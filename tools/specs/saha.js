/*
 * Saha servisi mobil uygulaması — SQLite, `sqlite3 app.db .dump` çıktısı.
 * Teknisyen tabletindeki çevrimdışı önbellek: iş emirleri, kontrol listeleri, parça kullanımı,
 * fotoğraf ve imza, sunucuya eşitleme kuyruğu. FK'ler satır içi REFERENCES ile.
 */
'use strict';

const SPEC = `
customers | | id:int pk ai; remote_id:uuid uq; name nn; phone; email
sites | Hizmet verilen adres | id:int pk ai; remote_id:uuid uq; customer_id:int nn >customers; name nn; address:text; latitude:dec(9,6); longitude:dec(9,6)
asset_types | | id:int pk ai; code nn uq; name nn; checklist_template_id:int >checklist_templates
assets | Sahadaki cihaz (klima, jeneratör, asansör...) | id:int pk ai; remote_id:uuid uq; site_id:int nn >sites; asset_type_id:int nn >asset_types; serial_no; installed_on:date; warranty_until:date
technicians | | id:int pk ai; remote_id:uuid uq; full_name nn; phone; skill_level:int
work_orders | İş emri | id:int pk ai; remote_id:uuid uq; order_no nn uq; site_id:int nn >sites; asset_id:int >assets; assigned_technician_id:int >technicians; priority:int nn; status:str(20) nn; scheduled_at; started_at; completed_at; problem_description:text
work_order_tasks | | id:int pk ai; work_order_id:int nn >work_orders; seq:int nn; title nn; done:bool nn
checklist_templates | | id:int pk ai; name nn; version:int nn
checklist_items | | id:int pk ai; checklist_template_id:int nn >checklist_templates; seq:int nn; question:text nn; answer_type:str(20) nn
checklist_answers | | id:int pk ai; work_order_id:int nn >work_orders; checklist_item_id:int nn >checklist_items; value:text; answered_at
parts | Yedek parça kataloğu | id:int pk ai; part_no nn uq; name nn; unit_price:money
van_stock | Teknisyen aracındaki stok | technician_id:int pk >technicians; part_id:int pk >parts; quantity nn
part_usages | | id:int pk ai; work_order_id:int nn >work_orders; part_id:int nn >parts; quantity nn
time_entries | | id:int pk ai; work_order_id:int nn >work_orders; technician_id:int nn >technicians; started_at nn; ended_at; kind:str(20) nn
photos | | id:int pk ai; work_order_id:int nn >work_orders; local_path:text nn; taken_at nn; uploaded_at
signatures | Müşteri imzası | id:int pk ai; work_order_id:int nn uq >work_orders; signer_name nn; image_path:text nn; signed_at nn
sync_queue | Sunucuya gönderilecek değişiklikler | id:int pk ai; entity:str(40) nn; entity_id:int nn; operation:str(10) nn; payload:json nn; queued_at nn; attempts:int nn
sync_log | | id:int pk ai; direction:str(10) nn; started_at nn; finished_at; records:int; error:text
`;

module.exports = {
  id: 'saha',
  title: 'Saha servisi mobil uygulaması',
  sector: 'Saha servisi',
  dialect: 'SQLite',
  scenario: 'Tabletteki çevrimdışı veritabanının sqlite3 .dump çıktısı: INTEGER PRIMARY KEY AUTOINCREMENT, satır içi REFERENCES, eşitleme kuyruğu.',
  en: { title: 'Field service mobile app', sector: 'Field service', scenario: 'sqlite3 .dump of the tablet\'s offline database: INTEGER PRIMARY KEY AUTOINCREMENT, inline REFERENCES, a sync queue.' },
  build(lib) {
    const t = lib.parseSpec(SPEC);
    return { 'app.db.sql': lib.emitSqlite(t) };
  },
};
