#!/usr/bin/env node
/*
 * README ekran görüntülerini üretir:  node tools/screenshots.js [http://localhost:8000/]
 *
 * Sayfanın bir statik sunucuda açık olması gerekir (python -m http.server 8000).
 * Chrome ya da Edge'i başsız (headless) çalıştırır; yolu CHROME ortam değişkeniyle de verilebilir.
 * Her sahne iki dilde çekilir: docs/images/tr/*.png ve docs/images/en/*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'http://localhost:8000/';
const OUT = path.join(__dirname, '..', 'docs', 'images');

const SCENES = {
  'genel-bakis': 'sample=telekom&legend=1',
  'secim-ve-panel': 'sample=telekom&select=BILLING_ACCOUNT&zoom=0.9&legend=0',
  'yakin-plan': 'sample=kucuk&select=SUBSCRIPTION&zoom=1.7&legend=0',
  'coklu-veritabani': 'sample=polyglot&legend=0',
  'dosya-takimyildizlari': 'sample=sigorta&legend=0',
  'sozluk-rozetleri': 'sample=sozluk&center=ABONE&zoom=1.25&legend=0',
  'mongodb-uydular': 'sample=sosyal&select=posts&zoom=0.75&legend=0',
  'adlandirma-profili': 'sample=karisik&pop=naming&legend=0',
};

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = CANDIDATES.find(p => fs.existsSync(p));
if (!chrome) { console.error('Chrome bulunamadı; CHROME ortam değişkeniyle yolunu verin.'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sqlschema-shot-'));
for (const lang of ['tr', 'en']) {
  fs.mkdirSync(path.join(OUT, lang), { recursive: true });
  for (const [name, query] of Object.entries(SCENES)) {
    const file = path.join(OUT, lang, name + '.png');
    const url = `${BASE}?lang=${lang}&${query}`;
    execFileSync(chrome, [
      '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1440,900',
      '--virtual-time-budget=12000', `--user-data-dir=${profile}`, `--screenshot=${file}`, url,
    ], { stdio: 'ignore' });
    console.log(`${lang}/${name}.png  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
}
fs.rmSync(profile, { recursive: true, force: true });
