-- Which name in the export produced this count.
--
-- Re-importing replaces the window a file speaks for, and until now that window
-- was "these dates, for these courses". That holds only while a name keeps
-- pointing at the same course. The moment the desk re-points `真駒内` from one
-- course to another — or says to leave it out — the rows the old course already
-- holds fall outside the window and stay, and the board shows the same month
-- twice.
--
-- The name is the thing that is stable across that change, so the row records
-- it and the replacement is keyed on it. NULL on rows written before this
-- column existed; those are still cleared by the course they were written
-- against, which is the only handle they have.
ALTER TABLE golf_reservation_day_summaries
    ADD COLUMN sheet_label VARCHAR(120) NULL AFTER golf_course_id;

-- Replacement reads a month's rows by the names in the file being imported.
CREATE INDEX idx_golf_reservation_day_summaries_label
    ON golf_reservation_day_summaries (tenant_id, summary_date, sheet_label);
