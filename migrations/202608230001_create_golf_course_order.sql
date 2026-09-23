-- The order courses are laid out in on the ledger board.
--
-- This was living in the golf extension's config JSON on Field, alongside the
-- plans and the caddie rank fees. That object is replaced wholesale on every
-- write with no version to compare against, so two screens saving at the same
-- moment silently lose one of the two edits; and writing to it now requires the
-- permission that also turns extensions on and off, which none of CourseBoard's
-- roles hold. Neither is a reason Field should know how a golf club likes its
-- board arranged in the first place (ADR-0009, ADR-0010).
--
-- One row per placed course rather than a single delimited column: course ids
-- come from Field and are opaque to us, so folding them into one string would
-- make a separator inside an id corrupt the arrangement.
CREATE TABLE golf_course_order (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    -- Zero-based position on the board. A tenant with no rows has not arranged
    -- anything and falls back to the course list's own order, which is the same
    -- thing the missing config key used to mean.
    position INT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- A course sits in exactly one place. The reverse is deliberately left
    -- unconstrained: saving rewrites the positions of rows that are already
    -- there, so swapping two courses passes through a moment where both hold
    -- the same number. Nothing reads a position except to sort by it.
    UNIQUE KEY uq_golf_course_order_course (tenant_id, golf_course_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
