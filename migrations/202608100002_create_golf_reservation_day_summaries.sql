-- How many groups a course expects on one half of one day, taken from the
-- club's booking system.
--
-- Sapporo Country Club books in IC Green, and IC Green will not export a
-- reservation list: the only file it produces is a daily count sheet, with no
-- start times and no per-booking caddie flag (PLT-3247). So this cannot be
-- expressed as Field reservations consuming generated tee-time inventory —
-- there is nothing here to attach to a slot. It is a separate, coarser series
-- that sits beside the inventory rather than inside it.
--
-- The grain is the finest the file offers and no finer: one course, one date,
-- morning or afternoon. Inventing tee times to spread the count over would
-- manufacture detail the club never sent.
CREATE TABLE golf_reservation_day_summaries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    summary_date DATE NOT NULL,
    -- 'am' / 'pm'. The sheet splits every day in two and reports nothing
    -- narrower, so this is a label for one of two buckets, not a time.
    time_of_day VARCHAR(2) NOT NULL,
    -- Groups booked, and how many of those asked for a caddie. The caddie count
    -- is a subset of the total, which is what makes a day's caddie demand
    -- readable without per-booking detail.
    total_groups INT NOT NULL,
    caddie_groups INT NOT NULL,
    -- The file this row came from, kept so the desk can tell which export a
    -- surprising number arrived in. The club re-exports the same month all
    -- month long, so "which file said that" is a question that gets asked.
    source_file VARCHAR(255) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_golf_reservation_day_summaries_time_of_day
        CHECK (time_of_day IN ('am', 'pm')),
    -- Counts are counts: a negative one means the file was misread, and it
    -- should fail here rather than turn into negative caddie demand later.
    CONSTRAINT chk_golf_reservation_day_summaries_counts
        CHECK (total_groups >= 0 AND caddie_groups >= 0),
    -- The import key. The club re-exports the same month whenever somebody
    -- asks, so the same (course, date, half-day) arrives over and over and has
    -- to land on the row it landed on last time instead of stacking a second
    -- count beside it.
    UNIQUE KEY uq_golf_reservation_day_summaries_slot
        (tenant_id, golf_course_id, summary_date, time_of_day),
    -- Every screen reads a date range for the whole tenant and groups by course.
    KEY idx_golf_reservation_day_summaries_range (tenant_id, summary_date)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
