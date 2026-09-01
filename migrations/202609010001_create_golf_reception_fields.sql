-- The columns a golf course prints on its reception sheet.
--
-- Standard fields are the generic customer columns Field already owns. Custom
-- fields are golf-specific questions and stay in CourseBoard, so the front
-- desk does not need to open Field admin (ADR-0005, ADR-0009, ADR-0010).
--
-- An unconfigured tenant has no rows here: the CourseBoard domain merges the
-- built-in standard defaults into the result. A replacement writes only the
-- settings the tenant currently chose; old custom answers are intentionally
-- kept in golf_customer_reception_values when a definition is removed.
CREATE TABLE golf_reception_fields (
    tenant_id VARCHAR(64) NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    field_type VARCHAR(16) NOT NULL,
    enabled BOOLEAN NOT NULL,
    required BOOLEAN NOT NULL,
    label VARCHAR(255) NULL,
    sort_order INT NOT NULL,
    options_json JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tenant_id, field_key),
    KEY ix_golf_reception_fields_order (tenant_id, sort_order, field_key)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Answers for CourseBoard-owned custom reception fields. The customer itself
-- remains in Field; customer_id is an upstream reference and is deliberately
-- not a foreign key. Removing a field definition never removes its history.
CREATE TABLE golf_customer_reception_values (
    tenant_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    field_key VARCHAR(64) NOT NULL,
    value_json JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (tenant_id, customer_id, field_key),
    KEY ix_golf_customer_reception_values_customer (tenant_id, customer_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
