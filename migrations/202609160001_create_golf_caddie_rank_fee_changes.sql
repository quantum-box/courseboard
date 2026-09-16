-- Every time somebody reprices the ranks, and what it was before.
--
-- `golf_caddie_rank_fees` holds one row per tenant and a save overwrites it,
-- so the payroll sheet could say what a round pays today but not what it paid
-- when last month's figure was handed over, who changed it, or why (PLT-3348).
-- A caddie asking why their pay moved deserves a better answer than "the
-- number is what it is now".
--
-- Append-only. A row is written in the same transaction as the table it
-- describes, so the log never claims a price the table did not take and the
-- table never takes one the log did not record.
CREATE TABLE golf_caddie_rank_fee_changes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- What the club was paying by just before, as payroll read it — the
    -- defaults or the old extension config for a club that had never saved.
    -- Null only on the rows seeded below, where nobody knows what came before.
    previous_fee_a BIGINT NULL,
    previous_fee_b BIGINT NULL,
    previous_fee_c BIGINT NULL,
    previous_fee_d BIGINT NULL,
    previous_currency CHAR(3) NULL,
    fee_a BIGINT NOT NULL,
    fee_b BIGINT NOT NULL,
    fee_c BIGINT NOT NULL,
    fee_d BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    -- Why, when they said. The amounts say what changed; this is the part a
    -- caddie asking about their pay actually wants to hear.
    note TEXT NULL,
    -- The verified token's `sub`, and the username it carried. Both nullable:
    -- a token without them still repriced the table, and refusing to record
    -- the change would lose the amounts along with the name.
    changed_by VARCHAR(255) NULL,
    changed_by_name VARCHAR(255) NULL,
    changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    KEY ix_golf_caddie_rank_fee_changes_tenant (tenant_id, changed_at, id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- A club that priced its ranks before the log existed starts with the table it
-- has, dated when it was last saved. Without this the history of such a club
-- would open on its next change and say nothing about the amounts in force
-- until then.
INSERT INTO golf_caddie_rank_fee_changes
    (tenant_id, fee_a, fee_b, fee_c, fee_d, currency, changed_at)
SELECT tenant_id, fee_a, fee_b, fee_c, fee_d, currency, updated_at
FROM golf_caddie_rank_fees;
