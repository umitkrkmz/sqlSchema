DROP TABLE customer_addresses;
ALTER TABLE addresses ADD COLUMN customer_id bigint REFERENCES customers(id);
