CREATE OR REPLACE VIEW v_open_shipments AS
SELECT s.id, s.tracking_no, s.created_at
FROM shipments s
WHERE NOT EXISTS (SELECT 1 FROM delivery_attempts d WHERE d.shipment_id = s.id AND d.outcome = 'DELIVERED');
