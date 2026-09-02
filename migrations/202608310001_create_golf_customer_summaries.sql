-- What each person in the ledger adds up to, worked out ahead of time.
--
-- The same figures the customer's own page shows, only kept rather than
-- recomputed. One person's history costs a paged sweep of Field's reservations
-- (up to four calls, two thousand rows), which is fine for one page and
-- impossible for a list ordered by what people are worth. Without this table
-- the desk builds its call list by eye, because nothing can sort the ledger by
-- takings or by how long since somebody last played.
--
-- Keyed by Field's customer id and holding no name, address, or phone: the
-- ledger is Field's and CourseBoard keeps no copy of it (ADR-0005). What is
-- here is golf's reading of generic bookings, which is ours (ADR-0009). The
-- consequence is deliberate — this table cannot be searched by name, only
-- ranked and filtered by play, and the screen fetches the names for the rows it
-- is about to show.
CREATE TABLE golf_customer_summaries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    -- Rounds played. Mirrors `CustomerVisitSummary` field for field, because
    -- the refresh builds it with the very same `CustomerVisitHistory` the
    -- single-customer page uses. A second way of counting would put two
    -- different numbers under one label.
    visits INT UNSIGNED NOT NULL DEFAULT 0,
    -- Rounds sold across those visits; a foursome counts four.
    players BIGINT NOT NULL DEFAULT 0,
    total_amount BIGINT NOT NULL DEFAULT 0,
    -- Visits whose booking carries no money, kept out of the average and
    -- reported so the screen can say what the average left out.
    unpriced_visits INT UNSIGNED NOT NULL DEFAULT 0,
    -- Takings per round sold. NULL is an unknown average, not a zero one.
    spend_per_player BIGINT NULL,
    cancelled INT UNSIGNED NOT NULL DEFAULT 0,
    no_shows INT UNSIGNED NOT NULL DEFAULT 0,
    upcoming INT UNSIGNED NOT NULL DEFAULT 0,
    -- NULL when this person has never played, and also when the read gave up
    -- before the beginning; `truncated` is what tells the two apart.
    first_visit_at TIMESTAMP(6) NULL,
    last_visit_at TIMESTAMP(6) NULL,
    -- The sweep stopped short of this person's whole history. The figures are a
    -- partial count, so they carry no grade — a twenty-year member shown as
    -- ungraded is a bug the desk would never catch, and a low grade would be
    -- worse.
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    computed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_golf_customer_summaries (tenant_id, customer_id),
    -- The three orders a call list is built in: who is worth the most, who has
    -- been away the longest, who comes the most often.
    KEY ix_golf_customer_summaries_amount (tenant_id, total_amount),
    KEY ix_golf_customer_summaries_last_visit (tenant_id, last_visit_at),
    KEY ix_golf_customer_summaries_visits (tenant_id, visits)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
