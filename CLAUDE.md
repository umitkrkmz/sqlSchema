# CLAUDE.md

Proje rehberinin tamamı AGENTS.md'dedir; Claude Code bu satırla onu da yükler:

@AGENTS.md

## Claude Code'a özel notlar

- **Windows PowerShell 5.1'de UTF-8 dosyaları `Get-Content` / `Set-Content` ile düzenlemeyin.** Varsayılan kod sayfası (cp1254) Türkçe karakterleri bozar ve `-Encoding utf8` BOM ekler. Düzenleme için Edit aracını, toplu işler için Node betiklerini kullanın.
- Unicode kaçışlarında `\xC0` ya da `\u{2009}` biçimini kullanın; `À` yazıldığında araçlar onu gerçek karaktere çevirebiliyor.
- Arayüzü denemek için `.claude/launch.json`'daki `static` sunucusu (port 8765) kullanılabilir. Değişiklikten sonra sayfayı yeniden yükleyip konsol hatalarına bakın; tarayıcı eski betiği önbellekten verebilir.
- Uzun süren komutlar (örnek üretimi, ekran görüntüleri) çıktısını `Select-Object -First N` ile kesmeyin; bu, işlemi yarıda durdurur.
