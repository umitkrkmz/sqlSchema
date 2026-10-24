/*
 * Lojistik / kargo — PostgreSQL, Flyway migration klasörü (src/main/resources/db/migration).
 * Şema 14 sürümde evrilir: tablo ve kolon adı değiştirme, tablo silme, tip değiştirme, FK kaldırıp
 * yeniden ekleme, partition'lı izleme tablosu. Harita yalnızca son hâli gösterir.
 * U__ (geri alma) betiği ve flyway.conf okunmaz; R__ (tekrarlanabilir) betiği en sonda çalışır.
 */
'use strict';

const DIR = 'src/main/resources/db/migration/';

const MIGRATIONS = {
  'V1__baseline.sql': `-- Başlangıç şeması
CREATE TABLE customer (
    id bigserial PRIMARY KEY,
    tax_no varchar(11),
    name varchar(200) NOT NULL,
    customer_type varchar(10) NOT NULL DEFAULT 'B2C',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE address (
    id bigserial PRIMARY KEY,
    customer_id bigint REFERENCES customer(id),
    city varchar(60) NOT NULL,
    district varchar(60) NOT NULL,
    line text NOT NULL,
    postal_code varchar(10),
    geo_lat numeric(9,6),
    geo_lon numeric(9,6)
);

CREATE TABLE warehouse (
    id serial PRIMARY KEY,
    code varchar(10) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    address_id bigint NOT NULL REFERENCES address(id)
);

CREATE TABLE shipment (
    id bigserial PRIMARY KEY,
    tracking_no varchar(20) NOT NULL UNIQUE,
    sender_id bigint NOT NULL REFERENCES customer(id),
    receiver_address_id bigint NOT NULL REFERENCES address(id),
    origin_warehouse_id integer REFERENCES warehouse(id),
    service_level varchar(20) NOT NULL,
    weight integer,
    declared_value numeric(12,2),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parcel (
    id bigserial PRIMARY KEY,
    shipment_id bigint NOT NULL REFERENCES shipment(id) ON DELETE CASCADE,
    barcode varchar(30) NOT NULL UNIQUE,
    weight integer,
    length_cm integer, width_cm integer, height_cm integer
);

CREATE TABLE legacy_route (
    id serial PRIMARY KEY,
    code varchar(20) NOT NULL,
    description text
);

CREATE TABLE courier (
    id serial PRIMARY KEY,
    full_name varchar(150) NOT NULL,
    phone varchar(20),
    legacy_route_id integer REFERENCES legacy_route(id)
);
`,
  'V2__hubs_and_transfers.sql': `CREATE TABLE hub (
    id serial PRIMARY KEY,
    code varchar(10) NOT NULL UNIQUE,
    name varchar(100) NOT NULL,
    warehouse_id integer REFERENCES warehouse(id),
    hub_type varchar(20) NOT NULL
);

CREATE TABLE hub_transfer (
    id bigserial PRIMARY KEY,
    from_hub_id integer NOT NULL REFERENCES hub(id),
    to_hub_id integer NOT NULL REFERENCES hub(id),
    departed_at timestamptz,
    arrived_at timestamptz,
    vehicle_plate varchar(12)
);

ALTER TABLE parcel ADD COLUMN current_hub_id integer REFERENCES hub(id);
`,
  'V3__pricing.sql': `CREATE TABLE tariff (
    id serial PRIMARY KEY,
    name varchar(100) NOT NULL,
    valid_from date NOT NULL,
    valid_to date
);

CREATE TABLE tariff_zone (
    tariff_id integer NOT NULL REFERENCES tariff(id),
    from_city varchar(60) NOT NULL,
    to_city varchar(60) NOT NULL,
    zone smallint NOT NULL,
    PRIMARY KEY (tariff_id, from_city, to_city)
);

CREATE TABLE price_quote (
    id bigserial PRIMARY KEY,
    customer_id bigint REFERENCES customer(id),
    tariff_id integer NOT NULL REFERENCES tariff(id),
    desi numeric(8,2) NOT NULL,
    amount numeric(12,2) NOT NULL,
    quoted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shipment ADD COLUMN price_quote_id bigint REFERENCES price_quote(id);
`,
  'V4__plural_table_names.sql': `-- Ekip kararı: tablo adları çoğul
ALTER TABLE customer RENAME TO customers;
ALTER TABLE address RENAME TO addresses;
ALTER TABLE shipment RENAME TO shipments;
ALTER TABLE parcel RENAME TO parcels;
ALTER TABLE courier RENAME TO couriers;
ALTER TABLE warehouse RENAME TO warehouses;
ALTER TABLE hub RENAME TO hubs;
ALTER TABLE hub_transfer RENAME TO hub_transfers;
`,
  'V5__drivers_and_vehicles.sql': `CREATE TABLE vehicles (
    id serial PRIMARY KEY,
    plate varchar(12) NOT NULL UNIQUE,
    vehicle_type varchar(20) NOT NULL,
    capacity_kg integer,
    home_hub_id integer REFERENCES hubs(id)
);

ALTER TABLE couriers RENAME TO drivers;
ALTER TABLE drivers ADD COLUMN license_class varchar(5);
ALTER TABLE drivers ADD COLUMN employment_type varchar(20) NOT NULL DEFAULT 'STAFF';

CREATE TABLE driver_shifts (
    id bigserial PRIMARY KEY,
    driver_id integer NOT NULL REFERENCES drivers(id),
    vehicle_id integer REFERENCES vehicles(id),
    hub_id integer NOT NULL REFERENCES hubs(id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz
);
`,
  'V6__delivery_attempts.sql': `CREATE TABLE delivery_attempts (
    id bigserial PRIMARY KEY,
    shipment_id bigint NOT NULL REFERENCES shipments(id),
    driver_id integer REFERENCES drivers(id),
    attempted_at timestamptz NOT NULL,
    outcome varchar(20) NOT NULL,
    failure_reason varchar(200),
    geo_lat numeric(9,6),
    geo_lon numeric(9,6)
);
`,
  'V7__route_plans_replace_legacy.sql': `-- Eski rota tablosu emekliye ayrılıyor
ALTER TABLE drivers DROP COLUMN legacy_route_id;
DROP TABLE legacy_route;

CREATE TABLE route_plans (
    id bigserial PRIMARY KEY,
    driver_shift_id bigint NOT NULL REFERENCES driver_shifts(id),
    planned_for date NOT NULL,
    optimizer_version varchar(20)
);

CREATE TABLE route_stops (
    route_plan_id bigint NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
    seq smallint NOT NULL,
    shipment_id bigint NOT NULL REFERENCES shipments(id),
    eta timestamptz,
    PRIMARY KEY (route_plan_id, seq)
);
`,
  'V8__customs.sql': `CREATE TABLE customs_declarations (
    id bigserial PRIMARY KEY,
    shipment_id bigint NOT NULL UNIQUE REFERENCES shipments(id),
    gtip_code varchar(12) NOT NULL,
    origin_country char(2) NOT NULL,
    declared_value numeric(12,2) NOT NULL,
    currency char(3) NOT NULL,
    cleared_at timestamptz
);

CREATE TABLE customs_items (
    id bigserial PRIMARY KEY,
    customs_declaration_id bigint NOT NULL REFERENCES customs_declarations(id),
    description text NOT NULL,
    quantity integer NOT NULL,
    unit_value numeric(12,2) NOT NULL
);
`,
  'V9__returns.sql': `CREATE TABLE return_requests (
    id bigserial PRIMARY KEY,
    original_shipment_id bigint NOT NULL REFERENCES shipments(id),
    return_shipment_id bigint REFERENCES shipments(id),
    reason varchar(200) NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now()
);
`,
  'V10__proof_of_delivery.sql': `CREATE TABLE delivery_proofs (
    delivery_attempt_id bigint PRIMARY KEY REFERENCES delivery_attempts(id),
    receiver_name varchar(150),
    receiver_relation varchar(30),
    signature_url text,
    photo_url text,
    otp_verified boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE delivery_proofs IS 'Teslim kanıtı: imza, fotoğraf, SMS doğrulama';
`,
  'V11__weights_to_grams.sql': `-- Ağırlıklar kilogramdan grama, kolon adları netleşti
ALTER TABLE shipments RENAME COLUMN weight TO weight_grams;
ALTER TABLE shipments ALTER COLUMN weight_grams TYPE bigint;
ALTER TABLE parcels RENAME COLUMN weight TO weight_grams;
ALTER TABLE parcels ALTER COLUMN weight_grams TYPE bigint;
ALTER TABLE shipments RENAME COLUMN sender_id TO sender_customer_id;
`,
  'V12__address_ownership.sql': `-- Adresler artık müşteriye bağlı değil; adres defteri ayrı tabloya taşındı
ALTER TABLE addresses DROP CONSTRAINT address_customer_id_fkey;
ALTER TABLE addresses DROP COLUMN customer_id;

CREATE TABLE customer_addresses (
    customer_id bigint NOT NULL REFERENCES customers(id),
    address_id bigint NOT NULL REFERENCES addresses(id),
    label varchar(30),
    PRIMARY KEY (customer_id, address_id)
);
`,
  'V13__warehouse_slots.sql': `CREATE TABLE warehouse_slots (
    id bigserial PRIMARY KEY,
    warehouse_id integer NOT NULL REFERENCES warehouses(id),
    aisle varchar(5) NOT NULL,
    rack varchar(5) NOT NULL,
    level smallint NOT NULL,
    UNIQUE (warehouse_id, aisle, rack, level)
);

ALTER TABLE parcels ADD COLUMN warehouse_slot_id bigint REFERENCES warehouse_slots(id);
`,
  'V14__tracking_events_partitioned.sql': `-- İzleme olayları aylık partition; yüksek hacim nedeniyle FK yok
CREATE TABLE tracking_events (
    id bigint GENERATED ALWAYS AS IDENTITY,
    shipment_id bigint NOT NULL,
    parcel_id bigint,
    hub_id integer,
    event_code varchar(20) NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE tracking_events_2026_09 PARTITION OF tracking_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE tracking_events_2026_10 PARTITION OF tracking_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX ix_tracking_events_shipment ON tracking_events (shipment_id, occurred_at DESC);
`,
  'R__reporting_views.sql': `CREATE OR REPLACE VIEW v_open_shipments AS
SELECT s.id, s.tracking_no, s.created_at
FROM shipments s
WHERE NOT EXISTS (SELECT 1 FROM delivery_attempts d WHERE d.shipment_id = s.id AND d.outcome = 'DELIVERED');
`,
  'U12__undo_address_ownership.sql': `DROP TABLE customer_addresses;
ALTER TABLE addresses ADD COLUMN customer_id bigint REFERENCES customers(id);
`,
};

module.exports = {
  id: 'lojistik',
  title: 'Lojistik / kargo',
  sector: 'Lojistik',
  dialect: 'PostgreSQL',
  scenario: 'Flyway migration klasörü, 14 sürüm: tablo ve kolon adı değiştirme, tablo silme, tip değişikliği, FK kaldırma, partition. Harita son hâli gösterir.',
  en: { title: 'Logistics / parcel delivery', sector: 'Logistics', scenario: 'Flyway migration folder, 14 versions: table and column renames, dropped tables, type changes, removed FKs, partitioning. The map shows the final state.' },
  build() {
    const files = {};
    for (const [name, sql] of Object.entries(MIGRATIONS)) files[DIR + name] = sql;
    files['flyway.conf'] = 'flyway.locations=filesystem:src/main/resources/db/migration\nflyway.schemas=public\nflyway.baselineOnMigrate=true\n';
    return files;
  },
};
