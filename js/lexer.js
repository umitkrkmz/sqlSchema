/*
 * sqlSchema · lexer.js
 * SQL metnini parçalara (token) ayırır, ifadelere böler ve dosyanın lehçesini tahmin eder.
 *
 * token: { t, v, u?, line }
 *   t = 'w' kelime | 'q' tırnaklı tanımlayıcı | 's' metin | 'n' sayı | 'p' noktalama | 'd' ayraç (/, GO, DELIMITER)
 */
(function (NS) {
'use strict';

const DIALECTS = {
  oracle: 'Oracle',
  tsql: 'SQL Server',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  cassandra: 'Cassandra',
  mongodb: 'MongoDB',
  sql: 'SQL',
};

// İfade başında, satırın tamamını kaplayan SQL*Plus / istemci komutları
const CLIENT_CMD = /^(PROMPT|REM|REMARK|SET|SPOOL|WHENEVER|CONNECT|CONN|DEFINE|UNDEFINE|SHOW|EXIT|QUIT|PAUSE|ACCEPT|VARIABLE|VAR|COLUMN|TTITLE|BTITLE|BREAK|CLEAR|HOST)\b/i;
const WORD_RE = /[A-Za-z_\xC0-\u{FFFF}][\w$#\xC0-\u{FFFF}]*/yu;
const NUM_RE = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
const DOLLAR_RE = /\$([A-Za-z_]\w*)?\$/y;
const Q_CLOSE = { '[': ']', '(': ')', '{': '}', '<': '>' };

function countNL(s, a, b) {
  let k = 0;
  for (let i = a; i < b; i++) if (s.charCodeAt(i) === 10) k++;
  return k;
}

function tokenize(src) {
  const toks = [];
  const n = src.length;
  const backslashEsc = src.indexOf('`') >= 0; // MySQL dökümlerinde \' kaçışı kullanılır
  let i = 0, line = 1, lineStart = true, delim = null;

  const push = (t, v) => {
    const tok = { t, v, line };
    if (t === 'w') tok.u = v.toUpperCase();
    toks.push(tok);
    lineStart = false;
  };
  const atStmtStart = () => {
    const l = toks[toks.length - 1];
    return !l || l.t === 'd' || (l.t === 'p' && l.v === ';');
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = true; continue; }
    if (c <= ' ' || c === '\u{FEFF}' || c === '\xA0') { i++; continue; }

    if (lineStart) {
      const e = src.indexOf('\n', i);
      const lineEnd = e < 0 ? n : e;
      const rest = src.slice(i, Math.min(lineEnd, i + 200)).trim();
      if (rest === '/' && lineEnd - i < 200) { push('d', '/'); i = lineEnd; continue; }
      if (/^GO(\s+\d+)?\s*;?$/i.test(rest)) { push('d', 'GO'); i = lineEnd; continue; }
      if (atStmtStart()) {
        const m = /^DELIMITER\s+(\S+)/i.exec(rest);
        if (m) { delim = m[1] === ';' ? null : m[1]; i = lineEnd; continue; }
        if (c === '@' || c === '#' || CLIENT_CMD.test(rest)) { i = lineEnd; continue; }
      }
    }

    if (delim && src.startsWith(delim, i)) { push('d', delim); i += delim.length; continue; }

    // yorumlar: --, // (CQL), /* */
    if ((c === '-' && src[i + 1] === '-') || (c === '/' && src[i + 1] === '/')) {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      line += countNL(src, i, end);
      i = end;
      continue;
    }

    // metinler: '...', N'...', E'...', q'[...]'
    if (c === "'" || ((c === 'N' || c === 'n' || c === 'E' || c === 'e') && src[i + 1] === "'")) {
      let j = c === "'" ? i + 1 : i + 2;
      let out = '';
      while (j < n) {
        const ch = src[j];
        if (ch === "'") {
          if (src[j + 1] === "'") { out += "'"; j += 2; continue; }
          break;
        }
        if (ch === '\\' && backslashEsc && j + 1 < n) { out += src[j + 1]; j += 2; continue; }
        if (ch === '\n') line++;
        out += ch;
        j++;
      }
      push('s', out);
      i = j + 1;
      continue;
    }
    if ((c === 'q' || c === 'Q') && src[i + 1] === "'" && i + 2 < n) {
      const close = (Q_CLOSE[src[i + 2]] || src[i + 2]) + "'";
      const e = src.indexOf(close, i + 3);
      const end = e < 0 ? n : e;
      push('s', src.slice(i + 3, end));
      line += countNL(src, i, end);
      i = end + 2;
      continue;
    }

    // tırnaklı tanımlayıcılar: "X", `X`, [X]
    if (c === '"' || c === '`') {
      let j = i + 1, out = '';
      while (j < n) {
        if (src[j] === c) {
          if (src[j + 1] === c) { out += c; j += 2; continue; }
          break;
        }
        out += src[j];
        j++;
      }
      push('q', out);
      i = j + 1;
      continue;
    }
    if (c === '[') {
      const e = src.indexOf(']', i);
      if (src[i + 1] === ']' || e < 0 || e - i > 130) { push('p', '['); i++; continue; }
      push('q', src.slice(i + 1, e));
      i = e + 1;
      continue;
    }

    // PostgreSQL $$ ... $$ gövdeleri
    if (c === '$' && !delim) {
      DOLLAR_RE.lastIndex = i;
      const m = DOLLAR_RE.exec(src);
      if (m) {
        const e = src.indexOf(m[0], i + m[0].length);
        const end = e < 0 ? n : e;
        push('s', src.slice(i + m[0].length, end));
        line += countNL(src, i, end);
        i = end + m[0].length;
        continue;
      }
    }

    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      push('n', m[0]);
      i += m[0].length;
      continue;
    }

    WORD_RE.lastIndex = i;
    const wm = WORD_RE.exec(src);
    if (wm) { push('w', wm[0]); i += wm[0].length; continue; }

    push('p', c);
    i++;
  }
  return toks;
}

/*
 * İfade ayırıcı. PL/SQL gövdeleri (trigger, package, procedure...) içinde ';' bulunur.
 * Bu bloklar '/' satırına ya da arkasından yeni bir DDL gelen ';' işaretine kadar sürer.
 * Cassandra'da CREATE TYPE bir veri tipidir, PL/SQL bloğu değil: opts.plsql = false.
 */
const PLSQL_KINDS = new Set(['TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TYPE', 'LIBRARY', 'JAVA']);
const CREATE_MODIFIERS = new Set(['OR', 'REPLACE', 'EDITIONABLE', 'NONEDITIONABLE', 'EDITIONING', 'AND', 'COMPILE', 'RESOLVE', 'NOFORCE', 'FORCE', 'DEFINER']);
const DDL_START = new Set(['CREATE', 'ALTER', 'COMMENT', 'GRANT', 'DROP', 'REVOKE', 'RENAME']);

function isPlsqlStart(toks, k) {
  const w0 = toks[k];
  if (!w0 || w0.t !== 'w') return false;
  if (w0.u === 'DECLARE' || w0.u === 'BEGIN') return true;
  if (w0.u !== 'CREATE') return false;
  for (let j = k + 1; j < toks.length && j < k + 8; j++) {
    const t = toks[j];
    if (t.t !== 'w') return false;
    if (CREATE_MODIFIERS.has(t.u)) continue;
    return PLSQL_KINDS.has(t.u);
  }
  return false;
}

function splitStatements(toks, opts = {}) {
  const allowPlsql = opts.plsql !== false;
  const out = [];
  let cur = [];
  let plsql = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'd') {
      if (cur.length) out.push(cur);
      cur = [];
      plsql = false;
      continue;
    }
    if (cur.length === 0) plsql = allowPlsql && isPlsqlStart(toks, k);
    if (t.t === 'p' && t.v === ';') {
      if (!plsql) {
        if (cur.length) out.push(cur);
        cur = [];
        continue;
      }
      const nx = toks[k + 1];
      if (!nx || (nx.t === 'w' && DDL_START.has(nx.u))) {
        out.push(cur);
        cur = [];
        plsql = false;
        continue;
      }
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/*
 * Lehçe tahmini: her lehçeye özgü işaretleri sayar, en yüksek puanı alanı seçer.
 * Yalnızca rapor ve birkaç lehçeye özgü kural (USE, CREATE TYPE) için kullanılır;
 * ayrıştırıcı bütün lehçeleri zaten aynı anda okuyabilir.
 */
const DIALECT_HINTS = {
  oracle: [/\bVARCHAR2\b/gi, /\bNUMBER\s*\(/gi, /\bTABLESPACE\b/gi, /^\s*\/\s*$/gm, /\bENABLE\s*[,;)]/gi, /\bNOCOMPRESS\b/gi, /\bSYSDATE\b/gi, /\bPCTFREE\b/gi, /\bNOVALIDATE\b/gi],
  tsql: [/\[dbo\]/gi, /^\s*GO\s*$/gim, /\bNVARCHAR\b/gi, /\bIDENTITY\s*\(/gi, /\bCLUSTERED\b/gi, /sp_addextendedproperty/gi, /\bDATETIME2\b/gi, /\bUNIQUEIDENTIFIER\b/gi, /\bON \[PRIMARY\]/gi],
  mysql: [/`/g, /\bENGINE\s*=/gi, /\bAUTO_INCREMENT\b/gi, /DEFAULT CHARSET/gi, /\/\*!\d+/g, /\bTINYINT\b/gi, /\bUNSIGNED\b/gi],
  postgres: [/\bBIGSERIAL\b|\bSERIAL\b/gi, /::\w/g, /\$\$/g, /\bTIMESTAMPTZ\b/gi, /\bJSONB\b/gi, /OWNER TO/gi, /CREATE EXTENSION/gi, /\bcharacter varying\b/gi, /\bpublic\./gi, /\bALTER TABLE ONLY\b/gi],
  sqlite: [/\bAUTOINCREMENT\b/gi, /WITHOUT ROWID/gi, /\bPRAGMA\b/gi, /\bsqlite_/gi],
  cassandra: [/CREATE KEYSPACE/gi, /WITH CLUSTERING ORDER/gi, /\bfrozen\s*</gi, /PRIMARY KEY\s*\(\s*\(/gi, /\bTIMEUUID\b/gi, /\bmap\s*</gi, /\bcompaction\s*=/gi],
};

function detectDialect(src, fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/\.cql$/.test(name)) return 'cassandra';
  const head = src.length > 300000 ? src.slice(0, 300000) : src;
  if (/MariaDB dump|-- Server version\s+[\d.]+-MariaDB/i.test(head)) return 'mariadb';
  let best = 'sql', bestScore = 1;
  for (const [id, res] of Object.entries(DIALECT_HINTS)) {
    let score = 0;
    for (const re of res) {
      re.lastIndex = 0;
      const m = head.match(re);
      if (m) score += Math.min(m.length, 25);
    }
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}

Object.assign(NS, { DIALECTS, tokenize, splitStatements, detectDialect, CREATE_MODIFIERS });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
