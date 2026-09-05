package io.github.djnastx.nousdeux;

import android.Manifest;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "LocationBridge",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        )
    }
)
public final class LocationBridgePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (!validateStartCall(call)) return;

        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "handleLocationPermission");
            return;
        }

        startWithGrantedPermission(call);
    }

    @PermissionCallback
    private void handleLocationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission was not granted", "LOCATION_PERMISSION_DENIED");
            return;
        }
        startWithGrantedPermission(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), LocationTrackingService.class);
            getContext().stopService(intent);
            SecureSessionStore.clear(getContext());

            JSObject result = new JSObject();
            result.put("running", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to stop native location service", "LOCATION_STOP_FAILED", error);
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("permission", getPermissionState("location").toString().toLowerCase());
        try {
            result.put("sessionStored", SecureSessionStore.load(getContext()) != null);
        } catch (Exception error) {
            result.put("sessionStored", false);
        }
        call.resolve(result);
    }

    private void startWithGrantedPermission(PluginCall call) {
        try {
            String supabaseUrl = requireString(call, "supabaseUrl");
            String publishableKey = requireString(call, "publishableKey");
            String accessToken = requireString(call, "accessToken");
            String refreshToken = requireString(call, "refreshToken");
            String userId = requireString(call, "userId");

            if (!supabaseUrl.startsWith("https://")) {
                call.reject("Supabase URL must use HTTPS", "INVALID_SUPABASE_URL");
                return;
            }

            SecureSessionStore.save(
                getContext(),
                new SecureSessionStore.Session(
                    supabaseUrl,
                    publishableKey,
                    accessToken,
                    refreshToken,
                    userId
                )
            );

            Intent intent = new Intent(getContext(), LocationTrackingService.class);
            intent.setAction(LocationTrackingService.ACTION_START);
            ContextCompat.startForegroundService(getContext(), intent);

            JSObject result = new JSObject();
            result.put("running", true);
            call.resolve(result);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_LOCATION_SESSION", error);
        } catch (Exception error) {
            SecureSessionStore.clear(getContext());
            call.reject("Unable to start native location service", "LOCATION_START_FAILED", error);
        }
    }

    private boolean validateStartCall(PluginCall call) {
        String[] keys = { "supabaseUrl", "publishableKey", "accessToken", "refreshToken", "userId" };
        for (String key : keys) {
            String value = call.getString(key);
            if (value == null || value.trim().isEmpty()) {
                call.reject("Missing required field: " + key, "INVALID_LOCATION_SESSION");
                return false;
            }
        }
        return true;
    }

    private String requireString(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing required field: " + key);
        }
        return value.trim();
    }
}
