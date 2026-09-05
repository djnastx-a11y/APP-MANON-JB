import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as maplibregl from "https://unpkg.com/maplibre-gl@6.7.0/dist/maplibre-gl.mjs";

const cfg = window.APP_CONFIG || {};
const msg = document.getElementById("locationMessage");
const sharingToggle = document.getElementById("sharingToggle");
const liveBadge = document.getElementById("liveBadge");
const refreshBtn = document.getElementById("refreshLocationBtn");
const sendNowBtn = document.getElementById("centerOnMeBtn");
const fitBothBtn = document.getElementById("fitBothBtn");
const focusMeBtn = document.getElementById("focusMeBtn");
const focusPartnerBtn = document.getElementById("focusPartnerBtn");
const meMapLink = document.getElementById("meMapLink");
const partnerMapLink = document.getElementById("partnerMapLink");

let supabase = null;
let currentUser = null;
let watchId = null;
let realtimeChannel = null;
let sharingEnabled = false;
let lastPersistedAt = 0;
let lastPersistedPoint = null;
let lastPositions = [];
let map = null;
let mapReady = false;
let meMarker = null;
let partnerMarker = null;

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
  return `il y a ${Math.floor(h / 24)} j`;
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

function currentNames() {
  const mine = currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "Moi";
  const partner = mine.toLowerCase().includes("manon") ? "JB" : "Manon";
  return { mine, partner };
}

function displayNames() {
  const { mine, partner } = currentNames();
  const mineInitial = mine.slice(0, 1).toUpperCase();
  const partnerInitial = partner.slice(0, 1).toUpperCase();
  document.getElementById("meName").textContent = mine;
  document.getElementById("meAvatar").textContent = mineInitial;
  document.getElementById("partnerName").textContent = partner;
  document.getElementById("partnerAvatar").textContent = partnerInitial;
  document.getElementById("mapMeName").textContent = mine;
  document.getElementById("mapMeAvatar").textContent = mineInitial;
  document.getElementById("mapPartnerName").textContent = partner;
  document.getElementById("mapPartnerAvatar").textContent = partnerInitial;
}

function initMap() {
  if (map) return;
  map = new maplibregl.Map({
    container: "liveMap",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [-3.36, 47.75],
    zoom: 11.5,
    attributionControl: true,
    cooperativeGestures: false
  });
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.on("load", () => {
    mapReady = true;
    syncMap(true);
  });
}

function makeMarker(kind, initial) {
  const el = document.createElement("div");
  el.className = `map-person-marker ${kind}`;
  el.textContent = initial;
  return el;
}

function getRows() {
  const me = lastPositions.find(r => r.user_id === currentUser?.id) || null;
  const partner = lastPositions.find(r => r.user_id !== currentUser?.id) || null;
  return { me, partner };
}

function upsertMarker(marker, row, kind, initial) {
  if (!mapReady || !row) {
    if (marker) marker.remove();
    return null;
  }
  const lngLat = [Number(row.longitude), Number(row.latitude)];
  if (!marker) {
    marker = new maplibregl.Marker({ element: makeMarker(kind, initial), anchor: "center" })
      .setLngLat(lngLat)
      .addTo(map);
  } else {
    marker.setLngLat(lngLat);
  }
  return marker;
}

function focusRow(row, zoom = 16) {
  if (!mapReady || !row) return;
  map.easeTo({
    center: [Number(row.longitude), Number(row.latitude)],
    zoom,
    duration: 650,
    essential: true
  });
  document.querySelector(".map-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fitBoth() {
  if (!mapReady) return;
  const { me, partner } = getRows();
  const rows = [me, partner].filter(Boolean);
  if (!rows.length) return;
  if (rows.length === 1) {
    focusRow(rows[0], 16);
    return;
  }
  const bounds = new maplibregl.LngLatBounds();
  rows.forEach(row => bounds.extend([Number(row.longitude), Number(row.latitude)]));
  map.fitBounds(bounds, {
    padding: { top: 100, right: 55, bottom: 110, left: 55 },
    maxZoom: 16,
    duration: 700
  });
}

function syncMap(fit = false) {
  if (!mapReady || !currentUser) return;
  const { mine, partner: partnerName } = currentNames();
  const { me, partner } = getRows();
  meMarker = upsertMarker(meMarker, me, "me", mine.slice(0, 1).toUpperCase());
  partnerMarker = upsertMarker(partnerMarker, partner, "partner", partnerName.slice(0, 1).toUpperCase());
  const subtitle = document.getElementById("mapSubtitle");
  if (subtitle) {
    if (me && partner) subtitle.textContent = "Vous êtes tous les deux visibles";
    else if (me || partner) subtitle.textContent = "1 position disponible";
    else subtitle.textContent = "Aucune position disponible";
  }
  if (fit) fitBoth();
}

function paintPosition(cardPrefix, row) {
  const status = document.getElementById(`${cardPrefix}Status`);
  const meta = document.getElementById(`${cardPrefix}Meta`);
  const button = document.getElementById(`${cardPrefix}MapLink`);
  if (!row) {
    status.textContent = "Aucune position";
    meta.textContent = "";
    button.classList.add("hidden");
    return;
  }
  status.textContent = `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`;
  const parts = [formatAge(row.captured_at)];
  const accuracy = Number(row.accuracy_m);
  const speed = Number(row.speed_mps);
  if (Number.isFinite(accuracy)) parts.push(`précision ±${Math.round(accuracy)} m`);
  if (Number.isFinite(speed) && speed > 0.5) parts.push(`${Math.round(speed * 3.6)} km/h`);
  meta.textContent = parts.filter(Boolean).join(" · ");
  button.classList.remove("hidden");
}

function renderPositions(rows = lastPositions, fit = false) {
  lastPositions = Array.isArray(rows) ? rows : [];
  const { me, partner } = getRows();
  paintPosition("me", me);
  paintPosition("partner", partner);
  syncMap(fit);
}

async function loadPositions(fit = false) {
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase
    .from("current_locations")
    .select("user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,source,captured_at,received_at")
    .order("captured_at", { ascending: false });
  if (error) {
    setMessage("Impossible de charger les positions.", true);
    return;
  }
  renderPositions(data || [], fit);
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
  await loadPositions(false);
  setMessage("Position synchronisée.");
}

function geoErrorText(error) {
  if (!error) return "Erreur de localisation.";
  if (error.code === 1) return "Permission de localisation refusée. Autorise-la dans les réglages du téléphone.";
  if (error.code === 2) return "Position indisponible pour le moment.";
  if (error.code === 3) return "La localisation a mis trop de temps à répondre.";
  return "Erreur de localisation.";
}

async function stopSharing(updateRemote = true) {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (updateRemote && currentUser) await saveSharingPreference(false);
  setLiveUi(false);
}

async function startSharing() {
  if (!("geolocation" in navigator)) {
    try { await stopSharing(true); } catch (_) { setLiveUi(false); }
    setMessage("Ce navigateur ne fournit pas la géolocalisation.", true);
    return;
  }

  setMessage("Vérification de la localisation…");
  navigator.geolocation.getCurrentPosition(
    async firstPosition => {
      try {
        await saveSharingPreference(true);
        setLiveUi(true);
        await persistPosition(firstPosition, true);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = navigator.geolocation.watchPosition(
          p => persistPosition(p).catch(err => {
            console.error("location persist failed", err);
            setMessage("La position n’a pas pu être synchronisée.", true);
          }),
          async error => {
            console.warn("geolocation failed", error);
            try { await stopSharing(true); } catch (_) { setLiveUi(false); }
            setMessage(geoErrorText(error), true);
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
      } catch (error) {
        console.error("start sharing failed", error);
        try { await stopSharing(true); } catch (_) { setLiveUi(false); }
        setMessage("Impossible d’activer le partage.", true);
      }
    },
    async error => {
      try { await stopSharing(true); } catch (_) { setLiveUi(false); }
      setMessage(geoErrorText(error), true);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
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
    .on("postgres_changes", { event: "*", schema: "public", table: "current_locations" }, () => loadPositions(false))
    .subscribe();
}

async function init() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setMessage("Configuration Supabase manquante.", true);
    sharingToggle.disabled = true;
    return;
  }

  initMap();
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = data.session.user;
  displayNames();
  await loadPositions(true);
  const resumeSharing = await loadSharingPreference();
  await setupRealtime();

  if (resumeSharing) startSharing();

  sharingToggle.addEventListener("change", () => {
    if (sharingToggle.checked) startSharing();
    else stopSharing(true).then(() => setMessage("Partage mis en pause.")).catch(error => {
      console.error("stop sharing failed", error);
      setMessage("Impossible d’enregistrer la pause du partage.", true);
    });
  });

  refreshBtn.addEventListener("click", () => loadPositions(true).catch(error => {
    console.error("load positions failed", error);
    setMessage("Impossible de charger les positions.", true);
  }));
  sendNowBtn.addEventListener("click", sendCurrentPositionNow);
  fitBothBtn?.addEventListener("click", fitBoth);
  focusMeBtn?.addEventListener("click", () => focusRow(getRows().me));
  focusPartnerBtn?.addEventListener("click", () => focusRow(getRows().partner));
  meMapLink?.addEventListener("click", () => focusRow(getRows().me));
  partnerMapLink?.addEventListener("click", () => focusRow(getRows().partner));

  window.addEventListener("beforeunload", () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    if (map) map.remove();
  });
}

init().catch(error => {
  console.error("location init failed", error);
  setMessage("Le module de localisation n’a pas pu démarrer.", true);
});
