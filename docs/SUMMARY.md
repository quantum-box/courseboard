# Summary

# Architecture

- [Decisions]()
  - [ADR-0001: production Cognito client allowlist](src/architecture/decisions/ADR-0001-production-cognito-client-allowlist.md)
  - [ADR-0002: React SPAとcourseboard-apiを独立配信する](src/architecture/decisions/ADR-0002-react-spa-courseboard-api-boundary.md)
  - [ADR-0003: Courseboardの人間ユーザーtoken issuerをCognitoに統一する](src/architecture/decisions/ADR-0003-cognito-human-token-issuer.md)
  - [ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する](src/architecture/decisions/ADR-0004-ui-platform-api-access-via-courseboard-api.md)

# Tasks

- [In Progress]()
  - [/v1/me proxyとextension連動テナント選択](src/tasks/in-progress/v1-me-proxy-extension-filter/task.md)

- [Completed]()
  - [v0.1.8]()
    - [CourseboardからFieldへのテナント文脈伝播を修正する](src/tasks/completed/v0.1.8/fix-courseboard-field-tenant-context/task.md)
  - [v0.1.6]()
    - [Courseboard human token issuerのCognito統一](src/tasks/completed/v0.1.6/cognito-human-token-issuer/task.md)
  - [v0.1.2]()
    - [courseboard-api Cloud App deployment](src/tasks/completed/v0.1.2/courseboard-api-cloud-app/task.md)
  - [v0.1.5]()
    - [Next.jsからReact/Viteへの移行](src/tasks/completed/v0.1.5/migrate-nextjs-to-react/task.md)
