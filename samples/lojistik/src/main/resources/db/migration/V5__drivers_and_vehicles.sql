CREATE TABLE vehicles (
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
