(() => {
  const params = new URLSearchParams(location.search);
  const nativeAndroid = params.get("native") === "android" && !!window.NativeTracking;

  if (window.L?.tileLayer) {
    const originalTileLayer = window.L.tileLayer.bind(window.L);
    window.L.tileLayer = (url, options = {}) => {
      const isCarto = String(url).includes("cartocdn.com");
      const safeUrl = isCarto
        ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        : String(url).replace("https://{s}.tile.openstreetmap.org", "https://tile.openstreetmap.org");
      const safeOptions = isCarto ? { ...options, subdomains: undefined, maxZoom: 19 } : { ...options, subdomains: undefined };
      return originalTileLayer(safeUrl, safeOptions);
    };
  }

  if (!nativeAndroid) return;

  const style = document.createElement("style");
  style.textContent = `
    .native-onboarding{position:fixed;z-index:2000;inset:0;background:rgba(28,22,38,.44);display:grid;place-items:end center;padding:18px 18px calc(22px + env(safe-area-inset-bottom));backdrop-filter:blur(5px)}
    .native-onboarding.hidden{display:none!important}.native-onboarding-card{width:min(100%,520px);background:#fff;border-radius:28px;padding:22px;box-shadow:0 20px 55px rgba(30,20,45,.28)}
    .native-onboarding-icon{width:54px;height:54px;border-radius:18px;background:#f1eaff;color:#8d4df7;display:grid;place-items:center;font-size:30px;margin-bottom:14px}
    .native-onboarding-card h2{margin:0 0 8px;font-size:22px;color:#2b2337}.native-onboarding-card p{margin:0 0 16px;color:#746a80;font-size:14px;line-height:1.45}
    .native-onboarding-card button{width:100%;height:52px;border:0;border-radius:18px;background:#8d4df7;color:#fff;font-weight:800;font-size:15px}.native-onboarding-card small{display:block;text-align:center;color:#91889b;margin-top:10px;font-size:10px}
    .native-map-surface{position:absolute;inset:0;z-index:1200;background:#e8ecef;overflow:hidden}.native-map-surface.hidden{display:none!important}.native-map-surface iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;background:#e8ecef}.native-map-markers{position:absolute;inset:0;pointer-events:none;z-index:2}.native-map-marker{position:absolute;transform:translate(-50%,-100%);display:grid;justify-items:center;gap:4px}.native-map-pin{width:55px;height:55px;border-radius:50%;display:grid;place-items:center;background:#79c9d5;color:#fff;font-size:21px;font-weight:800;border:4px solid #fff;box-shadow:0 4px 14px rgba(50,38,67,.28),0 0 0 3px #8d4df7}.native-map-label{white-space:nowrap;background:#fff;color:#34283f;padding:5px 9px;border-radius:12px;font-size:11px;font-weight:750;box-shadow:0 3px 10px rgba(45,34,61,.16)}
    .profile-native-card{background:#fff;border-radius:20px;padding:17px;margin-bottom:12px;box-shadow:0 5px 15px rgba(48,36,63,.07)}.profile-native-card strong,.profile-native-card span{display:block}.profile-native-card strong{font-size:15px}.profile-native-card span{font-size:11px;color:#786f84;margin-top:4px;line-height:1.4}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("section");
  overlay.className = "native-onboarding hidden";
  overlay.innerHTML = `<div class="native-onboarding-card"><div class="native-onboarding-icon">⌖</div><h2>Active la localisation en direct</h2><p>Autorise la position précise puis « Toujours autoriser ». Le suivi continuera écran éteint.</p><button id="nativeEnableLocation" type="button">Activer la localisation</button><small>Tu peux couper le partage à tout moment.</small></div>`;
  document.body.appendChild(overlay);

  let client = null;
  let session = null;
  let preferenceEnabled = false;
  let ready = false;
  let nativeRows = [];
  let nativeSurface = null;
  let nativeFrame = null;
  let nativeMarkers = null;
  let lastMapSignature = "";
  let realtimeChannel = null;
  let pollTimer = null;

  const fakeWatches = new Map();
  let fakeWatchSeq = -1;

  const setUi = enabled => {
    const toggle = document.getElementById("sharingToggle");
    if (toggle) toggle.checked = !!enabled;
    const shareLabel = document.getElementById("shareLabel");
    if (shareLabel) shareLabel.textContent = enabled ? "Partage actif" : "Partage désactivé";
    const settingsStatus = document.getElementById("settingsShareStatus");
    if (settingsStatus) settingsStatus.textContent = enabled ? "Activé" : "Désactivé";
  };

  const toast = (text, error = false) => {
    const node = document.getElementById("locationMessage");
    if (!node) return;
    if (text === "Position indisponible." && getSelfRow()) return;
    node.textContent = text;
    node.classList.toggle("error", error);
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 3200);
  };

  function installProfileUi() {
    const nav = document.getElementById("navAccount");
    if (nav) {
      const icon = nav.querySelector("span");
      const label = nav.querySelector("strong");
      if (icon) icon.textContent = "●";
      if (label) label.textContent = "Profil";
      nav.setAttribute("aria-label", "Profil");
    }
    const panel = document.getElementById("membershipPanel");
    if (!panel) return;
    const head = panel.querySelector(".full-panel-head h2");
    if (head) head.textContent = "Profil";
    const oldCard = panel.querySelector(".panel-card");
    const oldGrid = panel.querySelector(".feature-grid");
    if (oldCard) oldCard.remove();
    if (oldGrid) oldGrid.remove();
    if (!panel.querySelector(".profile-native-card")) {
      panel.insertAdjacentHTML("beforeend", `<div class="profile-native-card"><strong>Famille Ridau</strong><span>Cercle privé · 2 membres</span></div><div class="profile-native-card"><strong>Localisation en direct</strong><span id="nativeProfileShare">Partage actif sur ce téléphone</span></div><div class="profile-native-card"><strong>Application privée</strong><span>Aucun abonnement. Les fonctions sont celles de votre propre application.</span></div>`);
    }
  }

  function getSelfRow() {
    return nativeRows.find(row => row.user_id === session?.user?.id && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) || null;
  }

  function syntheticPosition(row) {
    const captured = new Date(row?.captured_at || Date.now()).getTime();
    return {
      coords: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracy: Number.isFinite(Number(row.accuracy_m)) ? Number(row.accuracy_m) : 25,
        altitude: Number.isFinite(Number(row.altitude_m)) ? Number(row.altitude_m) : null,
        altitudeAccuracy: null,
        heading: Number.isFinite(Number(row.heading_deg)) ? Number(row.heading_deg) : null,
        speed: Number.isFinite(Number(row.speed_mps)) ? Number(row.speed_mps) : null
      },
      timestamp: Number.isFinite(captured) ? captured : Date.now()
    };
  }

  function installNativeGeolocationShim() {
    if (!navigator.geolocation || navigator.geolocation.__nousDeuxNativeShim) return;
    const geo = navigator.geolocation;
    const originalClear = geo.clearWatch?.bind(geo);

    geo.getCurrentPosition = (success, error) => {
      let attempts = 0;
      const wait = () => {
        const row = getSelfRow();
        if (row) return success(syntheticPosition(row));
        attempts += 1;
        if (attempts < 25) return setTimeout(wait, 200);
        if (typeof error === "function") error({ code: 2, message: "Position native indisponible" });
      };
      wait();
    };

    geo.watchPosition = (success, error) => {
      const id = fakeWatchSeq--;
      let lastCaptured = "";
      const tick = () => {
        const row = getSelfRow();
        if (!row) return;
        const captured = String(row.captured_at || "");
        if (captured && captured === lastCaptured) return;
        lastCaptured = captured;
        success(syntheticPosition(row));
      };
      tick();
      const timer = setInterval(tick, 3000);
      fakeWatches.set(id, timer);
      return id;
    };

    geo.clearWatch = id => {
      if (fakeWatches.has(id)) {
        clearInterval(fakeWatches.get(id));
        fakeWatches.delete(id);
        return;
      }
      if (originalClear) originalClear(id);
    };
    geo.__nousDeuxNativeShim = true;
  }

  function ensureNativeMapSurface() {
    const mapNode = document.getElementById("map");
    if (!mapNode || nativeSurface) return;
    nativeSurface = document.createElement("div");
    nativeSurface.id = "nativeMapSurface";
    nativeSurface.className = "native-map-surface hidden";
    nativeSurface.innerHTML = `<iframe id="nativeMapFrame" title="Carte de localisation"></iframe><div id="nativeMapMarkers" class="native-map-markers"></div>`;
    mapNode.appendChild(nativeSurface);
    nativeFrame = document.getElementById("nativeMapFrame");
    nativeMarkers = document.getElementById("nativeMapMarkers");
  }

  const mercatorY = lat => {
    const clamped = Math.max(-85, Math.min(85, Number(lat)));
    const rad = clamped * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  };

  function computeBounds(rows) {
    const valid = rows.filter(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)));
    if (!valid.length) return null;
    let minLat = Math.min(...valid.map(r => Number(r.latitude)));
    let maxLat = Math.max(...valid.map(r => Number(r.latitude)));
    let minLon = Math.min(...valid.map(r => Number(r.longitude)));
    let maxLon = Math.max(...valid.map(r => Number(r.longitude)));
    let latSpan = Math.max(maxLat - minLat, 0.008);
    let lonSpan = Math.max(maxLon - minLon, 0.012);
    const latPad = latSpan * 0.45;
    const lonPad = lonSpan * 0.45;
    minLat -= latPad; maxLat += latPad; minLon -= lonPad; maxLon += lonPad;
    return { minLat, maxLat, minLon, maxLon };
  }

  function memberLabel(row) {
    if (row.user_id === session?.user?.id) return session?.user?.user_metadata?.display_name || session?.user?.email?.split("@")[0] || "JB";
    return "Manon";
  }

  function renderNativeMap(force = false) {
    ensureNativeMapSurface();
    const rows = nativeRows.filter(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)));
    if (!rows.length || !nativeSurface || !nativeFrame || !nativeMarkers) return;
    const bounds = computeBounds(rows);
    if (!bounds) return;
    const signature = rows.map(r => `${r.user_id}:${Number(r.latitude).toFixed(5)}:${Number(r.longitude).toFixed(5)}`).join("|");
    if (force || signature !== lastMapSignature) {
      lastMapSignature = signature;
      const bbox = `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`;
      nativeFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik`;
    }
    const yTop = mercatorY(bounds.maxLat);
    const yBottom = mercatorY(bounds.minLat);
    nativeMarkers.innerHTML = "";
    for (const row of rows) {
      const x = (Number(row.longitude) - bounds.minLon) / Math.max(0.000001, bounds.maxLon - bounds.minLon);
      const y = (mercatorY(Number(row.latitude)) - yTop) / Math.max(0.000001, yBottom - yTop);
      const name = memberLabel(row);
      const marker = document.createElement("div");
      marker.className = "native-map-marker";
      marker.style.left = `${Math.max(3, Math.min(97, x * 100))}%`;
      marker.style.top = `${Math.max(8, Math.min(94, y * 100))}%`;
      marker.innerHTML = `<div class="native-map-pin">${name.slice(0,1).toUpperCase()}</div><div class="native-map-label">${name}</div>`;
      nativeMarkers.appendChild(marker);
    }
  }

  function leafletHasVisibleTiles() {
    return [...document.querySelectorAll("#map img.leaflet-tile-loaded")].some(img => img.complete && img.naturalWidth > 0);
  }

  function reconcileMapRenderer() {
    ensureNativeMapSurface();
    if (!nativeSurface || !nativeRows.length) return;
    if (leafletHasVisibleTiles()) nativeSurface.classList.add("hidden");
    else {
      renderNativeMap();
      nativeSurface.classList.remove("hidden");
    }
  }

  async function loadNativeRows() {
    if (!client || !session) return;
    const { data, error } = await client.from("current_locations")
      .select("user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,captured_at,received_at")
      .order("captured_at", { ascending: false });
    if (error) {
      console.error("native rows load failed", error);
      return;
    }
    nativeRows = Array.isArray(data) ? data : [];
    reconcileMapRenderer();
    const self = getSelfRow();
    if (self) {
      const node = document.getElementById("locationMessage");
      if (node?.textContent === "Position indisponible.") node.classList.remove("show");
    }
  }

  async function savePreference(enabled) {
    if (!client || !session?.user) return;
    const { error } = await client.from("location_sharing_preferences").upsert({
      user_id: session.user.id,
      sharing_enabled: !!enabled,
      precise_enabled: true,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    preferenceEnabled = !!enabled;
  }

  async function startNative() {
    if (!session) return;
    try {
      await savePreference(true);
      setUi(true);
      overlay.classList.add("hidden");
      window.NativeTracking.start(
        session.access_token || "",
        session.refresh_token || "",
        session.user.id,
        Number(session.expires_at || 0)
      );
      const share = document.getElementById("nativeProfileShare");
      if (share) share.textContent = "Partage actif sur ce téléphone";
      toast("Localisation Android activée.");
      setTimeout(loadNativeRows, 900);
    } catch (error) {
      console.error("native tracking start failed", error);
      setUi(false);
      toast("Impossible d’activer la localisation Android.", true);
    }
  }

  async function stopNative() {
    try { await savePreference(false); } catch (error) { console.error("native sharing preference stop failed", error); }
    try { window.NativeTracking.stop(); } catch {}
    setUi(false);
    const share = document.getElementById("nativeProfileShare");
    if (share) share.textContent = "Partage désactivé sur ce téléphone";
    toast("Partage de position arrêté.");
  }

  document.addEventListener("change", event => {
    if (event.target?.id !== "sharingToggle" || !ready) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.target.checked) startNative(); else stopNative();
  }, true);

  document.addEventListener("click", event => {
    if (event.target?.id === "nativeEnableLocation") {
      event.preventDefault();
      startNative();
      return;
    }
    const center = event.target?.closest?.("#centerOnMeBtn");
    if (center && getSelfRow()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      renderNativeMap(true);
      const node = document.getElementById("memberCallout");
      if (node) node.classList.remove("hidden");
      const nameNode = document.getElementById("memberCalloutName");
      const statusNode = document.getElementById("memberCalloutStatus");
      if (nameNode) nameNode.textContent = memberLabel(getSelfRow());
      if (statusNode) statusNode.textContent = "À l’instant";
    }
  }, true);

  installProfileUi();
  installNativeGeolocationShim();
  ensureNativeMapSurface();

  (async () => {
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      const cfg = window.APP_CONFIG || {};
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
      client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return;
      session = data.session;
      const pref = await client.from("location_sharing_preferences").select("sharing_enabled").eq("user_id", session.user.id).maybeSingle();
      preferenceEnabled = !!pref.data?.sharing_enabled;
      ready = true;
      setUi(preferenceEnabled);
      await loadNativeRows();
      if (preferenceEnabled) {
        window.NativeTracking.start(
          session.access_token || "",
          session.refresh_token || "",
          session.user.id,
          Number(session.expires_at || 0)
        );
      } else {
        overlay.classList.remove("hidden");
      }
      realtimeChannel = client.channel("native-map-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "current_locations" }, () => loadNativeRows())
        .subscribe();
      pollTimer = setInterval(loadNativeRows, 10000);
      setInterval(reconcileMapRenderer, 2500);
    } catch (error) {
      console.error("native bridge init failed", error);
      toast("Le module Android n’a pas pu démarrer.", true);
    }
  })();
})();