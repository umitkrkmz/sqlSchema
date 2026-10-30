/*
 * sqlSchema · privacy.js
 * KVKK haritası: kişisel veri tutuyor gibi duran kolonlar ve kişiyle ilişkilendirilebilen tablolar.
 * Sınıflandırma kolon adından, açıklamasından ve tablonun adından tahmin edilir; hukuki görüş değildir.
 * Metin değil kod döndürür; çeviri arayüzde yapılır.
 *
 *   privacyMap(model) → {
 *     columns: [{ t, col, cat, src }]        cat: identity | contact | financial | location | special
 *                                            src: name | comment | table (tablonun adı: ADRES tablosunun satırı, TANI tablosu)
 *     tables: Map(tablo → { cats: Set, cols: [...] })   doğrudan kişisel veri tutan tablolar
 *     linked: Map(tablo → { depth, via })   kişisel veri tutan bir tabloya FK / @ref ile (dolaylı da) bağlananlar
 *     counts: { kategori: kolon sayısı } · scanned: denetlenen tablo sayısı
 *   }
 *   PRIVACY_CATS: kategoriler, önem sırasıyla (özel nitelikli en başta)
 */
(function (NS) {
'use strict';

const PRIVACY_CATS = ['special', 'identity', 'financial', 'contact', 'location'];

const TR_FOLD = { '\xC7': 'C', '\u{11E}': 'G', '\u{130}': 'I', '\xD6': 'O', '\u{15E}': 'S', '\xDC': 'U', '\xE7': 'c', '\u{11F}': 'g', '\u{131}': 'i', '\xF6': 'o', '\u{15F}': 's', '\xFC': 'u' };
const fold = s => String(s == null ? '' : s).replace(/[\xC7\u{11E}\u{130}\xD6\u{15E}\xDC\xE7\u{11F}\u{131}\xF6\u{15F}\xFC]/gu, ch => TR_FOLD[ch]);
// Ad parçaları '_A_B_' biçiminde: NationalId, national_id ve NATIONAL_ID aynı kalıba düşer
const joined = name => '_' + fold(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).join('_') + '_';

// Kolon adı kalıpları (kelime sınırlarıyla). Genel "NAME", "CEZA" gibi çok anlamlı kelimeler bilerek yok.
const NAME = {
  special: /_(TANI|TANISI|TESHIS|DIAGNOSIS|ICD|ICD_?10|ICD10_CODE|HASTALIK|DISEASE|ILAC|MEDICATION|DRUG|RECETE|PRESCRIPTION|KAN_GRUBU|BLOOD_TYPE|BLOOD|ALERJI|ALLERGY|ENGELLI|ENGEL_DURUMU|DISABILITY|SAGLIK|HEALTH|DIN|RELIGION|MEZHEP|IRK|RACE|ETNIK|ETHNIC|ETHNICITY|SIYASI|POLITICAL|SENDIKA|TRADE_UNION|BIYOMETRIK|BIOMETRIC|PARMAK_IZI|(?<!DEVICE_|BROWSER_|CIHAZ_)FINGERPRINT|GENETIK|GENETIC|SABIKA|CRIMINAL|MAHKUMIYET|CONVICTION|CINSEL|SEXUAL)_/,
  // cihaz parmak izi (tarayıcı, cihaz) biyometrik değildir
  identity: /_(TCKN|TCKNO|TC_?NO|TC_KIMLIK(_NO)?|KIMLIK_?NO|NATIONAL_?ID|NATIONALID|SSN|PASAPORT(_NO)?|PASSPORT(_NO)?|SOYAD|SOYADI|SURNAME|LAST_?NAME|FIRST_?NAME|FULL_?NAME|AD_SOYAD|ADI_SOYADI|DOGUM(_TAR|_TARIHI|_YERI)?|BIRTH(_DATE|_PLACE)?|BIRTHDATE|BIRTHDAY|DOB|ANNE_ADI|BABA_ADI|MOTHER(S)?_(MAIDEN_)?NAME|CINSIYET|GENDER|MEDENI(_HAL|_DURUM)?|MARITAL(_STATUS)?|UYRUK|NATIONALITY)_/,
  financial: /_(IBAN|PAN|MASKED_PAN|CVV|CVC|KART_?NO|CARD_?NO|CARD_?NUMBER|CARD_?TOKEN|BANKA_HESAP_?NO|BANK_ACCOUNT_?(NO|NUMBER)|MAAS|SALARY|GELIR|INCOME|KREDI_NOTU|CREDIT_SCORE)_/,
  contact: /_(TELEFON|TEL|TEL_?NO|PHONE|GSM|MOBILE|CEP(_TEL)?|MSISDN|FAX|FAKS|EMAIL|E_?MAIL|EPOSTA|E_POSTA|MAIL|(?<!IP_|MAC_)ADRES|(?<!IP_|MAC_)ADDRESS|SOKAK|STREET|CADDE|MAHALLE|POSTA_?KODU|POSTAL_?CODE|ZIP(_CODE)?)_/,
  location: /_(IP|IP_?ADRES|IP_?ADDRESS|IPADDRESS|IMEI|IMSI|ICCID|MAC_?ADRES|MAC_?ADDRESS|LAT|LATITUDE|LNG|LON|LONGITUDE|ENLEM|BOYLAM|GEO_LAT|GEO_LON|KONUM|LOCATION|COORD|KOORDINAT|CELL_ID|BAZ_?ISTASYON)_/,
};
// Kişiye özgü olmayan önekli adlar: PHONE_PREFIX, ADDRESS_TYPE, EMAIL_VERIFIED gibi kolonlar veri değil, nitelik
const NOT_DATA = /_(PREFIX|TYPE|TIP|TIPI|ROLE|ROL|KIND|STATUS|DURUM|VERIFIED|ONAY|COUNT|SAYI|FORMAT|TEMPLATE|SABLON|VERSION|SURUM)(_AT|_ON|_DATE|_TAR|_TARIHI)?_$/;
// Teknik adres ve kimlikler (sunucu, eSIM sunucusu, yönetim ağı) kişiye ait değildir
const TECH = /_(SMDP|SERVER|SUNUCU|HOST|URL|URI|WEB|SMTP|DNS|GATEWAY|MGMT|MANAGEMENT)_/;
// Adres tablosunun satırları: kolon adı tek başına söylemez, tablo söyler
const ADDRESS_TABLE = /_(ADRES|ADDRESS|ADDRESSES|ADRESLER)_/;
const ADDRESS_PART = /_(LINE|LINE_?\d|SATIR|IL|ILCE|CITY|DISTRICT|TOWN|NEIGHBORHOOD|BUILDING|BINA|KAPI_NO|DAIRE|APARTMENT)_/;
// Tablonun kendisi özel nitelikli veri tutuyorsa (tanı, reçete, laboratuvar sonucu) bütün satırları öyledir
const SPECIAL_TABLE = /_(TANI|DIAGNOSIS|DIAGNOSES|RECETE|PRESCRIPTION|PRESCRIPTION_ITEM|LAB_RESULT|LAB_RESULTS|TAHLIL|ALLERGY|ALERJI|MEDICATION)_/;

function classify(tb, c) {
  const j = joined(c.name);
  // Anahtarlar kimliktir, veri değil: ADDRESS_ID adresin kendisi değil, adres satırını gösterir (yayılım onu yakalar).
  // Kimlik biçimli PK (icd10.icd10_code, CELL_ID) katalog ya da altyapı kodudur; PK'nin kendisi veri olabilir (e-posta). Kişinin özelliğini gösteren FK'ler (CINSIYET_ID,
  // NATIONALITY_ID) kişisel kalır.
  if (c.pk && /_(ID|KEY|CODE|KOD|KODU|NO)_$/.test(j)) return null;
  // FK tanımlanmamış (staging) tablolarda da _ID ile biten kolon bir satırı gösterir
  const link = /_ID_$/.test(j);
  for (const cat of PRIVACY_CATS) {
    if (!NAME[cat].test(j) || NOT_DATA.test(j)) continue;
    if (link && cat !== 'identity') continue;
    if ((cat === 'contact' || cat === 'location') && TECH.test(j)) continue;
    return { cat, src: 'name' };
  }
  if (ADDRESS_TABLE.test(joined(tb.name)) && ADDRESS_PART.test(j) && !c.pk && !link) return { cat: 'contact', src: 'table' };
  const cm = c.comment ? joined(c.comment) : '';
  if (cm) for (const cat of PRIVACY_CATS) if (NAME[cat].test(cm) && !link && !c.pk) return { cat, src: 'comment' };
  return null;
}

function privacyMap(model) {
  const scan = model.tables.filter(tb => !tb.external);
  const columns = [];
  const tables = new Map();
  const mark = (tb, col, cat, src) => {
    columns.push({ t: tb, col, cat, src });
    if (!tables.has(tb)) tables.set(tb, { cats: new Set(), cols: [] });
    const e = tables.get(tb);
    e.cats.add(cat);
    if (col) e.cols.push({ col, cat });
  };
  // Konum / cihaz verisi ve tanı, reçete gibi tablolar ancak bir kişiyle ilişkiliyse kişiseldir: baz istasyonunun ya da
  // ATM'nin koordinatı, ilaç kataloğu değildir. Önce diğer kategorilerle kişisel tablolar bulunur, yayılım onlardan yapılır.
  const later = [];
  for (const tb of scan) {
    if (SPECIAL_TABLE.test(joined(tb.name)) && !tb.dictionary) later.push([tb, null, 'special', 'table']);
    for (const c of tb.columns) {
      const k = classify(tb, c);
      if (k && k.cat === 'location') later.push([tb, c.name, k.cat, k.src]);
      else if (k) mark(tb, c.name, k.cat, k.src);
    }
  }
  // Yayılım: kişisel veri tutan tabloya bağlanan (alt) tablolar kişiyle ilişkilendirilebilir; zincir boyunca sürer.
  // Sözlük ve kod tablolarına giden bağlantılar yön gereği yayılmaz (sözlük üst tablodur).
  const linked = new Map();
  let frontier = [...tables.keys()], depth = 0;
  const seen = new Set(frontier);
  while (frontier.length) {
    depth++;
    const next = [];
    for (const p of frontier) {
      for (const r of model.rels) {
        if (r.parent !== p || r.kind === 'embed' || r.self || seen.has(r.child) || r.child.external) continue;
        seen.add(r.child);
        linked.set(r.child, { depth, via: p });
        next.push(r.child);
      }
    }
    frontier = next;
  }
  for (const [tb, col, cat, src] of later) {
    // konum doğrudan kişiyle ilişkili tabloda (en fazla bir adım) anlamlı; özel nitelikli kayıt zincirin sonunda da öyledir
    const l = linked.get(tb);
    if (!tables.has(tb) && !(l && (cat === 'special' || l.depth <= 1))) continue;
    mark(tb, col, cat, src);
    linked.delete(tb);
  }
  const counts = Object.fromEntries(PRIVACY_CATS.map(c => [c, 0]));
  for (const x of columns) if (x.col) counts[x.cat]++;
  return { columns, tables, linked, counts, scanned: scan.length };
}

Object.assign(NS, { privacyMap, PRIVACY_CATS });
})(globalThis.sqlSchema = globalThis.sqlSchema || {});
