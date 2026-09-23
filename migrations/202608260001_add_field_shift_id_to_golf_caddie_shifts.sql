-- The Field shift this confirmed day is written through to.
--
-- A caddie working is a fact Field's HRM already models — a `StaffShift` with
-- a staff member, a date, and hours. Which course they stand at and how many
-- rounds they can take is golf's own, and stays here (ADR-0013). Holding the
-- id of the Field row lets a later edit reach the same shift rather than
-- stacking a second one on the same day, and lets a day turned off delete the
-- shift it created instead of leaving Field claiming somebody is at work.
--
-- NULL means no Field shift stands behind this row. Three ways to get there,
-- all ordinary:
--
--   * a row confirmed before this column existed, not yet written through
--   * a caddie with no staff link, so there is no staff member to file under
--     (the roster warns about these; see the broken-link notice)
--   * a day the caddie is not working, where Field holds nothing by design
--
-- Deliberately not UNIQUE. Field owns that id's uniqueness, and a stale
-- duplicate here — two rows briefly pointing at one shift while a write is
-- retried — must not be the thing that fails the write.
ALTER TABLE golf_caddie_shifts
    ADD COLUMN field_shift_id VARCHAR(64) NULL;

-- Kept as a separate ALTER. TiDB serverless validates an index against the
-- pre-ALTER schema, so naming a column added in the same statement fails a
-- fresh replay with 1072 column does not exist — the same way PLT-3825 failed
-- on a CHECK, and the way PLT-3835's own migration failed before it was split.
--
-- Reading by Field id is how a shift is found when Field is the side that
-- changed, and how a write-through reconciles what it already filed.
ALTER TABLE golf_caddie_shifts
    ADD KEY idx_golf_caddie_shifts_field_shift (tenant_id, field_shift_id);
