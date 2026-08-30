-- When this confirmed day was last told to Field.
--
-- A caddie being at work is a fact Field's HRM holds too (ADR-0013), and one
-- CourseBoard operation can change how many days at once by three orders of
-- magnitude: the desk editing tomorrow moves one day, confirming a month moves
-- the whole roster's. The single day goes to Field inside the same request.
-- A month cannot — a thousand-odd upstream calls do not belong in the request
-- that a person is waiting on — so it is pushed afterwards, in batches.
--
-- Which means something has to remember how far that got. This is it.
--
-- Compared against `updated_at`, never read on its own:
--
--   * NULL                      never told to Field
--   * field_synced_at < updated_at   changed since Field was last told
--   * field_synced_at >= updated_at  Field has the current version
--
-- A timestamp rather than a boolean because the question is not "was it ever
-- sent" but "was it sent *since it last changed*". A day re-confirmed with
-- different hours has a `field_shift_id` already, and a flag would call it
-- done while Field still held last week's morning.
--
-- Stamped only after Field acknowledges, in the same write that stores the
-- shift id. A day Field holds nothing for by design — an off day — is stamped
-- too, with a NULL id: otherwise every pass would pick it up again, find
-- nothing to do, and never finish.
ALTER TABLE golf_caddie_shifts
    ADD COLUMN field_synced_at TIMESTAMP(6) NULL;

-- Kept as a separate ALTER. TiDB serverless validates an index against the
-- pre-ALTER schema, so naming a column added in the same statement fails a
-- fresh replay with 1072 column does not exist (PLT-3825, and PLT-3835's own
-- first migration).
--
-- The batch scan asks one tenant for one month's days that are behind, oldest
-- first. Leading with the columns it filters on keeps that off a full scan of
-- every month ever confirmed.
ALTER TABLE golf_caddie_shifts
    ADD KEY idx_golf_caddie_shifts_field_sync (tenant_id, shift_date, field_synced_at);
