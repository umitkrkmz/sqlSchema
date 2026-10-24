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
for (const f of ['i18n', 'lexer', 'sql-parser', 'mongo', 'files', 'model', 'layout', 'sample-small']) require(path.join(ROOT, 'js', f + '.js'));
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

// Uygulamanın yaptığı gibi: sırala, ayrıştır, (isteğe bağlı) ayrı veritabanları, model, yerleşim
function build(files, separate) {
  const { files: ordered, skipped, migration } = NS.orderFiles(files);
  const names = NS.databaseNames(ordered.map(f => f.path));
  const inputs = [];
  for (const f of ordered) {
    const r = NS.parseFile(f.path, f.text);
    if (r) inputs.push({ ...r, db: separate ? names.get(f.path) : 'main' });
  }
  NS.harmonizeDialects(inputs);
  const model = NS.buildModel(inputs);
  const lay = NS.layoutModel(model);
  return { model, lay, skipped, migration, order: ordered.map(f => f.path) };
}

function loadSample(s) {
  if (s.embedded) return build([{ path: 'ornek.sql', text: NS.SAMPLE_SQL }]);
  const files = s.files.map(p => ({ path: s.id + '/' + p, text: decode(fs.readFileSync(path.join(ROOT, 'samples', s.id, p))) }));
  return build(files, s.separate);
}

const find = (m, name) => m.tables.find(t => t.name === name);
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
  },
  telekom({ model: m }) {
    check('telekom: 300+ tablo', m.stats.tables >= 300, m.stats.tables);
    check('telekom: 350+ FK', m.stats.fk >= 350, m.stats.fk);
    check('telekom: PL/SQL paketi atlandı', m.stats.skipped.some(([k]) => k === 'CREATE PACKAGE'));
    check('telekom: CRM takımyıldızlara bölündü', m.tables.find(t => t.schema === 'CRM').schemaRef.groups.length > 1);
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
    check('banka: görünüm ve yordam atlandı', m.stats.skipped.some(([k]) => k === 'CREATE VIEW') && m.stats.skipped.some(([k]) => k === 'CREATE PROCEDURE'));
  },
  sigorta({ model: m }) {
    check('sigorta: hiç FK yok', m.stats.fk === 0, m.stats.fk);
    check('sigorta: 50+ tahmini ilişki', m.stats.implicit >= 50, m.stats.implicit);
    check('sigorta: hasar dosyası → poliçe', rel(m, 'HASAR_DOSYA', 'POLICE_NO', 'POLICE', 'implicit'));
    check('sigorta: poliçe aracı 1:1 poliçe', (rel(m, 'POLICE_ARAC', 'POLICE_NO', 'POLICE') || {}).childEnd === 'zeroOne');
    check('sigorta: tek şema', new Set(m.tables.map(t => t.schema)).size === 1);
  },
  eticaret({ model: m }) {
    check('eticaret: MySQL tanındı', m.stats.dialects.includes('mysql'), m.stats.dialects);
    check('eticaret: 50+ FK', m.stats.fk >= 50, m.stats.fk);
    check('eticaret: arama kaydı → kullanıcı (tahmini)', rel(m, 'search_logs', 'user_id', 'users', 'implicit'));
    check('eticaret: kategori kendine bağlı', rel(m, 'categories', 'parent_id', 'categories').self);
    check('eticaret: satıcı 1:1 kullanıcı', rel(m, 'sellers', 'user_id', 'users').childEnd === 'zeroOne');
  },
  saglik({ model: m }) {
    check('saglik: PostgreSQL tanındı', m.stats.dialects.includes('postgres'), m.stats.dialects);
    check('saglik: FK dosyası tablolardan önce gelse de 50+ FK', m.stats.fk >= 50, m.stats.fk);
    check('saglik: PK\'ler ayrı dosyadan geldi', find(m, 'patient').pk[0] === 'patient_id');
    check('saglik: açıklamalar ayrı dosyadan geldi', !!find(m, 'patient').comment);
  },
  lojistik({ model: m, migration, skipped, order }) {
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
};

const all = {};
console.log('sqlSchema testleri\n');
for (const s of NS.SAMPLES) {
  const t0 = Date.now();
  const res = loadSample(s);
  all[s.id] = res;
  const before = failed;
  common(s, res);
  if (EXPECT[s.id]) EXPECT[s.id](res, all);
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
  for (const code of ['config', 'ext', 'down', 'undo', 'tooBig', 'total']) used.add('skip_' + code);
  const missing = [...used].filter(k => !en.has(k) || !tr.has(k));
  check('i18n: kullanılan her anahtar iki dilde de var', !missing.length, missing);
  check('i18n: Node ortamında varsayılan dil seçildi', NS.LANGS.includes(NS.getLang()), NS.getLang());
}

console.log(`\n${passed} denetim geçti, ${failed} başarısız`);
process.exitCode = failed ? 1 : 0;
