-- Daily reservation-count rows imported from an external facility report — a
-- spreadsheet the desk takes off another system, one row per facility,
-- date, and half-day.
--
-- This is operational golf history, not static configuration, and it grows by
-- courses × days × 2 forever; it is the one system whose exit from the Field
-- extension config cannot be a read-time fallback (ADR-0009). Two stores
-- holding answers for the same date cannot be reconciled by a reader, so the
-- move is a one-shot seed: reads fall back to the legacy config copy only
-- while a tenant has no rows here at all, and the first import (or the
-- courseboard-migrate-reservation-reports command) copies the legacy rows in
-- before anything is written.
CREATE TABLE golf_reservation_report_rows (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Where the row lives on the board: a CourseBoard course id, or
    -- `unlinked:<source key>` for a report facility that has no honest
    -- one-course link (some reports aggregate several IN/OUT courses into one
    -- facility). Mirrors the two namespaces the legacy config kept.
    bucket VARCHAR(320) NOT NULL,
    -- The linked course, when the bucket is one. NULL for unlinked rows.
    golf_course_id VARCHAR(64) NULL,
    source_system VARCHAR(64) NOT NULL DEFAULT '',
    -- Identity of the source facility as the report names it. Re-imports
    -- replace by this key, so a facility relinked to another course leaves no
    -- stale copy behind in its old bucket.
    source_course_key VARCHAR(255) NOT NULL,
    source_course_name VARCHAR(255) NOT NULL DEFAULT '',
    report_date DATE NOT NULL,
    -- morning | afternoon; the report's own half-day granularity.
    day_part VARCHAR(16) NOT NULL,
    group_count BIGINT NOT NULL DEFAULT 0,
    caddie_attached_group_count BIGINT NOT NULL DEFAULT 0,
    source_file_sha256 VARCHAR(128) NOT NULL DEFAULT '',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- Written by the application, not ON UPDATE: an unchanged row re-imported
    -- from the same file must keep the timestamp of the import that actually
    -- changed it.
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One answer per half-day per bucket, exactly like the legacy config's
    -- `<date>:<part>` row keys.
    UNIQUE KEY uq_golf_reservation_report_rows (tenant_id, bucket, report_date, day_part),
    -- Replacement on import deletes by the source facility across buckets.
    KEY idx_golf_reservation_report_rows_source (tenant_id, source_course_key)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
