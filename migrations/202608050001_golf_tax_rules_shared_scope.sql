-- Golf course tax is prefectural law, not per-tenant configuration.
--
-- Two things stopped a real tenant from ever pricing a round:
--
-- 1. Both tables carry a foreign key onto `tenants`, a table this repository
--    creates with one row ('scc') and never writes to again. A real tenant id
--    cannot be inserted, so `find_rule_by_green_fee` never matched and pricing
--    answered 400 for every tenant.
-- 2. The only seeded rates were 400/350/300/200 for grades A-D. Hokkaido's
--    published rates run 400-1,200 yen in 80-yen steps across 11 grades, so
--    350, 300 and 200 cannot occur. Those rows were demo values.
--
-- Rates are shared: every course in a prefecture reads the same schedule, and
-- the prefecture tells each course which grade it is. So the schedule lives
-- under the sentinel tenant '*', and a tenant row overrides it when a course
-- genuinely differs. The sentinel is used rather than NULL because MySQL treats
-- NULLs in a UNIQUE key as distinct, which would let duplicate shared rows in.

ALTER TABLE golf_tax_rules DROP FOREIGN KEY fk_golf_tax_rules_tenant;
ALTER TABLE golf_grade_thresholds DROP FOREIGN KEY fk_golf_grade_thresholds_tenant;

-- Rates move by prefectural ordinance, and a past round has to keep the rate
-- that applied on the day it was played.
ALTER TABLE golf_tax_rules
    ADD COLUMN effective_from DATE NOT NULL DEFAULT '1970-01-01';

-- Hokkaido halves the tax for players aged 65 up to but not including 70. The
-- table could only say "exempt" or "not exempt", so those players were charged
-- the full rate — twice what they owe.
ALTER TABLE golf_tax_rules
    ADD COLUMN senior_reduced_min_age BIGINT NULL,
    ADD COLUMN senior_reduced_percent BIGINT NULL;

-- Kept as a separate ALTER: TiDB serverless validates CHECK expressions
-- against the pre-ALTER schema, so bundling the constraint with the
-- columns it references fails a fresh replay with 1054 Unknown column
-- (PLT-3825). Applied databases carry the updated checksum for this
-- file out-of-band.
ALTER TABLE golf_tax_rules
    ADD CONSTRAINT chk_golf_tax_rules_reduced_percent
        CHECK (senior_reduced_percent IS NULL
               OR (senior_reduced_percent > 0 AND senior_reduced_percent < 100));

ALTER TABLE golf_tax_rules
    DROP INDEX uq_golf_tax_rules_tenant_prefecture_grade,
    ADD UNIQUE KEY uq_golf_tax_rules_scope (
        tenant_id, prefecture, course_grade, effective_from
    );

-- The 'scc' rows stay: they are the fixture the repository tests price against,
-- and no real tenant can match that id. Their amounts are not a rate any
-- Hokkaido course can be charged, so they must never be read as a rate schedule.
-- Give them the reduced band so the tests exercise the new columns.
UPDATE golf_tax_rules
SET senior_reduced_min_age = 65, senior_reduced_percent = 50
WHERE tenant_id = 'scc';

-- Hokkaido's published schedule: 400 to 1,200 yen in 80-yen steps, 11 grades.
-- Exempt: under 18, 70 and over, and holders of a disability certificate.
-- Halved: 65 up to 70.
-- Source: https://www.pref.hokkaido.lg.jp/sm/zim/tax/golf01.html
--
-- Which grade a given course is assigned is not derivable from these numbers —
-- the prefecture notifies each course — so no grade thresholds are seeded here.
INSERT INTO golf_tax_rules (
    tenant_id, prefecture, course_grade, fee,
    minor_exempt_under_age, senior_exempt_min_age, disability_cert_exempt,
    senior_reduced_min_age, senior_reduced_percent, effective_from
)
VALUES
    ('*', 'hokkaido', '1', 1200, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '2', 1120, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '3', 1040, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '4', 960, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '5', 880, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '6', 800, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '7', 720, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '8', 640, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '9', 560, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '10', 480, 18, 70, 1, 65, 50, '1970-01-01'),
    ('*', 'hokkaido', '11', 400, 18, 70, 1, 65, 50, '1970-01-01')
ON DUPLICATE KEY UPDATE fee = VALUES(fee);
