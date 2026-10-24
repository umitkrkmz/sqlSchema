/*
 * Telekom şemasının "nesne türüne göre ayrı dosyalar" dışa aktarımı: şema başına bir dosya,
 * PL/SQL paketleri ayrı, bütün FK'ler en sondaki 99_ref_constraints.sql dosyasında.
 * Tek başına açılan bir şema dosyası ilişkisiz görünür; klasör olarak açıldığında birleşir.
 */
'use strict';
const telekom = require('./telekom');

module.exports = {
  id: 'telekom-bolunmus',
  title: 'Telekom, şema başına dosya',
  sector: 'Telekom',
  dialect: 'Oracle',
  scenario: 'Aynı şema 16 dosyaya bölünmüş; FK\'ler en sondaki 99_ref_constraints.sql dosyasında, paketler ayrı dosyada.',
  en: { title: 'Telecom, one file per schema', sector: 'Telecom', scenario: 'The same schema split into 16 files; all FKs live in the final 99_ref_constraints.sql, packages in a separate file.' },
  build: lib => lib.emitOracleDev(telekom.tables(lib), { split: true, extra: telekom.PACKAGES }),
};
