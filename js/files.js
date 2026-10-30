/*
 * sqlSchema · files.js
 * Bir dosya kümesini işlenecek sıraya koyar ve her dosyayı uygun ayrıştırıcıya yollar.
 *
 * Sıralama, migration araçlarının kurallarını izler:
 *   Flyway        V1__init.sql, V1_1__x.sql, V2__y.sql   sürüm numarasına göre; R__*.sql en sonda; U*__ atlanır
 *   golang-migrate / dbmate   000001_x.up.sql            .down.sql atlanır
 *   Zaman damgalı 20240115093000_x.sql
 *   Numaralı      01_tables.sql, 02_fks.sql
 *   Prisma        20240115093000_init/migration.sql      sürüm klasör adında
 *   Diesel        2024-01-15-093000_init/up.sql          down.sql atlanır
 *   Diğerleri     doğal ad sırası (a2.sql < a10.sql)
 * Sıra yanlış olsa da sorun çıkmaz: model.js, tablosu henüz tanımlanmamış ALTER'ları sona saklar.
 */
(function (NS) {
'use strict';

const { parseSQL, parseMongo, looksLikeMongo, parseEfCore, looksLikeEfSnapshot, detectDialect } = NS;

const SQL_EXT = /\.(sql|ddl|pls|pks|pkb|plb|tab|cql|psql|txt)$/i;
const MONGO_EXT = /\.(json|jsonl|ndjson|js|mjs|cjs|ts)$/i;
const IGNORED = /(^|\/)(node_modules|\.git|dist|build|coverage|bin|obj)\/|(^|\/)(package(-lock)?|tsconfig|jsconfig|composer|bower|manifest|\.?eslintrc|\.?prettierrc|angular|vercel|firebase|appsettings|launchSettings)(\.[\w-]+)?\.json$|\.(config|conf|min)\.(js|json)$/i;
// .NET projesinde yalnızca EF Core model özeti okunur; entity sınıfları ve migration kodu atlanır
const EF_SNAPSHOT = /ModelSnapshot\.cs$/i;

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const baseName = p => String(p).split('/').pop();
const dirName = p => { const i = String(p).lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
// Adı her sürümde aynı olan dosyalar (Prisma, Diesel): sürüm ve görünen ad klasörden gelir
const GENERIC = /^(migration|up|down)\.sql$/i;
const FOLDER_VERSION = [
  { re: /^(\d{14})_/, tool: 'Prisma', version: m => [Number(m[1])] },
  { re: /^(\d{4})-(\d{2})-(\d{2})-(\d{6})_/, tool: 'Diesel', version: m => [Number(m.slice(1, 5).join(''))] },
];
function folderVersion(path) {
  if (!GENERIC.test(baseName(path))) return null;
  const folder = baseName(dirName(path));
  for (const v of FOLDER_VERSION) { const m = v.re.exec(folder); if (m) return { folder, tool: v.tool, version: v.version(m) }; }
  return null;
}
// Sürümün görünen adı: V3__pricing, Prisma'da 20240115093000_init
const fileLabel = p => { const fv = folderVersion(p); return fv ? fv.folder : baseName(p).replace(/\.[^.]+$/, ''); };

// skip: atlanma nedeni kodu (arayüz çevirir: config, ext, down, undo, project)
// *.sqlschema.json sqlSchema'nın proje dosyasıdır (borç kaydı, görünümler): şema değil, arayüz ayrıca okur
function classify(path) {
  const name = baseName(path);
  if (/.sqlschema.json$/i.test(name)) return { path, name, skip: 'project' };
  if (IGNORED.test(path)) return { path, name, skip: 'config' };
  if (EF_SNAPSHOT.test(name)) return { path, name, kind: 'plain' };
  if (!SQL_EXT.test(name) && !MONGO_EXT.test(name)) return { path, name, skip: 'ext' };
  if (/\.down\.sql$/i.test(name)) return { path, name, skip: 'down' };
  const fv = folderVersion(path);
  if (fv) return /^down\./i.test(name) ? { path, name, skip: 'down' } : { path, name, kind: 'migration', tool: fv.tool, version: fv.version };
  if (/^U\d[\w.]*__/i.test(name)) return { path, name, skip: 'undo' };
  let m;
  if ((m = /^V(\d+(?:[._]\d+)*)__/i.exec(name))) return { path, name, kind: 'migration', tool: 'Flyway', version: m[1].split(/[._]/).map(Number) };
  if (/^R__/i.test(name)) return { path, name, kind: 'repeatable', tool: 'Flyway' };
  if ((m = /^(\d+)_.+\.up\.sql$/i.exec(name))) return { path, name, kind: 'migration', tool: 'migrate', version: [Number(m[1])] };
  if ((m = /^(\d{12,14})[_-]/.exec(name))) return { path, name, kind: 'migration', tool: 'timestamp', version: [Number(m[1])] };
  if ((m = /^(\d+)[_\-. ]/.exec(name))) return { path, name, kind: 'ordered', version: [Number(m[1])] };
  return { path, name, kind: 'plain' };
}

const RANK = { migration: 0, ordered: 0, plain: 1, repeatable: 2 };

function compareVersion(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

// files: [{ path, ... }] → aynı nesneler, işlem sırasında; atlananlar ayrı listede
function orderFiles(files) {
  const keep = [], skipped = [];
  for (const f of files) {
    const c = classify(f.path);
    if (c.skip) { skipped.push({ file: f, reason: c.skip }); continue; }
    keep.push({ f, c });
  }
  keep.sort((x, y) => {
    const d = natural(dirName(x.f.path), dirName(y.f.path));
    if (d) return d;
    const r = RANK[x.c.kind] - RANK[y.c.kind];
    if (r) return r;
    if (x.c.version && y.c.version) { const v = compareVersion(x.c.version, y.c.version); if (v) return v; }
    return natural(x.c.name, y.c.name);
  });
  const migrations = keep.filter(k => k.c.kind === 'migration');
  return {
    files: keep.map(k => Object.assign(k.f, { order: k.c })),
    skipped,
    migration: migrations.length >= 2 ? migrations[0].c.tool : null,
  };
}

// Dosyayı uygun ayrıştırıcıya yollar. null: dosyada şema bilgisi yok.
function parseFile(path, text) {
  const name = baseName(path);
  if (EF_SNAPSHOT.test(name)) {
    if (!looksLikeEfSnapshot(text, name)) return null;
    const r = parseEfCore(text, { file: path });
    return r.ops.length ? r : null;
  }
  if (MONGO_EXT.test(name)) {
    if (!looksLikeMongo(text, name)) return null;
    const r = parseMongo(text, { file: path });
    return r.ops.length ? r : null;
  }
  return parseSQL(text, { file: path, dialect: detectDialect(text, name) });
}

// Lehçe ipucu taşımayan dosyalar (yalnızca ALTER TABLE ya da INSERT içerenler gibi) aynı klasördeki
// baskın lehçeyi alır; böylece bölünmüş bir PostgreSQL dökümü raporda "SQL + PostgreSQL" görünmez.
function harmonizeDialects(results) {
  const byDir = new Map();
  for (const r of results) {
    if (r.dialect === 'sql' || r.dialect === 'mongodb') continue;
    const d = dirName(r.file);
    if (!byDir.has(d)) byDir.set(d, new Map());
    byDir.get(d).set(r.dialect, (byDir.get(d).get(r.dialect) || 0) + 1);
  }
  for (const r of results) {
    if (r.dialect !== 'sql') continue;
    const counts = byDir.get(dirName(r.file)) || [...byDir.values()].reduce((m, c) => { for (const [k, v] of c) m.set(k, (m.get(k) || 0) + v); return m; }, new Map());
    let best = null, n = 0;
    for (const [k, v] of counts) if (v > n) { best = k; n = v; }
    if (best) r.dialect = best;
  }
  return results;
}

// "Ayrı veritabanları" kipinde dosyanın ait olduğu veritabanının adı:
// dosyalar farklı klasörlerdeyse klasör, hepsi aynı klasördeyse dosya adı
function databaseNames(paths) {
  const dirs = new Set(paths.map(p => String(p).split('/').slice(0, -1).join('/')));
  const out = new Map();
  for (const p of paths) {
    const segs = String(p).split('/');
    if (dirs.size > 1) {
      const common = commonPrefix([...dirs].map(d => d.split('/')));
      out.set(p, segs[common] && segs.length - 1 > common ? segs[common] : baseName(p).replace(/\.[^.]+$/, ''));
    } else {
      out.set(p, baseName(p).replace(/\.[^.]+$/, ''));
    }
  }
  return out;
}

function commonPrefix(lists) {
  let i = 0;
  while (lists.every(l => l.length > i && l[i] === lists[0][i])) i++;
  return i;
}

Object.assign(NS, { classify, fileLabel, orderFiles, parseFile, databaseNames, harmonizeDialects });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
