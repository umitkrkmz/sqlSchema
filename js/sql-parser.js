/*
 * sqlSchema · sql-parser.js
 * DDL ifadelerini sıralı bir işlem (op) listesine çevirir. Ad çözümleme burada yapılmaz;
 * model.js işlemleri dosya sırasıyla uygular. Böylece FK'lerin tablolardan önce gelmesi,
 * migration'lardaki DROP / RENAME ve farklı dosyalara bölünmüş şemalar aynı yoldan geçer.
 *
 * İşlemler (hepsinde file ve line bulunur):
 *   create    { t, def: { columns, comment, noColumns } }
 *   pk / uq   { t, cols, name, partition? }
 *   fk        { t, cols, ref, refCols, name, disabled, onDelete }
 *   addcol    { t, col }              dropcol   { t, col }
 *   null      { t, col, nullable }    type      { t, col, type }
 *   renamecol { t, col, to }          rename    { t, to }
 *   drop      { t }                   dropcon   { t, name }      droppk { t }
 *   state     { t, name, disabled }   tcomment  { t, text }      ccomment { t, col, text }
 *   check     { t, col, values }      yalnızca izin verilen değer listesi: CHECK (X IN ('A','P')), CHECK (X='A' OR X='P')
 *   rows      { t, cols, rows }       INSERT ... VALUES satırları (sözlük tablolarının içeriği için; tablo başına sınırlı)
 */
(function (NS) {
'use strict';

const { tokenize, splitStatements, detectDialect, CREATE_MODIFIERS } = NS;

class Cursor {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  done() { return this.i >= this.toks.length; }
  isW(...words) { const t = this.peek(); return !!t && t.t === 'w' && words.includes(t.u); }
  isP(ch, o = 0) { const t = this.peek(o); return !!t && t.t === 'p' && t.v === ch; }
  isIdent(o = 0) { const t = this.peek(o); return !!t && (t.t === 'w' || t.t === 'q'); }
  acceptW(...words) { if (this.isW(...words)) { this.i++; return true; } return false; }
  acceptP(ch) { if (this.isP(ch)) { this.i++; return true; } return false; }
  acceptSeq(...words) {
    for (let k = 0; k < words.length; k++) {
      const t = this.peek(k);
      if (!t || t.t !== 'w' || t.u !== words[k]) return false;
    }
    this.i += words.length;
    return true;
  }
  // imleç '(' üzerindeyken eşleşen ')' sonrasına atlar
  skipGroup() {
    let depth = 0;
    while (!this.done()) {
      const t = this.next();
      if (t.t !== 'p') continue;
      if (t.v === '(') depth++;
      else if (t.v === ')' && --depth === 0) return;
    }
  }
  // imleç '(' üzerindeyken grubu üst seviye virgüllerden böler
  groupItems() {
    this.next();
    const start = this.i;
    let depth = 0;
    while (!this.done()) {
      const t = this.next();
      if (t.t !== 'p') continue;
      if (t.v === '(') depth++;
      else if (t.v === ')') { if (depth === 0) break; depth--; }
    }
    return splitTopLevel(this.toks.slice(start, this.i - 1));
  }
  rest() { return this.toks.slice(this.i); }
}

// Üst seviye virgüllerden böler. Parantez dışındaki '<' '>' yalnızca CQL tiplerinde
// (map<text, int>) görünür; içlerindeki virgül de bölmez.
function splitTopLevel(toks) {
  const out = [];
  let cur = [], depth = 0, angle = 0;
  for (const t of toks) {
    if (t.t === 'p') {
      if (t.v === '(') depth++;
      else if (t.v === ')') depth--;
      else if (depth === 0 && t.v === '<') angle++;
      else if (depth === 0 && t.v === '>' && angle > 0) angle--;
      else if (t.v === ',' && depth === 0 && angle === 0) { out.push(cur); cur = []; continue; }
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

function readName(c) {
  if (!c.isIdent()) return null;
  const parts = [c.next().v];
  while (c.isP('.') && c.isIdent(1)) { c.next(); parts.push(c.next().v); }
  return parts;
}

// "(A, B DESC, C(10))" → ['A','B','C']; ifade içeren listeler için null.
// CQL: "((a, b), c)" → ['a','b','c'], info.partition = ['a','b']
function readColList(c, info) {
  if (!c.isP('(')) return null;
  const names = [];
  let expr = false;
  for (const it of c.groupItems()) {
    const t0 = it[0], t1 = it[1];
    if (t0 && t0.t === 'p' && t0.v === '(') {
      const part = it.filter(t => t.t === 'w' || t.t === 'q').map(t => t.v);
      if (info && !names.length) info.partition = part;
      names.push(...part);
      continue;
    }
    if (!t0 || (t0.t !== 'w' && t0.t !== 'q')) { expr = true; continue; }
    if (t1 && !(t1.t === 'w' || (t1.t === 'p' && t1.v === '(' && it[2] && it[2].t === 'n'))) { expr = true; continue; }
    names.push(t0.v);
  }
  return expr ? null : names;
}

function tokText(toks, rawQuoted) {
  let s = '';
  let prev = null;
  for (const t of toks) {
    const v = t.t === 's' ? `'${t.v}'` : t.t === 'q' && !rawQuoted ? `"${t.v}"` : t.v;
    const wordish = t.t !== 'p';
    if (prev && prev !== 'p' && wordish) s += ' ';
    s += v;
    prev = wordish ? 'w' : 'p';
  }
  return s;
}

const typeText = toks => tokText(toks, true)
  .replace(/\s*\(\s*/g, '(').replace(/\s*,\s*/g, ',').replace(/\s*\)/g, ')').replace(/\)(?=\w)/g, ') ')
  .replace(/\s*<\s*/g, '<').replace(/\s*>/g, '>');

const TABLE_CONSTRAINT_START = new Set(['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'EXCLUDE', 'PERIOD', 'SUPPLEMENTAL', 'SCOPE', 'LIKE']);
const COL_ATTR = new Set(['NOT', 'NULL', 'DEFAULT', 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'COLLATE', 'GENERATED', 'IDENTITY', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'COMMENT', 'ENABLE', 'DISABLE', 'VISIBLE', 'INVISIBLE', 'ENCRYPT', 'AS', 'ON', 'SPARSE', 'ROWGUIDCOL', 'FILESTREAM', 'MASKED', 'SORT', 'STORAGE', 'COMPRESSION', 'CHARSET', 'KEY', 'SRID', 'LOB', 'STATIC', 'USING', 'FIRST', 'AFTER']);

function readAction(c) {
  if (c.acceptW('CASCADE')) return 'CASCADE';
  if (c.acceptSeq('SET', 'NULL')) return 'SET NULL';
  if (c.acceptSeq('SET', 'DEFAULT')) return 'SET DEFAULT';
  if (c.acceptSeq('NO', 'ACTION')) return 'NO ACTION';
  if (c.acceptW('RESTRICT')) return 'RESTRICT';
  return null;
}

function parseReferences(c, P) {
  const parts = readName(c);
  const cols = c.isP('(') ? readColList(c) : null;
  let onDelete = null, disabled = false;
  while (!c.done()) {
    if (c.acceptSeq('ON', 'DELETE')) { onDelete = readAction(c); continue; }
    if (c.acceptSeq('ON', 'UPDATE')) { readAction(c); continue; }
    if (c.acceptW('DISABLE')) { disabled = true; continue; }
    if (c.acceptSeq('NOT', 'ENFORCED')) { disabled = true; continue; }
    if (c.acceptSeq('NOT', 'DEFERRABLE')) continue;
    if (c.acceptSeq('NOT', 'FOR', 'REPLICATION')) continue;
    if (c.isW('NOT', 'NULL', 'DEFAULT', 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'REFERENCES', 'COMMENT', 'COLLATE', 'GENERATED', 'IDENTITY', 'AUTO_INCREMENT')) break;
    if (c.isP('(')) { c.skipGroup(); continue; }
    c.next();
  }
  return { parts: parts && P.qn(parts), cols, onDelete, disabled };
}

/*
 * CHECK gövdesinden izin verilen değer listesi. İki biçim okunur:
 *   (DURUM IN ('A', 'P'))          Oracle, PostgreSQL, MySQL
 *   (([Durum]='A' OR [Durum]='P'))  SQL Server "Generate Scripts" çıktısı
 * Aralık, karşılaştırma ve birden fazla kolonlu koşullar değer listesi değildir; okunmaz.
 */
function readCheckValues(c) {
  if (!c.isP('(')) return null;
  const s = c.i;
  c.skipGroup();
  const inner = c.toks.slice(s + 1, c.i - 1);
  const isId = t => t && (t.t === 'w' || t.t === 'q');
  const lit = t => t && (t.t === 's' || t.t === 'n');
  const toks = inner.filter(t => !(t.t === 'p' && (t.v === '(' || t.v === ')')));
  // IN biçimi: parantezleri atınca  ad IN lit , lit , lit
  if (isId(toks[0]) && toks[1] && toks[1].u === 'IN') {
    const values = [];
    for (let j = 2; j < toks.length; j++) {
      if (j % 2 === 0 ? !lit(toks[j]) : !(toks[j].t === 'p' && toks[j].v === ',')) return null;
      if (j % 2 === 0) values.push(String(toks[j].v));
    }
    return values.length >= 2 ? { col: toks[0].v, values } : null;
  }
  // OR biçimi:  ad = lit OR ad = lit ...
  const values = [];
  let col = null;
  for (let j = 0; j < toks.length; j += 4) {
    const [a, eq, v, or] = toks.slice(j, j + 4);
    if (!isId(a) || !eq || eq.v !== '=' || !lit(v)) return null;
    if (col !== null && col.toUpperCase() !== a.v.toUpperCase()) return null;
    col = a.v;
    values.push(String(v.v));
    if (or && or.u !== 'OR') return null;
  }
  return values.length >= 2 ? { col, values } : null;
}

// Tablo seviyesi kısıt; imleç CONSTRAINT / PRIMARY / FOREIGN / UNIQUE ... üzerinde
function parseConstraint(c, tparts, P) {
  let name = null;
  if (c.acceptW('CONSTRAINT') && c.isIdent() && !c.isW('PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK')) name = c.next().v;
  if (c.acceptW('CHECK')) {
    const r = readCheckValues(c);
    if (r) P.op({ op: 'check', t: tparts, col: r.col, values: r.values });
    return;
  }
  if (c.acceptSeq('PRIMARY', 'KEY')) {
    c.acceptW('CLUSTERED', 'NONCLUSTERED');
    const info = {};
    const cols = readColList(c, info);
    if (cols) P.op({ op: 'pk', t: tparts, cols, name, partition: info.partition });
    return;
  }
  if (c.acceptW('UNIQUE')) {
    c.acceptW('KEY', 'INDEX');
    c.acceptW('CLUSTERED', 'NONCLUSTERED');
    let idx = null;
    if (c.isIdent()) idx = c.next().v;
    const cols = readColList(c);
    if (cols) P.op({ op: 'uq', t: tparts, cols, name: name || idx });
    return;
  }
  if (c.acceptSeq('FOREIGN', 'KEY')) {
    let idx = null;
    if (c.isIdent()) idx = c.next().v;
    const cols = readColList(c);
    if (!cols || !c.acceptW('REFERENCES')) return;
    const r = parseReferences(c, P);
    if (r.parts) P.op({ op: 'fk', t: tparts, cols, ref: r.parts, refCols: r.cols, name: name || idx, disabled: r.disabled, onDelete: r.onDelete });
  }
}

function skipExpr(c) {
  const operand = () => {
    const t = c.peek();
    if (!t) return;
    if (t.t === 'p' && t.v === '(') { c.skipGroup(); return; }
    if (t.t === 'p' && (t.v === '-' || t.v === '+')) { c.next(); operand(); return; }
    c.next();
    if (c.isP('(')) c.skipGroup();
  };
  operand();
  while (!c.done()) {
    const t = c.peek();
    if (t.t === 'p' && '+-*/|:'.includes(t.v)) {
      c.next();
      if (c.isP('|') || c.isP(':')) c.next();
      operand();
      continue;
    }
    break;
  }
}

// Kolon tipini okur: NUMBER(18,0), TIMESTAMP(6) WITH TIME ZONE, int[], map<text, frozen<list<int>>>
function readType(c) {
  const typeToks = [];
  while (!c.done()) {
    const t = c.peek();
    if (t.t === 'w') {
      if (COL_ATTR.has(t.u)) break;
      if (t.u === 'CHARACTER' && typeToks.length && c.peek(1) && c.peek(1).u === 'SET') break;
      typeToks.push(c.next());
      continue;
    }
    if (t.t === 'p' && t.v === '(' && typeToks.length) {
      const s = c.i;
      c.skipGroup();
      typeToks.push(...c.toks.slice(s, c.i));
      continue;
    }
    if (t.t === 'p' && t.v === '<' && typeToks.length) {
      let depth = 0;
      while (!c.done()) {
        const x = c.next();
        typeToks.push(x);
        if (x.t === 'p' && x.v === '<') depth++;
        else if (x.t === 'p' && x.v === '>' && --depth === 0) break;
      }
      continue;
    }
    if (t.t === 'p' && (t.v === '[' || t.v === ']') && typeToks.length) { typeToks.push(c.next()); continue; }
    if (t.t === 'q' && !typeToks.length) { typeToks.push(c.next()); continue; }
    break;
  }
  return typeText(typeToks);
}

function parseColumnDef(c, tparts, P) {
  const name = c.next().v;
  const col = { name, type: readType(c), nullable: true, pk: false, comment: null, identity: false };
  let pending = null;
  while (!c.done()) {
    if (c.acceptSeq('NOT', 'NULL')) { col.nullable = false; continue; }
    if (c.acceptW('NULL')) continue;
    if (c.acceptW('CONSTRAINT')) { pending = c.isIdent() && !c.isW('PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'NOT', 'NULL') ? c.next().v : null; continue; }
    if (c.acceptSeq('PRIMARY', 'KEY')) {
      P.op({ op: 'pk', t: tparts, cols: [name], name: pending });
      col.nullable = false;
      pending = null;
      continue;
    }
    if (c.acceptW('UNIQUE')) { c.acceptW('KEY'); P.op({ op: 'uq', t: tparts, cols: [name], name: pending }); pending = null; continue; }
    if (c.acceptW('REFERENCES')) {
      const r = parseReferences(c, P);
      if (r.parts) P.op({ op: 'fk', t: tparts, cols: [name], ref: r.parts, refCols: r.cols, name: pending, disabled: r.disabled, onDelete: r.onDelete });
      pending = null;
      continue;
    }
    if (c.acceptW('CHECK')) {
      const r = readCheckValues(c);
      if (r && r.col.toUpperCase() === name.toUpperCase()) P.op({ op: 'check', t: tparts, col: name, values: r.values });
      pending = null;
      continue;
    }
    if (c.acceptW('DEFAULT')) { c.acceptSeq('ON', 'NULL'); skipExpr(c); continue; }
    if (c.acceptW('COMMENT')) { const t = c.peek(); if (t && t.t === 's') { col.comment = t.v; c.next(); } continue; }
    if (c.acceptW('IDENTITY', 'AUTO_INCREMENT', 'AUTOINCREMENT')) { col.identity = true; if (c.isP('(')) c.skipGroup(); continue; }
    if (c.acceptW('STATIC')) { col.static = true; continue; }
    if (c.acceptW('GENERATED')) {
      while (!c.done() && !c.isW('AS')) c.next();
      c.acceptW('AS');
      if (c.acceptW('IDENTITY')) col.identity = true;
      if (c.isP('(')) c.skipGroup();
      continue;
    }
    if (c.acceptW('AS')) { if (c.isP('(')) c.skipGroup(); col.virtual = true; continue; }
    if (c.isP('(')) { c.skipGroup(); continue; }
    c.next();
  }
  return col;
}

// CREATE TABLE gövdesindeki ya da ALTER TABLE ADD içindeki tek bir öğe
function parseTableElement(toks, tparts, P, onColumn) {
  const c = new Cursor(toks);
  const t0 = c.peek();
  if (!t0) return;
  if (t0.t === 'w' && TABLE_CONSTRAINT_START.has(t0.u)) {
    // KEY / INDEX / PERIOD gibi kelimeler tırnaksız kolon adı da olabilir:
    // "KEY ad (kolonlar)" indekstir, "KEY VARCHAR2(10)" ise KEY adlı bir kolondur.
    const t1 = c.peek(1), t2 = c.peek(2), t3 = c.peek(3);
    const isP = (t, ch) => !!t && t.t === 'p' && t.v === ch;
    const isId = t => !!t && (t.t === 'w' || t.t === 'q');
    let constraint = true;
    if (!['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'LIKE'].includes(t0.u)) {
      constraint = isP(t1, '(') ||
        (t1 && t1.t === 'w' && ['FOR', 'KEY', 'INDEX', 'LOG'].includes(t1.u)) ||
        (isId(t1) && isP(t2, '(') && !!t3 && t3.t !== 'n');
    }
    if (constraint) { parseConstraint(c, tparts, P); return; }
  }
  if (!c.isIdent()) return;
  onColumn(parseColumnDef(c, tparts, P));
}

function parseCreateTable(c, P) {
  c.acceptSeq('IF', 'NOT', 'EXISTS');
  const raw = readName(c);
  if (!raw) return P.skip('CREATE TABLE');
  const last = raw[raw.length - 1];
  if (last[0] === '#' || last[0] === '@') return P.skip('CREATE TABLE #temp');
  if (c.isW('PARTITION') && c.peek(1) && c.peek(1).u === 'OF') return P.skip('CREATE TABLE … PARTITION OF');
  const parts = P.qn(raw);
  const def = { columns: [], comment: null, noColumns: false };
  P.op({ op: 'create', t: parts, def });
  P.stats.tables++;
  if (c.isP('(')) {
    for (const it of c.groupItems()) parseTableElement(it, parts, P, col => def.columns.push(col));
  } else {
    def.noColumns = true;
  }
  while (!c.done()) {
    if (c.acceptW('COMMENT')) {
      c.acceptP('=');
      const t = c.peek();
      if (t && t.t === 's') def.comment = t.v;
    }
    c.next();
  }
}

// MODIFY / ALTER COLUMN / CHANGE öğesi: tip ve NULL değişiklikleri
function parseColumnChange(it, tparts, P, renamed) {
  const id = it[0];
  if (!id || (id.t !== 'w' && id.t !== 'q')) return;
  let col = id.v;
  let rest = it.slice(1);
  if (renamed) {
    const to = rest[0];
    if (!to || (to.t !== 'w' && to.t !== 'q')) return;
    P.op({ op: 'renamecol', t: tparts, col, to: to.v });
    col = to.v;
    rest = rest.slice(1);
  }
  const c = new Cursor(rest);
  if (c.acceptW('TYPE') || c.acceptSeq('SET', 'DATA', 'TYPE')) {
    P.op({ op: 'type', t: tparts, col, type: readType(c) });
  } else if (c.peek() && (c.peek().t === 'w' || c.peek().t === 'q') && !COL_ATTR.has(c.peek().u) && !['SET', 'DROP'].includes(c.peek().u)) {
    P.op({ op: 'type', t: tparts, col, type: readType(c) });
  }
  const words = rest.filter(t => t.t === 'w').map(t => t.u);
  const hasNotNull = words.some((w, k) => w === 'NOT' && words[k + 1] === 'NULL');
  if (words.includes('DROP') && hasNotNull) P.op({ op: 'null', t: tparts, col, nullable: true });
  else if (hasNotNull) P.op({ op: 'null', t: tparts, col, nullable: false });
  else if (words.includes('NULL') && !words.includes('DEFAULT')) P.op({ op: 'null', t: tparts, col, nullable: true });
}

function parseAlterTable(c, P) {
  c.acceptSeq('IF', 'EXISTS');
  c.acceptW('ONLY');
  const raw = readName(c);
  if (!raw) return P.skip('ALTER TABLE');
  const tparts = P.qn(raw);
  if (c.acceptW('WITH')) c.acceptW('CHECK', 'NOCHECK');
  const addCol = col => P.op({ op: 'addcol', t: tparts, col });
  for (const a of splitTopLevel(c.rest())) {
    const ac = new Cursor(a);
    if (ac.acceptW('ADD')) {
      if (ac.isP('(')) {
        for (const it of ac.groupItems()) parseTableElement(it, tparts, P, addCol);
      } else {
        ac.acceptW('COLUMN');
        ac.acceptSeq('IF', 'NOT', 'EXISTS');
        parseTableElement(ac.rest(), tparts, P, addCol);
      }
    } else if (ac.acceptW('MODIFY') || ac.acceptSeq('ALTER', 'COLUMN') || ac.acceptW('ALTER')) {
      ac.acceptW('COLUMN');
      const items = ac.isP('(') ? ac.groupItems() : [ac.rest()];
      for (const it of items) parseColumnChange(it, tparts, P, false);
    } else if (ac.acceptW('CHANGE')) {
      ac.acceptW('COLUMN');
      parseColumnChange(ac.rest(), tparts, P, true);
    } else if (ac.acceptW('DROP')) {
      if (ac.acceptW('CONSTRAINT') || ac.acceptSeq('FOREIGN', 'KEY') || ac.acceptW('INDEX', 'KEY')) {
        ac.acceptSeq('IF', 'EXISTS');
        if (ac.isIdent()) P.op({ op: 'dropcon', t: tparts, name: ac.next().v });
      } else if (ac.acceptSeq('PRIMARY', 'KEY')) {
        P.op({ op: 'droppk', t: tparts });
      } else {
        ac.acceptW('COLUMN');
        ac.acceptSeq('IF', 'EXISTS');
        const names = ac.isP('(') ? ac.groupItems().map(it => it[0] && it[0].v) : [ac.isIdent() ? ac.next().v : null];
        for (const n of names) if (n) P.op({ op: 'dropcol', t: tparts, col: n });
      }
    } else if (ac.acceptW('RENAME')) {
      if (ac.acceptW('COLUMN') || (ac.isIdent() && ac.peek(1) && ac.peek(1).u === 'TO' && !ac.isW('TO', 'AS'))) {
        const from = ac.isIdent() ? ac.next().v : null;
        ac.acceptW('TO');
        if (from && ac.isIdent()) P.op({ op: 'renamecol', t: tparts, col: from, to: ac.next().v });
      } else if (ac.acceptW('CONSTRAINT')) {
        const from = ac.isIdent() ? ac.next().v : null;
        ac.acceptW('TO');
        if (from && ac.isIdent()) P.op({ op: 'renamecon', t: tparts, name: from, to: ac.next().v });
      } else {
        ac.acceptW('TO', 'AS');
        const to = readName(ac);
        if (to) P.op({ op: 'rename', t: tparts, to: to[to.length - 1] });
      }
    } else if (ac.acceptW('NOCHECK')) {
      ac.acceptW('CONSTRAINT');
      if (ac.isIdent()) P.op({ op: 'state', t: tparts, name: ac.next().v, disabled: true });
    } else if (ac.acceptW('DISABLE', 'ENABLE')) {
      const disabled = a[0].u === 'DISABLE';
      ac.acceptW('NOVALIDATE', 'VALIDATE');
      if (ac.acceptW('CONSTRAINT') && ac.isIdent()) P.op({ op: 'state', t: tparts, name: ac.next().v, disabled });
    } else if (ac.acceptSeq('CHECK', 'CONSTRAINT')) {
      if (ac.isIdent()) P.op({ op: 'state', t: tparts, name: ac.next().v, disabled: false });
    }
  }
}

function parseCreateIndex(c, P) {
  const unique = c.acceptW('UNIQUE');
  while (c.acceptW('BITMAP', 'CLUSTERED', 'NONCLUSTERED', 'MULTIVALUE', 'FULLTEXT', 'SPATIAL', 'SEARCH', 'CUSTOM')) { /* atla */ }
  if (!c.acceptW('INDEX')) return P.skip('CREATE INDEX');
  c.acceptW('CONCURRENTLY');
  c.acceptSeq('IF', 'NOT', 'EXISTS');
  if (!c.isW('ON')) readName(c);
  if (!c.acceptW('ON')) return P.skip('CREATE INDEX');
  c.acceptW('ONLY');
  const t = readName(c);
  if (!t) return;
  if (c.acceptW('USING')) c.next();
  const cols = readColList(c);
  P.stats.indexes++;
  if (unique && cols) P.op({ op: 'uq', t: P.qn(t), cols, index: true });
}

function parseComment(c, P) {
  const kind = c.next();
  if (!kind || kind.t !== 'w') return;
  if (kind.u !== 'TABLE' && kind.u !== 'COLUMN') return P.skip('COMMENT ON ' + kind.u);
  const parts = readName(c);
  if (!parts || !c.acceptW('IS')) return;
  const s = c.peek();
  const text = s && s.t === 's' ? s.v : null;
  P.stats.comments++;
  if (kind.u === 'TABLE') P.op({ op: 'tcomment', t: P.qn(parts), text });
  else if (parts.length >= 2) P.op({ op: 'ccomment', t: P.qn(parts.slice(0, -1)), col: parts[parts.length - 1], text });
}

// T-SQL: EXEC sys.sp_addextendedproperty @name=N'MS_Description', ... ve EXEC sp_rename 'dbo.A', 'B'
function parseExec(c, P) {
  c.next();
  const proc = readName(c);
  const pname = proc ? proc[proc.length - 1].toUpperCase() : '';
  const named = {}, pos = [];
  while (!c.done()) {
    if (c.isP('@') && c.isIdent(1)) {
      c.next();
      const k = c.next().v.toLowerCase();
      c.acceptP('=');
      const v = c.next();
      named[k] = v && v.t !== 'p' ? v.v : null;
    } else {
      const t = c.next();
      if (t.t === 's' || (t.t === 'w' && t.u === 'NULL')) pos.push(t.t === 's' ? t.v : null);
    }
  }
  const g = (k, i) => (named[k] !== undefined ? named[k] : pos[i]);
  if (pname === 'SP_RENAME') {
    const from = String(g('objname', 0) || '').replace(/[[\]"]/g, '').split('.');
    const to = g('newname', 1);
    const type = String(g('objtype', 2) || '').toUpperCase();
    if (!from[0] || !to) return;
    if (type === 'COLUMN' && from.length >= 2) P.op({ op: 'renamecol', t: P.qn(from.slice(0, -1)), col: from[from.length - 1], to });
    else if (!type || type === 'OBJECT') P.op({ op: 'rename', t: P.qn(from), to });
    return;
  }
  if (pname !== 'SP_ADDEXTENDEDPROPERTY') return P.skip('EXEC');
  if (String(g('name', 0) || '').toUpperCase() !== 'MS_DESCRIPTION') return;
  const schema = g('level0name', 3), table = g('level1name', 5), l2type = g('level2type', 6), l2name = g('level2name', 7);
  if (!table) return;
  const tparts = schema ? [schema, table] : [table];
  P.stats.comments++;
  if (l2type && String(l2type).toUpperCase() === 'COLUMN' && l2name) P.op({ op: 'ccomment', t: tparts, col: l2name, text: g('value', 1) });
  else P.op({ op: 'tcomment', t: tparts, text: g('value', 1) });
}

function parseDrop(c, P) {
  if (!c.acceptW('TABLE')) return P.skip('DROP ' + (c.peek() && c.peek().u || ''));
  c.acceptSeq('IF', 'EXISTS');
  for (const it of splitTopLevel(c.rest())) {
    const ic = new Cursor(it);
    const parts = readName(ic);
    if (parts) P.op({ op: 'drop', t: P.qn(parts) });
  }
}

// Oracle: RENAME a TO b · MySQL: RENAME TABLE a TO b, c TO d
function parseRename(c, P) {
  c.acceptW('TABLE');
  for (const it of splitTopLevel(c.rest())) {
    const ic = new Cursor(it);
    const from = readName(ic);
    if (!from || !ic.acceptW('TO')) continue;
    const to = readName(ic);
    if (to) P.op({ op: 'rename', t: P.qn(from), to: to[to.length - 1] });
  }
}

function statementLabel(toks) {
  const w = [];
  for (const t of toks) {
    if (t.t !== 'w') break;
    if (w.length && CREATE_MODIFIERS.has(t.u)) continue;
    w.push(t.u);
    if (w.length === 2 || (w[0] !== 'CREATE' && w[0] !== 'ALTER' && w[0] !== 'DROP')) break;
  }
  return w.join(' ') || '?';
}

/*
 * INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y'): sözlük tablolarındaki kodların anlamını göstermek için.
 * Yalnızca düz değerler (metin, sayı, NULL) okunur; işlev çağrıları bilinmeyen değer olur. INSERT ... SELECT
 * okunmaz. Veri dökümleri büyük olabileceğinden tablo başına ROWS_MAX satırdan sonrası atlanır.
 */
const ROWS_MAX = 2000;
function parseInsert(c, P) {
  c.acceptW('INTO');
  const raw = readName(c);
  if (!raw) return;
  const key = raw.join('.').toUpperCase();
  const seen = P.rowCount.get(key) || 0;
  if (seen >= ROWS_MAX) return;
  const cols = c.isP('(') ? readColList(c) : null;
  if (!c.acceptW('VALUES')) return;
  const rows = [];
  while (c.isP('(') && seen + rows.length < ROWS_MAX) {
    const s = c.i;
    c.skipGroup();
    const row = [];
    for (const item of splitTopLevel(c.toks.slice(s + 1, c.i - 1))) {
      const [a, b] = item;
      if (item.length === 1 && (a.t === 's' || a.t === 'n')) row.push(String(a.v));
      else if (item.length === 1 && a.t === 'w' && a.u === 'NULL') row.push(null);
      else if (item.length === 2 && a.t === 'p' && a.v === '-' && b.t === 'n') row.push('-' + b.v);
      else row.push(undefined);
    }
    rows.push(row);
    if (!c.acceptP(',')) break;
  }
  if (!rows.length) return;
  P.rowCount.set(key, seen + rows.length);
  P.op({ op: 'rows', t: P.qn(raw), cols, rows });
}

// USE ile varsayılan şema seçen lehçeler (MySQL'de veritabanı = şema, Cassandra'da keyspace)
const USE_SETS_SCHEMA = new Set(['mysql', 'mariadb', 'cassandra', 'sql']);

function parseSQL(src, opts = {}) {
  const dialect = opts.dialect || detectDialect(src, opts.file);
  const P = {
    file: opts.file || '',
    dialect,
    ops: [],
    defaultSchema: null,
    rowCount: new Map(),
    line: 0,
    stats: { statements: 0, tables: 0, indexes: 0, comments: 0, skipped: new Map(), errors: [] },
    skip(label) { this.stats.skipped.set(label, (this.stats.skipped.get(label) || 0) + 1); },
    op(o) { o.file = this.file; o.line = this.line; this.ops.push(o); },
    qn(parts) { return parts.length === 1 && this.defaultSchema ? [this.defaultSchema, parts[0]] : parts; },
  };
  const toks = tokenize(src);
  const stmts = splitStatements(toks, { plsql: dialect !== 'cassandra' });
  P.stats.statements = stmts.length;
  for (const st of stmts) {
    const c = new Cursor(st);
    P.line = st[0] ? st[0].line : 0;
    try {
      if (c.acceptW('CREATE')) {
        c.acceptSeq('OR', 'REPLACE');
        const save = c.i;
        while (c.acceptW('GLOBAL', 'PRIVATE', 'TEMPORARY', 'TEMP', 'UNLOGGED', 'SHARDED', 'DUPLICATED', 'BLOCKCHAIN', 'IMMUTABLE', 'LOCAL', 'COLUMNFAMILY')) { /* atla */ }
        if (c.acceptW('TABLE')) { parseCreateTable(c, P); continue; }
        c.i = save;
        if (c.isW('UNIQUE', 'BITMAP', 'CLUSTERED', 'NONCLUSTERED', 'INDEX', 'MULTIVALUE', 'FULLTEXT', 'SPATIAL', 'CUSTOM')) { parseCreateIndex(c, P); continue; }
        P.skip(statementLabel(st));
      } else if (c.acceptSeq('ALTER', 'TABLE')) {
        parseAlterTable(c, P);
      } else if (c.acceptSeq('COMMENT', 'ON')) {
        parseComment(c, P);
      } else if (c.isW('EXEC', 'EXECUTE')) {
        parseExec(c, P);
      } else if (c.acceptW('DROP')) {
        parseDrop(c, P);
      } else if (c.acceptW('RENAME')) {
        parseRename(c, P);
      } else if (c.acceptW('INSERT')) {
        // çizime girmez, raporda sayılır; satırlar yalnızca kod değerlerini göstermek için tutulur
        P.skip('INSERT');
        parseInsert(c, P);
      } else if (c.acceptW('USE')) {
        const parts = readName(c);
        if (parts && USE_SETS_SCHEMA.has(dialect)) P.defaultSchema = parts[parts.length - 1];
      } else {
        P.skip(statementLabel(st));
      }
    } catch (err) {
      P.stats.errors.push({ file: P.file, line: P.line, message: String(err && err.message || err) });
    }
  }
  return { file: P.file, dialect, ops: P.ops, stats: P.stats };
}

Object.assign(NS, { parseSQL });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
