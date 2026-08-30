-- When each membership may be played.
--
-- 平日会員 is the point: a club sells a cheaper membership that is only good
-- Monday to Friday. Field's registry has no notion of when a plan may be used
-- and should not — a gym membership is not restricted by tee time (ADR-0005).
--
-- Advisory, not enforcement. CourseBoard warns and saves anyway: the desk takes
-- exceptions every week, and refusing would push them into Field's admin to
-- make the booking, which is the outcome CourseBoard exists to avoid.
CREATE TABLE golf_membership_play_windows (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Field's membership plan id. Not a foreign key: the plans live upstream.
    plan_id VARCHAR(64) NOT NULL,
    -- Monday-first 7-bit set. 0 and 127 both mean "no restriction": a row the
    -- operator started and left blank must not lock a member out of the week.
    playable_days TINYINT UNSIGNED NOT NULL DEFAULT 0,
    -- Course-local clock, not UTC. A 07:00 JST Saturday round is Friday in UTC,
    -- and judging it there would clear a 平日会員 for a weekend.
    from_time TIME NULL,
    to_time TIME NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_golf_membership_play_windows_plan (tenant_id, plan_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
