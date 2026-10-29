/*
 * sqlSchema · fixes.js
 * Denetim bulguları için lehçeye uygun düzeltme SQL'i. Öneridir: betik çalıştırılmadan önce gözden geçirilir.
 * Metin (açıklama, uyarı) döndürmez; notlar kod olarak döner, arayüz çevirir.
 *
 *   fixFor(f, opts) → { risk: safe | review | risky, steps: [{ sql, note?, comment? }] } ya da null (elle düzeltilir)
 *     risk: safe   veriyi ve kodu değiştirmez (indeks, FK, kısıt adı)
 *           review veri ya da başarım etkilenebilir (PK ekleme, indeks kaldırma, tip genişletme)
 *           risky  veri dönüştürülür ya da ad değişir; uygulama kodu, view ve paketler de değişmeli
 *     note: adımın önüne yazılacak açıklamanın kodu (ya da kod listesi) · comment: adım yorum olarak yazılır (sonra elle çalıştırılır)
 *   fixAll(findings, opts) → [{ f, fix }]   aynı betikte üretilen kısıt ve indeks adları çakışmaz; tablo adını
 *     değiştiren düzeltmeler sona alınır (öncekiler eski adı kullanır)
 *   opts: { indexesKnown }  false: dökümde indeks bilgisi yok, FK'ye indeks önerilmez
 *   opts: { novalidate: true }  FK'ler mevcut veriyi denetlemeden eklenir (Oracle ENABLE NOVALIDATE,
 *         PostgreSQL NOT VALID, SQL Server WITH NOCHECK); veri temizlenince doğrulama adımı yorum olarak eklenir
 */
(function (NS) {
'use strict';

const FIX_NOTES = ['typeMismatch', 'novalidate', 'validateLater', 'orphans', 'checkUsage', 'naturalKey', 'format', 'verify', 'dropFkFirst', 'codeRefs', 'scale', 'length', 'rtrim', 'fkIndex'];

const U = s => String(s == null ? '' : s).toUpperCase();
const NAME_MAX = { oracle: 30, postgres: 63, mysql: 64, mariadb: 64, tsql: 128, sqlite: 128, sql: 63 };
const RESERVED = new Set('ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CASE CHAR CHECK CLUSTER COLUMN COMMENT COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE END EXCLUSIVE EXISTS FILE FLOAT FOR FOREIGN FROM GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT INDEX INITIAL INSERT INTEGER INTERSECT INTO IS JOIN KEY LEVEL LIKE LIMIT LOCK LONG MINUS MODE MODIFY NOT NOWAIT NULL NUMBER OF OFFSET ON OPTION OR ORDER PRIMARY PRIOR PUBLIC RAW REFERENCES RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT START SYNONYM SYSDATE TABLE THEN TO TRIGGER UID UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHEN WHERE WITH TRANSACTION TRAN PROC PROCEDURE PLAN BACKUP CURSOR DATABASE OPEN CLOSE FETCH EXEC EXECUTE IDENTITY MERGE PERCENT PIVOT RULE SCHEMA TOP TRUNCATE'.split(' '));
const TR_ASCII = { 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U', 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Â': 'A', 'â': 'a', 'Î': 'I', 'î': 'i', 'Û': 'U', 'û': 'u' };

const dialectOf = (f, opts) => opts.dialect || (f.t || f.tables[0] || {}).dialect || 'sql';

// Tek harf düzenindeki düz adlar tırnaksız yazılır (veritabanı onları kendi düzenine çevirir); karışık harfli,
// ayrılmış ya da özel karakterli adlar tırnaklanır
function qi(name, d) {
  const n = String(name);
  const plain = /^[A-Za-z_][A-Za-z0-9_$#]*$/.test(n) && !RESERVED.has(U(n));
  const oneCase = n === n.toUpperCase() || n === n.toLowerCase();
  if (d === 'tsql') return plain ? n : '[' + n.replace(/]/g, ']]') + ']';
  if (d === 'mysql' || d === 'mariadb') return plain ? n : '`' + n.replace(/`/g, '``') + '`';
  return plain && oneCase ? n : '"' + n.replace(/"/g, '""') + '"';
}
const qt = (tb, d) => (tb.schema ? qi(tb.schema, d) + '.' : '') + qi(tb.name, d);
const qcols = (cols, d) => cols.map(c => qi(c, d)).join(', ');
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

// Üretilen adlar tablonun harf düzenini izler: küçük harfli şemada fk_siparis_musteri, öbürlerinde FK_SIPARIS_MUSTERI
function caseLike(tb, s) {
  const lower = tb.name === tb.name.toLowerCase();
  return lower ? s.toLowerCase() : s.toUpperCase();
}
function makeName(tb, parts, d, used) {
  const max = NAME_MAX[d] || 30;
  let base = caseLike(tb, parts.join('_').replace(/[^\p{L}\p{N}_]+/gu, '_')).replace(/[^\x00-\x7F]/g, ch => TR_ASCII[ch] || '_');
  if (base.length > max) base = base.slice(0, max);
  let name = base, k = 2;
  while (used.has(U(name))) { const sfx = '_' + k++; name = base.slice(0, max - sfx.length) + sfx; }
  used.add(U(name));
  return name;
}

const hasCol = (tb, name) => tb.colIdx.has(U(name));
const colOf = (tb, name) => tb.colIdx.get(U(name));
// Kolonlar PK, UNIQUE ya da bir indeksin başında mı?
function indexed(tb, cols) {
  const keys = [tb.pk, ...tb.uniques.map(u => u.cols), ...(tb.indexes || []).map(x => x.cols)].filter(k => k && k.length);
  return keys.some(k => cols.length <= k.length && cols.every(c => k.slice(0, cols.length).some(x => U(x) === U(c))));
}

/* ─── Ad değiştirme ─── */

function renameTable(tb, to, d) {
  if (d === 'tsql') return `EXEC sp_rename ${lit((tb.schema ? tb.schema + '.' : '') + tb.name)}, ${lit(to)};`;
  if (d === 'mysql' || d === 'mariadb') return `RENAME TABLE ${qt(tb, d)} TO ${qi(to, d)};`;
  return `ALTER TABLE ${qt(tb, d)} RENAME TO ${qi(to, d)};`;
}
function renameColumn(tb, from, to, d) {
  if (d === 'tsql') return `EXEC sp_rename ${lit((tb.schema ? tb.schema + '.' : '') + tb.name + '.' + from)}, ${lit(to)}, 'COLUMN';`;
  return `ALTER TABLE ${qt(tb, d)} RENAME COLUMN ${qi(from, d)} TO ${qi(to, d)};`;
}
// Ad baskın harf düzenine: BayiPerformans → BAYI_PERFORMANS (upperSnake), bayi_performans (lowerSnake) ...
function toCase(name, style) {
  const w = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').split(/[^A-Za-z0-9\xC0-\u{FFFF}]+/u).filter(Boolean);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (style === 'upperSnake') return w.join('_').toUpperCase();
  if (style === 'lowerSnake') return w.join('_').toLowerCase();
  if (style === 'pascal') return w.map(cap).join('');
  if (style === 'camel') return w.map((s, i) => (i ? cap(s) : s.toLowerCase())).join('');
  return null;
}

/* ─── Tip değiştirme ─── */

// Kolonun tipini değiştiren tek adım (veri dönüşümü gerektirmeyen genişletmeler için)
function alterType(tb, col, type, d) {
  const c = colOf(tb, col), nn = c && !c.nullable;
  if (d === 'oracle') return `ALTER TABLE ${qt(tb, d)} MODIFY (${qi(col, d)} ${type});`;
  if (d === 'tsql') return `ALTER TABLE ${qt(tb, d)} ALTER COLUMN ${qi(col, d)} ${type}${nn ? ' NOT NULL' : ' NULL'};`;
  if (d === 'mysql' || d === 'mariadb') return `ALTER TABLE ${qt(tb, d)} MODIFY COLUMN ${qi(col, d)} ${type}${nn ? ' NOT NULL' : ' NULL'};`;
  if (d === 'sqlite') return null;
  return `ALTER TABLE ${qt(tb, d)} ALTER COLUMN ${qi(col, d)} TYPE ${type};`;
}

// Veri dönüştüren tip değişikliği. PostgreSQL tek adımda (USING); öbürlerinde yeni kolon, kopyalama, doğrulama,
// eski kolonu kaldırma, yeniden adlandırma. conv: lehçeye göre dönüşüm ifadesi (eski kolon adıyla)
function convertSteps(tb, col, d, types, conv, firstNote, used) {
  const c = colOf(tb, col), nn = c && !c.nullable, type = types[d] || types.sql;
  if (d === 'sqlite') return null;
  if (d === 'postgres' || d === 'sql') {
    const steps = [{ sql: `ALTER TABLE ${qt(tb, d)} ALTER COLUMN ${qi(col, d)} TYPE ${type} USING ${conv(qi(col, d))};`, note: firstNote }];
    return steps;
  }
  const tmp = makeName(tb, [col, 'YENI'], d, used);
  const T = qt(tb, d);
  const add = d === 'oracle' ? `ALTER TABLE ${T} ADD (${qi(tmp, d)} ${type});` : d === 'tsql' ? `ALTER TABLE ${T} ADD ${qi(tmp, d)} ${type} NULL;` : `ALTER TABLE ${T} ADD COLUMN ${qi(tmp, d)} ${type} NULL;`;
  const steps = [
    { sql: add },
    { sql: `UPDATE ${T} SET ${qi(tmp, d)} = ${conv(qi(col, d))};`, note: firstNote },
    { sql: `ALTER TABLE ${T} DROP COLUMN ${qi(col, d)};`, note: 'verify' },
    { sql: renameColumn(tb, tmp, col, d) },
  ];
  if (nn) steps.push({ sql: d === 'oracle' ? `ALTER TABLE ${T} MODIFY (${qi(col, d)} NOT NULL);` : d === 'tsql' ? `ALTER TABLE ${T} ALTER COLUMN ${qi(col, d)} ${type} NOT NULL;` : `ALTER TABLE ${T} MODIFY COLUMN ${qi(col, d)} ${type} NOT NULL;` });
  return steps;
}

/* ─── Kurallar ─── */

function addFk(tb, cols, parent, refCols, d, opts, used) {
  if (d === 'sqlite') return null;
  const name = makeName(tb, ['FK', tb.name, parent.name], d, used);
  const T = qt(tb, d), nv = opts.novalidate !== false;
  const ref = `FOREIGN KEY (${qcols(cols, d)}) REFERENCES ${qt(parent, d)} (${qcols(refCols, d)})`;
  const steps = [];
  if (d === 'oracle') {
    steps.push({ sql: `ALTER TABLE ${T} ADD CONSTRAINT ${qi(name, d)} ${ref}${nv ? ' ENABLE NOVALIDATE' : ''};`, note: nv ? 'novalidate' : null });
    if (nv) steps.push({ sql: `ALTER TABLE ${T} MODIFY CONSTRAINT ${qi(name, d)} VALIDATE;`, note: 'validateLater', comment: true });
  } else if (d === 'postgres' || d === 'sql') {
    steps.push({ sql: `ALTER TABLE ${T} ADD CONSTRAINT ${qi(name, d)} ${ref}${nv ? ' NOT VALID' : ''};`, note: nv ? 'novalidate' : null });
    if (nv) steps.push({ sql: `ALTER TABLE ${T} VALIDATE CONSTRAINT ${qi(name, d)};`, note: 'validateLater', comment: true });
  } else if (d === 'tsql') {
    steps.push({ sql: `ALTER TABLE ${T} WITH ${nv ? 'NOCHECK' : 'CHECK'} ADD CONSTRAINT ${qi(name, d)} ${ref};`, note: nv ? 'novalidate' : null });
    if (nv) steps.push({ sql: `ALTER TABLE ${T} WITH CHECK CHECK CONSTRAINT ${qi(name, d)};`, note: 'validateLater', comment: true });
  } else {
    steps.push({ sql: `ALTER TABLE ${T} ADD CONSTRAINT ${qi(name, d)} ${ref};` });
  }
  return steps;
}
function addIndex(tb, cols, d, used, note) {
  const name = makeName(tb, ['IX', tb.name, ...cols], d, used);
  return { sql: `CREATE INDEX ${qi(name, d)} ON ${qt(tb, d)} (${qcols(cols, d)});`, note };
}

const NUM_TYPE = { oracle: 'NUMBER(18,2)', tsql: 'decimal(18,2)', mysql: 'DECIMAL(18,2)', mariadb: 'DECIMAL(18,2)', sql: 'numeric(18,2)', postgres: 'numeric(18,2)' };
const INT_TYPE = { oracle: 'NUMBER(10)', tsql: 'int', mysql: 'INT', mariadb: 'INT', sql: 'integer', postgres: 'integer' };
const QUANTITY = /(^|_)(ADET|ADEDI|QTY|QUANTITY|MIKTAR|MIKTARI|COUNT|SAYI|SAYISI)$/i;
const TIMESTAMPISH = /(^|_)(AT|TS|TIMESTAMP|ZAMAN|ZAMANI)$/i;

const RULES = {
  'fk-missing'(f, d, opts, used) {
    const cols = f.col.split(', ');
    const steps = addFk(f.t, cols, f.data.parent, [f.data.refCol], d, opts, used);
    if (!steps) return null;
    // tipler uyuşmuyorsa FK tanımlanabilir ama tip farkı (CHAR / VARCHAR, dar kolon) görünür hâle gelir
    const a = colOf(f.t, cols[0]), b = colOf(f.data.parent, f.data.refCol);
    const ta = a && NS.typeInfo(a.type), tb = b && NS.typeInfo(b.type);
    const mismatch = ta && tb && ta.family !== 'other' && tb.family !== 'other' && (ta.family !== tb.family || ta.fixed !== tb.fixed || (ta.len != null && tb.len != null && ta.len < tb.len));
    if (mismatch) steps[0].note = ['typeMismatch'].concat(steps[0].note || []);
    // MySQL FK için indeksi kendisi kurar
    if (opts.indexesKnown !== false && !indexed(f.t, cols) && d !== 'mysql' && d !== 'mariadb') steps.push(addIndex(f.t, cols, d, used, 'fkIndex'));
    return { risk: mismatch ? 'review' : 'safe', steps };
  },
  'fk-no-index'(f, d, opts, used) {
    return { risk: 'safe', steps: [addIndex(f.t, f.col.split(', '), d, used)] };
  },
  'disabled-fk'(f, d) {
    const name = f.data.name, T = qt(f.t, d);
    if (!name || !['oracle', 'tsql', 'postgres'].includes(d)) return null;
    const cols = f.col.split(', '), ref = f.data.refCols || [];
    const steps = [];
    // önce yetim satırlar: üst tabloda karşılığı olmayan kayıtlar varsa doğrulama başarısız olur
    if (cols.length === 1 && ref.length === 1) {
      steps.push({ sql: `SELECT c.* FROM ${T} c WHERE c.${qi(cols[0], d)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${qt(f.data.parent, d)} p WHERE p.${qi(ref[0], d)} = c.${qi(cols[0], d)});`, note: 'orphans' });
    }
    steps.push({ sql: d === 'oracle' ? `ALTER TABLE ${T} ENABLE VALIDATE CONSTRAINT ${qi(name, d)};` : d === 'tsql' ? `ALTER TABLE ${T} WITH CHECK CHECK CONSTRAINT ${qi(name, d)};` : `ALTER TABLE ${T} VALIDATE CONSTRAINT ${qi(name, d)};` });
    return { risk: 'review', steps };
  },
  'duplicate-index'(f, d) {
    const name = f.data.name;
    if (!name) return null;
    const ix = qi(name, d), on = d === 'tsql' || d === 'mysql' || d === 'mariadb' ? ` ON ${qt(f.t, d)}` : '';
    const owner = (d === 'oracle' || d === 'postgres') && f.t.schema ? qi(f.t.schema, d) + '.' : '';
    return { risk: 'review', steps: [{ sql: `DROP INDEX ${owner}${ix}${on};`, note: 'checkUsage' }] };
  },
  'no-pk'(f, d, opts, used) {
    if (f.data.appendOnly || d === 'sqlite') return null;
    const tb = f.t, T = qt(tb, d);
    // eklenen kolonun adı şemanın baskın PK adlandırmasını izler (ID, <TABLO>_ID, <TABLO>_NO)
    const style = f.data.pkStyle;
    const col = caseLike(tb, style === 'tableId' || (!style && hasCol(tb, 'ID')) ? tb.name + '_ID' : style === 'tableOther' ? tb.name + '_NO' : 'ID');
    if (hasCol(tb, col)) return null;
    const pk = makeName(tb, ['PK', tb.name], d, used);
    const c = qi(col, d);
    const add = {
      oracle: `ALTER TABLE ${T} ADD (${c} NUMBER(18) GENERATED BY DEFAULT AS IDENTITY);`,
      tsql: `ALTER TABLE ${T} ADD ${c} bigint IDENTITY(1,1) NOT NULL;`,
      mysql: `ALTER TABLE ${T} ADD COLUMN ${c} BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;`,
      mariadb: `ALTER TABLE ${T} ADD COLUMN ${c} BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST;`,
    }[d] || `ALTER TABLE ${T} ADD COLUMN ${c} bigint GENERATED BY DEFAULT AS IDENTITY;`;
    const steps = [{ sql: add, note: 'naturalKey' }];
    if (d !== 'mysql' && d !== 'mariadb') steps.push({ sql: `ALTER TABLE ${T} ADD CONSTRAINT ${qi(pk, d)} PRIMARY KEY (${c});` });
    return { risk: 'review', steps };
  },
  'fk-type-mismatch'(f, d) {
    // yalnızca aynı tip ailesinde genişletme: veri dönüşmez
    const a = NS.typeInfo(f.data.type), b = NS.typeInfo(f.data.refType);
    const ints = ['SMALLINT', 'INT', 'INTEGER', 'BIGINT', 'INT2', 'INT4', 'INT8', 'SERIAL', 'BIGSERIAL'];
    const wider = a.len != null && b.len != null ? a.len < b.len && (a.scale || 0) === (b.scale || 0) : ints.includes(a.base) && ints.includes(b.base);
    if (a.family !== b.family || a.fixed !== b.fixed || !wider) return null;
    const sql = alterType(f.t, f.col, f.data.refType, d);
    if (!sql) return null;
    return { risk: 'review', steps: [{ sql, note: d === 'tsql' || d === 'mysql' || d === 'mariadb' ? 'dropFkFirst' : null }] };
  },
  'date-as-text'(f, d, opts, used) {
    const ts = TIMESTAMPISH.test(f.col);
    const types = ts ? { oracle: 'TIMESTAMP', tsql: 'datetime2', mysql: 'DATETIME', mariadb: 'DATETIME', sql: 'timestamp', postgres: 'timestamp' } : { oracle: 'DATE', tsql: 'date', mysql: 'DATE', mariadb: 'DATE', sql: 'date', postgres: 'date' };
    const conv = {
      oracle: c => `TO_DATE(${c}, 'YYYY-MM-DD')`,
      tsql: c => `TRY_CONVERT(${types.tsql}, ${c}, 23)`,
      mysql: c => `STR_TO_DATE(${c}, '%Y-%m-%d')`, mariadb: c => `STR_TO_DATE(${c}, '%Y-%m-%d')`,
    }[d] || (c => `to_date(${c}, 'YYYY-MM-DD')`);
    const steps = convertSteps(f.t, f.col, d, types, conv, 'format', used);
    return steps && { risk: 'risky', steps };
  },
  'number-as-text'(f, d, opts, used) {
    const types = QUANTITY.test(f.col) ? INT_TYPE : NUM_TYPE;
    const conv = { oracle: c => `TO_NUMBER(${c})`, tsql: c => `TRY_CONVERT(${types.tsql}, ${c})` }[d] || (c => `CAST(${c} AS ${types[d] || types.sql})`);
    const steps = convertSteps(f.t, f.col, d, types, conv, 'verify', used);
    return steps && { risk: 'risky', steps };
  },
  'money-as-float'(f, d, opts, used) {
    // Oracle duyarlığı küçültürken dolu kolonu değiştirmez (ORA-01440): yeni kolona kopyalanır
    if (d === 'oracle') {
      const steps = convertSteps(f.t, f.col, d, NUM_TYPE, c => `ROUND(${c}, 2)`, 'scale', used);
      return { risk: 'review', steps };
    }
    if (d === 'postgres' || d === 'sql') return { risk: 'review', steps: [{ sql: `ALTER TABLE ${qt(f.t, d)} ALTER COLUMN ${qi(f.col, d)} TYPE numeric(18,2) USING round(${qi(f.col, d)}::numeric, 2);`, note: 'scale' }] };
    const sql = alterType(f.t, f.col, NUM_TYPE[d] || NUM_TYPE.sql, d);
    return sql && { risk: 'review', steps: [{ sql, note: 'scale' }] };
  },
  'char-for-variable'(f, d) {
    const steps = [];
    for (const col of f.data.cols) {
      const c = colOf(f.t, col);
      if (!c) continue;
      const type = String(c.type).replace(/^(N?)CHAR(ACTER)?\b/i, (m, n) => (d === 'oracle' ? (n ? 'NVARCHAR2' : 'VARCHAR2') : (n ? 'NVARCHAR' : 'VARCHAR')));
      const sql = alterType(f.t, col, type, d);
      if (!sql) return null;
      steps.push({ sql });
      // CHAR'ın doldurduğu boşluklar VARCHAR'a da geçer (PostgreSQL ve MySQL dönüşümde kırpar)
      if (d === 'oracle' || d === 'tsql') steps.push({ sql: `UPDATE ${qt(f.t, d)} SET ${qi(col, d)} = RTRIM(${qi(col, d)});`, note: 'rtrim' });
    }
    return steps.length ? { risk: 'review', steps } : null;
  },
  'lob-for-short'(f, d, opts, used) {
    const steps = [];
    for (const col of f.data.cols) {
      if (d === 'oracle') steps.push(...convertSteps(f.t, col, d, { oracle: 'VARCHAR2(1000 CHAR)' }, c => `DBMS_LOB.SUBSTR(${c}, 1000, 1)`, 'length', used));
      else if (d === 'tsql') steps.push({ sql: alterType(f.t, col, 'nvarchar(1000)', d), note: 'length' });
      else if (d === 'mysql' || d === 'mariadb') steps.push({ sql: alterType(f.t, col, 'VARCHAR(1000)', d), note: 'length' });
      else return null;
    }
    return { risk: 'risky', steps };
  },
  'system-name'(f, d, opts, used) {
    if (!['oracle', 'postgres', 'tsql'].includes(d)) return null;
    const tb = f.t, T = qt(tb, d), steps = [];
    for (const old of f.data.names) {
      const n = U(old);
      let kind = null, parts = null;
      if (tb.pkName && U(tb.pkName) === n) { kind = 'pk'; parts = ['PK', tb.name]; }
      const uq = tb.uniques.find(u => U(u.name) === n);
      if (uq) { kind = 'uq'; parts = ['UQ', tb.name, ...uq.cols]; }
      const fk = tb.out.find(r => r.kind === 'fk' && U(r.name) === n);
      if (fk) { kind = 'fk'; parts = ['FK', tb.name, fk.parent.name]; }
      const ix = (tb.indexes || []).find(x => U(x.name) === n);
      if (ix) { kind = 'ix'; parts = ['IX', tb.name, ...ix.cols]; }
      if (!kind) continue;
      const to = makeName(tb, parts, d, used);
      if (d === 'tsql') steps.push({ sql: `EXEC sp_rename ${lit((tb.schema ? tb.schema + '.' : '') + old)}, ${lit(to)}, ${kind === 'ix' ? `'INDEX'` : `'OBJECT'`};` });
      else if (kind === 'ix') steps.push({ sql: `ALTER INDEX ${qi(old, d)} RENAME TO ${qi(to, d)};` });
      else {
        steps.push({ sql: `ALTER TABLE ${T} RENAME CONSTRAINT ${qi(old, d)} TO ${qi(to, d)};` });
        // Oracle'da PK ve UNIQUE'in indeksi de sistem adını taşır
        if (d === 'oracle' && (kind === 'pk' || kind === 'uq')) steps.push({ sql: `ALTER INDEX ${qi(old, d)} RENAME TO ${qi(to, d)};` });
      }
    }
    return steps.length ? { risk: 'safe', steps } : null;
  },
  'non-ascii-name'(f, d) {
    const tb = f.t, steps = [];
    let tableTo = null;
    const ascii = s => s.replace(/[^\x00-\x7F]/g, ch => TR_ASCII[ch] || '_');
    for (const old of f.data.names) {
      const to = ascii(old);
      if (to === old) continue;
      if (U(old) === U(tb.name)) tableTo = to;
      else if (hasCol(tb, to)) return null;
      else steps.push({ sql: renameColumn(tb, old, to, d) });
    }
    if (tableTo) steps.push({ sql: renameTable(tb, tableTo, d), renamesTable: true });
    if (!steps.length) return null;
    steps[0].note = 'codeRefs';
    return { risk: 'risky', steps };
  },
  'naming-case'(f, d) {
    const to = toCase(f.col || f.t.name, f.data.dominant);
    if (!to || to === (f.col || f.t.name)) return null;
    if (f.col && hasCol(f.t, to) && U(to) !== U(f.col)) return null;
    return { risk: 'risky', steps: [{ sql: f.col ? renameColumn(f.t, f.col, to, d) : renameTable(f.t, to, d), note: 'codeRefs', renamesTable: !f.col }] };
  },
  'pk-style'(f, d) {
    const tb = f.t;
    const to = f.data.dominant === 'id' ? caseLike(tb, 'ID') : f.data.dominant === 'tableId' ? caseLike(tb, tb.name + '_ID') : null;
    if (!to || !f.col || hasCol(tb, to)) return null;
    return { risk: 'risky', steps: [{ sql: renameColumn(tb, f.col, to, d), note: 'codeRefs' }] };
  },
  'fk-style'(f, d) {
    const tb = f.t, parent = f.data.ref;
    if (!parent || f.data.dominant !== 'targetId') return null;
    const to = caseLike(tb, parent.name + '_ID');
    if (hasCol(tb, to)) return null;
    return { risk: 'risky', steps: [{ sql: renameColumn(tb, f.col, to, d), note: 'codeRefs' }] };
  },
};

function fixFor(f, opts = {}, used = new Set()) {
  const rule = RULES[f.rule];
  if (!rule || !f.t) return null;
  const fix = rule(f, dialectOf(f, opts), opts, used);
  return fix && fix.steps && fix.steps.length && fix.steps.every(s => s && s.sql) ? fix : null;
}

// Bütün bir betik için: üretilen adlar çakışmasın diye mevcut kısıt ve indeks adları baştan dolu
function fixAll(findings, opts = {}) {
  const used = new Set();
  for (const f of findings) for (const tb of f.tables) {
    for (const n of [tb.pkName, ...tb.uniques.map(u => u.name), ...(tb.indexes || []).map(x => x.name), ...tb.out.map(r => r.name)]) if (n) used.add(U(n));
  }
  const out = findings.map(f => ({ f, fix: fixFor(f, opts, used) })).filter(x => x.fix);
  const late = x => x.fix.steps.some(s => s.renamesTable);
  return out.filter(x => !late(x)).concat(out.filter(late));
}

Object.assign(NS, { fixFor, fixAll, FIX_NOTES, FIXABLE: Object.keys(RULES) });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
