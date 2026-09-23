CREATE TABLE cancellation_fee_collections (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    reference VARCHAR(255),
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(32) NOT NULL,
    amount BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'JPY',
    due_date DATE NOT NULL,
    reason TEXT,
    notes TEXT,
    public_token VARCHAR(128) NOT NULL,
    payment_url VARCHAR(2048) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    sms_status VARCHAR(16) NOT NULL DEFAULT 'not_requested',
    sms_message TEXT,
    sms_provider_message_id VARCHAR(255),
    sms_error TEXT,
    stripe_payment_intent_id VARCHAR(255),
    stripe_client_secret VARCHAR(255),
    paid_at TIMESTAMP(6) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_cancellation_fee_amount CHECK (amount > 0),
    CONSTRAINT chk_cancellation_fee_status CHECK (
        status IN ('pending', 'paid', 'cancelled', 'expired')
    ),
    CONSTRAINT chk_cancellation_fee_sms_status CHECK (
        sms_status IN ('not_requested', 'skipped', 'sent', 'failed')
    ),
    UNIQUE KEY uq_cancellation_fee_public_token (public_token)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE INDEX idx_cancellation_fee_collections_tenant_created
    ON cancellation_fee_collections (tenant_id, created_at);
