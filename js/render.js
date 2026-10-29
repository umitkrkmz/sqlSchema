/*
 * sqlSchema · render.js
 * Canvas çizimi ve kamera. Yakınlaştırma (k) üç görünüm seçer:
 *   k < LV_GALAXY   galaksi       veritabanları ve şemalar, şemalar arası demetler, sönük yıldızlar
 *   k < LV_CARD     takımyıldız   yıldızlar, ilişki çizgileri, adlar; vurgulu çizgilerde karga ayağı
 *   k ≥ LV_CARD     yakın plan    tablo kartları, kolon satırlarına bağlanan çizgiler, karga ayağı
 */
(function (NS) {
'use strict';

const PALETTE = ['#f2b45a', '#6cc6dc', '#a58cf2', '#ef7b86', '#7fd39a', '#6f9ff4', '#f0955a', '#5fd6b8', '#e38ad4', '#c7d86a', '#9fb3d9', '#f5d76e'];
const C = {
  bg: '#060a18',
  grid: 'rgba(120,140,205,0.075)',
  gridLabel: 'rgba(150,165,215,0.38)',
  edge: '150,172,228',
  hi: '236,241,255',
  text: '#e4e9f7',
  dim: '#8a96b8',
  card: 'rgba(10,16,36,0.95)',
};
const LV_GALAXY = 0.11, LV_CARD = 1.15;
// En yüksek kart: 22 + (8 + 1) × 11 + 6 = 127 birim; layout.js'teki L.nodeR buna göre seçildi
const CARD = { w: 164, head: 22, row: 11, maxRows: 8, pad: 6 };
const FONT_SANS = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const FONT_COND = '"IBM Plex Sans Condensed", "Arial Narrow", "Segoe UI", sans-serif';
const FONT_MONO = '"IBM Plex Mono", "Cascadia Mono", Consolas, ui-monospace, monospace';
const { t: tr } = NS;   // 't' yerel değişkenlerde tablo için kullanılıyor; çeviri işlevi 'tr'
const DASH = { fk: [], ref: [10, 3], imp: [5, 4], off: [1.5, 3.5], emb: [8, 3, 2, 3] };

const $ = sel => document.querySelector(sel);
const canvas = $('#sky');
const ctx = canvas.getContext('2d');

const S = {
  files: [], separate: false, model: null, lay: null, order: [], idx: null,
  cam: { x: 0, y: 0, k: 0.3 }, w: 0, h: 0, dpr: 1, kMin: 0.01,
  hover: null, sel: null, selCol: null, focus: 0,
  implicit: true, grid: true, columns: true, dictLines: false,
  pick: new Set(), relSet: null,   // çoklu seçim (tablo anahtarları) · alt diyagramda görünen ilişkiler
  impact: false, impactRes: null, impactDepth: null,   // etki analizi kipi, sonucu, tablo → derece
  em: { active: null, near: null, hiRels: null, focus: null },
  anim: null, frame: 0, title: '', parseMs: 0,
};

const levelOf = k => (k < LV_GALAXY ? 0 : k < LV_CARD ? 1 : 2);
const sx = x => (x - S.cam.x) * S.cam.k + S.w / 2;
const sy = y => (y - S.cam.y) * S.cam.k + S.h / 2;
const wx = px => (px - S.w / 2) / S.cam.k + S.cam.x;
const wy = py => (py - S.h / 2) / S.cam.k + S.cam.y;
// alt diyagramda yalnızca iki ucu da diyagramda olan ilişkiler görünür (panel de dahil)
const relVisible = r => (S.implicit || r.kind !== 'implicit') && (!S.relSet || S.relSet.has(r));
const relStyle = r => (r.kind === 'implicit' ? 'imp' : r.kind === 'embed' ? 'emb' : r.kind === 'ref' ? 'ref' : r.disabled ? 'off' : 'fk');
const schemaColor = t => (t.external ? '#8892ad' : PALETTE[t.schemaRef.index % PALETTE.length]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Şemasız tablolar ve bağımsız yıldızlar için etiket arayüz dilinde yazılır
const schemaLabel = s => s.label || tr('defaultSchema');
const groupLabel = g => {
  if (g.loose) return tr('looseGroup');
  const l = g.label || schemaLabel(g.schema);
  return l.charAt(0).toLocaleUpperCase() + l.slice(1);
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function starR(t) {
  const zf = clamp(Math.pow(S.cam.k / 0.35, 0.35), 0.6, 1.5);
  const r = Math.min(11, (2.2 + 1.3 * Math.sqrt(t.deg)) * zf);
  return t.embedded ? Math.max(2, r * 0.55) : r;
}

// Kartlarda yer kazanmak için: NUMBER(18,0) → number(18), VARCHAR2(50 CHAR) → varchar2(50)
function shortType(type) {
  return String(type).toLowerCase()
    .replace(/\s+(char|byte)\)/, ')')
    .replace(/^number\((\d+),0\)/, 'number($1)')
    .replace(/^timestamp\s*\(\d\)\s*with (local )?time zone/, 'timestamptz')
    .replace(/^timestamp\s*\(\d\)/, 'timestamp')
    .replace(/^character varying/, 'varchar')
    .replace(/^double precision/, 'double');
}

// PK etiketi; Cassandra'da bölüm anahtarı PK, sıralama (clustering) anahtarı CK
function keyTag(t, c) {
  if (c.pk && t.partition && !t.partition.some(p => p.toUpperCase() === c.name.toUpperCase())) return c.fk ? 'CF' : 'CK';
  return c.pk && c.fk ? 'PF' : c.pk ? 'PK' : c.fk ? 'FK' : '';
}

// Kolon ayrıntıları kapalıyken kart yalnızca başlıktır; çizgiler başlığın ortasına bağlanır.
// Seçenek değişince ui.js her tablonun _rows önbelleğini siler.
function cardRows(t) {
  if (t._rows) return t._rows;
  if (!S.columns) {
    t._rows = [];
    t._more = 0;
    t._rowIdx = new Map();
    t._h = CARD.head;
    return t._rows;
  }
  const rank = c => (c.pk ? 0 : c.fk ? 1 : 2);
  const ordered = t.columns.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  t._rows = ordered.slice(0, CARD.maxRows);
  t._more = ordered.length - t._rows.length;
  // kolon → bağlandığı sözlük tablosu (kartta tip yerine rozet)
  t._dict = new Map(t.out.filter(r => r.dict && r.cols.length === 1).map(r => [r.cols[0].toUpperCase(), r.parent.name]));
  // karşılaştırmada kolon durumu (eklenen / değişen / adı değişen satırlar renklenir)
  const de = S.diffRes && diffOf(t);
  t._diffCols = de && de.status === 'changed' ? new Map(de.cols.filter(c => c.after).map(c => [c.after.name.toUpperCase(), c.status])) : null;
  t._rowIdx = new Map(t._rows.map((c, i) => [c.name.toUpperCase(), i]));
  t._h = CARD.head + Math.max(1, t._rows.length) * CARD.row + (t._more > 0 ? CARD.row : 0) + CARD.pad;
  return t._rows;
}

function anchorY(t, colName) {
  cardRows(t);
  const i = colName === undefined ? undefined : t._rowIdx.get(String(colName).toUpperCase());
  const top = t.y - t._h / 2;
  return i === undefined ? top + CARD.head / 2 : top + CARD.head + i * CARD.row + CARD.row / 2;
}

function cardGeom(r) {
  const a = r.child, b = r.parent, W = CARD.w / 2;
  let d1 = 1, d2 = 1;
  if (!r.self) {
    if (b.x - a.x > CARD.w * 0.7) { d1 = 1; d2 = -1; }
    else if (a.x - b.x > CARD.w * 0.7) { d1 = -1; d2 = 1; }
  }
  // gömülü belge çizgisi uydunun başlığından sahibindeki alan satırına gider
  const y1 = r.kind === 'embed' ? anchorY(a) : anchorY(a, r.cols[0]);
  const y2 = r.kind === 'embed' ? anchorY(b, r.cols[0]) : anchorY(b, r.refCols[0]);
  return { x1: a.x + d1 * W, y1, d1, x2: b.x + d2 * W, y2, d2 };
}

/*
 * Karga ayağı ucu. (px,py) varlığın sınırı, (ux,uy) varlıktan dışarı bakan birim vektör.
 * Varlığa en yakın işaret üst sınırı (| bir, < çok), dıştaki alt sınırı (o sıfır, | bir) gösterir.
 */
function drawEnd(g, px, py, ux, uy, kind, s, bg) {
  const nx = -uy, ny = ux;
  const many = kind === 'zeroMany' || kind === 'oneMany';
  const bar = d => {
    const cx = px + ux * d, cy = py + uy * d;
    g.moveTo(cx + nx * s * 0.6, cy + ny * s * 0.6);
    g.lineTo(cx - nx * s * 0.6, cy - ny * s * 0.6);
  };
  g.beginPath();
  if (many) {
    const tx = px + ux * s * 1.15, ty = py + uy * s * 1.15;
    g.moveTo(px + nx * s * 0.7, py + ny * s * 0.7);
    g.lineTo(tx, ty);
    g.lineTo(px - nx * s * 0.7, py - ny * s * 0.7);
    g.moveTo(px, py);
    g.lineTo(tx, ty);
  } else {
    bar(s * 0.55);
  }
  if (kind === 'one') bar(s * 1.05);
  if (kind === 'oneMany') bar(s * 1.6);
  g.stroke();
  if (kind === 'zeroOne' || kind === 'zeroMany') {
    const d = many ? s * 1.75 : s * 1.4;
    g.beginPath();
    g.arc(px + ux * d, py + uy * d, s * 0.4, 0, Math.PI * 2);
    g.fillStyle = bg;
    g.fill();
    g.stroke();
  }
}

// Küçük çizgi + iki uç işareti (lejant ve panel için)
function drawGlyph(cv, left, right, style, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 64, h = cv.clientHeight || 18;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.strokeStyle = color || C.text;
  g.lineWidth = 1.2;
  g.setLineDash(DASH[style] || []);
  g.beginPath();
  g.moveTo(left ? 2 : 0, h / 2);
  g.lineTo(right ? w - 2 : w, h / 2);
  g.stroke();
  g.setLineDash([]);
  const bg = getComputedStyle(cv).getPropertyValue('--glyph-bg').trim() || C.bg;
  if (left) { g.beginPath(); g.moveTo(2, 3); g.lineTo(2, h - 3); g.stroke(); drawEnd(g, 2, h / 2, 1, 0, left, 6, bg); }
  if (right) { g.beginPath(); g.moveTo(w - 2, 3); g.lineTo(w - 2, h - 3); g.stroke(); drawEnd(g, w - 2, h / 2, -1, 0, right, 6, bg); }
}

// Etiket çakışma ızgarası
class LabelGrid {
  constructor() { this.cells = new Map(); this.size = 64; }
  keys(x, y, w, h, fn) {
    const s = this.size;
    for (let gx = Math.floor(x / s); gx <= Math.floor((x + w) / s); gx++) {
      for (let gy = Math.floor(y / s); gy <= Math.floor((y + h) / s); gy++) if (fn(gx + ',' + gy) === false) return false;
    }
    return true;
  }
  free(x, y, w, h) {
    return this.keys(x, y, w, h, k => {
      const list = this.cells.get(k);
      if (!list) return true;
      for (const r of list) if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]) return false;
      return true;
    });
  }
  add(x, y, w, h) {
    const r = [x, y, w, h];
    this.keys(x, y, w, h, k => { if (!this.cells.has(k)) this.cells.set(k, []); this.cells.get(k).push(r); });
  }
  claim(cx, cy, w, h) {
    if (!this.free(cx - w / 2, cy - h / 2, w, h)) return false;
    this.add(cx - w / 2, cy - h / 2, w, h);
    return true;
  }
}

// Arka plan tozu: tohumlu, ekran uzayında, hafif paralaks
const DUST = (() => {
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  return Array.from({ length: 380 }, () => ({ x: rnd(), y: rnd(), r: rnd() < 0.08 ? 1.3 : 0.7, a: 0.15 + rnd() * 0.45 }));
})();

function viewRect(m) {
  return { x0: wx(-m), y0: wy(-m), x1: wx(S.w + m), y1: wy(S.h + m) };
}

function refreshEmphasis() {
  const a = S.hover || S.sel;
  const em = { active: a, near: null, hiRels: null, focus: null };
  if (a) {
    em.near = new Set([a]);
    em.hiRels = new Set();
    for (const r of a.out.concat(a.inc)) {
      if (!relVisible(r)) continue;
      em.hiRels.add(r);
      em.near.add(r.child);
      em.near.add(r.parent);
    }
  }
  // etki analizi açıkken yalnızca kök ve etkilenenler parlak, aradaki bağlantılar vurgulu
  if (S.impactRes) {
    const f = new Set([S.impactRes.root]);
    em.hiRels = new Set();
    for (const level of S.impactRes.levels) for (const x of level) { f.add(x.t); em.hiRels.add(x.via); }
    em.focus = f;
    em.near = f;
    S.em = em;
    return;
  }
  if (S.sel && S.focus) {
    const f = new Set([S.sel]);
    let frontier = [S.sel];
    for (let d = 0; d < S.focus; d++) {
      const nx = [];
      for (const t of frontier) {
        for (const r of t.out.concat(t.inc)) {
          if (!relVisible(r)) continue;
          const o = r.child === t ? r.parent : r.child;
          if (!f.has(o)) { f.add(o); nx.push(o); }
        }
      }
      frontier = nx;
    }
    em.focus = f;
  }
  S.em = em;
}

function nodeAlpha(t) {
  const em = S.em;
  if (em.focus && !em.focus.has(t)) return 0.07;
  if (em.active && !em.near.has(t)) return 0.3;
  // karşılaştırmada değişmeyen tablolar geri planda
  if (S.diffRes) { const d = diffOf(t); if (!d || d.status === 'same') return 0.35; }
  return 1;
}

// Şema farkı: eklenen yeşil, silinen kırmızı, değişen sarı; adı değişen ayrıca mavi halka
const DIFF_COLOR = { added: '#7fd49a', removed: '#ef7b86', changed: '#f2b45a', renamed: '#6cc6dc' };
const diffOf = t => S.diffRes && (S.diffRes.byAfter.get(t) || S.diffRes.byBefore.get(t));
const diffColor = t => { const d = diffOf(t); return d && d.status !== 'same' ? DIFF_COLOR[d.status] : null; };

function relClass(r) {
  const em = S.em;
  if (em.focus && !(em.focus.has(r.child) && em.focus.has(r.parent))) return 'ghost';
  if (em.hiRels && em.hiRels.has(r)) return 'hi';
  if (em.active) return 'dim';
  return 'norm';
}

function invalidate() {
  if (S.frame) return;
  S.frame = requestAnimationFrame(() => { S.frame = 0; draw(); if (S.anim) invalidate(); });
}

function draw() {
  if (S.anim) stepAnim();
  const { w, h, dpr } = S;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  drawDust();
  if (!S.lay) return;
  const lv = levelOf(S.cam.k);
  if (S.grid) drawGrid();
  drawRegions(lv, false);
  drawEdges(lv);
  if (lv === 2) drawCards(); else drawStars(lv);
  drawRegions(lv, true);
  if (lv < 2) drawLabels(lv);
  updateHud(lv);
}

function drawDust() {
  const ox = S.cam.x * S.cam.k * 0.03, oy = S.cam.y * S.cam.k * 0.03;
  const W = S.w + 40, H = S.h + 40;
  ctx.fillStyle = '#c9d4ff';
  for (const d of DUST) {
    const x = ((d.x * W - ox) % W + W) % W - 20;
    const y = ((d.y * H - oy) % H + H) % H - 20;
    ctx.globalAlpha = d.a * 0.6;
    ctx.fillRect(x, y, d.r, d.r);
  }
  ctx.globalAlpha = 1;
}

function fmtNum(v) {
  const s = Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u{2009}');
  return (v < 0 ? '\u{2212}' : '') + s;
}

function drawGrid() {
  const k = S.cam.k;
  const target = 150 / k;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= target);
  const x0 = wx(0), x1 = wx(S.w), y0 = wy(0), y1 = wy(S.h);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const X = Math.round(sx(x)) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, S.h); }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const Y = Math.round(sy(y)) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(S.w, Y); }
  ctx.stroke();
  ctx.fillStyle = C.gridLabel;
  ctx.font = `9px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) ctx.fillText(fmtNum(x), Math.round(sx(x)) + 4, 6);
  ctx.textBaseline = 'bottom';
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) if (sy(y) > 24) ctx.fillText(fmtNum(y), 6, Math.round(sy(y)) - 3);
}

function spaced(px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

// Veritabanı ve şema bölgeleri. İki geçiş: önce sınır daireleri (yıldızların altında), sonra adlar.
function drawRegions(lv, labels) {
  const k = S.cam.k;
  const multiDb = S.lay.dbs.length > 1;
  const multi = S.lay.schemas.length > 1;
  const faded = S.em.focus ? 0.35 : 1;
  const grid = labels ? new LabelGrid() : null;
  const DIALECTS = NS.DIALECTS;

  if (multiDb) {
    for (const db of S.lay.dbs) {
      const x = sx(db.x), y = sy(db.y), r = db.r * k;
      if (x + r < 0 || x - r > S.w || y + r < 0 || y - r > S.h) continue;
      if (!labels) {
        ctx.strokeStyle = `rgba(200,212,245,${0.13 * faded})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const name = db.label.toUpperCase();
      const sub = [...db.dialects].map(d => DIALECTS[d] || d).join(' + ');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = `600 ${lv === 0 ? 15 : 12}px ${FONT_COND}`;
      spaced(4);
      const ty = Math.max(y - r - 10, 30);
      if (grid.claim(x, ty - 10, ctx.measureText(name).width + 10, 32)) {
        ctx.fillStyle = `rgba(226,232,250,${0.85 * faded})`;
        ctx.fillText(name, x, ty - 12);
        spaced(0);
        ctx.font = `10px ${FONT_MONO}`;
        ctx.fillStyle = `rgba(170,180,212,${0.75 * faded})`;
        ctx.fillText(tr('database') + ' · ' + sub, x, ty + 2);
      }
      spaced(0);
    }
  }

  // şemalar büyükten küçüğe sıralı: kalabalıkta büyüklerin adı kalır
  for (const s of S.lay.schemas) {
    const x = sx(s.x), y = sy(s.y), r = s.r * k;
    if (x + r < 0 || x - r > S.w || y + r < 0 || y - r > S.h) continue;
    const col = PALETTE[s.index % PALETTE.length];
    const showCircle = multi && !(multiDb && s.db.schemas.length === 1);
    if (!labels) {
      if (showCircle) {
        ctx.setLineDash([2, 6]);
        ctx.strokeStyle = rgba(col, 0.16 * faded);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // dosya takımyıldızları: hangi tablonun hangi dosyadan geldiği bir bakışta görünsün
      for (const g of s.groups) {
        const gr = g.r * k;
        if (!g.file || gr < 14) continue;
        ctx.fillStyle = rgba(col, 0.03 * faded);
        ctx.strokeStyle = rgba(col, 0.22 * faded);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx(g.x), sy(g.y), gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      continue;
    }
    ctx.textAlign = 'center';
    if (lv === 0) {
      const fs = clamp(r * 0.12, 10, 18);
      const name = schemaLabel(s).toUpperCase();
      ctx.font = `600 ${fs}px ${FONT_COND}`;
      spaced(3);
      const nw = ctx.measureText(name).width;
      const sub = r > 50 ? tr('schemaSub', { t: s.tables.length, g: s.groups.length }) : '';
      if (grid.claim(x, y + (sub ? 3 : 0), nw + 8, fs + (sub ? 20 : 6))) {
        ctx.fillStyle = rgba(col, 0.92 * faded);
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x, y - (sub ? 6 : 0));
        spaced(0);
        if (sub) {
          ctx.font = `10px ${FONT_MONO}`;
          ctx.fillStyle = rgba('#aab4d4', 0.7 * faded);
          ctx.fillText(sub, x, y + 12);
        }
      }
      spaced(0);
    } else if (showCircle) {
      ctx.font = `600 11px ${FONT_COND}`;
      spaced(2.5);
      const name = schemaLabel(s).toUpperCase();
      if (grid.claim(x, y - r - 12, ctx.measureText(name).width + 8, 14)) {
        ctx.fillStyle = rgba(col, 0.6 * faded);
        ctx.textBaseline = 'bottom';
        ctx.fillText(name, x, y - r - 6);
      }
      spaced(0);
    }
    if (lv === 1 && s.groups.length > 1) {
      ctx.font = `500 10px ${FONT_COND}`;
      spaced(1.5);
      ctx.fillStyle = rgba('#b8c2e0', 0.32 * faded);
      ctx.textBaseline = 'bottom';
      for (const g of s.groups) if (!g.file && g.r * k > 60) ctx.fillText(groupLabel(g).toUpperCase(), sx(g.x), sy(g.y - g.r) + 4);
      spaced(0);
    }
    // dosya takımyıldızının adı sınırının üstünde, yakın planda da kalır
    if (lv >= 1) {
      ctx.font = `600 11px ${FONT_COND}`;
      spaced(1.5);
      ctx.textBaseline = 'bottom';
      for (const g of s.groups) {
        if (!g.file || g.r * k < 40) continue;
        const name = groupLabel(g);
        const gx = sx(g.x), gy = sy(g.y - g.r) - 5;
        if (!grid.claim(gx, gy - 7, ctx.measureText(name).width + 8, 14)) continue;
        ctx.fillStyle = rgba(col, 0.75 * faded);
        ctx.fillText(name, gx, gy);
      }
      spaced(0);
    }
  }
}

function pathRel(r, lv) {
  const a = r.child, b = r.parent;
  if (lv < 2) {
    const x = sx(a.x), y = sy(a.y);
    if (r.self) {
      const rr = starR(a) + 6;
      ctx.moveTo(x + rr * 1.4, y - rr * 0.2);
      ctx.arc(x + rr * 0.8, y - rr * 0.8, rr * 0.75, 0.4, Math.PI * 2 + 0.3);
      return;
    }
    ctx.moveTo(x, y);
    ctx.lineTo(sx(b.x), sy(b.y));
    return;
  }
  const g = cardGeom(r);
  const c = Math.max(42, Math.abs(g.x2 - g.x1) * 0.45);
  ctx.moveTo(sx(g.x1), sy(g.y1));
  ctx.bezierCurveTo(sx(g.x1 + g.d1 * c), sy(g.y1), sx(g.x2 + g.d2 * c), sy(g.y2), sx(g.x2), sy(g.y2));
}

function relInView(r, v, m) {
  const a = r.child, b = r.parent;
  return Math.max(a.x, b.x) + m >= v.x0 && Math.min(a.x, b.x) - m <= v.x1 && Math.max(a.y, b.y) + m >= v.y0 && Math.min(a.y, b.y) - m <= v.y1;
}

function strokeFor(style, alpha, lv, hi) {
  ctx.strokeStyle = `rgba(${hi ? C.hi : C.edge},${alpha})`;
  ctx.lineWidth = (lv === 0 ? 0.6 : lv === 1 ? 0.9 : 1.15) + (hi ? 0.7 : 0);
  ctx.setLineDash(DASH[style]);
}

function drawEdges(lv) {
  const v = viewRect(40);
  const m = lv === 2 ? CARD.w : 0;
  const base = lv === 0 ? 0.1 : lv === 1 ? 0.13 + 0.15 * clamp((S.cam.k - LV_GALAXY) / 0.5, 0, 1) : 0.42;
  const alpha = { norm: base, dim: base * 0.3, ghost: 0.025 };
  const batches = new Map();
  const hi = [];
  const drawn = [];
  for (const r of S.model.rels) {
    if (!relVisible(r)) continue;
    if (lv === 0 && r.child.schemaRef !== r.parent.schemaRef) continue;
    if (!relInView(r, v, m)) continue;
    const cls = relClass(r);
    // sözlük bağlantıları rozetle gösterilir; çizgi yalnızca uçlardan biri seçili ya da üzerindeyken
    if (r.dict && !S.dictLines && cls !== 'hi') continue;
    if (cls === 'hi') { hi.push(r); continue; }
    if (cls !== 'ghost') drawn.push(r);
    const key = relStyle(r) + '|' + cls;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(r);
  }
  for (const [key, list] of batches) {
    const [style, cls] = key.split('|');
    ctx.beginPath();
    for (const r of list) pathRel(r, lv);
    strokeFor(style, alpha[cls], lv, false);
    ctx.stroke();
  }
  for (const r of hi) {
    ctx.beginPath();
    pathRel(r, lv);
    strokeFor(relStyle(r), 0.95, lv, true);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (lv === 2) {
    const s = clamp(6 * S.cam.k, 5, 13);
    const hiSet = new Set(hi);
    for (const r of drawn.concat(hi)) {
      const g = cardGeom(r);
      const isHi = hiSet.has(r);
      ctx.strokeStyle = `rgba(${isHi ? C.hi : C.edge},${isHi ? 0.95 : Math.min(0.85, base * 1.8) * (relClass(r) === 'dim' ? 0.35 : 1)})`;
      ctx.lineWidth = isHi ? 1.6 : 1.1;
      drawEnd(ctx, sx(g.x1), sy(g.y1), g.d1, 0, r.childEnd, s, C.card);
      drawEnd(ctx, sx(g.x2), sy(g.y2), g.d2, 0, r.parentEnd, s, C.card);
    }
  } else if (lv === 1) {
    ctx.strokeStyle = `rgba(${C.hi},0.95)`;
    ctx.lineWidth = 1.3;
    const labels = hi.length <= 40;
    for (const r of hi) {
      if (r.self) continue;
      const ax = sx(r.child.x), ay = sy(r.child.y), bx = sx(r.parent.x), by = sy(r.parent.y);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 40) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const ra = starR(r.child) + 3, rb = starR(r.parent) + 3;
      drawEnd(ctx, ax + ux * ra, ay + uy * ra, ux, uy, r.childEnd, 6, C.bg);
      drawEnd(ctx, bx - ux * rb, by - uy * rb, -ux, -uy, r.parentEnd, 6, C.bg);
      if (labels && len > 140) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        let ang = Math.atan2(uy, ux);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.font = `9.5px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(200,212,245,0.85)';
        ctx.fillText(r.cols.join(', ') + (r.filter ? ' · ' + r.filter : ''), 0, -3);
        ctx.restore();
      }
    }
  } else {
    drawBundles();
  }
}

function drawBundles() {
  const pairs = new Map();
  for (const r of S.model.rels) {
    if (!relVisible(r) || (r.dict && !S.dictLines)) continue;
    const a = r.child.schemaRef, b = r.parent.schemaRef;
    if (a === b) continue;
    const key = a.index < b.index ? a.index + ',' + b.index : b.index + ',' + a.index;
    if (!pairs.has(key)) pairs.set(key, { a, b, n: 0 });
    pairs.get(key).n++;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `9.5px ${FONT_MONO}`;
  for (const { a, b, n } of pairs.values()) {
    const x1 = sx(a.x), y1 = sy(a.y), x2 = sx(b.x), y2 = sy(b.y);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const cx = mx - dy * 0.12, cy = my + dx * 0.12;
    ctx.strokeStyle = `rgba(${C.edge},0.22)`;
    ctx.lineWidth = 0.8 + Math.log2(n + 1) * 0.7;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();
    if (Math.hypot(dx, dy) < 160) continue;
    const lx = 0.25 * x1 + 0.5 * cx + 0.25 * x2, ly = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
    ctx.fillStyle = 'rgba(6,10,24,0.85)';
    const tw = ctx.measureText(String(n)).width + 8;
    ctx.fillRect(lx - tw / 2, ly - 7, tw, 14);
    ctx.fillStyle = 'rgba(190,202,235,0.8)';
    ctx.fillText(String(n), lx, ly + 0.5);
  }
}

function drawStars(lv) {
  const v = viewRect(20);
  const em = S.em;
  for (const t of S.model.tables) {
    if (t.x < v.x0 || t.x > v.x1 || t.y < v.y0 || t.y > v.y1) continue;
    const a = nodeAlpha(t);
    const x = sx(t.x), y = sy(t.y), r = starR(t);
    const col = diffColor(t) || schemaColor(t);
    ctx.globalAlpha = a * (t.deg === 0 ? 0.6 : 1);
    if (t === em.active || t === S.sel) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, rgba(col, 0.55));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    }
    if (t.external) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, r * 0.8), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (t.embedded) {
      // uydu: sönük dolgu, ince halka
      ctx.fillStyle = rgba(col, 0.45);
      ctx.strokeStyle = rgba(col, 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (t.junction) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.fillStyle = C.bg;
      ctx.beginPath();
      ctx.arc(x, y, clamp(r * 0.6, 2.4, 4.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (t.deg >= 3 && lv > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (S.pick.has(t.key)) drawPickRing(x, y, r + 4);
    const d = S.impactDepth && S.impactDepth.get(t);
    if (d) drawPickRing(x, y, r + 4, impactColor(d));
    const dd = S.diffRes && diffOf(t);
    if (dd && dd.renamed) drawPickRing(x, y, r + 4, DIFF_COLOR.renamed);
  }
  ctx.globalAlpha = 1;
  if (S.sel) drawReticle(sx(S.sel.x), sy(S.sel.y), starR(S.sel) + 7);
}

// etki derecesi: 1. derece en sıcak renk
const impactColor = d => (d === 1 ? 'rgba(239,123,134,0.95)' : d === 2 ? 'rgba(242,180,90,0.9)' : 'rgba(138,150,184,0.85)');

// çoklu seçime eklenmiş tablo: vurgu renginde ince halka (etki analizinde dereceye göre renk)
function drawPickRing(x, y, r, color) {
  ctx.strokeStyle = color || 'rgba(242,180,90,0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawReticle(x, y, r) {
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * (r + 3), y + dy * (r + 3));
    ctx.lineTo(x + dx * (r + 8), y + dy * (r + 8));
  }
  ctx.stroke();
}

function subLabel(t) {
  if (t.external) return tr('notDefined');
  if (t.embedded) return tr('satelliteOf', { o: t.owner ? t.owner.name : tr('embeddedDoc') });
  if (t.group.loose) return tr('looseStar');
  return `${t.desig} ${groupLabel(t.group)}`;
}

function drawLabels(lv) {
  const em = S.em;
  const grid = new LabelGrid();
  const showSub = S.cam.k > 0.45;
  const v = viewRect(0);
  // kalabalık bir gökyüzünde yalnızca parlak yıldızların adı yazılır
  let inView = 0;
  for (const t of S.model.tables) if (t.x >= v.x0 && t.x <= v.x1 && t.y >= v.y0 && t.y <= v.y1) inView++;
  const minDeg = inView < 120 ? 0 : S.cam.k < 0.16 ? 4 : S.cam.k < 0.26 ? 2 : 0;
  const seen = new Set();
  const list = em.active ? [...em.near, ...S.order] : S.order;
  let budget = 450;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const t of list) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (t.x < v.x0 || t.x > v.x1 || t.y < v.y0 || t.y > v.y1) continue;
    const near = em.near && em.near.has(t);
    if (!near && (lv === 0 || t.deg < minDeg || (t.embedded && S.cam.k < 0.3))) continue;
    const a = nodeAlpha(t);
    if (a < 0.2) continue;
    const name = t.embedded ? t.name.split('.').pop() : t.name;
    if (!t._lw) {
      ctx.font = `500 11px ${FONT_SANS}`;
      t._lw = ctx.measureText(name).width;
      ctx.font = `9.5px ${FONT_MONO}`;
      t._sub = subLabel(t);
      t._sw = ctx.measureText(t._sub).width;
    }
    const x = sx(t.x), y = sy(t.y) + starR(t) + 13;
    const w = Math.max(t._lw, showSub ? t._sw : 0) + 6;
    const hgt = showSub ? 25 : 14;
    if (!grid.free(x - w / 2, y - 11, w, hgt)) continue;
    grid.add(x - w / 2, y - 11, w, hgt);
    ctx.globalAlpha = a < 1 ? 0.5 : 1;
    ctx.font = `${t.embedded ? 400 : 500} 11px ${FONT_SANS}`;
    ctx.fillStyle = t === S.sel || t === S.hover ? '#ffffff' : t.embedded ? 'rgba(220,228,248,0.8)' : C.text;
    ctx.fillText(name, x, y);
    if (showSub) {
      ctx.font = `9.5px ${FONT_MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(t._sub, x, y + 12);
    }
    if (--budget <= 0) break;
  }
  ctx.globalAlpha = 1;
}

function fitText(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function drawCards() {
  const k = S.cam.k;
  const v = viewRect(CARD.w * k);
  const em = S.em;
  const order = S.model.tables.filter(t => t.x > v.x0 && t.x < v.x1 && t.y > v.y0 && t.y < v.y1);
  if (em.active) order.sort((a, b) => (a === em.active) - (b === em.active));
  for (const t of order) {
    const rows = cardRows(t);
    const W = CARD.w * k, H = t._h * k;
    const x0 = sx(t.x) - W / 2, y0 = sy(t.y) - H / 2;
    const col = diffColor(t) || schemaColor(t);
    const a = nodeAlpha(t);
    const isSel = t === S.sel, isAct = t === em.active;
    ctx.globalAlpha = a;
    if (isSel || isAct) {
      ctx.shadowColor = rgba(col, 0.6);
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = C.card;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, W, H, (t.embedded ? 10 : 4) * k); else ctx.rect(x0, y0, W, H);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.setLineDash(t.external ? [3, 3] : t.embedded ? [5, 2] : []);
    const picked = S.pick.has(t.key);
    const depth = S.impactDepth && S.impactDepth.get(t);
    ctx.strokeStyle = isSel ? '#ffffff' : depth ? impactColor(depth) : picked ? 'rgba(242,180,90,0.95)' : rgba(col, isAct ? 0.95 : 0.55);
    ctx.lineWidth = isSel || picked || depth ? 1.6 : 1;
    ctx.stroke();
    ctx.setLineDash([]);
    // başlık
    ctx.fillStyle = rgba(col, 0.13);
    ctx.fillRect(x0 + 1, y0 + 1, W - 2, CARD.head * k - 1);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x0 + 9 * k, y0 + CARD.head * k / 2, 3 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `600 ${10 * k}px ${FONT_SANS}`;
    ctx.fillStyle = C.text;
    const badge = t.junction ? 'M:N' : t.external ? tr('badgeExt') : t.embedded ? tr('badgeSat') : '';
    // kolonlar gizliyken başlıkta kolon sayısı: kartın ne kadar dolu olduğu yine görünsün
    const right = [badge, !S.columns && t.columns.length ? String(t.columns.length) : ''].filter(Boolean).join(' · ');
    ctx.fillText(fitText(t.name, W - (right ? 50 : 22) * k), x0 + 16 * k, y0 + CARD.head * k / 2 + 0.5);
    if (right) {
      ctx.font = `500 ${7.5 * k}px ${FONT_MONO}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = badge ? rgba(col, 0.9) : C.dim;
      ctx.fillText(right, x0 + W - 6 * k, y0 + CARD.head * k / 2 + 0.5);
    }
    // satırlar
    const rowH = CARD.row * k;
    let y = y0 + CARD.head * k + rowH / 2;
    for (const c of rows) {
      const hl = isSel && S.selCol && c.name.toUpperCase() === S.selCol;
      if (hl) { ctx.fillStyle = 'rgba(242,180,90,0.16)'; ctx.fillRect(x0 + 1, y - rowH / 2, W - 2, rowH); }
      const ds = t._diffCols && t._diffCols.get(c.name.toUpperCase());
      if (ds) { ctx.fillStyle = rgba(DIFF_COLOR[ds === 'added' ? 'added' : ds === 'renamed' ? 'renamed' : 'changed'], 0.16); ctx.fillRect(x0 + 1, y - rowH / 2, W - 2, rowH); }
      const tag = keyTag(t, c);
      ctx.textAlign = 'left';
      if (tag) {
        ctx.font = `500 ${7 * k}px ${FONT_MONO}`;
        ctx.fillStyle = c.pk ? '#f2b45a' : '#6cc6dc';
        ctx.fillText(tag, x0 + 6 * k, y + 0.5);
      }
      ctx.font = `${c.nullable ? 400 : 500} ${8.5 * k}px ${FONT_SANS}`;
      ctx.fillStyle = c.nullable ? 'rgba(200,210,235,0.62)' : C.text;
      const cname = fitText(c.name, W * 0.54 - (c.values ? 8 * k : 0));
      ctx.fillText(cname, x0 + 22 * k, y + 0.5);
      // değer listesi olan kolon: adın yanında ≡ (değerler panelde)
      if (c.values) {
        const nx = x0 + 22 * k + ctx.measureText(cname).width + 3 * k;
        ctx.font = `${7.5 * k}px ${FONT_MONO}`;
        ctx.fillStyle = 'rgba(242,180,90,0.85)';
        ctx.fillText('\u{2261}', nx, y + 0.5);
      }
      ctx.textAlign = 'right';
      ctx.font = `${7 * k}px ${FONT_MONO}`;
      const dict = !S.dictLines && t._dict.get(c.name.toUpperCase());
      ctx.fillStyle = dict ? 'rgba(242,180,90,0.9)' : C.dim;
      ctx.fillText(fitText(dict ? '→ ' + dict : shortType(c.type), W * 0.3), x0 + W - 6 * k, y + 0.5);
      y += rowH;
    }
    if (t._more > 0) {
      ctx.textAlign = 'left';
      ctx.font = `${7.5 * k}px ${FONT_MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(tr('moreCols', { n: t._more }), x0 + 22 * k, y + 0.5);
    }
    if (!rows.length && S.columns) {
      ctx.textAlign = 'left';
      ctx.font = `${7.5 * k}px ${FONT_MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(t.noColumns ? 'CREATE TABLE … AS SELECT' : tr('noCols'), x0 + 8 * k, y + 0.5);
    }
  }
  ctx.globalAlpha = 1;
}

let hudText = '';
function updateHud(lv) {
  const st = S.model.stats;
  const txt = `${tr('levels')[lv]} · ×${S.cam.k < 1 ? S.cam.k.toFixed(2) : S.cam.k.toFixed(1)}`;
  if (txt === hudText) return;
  hudText = txt;
  $('#hudView').textContent = txt;
  const mongoOnly = st.dialects.length === 1 && st.dialects[0] === 'mongodb';
  const parts = [tr(mongoOnly ? 'nCollections' : 'nTables', { n: st.tables }), `${st.fk} FK`, tr('nInferred', { n: st.implicit })];
  if (st.embedded) parts.push(tr('nSatellites', { n: st.embedded }));
  $('#hudStats').textContent = parts.join(' · ');
}
const resetHud = () => { hudText = ''; };

/* ─── Kamera ─── */

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  S.dpr = window.devicePixelRatio || 1;
  S.w = r.width;
  S.h = r.height;
  canvas.width = Math.round(r.width * S.dpr);
  canvas.height = Math.round(r.height * S.dpr);
  invalidate();
}

function fitView(animate) {
  if (!S.lay) return;
  const b = S.lay.bounds;
  // panel, tablo listesi ve açık lejantın kapladığı şeritleri hesaba kat
  const right = S.sel && !$('#panel').hidden && S.w > 820 ? 384 : 0;
  const left = !$('#tableList').hidden && S.w > 980 ? 304 : !document.body.classList.contains('legend-closed') && S.w > 980 ? 312 : 0;
  const k = clamp(Math.min((S.w - left - right - 60) / (b.maxX - b.minX), (S.h - 80) / (b.maxY - b.minY)), 0.005, 1.6);
  const target = { x: (b.minX + b.maxX) / 2 + (right - left) / 2 / k, y: (b.minY + b.maxY) / 2, k };
  S.kMin = k * 0.4;
  if (animate) flyTo(target); else { S.cam = target; invalidate(); }
}

function flyTo(target, ms = 650) {
  S.anim = { from: { ...S.cam }, to: target, t0: performance.now(), ms };
  invalidate();
}

function stepAnim() {
  const a = S.anim;
  const p = clamp((performance.now() - a.t0) / a.ms, 0, 1);
  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  S.cam = {
    x: a.from.x + (a.to.x - a.from.x) * e,
    y: a.from.y + (a.to.y - a.from.y) * e,
    k: Math.exp(Math.log(a.from.k) + (Math.log(a.to.k) - Math.log(a.from.k)) * e),
  };
  if (p >= 1) S.anim = null;
}

function zoomAt(px, py, f) {
  S.anim = null;
  const k = clamp(S.cam.k * f, S.kMin || 0.005, 5);
  const x = wx(px), y = wy(py);
  S.cam.k = k;
  S.cam.x = x - (px - S.w / 2) / k;
  S.cam.y = y - (py - S.h / 2) / k;
  invalidate();
}

function flyToTable(t, k) {
  const kk = k || Math.max(S.cam.k, 0.85);
  // sağdaki panel ve soldaki tablo listesi arasında kalan alanın ortasına
  const offset = (!$('#panel').hidden && S.w > 820 ? 190 : 0) - (!$('#tableList').hidden && S.w > 980 ? 150 : 0);
  flyTo({ x: t.x + offset / kk, y: t.y, k: kk });
}

Object.assign(NS, {
  S, $, canvas, C, CARD, PALETTE, DASH, schemaLabel, groupLabel,
  levelOf, wx, wy, starR, cardRows, keyTag, schemaColor, relStyle, relVisible, clamp,
  drawGlyph, refreshEmphasis, invalidate, draw, resetHud,
  resize, fitView, flyTo, zoomAt, flyToTable,
});
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
