# OSS publication boundary

Course Board is distributed as an open-source TACHYON Field integration. This
repository contains the application source, golf-specific domain logic, Field
API adapters, migrations, tests, and fictional fixtures.

Running the complete application still requires external services:

- a compatible TACHYON Field API and the required tenant policies
- an OIDC/OAuth configuration for operator access
- a MySQL-compatible database such as TiDB
- deployment-specific values and provider credentials

Production databases, customer records, access tokens, client secrets, signing
keys, and other credential material must never be committed. Public client IDs
and service URLs are not credentials, but deployment-specific tenant IDs and
operational records should be reviewed before publication.

The public repository is an implementation and integration reference. It does
not grant access to Quantum Box or TACHYON-hosted services.

## Publication boundary

Internal planning notes, customer-specific verification records, and private
agent configuration are intentionally excluded from the public snapshot.
Deployment manifests that remain in the repository contain only the values
needed by the application contract; credentials are supplied by the deployment
environment.
