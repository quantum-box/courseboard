-- When the summaries were last worked out, and whether it finished.
--
-- A refresh that quietly stopped running leaves a table full of plausible
-- figures that are months old, and a desk ringing people who came in last week.
-- Nothing in the numbers themselves says so, so the screen shows the last run
-- and the age of it beside the list.
--
-- Kept as a history rather than one row per tenant: a run that fails needs to
-- be readable next to the last one that worked.
CREATE TABLE golf_customer_summary_runs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- NULL while the run is still going, and after a process that died without
    -- being able to write its own ending.
    finished_at TIMESTAMP(6) NULL,
    -- running | succeeded | failed. Free text rather than an enum for the same
    -- reason the rest of this schema avoids them: a new outcome should not need
    -- a migration.
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    reservations_scanned BIGINT NOT NULL DEFAULT 0,
    customers_written BIGINT NOT NULL DEFAULT 0,
    -- Why it failed, in the words the gateway used. Read by whoever is asked
    -- why the list looks stale.
    error TEXT NULL,
    KEY ix_golf_customer_summary_runs_tenant (tenant_id, started_at)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
