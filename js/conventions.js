/*
 * sqlSchema · conventions.js
 * Adlandırma profili: şemada fiilen kullanılan adlandırma kalıplarını sayar ve oranlarını verir.
 * Amaç standart dayatmak değil; "PK'lerin %62'si ID, %38'i <TABLO>_ID" gibi bir fotoğraf çekip
 * baskın kalıbı ve ona uymayanları göstermek. Metin değil kod döndürür; çeviri arayüzdedir.
 *
 * Boyutlar ve kovalar (sıra, gösterim sırasıdır):
 *   tableCase / columnCase   upperSnake  lowerSnake  pascal  camel  mixed
 *   pkStyle                  id  tableId  tableOther  other  | shared  composite  none (nötr)
 *   fkStyle                  targetId  targetOther  role  samePk  roleOnly  other  | audit (nötr)
 *                            (yalnızca tanımlı, tek kolonlu FK)
 *   tableNumber              singular  plural
 *   prefix                   plain  prefixed                                (TBL_, T_, tbl...)
 *   charset                  ascii  nonAscii                                (tablo ve kolon adları)
 *   length                   short  long                                    (30 karakter: eski Oracle sınırı)
 *
 * Nötr kovalar orana ve baskınlığa katılmaz: bileşik PK, üst tablodan gelen PK (1:1) ve
 * CREATED_BY gibi denetim kolonları bir adlandırma tercihi değildir, PK'siz tablo ise denetimin konusudur.
 *
 * En çok kullanılan kalıbın payı CLEAR_AT'in altındaysa (%51'e %49 gibi) kalıp "baskın" sayılmaz:
 * clear: false döner ve arayüz "belirgin baskın kalıp yok" der.
 */
(function (NS) {
'use strict';

const U = s => String(s == null ? '' : s).toUpperCase();
// Alt çizgi ve harf düzeni farkı yok sayılır: CIHAZ_ID, CihazId ve cihaz_id aynı kalıptır
const norm = s => U(s).replace(/[^\p{L}\p{N}]/gu, '');

const PREFIX = /^(TBL|TB|TAB|T)_|^tbl(?=\p{Lu})/iu;
const OTHER_SUFFIX = /(NO|NUM|NR|KOD|KODU|CODE|CD|KEY|REF)$/;
const NAME_LIMIT = 30;
const CLEAR_AT = 0.6;

// Kaydı kimin açtığını / değiştirdiğini tutan kolonlar: hedef tablo adı geçmese de yerleşik bir kalıptır
const TR_FOLD = { '\xC7': 'C', '\u{11E}': 'G', '\u{130}': 'I', '\xD6': 'O', '\u{15E}': 'S', '\xDC': 'U' };
const AUDIT = new RegExp([
  '^(CREATED|CREATE|CREATOR|CRE|UPDATED|UPDATE|UPDATER|UPD|MODIFIED|MODIFY|CHANGED|INSERTED|INSERT|INS|LASTUPDATED|LASTMODIFIED|LASTCHANGED|DELETED|APPROVED)(BY|BYUSER|USER|USR)(ID|NO|CODE)?$',
  '^(KAYITKULLANICI|KAYITEDEN|KAYDEDEN|EKLEYEN|OLUSTURAN|GUNCELLEYEN|SONGUNCELLEYEN|DEGISTIREN|SILEN|ONAYLAYAN)(KULLANICI)?(ID|NO|KOD|SICIL|SICILNO)?$',
].join('|'));
const isAudit = col => AUDIT.test(norm(col).replace(/[\xC7\u{11E}\u{130}\xD6\u{15E}\xDC]/gu, ch => TR_FOLD[ch]));

const DIMS = {
  tableCase: { keys: ['upperSnake', 'lowerSnake', 'pascal', 'camel', 'mixed'] },
  columnCase: { keys: ['upperSnake', 'lowerSnake', 'pascal', 'camel', 'mixed'] },
  pkStyle: { keys: ['id', 'tableId', 'tableOther', 'other', 'shared', 'composite', 'none'], neutral: ['shared', 'composite', 'none'] },
  fkStyle: { keys: ['targetId', 'targetOther', 'role', 'samePk', 'roleOnly', 'other', 'audit'], neutral: ['audit'] },
  tableNumber: { keys: ['singular', 'plural'] },
  prefix: { keys: ['plain', 'prefixed'] },
  charset: { keys: ['ascii', 'nonAscii'] },
  length: { keys: ['short', 'long'] },
};

function caseOf(name) {
  const s = String(name);
  if (!/^[\p{L}\p{N}_$#]+$/u.test(s)) return 'mixed';
  const lower = /\p{Ll}/u.test(s), upper = /\p{Lu}/u.test(s);
  if (!lower) return 'upperSnake';
  if (!upper) return 'lowerSnake';
  if (s.includes('_')) return 'mixed';
  return /^\p{Lu}/u.test(s) ? 'pascal' : 'camel';
}

// Son kelimeye bakan kaba bir tahmin: İngilizce -s/-es/-ies, Türkçe -lar/-ler.
// Türkçe ekte ünlü uyumu aranır; SELLER, HANDLER, DEALER gibi İngilizce -er adları çoğul sayılmaz.
function isPlural(name) {
  const words = String(name).split(/_|(?=\p{Lu}\p{Ll})/u).filter(Boolean);
  const w = U(words[words.length - 1] || '');
  if (w.length < 4) return false;
  if (/(IES|SES|XES|[^SUI]S)$/.test(w)) return true;
  const m = /^(.*?)(LAR|LER)$/.exec(w);
  if (!m || m[1].length < 2 || /LL$/.test(w.slice(0, -2))) return false;
  const vowels = m[1].match(/[AEIOU\xD6\xDC\u{130}]/gu);
  const last = vowels ? vowels[vowels.length - 1] : '';
  return m[2] === 'LAR' ? !/[E\xD6\xDC\u{130}]/u.test(last) : !/[AOU]/.test(last);
}

// Tablo adının PK / FK kolonunda görünebilecek biçimleri: önek ve çoğul eki atılmış hâlleri
function nameForms(name) {
  const base = norm(String(name).replace(PREFIX, ''));
  const forms = new Set([base, norm(name)]);
  if (/IES$/.test(base)) forms.add(base.slice(0, -3) + 'Y');
  if (/(SES|XES)$/.test(base)) forms.add(base.slice(0, -2));
  if (/S$/.test(base)) forms.add(base.slice(0, -1));
  if (/(LAR|LER)$/.test(base) && base.length > 5) forms.add(base.slice(0, -3));
  return [...forms].filter(Boolean);
}

// Tablo adının son kelimeleri: rol önekli FK'lerde hedefin yalnızca son kelimesi geçer (AGENT_USER_ID → APP_USER)
function tailsOf(name) {
  const words = String(name).replace(PREFIX, '').split(/_|(?=\p{Lu}\p{Ll})/u).filter(Boolean);
  const tails = [];
  for (let i = 1; i < words.length; i++) tails.push(...nameForms(words.slice(i).join('_')));
  return tails.filter(f => f.length >= 3);
}

// Kolon adının kalıbı: tablo adı + ID / NO / KOD..., rol önekli hâli ya da hiçbiri.
// Tablo adının son kelimeleri de kabul edilir: HASAR_DOSYA.DOSYA_NO, TROUBLE_TICKET.TICKET_ID
function stemMatch(col, forms, tails = []) {
  const c = norm(col);
  let suffix = null, stem = null;
  if (/ID$/.test(c) && c.length > 2) { suffix = 'id'; stem = c.slice(0, -2); }
  else {
    const m = OTHER_SUFFIX.exec(c);
    if (m && c.length > m[1].length) { suffix = 'other'; stem = c.slice(0, -m[1].length); }
  }
  if (!stem) return null;   // anahtar eki yok (SAHIBI, ASSIGNED_TO)
  if (forms.some(f => f === stem || (stem.length >= 3 && f.endsWith(stem)))) return { suffix, stem, exact: true };
  if (forms.concat(tails).some(f => f.length >= 3 && stem.endsWith(f))) return { suffix, stem, exact: false };
  return { suffix, stem, exact: null };
}

// PK aynı zamanda başka bir tabloya FK ise (1:1 alt tablo) adı üst tablodan gelir; tercih değildir
const sharesPk = tb => tb.out.some(r => r.kind !== 'embed' && !r.self && r.cols.length === 1 && U(r.cols[0]) === U(tb.pk[0]));

function pkStyleOf(tb) {
  if (!tb.pk.length) return 'none';
  if (tb.pk.length > 1) return 'composite';
  const pk = tb.pk[0];
  if (U(pk) === 'ID' || U(pk) === '_ID') return 'id';
  if (sharesPk(tb)) return 'shared';
  const m = stemMatch(pk, nameForms(tb.name));
  if (m && m.exact !== null) return m.suffix === 'id' ? 'tableId' : 'tableOther';
  return 'other';
}

function fkStyleOf(r) {
  const col = r.cols[0], parent = r.parent;
  if (isAudit(col)) return 'audit';
  const m = stemMatch(col, nameForms(parent.name), tailsOf(parent.name));
  if (m && m.exact) return m.suffix === 'id' ? 'targetId' : 'targetOther';
  // kendine başvuran kolonda rol adı olağandır: PARENT_ID, MANAGER_ID, UST_BIRIM_ID
  if ((m && m.exact === false) || (m && r.self)) return 'role';
  if (parent.pk.length === 1 && U(parent.pk[0]) === U(col)) return 'samePk';
  // anahtar eki yoksa ad yalnızca rolü söyler (SAHIBI → ABONE); ek varken hedef tutmuyorsa kuralsızdır (CHZ_REF → CIHAZ)
  return m ? 'other' : 'roleOnly';
}

/*
 * opts.filter: tablo → boolean (ör. tek bir şema); opts.clearAt: belirgin baskınlık eşiği (0.6). Dönen nesne:
 *   { tables, columns, fks, score, clearAt, dims: [{ id, total, dominant, share, clear, buckets: [{ key, n, pct, neutral, items }], outliers }] }
 * items: [{ t: tablo, c: kolon adı | null, ref: hedef tablo (FK için) }]
 */
function namingProfile(model, opts = {}) {
  const keep = opts.filter || (() => true);
  const clearAt = opts.clearAt || CLEAR_AT;
  // Dış ve gömülü tablolar dosyada tanımlı değil; MongoDB'de _id ve ref alanları adlandırma tercihi değildir
  const tables = model.tables.filter(tb => !tb.external && !tb.embedded && keep(tb));
  const sqlTables = tables.filter(tb => tb.dialect !== 'mongodb');
  const acc = {};
  for (const id of Object.keys(DIMS)) acc[id] = new Map(DIMS[id].keys.map(k => [k, []]));
  const add = (dim, key, item) => acc[dim].get(key).push(item);
  let columns = 0;

  for (const tb of tables) {
    const it = { t: tb, c: null };
    add('tableCase', caseOf(tb.name), it);
    add('tableNumber', isPlural(tb.name) ? 'plural' : 'singular', it);
    add('prefix', PREFIX.test(tb.name) ? 'prefixed' : 'plain', it);
    add('charset', /[^\x00-\x7F]/.test(tb.name) ? 'nonAscii' : 'ascii', it);
    add('length', tb.name.length > NAME_LIMIT ? 'long' : 'short', it);
    for (const c of tb.columns) {
      columns++;
      const ci = { t: tb, c: c.name };
      add('columnCase', caseOf(c.name), ci);
      add('charset', /[^\x00-\x7F]/.test(c.name) ? 'nonAscii' : 'ascii', ci);
      add('length', c.name.length > NAME_LIMIT ? 'long' : 'short', ci);
    }
  }
  for (const tb of sqlTables) add('pkStyle', pkStyleOf(tb), { t: tb, c: tb.pk.length === 1 ? tb.pk[0] : null });
  let fks = 0;
  const inScope = new Set(sqlTables);
  for (const r of model.rels) {
    if (r.kind !== 'fk' || r.cols.length !== 1 || !inScope.has(r.child) || r.parent.dialect === 'mongodb') continue;
    fks++;
    add('fkStyle', fkStyleOf(r), { t: r.child, c: r.cols[0], ref: r.parent });
  }

  const dims = Object.entries(DIMS).map(([id, def]) => profileDim(id, def, acc[id], clearAt));
  // Tutarlılık: her boyutta baskın kalıba uyanların oranının ortalaması (boş boyutlar hariç)
  const scored = dims.filter(d => d.total);
  const score = scored.length ? Math.round(scored.reduce((s, d) => s + d.share, 0) / scored.length * 100) : null;
  return { tables: tables.length, columns, fks, score, dims, nameLimit: NAME_LIMIT, clearAt };
}

// Kovalardan boyut özeti: oranlar, baskın kalıp ve ona uymayanlar. Tip profili (audit.js) de bunu kullanır.
//   def: { keys, neutral }, acc: Map(kova → öğeler)
function profileDim(id, def, acc, clearAt = CLEAR_AT) {
  const neutral = def.neutral || [];
  const buckets = def.keys.map(key => ({ key, n: acc.get(key).length, neutral: neutral.includes(key), items: acc.get(key) }));
  const counted = buckets.filter(b => !b.neutral);
  const total = counted.reduce((s, b) => s + b.n, 0);
  for (const b of buckets) b.pct = b.neutral || !total ? null : Math.round(b.n * 1000 / total) / 10;
  let dom = null;
  for (const b of counted) if (b.n && (!dom || b.n > dom.n)) dom = b;
  const outliers = dom ? counted.filter(b => b !== dom).flatMap(b => b.items) : [];
  const share = dom ? dom.n / total : null;
  return { id, total, dominant: dom ? dom.key : null, share, clear: dom ? share >= clearAt : false, buckets, outliers };
}

// Standart önerisi: her boyutta baskın kalıp belirginse (%60 ve üstü) o önerilir; değilse öneri boş kalır, seçenekler
// oranlarıyla döner ve karar ekibindir. Profilin fotoğrafından bir başlangıç noktası; kendisi kural koymaz.
// Standart olamayacak kovalar (karışık harf düzeni, tablo adıyla ilgisiz PK, belirsiz FK adı, rol önekli FK) seçenek değildir:
// rol önekli FK her standartta kabul edilir (aynı tabloya iki FK).
//   proposeStandard(profile, { dialects }) → {
//     standard: { tableCase, columnCase, pkStyle, fkStyle, tableNumber, ascii, nameLimit, comments, auditColumns },
//     choices: { boyut: [{ key, pct, n }] }, clear: { boyut: bool }
//   }
const STD_DIMS = ['tableCase', 'columnCase', 'pkStyle', 'fkStyle', 'tableNumber'];
const NOT_STANDARD = { tableCase: ['mixed'], columnCase: ['mixed'], pkStyle: ['other'], fkStyle: ['role', 'roleOnly', 'other'] };
function proposeStandard(profile, opts = {}) {
  const standard = {}, choices = {}, clear = {};
  for (const id of STD_DIMS) {
    const d = profile.dims.find(x => x.id === id);
    const skip = NOT_STANDARD[id] || [];
    choices[id] = d ? d.buckets.filter(b => !b.neutral && b.n && !skip.includes(b.key)).sort((a, b) => b.n - a.n).map(b => ({ key: b.key, pct: b.pct, n: b.n })) : [];
    clear[id] = !!(d && d.clear);
    standard[id] = d && d.clear && choices[id].some(c => c.key === d.dominant) ? d.dominant : null;
  }
  const cs = profile.dims.find(x => x.id === 'charset');
  standard.ascii = !cs || cs.dominant !== 'nonAscii';
  standard.nameLimit = (opts.dialects || []).includes('oracle') ? NAME_LIMIT : null;
  standard.comments = null;
  standard.auditColumns = [];
  return { standard, choices, clear };
}

Object.assign(NS, { namingProfile, profileDim, proposeStandard, STD_DIMS, caseOf, isPlural, isAudit, pkStyleOf, fkStyleOf });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
