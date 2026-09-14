package com.nastx.nousdeux;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.Locale;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 41;
    private static final int REQ_NOTIFICATIONS = 42;
    private WebView webView;
    private PendingStart pendingStart;
    private boolean receiverRegistered = false;
    private boolean waitingForLocationSettings = false;

    private final BroadcastReceiver liveLocationReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null || !LocationService.ACTION_LOCATION.equals(intent.getAction()) || webView == null) return;
            double latitude = intent.getDoubleExtra(LocationService.EXTRA_LATITUDE, Double.NaN);
            double longitude = intent.getDoubleExtra(LocationService.EXTRA_LONGITUDE, Double.NaN);
            float accuracy = intent.getFloatExtra(LocationService.EXTRA_ACCURACY, -1f);
            float speed = intent.getFloatExtra(LocationService.EXTRA_SPEED, -1f);
            float bearing = intent.getFloatExtra(LocationService.EXTRA_BEARING, -1f);
            long time = intent.getLongExtra(LocationService.EXTRA_TIME, System.currentTimeMillis());
            if (!Double.isFinite(latitude) || !Double.isFinite(longitude)) return;
            String js = String.format(Locale.US,
                    "window.dispatchEvent(new CustomEvent('nousdeux:nativeLocation',{detail:{latitude:%.8f,longitude:%.8f,accuracy:%.2f,speed:%.3f,bearing:%.2f,time:%d}}));",
                    latitude, longitude, accuracy, speed, bearing, time);
            webView.evaluateJavascript(js, null);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new NativeTrackingBridge(), "NativeTracking");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, hasPreciseLocationPermission(), false);
            }
        });
        webView.loadUrl("https://djnastx-a11y.github.io/APP-MANON-JB/location.html?native=android");
    }

    @Override protected void onStart() {
        super.onStart();
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(LocationService.ACTION_LOCATION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(liveLocationReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(liveLocationReceiver, filter);
            receiverRegistered = true;
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (waitingForLocationSettings) {
            waitingForLocationSettings = false;
            if (pendingStart != null && hasPreciseLocationPermission()) {
                startNativeTracking(pendingStart);
            } else if (pendingStart != null && hasApproximateLocationPermission()) {
                showPreciseLocationRequired();
            }
        }
    }

    @Override protected void onStop() {
        if (receiverRegistered) {
            try { unregisterReceiver(liveLocationReceiver); } catch (Exception ignored) { }
            receiverRegistered = false;
        }
        super.onStop();
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    private boolean hasPreciseLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasApproximateLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStart(PendingStart start) {
        pendingStart = start;
        if (!hasPreciseLocationPermission()) {
            if (hasApproximateLocationPermission()) {
                showPreciseLocationRequired();
            } else {
                showLocationPermissionIntro();
            }
            return;
        }
        requestNotificationsIfNeeded();
        startNativeTracking(start);
    }

    private void showLocationPermissionIntro() {
        new AlertDialog.Builder(this)
                .setTitle("Autoriser la localisation")
                .setMessage("Pour afficher ta position en direct et suivre tes déplacements, choisis Autoriser et garde Position précise activée.")
                .setNegativeButton("Annuler", null)
                .setPositiveButton("Continuer", (d, w) -> requestForegroundLocationPermissions())
                .show();
    }

    private void requestForegroundLocationPermissions() {
        requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, REQ_LOCATION);
    }

    private void showPreciseLocationRequired() {
        new AlertDialog.Builder(this)
                .setTitle("Position précise nécessaire")
                .setMessage("Android a autorisé seulement la position approximative. Pour un suivi type Waze ou Life360, active Position précise pour Nous Deux Live.")
                .setNegativeButton("Réessayer", (d, w) -> requestForegroundLocationPermissions())
                .setPositiveButton("Ouvrir les réglages", (d, w) -> openAppSettings())
                .show();
    }

    private void showLocationDenied() {
        boolean canAskAgain = shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)
                || shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION);
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("Localisation désactivée")
                .setMessage("Nous Deux Live ne peut pas suivre ta position tant que la localisation n’est pas autorisée.")
                .setNegativeButton("Annuler", null);
        if (canAskAgain) {
            builder.setPositiveButton("Autoriser", (d, w) -> requestForegroundLocationPermissions());
        } else {
            builder.setPositiveButton("Ouvrir les réglages", (d, w) -> openAppSettings());
        }
        builder.show();
    }

    private void openAppSettings() {
        waitingForLocationSettings = true;
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        startActivity(i);
    }

    private void requestNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    private void startNativeTracking(PendingStart start) {
        if (!hasPreciseLocationPermission()) {
            showPreciseLocationRequired();
            return;
        }
        SecureStore store = new SecureStore(this);
        store.putSecret("access", start.accessToken);
        store.putSecret("refresh", start.refreshToken);
        store.putSecret("user_id", start.userId);
        store.putSecret("expires_at", Long.toString(start.expiresAtMs));
        store.setEnabled(true);
        Intent intent = new Intent(this, LocationService.class).setAction(LocationService.ACTION_START);
        startForegroundService(intent);
        pendingStart = null;
        dispatchPermissionState("precise");
        explainBackgroundPermission();
    }

    private void explainBackgroundPermission() {
        if (Build.VERSION.SDK_INT < 29) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        new AlertDialog.Builder(this)
                .setTitle("Suivi écran éteint")
                .setMessage("Pour continuer le suivi quand l’écran est éteint ou l’application fermée, ouvre les réglages de Nous Deux Live puis choisis Autorisations, Localisation, Toujours autoriser. Garde aussi Position précise activée.")
                .setNegativeButton("Plus tard", null)
                .setPositiveButton("Ouvrir les réglages", (d, w) -> openAppSettings())
                .show();
    }

    private void dispatchPermissionState(String state) {
        if (webView == null) return;
        String safe = state.replace("'", "");
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('nousdeux:locationPermission',{detail:{state:'" + safe + "'}}));", null);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingStart != null) {
            if (hasPreciseLocationPermission()) {
                requestNotificationsIfNeeded();
                startNativeTracking(pendingStart);
            } else if (hasApproximateLocationPermission()) {
                dispatchPermissionState("approximate");
                Toast.makeText(this, "Position approximative activée. Active Position précise pour le suivi en direct.", Toast.LENGTH_LONG).show();
                showPreciseLocationRequired();
            } else {
                dispatchPermissionState("denied");
                showLocationDenied();
            }
        }
    }

    public final class NativeTrackingBridge {
        @JavascriptInterface public void start(String accessToken, String refreshToken, String userId, double expiresAtSeconds) {
            runOnUiThread(() -> requestStart(new PendingStart(accessToken, refreshToken, userId, (long)(expiresAtSeconds * 1000L))));
        }

        @JavascriptInterface public void stop() {
            runOnUiThread(() -> {
                SecureStore store = new SecureStore(MainActivity.this);
                store.setEnabled(false);
                store.clearSecrets();
                stopService(new Intent(MainActivity.this, LocationService.class));
            });
        }

        @JavascriptInterface public boolean isNative() { return true; }

        @JavascriptInterface public void openLocationSettings() {
            runOnUiThread(MainActivity.this::openAppSettings);
        }

        @JavascriptInterface public String permissionState() {
            if (hasPreciseLocationPermission()) return "precise";
            if (hasApproximateLocationPermission()) return "approximate";
            return "denied";
        }
    }

    private static final class PendingStart {
        final String accessToken, refreshToken, userId;
        final long expiresAtMs;
        PendingStart(String accessToken, String refreshToken, String userId, long expiresAtMs) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.userId = userId;
            this.expiresAtMs = expiresAtMs;
        }
    }
}
