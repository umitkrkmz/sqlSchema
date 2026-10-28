/*
 * sqlSchema · ui.js
 * Dosya ve klasör yükleme, dosya listesi, örnek galerisi, arama, detay paneli, rapor, dil seçimi,
 * URL parametreleri, işaretçi ve klavye.
 *
 * URL parametreleri (paylaşılabilir bağlantılar ve belge görüntüleri için):
 *   ?lang=tr|en   ?sample=<örnek kimliği>   ?select=<tablo adı>   ?zoom=<1.6>   ?legend=0|1
 *   ?pop=naming|report|files   (örnekle birlikte: açılışta gösterilecek pencere)   ?columns=0|1
 *   ?grouping=auto|file|name
 */
(function (NS) {
'use strict';

const {
  S, $, canvas, CARD, DIALECTS, t,
  levelOf, wx, wy, starR, cardRows, keyTag, schemaColor, schemaLabel, groupLabel, relStyle, relVisible,
  drawGlyph, refreshEmphasis, invalidate, draw, resetHud, resize, fitView, zoomAt, flyToTable,
  classify, orderFiles, parseFile, databaseNames, harmonizeDialects, buildModel, layoutModel, resolveGrouping, namingProfile,
} = NS;

const MAX_FILE = 60 * 1024 * 1024;
const MAX_TOTAL = 250 * 1024 * 1024;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const dialectName = d => DIALECTS[d] || d || '?';
const baseName = p => String(p).split('/').pop();
const params = new URLSearchParams(location.search);

let toastTimer = 0;
function toast(msg, ms = 4500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ─── Model kurma ─── */

function buildIndex() {
  const cell = 300;
  S.idx = new Map();
  for (const tb of S.model.tables) {
    const key = Math.floor(tb.x / cell) + ',' + Math.floor(tb.y / cell);
    if (!S.idx.has(key)) S.idx.set(key, []);
    S.idx.get(key).push(tb);
  }
}

// Dosya kümesini sırala, ayrıştır (dosya başına bir kez), modeli ve yerleşimi kur
function rebuild() {
  const t0 = performance.now();
  const { files: ordered, migration } = orderFiles(S.files.filter(f => f.text != null && !f.skipReason));
  for (const f of ordered) {
    if (f.result === undefined) {
      try { f.result = parseFile(f.path, f.text); } catch (err) { f.result = null; f.error = String(err && err.message || err); }
    }
  }
  harmonizeDialects(ordered.filter(f => f.result).map(f => f.result));
  const active = ordered.filter(f => f.include && f.result);
  const dbNames = databaseNames(active.map(f => f.path));
  const inputs = active.map(f => ({ ...f.result, db: S.separate ? dbNames.get(f.path) : 'main' }));
  const model = buildModel(inputs);
  S.migration = migration;
  S.ordered = ordered;
  if (!model.tables.length) {
    S.model = S.lay = null;
    return false;
  }
  S.lay = layoutModel(model, { grouping: resolveGrouping(S.grouping, migration) });
  S.model = model;
  S.parseMs = Math.round(performance.now() - t0);
  S.order = model.tables.slice().sort((a, b) => b.deg - a.deg || String(a.name).localeCompare(String(b.name)));
  S.hover = S.sel = null;
  S.focus = 0;
  buildIndex();
  refreshEmphasis();
  renderPanel();
  renderReport();
  renderNaming();
  renderFiles();
  resetHud();
  document.body.classList.add('loaded');
  $('#empty').hidden = true;
  fitView(false);
  return true;
}

// Dosyaların lehçeleri birbirinden farklıysa (Oracle + MongoDB gibi) ayrı veritabanı olarak çizilir
function guessSeparate(files) {
  const fam = d => (d === 'mariadb' ? 'mysql' : d);
  const set = new Set(files.filter(f => f.result).map(f => fam(f.result.dialect)).filter(d => d !== 'sql'));
  return set.size > 1;
}

// Yükleme bitince çözülen bir Promise döndürür (URL'deki ?select= için)
function setFiles(files, title, opts = {}) {
  S.files = files;
  S.title = title;
  $('#fileName').textContent = title;
  $('#fileName').title = title;
  toast(t('parsing'), 0);
  return new Promise(resolve => setTimeout(() => {
    try {
      for (const f of files) if (f.text != null && !f.skipReason && f.result === undefined && !classify(f.path).skip) f.result = parseFile(f.path, f.text);
      harmonizeDialects(files.filter(f => f.result).map(f => f.result));
      S.separate = opts.separate !== undefined ? opts.separate : guessSeparate(files);
      if (!rebuild()) {
        renderFiles();
        toast(t('noSchemaFound'), 9000);
        return resolve(false);
      }
      const st = S.model.stats;
      toast(t('loadedSummary', { files: files.filter(f => f.result).length, tables: st.tables, rels: st.fk, inferred: st.implicit, sats: st.embedded, ms: S.parseMs }));
      resolve(true);
    } catch (err) {
      console.error(err);
      toast(t('readError', { m: err && err.message || err }), 8000);
      resolve(false);
    }
  }, 30));
}

function loadText(text, name) {
  return setFiles([{ path: name, text, include: true }], name);
}

/* ─── Dosya okuma ─── */

async function readFileText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // SSMS "Generate Scripts" varsayılan olarak UTF-16 yazar; eski Oracle dökümleri Windows-1254 olabilir
  if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('\u{FFFD}')) return utf8;
  try { return new TextDecoder('windows-1254').decode(buf); } catch (err) { return utf8; }
}

// list: [{ path, file }]
async function loadEntries(list, append) {
  if (!list.length) return;
  toast(t('readingFiles', { n: list.length }), 0);
  const out = [];
  let total = 0;
  for (const { path, file } of list) {
    const rec = { path, size: file.size, include: true };
    const c = classify(path);
    if (c.skip) rec.skipReason = c.skip;
    else if (file.size > MAX_FILE) rec.skipReason = 'tooBig';
    else if ((total += file.size) > MAX_TOTAL) rec.skipReason = 'total';
    else rec.text = await readFileText(file);
    out.push(rec);
  }
  const files = append ? S.files.concat(out) : out;
  const readable = files.filter(f => f.text != null);
  const dirs = new Set(readable.map(f => f.path.split('/')[0]));
  const title = readable.length === 1 ? readable[0].path : dirs.size === 1 && readable[0].path.includes('/') ? [...dirs][0] + '/' : t('nFiles', { n: readable.length });
  setFiles(files, title);
}

const fromInput = input => [...input.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }));

// Chrome, sayfa file:// ile açıldığında klasör API'sinde EncodingError ("A URI supplied to the API was
// malformed...") verir. Bu yüzden klasör API'si yalnızca gerçekten klasör bırakıldığında kullanılır.
function dropEntries(dt) {
  const plain = [...dt.files].map(f => ({ path: f.name, file: f }));
  const entries = [...dt.items].filter(i => i.kind === 'file').map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.some(e => e.isDirectory)) return Promise.resolve(plain);
  const dirs = new Set(entries.filter(e => e.isDirectory).map(e => e.name));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, file });
      return;
    }
    if (!entry.isDirectory || /^(node_modules|\.git)$/.test(entry.name)) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + '/');
    }
  };
  return (async () => {
    try {
      for (const e of entries) await walk(e, '');
      return out;
    } catch (err) {
      const e2 = new Error(err.message);
      e2.folderBlocked = true;
      e2.files = plain.filter(p => !dirs.has(p.path)); // klasörün yanında bırakılan dosyalar yine de okunabilir
      throw e2;
    }
  })();
}

function dropFailed(err) {
  if (!err.folderBlocked) { toast(t('dropError', { m: err.message }), 8000); return; }
  if (err.files && err.files.length) loadEntries(err.files, false);
  toast(location.protocol === 'file:' ? t('folderBlockedFile') : t('folderBlocked', { m: err.message }), 12000);
}

/* ─── Örnek galerisi ─── */

const sampleText = (s, key) => (NS.getLang() === 'en' && s.en && s.en[key]) || s[key];

function renderSamples() {
  const list = NS.SAMPLES || [];
  $('#sampleMenu').innerHTML = list.map(s => `
    <button data-sample="${esc(s.id)}">
      <b>${esc(sampleText(s, 'title'))}</b>
      <span class="m-tags"><i>${esc(sampleText(s, 'sector'))}</i><i>${esc(s.dialect)}</i><i>${s.files ? esc(t('files', { n: s.files.length })) : esc(t('embedded'))}</i></span>
      <span class="m-desc">${esc(sampleText(s, 'scenario'))}</span>
    </button>`).join('');
}

async function loadSample(id) {
  const s = (NS.SAMPLES || []).find(x => x.id === id);
  if (!s) return false;
  const title = sampleText(s, 'title');
  if (s.embedded) return setFiles([{ path: 'ornek_kucuk.sql', text: NS.SAMPLE_SQL, include: true }], title);
  toast(t('loadingSample', { s: title }), 0);
  try {
    const files = await Promise.all(s.files.map(async p => {
      const res = await fetch('samples/' + s.id + '/' + p);
      if (!res.ok) throw new Error(res.status + ' ' + p);
      const blob = await res.blob();
      return { path: s.id + '/' + p, size: blob.size, include: true, text: await readFileText(blob) };
    }));
    return setFiles(files, title, { separate: !!s.separate });
  } catch (err) {
    toast(location.protocol === 'file:' ? t('sampleFileProtocol', { id: s.id }) : t('sampleError', { m: err.message }), 9000);
    return false;
  }
}

/* ─── Dosya listesi ve rapor ─── */

function renderFiles() {
  const el = $('#filesPop');
  const ordered = S.ordered || [];
  const skipped = S.files.filter(f => f.skipReason);
  const noSchema = ordered.filter(f => f.result === null);
  const usable = ordered.filter(f => f.result);
  $('#hudFiles').textContent = t('nFiles', { n: usable.length });
  $('#hudFiles').hidden = S.files.length < 2;
  const folders = new Set(usable.map(f => f.path.split('/').slice(0, -1).join('/'))).size > 1;
  const tool = S.migration === 'timestamp' ? t('tool_timestamp') : S.migration;
  el.innerHTML = `
    <h4>${esc(t('filesTitle'))} <span>${usable.length}</span></h4>
    ${S.migration ? `<p class="note">${esc(t('migrationApplied', { tool }))}</p>` : ''}
    <label class="toggle sep-toggle"><input type="checkbox" id="tSeparate" ${S.separate ? 'checked' : ''}><span>${esc(t(folders ? 'separateFolders' : 'separateFiles'))}</span></label>
    <ol class="flist">${usable.map(f => {
      const st = f.result.stats;
      return `<li class="${f.include ? '' : 'off'}">
        <label><input type="checkbox" data-file="${esc(f.path)}" ${f.include ? 'checked' : ''}>
        <span class="fp" title="${esc(f.path)}">${esc(f.path)}</span></label>
        <span class="fm"><i>${esc(dialectName(f.result.dialect))}</i>${st.tables} ${esc(t(f.result.dialect === 'mongodb' ? 'collectionsWord' : 'tablesWord'))}${st.errors.length ? ` · <b class="err">${esc(t('nErrors', { n: st.errors.length }))}</b>` : ''}</span>
      </li>`;
    }).join('')}</ol>
    ${noSchema.length ? `<details><summary>${esc(t('noSchemaFiles', { n: noSchema.length }))}</summary><ul class="skip">${noSchema.map(f => `<li>${esc(f.path)}</li>`).join('')}</ul></details>` : ''}
    ${skipped.length ? `<details><summary>${esc(t('skippedFiles', { n: skipped.length }))}</summary><ul class="skip">${skipped.slice(0, 200).map(f => `<li>${esc(f.path)} <span>${esc(t('skip_' + f.skipReason))}</span></li>`).join('')}</ul></details>` : ''}
    <button class="btn sm ghost" data-act="add-files">${esc(t('addFiles'))}</button>`;
}

$('#filesPop').addEventListener('change', e => {
  if (e.target.id === 'tSeparate') { S.separate = e.target.checked; rebuild(); return; }
  const path = e.target.dataset.file;
  if (path === undefined) return;
  const f = S.files.find(x => x.path === path);
  if (!f) return;
  f.include = e.target.checked;
  if (!rebuild()) { renderFiles(); toast(t('noTablesLeft')); }
});

function renderReport() {
  const st = S.model.stats;
  const row = (k, v) => `<tr><td>${esc(t(k))}</td><td>${v}</td></tr>`;
  const list = (title, items) => (items.length ? `<h5>${esc(t(title))}</h5><ul>${items.join('')}</ul>` : '');
  $('#report').innerHTML = `
    <h4>${esc(t('reportTitle'))}</h4>
    <table>
      ${row('rFiles', st.files.length + (st.dialects.length ? ` <span class="dim">${esc(st.dialects.map(dialectName).join(', '))}</span>` : ''))}
      ${row('rStatements', st.statements)}
      ${row('rTables', st.tables + (st.external ? ` <span class="dim">${esc(t('rExternal', { n: st.external }))}</span>` : ''))}
      ${st.embedded ? row('rEmbedded', st.embedded) : ''}
      ${row('rColumns', st.columns)}
      ${row('rFk', st.fk + (st.fkDisabled ? ` <span class="dim">${esc(t('rDisabled', { n: st.fkDisabled }))}</span>` : ''))}
      ${row('rImplicit', st.implicit)}
      ${row('rJunctions', st.junctions)}
      ${row('rIndexes', `${st.indexes} / ${st.comments}`)}
      ${row('rTime', S.parseMs + ' ms')}
    </table>
    ${list('rWarnings', st.warnings.slice(0, 30).map(w => `<li class="w"><span>${esc(w.kind === 'dup' ? t('warnDup', w) : w.text || '')}</span></li>`))}
    ${list('rOrphans', st.orphans.slice(0, 30).map(o => `<li><span>${esc(o.text)}</span><b>${esc(o.where)}</b></li>`))}
    ${list('rSkipped', st.skipped.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v}</b></li>`))}
    ${list('rErrors', st.errors.slice(0, 20).map(e => `<li><span>${esc(e.file ? baseName(e.file) + ':' : t('line') + ' ')}${e.line}</span><b>${esc(e.message)}</b></li>`))}`;
}

/* ─── Adlandırma profili ─── */

const schemaKey = s => s.db.name + '|' + s.name;
const scopeLabel = s => (S.lay.dbs.length > 1 ? s.db.label + ' / ' : '') + schemaLabel(s);
const fmtPct = n => t('pct', { n: n.toLocaleString(NS.getLang(), { maximumFractionDigits: 1 }) });
const bucketLabel = (d, b, lim) => t('nk_' + d.id + '_' + b.key, { n: lim });
// Payı eşiğin altındaysa en çok kullanılan kalıp "baskın" değil, yalnızca "en çok" olarak yazılır
const topWord = d => t(d.clear ? 'namingDominant' : 'namingTop');
const outliersTitle = d => t(d.clear ? 'namingOutliers' : 'namingOutliersTop', { n: d.outliers.length });
const noClearNote = (d, p) => t('namingNoClear', { share: fmtPct(Math.round(d.share * 1000) / 10), at: fmtPct(Math.round(p.clearAt * 100)) });
// Örnek ve sapan adlar: TABLO.KOLON, FK'de hedefle birlikte; şema yalnızca birden fazla şema varsa yazılır
function itemName(it) {
  const tb = it.t;
  const base = (S.lay.schemas.length > 1 && tb.schema ? tb.schema + '.' : '') + tb.name + (it.c ? '.' + it.c : '');
  return it.ref ? base + ' → ' + it.ref.name : base;
}

function currentProfile() {
  const scope = S.lay.schemas.find(s => schemaKey(s) === S.namingScope);
  if (!scope) S.namingScope = '';
  return { scope, profile: namingProfile(S.model, scope ? { filter: tb => tb.schemaRef === scope } : {}) };
}

function renderNaming() {
  const el = $('#namingPop');
  const { profile: p } = currentProfile();
  const scopes = S.lay.schemas.filter(s => s.tables.some(tb => !tb.external && !tb.embedded));
  const scopeSel = scopes.length > 1 ? `<label class="scope">${esc(t('namingScope'))}
    <select id="namingScope"><option value="">${esc(t('namingAll'))}</option>${scopes.map(s => `<option value="${esc(schemaKey(s))}" ${schemaKey(s) === S.namingScope ? 'selected' : ''}>${esc(scopeLabel(s))} (${s.tables.length})</option>`).join('')}</select></label>` : '';
  const dims = p.dims.map(d => {
    const counted = d.buckets.filter(b => !b.neutral && b.n);
    const neutral = d.buckets.filter(b => b.neutral && b.n);
    if (!d.total) {
      const why = d.id === 'fkStyle' ? 'namingNoFk' : d.id === 'pkStyle' ? 'namingNoPk' : 'namingEmpty';
      return `<section class="nd"><h5>${esc(t('nd_' + d.id))}</h5><p class="nn">${esc(t(why))}</p></section>`;
    }
    const color = new Map(d.buckets.filter(b => !b.neutral).map((b, i) => [b.key, i]));
    const bar = counted.map(b => `<i class="c${color.get(b.key)}" style="width:${b.n * 100 / d.total}%"></i>`).join('');
    const rows = counted.map(b => {
      const dom = b.key === d.dominant;
      return `<li class="${dom ? 'dom' : ''}" ${b.items[0] ? `data-go="${esc(b.items[0].t.key)}" data-col="${esc(b.items[0].c || '')}"` : ''}>
        <i class="sw c${color.get(b.key)}"></i><span class="nl">${esc(bucketLabel(d, b, p.nameLimit))}${dom && counted.length > 1 ? ` <em class="${d.clear ? '' : 'weak'}">${esc(topWord(d))}</em>` : ''}</span>
        <span class="ex" title="${esc(itemName(b.items[0]))}">${esc(itemName(b.items[0]))}</span><b>${esc(fmtPct(b.pct))}</b><b>${b.n}</b></li>`;
    }).join('');
    const extra = neutral.length ? `<p class="nn">${esc(t('namingNotCounted'))}: ${neutral.map(b => `${esc(bucketLabel(d, b, p.nameLimit))} ${b.n}`).join(' · ')}</p>` : '';
    const MAX = 60;
    const mixed = d.clear ? '' : `<p class="nn mixed">${esc(noClearNote(d, p))}</p>`;
    const outs = d.outliers.length ? `<details><summary>${esc(outliersTitle(d))}</summary><ul class="no">${d.outliers.slice(0, MAX).map(it => `<li data-go="${esc(it.t.key)}" data-col="${esc(it.c || '')}" tabindex="0">${esc(itemName(it))}</li>`).join('')}${d.outliers.length > MAX ? `<li class="more">${esc(t('namingMore', { n: d.outliers.length - MAX }))}</li>` : ''}</ul></details>` : '';
    return `<section class="nd"><h5>${esc(t('nd_' + d.id))}</h5><div class="nbar">${bar}</div><ul class="nb">${rows}</ul>${mixed}${extra}${outs}</section>`;
  }).join('');
  el.innerHTML = `
    <h4>${esc(t('namingTitle'))}</h4>
    <p class="intro">${esc(t('namingIntro'))}</p>
    ${scopeSel}
    <div class="nscore" title="${esc(t('namingScoreTitle'))}"><span>${esc(t('namingScore'))}</span><strong>${p.score == null ? '–' : esc(fmtPct(p.score))}</strong><small>${esc(t('namingCounts', p))}</small></div>
    ${p.tables ? dims : `<p class="nn">${esc(t('namingEmpty'))}</p>`}
    <button class="btn sm ghost" data-act="naming-md" title="${esc(t('namingMdTitle'))}">${esc(t('namingMd'))}</button>`;
}

$('#namingPop').addEventListener('change', e => {
  if (e.target.id !== 'namingScope') return;
  S.namingScope = e.target.value;
  renderNaming();
});
$('#namingPop').addEventListener('click', e => {
  const li = e.target.closest('li[data-go]');
  if (!li) return;
  const tb = S.model.tables.find(x => x.key === li.dataset.go);
  if (tb) select(tb, { fly: true, col: li.dataset.col || null });
});
$('#namingPop').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('li[data-go]')) e.target.click();
});

// Ekiple paylaşmak için: standart tartışmasının başlangıç belgesi
function namingMarkdown() {
  const { scope, profile: p } = currentProfile();
  // <TABLO>_ID gibi etiketler kaçışlanmazsa GitHub onları HTML etiketi sanıp gizler
  const cell = s => String(s).replace(/\|/g, '\\|').replace(/</g, '\\<');
  const code = s => '`' + String(s).replace(/`/g, "'") + '`';
  const out = [`# ${t('namingTitle')} · ${S.title || ''}${scope ? ' · ' + scopeLabel(scope) : ''}`, ''];
  out.push(`**${t('namingScore')}:** ${p.score == null ? '–' : fmtPct(p.score)} · ${t('namingCounts', p)}`, '', `> ${t('namingIntro')}`, '');
  for (const d of p.dims) {
    out.push(`## ${t('nd_' + d.id)}`, '');
    if (!d.total) { out.push(t(d.id === 'fkStyle' ? 'namingNoFk' : d.id === 'pkStyle' ? 'namingNoPk' : 'namingEmpty'), ''); continue; }
    out.push(`| ${t('namingPattern')} | ${t('namingShare')} | ${t('namingCount')} | ${t('namingExample')} |`, '|---|---:|---:|---|');
    for (const b of d.buckets.filter(x => !x.neutral && x.n)) {
      const dom = b.key === d.dominant && d.buckets.filter(x => !x.neutral && x.n).length > 1 ? ` (${topWord(d)})` : '';
      out.push(`| ${cell(bucketLabel(d, b, p.nameLimit))}${dom} | ${fmtPct(b.pct)} | ${b.n} | ${code(itemName(b.items[0]))} |`);
    }
    out.push('');
    if (!d.clear) out.push(noClearNote(d, p), '');
    const neutral = d.buckets.filter(b => b.neutral && b.n);
    if (neutral.length) out.push(`${t('namingNotCounted')}: ${neutral.map(b => `${bucketLabel(d, b, p.nameLimit)} ${b.n}`).join(' · ')}`, '');
    if (d.outliers.length) out.push(`**${outliersTitle(d)}:** ${d.outliers.map(it => code(itemName(it))).join(', ')}`, '');
  }
  return out.join('\n');
}

function downloadText(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ─── Seçim ve vurgu ─── */

function hitTest(px, py) {
  if (!S.idx) return null;
  const x = wx(px), y = wy(py), k = S.cam.k, lv = levelOf(k);
  const cell = 300;
  const rad = lv === 2 ? CARD.w : 20 / k;
  let best = null, bd = Infinity;
  for (let gx = Math.floor((x - rad) / cell); gx <= Math.floor((x + rad) / cell); gx++) {
    for (let gy = Math.floor((y - rad) / cell); gy <= Math.floor((y + rad) / cell); gy++) {
      const list = S.idx.get(gx + ',' + gy);
      if (!list) continue;
      for (const tb of list) {
        if (S.em.focus && !S.em.focus.has(tb)) continue;
        if (lv === 2) {
          cardRows(tb);
          if (Math.abs(x - tb.x) <= CARD.w / 2 && Math.abs(y - tb.y) <= tb._h / 2) return tb;
        } else {
          const d = Math.hypot(x - tb.x, y - tb.y) * k;
          if (d < starR(tb) + 7 && d < bd) { bd = d; best = tb; }
        }
      }
    }
  }
  return best;
}

function setHover(tb) {
  if (tb === S.hover) return;
  S.hover = tb;
  canvas.style.cursor = tb ? 'pointer' : '';
  refreshEmphasis();
  invalidate();
}

function select(tb, opts = {}) {
  S.sel = tb;
  S.selCol = opts.col ? opts.col.toUpperCase() : null;
  if (!tb) S.focus = 0;
  refreshEmphasis();
  renderPanel();
  invalidate();
  if (tb && opts.fly) flyToTable(tb, opts.k);
}

/* ─── Detay paneli ─── */

function sentence(r) {
  const c = r.child.name, p = r.parent.name, f = r.cols[0];
  if (r.kind === 'embed') return t(r.many ? 'sEmbedMany' : 'sEmbedOne', { p, f });
  if (r.many) return t('sMany', { c, p, f });
  const a = t(r.parentEnd === 'one' ? 'sOne' : 'sZeroOne', { c, p });
  const b = t(r.childEnd === 'zeroOne' ? 's1to1' : 's1toN', { c, p });
  return (r.kind === 'implicit' ? t('guess') : '') + a + ' ' + b;
}

function relItem(r, dir) {
  const other = dir === 'out' ? r.parent : r.child;
  const left = dir === 'out' ? r.childEnd : r.parentEnd;
  const right = dir === 'out' ? r.parentEnd : r.childEnd;
  const badges = [
    r.kind === 'implicit' ? `<span class="tag t-imp">${esc(t('tagInferred'))}</span>` : '',
    r.kind === 'embed' ? `<span class="tag t-emb">${esc(t('tagEmbed'))}</span>` : '',
    r.label === 'ref' ? '<span class="tag">ref</span>' : '',
    r.disabled ? `<span class="tag t-off">${esc(t('tagDisabled'))}</span>` : '',
    r.onDelete ? `<span class="tag">ON DELETE ${esc(r.onDelete)}</span>` : '',
    r.self ? `<span class="tag">${esc(t('tagSelf'))}</span>` : '',
  ].join('');
  const map = r.kind === 'embed'
    ? `${esc(t('field'))}: ${esc(r.cols[0])}${r.many ? '[]' : ''}`
    : r.cols.map((c, i) => `${esc(c)} → ${esc(r.refCols[i] || '?')}`).join(', ');
  const src = r.src && r.src.file && S.files.length > 1 ? `<span class="cn-name">${esc(baseName(r.src.file))}:${r.src.line}</span>` : '';
  return `<li data-go="${esc(other.key)}" tabindex="0">
    <canvas class="glyph" data-l="${left}" data-r="${right}" data-s="${relStyle(r)}"></canvas>
    <div class="ri">
      <div class="rn"><b>${esc(other.name)}</b><span class="rs">${esc(other.schema)}</span>${badges}</div>
      <div class="rc">${map}${r.name ? ` <span class="cn-name">${esc(r.name)}</span>` : ''} ${src}</div>
      <div class="rd">${esc(sentence(r))}</div>
    </div>
  </li>`;
}

function renderPanel() {
  const p = $('#panel');
  const tb = S.sel;
  document.body.classList.toggle('has-panel', !!tb);
  if (!tb) { p.hidden = true; p.innerHTML = ''; return; }
  p.hidden = false;
  const col = schemaColor(tb);
  const outs = tb.out.filter(relVisible);
  const ins = tb.inc.filter(r => relVisible(r) && !r.self);
  const mongo = tb.dialect === 'mongodb';
  const tag = (cls, key) => `<span class="tag ${cls}">${esc(t(key))}</span>`;
  const badges = [
    tb.junction ? tag('', 'tagJunction') : '',
    tb.embedded ? tag('t-emb', 'tagEmbedded') : '',
    tb.external ? tag('t-off', 'tagExternal') : '',
    !tb.external && !tb.embedded && !tb.pk.length ? tag('t-off', 'tagNoPk') : '',
    tb.noColumns ? '<span class="tag">AS SELECT</span>' : '',
    tb.dialect ? `<span class="tag">${esc(dialectName(tb.dialect))}</span>` : '',
  ].join('');
  const rows = tb.columns.map(c => {
    const k = keyTag(tb, c);
    const hl = S.selCol && c.name.toUpperCase() === S.selCol ? ' class="hl"' : '';
    return `<tr${hl}><td class="ck ${k ? 'k-' + k : ''}">${k}</td><td class="cn${c.nullable ? ' nul' : ''}">${esc(c.name)}${c.comment ? `<div class="cc">${esc(c.comment)}</div>` : ''}</td><td class="ct">${esc(String(c.type).toLowerCase())}${c.nullable ? '' : `<b title="${esc(mongo ? t('reqTitle') : 'NOT NULL')}">${mongo ? 'req' : 'nn'}</b>`}</td></tr>`;
  }).join('');
  const where = [tb.db !== 'main' ? tb.db : '', schemaLabel(tb.schemaRef)].filter(Boolean).join(' / ');
  const group = tb.external ? t('externalRef') : tb.embedded ? t('satelliteOf', { o: tb.owner ? tb.owner.name : '' }) : tb.group.loose ? t('looseStar') : tb.desig + ' ' + groupLabel(tb.group);
  const files = tb.files.map(f => baseName(f)).join(', ');
  p.innerHTML = `
    <div class="p-head" style="--c:${col}">
      <button class="p-close" data-act="close" aria-label="${esc(t('panelClose'))}">×</button>
      <div class="p-eyebrow"><span class="dot"></span>${esc(where)}<span class="sep">/</span>${esc(group)}</div>
      <h2 title="${esc(tb.name)}">${esc(tb.name)}</h2>
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      ${tb.comment ? `<p class="p-comment">${esc(tb.comment)}</p>` : ''}
      ${tb.src && S.files.length > 1 ? `<p class="p-src" title="${esc(tb.files.join('\n'))}">${esc(baseName(tb.src.file))}:${tb.src.line}${tb.files.length > 1 ? ' · ' + esc(t('seenInFiles', { n: tb.files.length, list: files })) : ''}</p>` : ''}
      <div class="p-actions">
        <button class="btn sm ${S.focus ? '' : 'ghost'}" data-act="focus" title="${esc(t('focusTitle'))}">${esc(t('focus')[S.focus])}</button>
        <button class="btn sm ghost" data-act="zoom">${esc(t(mongo ? 'showFields' : 'showColumns'))}</button>
      </div>
    </div>
    <div class="p-body">
      <section>
        <h3>${esc(t(mongo ? 'fields' : 'columns'))} <span>${tb.columns.length}</span></h3>
        <table class="cols"><tbody>${rows || `<tr><td class="empty-row">${esc(t('noColumnInfo'))}</td></tr>`}</tbody></table>
      </section>
      <section>
        <h3>${esc(t('outgoing'))} <span>${outs.length}</span></h3>
        <ul class="rels">${outs.map(r => relItem(r, 'out')).join('') || `<li class="none">${esc(t('noOutgoing'))}</li>`}</ul>
      </section>
      <section>
        <h3>${esc(t('incoming'))} <span>${ins.length}</span></h3>
        <ul class="rels">${ins.map(r => relItem(r, 'in')).join('') || `<li class="none">${esc(t('noIncoming'))}</li>`}</ul>
      </section>
    </div>`;
  p.querySelectorAll('canvas.glyph').forEach(cv => drawGlyph(cv, cv.dataset.l, cv.dataset.r, cv.dataset.s));
  const hl = p.querySelector('tr.hl');
  if (hl) hl.scrollIntoView({ block: 'center' });
}

$('#panel').addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'close') select(null);
    else if (a === 'focus') { S.focus = (S.focus + 1) % 3; refreshEmphasis(); renderPanel(); invalidate(); }
    else if (a === 'zoom' && S.sel) {
      if (!S.columns) setColumns(true);   // düğme açıkça kolonları istiyor
      flyToTable(S.sel, Math.max(1.5, S.cam.k));
    }
    return;
  }
  const li = e.target.closest('li[data-go]');
  if (li) {
    const tb = S.model.tables.find(x => x.key === li.dataset.go);
    if (tb) select(tb, { fly: true });
  }
});
$('#panel').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('li[data-go]')) e.target.click();
});

/* ─── Arama ─── */

const q = $('#q');
const results = $('#results');
let hits = [], active = -1;

function runSearch() {
  const v = q.value.trim().toUpperCase();
  if (!v || !S.model) { results.hidden = true; hits = []; return; }
  const found = [];
  for (const tb of S.model.tables) {
    const i = String(tb.name).toUpperCase().indexOf(v);
    if (i >= 0) found.push({ tb, score: (i === 0 ? 0 : 1) * 1000 - tb.deg });
  }
  found.sort((a, b) => a.score - b.score);
  hits = found.slice(0, 10).map(x => ({ tb: x.tb }));
  if (v.length >= 3) {
    let n = 0;
    for (const tb of S.model.tables) {
      for (const c of tb.columns) {
        if (c.name.toUpperCase().includes(v)) { hits.push({ tb, col: c.name }); if (++n >= 8) break; }
      }
      if (n >= 8) break;
    }
  }
  active = hits.length ? 0 : -1;
  const meta = tb => [tb.db !== 'main' ? tb.db : '', tb.schema].filter(Boolean).join(' / ');
  results.innerHTML = hits.length
    ? hits.map((h, i) => `<li data-i="${i}" class="${i === active ? 'on' : ''}" role="option">
        <span class="dot" style="--c:${schemaColor(h.tb)}"></span>
        ${h.col ? `<span class="r-col">${esc(h.col)}</span><span class="r-in">${esc(h.tb.name)}</span>` : `<span class="r-name">${esc(h.tb.name)}</span>`}
        <span class="r-meta">${esc(meta(h.tb))}${h.col ? ' · ' + esc(t('column')) : ''}</span></li>`).join('')
    : `<li class="none">${esc(t('noMatch'))}</li>`;
  results.hidden = false;
}

function pickHit(i) {
  const h = hits[i];
  if (!h) return;
  results.hidden = true;
  q.blur();
  select(h.tb, { fly: true, col: h.col, k: h.col ? Math.max(1.5, S.cam.k) : undefined });
}

q.addEventListener('input', runSearch);
q.addEventListener('focus', () => { if (q.value) runSearch(); });
q.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!hits.length) return;
    active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
    results.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === active));
  } else if (e.key === 'Enter') {
    pickHit(active);
  } else if (e.key === 'Escape') {
    q.value = '';
    results.hidden = true;
    q.blur();
  }
});
results.addEventListener('mousedown', e => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); pickHit(Number(li.dataset.i)); }
});

/* ─── İşaretçi ve klavye ─── */

const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: S.cam.k };
    drag = null;
  } else {
    drag = { x: e.offsetX, y: e.offsetY, cx: S.cam.x, cy: S.cam.y, moved: false };
    S.anim = null;
  }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.k * d / pinch.d) / S.cam.k);
    return;
  }
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      S.cam.x = drag.cx - dx / S.cam.k;
      S.cam.y = drag.cy - dy / S.cam.k;
      canvas.style.cursor = 'grabbing';
      invalidate();
    }
    return;
  }
  if (e.pointerType === 'mouse') setHover(hitTest(e.offsetX, e.offsetY));
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch && pointers.size < 2) { pinch = null; return; }
  if (drag && !drag.moved && e.type === 'pointerup') {
    const tb = hitTest(e.offsetX, e.offsetY);
    select(tb);
    if (tb && e.pointerType !== 'mouse') S.hover = null;
  }
  drag = null;
  canvas.style.cursor = S.hover ? 'pointer' : '';
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
canvas.addEventListener('dblclick', e => {
  const tb = hitTest(e.offsetX, e.offsetY);
  if (tb) select(tb, { fly: true, k: Math.max(1.5, S.cam.k) });
  else zoomAt(e.offsetX, e.offsetY, 2);
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016) * (e.deltaMode === 1 ? 16 : 1));
  zoomAt(e.offsetX, e.offsetY, f);
}, { passive: false });

window.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); return; }
  if (typing || !S.model) return;
  if (e.key === 'Escape') {
    if (S.focus) { S.focus = 0; refreshEmphasis(); renderPanel(); invalidate(); }
    else select(null);
  } else if (e.key === 'f' || e.key === 'F') fitView(true);
  else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) setColumns(!S.columns);
  else if (e.key === '+' || e.key === '=') zoomAt(S.w / 2, S.h / 2, 1.4);
  else if (e.key === '-' || e.key === '_') zoomAt(S.w / 2, S.h / 2, 1 / 1.4);
});

/* ─── Düğmeler, menüler, sürükle-bırak ─── */

const fileInput = $('#file');
const folderInput = $('#folder');
let appendNext = false;
fileInput.addEventListener('change', () => { loadEntries(fromInput(fileInput), appendNext); appendNext = false; fileInput.value = ''; });
folderInput.addEventListener('change', () => { loadEntries(fromInput(folderInput), false); folderInput.value = ''; });

const popovers = ['#sampleMenu', '#viewMenu', '#report', '#filesPop', '#namingPop'];
function togglePop(sel) {
  for (const p of popovers) $(p).hidden = p === sel ? !$(p).hidden : true;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act], [data-sample], [data-lang]');
  if (!e.target.closest('.menu, .pop, .hud')) for (const p of popovers) $(p).hidden = true;
  if (!b || b.closest('#panel')) return;
  if (b.dataset.lang) { NS.setLang(b.dataset.lang); return; }
  if (b.dataset.sample) { $('#sampleMenu').hidden = true; loadSample(b.dataset.sample); return; }
  switch (b.dataset.act) {
    case 'open': fileInput.click(); break;
    case 'open-folder': folderInput.click(); break;
    case 'add-files': appendNext = true; fileInput.click(); break;
    case 'paste': $('#pasteDlg').showModal(); $('#pasteText').focus(); break;
    case 'samples': togglePop('#sampleMenu'); break;
    case 'view': togglePop('#viewMenu'); break;
    case 'sample-first': loadSample((NS.SAMPLES || [])[0].id); break;
    case 'fit': fitView(true); break;
    case 'png': exportPng(); break;
    case 'report': togglePop('#report'); break;
    case 'files': togglePop('#filesPop'); break;
    case 'naming': togglePop('#namingPop'); break;
    case 'naming-md': if (S.model) downloadText(namingMarkdown(), fileStem() + '-' + t('namingFile') + '.md', 'text/markdown;charset=utf-8'); break;
    case 'legend':
      document.body.classList.toggle('legend-closed');
      try { localStorage.setItem('sqlschema.legend', document.body.classList.contains('legend-closed') ? '0' : '1'); } catch (err) { /* depolama kapalı */ }
      break;
  }
});

$('#pasteDlg').addEventListener('close', () => {
  const dlg = $('#pasteDlg');
  if (dlg.returnValue === 'ok') {
    const txt = $('#pasteText').value;
    if (txt.trim()) loadText(txt, /^\s*[[{]/.test(txt) ? 'paste.json' : /\$jsonSchema|createCollection|Schema\(/.test(txt) ? 'paste.js' : 'paste.sql');
  }
});

$('#tImplicit').addEventListener('change', e => { S.implicit = e.target.checked; refreshEmphasis(); renderPanel(); invalidate(); });
$('#tGrid').addEventListener('change', e => { S.grid = e.target.checked; invalidate(); });
$('#tColumns').addEventListener('change', e => setColumns(e.target.checked));
// Takımyıldız gruplaması: 'auto' migration'da ada, değilse dosyaya göre (layout.js resolveGrouping)
$('#viewMenu').addEventListener('change', e => {
  if (e.target.name !== 'grouping') return;
  S.grouping = e.target.value;
  try { localStorage.setItem('sqlschema.grouping', S.grouping); } catch (err) { /* depolama kapalı */ }
  if (S.model) rebuild();
});
function markGrouping() {
  for (const r of document.querySelectorAll('#viewMenu input[name="grouping"]')) r.checked = r.value === S.grouping;
}

// Kolon ayrıntıları: kapalıyken yakın plan yalnızca tablo adlarını ve ilişkileri gösterir
function setColumns(on, quiet) {
  S.columns = on;
  $('#tColumns').checked = on;
  if (S.model) for (const tb of S.model.tables) tb._rows = null;
  try { localStorage.setItem('sqlschema.columns', on ? '1' : '0'); } catch (err) { /* depolama kapalı */ }
  if (!quiet && S.model) toast(t(on ? 'columnsOn' : 'columnsOff'), 2500);
  invalidate();
}

let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropOverlay').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  if (!e.dataTransfer) return;
  dropEntries(e.dataTransfer).then(list => loadEntries(list, false)).catch(dropFailed);
});

const fileStem = () => (S.title || 'schema').replace(/[\\/]+$/, '').replace(/\.[^.]+$/, '').replace(/[^\w\-\u{C0}-\u{24F}]+/gu, '_');

function exportPng() {
  if (!S.model) return;
  draw();
  canvas.toBlob(blob => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileStem() + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

function drawLegend() {
  document.querySelectorAll('#legend canvas[data-end]').forEach(cv => drawGlyph(cv, null, cv.dataset.end, 'fk'));
  document.querySelectorAll('#legend canvas[data-line]').forEach(cv => drawGlyph(cv, null, null, cv.dataset.line));
  document.querySelectorAll('#legend canvas[data-pair]').forEach(cv => {
    const [l, r] = cv.dataset.pair.split(',');
    drawGlyph(cv, l, r, 'fk');
  });
}

/* ─── Dil ─── */

function markLang() {
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === NS.getLang()));
}

NS.onLangChange(() => {
  markLang();
  renderSamples();
  if (S.model) {
    for (const tb of S.model.tables) tb._lw = 0;   // etiket genişlikleri yeniden ölçülür
    renderPanel();
    renderReport();
    renderNaming();
    renderFiles();
    resetHud();
  }
  if (S.title && S.files.length > 1 && /^\d+ /.test(S.title)) $('#fileName').textContent = t('nFiles', { n: S.files.filter(f => f.text != null).length });
  invalidate();
});

/* ─── Başlangıç ─── */

const legendPref = params.get('legend');
try {
  const saved = localStorage.getItem('sqlschema.legend');
  if (legendPref === '0' || (legendPref !== '1' && (saved === '0' || (saved === null && window.innerWidth < 1100)))) document.body.classList.add('legend-closed');
} catch (err) { if (legendPref === '0') document.body.classList.add('legend-closed'); }
{
  let cols = params.get('columns');
  if (cols !== '0' && cols !== '1') { try { cols = localStorage.getItem('sqlschema.columns'); } catch (err) { cols = null; } }
  if (cols === '0') { S.columns = false; $('#tColumns').checked = false; }
  let grouping = params.get('grouping');
  if (!['auto', 'file', 'name'].includes(grouping)) { try { grouping = localStorage.getItem('sqlschema.grouping'); } catch (err) { grouping = null; } }
  S.grouping = ['auto', 'file', 'name'].includes(grouping) ? grouping : 'auto';
  markGrouping();
}

// Konsoldan inceleme için: sqlSchema.S.model.tables, sqlSchema.loadText(metin, 'ad.sql')
Object.assign(NS, { loadText, setFiles, rebuild, loadSample });

NS.applyI18n();
markLang();
renderSamples();
new ResizeObserver(resize).observe(canvas.parentElement);
resize();
drawLegend();
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (S.model) for (const tb of S.model.tables) tb._lw = 0;
    drawLegend();
    invalidate();
  });
}

// ?sample=telekom&select=BILLING_ACCOUNT&zoom=1.6
if (params.get('sample')) {
  loadSample(params.get('sample')).then(ok => {
    if (!ok || !S.model) return;
    const name = (params.get('select') || '').toUpperCase();
    const tb = name && S.model.tables.find(x => x.name.toUpperCase() === name);
    const zoom = Number(params.get('zoom'));
    if (tb) {
      select(tb);
      const k = zoom > 0 ? zoom : Math.max(S.cam.k, 0.85);
      const offset = !$('#panel').hidden && S.w > 820 ? 190 : 0;
      S.anim = null;
      S.cam = { x: tb.x + offset / k, y: tb.y, k };
    } else if (zoom > 0) {
      S.cam.k = zoom;
    }
    const pop = { naming: '#namingPop', report: '#report', files: '#filesPop' }[params.get('pop')];
    if (pop) togglePop(pop);
    invalidate();
  });
}
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
