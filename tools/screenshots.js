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
  'tablo-listesi': 'sample=sigorta&list=1&select=HASAR_DOSYA&zoom=0.9&legend=0',
  'alt-diyagram': 'sample=telekom&sub=BILLING_ACCOUNT,INVOICE&near=1&legend=0',
  'etki-analizi': 'sample=kucuk&select=CUSTOMER&impact=1&zoom=0.75&legend=0',
  'yol-vurgulama': 'sample=kucuk&path=PAYMENT_ALLOCATION,ADDRESS&legend=0',
  'ef-core': 'sample=bayi&select=Dealers&zoom=0.8&legend=0',
  'mongodb-uydular': 'sample=sosyal&select=posts&zoom=0.75&legend=0',
  'adlandirma-profili': 'sample=karisik&pop=naming&style=pkStyle&legend=0',
  'sema-farki': 'sample=lojistik&diff=V3&select=shipments&zoom=1.3&legend=0',
  'gecis-taslagi': 'sample=lojistik&diff=V3&alter=1&legend=0',
  'zaman-cizelgesi': 'sample=lojistik&time=V4&select=shipments&zoom=0.85&legend=0',
  'tasarim-denetimi': 'sample=hatali&audit=1&select=KAMPANYA&zoom=1.1&legend=0',
  'duzeltme-onerileri': 'sample=hatali&fix=1&legend=0',
  'standart-ve-kurallar': 'sample=karisik&std=1&legend=0',
  'disa-aktarma': 'sample=kucuk&export=mermaid&legend=0',
  'kvkk-haritasi': 'sample=saglik&privacy=1&pop=privacy&legend=0',
  'inceleme-raporu': 'sample=hatali&diff=V1&review=1&legend=0',
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
