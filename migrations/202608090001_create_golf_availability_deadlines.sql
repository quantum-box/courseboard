-- Deadline for filing a caddie's shift request for one calendar month.
--
-- Shift requests are still gathered by word of mouth and typed in by the
-- caddie master, so a caddie whose request never reached the desk looks the
-- same as one who is happy to work every day (see caddie_ops.rs, an absent
-- day reads as available). Missing that gap turns into a caddie assigned on
-- a day they cannot actually work. This table gives the desk a date to check
-- submissions against; Field's shift-request API has no notion of a filing
-- deadline, so it is CourseBoard's own data (ADR-0005).
CREATE TABLE golf_availability_deadlines (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- YYYY-MM, the calendar month the deadline gates requests for. Backtick-
    -- quoted: TiDB reserves `year_month` as a keyword.
    `year_month` CHAR(7) NOT NULL,
    deadline_date DATE NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- Format is validated by YearMonth::parse before a row ever reaches here;
    -- no CHECK constraint duplicates it in SQL.
    -- One deadline per tenant per month: setting it again replaces the date
    -- rather than adding a second deadline the desk would have to pick between.
    UNIQUE KEY uq_golf_availability_deadlines_month (tenant_id, `year_month`)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
