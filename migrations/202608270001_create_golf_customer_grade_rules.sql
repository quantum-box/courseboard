-- The ladder a club sorts its regulars by — ゴールド / シルバー, A / B / C,
-- whatever this club calls its rungs.
--
-- A grade is not a membership. Field owns memberships because a clinic and a
-- gym want the same two tables; a grade is worked out from how somebody
-- actually plays, which is golf's own judgement and belongs here (ADR-0005,
-- ADR-0009).
--
-- One row per rung. `position` is the club's own order and decides which rung
-- wins when a customer clears more than one: judged top down, first match
-- taken, so the club arranges the ladder rather than arguing with a sort.
CREATE TABLE golf_customer_grade_rules (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Zero-based, highest rung first.
    position INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    -- Rounds played over the customer's whole history. Zero asks nothing.
    min_visits INT UNSIGNED NOT NULL DEFAULT 0,
    -- Takings per round sold, and lifetime takings. NULL asks nothing of
    -- either, which is what a club grading purely on how often people come
    -- leaves them as.
    min_spend_per_player BIGINT NULL,
    min_total_amount BIGINT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- The same rung twice would be two answers to one question. Position is
    -- deliberately not unique: saving rewrites positions of rows that stay,
    -- and a swap passes through a moment where two rows hold the same one.
    UNIQUE KEY uq_golf_customer_grade_rules_name (tenant_id, name)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
