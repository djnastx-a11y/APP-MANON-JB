package io.github.djnastx.nousdeux;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureSessionStore {
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "nous_deux_location_device_v2";
    private static final String FILE_NAME = "location_device_v2.json.enc";

    private SecureSessionStore() {}

    static final class Session {
        final String ingestUrl;
        final String deviceToken;

        Session(String ingestUrl, String deviceToken) {
            this.ingestUrl = ingestUrl;
            this.deviceToken = deviceToken;
        }
    }

    static synchronized void save(Context context, Session session) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("ingestUrl", session.ingestUrl);
        payload.put("deviceToken", session.deviceToken);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        JSONObject envelope = new JSONObject();
        envelope.put("v", 2);
        envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        envelope.put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));

        File target = getFile(context);
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp, false)) {
            out.write(envelope.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("Unable to replace encrypted device credential");
        if (!temp.renameTo(target)) throw new IllegalStateException("Unable to persist encrypted device credential");
    }

    static synchronized Session load(Context context) throws Exception {
        File file = getFile(context);
        if (!file.exists()) return null;

        JSONObject envelope = new JSONObject(new String(readAllBytes(file), StandardCharsets.UTF_8));
        if (envelope.optInt("v", 0) != 2) throw new IllegalStateException("Unsupported device credential format");

        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(envelope.getString("data"), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        JSONObject payload = new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));

        return new Session(payload.getString("ingestUrl"), payload.getString("deviceToken"));
    }

    static synchronized void clear(Context context) {
        File file = getFile(context);
        if (file.exists()) file.delete();
    }

    private static byte[] readAllBytes(File file) throws Exception {
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    private static File getFile(Context context) {
        return new File(context.getNoBackupFilesDir(), FILE_NAME);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
