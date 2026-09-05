import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const packagePath = join('android', 'app', 'src', 'main', 'java', 'io', 'github', 'djnastx', 'nousdeux');
const nativeSourcePath = join('native', 'android', 'io', 'github', 'djnastx', 'nousdeux');
const manifestPath = join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
const mainActivityPath = join(packagePath, 'MainActivity.java');

const nativeFiles = [
  'SecureSessionStore.java',
  'SupabaseLocationClient.java',
  'LocationTrackingService.java',
  'LocationBridgePlugin.java'
];

await access(manifestPath);
await access(mainActivityPath);
await mkdir(packagePath, { recursive: true });

for (const file of nativeFiles) {
  const source = join(nativeSourcePath, file);
  await access(source);
  await copyFile(source, join(packagePath, file));
}

const generatedMain = await readFile(mainActivityPath, 'utf8');
if (!generatedMain.includes('extends BridgeActivity')) {
  throw new Error('Unexpected Capacitor MainActivity template; refusing unsafe patch');
}

const mainActivity = `package io.github.djnastx.nousdeux;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`;
await writeFile(mainActivityPath, mainActivity, 'utf8');

let manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('<application') || !manifest.includes('</application>')) {
  throw new Error('Unexpected AndroidManifest template; refusing unsafe patch');
}

const permissions = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION'
];

for (const permission of permissions) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace(
      '<application',
      `    <uses-permission android:name="${permission}" />\n\n    <application`
    );
  }
}

if (!manifest.includes('android:name=".LocationTrackingService"')) {
  const service = `
        <service
            android:name=".LocationTrackingService"
            android:exported="false"
            android:foregroundServiceType="location"
            android:stopWithTask="false" />
`;
  manifest = manifest.replace('</application>', `${service}    </application>`);
}

manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
await writeFile(manifestPath, manifest, 'utf8');

console.log('Applied native Android location bridge, permissions and foreground service declaration');
