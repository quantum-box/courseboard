# Golf MVP Demo Seed and Headless E2E

This document describes the local, secret-free demo path for the caddie workflow:

1. caddie profiles
2. shifts / availability
3. daily caddie dispatch status board inputs
4. smart assign recommendation
5. reservation assignment
6. double-booking regression

The seed is implemented in `src/demo_seed.rs` so it can be exercised in CI
without a live field API, production data, or credentials.

## Demo Seed

`small_course_seed()` models a small golf course tenant:

- tenant: `scc-demo`
- caddies:
  - `sp_demo_aiko`: active, senior, course-east knowledge, member rating 4.7
  - `sp_demo_mika`: active, already assigned to an overlapping round
  - `sp_demo_ren`: active rookie
  - `sp_demo_inactive`: inactive
- shifts / day status inputs:
  - `sp_demo_aiko`: 2026-06-01 07:00-13:00, checked in
  - `sp_demo_mika`: 2026-06-01 07:00-13:00, available but already assigned
  - `sp_demo_ren`: 2026-06-01 07:00-13:00, waiting
  - `sp_demo_inactive`: 2026-06-01 07:00-13:00, absent
- reservations:
  - `res_demo_tee_001`: 2026-06-01 08:00-12:00, course-east, member_001
  - `res_demo_tee_002`: 2026-06-01 08:30-12:30, same course overlap
- existing assignment:
  - `sp_demo_mika` is busy from 08:15-11:45

## Headless Runner

Run the demo regression locally:

```bash
cargo test demo_seed::tests::headless_demo_recommends_assigns_and_blocks_double_booking
```

Run all Rust tests, including the demo flow:

```bash
cargo test
```

## Trace Evidence

Expected trace from `run_headless_demo(&small_course_seed())`:

```text
reservation_id=res_demo_tee_001
recommended_profile_id=sp_demo_aiko
recommended_reasons=[
  active caddie,
  shift covers requested tee time,
  no overlapping assignment,
  course knowledge match,
  customer rating 4+,
  senior caddie
]
assignment_id=asg_res_demo_tee_001
double_booking_profile_status=Busy
double_booking_blocked=true
```

This proves the MVP path can be demonstrated from deterministic seed data and
that assigning the first reservation makes the same caddie unavailable for an
overlapping second reservation.

## Daily Dispatch Board

`GET /admin/dispatch?tenant_id=scc-demo&date=2026-06-01` renders a daily
operation board from the same generic field API resources:

- `staff_profile` rows identify caddies.
- `staff_availability` rows provide scheduled shift windows and operational
  day-state values such as `checked_in`, `waiting`, `absent`, or `cancelled`.
- `staff_assignment` rows show reservation tee-time assignments next to each
  caddie.

The board is intentionally operational and read-oriented for the MVP B
follow-up. It does not introduce HR, payroll, or time-clock behavior. If
operators need writable check-in / waiting / absent transitions, TACHYON Field
should expose a generic daily staff status update contract rather than a
golf-specific core endpoint.
