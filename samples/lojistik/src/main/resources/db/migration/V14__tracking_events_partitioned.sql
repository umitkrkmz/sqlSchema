-- İzleme olayları aylık partition; yüksek hacim nedeniyle FK yok
CREATE TABLE tracking_events (
    id bigint GENERATED ALWAYS AS IDENTITY,
    shipment_id bigint NOT NULL,
    parcel_id bigint,
    hub_id integer,
    event_code varchar(20) NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE tracking_events_2026_09 PARTITION OF tracking_events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE tracking_events_2026_10 PARTITION OF tracking_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX ix_tracking_events_shipment ON tracking_events (shipment_id, occurred_at DESC);
