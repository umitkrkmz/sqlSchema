CREATE TABLE customs_declarations (
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
