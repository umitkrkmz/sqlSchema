CREATE TABLE warehouse_slots (
    id bigserial PRIMARY KEY,
    warehouse_id integer NOT NULL REFERENCES warehouses(id),
    aisle varchar(5) NOT NULL,
    rack varchar(5) NOT NULL,
    level smallint NOT NULL,
    UNIQUE (warehouse_id, aisle, rack, level)
);

ALTER TABLE parcels ADD COLUMN warehouse_slot_id bigint REFERENCES warehouse_slots(id);
