-- Validation/staging never changes reservation-count snapshots. The owning
-- application commits the replacement and its once-only receipt together.
CREATE TABLE courseboard_common_import_jobs (
    tenant_id VARCHAR(255) NOT NULL,
    job_id VARCHAR(64) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    source_sha256 CHAR(64) NOT NULL,
    options_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'validating',
    result_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tenant_id, job_id)
);
CREATE TABLE courseboard_common_import_rows (
    tenant_id VARCHAR(255) NOT NULL,
    job_id VARCHAR(64) NOT NULL,
    identity_hash CHAR(64) NOT NULL,
    source_row_number BIGINT UNSIGNED NOT NULL,
    object_json JSON NOT NULL,
    object_hash CHAR(64) NOT NULL,
    source_course_key VARCHAR(255) NOT NULL,
    bucket VARCHAR(320) NOT NULL,
    golf_course_id VARCHAR(64) NULL,
    report_date DATE NOT NULL,
    day_part VARCHAR(16) NOT NULL,
    staged BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tenant_id, job_id, identity_hash),
    UNIQUE KEY uq_common_import_bucket (tenant_id, job_id, bucket, report_date, day_part),
    KEY idx_common_import_source (tenant_id, job_id, source_course_key)
);

CREATE TABLE courseboard_common_import_facilities (
    tenant_id VARCHAR(255) NOT NULL,
    job_id VARCHAR(64) NOT NULL,
    source_course_key VARCHAR(255) NOT NULL,
    bucket VARCHAR(320) NOT NULL,
    before_hash CHAR(64) NOT NULL,
    PRIMARY KEY (tenant_id, job_id, source_course_key)
);
