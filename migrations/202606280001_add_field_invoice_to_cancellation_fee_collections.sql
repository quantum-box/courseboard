ALTER TABLE cancellation_fee_collections
    ADD COLUMN field_invoice_id VARCHAR(128);

ALTER TABLE cancellation_fee_collections
    ADD COLUMN field_invoice_payment_url VARCHAR(2048);

CREATE INDEX idx_cancellation_fee_collections_field_invoice
    ON cancellation_fee_collections (tenant_id, field_invoice_id);
