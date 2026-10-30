/*
 * sqlSchema · efcore.js
 * Entity Framework Core'un ürettiği model özetini (Migrations/<Bağlam>ModelSnapshot.cs) okur ve SQL ayrıştırıcısıyla
 * aynı işlem listesine (bkz. sql-parser.js) çevirir. Kod çalıştırılmaz: dosya araç tarafından üretildiği için düzenlidir
 * ve modelin tamamını tek yerde tutar; elle yazılmış entity sınıflarından ve fluent API'den çok daha güvenilirdir.
 *
 * Okunanlar:
 *   modelBuilder.Entity("Ad.Alanı.Sınıf", b => { ... })    aynı varlık birden fazla blokta (ilişkiler ayrı blokta) olabilir
 *   b.Property<T>("Ad")   HasColumnName, HasColumnType, IsRequired, HasMaxLength, HasPrecision, HasDefaultValue(Sql),
 *                         HasComment, HasConversion<T>, UseIdentityColumn
 *   b.HasKey / HasAlternateKey / HasIndex(...).IsUnique()   b.ToTable("Tablo", "şema", t => { HasComment, HasCheckConstraint })
 *   b.HasOne(...).WithMany() | WithOne().HasForeignKey(...).HasPrincipalKey(...).OnDelete(DeleteBehavior.X)
 *   b.OwnsOne / OwnsMany   aynı tabloda (Navigasyon_Kolon) ya da kendi tablosunda
 *   b.HasBaseType   TPH (temel tabloya, kolonlar NULL olabilir), TPT (kendi tablosu + temel tabloya FK), TPC (temel kolonlar kopyalanır)
 *   Çoka çok: EF'in ürettiği ara varlık ("DealerRegion") sıradan bir tablo olarak gelir.
 * Okunmayanlar: ToView / ToSqlQuery ile görünüme bağlanan varlıklar (atlananlar sayılır), HasData tohum verisi.
 * Sağlayıcı (SqlServer, Npgsql, Oracle, MySql, Sqlite) ek sınıf ve not adlarından, olmazsa kolon tiplerinden tahmin edilir.
 */
(function (NS) {
'use strict';

/* ─── C# okuyucu: yalnızca snapshot'ta geçen biçimler ─── */

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    // #pragma, #nullable, #region satırları
    if (ch === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '"' || (ch === '@' && src[i + 1] === '"')) {
      const verbatim = ch === '@';
      let j = i + (verbatim ? 2 : 1), out = '';
      const start = line;
      while (j < n) {
        const c = src[j];
        if (verbatim && c === '"' && src[j + 1] === '"') { out += '"'; j += 2; continue; }
        if (c === '"') { j++; break; }
        if (!verbatim && c === '\\') { const e = src[j + 1]; out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '' : e; j += 2; continue; }
        if (c === '\n') line++;
        out += c;
        j++;
      }
      toks.push({ t: 's', v: out, line: start });
      i = j;
      continue;
    }
    if (ch === '\'') { const e = src.indexOf('\'', i + 1); toks.push({ t: 's', v: src.slice(i + 1, e < 0 ? n : e), line }); i = e < 0 ? n : e + 1; continue; }
    const num = /^-?\d+(\.\d+)?[mMlLfFdDuU]*/.exec(src.slice(i, i + 40));
    if (num && (ch !== '-' || /\d/.test(src[i + 1]))) { toks.push({ t: 'n', v: Number(num[0].replace(/[a-zA-Z]+$/, '')), line }); i += num[0].length; continue; }
    const id = /^@?[A-Za-z_][\w]*/.exec(src.slice(i, i + 200));
    if (id) { toks.push({ t: 'w', v: id[0].replace(/^@/, ''), line }); i += id[0].length; continue; }
    if (ch === '=' && src[i + 1] === '>') { toks.push({ t: 'p', v: '=>', line }); i += 2; continue; }
    toks.push({ t: 'p', v: ch, line });
    i++;
  }
  return toks;
}

// İfade ağacı: { s } metin · { n } sayı · { id } true/false/null/new · { chain: [{ name, gen, args }] } · { lambda: { param, body } }
// body: deyim listesi (blok) ya da tek ifade
class Reader {
  constructor(toks, i = 0) { this.k = toks; this.i = i; }
  peek(o = 0) { return this.k[this.i + o]; }
  isP(v, o = 0) { const t = this.peek(o); return !!t && t.t === 'p' && t.v === v; }
  eatP(v) { if (this.isP(v)) { this.i++; return true; } return false; }
  // açılış parantezinden eşleşen kapanışa kadar atla
  skipBalanced() {
    const open = this.peek().v, close = { '(': ')', '{': '}', '[': ']' }[open];
    let d = 0;
    while (this.i < this.k.length) {
      const t = this.k[this.i++];
      if (t.t !== 'p') continue;
      if (t.v === open) d++;
      else if (t.v === close && --d === 0) return;
    }
  }
  generic() {
    if (!this.isP('<')) return null;
    let d = 0, out = '';
    while (this.i < this.k.length) {
      const t = this.k[this.i++];
      if (t.t === 'p' && t.v === '<') { if (d++) out += '<'; continue; }
      if (t.t === 'p' && t.v === '>') { if (--d === 0) return out; out += '>'; continue; }
      out += t.t === 'p' && t.v === ',' ? ', ' : t.v;
    }
    return out;
  }
  args() {
    const out = [];
    this.eatP('(');
    while (this.i < this.k.length && !this.isP(')')) {
      // adlandırılmış argüman (name: "x") snapshot'ta yok ama zararsız
      if (this.peek().t === 'w' && this.isP(':', 1)) this.i += 2;
      out.push(this.expr());
      if (!this.eatP(',')) break;
    }
    this.eatP(')');
    return out;
  }
  expr() {
    const t = this.peek();
    if (!t) return null;
    if (t.t === 's') { this.i++; return { s: t.v }; }
    if (t.t === 'n') { this.i++; return { n: t.v }; }
    if (t.t === 'p' && t.v === '(') {
      // (string)null gibi tür dönüşümü
      if (this.peek(1) && this.peek(1).t === 'w' && this.isP(')', 2)) { this.i += 3; return this.expr(); }
      this.i++;
      const e = this.expr();
      this.eatP(')');
      return e;
    }
    if (t.t === 'p' && t.v === '-' && this.peek(1) && this.peek(1).t === 'n') { this.i += 2; return { n: -this.peek(-1).v }; }
    if (t.t === 'w') {
      if (t.v === 'new') {
        this.i++;
        while (this.peek() && !this.isP('{') && !this.isP('(') && !this.isP(';') && !this.isP(',') && !this.isP(')')) this.i++;
        if (this.isP('{') || this.isP('(')) this.skipBalanced();
        if (this.isP('{')) this.skipBalanced();
        return { id: 'new' };
      }
      if (this.isP('=>', 1)) {
        const param = t.v;
        this.i += 2;
        if (this.isP('{')) return { lambda: { param, body: this.block() } };
        return { lambda: { param, body: [this.expr()] } };
      }
      return this.chain();
    }
    this.i++;
    return null;
  }
  chain() {
    const chain = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'w') break;
      this.i++;
      const gen = this.generic();
      const args = this.isP('(') ? this.args() : null;
      chain.push({ name: t.v, gen, args, line: t.line });
      if (this.isP('.') && this.peek(1) && this.peek(1).t === 'w') { this.i++; continue; }
      break;
    }
    if (chain.length === 1 && !chain[0].args && /^(true|false|null)$/.test(chain[0].name)) return { id: chain[0].name };
    return { chain };
  }
  block() {
    const out = [];
    this.eatP('{');
    while (this.i < this.k.length && !this.isP('}')) {
      const start = this.i;
      const e = this.expr();
      if (e) out.push(e);
      // deyim sonuna kadar kalanı atla (if, return gibi beklenmeyen biçimler)
      while (this.i < this.k.length && !this.isP(';') && !this.isP('}')) { if (this.isP('{') || this.isP('(')) this.skipBalanced(); else this.i++; }
      this.eatP(';');
      if (this.i === start) this.i++;
    }
    this.eatP('}');
    return out;
  }
}

const str = e => (e && e.s != null ? e.s : null);
const strs = args => (args || []).map(str).filter(x => x != null);
const call = (chain, name) => chain.find(c => c.name === name);
const shortName = s => String(s).split('.').pop();

/* ─── Anlam: varlıklar, özellikler, ilişkiler ─── */

const CLR = {
  int: 'int', long: 'bigint', short: 'smallint', byte: 'tinyint', bool: 'bit', decimal: 'decimal(18,2)', double: 'float', float: 'real',
  string: 'nvarchar', Guid: 'uniqueidentifier', DateTime: 'datetime2', DateTimeOffset: 'datetimeoffset', DateOnly: 'date', TimeOnly: 'time',
  TimeSpan: 'time', 'byte[]': 'varbinary(max)', char: 'nchar(1)',
};
const VALUE_TYPES = /^(int|long|short|byte|sbyte|uint|ulong|ushort|bool|decimal|double|float|char|Guid|DateTime|DateTimeOffset|DateOnly|TimeOnly|TimeSpan)$/;
const DELETE = { Cascade: 'CASCADE', SetNull: 'SET NULL', ClientCascade: null, Restrict: null, NoAction: null, ClientSetNull: null, ClientNoAction: null };

function newEntity(name) {
  return { name, table: undefined, schema: undefined, base: null, strategy: null, props: new Map(), propOrder: [], key: null, akeys: [], indexes: [], rels: [], comment: null, checks: [], owned: null, view: false, line: 0 };
}

function readProperty(st, ent) {
  const head = st.chain[1];
  const name = str(head.args && head.args[0]);
  if (!name) return;
  const p = ent.props.get(name) || { name, clr: null, column: null, type: null, required: false, nullable: null, maxLength: null, precision: null, comment: null, default: null, identity: false, line: head.line };
  const gen = head.gen || '';
  p.clr = gen.replace(/\s/g, '');
  for (const c of st.chain.slice(2)) {
    const a = c.args || [];
    if (c.name === 'HasColumnName') p.column = str(a[0]);
    else if (c.name === 'HasColumnType') p.type = str(a[0]);
    else if (c.name === 'IsRequired') p.required = !(a[0] && a[0].id === 'false');
    else if (c.name === 'HasMaxLength') p.maxLength = a[0] && a[0].n;
    else if (c.name === 'HasPrecision') p.precision = a.map(x => x && x.n).filter(x => x != null);
    else if (c.name === 'HasComment') p.comment = str(a[0]);
    else if (c.name === 'HasDefaultValueSql') p.default = str(a[0]);
    else if (c.name === 'HasDefaultValue') p.default = a[0] ? (a[0].s != null ? `'${a[0].s.replace(/'/g, "''")}'` : a[0].n != null ? String(a[0].n) : a[0].id === 'true' ? '1' : a[0].id === 'false' ? '0' : a[0].chain ? a[0].chain.map(x => x.name).join('.') : null) : null;
    else if (c.name === 'HasConversion' && c.gen) p.clr = c.gen.replace(/\s/g, '');
    else if (c.name === 'UseIdentityColumn' || c.name === 'UseIdentityByDefaultColumn' || c.name === 'UseIdentityAlwaysColumn') p.identity = true;
  }
  ent.props.set(name, p);
  if (!ent.propOrder.includes(name)) ent.propOrder.push(name);
}

// HasOne(hedef, nav).WithMany() | WithOne().HasForeignKey(...)
function readRelationship(st, ent, entities) {
  const ch = st.chain.slice(1);
  const one = call(ch, 'HasOne'), many = call(ch, 'HasMany');
  const target = str((one || many).args && (one || many).args[0]);
  if (!target) return;
  const withOne = call(ch, 'WithOne');
  const fk = call(ch, 'HasForeignKey');
  if (!fk) return;
  let cols = strs(fk.args);
  let dependent = ent.name, principal = target;
  // bire bir: HasForeignKey'in ilk argümanı bağımlı varlığın adıdır
  if ((withOne || many) && cols.length > 1 && (entities.has(cols[0]) || cols[0] === ent.name || cols[0] === target)) {
    dependent = cols[0];
    cols = cols.slice(1);
    principal = dependent === ent.name ? target : ent.name;
  } else if (many) {
    dependent = target;
    principal = ent.name;
  }
  const pk = call(ch, 'HasPrincipalKey');
  let refProps = pk ? strs(pk.args) : null;
  if (refProps && refProps.length > 1 && (entities.has(refProps[0]) || refProps[0] === principal || refProps[0] === dependent)) refProps = refProps.slice(1);
  const del = call(ch, 'OnDelete');
  const delName = del && del.args && del.args[0] && del.args[0].chain ? del.args[0].chain[del.args[0].chain.length - 1].name : null;
  const cname = call(ch, 'HasConstraintName');
  const rel = { dependent, principal, cols, refProps, onDelete: delName && DELETE[delName] !== undefined ? DELETE[delName] : null, name: cname ? str(cname.args[0]) : null, line: ch[0].line };
  const dep = entities.get(dependent) || ent;
  dep.rels.push(rel);
}

function readEntityBlock(name, lambda, entities, ctx, owner) {
  const key = owner ? owner.ent.name + '.' + owner.nav : name;
  if (!entities.has(key)) entities.set(key, newEntity(key));
  const ent = entities.get(key);
  if (owner) ent.owned = { owner: owner.ent.name, nav: owner.nav, many: owner.many, clr: name };
  const param = lambda.param;
  for (const st of lambda.body) {
    if (!st || !st.chain) continue;
    const ch = st.chain;
    // SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<int>("Id"))
    if (ch[0].name !== param) {
      const inner = ch.length > 1 && ch[ch.length - 1].args && ch[ch.length - 1].args[0];
      if (/UseIdentity/.test(ch[ch.length - 1].name) && inner && inner.chain && inner.chain[0].name === param && inner.chain[1] && inner.chain[1].name === 'Property') {
        const p = ent.props.get(str(inner.chain[1].args[0]));
        if (p) p.identity = true;
      }
      if (/SqlServer|Npgsql|Oracle|MySql|Sqlite/.test(ch[0].name)) ctx.provider.push(ch[0].name);
      continue;
    }
    const head = ch[1];
    if (!head) continue;
    ent.line = ent.line || head.line;
    const a = head.args || [];
    if (head.name === 'Property') readProperty(st, ent);
    else if (head.name === 'HasKey') { const n = call(ch, 'HasName'); ent.key = { props: strs(a), name: n ? str(n.args[0]) : null }; }
    else if (head.name === 'HasAlternateKey') { const n = call(ch, 'HasName'); ent.akeys.push({ props: strs(a), name: n ? str(n.args[0]) : null }); }
    else if (head.name === 'HasIndex') {
      const n = call(ch, 'HasDatabaseName') || call(ch, 'HasName');
      ent.indexes.push({ props: strs(a), unique: !!call(ch, 'IsUnique') && !(call(ch, 'IsUnique').args || []).some(x => x && x.id === 'false'), name: n ? str(n.args[0]) : null, line: head.line });
    }
    else if (head.name === 'ToTable') {
      ent.table = a[0] && a[0].id === 'null' ? null : str(a[0]);
      if (str(a[1])) ent.schema = str(a[1]);
      const lam = a.find(x => x && x.lambda);
      if (lam) {
        for (const s of lam.lambda.body) {
          if (!s || !s.chain) continue;
          const c = s.chain[1];
          if (!c) continue;
          if (c.name === 'HasComment') ent.comment = str(c.args[0]);
          else if (c.name === 'HasCheckConstraint') ent.checks.push(str(c.args[1]));
        }
      }
    }
    else if (head.name === 'ToView' || head.name === 'ToSqlQuery' || head.name === 'ToFunction') ent.view = true;
    else if (head.name === 'HasComment') ent.comment = str(a[0]);
    else if (head.name === 'HasCheckConstraint') ent.checks.push(str(a[1]));
    else if (head.name === 'HasBaseType') ent.base = str(a[0]);
    else if (head.name === 'UseTpcMappingStrategy') ent.strategy = 'tpc';
    else if (head.name === 'UseTptMappingStrategy') ent.strategy = 'tpt';
    else if (head.name === 'HasOne' || head.name === 'HasMany') readRelationship(st, ent, entities);
    else if (head.name === 'OwnsOne' || head.name === 'OwnsMany') {
      const lam = a.find(x => x && x.lambda);
      const type = str(a[0]), nav = str(a[1]) || shortName(type);
      if (lam && type) readEntityBlock(type, lam.lambda, entities, ctx, { ent, nav, many: head.name === 'OwnsMany' });
    }
    else if (head.name === 'WithOwner' && owner) {
      const fk = call(ch, 'HasForeignKey');
      if (fk) ent.owned.fk = strs(fk.args);
    }
  }
}

function findModel(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'w' && (t.v === 'BuildModel' || t.v === 'BuildTargetModel')) {
      let j = i;
      while (j < toks.length && !(toks[j].t === 'p' && toks[j].v === '{')) j++;
      return new Reader(toks, j).block();
    }
  }
  return null;
}

// Sağlayıcı: ek sınıf adları ve notlar; yoksa kolon tipleri
function providerOf(names, types) {
  const s = names.join(' ');
  if (/SqlServer/.test(s)) return 'tsql';
  if (/Npgsql/.test(s)) return 'postgres';
  if (/Oracle/.test(s)) return 'oracle';
  if (/MySql/.test(s)) return 'mysql';
  if (/Sqlite/.test(s)) return 'sqlite';
  const ty = types.join(' ').toLowerCase();
  if (/nvarchar|datetime2|uniqueidentifier|\bbit\b/.test(ty)) return 'tsql';
  if (/number\(|nvarchar2|varchar2|timestamp\(7\)/.test(ty)) return 'oracle';
  if (/character varying|timestamp with|\bboolean\b|\bbytea\b|\buuid\b/.test(ty)) return 'postgres';
  if (/longtext|tinyint\(1\)|datetime\(6\)/.test(ty)) return 'mysql';
  if (/^(\s*(integer|text|real|blob)\s*)+$/.test(ty)) return 'sqlite';
  return 'tsql';
}

function looksLikeEfSnapshot(src, file) {
  return /\.cs$/i.test(String(file || '')) && /\bModelSnapshot\b|BuildTargetModel|BuildModel\s*\(\s*ModelBuilder/.test(src) && /\.Entity\s*\(/.test(src);
}

function parseEfCore(src, opts = {}) {
  const file = opts.file || '';
  const stats = { statements: 0, tables: 0, indexes: 0, comments: 0, skipped: new Map(), errors: [] };
  const ops = [];
  const op = (o, line) => { o.file = file; o.line = line || 0; ops.push(o); };
  let dialect = 'tsql';
  try {
    const body = findModel(tokenize(src));
    if (!body) return { file, dialect, ops, stats, orm: 'efcore' };
    const entities = new Map();
    const ctx = { provider: [], defaultSchema: null };
    for (const st of body) {
      if (!st || !st.chain) continue;
      const ch = st.chain;
      stats.statements++;
      if (ch[0].name !== 'modelBuilder') { if (/SqlServer|Npgsql|Oracle|MySql|Sqlite/.test(ch[0].name)) ctx.provider.push(ch[0].name); continue; }
      for (const c of ch.slice(1)) {
        if (c.name === 'HasDefaultSchema') ctx.defaultSchema = str(c.args[0]);
        if (c.name === 'HasAnnotation' && /^(SqlServer|Npgsql|Oracle|MySql|Sqlite):/.test(str(c.args[0]) || '')) ctx.provider.push(str(c.args[0]));
        if (c.name === 'Entity' && c.args && str(c.args[0])) {
          const lam = c.args.find(x => x && x.lambda);
          if (lam) readEntityBlock(str(c.args[0]), lam.lambda, entities, ctx, null);
        }
      }
    }
    dialect = providerOf(ctx.provider, [...entities.values()].flatMap(e => [...e.props.values()].map(p => p.type || '')));
    emit(entities, ctx, op, stats);
  } catch (err) {
    stats.errors.push({ file, line: 0, message: String(err && err.message || err) });
  }
  return { file, dialect, ops, stats, orm: 'efcore' };
}

/* ─── Varlıklardan tablolara ─── */

function emit(entities, ctx, op, stats) {
  const all = [...entities.values()];
  const byName = n => entities.get(n);
  const rootOf = e => { let r = e; const seen = new Set(); while (r.base && byName(r.base) && !seen.has(r)) { seen.add(r); r = byName(r.base); } return r; };
  const strategyOf = e => rootOf(e).strategy;
  // Tablo: ToTable; yoksa TPH'de temel tablonun, owned'da sahibin tablosu; hiçbiri yoksa sınıf adı
  const tableOf = (e, seen = new Set()) => {
    if (seen.has(e)) return null;
    seen.add(e);
    if (e.view) return null;
    if (e.table) return { name: e.table, schema: e.schema || (e.owned && byName(e.owned.owner) && tableOf(byName(e.owned.owner), seen) || {}).schema || ctx.defaultSchema };
    if (e.table === null && !e.base) return null;
    if (e.base && byName(e.base) && strategyOf(e) !== 'tpc' && strategyOf(e) !== 'tpt') return tableOf(byName(e.base), seen);
    if (e.owned && !e.owned.many && byName(e.owned.owner)) return tableOf(byName(e.owned.owner), seen);
    if (e.table === null) return null;
    return { name: shortName(e.owned ? e.owned.clr : e.name), schema: ctx.defaultSchema };
  };
  const parts = tb => (tb.schema ? [tb.schema, tb.name] : [tb.name]);
  const tkey = tb => (tb.schema || '') + '.' + tb.name;
  // Aynı tabloya düşen owned özelliklerin kolon adı Navigasyon_Özellik olur (HasColumnName yoksa)
  const splitOwned = e => e.owned && !e.owned.many && byName(e.owned.owner) && (() => { const a = tableOf(e), b = tableOf(byName(e.owned.owner)); return a && b && tkey(a) === tkey(b); })();
  const navPrefix = e => { const pre = []; let x = e; while (x && splitOwned(x)) { pre.unshift(x.owned.nav); x = byName(x.owned.owner); } return pre.join('_'); };
  const colName = (e, prop) => {
    const p = propOf(e, prop);
    if (p && p.column) return p.column;
    const pre = navPrefix(e);
    return pre ? pre + '_' + prop : prop;
  };
  // Özellik varlıkta yoksa temel sınıflarda aranır
  function propOf(e, name) {
    for (let x = e, i = 0; x && i < 10; x = x.base && byName(x.base), i++) if (x.props.has(name)) return x.props.get(name);
    return null;
  }
  const keyOf = e => { for (let x = e, i = 0; x && i < 10; x = x.base && byName(x.base), i++) if (x.key) return x.key; return null; };

  const tables = new Map();
  const tableFor = e => {
    const tb = tableOf(e);
    if (!tb) return null;
    const k = tkey(tb);
    if (!tables.has(k)) tables.set(k, { parts: parts(tb), columns: [], colIdx: new Set(), pk: null, uqs: [], indexes: [], fks: [], comment: null, checks: [], line: e.line });
    return tables.get(k);
  };
  const typeOf = p => {
    if (p.type) return p.type;
    const base = (p.clr || '').replace(/\?$/, '');
    const t = CLR[base] || base || '?';
    if (t === 'nvarchar') return p.maxLength ? `nvarchar(${p.maxLength})` : 'nvarchar(max)';
    if (base === 'decimal' && p.precision && p.precision.length) return `decimal(${p.precision.join(',')})`;
    return t;
  };
  const nullableOf = p => {
    const clr = p.clr || '';
    if (clr.endsWith('?')) return true;
    if (VALUE_TYPES.test(clr)) return false;
    return !p.required;
  };
  const addColumn = (tbl, e, p, forceNull) => {
    const name = colName(e, p.name);
    if (tbl.colIdx.has(name.toUpperCase())) return;
    tbl.colIdx.add(name.toUpperCase());
    tbl.columns.push({ name, type: typeOf(p), nullable: forceNull || nullableOf(p), pk: false, comment: p.comment, identity: p.identity, default: p.default });
  };

  // TPH'de türetilmiş sınıfın kolonları NULL olabilir; TPC'de somut tablo temel kolonları da taşır
  const order = all.slice().sort((a, b) => depthOf(a) - depthOf(b) || (a.line - b.line));
  function depthOf(e) { let d = 0; for (let x = e; x && x.base && byName(x.base) && d < 10; x = byName(x.base)) d++; return d; }
  for (const e of order) {
    if (e.view) { stats.skipped.set('ToView', (stats.skipped.get('ToView') || 0) + 1); continue; }
    const tbl = tableFor(e);
    if (!tbl) continue;
    const derivedShared = e.base && byName(e.base) && tableOf(byName(e.base)) && tkey(tableOf(byName(e.base))) === tkey(tableOf(e));
    if (e.base && byName(e.base) && !derivedShared) {
      // TPC: temel sınıfın bütün kolonları; TPT: yalnızca anahtar
      const chainUp = [];
      for (let x = byName(e.base), i = 0; x && i < 10; x = x.base && byName(x.base), i++) chainUp.unshift(x);
      const k = keyOf(e);
      for (const b of chainUp) for (const n of b.propOrder || []) if (strategyOf(e) === 'tpc' || (k && k.props.includes(n))) addColumn(tbl, b, b.props.get(n), false);
    }
    for (const n of e.propOrder || []) {
      // aynı tabloya bölünen owned varlıkta sahibin anahtarı tekrar eklenmez
      if (splitOwned(e) && ((e.owned.fk || []).includes(n) || (e.key && e.key.props.includes(n)))) continue;
      addColumn(tbl, e, e.props.get(n), !!derivedShared);
    }
    if (e.comment && !derivedShared) tbl.comment = tbl.comment || e.comment;
    tbl.checks.push(...e.checks.filter(Boolean));
    // TPT / TPC tablosunun anahtarı temel sınıftan gelir
    const k = !splitOwned(e) && !derivedShared ? e.key || (e.base ? keyOf(e) : null) : null;
    if (k && k.props.length && !tbl.pk) tbl.pk = { cols: k.props.map(p => colName(e, p)), name: k.name || 'PK_' + tbl.parts[tbl.parts.length - 1] };
    for (const ak of e.akeys) tbl.uqs.push({ cols: ak.props.map(p => colName(e, p)), name: ak.name });
    for (const ix of e.indexes) (ix.unique ? tbl.uqs : tbl.indexes).push({ cols: ix.props.map(p => colName(e, p)), name: ix.name || 'IX_' + tbl.parts[tbl.parts.length - 1] + '_' + ix.props.map(p => colName(e, p)).join('_'), index: true, line: ix.line });
    // owned kendi tablosundaysa sahibine FK
    if (e.owned && !splitOwned(e) && e.owned.fk && byName(e.owned.owner)) {
      const owner = byName(e.owned.owner);
      const ot = tableOf(owner), ok = keyOf(owner);
      if (ot && ok) tbl.fks.push({ cols: e.owned.fk.map(p => colName(e, p)), ref: parts(ot), refCols: ok.props.map(p => colName(owner, p)), name: null, onDelete: 'CASCADE' });
    }
  }
  // İlişkiler: bağımlı varlığın tablosundan asıl varlığın anahtarına
  for (const e of all) {
    for (const r of e.rels) {
      const dep = byName(r.dependent) || e, pri = byName(r.principal);
      if (!pri || dep.view || pri.view) continue;
      const dt = tableOf(dep), pt = tableOf(pri);
      if (!dt || !pt) continue;
      const tbl = tables.get(tkey(dt));
      const refProps = r.refProps || (keyOf(pri) || { props: [] }).props;
      const cols = r.cols.map(p => colName(dep, p));
      // TPT'de türetilmiş tablonun temel tabloya FK'si ile owned sahibine FK zaten var olabilir
      if (tbl.fks.some(f => f.cols.join() === cols.join() && f.ref.join() === parts(pt).join())) continue;
      tbl.fks.push({ cols, ref: parts(pt), refCols: refProps.map(p => colName(pri, p)), name: r.name || `FK_${dt.name}_${pt.name}_${r.cols.join('_')}`, onDelete: r.onDelete, line: r.line });
    }
  }

  for (const tbl of tables.values()) {
    const line = tbl.line;
    op({ op: 'create', t: tbl.parts, def: { columns: tbl.columns, comment: tbl.comment } }, line);
    stats.tables++;
    if (tbl.comment) stats.comments++;
    if (tbl.pk) op({ op: 'pk', t: tbl.parts, cols: tbl.pk.cols, name: tbl.pk.name }, line);
    for (const u of tbl.uqs) { op({ op: 'uq', t: tbl.parts, cols: u.cols, name: u.name, index: !!u.index }, u.line || line); if (u.index) stats.indexes++; }
    for (const x of tbl.indexes) { op({ op: 'index', t: tbl.parts, cols: x.cols, name: x.name }, x.line || line); stats.indexes++; }
    for (const f of tbl.fks) op({ op: 'fk', t: tbl.parts, cols: f.cols, ref: f.ref, refCols: f.refCols, name: f.name, disabled: false, onDelete: f.onDelete }, f.line || line);
    // CHECK ([Status] IN (1, 2, 3)): izin verilen değer listesi
    for (const sql of tbl.checks) {
      const m = /^\s*\(?\s*[["`]?(\w+)[\]"`]?\s+IN\s*\(([^)]*)\)\s*\)?\s*$/i.exec(sql || '');
      if (m) op({ op: 'check', t: tbl.parts, col: m[1], values: m[2].split(',').map(v => v.trim().replace(/^N?'(.*)'$/, '$1')).filter(Boolean) }, line);
    }
  }
}

Object.assign(NS, { parseEfCore, looksLikeEfSnapshot });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
