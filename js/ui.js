/*
 * sqlSchema · ui.js
 * Dosya ve klasör yükleme, dosya listesi, örnek galerisi, arama, detay paneli, rapor, dil seçimi,
 * URL parametreleri, işaretçi ve klavye.
 *
 * URL parametreleri (paylaşılabilir bağlantılar ve belge görüntüleri için):
 *   ?lang=tr|en   ?sample=<örnek kimliği>   ?select=<tablo adı>   ?center=<tablo adı>   ?zoom=<1.6>   ?legend=0|1
 *   ?pop=naming|report|files|diff|audit   (örnekle birlikte: açılışta gösterilecek pencere)   ?columns=0|1
 *   ?grouping=auto|file|name   ?list=0|1   ?sub=<tablo>,<tablo>&near=1 (alt diyagram)   ?impact=1 (select ile)
 *   ?diff=V3 (migration klasöründe bu sürümle karşılaştır)   ?time=V4 (zaman çizelgesi bu sürümde; ?time=1 baştan)
 *   ?audit=1 (tasarım denetimi haritada)   ?fix=1 (düzeltme önerileri penceresi)   ?review=1 (değişiklik incelemesi; diff ya da time ile)
 */
(function (NS) {
'use strict';

const {
  S, $, canvas, CARD, PALETTE, DIALECTS, t,
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

// etiketler bu sırayla çizilir: çok bağlantılı tablolar önce
const byDegree = (a, b) => b.deg - a.deg || String(a.name).localeCompare(String(b.name));

function buildIndex() {
  const cell = 300;
  S.idx = new Map();
  S.byKey = new Map(S.model.tables.map(tb => [tb.key, tb]));
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
  const model = buildModel(inputs, { dictionaries: S.dictOverride });
  S.migration = migration;
  S.ordered = ordered;
  S.full = null;
  S.relSet = null;
  if (!model.tables.length) {
    S.model = S.lay = null;
    return false;
  }
  // karşılaştırma açıksa: "önce" modeli kurulur, fark hesaplanır; silinen tablolar da haritada yerini alır
  let shown = model;
  S.diffRes = S.diffBefore = null;
  stopPlay();
  S.tl = null;
  S.hover = S.sel = null;
  if (S.time && migration && active.length > 1) {
    S.tl = timelineState(active, inputs, model, migration);
    applyStep(S.time.pos);
  } else {
    S.time = null;
    if (S.diff) {
      const before = buildBefore(ordered, f => (S.separate ? dbNames.get(f.path) : 'main'));
      if (before) {
        S.diffRes = NS.diffModels(before, model);
        S.diffBefore = before;
        const gone = S.diffRes.tables.filter(e => e.status === 'removed').map(e => e.before);
        shown = { ...model, tables: model.tables.concat(gone) };
      }
    }
    S.lay = layoutModel(shown, { grouping: resolveGrouping(S.grouping, migration) });
    S.model = shown;
    // silinen tabloların "önce" ilişkileri çizilmez; yalnızca sonraki modelin ilişkileri
    if (S.diffRes) S.relSet = new Set(model.rels);
    S.order = shown.tables.slice().sort(byDegree);
  }
  S.parseMs = Math.round(performance.now() - t0);
  S.focus = 0;
  S.impactRes = S.impactDepth = null;
  S.history = [];
  S.histPos = -1;
  buildIndex();
  refreshEmphasis();
  renderPanel();
  renderReport();
  renderNaming();
  renderFiles();
  renderList();
  renderViews();
  resetHud();
  document.body.classList.add('loaded');
  $('#empty').hidden = true;
  fitView(false);
  // görünüm ayarı ya da dosya seçimi değişince açık alt diyagram korunur (karşılaştırmada alt diyagram yok)
  if (S.subKeys && (S.diffRes || !enterSubset(S.subKeys, S.subNeighbors))) S.subKeys = null;
  renderDiff();
  renderTimeBar();
  refreshAudit();
  S.pick = new Set([...S.pick].filter(k => S.byKey.has(k)));
  renderPickBar();
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
  // yeni dosya kümesi: önceki seçim, alt diyagram ve karşılaştırma geçersiz
  S.subKeys = null;
  S.pick = new Set();
  S.diff = S.time = null;
  S.audit = null;
  S.title = title;
  readProject(files);
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
    if (c.skip) {
      rec.skipReason = c.skip;
      if (c.skip === 'project' && file.size <= MAX_FILE) rec.projectText = await readFileText(file);
    } else if (file.size > MAX_FILE) rec.skipReason = 'tooBig';
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
      ${st.refs ? row('rRefs', st.refs) : ''}
      ${st.dictionaries ? row('rDicts', st.dictionaries) : ''}
      ${st.valueLists ? row('rValueLists', st.valueLists) : ''}
      ${st.dataRows ? row('rDataRows', st.dataRows) : ''}
      ${row('rImplicit', st.implicit)}
      ${row('rJunctions', st.junctions)}
      ${row('rIndexes', `${st.indexes} / ${st.comments}`)}
      ${row('rTime', S.parseMs + ' ms')}
    </table>
    ${list('rWarnings', st.warnings.slice(0, 30).map(w => `<li class="w"><span>${esc(w.kind === 'dup' ? t('warnDup', w) : w.kind === 'ref' ? t('warnRef', w) : w.text || '')}</span></li>`))}
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

/* ─── Tasarım denetimi ─── */

// Bulgular js/audit.js'te (kod döner); burada metin, pencere, panel ve harita.
// Denetim tembel kurulur ve görüntülenen modele bağlı saklanır: alt diyagramda tam model, karşılaştırmada "sonra" denetlenir.
S.audit = null;      // { src, stamp, res }
S.auditMap = false;  // haritada: en ağır yeni bulguya göre renk; hata ve uyarısı olmayanlar geri planda
S.auditSev = null;   // tablo → en ağır önem (render.js)
S.auditCols = null;  // tablo → Map(KOLON → önem) (kartta satır rengi)
const SEV_RANK = { error: 0, warning: 1, info: 2 };
const SEV_KEY = { error: 'sevError', warning: 'sevWarning', info: 'sevInfo' };
const AUDIT_GROUPS = ['keys', 'types', 'norm', 'naming'];

function getAudit() {
  const src = S.full ? S.full.model : S.model;
  if (!src) return null;
  const debt = currentDebt();
  const stamp = debt ? debt.updated : '';
  if (!S.audit || S.audit.src !== src || S.audit.stamp !== stamp) {
    const m = S.diffRes ? { ...src, tables: src.tables.filter(tb => S.diffRes.byAfter.has(tb)) } : src;
    S.audit = { src, stamp, res: NS.auditModel(m, { debt: debt ? debt.keys : null }) };
    applyAuditMap();
  }
  return S.audit.res;
}

// Haritada yalnızca yeni bulgular: kabul edilmiş borç renk almaz
function applyAuditMap() {
  S.auditSev = S.auditCols = null;
  const a = S.auditMap && S.audit && S.audit.res;
  if (a) {
    S.auditSev = new Map();
    S.auditCols = new Map();
    const worse = (m, k, sev) => { if (!m.has(k) || SEV_RANK[sev] < SEV_RANK[m.get(k)]) m.set(k, sev); };
    for (const [tb, fs] of a.byTable) {
      for (const f of fs) {
        if (f.debt) continue;
        worse(S.auditSev, tb, f.severity);
        const cols = f.col ? f.col.split(', ') : f.data.cols || [];
        if (!cols.length) continue;
        if (!S.auditCols.has(tb)) S.auditCols.set(tb, new Map());
        for (const c of cols) worse(S.auditCols.get(tb), c.toUpperCase(), f.severity);
      }
    }
  }
  for (const tb of (S.model ? S.model.tables : [])) tb._rows = null;
}

// Görüntülenen model değişince (rebuild, alt diyagram, zaman adımı): harita ve açık pencere yeni modelle
function refreshAudit() {
  if (!S.auditMap && $('#auditPop').hidden) { S.auditSev = S.auditCols = null; return; }
  getAudit();
  renderAudit();
}

function setAuditMap(on) {
  S.auditMap = on;
  getAudit();
  applyAuditMap();
  renderAudit();
  renderPanel();
  invalidate();
}

// Kural metinlerinin değişkenleri: tablo nesneleri ada, listeler metne
function auditVars(f) {
  const d = f.data, nm = x => (x && x.name) || '';
  const style = k => (k ? t('nk_' + d.dim + '_' + k, { n: 30 }) : '');
  return {
    ...d, col: f.col, parent: nm(d.parent), ref: nm(d.ref),
    cols: (d.cols || []).join(', '), names: (d.names || []).join(', '), byCols: (d.byCols || []).join(', '),
    tables: f.tables.map(nm).join(' \u{2194} '),
    variants: (d.variants || []).map(x => `${x.type}: ${x.tables.map(nm).join(', ')}`).join(' · '),
    encodings: (d.encodings || []).map(e => `${e.enc} (${e.cols.map(c => c.t.name + '.' + c.c).join(', ')})`).join(' · '),
    style: style(d.style), dominant: style(d.dominant),
  };
}
const ruleText = id => t('auditRules')[id];
const auditWhat = f => ruleText(f.rule).what(auditVars(f));
const auditLabel = f => (f.t ? f.t.name + (f.col ? '.' + f.col : '') : f.col || '');
const sevCounts = c => ['error', 'warning', 'info'].filter(s => c[s]).map(s => `<i class="sev-${s}">${esc(t(SEV_KEY[s], { n: c[s] }))}</i>`).join('');
const countSev = fs => { const c = { error: 0, warning: 0, info: 0 }; for (const f of fs) c[f.severity]++; return c; };

// Kural kural liste; open: açık kalacak kural kimlikleri (yeniden çizimde)
function auditRulesHtml(list, open, prefix) {
  const byRule = new Map();
  for (const f of list) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
  return AUDIT_GROUPS.map(g => {
    const rules = NS.AUDIT_RULES.filter(r => r.group === g && byRule.has(r.id));
    if (!rules.length) return '';
    return `<h5>${esc(t('auditGroups')[g])}</h5>${rules.map(r => {
      const fs = byRule.get(r.id), R = ruleText(r.id), max = 40, id = prefix + r.id;
      const items = fs.slice(0, max).map(f => {
        const tb = f.t || f.tables[0], what = auditWhat(f);
        return `<li class="sev-${f.severity}" data-go="${esc(tb.key)}"${f.t && f.col && !f.col.includes(',') ? ` data-col="${esc(f.col)}"` : ''} tabindex="0"><b>${esc(auditLabel(f))}</b>${what ? ` <span>${esc(what)}</span>` : ''}</li>`;
      }).join('');
      return `<details class="au-rule sev-${r.severity}" data-rule="${id}"${open.has(id) ? ' open' : ''}><summary><i class="dot"></i><b>${esc(R.title)}</b>${r.guess ? `<em>${esc(t('auditGuess'))}</em>` : ''}<span class="n">${fs.length}</span></summary>
        <p><b>${esc(t('auditWhy'))}:</b> ${esc(R.why)}</p><p><b>${esc(t('auditFix'))}:</b> ${esc(R.fix)}</p>
        <ul class="au-items">${items}${fs.length > max ? `<li class="more">${esc(t('auditMore', { n: fs.length - max }))}</li>` : ''}</ul></details>`;
    }).join('')}`;
  }).join('');
}

function renderAudit() {
  const el = $('#auditPop');
  if (el.hidden && !S.auditMap) return;
  const a = getAudit();
  if (!a) { el.innerHTML = ''; return; }
  // yeniden çizimde açık kurallar ve borç listesi açık kalsın (haritada göster, dil değişimi)
  const open = new Set([...el.querySelectorAll('details[open]')].map(d => d.dataset.rule));
  const fresh = a.findings.filter(f => !f.debt), owed = a.findings.filter(f => f.debt);
  // en çok yeni bulgu: hata 10, uyarı 3, bilgi 1 ağırlıkla
  const weight = fs => fs.reduce((s, f) => s + (f.severity === 'error' ? 10 : f.severity === 'warning' ? 3 : 1), 0);
  const worst = [...a.byTable.entries()].map(([tb, fs]) => [tb, fs.filter(f => !f.debt)]).filter(([, fs]) => fs.some(f => f.severity !== 'info'))
    .sort((x, y) => weight(y[1]) - weight(x[1]) || String(x[0].name).localeCompare(String(y[0].name))).slice(0, 10);
  const skipped = a.skipped.map(s => `<p class="nn">${esc(t(s.reason === 'noIndexes' ? 'auditSkipNoIndexes' : 'auditNone'))}</p>`).join('');
  el.innerHTML = `<h4>${esc(t('auditTitle'))}</h4>
    <p class="intro">${esc(t('auditIntro'))}</p>
    <p class="au-sum">${esc(t('auditSummary', a))}</p>
    <p class="au-chips">${sevCounts(a.counts) || `<span class="nn">${esc(t(a.debt ? 'debtNoNew' : 'auditNone'))}</span>`}</p>
    ${reviewBoxHtml()}${debtHtml(a, owed, open)}
    ${skipped}${auditRulesHtml(fresh, open, '')}
    ${worst.length > 1 ? `<h5>${esc(t('auditWorst'))}</h5><ul class="au-items au-worst">${worst.map(([tb, fs]) =>
      `<li data-go="${esc(tb.key)}" tabindex="0"><b>${esc(tb.name)}</b><span class="au-chips">${sevCounts(countSev(fs))}</span></li>`).join('')}</ul>` : ''}
    <div class="df-row">
      ${fresh.length ? `<button class="btn sm ${S.auditMap ? '' : 'ghost'}" data-act="audit-map">${esc(t(S.auditMap ? 'auditMapOff' : 'auditMap'))}</button>` : ''}
      ${a.findings.some(f => NS.FIXABLE.includes(f.rule)) ? `<button class="btn sm ghost" data-act="audit-fix">${esc(t('fixBtn'))}</button>` : ''}
      ${a.findings.length ? `<button class="btn sm ghost" data-act="audit-md">${esc(t('namingMd'))}</button>` : ''}
    </div>`;
}

$('#auditPop').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) {
    e.stopPropagation();
    const act = b.dataset.act;
    if (act === 'audit-map') setAuditMap(!S.auditMap);
    else if (act === 'audit-md') downloadText(auditMarkdown(), fileStem() + '-' + t('auditFile') + '.md', 'text/markdown;charset=utf-8');
    else if (act === 'audit-fix') openFix();
    else if (act === 'review-open') openReview();
    else if (act === 'debt-accept') acceptDebt();
    else if (act === 'debt-clear') clearDebt();
    else if (act === 'debt-file') downloadProject();
    return;
  }
  const li = e.target.closest('li[data-go]');
  if (!li) return;
  const tb = S.byKey.get(li.dataset.go);
  if (tb) select(tb, { fly: true, col: li.dataset.col || null });
});
$('#auditPop').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('li[data-go]')) e.target.click();
});

// Panel: seçili tablonun bulguları (kapalı başlar; haritada gösterilirken açık). Borç soluk ve etiketli.
function auditPanelHtml(tb) {
  const a = getAudit();
  const fs = a && a.byTable.get(tb);
  if (!fs || !fs.length) return '';
  const fresh = fs.filter(f => !f.debt), owed = fs.length - fresh.length;
  const sorted = fresh.concat(fs.filter(f => f.debt));
  return `<section class="auditsec"><details${S.auditMap ? ' open' : ''}><summary><h3>${esc(t('auditHead'))} <span class="au-chips">${sevCounts(countSev(fresh))}${owed ? `<i class="debt">${esc(t('debtCount', { n: owed }))}</i>` : ''}</span></h3></summary>
    <ul class="au-items">${sorted.map(f => {
      const R = ruleText(f.rule), what = auditWhat(f);
      const fx = NS.fixFor(f, fixOptions(a));
      const sql = fx ? `<details class="au-sql"><summary>${esc(t('fixSql'))} · ${esc(t('fixRisk')[fx.risk])}</summary><pre>${esc(fixText(f, fx))}</pre></details>` : '';
      return `<li class="sev-${f.severity}${f.debt ? ' debt' : ''}"><b>${esc(R.title)}</b>${f.debt ? ` <em>${esc(t('debtTag'))}</em>` : ''}${f.col ? ` <code>${esc(f.col)}</code>` : ''}${what ? ` <span>${esc(what)}</span>` : ''}<small>${esc(t('auditFix'))}: ${esc(R.fix)}</small>${sql}</li>`;
    }).join('')}</ul></details></section>`;
}

// İnceleme belgesi: yeni bulgular kural kural (ne / neden / öneri), sonra borcun özeti ve ödenenler
function auditMarkdown() {
  const a = getAudit();
  const code = s => '`' + String(s).replace(/`/g, "'") + '`';
  const out = [`# ${t('auditTitle')} · ${S.title || ''}`, '', t('auditSummary', a), '',
    ['error', 'warning', 'info'].filter(s => a.counts[s]).map(s => t(SEV_KEY[s], { n: a.counts[s] })).join(' · ') || t(a.debt ? 'debtNoNew' : 'auditNone'), ''];
  for (const s of a.skipped) out.push('> ' + t(s.reason === 'noIndexes' ? 'auditSkipNoIndexes' : 'auditNone'), '');
  const fresh = a.findings.filter(f => !f.debt);
  for (const g of AUDIT_GROUPS) {
    const rules = NS.AUDIT_RULES.filter(r => r.group === g && fresh.some(f => f.rule === r.id));
    if (!rules.length) continue;
    out.push(`## ${t('auditGroups')[g]}`, '');
    for (const r of rules) {
      const fs = fresh.filter(f => f.rule === r.id), R = ruleText(r.id);
      out.push(`### ${R.title} (${fs.length})${r.guess ? ' · ' + t('auditGuess') : ''}`, '', `**${t('auditWhy')}:** ${R.why}`, '', `**${t('auditFix')}:** ${R.fix}`, '');
      for (const f of fs) { const what = auditWhat(f), label = auditLabel(f); out.push(`- ${label ? code(label) : ''}${label && what ? ' ' : ''}${what}`); }
      out.push('');
    }
  }
  if (a.debt) {
    const d = currentDebt();
    out.push(`## ${t('debtHead')}`, '', t('debtSummary', debtVars(a, d)), '');
    for (const r of NS.AUDIT_RULES) {
      const n = a.findings.filter(f => f.debt && f.rule === r.id).length;
      if (n) out.push(`- ${ruleText(r.id).title}: ${n}`);
    }
    out.push('');
    if (a.debt.paid.length) {
      out.push(`### ${t('debtPaid')} (${a.debt.paid.length})`, '');
      for (const k of a.debt.paid) out.push('- ' + paidText(k));
      out.push('');
    }
  }
  return out.join('\n');
}

/* ─── Borç kaydı ─── */

// "Geçmişi affet, geleceği denetle": o anki bulgular kabul edilmiş borç olarak kaydedilir; bundan sonra yalnızca yeni
// bulgular hata sayılır. Kayıt bulgu anahtarlarıdır (audit.js findingKey). İki kaynak:
//   - klasördeki *.sqlschema.json: şemayla birlikte depoya konur, klasörü açan herkes aynı borcu görür
//   - tarayıcı: proje adına göre (dosya kümesine göre değil; yeni migration eklenince kayıt kaybolmasın)
// İkisi de varsa daha yeni olan geçerli. Borcu kaldırmak boş bir kayıt yazar; böylece dosyadaki kaydı da örter.
S.project = null;   // { name, data }: klasörden okunan proje dosyası

const hash36 = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h.toString(36); };
const debtStoreKey = () => 'sqlschema.debt.' + hash36(String(S.title || ''));
const validDebt = d => (d && Array.isArray(d.keys) && typeof d.updated === 'string'
  ? { keys: d.keys.map(String), accepted: String(d.accepted || d.updated).slice(0, 10), updated: d.updated } : null);

function currentDebt() {
  let local = null;
  try { local = validDebt(JSON.parse(localStorage.getItem(debtStoreKey()) || 'null')); } catch (err) { /* depolama kapalı */ }
  const file = S.project && validDebt(S.project.data.debt);
  const d = local && file ? (local.updated >= file.updated ? local : file) : local || file;
  return d && d.keys.length ? d : null;
}
function storeDebt(d) {
  try { localStorage.setItem(debtStoreKey(), JSON.stringify(d)); } catch (err) { toast(t('viewsNoStorage')); }
  refreshAfterDebt();
}
function refreshAfterDebt() {
  S.audit = null;
  getAudit();
  renderAudit();
  renderPanel();
  invalidate();
}

function acceptDebt() {
  const a = getAudit();
  if (!a || !a.findings.length) return;
  const now = new Date().toISOString();
  const prev = currentDebt();
  storeDebt({ keys: [...new Set(a.findings.map(f => f.key))], accepted: prev ? prev.accepted : now.slice(0, 10), updated: now });
  toast(t('debtAccepted', { n: a.findings.length }), 4000);
}
function clearDebt() {
  storeDebt({ keys: [], accepted: '', updated: new Date().toISOString() });
  toast(t('debtCleared'), 3000);
}

// Proje dosyası: borç ve kayıtlı görünümler; şemayı içermez
function downloadProject() {
  const d = currentDebt();
  const data = { app: 'sqlSchema', kind: 'project', version: 1, debt: d || { keys: [], accepted: '', updated: new Date().toISOString() }, views: loadViews() };
  downloadText(JSON.stringify(data, null, 2) + '\n', fileStem() + '.sqlschema.json', 'application/json');
  toast(t('debtFileTip'), 6000);
}

function readProject(files) {
  S.project = null;
  for (const f of files) {
    if (f.skipReason !== 'project' || f.projectText == null) continue;
    try {
      const data = JSON.parse(f.projectText);
      if (data && data.app === 'sqlSchema' && (data.kind === 'project' || data.kind === 'views')) { S.project = { name: baseName(f.path), data }; return; }
    } catch (err) { /* bozuk dosya: yok sayılır */ }
  }
}

const debtVars = (a, d) => ({ accepted: d.accepted, total: a.debt.total, left: a.debt.left, paid: a.debt.paid.length, pct: a.debt.total ? Math.round(a.debt.paid.length * 100 / a.debt.total) : 0 });
// ödenen bir borcun anahtarı: 'kural:TABLO.KOLON' → "Kural başlığı: TABLO.KOLON"
function paidText(key) {
  const i = key.indexOf(':'), R = ruleText(key.slice(0, i));
  return (R ? R.title : key.slice(0, i)) + ': ' + key.slice(i + 1);
}

function debtHtml(a, owed, open) {
  if (!a.debt) {
    return a.findings.length ? `<div class="au-debt"><p class="df-hint">${esc(t('debtHint'))}</p>
      <div class="df-row"><button class="btn sm ghost" data-act="debt-accept">${esc(t('debtAccept'))}</button></div></div>` : '';
  }
  const d = currentDebt(), v = debtVars(a, d);
  const file = S.project && validDebt(S.project.data.debt);
  const src = file && file.updated === d.updated ? t('debtSrcFile', { name: S.project.name }) : t('debtSrcLocal');
  const paid = a.debt.paid.length ? `<details class="au-rule" data-rule="debt-paid"${open.has('debt-paid') ? ' open' : ''}><summary><i class="dot paid"></i><b>${esc(t('debtPaid'))}</b><span class="n">${a.debt.paid.length}</span></summary>
    <ul class="au-items">${a.debt.paid.slice(0, 60).map(k => `<li class="paid">${esc(paidText(k))}</li>`).join('')}</ul></details>` : '';
  return `<div class="au-debt">
    <h5>${esc(t('debtHead'))} <small>${esc(src)}</small></h5>
    <p>${esc(t('debtSummary', v))}</p>
    <div class="au-bar" title="${esc(t('debtProgress', v))}"><i style="width:${v.pct}%"></i></div>
    ${owed.length ? `<details class="au-debtlist" data-rule="debt-list"${open.has('debt-list') ? ' open' : ''}><summary>${esc(t('debtList', { n: owed.length }))}</summary>${auditRulesHtml(owed, open, 'debt:')}</details>` : ''}
    ${paid}
    <div class="df-row">
      <button class="btn sm ghost" data-act="debt-accept" title="${esc(t('debtAcceptMoreTitle'))}">${esc(t('debtAcceptMore'))}</button>
      <button class="btn sm ghost" data-act="debt-file" title="${esc(t('debtFileTip'))}">${esc(t('debtFile'))}</button>
      <button class="btn sm ghost" data-act="debt-clear">${esc(t('debtClear'))}</button>
    </div></div>`;
}

/* ─── Düzeltme önerileri ─── */

// SQL js/fixes.js'te üretilir (notlar kod döner); burada betik metni, pencere ve panelde bulgu başına öneri.
// Varsayılan seçim güvenli ve gözden geçirilecek öneriler; riskliler (veri dönüşümü, ad değişikliği) elle açılır.
S.fixOpts = { safe: true, review: true, risky: false, onlyNew: true, novalidate: true };
const FIX_RISKS = ['safe', 'review', 'risky'];

const fixOptions = a => ({ indexesKnown: !a.skipped.some(x => x.rule === 'fk-no-index'), novalidate: S.fixOpts.novalidate });

// Bir önerinin metni: başlık, notlar ve adımlar (sonra çalıştırılacak adımlar yorum olarak)
function fixText(f, fix) {
  const R = ruleText(f.rule), label = auditLabel(f), notes = t('fixNotes');
  const out = [`-- [${t('fixRisk')[fix.risk]}] ${R.title}${label ? ' · ' + label : ''}`];
  for (const st of fix.steps) {
    for (const n of [].concat(st.note || [])) out.push('-- ' + notes[n]);
    out.push(st.comment ? '-- ' + st.sql : st.sql);
  }
  return out.join('\n');
}

function fixItems() {
  const a = getAudit();
  if (!a) return { a, all: [], picked: [], manual: 0 };
  const pool = S.fixOpts.onlyNew ? a.findings.filter(f => !f.debt) : a.findings;
  const all = NS.fixAll(pool, fixOptions(a));
  return { a, all, picked: all.filter(x => S.fixOpts[x.fix.risk]), manual: pool.length - all.length };
}
const riskCounts = items => { const c = { n: items.length, safe: 0, review: 0, risky: 0 }; for (const x of items) c[x.fix.risk]++; return c; };

function fixScript(items) {
  const dialects = [...new Set(items.map(x => x.f.t.dialect).filter(Boolean))].map(d => DIALECTS[d] || d);
  const head = [
    '-- ' + t('fixHeader', { title: S.title || '', dialect: dialects.join(', '), date: new Date().toISOString().slice(0, 10) }),
    '-- ' + t('fixWarn'),
    '-- ' + t('fixCount', riskCounts(items)),
    '',
  ];
  return head.join('\n') + '\n' + (items.length ? items.map(x => fixText(x.f, x.fix)).join('\n\n') : t('fixNone')) + '\n';
}

function openFix() {
  renderFix();
  const d = $('#fixDlg');
  if (!d.open) d.showModal();
}

function renderFix() {
  const { a, all, picked, manual } = fixItems();
  const n = r => all.filter(x => x.fix.risk === r).length;
  $('#fixBody').innerHTML = `<h3>${esc(t('fixTitle'))}</h3>
    <p>${esc(t('fixIntro'))}</p>
    <div class="fx-opts">
      ${FIX_RISKS.map(r => `<label class="fx-${r}" title="${esc(t('fixRiskTitle')[r])}"><input type="checkbox" data-fix="${r}" ${S.fixOpts[r] ? 'checked' : ''}> ${esc(t('fixRisk')[r])} <i>${n(r)}</i></label>`).join('')}
      ${a && a.debt ? `<label><input type="checkbox" data-fix="onlyNew" ${S.fixOpts.onlyNew ? 'checked' : ''}> ${esc(t('fixOnlyNew'))}</label>` : ''}
      ${all.some(x => x.f.rule === 'fk-missing') ? `<label><input type="checkbox" data-fix="novalidate" ${S.fixOpts.novalidate ? 'checked' : ''}> ${esc(t('fixNovalidate'))}</label>` : ''}
    </div>
    ${manual ? `<p class="fx-note">${esc(t('fixManual', { n: manual }))}</p>` : ''}
    <pre id="fixPre" tabindex="0">${esc(fixScript(picked))}</pre>
    <div class="row">
      <span class="grow">${esc(t('fixCount', riskCounts(picked)))}</span>
      <button class="btn ghost" data-fix-act="copy" ${picked.length ? '' : 'disabled'}>${esc(t('fixCopy'))}</button>
      <button class="btn ghost" data-fix-act="download" ${picked.length ? '' : 'disabled'}>${esc(t('fixDownload'))}</button>
      <button class="btn" data-fix-act="close">${esc(t('fixClose'))}</button>
    </div>`;
}

$('#fixDlg').addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.fix;
  if (!k) return;
  S.fixOpts[k] = e.target.checked;
  renderFix();
});
$('#fixDlg').addEventListener('click', e => {
  const b = e.target.closest('[data-fix-act]');
  if (!b) return;
  const script = $('#fixPre').textContent;
  if (b.dataset.fixAct === 'close') $('#fixDlg').close();
  else if (b.dataset.fixAct === 'download') downloadText(script, fileStem() + '-' + t('fixFile') + '.sql', 'application/sql;charset=utf-8');
  else if (b.dataset.fixAct === 'copy') copyPre($('#fixPre'));
});

// file:// sayfalarında pano API'si olmayabilir: metin seçilir, kullanıcı kopyalar
function copyPre(pre) {
  const text = pre.textContent;
  const done = () => toast(t('fixCopied'), 2500);
  const select = () => { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); let ok = false; try { ok = document.execCommand('copy'); } catch (err) { /* desteklenmiyor */ } if (ok) done(); else toast(t('fixSelected'), 4000); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, select);
  else select();
}

/* ─── Değişiklik incelemesi ─── */

// Karşılaştırma ya da zaman çizelgesi açıkken: "sonra"nın getirdiği ve giderdiği bulgular (audit.js reviewChange).
// Rapor PR yorumuna yapıştırılacak Markdown'dur; güvenli ve gözden geçirilecek düzeltme SQL'i katlanır bölümde.
S.diffBefore = null;   // karşılaştırmanın "önce" modeli (rebuild ve zaman adımı kurar)
S.review = null;       // { src, stamp, res }
S.reviewSql = true;
const SEV_ICON = { error: '\u{2717}', warning: '\u{26A0}', info: '\u{2139}' };

function getReview() {
  if (!S.diffRes || !S.diffBefore) return null;
  const src = S.full ? S.full.model : S.model;
  const debt = currentDebt();
  const stamp = debt ? debt.updated : '';
  if (!S.review || S.review.src !== src || S.review.stamp !== stamp) {
    const after = { ...src, tables: src.tables.filter(tb => S.diffRes.byAfter.has(tb)) };
    S.review = { src, stamp, res: NS.reviewChange(S.diffBefore, after, { diff: S.diffRes, debt: debt ? debt.keys : null }) };
  }
  return S.review.res;
}

function reviewMarkdown(r, withSql) {
  const [before, after] = diffSides();
  const code = s => '`' + String(s).replace(/`/g, "'") + '`';
  const line = f => {
    const what = auditWhat(f), label = auditLabel(f);
    return `- ${SEV_ICON[f.severity]} ${label ? code(label) + ' · ' : ''}${ruleText(f.rule).title}${what ? ': ' + what : ''}`;
  };
  const bySev = list => list.slice().sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const out = [`## ${t('reviewHead', { before, after })}`, '',
    [t('reviewTables', r.diff.summary), ...['error', 'warning', 'info'].filter(k => r.counts[k]).map(k => t(SEV_KEY[k], { n: r.counts[k] }))].join(' · '), ''];
  if (!r.findings.length) out.push(t('reviewNone'), '');
  else out.push(`### ${t('reviewNew')} (${r.findings.length})`, '', ...bySev(r.findings).map(line), '');
  if (r.fixed.length) out.push(`### ${t('reviewFixed')} (${r.fixed.length})`, '', ...bySev(r.fixed).map(line), '');
  if (withSql && r.findings.length) {
    const fx = NS.fixAll(r.findings, fixOptions(r.after)).filter(x => x.fix.risk !== 'risky');
    if (fx.length) out.push(`<details><summary>${t('reviewSql')} (${fx.length})</summary>`, '', '```sql', fx.map(x => fixText(x.f, x.fix)).join('\n\n'), '```', '', '</details>', '');
  }
  return out.join('\n');
}

function openReview() {
  renderReview();
  const d = $('#reviewDlg');
  if (!d.open) d.showModal();
}
function renderReview() {
  const r = getReview();
  if (!r) { $('#reviewDlg').open && $('#reviewDlg').close(); return; }
  $('#reviewBody').innerHTML = `<h3>${esc(t('reviewTitle'))}</h3>
    <p>${esc(t('reviewIntro'))}</p>
    <div class="fx-opts"><label><input type="checkbox" data-rv="sql" ${S.reviewSql ? 'checked' : ''}> ${esc(t('reviewWithSql'))}</label></div>
    <pre id="reviewPre" tabindex="0">${esc(reviewMarkdown(r, S.reviewSql))}</pre>
    <div class="row">
      <span class="grow">${esc(t('reviewBox', { n: r.findings.length, fixed: r.fixed.length }))}</span>
      <button class="btn ghost" data-rv-act="copy">${esc(t('fixCopy'))}</button>
      <button class="btn ghost" data-rv-act="download">${esc(t('namingMd'))}</button>
      <button class="btn" data-rv-act="close">${esc(t('fixClose'))}</button>
    </div>`;
}
$('#reviewDlg').addEventListener('change', e => {
  if (!e.target.dataset || e.target.dataset.rv !== 'sql') return;
  S.reviewSql = e.target.checked;
  renderReview();
});
$('#reviewDlg').addEventListener('click', e => {
  const b = e.target.closest('[data-rv-act]');
  if (!b) return;
  const act = b.dataset.rvAct;
  if (act === 'close') $('#reviewDlg').close();
  else if (act === 'download') downloadText($('#reviewPre').textContent, fileStem() + '-' + t('reviewFile') + '.md', 'text/markdown;charset=utf-8');
  else if (act === 'copy') copyPre($('#reviewPre'));
});

// Denetim penceresinde: karşılaştırma açıkken bu değişikliğin özeti
function reviewBoxHtml() {
  const r = getReview();
  if (!r) return '';
  const [before, after] = diffSides();
  return `<div class="au-debt au-review"><h5>${esc(t('reviewTitle'))} <small>${esc(before)} → ${esc(after)}</small></h5>
    <p class="au-chips">${sevCounts(r.counts) || `<span class="nn">${esc(t('reviewNone'))}</span>`}${r.fixed.length ? `<i class="paid">${esc(t('reviewFixedN', { n: r.fixed.length }))}</i>` : ''}</p>
    <div class="df-row"><button class="btn sm ghost" data-act="review-open">${esc(t('reviewBtn'))}</button></div></div>`;
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
  if (tb && !opts.fromHistory) pushHistory(tb);
  computeImpact();
  refreshEmphasis();
  renderPanel();
  markListSel();
  invalidate();
  if (tb && opts.fly) flyToTable(tb, opts.k);
}

/* ─── Çoklu seçim ve alt diyagram ─── */

// Ctrl/Cmd + tık, panel ya da tablo listesiyle tablolar seçime eklenir. Alt diyagram yalnızca onları (isteğe
// bağlı bir adım komşularıyla) kendi yerleşimiyle çizer. Tam model S.full'da saklanır; çıkınca tam yerleşim
// yeniden kurulur (deterministik olduğu için aynı harita döner).
S.full = null;
S.subKeys = null;
S.subNeighbors = false;

function togglePick(tb) {
  if (!tb) return;
  if (S.pick.has(tb.key)) S.pick.delete(tb.key); else S.pick.add(tb.key);
  afterPick();
}
function pickTables(tables) {
  const all = tables.every(tb => S.pick.has(tb.key));
  for (const tb of tables) { if (all) S.pick.delete(tb.key); else S.pick.add(tb.key); }
  afterPick();
}
function afterPick() {
  renderPickBar();
  renderPanel();
  renderList();
  invalidate();
}

function subsetModel(full, keys, neighbors) {
  const byKey = new Map(full.tables.map(tb => [tb.key, tb]));
  const set = new Set(keys.map(k => byKey.get(k)).filter(Boolean));
  if (neighbors) {
    for (const tb of [...set]) {
      for (const r of tb.out.concat(tb.inc)) {
        if (r.kind === 'implicit' && !S.implicit) continue;
        set.add(r.child);
        set.add(r.parent);
      }
    }
  }
  // gömülü belgeler (MongoDB uyduları) sahipleriyle gelir
  for (const tb of full.tables) if (tb.embedded && tb.owner && set.has(tb.owner)) set.add(tb);
  const tables = full.tables.filter(tb => set.has(tb));
  const rels = full.rels.filter(r => set.has(r.child) && set.has(r.parent));
  // alt bilgi çubuğu alt diyagramın kendi sayılarını göstersin
  const stats = {
    ...full.stats,
    tables: tables.filter(tb => !tb.external && !tb.embedded).length,
    embedded: tables.filter(tb => tb.embedded).length,
    fk: rels.filter(r => r.kind === 'fk').length,
    implicit: rels.filter(r => r.kind === 'implicit').length,
  };
  return { ...full, tables, rels, stats, dbs: [...new Set(tables.map(tb => tb.db))], sub: true };
}

function enterSubset(keys, neighbors) {
  // zaman çizelgesinde alt diyagram yok: çizelge kapanır, alt diyagram son hâlden kurulur
  if (S.tl) { S.time = null; rebuild(); }
  const full = S.full ? S.full.model : S.model;
  const sub = subsetModel(full, keys, neighbors);
  if (!sub.tables.length) return false;
  S.full = { model: full };
  S.subKeys = keys.slice();
  S.subNeighbors = !!neighbors;
  S.pick = new Set();
  S.model = sub;
  S.relSet = new Set(sub.rels);
  S.lay = layoutModel(sub, { grouping: resolveGrouping(S.grouping, S.migration) });
  afterLayout();
  return true;
}

function exitSubset() {
  if (!S.full) return;
  S.model = S.full.model;
  S.full = null;
  S.subKeys = null;
  S.relSet = null;
  S.lay = layoutModel(S.model, { grouping: resolveGrouping(S.grouping, S.migration) });
  afterLayout();
}

function afterLayout() {
  S.hover = null;
  // etiketler bu sırayla çizilir; alt diyagramda yalnızca diyagramdaki tablolar
  S.order = S.model.tables.slice().sort(byDegree);
  for (const tb of S.model.tables) { tb._rows = null; tb._lw = 0; }
  buildIndex();
  if (S.sel && !S.byKey.has(S.sel.key)) S.sel = null;
  computeImpact();
  refreshEmphasis();
  renderPanel();
  renderList();
  renderNaming();
  renderPickBar();
  refreshAudit();
  resetHud();
  fitView(true);
}

function renderPickBar(naming) {
  const el = $('#pickBar');
  if (S.full && naming) {
    el.innerHTML = `<span class="pb-title">${esc(t('pbSub'))}</span>
      <input id="pbName" type="text" maxlength="80" spellcheck="false" value="${esc(defaultViewName())}" placeholder="${esc(t('pbNamePh'))}">
      <button class="btn sm" data-act="view-save">${esc(t('pbSave'))}</button>
      <button class="btn sm ghost" data-act="view-cancel">${esc(t('cancel'))}</button>`;
    const inp = $('#pbName');
    inp.focus();
    inp.select();
  } else if (S.full) {
    el.innerHTML = `<span class="pb-title">${esc(t('pbSub'))}</span><b>${esc(t('pbCount', { n: S.model.tables.length }))}</b>
      <button class="btn sm ghost" data-act="view-name" title="${esc(t('pbSaveTitle'))}">${esc(t('pbSave'))}</button>
      <button class="btn sm" data-act="sub-exit">${esc(t('pbExit'))}</button>`;
  } else if (S.pick.size) {
    el.innerHTML = `<b>${esc(t('pbSelected', { n: S.pick.size }))}</b>
      <label class="toggle"><input type="checkbox" id="pbNeighbors" ${S.subNeighbors ? 'checked' : ''}><span>${esc(t('pbNeighbors'))}</span></label>
      <button class="btn sm" data-act="sub-open">${esc(t('pbOpen'))}</button>
      <button class="btn sm ghost" data-act="pick-clear">${esc(t('pbClear'))}</button>`;
  }
  el.hidden = !S.full && !S.pick.size;
}

$('#pickBar').addEventListener('change', e => { if (e.target.id === 'pbNeighbors') S.subNeighbors = e.target.checked; });
$('#pickBar').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.act === 'sub-open') enterSubset([...S.pick], S.subNeighbors);
  else if (b.dataset.act === 'sub-exit') exitSubset();
  else if (b.dataset.act === 'pick-clear') { S.pick = new Set(); afterPick(); }
  else if (b.dataset.act === 'view-name') renderPickBar(true);
  else if (b.dataset.act === 'view-cancel') renderPickBar();
  else if (b.dataset.act === 'view-save') saveView($('#pbName').value);
});
$('#pickBar').addEventListener('keydown', e => {
  if (e.target.id !== 'pbName') return;
  e.stopPropagation();   // yazarken C, L gibi kısayollar çalışmasın
  if (e.key === 'Enter') saveView(e.target.value);
  else if (e.key === 'Escape') renderPickBar();
});

/* ─── Kayıtlı görünümler ─── */

// Görünüm = adlandırılmış bir alt diyagram (tablo anahtarları + komşular). Tarayıcıda dosya kümesinin parmak izine
// göre saklanır; aynı dosyalar açılınca geri gelir. .sqlschema.json olarak dışa/içe aktarılır, şemayı taşımaz.
function viewsFingerprint() {
  const paths = (S.ordered || []).filter(f => f.include && f.result).map(f => f.path).sort().join('\n');
  return hash36(paths);
}
function loadViews() {
  try {
    const raw = localStorage.getItem('sqlschema.views.' + viewsFingerprint());
    const v = raw != null ? JSON.parse(raw) : (S.project && S.project.data.views) || [];
    return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && Array.isArray(x.tables)) : [];
  } catch (err) { return []; }
}
function storeViews(views) {
  try { localStorage.setItem('sqlschema.views.' + viewsFingerprint(), JSON.stringify(views)); } catch (err) { toast(t('viewsNoStorage')); }
}
function defaultViewName() {
  const full = S.full ? S.full.model : S.model;
  const names = (S.subKeys || []).map(k => { const tb = full && full.tables.find(x => x.key === k); return tb ? tb.name : k.split('.').pop(); });
  return names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '');
}
function saveView(name) {
  name = String(name || '').trim();
  if (!name || !S.subKeys) return;
  const views = loadViews().filter(v => v.name !== name);
  views.push({ name, tables: S.subKeys.slice(), near: S.subNeighbors });
  storeViews(views);
  renderPickBar();
  renderViews();
  toast(t('viewSaved', { name }), 2500);
}
function openView(v) {
  const keys = v.tables.filter(k => (S.full ? S.full.model : S.model).tables.some(tb => tb.key === k));
  if (!keys.length || !enterSubset(keys, !!v.near)) { toast(t('viewMissing'), 4000); return; }
  $('#viewMenu').hidden = true;
}

function renderViews() {
  const el = $('#savedViews');
  const views = S.model || S.full ? loadViews() : [];
  el.innerHTML = `<div class="sv-head">${esc(t('viewsTitle'))}</div>
    ${views.length ? `<ul>${views.map((v, i) => `<li><button class="sv-open" data-view-open="${i}"><b>${esc(v.name)}</b><span>${esc(t('pbCount', { n: v.tables.length }))}${v.near ? ' · ' + esc(t('pbNeighbors')) : ''}</span></button><button class="sv-del" data-view-del="${i}" title="${esc(t('viewDelete'))}" aria-label="${esc(t('viewDelete'))}">×</button></li>`).join('')}</ul>` : `<p>${esc(t('viewsEmpty'))}</p>`}
    <div class="sv-actions">
      <button class="btn sm ghost" data-view-act="export" ${views.length ? '' : 'disabled'} title="${esc(t('viewsExportTitle'))}">${esc(t('viewsExport'))}</button>
      <button class="btn sm ghost" data-view-act="import">${esc(t('viewsImport'))}</button>
    </div>`;
}

$('#savedViews').addEventListener('click', e => {
  const views = loadViews();
  const open = e.target.closest('[data-view-open]');
  if (open) { const v = views[Number(open.dataset.viewOpen)]; if (v) openView(v); return; }
  const del = e.target.closest('[data-view-del]');
  if (del) {
    const v = views[Number(del.dataset.viewDel)];
    if (!v) return;
    storeViews(views.filter(x => x !== v));
    renderViews();
    toast(t('viewDeleted', { name: v.name }), 2500);
    return;
  }
  const act = e.target.closest('[data-view-act]');
  if (!act) return;
  if (act.dataset.viewAct === 'export') {
    const data = { app: 'sqlSchema', kind: 'views', version: 1, views };
    downloadText(JSON.stringify(data, null, 2) + '\n', fileStem() + '.sqlschema.json', 'application/json');
  } else $('#viewFile').click();
});

$('#viewFile').addEventListener('change', async () => {
  const file = $('#viewFile').files[0];
  $('#viewFile').value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'sqlSchema' || (data.kind !== 'views' && data.kind !== 'project')) throw new Error('kind');
    const debt = data.kind === 'project' && validDebt(data.debt);
    if (debt) storeDebt(debt);
    if (!Array.isArray(data.views) || !data.views.length) { if (debt) toast(t('debtImported', { n: debt.keys.length }), 3000); else throw new Error('empty'); return; }
    const incoming = data.views.filter(v => v && typeof v.name === 'string' && Array.isArray(v.tables)).map(v => ({ name: v.name.slice(0, 80), tables: v.tables.map(String), near: !!v.near }));
    const names = new Set(incoming.map(v => v.name));
    storeViews(loadViews().filter(v => !names.has(v.name)).concat(incoming));
    renderViews();
    toast(t('viewsImported', { n: incoming.length }), 3000);
  } catch (err) {
    toast(t('viewsBadFile'), 5000);
  }
});

/* ─── Tablo listesi ─── */

// Veritabanı › şema › takımyıldız › tablo. "Tabloları sırayla gezmek" için: ↑ ↓ seçimi ve haritayı birlikte taşır.
// Varsayılan kapalı (Görünüm menüsü ya da L); açıkken lejant kapanır, ikisi aynı kenarı paylaşır.
S.list = false;
S.listOrder = 'file';
let listKeys = [], listGroups = [];

// Dosyadaki sıra: tablonun tanımlandığı dosya ve satır; dosyası olmayanlar (dış başvurular) en sonda
const fileOrder = (a, b) => {
  const fa = a.src ? a.src.file : '\u{FFFF}', fb = b.src ? b.src.file : '\u{FFFF}';
  return fa.localeCompare(fb, undefined, { numeric: true }) || (a.src ? a.src.line : 0) - (b.src ? b.src.line : 0) || String(a.name).localeCompare(String(b.name));
};

function renderList() {
  if (!S.list || !S.model) return;
  const fold = s => String(s || '').normalize('NFD').replace(/[\u{300}-\u{36F}]/gu, '').toUpperCase();
  const f = fold($('#tlFilter').value.trim());
  const multiDb = S.lay.dbs.length > 1, multiSchema = S.lay.schemas.length > 1;
  const out = [];
  listKeys = [];
  listGroups = [];
  let shown = 0, total = 0;
  for (const s of S.lay.schemas) {
    const groups = s.groups.map(g => {
      const ts = g.tables.filter(tb => !tb.embedded);
      total += ts.length;
      const hit = f ? ts.filter(tb => fold(tb.name).includes(f)) : ts;
      return { g, ts: hit.sort(S.listOrder === 'file' ? fileOrder : (a, b) => String(a.name).localeCompare(String(b.name))) };
    }).filter(x => x.ts.length);
    if (!groups.length) continue;
    if (multiSchema) out.push(`<div class="tl-schema" style="--c:${PALETTE[s.index % PALETTE.length]}">${esc((multiDb ? s.db.label + ' / ' : '') + schemaLabel(s))}</div>`);
    for (const { g, ts } of groups) {
      if (s.groups.length > 1) {
        listGroups.push(ts);
        const all = ts.every(tb => S.pick.has(tb.key));
        out.push(`<div class="tl-group">${esc(groupLabel(g))} <span>${ts.length}</span><button class="tl-pick${all ? ' on' : ''}" data-pickgroup="${listGroups.length - 1}" title="${esc(t('listPickGroup'))}">${all ? '\u{2212}' : '+'}</button></div>`);
      }
      for (const tb of ts) {
        listKeys.push(tb.key);
        shown++;
        const tags = [
          !tb.external && !tb.pk.length ? `<i class="bad">${esc(t('tagNoPk'))}</i>` : '',
          tb.junction ? '<i>M:N</i>' : '',
          tb.dictionary ? `<i class="acc">${esc(t('tagDict'))}</i>` : '',
          tb.external ? `<i>${esc(t('tagExternal'))}</i>` : '',
        ].join('');
        out.push(`<button class="tl-row${tb === S.sel ? ' on' : ''}${tb.external ? ' ext' : ''}${S.pick.has(tb.key) ? ' picked' : ''}" data-key="${esc(tb.key)}" tabindex="-1"><span class="tl-name">${esc(tb.name)}</span>${tags}<span class="tl-n">${tb.columns.length}</span></button>`);
      }
    }
  }
  $('#tlBody').innerHTML = out.join('') || `<p class="tl-none">${esc(t('noMatch'))}</p>`;
  $('#tlCount').textContent = f ? `${shown} / ${total}` : String(total);
  for (const b of document.querySelectorAll('#tableList [data-order]')) b.setAttribute('aria-pressed', String(b.dataset.order === S.listOrder));
  markListSel();
}

function markListSel() {
  if (!S.list) return;
  const prev = $('#tlBody .tl-row.on');
  if (prev) prev.classList.remove('on');
  if (!S.sel) return;
  const row = $(`#tlBody .tl-row[data-key="${CSS.escape(S.sel.key)}"]`);
  if (row) { row.classList.add('on'); row.scrollIntoView({ block: 'nearest' }); }
}

// persist: kullanıcının seçimi hatırlanır; ?list=1 gibi bağlantı parametreleri hatırlanmaz
function setList(on, persist = true) {
  S.list = on;
  $('#tableList').hidden = !on;
  $('#tList').checked = on;
  document.body.classList.toggle('has-list', on);
  if (on) document.body.classList.add('legend-closed');
  if (persist) { try { localStorage.setItem('sqlschema.list', on ? '1' : '0'); } catch (err) { /* depolama kapalı */ } }
  renderList();
}

// Listede bir satıra geç: seçim, panel ve harita birlikte ilerler
function listGo(i) {
  if (!listKeys.length) return;
  const k = listKeys[Math.max(0, Math.min(listKeys.length - 1, i))];
  const tb = S.byKey.get(k);
  if (tb) select(tb, { fly: true });
  const row = $(`#tlBody .tl-row[data-key="${CSS.escape(k)}"]`);
  if (row) row.focus({ preventScroll: true });
}

$('#tList').addEventListener('change', e => setList(e.target.checked));
$('#tlFilter').addEventListener('input', renderList);
$('#tableList').addEventListener('click', e => {
  const order = e.target.closest('[data-order]');
  if (order) { S.listOrder = order.dataset.order; renderList(); return; }
  const grp = e.target.closest('[data-pickgroup]');
  if (grp) { pickTables(listGroups[Number(grp.dataset.pickgroup)] || []); return; }
  const row = e.target.closest('.tl-row');
  if (row && (e.ctrlKey || e.metaKey)) { togglePick(S.byKey.get(row.dataset.key)); return; }
  if (row) listGo(listKeys.indexOf(row.dataset.key));
});
$('#tableList').addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
    if (e.key === 'Escape') { e.stopPropagation(); setList(false); }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const cur = document.activeElement && document.activeElement.dataset ? listKeys.indexOf(document.activeElement.dataset.key) : -1;
  const from = cur >= 0 ? cur : S.sel ? listKeys.indexOf(S.sel.key) : -1;
  listGo(from < 0 ? 0 : from + (e.key === 'ArrowDown' ? 1 : -1));
});

/* ─── Şema farkı (karşılaştırma) ─── */

// "Önce" iki yoldan gelir: migration klasöründe bir sürüme kadarki dosyalar ya da ayrıca seçilen dosyalar.
// "Sonra" her zaman açık dosyalardır. Fark js/diff.js'te; burada harita, panel ve rapor.
S.diff = null;
S.diffRes = null;

function buildBefore(ordered, dbOf) {
  let inputs;
  if (S.diff.mode === 'version') {
    const i = ordered.findIndex(f => f.path === S.diff.version);
    if (i < 0) return null;
    inputs = ordered.slice(0, i + 1).filter(f => f.include && f.result).map(f => ({ ...f.result, db: dbOf(f) }));
  } else {
    const recs = S.diff.files.filter(f => f.text != null && !f.skipReason);
    for (const f of recs) {
      if (f.result === undefined) { try { f.result = parseFile(f.path, f.text); } catch (err) { f.result = null; } }
    }
    const { files: ord } = orderFiles(recs);
    const usable = ord.filter(f => f.result);
    harmonizeDialects(usable.map(f => f.result));
    const names = databaseNames(usable.map(f => f.path));
    inputs = usable.map(f => ({ ...f.result, db: S.separate ? names.get(f.path) : 'main' }));
  }
  if (!inputs.length) return null;
  return buildModel(inputs, { dictionaries: S.dictOverride });
}

function startDiff(diff) {
  S.diff = diff;
  S.subKeys = null;
  S.pick = new Set();
  if (!rebuild()) { S.diff = null; rebuild(); return; }
  if (!S.diffRes) { toast(t('diffNoBefore'), 5000); S.diff = null; rebuild(); return; }
  const s = S.diffRes.summary;
  toast(t('diffSummary', s), 4000);
}
function stopDiff() {
  S.diff = null;
  rebuild();
}

// Migration klasöründeki sürüm dosyaları (karşılaştırma ve zaman çizelgesi için): son dosya hariç
function versionFiles() {
  return (S.ordered || []).filter(f => f.include && f.result);
}
const fileLabel = p => baseName(p).replace(/\.[^.]+$/, '');

// Karşılaştırmanın iki yanının adı; zaman çizelgesinde bir önceki ve şimdiki sürüm
function diffSides() {
  if (S.tl) {
    const i = S.tl.pos, f = S.tl.files;
    return [i ? fileLabel(f[i - 1].path) : '\u{2205}', fileLabel(f[i].path)];
  }
  return [S.diff.mode === 'version' ? fileLabel(S.diff.version) : S.diff.title, S.title || ''];
}

const DIFF_STATUS = { added: 'diffAdded', removed: 'diffRemoved', changed: 'diffChanged', renamed: 'diffRenamed' };

function renderDiff() {
  const el = $('#diffPop');
  if (!S.model) { el.innerHTML = ''; return; }
  if (!S.diffRes) {
    const vers = S.migration ? versionFiles() : [];
    const verSel = vers.length > 1 ? `<label class="df-row">${esc(t('diffVersion'))}
      <select id="dfVersion">${vers.slice(0, -1).map((f, i) => `<option value="${esc(f.path)}" ${i === vers.length - 2 ? 'selected' : ''}>${esc(fileLabel(f.path))}</option>`).join('')}</select>
      <button class="btn sm" data-act="diff-version">${esc(t('diffRun'))}</button></label>` : '';
    const tl = vers.length > 1 ? `<div class="df-row"><button class="btn sm" data-act="time-open">${esc(t('tlOpen'))}</button></div><p class="df-hint">${esc(t('tlHint'))}</p>` : '';
    el.innerHTML = `<h4>${esc(t('diffTitle'))}</h4>
      <p class="intro">${esc(t('diffIntro'))}</p>
      ${verSel}${tl}
      <p class="df-or">${esc(t(verSel ? 'diffOrFiles' : 'diffFiles'))}</p>
      <div class="df-row"><button class="btn sm ghost" data-act="diff-files">${esc(t('chooseFiles'))}</button><button class="btn sm ghost" data-act="diff-folder">${esc(t('chooseFolder'))}</button></div>`;
    return;
  }
  const res = S.diffRes, s = res.summary;
  const [before, after] = diffSides();
  const group = (status, list) => list.length ? `<h5>${esc(t(DIFF_STATUS[status]))} <span>${list.length}</span></h5><ul class="df-list">${list.map(e => {
    const tb = e.after || e.before;
    const note = e.renamed ? ` <i>← ${esc(e.before.name)}</i>` : '';
    return `<li data-go="${esc(tb.key)}" class="d-${status}"><b>${esc(tb.name)}</b>${note}<span>${esc(tb.schema || '')}</span></li>`;
  }).join('')}</ul>` : '';
  const by = st => res.tables.filter(e => e.status === st);
  el.innerHTML = `<h4>${esc(t('diffTitle'))}</h4>
    <p class="df-sides"><span>${esc(t('diffBefore'))}: <b>${esc(before)}</b></span><span>${esc(t('diffAfter'))}: <b>${esc(after)}</b></span></p>
    <p class="df-chips"><i class="d-added">${esc(t('diffAdded'))} ${s.added}</i><i class="d-removed">${esc(t('diffRemoved'))} ${s.removed}</i><i class="d-changed">${esc(t('diffChanged'))} ${s.changed}</i><i class="d-renamed">${esc(t('diffRenamed'))} ${s.renamed}</i></p>
    ${s.added + s.removed + s.changed ? '' : `<p class="nn">${esc(t('diffNone'))}</p>`}
    ${group('added', by('added'))}${group('removed', by('removed'))}${group('changed', by('changed'))}
    <div class="df-row">
      <button class="btn sm ghost" data-act="diff-review" title="${esc(t('reviewIntro'))}">${esc(t('reviewBtn'))}</button>
      ${s.added + s.removed + s.changed ? `<button class="btn sm ghost" data-act="diff-md">${esc(t('namingMd'))}</button>` : ''}
      <button class="btn sm" data-act="diff-close">${esc(t(S.tl ? 'tlClose' : 'diffClose'))}</button>
    </div>`;
}

// Panel: seçili tablonun farkı
function diffPanelHtml(tb) {
  const e = S.diffRes && (S.diffRes.byAfter.get(tb) || S.diffRes.byBefore.get(tb));
  if (!e || e.status === 'same') return '';
  const items = [];
  if (e.renamed) items.push(`<li class="d-renamed">${esc(t('diffRenamedFrom', { name: e.before.name }))}</li>`);
  for (const c of e.cols) items.push(`<li class="d-${c.status}">${esc(diffColText(c))}</li>`);
  if (e.pk) items.push(`<li class="d-changed">PK: (${esc(e.pk.before.join(', '))}) → (${esc(e.pk.after.join(', '))})</li>`);
  for (const f of e.fks) items.push(`<li class="d-${f.status === 'added' ? 'added' : 'removed'}">${f.status === 'added' ? '+' : '\u{2212}'} FK ${esc(f.rel.cols.join(', '))} → ${esc(f.rel.parent.name)}</li>`);
  return `<section class="diffsec"><h3>${esc(t('diffHead'))} <span class="tag d-${e.status}">${esc(t(DIFF_STATUS[e.status]))}</span></h3>
    ${items.length ? `<ul class="df-changes">${items.join('')}</ul>` : ''}</section>`;
}

function diffColText(c) {
  const what = { type: () => t('diffType', { a: c.before.type, b: c.after.type }), null: () => t(c.after.nullable ? 'diffNowNull' : 'diffNowNotNull'), pk: () => t(c.after.pk ? 'diffNowPk' : 'diffNoLongerPk') };
  const ch = c.changes.map(k => what[k]()).join('; ');
  if (c.status === 'added') return `+ ${c.name} ${c.after.type || ''}`.trim();
  if (c.status === 'removed') return `\u{2212} ${c.name}`;
  if (c.status === 'renamed') return `${c.from} → ${c.name} (${t('diffGuess')})${ch ? ': ' + ch : ''}`;
  return `~ ${c.name}: ${ch}`;
}

// Değişiklik raporu: sürüm notu ya da inceleme için
function diffMarkdown() {
  const res = S.diffRes, s = res.summary;
  const [before, after] = diffSides();
  const q = tb => '`' + (tb.schema ? tb.schema + '.' : '') + tb.name + '`';
  const out = [`# ${t('diffTitle')} · ${before} → ${after}`, '', t('diffSummary', s), ''];
  const by = st => res.tables.filter(e => e.status === st);
  if (by('added').length) out.push(`## ${t('diffAdded')}`, '', ...by('added').map(e => '- ' + q(e.after)), '');
  if (by('removed').length) out.push(`## ${t('diffRemoved')}`, '', ...by('removed').map(e => '- ' + q(e.before)), '');
  if (by('changed').length) {
    out.push(`## ${t('diffChanged')}`, '');
    for (const e of by('changed')) {
      out.push(`### ${q(e.after)}${e.renamed ? ' ← ' + q(e.before) + ' (' + t('diffGuess') + ')' : ''}`, '');
      const items = e.cols.map(c => '- ' + diffColText(c));
      if (e.pk) items.push(`- PK: (${e.pk.before.join(', ')}) → (${e.pk.after.join(', ')})`);
      for (const f of e.fks) items.push(`- ${f.status === 'added' ? '+' : '\u{2212}'} FK ${f.rel.cols.join(', ')} → ${f.rel.parent.name}`);
      if (items.length) out.push(...items, '');
    }
  }
  return out.join('\n');
}

$('#diffPop').addEventListener('click', e => {
  const go = e.target.closest('li[data-go]');
  if (go) { const tb = S.byKey.get(go.dataset.go); if (tb) select(tb, { fly: true }); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.stopPropagation();
  const a = b.dataset.act;
  if (a === 'diff-version') startDiff({ mode: 'version', version: $('#dfVersion').value });
  else if (a === 'diff-files') $('#diffFile').click();
  else if (a === 'diff-folder') $('#diffFolder').click();
  else if (a === 'diff-close') { if (S.tl) stopTimeline(); else stopDiff(); }
  else if (a === 'time-open') { $('#diffPop').hidden = true; startTimeline(0); }
  else if (a === 'diff-review') openReview();
  else if (a === 'diff-md') downloadText(diffMarkdown(), fileStem() + '-' + t('diffFile') + '.md', 'text/markdown;charset=utf-8');
});

// "Önce" dosyaları: açık dosyalarla aynı okuma kuralları; açık dosyalara eklenmez
async function readBefore(list) {
  if (!list.length) return;
  const recs = [];
  for (const { path, file } of list) {
    const rec = { path, include: true };
    const c = classify(path);
    if (c.skip) rec.skipReason = c.skip;
    else if (file.size > MAX_FILE) rec.skipReason = 'tooBig';
    else rec.text = await readFileText(file);
    recs.push(rec);
  }
  const readable = recs.filter(f => f.text != null);
  const dirs = new Set(readable.map(f => f.path.split('/')[0]));
  const title = readable.length === 1 ? readable[0].path : dirs.size === 1 && readable[0].path.includes('/') ? [...dirs][0] + '/' : t('nFiles', { n: readable.length });
  startDiff({ mode: 'files', files: recs, title });
}
$('#diffFile').addEventListener('change', () => { readBefore(fromInput($('#diffFile'))); $('#diffFile').value = ''; });
$('#diffFolder').addEventListener('change', () => { readBefore(fromInput($('#diffFolder'))); $('#diffFolder').value = ''; });

/* ─── Migration zaman çizelgesi ─── */

// Her sürüm dosyası bir adım: o dosyaya kadarki model ve bir öncekine farkı (js/diff.js timeline).
// Yerleşim bütün sürümlerdeki tabloların birleşiminden bir kez kurulur; adım değişince tablolar yerinde kalır,
// yalnızca o adımda var olanlar (ve o adımda silinenler) çizilir. Kamera adımlar arasında oynamaz.
S.time = null;   // { pos }: istenen adım; rebuild bundan S.tl'yi kurar
S.tl = null;     // { tl, lay, uni, files, pos, timer }
const LAY_FIELDS = ['x', 'y', 'lx', 'ly', 'desig', 'group', 'schemaRef'];

function timelineState(files, inputs, model, migration) {
  const models = inputs.map((_, i) => (i === inputs.length - 1 ? model : buildModel(inputs.slice(0, i + 1), { dictionaries: S.dictOverride })));
  const tl = NS.timeline(models);
  const lay = layoutModel({ ...model, tables: tl.union, rels: tl.unionRels }, { grouping: resolveGrouping(S.grouping, migration) });
  for (const s of lay.schemas) { s._all = s.tables; for (const g of s.groups) g._all = g.tables; }
  const uni = new Map(tl.union.map(u => [tl.idOf.get(u), u]));
  return { tl, lay, uni, files, pos: 0, timer: null };
}

function applyStep(i) {
  const T = S.tl, { tl, lay, uni } = T;
  const keep = S.sel ? tl.idOf.get(S.sel) : null;
  T.pos = S.time.pos = Math.max(0, Math.min(tl.steps.length - 1, i));
  const st = tl.steps[T.pos];
  const gone = st.diff.tables.filter(e => e.status === 'removed').map(e => e.before);
  const tables = st.model.tables.concat(gone);
  const byId = new Map(tables.map(tb => [tl.idOf.get(tb), tb]));
  for (const tb of tables) {
    const u = uni.get(tl.idOf.get(tb));
    for (const k of LAY_FIELDS) tb[k] = u[k];
    tb._rows = null;
    tb._lw = 0;
  }
  // bölgeler birleşik yerleşimde kalır; içlerindeki tablo listeleri bu adımın tabloları
  const here = u => byId.get(tl.idOf.get(u));
  for (const s of lay.schemas) {
    s.tables = s._all.map(here).filter(Boolean);
    for (const g of s.groups) g.tables = g._all.map(here).filter(Boolean);
  }
  S.lay = lay;
  S.model = { ...st.model, tables };
  S.diffRes = st.diff;
  S.diffBefore = T.pos ? tl.steps[T.pos - 1].model : { tables: [], rels: [] };
  S.relSet = new Set(st.model.rels);
  S.order = tables.slice().sort(byDegree);
  S.sel = keep != null ? byId.get(keep) || null : null;
}

function startTimeline(pos) {
  S.diff = null;
  S.subKeys = null;
  S.pick = new Set();
  S.time = { pos };
  rebuild();
}
function stopTimeline() {
  S.time = null;
  rebuild();
}

// Adım değişimi: model ve fark değişir, yerleşim ve kamera aynı kalır
function timeGo(i) {
  if (!S.tl) return;
  applyStep(i);
  buildIndex();
  computeImpact();
  refreshEmphasis();
  renderPanel();
  renderList();
  renderDiff();
  if (!$('#namingPop').hidden) renderNaming();
  if (!$('#report').hidden) renderReport();
  renderTimeBar();
  refreshAudit();
  resetHud();
  invalidate();
}

function stopPlay() {
  if (S.tl && S.tl.timer) { clearInterval(S.tl.timer); S.tl.timer = null; }
}
function togglePlay() {
  if (!S.tl) return;
  if (S.tl.timer) { stopPlay(); renderTimeBar(); return; }
  if (S.tl.pos >= S.tl.tl.steps.length - 1) timeGo(0);
  S.tl.timer = setInterval(() => {
    if (!S.tl) return;
    if (S.tl.pos >= S.tl.tl.steps.length - 1) { stopPlay(); renderTimeBar(); return; }
    timeGo(S.tl.pos + 1);
  }, 1400);
  renderTimeBar();
}

// Çubuk bir kez kurulur, sonra yalnızca değerleri güncellenir (kaydırıcı sürüklenirken yeniden yazılmasın)
function renderTimeBar() {
  const el = $('#timeBar');
  if (!S.tl) { el.hidden = true; el.innerHTML = ''; return; }
  const n = S.tl.tl.steps.length, i = S.tl.pos;
  if (!el.firstChild) {
    el.innerHTML = `<span class="pb-title">${esc(t('tlTitle'))}</span>
      <button class="tb-btn" data-act="time-prev" title="${esc(t('tlPrev'))}" aria-label="${esc(t('tlPrev'))}">\u{2039}</button>
      <button class="tb-btn" data-act="time-play"></button>
      <button class="tb-btn" data-act="time-next" title="${esc(t('tlNext'))}" aria-label="${esc(t('tlNext'))}">\u{203A}</button>
      <input type="range" id="tbRange" min="0" max="${n - 1}" step="1" aria-label="${esc(t('tlTitle'))}">
      <span class="tb-ver"><b></b> <i></i></span>
      <span class="tb-chips"></span>
      <button class="p-close" data-act="time-close" title="${esc(t('tlClose'))}" aria-label="${esc(t('tlClose'))}">×</button>`;
  }
  el.hidden = false;
  const f = S.tl.files[i], s = S.tl.tl.steps[i].diff.summary;
  const play = el.querySelector('[data-act="time-play"]');
  play.textContent = S.tl.timer ? '\u{275A}\u{275A}' : '\u{25B6}';
  play.title = t(S.tl.timer ? 'tlPause' : 'tlPlay');
  play.setAttribute('aria-label', play.title);
  el.querySelector('[data-act="time-prev"]').disabled = i === 0;
  el.querySelector('[data-act="time-next"]').disabled = i === n - 1;
  const range = $('#tbRange');
  range.max = n - 1;
  if (document.activeElement !== range || Number(range.value) !== i) range.value = i;
  el.querySelector('.tb-ver b').textContent = fileLabel(f.path);
  el.querySelector('.tb-ver').title = f.path;
  el.querySelector('.tb-ver i').textContent = `${i + 1} / ${n}`;
  const chip = (cls, sign, v) => (v ? `<i class="${cls}">${sign}${v}</i>` : '');
  el.querySelector('.tb-chips').innerHTML = chip('d-added', '+', s.added) + chip('d-changed', '~', s.changed) + chip('d-removed', '\u{2212}', s.removed)
    || `<i class="none">${esc(t('tlNoChange'))}</i>`;
}

$('#timeBar').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !S.tl) return;
  e.stopPropagation();
  const a = b.dataset.act;
  if (a === 'time-prev') { stopPlay(); timeGo(S.tl.pos - 1); }
  else if (a === 'time-next') { stopPlay(); timeGo(S.tl.pos + 1); }
  else if (a === 'time-play') togglePlay();
  else if (a === 'time-close') stopTimeline();
});
$('#timeBar').addEventListener('input', e => {
  if (e.target.id !== 'tbRange' || !S.tl) return;
  stopPlay();
  timeGo(Number(e.target.value));
});

// Panel: seçili tablonun sürümler boyunca geçmişi; bir satıra tıklanınca o adıma gidilir
function timeHistoryHtml(tb) {
  if (!S.tl) return '';
  const { tl, files, pos } = S.tl;
  const h = NS.tableHistory(tl, tl.idOf.get(tb));
  if (!h.length) return '';
  return `<section class="tlhist"><h3>${esc(t('tlHistory'))} <span>${h.length}</span></h3>
    <ul class="df-changes">${h.map(x => `<li class="d-${x.status}${x.step === pos ? ' on' : ''}" data-step="${x.step}" tabindex="0"><b>${esc(fileLabel(files[x.step].path))}</b> ${esc(historyText(x))}</li>`).join('')}</ul></section>`;
}
function historyText(x) {
  if (x.status === 'added') return t('tlCreated');
  if (x.status === 'removed') return t('tlDropped');
  const e = x.entry, parts = [];
  if (e.renamed) parts.push(t('tlRenamed', { a: e.before.name, b: e.after.name }));
  if (e.cols.length) parts.push(t('tlCols', { n: e.cols.length }));
  if (e.pk) parts.push('PK');
  if (e.fks.length) parts.push(t('tlFks', { n: e.fks.length }));
  return parts.join(' · ');
}

/* ─── Etki analizi ─── */

// Kip açıkken seçili tabloyu izler; panelde bir kolona tıklanınca yalnızca o kolona bağlananlar (S.selCol)
const IMPACT_ACTION = { cascade: 'actCascade', setNull: 'actSetNull', setDefault: 'actSetDefault', restrict: 'actRestrict', unenforced: 'actUnenforced', embedded: 'actEmbedded' };

function computeImpact() {
  S.impactRes = S.impact && S.sel ? NS.impactOf(S.sel, { accept: relVisible, col: S.selCol }) : null;
  S.impactDepth = S.impactRes ? new Map(S.impactRes.levels.flatMap((l, i) => l.map(x => [x.t, i + 1]))) : null;
}
function setImpact(on) {
  S.impact = on;
  document.body.classList.toggle('has-impact', on);
  if (!on) S.selCol = null;
  computeImpact();
  refreshEmphasis();
  renderPanel();
  invalidate();
}

const impactSummary = res => (res.total
  ? t(res.col ? 'impactColSummary' : 'impactSummary', { n: res.total, d1: res.levels[0].length, col: res.col })
  : t(res.col ? 'impactColNone' : 'impactNone', { col: res.col }));

function impactHtml(res) {
  const target = res.root.name + (res.col ? '.' + res.col : '');
  const sum = impactSummary(res);
  const item = x => `<li data-go="${esc(x.t.key)}" tabindex="0">
    <canvas class="glyph" data-l="${x.via.parentEnd}" data-r="${x.via.childEnd}" data-s="${relStyle(x.via)}"></canvas><div class="ri">
      <div class="rn"><b>${esc(x.t.name)}</b><span class="rs">${esc(x.t.schema)}</span><span class="tag act-${x.action}">${esc(t(IMPACT_ACTION[x.action]))}</span></div>
      <div class="rc">${x.via.cols.map((c, i) => `${esc(c)} → ${esc(x.via.refCols[i] || '?')}`).join(', ')}</div></div></li>`;
  const levels = res.levels.map((l, i) => `<h4>${esc(t('impactDepth', { d: i + 1 }))} <span>${l.length}</span></h4><ul class="rels">${l.map(item).join('')}</ul>`).join('');
  const cascade = res.cascade.length ? `<h4>${esc(t('impactCascade'))} <span>${res.cascade.length}</span></h4><p class="imp-chips">${res.cascade.map(x => `<button data-go="${esc(x.t.key)}">${esc(x.t.name)}</button>`).join('')}</p>` : '';
  return `<section class="impact">
    <h3>${esc(t('impactHead'))} · ${esc(target)} <span>${res.total}</span></h3>
    <p class="imp-sum">${esc(sum)}</p>
    <p class="imp-hint">${esc(t(res.col ? 'impactColHint' : 'impactHint'))}</p>
    ${cascade}${levels}
    ${res.total ? `<button class="btn sm ghost" data-act="impact-md">${esc(t('namingMd'))}</button>` : ''}
  </section>`;
}

// Etki raporu: değişiklik öncesi ekiple paylaşmak için
function impactMarkdown(res) {
  const cell = s => String(s).replace(/\|/g, '\\|');
  const out = [`# ${t('impactHead')} · ${res.root.name}${res.col ? '.' + res.col : ''} · ${S.title || ''}`, ''];
  out.push(impactSummary(res), '');
  if (res.cascade.length) out.push(`## ${t('impactCascade')}`, '', res.cascade.map(x => '`' + x.t.name + '`').join(', '), '');
  res.levels.forEach((l, i) => {
    out.push(`## ${t('impactDepth', { d: i + 1 })}`, '', `| ${t('impactTable')} | ${t('impactColumns')} | ${t('impactAction')} |`, '|---|---|---|');
    for (const x of l) out.push(`| \`${cell((x.t.schema ? x.t.schema + '.' : '') + x.t.name)}\` | ${cell(x.via.cols.map((c, j) => c + ' → ' + (x.via.refCols[j] || '?')).join(', '))} | ${cell(t(IMPACT_ACTION[x.action]))} |`);
    out.push('');
  });
  return out.join('\n');
}

/* ─── Gezinme geçmişi ─── */

// Tarayıcı geçmişi gibi: geri gidip yeni bir tablo seçilince ileri kısmı silinir
const HISTORY_MAX = 50;
function pushHistory(tb) {
  if (S.history[S.histPos] === tb.key) return;
  S.history = S.history.slice(0, S.histPos + 1);
  S.history.push(tb.key);
  if (S.history.length > HISTORY_MAX) S.history.shift();
  S.histPos = S.history.length - 1;
}
function goHistory(pos) {
  const tb = S.byKey && S.byKey.get(S.history[pos]);
  if (!tb) return;
  S.histPos = pos;
  select(tb, { fly: true, fromHistory: true });
}

// Panel başındaki iz: geçerli tablonun çevresinde en çok 7 adım
function trailHtml() {
  if (!S.history || S.history.length < 2) return '';
  const from = Math.max(0, S.histPos - 4), to = Math.min(S.history.length, S.histPos + 3);
  const items = [];
  if (from > 0) items.push('<li class="gap">…</li>');
  for (let i = from; i < to; i++) {
    const tb = S.byKey.get(S.history[i]);
    if (!tb) continue;
    // dar panelde ad kısalır; tam ad ve şema ipucunda
    const full = (tb.schema ? tb.schema + '.' : '') + tb.name;
    items.push(`<li class="${i === S.histPos ? 'cur' : i > S.histPos ? 'fwd' : ''}"><button data-hist="${i}" title="${esc(full)}" ${i === S.histPos ? 'aria-current="true"' : ''}>${esc(tb.name)}</button></li>`);
  }
  if (to < S.history.length) items.push('<li class="gap">…</li>');
  return `<nav class="trail" aria-label="${esc(t('trailLabel'))}">
    <button class="nav" data-act="back" title="${esc(t('navBack'))}" ${S.histPos > 0 ? '' : 'disabled'}>‹</button>
    <button class="nav" data-act="fwd" title="${esc(t('navFwd'))}" ${S.histPos < S.history.length - 1 ? '' : 'disabled'}>›</button>
    <ol>${items.join('')}</ol>
  </nav>`;
}

/* ─── Detay paneli ─── */

function sentence(r) {
  const c = r.child.name, p = r.parent.name, f = r.cols[0];
  if (r.kind === 'embed') return t(r.many ? 'sEmbedMany' : 'sEmbedOne', { p, f });
  if (r.many) return t('sMany', { c, p, f });
  const a = t(r.parentEnd === 'one' ? 'sOne' : 'sZeroOne', { c, p });
  const b = t(r.childEnd === 'zeroOne' ? 's1to1' : 's1toN', { c, p });
  return (r.kind === 'implicit' ? t('guess') : '') + a + ' ' + b + (r.filter ? ' ' + t('sFilter', { p, f: r.filter }) : '');
}

function relItem(r, dir) {
  const other = dir === 'out' ? r.parent : r.child;
  const left = dir === 'out' ? r.childEnd : r.parentEnd;
  const right = dir === 'out' ? r.parentEnd : r.childEnd;
  const badges = [
    r.kind === 'implicit' ? `<span class="tag t-imp">${esc(t('tagInferred'))}</span>` : '',
    r.kind === 'ref' ? `<span class="tag t-ref" title="${esc(t('tagRefTitle'))}">${esc(t('tagRef'))}</span>` : '',
    r.kind === 'embed' ? `<span class="tag t-emb">${esc(t('tagEmbed'))}</span>` : '',
    r.label === 'ref' ? '<span class="tag">ref</span>' : '',
    r.disabled ? `<span class="tag t-off">${esc(t('tagDisabled'))}</span>` : '',
    r.onDelete ? `<span class="tag">ON DELETE ${esc(r.onDelete)}</span>` : '',
    r.self ? `<span class="tag">${esc(t('tagSelf'))}</span>` : '',
  ].join('');
  const map = r.kind === 'embed'
    ? `${esc(t('field'))}: ${esc(r.cols[0])}${r.many ? '[]' : ''}`
    : r.cols.map((c, i) => `${esc(c)} → ${esc(r.refCols[i] || '?')}`).join(', ') + (r.filter ? ` <span class="filter">(${esc(r.filter)})</span>` : '');
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

// Kolonun kod değerleri: kutucuklar ve nereden okunduğu
const VALUE_SRC = { comment: 'vsrcComment', check: 'vsrcCheck', enum: 'vsrcEnum', dict: 'vsrcDict' };
function valuesHtml(c) {
  const MAX = 40;
  const chips = c.values.slice(0, MAX).map(v => `<span class="cv"><b>${esc(v.code)}</b>${v.label ? ' ' + esc(v.label) : ''}</span>`).join('');
  const more = c.values.length > MAX ? `<span class="cv more">${esc(t('namingMore', { n: c.values.length - MAX }))}</span>` : '';
  return `<div class="cvals">${chips}${more}<i class="vsrc">${esc(t(VALUE_SRC[c.valuesSrc] || 'vsrcComment', c))}</i></div>`;
}

// "Sözlük olarak göster" düğmesi yalnızca sözlüğe benzeyen tablolarda çıkar: az kolon, çok gelen ilişki,
// kendisi pek bir yere bağlanmıyor (durum, tip, kod tabloları). Zaten sözlükse ya da elle seçildiyse her zaman.
// Ad ya da kolonlar da sözlüğü andırmalı; yalnızca "az kolon, çok gelen ilişki" CUSTOMER gibi ana tabloları da yakalar
const DICT_NAME = /(^|_)(KOD|KODU|CODE|CODES|TIP|TIPI|TYPE|TYPES|STATUS|DURUM|SOZLUK|LOOKUP|LOV|PARAM|PARAMETRE|DICT|DICTIONARY|ENUM)(_|$)/i;
const DICT_COL = /^(KOD|KODU|CODE|TIP|TYPE|KOD_TIP|TIP_ID|TYPE_ID|GRUP|GROUP)$/i;
function dictCandidate(tb) {
  if (tb.external || tb.embedded) return false;
  if (tb.dictionary || S.dictOverride.has(tb.key)) return true;
  const looks = DICT_NAME.test(tb.name) || tb.columns.some(c => DICT_COL.test(c.name));
  return looks && tb.inc.filter(r => !r.self).length >= 3 && tb.columns.length <= 8 && tb.out.filter(r => !r.self).length <= 1;
}

// Sözlük tablosunun hangi koşulla (TIP_ID = 7) hangi kolonlarca kullanıldığı
function dictUsage(tb) {
  const by = new Map();
  for (const r of tb.inc) {
    if (!r.dict || !relVisible(r)) continue;
    const k = r.filter || '';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  if (!by.size) return '';
  const n = [...by.values()].reduce((s, rs) => s + rs.length, 0);
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([f, rs]) => `<tr>
    <td class="df">${f ? esc(f) : `<i>${esc(t('dictNoFilter'))}</i>`}</td>
    <td>${rs.map(r => `<button class="dc" data-go="${esc(r.child.key)}" data-col="${esc(r.cols[0])}">${esc(r.child.name)}.${esc(r.cols[0])}</button>`).join('')}</td>
  </tr>`).join('');
  return `<section><h3>${esc(t('dictUsage'))} <span>${n}</span></h3><table class="dict"><tbody>${rows}</tbody></table></section>`;
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
    tb.dictionary ? tag('t-ref', 'tagDict') : '',
    tb.noColumns ? '<span class="tag">AS SELECT</span>' : '',
    tb.dialect ? `<span class="tag">${esc(dialectName(tb.dialect))}</span>` : '',
  ].join('');
  const rows = tb.columns.map(c => {
    const k = keyTag(tb, c);
    const hl = S.selCol && c.name.toUpperCase() === S.selCol ? ' class="hl"' : '';
    // açıklama bir değer listesiyse liste kutucuk olur, metnin geri kalanı açıklama olarak kalır
    const note = c.commentUsed ? c.valuesNote : c.comment;
    return `<tr${hl} data-col="${esc(c.name)}"><td class="ck ${k ? 'k-' + k : ''}">${k}</td><td class="cn${c.nullable ? ' nul' : ''}">${esc(c.name)}${note ? `<div class="cc">${esc(note)}</div>` : ''}${c.values ? valuesHtml(c) : ''}</td><td class="ct">${esc(String(c.type).toLowerCase())}${c.nullable ? '' : `<b title="${esc(mongo ? t('reqTitle') : 'NOT NULL')}">${mongo ? 'req' : 'nn'}</b>`}</td></tr>`;
  }).join('');
  const where = [tb.db !== 'main' ? tb.db : '', schemaLabel(tb.schemaRef)].filter(Boolean).join(' / ');
  const group = tb.external ? t('externalRef') : tb.embedded ? t('satelliteOf', { o: tb.owner ? tb.owner.name : '' }) : tb.group.loose ? t('looseStar') : tb.desig + ' ' + groupLabel(tb.group);
  const files = tb.files.map(f => baseName(f)).join(', ');
  p.innerHTML = `
    <div class="p-head" style="--c:${col}">
      <button class="p-close" data-act="close" aria-label="${esc(t('panelClose'))}">×</button>
      ${trailHtml()}
      <div class="p-eyebrow"><span class="dot"></span>${esc(where)}<span class="sep">/</span>${esc(group)}</div>
      <h2 title="${esc(tb.name)}">${esc(tb.name)}</h2>
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      ${tb.comment ? `<p class="p-comment">${esc(tb.comment)}</p>` : ''}
      ${tb.src && S.files.length > 1 ? `<p class="p-src" title="${esc(tb.files.join('\n'))}">${esc(baseName(tb.src.file))}:${tb.src.line}${tb.files.length > 1 ? ' · ' + esc(t('seenInFiles', { n: tb.files.length, list: files })) : ''}</p>` : ''}
      <div class="p-actions">
        <button class="btn sm ${S.focus ? '' : 'ghost'}" data-act="focus" title="${esc(t('focusTitle'))}">${esc(t('focus')[S.focus])}</button>
        <button class="btn sm ghost" data-act="zoom">${esc(t(mongo ? 'showFields' : 'showColumns'))}</button>
        <button class="btn sm ${S.impact ? '' : 'ghost'}" data-act="impact" title="${esc(t('impactTitle'))}">${esc(t('impactBtn'))}</button>
        <button class="btn sm ${S.pick.has(tb.key) ? '' : 'ghost'}" data-act="pick" title="${esc(t('pickTitle'))}">${esc(t(S.pick.has(tb.key) ? 'pickRemove' : 'pickAdd'))}</button>
        ${!dictCandidate(tb) ? '' : `<button class="btn sm ghost" data-act="dict" title="${esc(t('dictMarkTitle'))}">${esc(t(tb.dictionary ? 'dictUnmark' : 'dictMark'))}</button>`}
      </div>
    </div>
    <div class="p-body">
      ${diffPanelHtml(tb)}
      ${timeHistoryHtml(tb)}
      ${auditPanelHtml(tb)}
      ${S.impactRes && S.impactRes.root === tb ? impactHtml(S.impactRes) : ''}
      <section>
        <h3>${esc(t(mongo ? 'fields' : 'columns'))} <span>${tb.columns.length}</span></h3>
        <table class="cols"><tbody>${rows || `<tr><td class="empty-row">${esc(t('noColumnInfo'))}</td></tr>`}</tbody></table>
      </section>
      ${tb.dictionary ? dictUsage(tb) : ''}
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
  const hist = e.target.closest('[data-hist]');
  if (hist) { goHistory(Number(hist.dataset.hist)); return; }
  const step = e.target.closest('[data-step]');
  if (step) { stopPlay(); timeGo(Number(step.dataset.step)); return; }
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'close') select(null);
    else if (a === 'back') goHistory(S.histPos - 1);
    else if (a === 'fwd') goHistory(S.histPos + 1);
    else if (a === 'focus') { S.focus = (S.focus + 1) % 3; refreshEmphasis(); renderPanel(); invalidate(); }
    else if (a === 'dict' && S.sel) toggleDictionary(S.sel);
    else if (a === 'pick' && S.sel) togglePick(S.sel);
    else if (a === 'impact') setImpact(!S.impact);
    else if (a === 'impact-md' && S.impactRes) downloadText(impactMarkdown(S.impactRes), fileStem() + '-' + t('impactFile') + '-' + S.impactRes.root.name + '.md', 'text/markdown;charset=utf-8');
    else if (a === 'zoom' && S.sel) {
      if (!S.columns) setColumns(true);   // düğme açıkça kolonları istiyor
      flyToTable(S.sel, Math.max(1.5, S.cam.k));
    }
    return;
  }
  const go = e.target.closest('[data-go]');
  if (go) {
    const tb = S.byKey.get(go.dataset.go);
    if (tb) select(tb, { fly: true, col: go.dataset.col || null });
    return;
  }
  // etki analizinde kolona tıklamak analizi o kolona daraltır (tekrar tıklamak tabloya döner)
  const row = S.impact && e.target.closest('table.cols tr[data-col]');
  if (row) {
    const col = row.dataset.col.toUpperCase();
    S.selCol = S.selCol === col ? null : col;
    computeImpact();
    refreshEmphasis();
    renderPanel();
    invalidate();
  }
});
$('#panel').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('li[data-go], li[data-step]')) e.target.click();
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
    // kod değerlerinin anlamı da aranır: "iptal" → "İptal" değerini tutan kolon. Aksan ve İ/ı farkı yok sayılır.
    const fold = s => String(s || '').normalize('NFD').replace(/[\u{300}-\u{36F}]/gu, '').toUpperCase();
    const fv = fold(q.value.trim());
    n = 0;
    for (const tb of S.model.tables) {
      for (const c of tb.columns) {
        const hit = c.values && c.values.find(x => fold(x.label).includes(fv));
        if (hit) { hits.push({ tb, col: c.name, val: hit.code + ' = ' + hit.label }); if (++n >= 6) break; }
      }
      if (n >= 6) break;
    }
  }
  active = hits.length ? 0 : -1;
  const meta = tb => [tb.db !== 'main' ? tb.db : '', tb.schema].filter(Boolean).join(' / ');
  results.innerHTML = hits.length
    ? hits.map((h, i) => `<li data-i="${i}" class="${i === active ? 'on' : ''}" role="option">
        <span class="dot" style="--c:${schemaColor(h.tb)}"></span>
        ${h.col ? `<span class="r-col">${esc(h.col)}</span><span class="r-in">${esc(h.tb.name)}</span>` : `<span class="r-name">${esc(h.tb.name)}</span>`}
        <span class="r-meta">${esc(meta(h.tb))}${h.val ? ' · ' + esc(h.val) : h.col ? ' · ' + esc(t('column')) : ''}</span></li>`).join('')
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
    // Ctrl/Cmd + tık: tabloyu çoklu seçime ekle / çıkar (alt diyagram için)
    if ((e.ctrlKey || e.metaKey) && tb) togglePick(tb);
    else select(tb);
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
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); q.select(); return; }
  if (typing || !S.model) return;
  // Alt+← / Alt+→: gezinme geçmişi (tarayıcının "geri" kısayolunu da engeller)
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    goHistory(S.histPos + (e.key === 'ArrowLeft' ? -1 : 1));
    return;
  }
  // ↑ / ↓: paneldeki ilişkiler arasında dolaşır, Enter o tabloya gider
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.sel && !e.altKey) {
    const items = [...document.querySelectorAll('#panel li[data-go]')];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') {
    if (S.impact) setImpact(false);
    else if (S.focus) { S.focus = 0; refreshEmphasis(); renderPanel(); invalidate(); }
    else if (S.sel) select(null);
    else if (S.full) exitSubset();
    else if (S.pick.size) { S.pick = new Set(); afterPick(); }
  } else if ((e.key === ',' || e.key === '.') && S.tl) { stopPlay(); timeGo(S.tl.pos + (e.key === ',' ? -1 : 1)); }
  else if (e.key === 'f' || e.key === 'F') fitView(true);
  else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) setColumns(!S.columns);
  else if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
    setList(!S.list);
    if (S.list) listGo(S.sel ? listKeys.indexOf(S.sel.key) : 0);
  }
  else if (e.key === '+' || e.key === '=') zoomAt(S.w / 2, S.h / 2, 1.4);
  else if (e.key === '-' || e.key === '_') zoomAt(S.w / 2, S.h / 2, 1 / 1.4);
});

/* ─── Düğmeler, menüler, sürükle-bırak ─── */

const fileInput = $('#file');
const folderInput = $('#folder');
let appendNext = false;
fileInput.addEventListener('change', () => { loadEntries(fromInput(fileInput), appendNext); appendNext = false; fileInput.value = ''; });
folderInput.addEventListener('change', () => { loadEntries(fromInput(folderInput), false); folderInput.value = ''; });

const popovers = ['#sampleMenu', '#viewMenu', '#report', '#filesPop', '#namingPop', '#diffPop', '#auditPop'];
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
    case 'audit': togglePop('#auditPop'); renderAudit(); break;
    case 'diff': togglePop('#diffPop'); break;
    case 'naming-md': if (S.model) downloadText(namingMarkdown(), fileStem() + '-' + t('namingFile') + '.md', 'text/markdown;charset=utf-8'); break;
    case 'list-close': setList(false); break;
    case 'legend':
      document.body.classList.toggle('legend-closed');
      // lejant ve tablo listesi aynı kenarı paylaşır
      if (!document.body.classList.contains('legend-closed') && S.list) setList(false);
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
$('#tDictLines').addEventListener('change', e => {
  S.dictLines = e.target.checked;
  if (S.model) for (const tb of S.model.tables) tb._rows = null;
  try { localStorage.setItem('sqlschema.dictLines', S.dictLines ? '1' : '0'); } catch (err) { /* depolama kapalı */ }
  invalidate();
});

// Sözlük tablosu seçimi elle değiştirilebilir; tablo anahtarına göre tarayıcıda hatırlanır
function toggleDictionary(tb) {
  S.dictOverride.set(tb.key, !tb.dictionary);
  try { localStorage.setItem('sqlschema.dicts', JSON.stringify([...S.dictOverride])); } catch (err) { /* depolama kapalı */ }
  const key = tb.key, cam = { ...S.cam };
  rebuild();
  S.anim = null;
  S.cam = cam;
  const again = S.byKey.get(key);
  if (again) select(again);
  invalidate();
}
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
    renderList();
    renderViews();
    renderPickBar();
    renderDiff();
    $('#timeBar').innerHTML = '';
    renderTimeBar();
    renderAudit();
    if ($('#fixDlg').open) renderFix();
    if ($('#reviewDlg').open) renderReview();
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
  S.dictOverride = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem('sqlschema.dicts') || '[]');
    if (Array.isArray(saved)) S.dictOverride = new Map(saved.filter(e => Array.isArray(e) && typeof e[1] === 'boolean'));
    S.dictLines = localStorage.getItem('sqlschema.dictLines') === '1';
  } catch (err) { /* depolama kapalı */ }
  $('#tDictLines').checked = S.dictLines;
  let list = params.get('list');
  if (list !== '0' && list !== '1') { try { list = localStorage.getItem('sqlschema.list'); } catch (err) { list = null; } }
  if (list === '1') setList(true, false);
}

// Konsoldan inceleme için: sqlSchema.S.model.tables, sqlSchema.loadText(metin, 'ad.sql')
Object.assign(NS, { loadText, setFiles, rebuild, loadSample });

NS.applyI18n();
markLang();
renderSamples();
renderViews();
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
    // ?diff=V3: migration klasöründe bu sürüme kadarki hâliyle karşılaştır
    const dv = params.get('diff');
    if (dv) {
      const f = versionFiles().find(x => fileLabel(x.path) === dv || fileLabel(x.path).startsWith(dv + '__'));
      if (f) startDiff({ mode: 'version', version: f.path });
    }
    // ?time=V4: zaman çizelgesini bu sürümde açar (?time=1 baştan)
    const tv = params.get('time');
    if (tv) {
      const vers = versionFiles();
      const i = vers.findIndex(x => fileLabel(x.path) === tv || fileLabel(x.path).startsWith(tv + '__'));
      startTimeline(Math.max(0, i));
    }
    // ?sub=A,B,C&near=1: bu tablolarla (ve komşularıyla) alt diyagram
    const subNames = (params.get('sub') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (subNames.length) {
      const keys = S.model.tables.filter(x => subNames.includes(x.name.toUpperCase())).map(x => x.key);
      if (keys.length) enterSubset(keys, params.get('near') === '1');
    }
    const byName = p => { const n = (params.get(p) || '').toUpperCase(); return n && S.model.tables.find(x => x.name.toUpperCase() === n); };
    const tb = byName('select') || byName('center');
    const zoom = Number(params.get('zoom'));
    if (tb) {
      // ?center= seçmeden ortalar: vurgu ve panel olmadan bir bölgeyi göstermek için
      if (params.get('select')) select(tb);
      if (params.get('select') && params.get('impact') === '1') setImpact(true);
      const k = zoom > 0 ? zoom : Math.max(S.cam.k, 0.85);
      const offset = !$('#panel').hidden && S.w > 820 ? 190 : 0;
      S.anim = null;
      S.cam = { x: tb.x + offset / k, y: tb.y, k };
    } else if (zoom > 0) {
      S.cam.k = zoom;
    }
    // ?audit=1: denetim haritada
    if (params.get('audit') === '1') setAuditMap(true);
    const pop = { naming: '#namingPop', report: '#report', files: '#filesPop', diff: '#diffPop', audit: '#auditPop' }[params.get('pop')];
    if (pop) { togglePop(pop); if (pop === '#auditPop') renderAudit(); }
    // ?fix=1: düzeltme önerileri penceresi
    if (params.get('fix') === '1') openFix();
    // ?review=1: karşılaştırma ya da zaman çizelgesiyle birlikte değişiklik incelemesi
    if (params.get('review') === '1' && getReview()) openReview();
    invalidate();
  });
}
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
