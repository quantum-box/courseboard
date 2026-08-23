-- The golf-specific keys of a reservation product: play type, hole count,
-- players per group, and which courses the plan is sold on.
--
-- The generic product shape (id, name, enabled, booking mode, duration,
-- slots, sellable-resource allow-list) stays in Field's extension config —
-- Field's public storefront and slot import read and write it, and its
-- replacement is a generic product table filed as PLT-3855. These four keys
-- are different: Field neither reads nor validates them (grepped and pinned
-- in the exit taskdoc), so they are golf domain data that only rode along
-- (ADR-0005, ADR-0009).
--
-- Transitional shape: CourseBoard reads these rows first and still writes the
-- same keys to the config, so a revert loses nothing; the config copy stops
-- being written once every product has a row here.
CREATE TABLE golf_product_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    reservation_service_id VARCHAR(64) NOT NULL,
    -- self | caddie; the default reproduces what a product without the key
    -- meant before this table existed.
    play_type VARCHAR(16) NOT NULL DEFAULT 'self',
    hole_count INT NOT NULL DEFAULT 18,
    -- NULL means the plan does not cap the group beyond the slot's own limit.
    max_players_per_group INT NULL,
    -- Whether the plan declared which courses it is sold on. Declared with
    -- zero course rows means "sold nowhere" (fail closed); undeclared means
    -- unrestricted. Collapsing the two would turn a deliberately unsellable
    -- plan into one sold everywhere.
    course_scope_declared BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_golf_product_settings (tenant_id, reservation_service_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per course the plan is sold on. Course ids are Field-issued opaque
-- strings, so they get rows rather than a delimited column.
CREATE TABLE golf_product_courses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    reservation_service_id VARCHAR(64) NOT NULL,
    -- Order the club arranged the courses in, not sorted for them. Not unique:
    -- a save rewrites positions and a swap passes through a duplicate moment.
    position INT NOT NULL,
    golf_course_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_golf_product_courses (tenant_id, reservation_service_id, golf_course_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
