-- How somebody got into the customer ledger.
--
-- The ledger row itself lives in Field, which records who the person is and
-- nothing about the act of writing them down. That act is reception work: a
-- desk read a sheet, decided none of the candidates on screen was this person,
-- and created them. When two Yamada Taro turn up a week later, the only way
-- back to the sheet is this table (ADR-0009).
--
-- Deliberately not an audit log of every change. One row per creation, written
-- once and never updated: what is being kept is the provenance of a ledger
-- entry, not its history.
CREATE TABLE golf_customer_registrations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Field's consumer id. Not a foreign key: the ledger is upstream.
    customer_id VARCHAR(64) NOT NULL,
    -- `manual`, `reception_sheet`, or `ledger` — typed at the counter, read
    -- off a scanned sheet, or answered from the booking's own names. Stored as
    -- text so a fourth way in is a deploy and not a schema change.
    source VARCHAR(32) NOT NULL,
    -- The `sub` of the signed-in caller. Nullable because a token without one
    -- is still a token that created a real customer, and dropping the row
    -- would lose the sheet along with the name of who read it.
    registered_by VARCHAR(255) NULL,
    -- Which line of the sheet this person came off, zero-based. Only ever set
    -- for `reception_sheet`; the sheet is not stored, so this is a pointer to
    -- a position on paper the desk still has.
    source_row_index INT UNSIGNED NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One creation per ledger entry. A retry that reaches Field twice makes
    -- two customers with two ids, so the collision this guards against is a
    -- double write of the same id rather than a genuine second registration.
    UNIQUE KEY uq_golf_customer_registrations_customer (tenant_id, customer_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
