CREATE TABLE cancellation_fee_collections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    reference TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'JPY',
    due_date TEXT NOT NULL,
    reason TEXT,
    notes TEXT,
    public_token TEXT NOT NULL UNIQUE,
    payment_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),
    sms_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (sms_status IN ('not_requested', 'skipped', 'sent', 'failed')),
    sms_message TEXT,
    sms_provider_message_id TEXT,
    sms_error TEXT,
    stripe_payment_intent_id TEXT,
    stripe_client_secret TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cancellation_fee_collections_tenant_created
    ON cancellation_fee_collections (tenant_id, created_at DESC);

CREATE INDEX idx_cancellation_fee_collections_public_token
    ON cancellation_fee_collections (public_token);
