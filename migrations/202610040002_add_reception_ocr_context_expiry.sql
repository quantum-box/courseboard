-- NULL on legacy preview rows means created_at + 24 hours. New rows use the
-- upstream job's exact expiry, including replays after a lost create response.
ALTER TABLE golf_reception_ocr_job_contexts ADD COLUMN expires_at TIMESTAMP(6) NULL;
CREATE INDEX ix_golf_reception_ocr_context_expiry ON golf_reception_ocr_job_contexts (expires_at);
