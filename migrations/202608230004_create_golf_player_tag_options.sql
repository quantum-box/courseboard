-- The visitor categories offered when a booking is entered — 会員, 優待, WEB,
-- whatever this club sorts its players by.
--
-- A golf desk's vocabulary for its own visitors is nothing Field needs a
-- column for, and the extension config it sat in is replaced wholesale on
-- every write with no version to compare against (ADR-0005, ADR-0009).
--
-- One row per category rather than a delimited column: the labels are free
-- Japanese text, so folding them into one string would make a separator
-- inside a label corrupt the list.
CREATE TABLE golf_player_tag_options (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Zero-based position in the pick list. Shown top to bottom in the order
    -- the club arranged, not sorted for them.
    position INT NOT NULL,
    label VARCHAR(40) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- The same category twice would be two answers to one question. Position
    -- is deliberately not unique: saving rewrites positions of rows that stay,
    -- and a swap passes through a moment where two rows hold the same one.
    UNIQUE KEY uq_golf_player_tag_options_label (tenant_id, label)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
