#!/usr/bin/env node
/*
 * Sentetik örnek şemaları üretir:   node tools/gen-samples.js
 *
 * Çıktı: samples/<örnek>/...  ve uygulamanın örnek menüsünü dolduran samples/catalog.js
 * Örnekler gerçek bir kuruma ait değildir; sektörlerin tipik yapısını ve araçların gerçek
 * dışa aktarım biçimlerini (SQL Developer, SSMS, mysqldump, pg_dump, sqlite .dump) taklit eder.
 *
 * Yeni bir örnek eklemek için tools/specs/ altına bir dosya yazıp SPECS listesine ekleyin.
 *
 * Tablo dili (DSL), her satır bir tablo:
 *   ŞEMA.TABLO [+part] | açıklama | kolon; kolon; ...
 *   kolon: AD[:TİP] [pk] [nn] [uq] [ai] [>HEDEF] [!>HEDEF]
 *     pk birincil anahtar · nn NOT NULL · uq UNIQUE · ai otomatik artan
 *     >HEDEF yabancı anahtar (hedefin PK'sine) · !>HEDEF devre dışı FK (RELY DISABLE / NOCHECK)
 *   TİP mantıksal (id int bigint smallint str(n) char(n) text dec(p,s) money date ts bool uuid json blob enum)
 *   ya da lehçeye özgü ham tip (VARCHAR2(10 CHAR) gibi). Tip yazılmazsa kolon adından çıkarılır.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'samples');
const SPECS = ['telekom', 'telekom-bolunmus', 'banka', 'sigorta', 'eticaret', 'saglik', 'lojistik', 'iot', 'sosyal', 'saha', 'polyglot', 'karisik', 'sozluk', 'hatali'];

/* ─── Tipler ─── */

const LOGICAL = /^(id|int|bigint|smallint|str\(\d+\)|char\(\d+\)|text|dec\(\d+,\d+\)|money|date|ts|bool|uuid|json|blob|enum)$/;

const TYPE = {
  oracle: { id: 'NUMBER(18,0)', int: 'NUMBER(10,0)', bigint: 'NUMBER(19,0)', smallint: 'NUMBER(5,0)', str: n => `VARCHAR2(${n} CHAR)`, char: n => `CHAR(${n} CHAR)`, text: 'CLOB', dec: (p, s) => `NUMBER(${p},${s})`, money: 'NUMBER(14,4)', date: 'DATE', ts: 'TIMESTAMP (6)', bool: 'CHAR(1 CHAR)', uuid: 'RAW(16)', json: 'CLOB', blob: 'BLOB', enum: 'VARCHAR2(20 CHAR)' },
  tsql: { id: '[bigint]', int: '[int]', bigint: '[bigint]', smallint: '[smallint]', str: n => `[nvarchar](${n})`, char: n => `[nchar](${n})`, text: '[nvarchar](max)', dec: (p, s) => `[decimal](${p}, ${s})`, money: '[decimal](18, 2)', date: '[date]', ts: '[datetime2](7)', bool: '[bit]', uuid: '[uniqueidentifier]', json: '[nvarchar](max)', blob: '[varbinary](max)', enum: '[nvarchar](20)' },
  mysql: { id: 'bigint unsigned', int: 'int', bigint: 'bigint', smallint: 'smallint', str: n => `varchar(${n})`, char: n => `char(${n})`, text: 'text', dec: (p, s) => `decimal(${p},${s})`, money: 'decimal(12,2)', date: 'date', ts: 'datetime', bool: 'tinyint(1)', uuid: 'char(36)', json: 'json', blob: 'longblob', enum: "enum('active','passive','pending','cancelled')" },
  postgres: { id: 'bigint', int: 'integer', bigint: 'bigint', smallint: 'smallint', str: n => `character varying(${n})`, char: n => `character(${n})`, text: 'text', dec: (p, s) => `numeric(${p},${s})`, money: 'numeric(14,2)', date: 'date', ts: 'timestamp with time zone', bool: 'boolean', uuid: 'uuid', json: 'jsonb', blob: 'bytea', enum: 'character varying(20)' },
  sqlite: { id: 'INTEGER', int: 'INTEGER', bigint: 'INTEGER', smallint: 'INTEGER', str: () => 'TEXT', char: () => 'TEXT', text: 'TEXT', dec: () => 'NUMERIC', money: 'NUMERIC', date: 'TEXT', ts: 'TEXT', bool: 'INTEGER', uuid: 'TEXT', json: 'TEXT', blob: 'BLOB', enum: 'TEXT' },
};

function typeFor(dialect, t) {
  if (!LOGICAL.test(t)) return t;
  const m = /^(\w+)(?:\((\d+)(?:,(\d+))?\))?$/.exec(t);
  const v = TYPE[dialect][m[1]];
  return typeof v === 'function' ? v(m[2], m[3]) : v;
}

// Kolon adından mantıksal tip: büyük/küçük harf ve snake/camel/Pascal adlandırmayla çalışır
function inferType(name, rules) {
  for (const [re, t] of rules || []) if (re.test(name)) return t;
  if (/^id$|_id$|_key$/i.test(name) || /[a-z0-9]Id$|[a-z]Key$/.test(name)) return 'id';
  if (/(_date|_on|_dt|_until)$|^(valid_from|valid_to|period_start|period_end)$/i.test(name) || /[a-z](Date|On)$/.test(name)) return 'date';
  if (/(_at|_time)$/i.test(name) || /[a-z](At|Time)$/.test(name)) return 'ts';
  if (/(amount|_fee|price|balance|_total|_limit|budget|cost)$/i.test(name)) return 'money';
  if (/^(is|has|can|supports)[_A-Z]|_flag$|Flag$|enabled$/i.test(name) && !/^island/i.test(name)) return 'bool';
  if (/(_code|Code)$|^code$/i.test(name)) return 'str(30)';
  if (/msisdn/i.test(name)) return 'str(15)';
  if (/(_no|No)$/.test(name) || /_NO$/.test(name)) return 'str(30)';
  if (/e?mail$/i.test(name)) return 'str(190)';
  if (/phone$/i.test(name)) return 'str(20)';
  if (/url$|path$/i.test(name)) return 'str(400)';
  if (/(name|title)$/i.test(name)) return 'str(100)';
  if (/(description|note|notes|comment|comments|reason)$/i.test(name)) return 'str(400)';
  if (/(count|quantity|qty)$/i.test(name)) return 'int';
  return 'str(50)';
}

/* ─── DSL ayrıştırma ─── */

function parseSpec(text, opts = {}) {
  const tables = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [head, comment, cols = ''] = line.split('|').map(s => s.trim());
    const [qn, ...flags] = head.split(/\s+/);
    const dot = qn.lastIndexOf('.');
    const schema = dot < 0 ? (opts.schema || '') : qn.slice(0, dot);
    const name = dot < 0 ? qn : qn.slice(dot + 1);
    const t = { schema, name, comment: comment || null, part: flags.includes('+part'), cols: [], pk: [], uq: [], fks: [] };
    for (const cs of cols.split(';').map(s => s.trim()).filter(Boolean)) {
      const parts = cs.split(/\s+/);
      let [cname, ctype] = parts[0].split(/:(.*)/s);
      let k = 1;
      if (ctype && ctype.includes('(') && !ctype.includes(')')) {
        while (k < parts.length && !parts[k - 1].includes(')')) { ctype += ' ' + parts[k]; k++; }
      }
      const col = { name: cname, type: ctype || inferType(cname, opts.infer), nn: false };
      for (const f of parts.slice(k)) {
        if (f === 'pk') { t.pk.push(cname); col.nn = true; }
        else if (f === 'nn') col.nn = true;
        else if (f === 'uq') t.uq.push(cname);
        else if (f === 'ai') col.ai = true;
        else if (f.startsWith('!>')) t.fks.push({ col: cname, ref: f.slice(2), disabled: true });
        else if (f.startsWith('>')) t.fks.push({ col: cname, ref: f.slice(1) });
      }
      t.cols.push(col);
    }
    tables.set(key(schema, name), t);
  }
  return tables;
}

const key = (s, n) => (s ? s + '.' : '') + n;
const qualify = (ref, schema) => (ref.includes('.') ? ref : key(schema, ref));
const target = (tables, t, fk) => tables.get(qualify(fk.ref, t.schema));

// Tanımlı olmayan FK hedefleri için arama (lookup) tablosu üretir
function addLookups(tables, conv) {
  const made = [];
  for (const t of [...tables.values()]) {
    for (const fk of t.fks) {
      const q = qualify(fk.ref, t.schema);
      if (tables.has(q)) continue;
      const dot = q.lastIndexOf('.');
      const s = dot < 0 ? '' : q.slice(0, dot), n = dot < 0 ? q : q.slice(dot + 1);
      const cols = conv(n);
      tables.set(q, { schema: s, name: n, comment: null, part: false, lookup: true, cols, pk: [cols[0].name], uq: cols[1] ? [cols[1].name] : [], fks: [] });
      made.push(q);
    }
  }
  return made;
}

const UPPER_LOOKUP = n => [{ name: n + '_ID', type: 'NUMBER(6,0)', nn: true }, { name: 'CODE', type: 'str(30)', nn: true }, { name: 'NAME', type: 'str(100)', nn: true }, { name: 'DESCRIPTION', type: 'str(400)' }, { name: 'IS_ACTIVE', type: 'bool', nn: true, def: "'Y'" }, { name: 'SORT_ORDER', type: 'NUMBER(5,0)' }];
const PASCAL_LOOKUP = n => [{ name: n + 'Id', type: 'int', nn: true, ai: true }, { name: 'Code', type: 'str(30)', nn: true }, { name: 'Name', type: 'str(100)', nn: true }, { name: 'IsActive', type: 'bool', nn: true, def: '((1))' }];
const SNAKE_LOOKUP = n => [{ name: 'id', type: 'int', nn: true, ai: true }, { name: 'code', type: 'str(30)', nn: true }, { name: 'name', type: 'str(100)', nn: true }];

function addAudit(tables, cols, skip) {
  for (const t of tables.values()) {
    if (t.lookup || t.part || (skip && skip(t))) continue;
    for (const c of cols) if (!t.cols.some(x => x.name === c.name)) t.cols.push({ ...c });
  }
}

const bySchema = tables => {
  const m = new Map();
  for (const t of tables.values()) {
    if (!m.has(t.schema)) m.set(t.schema, []);
    m.get(t.schema).push(t);
  }
  return m;
};

/* ─── Oracle: SQL Developer / DBMS_METADATA dökümü ─── */

const q = s => '"' + s + '"';
const STORAGE = `  PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255
 NOCOMPRESS LOGGING
  STORAGE(INITIAL 65536 NEXT 1048576 MINEXTENTS 1 MAXEXTENTS 2147483645
  PCTINCREASE 0 FREELISTS 1 FREELIST GROUPS 1
  BUFFER_POOL DEFAULT FLASH_CACHE DEFAULT CELL_FLASH_CACHE DEFAULT)`;

function oracleTable(t, n, tail) {
  const out = [];
  const fq = q(t.schema) + '.' + q(t.name);
  // şemaların yarısında NOT NULL ve PK ayrı ALTER olarak gelir (DBMS_METADATA biçimi)
  const separate = (t.schema.charCodeAt(0) + t.schema.length) % 2 === 0;
  out.push('--------------------------------------------------------', '--  DDL for Table ' + t.name, '--------------------------------------------------------', '');
  const lines = t.cols.map(c => {
    let s = '\t' + q(c.name) + ' ' + typeFor('oracle', c.type);
    if (c.def) s += ' DEFAULT ' + c.def;
    if (c.nn && !separate) s += ' NOT NULL ENABLE';
    return s;
  });
  if (t.pk.length && !separate) lines.push('\t CONSTRAINT ' + q('PK_' + t.name.slice(0, 27)) + ' PRIMARY KEY (' + t.pk.map(q).join(', ') + ')\n  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS\n  TABLESPACE ' + q(t.schema + '_IDX') + '  ENABLE');
  t.uq.forEach((u, i) => {
    if (n % 3 === 0) tail.push('  CREATE UNIQUE INDEX ' + q(t.schema) + '.' + q('UX_' + t.name.slice(0, 20) + '_' + (i + 1)) + ' ON ' + fq + ' (' + q(u) + ') \n  PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS\n  TABLESPACE ' + q(t.schema + '_IDX') + ' ;');
    else lines.push('\t CONSTRAINT ' + q('UK_' + t.name.slice(0, 22) + '_' + (i + 1)) + ' UNIQUE (' + q(u) + ')\n  USING INDEX TABLESPACE ' + q(t.schema + '_IDX') + '  ENABLE');
  });
  const partCol = t.part && (t.cols.find(c => /DATE|TIME|_AT$/.test(c.name) && /DATE|TIMESTAMP/.test(typeFor('oracle', c.type))) || t.cols[0]);
  out.push('  CREATE TABLE ' + fq + '\n   (' + lines.join(',\n') + '\n   ) SEGMENT CREATION IMMEDIATE\n' + STORAGE + '\n  TABLESPACE ' + q(t.schema + '_DATA') +
    (t.part ? '\n  PARTITION BY RANGE (' + q(partCol.name) + ") INTERVAL (NUMTODSINTERVAL(1,'DAY'))\n (PARTITION \"P_INIT\"  VALUES LESS THAN (TO_DATE(' 2024-01-01 00:00:00', 'SYYYY-MM-DD HH24:MI:SS', 'NLS_CALENDAR=GREGORIAN')) SEGMENT CREATION IMMEDIATE\n  PCTFREE 10 PCTUSED 40 INITRANS 1 MAXTRANS 255\n NOCOMPRESS NOLOGGING\n  TABLESPACE " + q(t.schema + '_PART') + ' )' : '') + ' ;', '');
  if (t.comment) out.push('   COMMENT ON TABLE ' + fq + "  IS '" + t.comment.replace(/'/g, "''") + "';");
  for (const c of t.cols) if (c.comment) out.push('   COMMENT ON COLUMN ' + fq + '.' + q(c.name) + " IS '" + c.comment.replace(/'/g, "''") + "';");
  if (separate) {
    out.push('--------------------------------------------------------', '--  Constraints for Table ' + t.name, '--------------------------------------------------------');
    for (const c of t.cols) if (c.nn) out.push('  ALTER TABLE ' + fq + ' MODIFY (' + q(c.name) + ' NOT NULL ENABLE);');
    if (t.pk.length) out.push('  ALTER TABLE ' + fq + ' ADD CONSTRAINT ' + q('PK_' + t.name.slice(0, 27)) + ' PRIMARY KEY (' + t.pk.map(q).join(', ') + ')\n  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS\n  TABLESPACE ' + q(t.schema + '_IDX') + '  ENABLE;');
  }
  out.push('');
  if (t.pk.length === 1 && /_ID$/.test(t.pk[0]) && !t.lookup) {
    const seq = q(t.schema) + '.' + q('SEQ_' + t.name.slice(0, 26));
    out.push('  CREATE SEQUENCE  ' + seq + '  MINVALUE 1 MAXVALUE 9999999999999999999999999999 INCREMENT BY 1 START WITH 1 CACHE 1000 NOORDER  NOCYCLE  NOKEEP  NOSCALE  GLOBAL ;');
    if (n % 4 === 0) {
      const trg = q(t.schema) + '.' + q('TRG_' + t.name.slice(0, 22) + '_BI');
      out.push('--------------------------------------------------------', '--  DDL for Trigger TRG_' + t.name.slice(0, 22) + '_BI', '--------------------------------------------------------', '');
      out.push('  CREATE OR REPLACE EDITIONABLE TRIGGER ' + trg + '\n  BEFORE INSERT ON ' + fq + '\n  FOR EACH ROW\nBEGIN\n  IF :NEW.' + t.pk[0] + ' IS NULL THEN\n    :NEW.' + t.pk[0] + ' := ' + seq + ".NEXTVAL;\n  END IF;\n  -- not: ; ve / karakterleri burada ifadeyi bitirmemeli\n  :NEW.CREATED_BY := NVL(SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER'), USER);\nEND;\n/");
      out.push('ALTER TRIGGER ' + trg + ' ENABLE;');
    }
  }
  if (n % 9 === 0) out.push('  GRANT SELECT ON ' + fq + ' TO "REPORT_RO";');
  return out.join('\n');
}

function oracleRefs(tables, t) {
  const fq = q(t.schema) + '.' + q(t.name);
  return t.fks.map(fk => {
    const tg = target(tables, t, fk);
    const cascade = /_LINE$|_NOTE$|_ATTACHMENT$/.test(t.name) && fk.col === t.pk[0];
    return '  ALTER TABLE ' + fq + ' ADD CONSTRAINT ' + q(('FK_' + t.name.slice(0, 12) + '_' + fk.col).slice(0, 30)) + ' FOREIGN KEY (' + q(fk.col) + ')\n\t  REFERENCES ' + q(tg.schema) + '.' + q(tg.name) + ' (' + q(tg.pk[0]) + ')' + (fk.disabled ? ' RELY DISABLE NOVALIDATE;' : cascade ? ' ON DELETE CASCADE ENABLE;' : ' ENABLE;');
  });
}

function emitOracleDev(tables, opts = {}) {
  const head = ['--------------------------------------------------------', '--  Dosya oluşturuldu - sqlSchema sentetik örneği', '--  Biçim: Oracle SQL Developer / DBMS_METADATA dışa aktarımı', '--  Gerçek bir kuruma ait değildir.', '--------------------------------------------------------', 'SET DEFINE OFF;', ''];
  const tail = [], refs = [];
  let n = 0;
  if (!opts.split) {
    const body = [];
    for (const t of tables.values()) { n++; body.push(oracleTable(t, n, tail)); refs.push(...oracleRefs(tables, t)); }
    return { [opts.file]: [...head, ...body, ...tail, '', opts.extra || '', '--------------------------------------------------------', '--  Ref Constraints', '--------------------------------------------------------', ...refs].join('\n') + '\n' };
  }
  // şema başına bir dosya, FK'ler en sonda ayrı bir dosyada (SQL Developer "nesne türüne göre ayır")
  const files = {};
  let i = 0;
  for (const [schema, list] of bySchema(tables)) {
    i++;
    const body = [], tl = [];
    for (const t of list) { n++; body.push(oracleTable(t, n, tl)); refs.push(...oracleRefs(tables, t)); }
    files[String(i).padStart(2, '0') + '_' + schema + '.sql'] = [...head, ...body, ...tl].join('\n') + '\n';
  }
  if (opts.extra) files['90_paketler.sql'] = opts.extra;
  files['99_ref_constraints.sql'] = ['--------------------------------------------------------', '--  Ref Constraints (bütün şemalar)', '--------------------------------------------------------', ...refs].join('\n') + '\n';
  return files;
}

/* ─── Oracle: elle yazılmış eski (legacy) betikler ─── */

function emitOracleLegacy(list) {
  const out = [];
  for (const t of list) {
    const fq = t.schema + '.' + t.name;
    out.push(`-- ${t.name}${t.comment ? ' : ' + t.comment : ''}`);
    out.push(`CREATE TABLE ${fq}\n(\n${t.cols.map(c => `  ${c.name.padEnd(24)} ${typeFor('oracle', c.type)}${c.def ? ' DEFAULT ' + c.def : ''}${c.nn ? ' NOT NULL' : ''}`).join(',\n')}\n)\nTABLESPACE TS_${t.schema}_DATA;`);
    if (t.pk.length) out.push(`ALTER TABLE ${fq} ADD CONSTRAINT ${t.name.slice(0, 26)}_PK PRIMARY KEY (${t.pk.join(', ')}) USING INDEX TABLESPACE TS_${t.schema}_IDX;`);
    if (t.comment) out.push(`COMMENT ON TABLE ${fq} IS '${t.comment.replace(/'/g, "''")}';`);
    for (const c of t.cols) if (c.comment) out.push(`COMMENT ON COLUMN ${fq}.${c.name} IS '${c.comment.replace(/'/g, "''")}';`);
    out.push('');
  }
  return out.join('\n');
}

/* ─── SQL Server: SSMS "Generate Scripts" ─── */

function emitTsql(tables, opts) {
  const stamp = '24.10.2026 09:41:17';
  const out = [`USE [${opts.db}]`, 'GO'];
  for (const t of tables.values()) {
    out.push(`/****** Object:  Table [${t.schema}].[${t.name}]    Script Date: ${stamp} ******/`, 'SET ANSI_NULLS ON', 'GO', 'SET QUOTED_IDENTIFIER ON', 'GO');
    const lines = t.cols.map(c => `\t[${c.name}] ${typeFor('tsql', c.type)}${c.ai ? ' IDENTITY(1,1)' : ''} ${c.nn ? 'NOT NULL' : 'NULL'}`);
    if (t.pk.length) lines.push(` CONSTRAINT [PK_${t.name}] PRIMARY KEY CLUSTERED \n(\n${t.pk.map(p => `\t[${p}] ASC`).join(',\n')}\n)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]`);
    t.uq.forEach(u => lines.push(` CONSTRAINT [UQ_${t.name}_${u}] UNIQUE NONCLUSTERED \n(\n\t[${u}] ASC\n)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]`));
    out.push(`CREATE TABLE [${t.schema}].[${t.name}](\n${lines.join(',\n')}\n) ON [PRIMARY]${t.cols.some(c => /max\)/.test(typeFor('tsql', c.type))) ? ' TEXTIMAGE_ON [PRIMARY]' : ''}`, 'GO');
  }
  for (const t of tables.values()) {
    for (const c of t.cols) if (c.def) out.push(`ALTER TABLE [${t.schema}].[${t.name}] ADD  CONSTRAINT [DF_${t.name}_${c.name}]  DEFAULT ${c.def} FOR [${c.name}]`, 'GO');
  }
  for (const t of tables.values()) {
    for (const fk of t.fks) {
      const tg = target(tables, t, fk);
      const nm = `FK_${t.name}_${tg.name}_${fk.col}`;
      out.push(`ALTER TABLE [${t.schema}].[${t.name}]  WITH ${fk.disabled ? 'NOCHECK' : 'CHECK'} ADD  CONSTRAINT [${nm}] FOREIGN KEY([${fk.col}])\nREFERENCES [${tg.schema}].[${tg.name}] ([${tg.pk[0]}])`, 'GO');
      out.push(`ALTER TABLE [${t.schema}].[${t.name}] ${fk.disabled ? 'NOCHECK' : 'CHECK'} CONSTRAINT [${nm}]`, 'GO');
    }
  }
  for (const t of tables.values()) {
    if (t.comment) out.push(`EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'${t.comment.replace(/'/g, "''")}' , @level0type=N'SCHEMA',@level0name=N'${t.schema}', @level1type=N'TABLE',@level1name=N'${t.name}'`, 'GO');
    for (const c of t.cols) if (c.comment) out.push(`EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=N'${c.comment.replace(/'/g, "''")}' , @level0type=N'SCHEMA',@level0name=N'${t.schema}', @level1type=N'TABLE',@level1name=N'${t.name}', @level2type=N'COLUMN',@level2name=N'${c.name}'`, 'GO');
  }
  if (opts.extra) out.push(opts.extra);
  return out.join('\r\n') + '\r\n';
}

/* ─── MySQL: mysqldump --no-data ─── */

function emitMysql(tables, opts) {
  const out = [
    `-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)`, `--`, `-- Host: 127.0.0.1    Database: ${opts.db}`, `-- ------------------------------------------------------`, `-- Server version\t8.0.36`, '',
    '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;', '/*!40101 SET NAMES utf8mb4 */;', '/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;', "/*!40103 SET TIME_ZONE='+00:00' */;", '/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;', '',
  ];
  let auto = 1000;
  for (const t of tables.values()) {
    out.push('--', `-- Table structure for table \`${t.name}\``, '--', '', `DROP TABLE IF EXISTS \`${t.name}\`;`, '/*!40101 SET @saved_cs_client     = @@character_set_client */;', '/*!50503 SET character_set_client = utf8mb4 */;');
    const lines = t.cols.map(c => `  \`${c.name}\` ${typeFor('mysql', c.type)}${c.nn ? ' NOT NULL' : ' DEFAULT NULL'}${c.ai ? ' AUTO_INCREMENT' : ''}${c.def && !c.ai ? ' DEFAULT ' + c.def : ''}${c.comment ? ` COMMENT '${c.comment.replace(/'/g, "\\'")}'` : ''}`.replace(' DEFAULT NULL DEFAULT', ' DEFAULT'));
    if (t.pk.length) lines.push(`  PRIMARY KEY (${t.pk.map(p => '`' + p + '`').join(',')})`);
    t.uq.forEach(u => lines.push(`  UNIQUE KEY \`uq_${t.name}_${u}\` (\`${u}\`)`));
    for (const fk of t.fks) lines.push(`  KEY \`fk_${t.name}_${fk.col}\` (\`${fk.col}\`)`);
    for (const fk of t.fks) {
      const tg = target(tables, t, fk);
      lines.push(`  CONSTRAINT \`fk_${t.name}_${fk.col}\` FOREIGN KEY (\`${fk.col}\`) REFERENCES \`${tg.name}\` (\`${tg.pk[0]}\`)${/_items?$|_votes$|_history$/.test(t.name) && fk.col !== 'user_id' ? ' ON DELETE CASCADE' : ''}`);
    }
    out.push(`CREATE TABLE \`${t.name}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB${t.cols.some(c => c.ai) ? ' AUTO_INCREMENT=' + (auto += 937) : ''} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci${t.comment ? ` COMMENT='${t.comment.replace(/'/g, "\\'")}'` : ''};`, '/*!40101 SET character_set_client = @saved_cs_client */;', '');
  }
  out.push('/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;', '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;', '', `-- Dump completed on 2026-10-24  9:41:17`);
  return out.join('\n') + '\n';
}

/* ─── PostgreSQL ─── */

const pq = s => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : '"' + s + '"');

// OMOP CDM tarzı: tablolar, PK'ler, FK'ler, indeksler ve açıklamalar ayrı dosyalarda
function emitPostgresSplit(tables) {
  const ddl = ['--postgresql CDM DDL Specification', ''], pk = [], fk = [], idx = [], cm = [];
  for (const t of tables.values()) {
    const fq = pq(t.schema) + '.' + pq(t.name);
    ddl.push(`CREATE TABLE ${fq} (\n${t.cols.map(c => `\t\t\t${pq(c.name)} ${typeFor('postgres', c.type)}${c.nn ? ' NOT NULL' : ' NULL'}`).join(',\n')} );`);
    if (t.pk.length) pk.push(`ALTER TABLE ${fq} ADD CONSTRAINT xpk_${t.name} PRIMARY KEY (${t.pk.map(pq).join(',')});`);
    t.uq.forEach(u => pk.push(`ALTER TABLE ${fq} ADD CONSTRAINT xuk_${t.name}_${u} UNIQUE (${pq(u)});`));
    for (const f of t.fks) {
      const tg = target(tables, t, f);
      fk.push(`ALTER TABLE ${fq} ADD CONSTRAINT fpk_${t.name}_${f.col} FOREIGN KEY (${pq(f.col)}) REFERENCES ${pq(tg.schema)}.${pq(tg.name)} (${pq(tg.pk[0])});`);
      idx.push(`CREATE INDEX idx_${t.name}_${f.col} ON ${fq} (${pq(f.col)} ASC);`);
    }
    if (t.comment) cm.push(`COMMENT ON TABLE ${fq} IS '${t.comment.replace(/'/g, "''")}';`);
    for (const c of t.cols) if (c.comment) cm.push(`COMMENT ON COLUMN ${fq}.${pq(c.name)} IS '${c.comment.replace(/'/g, "''")}';`);
  }
  const hdr = n => `--postgresql CDM ${n}\n`;
  return { 'ddl.sql': ddl.join('\n') + '\n', 'primary_keys.sql': hdr('Primary Key Constraints') + pk.join('\n') + '\n', 'constraints.sql': hdr('Foreign Key Constraints') + fk.join('\n') + '\n', 'indices.sql': hdr('Indices') + idx.join('\n') + '\n', 'comments.sql': hdr('Comments') + cm.join('\n') + '\n' };
}

// pg_dump --schema-only
function emitPostgresDump(tables, opts = {}) {
  const out = ['--', '-- PostgreSQL database dump', '--', '', '-- Dumped from database version 16.4', '-- Dumped by pg_dump version 16.4', '', "SET statement_timeout = 0;", "SET client_encoding = 'UTF8';", "SET standard_conforming_strings = on;", "SELECT pg_catalog.set_config('search_path', '', false);", 'SET default_tablespace = \'\';', ''];
  const schemas = [...new Set([...tables.values()].map(t => t.schema))].filter(s => s !== 'public');
  for (const s of schemas) out.push(`CREATE SCHEMA ${pq(s)};`, '', `ALTER SCHEMA ${pq(s)} OWNER TO ${opts.owner || 'app'};`, '');
  for (const t of tables.values()) {
    const fq = pq(t.schema) + '.' + pq(t.name);
    out.push('--', `-- Name: ${t.name}; Type: TABLE; Schema: ${t.schema}; Owner: ${opts.owner || 'app'}`, '--', '');
    out.push(`CREATE TABLE ${fq} (\n${t.cols.map(c => `    ${pq(c.name)} ${typeFor('postgres', c.type)}${c.ai ? ' GENERATED ALWAYS AS IDENTITY' : ''}${c.def ? ' DEFAULT ' + c.def : ''}${c.nn ? ' NOT NULL' : ''}`).join(',\n')}\n)${t.part ? `\nPARTITION BY RANGE (${pq((t.cols.find(c => /_at$|date/.test(c.name)) || t.cols[0]).name)})` : ''};`, '', `ALTER TABLE ${fq} OWNER TO ${opts.owner || 'app'};`, '');
    if (t.comment) out.push(`COMMENT ON TABLE ${fq} IS '${t.comment.replace(/'/g, "''")}';`, '');
  }
  for (const t of tables.values()) {
    const fq = pq(t.schema) + '.' + pq(t.name);
    if (t.pk.length) out.push(`ALTER TABLE ONLY ${fq}\n    ADD CONSTRAINT ${t.name}_pkey PRIMARY KEY (${t.pk.map(pq).join(', ')});`, '');
    t.uq.forEach(u => out.push(`ALTER TABLE ONLY ${fq}\n    ADD CONSTRAINT ${t.name}_${u}_key UNIQUE (${pq(u)});`, ''));
  }
  for (const t of tables.values()) {
    for (const f of t.fks) {
      const tg = target(tables, t, f);
      out.push(`ALTER TABLE ONLY ${pq(t.schema)}.${pq(t.name)}\n    ADD CONSTRAINT ${t.name}_${f.col}_fkey FOREIGN KEY (${pq(f.col)}) REFERENCES ${pq(tg.schema)}.${pq(tg.name)}(${pq(tg.pk[0])});`, '');
    }
  }
  out.push('--', '-- PostgreSQL database dump complete', '--');
  return out.join('\n') + '\n';
}

/* ─── SQLite: sqlite3 .dump ─── */

function emitSqlite(tables) {
  const out = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  for (const t of tables.values()) {
    const lines = t.cols.map(c => {
      const pkInline = t.pk.length === 1 && t.pk[0] === c.name;
      const fk = t.fks.find(f => f.col === c.name);
      let s = `  ${c.name} ${typeFor('sqlite', c.type)}`;
      if (pkInline) s += ' PRIMARY KEY' + (c.ai ? ' AUTOINCREMENT' : '');
      else if (c.nn) s += ' NOT NULL';
      if (t.uq.includes(c.name)) s += ' UNIQUE';
      if (c.def) s += ' DEFAULT ' + c.def;
      if (fk) { const tg = target(tables, t, fk); s += ` REFERENCES ${tg.name}(${tg.pk[0]})${/_items?$|_answers$|_entries$/.test(t.name) ? ' ON DELETE CASCADE' : ''}`; }
      return s;
    });
    if (t.pk.length > 1) lines.push(`  PRIMARY KEY (${t.pk.join(', ')})`);
    out.push(`CREATE TABLE ${t.name} (\n${lines.join(',\n')}\n)${t.withoutRowid ? ' WITHOUT ROWID' : ''};`);
  }
  out.push("DELETE FROM sqlite_sequence;");
  for (const t of tables.values()) for (const f of t.fks) out.push(`CREATE INDEX idx_${t.name}_${f.col} ON ${t.name}(${f.col});`);
  out.push('COMMIT;');
  return out.join('\n') + '\n';
}

/* ─── Yazma ─── */

const lib = { parseSpec, addLookups, addAudit, typeFor, inferType, emitOracleDev, emitOracleLegacy, emitTsql, emitMysql, emitPostgresSplit, emitPostgresDump, emitSqlite, UPPER_LOOKUP, PASCAL_LOOKUP, SNAKE_LOOKUP, bySchema };

function write(id, files) {
  const dir = path.join(OUT, id);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

const catalog = [{
  id: 'kucuk', title: 'Küçük telekom', sector: 'Telekom', dialect: 'Oracle', scenario: '20 tablo; dosya gerekmez, uygulamaya gömülü. file:// ile de açılır.', embedded: true,
  en: { title: 'Small telecom', sector: 'Telecom', scenario: '20 tables; embedded in the app, no files needed. Works under file:// too.' },
}];
for (const name of SPECS) {
  const spec = require('./specs/' + name);
  const files = spec.build(lib);
  write(spec.id, files);
  const list = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!spec.en) throw new Error(spec.id + ': İngilizce (en) başlık, sektör ve senaryo eksik');
  catalog.push({ id: spec.id, title: spec.title, sector: spec.sector, dialect: spec.dialect, scenario: spec.scenario, files: list, separate: spec.separate || undefined, en: spec.en });
  const size = Object.values(files).reduce((s, c) => s + Buffer.byteLength(c), 0);
  console.log(`${spec.id.padEnd(18)} ${String(list.length).padStart(3)} dosya  ${(size / 1024).toFixed(0).padStart(5)} KB`);
}

fs.writeFileSync(path.join(OUT, 'catalog.js'), `/*
 * sqlSchema örnek kataloğu. tools/gen-samples.js üretir; elle düzenlemeyin.
 * Örnek dosyaları fetch ile okunur (http/https gerekir); 'kucuk' uygulamaya gömülüdür.
 */
(globalThis.sqlSchema = globalThis.sqlSchema || {}).SAMPLES = ${JSON.stringify(catalog, null, 2)};
`);
console.log('catalog.js:', catalog.length, 'örnek');
