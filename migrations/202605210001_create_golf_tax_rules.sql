CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE golf_tax_rules (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    prefecture VARCHAR(64) NOT NULL,
    course_grade VARCHAR(32) NOT NULL,
    fee BIGINT NOT NULL,
    minor_exempt_under_age BIGINT NOT NULL,
    senior_exempt_min_age BIGINT NOT NULL,
    disability_cert_exempt BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_golf_tax_rules_fee CHECK (fee >= 0),
    CONSTRAINT chk_golf_tax_rules_minor_age CHECK (minor_exempt_under_age > 0),
    CONSTRAINT chk_golf_tax_rules_senior_age CHECK (senior_exempt_min_age > 0),
    CONSTRAINT fk_golf_tax_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE KEY uq_golf_tax_rules_tenant_prefecture_grade (tenant_id, prefecture, course_grade)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO tenants (id, display_name)
VALUES ('scc', 'SCC')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

INSERT INTO golf_tax_rules (
    tenant_id,
    prefecture,
    course_grade,
    fee,
    minor_exempt_under_age,
    senior_exempt_min_age,
    disability_cert_exempt
)
VALUES ('scc', 'hokkaido', 'A', 400, 18, 70, 1)
ON DUPLICATE KEY UPDATE
    fee = VALUES(fee),
    minor_exempt_under_age = VALUES(minor_exempt_under_age),
    senior_exempt_min_age = VALUES(senior_exempt_min_age),
    disability_cert_exempt = VALUES(disability_cert_exempt),
    updated_at = CURRENT_TIMESTAMP(6);
