/*
 * sqlSchema · plsql.js
 * Oracle PL/SQL kaynaklarını (paket, yordam, fonksiyon, tetikleyici) okuyup bir kod haritası çıkarır:
 * hangi yordam hangisini çağırıyor, hangi tabloyu okuyor ya da yazıyor, nerede dinamik SQL var.
 * Kod çalıştırılmaz; metin okunarak çıkarılır. Çekirdek modüldür, DOM'a dokunmaz.
 *
 *   parsePlsql(src, { file }) → { file, units, packages, cursors, stats }
 *     units: [{ key, name, kind, pkg, schema, parent, file, line, endLine, overloads, calls, uses, dynamic, on }]
 *       kind: procedure | function | trigger | init (paket gövdesinin başlatma bölümü)
 *       calls: [{ parts, line, strong, dynamic }]      parts: ['PKG', 'YORDAM'] (büyük harf)
 *       uses:  [{ parts, mode: 'r' | 'w', op, line, dynamic }]
 *       dynamic: [{ line, text, holes, via }]           text: değişken kısımlar '…'; holes: okunamayan kısım sayısı
 *       on: tetikleyicinin tablosu (parts) ve olayları
 *   buildCodeModel(results, model) → çağrıları birimlere, tablo adlarını modeldeki tablolara çözer (aşağıda)
 *
 * Bilinen sınırlar: aşırı yüklenmiş yordamlar adla eşleşir (tek düğüm); değişkenden gelen tablo ya da yordam adı
 * okunamaz, yalnızca sayılır; nesne tipleri (TYPE BODY) ve Java yordamları okunmaz.
 */
(function (NS) {
'use strict';

const { tokenize, splitStatements } = NS;

const MODIFIERS = new Set(['OR', 'REPLACE', 'EDITIONABLE', 'NONEDITIONABLE', 'EDITIONING', 'NOFORCE', 'FORCE']);
// Çağrı sayılmayacak kelimeler: PL/SQL ve SQL anahtar kelimeleri, sık yerleşik işlevler
const KEYWORDS = new Set(('IF THEN ELSE ELSIF END LOOP WHILE FOR IN OUT NOCOPY BEGIN DECLARE EXCEPTION WHEN OTHERS RAISE RETURN ' +
  'NULL TRUE FALSE AND OR NOT IS AS OF ON BY TO INTO FROM WHERE SELECT INSERT UPDATE DELETE MERGE SET VALUES USING ' +
  'COMMIT ROLLBACK SAVEPOINT EXIT CONTINUE GOTO OPEN CLOSE FETCH BULK COLLECT LIMIT FORALL EXECUTE IMMEDIATE CASE ' +
  'DISTINCT ALL ANY SOME BETWEEN LIKE ESCAPE GROUP ORDER HAVING UNION MINUS INTERSECT JOIN INNER OUTER LEFT RIGHT FULL ' +
  'CROSS NATURAL WITH CONNECT START PRIOR LEVEL ROWNUM ROWID SYSDATE SYSTIMESTAMP USER DUAL CURSOR TYPE SUBTYPE ' +
  'RECORD TABLE INDEX VARRAY REF PRAGMA AUTONOMOUS_TRANSACTION EXCEPTION_INIT CONSTANT DEFAULT NEW OLD PARENT ' +
  'NUMBER VARCHAR2 VARCHAR CHAR DATE TIMESTAMP CLOB BLOB BOOLEAN INTEGER PLS_INTEGER BINARY_INTEGER RAW LONG ' +
  'NVL NVL2 DECODE COALESCE TO_CHAR TO_DATE TO_NUMBER TRUNC ROUND SUBSTR INSTR LENGTH UPPER LOWER TRIM LTRIM RTRIM ' +
  'REPLACE LPAD RPAD COUNT SUM MIN MAX AVG ADD_MONTHS LAST_DAY MONTHS_BETWEEN GREATEST LEAST ABS MOD CEIL FLOOR ' +
  'SQLERRM SQLCODE RAISE_APPLICATION_ERROR CHR ASCII CAST EXTRACT REGEXP_LIKE REGEXP_SUBSTR REGEXP_REPLACE ' +
  'LISTAGG ROW_NUMBER RANK DENSE_RANK OVER PARTITION LAG LEAD SYS_GUID SYS_CONTEXT NEXTVAL CURRVAL EXISTS ' +
  'RETURNING ANALYZE TRUNCATE ALTER DROP CREATE GRANT REVOKE').split(' '));
// Oracle'ın kendi paketleri: dış çağrı olarak ayrı (soluk) gösterilir
const ORACLE_PKG = /^(DBMS_|UTL_|OWA_|HTP$|HTF$|APEX_|CTX_|SYS$|STANDARD$|DBMS$)/;
const HOLE = '__DIN__';
const COLLECTION = new Set(['DELETE', 'EXISTS', 'COUNT', 'FIRST', 'LAST', 'NEXT', 'PRIOR', 'EXTEND', 'TRIM', 'LIMIT']);

const isName = t => !!t && (t.t === 'w' || t.t === 'q');
const up = t => (t.t === 'q' ? t.v.toUpperCase() : t.u);
const isP = (t, v) => !!t && t.t === 'p' && t.v === v;
const isW = (t, ...ws) => !!t && t.t === 'w' && ws.includes(t.u);

// a.b.c adı; @dblink atlanır
function readName(toks, i) {
  const parts = [];
  while (isName(toks[i])) {
    parts.push(up(toks[i]));
    i++;
    if (isP(toks[i], '.') && isName(toks[i + 1])) { i++; continue; }
    break;
  }
  if (isP(toks[i], '@') && isName(toks[i + 1])) i += 2;
  return { parts, next: i };
}

// açılış parantezinden eşleşen kapanışın arkasına
function skipParens(toks, i) {
  let d = 0;
  for (; i < toks.length; i++) {
    if (isP(toks[i], '(')) d++;
    else if (isP(toks[i], ')') && --d === 0) return i + 1;
  }
  return i;
}

/* ─── Birim gövdesinin çözümlemesi ─── */

// i, adı verilen işlevlerden birinin parantezi içinde mi (en yakın açık parantez, birkaç token geride)
function insideCall(toks, i, names) {
  let d = 0;
  for (let k = i - 1; k >= 0 && k > i - 12; k--) {
    if (isP(toks[k], ')')) d++;
    else if (isP(toks[k], '(')) { if (d === 0) return isW(toks[k - 1], ...names); d--; }
  }
  return false;
}

const STOP_FROM = new Set(['WHERE', 'GROUP', 'ORDER', 'CONNECT', 'START', 'HAVING', 'UNION', 'MINUS', 'INTERSECT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'ON', 'USING', 'INTO', 'FOR', 'WHEN', 'THEN', 'SET', 'VALUES', 'RETURNING', 'MODEL', 'PIVOT', 'UNPIVOT', 'SAMPLE', 'LOOP', 'BULK', 'LIMIT', 'OFFSET', 'FETCH', 'WINDOW']);

// SQL parçasındaki tablo kullanımları; tokens doğrusal taranır (alt sorguların FROM'u da sırası gelince okunur)
function tableUses(toks, ctes, dynamic) {
  const out = [];
  const add = (parts, mode, op, line) => {
    if (!parts.length) return;
    const last = parts[parts.length - 1];
    if (last === 'DUAL' || (parts.length === 1 && ctes.has(last))) return;
    out.push({ parts, mode, op, line, dynamic: !!dynamic });
  };
  const target = (i, mode, op) => {
    if (isW(toks[i], 'TABLE') && isP(toks[i + 1], '(')) return i;   // TABLE(koleksiyon)
    if (!isName(toks[i]) || (toks[i].t === 'w' && KEYWORDS.has(toks[i].u) && toks[i].u !== HOLE)) return i;
    const r = readName(toks, i);
    add(r.parts, mode, op, toks[i].line);
    return r.next;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'w') continue;
    const prev = toks[i - 1];
    if (t.u === 'WITH' && isName(toks[i + 1]) && isW(toks[i + 2], 'AS')) { ctes.add(up(toks[i + 1])); continue; }
    if (isP(prev, ',') && isName(t) && isW(toks[i + 1], 'AS') && isP(toks[i + 2], '(')) { ctes.add(up(t)); continue; }
    if (t.u === 'INSERT' && isW(toks[i + 1], 'INTO')) { i = target(i + 2, 'w', 'INSERT') - 1; continue; }
    // INSERT ALL / FIRST INTO a ... INTO b ... SELECT
    if (t.u === 'INSERT' && isW(toks[i + 1], 'ALL', 'FIRST')) {
      let j = i + 2;
      for (; j < toks.length && !isW(toks[j], 'SELECT') && !isP(toks[j], ';'); j++) if (isW(toks[j], 'INTO')) j = target(j + 1, 'w', 'INSERT') - 1;
      i = j - 1;
      continue;
    }
    if (t.u === 'UPDATE' && !isW(prev, 'FOR') && !isW(prev, 'BEFORE', 'AFTER', 'OR')) { i = target(i + 1, 'w', 'UPDATE') - 1; continue; }
    if (t.u === 'DELETE' && !isW(prev, 'ON', 'BEFORE', 'AFTER', 'OR')) { i = target(isW(toks[i + 1], 'FROM') ? i + 2 : i + 1, 'w', 'DELETE') - 1; continue; }
    if (t.u === 'MERGE' && isW(toks[i + 1], 'INTO')) { i = target(i + 2, 'w', 'MERGE') - 1; continue; }
    if (t.u === 'USING' && toks.slice(Math.max(0, i - 30), i).some(x => isW(x, 'MERGE'))) { i = target(i + 1, 'r', 'MERGE') - 1; continue; }
    if (t.u === 'TRUNCATE' && isW(toks[i + 1], 'TABLE')) { i = target(i + 2, 'w', 'TRUNCATE') - 1; continue; }
    if (t.u === 'JOIN') { i = target(i + 1, 'r', 'SELECT') - 1; continue; }
    // EXTRACT(YEAR FROM d), TRIM(' ' FROM x): FROM tablo değil
    if (t.u === 'FROM' && insideCall(toks, i, ['EXTRACT', 'TRIM', 'SUBSTRING', 'OVERLAY'])) continue;
    if (t.u === 'FROM' && !isW(prev, 'DELETE')) {
      // FROM a x, b y, (alt sorgu) z
      let j = i + 1;
      for (;;) {
        // alt sorgu: içi doğrusal taramada okunur, burada durulur
        if (isP(toks[j], '(')) break;
        else if (isName(toks[j]) && !(toks[j].t === 'w' && STOP_FROM.has(toks[j].u))) j = target(j, 'r', 'SELECT');
        else break;
        // takma ad
        if (isW(toks[j], 'AS')) j++;
        if (isName(toks[j]) && !(toks[j].t === 'w' && (STOP_FROM.has(toks[j].u) || KEYWORDS.has(toks[j].u)))) j++;
        if (isP(toks[j], ',')) { j++; continue; }
        break;
      }
      i = j - 1;
    }
  }
  return out;
}

// Çağrı adayları: a(...), a;, pkg.a(...), şema.pkg.a ...; çözümleme buildCodeModel'de
function callSites(toks, dynamic) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!isName(t)) continue;
    const prev = toks[i - 1];
    if (isP(prev, '.') || isP(prev, ':') || isP(prev, '%')) continue;
    // INSERT INTO t (kolonlar): tablo, çağrı değil
    if (isW(prev, 'INTO', 'FROM', 'JOIN', 'UPDATE', 'TABLE', 'USING', 'DELETE')) { i = readName(toks, i).next - 1; continue; }
    if (t.t === 'w' && KEYWORDS.has(t.u) && !isP(toks[i + 1], '.')) continue;
    const r = readName(toks, i);
    if (r.parts.length > 3 || (r.parts.length === 1 && t.t === 'w' && KEYWORDS.has(t.u))) { i = r.next - 1; continue; }
    // koleksiyon yöntemleri: G_LISTE.DELETE, V_TAB.EXISTS(i)
    if (r.parts.length === 2 && COLLECTION.has(r.parts[1])) { i = r.next - 1; continue; }
    const nx = toks[r.next];
    // atama hedefi ve %TYPE / %ROWTYPE çağrı değil
    if (isP(nx, ':') && isP(toks[r.next + 1], '=')) { i = r.next - 1; continue; }
    if (isP(nx, '%')) { i = r.next - 1; continue; }
    if (r.parts.some(p => p === HOLE)) { out.push({ parts: r.parts, line: t.line, strong: false, dynamic: true, hole: true }); i = r.next - 1; continue; }
    // güçlü aday: parantezli çağrı ya da kendi başına bir deyim (LOG_PKG.TEMIZLE;); x := r.alan; kayıt alanıdır
    const stmtStart = !prev || isP(prev, ';') || isW(prev, 'BEGIN', 'THEN', 'ELSE', 'LOOP', 'DECLARE', 'EXCEPTION') || (isP(prev, '>') && isP(toks[i - 2], '>'));
    const strong = isP(nx, '(') || (stmtStart && isP(nx, ';'));
    out.push({ parts: r.parts, line: t.line, strong, dynamic: !!dynamic });
    i = r.next - 1;
  }
  return out;
}

// Dinamik SQL metnini kurar: dize parçaları ve değişkenlerin bilinen değerleri; bilinmeyen kısım HOLE
function evalExpr(toks, env) {
  let text = '', holes = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // gruplama parantezleri saydam; işlev argümanlarını ad dalı atlar
    if (isP(t, '(') || isP(t, ')')) continue;
    if (isP(t, '|') && isP(toks[i + 1], '|')) { i++; continue; }
    if (t.t === 's') { text += t.v; continue; }
    if (isName(t)) {
      const r = readName(toks, i);
      const key = r.parts.join('.');
      // UPPER(x), CHR(10) gibi işlev çağrıları ve bilinmeyen değişkenler okunamaz
      if (!isP(toks[r.next], '(') && env.has(key)) { const v = env.get(key); text += v.text; holes += v.holes; }
      // boşluksuz: 'FROM CDR_' || v_gun → CDR___DIN__ tek ad kalır, okunamayan tablo olarak görünür
      else { text += HOLE; holes++; }
      i = r.next - 1;
      if (isP(toks[r.next], '(')) i = skipParens(toks, r.next) - 1;
      continue;
    }
  }
  return { text, holes };
}

// Değişken kısımları '…' ile yazılmış görünen metin
const showText = s => s.split(HOLE).join('\u{2026}').replace(/\s+/g, ' ').trim();

function analyzeUnit(unit, toks, pkgCursors) {
  const ctes = new Set();
  unit.uses.push(...tableUses(toks, ctes, false));
  unit.calls.push(...callSites(toks, false));
  // paket düzeyindeki imleçler: imleci kullanan yordam onun tablolarını okur
  if (pkgCursors && pkgCursors.size) {
    for (const t of toks) if (isName(t) && pkgCursors.has(up(t))) for (const u of pkgCursors.get(up(t))) unit.uses.push({ ...u, line: t.line, op: 'CURSOR' });
  }
  // değişken değerleri sırayla izlenir: v_sql := '...' || v_tablo || '...';
  const env = new Map();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // v := ...; ya da bildirimde ilk değer: v VARCHAR2(2000) := ...;
    if (isName(t) && !isP(toks[i - 1], '.') && (isP(toks[i + 1], ':') || !toks[i - 1] || isP(toks[i - 1], ';') || isW(toks[i - 1], 'IS', 'AS', 'DECLARE', 'BEGIN', 'THEN', 'ELSE', 'LOOP'))) {
      let j = i + 1, d = 0, at = -1;
      for (; j < toks.length && !isP(toks[j], ';'); j++) {
        if (isP(toks[j], '(')) d++;
        else if (isP(toks[j], ')')) d--;
        else if (d === 0 && at < 0 && isP(toks[j], ':') && isP(toks[j + 1], '=')) at = j;
      }
      // yalnızca ad := ... ya da ad TİP := ... (tip kelimelerinden ve parantezden oluşur)
      const between = at > 0 ? toks.slice(i + 1, at) : null;
      if (between && between.every(x => x.t === 'w' || x.t === 'n' || isP(x, '(') || isP(x, ')') || isP(x, ',') || isP(x, '.') || isP(x, '%'))) {
        env.set(up(t), evalExpr(toks.slice(at + 2, j), env));
        continue;
      }
    }
    let exprStart = -1, via = null;
    if (isW(t, 'EXECUTE') && isW(toks[i + 1], 'IMMEDIATE')) { exprStart = i + 2; via = 'EXECUTE IMMEDIATE'; }
    else if (isW(t, 'OPEN') && isName(toks[i + 1]) && isW(toks[i + 2], 'FOR') && !isW(toks[i + 3], 'SELECT', 'WITH')) { exprStart = i + 3; via = 'OPEN FOR'; }
    else if (isName(t) && up(t) === 'DBMS_SQL' && isP(toks[i + 1], '.') && isW(toks[i + 2], 'PARSE') && isP(toks[i + 3], '(')) {
      // DBMS_SQL.PARSE(imleç, metin, ...): ikinci argüman
      let j = i + 4, d = 0;
      while (j < toks.length && !(d === 0 && isP(toks[j], ','))) { if (isP(toks[j], '(')) d++; if (isP(toks[j], ')')) d--; j++; }
      exprStart = j + 1;
      via = 'DBMS_SQL';
    }
    if (exprStart < 0) continue;
    let j = exprStart, d = 0;
    while (j < toks.length && !(d === 0 && (isP(toks[j], ';') || isW(toks[j], 'USING', 'INTO', 'RETURNING', 'BULK') || (via === 'DBMS_SQL' && isP(toks[j], ','))))) {
      if (isP(toks[j], '(')) d++;
      if (isP(toks[j], ')')) { if (d === 0) break; d--; }
      j++;
    }
    const v = evalExpr(toks.slice(exprStart, j), env);
    const site = { line: t.line, text: showText(v.text) || '\u{2026}', holes: v.holes, via, tables: 0, unresolved: 0 };
    // metin olarak kurulan SQL: tablolar ve (BEGIN ... END; bloklarında) çağrılar
    const dt = tokenize(v.text);
    const uses = tableUses(dt, new Set(), true);
    for (const u of uses) {
      if (u.parts.some(p => p.includes(HOLE))) { site.unresolved++; u.pattern = showText(u.parts.join('.')); }
      else site.tables++;
      u.line = t.line;
    }
    unit.uses.push(...uses.filter(u => !u.pattern));
    if (uses.some(u => u.pattern)) site.patterns = uses.filter(u => u.pattern).map(u => ({ pattern: u.pattern, mode: u.mode, op: u.op }));
    if (/^\s*(BEGIN|DECLARE|CALL)\b/i.test(v.text)) {
      const cs = callSites(dt, true).map(c => ({ ...c, line: t.line }));
      unit.calls.push(...cs.filter(c => !c.hole));
      site.unresolved += cs.filter(c => c.hole).length;
    }
    // hiçbir şey okunamadıysa (metin tamamen değişkenden) bu da okunamayan bir yer
    if (!v.text.replace(new RegExp(HOLE, 'g'), '').trim()) site.unresolved = Math.max(1, site.unresolved);
    unit.dynamic.push(site);
    i = j;
  }
}

/* ─── Bloklar: paket gövdesi ve yordamlar ─── */

function newUnit(name, kind, pkg, schema, parent, file, line) {
  return { key: null, name, kind, pkg, schema, parent, file, line, endLine: line, overloads: 1, calls: [], uses: [], dynamic: [], toks: [] };
}

// PROCEDURE / FUNCTION başlığı: tanım mı (IS / AS) yoksa yalnızca bildirim mi (;)?
function header(toks, i) {
  let j = i + 2, d = 0;
  for (; j < toks.length; j++) {
    if (isP(toks[j], '(')) d++;
    else if (isP(toks[j], ')')) d--;
    else if (d === 0 && isP(toks[j], ';')) return { def: false, next: j + 1 };
    else if (d === 0 && isW(toks[j], 'IS', 'AS')) {
      // IS LANGUAGE JAVA / C, EXTERNAL: gövdesiz
      if (isW(toks[j + 1], 'LANGUAGE', 'EXTERNAL')) { while (j < toks.length && !isP(toks[j], ';')) j++; return { def: false, next: j + 1 }; }
      return { def: true, next: j + 1 };
    }
  }
  return { def: false, next: j };
}

// Gövde tokenlarını birimlere dağıtır; iç içe yordamlar kendi birimini alır
function scanBody(toks, start, pkg, schema, file, units, root) {
  const stack = root ? [root] : [];
  let depth = 0;
  const pkgToks = [];   // paket düzeyi (bildirimler, imleçler)
  for (let k = start; k < toks.length; k++) {
    const t = toks[k];
    const top = stack[stack.length - 1];
    if (isW(t, 'PROCEDURE', 'FUNCTION') && isName(toks[k + 1]) && !(top && top.inBegin)) {
      const h = header(toks, k);
      if (h.def) {
        const u = newUnit(up(toks[k + 1]), t.u === 'PROCEDURE' ? 'procedure' : 'function', pkg, schema, top || null, file, t.line);
        u.beginDepth = null;
        units.push(u);
        stack.push(u);
      }
      k = h.next - 1;
      continue;
    }
    if (isW(t, 'BEGIN')) {
      if (!top && pkg) {
        // paket gövdesinin başlatma bölümü
        const u = newUnit('<init>', 'init', pkg, schema, null, file, t.line);
        u.beginDepth = depth;
        u.inBegin = true;
        units.push(u);
        stack.push(u);
        depth++;
        continue;
      }
      if (top && top.beginDepth === null) { top.beginDepth = depth; top.inBegin = true; }
      depth++;
      if (top) top.toks.push(t);
      continue;
    }
    if (isW(t, 'CASE')) { depth++; if (top) top.toks.push(t); continue; }
    if (isW(t, 'END')) {
      if (isW(toks[k + 1], 'IF', 'LOOP')) { if (top) top.toks.push(t, toks[k + 1]); k++; continue; }
      if (isW(toks[k + 1], 'CASE')) { if (top) top.toks.push(t, toks[k + 1]); k++; }
      depth--;
      if (top && top.beginDepth !== null && depth === top.beginDepth) {
        top.endLine = t.line;
        stack.pop();
        // END ad;
        let j = k + 1;
        if (isName(toks[j]) && !isW(toks[j], 'IF', 'LOOP', 'CASE')) j++;
        if (isP(toks[j], ';')) j++;
        k = j - 1;
        continue;
      }
      if (top) top.toks.push(t);
      continue;
    }
    if (top) top.toks.push(t);
    else pkgToks.push(t);
  }
  // kapanmadan biten birimler (kesik dosya) kalan her şeyi alır
  for (const u of stack) u.endLine = u.endLine || u.line;
  return pkgToks;
}

// Paket düzeyindeki imleçler: CURSOR c_ad [(parametre)] IS SELECT ...;
function packageCursors(toks) {
  const map = new Map();
  for (let i = 0; i < toks.length; i++) {
    if (!isW(toks[i], 'CURSOR') || !isName(toks[i + 1])) continue;
    const name = up(toks[i + 1]);
    let j = i + 2;
    if (isP(toks[j], '(')) j = skipParens(toks, j);
    if (isW(toks[j], 'RETURN')) { while (j < toks.length && !isW(toks[j], 'IS') && !isP(toks[j], ';')) j++; }
    if (!isW(toks[j], 'IS')) continue;
    let e = j + 1;
    while (e < toks.length && !isP(toks[e], ';')) e++;
    map.set(name, tableUses(toks.slice(j + 1, e), new Set(), false));
    i = e;
  }
  return map;
}

/* ─── Dosya ─── */

function looksLikePlsql(src) {
  return /\bCREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(PACKAGE|PROCEDURE|FUNCTION|TRIGGER)\b/i.test(src);
}

function parsePlsql(src, opts = {}) {
  const file = opts.file || '';
  const units = [], packages = [];
  const stats = { units: 0, packages: 0, calls: 0, uses: 0, dynamic: 0, unresolved: 0, errors: [] };
  try {
    for (const st of splitStatements(tokenize(src))) {
      let i = 0;
      while (isP(st[i], '(')) i++;
      if (!isW(st[i], 'CREATE')) continue;
      i++;
      while (isW(st[i], ...MODIFIERS)) i++;
      const kind = st[i] && st[i].u;
      if (kind === 'PACKAGE') {
        const body = isW(st[i + 1], 'BODY');
        const nm = readName(st, i + (body ? 2 : 1));
        const name = nm.parts[nm.parts.length - 1], schema = nm.parts.length > 1 ? nm.parts[0] : null;
        let j = nm.next;
        while (j < st.length && !isW(st[j], 'IS', 'AS')) j++;
        const pkg = { name, schema, file, line: st[i].line, body, decl: [] };
        if (!body) {
          // belirtim: dışa açık yordam ve fonksiyonlar
          for (let k = j; k < st.length; k++) if (isW(st[k], 'PROCEDURE', 'FUNCTION') && isName(st[k + 1])) pkg.decl.push({ name: up(st[k + 1]), kind: st[k].u === 'PROCEDURE' ? 'procedure' : 'function', line: st[k].line });
        } else {
          const own = [];
          const pkgToks = scanBody(st, j + 1, name, schema, file, own, null);
          const cursors = packageCursors(pkgToks);
          for (const u of own) analyzeUnit(u, u.toks, cursors);
          pkg.cursors = [...cursors.keys()];
          units.push(...own);
        }
        packages.push(pkg);
        continue;
      }
      if (kind === 'PROCEDURE' || kind === 'FUNCTION') {
        const nm = readName(st, i + 1);
        const u = newUnit(nm.parts[nm.parts.length - 1], kind === 'PROCEDURE' ? 'procedure' : 'function', null, nm.parts.length > 1 ? nm.parts[0] : null, null, file, st[i].line);
        const h = header(st, i);
        if (!h.def) continue;
        u.beginDepth = null;
        const own = [u];
        scanBody(st, h.next, null, u.schema, file, own, u);
        for (const x of own) analyzeUnit(x, x.toks, null);
        units.push(...own);
        continue;
      }
      if (kind === 'TRIGGER') {
        const nm = readName(st, i + 1);
        const u = newUnit(nm.parts[nm.parts.length - 1], 'trigger', null, nm.parts.length > 1 ? nm.parts[0] : null, null, file, st[i].line);
        // BEFORE INSERT OR UPDATE OF X ON tablo ... gövde DECLARE / BEGIN / COMPOUND TRIGGER ile başlar
        let j = nm.next;
        const events = [];
        while (j < st.length && !isW(st[j], 'DECLARE', 'BEGIN', 'COMPOUND', 'CALL')) {
          if (isW(st[j], 'INSERT', 'UPDATE', 'DELETE')) events.push(st[j].u);
          if (isW(st[j], 'ON') && isName(st[j + 1]) && !isW(st[j + 1], 'DATABASE', 'SCHEMA')) u.on = { parts: readName(st, j + 1).parts, events };
          j++;
        }
        u.timing = st.slice(nm.next, j).find(x => isW(x, 'BEFORE', 'AFTER', 'INSTEAD'));
        u.timing = u.timing ? u.timing.u : null;
        u.endLine = st[st.length - 1].line;
        analyzeUnit(u, st.slice(j), null);
        units.push(u);
      }
    }
  } catch (err) {
    stats.errors.push({ file, line: 0, message: String(err && err.message || err) });
  }
  // aynı paketteki aynı adlı yordamlar (aşırı yükleme) tek birim
  const merged = [];
  const byKey = new Map();
  for (const u of units) {
    // anahtar: şema.paket.dış_yordam.iç_yordam (iç içe yordamlar üst yordamın yolunu taşır)
    u.path = u.parent ? u.parent.path + '.' + u.name : u.name;
    u.key = [u.schema || '', u.pkg || '', u.path].join('.');
    delete u.toks;
    delete u.beginDepth;
    delete u.inBegin;
    const prev = byKey.get(u.key);
    if (prev) {
      prev.overloads++;
      prev.calls.push(...u.calls);
      prev.uses.push(...u.uses);
      prev.dynamic.push(...u.dynamic);
      prev.endLine = Math.max(prev.endLine, u.endLine);
      for (const x of units) if (x.parent === u) x.parent = prev;
      continue;
    }
    byKey.set(u.key, u);
    merged.push(u);
  }
  for (const u of merged) {
    stats.calls += u.calls.filter(c => c.strong).length;
    stats.uses += u.uses.length;
    stats.dynamic += u.dynamic.length;
    stats.unresolved += u.dynamic.reduce((s, d) => s + d.unresolved, 0);
  }
  stats.units = merged.length;
  stats.packages = new Set(packages.map(p => p.name)).size;
  return { file, units: merged, packages, stats };
}

/*
 * Kod modeli: dosyaların birimleri birleştirilir, çağrılar birimlere, tablo adları tablo modeline çözülür.
 *   buildCodeModel(results, model?) → {
 *     units, packages: Map(ad → { name, schema, units, public: Set, spec, body }),
 *     calls: [{ from, to, line, dynamic }]   to: birim ya da dış düğüm { external: true, name, oracle }
 *     uses:  [{ unit, table, name, mode, op, line, dynamic }]   table: modeldeki tablo ya da null (görünüm, başka şema)
 *     externals: Map(ad → dış düğüm), byTable: Map(tablo → uses), callers: Map(birim → calls)
 *   }
 */
function buildCodeModel(results, model) {
  const units = results.flatMap(r => r.units);
  const packages = new Map();
  for (const r of results) {
    for (const p of r.packages) {
      if (!packages.has(p.name)) packages.set(p.name, { name: p.name, schema: p.schema, units: [], public: new Set(), spec: null, body: null });
      const P = packages.get(p.name);
      if (p.body) P.body = p; else { P.spec = p; for (const d of p.decl) P.public.add(d.name); }
    }
  }
  // gövdesi dökümde olmayan paket (başka ekibin, dışa aktarılmamış): belirtimdeki yordamlar gövdesiz birim olur
  for (const P of packages.values()) {
    if (!P.spec || P.body) continue;
    const seen = new Set();
    for (const d of P.spec.decl) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      units.push({ key: [P.schema || '', P.name, d.name].join('.'), name: d.name, path: d.name, kind: d.kind, pkg: P.name, schema: P.schema, parent: null, file: P.spec.file, line: d.line, endLine: d.line, overloads: 1, calls: [], uses: [], dynamic: [], noBody: true });
    }
  }
  const byPkg = new Map();     // PAKET → Map(AD → birim)  (paket düzeyi)
  const standalone = new Map();
  for (const u of units) {
    if (u.pkg) {
      if (!packages.has(u.pkg)) packages.set(u.pkg, { name: u.pkg, schema: u.schema, units: [], public: new Set(), spec: null, body: null });
      packages.get(u.pkg).units.push(u);
      if (!u.parent) {
        if (!byPkg.has(u.pkg)) byPkg.set(u.pkg, new Map());
        byPkg.get(u.pkg).set(u.name, u);
      }
    } else if (!u.parent && u.kind !== 'trigger') {
      if (!standalone.has(u.name)) standalone.set(u.name, []);
      standalone.get(u.name).push(u);
    }
  }
  for (const u of units) u.public = !!(u.pkg && !u.parent && packages.get(u.pkg).public.has(u.name));

  const externals = new Map();
  const ext = (name, oracle) => {
    if (!externals.has(name)) externals.set(name, { external: true, name, oracle, key: 'ext:' + name });
    return externals.get(name);
  };
  // 1 parçalı ad: iç içe yordamlar (yukarı doğru), paket düzeyi, tek başına yordamlar
  const local = (u, n) => {
    for (let p = u; p; p = p.parent) {
      const child = units.find(x => x.parent === p && x.name === n);
      if (child) return child;
      if (p.name === n && p.parent) return p;
    }
    if (u.pkg && byPkg.has(u.pkg) && byPkg.get(u.pkg).has(n)) return byPkg.get(u.pkg).get(n);
    const s = standalone.get(n);
    return s ? s.find(x => x.schema === u.schema) || s[0] : null;
  };
  const resolve = (u, parts) => {
    const n = parts.length;
    if (n === 1) return local(u, parts[0]);
    const [a, b] = parts.length === 3 ? [parts[1], parts[2]] : parts;
    if (byPkg.has(a) && byPkg.get(a).has(b)) return byPkg.get(a).get(b);
    if (n === 2 && standalone.has(b)) { const s = standalone.get(b).find(x => x.schema === a); if (s) return s; }
    return null;
  };

  const calls = [];
  for (const u of units) {
    const seen = new Set();
    for (const c of u.calls) {
      let to = resolve(u, c.parts);
      if (!to) {
        if (c.parts.length < 2 || !c.strong) continue;
        const pkgName = c.parts.length === 3 ? c.parts[1] : c.parts[0];
        const name = (c.parts.length === 3 ? c.parts.slice(1) : c.parts).join('.');
        // a.b: kayıt alanı ya da tablo kolonu olabilir; yalnızca paket gibi duranlar (parantezli çağrı) dış sayılır
        to = ext(name, ORACLE_PKG.test(pkgName) || c.parts[0] === 'SYS');
      }
      if (to === u) { u.recursive = true; continue; }
      const k = to.key + '|' + (c.dynamic ? 'd' : '');
      if (seen.has(k)) continue;
      seen.add(k);
      calls.push({ from: u, to, line: c.line, dynamic: !!c.dynamic });
    }
  }
  // Tablo adları: modeldeki tabloya (şemalı ya da şemasız); bulunamayan görünüm, eşanlamlı ya da başka şema olabilir
  const tables = model ? model.tables.filter(t => !t.external) : [];
  const byName = new Map();
  for (const t of tables) {
    const n = String(t.name).toUpperCase();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(t);
  }
  const findTable = (u, parts) => {
    const n = parts[parts.length - 1], s = parts.length > 1 ? parts[parts.length - 2] : null;
    const c = byName.get(n) || [];
    if (!c.length) return null;
    if (s) return c.find(t => String(t.schema || '').toUpperCase() === s) || null;
    return c.find(t => String(t.schema || '').toUpperCase() === (u.schema || '')) || (c.length === 1 ? c[0] : null);
  };
  const uses = [];
  const byTable = new Map();
  for (const u of units) {
    const seen = new Set();
    for (const x of u.uses) {
      const table = findTable(u, x.parts);
      const k = (table ? table.key : x.parts.join('.')) + '|' + x.mode + '|' + (x.dynamic ? 'd' : '');
      if (seen.has(k)) continue;
      seen.add(k);
      const use = { unit: u, table, name: x.parts.join('.'), mode: x.mode, op: x.op, line: x.line, dynamic: !!x.dynamic };
      uses.push(use);
      if (table) { if (!byTable.has(table)) byTable.set(table, []); byTable.get(table).push(use); }
    }
    if (u.on) u.onTable = findTable(u, u.on.parts);
  }
  const callers = new Map();
  for (const c of calls) { if (!callers.has(c.to)) callers.set(c.to, []); callers.get(c.to).push(c); }
  return { units, packages, calls, uses, externals, byTable, callers };
}

Object.assign(NS, { parsePlsql, looksLikePlsql, buildCodeModel });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
