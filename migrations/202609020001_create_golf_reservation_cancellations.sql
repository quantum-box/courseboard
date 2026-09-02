-- Why a booking is no longer on the board.
--
-- Cancelling a tee time removes it from the day: `is_tee_sheet_candidate`
-- drops a cancelled booking, so the desk that comes in the next morning sees
-- an empty slot and no trace that anybody had ever held it. Field records the
-- cancellation itself — `cancelledAt` on the reservation — but has nowhere to
-- put the reason (PLT-3297), so today the sentence the desk types is sent
-- upstream and lost on arrival.
--
-- What is kept here is not a copy of Field's cancellation. It is golf's
-- reading of one: which of the club's own reasons this was, how much notice
-- the caller gave, and whether a cancellation fee is owed for it. That
-- judgement is what decides whether the club charges, and it belongs to
-- CourseBoard for the same reason the fee itself does (ADR-0009).
--
-- The snapshot columns (tee time, day, players, what the booking was worth)
-- are here so a month of cancellations can be listed, filtered, and totalled
-- without reading every cancelled booking back out of Field one at a time —
-- the same trade `golf_customer_summaries` makes. They are what the booking
-- said at the moment it was cancelled and are never refreshed.
--
-- No name and no phone number: who this person is stays Field's answer, asked
-- for the rows a screen is about to show (ADR-0005).
CREATE TABLE golf_reservation_cancellations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    -- Field's reservation id. Not a foreign key: the booking is upstream.
    reservation_id VARCHAR(64) NOT NULL,
    -- The booking number as the desk knows it, kept so a row reads without a
    -- round trip to Field for a booking that is no longer on any board.
    reservation_number VARCHAR(64) NULL,
    -- Who booked, in Field's ledger. Nullable for the same reason a check-in
    -- seat is: plenty of bookings are taken under a name nobody has linked
    -- yet, and refusing to record the cancellation until they do would lose
    -- the reason as well as the link.
    customer_id VARCHAR(64) NULL,
    -- What the booking was taken under. The ledger entry can be renamed
    -- later; this is what the desk called them that day, and it is the only
    -- thing an unlinked row can be read by.
    customer_name VARCHAR(255) NULL,
    golf_course_id VARCHAR(64) NULL,
    -- The tee time that will now not be played, and the local calendar day it
    -- fell on, resolved against the tenant's timezone by the writer.
    tee_time TIMESTAMP(6) NULL,
    played_on DATE NULL,
    players INT UNSIGNED NOT NULL DEFAULT 0,
    -- What Field said the booking was worth. The starting point for the fee,
    -- never the fee itself: how much of it is charged is the club's rule.
    booking_amount BIGINT NULL,
    currency CHAR(3) NULL,
    -- The club's own reason, one of a fixed set the domain owns. Stored as
    -- text rather than an enum so a ninth reason is a deploy, not a schema
    -- change, and validated on the way in.
    reason_code VARCHAR(32) NOT NULL,
    -- The sentence the desk typed, when they typed one. Kept alongside the
    -- code rather than instead of it: the code is what a month can be counted
    -- by, the note is what makes one row make sense.
    reason_note TEXT NULL,
    -- Whole days between the cancellation and the tee time. Negative when the
    -- call came after the round should have started, which is how a no-show
    -- reaches this table. Worked out at write time because it is a fact about
    -- that moment; recomputing it later against `now` would change it.
    notice_days INT NULL,
    -- Where the cancellation fee got to: `unsettled` until somebody decides,
    -- then `waived` or `invoiced`. Whether a fee is due at all is read from
    -- the reason, not stored, so changing the club's rule does not need a
    -- backfill.
    fee_state VARCHAR(16) NOT NULL DEFAULT 'unsettled',
    -- Field's invoice, once one has been raised. This is the join that puts a
    -- cancellation fee next to the person who owes it.
    fee_invoice_id VARCHAR(128) NULL,
    fee_amount BIGINT NULL,
    fee_settled_at TIMESTAMP(6) NULL,
    -- Why it was waived, when it was. A waiver nobody can explain reads as an
    -- oversight the next time the same caller cancels.
    fee_note TEXT NULL,
    cancelled_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- The `sub` of whoever cancelled. Nullable: a token without one still
    -- cancelled a real booking, and dropping the row would lose the reason
    -- along with the name of who took the call.
    cancelled_by VARCHAR(255) NULL,
    CONSTRAINT chk_golf_cancellation_fee_state CHECK (
        fee_state IN ('unsettled', 'waived', 'invoiced')
    ),
    -- One cancellation per booking. A retry that reached Field twice cancelled
    -- the same booking twice, and the second call should correct the reason
    -- rather than add a row.
    UNIQUE KEY uq_golf_reservation_cancellations (tenant_id, reservation_id),
    -- The customer's own page reads by person; the extraction reads a period
    -- and then narrows by what is still owed.
    KEY ix_golf_reservation_cancellations_customer (tenant_id, customer_id, played_on),
    KEY ix_golf_reservation_cancellations_day (tenant_id, played_on),
    KEY ix_golf_reservation_cancellations_fee (tenant_id, fee_state, played_on)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
