package io.github.djnastx.nousdeux;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureSessionStore {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "nous_deux_location_session_v1";
    private static final String FILE_NAME = "location_session_v1.json.enc";

    private SecureSessionStore() {}

    static final class Session {
        final String supabaseUrl;
        final String publishableKey;
        final String accessToken;
        final String refreshToken;
        final String userId;

        Session(String supabaseUrl, String publishableKey, String accessToken, String refreshToken, String userId) {
            this.supabaseUrl = supabaseUrl;
            this.publishableKey = publishableKey;
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.userId = userId;
        }
    }

    static synchronized void save(Context context, Session session) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("supabaseUrl", session.supabaseUrl);
        payload.put("publishableKey", session.publishableKey);
        payload.put("accessToken", session.accessToken);
        payload.put("refreshToken", session.refreshToken);
        payload.put("userId", session.userId);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        JSONObject envelope = new JSONObject();
        envelope.put("v", 1);
        envelope.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
        envelope.put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));

        File target = getFile(context);
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        Files.write(temp.toPath(), envelope.toString().getBytes(StandardCharsets.UTF_8));
        if (!temp.renameTo(target)) {
            Files.deleteIfExists(target.toPath());
            if (!temp.renameTo(target)) throw new IllegalStateException("Unable to persist encrypted session");
        }
    }

    static synchronized Session load(Context context) throws Exception {
        File file = getFile(context);
        if (!file.exists()) return null;

        String raw = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        JSONObject envelope = new JSONObject(raw);
        if (envelope.optInt("v", 0) != 1) throw new IllegalStateException("Unsupported session format");

        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(envelope.getString("data"), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        String json = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        JSONObject payload = new JSONObject(json);

        return new Session(
            payload.getString("supabaseUrl"),
            payload.getString("publishableKey"),
            payload.getString("accessToken"),
            payload.getString("refreshToken"),
            payload.getString("userId")
        );
    }

    static synchronized void clear(Context context) {
        try {
            Files.deleteIfExists(getFile(context).toPath());
        } catch (Exception ignored) {
        }
    }

    private static File getFile(Context context) {
        return new File(context.getNoBackupFilesDir(), FILE_NAME);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build();
        generator.init(spec);
        return generator.generateKey();
    }
}
