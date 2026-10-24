CREATE TABLE delivery_attempts (
    id bigserial PRIMARY KEY,
    shipment_id bigint NOT NULL REFERENCES shipments(id),
    driver_id integer REFERENCES drivers(id),
    attempted_at timestamptz NOT NULL,
    outcome varchar(20) NOT NULL,
    failure_reason varchar(200),
    geo_lat numeric(9,6),
    geo_lon numeric(9,6)
);
