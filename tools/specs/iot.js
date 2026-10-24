/*
 * IoT telemetri — Apache Cassandra (CQL), iki keyspace.
 * Cassandra'da FK ve JOIN yoktur; veri "sorgu başına bir tablo" ilkesiyle çoğaltılır.
 * Harita ilişkileri yalnızca kolon adlarından (device_id, site_id ...) tahmin eder;
 * kartlarda bölüm anahtarı PK, sıralama anahtarı CK olarak görünür.
 */
'use strict';

const TELEMETRY = `// Keyspace: telemetry — cihaz, saha ve ölçüm verisi
CREATE KEYSPACE IF NOT EXISTS telemetry
  WITH replication = {'class': 'NetworkTopologyStrategy', 'ist1': 3, 'ank1': 3}
  AND durable_writes = true;

USE telemetry;

CREATE TYPE IF NOT EXISTS geo_point (lat double, lon double, alt_m float);
CREATE TYPE IF NOT EXISTS firmware_ref (version text, channel text, installed_at timestamp);

-- Kuruluşlar ve kullanıcılar
CREATE TABLE IF NOT EXISTS customers (
    customer_id uuid PRIMARY KEY,
    name text,
    tier text,
    created_at timestamp
);

CREATE TABLE IF NOT EXISTS users_by_email (
    email text PRIMARY KEY,
    user_id uuid,
    customer_id uuid,
    password_hash text,
    roles set<text>
);

CREATE TABLE IF NOT EXISTS sites (
    site_id uuid PRIMARY KEY,
    customer_id uuid,
    name text,
    location frozen<geo_point>,
    timezone text,
    tags map<text, text>
);

CREATE TABLE IF NOT EXISTS sites_by_customer (
    customer_id uuid,
    site_id uuid,
    name text,
    PRIMARY KEY ((customer_id), site_id)
);

-- Cihazlar
CREATE TABLE IF NOT EXISTS devices (
    device_id uuid PRIMARY KEY,
    site_id uuid,
    serial_no text,
    model text,
    firmware frozen<firmware_ref>,
    sensors list<text>,
    provisioned_at timestamp,
    decommissioned_at timestamp
);

CREATE TABLE IF NOT EXISTS devices_by_site (
    site_id uuid,
    device_id uuid,
    model text,
    status text,
    last_seen_at timestamp,
    PRIMARY KEY ((site_id), device_id)
);

CREATE TABLE IF NOT EXISTS device_by_serial (
    serial_no text PRIMARY KEY,
    device_id uuid
);

CREATE TABLE IF NOT EXISTS sensors_by_device (
    device_id uuid,
    sensor_id text,
    metric text,
    unit text,
    min_value double,
    max_value double,
    PRIMARY KEY ((device_id), sensor_id)
);

-- Ölçümler: cihaz + gün bölümü, zaman sıralı
CREATE TABLE IF NOT EXISTS readings_by_device_day (
    device_id uuid,
    day date,
    ts timestamp,
    sensor_id text,
    value double,
    quality tinyint,
    PRIMARY KEY ((device_id, day), ts, sensor_id)
) WITH CLUSTERING ORDER BY (ts DESC, sensor_id ASC)
  AND default_time_to_live = 7776000
  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};

CREATE TABLE IF NOT EXISTS latest_reading_by_device (
    device_id uuid,
    sensor_id text,
    ts timestamp,
    value double,
    PRIMARY KEY ((device_id), sensor_id)
);

-- Alarmlar
CREATE TABLE IF NOT EXISTS alerts_by_site_day (
    site_id uuid,
    day date,
    alert_id timeuuid,
    device_id uuid,
    severity text,
    rule_id uuid,
    message text,
    acknowledged boolean,
    PRIMARY KEY ((site_id, day), alert_id)
) WITH CLUSTERING ORDER BY (alert_id DESC);

CREATE TABLE IF NOT EXISTS alerts_by_device (
    device_id uuid,
    alert_id timeuuid,
    severity text,
    rule_id uuid,
    message text,
    PRIMARY KEY ((device_id), alert_id)
) WITH CLUSTERING ORDER BY (alert_id DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
    rule_id uuid PRIMARY KEY,
    customer_id uuid,
    metric text,
    operator text,
    threshold double,
    window_seconds int,
    enabled boolean
);

-- Komutlar ve bakım
CREATE TABLE IF NOT EXISTS commands_by_device (
    device_id uuid,
    command_id timeuuid,
    command text,
    payload blob,
    status text,
    issued_by uuid,
    PRIMARY KEY ((device_id), command_id)
) WITH CLUSTERING ORDER BY (command_id DESC);

CREATE TABLE IF NOT EXISTS maintenance_by_site (
    site_id uuid,
    scheduled_for date,
    work_id uuid,
    device_id uuid,
    technician text,
    notes text,
    PRIMARY KEY ((site_id), scheduled_for, work_id)
);

CREATE TABLE IF NOT EXISTS device_counters (
    device_id uuid PRIMARY KEY,
    messages_total counter,
    errors_total counter
);

CREATE MATERIALIZED VIEW IF NOT EXISTS devices_by_model AS
  SELECT model, device_id, site_id FROM devices
  WHERE model IS NOT NULL AND device_id IS NOT NULL
  PRIMARY KEY ((model), device_id);
`;

const ANALYTICS = `// Keyspace: analytics — Spark işlerinin yazdığı özetler
CREATE KEYSPACE IF NOT EXISTS analytics
  WITH replication = {'class': 'NetworkTopologyStrategy', 'ist1': 2};

CREATE TABLE IF NOT EXISTS analytics.rollup_hourly_by_device (
    device_id uuid,
    hour timestamp,
    sensor_id text,
    min_value double,
    max_value double,
    avg_value double,
    samples int,
    PRIMARY KEY ((device_id), hour, sensor_id)
) WITH CLUSTERING ORDER BY (hour DESC, sensor_id ASC);

CREATE TABLE IF NOT EXISTS analytics.rollup_daily_by_site (
    site_id uuid,
    day date,
    metric text,
    avg_value double,
    p95_value double,
    PRIMARY KEY ((site_id), day, metric)
);

CREATE TABLE IF NOT EXISTS analytics.energy_by_customer_month (
    customer_id uuid,
    month text,
    site_id uuid,
    kwh double,
    cost decimal,
    PRIMARY KEY ((customer_id, month), site_id)
);

CREATE TABLE IF NOT EXISTS analytics.anomaly_scores (
    device_id uuid,
    day date,
    score double,
    model_version text,
    PRIMARY KEY ((device_id), day)
);
`;

module.exports = {
  id: 'iot',
  title: 'IoT telemetri',
  sector: 'Enerji / IoT',
  dialect: 'Cassandra',
  scenario: 'İki keyspace, sorgu başına tablo tasarımı: FK yok, bölüm ve sıralama anahtarları, UDT\'ler, materialized view.',
  en: { title: 'IoT telemetry', sector: 'Energy / IoT', scenario: 'Two keyspaces, table-per-query design: no FKs, partition and clustering keys, UDTs, a materialized view.' },
  build: () => ({ 'cql/01_telemetry.cql': TELEMETRY, 'cql/02_analytics.cql': ANALYTICS }),
};
