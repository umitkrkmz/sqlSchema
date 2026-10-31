# Değişiklik geçmişi · Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) biçimini ve [Anlamsal Sürümleme](https://semver.org/lang/tr/)'yi izler.
This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Yayımlanmamış · Unreleased]

### Eklendi · Added

- **EF Core migration geçmişi:** `20240115093000_Initial.cs` gibi migration dosyaları sürüm olarak okunur (`Up()` içindeki `CreateTable`, `AddColumn`, `AlterColumn`, `RenameColumn`, `RenameTable`, `CreateIndex`, `AddForeignKey`, `DropTable` …; `Sql("...")` içindeki ham SQL). Zaman çizelgesi, şema farkı, değişiklik incelemesi ve `--since` EF projelerinde SQL'siz çalışır. Migration'lar varken model özeti (son hâlin kopyası) atlanır; `.Designer.cs` ve `Down()` okunmaz. **Bayi portalı** örneğine üç sürümlük geçmiş eklendi; test, geçmişin sonunun model özetiyle aynı şemayı verdiğini denetler.
  EF Core migration history: migration files such as `20240115093000_Initial.cs` are read as versions (`CreateTable`, `AddColumn`, `AlterColumn`, `RenameColumn`, `RenameTable`, `CreateIndex`, `AddForeignKey`, `DropTable` … in `Up()`; raw SQL in `Sql("...")`). The timeline, schema diff, change review and `--since` work for EF projects without SQL. When migrations are present the model snapshot (a copy of the final state) is skipped; `.Designer.cs` and `Down()` are not read. The **Dealer portal** sample gains a three-version history; a test checks that its end gives the same schema as the model snapshot.

### Değişti · Changed

- **Bozuk dosyaya dayanıklılık:** bir dosyada ayrıştırıcı hatası öbür dosyaları düşürmez; harita geri kalanla çizilir, dosya **dosyalar** listesinde hatasıyla görünür. Komut satırı denetimi de hatalı dosyayı yazıp devam eder. Test seti her örnek dosyasını kesip bozarak (616 varyant) çökme olmadığını denetler.
  Resilience to broken files: a parser error in one file no longer brings down the others; the map is drawn from the rest and the file is listed with its error under **files**. The command-line audit also reports the file and carries on. The test suite cuts and corrupts every sample file (616 variants) and checks nothing crashes.
- **Büyük şemada açılış:** adlandırma profili pencere kapalıyken hesaplanmaz; 2 900 tabloluk dökümde açılış yaklaşık 1,0 saniyeden 0,8 saniyeye indi.
  Opening large schemas: the naming profile is not computed while its window is closed; a 2,900-table dump now opens in about 0.8 s instead of 1.0 s.

## [0.12.0] - 2026-10-30

### Eklendi · Added

- **EF Core model özeti:** .NET projelerinde `Migrations/*ModelSnapshot.cs` SQL'e çevirmeden okunur: şema, kolon, tip, NULL, varsayılan, açıklama, PK, UNIQUE, indeks, CHECK, FK ve silme davranışı, owned tipler, TPH / TPT / TPC kalıtım, çoka çok ara tablolar; sağlayıcı (SQL Server, PostgreSQL, Oracle, MySQL, SQLite) tahmin edilir. Proje klasörü olduğu gibi açılabilir; entity sınıfları, migration kodu, `appsettings.json`, `bin/` ve `obj/` atlanır. Panelde snapshot'tan gelen tablolara **EF Core** etiketi. Yeni örnek: **Bayi portalı (EF Core)**, DBA betikleriyle karma proje.
  EF Core model snapshot: in .NET projects `Migrations/*ModelSnapshot.cs` is read without converting it to SQL: schema, columns, types, NULL, defaults, comments, PK, UNIQUE, indexes, CHECK, FKs and delete behaviour, owned types, TPH / TPT / TPC inheritance, many-to-many join tables; the provider (SQL Server, PostgreSQL, Oracle, MySQL, SQLite) is guessed. The project folder can be opened as it is; entity classes, migration code, `appsettings.json`, `bin/` and `obj/` are skipped. Tables from the snapshot carry an **EF Core** tag in the panel. New sample: **Dealer portal (EF Core)**, a mixed project with DBA scripts.
- **Yol bulma:** paneldeki **Yol bul** ile iki tablo arasındaki ilişki zinciri; haritada yalnızca yol parlak, panelde adım adım kolonlar (`A.KOLON → B.KOLON`), kısadan uzuna beş seçenek. Sözlük tablolarından ve denetim kolonlarından geçilmez; tanımlı yol yoksa tahmini ilişkiler kullanılır. JOIN SQL'i üretilmez; `?path=A,B`.
  Finding a path: **Find path** in the panel shows the chain of relationships between two tables; only the path stays bright on the map, the panel lists the columns step by step (`A.COL → B.COL`), with five options from shortest to longest. Lookup tables and audit columns are not passed through; inferred relationships are used when there is no declared path. No JOIN SQL is generated; `?path=A,B`.

### Değişti · Changed

- **Tahmini ilişki:** PK'si aynı zamanda FK olan 1:1 alt tablo (`DealerProfiles.DealerId`) artık tahminin hedefi olmaz; `DealerId` kolonu `Dealers`'a bağlanır.
  Inferred relationships: a 1:1 child table whose PK is also an FK (`DealerProfiles.DealerId`) is no longer a target; a `DealerId` column links to `Dealers`.
- **Tasarım denetimi:** kayıt, geçmiş ve arşiv tabloları PascalCase adlarla da tanınır (`OrdersHistory`, `AuditLogs`); PK'siz olmaları bilgi düzeyinde kalır.
  Design audit: log, history and archive tables are recognised with PascalCase names too (`OrdersHistory`, `AuditLogs`); a missing PK stays at info level.

## [0.11.0] - 2026-10-30

### Eklendi · Added

- **Stile göre boya:** adlandırma penceresinde her boyutun **haritada** düğmesi haritayı o boyuta göre boyar; baskın kalıba uymayan öğesi olan tablo o kalıbın rengini alır, kolon düzeyindeki boyutlarda kolon satırları da renklenir; haritanın üstünde açıklama çubuğu; `?style=pkStyle`.
  Colour by style: the **on map** button of each dimension in the naming window colours the map by that dimension; a table with an item outside the dominant pattern takes that pattern's colour, and for column-level dimensions the column rows are tinted too; a legend bar above the map; `?style=pkStyle`.
- **ALTER taslağı:** karşılaştırma ya da zaman çizelgesi açıkken önceki sürümü sonrakine getiren SQL betiği; bağımlılık sırasıyla aşamalar, lehçeye uygun söz dizimi, adım başına notlar (tahmin edilen ad değişikliği, adsız kısıt, varsayılansız `NOT NULL`, veri dönüştürme). Veri kaybettiren adımlar varsayılan olarak yorum satırıdır; `?alter=1`.
  ALTER draft: with a comparison or the timeline active, the SQL script that takes the earlier version to the later one; phases in dependency order, dialect-specific syntax, notes per step (guessed rename, unnamed constraint, `NOT NULL` without a default, data conversion). Data-losing steps are comments by default; `?alter=1`.
- **Tip profili:** adlandırma penceresinde **Veri tipleri** bölümü: tarih kolonları (tarih tipi, metin, sayı), tutar kolonları (ondalık, tamsayı, `FLOAT`, metin) ve evet / hayır kolonlarının kodlaması oranlarıyla; tasarım denetimiyle aynı sınıflandırma, haritada boyama ve Markdown; `?style=dateType`.
  Type profile: a **Data types** section in the naming window: date columns (date type, text, number), amount columns (decimal, integer, `FLOAT`, text) and the encoding of yes / no columns, with their shares; the same classification as the design audit, colouring on the map and Markdown; `?style=dateType`.
- **Prisma ve Diesel migration klasörleri:** sürümün dosya adında değil klasör adında olduğu düzen (`20240115093000_init/migration.sql`, `2024-01-15-093000_init/up.sql`) migration olarak tanınır; zaman çizelgesi, karşılaştırma ve `--since` klasör adını sürüm adı olarak kullanır; Diesel'in `down.sql` dosyaları atlanır.
  Prisma and Diesel migration folders: layouts where the version is in the folder name rather than the file name (`20240115093000_init/migration.sql`, `2024-01-15-093000_init/up.sql`) are recognised as migrations; the timeline, comparison and `--since` use the folder name as the version name; Diesel's `down.sql` files are skipped.
- **ORM'den SQL almak:** README'de EF Core, Hibernate / JPA, Django, Rails, Prisma, Alembic ve Diesel için şemayı SQL olarak alma rehberi.
  Getting SQL from an ORM: a README guide to getting the schema as SQL from EF Core, Hibernate / JPA, Django, Rails, Prisma, Alembic and Diesel.
- **Şema farkında varsayılan ve UNIQUE:** kolon varsayılanı (`DEFAULT`) ve UNIQUE kısıt farkları panelde ve Markdown raporda görünür.
  Defaults and UNIQUE in the schema diff: column default (`DEFAULT`) and UNIQUE constraint differences appear in the panel and the Markdown report.

## [0.10.0] - 2026-10-30

### Eklendi · Added

- **Dışa aktarma:** Markdown veri sözlüğü, Mermaid `erDiagram`, PlantUML (IE), DBML, CSV (Excel) ve haritanın yerleşimiyle SVG. Kapsam: bütün şema, tek şema, alt diyagram ya da seçili tablolar; kopyalama ve indirme; `?export=mermaid`.
  Export: a Markdown data dictionary, Mermaid `erDiagram`, PlantUML (IE), DBML, CSV (Excel) and an SVG with the map's layout. Scope: the whole schema, a single schema, the sub-diagram or the picked tables; copy and download; `?export=mermaid`.
- **KVKK haritası:** kişisel veri tutuyor gibi duran kolonlar (kimlik, iletişim, finans, konum / cihaz, özel nitelikli) ve FK / `@ref` zinciriyle kişiyle ilişkilendirilebilen tablolar; haritada renklendirme, panelde tablonun kişisel verisi, CSV ve Markdown envanter; `?privacy=1`. Bulgular tahmindir, hukuki görüş değildir.
  Personal data map: columns that seem to hold personal data (identity, contact, financial, location / device, special category) and tables that relate to a person through FK / `@ref` chains; colouring on the map, the table's personal data in the panel, a CSV and Markdown inventory; `?privacy=1`. Findings are guesses, not legal advice.

## [0.9.0] - 2026-10-29

### Eklendi · Added

- **Değişiklik incelemesi (PR):** karşılaştırma ya da zaman çizelgesi açıkken bu değişikliğin getirdiği ve giderdiği bulgular; adı değişen tablolar eşlenir, borç sayılmaz. PR yorumu için Markdown rapor, isteğe bağlı düzeltme SQL'iyle; denetim penceresinde özet; `?review=1`.
  Change review (PR): with a comparison or the timeline active, the findings this change brings and resolves; renamed tables are matched and debt is not counted. A Markdown report for a PR comment, optionally with fix SQL; a summary in the audit window; `?review=1`.
- **Komut satırı denetimi:** `tools/sqlschema-lint.js` denetimi, borç kaydını ve değişiklik incelemesini Node'da çalıştırır (`--since V15`, `--baseline <yol>`); metin, Markdown, JSON ve SARIF çıktı; `--fail-on` ile çıkış kodu; `--fix` ile düzeltme SQL'i. README'de GitHub Actions örneği.
  Command-line audit: `tools/sqlschema-lint.js` runs the audit, debt register and change review in Node (`--since V15`, `--baseline <path>`); text, Markdown, JSON and SARIF output; exit code via `--fail-on`; fix SQL via `--fix`. A GitHub Actions example in the README.
- **Standart ve kurallar:** adlandırma profilinden standart önerisi (baskın kalıp belirgin değilse "ekip karar vermeli"); tablo / kolon harf düzeni, PK, FK, tekil / çoğul, ad sınırı, ASCII, zorunlu açıklama ve denetim kolonları; kural başına önem (hata / uyarı / bilgi / kapalı). Kaydedilince denetim, inceleme ve komut satırı standarda göre denetler; standart `*.sqlschema.json` proje dosyasına yazılır. Yeni kurallar: tekil / çoğul, eksik açıklama, eksik denetim kolonu (yalnızca standartta tanımlıysa); `?std=1`.
  Standard and rules: a standard proposed from the naming profile ("the team should decide" when no dominant pattern is clear); table / column case, PK, FK, singular / plural, name limit, ASCII, required comments and audit columns; per-rule severity (error / warning / info / off). Once saved, the audit, review and command line check against the standard; it is written to the `*.sqlschema.json` project file. New rules: singular / plural, missing comment, missing audit column (only when the standard defines them); `?std=1`.
- **Standart belgesi:** kayıtlı standarttan (yoksa öneriden) ekibe gönderilecek Markdown belge; her maddede şemanın kendisinden doğru ve yanlış örnekler, PK'nin en sık tipi, zorunlular, anahtar ve veri tipi önerileri, kural önem tablosu; `?doc=1`.
  Standard document: a Markdown document for the team generated from the saved standard (or the proposal); right and wrong examples from the schema itself for each item, the most common PK type, requirements, key and data type advice, a rule severity table; `?doc=1`.

## [0.8.0] - 2026-10-29

### Eklendi · Added

- **Tasarım denetimi:** 29 kural (anahtarlar ve bütünlük, veri tipleri, normalizasyon, adlandırma); her bulgu ne, neden ve öneriyle. Hata / uyarı / bilgi, addan tahmin edilen bulgular işaretli. Haritada gösterme, panelde tablonun bulguları, en çok bulgu olan tablolar, Markdown inceleme belgesi; `?audit=1`, `?pop=audit`.
  Design audit: 29 rules (keys and integrity, data types, normalisation, naming); each finding with what, why and a suggestion. Error / warning / info, findings guessed from names marked as such. Show on map, the table's findings in the panel, the tables with the most findings, a Markdown review document; `?audit=1`, `?pop=audit`.
- **Borç kaydı:** o anki denetim bulguları "kabul edilmiş borç" olarak kaydedilir; yalnızca yeni bulgular hata sayılır ve haritada görünür, düzeltilenler ödenmiş sayılır. Kayıt tarayıcıda proje adına göre ve paylaşılabilir `*.sqlschema.json` proje dosyasında tutulur; klasördeki proje dosyası otomatik okunur (şema olarak ayrıştırılmaz).
  Debt register: the current audit findings are recorded as "accepted debt"; only new findings count as errors and show on the map, and fixed ones count as paid off. The register is kept in the browser under the project name and in a shareable `*.sqlschema.json` project file; a project file in the folder is read automatically (not parsed as schema).
- **Düzeltme önerileri:** düzeltilebilen bulgular için lehçeye uygun SQL (Oracle, PostgreSQL, SQL Server, MySQL / MariaDB, SQLite): FK ve indeks, devre dışı FK, gereksiz indeks, PK, tip genişletme ve dönüşümü, ad değişiklikleri. Güvenli / gözden geçirin / riskli; adım notları; `ENABLE NOVALIDATE` / `NOT VALID` / `WITH NOCHECK` seçeneği; betiği kopyalama ve `.sql` indirme; panelde bulgu başına SQL; `?fix=1`.
  Fix suggestions: dialect-specific SQL for the findings that can be fixed (Oracle, PostgreSQL, SQL Server, MySQL / MariaDB, SQLite): FKs and indexes, disabled FKs, redundant indexes, PKs, type widening and conversion, renames. Safe / review / risky; step notes; an `ENABLE NOVALIDATE` / `NOT VALID` / `WITH NOCHECK` option; copy the script or download it as `.sql`; per-finding SQL in the panel; `?fix=1`.
- `DROP INDEX` okunur; kaldırılan indeks modelden düşer.
  `DROP INDEX` is read; the dropped index leaves the model.
- **"Hatalı tasarım (DBA incelemesi)" örneği:** düzgün bir şemaya özensiz eklenmiş migration'lar; her denetim kuralı tetiklenir.
  "Flawed design (DBA review)" sample: careless migrations added to a clean schema; every audit rule fires.
- Benzersiz olmayan indeksler (`CREATE INDEX`) modelde tutulur (FK indeksi ve gereksiz indeks denetimi için).
  Non-unique indexes (`CREATE INDEX`) are kept in the model (for the FK-index and redundant-index checks).

## [0.7.0] - 2026-10-29

### Eklendi · Added

- **Şema farkı:** açık dosyalar önceki bir sürümle karşılaştırılır (migration klasöründe bir sürüm ya da ayrıca seçilen dosyalar). Eklenen, silinen, değişen ve adı değişen tablolar haritada renklenir; panelde kolon, PK ve FK farkları; ad değişikliği tahmini; Markdown rapor; `?diff=V3`.
  Schema diff: the open files are compared with an earlier version (a version of a migration folder or separately chosen files). Added, removed, changed and renamed tables are coloured on the map; column, PK and FK differences in the panel; rename guesses; a Markdown report; `?diff=V3`.
- **Migration zaman çizelgesi:** sürümler sırayla oynatılır. Yerleşim bütün sürümlerden bir kez kurulur, tablolar yerinde kalır; her adım bir öncekine göre fark olarak renklenir. Kaydırıcı, `,` / `.`, oynatma; panelde tablonun sürüm geçmişi; `?time=V4`.
  Migration timeline: the versions are played in order. The layout is built once from every version and tables stay in place; each step is coloured as a diff against the previous one. Slider, `,` / `.`, playback; the table's version history in the panel; `?time=V4`.

## [0.6.0] - 2026-10-29

### Eklendi · Added

- **Tablo listesi (`L`):** şema ve takımyıldız başlıkları altında bütün tablolar; dosya sırası ya da A → Z, `↑` / `↓` ile seçim ve harita birlikte ilerler, süzme kutusu, PK yok / M:N / sözlük / dış işaretleri. Görünüm menüsünden açılır, `?list=1`.
  Table list (`L`): every table under schema and constellation headings; file order or A → Z, `↑` / `↓` moves the selection and the map together, a filter box, no-PK / M:N / lookup / external tags. Opened from the View menu, `?list=1`.
- **Alt diyagram:** `Ctrl`/`Cmd` + tık, panel ya da tablo listesiyle seçilen tablolar (isteğe bağlı komşularıyla) kendi yerleşimiyle ayrı bir haritada; panel, arama, liste ve adlandırma profili de yalnızca onlara bakar. **Tümüne dön** ya da `Esc`; `?sub=A,B&near=1`.
  Sub-diagram: tables picked with `Ctrl`/`Cmd` + click, the panel or the table list (optionally with their neighbours) on a separate map with a layout of their own; the panel, search, list and naming profile look only at them. **Back to all** or `Esc`; `?sub=A,B&near=1`.
- **Kayıtlı görünümler:** alt diyagram bir adla kaydedilir; dosya kümesine göre tarayıcıda saklanır, Görünüm menüsünden açılır, silinir; `.sqlschema.json` olarak dışa/içe aktarılır (şemayı içermez).
  Saved views: a sub-diagram is saved under a name; kept in the browser per set of files, opened and deleted from the View menu; exported and imported as `.sqlschema.json` (without the schema).
- **Etki analizi:** seçili tabloya bağlananlar derece derece; her bağlantının silmedeki davranışı (birlikte silinir, boşaltılır, silmeyi engeller, denetlenmez), CASCADE zinciri, kolon düzeyi daraltma, haritada dereceye göre renk, Markdown rapor; `?impact=1`.
  Impact analysis: tables pointing to the selected table, level by level; what each link does on delete (deleted too, set to NULL, blocks the delete, not enforced), the CASCADE chain, column-level narrowing, level colours on the map and a Markdown report; `?impact=1`.

### Değişti · Changed

- **Kolonlar gizliyken** kart başlığında kolon sayısı görünür.
  With columns hidden, the card header shows the column count.
- **Gezinme izi:** adın üzerine gelince şemasıyla tam ad görünür.
  Navigation trail: hovering a name shows the full name with its schema.
- **README:** veritabanı türünün nasıl anlaşıldığını anlatan bölüm (lehçe ipuçları).
  README: a section on how the database type is recognised (dialect hints).

## [0.5.0] - 2026-10-29

### Eklendi · Added

- **Açıklamadaki kod değerleri:** `1 = Aktif, 2 = Pasif`, `A: Aktif; P: Pasif`, `E-Evet / H-Hayır` gibi değer listeleri kolon açıklamasından okunur; panelde kutucuk, kartta `≡` işareti olarak görünür ve aramada bulunur.
  Code values in comments: value lists such as `1 = Active, 2 = Passive`, `A: Active; P: Passive` or `Y-Yes / N-No` are read from column comments; they appear as chips in the panel and a `≡` mark on the card, and are searchable.
- **CHECK, ENUM ve MongoDB enum değerleri:** `CHECK (X IN (…))`, SQL Server `CHECK ([X]='A' OR [X]='P')`, MySQL `ENUM` tipi ve MongoDB `enum` alanları aynı değer kutucuklarıyla gösterilir; anlamları açıklamada yazılıysa birleşir. MongoDB enum'u artık açıklamaya "enum: …" diye eklenmez.
  CHECK, ENUM and MongoDB enum values: `CHECK (X IN (…))`, SQL Server `CHECK ([X]='A' OR [X]='P')`, the MySQL `ENUM` type and MongoDB `enum` fields are shown with the same value chips, combined with meanings written in the comment. MongoDB enums are no longer appended to the comment as "enum: …".
- **Sözlük verisi:** sözlük tablosunun `INSERT … VALUES` satırları okunur; `@ref … (TIP_ID = 7)` ile bağlı kolonda o tipin kodları ve anlamları görünür. Koşulsuz sözlük bağlantısında değer gösterilmez; tablo başına en çok 2 000 satır.
  Lookup data: the `INSERT … VALUES` rows of lookup tables are read; a column linked with `@ref … (TIP_ID = 7)` shows the codes and meanings of that type. Unconditional lookup links show no values; at most 2,000 rows per table.

## [0.4.0] - 2026-10-29

### Eklendi · Added

- **Sözlük tabloları:** en az iki koşullu ilişkinin hedefi olan tablo (genel kod tablosu) sözlük sayılır. Ona giden çizgiler yerine kartta `→ SÖZLÜK` rozeti görünür, yerleşimi çekmez; panelde koşul başına kullanan kolonlar listelenir. Panelden elle açılıp kapatılır; **Görünüm → Sözlük bağlantılarını çiz** ile çizgiler geri gelir.
  Lookup tables: a table that is the target of at least two conditional relationships (a generic code table) counts as a lookup. Lines to it are replaced by a `→ LOOKUP` badge on the card and do not pull the layout; the panel lists the referencing columns per condition. Toggle it by hand in the panel; **View → Draw lookup links** brings the lines back.
- **Örnek:** "Sözlük ağırlıklı (genel kod tablosu)": 30'dan fazla kolon tek bir SOZLUK tablosuna `@ref` ile bağlı.
  Sample: "Lookup-heavy (generic code table)": more than 30 columns point to a single SOZLUK table with `@ref`.
- **URL parametresi:** `center=TABLO` bir tabloyu seçmeden ortalar.
  URL parameter: `center=TABLE` centres a table without selecting it.

## [0.3.1] - 2026-10-29

### Değişti · Changed

- **Dosya takımyıldızları daha belirgin:** aralarındaki boşluk büyüdü, her biri ince bir daireyle sınırlanır ve adı sınırın üstünde, yakın planda da görünür.
  File constellations are more distinct: wider gaps between them, each outlined with a thin circle and named above the outline, also in the close-up.

## [0.3.0] - 2026-10-29

### Eklendi · Added

- **Görünüm menüsü:** kolon ayrıntıları, tahmini ilişkiler ve ızgara seçenekleri üst çubuktan bu menüye taşındı.
  View menu: the column details, inferred relations and grid options moved here from the toolbar.
- **Kolon ayrıntılarını gizleme (`C`):** yakın planda yalnızca tablo adları ve ilişkiler; seçim hatırlanır, `?columns=0` ile de açılır.
  Hide column details (`C`): the close-up shows only table names and relationships; the choice is remembered and can be set with `?columns=0`.
- **Dosya başına takımyıldız:** birden fazla dosya açıldığında her dosyanın tabloları kendi takımyıldızında toplanır, farklı dosyalar birbirinden uzak durur. Migration klasörleri ve MongoDB ad ve ilişkiye göre gruplanır; Görünüm menüsünden ya da `?grouping=` ile değiştirilebilir.
  One constellation per file: with several files open, each file's tables gather in their own constellation and different files stay apart. Migration folders and MongoDB are grouped by name and relationships; change it in the View menu or with `?grouping=`.
- **Gezinme geçmişi ve klavyeyle ilişki izleme:** panelin üstünde gezilen tabloların izi, `‹ ›` ve `Alt` + `←` / `→` ile geri/ileri; `↑` / `↓` ve `Enter` ile ilişkiler arasında dolaşma.
  Navigation history and keyboard relationship following: a trail of visited tables at the top of the panel, back/forward with `‹ ›` and `Alt` + `←` / `→`; move through relationships with `↑` / `↓` and `Enter`.
- **Açıklamadan ilişki (`@ref`):** kolon açıklamasına yazılan `@ref TABLO`, `@ref TABLO.KOLON (KOŞUL)` etiketi FK ile tanımlanamayan ilişkileri (ör. genel sözlük tablosunun bir tipi) haritaya ekler; uzun kesikli çizgi, panelde koşul ve okunuş, bulunamayan hedef için rapor uyarısı.
  Relationships from comments (`@ref`): a `@ref TABLE` or `@ref TABLE.COLUMN (CONDITION)` tag in a column comment adds relationships that cannot be declared as FKs (such as one type in a generic lookup table); drawn long-dashed, with the condition and reading in the panel and a report warning for missing targets.

## [0.2.1] - 2026-10-28

### Değişti · Changed

- **Adlandırma profili, FK kalıpları:** `CREATED_BY`, `UPDATED_BY`, `GUNCELLEYEN` gibi denetim kolonları ayrı sayılır ve orana katılmaz. "Kuralsız" grubu ikiye ayrıldı: yalnızca rol adı (`SAHIBI`) ve hedef adını içermeyen (`CHZ_REF`). Hedefin son kelimesini taşıyan adlar (`AGENT_USER_ID → APP_USER`) rol önekli sayılır.
  Naming profile, FK patterns: audit columns such as `CREATED_BY`, `UPDATED_BY` and `GUNCELLEYEN` are counted separately and left out of the shares. The "irregular" group is split into role name only (`OWNER`) and not containing the target name (`CHZ_REF`). Names carrying the target's last word (`AGENT_USER_ID → APP_USER`) count as role prefixed.
- **Belirgin baskınlık eşiği:** en çok kullanılan kalıbın payı %60'ın altındaysa "baskın" yerine "belirgin baskın kalıp yok" gösterilir.
  Clear-dominance threshold: when the most used pattern has less than 60%, the profile says "no clear dominant pattern" instead of "dominant".

## [0.2.0] - 2026-10-28

### Eklendi · Added

- **Adlandırma profili:** harf düzeni, PK ve FK adı kalıpları, tekil/çoğul, önek, ASCII dışı karakter ve ad uzunluğu için oranlar; baskın kalıp ve ona uymayanlar, şema bazında kapsam, tutarlılık puanı, Markdown olarak indirme.
  Naming profile: shares of case, PK and FK name patterns, singular/plural, prefixes, non-ASCII characters and name length; the dominant pattern and the names that depart from it, per-schema scope, a consistency score and Markdown download.
- **Örnek:** "Karışık adlandırma" (Oracle, iki ekibin farklı alışkanlıkları).
  Sample: "Mixed naming" (Oracle, two teams with different habits).
- **URL parametresi:** `pop=naming|report|files` açılışta bir pencere gösterir.
  URL parameter: `pop=naming|report|files` opens a window on load.

## [0.1.0] - 2026-10-24

İlk açık kaynak sürüm · First open-source release.

### Eklendi · Added

- **Yıldız haritası:** üç yakınlaştırma düzeyi (galaksi, takımyıldız, yakın plan) ve karga ayağı notasyonu.
  Star map with three zoom levels (galaxy, constellation, close-up) and crow's foot notation.
- **Ayrıştırıcılar:** Oracle, SQL Server, MySQL, MariaDB, PostgreSQL, SQLite ve Cassandra (CQL).
  Parsers for Oracle, SQL Server, MySQL, MariaDB, PostgreSQL, SQLite and Cassandra (CQL).
- **MongoDB:** `$jsonSchema` doğrulayıcıları, Mongoose modelleri ve `mongoexport` belgeleri; gömülü belgeler uydu olarak.
  MongoDB support from `$jsonSchema` validators, Mongoose models and `mongoexport` documents; embedded documents shown as satellites.
- **Çoklu dosya:** klasör okuma, Flyway / golang-migrate sırası, son hâli gösteren migration uygulaması, ayrı veritabanı (galaksi) kipi.
  Multiple files and folders, Flyway / golang-migrate ordering, migrations applied to show the final state, separate-database (galaxy) mode.
- **Tahmini ilişkiler:** kolon adlarından, ara tablo (M:N) tespiti.
  Relationships inferred from column names, and junction table (M:N) detection.
- **Arayüz:** arama, odak modu, detay paneli, ayrıştırma raporu, dosya listesi, PNG dışa aktarma.
  Search, focus mode, detail panel, parse report, file list and PNG export.
- **Türkçe ve İngilizce arayüz:** sistem diline göre otomatik seçim.
  Turkish and English interface, chosen automatically from the system language.
- **Paylaşılabilir URL parametreleri:** `lang`, `sample`, `select`, `zoom`, `legend`.
  Shareable URL parameters: `lang`, `sample`, `select`, `zoom`, `legend`.
- **Örnekler:** 12 sentetik sektör örneği ve üreticisi.
  12 synthetic sector samples and their generator.
- **Geliştirme araçları:** test seti, ekran görüntüsü üreticisi.
  Test suite and screenshot generator.

[Yayımlanmamış · Unreleased]: ../../compare/v0.12.0...HEAD
[0.12.0]: ../../compare/v0.11.0...v0.12.0
[0.11.0]: ../../compare/v0.10.0...v0.11.0
[0.10.0]: ../../compare/v0.9.0...v0.10.0
[0.9.0]: ../../compare/v0.8.0...v0.9.0
[0.8.0]: ../../compare/v0.7.0...v0.8.0
[0.7.0]: ../../compare/v0.6.0...v0.7.0
[0.6.0]: ../../compare/v0.5.0...v0.6.0
[0.5.0]: ../../compare/v0.4.0...v0.5.0
[0.4.0]: ../../compare/v0.3.1...v0.4.0
[0.3.1]: ../../compare/v0.3.0...v0.3.1
[0.3.0]: ../../compare/v0.2.1...v0.3.0
[0.2.1]: ../../compare/v0.2.0...v0.2.1
[0.2.0]: ../../compare/v0.1.0...v0.2.0
[0.1.0]: ../../releases/tag/v0.1.0
