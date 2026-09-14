import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const qsa = selector => [...document.querySelectorAll(selector)];

let supabase = null;
let currentUser = null;
let currentRows = [];
let sharingEnabled = false;
let watchId = null;
let realtimeChannel = null;
let map = null;
let baseLayers = [];
let activeBaseLayer = 0;
let markers = new Map();
let accuracyCircle = null;
let toastTimer = null;
let lastPersistedAt = 0;
let lastPersistedPoint = null;
let hasAutoFramed = false;
let selectedMemberId = null;
let historyDate = new Date();
let historyLayer = null;
let historyRows = [];
let lastPlaceState = new Map();

const PLACE_KEY = "nous-deux-places-v2";
const SOS_KEY = "nous-deux-sos-v1";

function setMessage(text, error = false) {
  const node = $("locationMessage");
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("error", !!error);
  node.classList.toggle("show", !!text);
  if (toastTimer) clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => node.classList.remove("show"), 2800);
}

function formatAge(iso) {
  if (!iso) return "Indisponible";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Indisponible";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 45) return "À l’instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `Il y a ${d} j`;
}

function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const lat1 = Number(a.latitude), lon1 = Number(a.longitude), lat2 = Number(b.latitude), lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
  const R = 6371000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function totalDistance(rows) {
  let meters = 0;
  for (let i = 1; i < rows.length; i++) meters += haversineMeters(rows[i - 1], rows[i]);
  return meters;
}

function memberName(row) {
  if (!row) return "Membre";
  if (row.user_id === currentUser?.id) return currentUser?.user_metadata?.display_name || currentUser?.email?.split("@")[0] || "JB";
  return row.display_name || "Manon";
}

function memberInitial(row) {
  return memberName(row).slice(0, 1).toUpperCase();
}

function validRows(rows = currentRows) {
  return (rows || []).filter(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)));
}

function setSharingUi(enabled) {
  sharingEnabled = !!enabled;
  const toggle = $("sharingToggle");
  if (toggle) toggle.checked = sharingEnabled;
  if ($("shareLabel")) $("shareLabel").textContent = sharingEnabled ? "Partage actif" : "Partage désactivé";
  if ($("settingsShareStatus")) $("settingsShareStatus").textContent = sharingEnabled ? "Activé" : "Désactivé";
}

function initMap() {
  if (!window.L) return setMessage("La carte n’a pas pu se charger.", true);
  map = L.map("map", { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([47.748, -3.367], 14);
  const voyager = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    subdomains: "abcd",
    attribution: "© OpenStreetMap © CARTO"
  });
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  });
  baseLayers = [voyager, osm];
  voyager.addTo(map);
  setTimeout(() => map.invalidateSize(), 120);
}

function markerIcon(row) {
  const partner = row.user_id !== currentUser?.id;
  return L.divIcon({
    className: "person-marker",
    html: `<div class="person-pin ${partner ? "partner" : ""}"><span>${memberInitial(row)}</span></div>`,
    iconSize: [66, 78],
    iconAnchor: [33, 72]
  });
}

function updateMap(rows) {
  if (!map) return;
  const valid = validRows(rows);
  const seen = new Set();
  for (const row of valid) {
    const key = row.user_id;
    seen.add(key);
    const latlng = [Number(row.latitude), Number(row.longitude)];
    if (!markers.has(key)) {
      const marker = L.marker(latlng, { icon: markerIcon(row), keyboard: false, riseOnHover: true }).addTo(map);
      marker.on("click", () => selectMember(key, true));
      markers.set(key, marker);
    } else {
      markers.get(key).setLatLng(latlng);
    }
    if (key === currentUser?.id) {
      const accuracy = Number(row.accuracy_m);
      if (accuracyCircle) accuracyCircle.remove();
      if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 500) {
        accuracyCircle = L.circle(latlng, { radius: accuracy, className: "accuracy-ring", stroke: true, fill: true, interactive: false }).addTo(map);
      }
    }
  }
  for (const key of [...markers.keys()]) {
    if (!seen.has(key)) {
      markers.get(key).remove();
      markers.delete(key);
    }
  }
  if (!hasAutoFramed && valid.length) {
    hasAutoFramed = true;
    setTimeout(() => fitEveryone(false), 150);
  }
}

function fitEveryone(animate = true) {
  if (!map) return;
  const rows = validRows();
  if (!rows.length) return setMessage("Aucune position disponible.", true);
  clearHistoryOverlay();
  if (rows.length === 1) return map.setView([Number(rows[0].latitude), Number(rows[0].longitude)], 16, { animate });
  const bounds = L.latLngBounds(rows.map(r => [Number(r.latitude), Number(r.longitude)]));
  map.fitBounds(bounds.pad(.4), { maxZoom: 16, animate });
}

function focusMember(userId) {
  const row = currentRows.find(r => r.user_id === userId);
  if (!row || !map) return setMessage("Position indisponible.", true);
  clearHistoryOverlay();
  map.setView([Number(row.latitude), Number(row.longitude)], 17, { animate: true });
}

function selectMember(userId, focus = false) {
  selectedMemberId = userId;
  qsa(".member-card").forEach(node => node.classList.toggle("active", node.dataset.userId === userId));
  const row = currentRows.find(r => r.user_id === userId);
  if (row) {
    $("memberCallout")?.classList.remove("hidden");
    if ($("memberCalloutName")) $("memberCalloutName").textContent = memberName(row);
    if ($("memberCalloutStatus")) $("memberCalloutStatus").textContent = formatAge(row.captured_at);
  }
  if (focus) focusMember(userId);
}

function renderMembers() {
  const rail = $("membersRail");
  if (!rail) return;
  rail.innerHTML = "";
  const rows = validRows();
  const sorted = [...rows].sort((a, b) => a.user_id === currentUser?.id ? -1 : b.user_id === currentUser?.id ? 1 : 0);
  if ($("sheetSubtitle")) $("sheetSubtitle").textContent = `${sorted.length || 0} membre${sorted.length > 1 ? "s" : ""}`;
  for (const row of sorted) {
    const button = document.createElement("button");
    button.className = "member-card" + (selectedMemberId === row.user_id ? " active" : "");
    button.type = "button";
    button.dataset.userId = row.user_id;
    button.innerHTML = `<span class="member-avatar">${memberInitial(row)}</span><strong>${memberName(row)}</strong><small>${formatAge(row.captured_at)}</small>`;
    button.addEventListener("click", () => selectMember(row.user_id, true));
    rail.appendChild(button);
  }
  if (!selectedMemberId && sorted.length) selectedMemberId = sorted[0].user_id;
}

function renderPositions(rows) {
  currentRows = Array.isArray(rows) ? rows : [];
  renderMembers();
  updateMap(currentRows);
  const partner = currentRows.find(r => r.user_id !== currentUser?.id);
  if (partner && !selectedMemberId) selectMember(partner.user_id, false);
  evaluatePlaces();
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
}

async function loadSharingPreference() {
  const { data, error } = await supabase.from("location_sharing_preferences").select("sharing_enabled").eq("user_id", currentUser.id).maybeSingle();
  if (error) {
    setMessage("Impossible de lire le partage.", true);
    return false;
  }
  setSharingUi(!!data?.sharing_enabled);
  return !!data?.sharing_enabled;
}

async function saveSharingPreference(enabled) {
  const { error } = await supabase.from("location_sharing_preferences").upsert({
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
  return haversineMeters(lastPersistedPoint, point) >= 40;
}

async function persistPosition(position, forceHistory = false) {
  if (!sharingEnabled || !currentUser) return;
  const c = position.coords;
  const row = {
    user_id: currentUser.id,
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy_m: Number.isFinite(c.accuracy) ? c.accuracy : null,
    altitude_m: Number.isFinite(c.altitude) ? c.altitude : null,
    speed_mps: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
    heading_deg: Number.isFinite(c.heading) && c.heading >= 0 && c.heading < 360 ? c.heading : null,
    source: "web",
    captured_at: new Date(position.timestamp || Date.now()).toISOString(),
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
  await loadPositions({ quiet: true });
}

function geoErrorText(error) {
  if (!error) return "Erreur de localisation.";
  if (error.code === 1) return "Permission de localisation refusée.";
  if (error.code === 2) return "Position indisponible.";
  if (error.code === 3) return "La localisation met trop de temps à répondre.";
  return "Erreur de localisation.";
}

async function stopSharing(updateRemote = true) {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (updateRemote && currentUser) await saveSharingPreference(false);
  setSharingUi(false);
}

async function startSharing() {
  if (!("geolocation" in navigator)) return setMessage("Géolocalisation non disponible.", true);
  setMessage("Recherche de ta position…");
  navigator.geolocation.getCurrentPosition(async firstPosition => {
    try {
      await saveSharingPreference(true);
      setSharingUi(true);
      await persistPosition(firstPosition, true);
      focusMember(currentUser.id);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        p => persistPosition(p).catch(() => setMessage("Synchronisation impossible.", true)),
        e => setMessage(geoErrorText(e), true),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    } catch (error) {
      console.error(error);
      setSharingUi(false);
      setMessage("Impossible d’activer le partage.", true);
    }
  }, e => {
    setSharingUi(false);
    setMessage(geoErrorText(e), true);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

function requestCurrentPosition() {
  if (!("geolocation" in navigator)) return setMessage("Géolocalisation non disponible.", true);
  if (!sharingEnabled) return startSharing();
  setMessage("Actualisation…");
  navigator.geolocation.getCurrentPosition(
    p => persistPosition(p, true).then(() => focusMember(currentUser.id)).catch(() => setMessage("Actualisation impossible.", true)),
    e => setMessage(geoErrorText(e), true),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

async function setupRealtime() {
  if (realtimeChannel) await supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel("nous-deux-live-location")
    .on("postgres_changes", { event: "*", schema: "public", table: "current_locations" }, () => loadPositions({ quiet: true }))
    .subscribe();
}

function drawerOpen(id) {
  qsa(".drawer").forEach(node => node.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
  $("panelBackdrop")?.classList.remove("hidden");
}

function closeDrawers() {
  qsa(".drawer").forEach(node => node.classList.add("hidden"));
  $("panelBackdrop")?.classList.add("hidden");
}

function showFullPanel(id, navId) {
  qsa(".full-panel").forEach(node => node.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
  qsa(".nav-item").forEach(node => node.classList.remove("active"));
  $(navId)?.classList.add("active");
}

function showLocation() {
  qsa(".full-panel").forEach(node => node.classList.add("hidden"));
  qsa(".nav-item").forEach(node => node.classList.remove("active"));
  $("navLocation")?.classList.add("active");
  setTimeout(() => map?.invalidateSize(), 80);
}

function loadPlaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLACE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePlaces(places) {
  localStorage.setItem(PLACE_KEY, JSON.stringify(places));
}

function renderPlaces() {
  const list = $("placesList");
  if (!list) return;
  const places = loadPlaces();
  list.innerHTML = "";
  if (!places.length) {
    list.innerHTML = `<div class="place-row"><span><strong>Aucun lieu enregistré</strong><small>Ajoute Maison, Travail, Salle de sport ou un autre lieu.</small></span><b>+</b></div>`;
    return;
  }
  for (const place of places) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "place-row";
    row.innerHTML = `<span><strong>${place.name}</strong><small>Zone de ${place.radius} m · alertes actives</small></span><b>›</b>`;
    row.addEventListener("click", () => {
      closeDrawers();
      map?.setView([place.latitude, place.longitude], 17, { animate: true });
      L.circle([place.latitude, place.longitude], { radius: place.radius, className: "accuracy-ring" }).addTo(map);
    });
    list.appendChild(row);
  }
}

function addPlace() {
  if (!map) return;
  const name = window.prompt("Nom du lieu", "Maison");
  if (!name?.trim()) return;
  const center = map.getCenter();
  const radiusText = window.prompt("Rayon de la zone en mètres", "150");
  const radius = Math.max(75, Math.min(3200, Number(radiusText) || 150));
  const places = loadPlaces();
  places.push({ id: crypto.randomUUID?.() || String(Date.now()), name: name.trim(), latitude: center.lat, longitude: center.lng, radius });
  savePlaces(places);
  renderPlaces();
  setMessage(`${name.trim()} ajouté au centre de la carte.`);
}

async function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body, icon: "icon.svg" });
}

function evaluatePlaces() {
  const places = loadPlaces();
  if (!places.length) return;
  for (const row of validRows()) {
    for (const place of places) {
      const key = `${row.user_id}:${place.id}`;
      const inside = haversineMeters(row, place) <= place.radius;
      const previous = lastPlaceState.get(key);
      if (previous !== undefined && previous !== inside) {
        const verb = inside ? "est arrivé(e) à" : "a quitté";
        notify("Nous Deux", `${memberName(row)} ${verb} ${place.name}`);
      }
      lastPlaceState.set(key, inside);
    }
  }
}

async function doCheckIn() {
  if (!("geolocation" in navigator)) return setMessage("Géolocalisation non disponible.", true);
  navigator.geolocation.getCurrentPosition(async p => {
    try {
      if (!sharingEnabled) {
        await saveSharingPreference(true);
        setSharingUi(true);
      }
      await persistPosition(p, true);
      setMessage("Check-in envoyé à ton cercle.");
    } catch (e) {
      console.error(e);
      setMessage("Check-in impossible.", true);
    }
  }, e => setMessage(geoErrorText(e), true), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

async function triggerSos() {
  const ok = window.confirm("Envoyer une alerte SOS à ton cercle avec ta position actuelle ?");
  if (!ok) return;
  if (!("geolocation" in navigator)) return setMessage("Position indisponible pour le SOS.", true);
  navigator.geolocation.getCurrentPosition(async p => {
    const lat = p.coords.latitude.toFixed(6);
    const lon = p.coords.longitude.toFixed(6);
    const event = { at: new Date().toISOString(), user_id: currentUser?.id, latitude: p.coords.latitude, longitude: p.coords.longitude };
    const stored = JSON.parse(localStorage.getItem(SOS_KEY) || "[]");
    stored.unshift(event);
    localStorage.setItem(SOS_KEY, JSON.stringify(stored.slice(0, 20)));
    let delivered = false;
    try {
      const { error } = await supabase.from("messages").insert({
        sender_id: currentUser.id,
        body: `🚨 SOS · J’ai besoin d’aide. Position: ${lat}, ${lon}`
      });
      delivered = !error;
    } catch {}
    await notify("SOS envoyé", delivered ? "Ton cercle a reçu l’alerte dans Nous Deux." : "L’alerte est enregistrée sur ce téléphone.");
    setMessage(delivered ? "SOS envoyé au cercle." : "SOS enregistré, envoi au cercle indisponible.", !delivered);
  }, e => setMessage(geoErrorText(e), true), { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatHistoryDate(date) {
  const today = startOfDay(new Date()).getTime();
  const target = startOfDay(date).getTime();
  if (target === today) return "Aujourd’hui";
  if (target === today - 86400000) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function clearHistoryOverlay() {
  if (historyLayer && map) {
    historyLayer.remove();
    historyLayer = null;
  }
}

function renderHistoryMemberSwitch() {
  const wrap = $("historyMemberSwitch");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const row of validRows()) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = memberName(row);
    b.classList.toggle("active", row.user_id === selectedMemberId);
    b.addEventListener("click", () => {
      selectedMemberId = row.user_id;
      renderHistoryMemberSwitch();
      loadHistory();
    });
    wrap.appendChild(b);
  }
}

function drawHistory(rows) {
  clearHistoryOverlay();
  if (!map || !rows.length) return;
  const group = L.layerGroup().addTo(map);
  historyLayer = group;
  const points = rows.map(r => [Number(r.latitude), Number(r.longitude)]).filter(p => p.every(Number.isFinite));
  if (!points.length) return;
  L.polyline(points, { color: "#8d4df7", weight: 5, opacity: .7 }).addTo(group);
  const step = Math.max(1, Math.ceil(points.length / 28));
  for (let i = 0; i < points.length; i += step) {
    L.circleMarker(points[i], { radius: 4, color: "#fff", weight: 2, fillColor: "#8d4df7", fillOpacity: 1 }).addTo(group);
  }
  map.fitBounds(L.latLngBounds(points).pad(.22), { maxZoom: 16, animate: true });
}

function renderHistory(rows) {
  historyRows = rows || [];
  const timeline = $("historyTimeline");
  const stats = $("historyStats");
  if ($("historyDateLabel")) $("historyDateLabel").textContent = formatHistoryDate(historyDate);
  const distanceKm = totalDistance(historyRows) / 1000;
  const first = historyRows[0];
  const last = historyRows[historyRows.length - 1];
  const duration = first && last ? new Date(last.captured_at) - new Date(first.captured_at) : 0;
  if (stats) stats.innerHTML = `<div class="history-stat"><strong>${historyRows.length}</strong><span>POSITIONS</span></div><div class="history-stat"><strong>${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km</strong><span>DISTANCE</span></div><div class="history-stat"><strong>${formatDuration(duration)}</strong><span>AMPLITUDE</span></div>`;
  if (timeline) {
    timeline.innerHTML = "";
    if (!historyRows.length) timeline.innerHTML = `<div class="timeline-row"><span class="timeline-dot"></span><span><strong>Aucun déplacement</strong><small>Aucune position enregistrée pour cette journée.</small></span></div>`;
    const max = 36;
    const step = Math.max(1, Math.ceil(historyRows.length / max));
    for (let i = 0; i < historyRows.length; i += step) {
      const row = historyRows[i];
      const item = document.createElement("div");
      item.className = "timeline-row";
      const speed = Number(row.speed_mps);
      const speedText = Number.isFinite(speed) && speed > 1 ? ` · ${Math.round(speed * 3.6)} km/h` : "";
      item.innerHTML = `<span class="timeline-dot"></span><span><strong>${formatClock(row.captured_at)}</strong><small>Position enregistrée${speedText}</small></span>`;
      item.addEventListener("click", () => {
        closeDrawers();
        map?.setView([Number(row.latitude), Number(row.longitude)], 17, { animate: true });
      });
      timeline.appendChild(item);
    }
  }
  drawHistory(historyRows);
  renderDriveTrips(historyRows);
}

async function loadHistory() {
  if (!supabase || !selectedMemberId) return;
  const from = startOfDay(historyDate).toISOString();
  const to = endOfDay(historyDate).toISOString();
  const { data, error } = await supabase
    .from("location_history")
    .select("user_id,latitude,longitude,accuracy_m,speed_mps,heading_deg,captured_at")
    .eq("user_id", selectedMemberId)
    .gte("captured_at", from)
    .lte("captured_at", to)
    .order("captured_at", { ascending: true });
  if (error) {
    console.error(error);
    setMessage("Historique indisponible.", true);
    return;
  }
  renderHistory(data || []);
}

function splitTrips(rows) {
  const trips = [];
  let current = [];
  for (const row of rows) {
    if (!current.length) {
      current.push(row);
      continue;
    }
    const previous = current[current.length - 1];
    const gap = new Date(row.captured_at) - new Date(previous.captured_at);
    if (gap > 20 * 60000) {
      if (current.length > 1) trips.push(current);
      current = [row];
    } else current.push(row);
  }
  if (current.length > 1) trips.push(current);
  return trips.filter(t => totalDistance(t) >= 250);
}

function renderDriveTrips(rows = historyRows) {
  const trips = splitTrips(rows || []);
  const list = $("driveTrips");
  if (!list) return;
  list.innerHTML = "";
  if (!trips.length) {
    if ($("driveHeadline")) $("driveHeadline").textContent = "Aucun trajet aujourd’hui";
    if ($("driveCopy")) $("driveCopy").textContent = "Les trajets détectés apparaîtront ici avec durée, distance, vitesse et événements de conduite.";
    return;
  }
  if ($("driveHeadline")) $("driveHeadline").textContent = `${trips.length} trajet${trips.length > 1 ? "s" : ""} détecté${trips.length > 1 ? "s" : ""}`;
  if ($("driveCopy")) $("driveCopy").textContent = `${(trips.reduce((sum, t) => sum + totalDistance(t), 0) / 1000).toFixed(1)} km enregistrés sur la journée.`;
  for (const trip of trips.reverse()) {
    const distance = totalDistance(trip) / 1000;
    const duration = new Date(trip[trip.length - 1].captured_at) - new Date(trip[0].captured_at);
    const maxSpeed = Math.max(...trip.map(r => Number(r.speed_mps) || 0)) * 3.6;
    const row = document.createElement("div");
    row.className = "trip-row";
    row.innerHTML = `<span><strong>${formatClock(trip[0].captured_at)} → ${formatClock(trip[trip.length - 1].captured_at)}</strong><small>${distance.toFixed(1)} km · ${formatDuration(duration)} · max ${Math.round(maxSpeed)} km/h</small></span><b>›</b>`;
    list.appendChild(row);
  }
}

async function updateBatteryUi() {
  if (!("getBattery" in navigator)) return;
  try {
    const battery = await navigator.getBattery();
    const refresh = () => {
      if ($("batteryText")) $("batteryText").textContent = `Ce téléphone: ${Math.round(battery.level * 100)} %${battery.charging ? " · en charge" : ""}`;
    };
    refresh();
    battery.addEventListener("levelchange", refresh);
    battery.addEventListener("chargingchange", refresh);
  } catch {}
}

function changeBaseLayer() {
  if (!map || !baseLayers.length) return;
  map.removeLayer(baseLayers[activeBaseLayer]);
  activeBaseLayer = (activeBaseLayer + 1) % baseLayers.length;
  baseLayers[activeBaseLayer].addTo(map);
  setMessage(activeBaseLayer === 0 ? "Carte claire active." : "Carte standard active.");
}

function bindUi() {
  $("sharingToggle")?.addEventListener("change", e => {
    if (e.target.checked) startSharing();
    else stopSharing(true).then(() => setMessage("Partage de position en pause.")).catch(() => setMessage("Impossible de modifier le partage.", true));
  });
  $("centerOnMeBtn")?.addEventListener("click", requestCurrentPosition);
  $("fitBothBtn")?.addEventListener("click", () => fitEveryone());
  $("layersBtn")?.addEventListener("click", changeBaseLayer);
  $("familyBtn")?.addEventListener("click", () => fitEveryone());
  $("inboxBtn")?.addEventListener("click", () => { window.location.href = "index.html#us"; });
  $("settingsBtn")?.addEventListener("click", () => drawerOpen("settingsPanel"));
  $("placesBtn")?.addEventListener("click", () => { renderPlaces(); drawerOpen("placesPanel"); });
  $("addPlaceBtn")?.addEventListener("click", addPlace);
  $("historyBtn")?.addEventListener("click", () => {
    selectedMemberId = selectedMemberId || currentUser?.id;
    renderHistoryMemberSwitch();
    drawerOpen("historyPanel");
    loadHistory();
  });
  $("historyPrev")?.addEventListener("click", () => { historyDate.setDate(historyDate.getDate() - 1); loadHistory(); });
  $("historyNext")?.addEventListener("click", () => {
    const next = new Date(historyDate);
    next.setDate(next.getDate() + 1);
    if (startOfDay(next) > startOfDay(new Date())) return;
    historyDate = next;
    loadHistory();
  });
  $("checkInBtn")?.addEventListener("click", doCheckIn);
  $("sosBtn")?.addEventListener("click", triggerSos);
  $("safetySosCard")?.addEventListener("click", triggerSos);
  $("navLocation")?.addEventListener("click", showLocation);
  $("navDrive")?.addEventListener("click", () => { showFullPanel("drivePanel", "navDrive"); loadHistory(); });
  $("navSafety")?.addEventListener("click", () => showFullPanel("safetyPanel", "navSafety"));
  $("navAccount")?.addEventListener("click", () => showFullPanel("membershipPanel", "navAccount"));
  qsa("[data-back-location]").forEach(node => node.addEventListener("click", showLocation));
  qsa("[data-close-drawer]").forEach(node => node.addEventListener("click", closeDrawers));
  $("panelBackdrop")?.addEventListener("click", closeDrawers);
  $("sharingSettingsRow")?.addEventListener("click", () => {
    closeDrawers();
    if (sharingEnabled) stopSharing(true).then(() => setMessage("Partage désactivé."));
    else startSharing();
  });
  $("notificationSettingsRow")?.addEventListener("click", async () => {
    if (!("Notification" in window)) return setMessage("Notifications non disponibles.", true);
    const permission = await Notification.requestPermission();
    setMessage(permission === "granted" ? "Notifications activées." : "Notifications non autorisées.", permission !== "granted");
  });
  $("circleSettingsRow")?.addEventListener("click", () => setMessage("Cercle privé Famille Ridau."));
  $("crashCard")?.addEventListener("click", () => setMessage("La détection d’accident sera activée dans la version native."));
}

async function init() {
  initMap();
  bindUi();
  renderPlaces();
  updateBatteryUi();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    setMessage("Configuration Supabase manquante.", true);
    if ($("sharingToggle")) $("sharingToggle").disabled = true;
    return;
  }
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) {
    window.location.replace("index.html");
    return;
  }
  currentUser = data.session.user;
  selectedMemberId = currentUser.id;
  await loadPositions();
  const resume = await loadSharingPreference();
  await setupRealtime();
  if (resume) startSharing();
  setInterval(() => {
    renderMembers();
    const row = currentRows.find(r => r.user_id === selectedMemberId);
    if (row && $("memberCalloutStatus")) $("memberCalloutStatus").textContent = formatAge(row.captured_at);
  }, 30000);
}

init().catch(error => {
  console.error("location init failed", error);
  setMessage("La localisation n’a pas pu démarrer.", true);
});