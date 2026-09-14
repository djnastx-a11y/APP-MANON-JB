package com.nastx.nousdeux;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SecureStore store = new SecureStore(context);
        if (!store.isEnabled()) return;
        if (Build.VERSION.SDK_INT >= 29 && context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            context.startForegroundService(new Intent(context, LocationService.class).setAction(LocationService.ACTION_START));
        } catch (Exception ignored) { }
    }
}
