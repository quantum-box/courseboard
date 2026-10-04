-- Only configuration is retained here: documents and extracted personal data
-- stay in Field. The original schema survives retries and Lambda replacement.
CREATE TABLE golf_reception_ocr_job_contexts (
    tenant_id VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    job_id VARCHAR(64) COLLATE utf8mb4_bin NULL,
    context_json JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tenant_id, idempotency_key),
    UNIQUE KEY ux_golf_reception_ocr_job_context (tenant_id, job_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
