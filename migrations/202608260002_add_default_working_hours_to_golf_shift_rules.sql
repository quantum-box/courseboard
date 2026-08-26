-- The club's working hours, for the days a course schedule cannot answer.
--
-- A shift is confirmed as a span — the whole day, the morning, the afternoon —
-- because that is what the desk decides. Field's `StaffShift` wants a start
-- and an end, so the span has to become clock times before it can be written
-- there.
--
-- Nearly always the course answers: its reception schedule says which weekdays
-- it sends groups out and between which times, and a break between two bands
-- is the handover the club already runs. Reading the hours off that keeps one
-- answer in one place, per course, with no second setting to keep in step.
--
-- Two days a year it cannot, and both are ordinary:
--
--   * a shift confirmed with no course on it (`golf_course_id IS NULL`) —
--     someone is working, nobody has said where yet
--   * a weekday the course does not open
--
-- These columns are what those fall back to. They live here rather than as
-- constants in the code because the number reaches Field's payroll: a club
-- that starts at six should not be filed as starting at seven because a
-- developer picked seven.
--
-- Minutes past midnight rather than TIME, so the arithmetic that splits a day
-- into halves needs no conversion and cannot land on a value no clock reads
-- (the domain refuses 24:00 for the same reason).
--
-- The defaults below are a starting point, not a measurement: 07:00-17:00 with
-- the handover at noon. Any club whose courses have a schedule never reaches
-- them. A settings screen can expose these later; until then a tenant that
-- needs different hours changes the row.
ALTER TABLE golf_shift_rules
    ADD COLUMN default_work_start_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 420,
    ADD COLUMN default_work_end_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 1020,
    ADD COLUMN default_midday_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 720;

-- Kept as a separate ALTER. TiDB serverless validates a CHECK expression
-- against the pre-ALTER schema, so referencing columns added in the same
-- statement fails a fresh replay with 1054 unknown column (PLT-3825).
--
-- The order is what the domain requires to split a day at all: a handover
-- outside the working day leaves one half empty, and an end before the start
-- leaves no day to divide.
--
-- Documentation more than enforcement: TiDB ships with
-- `tidb_enable_check_constraint` off and accepts the clause without applying
-- it (checked against v8.5.7). It is kept because it states the invariant
-- where the columns are defined, and a target that does enforce it would be
-- right to. The reader falls back to the club default rather than trusting it.
ALTER TABLE golf_shift_rules
    ADD CONSTRAINT chk_golf_shift_rules_working_hours
        CHECK (default_work_start_minutes < default_midday_minutes
               AND default_midday_minutes < default_work_end_minutes
               AND default_work_end_minutes < 1440);
