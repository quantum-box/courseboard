-- Which CourseBoard course a name in the booking system's export refers to.
--
-- The export names courses the way the club's booking system says them —
-- `真駒内`, `滝の` — and CourseBoard holds whatever was typed into it. The two
-- agree often enough that guessing works for the club this was built from, and
-- not at all for the next one: a club whose courses are named differently, or
-- that has registered one of its three so far, or that is importing a course
-- kept for testing.
--
-- Guessing therefore cannot be the only path. This is where the desk's answer
-- lives once, so the same file imports without a word every month after.
--
-- Field has nowhere to keep it: `golf_courses` carries no external identifier,
-- and "what IC Green calls this course" is the golf anti-corruption layer,
-- which is CourseBoard's (ADR-0005).
CREATE TABLE golf_reservation_course_links (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- The course name exactly as the sheet writes it, minus the hole count the
    -- export puts on the line below. Matching is done on a normalized form, but
    -- what is stored is what the desk was shown.
    sheet_label VARCHAR(120) NOT NULL,
    -- NULL means "do not import this one" — a decision, not a gap. A club that
    -- runs three courses and manages one here has to be able to say so once and
    -- stop being asked.
    golf_course_id VARCHAR(64) NULL,
    updated_by VARCHAR(128) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One answer per name. Re-deciding changes it rather than stacking a second
    -- answer the import would have to pick between.
    UNIQUE KEY uq_golf_reservation_course_links_label (tenant_id, sheet_label)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
