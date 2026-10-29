#!/usr/bin/env node
/*
 * sqlSchema testleri: bağımlılık yok, Node 18+.   node tests/run.js
 * Uygulamanın ayrıştırıcı, model ve yerleşim modüllerini tarayıcıdaki sırayla yükler,
 * samples/ altındaki bütün örnekleri okur ve her biri için beklenen sonuçları denetler.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['i18n', 'lexer', 'sql-parser', 'mongo', 'files', 'model', 'diff', 'layout', 'conventions', 'audit', 'fixes', 'sample-small']) require(path.join(ROOT, 'js', f + '.js'));
require(path.join(ROOT, 'samples', 'catalog.js'));
const NS = globalThis.sqlSchema;

let failed = 0, passed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log(`  ✗ ${label}${detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`);
}

function decode(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  return buf.toString('utf8');
}

// Uygulamanın yaptığı gibi: sırala, ayrıştır, (isteğe bağlı) ayrı veritabanları, model, yerleşim.
// grouping verilmezse arayüzün 'auto' seçimi: migration'da ada göre, değilse dosyaya göre
function build(files, separate, grouping) {
  const { files: ordered, skipped, migration } = NS.orderFiles(files);
  const names = NS.databaseNames(ordered.map(f => f.path));
  const inputs = [];
  for (const f of ordered) {
    const r = NS.parseFile(f.path, f.text);
    if (r) inputs.push({ ...r, db: separate ? names.get(f.path) : 'main' });
  }
  NS.harmonizeDialects(inputs);
  const model = NS.buildModel(inputs);
  const lay = NS.layoutModel(model, { grouping: NS.resolveGrouping(grouping, migration) });
  return { model, lay, skipped, migration, order: ordered.map(f => f.path) };
}

function loadSample(s) {
  if (s.embedded) return build([{ path: 'ornek.sql', text: NS.SAMPLE_SQL }]);
  const files = s.files.map(p => ({ path: s.id + '/' + p, text: decode(fs.readFileSync(path.join(ROOT, 'samples', s.id, p))) }));
  return build(files, s.separate);
}

const find = (m, name) => m.tables.find(t => t.name === name);
// Adlandırma profilinde bir boyutun kova sayıları: { id: 11, tableId: 9 } (sıfırlar atlanır)
const dim = (p, id) => Object.fromEntries(p.dims.find(d => d.id === id).buckets.filter(b => b.n).map(b => [b.key, b.n]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rel = (m, child, col, parent, kind) => m.rels.find(r => r.child.name === child && r.cols.includes(col) && (!parent || r.parent.name === parent) && (!kind || r.kind === kind));
const cols = t => t.columns.map(c => c.name);

// Bütün örnekler için ortak denetimler
function common(s, res) {
  const st = res.model.stats;
  check(`${s.id}: ayrıştırma hatası yok`, st.errors.length === 0, st.errors.slice(0, 3));
  check(`${s.id}: tablosu bulunamayan ifade yok`, st.orphans.length === 0, st.orphans.slice(0, 3));
  check(`${s.id}: en az bir tablo`, st.tables > 0);
  // kartlar üst üste binmemeli (render.js CARD: 164 x en fazla 127)
  const H = t => 22 + Math.max(1, Math.min(t.columns.length, 8)) * 11 + (t.columns.length > 8 ? 11 : 0) + 6;
  const ts = res.model.tables;
  let overlaps = 0;
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    if (Math.abs(ts[i].x - ts[j].x) < 164 && Math.abs(ts[i].y - ts[j].y) < (H(ts[i]) + H(ts[j])) / 2) overlaps++;
  }
  check(`${s.id}: kart çakışması yok`, overlaps === 0, overlaps);
}

const EXPECT = {
  kucuk({ model: m }) {
    check('kucuk: 19 tablo', m.stats.tables === 19, m.stats.tables);
    check('kucuk: dış tablo SEC.APP_USER', find(m, 'APP_USER') && find(m, 'APP_USER').external);
    check('kucuk: devre dışı FK', rel(m, 'INVOICE_LINE', 'SUBSCRIPTION_ID', 'SUBSCRIPTION').disabled);
    check('kucuk: 1:1 profil', rel(m, 'CUSTOMER_PROFILE', 'CUSTOMER_ID', 'CUSTOMER').childEnd === 'zeroOne');
    check('kucuk: CDR tahmini ilişki', rel(m, 'VOICE_CDR', 'SUBSCRIPTION_ID', 'SUBSCRIPTION', 'implicit'));
    // etki analizi: CUSTOMER silinince CUSTOMER_PROFILE CASCADE ile gider, diğer FK'ler silmeyi engeller
    const imp = NS.impactOf(find(m, 'CUSTOMER'));
    const d1 = Object.fromEntries(imp.levels[0].map(x => [x.t.name, x.action]));
    check('kucuk: etki 1. derece ve silme eylemleri', d1.CUSTOMER_PROFILE === 'cascade' && d1.SUBSCRIPTION === 'restrict' && imp.levels[0].length === 5, d1);
    check('kucuk: CASCADE zinciri', imp.cascade.map(x => x.t.name).join() === 'CUSTOMER_PROFILE', imp.cascade.map(x => x.t.name));
    check('kucuk: tahmini ilişki denetlenmez sayılır', imp.levels[1].some(x => x.t.name === 'VOICE_CDR' && x.action === 'unenforced'));
    const noImp = NS.impactOf(find(m, 'CUSTOMER'), { accept: r => r.kind !== 'implicit' });
    check('kucuk: tahmini ilişkiler kapalıyken etki daralır', noImp.total < imp.total && !noImp.levels.flat().some(x => x.t.name === 'VOICE_CDR'), [noImp.total, imp.total]);
    const colImp = NS.impactOf(find(m, 'SUBSCRIPTION'), { col: 'NOPE' });
    check('kucuk: kolon düzeyi etki yalnızca o kolona bağlananlar', colImp.total === 0, colImp.total);
  },
  telekom({ model: m }) {
    check('telekom: 300+ tablo', m.stats.tables >= 300, m.stats.tables);
    check('telekom: 350+ FK', m.stats.fk >= 350, m.stats.fk);
    check('telekom: PL/SQL paketi atlandı', m.stats.skipped.some(([k]) => k === 'CREATE PACKAGE'));
    check('telekom: CRM takımyıldızlara bölündü', m.tables.find(t => t.schema === 'CRM').schemaRef.groups.length > 1);
    // alt diyagram aynı tablo nesneleriyle ayrı yerleşim kurar; tam yerleşim yeniden kurulunca konumlar birebir döner
    const pos = m.tables.map(t => t.x + ',' + t.y).join(';');
    const keep = new Set(m.tables.filter(t => t.schema === 'BILLING'));
    NS.layoutModel({ ...m, tables: m.tables.filter(t => keep.has(t)), rels: m.rels.filter(r => keep.has(r.child) && keep.has(r.parent)) });
    NS.layoutModel(m, { grouping: 'file' });
    check('telekom: alt diyagramdan dönünce yerleşim aynı', m.tables.map(t => t.x + ',' + t.y).join(';') === pos);
    const fk = dim(NS.namingProfile(m), 'fkStyle');
    check('telekom: AGENT_USER_ID → APP_USER rol önekli sayılır, hedef adını içermeyen FK yok', !fk.other && fk.role >= 50 && fk.audit === 2, fk);
  },
  'telekom-bolunmus'({ model: m }, all) {
    const one = all.telekom.model.stats;
    check('telekom-bolunmus: tek dosyalı hâliyle aynı tablo sayısı', m.stats.tables === one.tables, [m.stats.tables, one.tables]);
    check('telekom-bolunmus: aynı FK sayısı', m.stats.fk === one.fk, [m.stats.fk, one.fk]);
    check('telekom-bolunmus: aynı tahmini ilişki sayısı', m.stats.implicit === one.implicit, [m.stats.implicit, one.implicit]);
  },
  banka({ model: m }) {
    check('banka: SQL Server tanındı', m.stats.dialects.includes('tsql'), m.stats.dialects);
    check('banka: 80+ FK', m.stats.fk >= 80, m.stats.fk);
    check('banka: açıklamalar okundu', m.stats.comments > 10, m.stats.comments);
    check('banka: Person 1:1 Customer', rel(m, 'Person', 'CustomerId', 'Customer').childEnd === 'zeroOne');
    check('banka: AML alarmı → işlem (tahmini)', rel(m, 'Alert', 'TransactionId', 'Transaction', 'implicit'));
    check('banka: ara tablo RolePermission', find(m, 'RolePermission').junction);
    const g = find(m, 'Person').colIdx.get('GENDER');
    check('banka: SSMS CHECK ([x]=\'F\' OR ...) değer listesi', g.valuesSrc === 'check' && g.values.map(v => v.code).join() === 'F,M,U', g.values);
    check('banka: görünüm ve yordam atlandı', m.stats.skipped.some(([k]) => k === 'CREATE VIEW') && m.stats.skipped.some(([k]) => k === 'CREATE PROCEDURE'));
    const p = NS.namingProfile(m);
    check('banka: adlandırma tek stil (PascalCase, <Tablo>Id)', p.dims.find(d => d.id === 'tableCase').share === 1 && p.dims.find(d => d.id === 'pkStyle').dominant === 'tableId', p.dims.map(d => d.dominant));
    check('banka: 1:1 alt tabloların PK\'si sapma sayılmaz', dim(p, 'pkStyle').shared === 6 && !dim(p, 'pkStyle').other, dim(p, 'pkStyle'));
  },
  sigorta({ model: m, lay }, all, s) {
    check('sigorta: hiç FK yok', m.stats.fk === 0, m.stats.fk);
    check('sigorta: 50+ tahmini ilişki', m.stats.implicit >= 50, m.stats.implicit);
    check('sigorta: hasar dosyası → poliçe', rel(m, 'HASAR_DOSYA', 'POLICE_NO', 'POLICE', 'implicit'));
    check('sigorta: poliçe aracı 1:1 poliçe', (rel(m, 'POLICE_ARAC', 'POLICE_NO', 'POLICE') || {}).childEnd === 'zeroOne');
    check('sigorta: tek şema', new Set(m.tables.map(t => t.schema)).size === 1);
    const pImp = NS.impactOf(find(m, 'POLICE'));
    check('sigorta: POLICE\'e en az 15 tablo bağlı, hepsi denetlenmez (FK yok)', pImp.total >= 15 && pImp.levels.flat().every(x => x.action === 'unenforced') && !pImp.cascade.length, [pImp.total]);
    const pd = rel(m, 'POLICE', 'POLICE_DURUM', 'KOD_TABLO', 'ref');
    check('sigorta: @ref ile sözlük tablosuna koşullu ilişki', pd && pd.refCols[0] === 'KOD' && pd.filter === "KOD_TIP = 'POLICE_DURUM'", pd && [pd.refCols, pd.filter]);
    check('sigorta: 4 @ref ilişkisi, uyarı yok', m.stats.refs === 4 && !m.stats.warnings.length, [m.stats.refs, m.stats.warnings]);
    check('sigorta: @ref PK\'ye (MUSTERI)', rel(m, 'HASAR_IHBAR', 'IHBAR_EDEN_MUSTERI_NO', 'MUSTERI', 'ref'));
    const vals = (t, c) => (find(m, t).colIdx.get(c).values || []).map(v => v.code + '=' + v.label).join(', ');
    check('sigorta: açıklamadaki değer listeleri', vals('MUSTERI', 'MUSTERI_TIP') === 'G=Gerçek kişi, T=Tüzel kişi' && vals('MUSTERI', 'CINSIYET') === 'E=Erkek, K=Kadın, B=Belirtilmemiş' && vals('MUSTERI', 'KARA_LISTE') === 'E=Evet, H=Hayır', [vals('MUSTERI', 'MUSTERI_TIP'), vals('MUSTERI', 'CINSIYET'), vals('MUSTERI', 'KARA_LISTE')]);
    const kanal = find(m, 'HASAR_IHBAR').colIdx.get('IHBAR_KANAL');
    check('sigorta: listenin önündeki metin ayrı tutulur', kanal.values.length === 4 && kanal.valuesNote === 'İhbarın geldiği kanal', [kanal.values.length, kanal.valuesNote]);
    const mt = find(m, 'MUSTERI').colIdx.get('MUSTERI_TIP');
    check('sigorta: CHECK değerleri açıklamadaki anlamlarla birleşir', mt.valuesSrc === 'check' && vals('MUSTERI', 'MUSTERI_TIP') === 'G=Gerçek kişi, T=Tüzel kişi', [mt.valuesSrc, vals('MUSTERI', 'MUSTERI_TIP')]);
    check('sigorta: anlamı yazılmamış CHECK değerleri', vals('POLICE_ARAC', 'KULLANIM_TARZ') === 'HUSUSI=null, TICARI=null, TAKSI=null, RESMI=null', vals('POLICE_ARAC', 'KULLANIM_TARZ'));
    const pdv = find(m, 'POLICE').colIdx.get('POLICE_DURUM');
    check('sigorta: veri dosyası tablodan önce gelse de sözlük değerleri okunur', pdv.valuesSrc === 'dict' && vals('POLICE', 'POLICE_DURUM') === 'A=Aktif, I=İptal, Y=Yenilendi', [pdv.valuesSrc, vals('POLICE', 'POLICE_DURUM')]);
    check('sigorta: verisi olmayan koşul boş kalır', !find(m, 'TEKLIF').colIdx.get('DURUM_KOD').values);
    check('sigorta: veri dosyası tablonun dosyalarına sayılmaz', !find(m, 'KOD_TABLO').files.some(f => /verisi/.test(f)), find(m, 'KOD_TABLO').files);
    check('sigorta: @ref açıklaması değer listesi sayılmaz', !find(m, 'POLICE').colIdx.get('POLICE_DURUM').values || find(m, 'POLICE').colIdx.get('POLICE_DURUM').valuesSrc !== 'comment');
    check('sigorta: KOD_TABLO sözlük, MUSTERI değil', find(m, 'KOD_TABLO').dictionary && !find(m, 'MUSTERI').dictionary && m.stats.dictionaries === 1);
    check('sigorta: sözlüğe giden ilişkiler işaretli', m.rels.filter(r => r.dict).length === 3 && !rel(m, 'HASAR_IHBAR', 'IHBAR_EDEN_MUSTERI_NO', 'MUSTERI', 'ref').dict);
    const labels = lay.schemas[0].groups.map(g => g.label).sort();
    check('sigorta: modül klasörü başına bir takımyıldız', same(labels, ['ACENTE/tablolar', 'HASAR/tablolar', 'ORTAK/tablolar', 'POLICE/tablolar', 'REASURANS/tablolar', 'TAHSILAT/tablolar', 'URUN/tablolar']), labels);
    check('sigorta: her tablo kendi dosyasının takımyıldızında', m.tables.every(t => t.group.file === t.src.file));
    const byName = build(s.files.map(p => ({ path: 'sigorta/' + p, text: fs.readFileSync(path.join(ROOT, 'samples', 'sigorta', p), 'utf8') })), false, 'name').lay;
    check('sigorta: ada göre gruplama seçilince dosya takımyıldızı yok', !byName.groups.some(g => g.file), byName.groups.map(g => g.label));
  },
  eticaret({ model: m }) {
    check('eticaret: MySQL tanındı', m.stats.dialects.includes('mysql'), m.stats.dialects);
    check('eticaret: 50+ FK', m.stats.fk >= 50, m.stats.fk);
    check('eticaret: arama kaydı → kullanıcı (tahmini)', rel(m, 'search_logs', 'user_id', 'users', 'implicit'));
    check('eticaret: kategori kendine bağlı', rel(m, 'categories', 'parent_id', 'categories').self);
    check('eticaret: satıcı 1:1 kullanıcı', rel(m, 'sellers', 'user_id', 'users').childEnd === 'zeroOne');
    const st = find(m, 'orders').colIdx.get('STATUS');
    check('eticaret: MySQL ENUM tipi değer listesi', st.valuesSrc === 'enum' && st.values.length === 4, st.values);
    const p = NS.namingProfile(m);
    check('eticaret: adlandırma snake_case, PK id, çoğul', same(dim(p, 'pkStyle'), { id: 35, composite: 5 }) && p.dims.find(d => d.id === 'tableNumber').dominant === 'plural' && p.dims.find(d => d.id === 'columnCase').share === 1);
  },
  saglik({ model: m }) {
    check('saglik: PostgreSQL tanındı', m.stats.dialects.includes('postgres'), m.stats.dialects);
    check('saglik: FK dosyası tablolardan önce gelse de 50+ FK', m.stats.fk >= 50, m.stats.fk);
    check('saglik: PK\'ler ayrı dosyadan geldi', find(m, 'patient').pk[0] === 'patient_id');
    check('saglik: açıklamalar ayrı dosyadan geldi', !!find(m, 'patient').comment);
  },
  lojistik({ model: m, migration, skipped, order }, all, s) {
    check('lojistik: Flyway tanındı', migration === 'Flyway', migration);
    check('lojistik: U betiği ve flyway.conf atlandı', skipped.length === 2, skipped.map(x => x.file.path));
    check('lojistik: R__ en sonda', /R__/.test(order[order.length - 1]), order.slice(-2));
    check('lojistik: V10, V2\'den sonra', order.findIndex(p => /V10__/.test(p)) > order.findIndex(p => /V2__/.test(p)));
    check('lojistik: eski adlar yok', !find(m, 'shipment') && !find(m, 'courier') && !find(m, 'couriers') && !find(m, 'legacy_route'));
    check('lojistik: yeni adlar var', !!find(m, 'shipments') && !!find(m, 'drivers'));
    check('lojistik: kolon adı değişti', cols(find(m, 'shipments')).includes('weight_grams') && cols(find(m, 'shipments')).includes('sender_customer_id'));
    check('lojistik: tip değişti', find(m, 'parcels').colIdx.get('WEIGHT_GRAMS').type === 'bigint');
    check('lojistik: silinen kolon gitti', !cols(find(m, 'addresses')).includes('customer_id'));
    check('lojistik: yeniden adlandırılan tabloya FK', rel(m, 'parcels', 'shipment_id', 'shipments', 'fk'));
    check('lojistik: partition tablosu tahminle bağlı', rel(m, 'tracking_events', 'shipment_id', 'shipments', 'implicit'));
    check('lojistik: partition parçaları tablo olmadı', !find(m, 'tracking_events_2026_09'));
    // şema farkı: V3'e kadarki hâl → son hâl
    const lfiles = s.files.map(p => ({ path: 'lojistik/' + p, text: fs.readFileSync(path.join(ROOT, 'samples', 'lojistik', p), 'utf8') }));
    const upTo = n => lfiles.filter(f => { const v = /\/V(\d+)__/.exec(f.path); return v ? +v[1] <= n : false; });
    const d = NS.diffModels(build(upTo(3)).model, m);
    const de = n => d.tables.find(e => (e.after || e.before).name === n);
    check('lojistik fark: 12 eklenen, 1 silinen, 8 değişen (8 adı değişen)', d.summary.added === 12 && d.summary.removed === 1 && d.summary.changed === 8 && d.summary.renamed === 8, d.summary);
    check('lojistik fark: tablo adı değişikliği tahmini', de('customers').renamed && de('customers').before.name === 'customer' && de('drivers').before.name === 'courier');
    const sc = Object.fromEntries(de('shipments').cols.map(c => [c.name, c]));
    check('lojistik fark: kolon adı değişikliği ve tip değişikliği', sc.weight_grams.status === 'renamed' && sc.weight_grams.from === 'weight' && sc.weight_grams.changes.includes('type') && sc.sender_customer_id.from === 'sender_id', Object.values(sc).map(c => [c.status, c.from, c.name, c.changes]));
    check('lojistik fark: adı değişen kolonun FK\'si değişmiş sayılmaz', !de('shipments').fks.length, de('shipments').fks.map(f => [f.status, f.rel.cols]));
    check('lojistik fark: silinen kolon ve FK', de('addresses').cols.some(c => c.status === 'removed' && c.name === 'customer_id') && de('addresses').fks.some(f => f.status === 'removed'));
    check('lojistik fark: silinen ve eklenen tablo', de('legacy_route').status === 'removed' && de('tracking_events').status === 'added');
    check('lojistik inceleme: yalnızca ad değiştiren sürüm bulgu getirmez', !NS.reviewChange(build(upTo(3)).model, build(upTo(4)).model).findings.length);
    // V14 ilk indeksi getirir: önce denetlenemeyen FK indeksi kuralı değişmeyen tablolarda yeni bulgu saymaz
    check('lojistik inceleme: ilk indeksi getiren sürüm eski tablolara bulgu yüklemez', !NS.reviewChange(build(upTo(13)).model, build(upTo(14)).model).findings.length);
    check('lojistik fark: aynı dosyalarda fark yok', NS.diffModels(build(lfiles.filter(f => /\/V/.test(f.path))).model, build(lfiles.filter(f => /\/V/.test(f.path))).model).summary.same === 23);
    // zaman çizelgesi: dosya sırasıyla her sürüme kadarki model; soy, geçmiş, birleşik yerleşim
    const ordF = order.map(p => lfiles.find(f => f.path.endsWith(p) || p.endsWith(f.path))).filter(Boolean);
    const tl = NS.timeline(ordF.map((_, i) => build(ordF.slice(0, i + 1)).model));
    const lastStep = tl.steps[tl.steps.length - 1].model;
    const hist = n => NS.tableHistory(tl, tl.idOf.get(lastStep.tables.find(t => t.name === n)));
    const unionNames = tl.union.map(t => t.name);
    check('lojistik zaman: her dosya bir adım, son adım son model', tl.steps.length === order.length && lastStep.tables.length === m.tables.length, [tl.steps.length, order.length]);
    check('lojistik zaman: ilk adımda her şey eklendi', tl.steps[0].diff.summary.added === tl.steps[0].model.tables.length);
    const sh = hist('shipments');
    check('lojistik zaman: shipments geçmişi (oluştu, adı değişti, kolonu değişti)', sh[0].status === 'added' && sh[0].step === 0 && sh.some(h => h.entry.renamed) && sh.some(h => h.entry.cols.some(c => c.name === 'weight_grams')), sh.map(h => [h.step, h.status, h.entry.renamed]));
    check('lojistik zaman: adı değişen tablo birleşikte bir kez', unionNames.includes('shipments') && !unionNames.includes('shipment') && unionNames.includes('legacy_route'), unionNames);
    const lr = tl.steps.findIndex((s, i) => i && s.diff.tables.some(e => e.status === 'removed' && e.before.name === 'legacy_route'));
    check('lojistik zaman: silinen tablonun geçmişi silinmeyle biter', lr > 0 && NS.tableHistory(tl, tl.idOf.get(tl.steps[lr - 1].model.tables.find(t => t.name === 'legacy_route'))).pop().status === 'removed');
    const us = new Set(tl.union);
    check('lojistik zaman: birleşik ilişkiler birleşik tablolara bağlı', tl.unionRels.every(r => us.has(r.child) && us.has(r.parent)) && tl.unionRels.length >= lastStep.rels.length);
    check('lojistik: migration\'da dosyaya göre gruplanmaz', NS.resolveGrouping('auto', migration) === 'name' && !m.tables.some(t => t.group.file));
  },
  iot({ model: m }) {
    check('iot: Cassandra tanındı', m.stats.dialects.includes('cassandra'), m.stats.dialects);
    check('iot: iki keyspace', new Set(m.tables.map(t => t.schema)).size === 2);
    check('iot: bölüm anahtarı', String(find(m, 'readings_by_device_day').partition) === 'device_id,day');
    check('iot: map<text, text> tek kolon', find(m, 'sites').colIdx.get('TAGS').type === 'map<text,text>');
    check('iot: ölçüm → cihaz (tahmini)', rel(m, 'readings_by_device_day', 'device_id', 'devices', 'implicit'));
    check('iot: keyspace\'ler arası tahmin', rel(m, 'rollup_daily_by_site', 'site_id', 'sites', 'implicit'));
  },
  sosyal({ model: m }) {
    check('sosyal: MongoDB', m.stats.dialects.includes('mongodb'), m.stats.dialects);
    const users = m.tables.filter(t => t.name === 'users');
    check('sosyal: users tek tabloda birleşti', users.length === 1, users.length);
    check('sosyal: doğrulayıcı + model alanları', cols(users[0]).includes('profile') && cols(users[0]).includes('blockedUsers'));
    check('sosyal: uydu belgeler', m.stats.embedded >= 8, m.stats.embedded);
    check('sosyal: Mongoose ref', rel(m, 'comments', 'post', 'posts', 'fk'));
    check('sosyal: dizi ref → çok', rel(m, 'comments', 'mentions', 'users', 'fk').parentEnd === 'zeroMany');
    check('sosyal: belge örneğinden koleksiyon', !!find(m, 'ad_impressions'));
    check('sosyal: alan adından tahmin', rel(m, 'likes', 'postId', 'posts', 'implicit'));
    check('sosyal: package.json okunmadı', !find(m, 'package'));
    check('sosyal: model() içinde satır içi new Schema()', !!find(m, 'sessions') && rel(m, 'sessions', 'user', 'users', 'fk'));
    check('sosyal: üçüncü argümanla koleksiyon adı', !!find(m, 'stories'));
    check('sosyal: ref \'Media\' → media (Mongoose çoğul kuralı)', rel(m, 'stories', 'media', 'media', 'fk') && !find(m, 'medias'));
    check('sosyal: dış koleksiyon yok', m.stats.external === 0, m.tables.filter(t => t.external).map(t => t.name));
    check('sosyal: MongoDB kaynak dosyalarına göre bölünmez', !m.tables.some(t => t.group.file));
    const vis = find(m, 'posts').colIdx.get('VISIBILITY');
    check('sosyal: enum değerleri kolonun değer listesi, açıklamaya yazılmaz', vis.valuesSrc === 'enum' && vis.values.map(v => v.code).join() === 'public,followers,circle' && !/enum:/.test(vis.comment || ''), [vis.values, vis.comment]);
  },
  saha({ model: m }) {
    check('saha: SQLite tanındı', m.stats.dialects.includes('sqlite'), m.stats.dialects);
    check('saha: 15+ FK', m.stats.fk >= 15, m.stats.fk);
    check('saha: imza 1:1 iş emri', rel(m, 'signatures', 'work_order_id', 'work_orders').childEnd === 'zeroOne');
  },
  polyglot({ model: m }) {
    check('polyglot: üç veritabanı', m.dbs.length === 3, m.dbs);
    check('polyglot: üç lehçe', m.stats.dialects.length === 3, m.stats.dialects);
    check('polyglot: veritabanları arası ilişki yok', !m.rels.some(r => r.child.db !== r.parent.db));
  },
  sozluk({ model: m }) {
    const sz = find(m, 'SOZLUK');
    check('sozluk: SOZLUK sözlük, SOZLUK_TIP değil', sz.dictionary && !find(m, 'SOZLUK_TIP').dictionary && m.stats.dictionaries === 1);
    check('sozluk: 29 @ref, uyarı yok', m.stats.refs === 29 && !m.stats.warnings.length, [m.stats.refs, m.stats.warnings]);
    check('sozluk: sözlüğe 31 bağlantı', m.rels.filter(r => r.dict).length === 31, m.rels.filter(r => r.dict).length);
    const yontem = rel(m, 'ODEME', 'YONTEM_ID', 'SOZLUK');
    check('sozluk: FK + @ref → koşullu FK', yontem && yontem.kind === 'fk' && yontem.filter === 'TIP_ID = 11' && yontem.dict, yontem && [yontem.kind, yontem.filter]);
    const adres = rel(m, 'ADRES', 'ADRES_TIP_ID', 'SOZLUK');
    check('sozluk: koşulsuz FK da sözlük bağlantısı', adres && adres.kind === 'fk' && !adres.filter && adres.dict);
    check('sozluk: şemalı ve şemasız @ref aynı tabloya', rel(m, 'ABONE', 'DURUM_ID', 'SOZLUK', 'ref') && rel(m, 'ABONE', 'TIP_ID', 'SOZLUK', 'ref'));
    const dv = (t, c) => { const x = find(m, t).colIdx.get(c); return x.valuesSrc === 'dict' ? x.values.map(v => v.code + '=' + v.label).join(', ') : null; };
    check('sozluk: INSERT satırlarından koşula uyan kod değerleri', dv('ABONE', 'DURUM_ID') === '1=Aktif, 2=Pasif, 3=Askıya alınmış, 4=İptal' && dv('HAT', 'DURUM_ID') === '5=Açık, 6=Kapalı, 7=Tek yönlü kapalı', [dv('ABONE', 'DURUM_ID'), dv('HAT', 'DURUM_ID')]);
    check('sozluk: koşulsuz sözlük bağlantısında değer gösterilmez', !dv('ADRES', 'ADRES_TIP_ID'));
    check('sozluk: verisi olmayan tip boş kalır', !find(m, 'ODEME').colIdx.get('YONTEM_ID').values);
    check('sozluk: düz FK ile küçük tabloya da değer gelir', (dv('SOZLUK', 'TIP_ID') || '').startsWith('1=Abone durumu, 2=Abone tipi'));
    check('sozluk: veri satırları sayıldı, INSERT raporda kalır', m.stats.dataRows === 42 && m.stats.skipped.some(([k, n]) => k === 'INSERT' && n === 42), [m.stats.dataRows, m.stats.skipped]);
    check('sozluk: TIP_ID kolonları SOZLUK_TIP\'e tahmin edilmez', !m.rels.some(r => r.kind === 'implicit'), m.rels.filter(r => r.kind === 'implicit').map(r => r.child.name + '.' + r.cols[0]));
  },
  hatali({ model: m, migration }, all, s) {
    check('hatali: Flyway tanındı, 14 tablo', migration === 'Flyway' && m.stats.tables === 14, [migration, m.stats.tables]);
    const a = NS.auditModel(m);
    const got = a.findings.map(f => `${f.rule} ${f.t ? f.t.name : f.tables.map(t => t.name).join('+')}${f.col ? '.' + f.col : ''}`);
    const want = [
      'no-pk KAMPANYA_KATILIM', 'fk-type-mismatch KAMPANYA_KATILIM.MUSTERI_ID', 'ref-broken MUSTERI.SEGMENT_KOD',
      'fk-missing URUN.URUN_GRUBU_ID', 'fk-no-index KAMPANYA_KATILIM.KAMPANYA_ID', 'fk-no-index KAMPANYA_KATILIM.MUSTERI_ID',
      'fk-no-index SIPARIS.KAMPANYA_ID', 'fk-cycle BAYI+BOLGE', 'duplicate-index MUSTERI_NOTU.MUSTERI_REF',
      'disabled-fk SIPARIS.KAMPANYA_ID', 'orphan-table ESKI_FIYAT_LISTESI', 'date-as-text KAMPANYA.BASLANGIC_TAR',
      'date-as-text KAMPANYA.BITIS_TAR', 'money-as-float KAMPANYA.INDIRIM_TUTARI', 'number-as-text KAMPANYA.KATILIMCI_ADEDI',
      'oversized-text KAMPANYA', 'char-for-variable MUSTERI', 'same-name-diff-type SIPARIS+KAMPANYA.DURUM',
      'number-no-precision ESKI_FIYAT_LISTESI', 'lob-for-short MUSTERI_NOTU', 'bool-inconsistent BAYI+KAMPANYA+MUSTERI_NOTU',
      'repeating-group MUSTERI', 'delimited-list KAMPANYA.HEDEF_SEGMENT_IDS', 'eav-pattern MUSTERI_OZELLIK',
      'wide-table MUSTERI_RAPOR_DUZ', 'name-too-long ESKI_FIYAT_LISTESI.SON_KAMPANYA_KATILIM_ONAY_TARIHI',
      'reserved-word MUSTERI_NOTU.COMMENT', 'non-ascii-name KAMPANYA', 'pk-style URUN_GRUBU.URUN_GRUBU_ID',
      'fk-style MUSTERI_NOTU.MUSTERI_REF', 'naming-case BayiPerformans', 'naming-case BayiPerformans.BayiId',
      'naming-case BayiPerformans.Donem', 'naming-case BayiPerformans.Id', 'system-name ESKI_FIYAT_LISTESI',
    ];
    check('hatali denetim: bulgu listesi birebir', same(got, want), got.filter(x => !want.includes(x)).concat(want.filter(x => !got.includes(x)).map(x => '-' + x)));
    check('hatali denetim: her kural en az bir kez', NS.AUDIT_RULES.filter(r => !r.standard).every(r => a.findings.some(f => f.rule === r.id)), NS.AUDIT_RULES.filter(r => !r.standard && !a.findings.some(f => f.rule === r.id)).map(r => r.id));
    // standart: profilden öneri; verilince adlandırma kuralları ona göre, standarda bağlı kurallar çalışır
    const prop = NS.proposeStandard(NS.namingProfile(m), { dialects: ['oracle'] });
    check('standart önerisi: belirgin kalıplar önerilir', prop.standard.tableCase === 'upperSnake' && prop.standard.pkStyle === 'id' && prop.standard.fkStyle === 'targetId' && prop.standard.nameLimit === 30 && prop.standard.ascii === true && prop.choices.fkStyle.every(c => !['role', 'roleOnly', 'other'].includes(c.key)), prop.standard);
    const pk = NS.proposeStandard(NS.namingProfile(all.karisik.model));
    check('standart önerisi: belirgin baskın yoksa öneri boş, seçenekler oranlarıyla', pk.standard.pkStyle === null && !pk.clear.pkStyle && pk.choices.pkStyle.length >= 2 && pk.choices.pkStyle[0].pct != null, [pk.standard.pkStyle, pk.choices.pkStyle]);
    const as = NS.auditModel(m, { standard: { pkStyle: 'tableId', tableNumber: 'plural', comments: 'tables', auditColumns: ['CREATED_AT'], nameLimit: 25, ascii: false } });
    const ofRule = id => as.findings.filter(f => f.rule === id);
    check('standart: PK kuralı standarda göre', ofRule('pk-style').length >= 8 && ofRule('pk-style').every(f => f.data.standard && f.data.dominant === 'tableId') && !ofRule('pk-style').some(f => f.t.name === 'URUN_GRUBU'), ofRule('pk-style').map(f => f.key));
    check('standart: tekil / çoğul, açıklama ve denetim kolonları', ofRule('naming-number').length > 0 && ofRule('missing-comment').length === 14 && ofRule('missing-audit').length === 14 && ofRule('missing-audit')[0].data.cols[0] === 'CREATED_AT', [ofRule('naming-number').length, ofRule('missing-comment').length, ofRule('missing-audit').length]);
    check('standart: ad sınırı ve karakter kümesi', ofRule('name-too-long').length > 1 && ofRule('name-too-long').every(f => f.data.max === 25 && f.data.standard) && !ofRule('non-ascii-name').length);
    const sv = NS.auditModel(m, { severity: { 'fk-no-index': 'error', 'orphan-table': 'off' } });
    check('önem ayarı: yükseltme ve kapatma', sv.findings.filter(f => f.rule === 'fk-no-index').every(f => f.severity === 'error') && !sv.findings.some(f => f.rule === 'orphan-table') && sv.counts.error === 10, sv.counts);
    check('hatali denetim: sayılar ve temiz tablolar', same(a.counts, { error: 7, warning: 20, info: 8 }) && a.clean === 3 && !a.skipped.length, [a.counts, a.clean]);
    const bi = a.findings.find(f => f.rule === 'bool-inconsistent');
    check('hatali denetim: mantıksal kodlamalar', same(bi.data.encodings.map(e => e.enc), ['E/H', 'Y/N', 'NUMBER(1)']), bi.data.encodings.map(e => e.enc));
    check('hatali denetim: tabloya göre bulgular', a.byTable.get(find(m, 'KAMPANYA')).length === 9 && !a.byTable.has(find(m, 'SIPARIS_KALEM')), a.byTable.get(find(m, 'KAMPANYA')).map(f => f.rule));
    // borç kaydı: V3'teki bulgular kabul edilir; son hâlde yalnızca V4 ve V5'in getirdikleri yeni sayılır
    const hfiles = s.files.map(p => ({ path: 'hatali/' + p, text: fs.readFileSync(path.join(ROOT, 'samples', 'hatali', p), 'utf8') }));
    const upToV = n => hfiles.filter(f => +/\/V(\d+)__/.exec(f.path)[1] <= n);
    const keysV3 = NS.auditModel(build(upToV(3)).model).findings.map(f => f.key);
    check('borç: bulgu anahtarı kalıcı ve okunur', same(NS.auditModel(build(hfiles).model).findings.map(f => f.key), a.findings.map(f => f.key)) && keysV3.includes('no-pk:KAMPANYA_KATILIM') && keysV3.includes('fk-type-mismatch:KAMPANYA_KATILIM.MUSTERI_ID') && keysV3.includes('repeating-group:MUSTERI.TEL1,TEL2,TEL3'), keysV3.slice(0, 5));
    const ab3 = NS.auditModel(m, { debt: keysV3 });
    const newRules = [...new Set(ab3.findings.filter(f => !f.debt).map(f => f.rule))].sort();
    check('borç: kabul edilenler yeni sayılmaz', ab3.debt.total === 21 && ab3.debt.left === 21 && !ab3.debt.paid.length && same(ab3.counts, { error: 1, warning: 8, info: 5 }) && same(ab3.debt.counts, { error: 6, warning: 12, info: 3 }), [ab3.debt, ab3.counts]);
    check('borç: yeni bulgular V4 ve V5\'ten', same(newRules, ['disabled-fk', 'fk-cycle', 'fk-missing', 'fk-no-index', 'name-too-long', 'naming-case', 'number-no-precision', 'orphan-table', 'pk-style', 'system-name', 'wide-table']), newRules);
    // düzeltilen bulgu ödenmiş sayılır; temiz tablo sayısı yalnızca yeni bulgulara bakar
    const fixed = build(hfiles.concat([{ path: 'hatali/db/migration/V6__duzeltme.sql', text: 'ALTER TABLE KAMPANYA_KATILIM ADD CONSTRAINT PK_KAMPANYA_KATILIM PRIMARY KEY (KAMPANYA_ID, MUSTERI_ID);\n' }])).model;
    const af = NS.auditModel(fixed, { debt: keysV3 });
    // PK (KAMPANYA_ID, MUSTERI_ID) KAMPANYA_ID'nin FK indeksini de karşılar
    check('borç: düzeltilen bulgular ödendi', same(af.debt.paid, ['no-pk:KAMPANYA_KATILIM', 'fk-no-index:KAMPANYA_KATILIM.KAMPANYA_ID']) && af.debt.left === 19 && af.clean > a.clean, [af.debt.paid, af.clean]);
    // değişiklik incelemesi: V5'in getirdiği bulgular; düzeltme sürümü bulgu getirmez, giderir
    const r45 = NS.reviewChange(build(upToV(4)).model, m);
    check('inceleme: V4 → V5 yalnızca V5 bulguları', r45.findings.length === 9 && same(r45.counts, { error: 1, warning: 4, info: 4 }) && !r45.fixed.length && r45.findings.every(f => f.tables.some(t => ['ESKI_FIYAT_LISTESI', 'MUSTERI_RAPOR_DUZ', 'BayiPerformans'].includes(t.name))), r45.findings.map(f => f.key));
    const rfix = NS.reviewChange(m, fixed);
    check('inceleme: düzeltme sürümü yeni bulgu getirmez, giderir', !rfix.findings.length && same(rfix.fixed.map(f => f.key).sort(), ['fk-no-index:KAMPANYA_KATILIM.KAMPANYA_ID', 'no-pk:KAMPANYA_KATILIM']), rfix.fixed.map(f => f.key));
    check('inceleme: borçtaki bulgular yeni sayılmaz', NS.reviewChange(build(upToV(1)).model, build(upToV(2)).model, { debt: ['no-pk:KAMPANYA_KATILIM'] }).findings.length === 12);
    check('borç: proje dosyası şema sayılmaz', NS.classify('satis/db/satis.sqlschema.json').skip === 'project');
    // indeks işlemi: benzersiz olmayan indeks modelde, kolonu silinince indeks de gider
    check('hatali: indeksler modelde', find(m, 'MUSTERI_NOTU').indexes.length === 2 && find(m, 'SIPARIS').indexes.length === 2);
    // mevcut örneklerde yanlış alarm makul
    const at = NS.auditModel(all.telekom.model), ab = NS.auditModel(all.banka.model);
    check('telekom denetim: metin tarih yok', !at.findings.some(f => f.rule === 'date-as-text'));
    check('banka denetim: PK stili bulgusu yok, hata yok', !ab.findings.some(f => f.rule === 'pk-style') && ab.counts.error === 0, ab.counts);
    check('saha denetim: SQLite metin tarihi sayılmaz', !NS.auditModel(all.saha.model).findings.some(f => f.rule === 'date-as-text'));
    check('denetim: MongoDB örneğinde bulgu yok', !NS.auditModel(all.sosyal.model).findings.length);
    const ad = NS.auditModel(all.eticaret.model);
    check('eticaret denetim: dökümde indeks yoksa FK indeksi denetlenmez', ad.skipped.some(x => x.rule === 'fk-no-index'));
  },
  // Düzeltme SQL'i: üretilen betik dosyalara yeni bir sürüm olarak eklenip yeniden denetlenince düzeltilen bulgular
  // kaybolur, yeni bulgu çıkmaz ve ayrıştırma hatası olmaz
  fixesRoundTrip(all) {
    const round = (id, extra) => {
      const s = NS.SAMPLES.find(x => x.id === id);
      const files = s.files.map(p => ({ path: id + '/' + p, text: decode(fs.readFileSync(path.join(ROOT, 'samples', id, p))) }));
      const a = NS.auditModel(all[id].model);
      const fixes = NS.fixAll(a.findings, { indexesKnown: !a.skipped.some(x => x.rule === 'fk-no-index'), ...extra });
      const script = fixes.flatMap(x => x.fix.steps.filter(st => !st.comment).map(st => st.sql)).join('\n');
      const dir = files[0].path.includes('/db/migration/') ? id + '/db/migration/' : files[0].path.replace(/[^/]*$/, '');
      const name = /\/V\d+__/.test(files.map(f => f.path).join()) ? 'V99__duzeltme.sql' : 'zz_duzeltme.sql';
      const m2 = build(files.concat([{ path: dir + name, text: script }]), s.separate).model;
      const a2 = NS.auditModel(m2);
      const before = new Set(a.findings.map(f => f.key)), after = new Set(a2.findings.map(f => f.key));
      const fixedKeys = fixes.map(x => x.f.key);
      return { fixes, script, errors: m2.stats.errors, gone: fixedKeys.filter(k => !after.has(k)).length, stay: fixedKeys.filter(k => after.has(k)), fresh: [...after].filter(k => !before.has(k)) };
    };
    const h = round('hatali');
    check('düzeltme hatali: 22 öneri, hepsi uygulanınca bulgu kayboluyor', h.fixes.length === 22 && h.gone === 22 && !h.errors.length, [h.fixes.length, h.gone, h.stay, h.errors.slice(0, 2)]);
    check('düzeltme hatali: yeni bulgu çıkmıyor', !h.fresh.length, h.fresh);
    const risks = {};
    for (const x of h.fixes) risks[x.fix.risk] = (risks[x.fix.risk] || 0) + 1;
    check('düzeltme hatali: risk dağılımı', same(risks, { review: 6, safe: 5, risky: 11 }), risks);
    const sql = f => h.fixes.find(x => x.f.key === f).fix.steps.map(st => (st.comment ? '-- ' : '') + st.sql);
    check('düzeltme: FK, NOVALIDATE ve indeks', same(sql('fk-missing:URUN.URUN_GRUBU_ID'), [
      'ALTER TABLE URUN ADD CONSTRAINT FK_URUN_URUN_GRUBU FOREIGN KEY (URUN_GRUBU_ID) REFERENCES URUN_GRUBU (URUN_GRUBU_ID) ENABLE NOVALIDATE;',
      '-- ALTER TABLE URUN MODIFY CONSTRAINT FK_URUN_URUN_GRUBU VALIDATE;',
      'CREATE INDEX IX_URUN_URUN_GRUBU_ID ON URUN (URUN_GRUBU_ID);']), sql('fk-missing:URUN.URUN_GRUBU_ID'));
    check('düzeltme: Oracle ad sınırı 30', sql('fk-no-index:KAMPANYA_KATILIM.KAMPANYA_ID')[0] === 'CREATE INDEX IX_KAMPANYA_KATILIM_KAMPANYA_I ON KAMPANYA_KATILIM (KAMPANYA_ID);', sql('fk-no-index:KAMPANYA_KATILIM.KAMPANYA_ID'));
    check('düzeltme: metin tarih yeni kolonla taşınır', same(sql('date-as-text:KAMPANYA.BASLANGIC_TAR'), [
      'ALTER TABLE KAMPANYA ADD (BASLANGIC_TAR_YENI DATE);', "UPDATE KAMPANYA SET BASLANGIC_TAR_YENI = TO_DATE(BASLANGIC_TAR, 'YYYY-MM-DD');",
      'ALTER TABLE KAMPANYA DROP COLUMN BASLANGIC_TAR;', 'ALTER TABLE KAMPANYA RENAME COLUMN BASLANGIC_TAR_YENI TO BASLANGIC_TAR;']), sql('date-as-text:KAMPANYA.BASLANGIC_TAR'));
    check('düzeltme: tırnaklı adlar ve harf düzeni', sql('naming-case:BAYIPERFORMANS.BAYIID')[0] === 'ALTER TABLE "BayiPerformans" RENAME COLUMN "BayiId" TO BAYI_ID;' && sql('non-ascii-name:KAMPANYA.İNDİRİM_ORANI')[0] === 'ALTER TABLE KAMPANYA RENAME COLUMN "İNDİRİM_ORANI" TO INDIRIM_ORANI;');
    check('düzeltme: tablo adını değiştirenler en sonda', h.fixes[h.fixes.length - 1].f.key === 'naming-case:BAYIPERFORMANS', h.fixes.slice(-2).map(x => x.f.key));
    check('düzeltme: sistem adlı PK ve indeksi', same(sql('system-name:ESKI_FIYAT_LISTESI.SYS_C0012345'), ['ALTER TABLE ESKI_FIYAT_LISTESI RENAME CONSTRAINT SYS_C0012345 TO PK_ESKI_FIYAT_LISTESI;', 'ALTER INDEX SYS_C0012345 RENAME TO PK_ESKI_FIYAT_LISTESI;']));
    const plain = round('hatali', { novalidate: false });
    check('düzeltme: NOVALIDATE kapatılabilir', !plain.script.includes('NOVALIDATE'));
    // lehçeler
    const lj = round('lojistik');
    check('düzeltme lojistik (PostgreSQL): küçük harfli adlar, hepsi uygulanıyor', lj.fixes.length === 25 && lj.gone === 25 && !lj.fresh.length && !lj.errors.length && lj.script.includes('CREATE INDEX ix_customer_addresses_address_id ON customer_addresses (address_id);'), [lj.fixes.length, lj.gone, lj.fresh]);
    const bk = round('banka');
    check('düzeltme banka (SQL Server): WITH NOCHECK, indeks bilgisi yokken indeks önerilmez', bk.script.includes('ALTER TABLE aml.Alert WITH NOCHECK ADD CONSTRAINT FK_ALERT_TRANSACTION FOREIGN KEY (TransactionId) REFERENCES acc.[Transaction] (TransactionId);') && !bk.script.includes('CREATE INDEX') && !bk.fresh.length, bk.script.split('\n').slice(0, 2));
    const sg = round('sigorta');
    check('düzeltme sigorta: eklenen PK baskın adlandırmayı izler', sg.gone === sg.fixes.length && !sg.fresh.length && !sg.errors.length, [sg.stay, sg.fresh]);
    const kr = round('karisik');
    check('düzeltme karisik: Türkçe karakterli tablo en son yeniden adlandırılır', /RENAME COLUMN "İMZA_TAR" TO IMZA_TAR;\nALTER TABLE SAHA."SÖZLEŞME" RENAME TO SOZLESME;/.test(kr.script) && !kr.fresh.length && kr.gone === kr.fixes.length, kr.fresh);
    const tk = round('telekom');
    check('düzeltme telekom: tip uyuşmazlığı olan FK önerisi gözden geçirilecek', tk.fixes.filter(x => [].concat(x.fix.steps[0].note || []).includes('typeMismatch')).every(x => x.fix.risk === 'review') && !tk.errors.length && tk.gone === tk.fixes.length);
    // her not kodunun iki dilde metni var
    const noText = ['tr', 'en'].flatMap(l => NS.FIX_NOTES.filter(n => !(NS.i18nRaw(l, 'fixNotes') || {})[n]).map(n => l + ':' + n));
    check('i18n: her düzeltme notunun metni iki dilde', !noText.length, noText);
  },
  karisik({ model: m }) {
    const p = NS.namingProfile(m);
    check('karisik: 25 tablo, 29 FK', p.tables === 25 && p.fks === 29, [p.tables, p.fks]);
    check('karisik: PK %52 ID, %39 <TABLO>_ID', same(dim(p, 'pkStyle'), { id: 12, tableId: 9, tableOther: 1, other: 1, composite: 2 }), dim(p, 'pkStyle'));
    const pkDim = p.dims.find(d => d.id === 'pkStyle');
    check('karisik: PK\'de en çok ID ama belirgin baskın değil (%60 altı)', pkDim.dominant === 'id' && !pkDim.clear, [pkDim.dominant, pkDim.share]);
    check('karisik: FK stilleri', same(dim(p, 'fkStyle'), { targetId: 19, targetOther: 2, role: 2, roleOnly: 1, other: 2, audit: 3 }), dim(p, 'fkStyle'));
    check('karisik: FK\'de <HEDEF>_ID belirgin baskın', p.dims.find(d => d.id === 'fkStyle').clear);
    const fkItems = key => p.dims.find(d => d.id === 'fkStyle').buckets.find(b => b.key === key).items.map(i => i.c).sort();
    check('karisik: hedef adını içermeyen FK\'ler', same(fkItems('other'), ['CHZ_REF', 'DEVICE_REF']), fkItems('other'));
    check('karisik: yalnızca rol adı', same(fkItems('roleOnly'), ['SAHIBI']), fkItems('roleOnly'));
    check('karisik: denetim kolonları orana katılmaz', same(fkItems('audit'), ['CREATED_BY', 'GUNCELLEYEN', 'UPDATED_BY']) && !p.dims.find(d => d.id === 'fkStyle').outliers.some(i => fkItems('audit').includes(i.c)), fkItems('audit'));
    check('karisik: ORM tabloları PascalCase', same(dim(p, 'tableCase'), { upperSnake: 23, pascal: 2 }) && dim(p, 'columnCase').pascal === 7, [dim(p, 'tableCase'), dim(p, 'columnCase')]);
    check('karisik: Türkçe çoğul, TBL_ öneki', same(dim(p, 'tableNumber'), { singular: 24, plural: 1 }) && same(dim(p, 'prefix'), { plain: 24, prefixed: 1 }));
    check('karisik: ASCII dışı ve 30+ karakter adlar', dim(p, 'charset').nonAscii === 3 && dim(p, 'length').long === 1, [dim(p, 'charset'), dim(p, 'length')]);
    const env = NS.namingProfile(m, { filter: t => t.schema === 'ENVANTER' }), saha = NS.namingProfile(m, { filter: t => t.schema === 'SAHA' });
    check('karisik: şema bazında ENVANTER <TABLO>_ID, SAHA ID', env.dims.find(d => d.id === 'pkStyle').dominant === 'tableId' && saha.dims.find(d => d.id === 'pkStyle').dominant === 'id');
    check('karisik: SAHA\'da eski alışkanlıkla açılan tablo', same(saha.dims.find(d => d.id === 'pkStyle').outliers.map(i => i.t.name), ['ABONE']));
  },
};

const all = {};
console.log('sqlSchema testleri\n');
for (const s of NS.SAMPLES) {
  const t0 = Date.now();
  const res = loadSample(s);
  all[s.id] = res;
  const before = failed;
  common(s, res);
  if (EXPECT[s.id]) EXPECT[s.id](res, all, s);
  if (s.id === NS.SAMPLES[NS.SAMPLES.length - 1].id) EXPECT.fixesRoundTrip(all);
  const st = res.model.stats;
  console.log(`${failed === before ? '✓' : '✗'} ${s.id.padEnd(18)} ${String(st.tables).padStart(4)} tablo ${String(st.fk).padStart(4)} FK ${String(st.implicit).padStart(4)} tahmini ${String(st.embedded).padStart(3)} uydu  ${st.dialects.join('+').padEnd(26)} ${Date.now() - t0} ms`);
}

// Ayrıştırıcı birim denetimleri
const one = sql => build([{ path: 'x.sql', text: sql }]).model;
{
  const m = one("CREATE TABLE a (id int PRIMARY KEY, \"KEY\" VARCHAR2(10)); CREATE TABLE b (id int PRIMARY KEY, a_id int, KEY idx_a (a_id), CONSTRAINT fk FOREIGN KEY (a_id) REFERENCES a(id));");
  check('KEY adlı kolon ile KEY indeksi ayrılır', cols(find(m, 'a')).includes('KEY') && cols(find(m, 'b')).length === 2, [cols(find(m, 'a')), cols(find(m, 'b'))]);
  const m2 = one("ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (x) REFERENCES u(id);\nCREATE TABLE t (x int);\nCREATE TABLE u (id int PRIMARY KEY);");
  check('ALTER, CREATE\'ten önce gelse de uygulanır', m2.stats.fk === 1 && m2.stats.orphans.length === 0);
  const m3 = one("CREATE TABLE \"S\".\"T\" (\"A\" NUMBER, \"B\" VARCHAR2(10 CHAR)) ;\nCREATE OR REPLACE TRIGGER x BEFORE INSERT ON t FOR EACH ROW BEGIN :NEW.a := 1; END;\n/\nCREATE TABLE \"S\".\"U\" (\"A\" NUMBER);");
  check('PL/SQL bloğu sonraki tabloyu yutmaz', m3.stats.tables === 2, m3.stats.tables);
  const m4 = one("EXEC sp_rename 'dbo.Old', 'New';\nGO\nCREATE TABLE [dbo].[Old] ([Id] int NOT NULL);\nGO\nEXEC sp_rename 'dbo.Old', 'New';\nGO");
  check('sp_rename tabloyu yeniden adlandırır', !!find(m4, 'New') && !find(m4, 'Old'));

  // @ref açıklama etiketi
  const r1 = one("CREATE TABLE sozluk (id int PRIMARY KEY, tip_id int, ad varchar(50));\nCREATE TABLE abone (id int PRIMARY KEY, durum_id int NOT NULL, segment_id int, kanal varchar(10));\nCOMMENT ON COLUMN abone.durum_id IS 'Abone durumu. @ref sozluk.id (tip_id = 7)';\nCOMMENT ON COLUMN abone.segment_id IS '@ref yok_tablo';\nCOMMENT ON COLUMN abone.kanal IS 'Satış kanalı @ref SOZLUK';");
  const rr = rel(r1, 'abone', 'durum_id', 'sozluk', 'ref');
  check('@ref TABLO.KOLON (koşul)', rr && rr.filter === 'tip_id = 7' && rr.parentEnd === 'one' && rr.childEnd === 'zeroMany', rr && [rr.filter, rr.parentEnd, rr.childEnd]);
  check('@ref TABLO hedefin PK\'sine, büyük/küçük harf duyarsız', !!rel(r1, 'abone', 'kanal', 'sozluk', 'ref'));
  check('bulunamayan @ref uyarı olur', r1.stats.warnings.some(w => w.kind === 'ref' && w.name === 'abone.segment_id'), r1.stats.warnings);
  check('@ref kolonu FK olarak işaretlenir, tahmin edilmez', find(r1, 'abone').colIdx.get('DURUM_ID').fk && !r1.rels.some(r => r.kind === 'implicit' && r.cols[0] === 'durum_id'));
  const r2 = one("CREATE TABLE s (k varchar(10) PRIMARY KEY);\nCREATE TABLE a (id int PRIMARY KEY, s_kod varchar(10) COMMENT 'Kod @ref s (grup = 3)', CONSTRAINT fk_a FOREIGN KEY (s_kod) REFERENCES s (k)) ENGINE=InnoDB;");
  const r2fk = r2.rels.filter(r => r.child.name === 'a');
  check('FK varken @ref koşulu FK\'ye eklenir, çift ilişki olmaz', r2fk.length === 1 && r2fk[0].kind === 'fk' && r2fk[0].filter === 'grup = 3', r2fk.map(r => [r.kind, r.filter]));
  const r3 = one("CREATE TABLE ref.kod (id int PRIMARY KEY, deger varchar(10));\nCREATE TABLE app.x (id int PRIMARY KEY, kod_id int);\nCOMMENT ON COLUMN app.x.kod_id IS '@ref ref.kod.deger';");
  check('@ref ŞEMA.TABLO.KOLON', (rel(r3, 'x', 'kod_id', 'kod', 'ref') || {}).refCols + '' === 'deger');

  // Sözlük tablosu: en az iki koşullu ilişkinin hedefi; elle açılıp kapatılabilir
  check('tek koşullu ilişki sözlük yapmaz', !find(r1, 'sozluk').dictionary);
  const dsql = "CREATE TABLE sozluk (id int PRIMARY KEY, tip_id int);\nCREATE TABLE a (id int PRIMARY KEY, durum_id int, tur_id int, b_id int);\nCREATE TABLE b (id int PRIMARY KEY);\nCOMMENT ON COLUMN a.durum_id IS '@ref sozluk (tip_id = 1)';\nCOMMENT ON COLUMN a.tur_id IS '@ref sozluk (tip_id = 2)';";
  const d1 = one(dsql);
  check('iki koşullu ilişki sözlük yapar', find(d1, 'sozluk').dictionary && d1.rels.filter(r => r.dict).length === 2 && !rel(d1, 'a', 'b_id', 'b').dict);
  const dm = (sql, map) => { const f = [{ path: 'x.sql', text: sql }]; return NS.buildModel(NS.orderFiles(f).files.map(x => ({ ...NS.parseFile(x.path, x.text), db: 'main' })), { dictionaries: map }); };
  const off = dm(dsql, new Map([['main|.SOZLUK', false]]));
  const on = dm(dsql, new Map([['main|.B', true]]));
  check('sözlük elle kapatılır ve açılır', !find(off, 'sozluk').dictionary && !off.rels.some(r => r.dict) && find(on, 'b').dictionary && rel(on, 'a', 'b_id', 'b').dict, [find(off, 'sozluk').key]);}

// Açıklamadaki değer listeleri
{
  const v = s => { const r = NS.valuesFromComment(s); return r ? r.map(x => x.code + '=' + x.label).join(',') : null; };
  const yes = {
    '1 = Aktif, 2 = Pasif, 3 = İptal': '1=Aktif,2=Pasif,3=İptal',
    'Abone durumu: 1 = Aktif, 2 = Pasif': '1=Aktif,2=Pasif',
    'A: Aktif; P: Pasif': 'A=Aktif,P=Pasif',
    'E-Evet / H-Hayır': 'E=Evet,H=Hayır',
    'Durum (1=Aktif, 2=Pasif)': '1=Aktif,2=Pasif',
    '1=Bireysel|2=Kurumsal': '1=Bireysel,2=Kurumsal',
    '0 => kapalı, 1 => açık': '0=kapalı,1=açık',
    'active: kullanılıyor, passive: kapalı': 'active=kullanılıyor,passive=kapalı',
  };
  const wrongYes = Object.entries(yes).filter(([s, e]) => v(s) !== e).map(([s]) => [s, v(s)]);
  check('değer listesi biçimleri', !wrongYes.length, wrongYes);
  const no = ['Not: bu alan eski, Kaynak: SAP', 'Sürüm 2 = yeni biçim', 'Tarih: 2024-01-01', 'E-posta adresi, SMS izni', 'Durum. @ref SOZLUK.ID (TIP_ID = 7)', 'a = b'];
  const wrongNo = no.filter(s => v(s));
  check('değer listesi sanılmayan açıklamalar', !wrongNo.length, wrongNo.map(s => [s, v(s)]));
  check('listenin dışındaki metin', NS.valuesFromComment('G = Gerçek, T = Tüzel. Varsayılan G').rest === 'Varsayılan G');

  // CHECK kısıtındaki değer listeleri
  const ck = one("CREATE TABLE a (id int PRIMARY KEY, durum CHAR(1) CONSTRAINT ck CHECK (durum IN ('A','P')) NOT NULL, tip varchar(5), adet int CHECK (adet > 0), puan int, CONSTRAINT ck2 CHECK (tip IN ('B','K')), CONSTRAINT ck3 CHECK (puan BETWEEN 1 AND 5));\nALTER TABLE a ADD CONSTRAINT ck4 CHECK (id IN (1, 2) AND tip = 'B');");
  const cv = c => { const x = find(ck, 'a').colIdx.get(c); return x.values ? x.values.map(v => v.code).join() : null; };
  check('CHECK IN: satır içi ve tablo düzeyi', cv('DURUM') === 'A,P' && cv('TIP') === 'B,K', [cv('DURUM'), cv('TIP')]);
  check('CHECK IN satır içinde NOT NULL\'u bozmaz', !find(ck, 'a').colIdx.get('DURUM').nullable);
  // INSERT satırları
  const ins = one("CREATE TABLE kod (id int PRIMARY KEY, grup varchar(10), ad varchar(50));\nCREATE TABLE a (id int PRIMARY KEY, k int);\nCOMMENT ON COLUMN a.k IS '@ref kod (grup = ''X'')';\nINSERT INTO kod (id, grup, ad) VALUES (1, 'X', 'Bir'), (2, 'X', 'İki'), (3, 'Y', 'Üç');\nINSERT INTO kod VALUES (-4, 'X', NULL);\nINSERT INTO kod (id, grup, ad) SELECT id, 'X', ad FROM baska;\nINSERT INTO kod (id, grup, ad) VALUES (5, 'X', UPPER('beş'));");
  const kv = find(ins, 'a').colIdx.get('K').values;
  check('INSERT: çok satırlı VALUES, kolonsuz INSERT, eksi sayı, NULL, işlev', kv && kv.map(v => v.code + '=' + v.label).join() === '1=Bir,2=İki,-4=null,5=null', kv);
  check('INSERT ... SELECT okunmaz', find(ins, 'kod').rows.length === 5, find(ins, 'kod').rows.length);
  check('karşılaştırma, aralık ve bileşik koşul liste sayılmaz', !cv('ADET') && !cv('PUAN') && !cv('ID'), [cv('ADET'), cv('PUAN'), cv('ID')]);
}

// Adlandırma sınıflandırıcıları
{
  const cases = { CUSTOMER_ORDER: 'upperSnake', ID: 'upperSnake', 'SÖZLEŞME': 'upperSnake', order_lines: 'lowerSnake', OrderLine: 'pascal', Id: 'pascal', orderLine: 'camel', Order_Line: 'mixed', 'Order Line': 'mixed' };
  const wrong = Object.entries(cases).filter(([n, c]) => NS.caseOf(n) !== c).map(([n]) => [n, NS.caseOf(n)]);
  check('harf düzeni sınıflandırması', !wrong.length, wrong);
  const plural = ['users', 'categories', 'addresses', 'RANDEVULAR', 'KALEMLER', 'OrderItems', 'AYARLAR'];
  const single = ['STATUS', 'ADDRESS', 'ANALYSIS', 'SMS', 'Biller', 'SELLER', 'HANDLER', 'DEALER', 'CUSTOMER', 'MALZEME'];
  const bad = plural.filter(n => !NS.isPlural(n)).concat(single.filter(n => NS.isPlural(n)));
  check('çoğul tahmini', !bad.length, bad);
  const audit = ['CREATED_BY', 'updated_by', 'createdBy', 'LAST_UPDATED_BY', 'INS_USER', 'CREATED_USER_ID', 'CHANGED_BY_USER_ID', 'KAYIT_KULLANICI', 'GUNCELLEYEN', 'GÜNCELLEYEN', 'OLUŞTURAN_SICIL_NO', 'DEĞİŞTİREN'];
  const notAudit = ['CUSTOMER_ID', 'KAYIT_TAR', 'CREATED_AT', 'SAHIBI', 'USER_ID', 'KAYIT_NO'];
  const badAudit = audit.filter(n => !NS.isAudit(n)).concat(notAudit.filter(n => NS.isAudit(n)));
  check('denetim kolonu tanıma', !badAudit.length, badAudit);
}

// Dil desteği: iki sözlük aynı anahtarlara sahip, HTML ve kodda kullanılan her anahtar tanımlı
{
  const tr = new Set(NS.i18nKeys('tr')), en = new Set(NS.i18nKeys('en'));
  const onlyTr = [...tr].filter(k => !en.has(k)), onlyEn = [...en].filter(k => !tr.has(k));
  check('i18n: TR ve EN sözlükleri aynı anahtarlara sahip', !onlyTr.length && !onlyEn.length, { onlyTr, onlyEn });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1]);
  for (const f of ['ui.js', 'render.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr)\('([A-Za-z_]+)'/g)) used.add(m[1]);
  }
  // 'skip_' + kod biçimindeki dinamik anahtarlar: files.js ve ui.js'teki bütün atlama kodları
  used.delete('skip_');
  for (const code of ['config', 'ext', 'down', 'undo', 'project', 'tooBig', 'total']) used.add('skip_' + code);
  // adlandırma profilinin boyut ('nd_' + boyut) ve kova ('nk_' + boyut + '_' + kova) anahtarları
  used.delete('nd_');
  used.delete('nk_');
  for (const d of NS.namingProfile(all.kucuk.model).dims) {
    used.add('nd_' + d.id);
    for (const b of d.buckets) used.add('nk_' + d.id + '_' + b.key);
  }
  const missing = [...used].filter(k => !en.has(k) || !tr.has(k));
  check('i18n: kullanılan her anahtar iki dilde de var', !missing.length, missing);
  // aynı sözlükte iki kez yazılan anahtar sessizce öncekini ezer (ör. sayfa başlığı docTitle)
  const dupKeys = [];
  let dict = '';
  const seenKeys = new Set();
  for (const line of fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8').split('\n')) {
    const d = /^ {2}(tr|en): \{/.exec(line);
    if (d) { dict = d[1]; continue; }
    const k = /^ {4}([A-Za-z_]+):/.exec(line);
    if (!dict || !k) continue;
    // dizgiler ve satır içi alt nesneler ({ safe: ..., review: ... }) atılır; yalnızca sözlüğün kendi anahtarları kalır
    let top = line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`[^`]*`/g, '``');
    while (/\{[^{}]*\}/.test(top)) top = top.replace(/\{[^{}]*\}/g, '()');
    for (const m of top.matchAll(/(?:^ {4}|, )([A-Za-z_]+): /g)) { const id = dict + ':' + m[1]; if (seenKeys.has(id)) dupKeys.push(id); seenKeys.add(id); }
  }
  check('i18n: sözlükte yinelenen anahtar yok', !dupKeys.length, dupKeys);
  // denetim kurallarının metni: her kural iki dilde başlık, neden, öneri ve ayrıntı işleviyle
  const ruleText = l => NS.i18nRaw(l, 'auditRules');
  const noText = ['tr', 'en'].flatMap(l => NS.AUDIT_RULES.filter(r => { const x = ruleText(l)[r.id]; return !x || !x.title || !x.why || !x.fix || typeof x.what !== 'function'; }).map(r => l + ':' + r.id));
  check('i18n: her denetim kuralının metni iki dilde', !noText.length, noText);
  check('i18n: Node ortamında varsayılan dil seçildi', NS.LANGS.includes(NS.getLang()), NS.getLang());
}

// Komut satırı denetimi (tools/sqlschema-lint.js): alt süreçle, çıkış kodu ve çıktı biçimleri
{
  const { spawnSync } = require('child_process');
  const os = require('os');
  const lint = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sqlschema-lint.js'), ...args], { cwd: ROOT, encoding: 'utf8' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlschema-'));
  try {
    const hat = path.join('samples', 'hatali');
    const r1 = lint(hat);
    check('lint: hata varken çıkış kodu 1, metin çıktı', r1.status === 1 && /\[no-pk\]/.test(r1.stdout) && /7 hata · 20 uyarı · 8 bilgi/.test(r1.stdout), [r1.status, r1.stderr]);
    const r2 = lint(hat, '--format', 'json', '--fail-on', 'none', '--lang', 'en');
    const j = JSON.parse(r2.stdout);
    check('lint: JSON çıktı ve --fail-on none', r2.status === 0 && j.mode === 'audit' && same(j.counts, { error: 7, warning: 20, info: 8 }) && j.findings[0].location.file === 'hatali/db/migration/V2__kampanya.sql' && j.findings[0].title === 'Table without a primary key', [r2.status, j.counts]);
    const r3 = lint(path.join(hat, 'db', 'migration'), '--since', 'V5', '--format', 'md');
    check('lint: --since ile inceleme (Markdown)', r3.status === 1 && r3.stdout.includes('V4__bolge_sorumlusu → V5__raporlama') && r3.stdout.includes('(9)'), r3.stdout.slice(0, 200));
    const r4 = lint(hat, '--format', 'sarif', '--fail-on', 'warning');
    const sf = JSON.parse(r4.stdout);
    check('lint: SARIF 2.1.0', r4.status === 1 && sf.version === '2.1.0' && sf.runs[0].results.length === 35 && sf.runs[0].tool.driver.rules.length === NS.AUDIT_RULES.length && sf.runs[0].results.every(x => x.locations.length && x.partialFingerprints.sqlSchemaKey));
    const fixFile = path.join(tmp, 'fix.sql');
    lint(hat, '--fix', fixFile, '--fail-on', 'none');
    const fixSql = fs.readFileSync(fixFile, 'utf8');
    check('lint: --fix güvenli ve gözden geçirilecek SQL', fixSql.includes('CREATE INDEX IX_SIPARIS_KAMPANYA_ID ON SIPARIS (KAMPANYA_ID);') && !fixSql.includes('TO INDIRIM_ORANI') && !fixSql.includes('BAYI_PERFORMANS'));
    check('lint: kullanım hatasında çıkış kodu 2', lint(hat, '--since', 'V9').status === 2 && lint().status === 2 && lint(hat, '--format', 'xml').status === 2);
    // borç kaydı: klasördeki proje dosyası; yalnızca sonradan eklenen bulgu sayılır
    const proj = path.join(tmp, 'proj');
    fs.mkdirSync(proj);
    for (const f of fs.readdirSync(path.join(ROOT, hat, 'db', 'migration'))) fs.copyFileSync(path.join(ROOT, hat, 'db', 'migration', f), path.join(proj, f));
    fs.writeFileSync(path.join(proj, 'satis.sqlschema.json'), JSON.stringify({ app: 'sqlSchema', kind: 'project', version: 1, debt: { keys: j.findings.map(f => f.key), accepted: '2026-10-29', updated: '2026-10-29T00:00:00Z' } }));
    check('lint: borç tamamken bulgu yok', lint(proj).status === 0);
    fs.writeFileSync(path.join(proj, 'V6__yeni.sql'), 'ALTER TABLE KAMPANYA ADD (ACIKLAMA_TAR VARCHAR2(20));\n');
    const r5 = lint(proj, '--format', 'json');
    const j5 = JSON.parse(r5.stdout);
    check('lint: borçtan sonra eklenen bulgu yakalanır', r5.status === 1 && j5.findings.length === 1 && j5.findings[0].key === 'date-as-text:KAMPANYA.ACIKLAMA_TAR' && j5.debt.left === 35, [r5.status, j5.findings.map(f => f.key)]);
    // aynı proje dosyasında standart ve önem ayarı: metin tarih kapatılır, denetim kolonu zorunlu olur
    const projData = JSON.parse(fs.readFileSync(path.join(proj, 'satis.sqlschema.json'), 'utf8'));
    projData.rules = { standard: { auditColumns: ['CREATED_AT'] }, severity: { 'date-as-text': 'off', 'missing-audit': 'info' }, updated: '2026-10-29T00:00:00Z' };
    fs.writeFileSync(path.join(proj, 'satis.sqlschema.json'), JSON.stringify(projData));
    const r6 = lint(proj, '--format', 'json', '--fail-on', 'warning');
    const j6 = JSON.parse(r6.stdout);
    check('lint: proje dosyasındaki standart ve önem ayarı', r6.status === 0 && !j6.findings.some(f => f.rule === 'date-as-text') && j6.findings.filter(f => f.rule === 'missing-audit').length === 14 && j6.findings.every(f => f.severity === 'info'), [r6.status, j6.counts]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n${passed} denetim geçti, ${failed} başarısız`);
process.exitCode = failed ? 1 : 0;
