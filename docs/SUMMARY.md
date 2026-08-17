# Summary

# Architecture

- [Decisions]()
  - [ADR-0001: production Cognito client allowlist](src/architecture/decisions/ADR-0001-production-cognito-client-allowlist.md)
  - [ADR-0002: React SPAとcourseboard-apiを独立配信する](src/architecture/decisions/ADR-0002-react-spa-courseboard-api-boundary.md)
  - [ADR-0003: Courseboardの人間ユーザーtoken issuerをCognitoに統一する](src/architecture/decisions/ADR-0003-cognito-human-token-issuer.md)
  - [ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する](src/architecture/decisions/ADR-0004-ui-platform-api-access-via-courseboard-api.md)
  - [ADR-0005: ゴルフドメイン知識はCourseBoardが所有する](src/architecture/decisions/ADR-0005-golf-domain-ownership.md)
  - [ADR-0006: 日次サマリは集約需要として扱いダミー予約を作らない](src/architecture/decisions/ADR-0006-aggregate-caddie-demand-without-dummy-reservations.md)
  - [ADR-0007: 外部予約帳票の集計をField extension configへ暫定保存する](src/architecture/decisions/ADR-0007-external-reservation-report-snapshots.md)

# Business

- [キャンセル料徴収の原価と課金モデル](src/business/cancellation-fee-pricing.md)

# Tasks
- [In Progress]()
  - [PLT-3339 日次サマリを必要キャディ数と割当に接続する](src/tasks/in-progress/plt-3339-daily-summary-caddie-demand/task.md)
    - [設計](src/tasks/in-progress/plt-3339-daily-summary-caddie-demand/design.md)
  - [CourseBoard の請求先と法人売掛を連携する](src/tasks/in-progress/plt-3406-bill-to/task.md)
    - [設計](src/tasks/in-progress/plt-3406-bill-to/design.md)
  - [/v1/me proxyとextension連動テナント選択](src/tasks/in-progress/v1-me-proxy-extension-filter/task.md)

- [Completed]()
  - [v0.1.11]()
    - [予約表集計を有効なテナントスコープへ保存する](src/tasks/completed/v0.1.11/fix-reservation-report-tenant-scope/task.md)
  - [v0.1.10]()
    - [既存予約システムの日別予約表をとりこむ](src/tasks/completed/v0.1.10/reservation-report-import/task.md)
  - [v0.1.9]()
    - [キャディ配置を予約 ID で上流絞り込みする](src/tasks/completed/v0.1.9/plt-3377-reservation-filter/task.md)
  - [v0.1.4]()
    - [更新・再読み込みボタンを廃止する](src/tasks/completed/v0.1.4/remove-refresh-controls/task.md)
  - [v0.1.3]()
    - [ページ遷移で前回表示をすぐ復元する](src/tasks/completed/v0.1.3/cached-page-navigation/task.md)
    - [予約作成時にプレイヤー情報を入力する](src/tasks/completed/v0.1.3/reservation-create-player-details/task.md)
  - [v0.1.8]()
    - [CourseboardからFieldへのテナント文脈伝播を修正する](src/tasks/completed/v0.1.8/fix-courseboard-field-tenant-context/task.md)
  - [v0.1.6]()
    - [Courseboard human token issuerのCognito統一](src/tasks/completed/v0.1.6/cognito-human-token-issuer/task.md)
    - [ページごとのメタ情報を整える](src/tasks/completed/v0.1.6/page-metadata-seo/task.md)
  - [v0.1.2]()
    - [courseboard-api Cloud App deployment](src/tasks/completed/v0.1.2/courseboard-api-cloud-app/task.md)
    - [Desktopタブとアプリ内更新](src/tasks/completed/v0.1.2/desktop-tabs-and-updater/task.md)
  - [v0.1.5]()
    - [Next.jsからReact/Viteへの移行](src/tasks/completed/v0.1.5/migrate-nextjs-to-react/task.md)
