/*
 * sqlSchema · diff.js
 * İki modelin farkı ("önce" → "sonra"): tablolar, kolonlar, birincil anahtar ve tanımlı ilişkiler (FK, @ref).
 * Adı değişen tablo ve kolonlar tahmin edilir (kolon kümesi ve ad benzerliği); rapor bunu tahmin olarak yazar.
 * Metin değil kod döndürür; çeviri arayüzde yapılır.
 *
 *   diffModels(before, after) → {
 *     tables: [{ status, before, after, renamed, cols, pk, fks }]   status: added | removed | changed | same
 *       renamed: tablo adı değişti (tahmin); changed ile birlikte olabilir
 *       cols:  [{ status: added | removed | changed | renamed, name, from, before, after, changes: ['type', 'null', 'pk'] }]
 *       pk:    { before: [...], after: [...] } ya da null
 *       fks:   [{ status: added | removed, rel }]
 *     byAfter, byBefore: tablo → kayıt · summary: { added, removed, changed, renamed, same }
 *   }
 */
(function (NS) {
'use strict';

const U = s => String(s == null ? '' : s).toUpperCase();
const norm = s => U(s).replace(/[^\p{L}\p{N}]/gu, '');
const normType = s => U(s).replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();

// Ad benzerliği 0..1: biri öbürünü içeriyorsa yüksek, yoksa ortak önek oranı (weight → weight_grams, sender_id → sender_customer_id)
function nameSim(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.6 + 0.3 * Math.min(x.length, y.length) / Math.max(x.length, y.length);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  return p / Math.max(x.length, y.length);
}

// Kaldırılan ve eklenen öğelerden en iyi eşleşen çiftler (açgözlü; skor eşiğin altındaysa eşleşmez)
function pairUp(removed, added, score, min) {
  const cands = [];
  for (const r of removed) for (const a of added) { const s = score(r, a); if (s >= min) cands.push([s, r, a]); }
  cands.sort((p, q) => q[0] - p[0]);
  const usedR = new Set(), usedA = new Set(), pairs = [];
  for (const [, r, a] of cands) {
    if (usedR.has(r) || usedA.has(a)) continue;
    usedR.add(r); usedA.add(a);
    pairs.push([r, a]);
  }
  return pairs;
}

function diffColumns(tb, ta) {
  const bc = new Map(tb.columns.map(c => [U(c.name), c]));
  const ac = new Map(ta.columns.map(c => [U(c.name), c]));
  const out = [];
  const removed = tb.columns.filter(c => !ac.has(U(c.name)));
  const added = ta.columns.filter(c => !bc.has(U(c.name)));
  // adı değişen kolon: aynı tip ailesi ve benzer ad; tek aday kaldıysa ad benzemese de aynı tip yeterli
  const fam = c => NS.typeFamily(c.type);
  const pairs = pairUp(removed, added, (r, a) => {
    const sameFam = fam(r) && fam(r) === fam(a);
    const sim = nameSim(r.name, a.name);
    if (!sameFam && sim < 0.6) return 0;
    if (removed.length === 1 && added.length === 1 && sameFam) return 1 + sim;
    return sim >= 0.4 ? sim + (sameFam ? 0.5 : 0) + (normType(r.type) === normType(a.type) ? 0.3 : 0) : 0;
  }, 0.4);
  // ikinci tur: eşleşmeden tek bir kaldırılan ve tek bir eklenen kolon kaldıysa ve tipleri birebir aynıysa,
  // ad benzemese de yeniden adlandırmadır (sender_id → sender_customer_id)
  const leftR = removed.filter(r => !pairs.some(p => p[0] === r)), leftA = added.filter(a => !pairs.some(p => p[1] === a));
  if (leftR.length === 1 && leftA.length === 1 && normType(leftR[0].type) === normType(leftA[0].type)) pairs.push([leftR[0], leftA[0]]);
  const renamedFrom = new Map(pairs.map(([r, a]) => [a, r]));
  const renamedTo = new Set(pairs.map(([r]) => r));
  const changes = (b, a) => {
    const ch = [];
    if (normType(b.type) !== normType(a.type)) ch.push('type');
    if (!!b.nullable !== !!a.nullable) ch.push('null');
    if (!!b.pk !== !!a.pk) ch.push('pk');
    return ch;
  };
  for (const a of ta.columns) {
    const b = bc.get(U(a.name)) || renamedFrom.get(a);
    if (!b) { out.push({ status: 'added', name: a.name, after: a, changes: [] }); continue; }
    const ch = changes(b, a);
    if (renamedFrom.has(a)) out.push({ status: 'renamed', name: a.name, from: b.name, before: b, after: a, changes: ch });
    else if (ch.length) out.push({ status: 'changed', name: a.name, before: b, after: a, changes: ch });
  }
  for (const b of removed) if (!renamedTo.has(b)) out.push({ status: 'removed', name: b.name, before: b, changes: [] });
  return { cols: out, colMap: new Map(pairs.map(([r, a]) => [U(r.name), U(a.name)])) };
}

function diffModels(before, after) {
  const real = m => m.tables.filter(t => !t.external);
  const B = real(before), A = real(after);
  const aByKey = new Map(A.map(t => [t.key, t]));
  const bByKey = new Map(B.map(t => [t.key, t]));
  const removed = B.filter(t => !aByKey.has(t.key));
  const added = A.filter(t => !bByKey.has(t.key));

  // adı değişen tablo: kolon kümeleri büyük ölçüde aynı (Jaccard), aynı veritabanı; şema ve ad benzerliği öne geçirir
  const colSet = t => new Set(t.columns.map(c => U(c.name)));
  const pairs = pairUp(removed, added, (r, a) => {
    if (r.db !== a.db) return 0;
    const x = colSet(r), y = colSet(a);
    let inter = 0;
    for (const c of x) if (y.has(c)) inter++;
    const jac = inter / (x.size + y.size - inter || 1);
    if (jac < 0.5) return 0;
    return jac + 0.3 * nameSim(r.name, a.name) + (U(r.schema) === U(a.schema) ? 0.1 : 0);
  }, 0.5);
  const renamedTo = new Map(pairs.map(([r, a]) => [r, a]));
  const renamedFrom = new Map(pairs.map(([r, a]) => [a, r]));

  // FK imzası: kolonlar → hedef tablo (adı değiştiyse yeni adıyla) ve hedef kolonlar
  const afterKeyOf = t => (renamedTo.get(t) || t).key;
  const sig = (r, colMap, side) => {
    const cols = r.cols.map(c => (colMap && colMap.get(U(c))) || U(c)).join(',');
    const parent = side === 'before' ? afterKeyOf(r.parent) : r.parent.key;
    return cols + '>' + parent + '(' + r.refCols.map(U).join(',') + ')';
  };
  const declared = t => t.out.filter(r => r.kind === 'fk' || r.kind === 'ref');

  const tables = [];
  for (const t of A) {
    const b = bByKey.get(t.key) || renamedFrom.get(t);
    if (!b) { tables.push({ status: 'added', after: t, renamed: false, cols: [], pk: null, fks: declared(t).map(rel => ({ status: 'added', rel })) }); continue; }
    const { cols, colMap } = diffColumns(b, t);
    const pkB = b.pk.map(c => colMap.get(U(c)) || U(c)).join(','), pkA = t.pk.map(U).join(',');
    const pk = pkB !== pkA ? { before: b.pk.slice(), after: t.pk.slice() } : null;
    const bs = new Map(declared(b).map(r => [sig(r, colMap, 'before'), r]));
    const as = new Map(declared(t).map(r => [sig(r, null, 'after'), r]));
    const fks = [];
    for (const [k, rel] of as) if (!bs.has(k)) fks.push({ status: 'added', rel });
    for (const [k, rel] of bs) if (!as.has(k)) fks.push({ status: 'removed', rel });
    const renamed = renamedFrom.has(t);
    const changed = cols.length > 0 || !!pk || fks.length > 0;
    tables.push({ status: changed ? 'changed' : renamed ? 'changed' : 'same', before: b, after: t, renamed, cols, pk, fks });
  }
  for (const t of removed) if (!renamedTo.has(t)) tables.push({ status: 'removed', before: t, renamed: false, cols: [], pk: null, fks: [] });

  const summary = { added: 0, removed: 0, changed: 0, renamed: 0, same: 0 };
  for (const e of tables) { summary[e.status]++; if (e.renamed) summary.renamed++; }
  return {
    tables,
    byAfter: new Map(tables.filter(e => e.after).map(e => [e.after, e])),
    byBefore: new Map(tables.filter(e => e.before).map(e => [e.before, e])),
    summary,
  };
}

Object.assign(NS, { diffModels });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
