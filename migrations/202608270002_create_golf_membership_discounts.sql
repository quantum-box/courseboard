-- What each membership takes off the green fee.
--
-- Field sells the plan; the price rule is golf's, so it lives here (ADR-0009).
-- Field's membership registry carries no discount and should not — a gym's
-- membership discounts nothing on a green fee.
--
-- A discount rather than a member's own posted fee: the green fee already
-- moves with the day and the season, and an absolute member rate would freeze
-- that into one number and undo the operator's weekday pricing.
CREATE TABLE golf_membership_discounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Field's membership plan id. Not a foreign key: the plans live upstream.
    plan_id VARCHAR(64) NOT NULL,
    -- 'yen' or 'percent'. Two shapes because courses post both; one column
    -- pair rather than two nullable ones so a plan cannot carry both at once.
    discount_kind VARCHAR(16) NOT NULL,
    discount_value BIGINT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One discount per plan. Two would be two answers to one question at the
    -- counter, with no way to tell which the member was quoted.
    UNIQUE KEY uq_golf_membership_discounts_plan (tenant_id, plan_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
