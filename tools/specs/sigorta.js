/*
 * Sigorta — yıllar içinde büyümüş eski (legacy) bir Oracle sistemi.
 * Modül başına klasör (ORTAK, URUN, ACENTE, POLICE, HASAR, TAHSILAT, REASURANS), elle yazılmış betikler,
 * Türkçe adlar ve hiç FK yok: ilişkiler POLICE_NO, MUSTERI_NO, DOSYA_NO gibi kolon adlarından tahmin edilir.
 * Durum kolonları genel kod tablosuna (KOD_TABLO, KOD_TIP + KOD) bağlıdır; bu FK ile ifade edilemez,
 * DBA kolon açıklamasına @ref etiketi yazmıştır.
 * Bir klasörde yalnızca PL/SQL paketi, birinde yalnızca veri (INSERT) var; bunlar çizime girmez.
 */
'use strict';

const RULES = [
  [/_NO$/, 'NUMBER(12,0)'],
  [/_KOD$/, 'VARCHAR2(10 CHAR)'],
  [/_TAR$/, 'DATE'],
  [/(TUTAR|PRIM|_BEDEL|BAKIYE)$/, 'NUMBER(18,2)'],
  [/ORAN$/, 'NUMBER(9,6)'],
  [/(_ADI|UNVAN|ACIKLAMA|ADRES)$/, 'VARCHAR2(250 CHAR)'],
  [/(_TIP|_DURUM)$/, 'CHAR(1 CHAR)'],
  [/^(KAYIT_KULLANICI|GUNCELLEYEN)$/, 'VARCHAR2(30 CHAR)'],
];

const MODULES = {
  ORTAK: `
SGR.IL | İl tanımları | IL_KOD:VARCHAR2(3 CHAR) pk; IL_ADI nn; PLAKA:VARCHAR2(2 CHAR)
SGR.ILCE | | ILCE_KOD:VARCHAR2(6 CHAR) pk; IL_KOD nn; ILCE_ADI nn
SGR.BOLGE | Bölge müdürlükleri | BOLGE_KOD pk; BOLGE_ADI nn; BOLGE_MUDURU_SICIL:NUMBER(8,0)
SGR.SUBE | | SUBE_KOD pk; SUBE_ADI nn; BOLGE_KOD; IL_KOD; ACILIS_TAR
SGR.PERSONEL | | SICIL_NO:NUMBER(8,0) pk; AD_SOYAD:VARCHAR2(100 CHAR) nn; SUBE_KOD; GOREV_KOD; GIRIS_TAR; CIKIS_TAR
SGR.MUSTERI | Sigorta ettiren, sigortalı ve lehtarlar tek tabloda | MUSTERI_NO pk; MUSTERI_TIP nn; TCKN:VARCHAR2(11 CHAR); VKN:VARCHAR2(10 CHAR); UNVAN nn; DOGUM_TAR; CINSIYET:CHAR(1 CHAR); IL_KOD; ILCE_KOD; ADRES; TEL_NO:VARCHAR2(20 CHAR); EPOSTA:VARCHAR2(100 CHAR); KARA_LISTE:CHAR(1 CHAR); KAYIT_TAR nn
SGR.MUSTERI_BANKA | Müşteri IBAN bilgileri | MUSTERI_NO pk; SIRA_NO:NUMBER(3,0) pk; BANKA_KOD; IBAN:VARCHAR2(34 CHAR) nn
SGR.BANKA | | BANKA_KOD pk; BANKA_ADI nn; EFT_KOD:VARCHAR2(5 CHAR)
SGR.DOVIZ_KUR | TCMB kurları | DOVIZ_KOD:VARCHAR2(3 CHAR) pk; KUR_TAR pk; ALIS_KUR:NUMBER(18,6); SATIS_KUR:NUMBER(18,6)
SGR.KOD_TABLO | Genel kod tablosu (KOD_TIP + KOD) | KOD_TIP:VARCHAR2(20 CHAR) pk; KOD:VARCHAR2(20 CHAR) pk; ACIKLAMA nn; GECERLI:CHAR(1 CHAR)
SGR.PARAMETRE | | PARAM_ADI:VARCHAR2(50 CHAR) pk; PARAM_DEGER:VARCHAR2(400 CHAR); ACIKLAMA
`,
  URUN: `
SGR.BRANS | Branş (kasko, trafik, konut, sağlık...) | BRANS_KOD pk; BRANS_ADI nn; ANA_BRANS_KOD
SGR.URUN | Satılan sigorta ürünü | URUN_KOD pk; URUN_ADI nn; BRANS_KOD nn; BASLANGIC_TAR nn; BITIS_TAR; SATISTA:CHAR(1 CHAR)
SGR.TEMINAT | Teminat tanımı | TEMINAT_KOD pk; TEMINAT_ADI nn; BRANS_KOD
SGR.URUN_TEMINAT | Ürünün içerdiği teminatlar | URUN_KOD pk; TEMINAT_KOD pk; ZORUNLU:CHAR(1 CHAR) nn; LIMIT_TUTAR
SGR.TARIFE | | TARIFE_NO pk; URUN_KOD nn; GECERLILIK_TAR nn; ACIKLAMA
SGR.TARIFE_KATSAYI | Fiyat katsayıları | TARIFE_NO pk; FAKTOR_KOD:VARCHAR2(20 CHAR) pk; DEGER:VARCHAR2(30 CHAR) pk; KATSAYI_ORAN nn
SGR.ARAC_MARKA | | MARKA_KOD pk; MARKA_ADI nn
SGR.ARAC_MODEL | Kasko değer listesi | MARKA_KOD pk; MODEL_KOD pk; MODEL_YIL:NUMBER(4,0) pk; MODEL_ADI nn; KASKO_DEGER_BEDEL
`,
  ACENTE: `
SGR.ACENTE | Satış kanalı: acente | ACENTE_KOD pk; UNVAN nn; VKN:VARCHAR2(10 CHAR); LEVHA_NO:VARCHAR2(20 CHAR); BOLGE_KOD; SUBE_KOD; BASLANGIC_TAR; FESIH_TAR
SGR.ACENTE_YETKI | Acentenin satabileceği branşlar | ACENTE_KOD pk; BRANS_KOD pk; YETKI_TAR nn
SGR.ACENTE_KOMISYON | Ürün bazında komisyon oranı | ACENTE_KOD pk; URUN_KOD pk; GECERLILIK_TAR pk; KOMISYON_ORAN nn
SGR.ACENTE_HAKEDIS | Aylık hakediş | HAKEDIS_NO pk; ACENTE_KOD nn; DONEM:VARCHAR2(6 CHAR) nn; BRUT_TUTAR; STOPAJ_TUTAR; NET_TUTAR; ODEME_TAR
SGR.BROKER | | BROKER_KOD pk; UNVAN nn; VKN:VARCHAR2(10 CHAR)
`,
  POLICE: `
SGR.TEKLIF | Poliçe teklifi | TEKLIF_NO pk; MUSTERI_NO nn; URUN_KOD nn; ACENTE_KOD; TEKLIF_TAR nn; GECERLILIK_TAR; BRUT_PRIM; DURUM_KOD
SGR.POLICE | Poliçe ana kaydı | POLICE_NO pk; YENILEME_NO:NUMBER(3,0) nn; TEKLIF_NO; URUN_KOD nn; SIGORTA_ETTIREN_NO:NUMBER(12,0) nn; MUSTERI_NO nn; ACENTE_KOD; BROKER_KOD; TANZIM_TAR nn; BASLANGIC_TAR nn; BITIS_TAR nn; DOVIZ_KOD:VARCHAR2(3 CHAR); NET_PRIM; BRUT_PRIM; POLICE_DURUM nn; ONCEKI_POLICE_NO:NUMBER(12,0)
SGR.POLICE_ZEYL | Zeyilname (poliçe değişikliği) | POLICE_NO pk; ZEYL_NO:NUMBER(4,0) pk; ZEYL_TIP nn; ZEYL_TAR nn; PRIM_FARKI_TUTAR; ACIKLAMA
SGR.POLICE_TEMINAT | | POLICE_NO pk; ZEYL_NO:NUMBER(4,0) pk; TEMINAT_KOD pk; LIMIT_TUTAR; MUAFIYET_TUTAR; PRIM
SGR.POLICE_SIGORTALI | Poliçedeki sigortalılar | POLICE_NO pk; MUSTERI_NO pk; YAKINLIK_KOD; GIRIS_TAR nn; CIKIS_TAR
SGR.POLICE_ARAC | Kasko / trafik riski | POLICE_NO pk; PLAKA:VARCHAR2(10 CHAR) nn; SASI_NO:VARCHAR2(20 CHAR); MOTOR_NO:VARCHAR2(20 CHAR); MARKA_KOD; MODEL_KOD; MODEL_YIL:NUMBER(4,0); KULLANIM_TARZ:VARCHAR2(10 CHAR); HASARSIZLIK_KADEME:NUMBER(1,0)
SGR.POLICE_KONUT | Konut / DASK riski | POLICE_NO pk; UAVT_KOD:VARCHAR2(10 CHAR) nn; IL_KOD; ILCE_KOD; ADRES; YAPI_TARZ:VARCHAR2(10 CHAR); INSA_YIL:NUMBER(4,0); BRUT_M2:NUMBER(6,0); BINA_BEDEL; ESYA_BEDEL
SGR.POLICE_ODEME_PLAN | Taksit planı | POLICE_NO pk; ZEYL_NO:NUMBER(4,0) pk; TAKSIT_NO:NUMBER(2,0) pk; VADE_TAR nn; TUTAR nn
SGR.POLICE_NOT | Serbest metin notlar (PK yok) | POLICE_NO nn; NOT_TAR nn; SICIL_NO:NUMBER(8,0); NOT_METIN:VARCHAR2(4000 CHAR)
`,
  HASAR: `
SGR.EKSPER | | EKSPER_KOD pk; AD_SOYAD:VARCHAR2(100 CHAR) nn; SICIL_BELGE_NO:VARCHAR2(20 CHAR); IL_KOD
SGR.SERVIS | Anlaşmalı servis | SERVIS_KOD pk; UNVAN nn; IL_KOD; YETKILI_MARKA_KOD:VARCHAR2(10 CHAR)
SGR.HASAR_IHBAR | Hasar ihbarı | IHBAR_NO pk; POLICE_NO nn; IHBAR_TAR nn; HASAR_TAR nn; IHBAR_EDEN_MUSTERI_NO:NUMBER(12,0); IHBAR_KANAL:VARCHAR2(10 CHAR); OLAY_YERI_IL_KOD:VARCHAR2(3 CHAR); ACIKLAMA
SGR.HASAR_DOSYA | Hasar dosyası | DOSYA_NO pk; IHBAR_NO nn; POLICE_NO nn; BRANS_KOD nn; EKSPER_KOD; DOSYA_DURUM nn; ACILIS_TAR nn; KAPANIS_TAR; MUALLAK_TUTAR
SGR.HASAR_KALEM | | DOSYA_NO pk; KALEM_NO:NUMBER(3,0) pk; TEMINAT_KOD nn; TALEP_TUTAR; ONAY_TUTAR
SGR.HASAR_REZERV | Muallak rezerv hareketleri | DOSYA_NO pk; REZERV_TAR pk; REZERV_TUTAR nn; SICIL_NO:NUMBER(8,0)
SGR.HASAR_ODEME | | ODEME_NO pk; DOSYA_NO nn; ALICI_MUSTERI_NO:NUMBER(12,0); SERVIS_KOD; BANKA_KOD; IBAN:VARCHAR2(34 CHAR); ODEME_TUTAR nn; ODEME_TAR nn
SGR.EKSPER_RAPOR | | RAPOR_NO pk; DOSYA_NO nn; EKSPER_KOD nn; RAPOR_TAR nn; HASAR_TUTAR; SOVTAJ_TUTAR
SGR.HASAR_EVRAK | | DOSYA_NO pk; EVRAK_NO:NUMBER(3,0) pk; EVRAK_TIP nn; DOSYA_YOLU:VARCHAR2(400 CHAR)
SGR.HASAR_SERVIS | Dosyanın yönlendirildiği servis | DOSYA_NO pk; SERVIS_KOD pk; YONLENDIRME_TAR nn
SGR.RUCU | Rücu takibi | RUCU_NO pk; DOSYA_NO nn; KARSI_SIRKET_KOD:VARCHAR2(10 CHAR); RUCU_TUTAR; TAHSIL_TUTAR; DURUM_KOD
`,
  TAHSILAT: `
SGR.PRIM_TAHAKKUK | Prim tahakkuku | TAHAKKUK_NO pk; POLICE_NO nn; ZEYL_NO:NUMBER(4,0) nn; TAKSIT_NO:NUMBER(2,0) nn; VADE_TAR nn; TUTAR nn; KALAN_TUTAR nn
SGR.TAHSILAT | | TAHSILAT_NO pk; MUSTERI_NO nn; TAHSILAT_TAR nn; TUTAR nn; ODEME_ARAC_KOD:VARCHAR2(10 CHAR) nn; BANKA_KOD; DEKONT_NO:VARCHAR2(30 CHAR)
SGR.TAHSILAT_DAGITIM | Tahsilatın tahakkuklara dağıtımı | TAHSILAT_NO pk; TAHAKKUK_NO pk; DAGITIM_TUTAR nn
SGR.KK_TALIMAT | Kredi kartı otomatik ödeme talimatı | TALIMAT_NO pk; MUSTERI_NO nn; POLICE_NO; KART_TOKEN:VARCHAR2(64 CHAR) nn; MASKELI_KART:VARCHAR2(19 CHAR); IPTAL_TAR
SGR.PRIM_IADE | | IADE_NO pk; POLICE_NO nn; ZEYL_NO:NUMBER(4,0); IADE_TUTAR nn; IADE_TAR
SGR.HESAP_PLANI | | HESAP_KOD:VARCHAR2(20 CHAR) pk; HESAP_ADI nn; UST_HESAP_KOD:VARCHAR2(20 CHAR)
SGR.MUHASEBE_FIS | | FIS_NO pk; FIS_TAR nn; KAYNAK_MODUL:VARCHAR2(10 CHAR) nn; ACIKLAMA
SGR.MUHASEBE_FIS_SATIR | | FIS_NO pk; SATIR_NO:NUMBER(5,0) pk; HESAP_KOD:VARCHAR2(20 CHAR) nn; BORC_TUTAR; ALACAK_TUTAR; SUBE_KOD
`,
  REASURANS: `
SGR.REASUROR | Reasürans şirketi | REASUROR_KOD pk; UNVAN nn; ULKE_KOD:VARCHAR2(2 CHAR); RATING:VARCHAR2(5 CHAR)
SGR.ANLASMA | Reasürans anlaşması | ANLASMA_NO pk; ANLASMA_TIP nn; BRANS_KOD; BASLANGIC_TAR nn; BITIS_TAR nn; SAKLAMA_TUTAR
SGR.ANLASMA_PAY | | ANLASMA_NO pk; REASUROR_KOD pk; PAY_ORAN nn
SGR.CESSION | Poliçe bazında devir | CESSION_NO pk; POLICE_NO nn; ANLASMA_NO nn; DEVIR_PRIM; DEVIR_TAR
`,
};

// Kolon açıklamaları:
//   durum kolonları genel kod tablosunun yalnızca bir tipine bağlıdır; FK ile tanımlanamaz, DBA açıklamaya @ref yazmıştır
//   bazı kodların anlamı ise ayrı bir tabloda değil doğrudan açıklamada yazılıdır ("G = Gerçek kişi, T = Tüzel kişi")
const COMMENTS = {
  'SGR.POLICE': { POLICE_DURUM: "Poliçe durumu. @ref KOD_TABLO.KOD (KOD_TIP = 'POLICE_DURUM')" },
  'SGR.HASAR_DOSYA': { DOSYA_DURUM: "Dosya durumu. @ref KOD_TABLO.KOD (KOD_TIP = 'DOSYA_DURUM')" },
  'SGR.TEKLIF': { DURUM_KOD: "Teklif durumu. @ref KOD_TABLO.KOD (KOD_TIP = 'TEKLIF_DURUM')" },
  'SGR.HASAR_IHBAR': {
    IHBAR_EDEN_MUSTERI_NO: 'İhbarı yapan kişi; sigortalı olmayabilir. @ref MUSTERI',
    IHBAR_KANAL: 'İhbarın geldiği kanal: ACN = Acente, CAG = Çağrı merkezi, WEB = İnternet şubesi, MOB = Mobil uygulama',
  },
  'SGR.MUSTERI': {
    MUSTERI_TIP: 'G = Gerçek kişi, T = Tüzel kişi',
    CINSIYET: 'E: Erkek; K: Kadın; B: Belirtilmemiş',
    KARA_LISTE: 'Sahtecilik şüphesi. E-Evet / H-Hayır',
  },
  'SGR.POLICE_ZEYL': { ZEYL_TIP: 'Zeyilname tipi (1=Teminat ekleme, 2=Teminat çıkarma, 3=Bilgi değişikliği, 4=İptal)' },
};

const INDEXES = {
  // kodların bir kısmı CHECK kısıtıyla da sınırlanmış; anlamları açıklamada (MUSTERI_TIP) ya da hiç yazılmamış (KULLANIM_TARZ)
  ORTAK: ["ALTER TABLE SGR.MUSTERI ADD CONSTRAINT MUSTERI_TIP_CK CHECK (MUSTERI_TIP IN ('G', 'T'));"],
  POLICE: [
    "ALTER TABLE SGR.POLICE_ARAC ADD CONSTRAINT POLICE_ARAC_KT_CK CHECK (KULLANIM_TARZ IN ('HUSUSI', 'TICARI', 'TAKSI', 'RESMI'));",'CREATE INDEX SGR.POLICE_IX1 ON SGR.POLICE (MUSTERI_NO);', 'CREATE INDEX SGR.POLICE_IX2 ON SGR.POLICE (ACENTE_KOD, TANZIM_TAR);', 'CREATE UNIQUE INDEX SGR.POLICE_ARAC_UX1 ON SGR.POLICE_ARAC (PLAKA, POLICE_NO);'],
  HASAR: ['CREATE INDEX SGR.HASAR_DOSYA_IX1 ON SGR.HASAR_DOSYA (POLICE_NO);', 'CREATE INDEX SGR.HASAR_ODEME_IX1 ON SGR.HASAR_ODEME (DOSYA_NO);'],
  TAHSILAT: ['CREATE INDEX SGR.PRIM_TAHAKKUK_IX1 ON SGR.PRIM_TAHAKKUK (POLICE_NO, ZEYL_NO);'],
};

const PACKAGE = `CREATE OR REPLACE PACKAGE BODY SGR.PKG_POLICE AS
  -- Poliçe yenileme: eski poliçeyi kapatır, yenisini oluşturur
  PROCEDURE YENILE(P_POLICE_NO IN NUMBER) IS
    V_YENI NUMBER;
  BEGIN
    SELECT SGR.SEQ_POLICE.NEXTVAL INTO V_YENI FROM DUAL;
    INSERT INTO SGR.POLICE (POLICE_NO, YENILEME_NO, URUN_KOD, SIGORTA_ETTIREN_NO, MUSTERI_NO, TANZIM_TAR, BASLANGIC_TAR, BITIS_TAR, POLICE_DURUM, ONCEKI_POLICE_NO)
    SELECT V_YENI, YENILEME_NO + 1, URUN_KOD, SIGORTA_ETTIREN_NO, MUSTERI_NO, SYSDATE, BITIS_TAR, ADD_MONTHS(BITIS_TAR, 12), 'A', POLICE_NO
      FROM SGR.POLICE WHERE POLICE_NO = P_POLICE_NO;
    UPDATE SGR.POLICE SET POLICE_DURUM = 'Y' WHERE POLICE_NO = P_POLICE_NO;
  END YENILE;
END PKG_POLICE;
/
`;

const DATA = `-- KOD_TABLO başlangıç verisi
INSERT INTO SGR.KOD_TABLO (KOD_TIP, KOD, ACIKLAMA, GECERLI) VALUES ('POLICE_DURUM', 'A', 'Aktif', 'E');
INSERT INTO SGR.KOD_TABLO (KOD_TIP, KOD, ACIKLAMA, GECERLI) VALUES ('POLICE_DURUM', 'I', 'İptal', 'E');
INSERT INTO SGR.KOD_TABLO (KOD_TIP, KOD, ACIKLAMA, GECERLI) VALUES ('POLICE_DURUM', 'Y', 'Yenilendi', 'E');
INSERT INTO SGR.KOD_TABLO (KOD_TIP, KOD, ACIKLAMA, GECERLI) VALUES ('DOSYA_DURUM', 'M', 'Muallak', 'E');
INSERT INTO SGR.KOD_TABLO (KOD_TIP, KOD, ACIKLAMA, GECERLI) VALUES ('DOSYA_DURUM', 'K', 'Kapandı', 'E');
COMMIT;
`;

module.exports = {
  id: 'sigorta',
  title: 'Sigorta (eski sistem)',
  sector: 'Sigorta',
  dialect: 'Oracle',
  scenario: 'Modül başına klasör, Türkçe adlar, elle yazılmış betikler ve hiç FK yok: ilişkiler kolon adlarından tahmin edilir. Durum kolonları genel kod tablosuna açıklamadaki @ref etiketiyle bağlanır.',
  en: { title: 'Insurance (legacy system)', sector: 'Insurance', scenario: 'A folder per module, Turkish names, hand-written scripts and no FKs at all: relationships are inferred from column names. Status columns point to the generic code table through @ref tags in their comments.' },
  build(lib) {
    const files = {};
    for (const [mod, spec] of Object.entries(MODULES)) {
      const t = lib.parseSpec(spec, { infer: RULES });
      for (const [key, cols] of Object.entries(COMMENTS)) {
        if (!t.has(key)) continue;
        for (const [col, text] of Object.entries(cols)) t.get(key).cols.find(c => c.name === col).comment = text;
      }
      lib.addAudit(t, [{ name: 'KAYIT_TAR', type: 'DATE', nn: true, def: 'SYSDATE' }, { name: 'KAYIT_KULLANICI', type: 'VARCHAR2(30 CHAR)' }, { name: 'GUNCELLEME_TAR', type: 'DATE' }]);
      files[`${mod}/tablolar.sql`] = `-- ${mod} modülü tabloları\n-- Not: bütünlük uygulama katmanında; veritabanında FK tanımlı değildir.\n\n` + lib.emitOracleLegacy([...t.values()]);
      if (INDEXES[mod]) files[`${mod}/indeksler.sql`] = INDEXES[mod].join('\n') + '\n';
    }
    files['POLICE/PKG_POLICE.pkb'] = PACKAGE;
    files['ORTAK/kod_tablo_verisi.sql'] = DATA;
    return files;
  },
};
