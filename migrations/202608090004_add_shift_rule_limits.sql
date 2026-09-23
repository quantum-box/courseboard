-- The rest of the club's shift-planning rules.
--
-- These started as constants in the planner, which was wrong: how many days in
-- a row a club will roster, how many rounds its course turns round in a day,
-- what its work rules promise over a month, and whether a caddie who files
-- nothing is coming in — all of it differs club to club, and none of it is
-- something Field could hold (ADR-0005).
--
-- Defaults reproduce the behaviour before this table had the columns, so a
-- tenant that never opens the setting plans exactly as it did.
ALTER TABLE golf_shift_rules
    -- The Labour Standards Act ceiling is 6. A club may promise more rest,
    -- never less, so the API clamps anything above it.
    ADD COLUMN max_consecutive_work_days INT NOT NULL DEFAULT 6,
    -- Rounds a caddie may be given in a day, whatever their own profile says.
    -- Two at most: there is not the daylight for a third.
    ADD COLUMN max_rounds_per_day INT NOT NULL DEFAULT 2,
    -- Rest days promised over a calendar month. 0 leaves the consecutive-day
    -- limit as the only rule, which is the statutory floor.
    ADD COLUMN min_rest_days_per_month INT NOT NULL DEFAULT 0,
    -- `working` or `off`: how a day nobody filed a request for is confirmed.
    -- `working` is what dispatch has always assumed.
    ADD COLUMN unfiled_request VARCHAR(16) NOT NULL DEFAULT 'working';
