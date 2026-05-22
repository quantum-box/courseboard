CREATE TABLE golf_grade_thresholds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    prefecture TEXT NOT NULL,
    course_grade TEXT NOT NULL,
    min_green_fee INTEGER NOT NULL,
    max_green_fee INTEGER,
    UNIQUE (tenant_id, prefecture, min_green_fee)
);

INSERT INTO golf_tax_rules (
    tenant_id,
    prefecture,
    course_grade,
    fee,
    minor_exempt_under_age,
    senior_exempt_min_age,
    disability_cert_exempt
)
VALUES
    ('scc', 'hokkaido', 'A', 400, 18, 70, 1),
    ('scc', 'hokkaido', 'B', 350, 18, 70, 1),
    ('scc', 'hokkaido', 'C', 300, 18, 70, 1),
    ('scc', 'hokkaido', 'D', 200, 18, 70, 1)
ON CONFLICT (tenant_id, prefecture, course_grade) DO UPDATE SET
    fee = excluded.fee,
    minor_exempt_under_age = excluded.minor_exempt_under_age,
    senior_exempt_min_age = excluded.senior_exempt_min_age,
    disability_cert_exempt = excluded.disability_cert_exempt,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO golf_grade_thresholds (
    tenant_id,
    prefecture,
    course_grade,
    min_green_fee,
    max_green_fee
)
VALUES
    ('scc', 'hokkaido', 'D', 0, 3500),
    ('scc', 'hokkaido', 'C', 3500, 5000),
    ('scc', 'hokkaido', 'B', 5000, 7000),
    ('scc', 'hokkaido', 'A', 7000, NULL)
ON CONFLICT (tenant_id, prefecture, min_green_fee) DO UPDATE SET
    course_grade = excluded.course_grade,
    max_green_fee = excluded.max_green_fee;
