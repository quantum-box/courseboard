# PLT-5652 common document adapter, first increment

Requires **Field PR https://github.com/quantum-box/tachyonfield/pull/1583 first**.
Issue: https://linear.app/quantum-box/issue/PLT-5652

This PR adds the CourseBoard half of the common document contract. It does not
switch the production reception or reservation PDF entry points. Delivery order
remains common contract → reservation PDF → reception → limited-tenant acceptance.

The server accepts optional original SHA declarations on existing reception OCR
job creation and forwards them with its existing saved field/consent schema. It
checks Field's manifest acknowledgement before allowing the new adapter to
upload. Legacy callers and in-progress jobs without SHA keep their existing
contract. Authentication uses the current request's Bearer/operator/platform;
no new service credentials or environment variables are introduced.

The bounded common-import BFF permits `customerReception` document link/sync/
revision routes, with current CourseBoard customer-management permission and
Field's current target/delegation checks. Link uses only `{ocrJobId}`: unlike
CSV/Excel, its strict request must not acquire an `importOptions` field. Common
history accepts Field `document` jobs without treating them as business success.

`desktop/src/features/golf/common-imports/document-api.ts` is the typed adapter
for the upcoming reader/editor flows:

1. Reserve with the caller's retained idempotency key and ordered original SHA,
   MIME and size declarations; link the existing OCR ID to a common job.
2. Before any Storage PUT, verify the complete reselected file set against its
   immutable manifest. Send no application Bearer or cookies to signed PUT URLs.
3. Read through the existing OCR confirm/advance APIs under that same OCR ID;
   synchronize its result to the common job without registering business data.
4. Save a revision with its manifest hash and expected version. On uncertain or
   stale responses, reload the existing common job; do not make a new OCR job.

The adapter is deliberately separate from `draftReceptionSheets`. Reception UI
migration cannot overtake the persistent reservation PDF reader, nor can it run
without deterministic Field customer/consent operation IDs and CourseBoard
partial-save recovery. Document execution is unavailable in the Field contract.

Limits match the existing reception executor: 32 files per job, JPEG/PNG/PDF,
64 MiB per file and 1 GiB total. Review revisions retain all original coordinates
and explicit exclusions; the server currently caps them at 5,000 rows/4 MiB.
Rotations are baked into upload bytes; selected-page and original-viewer UX are
later reader work. Source retention is 24 hours, after which existing revisions
remain readable but cannot be edited.

Reception's successful physical page ledger and 10 JPY price remain owned by
Field. Linking, editing and polling do not meter. **Reservation PDF pricing is
undecided and no reception price is applied to it.**

Local validation: TypeScript type-check plus 21 focused Vitest tests passed.
Changed-file rustfmt and whitespace checks passed; BFF/manifest-acknowledgement
Rust regressions are added for CI. Full Rust/DB/UI/E2E and customer acceptance
remain separate evidence. No merge or production deployment is part of this PR.
