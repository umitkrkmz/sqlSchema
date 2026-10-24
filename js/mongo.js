/*
 * sqlSchema · mongo.js
 * MongoDB'de DDL yoktur; şema üç kaynaktan çıkarılır ve SQL ayrıştırıcısıyla aynı işlem
 * listesine (bkz. sql-parser.js) çevrilir:
 *
 *   1. mongosh betikleri    db.createCollection('x', { validator: { $jsonSchema } }), collMod, createIndex
 *   2. Mongoose modelleri   new Schema({ ... ref: 'User' }), mongoose.model('Order', OrderSchema)
 *   3. Örnek belgeler       mongoexport çıktısı (JSON dizisi ya da satır başına bir belge)
 *
 * Gömülü belgeler "uydu" tablolar olur ('orders.items') ve sahibine 'embed' ilişkisiyle bağlanır.
 * Mongoose ref'leri tanımlı ilişkidir; diğer bütün bağlantılar model.js'de alan adından tahmin edilir.
 * Koleksiyonlar 'merge' bayrağıyla gelir: aynı koleksiyon hem doğrulayıcıda hem modelde hem
 * belgelerde görünüyorsa tek tabloda birleşir.
 */
(function (NS) {
'use strict';

/* ─── Hoşgörülü JS ifade okuyucu ───
 * JSON'un yanında tırnaksız anahtarları, tek tırnağı, sondaki virgülü, yorumları,
 * ObjectId("..") / ISODate("..") çağrılarını, Schema.Types.ObjectId gibi adları okur.
 * Fonksiyonlar ve ok fonksiyonları atlanır.
 *   { $ident: 'Schema.Types.ObjectId' }  { $call: 'ObjectId', args }  { $new: 'Schema', args }  { $fn: true }
 */
class JsReader {
  constructor(src, i = 0) { this.s = src; this.i = i; }
  ws() {
    const s = this.s;
    for (;;) {
      while (this.i < s.length && /\s/.test(s[this.i])) this.i++;
      if (s[this.i] === '/' && s[this.i + 1] === '/') { const e = s.indexOf('\n', this.i); this.i = e < 0 ? s.length : e; continue; }
      if (s[this.i] === '/' && s[this.i + 1] === '*') { const e = s.indexOf('*/', this.i + 2); this.i = e < 0 ? s.length : e + 2; continue; }
      return;
    }
  }
  peek() { this.ws(); return this.s[this.i]; }
  eat(ch) { if (this.peek() === ch) { this.i++; return true; } return false; }
  string() {
    const q = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === '\\') { out += this.s[this.i + 1] || ''; this.i += 2; continue; }
      out += this.s[this.i++];
    }
    this.i++;
    return out;
  }
  ident() {
    const m = /[A-Za-z_$][\w$]*/y;
    m.lastIndex = this.i;
    const r = m.exec(this.s);
    if (!r) return null;
    this.i += r[0].length;
    return r[0];
  }
  // '(' ya da '{' üzerindeyken eşleşen kapanışa atlar (metinleri ve yorumları dikkate alır)
  skipBalanced() {
    const open = this.s[this.i], close = { '(': ')', '{': '}', '[': ']' }[open];
    let depth = 0;
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '"' || ch === "'" || ch === '`') { this.string(); continue; }
      if (ch === '/' && (this.s[this.i + 1] === '/' || this.s[this.i + 1] === '*')) { this.ws(); continue; }
      this.i++;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) return;
    }
  }
  skipArrowBody() {
    if (this.peek() === '{') { this.skipBalanced(); return; }
    let depth = 0;
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === '"' || ch === "'" || ch === '`') { this.string(); continue; }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) return; depth--; }
      else if (ch === ',' && depth === 0) return;
      this.i++;
    }
  }
  args() {
    const list = [];
    this.i++;
    while (this.peek() !== undefined && !this.eat(')')) {
      list.push(this.value());
      this.eat(',');
    }
    return list;
  }
  value() {
    const ch = this.peek();
    if (ch === undefined) return undefined;
    if (ch === '{') return this.object();
    if (ch === '[') {
      this.i++;
      const arr = [];
      while (this.peek() !== undefined && !this.eat(']')) {
        if (this.s.startsWith('...', this.i)) { this.i += 3; this.value(); this.eat(','); continue; }
        arr.push(this.value());
        this.eat(',');
      }
      return arr;
    }
    if (ch === '"' || ch === "'" || ch === '`') return this.string();
    if (/[-+\d.]/.test(ch)) {
      const m = /[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
      m.lastIndex = this.i;
      const r = m.exec(this.s);
      if (r) { this.i += r[0].length; return Number(r[0]); }
    }
    if (ch === '/') {
      this.i++;
      while (this.i < this.s.length && this.s[this.i] !== '/') { if (this.s[this.i] === '\\') this.i++; this.i++; }
      this.i++;
      this.ident();
      return { $regex: true };
    }
    if (ch === '(') {
      const save = this.i;
      this.skipBalanced();
      if (this.peek() === '=' && this.s[this.i + 1] === '>') { this.i += 2; this.skipArrowBody(); return { $fn: true }; }
      this.i = save + 1;
      const v = this.value();
      this.eat(')');
      return v;
    }
    let name = this.ident();
    if (name === null) { this.i++; return undefined; }
    if (name === 'true') return true;
    if (name === 'false') return false;
    if (name === 'null' || name === 'undefined') return null;
    if (name === 'function' || name === 'async') {
      this.ident();
      if (this.peek() === '(') this.skipBalanced();
      if (this.peek() === '=' && this.s[this.i + 1] === '>') { this.i += 2; this.skipArrowBody(); return { $fn: true }; }
      if (this.peek() === '{') this.skipBalanced();
      return { $fn: true };
    }
    let isNew = false;
    if (name === 'new') { isNew = true; this.ws(); name = this.ident() || ''; }
    while (this.peek() === '.' ) { this.i++; name += '.' + (this.ident() || ''); }
    this.ws();
    if (this.s[this.i] === '=' && this.s[this.i + 1] === '>') { this.i += 2; this.skipArrowBody(); return { $fn: true }; }
    if (this.s[this.i] === '(') {
      const args = this.args();
      const v = isNew ? { $new: name, args } : { $call: name, args };
      while (this.peek() === '.') { this.i++; this.ident(); if (this.peek() === '(') this.args(); }
      return v;
    }
    return { $ident: name };
  }
  object() {
    this.i++;
    const obj = {};
    while (this.peek() !== undefined && !this.eat('}')) {
      if (this.s.startsWith('...', this.i)) { this.i += 3; this.value(); this.eat(','); continue; }
      const ch = this.peek();
      let key;
      if (ch === '"' || ch === "'" || ch === '`') key = this.string();
      else if (ch === '[') { this.skipBalanced(); key = null; }
      else if (/\d/.test(ch)) key = String(this.value());
      else key = this.ident();
      if (key === null && ch !== '[') { this.i++; continue; }
      if (this.peek() === '(') { this.skipBalanced(); if (this.peek() === '{') this.skipBalanced(); this.eat(','); continue; } // yöntem
      if (this.eat(':')) {
        const v = this.value();
        if (key !== null) obj[key] = v;
      } else if (key !== null) {
        obj[key] = { $ident: key }; // kısaltılmış özellik: { address }
      }
      this.eat(',');
    }
    return obj;
  }
}

const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !v.$ident && !v.$call && !v.$new && !v.$fn && !v.$regex;
const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Mongoose'un model adından koleksiyon adı türetme kuralları (mongoose-legacy-pluralize'ın özeti)
const UNCOUNTABLE = new Set(['advice', 'energy', 'equipment', 'information', 'money', 'species', 'series', 'rain', 'rice', 'fish', 'sheep', 'deer', 'news', 'expertise', 'status', 'media', 'data']);
const PLURAL_RULES = [
  [/(m)an$/, '$1en'], [/(pe)rson$/, '$1ople'], [/(child)$/, '$1ren'], [/(ax|test)is$/, '$1es'],
  [/(octop|vir)us$/, '$1i'], [/(alias|status)$/, '$1es'], [/(bu)s$/, '$1ses'], [/(buffal|tomat|potat)o$/, '$1oes'],
  [/([ti])um$/, '$1a'], [/sis$/, 'ses'], [/(?:([^f])fe|([lr])f)$/, '$1$2ves'], [/([^aeiouy]|qu)y$/, '$1ies'],
  [/(x|ch|ss|sh)$/, '$1es'], [/(matr|vert|ind)(?:ix|ex)$/, '$1ices'], [/([ml])ouse$/, '$1ice'], [/(quiz)$/, '$1zes'],
  [/s$/, 's'], [/$/, 's'],
];
function pluralize(w) {
  const s = w.toLowerCase();
  if (UNCOUNTABLE.has(s)) return s;
  for (const [re, rep] of PLURAL_RULES) if (re.test(s)) return s.replace(re, rep);
  return s;
}

/* ─── Ortak çıktı: ops ─── */

function makeEmitter(file, dialectStats) {
  const ops = [];
  let line = 0;
  return {
    ops,
    at(l) { line = l; },
    op(o) { o.file = file; o.line = line; ops.push(o); },
    stats: dialectStats,
  };
}

// Bir alan ağacını (fields: [{ name, type, nullable, comment, pk, ref, many, sub }]) tablolara açar
function emitEntity(E, parts, fields, owner) {
  const columns = [];
  const children = [];
  for (const f of fields) {
    if (f.sub) {
      children.push(f);
      columns.push({ name: f.name, type: f.many ? 'array<object>' : 'object', nullable: f.nullable, comment: f.comment || null, embedded: true });
      continue;
    }
    columns.push({ name: f.name, type: f.type, nullable: f.nullable, comment: f.comment || null, pk: !!f.pk });
  }
  E.op({ op: 'create', t: parts, def: { columns, comment: null, embedded: !!owner }, merge: true });
  E.stats.tables++;
  if (fields.some(f => f.pk)) E.op({ op: 'pk', t: parts, cols: fields.filter(f => f.pk).map(f => f.name) });
  for (const f of fields) {
    if (f.unique) E.op({ op: 'uq', t: parts, cols: [f.name] });
    if (f.ref) E.op({ op: 'fk', t: parts, cols: [f.name], ref: f.ref, refCols: ['_id'], name: null, many: !!f.many, label: 'ref' });
  }
  if (owner) E.op({ op: 'embed', t: owner.parts, child: parts, field: owner.field, many: owner.many });
  for (const f of children) {
    const childParts = parts.slice(0, -1).concat(parts[parts.length - 1] + '.' + f.name);
    emitEntity(E, childParts, f.sub, { parts, field: f.name, many: !!f.many });
  }
}

/* ─── 1. $jsonSchema ─── */

function bsonTypes(p) {
  return asArray(p.bsonType !== undefined ? p.bsonType : p.type).map(String);
}

function jsonSchemaFields(sch, top = true) {
  const req = new Set(asArray(sch.required));
  const fields = [];
  for (const [name, p] of Object.entries(sch.properties || {})) {
    if (!isPlain(p)) continue;
    const types = bsonTypes(p);
    const nonNull = types.filter(t => t !== 'null');
    const f = { name, nullable: !req.has(name) || types.includes('null'), pk: name === '_id' };
    const notes = [];
    if (p.description) notes.push(p.description);
    if (Array.isArray(p.enum)) notes.push('enum: ' + p.enum.join(', '));
    if (nonNull.includes('object') && isPlain(p.properties)) {
      f.sub = jsonSchemaFields(p, false);
    } else if (nonNull.includes('array')) {
      const items = Array.isArray(p.items) ? p.items[0] : p.items;
      if (isPlain(items) && bsonTypes(items).includes('object') && isPlain(items.properties)) {
        f.sub = jsonSchemaFields(items, false);
        f.many = true;
      } else {
        f.type = 'array<' + (isPlain(items) ? (bsonTypes(items).join('|') || 'any') : 'any') + '>';
      }
    } else {
      f.type = nonNull.join('|') || 'any';
    }
    f.comment = notes.join(' · ') || null;
    fields.push(f);
  }
  if (top && !fields.some(f => f.name === '_id')) fields.unshift({ name: '_id', type: 'objectId', nullable: false, pk: true });
  return fields;
}

function parseShellScript(src, E) {
  let db = null;
  const lineAt = i => src.slice(0, i).split('\n').length;
  const events = [];
  const add = (re, kind) => { re.lastIndex = 0; let m; while ((m = re.exec(src))) events.push({ i: m.index, end: m.index + m[0].length, m, kind }); };
  add(/\buse\s*\(\s*['"`]([\w-]+)['"`]\s*\)|^\s*use\s+([\w-]+)\s*;?\s*$|getSiblingDB\(\s*['"`]([\w-]+)['"`]\s*\)/gm, 'use');
  add(/\bcreateCollection\s*\(/g, 'create');
  add(/\brunCommand\s*\(/g, 'command');
  add(/\bdb\s*\.\s*(?:getCollection\(\s*['"`]([\w.-]+)['"`]\s*\)|([A-Za-z_$][\w$]*))\s*\.\s*createIndex\s*\(/g, 'index');
  events.sort((a, b) => a.i - b.i);
  let found = 0;
  for (const ev of events) {
    E.at(lineAt(ev.i));
    if (ev.kind === 'use') { db = ev.m[1] || ev.m[2] || ev.m[3]; continue; }
    const r = new JsReader(src, ev.end - 1);
    const args = r.args();
    const schema = db || 'mongo';
    if (ev.kind === 'create') {
      const name = typeof args[0] === 'string' ? args[0] : null;
      if (!name) continue;
      const js = args[1] && args[1].validator && args[1].validator.$jsonSchema;
      emitEntity(E, [schema, name], js ? jsonSchemaFields(js) : [{ name: '_id', type: 'objectId', nullable: false, pk: true }]);
      found++;
    } else if (ev.kind === 'command') {
      const cmd = args[0];
      const js = cmd && cmd.validator && cmd.validator.$jsonSchema;
      if (isPlain(cmd) && typeof cmd.collMod === 'string' && js) { emitEntity(E, [schema, cmd.collMod], jsonSchemaFields(js)); found++; }
    } else if (ev.kind === 'index') {
      const coll = ev.m[1] || ev.m[2];
      const keys = args[0], opts = args[1];
      if (isPlain(keys) && isPlain(opts) && opts.unique === true) E.op({ op: 'uq', t: [schema, coll], cols: Object.keys(keys) });
      E.stats.indexes++;
    }
  }
  return found;
}

/* ─── 2. Mongoose ─── */

const MONGOOSE_TYPES = { ObjectId: 'objectId', String: 'string', Number: 'number', Date: 'date', Boolean: 'bool', Buffer: 'binData', Mixed: 'mixed', Map: 'map', Decimal128: 'decimal', UUID: 'uuid', BigInt: 'long', Array: 'array<any>', Object: 'object' };

function mongooseTypeName(v) {
  if (v && v.$ident) return MONGOOSE_TYPES[v.$ident.split('.').pop()] || v.$ident.split('.').pop();
  if (v && v.$call) return MONGOOSE_TYPES[v.$call.split('.').pop()] || 'mixed';
  if (typeof v === 'string') return v.toLowerCase();
  return 'mixed';
}

function parseMongoose(src, E) {
  const lineAt = i => src.slice(0, i).split('\n').length;
  const schemas = new Map();     // değişken adı → { def, opts }
  const re = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)?(?:new\s+)?(?:mongoose\s*\.\s*)?Schema\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const r = new JsReader(src, m.index + m[0].length - 1);
    const args = r.args();
    if (m[1] && isPlain(args[0])) schemas.set(m[1], { def: args[0], opts: args[1], line: lineAt(m.index) });
  }
  const models = [];
  const mre = /\b(?:mongoose\s*\.\s*)?model\s*\(\s*['"`]/g;
  while ((m = mre.exec(src))) {
    const r = new JsReader(src, src.indexOf('(', m.index));
    const args = r.args();
    if (typeof args[0] !== 'string') continue;
    let sch = null;
    if (args[1] && args[1].$ident && schemas.has(args[1].$ident)) sch = schemas.get(args[1].$ident);
    else if (args[1] && args[1].$new && isPlain(args[1].args[0])) sch = { def: args[1].args[0], opts: args[1].args[1] };
    if (!sch) continue;
    models.push({ model: args[0], coll: typeof args[2] === 'string' ? args[2] : pluralize(args[0]), sch, line: lineAt(m.index) });
  }
  const collOf = new Map(models.map(x => [x.model, x.coll]));

  const fieldOf = (name, v, depth) => {
    if (depth > 6) return { name, type: 'mixed', nullable: true };
    if (Array.isArray(v)) {
      const inner = fieldOf(name, v.length ? v[0] : { $ident: 'Mixed' }, depth + 1);
      inner.many = true;
      if (!inner.sub) inner.type = 'array<' + inner.type + '>';
      return inner;
    }
    if (v && v.$ident && schemas.has(v.$ident)) return { name, nullable: true, sub: fieldsOf(schemas.get(v.$ident).def, depth + 1) };
    if (v && v.$new && isPlain(v.args[0])) return { name, nullable: true, sub: fieldsOf(v.args[0], depth + 1) };
    if (isPlain(v)) {
      const hasType = 'type' in v && !(isPlain(v.type) && !('type' in v.type));
      if (!hasType) return { name, nullable: true, sub: fieldsOf(v, depth + 1) };
      const f = fieldOf(name, v.type, depth + 1);
      f.nullable = !(v.required === true || (Array.isArray(v.required) && v.required[0] === true));
      if (v.unique === true) f.unique = true;
      if (typeof v.ref === 'string') f.ref = [collOf.get(v.ref) || pluralize(v.ref)];
      const notes = [];
      if (Array.isArray(v.enum)) notes.push('enum: ' + v.enum.join(', '));
      if (typeof v.description === 'string') notes.push(v.description);
      if (notes.length) f.comment = notes.join(' · ');
      return f;
    }
    return { name, type: mongooseTypeName(v), nullable: true };
  };
  const fieldsOf = (def, depth = 0) => {
    const fields = Object.entries(def).map(([k, v]) => fieldOf(k, v, depth));
    for (const f of fields) if (f.ref && f.many) f.type = 'array<objectId>';
    return fields;
  };

  for (const x of models) {
    E.at(x.line);
    const fields = fieldsOf(x.sch.def);
    if (!fields.some(f => f.name === '_id')) fields.unshift({ name: '_id', type: 'objectId', nullable: false, pk: true });
    if (x.sch.opts && x.sch.opts.timestamps) {
      fields.push({ name: 'createdAt', type: 'date', nullable: false }, { name: 'updatedAt', type: 'date', nullable: false });
    }
    emitEntity(E, [x.coll], fields);
  }
  return models.length;
}

/* ─── 3. Örnek belgeler ─── */

const HEX24 = /^[0-9a-f]{24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function valueType(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return HEX24.test(v) ? 'objectId' : ISO_DATE.test(v) ? 'date' : 'string';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'boolean') return 'bool';
  if (v.$oid !== undefined) return 'objectId';
  if (v.$date !== undefined) return 'date';
  if (v.$numberLong !== undefined) return 'long';
  if (v.$numberDecimal !== undefined) return 'decimal';
  if (v.$numberInt !== undefined) return 'int';
  if (v.$numberDouble !== undefined) return 'double';
  if (v.$binary !== undefined) return 'binData';
  if (v.$timestamp !== undefined) return 'timestamp';
  if (v.$call) {
    const n = v.$call.split('.').pop();
    return { ObjectId: 'objectId', ISODate: 'date', Date: 'date', NumberLong: 'long', NumberInt: 'int', NumberDecimal: 'decimal', UUID: 'uuid', BinData: 'binData', Timestamp: 'timestamp' }[n] || 'mixed';
  }
  if (v.$ident || v.$fn || v.$regex) return 'mixed';
  return 'object';
}

function newNode() { return { n: 0, fields: new Map() }; }

function observe(node, doc) {
  node.n++;
  for (const [k, v] of Object.entries(doc)) {
    let f = node.fields.get(k);
    if (!f) { f = { seen: 0, types: new Set(), sub: null, arrSub: null, items: new Set() }; node.fields.set(k, f); }
    f.seen++;
    const t = valueType(v);
    f.types.add(t);
    if (t === 'object') observe(f.sub || (f.sub = newNode()), v);
    if (t === 'array') {
      for (const it of v.slice(0, 50)) {
        const it2 = valueType(it);
        f.items.add(it2);
        if (it2 === 'object') observe(f.arrSub || (f.arrSub = newNode()), it);
      }
    }
  }
}

function nodeFields(node) {
  const fields = [];
  for (const [name, f] of node.fields) {
    const types = [...f.types].filter(t => t !== 'null');
    const field = { name, nullable: f.seen < node.n || f.types.has('null'), pk: name === '_id' };
    if (types.length === 1 && types[0] === 'object' && f.sub) field.sub = nodeFields(f.sub);
    else if (types.length === 1 && types[0] === 'array' && f.arrSub && f.items.size === 1) { field.sub = nodeFields(f.arrSub); field.many = true; }
    else if (types.includes('array')) field.type = 'array<' + ([...f.items].filter(t => t !== 'null').join('|') || 'any') + '>';
    else field.type = types.join('|') || 'null';
    fields.push(field);
  }
  return fields;
}

function readDocuments(src) {
  const text = src.trim();
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [v];
  } catch (err) { /* satır başına belge ya da kabuk çıktısı */ }
  const docs = [];
  const r = new JsReader(text);
  while (r.peek() !== undefined && docs.length < 20000) {
    const ch = r.peek();
    if (ch === '[') { const arr = r.value(); if (Array.isArray(arr)) docs.push(...arr.filter(isPlain)); continue; }
    if (ch !== '{') { r.i++; continue; }
    const v = r.value();
    if (isPlain(v)) docs.push(v);
  }
  return docs;
}

function parseDocuments(src, file, E) {
  const docs = readDocuments(src).filter(d => d && typeof d === 'object' && !Array.isArray(d));
  if (!docs.length) return 0;
  const base = String(file).split('/').pop().replace(/\.(json|jsonl|ndjson|bson\.json)$/i, '');
  const parts = base.split('.');
  const coll = parts.length > 1 ? parts.slice(1).join('.') : base;
  const node = newNode();
  for (const d of docs.slice(0, 5000)) observe(node, d);
  const fields = nodeFields(node);
  E.at(1);
  emitEntity(E, parts.length > 1 ? [parts[0], coll] : [coll], fields);
  E.stats.documents = docs.length;
  return 1;
}

/* ─── Giriş ─── */

function looksLikeMongo(src, file) {
  const name = String(file || '').toLowerCase();
  if (/\.(json|jsonl|ndjson)$/.test(name)) return true;
  if (!/\.(js|mjs|cjs|ts)$/.test(name)) return false;
  return /\$jsonSchema|createCollection\s*\(|\bSchema\s*\(|mongoose/.test(src);
}

function parseMongo(src, opts = {}) {
  const file = opts.file || '';
  const stats = { statements: 0, tables: 0, indexes: 0, comments: 0, skipped: new Map(), errors: [] };
  const E = makeEmitter(file, stats);
  try {
    if (/\.(json|jsonl|ndjson)$/i.test(file)) {
      stats.statements = parseDocuments(src, file, E);
    } else {
      stats.statements = parseShellScript(src, E) + parseMongoose(src, E);
    }
  } catch (err) {
    stats.errors.push({ file, line: 0, message: String(err && err.message || err) });
  }
  return { file, dialect: 'mongodb', ops: E.ops, stats };
}

Object.assign(NS, { parseMongo, looksLikeMongo, JsReader });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
