-- The inputs a course has to give before its prices can be worked out:
-- which prefecture's golf course tax schedule applies, the grade that
-- prefecture assigned, and the cost assumptions behind the revenue projection.
--
-- The prefecture and the grade are the key into the golf course tax table,
-- and that table already lives in CourseBoard's own MySQL (`golf_tax_rules`).
-- The key was in Field's extension config while the table it opens was here —
-- two stores for one lookup. Field has no notion of a golf course tax and no
-- reason to hold the key to ours (ADR-0005, ADR-0009).
CREATE TABLE golf_pricing_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Empty means "not chosen yet". The schedules differ by prefecture and a
    -- guessed default is a wrong tax, so pricing refuses until this is set and
    -- the screen asks for it (pricing_settings.rs).
    prefecture VARCHAR(32) NOT NULL DEFAULT '',
    tax_grade VARCHAR(32) NOT NULL DEFAULT '',
    -- The cost assumptions default to the values that were compiled into the
    -- binary before they became settings, so a club that never opened the
    -- screen keeps reading the same projection.
    taxable_ratio DOUBLE NOT NULL DEFAULT 0.85,
    price_elasticity DOUBLE NOT NULL DEFAULT -1.2,
    fixed_cost_per_day BIGINT NOT NULL DEFAULT 300000,
    variable_cost_per_visitor BIGINT NOT NULL DEFAULT 1500,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- A share above 1 would tax more visitors than turned up; negative money
    -- pays the course to open. Elasticity is legitimately negative.
    CONSTRAINT chk_golf_pricing_settings_ranges
        CHECK (taxable_ratio >= 0 AND taxable_ratio <= 1
           AND fixed_cost_per_day >= 0 AND variable_cost_per_visitor >= 0),
    -- One set of inputs per tenant: saving replaces the row rather than adding
    -- a second the simulator would have to choose between.
    UNIQUE KEY uq_golf_pricing_settings_tenant (tenant_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
