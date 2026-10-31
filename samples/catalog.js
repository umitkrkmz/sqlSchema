/*
 * sqlSchema örnek kataloğu. tools/gen-samples.js üretir; elle düzenlemeyin.
 * Örnek dosyaları fetch ile okunur (http/https gerekir); 'kucuk' uygulamaya gömülüdür.
 */
(globalThis.sqlSchema = globalThis.sqlSchema || {}).SAMPLES = [
  {
    "id": "kucuk",
    "title": "Küçük telekom",
    "sector": "Telekom",
    "dialect": "Oracle",
    "scenario": "20 tablo; dosya gerekmez, uygulamaya gömülü. file:// ile de açılır.",
    "embedded": true,
    "en": {
      "title": "Small telecom",
      "sector": "Telecom",
      "scenario": "20 tables; embedded in the app, no files needed. Works under file:// too."
    }
  },
  {
    "id": "telekom",
    "title": "Telekom BSS/OSS",
    "sector": "Telekom",
    "dialect": "Oracle",
    "scenario": "SQL Developer dökümü tek dosyada: 318 tablo, 16 şema, partition, trigger, paket. CDR tabloları FK'siz.",
    "files": [
      "telekom_oracle.sql"
    ],
    "en": {
      "title": "Telecom BSS/OSS",
      "sector": "Telecom",
      "scenario": "SQL Developer dump in a single file: 318 tables, 16 schemas, partitions, triggers, packages. CDR tables have no FKs."
    }
  },
  {
    "id": "telekom-bolunmus",
    "title": "Telekom, şema başına dosya",
    "sector": "Telekom",
    "dialect": "Oracle",
    "scenario": "Aynı şema 16 dosyaya bölünmüş; FK'ler en sondaki 99_ref_constraints.sql dosyasında, paketler ayrı dosyada.",
    "files": [
      "01_REF.sql",
      "02_CRM.sql",
      "03_PRODUCT.sql",
      "04_SALES.sql",
      "05_SUBS.sql",
      "06_RES.sql",
      "07_NET.sql",
      "08_PROV.sql",
      "09_CDR.sql",
      "10_BILLING.sql",
      "11_PAY.sql",
      "12_PARTNER.sql",
      "13_SEC.sql",
      "14_FIN.sql",
      "15_DWH.sql",
      "16_STG.sql",
      "90_paketler.sql",
      "99_ref_constraints.sql"
    ],
    "en": {
      "title": "Telecom, one file per schema",
      "sector": "Telecom",
      "scenario": "The same schema split into 16 files; all FKs live in the final 99_ref_constraints.sql, packages in a separate file."
    }
  },
  {
    "id": "banka",
    "title": "Çekirdek bankacılık",
    "sector": "Bankacılık",
    "dialect": "SQL Server",
    "scenario": "SSMS \"Generate Scripts\" çıktısı: UTF-16 kodlama, GO ayraçları, IDENTITY, açıklamalar sp_addextendedproperty ile; yüksek hacimli tablolar FK'siz.",
    "files": [
      "CoreBanking.sql"
    ],
    "en": {
      "title": "Core banking",
      "sector": "Banking",
      "scenario": "SSMS \"Generate Scripts\" output: UTF-16 encoding, GO separators, IDENTITY, descriptions via sp_addextendedproperty; high-volume tables without FKs."
    }
  },
  {
    "id": "sigorta",
    "title": "Sigorta (eski sistem)",
    "sector": "Sigorta",
    "dialect": "Oracle",
    "scenario": "Modül başına klasör, Türkçe adlar, elle yazılmış betikler ve hiç FK yok: ilişkiler kolon adlarından tahmin edilir. Durum kolonları genel kod tablosuna açıklamadaki @ref etiketiyle bağlanır.",
    "files": [
      "ACENTE/tablolar.sql",
      "HASAR/indeksler.sql",
      "HASAR/tablolar.sql",
      "ORTAK/indeksler.sql",
      "ORTAK/kod_tablo_verisi.sql",
      "ORTAK/tablolar.sql",
      "POLICE/indeksler.sql",
      "POLICE/PKG_POLICE.pkb",
      "POLICE/tablolar.sql",
      "REASURANS/tablolar.sql",
      "TAHSILAT/indeksler.sql",
      "TAHSILAT/tablolar.sql",
      "URUN/tablolar.sql"
    ],
    "en": {
      "title": "Insurance (legacy system)",
      "sector": "Insurance",
      "scenario": "A folder per module, Turkish names, hand-written scripts and no FKs at all: relationships are inferred from column names. Status columns point to the generic code table through @ref tags in their comments."
    }
  },
  {
    "id": "eticaret",
    "title": "Pazaryeri e-ticaret",
    "sector": "E-ticaret",
    "dialect": "MySQL",
    "scenario": "mysqldump --no-data çıktısı: backtick'li adlar, satır içi FK'ler, DELIMITER'lı yordam; arama ve gösterim tabloları FK'siz.",
    "files": [
      "pazaryeri_schema.sql"
    ],
    "en": {
      "title": "Marketplace e-commerce",
      "sector": "E-commerce",
      "scenario": "mysqldump --no-data output: backtick names, inline FKs, a DELIMITER procedure; search and view logs without FKs."
    }
  },
  {
    "id": "saglik",
    "title": "Hastane bilgi sistemi",
    "sector": "Sağlık",
    "dialect": "PostgreSQL",
    "scenario": "OMOP CDM dağıtım biçimi: tablolar, PK'ler, FK'ler, indeksler ve açıklamalar beş ayrı dosyada; FK dosyası tablolardan önce okunur.",
    "files": [
      "comments.sql",
      "constraints.sql",
      "ddl.sql",
      "indices.sql",
      "primary_keys.sql"
    ],
    "en": {
      "title": "Hospital information system",
      "sector": "Healthcare",
      "scenario": "OMOP CDM distribution layout: tables, PKs, FKs, indexes and comments in five files; the FK file is read before the tables."
    }
  },
  {
    "id": "lojistik",
    "title": "Lojistik / kargo",
    "sector": "Lojistik",
    "dialect": "PostgreSQL",
    "scenario": "Flyway migration klasörü, 14 sürüm: tablo ve kolon adı değiştirme, tablo silme, tip değişikliği, FK kaldırma, partition. Harita son hâli gösterir.",
    "files": [
      "flyway.conf",
      "src/main/resources/db/migration/R__reporting_views.sql",
      "src/main/resources/db/migration/U12__undo_address_ownership.sql",
      "src/main/resources/db/migration/V1__baseline.sql",
      "src/main/resources/db/migration/V2__hubs_and_transfers.sql",
      "src/main/resources/db/migration/V3__pricing.sql",
      "src/main/resources/db/migration/V4__plural_table_names.sql",
      "src/main/resources/db/migration/V5__drivers_and_vehicles.sql",
      "src/main/resources/db/migration/V6__delivery_attempts.sql",
      "src/main/resources/db/migration/V7__route_plans_replace_legacy.sql",
      "src/main/resources/db/migration/V8__customs.sql",
      "src/main/resources/db/migration/V9__returns.sql",
      "src/main/resources/db/migration/V10__proof_of_delivery.sql",
      "src/main/resources/db/migration/V11__weights_to_grams.sql",
      "src/main/resources/db/migration/V12__address_ownership.sql",
      "src/main/resources/db/migration/V13__warehouse_slots.sql",
      "src/main/resources/db/migration/V14__tracking_events_partitioned.sql"
    ],
    "en": {
      "title": "Logistics / parcel delivery",
      "sector": "Logistics",
      "scenario": "Flyway migration folder, 14 versions: table and column renames, dropped tables, type changes, removed FKs, partitioning. The map shows the final state."
    }
  },
  {
    "id": "iot",
    "title": "IoT telemetri",
    "sector": "Enerji / IoT",
    "dialect": "Cassandra",
    "scenario": "İki keyspace, sorgu başına tablo tasarımı: FK yok, bölüm ve sıralama anahtarları, UDT'ler, materialized view.",
    "files": [
      "cql/01_telemetry.cql",
      "cql/02_analytics.cql"
    ],
    "en": {
      "title": "IoT telemetry",
      "sector": "Energy / IoT",
      "scenario": "Two keyspaces, table-per-query design: no FKs, partition and clustering keys, UDTs, a materialized view."
    }
  },
  {
    "id": "sosyal",
    "title": "Sosyal medya",
    "sector": "Sosyal ağ",
    "dialect": "MongoDB",
    "scenario": "$jsonSchema doğrulayıcıları, Mongoose modelleri (ref) ve mongoexport belgeleri birlikte; gömülü alt belgeler uydu olarak görünür.",
    "files": [
      "api/models/Comment.js",
      "api/models/Group.js",
      "api/models/Session.js",
      "api/models/Story.js",
      "api/models/User.js",
      "api/package.json",
      "exports/sosyal.ad_campaigns.json",
      "exports/sosyal.ad_impressions.json",
      "exports/sosyal.analytics_events.json",
      "mongo/validators.js"
    ],
    "en": {
      "title": "Social network",
      "sector": "Social media",
      "scenario": "$jsonSchema validators, Mongoose models (ref) and mongoexport documents together; embedded sub-documents appear as satellites."
    }
  },
  {
    "id": "saha",
    "title": "Saha servisi mobil uygulaması",
    "sector": "Saha servisi",
    "dialect": "SQLite",
    "scenario": "Tabletteki çevrimdışı veritabanının sqlite3 .dump çıktısı: INTEGER PRIMARY KEY AUTOINCREMENT, satır içi REFERENCES, eşitleme kuyruğu.",
    "files": [
      "app.db.sql"
    ],
    "en": {
      "title": "Field service mobile app",
      "sector": "Field service",
      "scenario": "sqlite3 .dump of the tablet's offline database: INTEGER PRIMARY KEY AUTOINCREMENT, inline REFERENCES, a sync queue."
    }
  },
  {
    "id": "polyglot",
    "title": "Çok veritabanlı e-ticaret",
    "sector": "E-ticaret",
    "dialect": "MySQL + MongoDB + PostgreSQL",
    "scenario": "Mikroservis mimarisi: her klasör ayrı bir veritabanı (galaksi). Sipariş MySQL'de, katalog MongoDB'de, raporlama PostgreSQL yıldız şemasında.",
    "files": [
      "analitik/schema.sql",
      "katalog-servisi/validators.js",
      "siparis-servisi/schema.sql"
    ],
    "separate": true,
    "en": {
      "title": "Polyglot e-commerce",
      "sector": "E-commerce",
      "scenario": "Microservices: each folder is a separate database (galaxy). Orders in MySQL, catalog in MongoDB, reporting in a PostgreSQL star schema."
    }
  },
  {
    "id": "karisik",
    "title": "Karışık adlandırma",
    "sector": "Telekom saha ve envanter",
    "dialect": "Oracle",
    "scenario": "İki ekip, iki alışkanlık: ENVANTER'de PK <TABLO>_ID, SAHA'da ID. Kısaltılmış ve kuralsız FK'ler, ORM tabloları, Türkçe karakterli adlar. Adlandırma profilini denemek için.",
    "files": [
      "01_ENVANTER.sql",
      "02_SAHA.sql",
      "99_ref_constraints.sql"
    ],
    "en": {
      "title": "Mixed naming",
      "sector": "Telecom field service and inventory",
      "scenario": "Two teams, two habits: PK <TABLE>_ID in ENVANTER, ID in SAHA. Abbreviated and irregular FKs, ORM tables, names with Turkish characters. For trying the naming profile."
    }
  },
  {
    "id": "sozluk",
    "title": "Sözlük ağırlıklı (genel kod tablosu)",
    "sector": "Telekom CRM",
    "dialect": "Oracle",
    "scenario": "Bütün durum ve tip kodları tek bir SOZLUK tablosunda; 30'dan fazla kolon ona açıklamadaki @ref ... (TIP_ID = n) etiketiyle bağlı. Haritada çizgi yerine rozet olarak görünür.",
    "files": [
      "01_ORTAK.sql",
      "02_CRM.sql",
      "80_sozluk_tipleri.sql",
      "99_ref_constraints.sql"
    ],
    "en": {
      "title": "Lookup-heavy (generic code table)",
      "sector": "Telecom CRM",
      "scenario": "Every status and type code lives in a single SOZLUK table; more than 30 columns point to it through @ref ... (TIP_ID = n) tags in their comments. On the map they appear as badges instead of lines."
    }
  },
  {
    "id": "hatali",
    "title": "Hatalı tasarım (DBA incelemesi)",
    "sector": "Bayi satış",
    "dialect": "Oracle",
    "scenario": "Düzgün bir başlangıç şemasına üç geliştiricinin özensiz eklediği tablolar: PK'siz tablo, metin tarih, FLOAT tutar, indekssiz FK, döngü, anahtar-değer tablosu. Tasarım denetimini denemek için.",
    "files": [
      "db/migration/V1__temel_sema.sql",
      "db/migration/V2__kampanya.sql",
      "db/migration/V3__musteri_iletisim.sql",
      "db/migration/V4__bolge_sorumlusu.sql",
      "db/migration/V5__raporlama.sql"
    ],
    "en": {
      "title": "Flawed design (DBA review)",
      "sector": "Dealer sales",
      "scenario": "Tables three developers carelessly added to a clean baseline: a table without a PK, text dates, FLOAT amounts, unindexed FKs, a cycle, a key-value table. For trying the design audit."
    }
  },
  {
    "id": "bayi",
    "title": "Bayi portalı (EF Core)",
    "sector": "Telekom",
    "dialect": "SQL Server",
    "scenario": ".NET uygulamasının EF Core migration geçmişi (üç sürüm, zaman çizelgesiyle) ve model özeti ile DBA'nın elle yazdığı raporlama ve arşiv betikleri birlikte: owned tip, TPH / TPT kalıtım, çoka çok ara tablo.",
    "files": [
      "src/Portal.Data/Migrations/20240115093000_Initial.cs",
      "src/Portal.Data/Migrations/20240402110000_Payments.cs",
      "src/Portal.Data/Migrations/20240610150000_DealerStatusAndVkn.cs",
      "src/Portal.Data/Migrations/20240610150000_DealerStatusAndVkn.Designer.cs",
      "src/Portal.Data/Migrations/PortalDbContextModelSnapshot.cs",
      "src/Portal.Data/PortalDbContext.cs",
      "src/Portal.Database/dba/01_raporlama.sql",
      "src/Portal.Database/dba/02_arsiv.sql",
      "src/Portal.Domain/Sales/Dealer.cs",
      "src/Portal.Web/appsettings.json"
    ],
    "en": {
      "title": "Dealer portal (EF Core)",
      "sector": "Telecom",
      "scenario": "The EF Core migration history (three versions, with the timeline) and model snapshot of a .NET application together with the reporting and archive scripts the DBA wrote by hand: owned types, TPH / TPT inheritance, a many-to-many join table."
    }
  }
];
