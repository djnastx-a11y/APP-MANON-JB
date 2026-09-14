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
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("section");
  overlay.className = "native-onboarding hidden";
  overlay.innerHTML = `<div class="native-onboarding-card"><div class="native-onboarding-icon">⌖</div><h2>Active la localisation en direct</h2><p>Pour fonctionner comme Life360, autorise la position précise puis choisis « Toujours autoriser » dans les réglages Android. Le suivi continuera écran éteint.</p><button id="nativeEnableLocation" type="button">Activer la localisation</button><small>Tu peux couper le partage à tout moment avec l’interrupteur.</small></div>`;
  document.body.appendChild(overlay);

  let client = null;
  let session = null;
  let preferenceEnabled = false;
  let ready = false;

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
    node.textContent = text;
    node.classList.toggle("error", error);
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 3200);
  };

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
      toast("Localisation Android activée. Autorise la position précise et permanente.");
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
    }
  }, true);

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
    } catch (error) {
      console.error("native bridge init failed", error);
      toast("Le module Android n’a pas pu démarrer.", true);
    }
  })();
})();