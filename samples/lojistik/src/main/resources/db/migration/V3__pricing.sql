CREATE TABLE tariff (
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
