# Değişiklik geçmişi · Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) biçimini ve [Anlamsal Sürümleme](https://semver.org/lang/tr/)'yi izler.
This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Yayımlanmamış · Unreleased]

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

[Yayımlanmamış · Unreleased]: ../../compare/v0.1.0...HEAD
[0.1.0]: ../../releases/tag/v0.1.0
