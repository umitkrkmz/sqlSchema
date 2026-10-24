-- Ağırlıklar kilogramdan grama, kolon adları netleşti
ALTER TABLE shipments RENAME COLUMN weight TO weight_grams;
ALTER TABLE shipments ALTER COLUMN weight_grams TYPE bigint;
ALTER TABLE parcels RENAME COLUMN weight TO weight_grams;
ALTER TABLE parcels ALTER COLUMN weight_grams TYPE bigint;
ALTER TABLE shipments RENAME COLUMN sender_id TO sender_customer_id;
