-- Who actually walked up to the desk, one row per person per round.
--
-- Until now a visit was worked out rather than recorded: a booking whose tee
-- time has passed and was never cancelled counted as a round played. That
-- reading is wrong in both directions — somebody who simply did not turn up
-- still counts, and the three people who came in a colleague's group do not
-- count at all, because Field records one customer per reservation and the
-- rest of the group lives in CourseBoard's `golfParty` (ADR-0005, ADR-0009).
--
-- `customer_id` is nullable on purpose, for the same reason
-- `PartyPlayer.customer_id` is: a group arrives with four names on it and the
-- desk has not decided who two of them are in the ledger. Refusing the check-in
-- until they do would mean the busiest hour of the morning is the one nobody
-- records. An unlinked row still makes the headcount true; only the customer's
-- own page needs the link.
CREATE TABLE golf_visit_checkins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Field's reservation id. Walk-ins without a booking are out of scope for
    -- now, so this is required rather than nullable.
    reservation_id VARCHAR(64) NOT NULL,
    -- Seat in the group, zero-based, as `golfParty.players` orders them. This
    -- and the reservation are what make a second press of the button a no-op
    -- rather than a second visit.
    player_index INT UNSIGNED NOT NULL,
    customer_id VARCHAR(64) NULL,
    -- The name as the group was written down, kept even when the ledger link
    -- is there. The ledger entry can be renamed later; what the desk called
    -- this person that morning is what makes the row readable afterwards.
    player_name VARCHAR(120) NOT NULL,
    -- The local calendar day of play, resolved by the caller against the
    -- tenant's timezone. Stored so a day can be read back without asking
    -- Field for every booking on it.
    played_on DATE NOT NULL,
    checked_in_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- The `sub` of whoever pressed the button; see the registrations table for
    -- why this is nullable.
    checked_in_by VARCHAR(255) NULL,
    UNIQUE KEY uq_golf_visit_checkins_seat (tenant_id, reservation_id, player_index),
    -- The customer's own page reads by person; the day's desk reads by date.
    KEY ix_golf_visit_checkins_customer (tenant_id, customer_id, played_on),
    KEY ix_golf_visit_checkins_day (tenant_id, played_on)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
