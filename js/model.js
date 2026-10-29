/*
 * sqlSchema · model.js
 * Ayrıştırıcıların ürettiği işlem listelerini dosya sırasıyla uygular ve görselleştirmenin
 * kullandığı modeli kurar: tablolar, ilişkiler, kardinalite, ara tablolar, tahmini ilişkiler.
 *
 * Uç türleri (karga ayağı):
 *   'one'      ||   tam olarak bir      FK kolonu NOT NULL; gömülü belgenin sahibi
 *   'zeroOne'  o|   sıfır ya da bir     FK kolonu NULL olabilir; ya da 1:1 ilişkinin çocuk tarafı
 *   'zeroMany' o<   sıfır ya da çok     FK'yi taşıyan tarafın varsayılanı
 *   'oneMany'  |<   bir ya da çok       DDL ile zorlanamaz; yalnızca lejantta
 *
 * İlişki türleri: 'fk' tanımlı, 'ref' kolon açıklamasındaki @ref etiketiyle tanımlı,
 * 'implicit' kolon adından tahmin, 'embed' MongoDB gömülü belge.
 *
 * @ref etiketi, FK ile ifade edilemeyen ilişkiler içindir; en sık örneği genel sözlük tablosunun
 * yalnızca bir tipine bağlanan kolonlardır. Açıklamanın herhangi bir yerinde:
 *   @ref TABLO                     hedefin PK'sine
 *   @ref TABLO.KOLON               belli bir kolona (TABLO.KOLON yoksa ŞEMA.TABLO sayılır)
 *   @ref ŞEMA.TABLO.KOLON
 *   @ref SOZLUK.ID (TIP_ID = 7)    parantez içi koşul ilişkinin üstüne yazılır
 *
 * Sözlük tablosu: en az iki koşullu ilişkinin hedefi olan tablo (genel kod tablosu). t.dictionary ve
 * ona giden ilişkilerde r.dict işaretlenir; harita bu çizgileri rozetle gösterir, yerleşim onları
 * ağırlık saymaz. opts.dictionaries (tablo anahtarı → boolean) kullanıcının elle seçimidir.
 */
(function (NS) {
'use strict';

const AUDIT_COL = /^(CREATED|CREATE|UPDATED|UPDATE|MODIFIED|MODIFY|INSERTED|INSERT|INS|UPD|LAST_UPDATED|LAST_MODIFIED|LAST_UPDATE|LAST_MODIFY)_?(AT|ON|BY|DATE|DT|TS|TIME|TIMESTAMP|USER|USR)?$|^(START|END|VALID|EFFECTIVE|EXPIRY)_?(DATE|DT|FROM|TO|TS)$|^(VALID_FROM|VALID_TO|SORT_ORDER|IS_ACTIVE|ACTIVE|ROLE|ROLE_CODE|ADDRESS_ROLE|PRIORITY|SEQ|SEQ_NO|VERSION|ROW_VERSION)$/i;
const ID_SUFFIX = /^(.+?)_?(ID|NO|NUM|CODE|CD|KEY)$/i;
const IDS_SUFFIX = /^(.+?)_?IDS$/i;
const LOOKUP_NAME = /(STATUS|TYPE|REASON|CATEGORY|CLASS|KIND|LEVEL|PRIORITY)S?$/i;
const REF_PART = '(?:"[^"]+"|[\\p{L}\\p{N}_$#]+)';
const REF_TAG = new RegExp(`@ref\\s+(${REF_PART}(?:\\.${REF_PART}){0,2})(?:\\s*\\(([^)]*)\\))?`, 'iu');
const refParts = s => s.match(new RegExp(REF_PART, 'gu')).map(p => p.replace(/^"|"$/g, ''));

/*
 * Açıklamadaki değer listesi: "1 = Aktif, 2 = Pasif" · "A: Aktif; P: Pasif" · "E-Evet / H-Hayır".
 * Kodun anlamı ayrı bir sözlük tablosunda değil açıklamada yazılıdır. Yanlış yakalamaya karşı:
 * en az iki ardışık çift, aynı ayraç, kod gibi görünen kısa kodlar (1, A, AKTIF, active; "Kaynak" değil).
 */
const VALUE_PAIR = /(?<![\p{L}\p{N}_])([\p{L}\p{N}_]{1,12})\s*(=>|->|→|=|:|–|-)\s*([^=:]+?)\s*$/u;
const CODE_LIKE = /^(?:\p{N}+|[\p{Lu}\p{N}_]+|[\p{Ll}\p{N}_]+)$/u;

// Dönen dizinin .rest alanı, açıklamanın listeden geriye kalan kısmıdır ("Abone durumu"); panel onu ayrıca yazar
function valuesFromComment(text) {
  if (!text) return null;
  const s = String(text).replace(new RegExp(REF_TAG.source, 'giu'), ' ');
  const segs = s.split(/\s*[,;|\n]\s*|\s+\/\s+/);
  let best = [], run = [], sep = null;
  const flush = () => { if (run.length > best.length) best = run; run = []; sep = null; };
  segs.forEach((seg, i) => {
    const m = VALUE_PAIR.exec(seg);
    const dash = m && (m[2] === '-' || m[2] === '–');
    const parts = m ? m[3].split(/\.\s/) : [];
    const label = m && parts[0].replace(/[\s.)\]]+$/, '').trim();
    if (!m || !CODE_LIKE.test(m[1]) || (dash && !/^[\p{Lu}\p{N}]{1,4}$/u.test(m[1])) || !label || label.length > 60) { flush(); return; }
    if ((sep && sep !== m[2]) || run.some(v => v.code === m[1])) flush();
    run.push({ code: m[1], label, i, before: seg.slice(0, m.index), after: parts.slice(1).join('. ') });
    sep = m[2];
  });
  flush();
  if (best.length < 2) return null;
  const used = new Set(best.map(v => v.i));
  const rest = [];
  segs.forEach((seg, i) => {
    if (!used.has(i)) rest.push(seg);
    else {
      const v = best.find(x => x.i === i);
      if (v.before.trim()) rest.push(v.before);
      if (v.after.trim()) rest.push(v.after);
    }
  });
  const list = best.map(v => ({ code: v.code, label: v.label }));
  list.rest = rest.map(x => x.replace(/[\s:(.\-–]+$/, '').trim()).filter(Boolean).join(' · ') || null;
  return list;
}

function typeFamily(type) {
  const t = String(type || '').toUpperCase();
  if (!t) return '';
  if (/^(NUMBER|NUMERIC|DECIMAL|INT|INTEGER|BIGINT|SMALLINT|TINYINT|MEDIUMINT|SERIAL|BIGSERIAL|SMALLSERIAL|FLOAT|DOUBLE|REAL|BINARY_|MONEY|COUNTER|VARINT|LONG)/.test(t)) return 'num';
  if (/^(VARCHAR|NVARCHAR|CHAR|NCHAR|CHARACTER|TEXT|NTEXT|STRING|CLOB|NCLOB|VARCHAR2|NVARCHAR2|CITEXT|ASCII)/.test(t)) return 'str';
  if (/^(UUID|TIMEUUID|UNIQUEIDENTIFIER|RAW|OBJECTID|ARRAY<OBJECTID)/.test(t)) return 'uid';
  if (/^(ANY|MIXED|NULL)/.test(t)) return '';
  return 'other';
}

const ROWS_MAX = 5000;   // tablo başına tutulan veri satırı (INSERT)
const LABEL_COL = /^(AD|ADI|ISIM|NAME|ACIKLAMA|DESCRIPTION|DESC|TANIM|LABEL|TITLE|BASLIK|METIN|TEXT|DEGER|VALUE|DISPLAY_NAME)$/;

// @ref koşulu "TIP_ID = 7 AND DIL = 'TR'": yalnızca kolon = sabit eşitlikleri; başka biçimde null
function parseFilter(text) {
  if (!text) return [];
  const out = [];
  for (const part of String(text).split(/\s+AND\s+/i)) {
    const m = /^\s*"?([\p{L}\p{N}_$#]+)"?\s*=\s*(?:'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?))\s*$/u.exec(part);
    if (!m) return null;
    out.push({ col: m[1].toUpperCase(), val: m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3] });
  }
  return out;
}

/*
 * Sözlük verisi: hedef tablonun INSERT satırları varsa, bağlantının koşuluna uyan satırlar kolonun
 * değerleri olur (kod = hedef kolon, anlam = AD / ACIKLAMA / NAME gibi bir kolon). Kolonun kendi
 * CHECK / açıklama listesi öncelikli; orada anlamı eksik kodların anlamı sözlükten tamamlanır.
 */
function valuesFromRows(r, U) {
  const p = r.parent;
  if (!p.rows || !p.rows.length || r.cols.length !== 1 || r.kind === 'implicit' || r.kind === 'embed') return null;
  const filter = parseFilter(r.filter);
  // koşulsuz bağlantıda sözlüğün hangi tipinin geçerli olduğu bilinmez; bütün satırları göstermek yanıltır
  if (!filter || (p.dictionary && !filter.length)) return null;
  const key = U(r.refCols[0]);
  const rows = p.rows.filter(row => row[key] != null && filter.every(f => String(row[f.col]) === f.val));
  if (!rows.length || rows.length > 200) return null;
  const skip = new Set([key, ...filter.map(f => f.col)]);
  const cols = p.columns.map(c => U(c.name)).filter(n => !skip.has(n) && rows.some(row => row[n] != null));
  const labelCol = cols.find(n => LABEL_COL.test(n)) || cols.find(n => typeFamily(p.colIdx.get(n) && p.colIdx.get(n).type) === 'str');
  return rows.map(row => ({ code: String(row[key]), label: labelCol && row[labelCol] != null ? String(row[labelCol]) : null }));
}

// MySQL ENUM('a','b') / SET('a','b') tipindeki değerler
function enumFromType(type) {
  const m = /^(?:enum|set)\s*\((.*)\)$/is.exec(String(type || '').trim());
  if (!m) return null;
  const vals = [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map(x => x[1].replace(/''/g, "'"));
  return vals.length ? vals : null;
}

/*
 * Kolonun kod değerleri: c.values = [{ code, label }], c.valuesSrc nereden okunduğunu söyler.
 *   'check' CHECK kısıtı · 'enum' ENUM tipi ya da MongoDB enum · 'comment' açıklamadaki liste
 * İzin verilen değerler kısıttan ya da tipten gelir; anlamları açıklamada yazılıysa etiket olarak eklenir.
 * c.commentUsed: açıklamadaki liste kullanıldı, panel açıklamanın yalnızca kalanını (c.valuesNote) yazar.
 */
function setValues(c) {
  const fromComment = valuesFromComment(c.comment);
  const typeEnum = enumFromType(c.type);
  const allowed = c.allowed || typeEnum;
  c.values = null;
  c.valuesSrc = null;
  c.commentUsed = false;
  c.valuesNote = null;
  if (allowed) {
    const label = code => { const v = fromComment && fromComment.find(x => x.code.toUpperCase() === String(code).toUpperCase()); return v ? v.label : null; };
    c.values = allowed.map(code => ({ code: String(code), label: label(code) }));
    c.valuesSrc = c.allowed ? (c.allowedSrc || 'check') : 'enum';
    if (fromComment && c.values.some(v => v.label)) { c.commentUsed = true; c.valuesNote = fromComment.rest; }
  } else if (fromComment) {
    c.values = fromComment.slice();
    c.valuesSrc = 'comment';
    c.commentUsed = true;
    c.valuesNote = fromComment.rest;
  }
}

function buildModel(inputs, opts = {}) {
  const U = s => String(s == null ? '' : s).toUpperCase();
  const tables = new Map();   // anahtar → tablo
  const byName = new Map();   // db|AD → [tablo]
  const aliases = new Map();  // RENAME öncesi anahtar → tablo
  const warnings = [];
  const orphans = [];
  const embeds = [];
  const states = [];
  let nextId = 0;

  const keyOf = (db, schema, name) => db + '|' + U(schema) + '.' + U(name);
  const split = parts => (parts.length >= 2 ? [parts[parts.length - 2], parts[parts.length - 1]] : [null, parts[0]]);
  const where = op => (op.file ? `${op.file}:${op.line}` : `#${op.line}`);

  function index(t) {
    const k = t.db + '|' + U(t.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(t);
  }
  function unindex(t) {
    const list = byName.get(t.db + '|' + U(t.name));
    if (list) list.splice(list.indexOf(t), 1);
  }
  function mk(db, schema, name, external) {
    const t = {
      id: nextId++, key: keyOf(db, schema, name), db, schema: schema || '', name,
      columns: [], colIdx: new Map(), pk: [], pkName: null, uniques: [], comment: null,
      external: !!external, embedded: false, junction: false, dialect: null,
      out: [], inc: [], fkDefs: [], colRenames: new Map(), src: null, files: [],
    };
    tables.set(t.key, t);
    index(t);
    return t;
  }
  function addCol(t, col) {
    const k = U(col.name);
    const prev = t.colIdx.get(k);
    if (prev) { Object.assign(prev, col); return prev; }
    const c = { ...col };
    t.columns.push(c);
    t.colIdx.set(k, c);
    return c;
  }
  const getCol = (t, name) => t.colIdx.get(U(name));
  const touch = (t, op) => { if (op.file && !t.files.includes(op.file)) t.files.push(op.file); };

  function find(db, parts, fromSchema) {
    if (!parts || !parts.length) return null;
    const [s, n] = split(parts);
    if (s) {
      const k = keyOf(db, s, n);
      const t = tables.get(k) || aliases.get(k);
      if (t && !t.dropped) return t;
    } else if (fromSchema !== undefined) {
      const t = tables.get(keyOf(db, fromSchema, n));
      if (t) return t;
    }
    const list = (byName.get(db + '|' + U(n)) || []).filter(t => !t.dropped);
    if (!list.length) {
      if (!s) {
        for (const [k, t] of aliases) if (!t.dropped && k.startsWith(db + '|') && k.endsWith('.' + U(n))) return t;
      }
      return null;
    }
    if (list.length === 1) return list[0];
    const want = U(s || fromSchema || '');
    return list.find(t => U(t.schema) === want) || list.find(t => !t.external) || list[0];
  }

  // MongoDB koleksiyonları için varsayılan şema: aynı veritabanında en çok kullanılan Mongo şeması
  function mongoSchema(db) {
    const count = new Map();
    for (const t of tables.values()) if (t.db === db && t.dialect === 'mongodb' && t.schema) count.set(t.schema, (count.get(t.schema) || 0) + 1);
    let best = 'mongo', n = 0;
    for (const [s, c] of count) if (c > n) { best = s; n = c; }
    return best;
  }

  function mergeDef(t, def, op) {
    for (const col of def.columns) {
      const ex = getCol(t, col.name);
      if (!ex) { addCol(t, col); continue; }
      if (!ex.type || /^(mixed|any|null)$/i.test(ex.type)) ex.type = col.type;
      if (col.nullable === false) ex.nullable = false;
      if (!ex.comment && col.comment) ex.comment = col.comment;
      if (!ex.allowed && col.allowed) { ex.allowed = col.allowed; ex.allowedSrc = col.allowedSrc; }
      if (col.embedded) ex.embedded = true;
    }
    if (def.embedded) t.embedded = true;
    touch(t, op);
  }

  function create(op, input, schemaOverride) {
    const [s, n] = split(op.t);
    const schema = schemaOverride !== undefined ? schemaOverride : s;
    const key = keyOf(input.db, schema, n);
    let t = tables.get(key);
    if (t && !t.external && !t.dropped) {
      warnings.push({ kind: 'dup', name: t.name, a: where(t.src), b: where(op) });
      t.columns = []; t.colIdx = new Map(); t.pk = []; t.pkName = null; t.uniques = []; t.fkDefs = [];
    }
    if (!t || t.dropped) t = mk(input.db, schema, n);
    t.external = false;
    t.dialect = input.dialect;
    t.src = { file: op.file, line: op.line };
    touch(t, op);
    for (const col of op.def.columns) addCol(t, col);
    if (op.def.comment) t.comment = op.def.comment;
    t.noColumns = !!op.def.noColumns;
    t.embedded = !!op.def.embedded;
    return t;
  }

  // false: tablo henüz yok, işlem sona saklanır
  function apply(op, input, last) {
    const db = input.db;
    if (op.op === 'create') {
      if (op.merge) {
        const ex = find(db, op.t);
        if (ex) { mergeDef(ex, op.def, op); return true; }
        if (!last && op.t.length < 2) return false;
        create(op, input, op.t.length < 2 ? mongoSchema(db) : undefined);
        return true;
      }
      create(op, input);
      return true;
    }
    if (op.op === 'embed') { embeds.push({ ...op, db }); return true; }
    if (op.op === 'state') { states.push({ ...op, db }); return true; }
    const t = find(db, op.t);
    // DROP TABLE IF EXISTS çoğu dökümde CREATE'ten hemen önce gelir; olmayan tabloyu silmek bir şey yapmaz
    if (!t) return op.op === 'drop';
    if (op.op !== 'rows') touch(t, op);   // veri dosyası tablonun tanımlandığı dosyalardan sayılmaz
    switch (op.op) {
      case 'fk':
        t.fkDefs.push({ ...op, db });
        break;
      case 'pk':
        for (const c of t.columns) c.pk = false;
        t.pk = op.cols.map(c => (getCol(t, c) || { name: c }).name);
        t.pkName = op.name || null;
        if (op.partition) t.partition = op.partition.map(c => (getCol(t, c) || { name: c }).name);
        for (const c of op.cols) { const col = getCol(t, c); if (col) { col.pk = true; col.nullable = false; } }
        break;
      case 'uq':
        t.uniques.push({ cols: op.cols.slice(), name: op.name || null });
        break;
      case 'addcol':
        addCol(t, op.col);
        break;
      case 'dropcol': {
        const col = getCol(t, op.col);
        if (!col) break;
        t.columns.splice(t.columns.indexOf(col), 1);
        t.colIdx.delete(U(op.col));
        const gone = x => U(x) === U(op.col);
        t.pk = t.pk.filter(x => !gone(x));
        t.uniques = t.uniques.filter(u => !u.cols.some(gone));
        t.fkDefs = t.fkDefs.filter(f => !f.cols.some(gone));
        break;
      }
      case 'renamecol': {
        const col = getCol(t, op.col);
        if (!col) break;
        t.colIdx.delete(U(op.col));
        col.name = op.to;
        t.colIdx.set(U(op.to), col);
        t.colRenames.set(U(op.col), op.to);
        const ren = x => (U(x) === U(op.col) ? op.to : x);
        t.pk = t.pk.map(ren);
        for (const u of t.uniques) u.cols = u.cols.map(ren);
        for (const f of t.fkDefs) f.cols = f.cols.map(ren);
        break;
      }
      case 'null': {
        const col = getCol(t, op.col);
        if (col) col.nullable = op.nullable;
        break;
      }
      case 'type': {
        const col = getCol(t, op.col);
        if (col && op.type) col.type = op.type;
        break;
      }
      case 'tcomment':
        if (op.text) t.comment = op.text;
        break;
      case 'ccomment': {
        const col = getCol(t, op.col);
        if (col && op.text) col.comment = op.text;
        break;
      }
      case 'check': {
        const col = getCol(t, op.col);
        if (col) { col.allowed = op.values.slice(); col.allowedSrc = 'check'; }
        break;
      }
      case 'rows': {
        // satırlar kolon adına göre tutulur; INSERT'ler farklı kolon sıraları kullanabilir
        const names = (op.cols || t.columns.map(c => c.name)).map(U);
        t.rows = t.rows || [];
        for (const r of op.rows) {
          if (t.rows.length >= ROWS_MAX) break;
          const o = {};
          names.forEach((n, i) => { if (i < r.length && r[i] !== undefined) o[n] = r[i]; });
          t.rows.push(o);
        }
        break;
      }
      case 'drop':
        t.dropped = true;
        tables.delete(t.key);
        unindex(t);
        break;
      case 'rename': {
        const old = t.key;
        unindex(t);
        tables.delete(old);
        aliases.set(old, t);
        t.name = op.to;
        t.key = keyOf(db, t.schema, op.to);
        const clash = tables.get(t.key);
        if (clash && clash !== t) { clash.dropped = true; unindex(clash); }
        tables.set(t.key, t);
        index(t);
        break;
      }
      case 'dropcon': {
        const n = U(op.name);
        t.fkDefs = t.fkDefs.filter(f => U(f.name) !== n);
        t.uniques = t.uniques.filter(u => U(u.name) !== n);
        if (t.pkName && U(t.pkName) === n) { t.pk = []; t.pkName = null; }
        break;
      }
      case 'droppk':
        t.pk = [];
        t.pkName = null;
        break;
      case 'renamecon': {
        const n = U(op.name);
        for (const f of t.fkDefs) if (U(f.name) === n) f.name = op.to;
        for (const u of t.uniques) if (U(u.name) === n) u.name = op.to;
        if (t.pkName && U(t.pkName) === n) t.pkName = op.to;
        break;
      }
    }
    return true;
  }

  const pending = [];
  for (const input of inputs) for (const op of input.ops) if (!apply(op, input, false)) pending.push([op, input]);
  // ALTER / COMMENT / FK dosya sırasında tablodan önce gelmiş olabilir: bir tur daha
  for (const [op, input] of pending) {
    if (!apply(op, input, true)) orphans.push({ where: where(op), text: `${op.op.toUpperCase()} ${op.t.join('.')}` });
  }

  const alive = () => [...tables.values()].filter(t => !t.dropped);
  for (const t of alive()) {
    for (const c of t.columns) {
      if (t.pk.some(p => U(p) === U(c.name))) { c.pk = true; c.nullable = false; }
      setValues(c);
    }
  }

  // Tanımlı FK'ler
  const rels = [];
  const seen = new Set();
  for (const t of alive()) {
    for (const fd of t.fkDefs) {
      let parent = find(fd.db, fd.ref, t.schema);
      if (!parent) {
        const [s, n] = split(fd.ref);
        parent = mk(fd.db, s || t.schema, n, true);
        parent.dialect = t.dialect;
      }
      let refCols = fd.refCols ? fd.refCols.map(c => parent.colRenames.get(U(c)) || c) : (parent.pk.length ? parent.pk.slice() : fd.cols.slice());
      if (parent.external) {
        refCols.forEach((rc, i) => {
          if (!getCol(parent, rc)) {
            const srcCol = getCol(t, fd.cols[i]);
            addCol(parent, { name: rc, type: srcCol ? srcCol.type : '', nullable: false, pk: !fd.refCols || !parent.pk.length, comment: null });
          }
        });
        if (!parent.pk.length && !fd.refCols) parent.pk = refCols.slice();
      }
      const dedupe = t.key + '|' + fd.cols.map(U).join(',') + '|' + parent.key;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      rels.push({
        id: rels.length, kind: 'fk', child: t, parent,
        cols: fd.cols.map(c => (getCol(t, c) || { name: c }).name), refCols,
        name: fd.name, disabled: !!fd.disabled, onDelete: fd.onDelete, many: !!fd.many, label: fd.label || null,
        src: { file: fd.file, line: fd.line },
      });
    }
  }
  // Açıklamadaki @ref etiketleri. Kolonda zaten FK varsa yalnızca koşulu ona eklenir.
  for (const t of alive()) {
    if (t.external) continue;
    for (const c of t.columns) {
      const m = c.comment && REF_TAG.exec(c.comment);
      if (!m) continue;
      const parts = refParts(m[1]);
      let parent = null, col = null;
      if (parts.length === 3) { parent = find(t.db, parts.slice(0, 2), t.schema); col = parts[2]; }
      else if (parts.length === 2) {
        const asTable = find(t.db, [parts[0]], t.schema);
        if (asTable && getCol(asTable, parts[1])) { parent = asTable; col = parts[1]; }
        else parent = find(t.db, parts, t.schema);
      } else parent = find(t.db, parts, t.schema);
      if (!parent || parent.dropped || (col && !getCol(parent, col)) || (!col && parent.pk.length !== 1)) {
        warnings.push({ kind: 'ref', name: t.name + '.' + c.name, target: m[1] });
        continue;
      }
      const refCol = col ? getCol(parent, col).name : parent.pk[0];
      const filter = m[2] ? m[2].trim() : null;
      const ex = rels.find(r => r.child === t && r.cols.length === 1 && U(r.cols[0]) === U(c.name) && r.parent === parent);
      if (ex) { ex.filter = filter; continue; }
      rels.push({
        id: rels.length, kind: 'ref', child: t, parent, cols: [c.name], refCols: [refCol], filter,
        name: null, disabled: false, onDelete: null, many: false, label: null, src: t.src,
      });
    }
  }
  for (const st of states) {
    const t = find(st.db, st.t);
    for (const r of rels) {
      if ((t && r.child !== t) || r.kind !== 'fk') continue;
      if ((r.name && U(r.name) === U(st.name)) || U(st.name) === 'ALL') r.disabled = st.disabled;
    }
  }
  // Gömülü belgeler
  for (const e of embeds) {
    const owner = find(e.db, e.t), child = find(e.db, e.child);
    if (!owner || !child) continue;
    child.embedded = true;
    child.owner = owner;
    rels.push({ id: rels.length, kind: 'embed', child, parent: owner, cols: [e.field], refCols: [], name: null, disabled: false, onDelete: null, many: !!e.many, src: { file: e.file, line: e.line } });
  }

  const all = alive();
  const condRefs = new Map();
  for (const r of rels) if (r.filter && !r.self) condRefs.set(r.parent, (condRefs.get(r.parent) || 0) + 1);
  for (const t of all) {
    const forced = opts.dictionaries && opts.dictionaries.get(t.key);
    t.dictionary = typeof forced === 'boolean' ? forced : (condRefs.get(t) || 0) >= 2;
  }
  inferImplicit(all, rels, getCol, U);

  // Kardinalite ve komşuluk
  for (const r of rels) {
    const cols = r.cols.map(n => getCol(r.child, n));
    if (r.kind === 'embed') {
      r.parentEnd = 'one';
      r.childEnd = r.many ? 'zeroMany' : 'zeroOne';
      r.oneToOne = !r.many;
    } else if (r.many) {
      r.parentEnd = 'zeroMany';
      r.childEnd = 'zeroMany';
      r.oneToOne = false;
    } else {
      const mandatory = cols.length > 0 && cols.every(c => c && !c.nullable);
      r.parentEnd = mandatory ? 'one' : 'zeroOne';
      const set = new Set(r.cols.map(U));
      const sameSet = u => u.length === set.size && u.every(x => set.has(U(x)));
      r.oneToOne = (r.child.pk.length > 0 && sameSet(r.child.pk)) || r.child.uniques.some(u => sameSet(u.cols));
      r.childEnd = r.oneToOne ? 'zeroOne' : 'zeroMany';
    }
    r.self = r.child === r.parent;
    r.dict = !!r.parent.dictionary && !r.self && r.kind !== 'embed';
    r.child.out.push(r);
    r.parent.inc.push(r);
    if (r.kind !== 'embed') for (const c of cols) if (c) c.fk = true;
  }

  // Sözlük verisi: bağlantının hedefindeki INSERT satırlarından kolonun kod değerleri
  for (const r of rels) {
    const vals = valuesFromRows(r, U);
    const col = vals && getCol(r.child, r.cols[0]);
    if (!col) continue;
    if (!col.values) {
      col.values = vals;
      col.valuesSrc = 'dict';
      col.valuesFrom = r.parent.name + (r.filter ? ' · ' + r.filter : '');
    } else {
      for (const v of col.values) {
        const d = !v.label && vals.find(x => x.code.toUpperCase() === v.code.toUpperCase());
        if (d && d.label) v.label = d.label;
      }
    }
  }

  // Ara tablolar (M:N):
  //   klasik   PK'nin en az iki kolonu farklı FK'lerden gelir   (ROLE_PERMISSION)
  //   vekil    tek kolonlu kendi PK'si + iki FK, başka veri yok  (ID, A_ID, B_ID)
  for (const t of all) {
    // MongoDB ve Cassandra'da "ara tablo" kavramı yok: Cassandra'daki x_by_y tabloları sorgu için çoğaltılmış veridir
    if (t.external || t.embedded || t.dialect === 'mongodb' || t.dialect === 'cassandra' || t.inc.length) continue;
    const outs = t.out.filter(r => !r.self);
    if (outs.length < 2 || outs.length > 4) continue;
    const fkCols = new Set(outs.flatMap(r => r.cols.map(U)));
    const pkU = t.pk.map(U);
    const others = t.columns.filter(c => !fkCols.has(U(c.name)) && !pkU.includes(U(c.name)) && !AUDIT_COL.test(c.name));
    const classic = pkU.length >= 2 && outs.filter(r => r.cols.some(c => pkU.includes(U(c)))).length >= 2;
    const surrogate = outs.length === 2 && pkU.length <= 1 && !outs.some(r => LOOKUP_NAME.test(r.parent.name));
    if ((classic && others.length <= 2) || (surrogate && others.length === 0)) t.junction = true;
  }

  for (const t of all) {
    const nb = new Set();
    for (const r of t.out.concat(t.inc)) {
      const o = r.child === t ? r.parent : r.child;
      if (o !== t) nb.add(o);
    }
    t.deg = nb.size;
  }

  // Rapor
  const fkRels = rels.filter(r => r.kind === 'fk');
  const skipped = new Map();
  const errors = [];
  for (const input of inputs) {
    for (const [k, v] of input.stats.skipped) skipped.set(k, (skipped.get(k) || 0) + v);
    errors.push(...input.stats.errors);
  }
  const dbs = [...new Set(all.map(t => t.db))];
  return {
    tables: all,
    rels,
    getCol,
    dbs,
    stats: {
      files: inputs.map(i => ({ file: i.file, dialect: i.dialect, db: i.db, statements: i.stats.statements, tables: i.stats.tables, documents: i.stats.documents || 0, errors: i.stats.errors.length })),
      statements: inputs.reduce((s, i) => s + i.stats.statements, 0),
      tables: all.filter(t => !t.external && !t.embedded).length,
      embedded: all.filter(t => t.embedded).length,
      external: all.filter(t => t.external).length,
      columns: all.reduce((s, t) => s + t.columns.length, 0),
      fk: fkRels.length,
      fkDisabled: fkRels.filter(r => r.disabled).length,
      implicit: rels.filter(r => r.kind === 'implicit').length,
      refs: rels.filter(r => r.kind === 'ref').length,
      dictionaries: all.filter(t => t.dictionary).length,
      valueLists: all.reduce((s, t) => s + t.columns.filter(c => c.values).length, 0),
      dataRows: all.reduce((s, t) => s + (t.rows ? t.rows.length : 0), 0),
      embeds: rels.filter(r => r.kind === 'embed').length,
      junctions: all.filter(t => t.junction).length,
      indexes: inputs.reduce((s, i) => s + i.stats.indexes, 0),
      comments: inputs.reduce((s, i) => s + i.stats.comments, 0),
      dialects: [...new Set(inputs.map(i => i.dialect))],
      orphans,
      warnings,
      skipped: [...skipped.entries()].sort((a, b) => b[1] - a[1]),
      errors,
    },
  };
}

/*
 * Tahmini ilişkiler: FK tanımlı değil ama kolon adı başka bir tablonun tek kolonlu PK'siyle aynı
 * (INVOICE.CUSTOMER_ID → CUSTOMER.CUSTOMER_ID), ya da X_ID / xId kolonu PK'si ID / _id olan X tablosunu
 * gösteriyor (orders.customerId → customers._id). Aday birden fazlaysa ya da tipler uyuşmuyorsa çizilmez.
 */
function inferImplicit(all, rels, getCol, U) {
  const fkColSet = new Map();
  for (const r of rels) {
    if (!fkColSet.has(r.child)) fkColSet.set(r.child, new Set());
    r.cols.forEach(c => fkColSet.get(r.child).add(U(c)));
  }
  const pkIndex = new Map();
  const idTables = new Map();
  for (const t of all) {
    if (t.external || t.embedded || t.pk.length !== 1) continue;
    const pk = U(t.pk[0]);
    if (pk === 'ID' || pk === '_ID') {
      if (!idTables.has(t.db)) idTables.set(t.db, []);
      idTables.get(t.db).push(t);
      continue;
    }
    const k = t.db + '|' + pk;
    if (!pkIndex.has(k)) pkIndex.set(k, []);
    pkIndex.get(k).push(t);
  }
  const nameMatches = (t, stem) => {
    const N = U(t.name), S = U(stem).replace(/_$/, '');
    return N === S || N.endsWith('_' + S) || N === S + 'S' || N === S + 'ES' || N.replace(/IES$/, 'Y') === S || N.replace(/S$/, '') === S;
  };
  const pick = (cands, t, stem) => {
    if (cands.length === 1) return cands[0];
    const named = stem ? cands.filter(x => nameMatches(x, stem)) : [];
    if (named.length === 1) return named[0];
    const pool = named.length ? named : cands;
    const same = pool.filter(x => x.schema === t.schema);
    return same.length === 1 ? same[0] : null;
  };
  for (const t of all) {
    if (t.external) continue;
    const fkCols = fkColSet.get(t) || new Set();
    for (const col of t.columns) {
      const C = U(col.name);
      if (fkCols.has(C) || col.embedded || C === '_ID') continue;
      const isOid = /^(objectid|array<objectid)/i.test(col.type || '');
      let many = false;
      let stem = null;
      let m;
      if ((m = IDS_SUFFIX.exec(C)) && /^array</i.test(col.type || '')) { stem = m[1]; many = true; }
      else if ((m = ID_SUFFIX.exec(C))) stem = m[1];
      else if (isOid) stem = C;
      let target = null;
      let cands = (pkIndex.get(t.db + '|' + C) || []).filter(x => x !== t);
      if (cands.length && !many) {
        if (col.pk && t.pk.length === 1) cands = cands.filter(x => stem && nameMatches(x, stem));
        target = pick(cands, t, stem);
      } else if (stem && (/_?ID$/i.test(C) || isOid || many) && !col.pk) {
        target = pick((idTables.get(t.db) || []).filter(x => x !== t && nameMatches(x, stem)), t, stem);
      }
      if (!target) continue;
      const tcol = getCol(target, target.pk[0]);
      const f1 = typeFamily(col.type), f2 = typeFamily(tcol && tcol.type);
      if (f1 && f2 && f1 !== f2) continue;
      rels.push({ id: rels.length, kind: 'implicit', child: t, parent: target, cols: [col.name], refCols: [target.pk[0]], name: null, disabled: false, onDelete: null, many, src: null });
    }
  }
}

/*
 * Etki analizi: "bu tabloyu (ya da PK kolonunu) değiştirirsem, bir satırını silersem ne etkilenir?"
 * Tabloya bağlanan tablolar derece derece çıkarılır (1. derece doğrudan bağlananlar). Her bağlantının
 * silmedeki davranışı ayrıca söylenir; CASCADE zinciri "birlikte silinenler" olarak ayrıca verilir.
 *   opts.accept(r)  hangi ilişkiler sayılır (arayüz: görünür olanlar)   opts.col  yalnızca bu kolona bağlananlar (1. derece)
 * Eylemler: cascade · setNull · setDefault · restrict (FK silmeyi engeller) · unenforced (@ref, tahmini ya da
 * devre dışı FK: veritabanı denetlemez, yetim satır kalabilir) · embedded (MongoDB gömülü belge)
 */
function deleteAction(r) {
  if (r.kind === 'embed') return 'embedded';
  if (r.kind !== 'fk' || r.disabled) return 'unenforced';
  const a = String(r.onDelete || '').toUpperCase();
  return a === 'CASCADE' ? 'cascade' : a === 'SET NULL' ? 'setNull' : a === 'SET DEFAULT' ? 'setDefault' : 'restrict';
}

function impactOf(root, opts = {}) {
  const accept = opts.accept || (() => true);
  const col = opts.col ? String(opts.col).toUpperCase() : null;
  const depth = new Map([[root, 0]]);
  const levels = [];
  let frontier = [root];
  for (let d = 1; frontier.length && d <= (opts.maxDepth || 12); d++) {
    const next = [];
    for (const t of frontier) {
      for (const r of t.inc) {
        if (r.self || !accept(r) || depth.has(r.child)) continue;
        if (d === 1 && col && !r.refCols.some(c => String(c).toUpperCase() === col)) continue;
        depth.set(r.child, d);
        next.push({ t: r.child, via: r, action: deleteAction(r) });
      }
    }
    if (next.length) levels.push(next);
    frontier = next.map(x => x.t);
  }
  // birlikte silinenler: kökte bir satır silinince CASCADE zinciriyle giden tablolar. Silme bütün satırı
  // etkilediği için kolon seçili olsa da tablo düzeyindedir.
  const cascade = [];
  const seen = new Set([root]);
  let fr = [root];
  while (fr.length) {
    const nx = [];
    for (const t of fr) {
      for (const r of t.inc) {
        if (r.self || !accept(r) || seen.has(r.child)) continue;
        const action = deleteAction(r);
        if (action !== 'cascade' && action !== 'embedded') continue;
        seen.add(r.child);
        cascade.push({ t: r.child, via: r, action });
        nx.push(r.child);
      }
    }
    fr = nx;
  }
  return { root, col, levels, cascade, total: depth.size - 1 };
}

Object.assign(NS, { buildModel, typeFamily, valuesFromComment, impactOf, deleteAction });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
