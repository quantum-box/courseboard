-- Caddies moved off a fee of their own and onto their rank's fee.
--
-- Not the rank table's own history — that is `golf_caddie_rank_fee_changes`
-- (PLT-3348). This one is about individual caddies: whose per-caddie amount
-- was cleared, so the rank table started pricing them.
--
-- The per-caddie amount lives on the caddie profile upstream, and that profile
-- keeps only the current number. Setting it back to zero hands the caddie to
-- the rank table, which can raise or cut what a round pays them, and once it is
-- done nothing upstream can say what they were paid before (PLT-3346).
--
-- So every such move is written here: the amount before, the rank fee it was
-- handed to at that moment (the table can be edited later), who did it and the
-- reason they gave. It is a log, not a setting — rows are only ever added.
--
-- A row is written before the profile is and confirmed after. A crash between
-- the two leaves an unconfirmed row, which is never listed, rather than a pay
-- change nobody logged.
--
-- No name: who the caddie is stays upstream's answer (ADR-0005).
CREATE TABLE golf_caddie_own_fee_changes (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- The caddie profile upstream. Not a foreign key: the profile is not here.
    caddie_profile_id VARCHAR(64) NOT NULL,
    rank_code CHAR(1) NOT NULL,
    previous_fee BIGINT NOT NULL,
    new_fee BIGINT NOT NULL,
    rank_fee BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    note TEXT NULL,
    -- The verified token's `sub`, and the username it carried, as the rank
    -- table's history keeps them.
    changed_by VARCHAR(255) NULL,
    changed_by_name VARCHAR(255) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- Null until the profile write went through.
    applied_at TIMESTAMP(6) NULL,
    KEY idx_golf_caddie_own_fee_changes_tenant_applied (tenant_id, applied_at),
    KEY idx_golf_caddie_own_fee_changes_caddie (tenant_id, caddie_profile_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
