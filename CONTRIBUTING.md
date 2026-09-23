# Contributing to Course Board

Thank you for helping improve Course Board. Please open an issue before a
substantial change so that the API boundary and the Field integration contract
can be discussed first.

## Scope

Course Board owns golf-specific domain logic and its user interface. Generic
ERP capabilities belong in the Field API. A change that needs a new generic
Field capability should include the corresponding Field contract discussion.

## Development rules

- Never commit `.env`, access tokens, client secrets, database URLs containing
  credentials, signing keys, or customer data.
- Keep tenant-specific production configuration outside the repository.
- Keep authorization fail-closed when adding a new route.
- Use focused commits and include tests for behavior changes.

## Local checks

Run the checks relevant to the part you changed. The Rust test suite requires a
MySQL-compatible database such as TiDB; the frontend checks run from
`desktop/`.

```bash
cargo fmt --check
cargo test
cd desktop
npm run type-check
npm test
```

Also run `git diff --check` before opening a pull request. CI is the final
validation for the complete application and deployment configuration.
