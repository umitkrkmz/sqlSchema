-- Başlangıç şeması
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
