-- Match a row's name the same way the import matches it.
--
-- `sheet_label` holds the name exactly as the export wrote it, which is what
-- the desk should see. It is the wrong thing to look rows up by: the import
-- decides two names are the same one after normalizing them, so an export that
-- respells `東 コース` as `東コース` between months writes rows the replacement
-- can no longer find. Where that coincides with the desk re-pointing the name
-- at another course — or excluding it — the course is no help either, and last
-- month's counts sit on the board beside this month's.
--
-- So the row carries both: what was written, and the key it is found by. The
-- key is filled in Rust rather than by a generated column, because the
-- normalization is domain code (`normalize_course_label`) and a second copy of
-- it in SQL would be free to drift from the one the matching actually uses.
--
-- Not backfilled. Rows written between the column being added and this one are
-- preview-only — no release has shipped either — and guessing at their key from
-- the raw name would be exactly the SQL-side normalization this avoids. They
-- are cleared by their course, like every other row written before names were
-- recorded.
ALTER TABLE golf_reservation_day_summaries
    ADD COLUMN sheet_label_key VARCHAR(120) NULL AFTER sheet_label;

ALTER TABLE golf_reservation_day_summaries
    ADD INDEX idx_golf_reservation_day_summaries_label_key
        (tenant_id, summary_date, sheet_label_key);

-- Nothing reads the raw name, so its index was dead the moment lookups moved to
-- the key.
ALTER TABLE golf_reservation_day_summaries
    DROP INDEX idx_golf_reservation_day_summaries_label;
