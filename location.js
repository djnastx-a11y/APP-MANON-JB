import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.APP_CONFIG || {};
const msg = document.getElementById("locationMessage");
const sharingToggle = document.getElementById("sharingToggle");
const liveBadge = document.getElementById("liveBadge");
const refreshBtn = document.getElementById("refreshLocationBtn");
const sendNowBtn = document.getElementById("centerOnMeBtn");
const focusMeBtn = document.getElementById("focusMeBtn");
const focusPartnerBtn = document.getElementById("focusPartnerBtn");
const fitBothBtn = document.getElementById("fitBothBtn");
const placesBtn = document.getElementById("placesBtn");
const historyBtn = document.getElementById("historyBtn");
const meMapLink = document.getElementById("meMapLink");
const partnerMapLink = document.getElementById("partnerMapLink");
const distanceChip = document.getElementById("distanceChip");
const mapSubtitle = document.getElementById("mapSubtitle");

let supabase = null;
let currentUser = null;
let watchId = null;
let realtimeChannel = null;
let sharingEnabled = false;
let lastPersistedAt = 0;
let lastPersistedPoint = null;
let lastPositions = [];
let map = null;
let markers = new Map();
let accuracyCircle = null;
let hasAutoFramed = false;
let ageTimer = null;

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
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diff = Math.max(0, Date.now() - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "à l’instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function ageMinutes(iso) {
  if (!iso) return Infinity;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.max(0, Date.now() - timestamp) / 60000;
}

function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(Number(b.latitude) - Number(a.latitude));
  const dLon = toRad(Number(b.longitude) - Number(a.longitude));
  const lat1 = toRad(Number(a.latitude));
  const lat2 = toRad(Number(b.latitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

function displayNames() {
  const mine = currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "JB";
  const partner = mine.toLowerCase().includes("manon") ? "JB" : "Manon";
  ["meName", "meAvatar", "meMiniAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === "meName" ? mine : mine.slice(0, 1).toUpperCase();
  });
  ["partnerName", "partnerAvatar", "partnerMiniAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === "partnerName" ? partner : partner.slice(0, 1).toUpperCase();
  });
  mapSubtitle.textContent = `${mine} & ${partner}`;
}

function initMap() {
  if (!window.L) {
    setMessage("La carte n’a pas pu se charger.", true);
    return;
  }

  map = L.map("map", {
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true
  }).setView([47.75, -3.37], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  window.setTimeout(() => map?.invalidateSize(), 150);
}

function markerIcon(label, partner = false) {
  return L.divIcon({
    className: "person-marker",
    html: `<div class="person-pin ${partner ? "partner" : ""}"><span>${label}</span><i></i></div>`,
    iconSize: [58, 66],
    iconAnchor: [29, 58]
  });
}

function validRows(rows = lastPositions) {
  return rows.filter(row => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude)));
}

function fitEveryone(animate = true) {
  if (!map) return;
  const valid = validRows();
  if (!valid.length) {
    setMessage("Aucune position disponible pour le moment.", true);
    return;
  }
  if (valid.length === 1) {
    map.setView([Number(valid[0].latitude), Number(valid[0].longitude)], 16, { animate });
    return;
  }
  const bounds = L.latLngBounds(valid.map(row => [Number(row.latitude), Number(row.longitude)]));
  map.fitBounds(bounds.pad(.28), { maxZoom: 16, animate });
}

function updateMap(rows) {
  if (!map) return;
  const valid = validRows(rows);
  const seen = new Set();

  valid.forEach(row => {
    const partner = row.user_id !== currentUser?.id;
    const key = row.user_id;
    seen.add(key);
    const label = partner
      ? (document.getElementById("partnerAvatar")?.textContent || "M")
      : (document.getElementById("meAvatar")?.textContent || "J");
    const latlng = [Number(row.latitude), Number(row.longitude)];

    if (!markers.has(key)) {
      markers.set(key, L.marker(latlng, {
        icon: markerIcon(label, partner),
        riseOnHover: true,
        keyboard: false
      }).addTo(map));
    } else {
      markers.get(key).setLatLng(latlng);
    }

    if (!partner) {
      const accuracy = Number(row.accuracy_m);
      if (accuracyCircle) accuracyCircle.remove();
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 500) {
        accuracyCircle = L.circle(latlng, {
          radius: accuracy,
          className: "accuracy-ring",
          stroke: true,
          fill: true,
          interactive: false
        }).addTo(map);
      }
    }
  });

  [...markers.keys()].forEach(key => {
    if (!seen.has(key)) {
      markers.get(key).remove();
      markers.delete(key);
    }
  });

  if (!hasAutoFramed && valid.length) {
    hasAutoFramed = true;
    window.setTimeout(() => fitEveryone(false), 100);
  }
}

function paintPosition(cardPrefix, row) {
  const status = document.getElementById(`${cardPrefix}Status`);
  const meta = document.getElementById(`${cardPrefix}Meta`);
  const card = document.getElementById(`${cardPrefix}Card`);
  const button = document.getElementById(`${cardPrefix}MapLink`);

  if (!row) {
    status.textContent = "Position non disponible";
    meta.textContent = "";
    card.classList.remove("stale");
    button.classList.add("hidden");
    return;
  }

  const age = formatAge(row.captured_at);
  const minutes = ageMinutes(row.captured_at);
  const accuracy = Number(row.accuracy_m);
  const speed = Number(row.speed_mps);
  const isStale = minutes >= 15;

  if (cardPrefix === "me") {
    status.textContent = `Ma position · ${age}`;
  } else {
    status.textContent = isStale ? `Dernière position connue · ${age}` : `Position · ${age}`;
  }

  const parts = [];
  if (Number.isFinite(accuracy)) parts.push(`Précision ±${Math.round(accuracy)} m`);
  if (Number.isFinite(speed) && speed > .5) parts.push(`${Math.round(speed * 3.6)} km/h`);
  meta.textContent = parts.join(" · ");
  card.classList.toggle("stale", isStale && cardPrefix === "partner");
  button.classList.remove("hidden");
}

function updateDistance() {
  const me = lastPositions.find(row => row.user_id === currentUser?.id) || null;
  const partner = lastPositions.find(row => row.user_id !== currentUser?.id) || null;
  if (!me || !partner) {
    distanceChip.classList.add("hidden");
    distanceChip.textContent = "";
    return;
  }
  const distance = haversineMeters(me, partner);
  distanceChip.textContent = formatDistance(distance);
  distanceChip.classList.remove("hidden");
}

function renderPositions(rows = lastPositions) {
  lastPositions = Array.isArray(rows) ? rows : [];
  const me = lastPositions.find(row => row.user_id === currentUser?.id) || null;
  const partner = lastPositions.find(row => row.user_id !== currentUser?.id) || null;
  paintPosition("me", me);
  paintPosition("partner", partner);
  updateDistance();
  updateMap(lastPositions);
}

async function loadPositions({ quiet = false } = {}) {
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase
    .from("current_locations")
    .select("user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,source,captured_at,received_at")
    .order("captured_at", { ascending: false });

  if (error) {
    if (!quiet) setMessage("Impossible de charger les positions.", true);
    return;
  }

  renderPositions(data || []);
  if (!quiet) setMessage("");
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
    .upsert({
      user_id: currentUser.id,
      sharing_enabled: enabled,
      precise_enabled: true,
      updated_at: new Date().toISOString()
    });
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

  const { error: currentError } = await supabase
    .from("current_locations")
    .upsert(row, { onConflict: "user_id" });
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

  await loadPositions({ quiet: true });
  setMessage(`Position synchronisée · précision ±${Math.round(c.accuracy || 0)} m`);
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

  setMessage("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(async firstPosition => {
    try {
      await saveSharingPreference(true);
      setLiveUi(true);
      await persistPosition(firstPosition, true);

      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        position => persistPosition(position).catch(() => setMessage("La position n’a pas pu être synchronisée.", true)),
        async error => {
          try { await stopSharing(true); } catch (_) { setLiveUi(false); }
          setMessage(geoErrorText(error), true);
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    } catch (error) {
      console.error(error);
      try { await stopSharing(true); } catch (_) { setLiveUi(false); }
      setMessage("Impossible d’activer le partage.", true);
    }
  }, async error => {
    try { await stopSharing(true); } catch (_) { setLiveUi(false); }
    setMessage(geoErrorText(error), true);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
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
    position => persistPosition(position, true).then(() => focusUser(false)).catch(() => setMessage("Impossible d’envoyer la position.", true)),
    error => setMessage(geoErrorText(error), true),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

function focusUser(partner = false) {
  const row = lastPositions.find(item => partner ? item.user_id !== currentUser?.id : item.user_id === currentUser?.id);
  if (!row || !map) {
    setMessage(partner ? "Manon n’a pas encore partagé sa position." : "Ta position n’est pas encore disponible.", true);
    return;
  }
  map.setView([Number(row.latitude), Number(row.longitude)], 17, { animate: true });
}

async function setupRealtime() {
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel("couple-live-location")
    .on("postgres_changes", { event: "*", schema: "public", table: "current_locations" }, () => loadPositions({ quiet: true }))
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") setMessage("Connexion temps réel interrompue.", true);
    });
}

async function init() {
  initMap();

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
    if (sharingToggle.checked) {
      startSharing();
    } else {
      stopSharing(true)
        .then(() => setMessage("Partage mis en pause."))
        .catch(() => setMessage("Impossible d’enregistrer la pause du partage.", true));
    }
  });

  refreshBtn.addEventListener("click", async () => {
    await loadPositions();
    fitEveryone();
  });
  sendNowBtn.addEventListener("click", sendCurrentPositionNow);
  focusMeBtn.addEventListener("click", () => focusUser(false));
  focusPartnerBtn.addEventListener("click", () => focusUser(true));
  fitBothBtn.addEventListener("click", () => fitEveryone());
  meMapLink.addEventListener("click", () => focusUser(false));
  partnerMapLink.addEventListener("click", () => focusUser(true));
  placesBtn.addEventListener("click", () => setMessage("Les lieux et alertes d’arrivée et de départ arrivent dans l’étape suivante."));
  historyBtn.addEventListener("click", () => setMessage("L’historique de trajets arrive dans l’étape suivante."));

  ageTimer = window.setInterval(() => renderPositions(lastPositions), 30000);

  window.addEventListener("beforeunload", () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (ageTimer !== null) window.clearInterval(ageTimer);
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  });
}

init().catch(error => {
  console.error("location init failed", error);
  setMessage("Le module de localisation n’a pas pu démarrer.", true);
});
