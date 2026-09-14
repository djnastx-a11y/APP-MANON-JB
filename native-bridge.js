import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.APP_CONFIG || {};
const native = window.NativeTracking;

if (native && typeof native.start === "function" && cfg.supabaseUrl && cfg.supabaseAnonKey) {
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let nativeStarted = false;
  let syncing = false;

  async function syncNativeTracking() {
    if (syncing) return;
    syncing = true;
    try {
      const toggle = document.getElementById("sharingToggle");
      if (!toggle) return;

      if (!toggle.checked) {
        if (nativeStarted) {
          native.stop();
          nativeStarted = false;
        }
        return;
      }

      if (nativeStarted) return;

      const { data, error } = await supabase.auth.getSession();
      const session = data?.session;
      if (error || !session?.access_token || !session?.refresh_token || !session?.user?.id) return;

      native.start(
        session.access_token,
        session.refresh_token,
        session.user.id,
        Number(session.expires_at || 0)
      );
      nativeStarted = true;
    } finally {
      syncing = false;
    }
  }

  document.addEventListener("visibilitychange", syncNativeTracking);
  window.addEventListener("focus", syncNativeTracking);
  setInterval(syncNativeTracking, 1500);
  setTimeout(syncNativeTracking, 500);
}
