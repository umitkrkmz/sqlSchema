CREATE TABLE hub (
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
