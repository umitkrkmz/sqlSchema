/*
 * sqlSchema · layout.js
 * Dört kat: tablolar takımyıldız içinde, takımyıldızlar şema içinde, şemalar veritabanı (galaksi)
 * içinde, veritabanları gökyüzünde. Her kat aynı kuvvet gevşetmesini (relax) kullanır; düğümlerin
 * yarıçapı vardır, böylece alt katın daireleri üst katta çarpışma kutusu olarak davranır.
 * Rastgelelik yok: başlangıç altın açı sarmalı, aynı dosya her zaman aynı haritayı verir.
 */
(function (NS) {
'use strict';

const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω'];

const L = {
  // Tablo çarpışma yarıçapı. Merkezler arası en az 210 birim: 164×127'lik iki kart
  // hangi açıyla yan yana gelirse gelsin üst üste binmez (bkz. render.js CARD).
  nodeR: 105,
  groupSmall: 40,   // bu sayıdan küçük şemalar tek takımyıldızdır
  groupMax: 70,     // bir takımyıldızdaki en fazla tablo
  groupPad: 110,
  schemaPad: 240,
  dbPad: 700,
  // kat başına kuvvet ayarları (bkz. relax)
  tableForce: { iters: 300, step: 60, repel: 0.012, spring: 0.08, link: 70, gravity: 0.035, pad: 0 },
  groupForce: { iters: 260, repel: 0.01, spring: 0.04, gravity: 0.04 },
  schemaForce: { iters: 260, repel: 0.01, spring: 0.03, gravity: 0.04 },
};

function relax(n, rad, links, o) {
  const x = new Float64Array(n), y = new Float64Array(n);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = o.spread * Math.sqrt(i);
    x[i] = Math.cos(i * ga) * r;
    y[i] = Math.sin(i * ga) * r;
  }
  if (n < 2) return { x, y };
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const iters = o.iters;
  for (let it = 0; it < iters; it++) {
    const temp = o.step * (1 - it / iters) + o.step * 0.04;
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[i] - x[j], dy = y[i] - y[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) { dx = 0.01 * (j - i); dy = 0.017; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        const min = rad[i] + rad[j] + o.pad;
        let f = o.repel * min * min / d2;
        if (d < min) f += (min - d) / d * 0.6;
        fx[i] += dx * f; fy[i] += dy * f;
        fx[j] -= dx * f; fy[j] -= dy * f;
      }
    }
    for (const [a, b, w] of links) {
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const target = rad[a] + rad[b] + o.link;
      const f = o.spring * Math.min(w, 4) * (d - target) / d;
      fx[a] += dx * f; fy[a] += dy * f;
      fx[b] -= dx * f; fy[b] -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      fx[i] -= x[i] * o.gravity;
      fy[i] -= y[i] * o.gravity;
      const m = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
      const s = m > temp ? temp / m : 1;
      x[i] += fx[i] * s;
      y[i] += fy[i] * s;
    }
  }
  resolveCollisions(x, y, rad, o.pad * 0.6);
  return { x, y };
}

// Yalnızca çakışma giderme: üst üste binen daireleri eşit miktarda iter
function resolveCollisions(x, y, rad, pad, iters = 300) {
  const n = x.length;
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[i] - x[j], dy = y[i] - y[j];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const min = rad[i] + rad[j] + pad;
        if (d < min) {
          const push = (min - d) / 2 / d;
          x[i] += dx * push; y[i] += dy * push;
          x[j] -= dx * push; y[j] -= dy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/*
 * Uydular (MongoDB gömülü belgeleri) kuvvet yerleşimine girmez: sahibi yerleştikten sonra,
 * sahibin takımyıldız merkezinden dışa bakan tarafında bir yay üzerine dizilir. İç içe uydular
 * aynı kuralla kendi sahiplerinin çevresine gelir.
 */
function placeSatellites(ts, rels, main) {
  const children = new Map();
  for (const r of rels) {
    if (r.kind !== 'embed') continue;
    if (!children.has(r.parent)) children.set(r.parent, []);
    children.get(r.parent).push(r.child);
  }
  const placed = new Set(main);
  const R = L.nodeR * 2 + 10;
  const queue = [...main];
  while (queue.length) {
    const owner = queue.shift();
    const kids = (children.get(owner) || []).filter(k => ts.includes(k) && !placed.has(k));
    if (!kids.length) continue;
    const base = owner.lx || owner.ly ? Math.atan2(owner.ly, owner.lx) : -Math.PI / 2;
    const spread = Math.min(Math.PI * 1.6, 0.75 * kids.length);
    kids.forEach((k, i) => {
      const a = base + (kids.length === 1 ? 0 : -spread / 2 + spread * i / (kids.length - 1));
      k.lx = owner.lx + Math.cos(a) * R;
      k.ly = owner.ly + Math.sin(a) * R;
      placed.add(k);
      queue.push(k);
    });
  }
  // sahibi bu takımyıldızda olmayan uydular: merkeze yakın sarmal
  ts.filter(t => !placed.has(t)).forEach((t, i) => { t.lx = Math.cos(i) * R; t.ly = Math.sin(i) * R; });
}

// Konumları merkeze alır, kapsayan yarıçapı döndürür
function center(items, getR) {
  if (!items.length) return 0;
  let cx = 0, cy = 0;
  for (const it of items) { cx += it.lx; cy += it.ly; }
  cx /= items.length; cy /= items.length;
  let r = 0;
  for (const it of items) {
    it.lx -= cx; it.ly -= cy;
    r = Math.max(r, Math.hypot(it.lx, it.ly) + getR(it));
  }
  return r;
}

function prefixOf(name) {
  const p = String(name).toUpperCase().split(/[_.]/);
  return p.length > 1 && p[0].length >= 2 ? p[0] : null;
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[_\s])([a-z\xE0-\u{24F}])/gu, (m, a, b) => (a ? ' ' : '') + b.toUpperCase()).trim();
}

function toRoman(n) {
  const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}

function makeGroups(schema, rels) {
  const list = schema.tables;
  if (list.length <= L.groupSmall) return [{ name: schema.label, tables: list.slice() }];
  const inSchema = new Set(list);
  const nbrs = new Map(list.map(t => [t, []]));
  for (const r of rels) {
    if (r.self || !inSchema.has(r.child) || !inSchema.has(r.parent)) continue;
    nbrs.get(r.child).push(r.parent);
    nbrs.get(r.parent).push(r.child);
  }
  const assigned = new Map();
  const groups = [];
  const byPrefix = new Map();
  for (const t of list) {
    if (t.embedded) continue;
    const p = prefixOf(t.name);
    if (!p) continue;
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(t);
  }
  const named = new Map();
  for (const [p, ts] of byPrefix) {
    if (ts.length < 3) continue;
    const g = { name: p, tables: [] };
    groups.push(g);
    named.set(p, g);
    ts.forEach(t => assigned.set(t, g));
  }
  for (const t of list) {
    const g = named.get(String(t.name).toUpperCase());
    if (g && !assigned.has(t)) assigned.set(t, g);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const t of list) {
      if (assigned.has(t)) continue;
      const votes = new Map();
      for (const o of nbrs.get(t)) { const g = assigned.get(o); if (g) votes.set(g, (votes.get(g) || 0) + 1); }
      let best = null, bv = 0;
      for (const [g, v] of votes) if (v > bv) { best = g; bv = v; }
      if (best) assigned.set(t, best);
    }
  }
  // kalanlar: bağlı bileşenler
  const loose = [];
  const seen = new Set();
  for (const t of list) {
    if (assigned.has(t) || seen.has(t)) continue;
    const comp = [];
    const stack = [t];
    seen.add(t);
    while (stack.length) {
      const a = stack.pop();
      comp.push(a);
      for (const b of nbrs.get(a)) if (!assigned.has(b) && !seen.has(b)) { seen.add(b); stack.push(b); }
    }
    if (comp.length >= 3) {
      comp.sort((a, b) => b.deg - a.deg);
      const g = { name: String(comp[0].name).toUpperCase(), tables: [] };
      groups.push(g);
      comp.forEach(x => assigned.set(x, g));
    } else loose.push(...comp);
  }
  if (loose.length) {
    const g = { name: 'BAĞIMSIZ', tables: [], loose: true };
    groups.push(g);
    loose.forEach(x => assigned.set(x, g));
  }
  // uydular (gömülü belgeler) sahibinin takımyıldızında kalır
  for (const t of list) {
    let o = t;
    while (o.embedded && o.owner && inSchema.has(o.owner)) o = o.owner;
    if (o !== t && assigned.has(o)) assigned.set(t, assigned.get(o));
  }
  for (const t of list) assigned.get(t).tables.push(t);

  // büyük takımyıldızları BFS sırasıyla böl
  const out = [];
  for (const g of groups) {
    if (!g.tables.length) continue;
    if (g.tables.length <= L.groupMax) { out.push(g); continue; }
    const inG = new Set(g.tables);
    const order = [];
    const vis = new Set();
    const sorted = g.tables.slice().sort((a, b) => b.deg - a.deg);
    for (const s of sorted) {
      if (vis.has(s)) continue;
      const q = [s];
      vis.add(s);
      while (q.length) {
        const a = q.shift();
        order.push(a);
        for (const b of nbrs.get(a)) if (inG.has(b) && !vis.has(b)) { vis.add(b); q.push(b); }
      }
    }
    const parts = Math.ceil(order.length / L.groupMax);
    const size = Math.ceil(order.length / parts);
    for (let k = 0; k < parts; k++) out.push({ name: g.name + ' ' + toRoman(k + 1), tables: order.slice(k * size, (k + 1) * size), loose: g.loose });
  }
  return out;
}

// Daireleri (gruplar, şemalar, veritabanları) birbirine bağlantı sayısıyla çeken kat
function packCircles(items, rels, keyOf, force, pad) {
  if (!items.length) return 0;
  const idx = new Map(items.map((it, i) => [it, i]));
  const lk = new Map();
  for (const r of rels) {
    const a = idx.get(keyOf(r.child)), b = idx.get(keyOf(r.parent));
    if (a === undefined || b === undefined || a === b) continue;
    const k = a < b ? a + ',' + b : b + ',' + a;
    lk.set(k, (lk.get(k) || 0) + 1);
  }
  const links = [...lk.entries()].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, 1 + Math.log2(w)]; });
  const rad = Float64Array.from(items, it => it.r);
  const avg = rad.reduce((a, b) => a + b, 0) / rad.length;
  const p = relax(items.length, rad, links, { ...force, spread: avg * 1.5, step: avg * 0.5, link: pad, pad });
  items.forEach((it, i) => { it.lx = p.x[i]; it.ly = p.y[i]; });
  return center(items, it => it.r);
}

function layoutModel(model) {
  const rels = model.rels;
  const byDb = new Map();
  for (const t of model.tables) {
    if (!byDb.has(t.db)) byDb.set(t.db, new Map());
    const m = byDb.get(t.db);
    const s = t.schema || '';
    if (!m.has(s)) m.set(s, []);
    m.get(s).push(t);
  }
  const dbs = [];
  const schemas = [];
  const groups = [];
  for (const [name, bySchema] of byDb) {
    const db = { name, label: name, schemas: [], dialects: new Set() };
    dbs.push(db);
    for (const [sname, tables] of bySchema) {
      // label boşsa (şemasız tablolar) arayüz kendi dilinde "varsayılan / default" yazar
      const s = { name: sname, label: sname, tables, db };
      tables.forEach(t => { t.schemaRef = s; if (t.dialect) db.dialects.add(t.dialect); });
      db.schemas.push(s);
    }
    db.schemas.sort((a, b) => b.tables.length - a.tables.length);
    schemas.push(...db.schemas);
  }
  dbs.sort((a, b) => b.schemas.reduce((n, s) => n + s.tables.length, 0) - a.schemas.reduce((n, s) => n + s.tables.length, 0));
  schemas.sort((a, b) => dbs.indexOf(a.db) - dbs.indexOf(b.db));
  schemas.forEach((s, i) => { s.index = i; });

  for (const s of schemas) {
    s.groups = makeGroups(s, rels);
    for (const g of s.groups) {
      g.schema = s;
      g.label = g.loose ? '' : titleCase(g.name);
      g.index = groups.length;
      groups.push(g);
      g.tables.forEach(t => { t.group = g; });
    }
  }

  // 1) tablolar
  for (const g of groups) {
    const ts = g.tables.slice().sort((a, b) => (a.embedded - b.embedded) || b.deg - a.deg || String(a.name).localeCompare(String(b.name)));
    g.tables = ts;
    const main = ts.filter(t => !t.embedded);
    const idx = new Map(main.map((t, i) => [t, i]));
    const lk = new Map();
    for (const r of rels) {
      if (r.self) continue;
      // uydular üzerinden geçen ilişkiler sahibine aktarılır
      let a = r.child, b = r.parent;
      while (a.embedded && a.owner) a = a.owner;
      while (b.embedded && b.owner) b = b.owner;
      const ia = idx.get(a), ib = idx.get(b);
      if (ia === undefined || ib === undefined || ia === ib) continue;
      const k = ia < ib ? ia + ',' + ib : ib + ',' + ia;
      lk.set(k, (lk.get(k) || 0) + (r.kind === 'fk' ? 1 : 0.6));
    }
    const links = [...lk.entries()].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, w]; });
    const p = relax(main.length, new Float64Array(main.length).fill(L.nodeR), links, { ...L.tableForce, spread: L.nodeR * 1.4 });
    main.forEach((t, i) => {
      t.lx = p.x[i]; t.ly = p.y[i];
      t.desig = i < GREEK.length ? GREEK[i] : String(i + 1);
    });
    if (main.length < ts.length) {
      placeSatellites(ts, rels, main);
      const x = Float64Array.from(ts, t => t.lx), y = Float64Array.from(ts, t => t.ly);
      resolveCollisions(x, y, new Float64Array(ts.length).fill(L.nodeR), 0);
      ts.forEach((t, i) => { t.lx = x[i]; t.ly = y[i]; });
    }
    g.r = center(ts, () => L.nodeR) + 20;
  }

  // 2) takımyıldızlar, 3) şemalar, 4) veritabanları
  for (const s of schemas) {
    s.groups.sort((a, b) => b.tables.length - a.tables.length);
    s.r = packCircles(s.groups, rels, t => t.group, L.groupForce, L.groupPad) + 60;
  }
  for (const db of dbs) db.r = packCircles(db.schemas, rels, t => t.schemaRef, L.schemaForce, L.schemaPad) + (dbs.length > 1 ? 160 : 0);
  packCircles(dbs, [], t => t, L.schemaForce, L.dbPad);

  for (const db of dbs) {
    db.x = db.lx; db.y = db.ly;
    for (const s of db.schemas) {
      s.x = db.x + s.lx;
      s.y = db.y + s.ly;
      for (const g of s.groups) {
        g.x = s.x + g.lx;
        g.y = s.y + g.ly;
        for (const t of g.tables) { t.x = g.x + t.lx; t.y = g.y + t.ly; }
      }
    }
  }

  // Tek veritabanında galaksi dairesi çizilmez; sınırlar şemalardan alınır (saran daire gereksiz boşluk bırakır)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of dbs.length > 1 ? dbs : schemas) {
    minX = Math.min(minX, c.x - c.r); maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r); maxY = Math.max(maxY, c.y + c.r);
  }
  return { dbs, schemas, groups, bounds: { minX, minY, maxX, maxY } };
}

Object.assign(NS, { L, layoutModel });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
