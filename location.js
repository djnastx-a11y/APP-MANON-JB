import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.APP_CONFIG || {};
const msg = document.getElementById("locationMessage");
const sharingToggle = document.getElementById("sharingToggle");
const liveBadge = document.getElementById("liveBadge");
const refreshBtn = document.getElementById("refreshLocationBtn");
const sendNowBtn = document.getElementById("centerOnMeBtn");

let supabase = null;
let currentUser = null;
let watchId = null;
let realtimeChannel = null;
let sharingEnabled = false;
let lastPersistedAt = 0;
let lastPersistedPoint = null;
let lastPositions = [];

function setMessage(text, error = false) {
  msg.textContent = text || "";
  msg.classList.toggle("error", !!error);
}

function setLiveUi(enabled) {
  sharingEnabled = enabled;
  sharingToggle.checked = enabled;
  liveBadge.textContent = enabled ? "En direct" : "En pause";
  liveBadge.classList.toggle("on", enabled);
  liveBadge.classList.toggle("off", !enabled);
}

function formatAge(iso) {
  if (!iso) return "";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l’instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

function mapUrl(lat, lng) {
  const z = 16;
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=${z}/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}

function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function displayNames() {
  const mine = currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "Moi";
  const partner = mine.toLowerCase().includes("manon") ? "JB" : "Manon";
  document.getElementById("meName").textContent = mine;
  document.getElementById("meAvatar").textContent = mine.slice(0, 1).toUpperCase();
  document.getElementById("partnerName").textContent = partner;
  document.getElementById("partnerAvatar").textContent = partner.slice(0, 1).toUpperCase();
  return { mine, partner };
}

function paintPosition(cardPrefix, row) {
  const status = document.getElementById(`${cardPrefix}Status`);
  const meta = document.getElementById(`${cardPrefix}Meta`);
  const link = document.getElementById(`${cardPrefix}MapLink`);
  if (!row) {
    status.textContent = "Aucune position";
    meta.textContent = "";
    link.classList.add("hidden");
    link.removeAttribute("href");
    return;
  }
  status.textContent = `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`;
  const parts = [formatAge(row.captured_at)];
  if (Number.isFinite(row.accuracy_m)) parts.push(`précision ±${Math.round(row.accuracy_m)} m`);
  if (Number.isFinite(row.speed_mps) && row.speed_mps > 0.5) parts.push(`${Math.round(row.speed_mps * 3.6)} km/h`);
  meta.textContent = parts.filter(Boolean).join(" · ");
  link.href = mapUrl(row.latitude, row.longitude);
  link.classList.remove("hidden");
}

function renderPositions(rows = lastPositions) {
  lastPositions = Array.isArray(rows) ? rows : [];
  const me = lastPositions.find(r => r.user_id === currentUser?.id) || null;
  const partner = lastPositions.find(r => r.user_id !== currentUser?.id) || null;
  paintPosition("me", me);
  paintPosition("partner", partner);
}

async function loadPositions() {
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase
    .from("current_locations")
    .select("user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,source,captured_at,received_at")
    .order("captured_at", { ascending: false });
  if (error) {
    setMessage("Impossible de charger les positions.", true);
    return;
  }
  renderPositions(data || []);
}

async function loadSharingPreference() {
  const { data, error } = await supabase
    .from("location_sharing_preferences")
    .select("sharing_enabled")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    setMessage("Impossible de lire le réglage de partage.", true);
    return false;
  }
  setLiveUi(!!data?.sharing_enabled);
  return !!data?.sharing_enabled;
}

async function saveSharingPreference(enabled) {
  const { error } = await supabase
    .from("location_sharing_preferences")
    .upsert({ user_id: currentUser.id, sharing_enabled: enabled, precise_enabled: true, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function shouldPersistHistory(point) {
  const now = Date.now();
  if (!lastPersistedPoint) return true;
  if (now - lastPersistedAt >= 60000) return true;
  return haversineMeters(lastPersistedPoint, point) >= 50;
}

async function persistPosition(position, forceHistory = false) {
  if (!sharingEnabled || !currentUser) return;
  const c = position.coords;
  const capturedAt = new Date(position.timestamp || Date.now()).toISOString();
  const row = {
    user_id: currentUser.id,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: Number.isFinite(c.accuracy) ? c.accuracy : null,
    altitude_m: Number.isFinite(c.altitude) ? c.altitude : null,
    speed_mps: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
    heading_deg: Number.isFinite(c.heading) && c.heading >= 0 && c.heading < 360 ? c.heading : null,
    source: "web",
    captured_at: capturedAt,
    received_at: new Date().toISOString()
  };

  const { error: currentError } = await supabase.from("current_locations").upsert(row, { onConflict: "user_id" });
  if (currentError) throw currentError;

  const point = { latitude: c.latitude, longitude: c.longitude };
  if (forceHistory || shouldPersistHistory(point)) {
    const historyRow = { ...row };
    delete historyRow.received_at;
    const { error: historyError } = await supabase.from("location_history").insert(historyRow);
    if (historyError) throw historyError;
    lastPersistedAt = Date.now();
    lastPersistedPoint = point;
  }
  setMessage("Position synchronisée.");
}

function geoErrorText(error) {
  if (!error) return "Erreur de localisation.";
  if (error.code === 1) return "Permission de localisation refusée. Autorise-la dans les réglages du téléphone.";
  if (error.code === 2) return "Position indisponible pour le moment.";
  if (error.code === 3) return "La localisation a mis trop de temps à répondre.";
  return "Erreur de localisation.";
}

async function startSharing() {
  if (!("geolocation" in navigator)) {
    setLiveUi(false);
    setMessage("Ce navigateur ne fournit pas la géolocalisation.", true);
    return;
  }
  try {
    await saveSharingPreference(true);
    setLiveUi(true);
    setMessage("Activation de la localisation…");
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      p => persistPosition(p).catch(err => {
        console.error("location persist failed", err);
        setMessage("La position n’a pas pu être synchronisée.", true);
      }),
      async error => {
        console.warn("geolocation failed", error);
        setMessage(geoErrorText(error), true);
        await stopSharing(false).catch(() => {});
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  } catch (error) {
    console.error("start sharing failed", error);
    setLiveUi(false);
    setMessage("Impossible d’activer le partage.", true);
  }
}

async function stopSharing(updateRemote = true) {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (updateRemote && currentUser) await saveSharingPreference(false);
  setLiveUi(false);
  setMessage("Partage mis en pause.");
}

function sendCurrentPositionNow() {
  if (!("geolocation" in navigator)) {
    setMessage("Géolocalisation non disponible.", true);
    return;
  }
  if (!sharingEnabled) {
    setMessage("Active d’abord le partage de position.", true);
    return;
  }
  setMessage("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(
    p => persistPosition(p, true).catch(err => {
      console.error("manual position failed", err);
      setMessage("Impossible d’envoyer la position.", true);
    }),
    error => setMessage(geoErrorText(error), true),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

async function setupRealtime() {
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel("couple-live-location")
    .on("postgres_changes", { event: "*", schema: "public", table: "current_locations" }, () => loadPositions())
    .subscribe();
}

async function init() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setMessage("Configuration Supabase manquante.", true);
    sharingToggle.disabled = true;
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = data.session.user;
  displayNames();
  await loadPositions();
  const resumeSharing = await loadSharingPreference();
  await setupRealtime();

  if (resumeSharing) startSharing();

  sharingToggle.addEventListener("change", () => {
    if (sharingToggle.checked) startSharing();
    else stopSharing().catch(error => {
      console.error("stop sharing failed", error);
      setMessage("Impossible d’enregistrer la pause du partage.", true);
    });
  });
  refreshBtn.addEventListener("click", loadPositions);
  sendNowBtn.addEventListener("click", sendCurrentPositionNow);
  window.addEventListener("beforeunload", () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  });
}

init().catch(error => {
  console.error("location init failed", error);
  setMessage("Le module de localisation n’a pas pu démarrer.", true);
});
