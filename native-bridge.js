(() => {
  const params = new URLSearchParams(location.search);
  const nativeAndroid = params.get('native') === 'android' && !!window.NativeTracking;
  if (!nativeAndroid) return;

  let client = null;
  let session = null;
  let ready = false;
  let sharingEnabled = false;
  let rows = [];
  let pollTimer = null;
  let realtimeChannel = null;
  const fakeWatches = new Map();
  let fakeWatchSeq = -1;

  const style = document.createElement('style');
  style.textContent = `
    .native-onboarding{position:fixed;z-index:2000;inset:0;background:rgba(29,23,39,.38);display:grid;place-items:end center;padding:18px 18px calc(18px + env(safe-area-inset-bottom));backdrop-filter:blur(5px)}
    .native-onboarding.hidden{display:none!important}.native-onboarding-card{width:min(100%,520px);background:#fff;border-radius:24px;padding:20px;box-shadow:0 20px 55px rgba(30,20,45,.24)}
    .native-onboarding-icon{width:48px;height:48px;border-radius:15px;background:#f0ecff;color:#7a5af8;display:grid;place-items:center;font-size:25px;margin-bottom:12px}
    .native-onboarding-card h2{margin:0 0 7px;font-size:20px;color:#292330}.native-onboarding-card p{margin:0 0 15px;color:#777080;font-size:13px;line-height:1.45}
    .native-onboarding-card button{width:100%;height:50px;border:0;border-radius:16px;background:#7a5af8;color:#fff;font-weight:800;font-size:14px}.native-onboarding-card small{display:block;text-align:center;color:#918a99;margin-top:9px;font-size:10px}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('section');
  overlay.className = 'native-onboarding hidden';
  overlay.innerHTML = `<div class="native-onboarding-card"><div class="native-onboarding-icon">⌖</div><h2>Active la localisation en direct</h2><p>Autorise la position précise puis « Toujours autoriser ». Le suivi continuera même écran éteint.</p><button id="nativeEnableLocation" type="button">Activer la localisation</button><small>Le partage peut être coupé à tout moment.</small></div>`;
  document.body.appendChild(overlay);

  function selfRow() {
    return rows.find(row => row.user_id === session?.user?.id && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) || null;
  }

  function syntheticPosition(row) {
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
      timestamp: new Date(row.captured_at || Date.now()).getTime()
    };
  }

  function installGeolocationShim() {
    if (!navigator.geolocation || navigator.geolocation.__nousDeuxNativeShim) return;
    const geo = navigator.geolocation;
    const originalClear = geo.clearWatch?.bind(geo);

    geo.getCurrentPosition = (success, error) => {
      let attempts = 0;
      const tick = () => {
        const row = selfRow();
        if (row) return success(syntheticPosition(row));
        attempts += 1;
        if (attempts < 40) return setTimeout(tick, 150);
        if (typeof error === 'function') error({ code: 2, message: 'Position native indisponible' });
      };
      tick();
    };

    geo.watchPosition = success => {
      const id = fakeWatchSeq--;
      let last = '';
      const tick = () => {
        const row = selfRow();
        if (!row) return;
        const key = String(row.captured_at || '');
        if (key && key === last) return;
        last = key;
        success(syntheticPosition(row));
      };
      tick();
      const timer = setInterval(tick, 2500);
      fakeWatches.set(id, timer);
      return id;
    };

    geo.clearWatch = id => {
      if (fakeWatches.has(id)) {
        clearInterval(fakeWatches.get(id));
        fakeWatches.delete(id);
      } else if (originalClear) originalClear(id);
    };
    geo.__nousDeuxNativeShim = true;
  }

  function setUi(enabled) {
    sharingEnabled = !!enabled;
    const toggle = document.getElementById('sharingToggle');
    if (toggle) toggle.checked = sharingEnabled;
    const label = document.getElementById('shareLabel');
    if (label) label.textContent = sharingEnabled ? 'Partage actif' : 'Partage désactivé';
    const settings = document.getElementById('settingsShareStatus');
    if (settings) settings.textContent = sharingEnabled ? 'Activé' : 'Désactivé';
    const profile = document.getElementById('nativeProfileShare');
    if (profile) profile.textContent = sharingEnabled ? 'Partage actif sur ce téléphone' : 'Partage désactivé';
  }

  function toast(text, error = false) {
    if (text === 'Position indisponible.' && selfRow()) return;
    const node = document.getElementById('locationMessage');
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('error', error);
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2600);
  }

  async function loadRows() {
    if (!client || !session) return;
    const { data, error } = await client.from('current_locations')
      .select('user_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,captured_at,received_at')
      .order('captured_at', { ascending: false });
    if (!error) rows = Array.isArray(data) ? data : [];
  }

  async function savePreference(enabled) {
    const { error } = await client.from('location_sharing_preferences').upsert({
      user_id: session.user.id,
      sharing_enabled: !!enabled,
      precise_enabled: true,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
  }

  async function startNative() {
    if (!ready || !session) return toast('Initialisation de la localisation…');
    try {
      await savePreference(true);
      setUi(true);
      overlay.classList.add('hidden');
      window.NativeTracking.start(session.access_token || '', session.refresh_token || '', session.user.id, Number(session.expires_at || 0));
      toast('Localisation en direct activée.');
      setTimeout(loadRows, 700);
    } catch (error) {
      console.error('native tracking start failed', error);
      setUi(false);
      toast('Impossible d’activer la localisation.', true);
    }
  }

  async function stopNative() {
    try { await savePreference(false); } catch {}
    try { window.NativeTracking.stop(); } catch {}
    setUi(false);
    toast('Partage de position arrêté.');
  }

  installGeolocationShim();

  document.addEventListener('change', event => {
    if (event.target?.id !== 'sharingToggle') return;
    event.stopImmediatePropagation();
    event.preventDefault();
    if (event.target.checked) startNative(); else stopNative();
  }, true);

  document.addEventListener('click', event => {
    if (event.target?.id === 'nativeEnableLocation') {
      event.preventDefault();
      startNative();
    }
  }, true);

  (async () => {
    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const cfg = window.APP_CONFIG || {};
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
      client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) return;
      session = data.session;
      await loadRows();
      const pref = await client.from('location_sharing_preferences').select('sharing_enabled').eq('user_id', session.user.id).maybeSingle();
      ready = true;
      setUi(!!pref.data?.sharing_enabled);
      if (sharingEnabled) {
        window.NativeTracking.start(session.access_token || '', session.refresh_token || '', session.user.id, Number(session.expires_at || 0));
      } else {
        overlay.classList.remove('hidden');
      }
      realtimeChannel = client.channel('native-location-bridge')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'current_locations' }, loadRows)
        .subscribe();
      pollTimer = setInterval(loadRows, 5000);
    } catch (error) {
      console.error('native bridge init failed', error);
      toast('Le module de localisation n’a pas pu démarrer.', true);
    }
  })();
})();