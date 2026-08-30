-- The kinds of work a caddie can be put on when they are not walking a round.
--
-- コース整備, 練習場, フロント補助 — the club's own vocabulary for the jobs it
-- fills on a quiet day. Field's HRM has no word for any of it, and inventing
-- one there would put golf's vocabulary on the generic side (ADR-0005), so the
-- list is CourseBoard's own rows (ADR-0009), like the visitor categories.
--
-- A pick list, not a referenced entity: an assignment keeps the label it was
-- filed under (see golf_caddie_duty_assignments), so retiring a job here never
-- rewrites what a past day says the caddie did.
CREATE TABLE golf_caddie_duties (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- What the desk reads on the dispatch screen. Matched by value when the
    -- list is rearranged, which is why it carries the unique key.
    label VARCHAR(40) NOT NULL,
    -- The order the club arranged them in, which is the order the picker
    -- offers them in.
    position INT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_golf_caddie_duties_label (tenant_id, label)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
