/*
 * sqlSchema · export.js
 * Şemayı başka araçlara ve belgelere taşır: Markdown veri sözlüğü, Mermaid erDiagram, PlantUML (IE), DBML, CSV.
 * Hepsi verilen tablo kümesiyle çalışır (bütün şema, tek şema, alt diyagram, seçim); ilişki iki ucu kümedeyse yazılır.
 * Markdown ve CSV'nin başlık ve sözcükleri için çeviri işlevi (tr) dışarıdan verilir; modül kendi metnini üretmez.
 *
 *   exportSchema(model, format, { tables, tr, title, date, sep }) → metin
 *     format: md | mermaid | plantuml | dbml | csv · tables: varsayılan dış tablolar hariç hepsi · sep: CSV ayırıcısı
 *   EXPORT_FORMATS: [{ id, ext, mime }]
 */
(function (NS) {
'use strict';

const EXPORT_FORMATS = [
  { id: 'md', ext: 'md', mime: 'text/markdown' },
  { id: 'mermaid', ext: 'mmd', mime: 'text/plain' },
  { id: 'plantuml', ext: 'puml', mime: 'text/plain' },
  { id: 'dbml', ext: 'dbml', mime: 'text/plain' },
  { id: 'csv', ext: 'csv', mime: 'text/csv' },
];

const U = s => String(s == null ? '' : s).toUpperCase();
const TR_ASCII = { '\xC7': 'C', '\u{11E}': 'G', '\u{130}': 'I', '\xD6': 'O', '\u{15E}': 'S', '\xDC': 'U', '\xE7': 'c', '\u{11F}': 'g', '\u{131}': 'i', '\xF6': 'o', '\u{15F}': 's', '\xFC': 'u' };
const qname = tb => (tb.schema ? tb.schema + '.' : '') + tb.name;
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const values = c => (c.values || []).map(v => (v.label ? `${v.code} = ${v.label}` : v.code)).join(', ');

function scopeOf(model, opts) {
  const tables = (opts.tables || model.tables.filter(tb => !tb.external))
    .slice().sort((a, b) => qname(a).localeCompare(qname(b)));
  const set = new Set(tables);
  const rels = model.rels.filter(r => set.has(r.child) && set.has(r.parent))
    .slice().sort((a, b) => qname(a.child).localeCompare(qname(b.child)) || a.cols.join().localeCompare(b.cols.join()) || qname(a.parent).localeCompare(qname(b.parent)));
  return { tables, rels };
}

// Diyagram araçlarının kabul ettiği kimlik: harf, rakam, alt çizgi; çakışanlara sıra eki
function idMaker() {
  const used = new Map(), seen = new Set();
  return tb => {
    if (used.has(tb)) return used.get(tb);
    let id = qname(tb).replace(/[^\x00-\x7F]/g, ch => TR_ASCII[ch] || '_').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
    let out = id, k = 2;
    while (seen.has(U(out))) out = id + '_' + k++;
    seen.add(U(out));
    used.set(tb, out);
    return out;
  };
}
// İlişkinin iki ucu; IE / crow's foot (Mermaid ve PlantUML aynı işaretleri kullanır)
const LEFT = { one: '||', zeroOne: '|o', zeroMany: '}o' };
const RIGHT = { zeroOne: 'o|', zeroMany: 'o{' };
// Tanımlayıcı ilişki: FK kolonları alt tablonun PK'sinin parçası (ara tablo, ayrıntı satırı)
const identifying = r => r.kind !== 'implicit' && r.cols.length > 0 && r.cols.every(c => r.child.pk.some(p => U(p) === U(c)));
const keysOf = (tb, c) => {
  const k = [];
  if (c.pk) k.push('PK');
  // yalnızca tanımlı FK; @ref ve tahmini bağlantı kısıt değildir
  if (tb.out.some(r => r.kind === 'fk' && r.cols.some(x => U(x) === U(c.name)))) k.push('FK');
  if (!c.pk && tb.uniques.some(u => u.cols.length === 1 && U(u.cols[0]) === U(c.name))) k.push('UK');
  return k;
};

/* ─── Markdown veri sözlüğü ─── */

// GitHub başlık bağlantısı: küçük harf, noktalama atılır, boşluk tire olur
const anchor = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function toMarkdown(model, opts) {
  const tr = opts.tr || (k => k);
  const { tables, rels } = scopeOf(model, opts);
  const cell = s => oneLine(s).replace(/\|/g, '\\|');
  const code = s => '`' + String(s).replace(/`/g, "'") + '`';
  const link = tb => `[${qname(tb)}](#${anchor(qname(tb))})`;
  const out = [`# ${tr('exMdTitle', { title: opts.title || '' })}`, '', tr('exMdMeta', { tables: tables.length, rels: rels.length, date: opts.date || '' }), ''];
  out.push(`## ${tr('exMdToc')}`, '');
  for (const tb of tables) out.push(`- ${link(tb)}${tb.comment ? ': ' + cell(tb.comment).slice(0, 100) : ''}`);
  out.push('');
  for (const tb of tables) {
    out.push(`## ${qname(tb)}`, '');
    if (tb.comment) out.push(oneLine(tb.comment), '');
    if (tb.columns.length) {
      out.push(`| ${tr('exCol')} | ${tr('exType')} | ${tr('exNull')} | ${tr('exKey')} | ${tr('exDesc')} |`, '|---|---|---|---|---|');
      for (const c of tb.columns) {
        const desc = [c.comment && !c.commentUsed ? cell(c.comment) : '', values(c) ? `${tr('exValues')}: ${cell(values(c))}` : ''].filter(Boolean).join(' · ');
        out.push(`| ${code(c.name)} | ${cell(c.type || '')} | ${tr(c.nullable ? 'exYes' : 'exNo')} | ${keysOf(tb, c).join(', ')} | ${desc} |`);
      }
      out.push('');
    }
    const outs = rels.filter(r => r.child === tb && r.kind !== 'embed'), ins = rels.filter(r => r.parent === tb && r.kind !== 'embed');
    if (outs.length) {
      out.push(`**${tr('exRefs')}**`, '');
      for (const r of outs) {
        const notes = [tr(r.parentEnd === 'one' ? 'exMandatory' : 'exOptional'), r.kind === 'implicit' ? tr('exInferred') : '', r.filter ? r.filter : ''].filter(Boolean).join(', ');
        out.push(`- ${r.cols.map(code).join(', ')} \u{2192} ${link(r.parent)} ${r.refCols.map(code).join(', ')} (${notes})`);
      }
      out.push('');
    }
    if (ins.length) {
      out.push(`**${tr('exRefBy')}**`, '');
      for (const r of ins) out.push(`- ${link(r.child)} ${r.cols.map(code).join(', ')}${r.kind === 'implicit' ? ' (' + tr('exInferred') + ')' : ''}`);
      out.push('');
    }
  }
  return out.join('\n');
}

/* ─── Mermaid erDiagram ─── */

function toMermaid(model, opts) {
  const { tables, rels } = scopeOf(model, opts);
  const id = idMaker();
  const tok = (s, fallback) => { let x = String(s).replace(/[^\x00-\x7F]/g, ch => TR_ASCII[ch] || '_').replace(/[^A-Za-z0-9_()[\]-]/g, '_'); if (!/^[A-Za-z]/.test(x)) x = fallback + x; return x; };
  const out = ['erDiagram'];
  for (const tb of tables) {
    if (!tb.columns.length) continue;
    out.push(`  ${id(tb)} {`);
    for (const c of tb.columns) {
      const keys = keysOf(tb, c).join(', ');
      const note = c.comment ? ` "${oneLine(c.comment).replace(/"/g, "'").slice(0, 80)}"` : '';
      out.push(`    ${tok(c.type || 'unknown', 't_')} ${tok(c.name, 'c_')}${keys ? ' ' + keys : ''}${note}`);
    }
    out.push('  }');
  }
  for (const r of rels) {
    const line = identifying(r) ? '--' : '..';
    const label = r.cols.join(', ') + (r.kind === 'implicit' ? ' (?)' : '') + (r.filter ? ' ' + r.filter : '');
    out.push(`  ${id(r.parent)} ${LEFT[r.parentEnd]}${line}${RIGHT[r.childEnd]} ${id(r.child)} : "${label.replace(/"/g, "'")}"`);
  }
  return out.join('\n') + '\n';
}

/* ─── PlantUML (IE notasyonu) ─── */

function toPlantUml(model, opts) {
  const { tables, rels } = scopeOf(model, opts);
  const id = idMaker();
  const out = ['@startuml', 'hide circle', 'skinparam linetype ortho', ''];
  for (const tb of tables) {
    out.push(`entity "${qname(tb).replace(/"/g, "'")}" as ${id(tb)} {`);
    const pk = tb.columns.filter(c => c.pk), rest = tb.columns.filter(c => !c.pk);
    // * zorunlu (NOT NULL); PK kolonları çizginin üstünde
    const row = c => `  ${c.nullable ? '' : '* '}${c.name} : ${c.type || '?'}${keysOf(tb, c).map(k => ` <<${k}>>`).join('')}`;
    for (const c of pk) out.push(row(c));
    if (pk.length && rest.length) out.push('  --');
    for (const c of rest) out.push(row(c));
    out.push('}', '');
  }
  for (const r of rels) {
    const line = r.kind === 'implicit' ? '..' : '--';
    out.push(`${id(r.parent)} ${LEFT[r.parentEnd]}${line}${RIGHT[r.childEnd]} ${id(r.child)} : ${r.cols.join(', ')}${r.kind === 'implicit' ? ' (?)' : ''}`);
  }
  out.push('@enduml');
  return out.join('\n') + '\n';
}

/* ─── DBML (dbdiagram.io) ─── */

function toDbml(model, opts) {
  const { tables, rels } = scopeOf(model, opts);
  const q = s => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '"' + String(s).replace(/"/g, '\\"') + '"');
  const tn = tb => (tb.schema ? q(tb.schema) + '.' : '') + q(tb.name);
  const type = s => (!s ? 'unknown' : /^[A-Za-z_][\w]*(\([\d\s,]*\))?(\[\])?$/.test(s) ? s : '"' + String(s).replace(/"/g, '\\"') + '"');
  const note = s => "'" + oneLine(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const out = [];
  for (const tb of tables) {
    out.push(`Table ${tn(tb)}${tb.comment ? ` [note: ${note(tb.comment)}]` : ''} {`);
    for (const c of tb.columns) {
      const set = [];
      if (c.pk && tb.pk.length === 1) set.push('pk');
      if (!c.nullable) set.push('not null');
      if (!c.pk && tb.uniques.some(u => u.cols.length === 1 && U(u.cols[0]) === U(c.name))) set.push('unique');
      const desc = [c.comment && !c.commentUsed ? oneLine(c.comment) : '', values(c)].filter(Boolean).join(' · ');
      if (desc) set.push(`note: ${note(desc)}`);
      out.push(`  ${q(c.name)} ${type(c.type)}${set.length ? ' [' + set.join(', ') + ']' : ''}`);
    }
    if (tb.pk.length > 1) out.push('', '  indexes {', `    (${tb.pk.map(q).join(', ')}) [pk]`, '  }');
    out.push('}', '');
  }
  // Ref yalnızca tanımlı ilişkiler için; tahmini ilişki ve sözlük bağlantısı yorum olarak
  const side = (tb, cols) => (cols.length === 1 ? `${tn(tb)}.${q(cols[0])}` : `${tn(tb)}.(${cols.map(q).join(', ')})`);
  for (const r of rels) {
    if (r.kind === 'embed' || !r.refCols.length) continue;
    const ref = `${side(r.child, r.cols)} ${r.oneToOne ? '-' : '>'} ${side(r.parent, r.refCols)}`;
    if (r.kind === 'fk') out.push(`Ref: ${ref}`);
    else out.push(`// ${r.kind === 'implicit' ? '?' : '@ref'} ${ref}${r.filter ? ' ' + r.filter : ''}`);
  }
  return out.join('\n') + '\n';
}

/* ─── CSV ─── */

function toCsv(model, opts) {
  const tr = opts.tr || (k => k);
  const sep = opts.sep || ',';
  const { tables, rels } = scopeOf(model, opts);
  const f = v => { const s = String(v == null ? '' : v); return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [tr('exCsvHead').map(f).join(sep)];
  for (const tb of tables) {
    for (const c of tb.columns) {
      const targets = rels.filter(r => r.child === tb && r.kind !== 'embed' && r.cols.some(x => U(x) === U(c.name)))
        .map(r => `${qname(r.parent)}.${r.refCols[r.cols.findIndex(x => U(x) === U(c.name))] || ''}${r.kind === 'implicit' ? ' (?)' : ''}`);
      rows.push([tb.schema || '', tb.name, c.name, c.type || '', tr(c.nullable ? 'exYes' : 'exNo'), c.pk ? 'PK' : '', targets.join(' | '), oneLine(c.comment), values(c)].map(f).join(sep));
    }
  }
  return rows.join('\r\n') + '\r\n';
}

function exportSchema(model, format, opts = {}) {
  const fn = { md: toMarkdown, mermaid: toMermaid, plantuml: toPlantUml, dbml: toDbml, csv: toCsv }[format];
  if (!fn) throw new Error('format: ' + format);
  return fn(model, opts);
}

Object.assign(NS, { exportSchema, EXPORT_FORMATS });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
