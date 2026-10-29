/*
 * sqlSchema · audit.js
 * Tablo tasarım denetimi: kurallar modeli tarar, bulguları kod olarak döndürür; metin (ne, neden, nasıl) arayüzde.
 * Kesin olmayan kurallar adlardan tahmin yürütür; bu yüzden önemleri "uyarı" ya da "bilgi"dir.
 *
 *   auditModel(model, { debt }) → {
 *     findings: [{ rule, severity: error | warning | info, t, col, tables, data, key, debt }]
 *       t: bulgunun tablosu (şema genelindeki bulgularda null; o zaman tables ilgili tabloları verir)
 *       col: kolon adı ya da null · data: kurala özgü ayrıntı (tip, hedef, kolon listesi ...)
 *     byTable: Map(tablo → bulgular) · counts: { error, warning, info } · skipped: [{ rule, reason }]
 *     tables: denetlenen tablo sayısı · clean: hata ve uyarısı olmayan tablo sayısı
 *     debt: { total, left, paid: [anahtar], counts } (opts.debt verildiyse)
 *   }
 *   Borç: opts.debt kabul edilmiş bulgu anahtarlarıdır. Eşleşen bulgular debt: true olur, counts ve clean yalnızca
 *   yeni bulguları sayar; kayıtta olup artık bulunmayanlar ödenmiştir (paid).
 *   reviewChange(before, after, opts): bir değişikliğin getirdiği ve giderdiği bulgular (aşağıda)
 *   findingKey(f): kural, tablo (şemasıyla) ve kolonlardan kalıcı kimlik: 'fk-no-index:SATIS.SIPARIS.KAMPANYA_ID'
 *   AUDIT_RULES: [{ id, group, severity, guess }]   gruplar: keys, types, norm, naming; guess: bulgu addan tahmin
 */
(function (NS) {
'use strict';

const AUDIT_RULES = [
  { id: 'no-pk', group: 'keys', severity: 'error' },
  { id: 'fk-type-mismatch', group: 'keys', severity: 'error' },
  { id: 'ref-broken', group: 'keys', severity: 'error' },
  { id: 'fk-missing', group: 'keys', severity: 'warning', guess: true },
  { id: 'fk-no-index', group: 'keys', severity: 'warning' },
  { id: 'fk-cycle', group: 'keys', severity: 'warning' },
  { id: 'duplicate-index', group: 'keys', severity: 'warning' },
  { id: 'disabled-fk', group: 'keys', severity: 'info' },
  { id: 'orphan-table', group: 'keys', severity: 'info' },
  { id: 'date-as-text', group: 'types', severity: 'error', guess: true },
  { id: 'money-as-float', group: 'types', severity: 'error', guess: true },
  { id: 'number-as-text', group: 'types', severity: 'warning', guess: true },
  { id: 'oversized-text', group: 'types', severity: 'warning', guess: true },
  { id: 'char-for-variable', group: 'types', severity: 'warning', guess: true },
  { id: 'same-name-diff-type', group: 'types', severity: 'warning' },
  { id: 'number-no-precision', group: 'types', severity: 'info' },
  { id: 'lob-for-short', group: 'types', severity: 'info', guess: true },
  { id: 'bool-inconsistent', group: 'types', severity: 'info', guess: true },
  { id: 'repeating-group', group: 'norm', severity: 'warning', guess: true },
  { id: 'delimited-list', group: 'norm', severity: 'warning', guess: true },
  { id: 'eav-pattern', group: 'norm', severity: 'info', guess: true },
  { id: 'wide-table', group: 'norm', severity: 'info' },
  { id: 'name-too-long', group: 'naming', severity: 'error' },
  { id: 'reserved-word', group: 'naming', severity: 'warning' },
  { id: 'non-ascii-name', group: 'naming', severity: 'warning' },
  { id: 'pk-style', group: 'naming', severity: 'warning' },
  { id: 'fk-style', group: 'naming', severity: 'warning' },
  { id: 'naming-case', group: 'naming', severity: 'warning' },
  { id: 'system-name', group: 'naming', severity: 'info' },
];
const SEVERITY = new Map(AUDIT_RULES.map(r => [r.id, r.severity]));
const WIDE_AT = 100;

const U = s => String(s == null ? '' : s).toUpperCase();
// Ad parçaları: alt çizgi, boşluk ve camelCase sınırlarından (orderDate → ORDER, DATE)
const words = name => String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().split(/[^A-Z0-9\xC0-\u{FFFF}]+/u).filter(Boolean);
const last = name => { const w = words(name); return w[w.length - 1] || ''; };

/* ─── Tipler ─── */

const FLOAT = /^(FLOAT|REAL|DOUBLE|DOUBLE PRECISION|BINARY_DOUBLE|BINARY_FLOAT|FLOAT4|FLOAT8)$/;
const INTS = { SMALLINT: 1, INT2: 1, SMALLSERIAL: 1, TINYINT: 0, MEDIUMINT: 2, INT: 2, INTEGER: 2, INT4: 2, SERIAL: 2, BIGINT: 3, INT8: 3, BIGSERIAL: 3 };
const LOB = /^(CLOB|NCLOB|NTEXT|TEXT|LONGTEXT|MEDIUMTEXT|LONG)$/;

// "VARCHAR2(20 CHAR)" → { base: 'VARCHAR2', family: 'text', len: 20 }; bilinmeyen tipler 'other'
function typeInfo(type) {
  const s = U(type).trim();
  const m = /^([A-Z_][A-Z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:BYTE|CHAR)?\s*(?:,\s*(-?\d+)\s*)?\))?(\s.*)?$/.exec(s);
  const base = m ? m[1].trim() : s;
  const len = !m || m[2] == null ? null : m[2] === 'MAX' ? Infinity : Number(m[2]);
  const scale = m && m[3] != null ? Number(m[3]) : null;
  let family = 'other';
  if (/\[\]$|^ARRAY/.test(s)) family = 'array';
  else if (/^(BOOLEAN|BOOL|BIT)$/.test(base)) family = 'bool';
  else if (base in INTS || /^(NUMBER|NUMERIC|DECIMAL|DEC|MONEY|SMALLMONEY)$/.test(base) || FLOAT.test(base)) family = 'number';
  else if (/^(DATE|DATETIME|DATETIME2|SMALLDATETIME|DATETIMEOFFSET|TIME|TIMETZ|TIMESTAMP|TIMESTAMPTZ|YEAR)/.test(base)) family = 'date';
  else if (/CHAR|^TEXT$|^STRING$|^CITEXT$|CLOB$|^NTEXT$|TEXT$|^LONG$|^VARCHAR/.test(base)) family = 'text';
  else if (/^(RAW|LONG RAW|BLOB|BYTEA|VARBINARY|BINARY|IMAGE)$/.test(base)) family = 'binary';
  return { base, family, len, scale, fixed: /^N?CHAR(ACTER)?$/.test(base), lob: LOB.test(base), float: FLOAT.test(base) };
}

// FK ile hedef kolonu uyumsuz mu? Yalnızca kesin farklar: aile, tamsayı genişliği, CHAR / VARCHAR, ve hedeften dar
// uzunluk / duyarlık (geniş FK kolonu değerleri taşır; dar olan taşıyamaz)
function typeMismatch(a, b) {
  if (!a.base || !b.base || a.family === 'other' || b.family === 'other') return false;
  if (a.family !== b.family) return true;
  if (a.family === 'number') {
    if (a.base in INTS && b.base in INTS) return INTS[a.base] !== INTS[b.base];
    if ((a.base in INTS) !== (b.base in INTS)) return false;
    return a.len != null && b.len != null && (a.len < b.len || (a.scale || 0) !== (b.scale || 0));
  }
  if (a.family === 'text') return a.fixed !== b.fixed || (a.len != null && b.len != null && a.len < b.len);
  return false;
}

/* ─── Ad kalıpları ─── */

const DATE_LAST = new Set(['DATE', 'TARIH', 'TARIHI', 'TAR', 'DT', 'AT', 'ON', 'ZAMAN', 'ZAMANI', 'TIMESTAMP', 'TS']);
const DATE_FIRST = new Set(['DATE', 'TARIH']);
const DATE_NOT = new Set(['FORMAT', 'FMT', 'MASK', 'BICIM', 'BICIMI', 'TYPE', 'TIP', 'TIPI', 'KEY']);
// CREATED_AT, UPDATED_ON: AT / ON yalnızca geçmiş zaman ekinden sonra tarih sayılır (ADD_ON bir ürün adıdır)
function isDateName(w) {
  const lw = w[w.length - 1] || '';
  if (DATE_NOT.has(lw)) return false;
  if (lw === 'AT' || lw === 'ON') return w.length > 1 && /(ED|NT|ID|EN)$/.test(w[w.length - 2]);
  return DATE_LAST.has(lw) || DATE_FIRST.has(w[0]);
}
const AMOUNT = new Set(['TUTAR', 'TUTARI', 'AMOUNT', 'AMT', 'PRICE', 'FIYAT', 'FIYATI', 'BAKIYE', 'BAKIYESI', 'BALANCE', 'COST', 'MALIYET', 'UCRET', 'UCRETI', 'FEE', 'PRIM', 'PRIMI', 'PREMIUM', 'KOMISYON', 'COMMISSION', 'VERGI', 'TAX', 'BORC', 'ALACAK', 'SALARY', 'MAAS', 'LIMIT']);
const QUANTITY = new Set(['ADET', 'ADEDI', 'QTY', 'QUANTITY', 'MIKTAR', 'MIKTARI', 'COUNT', 'SAYI', 'SAYISI']);
const DESCRIPTIVE = new Set(['ACIKLAMA', 'ACIKLAMASI', 'DESCRIPTION', 'DESC', 'NOTE', 'NOTES', 'NOT', 'NOTU', 'NOTLAR', 'COMMENT', 'COMMENTS', 'MESSAGE', 'MESAJ', 'MESAJI', 'BODY', 'CONTENT', 'ICERIK', 'ICERIGI', 'PAYLOAD', 'JSON', 'XML', 'DETAIL', 'DETAILS', 'DETAY', 'TEXT', 'METIN', 'ADRES', 'ADDRESS', 'URL', 'PATH', 'YOL', 'SQL', 'QUERY', 'SORGU', 'DATA', 'VERI', 'HATA', 'ERROR', 'STACK', 'TRACE', 'RAW', 'RECORD', 'KAYIT', 'VALUE', 'DEGER', 'DEGERI']);
const GENERIC = new Set(['VALUE', 'DEGER', 'DEGERI', 'VAL', 'DATA', 'VERI']);
const APPEND_ONLY = /(^|_)(HIST|HISTORY|LOG|LOGS|AUDIT|ARCHIVE|ARC|ARSIV|GECMIS|BAK|BCK|BACKUP|TMP|TEMP|STG|STAGING|CDR|EVENTS?)$|^(STG|TMP|FACT)_/i;
const FK_FLAG = new Set(['other', 'roleOnly', 'targetOther']);
const SHORT = new Set(['NAME', 'AD', 'ADI', 'CODE', 'KOD', 'KODU', 'TITLE', 'BASLIK', 'STATUS', 'DURUM', 'DURUMU', 'TYPE', 'TIP', 'TIPI', 'NO', 'NUMARA', 'NUMARASI', 'EMAIL', 'EPOSTA', 'PHONE', 'TELEFON', 'TEL', 'GSM']);
const FIXED = new Set(['TCKN', 'TC', 'KIMLIK', 'IBAN', 'UUID', 'GUID', 'HASH', 'MD5', 'SHA', 'SHA1', 'SHA256', 'CHECKSUM', 'VKN', 'IMEI', 'IMSI', 'ICCID', 'MSISDN']);
const LIST_IDS = new Set(['IDS', 'IDLER', 'IDLERI']);
const LIST_LAST = new Set(['LIST', 'LISTE', 'LISTESI', 'CODES', 'KODLAR', 'KODLARI', 'TAGS', 'ETIKETLER']);
const EAV_KEY = new Set(['ATTR', 'ATTRIBUTE', 'OZELLIK', 'PARAM', 'PARAMETRE', 'PARAMETER', 'PROPERTY', 'KEY', 'ANAHTAR', 'ALAN', 'FIELD']);
const EAV_VALUE = new Set(['VALUE', 'DEGER', 'DEGERI', 'VAL']);
const BOOL_NAME = /^(IS|HAS|CAN)_|_(FLAG|FL|YN|MI|MU)$|^(AKTIF|ACTIVE|ENABLED|SILINDI|DELETED|ONAYLI|APPROVED)$/;
const BOOL_CODES = [['E', 'H'], ['Y', 'N'], ['0', '1'], ['T', 'F'], ['TRUE', 'FALSE']];

// Ayrılmış kelimeler: Oracle'ın tırnaksız kullanılamayanları ve lehçeler arasında ortak olanlar
const RESERVED_COMMON = 'ALL AND AS ASC BETWEEN BY CASE CHECK COLUMN CREATE CURRENT_DATE CURRENT_USER DEFAULT DELETE DESC DISTINCT DROP ELSE END FOR FOREIGN FROM GRANT GROUP HAVING IN INDEX INSERT INTO IS JOIN KEY LIKE LIMIT NOT NULL OFFSET ON OR ORDER PRIMARY REFERENCES SELECT SET TABLE THEN TO UNION UNIQUE UPDATE USER VALUES WHEN WHERE WITH';
const RESERVED_ORACLE = 'ACCESS ADD ALTER ANY AUDIT CHAR CLUSTER COMMENT COMPRESS CONNECT CURRENT DATE DECIMAL EXCLUSIVE EXISTS FILE FLOAT IDENTIFIED IMMEDIATE INCREMENT INITIAL INTEGER INTERSECT LEVEL LOCK LONG MAXEXTENTS MINUS MLSLABEL MODE MODIFY NOAUDIT NOCOMPRESS NOWAIT NUMBER OF OFFLINE ONLINE OPTION PCTFREE PRIOR PRIVILEGES PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SESSION SHARE SIZE SMALLINT START SUCCESSFUL SYNONYM SYSDATE TRIGGER UID VALIDATE VARCHAR VARCHAR2 VIEW WHENEVER';
const RESERVED = {
  oracle: new Set((RESERVED_COMMON + ' ' + RESERVED_ORACLE).split(' ').filter(w => !['KEY', 'LIMIT', 'OFFSET', 'JOIN', 'CASE', 'END', 'FOREIGN', 'PRIMARY', 'REFERENCES', 'CURRENT_USER', 'CURRENT_DATE'].includes(w))),
  other: new Set(RESERVED_COMMON.split(' ')),
};
const NAME_MAX = { oracle: 128, postgres: 63, mysql: 64, mariadb: 64, tsql: 128 };
const ORACLE_OLD = 30;   // 12.1 ve öncesi
const SYSTEM_NAME = /^SYS_C\d+$|^(PK|FK|UQ|DF|CK)__.+__[0-9A-F]{6,}$/i;

/* ─── Denetim ─── */

function auditModel(model, opts = {}) {
  const findings = [];
  const skipped = [];
  const add = (rule, t, col, data, tables, severity) => findings.push({ rule, severity: severity || SEVERITY.get(rule), t: t || null, col: col || null, tables: tables || (t ? [t] : []), data: data || {} });
  // Dış ve gömülü tablolar dosyada tanımlı değil; MongoDB ve Cassandra'da PK, FK ve tip kuralları anlamsız
  const all = model.tables.filter(tb => !tb.external && !tb.embedded && !tb.dropped);
  const sql = all.filter(tb => tb.dialect !== 'mongodb' && tb.dialect !== 'cassandra');
  const inSql = new Set(sql);
  const rels = model.rels.filter(r => inSql.has(r.child));
  const fks = rels.filter(r => r.kind === 'fk');
  const colOf = (tb, name) => tb.colIdx.get(U(name));

  // Anahtarlar ve bütünlük
  // Kayıt, geçmiş ve olgu tabloları (log, CDR, _HIST, FACT_) çoğu zaman bilinçli olarak PK'siz ve FK'siz tutulur
  // pkStyle: baskın PK adlandırması (düzeltme önerisi eklenecek kolonu buna göre adlandırır)
  const profile = NS.namingProfile && sql.length >= 3 ? NS.namingProfile({ ...model, tables: sql }) : null;
  const pkDim = profile && profile.dims.find(d => d.id === 'pkStyle');
  const pkStyle = pkDim && pkDim.clear ? pkDim.dominant : null;
  for (const tb of sql) if (!tb.pk.length && !tb.noColumns) add('no-pk', tb, null, APPEND_ONLY.test(tb.name) ? { appendOnly: true } : { pkStyle }, null, APPEND_ONLY.test(tb.name) ? 'info' : null);
  for (const r of fks) {
    r.cols.forEach((c, i) => {
      const a = colOf(r.child, c), b = r.refCols[i] && colOf(r.parent, r.refCols[i]);
      if (!a || !b || !a.type || !b.type) return;
      if (typeMismatch(typeInfo(a.type), typeInfo(b.type))) add('fk-type-mismatch', r.child, a.name, { type: a.type, parent: r.parent, refCol: b.name, refType: b.type });
    });
    if (r.disabled) add('disabled-fk', r.child, r.cols.join(', '), { parent: r.parent, name: r.name, refCols: r.refCols });
  }
  for (const w of (model.stats && model.stats.warnings) || []) if (w.kind === 'ref' && w.t && inSql.has(w.t)) add('ref-broken', w.t, w.col, { target: w.target });
  for (const r of rels) if (r.kind === 'implicit' && !APPEND_ONLY.test(r.child.name)) add('fk-missing', r.child, r.cols.join(', '), { parent: r.parent, refCol: r.refCols[0] });

  // FK indeksi: dosyalarda hiç indeks yoksa indeksler döküme alınmamıştır; o zaman denetlenmez.
  // MySQL / MariaDB (InnoDB) FK için indeksi kendisi kurar.
  const hasIndexes = sql.some(tb => tb.indexes.length || tb.uniques.some(u => u.index));
  if (!hasIndexes && fks.length) skipped.push({ rule: 'fk-no-index', reason: 'noIndexes' });
  const keysOf = tb => [tb.pk.length ? { cols: tb.pk, name: tb.pkName, kind: 'pk' } : null, ...tb.uniques.map(u => ({ ...u, kind: 'uq' })), ...tb.indexes.map(x => ({ ...x, kind: 'ix' }))].filter(Boolean);
  const leads = (key, cols) => cols.length <= key.cols.length && cols.every(c => key.cols.slice(0, cols.length).some(k => U(k) === U(c)));
  if (hasIndexes) {
    for (const r of fks) {
      if (r.self && r.cols.length === 1 && r.child.pk.length === 1 && U(r.child.pk[0]) === U(r.cols[0])) continue;
      if (r.child.dialect === 'mysql' || r.child.dialect === 'mariadb') continue;
      if (!keysOf(r.child).some(k => leads(k, r.cols))) add('fk-no-index', r.child, r.cols.join(', '), { parent: r.parent });
    }
  }
  // Yinelenen indeks: biri öbürünün aynı sıradaki öneki (PK ve UNIQUE'in kendi indeksi de sayılır)
  for (const tb of sql) {
    const ks = keysOf(tb);
    ks.forEach((a, i) => ks.forEach((b, j) => {
      if (i === j || a.kind !== 'ix') return;
      const prefix = a.cols.length <= b.cols.length && a.cols.every((c, k) => U(c) === U(b.cols[k]));
      if (prefix && (a.cols.length < b.cols.length || j < i || b.kind !== 'ix')) add('duplicate-index', tb, a.cols.join(', '), { name: a.name, by: b.name, byCols: b.cols, byKind: b.kind });
    }));
  }

  // Döngüsel FK zinciri (kendine bağlanan hiyerarşiler hariç): Tarjan güçlü bağlı bileşenleri
  {
    const out = new Map(sql.map(tb => [tb, []]));
    for (const r of fks) if (!r.self && out.has(r.parent)) out.get(r.child).push(r.parent);
    let n = 0;
    const idx = new Map(), low = new Map(), on = new Set(), stack = [];
    const visit = v => {
      idx.set(v, n); low.set(v, n); n++;
      stack.push(v); on.add(v);
      for (const w of out.get(v)) {
        if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      }
      if (low.get(v) === idx.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) add('fk-cycle', null, null, {}, comp.sort((a, b) => String(a.name).localeCompare(String(b.name))));
      }
    };
    for (const tb of sql) if (!idx.has(tb)) visit(tb);
  }

  // İlişkisiz tablo: şemada hiç ilişki yoksa anlamsız
  if (rels.length) {
    const linked = new Set();
    for (const r of model.rels) { linked.add(r.child); linked.add(r.parent); }
    for (const tb of sql) if (!linked.has(tb) && !tb.dictionary) add('orphan-table', tb);
  }

  // Veri tipleri ve normalizasyon (kolon başına; "bilgi" düzeyindekiler tablo başına toplanır)
  const byName = new Map();
  const bools = new Map();
  for (const tb of sql) {
    const per = { 'number-no-precision': [], 'lob-for-short': [], 'oversized-text': [], 'char-for-variable': [] };
    const groups = new Map();
    let eavKey = null, eavValue = null;
    for (const c of tb.columns) {
      if (!c.type) continue;
      const ti = typeInfo(c.type);
      const w = words(c.name), lw = w[w.length - 1] || '';
      if (ti.family === 'text') {
        if (isDateName(w) && tb.dialect !== 'sqlite') add('date-as-text', tb, c.name, { type: c.type });
        else if (AMOUNT.has(lw) || QUANTITY.has(lw)) add('number-as-text', tb, c.name, { type: c.type });
        else if (LIST_IDS.has(lw) || (LIST_LAST.has(lw) && (ti.len == null || ti.len >= 100))) add('delimited-list', tb, c.name, { type: c.type });
        if (ti.len != null && ti.len >= 4000 && !ti.lob && !w.some(x => DESCRIPTIVE.has(x))) per['oversized-text'].push(c.name);
        if (ti.fixed && ti.len != null && ti.len >= 20 && !c.values && !w.some(x => FIXED.has(x))) per['char-for-variable'].push(c.name);
        if (ti.lob && SHORT.has(lw) && !(ti.base === 'TEXT' && (tb.dialect === 'postgres' || tb.dialect === 'sqlite'))) per['lob-for-short'].push(c.name);
      }
      if (ti.float && AMOUNT.has(lw)) add('money-as-float', tb, c.name, { type: c.type });
      if (tb.dialect === 'oracle' && ti.base === 'NUMBER' && ti.len == null) per['number-no-precision'].push(c.name);
      if (EAV_VALUE.has(lw)) eavValue = c.name;
      if (w.some(x => EAV_KEY.has(x)) && !EAV_VALUE.has(lw)) eavKey = eavKey || c.name;
      // tekrarlayan grup: TEL1, TEL2, TEL3 (aynı gövde, ardışık numara)
      const m = /^(.*?[A-Za-z\xC0-\u{FFFF}])_?(\d{1,2})$/u.exec(c.name);
      if (m) { const k = U(m[1]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c.name); }
      // aynı ad, farklı tip ailesi (ID ve PK kolonları hariç; onları FK denetimi karşılar)
      if (U(c.name) !== 'ID' && !c.pk && ti.family !== 'other' && !GENERIC.has(U(c.name))) {
        if (!byName.has(U(c.name))) byName.set(U(c.name), []);
        byName.get(U(c.name)).push({ t: tb, c, family: ti.family });
      }
      // mantıksal kolonların kodlaması
      const enc = boolEncoding(c, ti, w);
      if (enc) { if (!bools.has(enc)) bools.set(enc, []); bools.get(enc).push({ t: tb, c: c.name }); }
    }
    for (const [rule, cols] of Object.entries(per)) if (cols.length) add(rule, tb, null, { cols });
    for (const [stem, cols] of groups) if (cols.length >= 3) add('repeating-group', tb, null, { stem, cols });
    if (eavKey && eavValue) add('eav-pattern', tb, null, { key: eavKey, value: eavValue });
    if (tb.columns.length > WIDE_AT) add('wide-table', tb, null, { n: tb.columns.length, max: WIDE_AT });
  }
  for (const [, list] of byName) {
    const fams = new Map();
    for (const x of list) { if (!fams.has(x.family)) fams.set(x.family, []); fams.get(x.family).push(x); }
    if (fams.size < 2) continue;
    const variants = [...fams.values()].map(xs => ({ type: xs[0].c.type, tables: xs.map(x => x.t) })).sort((a, b) => b.tables.length - a.tables.length);
    add('same-name-diff-type', null, list[0].c.name, { variants }, [...new Set(list.map(x => x.t))]);
  }
  if (bools.size > 1) {
    const encodings = [...bools.entries()].map(([enc, cols]) => ({ enc, cols })).sort((a, b) => b.cols.length - a.cols.length);
    add('bool-inconsistent', null, null, { encodings }, [...new Set(encodings.flatMap(e => e.cols.map(x => x.t)))]);
  }

  // Adlandırma
  for (const tb of sql) {
    const max = NAME_MAX[tb.dialect];
    const reserved = RESERVED[tb.dialect === 'oracle' ? 'oracle' : 'other'];
    const names = [{ kind: 'table', name: tb.name, col: null }, ...tb.columns.map(c => ({ kind: 'column', name: c.name, col: c.name }))];
    const cons = [tb.pkName, ...tb.uniques.map(u => u.name), ...tb.indexes.map(x => x.name), ...tb.out.filter(r => r.kind === 'fk').map(r => r.name)].filter(Boolean);
    for (const x of names.concat(cons.map(name => ({ kind: 'constraint', name, col: null })))) {
      const len = x.name.length;
      if (max && len > max) add('name-too-long', tb, x.col, { name: x.name, kind: x.kind, len, max });
      else if (tb.dialect === 'oracle' && len > ORACLE_OLD) add('name-too-long', tb, x.col, { name: x.name, kind: x.kind, len, max: ORACLE_OLD, old: true });
    }
    for (const x of names) if (reserved.has(U(x.name))) add('reserved-word', tb, x.col, { name: x.name, kind: x.kind });
    const nonAscii = names.filter(x => /[^\x00-\x7F]/.test(x.name)).map(x => x.name);
    if (nonAscii.length) add('non-ascii-name', tb, null, { names: nonAscii });
    const sys = cons.filter(n => SYSTEM_NAME.test(n));
    if (sys.length) add('system-name', tb, null, { names: sys });
  }
  // Baskın kalıp belirginse (%60 ve üstü) ona uymayanlar; kural dosyası gelince standart oradan okunacak
  const samePk = it => it.ref && it.ref.pk.length === 1 && U(it.ref.pk[0]) === U(it.c);
  if (profile) {
    const dimRule = { pkStyle: 'pk-style', fkStyle: 'fk-style', tableCase: 'naming-case', columnCase: 'naming-case' };
    for (const d of profile.dims) {
      const rule = dimRule[d.id];
      if (!rule || !d.clear) continue;
      for (const b of d.buckets) {
        if (b.neutral || b.key === d.dominant) continue;
        // Rol adlı FK (BILLING_ADDRESS_ID, NationalityId) ve hedefin PK adıyla aynı FK (CURRENCY_CODE) iyi uygulamadır; yalnızca
        // ID ile bitmeyen belirsiz adlar (CHZ_REF, MUSTERI_REF, ASSIGNED_TO) işaretlenir. Sözlüğe giden FK sözlüğün kendi kalıbını izler.
        // Metin tipli doğal anahtar (para birimi kodu) bilinçli bir seçimdir; pk-style'da sayılmaz.
        if (rule === 'fk-style' && !FK_FLAG.has(b.key)) continue;
        for (const it of b.items) {
          if (rule === 'fk-style' && ((it.ref && it.ref.dictionary) || last(it.c) === 'ID' || samePk(it))) continue;
          if (rule === 'pk-style' && it.c && typeInfo((it.t.colIdx.get(U(it.c)) || {}).type).family === 'text') continue;
          add(rule, it.t, it.c, { dim: d.id, style: b.key, dominant: d.dominant, ref: it.ref || null });
        }
      }
    }
  }

  const order = new Map(AUDIT_RULES.map((r, i) => [r.id, i]));
  findings.sort((a, b) => order.get(a.rule) - order.get(b.rule) || String(a.t ? a.t.name : '').localeCompare(String(b.t ? b.t.name : '')) || String(a.col || '').localeCompare(String(b.col || '')));
  const byTable = new Map();
  for (const f of findings) for (const tb of f.tables) { if (!byTable.has(tb)) byTable.set(tb, []); byTable.get(tb).push(f); }
  const keys = new Set(opts.debt || []);
  const seen = new Set();
  const counts = { error: 0, warning: 0, info: 0 }, debtCounts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) {
    f.key = findingKey(f, opts.nameOf);
    f.debt = keys.has(f.key);
    if (f.debt) seen.add(f.key);
    (f.debt ? debtCounts : counts)[f.severity]++;
  }
  const clean = sql.filter(tb => !(byTable.get(tb) || []).some(f => f.severity !== 'info' && !f.debt)).length;
  const debt = opts.debt ? { total: keys.size, left: seen.size, paid: [...keys].filter(k => !seen.has(k)), counts: debtCounts } : null;
  return { findings, byTable, counts, skipped, tables: sql.length, clean, debt };
}

// Bulgunun kalıcı kimliği: tablo nesneleri her kurulumda yenilenir, ad ve kolonlar kalır.
// Tablo düzeyindeki toplu bulgularda kolon listesi de kimliğe girer: listeye yeni kolon eklenirse bulgu yeniden görünür.
// nameOf: tablo → ad (değişiklik incelemesinde adı değişen tablonun eski bulguları yeni adıyla eşleşsin diye)
function findingKey(f, nameOf) {
  const tn = tb => U(nameOf ? nameOf(tb) : (tb.schema ? tb.schema + '.' : '') + tb.name);
  const where = f.t ? tn(f.t) : f.tables.map(tn).sort().join('+');
  const list = f.col ? [f.col] : f.data.cols || f.data.names || [];
  return f.rule + ':' + where + (list.length ? '.' + list.map(U).sort().join(',') : '');
}

// Mantıksal kolonun kodlaması: BOOLEAN, izin verilen değerler (E/H, Y/N, 0/1 ...) ya da adı mantıksal gibi duran NUMBER(1)
function boolEncoding(c, ti, w) {
  if (ti.family === 'bool') return 'BOOLEAN';
  if (c.values && c.values.length === 2) {
    const codes = c.values.map(v => U(v.code)).sort();
    const hit = BOOL_CODES.find(p => p.slice().sort().join() === codes.join());
    if (hit) return hit.join('/');
  }
  if (BOOL_NAME.test(w.join('_')) && ti.family === 'number' && ti.len === 1) return 'NUMBER(1)';
  return null;
}

// Değişiklik incelemesi (PR, yeni migration): "sonra"da olup "önce"de olmayan bulgular bu değişiklikle gelmiştir, tersi
// giderilmiştir. Adı değişen tablolar farktan eşlenir; eski bulgu yeni adıyla "yeni" görünmez. Borç kaydındakiler sayılmaz.
//   reviewChange(before, after, { diff, debt }) → { diff, findings, fixed, counts, before, after }
function reviewChange(before, after, opts = {}) {
  const diff = opts.diff || NS.diffModels(before, after);
  const renamed = new Map();
  for (const e of diff.tables) if (e.renamed && e.before && e.after) renamed.set(e.before, (e.after.schema ? e.after.schema + '.' : '') + e.after.name);
  const nameOf = tb => renamed.get(tb) || (tb.schema ? tb.schema + '.' : '') + tb.name;
  const a0 = auditModel(before, { debt: opts.debt, nameOf }), a1 = auditModel(after, { debt: opts.debt });
  const old = new Set(a0.findings.map(f => f.key)), now = new Set(a1.findings.map(f => f.key));
  // önce denetlenemeyen kural (dökümde indeks yoktu) sonra çalışırsa değişmeyen tablolardaki bulguları yeni değildir
  const skippedBefore = new Set(a0.skipped.map(x => x.rule));
  const touched = f => f.tables.some(tb => { const e = diff.byAfter.get(tb); return !e || e.status !== 'same'; });
  const findings = a1.findings.filter(f => !old.has(f.key) && !f.debt && (!skippedBefore.has(f.rule) || touched(f)));
  const fixed = a0.findings.filter(f => !now.has(f.key));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return { diff, findings, fixed, counts, before: a0, after: a1 };
}

Object.assign(NS, { auditModel, reviewChange, AUDIT_RULES, typeInfo, findingKey });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
