ALTER TABLE cancellation_fee_collections
    ADD COLUMN field_invoice_id TEXT;

ALTER TABLE cancellation_fee_collections
    ADD COLUMN field_invoice_payment_url TEXT;

CREATE INDEX idx_cancellation_fee_collections_field_invoice
    ON cancellation_fee_collections (tenant_id, field_invoice_id);
