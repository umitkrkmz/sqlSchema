#!/usr/bin/env node
/*
 * sqlSchema komut satırı denetimi: tarayıcıdaki tasarım denetimi, borç kaydı ve değişiklik incelemesi CI'da.
 *
 *   node tools/sqlschema-lint.js <dosya|klasör>... [seçenekler]
 *
 *   --since V15            migration klasöründe V15 ve sonrasını incele (önce = V15'ten önceki sürümler)
 *   --baseline <yol>       bu dosya ya da klasörle karşılaştırarak incele (ör. ana dalın kopyası)
 *   --project <dosya>      borç kaydı (*.sqlschema.json); verilmezse taranan klasörde aranır
 *   --format text|md|json|sarif   çıktı biçimi (varsayılan text)
 *   --out <dosya>          çıktıyı dosyaya yaz (varsayılan standart çıktı)
 *   --fix <dosya>          güvenli ve gözden geçirilecek düzeltme SQL'ini dosyaya yaz
 *   --fail-on error|warning|info|none   bu önemde yeni bulgu varsa çıkış kodu 1 (varsayılan error)
 *   --lang tr|en           metin dili (varsayılan tr)
 *   --separate             farklı klasörleri ayrı veritabanı say
 *
 * Çıkış kodu: 0 eşik altında, 1 eşikte ya da üstünde bulgu, 2 kullanım hatası ya da şema bulunamadı.
 * Dosyalar yalnızca okunur; ağ isteği yapılmaz. Bağımlılık yoktur: js/ altındaki çekirdek modüller kullanılır.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['i18n', 'lexer', 'sql-parser', 'mongo', 'files', 'model', 'diff', 'conventions', 'audit', 'fixes']) require(path.join(ROOT, 'js', f + '.js'));
const NS = globalThis.sqlSchema;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/* ─── Seçenekler ─── */

function parseArgs(argv) {
  const o = { paths: [], format: 'text', failOn: 'error', lang: 'tr', separate: false };
  const need = (i, k) => { if (i >= argv.length || argv[i].startsWith('--')) usage(`${k} bir değer bekler`); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') o.since = need(++i, a);
    else if (a === '--baseline') o.baseline = need(++i, a);
    else if (a === '--project') o.project = need(++i, a);
    else if (a === '--format') o.format = need(++i, a);
    else if (a === '--out') o.out = need(++i, a);
    else if (a === '--fix') o.fix = need(++i, a);
    else if (a === '--fail-on') o.failOn = need(++i, a);
    else if (a === '--lang') o.lang = need(++i, a);
    else if (a === '--separate') o.separate = true;
    else if (a === '--help' || a === '-h') { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).map(l => l.replace(/^ \* ?/, '')).join('\n') + '\n'); process.exit(0); }
    else if (a.startsWith('--')) usage(`bilinmeyen seçenek: ${a}`);
    else o.paths.push(a);
  }
  if (!o.paths.length) usage('denetlenecek dosya ya da klasör verilmedi');
  if (!['text', 'md', 'json', 'sarif'].includes(o.format)) usage(`--format: ${o.format}`);
  if (!['error', 'warning', 'info', 'none'].includes(o.failOn)) usage(`--fail-on: ${o.failOn}`);
  if (!['tr', 'en'].includes(o.lang)) usage(`--lang: ${o.lang}`);
  if (o.since && o.baseline) usage('--since ve --baseline birlikte kullanılmaz');
  return o;
}
function usage(msg) {
  process.stderr.write(`sqlschema-lint: ${msg}\nKullanım: node tools/sqlschema-lint.js <dosya|klasör>... [--since V15 | --baseline <yol>] [--format text|md|json|sarif] [--fail-on error|warning|info|none]\n`);
  process.exit(2);
}

/* ─── Dosyalar ─── */

// Klasörler özyinelemeli taranır; yollar taranan köke göre (tarayıcının klasör seçimindeki gibi) yazılır
function collect(paths) {
  const out = [];
  const walk = (abs, rel) => {
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (/^(node_modules|\.git)$/.test(path.basename(abs))) return;
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name), rel + '/' + name);
    } else out.push({ abs, path: rel.replace(/^\//, '') });
  };
  for (const p of paths) {
    if (!fs.existsSync(p)) usage(`bulunamadı: ${p}`);
    const abs = path.resolve(p);
    walk(abs, fs.statSync(abs).isDirectory() ? path.basename(abs) : path.basename(abs));
  }
  return out;
}

// Tarayıcıyla aynı kodlama kuralları: UTF-16 (SSMS), UTF-8, değilse Windows-1254 (eski Oracle dökümleri)
function decode(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf.slice(2));
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\u{FFFD}')) return utf8.replace(/^\u{FEFF}/u, '');
  try { return new TextDecoder('windows-1254').decode(buf); } catch (err) { return utf8; }
}

function read(paths) {
  const files = [], projects = [];
  for (const f of collect(paths)) {
    const c = NS.classify(f.path);
    if (c.skip === 'project') projects.push(f);
    else if (!c.skip) files.push({ path: f.path, text: decode(fs.readFileSync(f.abs)) });
  }
  return { files, projects };
}

// Uygulamanın yaptığı gibi: sırala, ayrıştır, lehçeleri uyumla, model
function build(files, separate) {
  const { files: ordered, migration } = NS.orderFiles(files);
  const parsed = [];
  for (const f of ordered) { const r = NS.parseFile(f.path, f.text); if (r) parsed.push({ f, r }); }
  NS.harmonizeDialects(parsed.map(x => x.r));
  const fam = d => (d === 'mariadb' ? 'mysql' : d);
  const sep = separate || new Set(parsed.map(x => fam(x.r.dialect)).filter(d => d !== 'sql')).size > 1;
  const names = NS.databaseNames(parsed.map(x => x.f.path));
  const model = NS.buildModel(parsed.map(x => ({ ...x.r, db: sep ? names.get(x.f.path) : 'main' })));
  return { model, ordered: parsed.map(x => x.f), migration };
}

/* ─── Metin ─── */

function translator(lang) {
  return (key, vars) => {
    const v = NS.i18nRaw(lang, key) !== undefined ? NS.i18nRaw(lang, key) : NS.i18nRaw('en', key);
    if (v === undefined) return key;
    return typeof v === 'function' ? v(vars || {}) : v;
  };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const tr = translator(o.lang);
  const ruleText = id => tr('auditRules')[id];
  const label = f => (f.t ? f.t.name + (f.col ? '.' + f.col : '') : f.col || '');
  const what = f => ruleText(f.rule).what(NS.auditVars(f, tr));
  const where = f => { const tb = f.t || f.tables[0]; return tb && tb.src ? { file: tb.src.file, line: tb.src.line } : null; };

  const { files, projects } = read(o.paths);
  if (!files.length) { process.stderr.write('sqlschema-lint: şema dosyası bulunamadı\n'); process.exit(2); }

  // önce / sonra: --since migration klasöründe bir sürümden ayırır, --baseline ayrı bir kopyayı okur
  let before = null, scope = o.paths.join(' ');
  const after = build(files, o.separate);
  if (!after.model.tables.length) { process.stderr.write('sqlschema-lint: tablo bulunamadı\n'); process.exit(2); }
  if (o.since) {
    const base = p => path.basename(p).replace(/\.[^.]+$/, '');
    const i = after.ordered.findIndex(f => base(f.path) === o.since || base(f.path).startsWith(o.since + '__'));
    if (i < 0) usage(`--since: ${o.since} sürümü bulunamadı`);
    before = build(after.ordered.slice(0, i), o.separate).model;
    scope = `${base(after.ordered[i - 1] ? after.ordered[i - 1].path : '') || '∅'} → ${base(after.ordered[after.ordered.length - 1].path)}`;
  } else if (o.baseline) {
    before = build(read([o.baseline]).files, o.separate).model;
    scope = `${o.baseline} → ${o.paths.join(' ')}`;
  }

  // borç kaydı: --project ya da taranan klasördeki *.sqlschema.json
  let debt = null, projectName = null;
  const projFile = o.project ? { abs: path.resolve(o.project), path: o.project } : projects[0];
  if (projFile) {
    try {
      const data = JSON.parse(fs.readFileSync(projFile.abs, 'utf8'));
      if (data && data.app === 'sqlSchema' && data.debt && Array.isArray(data.debt.keys)) { debt = data.debt.keys.map(String); projectName = path.basename(projFile.path); }
    } catch (err) { process.stderr.write(`sqlschema-lint: proje dosyası okunamadı: ${projFile.path}\n`); }
  }

  const audit = NS.auditModel(after.model, { debt });
  const review = before ? NS.reviewChange(before, after.model, { debt }) : null;
  const findings = review ? review.findings : audit.findings.filter(f => !f.debt);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const RANK = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const dialects = [...new Set(after.model.tables.map(t => t.dialect).filter(Boolean))].map(d => NS.DIALECTS[d] || d).join(', ');
  const countLine = c => ['error', 'warning', 'info'].filter(k => c[k]).map(k => tr({ error: 'sevError', warning: 'sevWarning', info: 'sevInfo' }[k], { n: c[k] })).join(' · ');

  let out;
  if (o.format === 'json') {
    out = JSON.stringify({
      tool: 'sqlSchema', version: VERSION, mode: review ? 'review' : 'audit', scope, dialects,
      tables: audit.tables, counts, debt: audit.debt ? { total: audit.debt.total, left: audit.debt.left, paid: audit.debt.paid.length } : null,
      findings: findings.map(f => ({ rule: f.rule, severity: f.severity, key: f.key, table: f.t ? f.t.name : null, column: f.col, tables: f.tables.map(t => t.name), title: ruleText(f.rule).title, detail: what(f), location: where(f) })),
      resolved: review ? review.fixed.map(f => ({ rule: f.rule, key: f.key })) : undefined,
      skipped: audit.skipped,
    }, null, 2) + '\n';
  } else if (o.format === 'sarif') {
    const level = { error: 'error', warning: 'warning', info: 'note' };
    out = JSON.stringify({
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
      runs: [{
        tool: { driver: { name: 'sqlSchema', version: VERSION, informationUri: 'https://github.com/umitkrkmz/sqlSchema',
          rules: NS.AUDIT_RULES.map(r => ({ id: r.id, name: r.id, shortDescription: { text: ruleText(r.id).title }, fullDescription: { text: ruleText(r.id).why }, help: { text: ruleText(r.id).fix }, defaultConfiguration: { level: level[r.severity] } })) } },
        results: findings.map(f => {
          const loc = where(f), d = what(f);
          return {
            ruleId: f.rule, level: level[f.severity],
            message: { text: `${label(f) ? label(f) + ': ' : ''}${ruleText(f.rule).title}${d ? ' (' + d + ')' : ''}` },
            partialFingerprints: { sqlSchemaKey: f.key },
            locations: loc ? [{ physicalLocation: { artifactLocation: { uri: loc.file.replace(/\\/g, '/') }, region: { startLine: Math.max(1, loc.line || 1) } } }] : [],
          };
        }),
      }],
    }, null, 2) + '\n';
  } else if (o.format === 'md') {
    const icon = { error: '\u{2717}', warning: '\u{26A0}', info: '\u{2139}' };
    const code = s => '`' + String(s).replace(/`/g, "'") + '`';
    const line = f => { const d = what(f), l = label(f); return `- ${icon[f.severity]} ${l ? code(l) + ' · ' : ''}${ruleText(f.rule).title}${d ? ': ' + d : ''}`; };
    const md = [];
    if (review) {
      md.push(`## ${tr('reviewHead', { before: scope.split(' → ')[0], after: scope.split(' → ')[1] || '' })}`, '', [tr('reviewTables', review.diff.summary), countLine(counts)].filter(Boolean).join(' · '), '');
      md.push(...(findings.length ? [`### ${tr('reviewNew')} (${findings.length})`, '', ...findings.map(line), ''] : [tr('reviewNone'), '']));
      if (review.fixed.length) md.push(`### ${tr('reviewFixed')} (${review.fixed.length})`, '', ...review.fixed.map(line), '');
    } else {
      md.push(`## ${tr('auditTitle')} · ${scope}`, '', `${dialects} · ${tr('auditSummary', audit)}`, '', countLine(counts) || tr(audit.debt ? 'debtNoNew' : 'auditNone'), '');
      if (audit.debt) md.push(`> ${tr('debtHead')}: ${projectName} · ${audit.debt.left} / ${audit.debt.total}`, '');
      md.push(...findings.map(line), '');
    }
    out = md.join('\n');
  } else {
    const icon = { error: 'x', warning: '!', info: 'i' };
    const lines = [review ? `sqlSchema ${tr('reviewTitle')} · ${scope}` : `sqlSchema ${tr('auditTitle')} · ${scope} · ${dialects} · ${tr('nTables', { n: audit.tables })}`];
    for (const f of findings) {
      const loc = where(f), d = what(f);
      lines.push(`${icon[f.severity]} ${label(f) || '-'}  ${ruleText(f.rule).title}${d ? ': ' + d : ''}  [${f.rule}]${loc ? '  ' + loc.file + ':' + loc.line : ''}`);
    }
    lines.push('', (countLine(counts) || tr(review ? 'reviewNone' : 'auditNone')) + (review && review.fixed.length ? ' · ' + tr('reviewFixedN', { n: review.fixed.length }) : '') + (audit.debt ? ` · ${tr('debtCount', { n: audit.debt.left })}` : ''));
    for (const s of audit.skipped) lines.push(tr(s.reason === 'noIndexes' ? 'auditSkipNoIndexes' : 'auditNone'));
    out = lines.join('\n') + '\n';
  }
  if (o.out) fs.writeFileSync(o.out, out); else process.stdout.write(out);

  // düzeltme betiği: güvenli ve gözden geçirilecek öneriler (riskliler tarayıcıda seçilerek alınır)
  if (o.fix) {
    const fixes = NS.fixAll(findings, { indexesKnown: !audit.skipped.some(s => s.rule === 'fk-no-index') }).filter(x => x.fix.risk !== 'risky');
    const notes = tr('fixNotes');
    const body = fixes.map(({ f, fix }) => [`-- [${tr('fixRisk')[fix.risk]}] ${ruleText(f.rule).title}${label(f) ? ' · ' + label(f) : ''}`,
      ...fix.steps.flatMap(st => [...[].concat(st.note || []).map(n => '-- ' + notes[n]), (st.comment ? '-- ' : '') + st.sql])].join('\n'));
    fs.writeFileSync(o.fix, [`-- ${tr('fixHeader', { title: scope, dialect: dialects, date: new Date().toISOString().slice(0, 10) })}`, `-- ${tr('fixWarn')}`, '', ''].join('\n') + (body.length ? body.join('\n\n') : tr('fixNone')) + '\n');
  }

  const order = ['error', 'warning', 'info'];
  const fail = o.failOn !== 'none' && findings.some(f => order.indexOf(f.severity) <= order.indexOf(o.failOn));
  process.exitCode = fail ? 1 : 0;
}

main();
