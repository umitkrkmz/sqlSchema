# Değişiklik geçmişi · Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) biçimini ve [Anlamsal Sürümleme](https://semver.org/lang/tr/)'yi izler.
This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Yayımlanmamış · Unreleased]

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

[Yayımlanmamış · Unreleased]: ../../compare/v0.3.0...HEAD
[0.3.0]: ../../compare/v0.2.1...v0.3.0
[0.2.1]: ../../compare/v0.2.0...v0.2.1
[0.2.0]: ../../compare/v0.1.0...v0.2.0
[0.1.0]: ../../releases/tag/v0.1.0
