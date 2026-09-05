package io.github.djnastx.nousdeux;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LocationTrackingService extends Service implements LocationListener {
    static final String ACTION_START = "io.github.djnastx.nousdeux.location.START";

    private static final String TAG = "NousDeuxLocation";
    private static final String CHANNEL_ID = "nous_deux_location_tracking";
    private static final int NOTIFICATION_ID = 2401;
    private static final long MIN_LOCATION_INTERVAL_MS = 15_000L;
    private static final float MIN_LOCATION_DISTANCE_M = 10f;
    private static final long MIN_UPLOAD_INTERVAL_MS = 10_000L;

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean uploadInFlight = new AtomicBoolean(false);
    private LocationManager locationManager;
    private SupabaseLocationClient apiClient;
    private volatile Location pendingLocation;
    private long lastUploadAt = 0L;
    private boolean tracking = false;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        apiClient = new SupabaseLocationClient(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification("Partage de position actif"), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);

        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission missing; stopping service");
            stopTrackingAndSelf();
            return START_NOT_STICKY;
        }
        try {
            if (SecureSessionStore.load(this) == null) {
                Log.w(TAG, "Location device credential missing; stopping service");
                stopTrackingAndSelf();
                return START_NOT_STICKY;
            }
        } catch (Exception error) {
            Log.e(TAG, "Unable to read location device credential", error);
            stopTrackingAndSelf();
            return START_NOT_STICKY;
        }

        if (!tracking) startLocationUpdates();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        if (!hasLocationPermission()) return;
        tracking = true;
        boolean registered = false;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_LOCATION_INTERVAL_MS, MIN_LOCATION_DISTANCE_M, this, Looper.getMainLooper());
                registered = true;
            }
        } catch (SecurityException error) {
            Log.e(TAG, "GPS registration rejected", error);
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_LOCATION_INTERVAL_MS, MIN_LOCATION_DISTANCE_M, this, Looper.getMainLooper());
                registered = true;
            }
        } catch (SecurityException error) {
            Log.e(TAG, "Network location registration rejected", error);
        }
        if (!registered) {
            Log.w(TAG, "No location provider available");
            updateNotification("GPS indisponible");
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        if (System.currentTimeMillis() - lastUploadAt < MIN_UPLOAD_INTERVAL_MS) {
            pendingLocation = new Location(location);
            return;
        }
        queueUpload(new Location(location));
    }

    @Override public void onProviderEnabled(String provider) { updateNotification("Partage de position actif"); }
    @Override public void onProviderDisabled(String provider) { updateNotification("Recherche du GPS…"); }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }

    private void queueUpload(Location location) {
        pendingLocation = location;
        if (!uploadInFlight.compareAndSet(false, true)) return;
        networkExecutor.execute(() -> {
            try {
                while (true) {
                    Location next = pendingLocation;
                    pendingLocation = null;
                    if (next == null) break;
                    long now = System.currentTimeMillis();
                    if (now - lastUploadAt < MIN_UPLOAD_INTERVAL_MS) continue;
                    try {
                        apiClient.send(next);
                        lastUploadAt = now;
                        updateNotification("Position synchronisée");
                    } catch (Exception error) {
                        Log.e(TAG, "Location upload failed", error);
                        updateNotification("Synchronisation en attente");
                    }
                }
            } finally {
                uploadInFlight.set(false);
                if (pendingLocation != null) queueUpload(pendingLocation);
            }
        });
    }

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void stopTrackingAndSelf() {
        tracking = false;
        try { if (locationManager != null) locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Localisation Nous Deux", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Indique quand le partage de position en arrière-plan est actif.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 2401, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Nous Deux · Localisation")
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void updateNotification(String text) {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    @Override
    public void onDestroy() {
        tracking = false;
        try { if (locationManager != null) locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
