package com.nastx.nousdeux;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationService extends Service implements LocationListener, SensorEventListener {
    static final String ACTION_START = "com.nastx.nousdeux.START_TRACKING";
    static final String ACTION_LOCATION = "com.nastx.nousdeux.LOCATION_UPDATE";
    static final String EXTRA_LATITUDE = "latitude";
    static final String EXTRA_LONGITUDE = "longitude";
    static final String EXTRA_ACCURACY = "accuracy";
    static final String EXTRA_SPEED = "speed";
    static final String EXTRA_BEARING = "bearing";
    static final String EXTRA_TIME = "time";

    private static final String ACTION_CANCEL_CRASH = "com.nastx.nousdeux.CANCEL_CRASH";
    private static final String ACTION_SEND_CRASH = "com.nastx.nousdeux.SEND_CRASH";
    private static final String TAG = "NousDeuxTracking";
    private static final String SUPABASE = "https://apmpqnukpurfwbpgpvwe.supabase.co";
    private static final String API_KEY = "sb_publishable_ap7OPlRhdewhfiMFbxJ8ig_xKuK5qC8";
    private static final int TRACKING_NOTIFICATION = 3601;
    private static final int CRASH_NOTIFICATION = 3602;

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private SensorManager sensorManager;
    private SecureStore store;
    private PowerManager.WakeLock wakeLock;
    private Location lastLocation;
    private Location lastUploadedLocation;
    private Location lastHistoryLocation;
    private long lastUploadAt = 0L;
    private long lastHistoryAt = 0L;
    private long lastCrashAt = 0L;
    private Runnable pendingCrash;

    @Override public void onCreate() {
        super.onCreate();
        store = new SecureStore(this);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NousDeux:LiveLocation");
        wakeLock.setReferenceCounted(false);
        createChannels();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_CANCEL_CRASH.equals(action)) { cancelCrash(); return START_STICKY; }
        if (ACTION_SEND_CRASH.equals(action)) { sendCrashAlert(); return START_STICKY; }
        startForeground(TRACKING_NOTIFICATION, trackingNotification());
        if (!wakeLock.isHeld()) wakeLock.acquire();
        startLocationUpdates();
        startImpactMonitor();
        return START_STICKY;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel("tracking", getString(com.nastx.nousdeux.R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW));
            nm.createNotificationChannel(new NotificationChannel("safety", getString(com.nastx.nousdeux.R.string.crash_channel), NotificationManager.IMPORTANCE_HIGH));
        }
    }

    private Notification trackingNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 10, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "tracking") : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Nous Deux · Localisation en direct")
                .setContentText("Suivi GPS actif, y compris pendant tes déplacements.")
                .setOngoing(true).setContentIntent(pi).setCategory(Notification.CATEGORY_SERVICE).build();
    }

    private void startLocationUpdates() {
        boolean fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) { stopSelf(); return; }
        try {
            locationManager.removeUpdates(this);

            Location cached = null;
            if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                cached = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            }
            if (cached == null && locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                cached = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            }
            if (cached != null && System.currentTimeMillis() - cached.getTime() < 120000L) onLocationChanged(cached);

            if (Build.VERSION.SDK_INT >= 31) {
                if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    LocationRequest gps = new LocationRequest.Builder(2000L)
                            .setMinUpdateIntervalMillis(1000L)
                            .setMinUpdateDistanceMeters(1f)
                            .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
                            .setMaxUpdateDelayMillis(0L)
                            .build();
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, gps, getMainExecutor(), this);
                }
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    LocationRequest networkRequest = new LocationRequest.Builder(5000L)
                            .setMinUpdateIntervalMillis(2500L)
                            .setMinUpdateDistanceMeters(3f)
                            .setQuality(LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                            .setMaxUpdateDelayMillis(0L)
                            .build();
                    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, networkRequest, getMainExecutor(), this);
                }
            } else {
                if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                    locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 1f, this, Looper.getMainLooper());
                if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                    locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000L, 3f, this, Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission lost", e);
            stopSelf();
        }
    }

    private void startImpactMonitor() {
        Sensor accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (accelerometer != null) sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_NORMAL);
    }

    private boolean shouldAccept(Location location) {
        if (location == null) return false;
        if (lastLocation == null) return true;
        long delta = location.getTime() - lastLocation.getTime();
        if (delta < -5000L) return false;
        if (location.hasAccuracy() && location.getAccuracy() > 150f && lastLocation.hasAccuracy()
                && lastLocation.getAccuracy() < location.getAccuracy() && delta < 15000L) return false;
        return true;
    }

    @Override public void onLocationChanged(Location location) {
        if (!shouldAccept(location)) return;
        lastLocation = new Location(location);
        broadcastLocation(location);
        network.execute(() -> uploadLocation(location));
    }

    private void broadcastLocation(Location location) {
        Intent update = new Intent(ACTION_LOCATION).setPackage(getPackageName());
        update.putExtra(EXTRA_LATITUDE, location.getLatitude());
        update.putExtra(EXTRA_LONGITUDE, location.getLongitude());
        update.putExtra(EXTRA_ACCURACY, location.hasAccuracy() ? location.getAccuracy() : -1f);
        update.putExtra(EXTRA_SPEED, location.hasSpeed() ? location.getSpeed() : -1f);
        update.putExtra(EXTRA_BEARING, location.hasBearing() ? location.getBearing() : -1f);
        update.putExtra(EXTRA_TIME, location.getTime());
        sendBroadcast(update);
    }

    private float estimatedSpeed(Location location) {
        if (location.hasSpeed() && location.getSpeed() >= 0f) return location.getSpeed();
        if (lastUploadedLocation == null) return 0f;
        long dt = Math.max(1L, location.getTime() - lastUploadedLocation.getTime());
        return lastUploadedLocation.distanceTo(location) / (dt / 1000f);
    }

    private boolean shouldUploadCurrent(Location location) {
        long now = System.currentTimeMillis();
        float speed = estimatedSpeed(location);
        boolean moving = speed >= 1.5f;
        long minInterval = moving ? 1800L : 8000L;
        float minDistance = moving ? 2f : 8f;
        if (lastUploadedLocation == null) return true;
        if (now - lastUploadAt >= minInterval) return true;
        return lastUploadedLocation.distanceTo(location) >= minDistance;
    }

    private void uploadLocation(Location location) {
        if (!store.isEnabled() || !shouldUploadCurrent(location)) return;
        try {
            String token = validAccessToken();
            if (token == null) return;
            JSONObject row = locationJson(location, true);
            int currentCode = request("POST", SUPABASE + "/rest/v1/current_locations?on_conflict=user_id", token, row.toString(), "resolution=merge-duplicates,return=minimal");
            if (currentCode == 401) {
                token = refreshAccessToken();
                if (token != null) currentCode = request("POST", SUPABASE + "/rest/v1/current_locations?on_conflict=user_id", token, row.toString(), "resolution=merge-duplicates,return=minimal");
            }
            if (currentCode >= 200 && currentCode < 300) {
                lastUploadAt = System.currentTimeMillis();
                lastUploadedLocation = new Location(location);
            }

            float speed = estimatedSpeed(location);
            boolean driving = speed >= 2.5f;
            long historyInterval = driving ? 10000L : 60000L;
            float historyDistance = driving ? 20f : 40f;
            boolean saveHistory = lastHistoryLocation == null || System.currentTimeMillis() - lastHistoryAt >= historyInterval || lastHistoryLocation.distanceTo(location) >= historyDistance;
            if (saveHistory && token != null) {
                request("POST", SUPABASE + "/rest/v1/location_history", token, locationJson(location, false).toString(), "return=minimal");
                lastHistoryAt = System.currentTimeMillis();
                lastHistoryLocation = new Location(location);
            }
        } catch (Exception e) { Log.e(TAG, "Upload failed", e); }
    }

    private JSONObject locationJson(Location location, boolean current) throws Exception {
        JSONObject row = new JSONObject();
        row.put("user_id", store.getSecret("user_id"));
        row.put("latitude", location.getLatitude());
        row.put("longitude", location.getLongitude());
        row.put("accuracy_m", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        row.put("altitude_m", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        row.put("speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        row.put("heading_deg", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
        row.put("source", "android_native_live");
        row.put("captured_at", Instant.ofEpochMilli(location.getTime()).toString());
        if (current) row.put("received_at", Instant.now().toString());
        return row;
    }

    private String validAccessToken() throws Exception {
        String token = store.getSecret("access");
        String expiryText = store.getSecret("expires_at");
        long expiry = 0L;
        try { expiry = Long.parseLong(expiryText == null ? "0" : expiryText); } catch (Exception ignored) { }
        if (token == null || System.currentTimeMillis() > expiry - 90000L) return refreshAccessToken();
        return token;
    }

    private String refreshAccessToken() throws Exception {
        String refresh = store.getSecret("refresh");
        if (refresh == null) return null;
        JSONObject body = new JSONObject().put("refresh_token", refresh);
        HttpURLConnection c = open("POST", SUPABASE + "/auth/v1/token?grant_type=refresh_token", null, null);
        write(c, body.toString());
        int code = c.getResponseCode();
        String response = read(c, code >= 200 && code < 300);
        c.disconnect();
        if (code < 200 || code >= 300) return null;
        JSONObject json = new JSONObject(response);
        String access = json.optString("access_token", null);
        String newRefresh = json.optString("refresh_token", refresh);
        long expiresIn = json.optLong("expires_in", 3600L);
        if (access != null) {
            store.putSecret("access", access);
            store.putSecret("refresh", newRefresh);
            store.putSecret("expires_at", Long.toString(System.currentTimeMillis() + expiresIn * 1000L));
        }
        return access;
    }

    private int request(String method, String url, String token, String body, String prefer) throws Exception {
        HttpURLConnection c = open(method, url, token, prefer);
        write(c, body);
        int code = c.getResponseCode();
        read(c, code >= 200 && code < 300);
        c.disconnect();
        return code;
    }

    private HttpURLConnection open(String method, String url, String token, String prefer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        c.setRequestProperty("apikey", API_KEY);
        c.setRequestProperty("Content-Type", "application/json");
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        if (prefer != null) c.setRequestProperty("Prefer", prefer);
        c.setDoOutput(true);
        return c;
    }

    private void write(HttpURLConnection c, String body) throws Exception {
        try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
    }

    private String read(HttpURLConnection c, boolean success) {
        try {
            InputStream stream = success ? c.getInputStream() : c.getErrorStream();
            if (stream == null) return "";
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            String line; while ((line = reader.readLine()) != null) out.append(line);
            return out.toString();
        } catch (Exception e) { return ""; }
    }

    @Override public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ACCELEROMETER || lastLocation == null) return;
        double x = event.values[0], y = event.values[1], z = event.values[2];
        double g = Math.sqrt(x*x + y*y + z*z) / SensorManager.GRAVITY_EARTH;
        float speedKmh = lastLocation.hasSpeed() ? lastLocation.getSpeed() * 3.6f : 0f;
        long now = System.currentTimeMillis();
        if (g >= 5.0 && speedKmh >= 40f && now - lastCrashAt > 120000L) {
            lastCrashAt = now;
            beginCrashCountdown();
        }
    }

    private void beginCrashCountdown() {
        cancelCrash();
        Intent cancel = new Intent(this, LocationService.class).setAction(ACTION_CANCEL_CRASH);
        Intent send = new Intent(this, LocationService.class).setAction(ACTION_SEND_CRASH);
        PendingIntent cancelPi = PendingIntent.getService(this, 21, cancel, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent sendPi = PendingIntent.getService(this, 22, send, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "safety") : new Notification.Builder(this);
        Notification n = b.setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("Impact important détecté")
                .setContentText("Alerte au cercle dans 45 secondes si tu ne l’annules pas.")
                .setAutoCancel(false)
                .addAction(new Notification.Action.Builder(null, "Je vais bien", cancelPi).build())
                .addAction(new Notification.Action.Builder(null, "SOS maintenant", sendPi).build())
                .build();
        getSystemService(NotificationManager.class).notify(CRASH_NOTIFICATION, n);
        pendingCrash = this::sendCrashAlert;
        handler.postDelayed(pendingCrash, 45000L);
    }

    private void cancelCrash() {
        if (pendingCrash != null) handler.removeCallbacks(pendingCrash);
        pendingCrash = null;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(CRASH_NOTIFICATION);
    }

    private void sendCrashAlert() {
        cancelCrash();
        Location location = lastLocation;
        if (location == null) return;
        network.execute(() -> {
            try {
                String token = validAccessToken();
                if (token == null) return;
                String coords = String.format(java.util.Locale.US, "%.6f, %.6f", location.getLatitude(), location.getLongitude());
                JSONObject message = new JSONObject().put("sender_id", store.getSecret("user_id"))
                        .put("body", "🚨 Impact important détecté. Aucune annulation reçue. Position: " + coords);
                request("POST", SUPABASE + "/rest/v1/messages", token, message.toString(), "return=minimal");
            } catch (Exception e) { Log.e(TAG, "Crash alert failed", e); }
        });
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    @Override public void onDestroy() {
        try { locationManager.removeUpdates(this); } catch (Exception ignored) { }
        try { sensorManager.unregisterListener(this); } catch (Exception ignored) { }
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) { }
        cancelCrash();
        network.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
