# ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する

## Status

Accepted (2026-08-22、2026-07-24 に Proposed)

実装済みで、`dist` に platform API の直参照が混入していないかを
CI が機械的に検査している。

**部分的に置き換えられている。** テナントをどう絞り込むかについての
Context / Decision / Consequences は
[ADR-0011](./ADR-0011-policy-based-tenant-selection.md) が置き換える。
「UI のアクセス先を Cognito と courseboard-api の 2 つに限定し、
platform API を UI から直接叩かない」という中核の決定は有効である。

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

（2026-08-23 追記）この「extensionの有効・無効こそが絞り込みの軸である」
という前提は、その後の調査で成立しないと分かった。CourseBoardの認可は
Tachyon Authの独立した名前空間で動いており、Field側の認可経路も
extension有効判定を見ていない。テナントがCourseBoardを使えるかは
ポリシーの付与で表現できる（[ADR-0011](./ADR-0011-policy-based-tenant-selection.md)）。
本ADRが解いた「選択後に全滅する」問題は残っており、
解き方だけが変わる。

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
- [ADR-0010: CourseBoardはFieldのextensionを使わない](ADR-0010-courseboard-is-not-a-field-extension.md)
- [ADR-0011: テナント選択はポリシーで行う](ADR-0011-policy-based-tenant-selection.md)
- [設計](../../tasks/completed/v0.1.11/v1-me-proxy-extension-filter/design.md)
- [PLT-2771](https://linear.app/issue/PLT-2771)
