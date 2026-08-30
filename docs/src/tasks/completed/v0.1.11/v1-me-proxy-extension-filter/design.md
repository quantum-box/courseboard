# /v1/me proxyとextension連動テナント選択の設計

## Links

- [PLT-2771](https://linear.app/issue/PLT-2771)
- [taskdoc](./task.md)
- [ADR-0002: React SPAとcourseboard-apiを独立配信する](../../../../architecture/decisions/ADR-0002-react-spa-courseboard-api-boundary.md)
- [ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する](../../../../architecture/decisions/ADR-0004-ui-platform-api-access-via-courseboard-api.md)

## Context

本番調査（2026-07-24）で次を確認した。

- courseboard-api → tachyon-field-api の golf_course extension系呼び出し
  （`/v1/erp/extensions/golf-course/*`）が、extension未有効テナントでは
  `BadRequest: golf_course extension is not enabled` (400) で全滅する。
- 一方でextensionチェックを通過するテナントも存在し（2026-07-19 00:32 UTC、
  reservation-policyの404まで到達）、有効・未有効テナントが混在している。
- UIのテナント選択は `https://api.n1.tachy.one/v1/me` を直接呼んで
  tenantsをそのまま表示するため（`desktop/src/auth/adapters.ts` の
  `VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT`）、未有効テナントを選べてしまい、
  選択後にField依存機能（コース一覧・キャディ配車・予約商品等）が全て失敗する。

extensionの正はfield DBの `tenant_extensions`
（`extension_key='golf_course' AND status='enabled'`、
tachyonfield `packages/reservation/src/sqlx_helpers.rs`
`ensure_golf_extension_enabled`）であり、courseboard側にもtachyon-api側にも無い。

## Goals

- extension未有効テナントをUIのテナント選択に出さない（または選択不可を明示する）。
- UIからtachyon-apiへの直接アクセスを無くし、UIの接続先をCognitoと
  courseboard-apiの2つに限定する（ADR-0004）。

## Non-goals

- golf_course extensionの有効化オペレーション自体（fieldadmin UIの責務）。
- Cognito直接認証の変更（ADR-0003を維持）。
- field-api以外の業種extensionの実装。

## Options

### A. courseboard-apiが集約する

courseboard-apiがtachyon-api `/v1/me` とfield-apiのextension状態を
それぞれ呼び、join して返す。

- 不採用: extension状態の取得がテナント数ぶんのfan-outになる。
  extensionの正を持たないcourseboard-apiにjoin責務が寄る。

### B. field-apiが集約する（採用）

field-apiに「呼び出しユーザーのテナント一覧 + extension有効状態」を返す
エンドポイントを追加し、courseboard-apiはそれをproxyする。
委譲チェーンは **UI → courseboard-api → field-api → tachyon-api**。

- field-apiは既にtachyon-api連携（`TACHYON_API_URL` / tachyon auth delegation
  によるidentity解決）を持ち、`tenant_extensions` とのjoinはローカルDBクエリで
  済むためfan-outが発生しない。

## Proposed design

### 1. field-api: テナント一覧 + extension状態エンドポイント（tachyonfield側）

- 例: `GET /v1/erp/me?extension_key=golf_course`
- ユーザーのbearer tokenを受け、tachyon-api `/v1/me` でテナント一覧を取得し、
  `tenant_extensions` とjoinして各テナントに `extension_enabled: bool` を付与して返す。
- `extension_key` はパラメータ化し、golf_course以外の業種extensionにも使える契約にする。
- 実装はtachyonfieldリポジトリ側の作業。本DDでは契約のみ定義する。

### 2. courseboard-api: `/v1/me` proxy

- 例: `GET /v1/me`（courseboard-api上）
- 既存の `/field-api` proxy（`src/field_proxy.rs`）と同じbearer委譲パターンで
  field-apiの上記エンドポイントを呼ぶ。
- レスポンスはUIの既存 `NativeProfilePayload` 互換を保ちつつ、
  tenantsを `extension_enabled` でフィルタする
  （初期実装は除外。将来「選択不可表示」にする場合はフラグ付き返却へ変更）。
- 認証は既存の `require_valid_token` を通す。

### 3. UI: profileEndpointの切り替え

- `VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT` をcourseboard-apiの `/v1/me` へ変更
  （`tachyon.yaml` のenvVarsと `desktop/scripts/configure.mjs`）。
- バンドルから `api.n1.tachy.one` への参照を無くす。
- `tenant-selection.ts` のロジックは変更不要（受け取るtenantsが絞られるだけ）。

## Security / authz

- bearer tokenの委譲のみで新しいsecretは増えない。
- courseboard-apiのCORS・JWT検証（ADR-0001/0002）は既存のまま。
- field-api側はtachyon auth delegationの既存経路を使う。

## Rollout

1. tachyonfield: field-apiエンドポイント追加（先行デプロイ、既存挙動に影響なし）。
2. courseboard-api: `/v1/me` proxy追加（UIはまだ旧経路のまま）。
3. UI: `VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT` を切り替えてデプロイ。
4. 動作確認後、tachyon-api直接参照の設定値を削除。

ロールバックは手順3のenv切り戻しのみで完了する。

## Test plan

- courseboard-api: proxyのunit test（委譲ヘッダー、フィルタ、401/424伝播）。
- UI: adapterのunit test（新エンドポイント契約）、
  headed browserで実ログイン→テナント選択→Field依存画面の表示確認。
- field-api契約はtachyonfield側のscenario testで担保する。

## Open questions

- field-apiエンドポイントの正式なパスとレスポンス契約（tachyonfield側とすり合わせ）。
- 有効テナントが0件のユーザーへのUI表示（エラー文言/ガイダンス）。
- 本番各テナントの `tenant_extensions` 現況の棚卸し（field DBはPrivateLink専用のため
  fieldadmin UIまたはVPC内から確認する）。
