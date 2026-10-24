// Keyspace: analytics — Spark işlerinin yazdığı özetler
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
