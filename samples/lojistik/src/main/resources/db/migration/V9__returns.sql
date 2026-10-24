CREATE TABLE return_requests (
    id bigserial PRIMARY KEY,
    original_shipment_id bigint NOT NULL REFERENCES shipments(id),
    return_shipment_id bigint REFERENCES shipments(id),
    reason varchar(200) NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now()
);
