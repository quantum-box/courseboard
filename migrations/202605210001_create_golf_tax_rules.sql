CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE golf_tax_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    prefecture TEXT NOT NULL,
    course_grade TEXT NOT NULL,
    fee INTEGER NOT NULL CHECK (fee >= 0),
    minor_exempt_under_age INTEGER NOT NULL CHECK (minor_exempt_under_age > 0),
    senior_exempt_min_age INTEGER NOT NULL CHECK (senior_exempt_min_age > 0),
    disability_cert_exempt INTEGER NOT NULL DEFAULT 1 CHECK (disability_cert_exempt IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    UNIQUE (tenant_id, prefecture, course_grade)
);

INSERT INTO tenants (id, display_name)
VALUES ('scc', 'SCC')
ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name;

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
ON CONFLICT (tenant_id, prefecture, course_grade) DO UPDATE SET
    fee = excluded.fee,
    minor_exempt_under_age = excluded.minor_exempt_under_age,
    senior_exempt_min_age = excluded.senior_exempt_min_age,
    disability_cert_exempt = excluded.disability_cert_exempt,
    updated_at = CURRENT_TIMESTAMP;
