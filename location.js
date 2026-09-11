import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const msg = $("locationMessage");
const sharingToggle = $("sharingToggle");
const liveBadge = $("liveBadge");
const shareLabel = $("shareLabel");
const statusSummary = $("statusSummary");
const partnerBubble = $("partnerBubble");
const partnerEventText = $("partnerEventText");
const partnerEventTime = $("partnerEventTime");

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
let toastTimer = null;

function setMessage(text, error = false) {
  if (!msg) return;
  msg.textContent = text || "";
  msg.classList.toggle("error", !!error);
  msg.classList.toggle("show", !!text);
  if (toastTimer) clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => msg.classList.remove("show"), 2800);
}

function setLiveUi(enabled) {
  sharingEnabled = enabled;
  if (sharingToggle) sharingToggle.checked = enabled;
  if (liveBadge) liveBadge.classList.toggle("on", enabled);
  if (shareLabel) shareLabel.textContent = enabled ? "Partage en direct" : "Partage désactivé";
  if (statusSummary) statusSummary.textContent = enabled ? "Position synchronisée entre vous deux" : "Localisation privée à deux";
}

function formatAge(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.floor(Math.max(0, Date.now() - t) / 1000);
  if (s < 45) return "À l’instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h} heure${h > 1 ? "s" : ""}`;
  const d = Math.floor(h / 24);
  return `Il y a ${d} jour${d > 1 ? "s" : ""}`;
}

function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(Number(b.latitude) - Number(a.latitude));
  const dLon = rad(Number(b.longitude) - Number(a.longitude));
  const lat1 = rad(Number(a.latitude));
  const lat2 = rad(Number(b.latitude));
  const x = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function displayNames() {
  const mine = currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "JB";
  const partner = mine.toLowerCase().includes("manon") ? "JB" : "Manon";
  if ($("meName")) $("meName").textContent = mine;
  if ($("partnerName")) $("partnerName").textContent = partner;
  ["meAvatar","meMiniAvatar"].forEach(id => { if ($(id)) $(id).textContent = mine.slice(0,1).toUpperCase(); });
  ["partnerAvatar","partnerMiniAvatar"].forEach(id => { if ($(id)) $(id).textContent = partner.slice(0,1).toUpperCase(); });
}

function initMap() {
  if (!window.L) {
    setMessage("La carte n’a pas pu se charger.", true);
    return;
  }
  map = L.map("map", { zoomControl:false, attributionControl:true, preferCanvas:true }).setView([47.75,-3.37], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:19, attribution:"© OpenStreetMap" }).addTo(map);
  setTimeout(() => map.invalidateSize(), 100);
}

function markerIcon(label, partner = false) {
  return L.divIcon({
    className:"person-marker",
    html:`<div class="person-pin ${partner ? "partner" : ""}"><span>${label}</span><i></i></div>`,
    iconSize:[84,98],
    iconAnchor:[42,88]
  });
}

function validRows(rows = lastPositions) {
  return rows.filter(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)));
}

function fitEveryone(animate = true) {
  if (!map) return;
  const rows = validRows();
  if (!rows.length) return setMessage("Aucune position disponible pour le moment.", true);
  if (rows.length === 1) return map.setView([Number(rows[0].latitude),Number(rows[0].longitude)],16,{animate});
  const bounds = L.latLngBounds(rows.map(r => [Number(r.latitude),Number(r.longitude)]));
  map.fitBounds(bounds.pad(.45),{maxZoom:16,animate});
}

function focusUser(partner = false) {
  const row = lastPositions.find(r => partner ? r.user_id !== currentUser?.id : r.user_id === currentUser?.id);
  if (!row || !map) return setMessage(partner ? "Position de Manon indisponible." : "Ta position est indisponible.", true);
  map.setView([Number(row.latitude),Number(row.longitude)],17,{animate:true});
}

function updatePartnerBubble(partner) {
  if (!partner || !partnerBubble) {
    partnerBubble?.classList.add("hidden");
    return;
  }
  partnerBubble.classList.remove("hidden");
  const name = $("partnerName")?.textContent || "Manon";
  if (partnerEventText) partnerEventText.textContent = `${name}, dernière position`;
  if (partnerEventTime) partnerEventTime.textContent = formatAge(partner.captured_at);
}

function updateMap(rows) {
  if (!map) return;
  const valid = validRows(rows);
  const seen = new Set();
  valid.forEach(row => {
    const partner = row.user_id !== currentUser?.id;
    const key = row.user_id;
    seen.add(key);
    const label = partner ? ($("partnerAvatar")?.textContent || "M") : ($("meAvatar")?.textContent || "J");
    const latlng = [Number(row.latitude), Number(row.longitude)];
    if (!markers.has(key)) {
      markers.set(key, L.marker(latlng,{icon:markerIcon(label,partner),keyboard:false,riseOnHover:true}).addTo(map));
    } else {
      markers.get(key).setLatLng(latlng);
    }
    if (!partner) {
      const accuracy = Number(row.accuracy_m);
      if (accuracyCircle) accuracyCircle.remove();
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 500) {
        accuracyCircle = L.circle(latlng,{radius:accuracy,className:"accuracy-ring",stroke:true,fill:true,interactive:false}).addTo(map);
      }
    }
  });
  [...markers.keys()].forEach(key => {
    if (!seen.has(key)) { markers.get(key).remove(); markers.delete(key); }
  });
  if (!hasAutoFramed && valid.length) {
    hasAutoFramed = true;
    setTimeout(() => fitEveryone(false), 120);
  }
}

function renderPositions(rows = lastPositions) {
  lastPositions = Array.isArray(rows) ? rows : [];
  const me = lastPositions.find(r => r.user_id === currentUser?.id) || null;
  const partner = lastPositions.find(r => r.user_id !== currentUser?.id) || null;
  if ($("meStatus")) $("meStatus").textContent = me ? formatAge(me.captured_at) : "Indisponible";
  if ($("partnerStatus")) $("partnerStatus").textContent = partner ? formatAge(partner.captured_at) : "Indisponible";
  if (me && partner && statusSummary) {
    const d = haversineMeters(me,partner);
    statusSummary.textContent = d < 1000 ? `${Math.round(d)} m entre vous` : `${(d/1000).toFixed(1)} km entre vous`;
  }
  updatePartnerBubble(partner);
  updateMap(lastPositions);
}

async function loadPositions({quiet=false} = {}) {
  if (!supabase || !currentUser) return;
  const {data,error} = await supabase.from("current_locations")
    .select("user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,source,captured_at,received_at")
    .order("captured_at",{ascending:false});
  if (error) {
    if (!quiet) setMessage("Impossible de charger les positions.", true);
    return;
  }
  renderPositions(data || []);
}

async function loadSharingPreference() {
  const {data,error} = await supabase.from("location_sharing_preferences")
    .select("sharing_enabled").eq("user_id",currentUser.id).maybeSingle();
  if (error) { setMessage("Impossible de lire le partage.", true); return false; }
  setLiveUi(!!data?.sharing_enabled);
  return !!data?.sharing_enabled;
}

async function saveSharingPreference(enabled) {
  const {error} = await supabase.from("location_sharing_preferences").upsert({
    user_id:currentUser.id,
    sharing_enabled:enabled,
    precise_enabled:true,
    updated_at:new Date().toISOString()
  });
  if (error) throw error;
}

function shouldPersistHistory(point) {
  const now = Date.now();
  if (!lastPersistedPoint) return true;
  if (now - lastPersistedAt >= 60000) return true;
  return haversineMeters(lastPersistedPoint,point) >= 50;
}

async function persistPosition(position, forceHistory = false) {
  if (!sharingEnabled || !currentUser) return;
  const c = position.coords;
  const row = {
    user_id:currentUser.id,
    latitude:c.latitude,
    longitude:c.longitude,
    accuracy_m:Number.isFinite(c.accuracy)?c.accuracy:null,
    altitude_m:Number.isFinite(c.altitude)?c.altitude:null,
    speed_mps:Number.isFinite(c.speed)&&c.speed>=0?c.speed:null,
    heading_deg:Number.isFinite(c.heading)&&c.heading>=0&&c.heading<360?c.heading:null,
    source:"web",
    captured_at:new Date(position.timestamp || Date.now()).toISOString(),
    received_at:new Date().toISOString()
  };
  const {error:currentError} = await supabase.from("current_locations").upsert(row,{onConflict:"user_id"});
  if (currentError) throw currentError;
  const point = {latitude:c.latitude,longitude:c.longitude};
  if (forceHistory || shouldPersistHistory(point)) {
    const historyRow = {...row}; delete historyRow.received_at;
    const {error:historyError} = await supabase.from("location_history").insert(historyRow);
    if (historyError) throw historyError;
    lastPersistedAt = Date.now();
    lastPersistedPoint = point;
  }
  await loadPositions({quiet:true});
}

function geoErrorText(error) {
  if (!error) return "Erreur de localisation.";
  if (error.code===1) return "Permission de localisation refusée.";
  if (error.code===2) return "Position indisponible pour le moment.";
  if (error.code===3) return "La localisation met trop de temps à répondre.";
  return "Erreur de localisation.";
}

async function stopSharing(updateRemote=true) {
  if (watchId!==null) { navigator.geolocation.clearWatch(watchId); watchId=null; }
  if (updateRemote && currentUser) await saveSharingPreference(false);
  setLiveUi(false);
}

async function startSharing() {
  if (!("geolocation" in navigator)) return setMessage("Géolocalisation non disponible.",true);
  setMessage("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(async firstPosition => {
    try {
      await saveSharingPreference(true);
      setLiveUi(true);
      await persistPosition(firstPosition,true);
      focusUser(false);
      if (watchId!==null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        p => persistPosition(p).catch(() => setMessage("La position n’a pas pu être synchronisée.",true)),
        e => setMessage(geoErrorText(e),true),
        {enableHighAccuracy:true,maximumAge:3000,timeout:15000}
      );
    } catch (e) {
      console.error(e);
      setMessage("Impossible d’activer le partage.",true);
      setLiveUi(false);
    }
  }, e => {
    setMessage(geoErrorText(e),true);
    setLiveUi(false);
  }, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
}

function requestCurrentPosition() {
  if (!("geolocation" in navigator)) return setMessage("Géolocalisation non disponible.",true);
  if (!sharingEnabled) {
    sharingToggle.checked = true;
    startSharing();
    return;
  }
  setMessage("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(
    p => persistPosition(p,true).then(() => focusUser(false)).catch(() => setMessage("Impossible d’actualiser ta position.",true)),
    e => setMessage(geoErrorText(e),true),
    {enableHighAccuracy:true,maximumAge:0,timeout:15000}
  );
}

async function setupRealtime() {
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase.channel("couple-live-location")
    .on("postgres_changes",{event:"*",schema:"public",table:"current_locations"},() => loadPositions({quiet:true}))
    .subscribe();
}

function bindUi() {
  sharingToggle?.addEventListener("change",() => {
    if (sharingToggle.checked) startSharing();
    else stopSharing(true).then(() => setMessage("Partage mis en pause."));
  });
  $("centerOnMeBtn")?.addEventListener("click",requestCurrentPosition);
  $("locatePill")?.addEventListener("click",requestCurrentPosition);
  $("refreshLocationBtn")?.addEventListener("click",() => loadPositions().then(() => fitEveryone()));
  $("focusMeBtn")?.addEventListener("click",() => focusUser(false));
  $("focusPartnerBtn")?.addEventListener("click",() => focusUser(true));
  $("fitBothBtn")?.addEventListener("click",() => fitEveryone());
  $("familyBtn")?.addEventListener("click",() => fitEveryone());
  $("layersBtn")?.addEventListener("click",() => setMessage("Vue carte active."));
  $("settingsBtn")?.addEventListener("click",() => setMessage(sharingEnabled ? "Partage de position activé." : "Partage de position désactivé."));
  $("inboxBtn")?.addEventListener("click",() => setMessage("Messages de Nous Deux."));
  $("chatBtn")?.addEventListener("click",() => { window.location.href="index.html#us"; });
  $("sosBtn")?.addEventListener("click",() => setMessage("Configuration SOS à ajouter ensuite."));
  $("navLocation")?.addEventListener("click",() => fitEveryone());
  $("navDrive")?.addEventListener("click",() => setMessage("Module Au volant à ajouter ensuite."));
  $("navSafety")?.addEventListener("click",() => setMessage("Module Sécurité à ajouter ensuite."));
  $("navAccount")?.addEventListener("click",() => setMessage("Module Abonnement à ajouter ensuite."));
}

async function init() {
  initMap();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setMessage("Configuration Supabase manquante.",true);
    sharingToggle.disabled = true;
    return;
  }
  supabase = createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
  const {data,error} = await supabase.auth.getSession();
  if (error || !data.session?.user) { window.location.replace("index.html"); return; }
  currentUser = data.session.user;
  displayNames();
  bindUi();
  await loadPositions();
  const resume = await loadSharingPreference();
  await setupRealtime();
  if (resume) startSharing();
  setInterval(() => renderPositions(lastPositions),30000);
}

init().catch(error => {
  console.error("location init failed",error);
  setMessage("La localisation n’a pas pu démarrer.",true);
});
