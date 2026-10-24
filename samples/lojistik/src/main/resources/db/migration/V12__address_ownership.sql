-- Adresler artık müşteriye bağlı değil; adres defteri ayrı tabloya taşındı
ALTER TABLE addresses DROP CONSTRAINT address_customer_id_fkey;
ALTER TABLE addresses DROP COLUMN customer_id;

CREATE TABLE customer_addresses (
    customer_id bigint NOT NULL REFERENCES customers(id),
    address_id bigint NOT NULL REFERENCES addresses(id),
    label varchar(30),
    PRIMARY KEY (customer_id, address_id)
);
