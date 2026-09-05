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

    private final Context context;

    SupabaseLocationClient(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void sendCurrent(Location location) throws Exception {
        JSONObject body = locationJson(location);
        SecureSessionStore.Session session = requireSession();
        Response response = authenticatedPost(
            session,
            "/rest/v1/current_locations?on_conflict=user_id",
            body.toString(),
            "resolution=merge-duplicates,return=minimal"
        );
        ensureSuccess(response, "current location");
    }

    synchronized void sendHistory(Location location) throws Exception {
        JSONObject body = locationJson(location);
        SecureSessionStore.Session session = requireSession();
        Response response = authenticatedPost(
            session,
            "/rest/v1/location_history",
            body.toString(),
            "return=minimal"
        );
        ensureSuccess(response, "location history");
    }

    private Response authenticatedPost(SecureSessionStore.Session session, String path, String body, String prefer) throws Exception {
        Response first = post(session.supabaseUrl + path, session.publishableKey, session.accessToken, body, prefer);
        if (first.code != HttpURLConnection.HTTP_UNAUTHORIZED) return first;

        SecureSessionStore.Session refreshed = refreshSession(session);
        return post(refreshed.supabaseUrl + path, refreshed.publishableKey, refreshed.accessToken, body, prefer);
    }

    private SecureSessionStore.Session refreshSession(SecureSessionStore.Session session) throws Exception {
        JSONObject body = new JSONObject();
        body.put("refresh_token", session.refreshToken);

        Response response = post(
            session.supabaseUrl + "/auth/v1/token?grant_type=refresh_token",
            session.publishableKey,
            null,
            body.toString(),
            null
        );
        ensureSuccess(response, "session refresh");

        JSONObject json = new JSONObject(response.body);
        String accessToken = json.getString("access_token");
        String refreshToken = json.optString("refresh_token", session.refreshToken);
        if (refreshToken == null || refreshToken.isEmpty()) refreshToken = session.refreshToken;

        SecureSessionStore.Session refreshed = new SecureSessionStore.Session(
            session.supabaseUrl,
            session.publishableKey,
            accessToken,
            refreshToken,
            session.userId
        );
        SecureSessionStore.save(context, refreshed);
        return refreshed;
    }

    private SecureSessionStore.Session requireSession() throws Exception {
        SecureSessionStore.Session session = SecureSessionStore.load(context);
        if (session == null) throw new IllegalStateException("No native location session available");
        return session;
    }

    private JSONObject locationJson(Location location) throws Exception {
        SecureSessionStore.Session session = requireSession();
        JSONObject json = new JSONObject();
        json.put("user_id", session.userId);
        json.put("latitude", location.getLatitude());
        json.put("longitude", location.getLongitude());
        json.put("accuracy_m", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        json.put("altitude_m", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        json.put("speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        json.put("heading_deg", location.hasBearing() ? normalizeBearing(location.getBearing()) : JSONObject.NULL);
        json.put("source", "android");
        json.put("captured_at", formatTimestamp(location.getTime() > 0 ? location.getTime() : System.currentTimeMillis()));
        return json;
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

    private static Response post(String rawUrl, String publishableKey, String accessToken, String jsonBody, String prefer) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("Supabase URL must use HTTPS");

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("apikey", publishableKey);
        connection.setRequestProperty("X-Client-Info", "nous-deux-android/0.2");
        if (accessToken != null && !accessToken.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        }
        if (prefer != null && !prefer.isEmpty()) connection.setRequestProperty("Prefer", prefer);

        byte[] bytes = jsonBody.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(bytes);
        }

        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 400 ? connection.getInputStream() : connection.getErrorStream();
        String body = stream == null ? "" : readStream(stream);
        connection.disconnect();
        return new Response(code, body);
    }

    private static String readStream(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void ensureSuccess(Response response, String operation) {
        if (response.code < 200 || response.code >= 300) {
            String body = response.body == null ? "" : response.body;
            if (body.length() > 400) body = body.substring(0, 400);
            throw new IllegalStateException(operation + " failed with HTTP " + response.code + ": " + body);
        }
    }

    private static final class Response {
        final int code;
        final String body;

        Response(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }
}
