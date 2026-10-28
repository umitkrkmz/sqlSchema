/*
 * Sözlük ağırlıklı — bir telekom CRM şeması; durum, tip, kanal, segment gibi bütün kodlar tek bir genel
 * sözlük tablosunda (ORTAK.SOZLUK: ID, TIP_ID, KOD, AD). Bir kolonun yalnızca bir tipe bağlı olduğu FK ile
 * ifade edilemez; DBA bunu kolon açıklamasına @ref ... (TIP_ID = n) olarak yazmıştır.
 * Haritada SOZLUK sözlük olarak tanınır: 30'dan fazla bağlantı çizgi yerine rozetle gösterilir.
 * Kenar durumlar: ODEME.YONTEM_ID'de hem FK hem @ref koşulu var; ADRES.ADRES_TIP_ID'de yalnızca FK var.
 */
'use strict';

const RULES = [
  [/_TAR$/, 'date'],
  [/(TUTAR)$/, 'money'],
  [/^(AD|AD_SOYAD|NOT_METIN)$/, 'str(200)'],
];

const SPEC = `
ORTAK.SOZLUK_TIP | Sözlük tipleri (abone durumu, hat tipi, kanal...) | ID:smallint pk; AD nn; ACIKLAMA:str(400)
ORTAK.SOZLUK | Genel kod tablosu: bütün durum ve tip kodları | ID:int pk; TIP_ID:smallint nn >SOZLUK_TIP; KOD:str(30) nn; AD nn; SIRA:smallint; AKTIF:bool nn

CRM.ABONE | Abone (gerçek ya da tüzel kişi) | ID pk; AD_SOYAD nn; TCKN:str(11); DURUM_ID:int nn; TIP_ID:int nn; SEGMENT_ID:int; CINSIYET_ID:int; EGITIM_ID:int; MESLEK_ID:int; DIL_ID:int; ILETISIM_TERCIH_ID:int; KAYIT_TAR nn
CRM.HAT | Abonenin hatları | ID pk; ABONE_ID nn >ABONE; MSISDN nn uq; DURUM_ID:int nn; HAT_TIP_ID:int nn; ROAMING_PROFIL_ID:int; IPTAL_NEDEN_ID:int; AKTIVASYON_TAR
CRM.TARIFE | | ID pk; AD nn; TARIFE_TIP_ID:int nn; TAAHHUT_ID:int; AYLIK_TUTAR
CRM.HAT_TARIFE | Hattın tarife geçmişi | ID pk; HAT_ID nn >HAT; TARIFE_ID nn >TARIFE; BASLANGIC_TAR nn; BITIS_TAR
CRM.FATURA_HESABI | | ID pk; ABONE_ID nn >ABONE; DONEM_ID:int nn; ODEME_YONTEM_ID:int
CRM.FATURA | | ID pk; FATURA_HESABI_ID nn >FATURA_HESABI; DURUM_ID:int nn; GONDERIM_ID:int; TUTAR nn; KESIM_TAR nn
CRM.ODEME | | ID pk; FATURA_ID nn >FATURA; YONTEM_ID:int nn >ORTAK.SOZLUK; KANAL_ID:int; TUTAR nn; ODEME_TAR nn
CRM.ADRES | | ID pk; ABONE_ID nn >ABONE; ADRES_TIP_ID:int nn >ORTAK.SOZLUK; ACIK_ADRES:str(400) nn
CRM.TALEP | Müşteri talebi / şikâyet | ID pk; ABONE_ID nn >ABONE; TIP_ID:int nn; DURUM_ID:int nn; ONCELIK_ID:int; KANAL_ID:int; ACILIS_TAR nn
CRM.TALEP_NOT | | ID pk; TALEP_ID nn >TALEP; NOT_METIN nn; YAZAN:str(30)
CRM.KAMPANYA | | ID pk; AD nn; TIP_ID:int nn; KANAL_ID:int; BASLANGIC_TAR nn; BITIS_TAR
CRM.KAMPANYA_KATILIM | | ID pk; KAMPANYA_ID nn >KAMPANYA; ABONE_ID nn >ABONE; DURUM_ID:int nn; KATILIM_TAR nn
CRM.CAGRI | Çağrı merkezi görüşmesi | ID pk; ABONE_ID >ABONE; KANAL_ID:int nn; NEDEN_ID:int; SONUC_ID:int; CAGRI_TAR nn
`;

// tablo → kolon → [sözlük tipi, açıklama]; bazıları şemayla (ORTAK.SOZLUK.ID), bazıları kısaca (SOZLUK) yazılmış
const TYPES = {
  1: 'Abone durumu', 2: 'Abone tipi', 3: 'Segment', 4: 'Cinsiyet', 5: 'Eğitim durumu', 6: 'Meslek',
  7: 'Hat durumu', 8: 'Hat tipi', 9: 'Tarife tipi', 10: 'Fatura dönemi', 11: 'Ödeme yöntemi', 12: 'Fatura durumu',
  13: 'Kanal', 14: 'Talep tipi', 15: 'Talep durumu', 16: 'Öncelik', 17: 'Kampanya tipi', 18: 'Adres tipi',
  19: 'İletişim tercihi', 20: 'İptal nedeni', 21: 'Kampanya katılım durumu', 22: 'Çağrı sonucu', 23: 'Dil',
  24: 'Roaming profili', 25: 'Taahhüt süresi', 26: 'Fatura gönderim şekli',
};
const REFS = {
  'CRM.ABONE': { DURUM_ID: 1, TIP_ID: 2, SEGMENT_ID: 3, CINSIYET_ID: 4, EGITIM_ID: 5, MESLEK_ID: 6, DIL_ID: 23, ILETISIM_TERCIH_ID: 19 },
  'CRM.HAT': { DURUM_ID: 7, HAT_TIP_ID: 8, ROAMING_PROFIL_ID: 24, IPTAL_NEDEN_ID: 20 },
  'CRM.TARIFE': { TARIFE_TIP_ID: 9, TAAHHUT_ID: 25 },
  'CRM.FATURA_HESABI': { DONEM_ID: 10, ODEME_YONTEM_ID: 11 },
  'CRM.FATURA': { DURUM_ID: 12, GONDERIM_ID: 26 },
  'CRM.ODEME': { YONTEM_ID: 11, KANAL_ID: 13 },
  'CRM.TALEP': { TIP_ID: 14, DURUM_ID: 15, ONCELIK_ID: 16, KANAL_ID: 13 },
  'CRM.KAMPANYA': { TIP_ID: 17, KANAL_ID: 13 },
  'CRM.KAMPANYA_KATILIM': { DURUM_ID: 21 },
  'CRM.CAGRI': { KANAL_ID: 13, NEDEN_ID: 14, SONUC_ID: 22 },
};

const DATA = `-- Sözlük tipleri (başlangıç verisi; çizime girmez)
${Object.entries(TYPES).map(([id, ad]) => `INSERT INTO ORTAK.SOZLUK_TIP (ID, AD) VALUES (${id}, '${ad}');`).join('\n')}
COMMIT;
`;

module.exports = {
  id: 'sozluk',
  title: 'Sözlük ağırlıklı (genel kod tablosu)',
  sector: 'Telekom CRM',
  dialect: 'Oracle',
  scenario: 'Bütün durum ve tip kodları tek bir SOZLUK tablosunda; 30\'dan fazla kolon ona açıklamadaki @ref ... (TIP_ID = n) etiketiyle bağlı. Haritada çizgi yerine rozet olarak görünür.',
  en: { title: 'Lookup-heavy (generic code table)', sector: 'Telecom CRM', scenario: 'Every status and type code lives in a single SOZLUK table; more than 30 columns point to it through @ref ... (TIP_ID = n) tags in their comments. On the map they appear as badges instead of lines.' },
  build(lib) {
    const tables = lib.parseSpec(SPEC, { infer: RULES });
    let n = 0;
    for (const [key, cols] of Object.entries(REFS)) {
      for (const [col, tip] of Object.entries(cols)) {
        const target = n++ % 3 === 0 ? 'ORTAK.SOZLUK.ID' : 'SOZLUK';
        tables.get(key).cols.find(c => c.name === col).comment = `${TYPES[tip]}. @ref ${target} (TIP_ID = ${tip})`;
      }
    }
    const files = lib.emitOracleDev(tables, { split: true });
    files['80_sozluk_tipleri.sql'] = DATA;
    return files;
  },
};
