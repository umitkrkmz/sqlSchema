/*
 * sqlSchema · migrate.js
 * Şema farkından (diff.js) "önce"yi "sonra"ya getiren SQL taslağı. Adımlar bağımlılık sırasıyla yazılır:
 *   dropFk     kaldırılan ya da değişen FK ve UNIQUE (eski adlarla, tablo adları değişmeden önce)
 *   rename     tablo ve kolon adları (fark tahmin ettiyse; tahmin olduğu notta yazılır)
 *   create     yeni tablolar (kolonlar, DEFAULT, NOT NULL, PK)
 *   addCol     eklenen kolonlar        alterCol  tip, NULL ve DEFAULT değişiklikleri
 *   pk         değişen birincil anahtar dropCol   kaldırılan kolonlar
 *   addKey     yeni UNIQUE ve FK       dropTable kaldırılan tablolar
 * Taslaktır: veri dönüşümü (metinden tarihe) ve doldurma yazılmaz, notla gösterilir. Metin değil kod döndürür.
 *
 *   migrationSteps(diff, { dialect }) → [{ phase, table, sql, note?, risk, comment? }]
 *     risk: safe | review | risky · note: kod ya da kod listesi (arayüz çevirir) · comment: adım yorum olarak yazılır
 *   MIGRATION_NOTES: not kodları
 */
(function (NS) {
'use strict';

const MIGRATION_NOTES = ['renameGuess', 'noName', 'notNullNoDefault', 'convert', 'dataLoss', 'tsqlDefault', 'pkDrop'];
const PHASES = ['dropFk', 'rename', 'create', 'addCol', 'alterCol', 'pk', 'dropCol', 'addKey', 'dropTable'];
const U = s => String(s == null ? '' : s).toUpperCase();

function migrationSteps(diff, opts = {}) {
  const T = NS.sqlTools;
  const anyTable = diff.tables.map(e => e.after || e.before).find(Boolean);
  const d = opts.dialect || (anyTable && anyTable.dialect) || 'sql';
  if (d === 'mongodb' || d === 'cassandra') return [];
  const { qi, qt, qcols, makeName, renameTable, renameColumn, alterType } = T;
  const used = new Set();
  for (const e of diff.tables) for (const tb of [e.before, e.after].filter(Boolean)) {
    for (const n of [tb.pkName, ...tb.uniques.map(u => u.name), ...(tb.indexes || []).map(x => x.name), ...tb.out.map(r => r.name)]) if (n) used.add(U(n));
  }
  const steps = [];
  const push = (phase, table, sql, risk = 'safe', note = null, comment = false) => steps.push({ phase, table: table.name, sql, risk, note, comment });
  const my = d === 'mysql' || d === 'mariadb';
  const colDef = c => `${qi(c.name, d)} ${c.type || 'varchar(255)'}${c.default != null ? ' DEFAULT ' + c.default : ''}${c.nullable ? '' : ' NOT NULL'}`;
  const dropConstraint = (tb, name, kind) => (my ? `ALTER TABLE ${qt(tb, d)} DROP ${kind === 'fk' ? 'FOREIGN KEY' : 'INDEX'} ${qi(name, d)};` : `ALTER TABLE ${qt(tb, d)} DROP CONSTRAINT ${qi(name, d)};`);
  const onDelete = r => (r.onDelete && r.onDelete !== 'NO ACTION' && r.onDelete !== 'RESTRICT' ? ' ON DELETE ' + r.onDelete : '');

  for (const e of diff.tables) {
    if (e.status === 'same') continue;
    const before = e.before, after = e.after;
    // 1) kaldırılan FK ve UNIQUE: yeni tanımlar sonra eklenir; @ref bir açıklamadır, kısıt değil
    for (const f of e.fks) {
      if (f.status !== 'removed' || f.rel.kind !== 'fk') continue;
      if (f.rel.name) push('dropFk', f.rel.child, dropConstraint(f.rel.child, f.rel.name, 'fk'));
      else push('dropFk', f.rel.child, dropConstraint(f.rel.child, '?', 'fk'), 'review', 'noName', true);
    }
    for (const x of e.uq || []) {
      if (x.status !== 'removed') continue;
      const name = x.u.name;
      const sql = x.u.index && !my ? `DROP INDEX ${name ? qi(name, d) : '?'}${d === 'tsql' ? ' ON ' + qt(before, d) : ''};` : dropConstraint(before, name || '?', 'uq');
      push('dropFk', before, sql, name ? 'safe' : 'review', name ? null : 'noName', !name);
    }
    // 2) adlar: önce tablo, sonra kolon (kolon adı değişikliği yeni tablo adıyla yazılır)
    if (e.renamed) push('rename', after, renameTable(before, after.name, d), 'review', 'renameGuess');
    for (const c of e.cols) if (c.status === 'renamed') push('rename', after, renameColumn(after, c.from, c.name, d), 'review', 'renameGuess');
    // 3) yeni tablo
    if (e.status === 'added') {
      const lines = after.columns.map(c => '  ' + colDef(c));
      if (after.pk.length) lines.push(`  CONSTRAINT ${qi(after.pkName || makeName(after, ['PK', after.name], d, used), d)} PRIMARY KEY (${qcols(after.pk, d)})`);
      // UNIQUE kısıtlar tabloyla; benzersiz indeksler ayrı CREATE UNIQUE INDEX olarak anahtar aşamasında
      for (const u of after.uniques) if (!u.index) lines.push(`  CONSTRAINT ${qi(u.name || makeName(after, ['UQ', after.name, ...u.cols], d, used), d)} UNIQUE (${qcols(u.cols, d)})`);
      push('create', after, `CREATE TABLE ${qt(after, d)} (\n${lines.join(',\n')}\n);`);
      for (const u of after.uniques) if (u.index) push('addKey', after, `CREATE UNIQUE INDEX ${qi(u.name || makeName(after, ['UX', after.name, ...u.cols], d, used), d)} ON ${qt(after, d)} (${qcols(u.cols, d)});`);
    }
    // 4) eklenen kolonlar: NOT NULL ve DEFAULT'suzsa dolu tabloda hata verir
    for (const c of e.cols) {
      if (c.status !== 'added' || e.status === 'added') continue;
      const def = colDef(c.after);
      const sql = d === 'oracle' ? `ALTER TABLE ${qt(after, d)} ADD (${def});` : d === 'tsql' ? `ALTER TABLE ${qt(after, d)} ADD ${def};` : `ALTER TABLE ${qt(after, d)} ADD COLUMN ${def};`;
      const risky = !c.after.nullable && c.after.default == null;
      push('addCol', after, sql, risky ? 'review' : 'safe', risky ? 'notNullNoDefault' : null);
    }
    // 5) değişen kolonlar: tip, NULL, DEFAULT
    for (const c of e.cols) {
      if (!c.before || !c.after || !c.changes.length) continue;
      const a = c.after, name = a.name, Q = qt(after, d), C = qi(name, d);
      const typeChanged = c.changes.includes('type');
      if (typeChanged) {
        const ta = NS.typeInfo(c.before.type), tb2 = NS.typeInfo(a.type);
        const widening = ta.family === tb2.family && ta.fixed === tb2.fixed && (ta.len == null || tb2.len == null || ta.len <= tb2.len);
        const sql = alterType(after, name, a.type, d);
        if (sql) push('alterCol', after, sql, widening ? 'review' : 'risky', widening ? null : 'convert');
      }
      // SQL Server ve MySQL'de tip değişikliği NULL bilgisini de yazar
      if (c.changes.includes('null') && !(typeChanged && (d === 'tsql' || my))) {
        const nn = !a.nullable;
        const sql = d === 'oracle' ? `ALTER TABLE ${Q} MODIFY (${C} ${nn ? 'NOT NULL' : 'NULL'});`
          : d === 'tsql' ? `ALTER TABLE ${Q} ALTER COLUMN ${C} ${a.type}${nn ? ' NOT NULL' : ' NULL'};`
          : my ? `ALTER TABLE ${Q} MODIFY COLUMN ${C} ${a.type}${nn ? ' NOT NULL' : ' NULL'};`
          : `ALTER TABLE ${Q} ALTER COLUMN ${C} ${nn ? 'SET' : 'DROP'} NOT NULL;`;
        push('alterCol', after, sql, nn ? 'review' : 'safe');
      }
      if (c.changes.includes('default')) {
        const v = a.default;
        if (d === 'tsql') push('alterCol', after, `ALTER TABLE ${Q} ADD CONSTRAINT ${qi(makeName(after, ['DF', after.name, name], d, used), d)} DEFAULT ${v == null ? 'NULL' : v} FOR ${C};`, 'review', 'tsqlDefault', true);
        else if (d === 'oracle') push('alterCol', after, `ALTER TABLE ${Q} MODIFY (${C} DEFAULT ${v == null ? 'NULL' : v});`);
        else push('alterCol', after, `ALTER TABLE ${Q} ALTER COLUMN ${C} ${v == null ? 'DROP DEFAULT' : 'SET DEFAULT ' + v};`);
      }
    }
    // 6) birincil anahtar: eskisi kaldırılır, yenisi eklenir (ona bağlı FK'ler önce düşmüş olmalı)
    if (e.pk) {
      if (e.pk.before.length) {
        const name = before.pkName || (d === 'postgres' || d === 'sql' ? before.name + '_pkey' : null);
        const sql = d === 'oracle' || my ? `ALTER TABLE ${qt(after, d)} DROP PRIMARY KEY;` : name ? `ALTER TABLE ${qt(after, d)} DROP CONSTRAINT ${qi(name, d)};` : `ALTER TABLE ${qt(after, d)} DROP CONSTRAINT ?;`;
        push('pk', after, sql, 'review', name || d === 'oracle' || my ? 'pkDrop' : 'noName', !name && d !== 'oracle' && !my);
      }
      if (e.pk.after.length) push('pk', after, `ALTER TABLE ${qt(after, d)} ADD CONSTRAINT ${qi(after.pkName || makeName(after, ['PK', after.name], d, used), d)} PRIMARY KEY (${qcols(e.pk.after, d)});`, 'review');
    }
    // 7) kaldırılan kolonlar: veri kaybolur
    for (const c of e.cols) if (c.status === 'removed') push('dropCol', after, `ALTER TABLE ${qt(after, d)} DROP COLUMN ${qi(c.name, d)};`, 'risky', 'dataLoss');
    // 8) yeni UNIQUE ve FK
    for (const x of e.uq || []) {
      if (x.status !== 'added') continue;
      const name = x.u.name || makeName(after, [x.u.index ? 'UX' : 'UQ', after.name, ...x.u.cols], d, used);
      push('addKey', after, x.u.index ? `CREATE UNIQUE INDEX ${qi(name, d)} ON ${qt(after, d)} (${qcols(x.u.cols, d)});` : `ALTER TABLE ${qt(after, d)} ADD CONSTRAINT ${qi(name, d)} UNIQUE (${qcols(x.u.cols, d)});`, 'review');
    }
    for (const f of e.fks) {
      if (f.status !== 'added' || f.rel.kind !== 'fk' || !f.rel.refCols.length) continue;
      const r = f.rel, name = r.name || makeName(r.child, ['FK', r.child.name, r.parent.name], d, used);
      push('addKey', r.child, `ALTER TABLE ${qt(r.child, d)} ADD CONSTRAINT ${qi(name, d)} FOREIGN KEY (${qcols(r.cols, d)}) REFERENCES ${qt(r.parent, d)} (${qcols(r.refCols, d)})${onDelete(r)};`);
    }
    // indeksler farkta yok: kolon kümesiyle burada karşılaştırılır (adı değişen kolonlar eşlenir)
    if (after && e.status !== 'removed') {
      const ren = new Map(e.cols.filter(c => c.status === 'renamed').map(c => [U(c.from), c.name]));
      const sig = (x, map) => x.cols.map(c => U((map && map.get(U(c))) || c)).join(',');
      const was = new Map((before ? before.indexes || [] : []).map(x => [sig(x, ren), x])), now = new Map((after.indexes || []).map(x => [sig(x), x]));
      for (const [k, x] of was) if (!now.has(k) && x.name) push('dropFk', before, `DROP INDEX ${qi(x.name, d)}${d === 'tsql' || my ? ' ON ' + qt(before, d) : ''};`, 'review');
      for (const [k, x] of now) if (!was.has(k)) push('addKey', after, `CREATE INDEX ${qi(x.name || makeName(after, ['IX', after.name, ...x.cols], d, used), d)} ON ${qt(after, d)} (${qcols(x.cols, d)});`);
    }
    // 9) kaldırılan tablo: FK'leri 1. adımda düştü
    if (e.status === 'removed') push('dropTable', before, `DROP TABLE ${qt(before, d)};`, 'risky', 'dataLoss');
  }
  // aşama sırası korunur; aşama içinde farkın tablo sırası
  return steps.map((s, i) => [s, i]).sort((a, b) => PHASES.indexOf(a[0].phase) - PHASES.indexOf(b[0].phase) || a[1] - b[1]).map(x => x[0]);
}

Object.assign(NS, { migrationSteps, MIGRATION_NOTES, MIGRATION_PHASES: PHASES });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
