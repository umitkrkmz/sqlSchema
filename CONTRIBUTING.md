# Katkı rehberi · Contributing

[**Türkçe**](#tr) · [**English**](#en)

<a id="tr"></a>

## Türkçe

sqlSchema'ya katkıda bulunmak istediğiniz için teşekkürler. Hata bildirimi, yeni lehçe desteği, sektör örneği, çeviri düzeltmesi ya da belge iyileştirmesi; hepsi değerli.

### Başlamadan önce

- Davranış kurallarımızı okuyun: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Güvenlik açıklarını herkese açık bir issue ile değil, [SECURITY.md](SECURITY.md)'deki yolla bildirin.
- Büyük bir değişiklik düşünüyorsanız önce bir issue açıp yaklaşımı konuşalım.

### Hata bildirmek

Issue açarken şunları ekleyin:

- Tarayıcı ve sürümü, sayfanın nasıl açıldığı (`file://` ya da bir sunucu).
- Arayüzün hangi dilde olduğu.
- Sağ alttaki **rapor** penceresinin içeriği: okunamayan ifadeler ve hatalar satır numarasıyla orada yazar.
- Hatayı üreten **en küçük** şema parçası.

> **Gerçek bir kuruma ait şema paylaşmayın.** Tablo ve kolon adlarını değiştirmek, hatayı yeniden üretmek için genellikle yeterlidir.

### Geliştirme ortamı

Derleme adımı ve bağımlılık yoktur. Node 18+ ve bir tarayıcı yeterlidir.

```bash
git clone <depo-adresi>
cd sqlSchema
python -m http.server 8000      # sayfayı http://localhost:8000 adresinde açın
node tests/run.js               # testler
```

### Değişiklik yaparken

- Mimari ve değişmezler [AGENTS.md](AGENTS.md)'de anlatılır. Özellikle şunlara dikkat edin:
  - bağımlılık ve derleme eklemeyin
  - ES modülü kullanmayın
  - çekirdek modüller DOM'a dokunmasın
  - yerleşim deterministik kalsın
- **Her arayüz metni iki dilde olmalı.** Anahtarı `js/i18n.js`'te hem `tr` hem `en` sözlüğüne ekleyin. Testler eksik anahtarı yakalar.
- **Örnekler üretilir.** `samples/` altını elle düzenlemeyin. `tools/specs/` altındaki tanımı değiştirip `node tools/gen-samples.js` çalıştırın.
- **Örnekler sentetik olmalı.** Lisansı belirsiz ya da gerçek bir kuruma ait şema eklemeyin.
- Kod stili: 2 boşluk, tek tırnak, noktalı virgül. Yorumlar kısa ve Türkçe, "ne" yerine "neden"i anlatır.
- Yeni bir ayrıştırıcı davranışı için `tests/run.js`'e bir denetim ekleyin.

### Pull request

1. Depoyu çatallayın (fork) ve bir dal açın: `feature/cassandra-udt` ya da `fix/mysql-delimiter` gibi.
2. Değişikliği küçük ve tek konulu tutun.
3. Göndermeden önce:
   - `node tests/run.js` hatasız geçmeli.
   - Örnek tanımları değiştiyse `node tools/gen-samples.js` çalıştırıp çıktıyı ekleyin.
   - Arayüz değiştiyse sayfayı TR ve EN dillerinde deneyin; görünüm değiştiyse `node tools/screenshots.js http://localhost:8000/` ile README görüntülerini yenileyin.
   - Kullanıcıya görünen bir davranış değiştiyse README'nin iki dilini ve `CHANGELOG.md`'yi güncelleyin.
4. PR açıklamasında neyi neden değiştirdiğinizi ve nasıl denediğinizi yazın.

Commit mesajları kısa ve emir kipinde olsun: `Cassandra UDT kolonlarını oku`, `Fix MySQL DELIMITER handling`. Türkçe ya da İngilizce olabilir.

### Lisans

Gönderdiğiniz katkılar projenin [MIT lisansı](LICENSE) altında yayımlanır.

<p align="right"><a href="#tr">↑ başa dön</a></p>

---

<a id="en"></a>

## English

Thank you for considering a contribution to sqlSchema. Bug reports, new dialect support, sector samples, translation fixes and documentation improvements are all welcome.

### Before you start

- Read our [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security issues as described in [SECURITY.md](SECURITY.md), not in a public issue.
- For larger changes, please open an issue first so we can agree on the approach.

### Reporting bugs

Please include:

- Browser and version, and how the page was opened (`file://` or a server).
- The interface language.
- The contents of the **report** window in the bottom-right corner: unread statements and errors are listed there with line numbers.
- The **smallest** schema fragment that reproduces the problem.

> **Do not share a schema that belongs to a real organisation.** Renaming tables and columns is usually enough to reproduce the issue.

### Development setup

There is no build step and no dependencies. Node 18+ and a browser are all you need.

```bash
git clone <repository-url>
cd sqlSchema
python -m http.server 8000      # open http://localhost:8000
node tests/run.js               # tests
```

### Making changes

- Architecture and invariants are described in [AGENTS.md](AGENTS.md). In particular:
  - no dependencies or build steps
  - no ES modules
  - core modules must not touch the DOM
  - the layout must stay deterministic
- **Every UI string must exist in both languages.** Add the key to both the `tr` and `en` dictionaries in `js/i18n.js`. The tests catch missing keys.
- **Samples are generated.** Do not edit `samples/` by hand. Change the definition under `tools/specs/` and run `node tools/gen-samples.js`.
- **Samples must be synthetic.** Do not add schemas from real organisations or with unclear licensing.
- Code style: 2-space indentation, single quotes, semicolons. Comments are short, in Turkish, and explain *why* rather than *what*.
- Add a check to `tests/run.js` for any new parser behaviour.

### Pull requests

1. Fork the repository and create a branch, such as `feature/cassandra-udt` or `fix/mysql-delimiter`.
2. Keep the change small and focused on one topic.
3. Before submitting:
   - `node tests/run.js` passes.
   - If sample definitions changed, run `node tools/gen-samples.js` and include the output.
   - If the UI changed, try the page in both TR and EN. If the look changed, refresh the README images with `node tools/screenshots.js http://localhost:8000/`.
   - If user-visible behaviour changed, update both languages of the README and `CHANGELOG.md`.
4. In the PR description, explain what changed, why, and how you tested it.

Use short, imperative commit messages, such as `Read Cassandra UDT columns` or `Fix MySQL DELIMITER handling`, in Turkish or English.

### License

By contributing, you agree that your contributions are released under the project's [MIT license](LICENSE).

<p align="right"><a href="#en">↑ back to top</a></p>
