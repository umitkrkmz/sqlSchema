# AGENTS.md

Bu dosya, bu depoda çalışan yapay zekâ kodlama ajanları (Claude Code, Codex, Cursor, Copilot vb.) ve insan katkıcılar için proje rehberidir. Kullanıcıya yönelik anlatım [README.md](README.md)'de, katkı süreci [CONTRIBUTING.md](CONTRIBUTING.md)'dedir.

## Proje

sqlSchema, veritabanı şema dosyalarını (SQL DDL, Cassandra CQL, MongoDB doğrulayıcıları / Mongoose modelleri / JSON belgeleri) tarayıcıda okuyup bir yıldız haritası olarak çizen, sunucusuz, bağımlılıksız bir uygulamadır. Kod yorumları, test çıktıları ve örnek adları Türkçedir; arayüz Türkçe ve İngilizcedir.

## Komutlar

```bash
node tests/run.js                                  # bütün testler; her değişiklikten sonra geçmeli
node tools/gen-samples.js                          # samples/ ve samples/catalog.js'i yeniden üretir
node tools/screenshots.js http://localhost:8000/   # docs/images/ altındaki README görüntüleri (Chrome gerekir)
python -m http.server 8000                         # sayfayı yerelde sunmak için
```

Node 18+ yeterlidir. `npm install` gerekmez; `package.json` yalnızca bu komutları kısayol olarak tanımlar.

## Mimari

Betikler `index.html`'de şu sırayla yüklenir ve her biri `globalThis.sqlSchema` ad alanına ekler:

| Dosya | Görev | DOM |
|---|---|---|
| `js/i18n.js` | TR/EN sözlükler, `t()`, dil seçimi | yalnızca `applyI18n` |
| `js/lexer.js` | tokenizer, ifade ayırıcı (`;`, `/`, `GO`, `DELIMITER`), lehçe tahmini | yok |
| `js/sql-parser.js` | DDL → sıralı işlem listesi (`create`, `fk`, `pk`, `rename`, `drop` ...; ayrıntı dosya başında) | yok |
| `js/mongo.js` | `$jsonSchema`, Mongoose ve JSON belgelerinden aynı işlem listesi | yok |
| `js/files.js` | dosya sıralama (Flyway, golang-migrate), ayrıştırıcı seçimi, ayrı veritabanı adları | yok |
| `js/model.js` | işlemleri dosya sırasıyla uygular; FK çözümleme, kardinalite, ara tablo, tahmini ilişki | yok |
| `js/diff.js` | iki modelin farkı (tablo, kolon, PK, FK), ad değişikliği tahmini; zaman çizelgesi (sürüm adımları, tablo soyu, geçmiş) | yok |
| `js/layout.js` | veritabanı → şema → takımyıldız (dosyaya ya da ada göre) → yıldız, deterministik kuvvet yerleşimi | yok |
| `js/conventions.js` | adlandırma profili: boyutlar, kovalar, oranlar, baskın kalıba uymayanlar (kod döndürür, metin değil) | yok |
| `js/sample-small.js` | gömülü küçük örnek | yok |
| `samples/catalog.js` | örnek kataloğu (üretilir) | yok |
| `js/render.js` | canvas çizimi, kamera, karga ayağı | var |
| `js/ui.js` | yükleme, dosya listesi, arama, panel, rapor, URL parametreleri | var |

Veri akışı: `dosyalar → orderFiles → parseFile (parseSQL | parseMongo) → buildModel → layoutModel → render`.

## Değişmezler

Bunları bozan bir değişiklik yapmayın; gerekirse önce bir issue açın.

1. **Bağımlılık ve derleme yok.** npm paketi, paketleyici, TypeScript derlemesi ya da CDN betiği eklenmez. Yalnızca Google Fonts bağlantısı vardır ve olmadan da çalışır.
2. **Klasik betikler, ES modülü değil.** `type="module"` ve `import` kullanılmaz; sayfa `file://` ile açıldığında da çalışmalıdır. Her dosya `(function (NS) { ... })(globalThis.sqlSchema = globalThis.sqlSchema || {})` kalıbını izler ve dışa açtıklarını `Object.assign(NS, {...})` ile verir.
3. **Çekirdek DOM'a dokunmaz.** `lexer`, `sql-parser`, `mongo`, `files`, `model`, `diff`, `layout`, `conventions` Node'da `require` edilebilmelidir; testler buna dayanır.
4. **Yerleşim deterministiktir.** `Math.random` yoktur; aynı girdi her zaman aynı haritayı verir.
5. **Kart boyutu ile yerleşim yarıçapı bağlıdır.** `render.js`'teki `CARD` (164 × en fazla 127) ile `layout.js`'teki `L.nodeR` (105) birlikte değişir; testler kart çakışmasını denetler.
6. **Her arayüz metni iki dilde.** Kullanıcıya görünen her metin `js/i18n.js`'te hem `tr` hem `en` sözlüğünde bulunur ve `t('anahtar')` ile kullanılır. HTML'de `data-i18n`, `data-i18n-html`, `data-i18n-attr` kullanılır. Testler eksik anahtarı yakalar. Çekirdek modüller metin değil kod döndürür (ör. `skip: 'config'`, `warnings: [{ kind: 'dup', ... }]`); çeviri arayüzde yapılır.
7. **Kullanıcı verisi kaçışlanır.** Dosyalardan gelen her ad, açıklama ve yol DOM'a yalnızca `esc()` ile girer. Tuvale çizilen metin güvenlidir.
8. **Dosyalar tarayıcıdan çıkmaz.** Ağ isteği yalnızca `samples/` altındaki örnekler için yapılır. Analitik, telemetri, harici API eklenmez.
9. **`samples/` üretilir.** Örnekleri elle düzenlemeyin; `tools/specs/` altındaki tanımı değiştirip `node tools/gen-samples.js` çalıştırın. Üretici deterministiktir; CI, üretilmiş dosyaların güncel olduğunu denetler.
10. **Örnekler sentetiktir.** Gerçek bir kuruma ait ya da lisansı belirsiz şema eklenmez.

## Kod stili

- 2 boşluk girinti, tek tırnak, noktalı virgül, `const` öncelikli.
- Yorumlar Türkçe ve kısadır; "ne" yerine "neden"i anlatır. Çevredeki kodun yorum yoğunluğuna uyun.
- Unicode kaçışlarında `À` yerine `\xC0` ya da `\u{2009}` biçimini tercih edin (bazı araçlar `\uXXXX`'i gerçek karaktere çeviriyor).
- Dosyalar UTF-8 (BOM'suz) ve LF satır sonuyla kaydedilir. Tek istisna `samples/banka/CoreBanking.sql`'dir: SSMS'i taklit ettiği için UTF-16'dır.

## Sık yapılan işler

**Yeni bir SQL lehçesi ya da ifade.** `sql-parser.js` yeni ifadeyi mevcut işlem türlerinden birine çevirmelidir. Yeni bir işlem türü gerekiyorsa dosya başındaki listeye ekleyin ve `model.js`'teki `apply` içinde uygulayın. `lexer.js`'teki `DIALECT_HINTS`'e lehçe ipuçlarını, `DIALECTS`'e görünen adı ekleyin. Ardından `tests/run.js`'e bir birim denetimi ekleyin.

**Yeni bir sektör örneği.** `tools/specs/<id>.js` dosyasını yazın:
- `id`, `title`, `sector`, `dialect`, `scenario` alanları
- `en: { title, sector, scenario }` alanı
- `build(lib)` işlevi

Sonra `tools/gen-samples.js`'teki `SPECS` listesine ekleyin, üreticiyi çalıştırın ve `tests/run.js`'teki `EXPECT`'e beklentileri yazın.

**Yeni bir arayüz metni.** Anahtarı `js/i18n.js`'te iki sözlüğe de ekleyin, `t()` ile kullanın, testleri çalıştırın.

## Bitti sayılmadan önce

- `node tests/run.js` hatasız geçer.
- Örnek tanımları değiştiyse `node tools/gen-samples.js` çalıştırıldı ve `samples/` değişiklikleri eklendi.
- Arayüz değiştiyse sayfa bir sunucuyla açılıp TR ve EN dillerinde denendi; konsolda hata yok.
- Görünüm değiştiyse README görüntüleri `tools/screenshots.js` ile yenilendi.
- Kullanıcıya görünen bir davranış değiştiyse README'nin iki dili ve `CHANGELOG.md` güncellendi.
