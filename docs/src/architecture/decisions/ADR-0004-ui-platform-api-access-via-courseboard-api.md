# ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する

## Status

Proposed (2026-07-24)

## Context

ADR-0002でReact SPAは独立した`courseboard-api`へBearer tokenを直接送る構成を採用し、
Field APIへのUI直接接続は不採用とした。しかしテナント一覧の取得だけは
UIがtachyon-api `https://api.n1.tachy.one/v1/me` を直接呼んでおり、
UIの接続先が3つ（Cognito、courseboard-api、tachyon-api）に分散していた。

本番調査（2026-07-24）で、`/v1/me` が返すテナントにはgolf_course extension
未有効のものが混在し、選択するとField依存機能が
`golf_course extension is not enabled` (400) で全滅することを確認した。
extensionの正はfield DBの`tenant_extensions`にしか無く、UIが直接
tachyon-apiを呼ぶ構成ではこの情報でテナントを絞り込めない。

## Decision

UIがアクセスするのはCognito（認証、ADR-0003）とcourseboard-apiの2つに限定する。
tachyon-api、field-apiを含むplatform APIへのUI直接アクセスは行わない。

platform APIのデータが必要な場合はcourseboard-apiがproxyし、
委譲チェーンは UI → courseboard-api → field-api → tachyon-api とする。
テナント一覧とextension状態のjoinは、`tenant_extensions`を持つ
field-apiが担い、courseboard-apiはextension未有効テナントを除外して返す。

## Consequences

- UIの接続先とCORS相手が固定され、platform API側のCORS設定にUIが依存しない。
- テナント選択はextension有効テナントに限定され、選択後の全滅が構造的に起きない。
- courseboard-apiに`/v1/me` proxyが増える。既存の`/field-api` proxyと同じ
  bearer委譲パターンを使い、新しいsecretは持たない。
- field-apiにテナント一覧 + extension状態の集約エンドポイントが必要になる
  （tachyonfield側の変更）。
- `VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT`のようなplatform API直参照の
  設定値は廃止していく。

## Alternatives Considered

- UIがtachyon-apiとfield-apiを両方直接呼んでclient側でjoinする:
  接続先とCORS依存が増え、extension判定ロジックがUIに漏れるため不採用。
- courseboard-apiがtachyon-apiとfield-apiを別々に呼んでjoinする:
  テナント数ぶんのfan-outが発生し、extensionの正を持たない
  courseboard-apiにjoin責務が寄るため不採用。

## References

- [ADR-0002: React SPAとcourseboard-apiを独立配信する](ADR-0002-react-spa-courseboard-api-boundary.md)
- [ADR-0003: Courseboardの人間ユーザーtoken issuerをCognitoに統一する](ADR-0003-cognito-human-token-issuer.md)
- [設計](../../tasks/in-progress/v1-me-proxy-extension-filter/design.md)
- [PLT-2771](https://linear.app/issue/PLT-2771)
