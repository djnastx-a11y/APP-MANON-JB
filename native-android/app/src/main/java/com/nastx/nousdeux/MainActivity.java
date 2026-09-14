package com.nastx.nousdeux;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
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

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 41;
    private static final int REQ_NOTIFICATIONS = 42;
    private WebView webView;
    private PendingStart pendingStart;

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
                callback.invoke(origin, hasLocationPermission(), false);
            }
        });
        webView.loadUrl("https://djnastx-a11y.github.io/APP-MANON-JB/location.html?native=android");
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestStart(PendingStart start) {
        pendingStart = start;
        if (!hasLocationPermission()) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, REQ_LOCATION);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
        startNativeTracking(start);
    }

    private void startNativeTracking(PendingStart start) {
        SecureStore store = new SecureStore(this);
        store.putSecret("access", start.accessToken);
        store.putSecret("refresh", start.refreshToken);
        store.putSecret("user_id", start.userId);
        store.putSecret("expires_at", Long.toString(start.expiresAtMs));
        store.setEnabled(true);
        Intent intent = new Intent(this, LocationService.class).setAction(LocationService.ACTION_START);
        startForegroundService(intent);
        explainBackgroundPermission();
    }

    private void explainBackgroundPermission() {
        if (Build.VERSION.SDK_INT < 29) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        new AlertDialog.Builder(this)
                .setTitle("Localisation permanente")
                .setMessage("Pour fonctionner comme Life360 après redémarrage ou lorsque l’application n’est plus visible, ouvre les autorisations et choisis Toujours autoriser pour la localisation.")
                .setNegativeButton("Plus tard", null)
                .setPositiveButton("Ouvrir les réglages", (d, w) -> {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                }).show();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingStart != null) {
            if (hasLocationPermission()) {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
                }
                startNativeTracking(pendingStart);
            } else {
                Toast.makeText(this, "La localisation est nécessaire au suivi en direct.", Toast.LENGTH_LONG).show();
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
