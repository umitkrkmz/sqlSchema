CREATE TABLE delivery_proofs (
    delivery_attempt_id bigint PRIMARY KEY REFERENCES delivery_attempts(id),
    receiver_name varchar(150),
    receiver_relation varchar(30),
    signature_url text,
    photo_url text,
    otp_verified boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE delivery_proofs IS 'Teslim kanıtı: imza, fotoğraf, SMS doğrulama';
