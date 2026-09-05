package io.github.djnastx.nousdeux;

import android.content.Context;
import android.location.Location;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class SupabaseLocationClient {
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 15000;
    private static final String EXPECTED_HOST = "apmpqnukpurfwbpgpvwe.supabase.co";
    private static final String EXPECTED_PATH = "/functions/v1/location-ingest";

    private final Context context;

    SupabaseLocationClient(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void send(Location location) throws Exception {
        SecureSessionStore.Session session = SecureSessionStore.load(context);
        if (session == null) throw new IllegalStateException("No native location device credential available");

        URL url = validateIngestUrl(session.ingestUrl);
        JSONObject body = new JSONObject();
        body.put("latitude", location.getLatitude());
        body.put("longitude", location.getLongitude());
        body.put("accuracy_m", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        body.put("altitude_m", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        body.put("speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        body.put("heading_deg", location.hasBearing() ? normalizeBearing(location.getBearing()) : JSONObject.NULL);
        body.put("captured_at", formatTimestamp(location.getTime() > 0 ? location.getTime() : System.currentTimeMillis()));

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("X-Location-Token", session.deviceToken);
            connection.setRequestProperty("X-Client-Info", "nous-deux-android/0.3");

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }

            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                InputStream stream = connection.getErrorStream();
                String responseBody = stream == null ? "" : readStream(stream);
                if (responseBody.length() > 300) responseBody = responseBody.substring(0, 300);
                throw new IllegalStateException("Location ingest HTTP " + code + ": " + responseBody);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static URL validateIngestUrl(String rawUrl) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("Ingest URL must use HTTPS");
        if (!EXPECTED_HOST.equalsIgnoreCase(url.getHost())) throw new IllegalArgumentException("Unexpected ingest host");
        if (!EXPECTED_PATH.equals(url.getPath())) throw new IllegalArgumentException("Unexpected ingest path");
        if (url.getQuery() != null || url.getRef() != null) throw new IllegalArgumentException("Unexpected ingest URL parameters");
        return url;
    }

    private static double normalizeBearing(float bearing) {
        double normalized = bearing % 360.0;
        return normalized < 0 ? normalized + 360.0 : normalized;
    }

    private static String formatTimestamp(long epochMillis) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(epochMillis));
    }

    private static String readStream(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
