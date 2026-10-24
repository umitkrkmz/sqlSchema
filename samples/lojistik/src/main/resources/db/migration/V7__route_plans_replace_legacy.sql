-- Eski rota tablosu emekliye ayrılıyor
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
