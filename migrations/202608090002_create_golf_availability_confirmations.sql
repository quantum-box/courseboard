-- Explicit confirmation that the caddie master checked one caddie's day-off
-- requests for one calendar month.
--
-- Availability is sparse: no row means "available", so availability rows
-- cannot distinguish "no requested days off" from "not asked yet". This
-- CourseBoard-owned marker records that operational distinction without
-- moving the Field-owned caddie into CourseBoard's database (ADR-0005).
CREATE TABLE golf_availability_confirmations (
    id BIGINT NOT NULL AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    `year_month` CHAR(7) NOT NULL,
    caddie_profile_id VARCHAR(64) NOT NULL,
    -- The time the caddie master marked the request as checked. It is not the
    -- time the request actually arrived, which CourseBoard cannot know.
    confirmed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    -- Also serves month-list queries through its tenant/month prefix.
    UNIQUE KEY uq_golf_availability_confirmations_caddie (
        tenant_id,
        `year_month`,
        caddie_profile_id
    )
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
