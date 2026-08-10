-- How far each course's tee-time inventory has been built, and when we last looked.
--
-- Generated inventory *is* the bookable window: a date with no slot row is
-- refused outright when a booking is taken. Saving a schedule builds the window
-- once, but the far edge does not move on its own afterwards, so a club that
-- never edits its week loses a day of sellable dates every day.
--
-- There is no scheduler in this product to move it on a timer, so the desk's
-- own traffic carries the top-up. That only works if the check is nearly free:
-- Field generates the slots but reports counts rather than a date, and asking
-- it how far it has gone would mean scanning inventory on every request. These
-- two dates make the check one indexed read instead — `checked_on` says the
-- work is already done today, and `generated_through` says where to resume when
-- it is not.
--
-- CourseBoard's own data (ADR-0005): the booking horizon is a golf operating
-- rule, and Field has no column for it or for this bookkeeping.
--
-- Expected to be temporary. `generated_through` is a copy of something Field
-- already knows and does not expose; if it starts reporting how far it has
-- built, or keeps a rolling window itself (PLT-3361), this table goes away.
CREATE TABLE golf_generated_through (
    tenant_id VARCHAR(64) NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    -- The last date inventory has been built through, inclusive.
    generated_through DATE NOT NULL,
    -- The course-local day the top-up last ran. Compared against today to skip
    -- the whole thing without calling Field at all.
    checked_on DATE NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One watermark per course. Building again moves it rather than adding a
    -- second row the top-up would have to choose between.
    PRIMARY KEY (tenant_id, golf_course_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
