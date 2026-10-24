# Güvenlik politikası · Security policy

[**Türkçe**](#tr) · [**English**](#en)

<a id="tr"></a>

## Türkçe

### Desteklenen sürümler

Güvenlik düzeltmeleri `main` dalındaki en son sürüme yapılır.

### Tehdit modeli

sqlSchema tamamen tarayıcıda çalışır:
- Sunucu tarafı yoktur.
- Kullanıcının seçtiği dosyalar hiçbir yere gönderilmez.
- Ağ isteği yalnızca depodaki `samples/` örnekleri ve Google Fonts için yapılır.

Bu yüzden en olası riskler, kötü niyetle hazırlanmış bir şema dosyasının şunları yapmasıdır:

- **Betik çalıştırma (XSS):** tablo adı, kolon adı, açıklama ya da dosya yolu üzerinden. Dosyalardan gelen metin DOM'a yalnızca kaçışlanarak eklenir. Bunu aşan bir yol bulursanız lütfen bildirin.
- **Tarayıcıyı kilitlemek:** ayrıştırıcıyı ya da yerleşimi aşırı uzun süren bir döngüye sokmak.
- **Dosyaların okunması ya da dışarı gönderilmesi:** sayfanın kullanıcının seçmediği dosyalara erişmesi ya da içerikleri bir yere göndermesi.

### Açık bildirmek

Lütfen güvenlik açıklarını **herkese açık bir issue ile bildirmeyin.**

1. Depo sayfasında **Security → Report a vulnerability** ile özel bir bildirim (GitHub Private Vulnerability Reporting) açın.
2. Açığı yeniden üreten en küçük dosyayı ve adımları ekleyin. Gerçek bir kuruma ait şema eklemeyin.
3. Bildirime 7 gün içinde yanıt vermeye çalışırız. Düzeltme yayımlandıktan sonra, isterseniz katkınız CHANGELOG'da anılır.

<p align="right"><a href="#tr">↑ başa dön</a></p>

---

<a id="en"></a>

## English

### Supported versions

Security fixes are made to the latest version on the `main` branch.

### Threat model

sqlSchema runs entirely in the browser:
- There is no server side.
- Files the user selects are never sent anywhere.
- The only network requests are for the repository's `samples/` and Google Fonts.

The most likely risks are therefore a maliciously crafted schema file that can:

- **Run script (XSS)** through a table name, column name, comment or file path. Text from files is inserted into the DOM only after escaping. Please report any way around this.
- **Freeze the browser** by driving the parser or layout into an excessively long loop.
- **Read or send out files** the user did not select.

### Reporting a vulnerability

Please **do not report security issues in a public issue.**

1. Use **Security → Report a vulnerability** on the repository page to open a private report (GitHub Private Vulnerability Reporting).
2. Include the smallest file and the steps that reproduce the issue. Do not include a schema that belongs to a real organisation.
3. We aim to respond within 7 days. Once a fix is released, your contribution can be credited in the CHANGELOG if you wish.

<p align="right"><a href="#en">↑ back to top</a></p>
