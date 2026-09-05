import { mkdir, rm, copyFile, access, readFile, writeFile } from 'node:fs/promises';
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

const indexPath = join('www', 'index.html');
let index = await readFile(indexPath, 'utf8');
const marker = '<div class="feature-list">';
const locationEntry = '<a class="feature-row" href="location.html" style="text-decoration:none;color:inherit"><span class="feature-icon">⌖</span><span><strong>Localisation</strong><small>Position partagée JB & Manon</small></span><b>›</b></a>';
if (!index.includes(marker)) throw new Error('Mobile location insertion point not found');
index = index.replace(marker, marker + locationEntry);
await writeFile(indexPath, index, 'utf8');

console.log(`Prepared ${files.length} web assets in www/ with native location entry`);
