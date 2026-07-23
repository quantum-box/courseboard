# CourseboardからFieldへのテナント文脈伝播を修正する

## 概要

本番Courseboardの認証済みcourse APIがField依存処理で失敗し、UIでは`Failed to fetch`として表示される。Courseboard UIは選択テナントの`x-operator-id`とplatform文脈の`x-platform-id`を送信しているが、courseboard-apiのField gatewayは`x-platform-id`を破棄していた。この欠落を修正し、上流障害時の応答をboundedなJSON 502に保ち、キャディ画面の不要なField fan-outも削減する。

関連: [PLT-2739](https://linear.app/issue/PLT-2739)、[courseboard #86](https://github.com/quantum-box/courseboard/issues/86)、[#94](https://github.com/quantum-box/courseboard/issues/94)

## スコープ

1. course APIの全Field gatewayで、受信した`x-platform-id`を`x-operator-id`とともに転送する。
2. `x-platform-id`未指定の既存クライアントは互換性のため許容する。
3. Field通信へ期限を設け、タイムアウトをCORS付きJSON 502として返す。
4. キャディ名簿で重複していたstaff取得を集約し、画面単位で不要な取得を遅延する。
5. unit test、Rust/React静的検査、preview、本番の認証済み名簿を検証する。

## 非スコープ

- Field側tenant policyの定義変更
- Cognitoのissuer/client変更
- Field UIの変更
- TiDB移行（#95で完了済み）

## 対象

- `src/course/domain/ports.rs`
- `src/course/interfaces/http.rs`
- `src/course/infrastructure/field_gateway.rs`
- `src/course/infrastructure/field_ops_gateway.rs`
- `desktop/src/features/golf/CaddiesPage.tsx`
- `desktop/src/hooks/useResource.ts`

## 設計

- [design.md](design.md)
- [ADR-0002](../../../../architecture/decisions/ADR-0002-react-spa-courseboard-api-boundary.md)

## 実装フェーズ

- [x] #96 / #97の未merge差分を最新main上へ回収
- [x] platform/operator/bearerのField伝播を実装し回帰テストを追加
- [x] host側のRust/React検証
- [x] version bumpとtaskdoc archive
- [ ] Ready PRのpreviewで認証済みユーザー経路を検証
- [ ] merge後に本番の認証済みユーザー経路を検証

## 完了条件

- Courseboard tenantとField Golf Sandboxで、`GET /v1/course/caddie-profiles`が認証済みリクエストに200を返す。
- Fieldへ送るリクエストに受信した`Authorization`、`x-operator-id`、`x-platform-id`が保持される。
- Fieldタイムアウト時もブラウザへCORS付きJSON 502が返る。
- キャディ名簿が重複staff requestを発生させない。
- 対象のRust/Reactテスト、format、lint相当検査、buildが成功する。

## リスクと残タスク

- 選択tenantに必要なField policy自体が存在しない場合、header伝播後も403になる。その場合はField側の別修正として切り分ける。
- 本番検証には実ユーザーのCognito sessionが必要である。
- 全Rust testはTiDB test admin poolへの接続timeoutで20件失敗した。変更面のtargeted test、clippy、fmtは成功しており、DB統合環境の復旧後に全件を再実行する。
