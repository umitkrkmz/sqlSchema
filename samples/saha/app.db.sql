PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT
);
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id TEXT UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  address TEXT,
  latitude NUMERIC,
  longitude NUMERIC
);
CREATE TABLE asset_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  checklist_template_id INTEGER REFERENCES checklist_templates(id)
);
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id TEXT UNIQUE,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  asset_type_id INTEGER NOT NULL REFERENCES asset_types(id),
  serial_no TEXT,
  installed_on TEXT,
  warranty_until TEXT
);
CREATE TABLE technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  skill_level INTEGER
);
CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remote_id TEXT UNIQUE,
  order_no TEXT NOT NULL UNIQUE,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  asset_id INTEGER REFERENCES assets(id),
  assigned_technician_id INTEGER REFERENCES technicians(id),
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  problem_description TEXT
);
CREATE TABLE work_order_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL
);
CREATE TABLE checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer_type TEXT NOT NULL
);
CREATE TABLE checklist_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  checklist_item_id INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  value TEXT,
  answered_at TEXT
);
CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_price NUMERIC
);
CREATE TABLE van_stock (
  technician_id INTEGER NOT NULL REFERENCES technicians(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL,
  PRIMARY KEY (technician_id, part_id)
);
CREATE TABLE part_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  quantity INTEGER NOT NULL
);
CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  kind TEXT NOT NULL
);
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
  local_path TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  uploaded_at TEXT
);
CREATE TABLE signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL UNIQUE REFERENCES work_orders(id),
  signer_name TEXT NOT NULL,
  image_path TEXT NOT NULL,
  signed_at TEXT NOT NULL
);
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  records INTEGER,
  error TEXT
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_sites_customer_id ON sites(customer_id);
CREATE INDEX idx_asset_types_checklist_template_id ON asset_types(checklist_template_id);
CREATE INDEX idx_assets_site_id ON assets(site_id);
CREATE INDEX idx_assets_asset_type_id ON assets(asset_type_id);
CREATE INDEX idx_work_orders_site_id ON work_orders(site_id);
CREATE INDEX idx_work_orders_asset_id ON work_orders(asset_id);
CREATE INDEX idx_work_orders_assigned_technician_id ON work_orders(assigned_technician_id);
CREATE INDEX idx_work_order_tasks_work_order_id ON work_order_tasks(work_order_id);
CREATE INDEX idx_checklist_items_checklist_template_id ON checklist_items(checklist_template_id);
CREATE INDEX idx_checklist_answers_work_order_id ON checklist_answers(work_order_id);
CREATE INDEX idx_checklist_answers_checklist_item_id ON checklist_answers(checklist_item_id);
CREATE INDEX idx_van_stock_technician_id ON van_stock(technician_id);
CREATE INDEX idx_van_stock_part_id ON van_stock(part_id);
CREATE INDEX idx_part_usages_work_order_id ON part_usages(work_order_id);
CREATE INDEX idx_part_usages_part_id ON part_usages(part_id);
CREATE INDEX idx_time_entries_work_order_id ON time_entries(work_order_id);
CREATE INDEX idx_time_entries_technician_id ON time_entries(technician_id);
CREATE INDEX idx_photos_work_order_id ON photos(work_order_id);
CREATE INDEX idx_signatures_work_order_id ON signatures(work_order_id);
COMMIT;
