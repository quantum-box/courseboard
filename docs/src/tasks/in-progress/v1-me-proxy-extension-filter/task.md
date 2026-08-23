# /v1/me proxyとextension連動テナント選択

> **Superseded (2026-08-23)。** 後継は
> [テナント選択をポリシーで行う](../tenant-selection-policy-check/task.md)。
> extension の有効判定による絞り込みは
> [ADR-0011](../../../architecture/decisions/ADR-0011-policy-based-tenant-selection.md)
> でポリシーベースに置き換わり、`/v1/erp/me` proxy と `extensionKey` パラメータは廃止する。
> 本 taskdoc が解いた「選択後に Field 依存機能が全滅する」問題は残っており、解き方だけが変わる。
> 未完の確認項目は後継へ引き継ぐ。

## Links

- [PLT-2771](https://linear.app/issue/PLT-2771)
- [設計](./design.md)
- [ADR-0004](../../../architecture/decisions/ADR-0004-ui-platform-api-access-via-courseboard-api.md)

## 概要

UIがtachyon-api `/v1/me` を直接呼んでテナント一覧を表示しているため、
golf_course extension未有効テナントを選択でき、選択後にField依存機能が
400で全滅する。委譲チェーンを UI → courseboard-api → field-api → tachyon-api
に変更し、extension未有効テナントをテナント選択から除外する。

## Scope

- courseboard-api: `/v1/me` proxyエンドポイント追加（field-api委譲）。
- UI: `VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT` をcourseboard-apiへ切り替え。
- field-api側エンドポイント（tachyonfieldリポジトリ）は契約定義のみ本taskで扱い、
  実装は別taskとする。

## Plan

- [x] field-apiエンドポイント契約をtachyonfield側とすり合わせる。
- [x] courseboard-apiに `/v1/me` proxyとunit testを追加する。
- [x] UIのprofileEndpoint設定を切り替える。
- [ ] headed browserで実ログイン→テナント選択→Field依存画面を確認する。
- [x] tachyon-api直接参照の設定値を削除する。

## Verification results

- tachyonfield PR #797で `GET /v1/erp/me?extensionKey=golf_course` を先行追加。
- courseboard-api `/v1/me` はlocal JWT検証後にinbound BearerをFieldへ委譲し、
  `enabled=true` のtenantだけをTachyon互換contractへ写像する。
- optional field省略、必須field欠落、重複/invalid tenant、異なるextension key、
  oversize、timeout、Field 401/403/5xxのfail-closed testを追加。
- `cargo test profile_proxy --lib`、OpenAPI path test、全target clippyを確認。
- UI profile endpointをcourseboard-api `/v1/me`へ切り替え、空tenantのenv fallbackと
  profile再検証失敗時のstale tenant復活経路を削除した。
- UIのtype-check、20 test files / 121 tests、production buildを確認した。
- CI、desktop release、Android/iOS releaseのbuild-time profile endpointをproxyへ統一し、
  workflow相当envの生成bundleにtachyon-api `/v1/me`の直参照がないことを確認した。
