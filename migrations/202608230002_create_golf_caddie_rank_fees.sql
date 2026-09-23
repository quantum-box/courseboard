-- What one round pays a caddie at each rank.
--
-- A club grades its caddies and pays by that grade. Field knows a staff member
-- was assigned to a booking; it has no notion of a caddie grade and no column
-- to pay one by, and adding both would put a golf pay rule into the shared ERP
-- schema (ADR-0005).
--
-- This lived in the golf extension's config JSON, which Field replaces
-- wholesale on every write with no version to compare against, and which now
-- requires the permission that also turns extensions on and off (ADR-0009,
-- ADR-0010). Money the club owes people is the last thing that should sit in a
-- bag two other screens overwrite.
--
-- Ranks are columns rather than rows: the set is closed (A through D), so a new
-- rank is a change to the domain, not a row somebody adds.
CREATE TABLE golf_caddie_rank_fees (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Defaults match what a club that never opened the screen was already being
    -- paid by, so moving the table changes nobody's pay. Not zero: a zero table
    -- reads as "this month cost nothing" on the payroll sheet, which is worse
    -- than a round number that visibly asks to be edited.
    fee_a BIGINT NOT NULL DEFAULT 12000,
    fee_b BIGINT NOT NULL DEFAULT 11000,
    fee_c BIGINT NOT NULL DEFAULT 10000,
    fee_d BIGINT NOT NULL DEFAULT 9000,
    currency CHAR(3) NOT NULL DEFAULT 'JPY',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- Zero is allowed: a club with nobody at that rank yet should not have to
    -- invent an amount. Negative is not — it would pay backwards.
    CONSTRAINT chk_golf_caddie_rank_fees_not_negative
        CHECK (fee_a >= 0 AND fee_b >= 0 AND fee_c >= 0 AND fee_d >= 0),
    -- One table per tenant: setting the fees replaces the row rather than
    -- adding a second the payroll would have to choose between.
    UNIQUE KEY uq_golf_caddie_rank_fees_tenant (tenant_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
