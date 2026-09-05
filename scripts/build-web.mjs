import { mkdir, rm, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const files = [
  'index.html',
  'app.css',
  'app.js',
  'config.js',
  'icon.svg',
  'manifest.json',
  'service-worker.js',
  'location.html',
  'location.css',
  'location.js'
];

await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });

for (const file of files) {
  await access(file);
  await copyFile(file, join('www', file));
}

console.log(`Prepared ${files.length} web assets in www/`);
