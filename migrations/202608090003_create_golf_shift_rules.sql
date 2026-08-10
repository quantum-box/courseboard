-- Club rules the monthly shift plan is built against.
--
-- The Labour Standards Act sets the ceiling (six working days in a row), but
-- where the rest day lands inside that window is the club's call: a course
-- whose Saturdays fill and whose Sundays are quiet wants only Saturday held
-- back, and the next club along wants both. Field has no notion of a golf
-- club's busy days, so it is CourseBoard's own data (ADR-0005).
CREATE TABLE golf_shift_rules (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Weekdays to keep clear of rest days, as `mon,tue,...`. Empty means the
    -- plan may rest anybody on any day. A preference, not a ban: when the
    -- six-day limit leaves nothing else in the window, a protected day is
    -- still used rather than breaking the law.
    avoided_rest_weekdays VARCHAR(32) NOT NULL DEFAULT 'sat,sun',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One set of rules per tenant: changing them replaces the row rather than
    -- adding a second the plan would have to choose between.
    UNIQUE KEY uq_golf_shift_rules_tenant (tenant_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
