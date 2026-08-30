-- One caddie put on other work for one stretch of one day.
--
-- A caddie confirmed to work whose day the tee sheet never fills is idle on
-- the board and busy in the yard, and nothing on the dispatch screen said
-- which. This is where the desk records it, and it is what takes them out of
-- the day's caddie supply: somebody sent to the practice range cannot also be
-- offered as the caddie for a group.
--
-- Deliberately not a column on golf_caddie_shifts. Regenerating a month
-- rewrites every `generated` shift row, and a duty decided for one day must
-- not be erased by next week's planning run.
CREATE TABLE golf_caddie_duty_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    duty_date DATE NOT NULL,
    caddie_id VARCHAR(64) NOT NULL,
    -- The label as it stood when the day was filed, not a reference to
    -- golf_caddie_duties. What the caddie actually did that day is history,
    -- and renaming or dropping the job later must not rewrite it.
    duty_label VARCHAR(40) NOT NULL,
    -- The stretch of the day this covers, in minutes from the club's midnight;
    -- 0 to 1440 is the whole day. Minutes rather than TIME because every
    -- comparison this feeds — against a tee time, against another duty, against
    -- local noon — is arithmetic on minutes of the club's own day.
    start_minute INT NOT NULL,
    end_minute INT NOT NULL,
    -- Anything the desk wants to add: which hole, who asked, when to stop.
    note VARCHAR(255) NULL,
    updated_by VARCHAR(128) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One job per caddie per start. A day holds several — the range until
    -- noon, cart cleaning after it — and the use case refuses windows that
    -- overlap, so two rows can never claim the same minute.
    UNIQUE KEY uq_golf_caddie_duty_assignments_start (
        tenant_id, duty_date, caddie_id, start_minute
    ),
    -- The dispatch screen reads one day, and the supply count reads a range.
    KEY idx_golf_caddie_duty_assignments_date (tenant_id, duty_date)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
