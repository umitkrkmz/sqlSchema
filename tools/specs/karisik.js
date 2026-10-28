/*
 * Karışık adlandırma — iki ekibin yıllar içinde aynı veritabanına farklı alışkanlıklarla tablo eklediği bir Oracle şeması.
 * ENVANTER eski ekibin işi: PK <TABLO>_ID. SAHA yeni ekibin işi: PK ID. Arada kısaltılmış (CHZ_REF),
 * İngilizce (DEVICE_REF) ve yalnızca rol adı taşıyan (SAHIBI) FK kolonları, rol önekli FK'ler,
 * kullanıcıya bağlı denetim kolonları (CREATED_BY, GUNCELLEYEN), TBL_ öneki, Türkçe çoğul,
 * bir ORM'in tırnakla açtığı PascalCase tablolar, Türkçe karakterli ve 30 karakteri aşan adlar var.
 * Adlandırma profilinin testidir: tests/run.js buradaki oranları birebir bekler.
 */
'use strict';

const RULES = [
  [/_TAR$|Tarihi$/, 'date'],
  [/_KOD$/, 'str(10)'],
  [/(_ADI|^AD_SOYAD|^UNVAN)$/, 'str(100)'],
];

const SPEC = `
# ENVANTER: eski ekip, PK <TABLO>_ID
ENVANTER.CIHAZ | Sahadaki her fiziksel cihaz (modem, ONT, set üstü kutu) | CIHAZ_ID pk; SERI_NO nn uq; CIHAZ_MODEL_ID >CIHAZ_MODEL; DEPO_ID >DEPO; DURUM_KOD; ALIS_TAR; SON_BAKIM_YAPAN_TEKNISYEN_SICIL_NO; GUNCELLEYEN:id >SAHA.KULLANICI
ENVANTER.CIHAZ_MODEL | | CIHAZ_MODEL_ID pk; MARKA_ID nn >MARKA; MODEL_ADI nn
ENVANTER.MARKA | | MARKA_ID pk; MARKA_ADI nn
ENVANTER.DEPO | Ana depo ve bölge depoları | DEPO_ID pk; DEPO_ADI nn; IL_KOD >IL
ENVANTER.IL | | IL_KOD pk; IL_ADI nn
ENVANTER.TEDARIKCI | | TEDARIKCI_ID pk; UNVAN nn; VKN:str(10)
ENVANTER.SATIN_ALMA | | SATIN_ALMA_ID pk; TEDARIKCI_NO:id nn >TEDARIKCI; SIPARIS_TAR nn
ENVANTER.SATIN_ALMA_KALEM | | SATIN_ALMA_ID pk >SATIN_ALMA; KALEM_NO:smallint pk; CIHAZ_MODEL_ID nn >CIHAZ_MODEL; ADET:int nn
ENVANTER.CIHAZ_HAREKET | Depolar arası transfer; sonradan başka bir geliştirici eklemiş | ID pk; CHZ_REF:id nn >CIHAZ; KAYNAK_DEPO_ID >DEPO; HEDEF_DEPO_ID >DEPO; HAREKET_TAR nn
ENVANTER.TBL_ARIZA_TIP | | ARIZA_TIP_ID pk; ARIZA_ADI nn
ENVANTER.SAYIM | Dönem sonu depo sayımı | SAYIM_ID pk; DEPO_ID nn >DEPO; SAYIM_TAR nn
ENVANTER.SAYIM_DETAY | | NO:id pk; SAYIM_ID nn >SAYIM; CIHAZ_ID nn >CIHAZ; BULUNDU:bool

# SAHA: yeni ekip, PK ID
SAHA.TEKNISYEN | | ID pk; AD_SOYAD nn; SICIL_NO uq; BOLGE_ID >BOLGE
SAHA.BOLGE | | ID pk; BOLGE_ADI nn
SAHA.ABONE | Saha ekibinin kendi abone kopyası; eski alışkanlıkla açılmış | ABONE_ID pk; AD_SOYAD nn; TCKN:str(11)
SAHA.KULLANICI | Uygulama kullanıcıları | ID pk; KULLANICI_ADI:str(50) nn uq; AD_SOYAD nn
SAHA.IS_EMRI | Kurulum, arıza ve söküm iş emirleri | ID pk; ABONE_ID nn >ABONE; CIHAZ_ID >ENVANTER.CIHAZ; TEKNISYEN_ID >TEKNISYEN; ACILIS_TAR nn; DURUM:str(20) nn; CREATED_BY:id nn >KULLANICI; UPDATED_BY:id >KULLANICI
SAHA.IS_EMRI_ADIM | | ID pk; IS_EMRI_ID nn >IS_EMRI; SIRA:smallint nn; ACIKLAMA:str(400)
SAHA.RANDEVULAR | | ID pk; IS_EMRI_ID nn >IS_EMRI; BASLANGIC_TAR nn; BITIS_TAR
SAHA.MALZEME | | ID pk; MALZEME_ADI nn; BIRIM:str(10)
SAHA.IS_EMRI_MALZEME | | IS_EMRI_ID pk >IS_EMRI; MALZEME_ID pk >MALZEME; MIKTAR:dec(10,2) nn
SAHA.CIHAZ_SAHIPLIK | Cihazın hangi abonede olduğu | ID pk; SAHIBI:id nn >ABONE; DEVICE_REF:id nn >ENVANTER.CIHAZ; BASLANGIC_TAR nn
SAHA.IsEmriNotu | Mobil uygulamanın ORM'i tırnaklı adlarla açtı | Id pk; IsEmriId nn >IS_EMRI; Metin:text; OlusturmaTarihi nn
SAHA.Fotograf | | Id pk; IsEmriId nn >IS_EMRI; DosyaYolu:str(400) nn
SAHA.SÖZLEŞME | | ID pk; ABONE_ID nn >ABONE; BAŞLANGIÇ_TAR nn; İMZA_TAR
`;

module.exports = {
  id: 'karisik',
  title: 'Karışık adlandırma',
  sector: 'Telekom saha ve envanter',
  dialect: 'Oracle',
  scenario: 'İki ekip, iki alışkanlık: ENVANTER\'de PK <TABLO>_ID, SAHA\'da ID. Kısaltılmış ve kuralsız FK\'ler, ORM tabloları, Türkçe karakterli adlar. Adlandırma profilini denemek için.',
  en: { title: 'Mixed naming', sector: 'Telecom field service and inventory', scenario: 'Two teams, two habits: PK <TABLE>_ID in ENVANTER, ID in SAHA. Abbreviated and irregular FKs, ORM tables, names with Turkish characters. For trying the naming profile.' },
  build(lib) {
    const tables = lib.parseSpec(SPEC, { infer: RULES });
    return lib.emitOracleDev(tables, { split: true });
  },
};
