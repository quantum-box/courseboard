-- The confirmed shift for one caddie on one day, and the course they work it.
--
-- What the desk had until now was the shift *request* (caddie_ops.rs: a day
-- with no request on file reads as available), which lives in Field and has
-- nowhere to record a course. But a course sells caddie-attached tee times
-- against the caddies actually standing there that morning, so the placement
-- has to be decided before the day is sold — and "this caddie works B course
-- on the 12th" is a golf dispatch decision Field's generic HRM cannot carry
-- (ADR-0005). It is CourseBoard's own data, like the filing deadline.
CREATE TABLE golf_caddie_shifts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    shift_date DATE NOT NULL,
    caddie_id VARCHAR(64) NOT NULL,
    -- The course this caddie works that day. NULL means confirmed but not
    -- placed anywhere: somebody with no main course yet, or a day off. An
    -- unplaced caddie counts towards nobody's supply, which is what makes the
    -- gap visible instead of silently inflating a course's capacity.
    golf_course_id VARCHAR(64) NULL,
    is_working BOOLEAN NOT NULL,
    -- full_day / morning / afternoon, carried over from the half-day request.
    span VARCHAR(16) NOT NULL,
    -- Rounds this caddie can take that day: 0 when off, 1 normally, 2 when
    -- they can and asked to go round twice. This is what a course's supply is
    -- summed from.
    rounds_capacity INT NOT NULL,
    -- generated / edited / pinned. Regenerating a month rewrites `generated`
    -- rows only, so a desk decision survives the next run; `pinned` is also
    -- held out of automatic course moves when a day runs short.
    origin VARCHAR(16) NOT NULL,
    -- Why somebody was put to work on a day they filed off. Required for that
    -- edit and kept as the record of who decided it.
    note VARCHAR(255) NULL,
    updated_by VARCHAR(128) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One confirmed shift per caddie per day: regenerating a month replaces
    -- rows rather than stacking a second placement the desk would have to
    -- choose between.
    UNIQUE KEY uq_golf_caddie_shifts_day (tenant_id, shift_date, caddie_id),
    -- The dispatch screens read a day one course at a time.
    KEY idx_golf_caddie_shifts_course (tenant_id, shift_date, golf_course_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
