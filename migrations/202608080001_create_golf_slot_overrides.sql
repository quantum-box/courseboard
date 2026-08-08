-- Desk marks on individual tee times: closed for sale, or sold at a special rate.
--
-- Field generates tee-time inventory from a course's weekly schedule and gives
-- no write API for a single generated slot. A course that wants to stop selling
-- 07:14 on one Saturday can only do it by editing the rule that governs every
-- Saturday, which is not the same decision. These marks are CourseBoard's own
-- (ADR-0005) and sit on top of Field's inventory rather than inside it.
--
-- Keyed by wall clock rather than by Field's slot id: regenerating a schedule
-- rebuilds the slot rows with new ids, and a mark that pointed at an id would
-- quietly detach from the row the operator put it on.
CREATE TABLE golf_slot_overrides (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    slot_date DATE NOT NULL,
    -- The wall clock as the ledger draws it, not a TIME. A TIME column hands
    -- back seconds nobody set and invites arithmetic on a value that is a label
    -- for a row, not a duration.
    tee_time CHAR(5) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    label VARCHAR(120) NULL,
    note VARCHAR(120) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_golf_slot_overrides_kind CHECK (kind IN ('closed', 'special_rate')),
    CONSTRAINT chk_golf_slot_overrides_tee_time
        CHECK (tee_time REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    -- One mark per tee time: re-marking a slot changes it rather than stacking a
    -- second mark that the ledger would have to pick between.
    UNIQUE KEY uq_golf_slot_overrides_slot (tenant_id, golf_course_id, slot_date, tee_time),
    -- The ledger always asks for one day at a time.
    KEY idx_golf_slot_overrides_day (tenant_id, slot_date)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
