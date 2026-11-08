# Field common Agent rollout

Related work is PLT-6313 through PLT-6320. Deploy the Field profile/API and
common Worker before switching this client. The client continues to use
`@tachyon-sdk/agent`'s published transport interface and can adopt its additive
0.5 helpers after that package is released.

## Connections

JSON session creation and results use the existing authenticated `/field-api`
proxy. It forwards the caller bearer and Field application headers unchanged.
Field prepares Agent execution. Streaming connects directly to
`https://field-agent-stream.txcloud.app`, which prepares only through Field.
Business reads and writes continue through Courseboard API authorization.

The existing `VITE_COURSEBOARD_AGENT_STREAM_BASE_URL` selects the common Worker.
Restoring `https://courseboard-agent-stream.txcloud.app` selects the legacy
client paths. Keep that deployment and its legacy API until the observation
window proves that no old client calls remain. Restored transcripts are kept,
but sessions from another connection scope require a new conversation.

For a paired preview, set the existing Field proxy `TACHYON_FIELD_API_URL` to
the Field PR API and the existing stream setting to
`https://field-agent-stream.txcloud.app/preview/<Field PR number>`.
Register the Field preview's direct Lambda Function URL in the common Worker's
existing FIELD_API_ORIGIN production/previews map first. Its same-zone public
API URL cannot be used from the Worker. The same Worker code then prepares
against that Field API. Record both Field and Courseboard commits and the
deployed Worker commit.

## Acceptance record

The following numbers are the supplied reference fixture for 2026-11-07.
Production comparison remains pending. Compare them with the current ledger
before completing PLT-6319. If the data changed, keep the observed time and
explain the difference.

| Course | Groups | Players | Self | Caddie |
| --- | ---: | ---: | ---: | ---: |
| 空沼IN | 13 | 45 | 9 | 4 |
| 藻岩OUT | 11 | 38 | 8 | 3 |
| 滝のOUT | 4 | 13 | 2 | 2 |
| 空沼OUT | 1 | 2 | 1 | 0 |
| 藻岩IN | 0 | 0 | 0 | 0 |
| 滝のIN | 0 | 0 | 0 | 0 |
| 実務再テストコース_20260812 | 0 | 0 | 0 | 0 |
| 羊ヶ丘IN | 0 | 0 | 0 | 0 |
| 羊ケ丘OUT | 0 | 0 | 0 | 0 |
| Total | 29 | 98 | 20 | 9 |

Verify reservation, customer, course and product reads, a mixed request, write
approval, refusal, abort, repeated events and uncertain write recovery using
safe test records. The screen must render all course figures from structured
ledger data. A failed or partial read must remain incomplete.

## Retirement gate

PLT-6320 remains pending until preview and production acceptance, rollback
verification, and recorded zero legacy traffic are complete. Then remove the
dedicated Cloud App, its manifest block and Worker code, the old agent
preparation in `src/agent.rs`, and the compatibility selection in this client.
Retain the operations catalogue, business authorization, confirmation UI and
structured ledger rendering. Record the post-retirement smoke result.
