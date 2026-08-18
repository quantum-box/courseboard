# メンバーへの policy 単位の権限付与

## 背景

権限管理レビュー（2026-08-18）で分かったこと:

- メンバー画面は Field IAM（`/v1/field/iam/users*`）の薄い proxy で、policy の
  フラットリスト全置換という仕組み自体は Field 本体と同じ。**policy 単位の付与は
  もともとできる**。
- ただしカタログに載るのは Field 汎用 policy（`field:sales` など13件）だけで、
  ゴルフ業務の言葉で切った policy が存在しなかった。
- さらに CourseBoard API 自身は JWT 検証しかしておらず、CourseBoard ローカル DB を
  触るルート（シフトルール・枠調整・税計算・キャンセル料・デモ seed）は
  **テナント所属の検証すら無しに誰でも書けた**。policy を細かく付けても効かない。

## 変更

### メンバー画面（`desktop/src/features/members/`）

- policy 識別子 → 画面の言葉のラベルマップ（Field `members-labels.ts` 方式、
  ja / ja-plain / en、未知の policy は生の name/description にフォールバック）
- 招待中（pending）行の表示。一覧 API は承諾済みメンバーしか返さないため、
  クライアントローカルに保持し、そのアドレスが一覧に現れたら消す
- 検索（名前・メール・ID）と 20 件ページャ、全てチェック / 全て外す
- 廃止済み `pol_erp_admin` を案内していた文言の修正

### ゴルフ業務ロール（`.tachyon/manifests/tachyonfield-golf-auth.yml`）

extension 所有の policy は extension リポジトリで管理する規約
（tachyonfield `docs/tasks/plt-1579-auth-manifest.md`）に従い、このリポジトリの
マニフェストに定義した。

- action: `field_extension_golf:{ListShifts, ManageShifts, ListSlotOverrides,
  ManageSlotOverrides, CalculateFees, ManageCancellationFees, SeedDemoBoard}`
- policy（ロール）: `field-extension:golf:{viewer, reception, caddie-master,
  accounting, manager}`
- 各ロールは必要な `field:*` / `accounting:*` action を同梱する。理由は2つ:
  1. Field IAM カタログは context `field` の action を含む policy しか出さない
     （`field_policy_matching.rs::policy_applies_to_field`）
  2. 画面の大半は利用者本人の bearer で Field を呼ぶので、Field 側 action が
     無いロールは「付与できるのに使えない」ロールになる
- `global: true`。ゴルフ場テナントが prod / sandbox platform に分かれているため、
  platform 単位の `shared: true` では届かないテナントが出る

**適用手順**（未実施。change control が必要）:

```bash
tachyon --tenant-id <tenant> auth manifest plan -f .tachyon/manifests/tachyonfield-golf-auth.yml
tachyon --tenant-id <tenant> auth manifest apply -f .tachyon/manifests/tachyonfield-golf-auth.yml
```

適用後はメンバー画面のカタログに自動で載る（UI 変更不要。ラベルは実装済み）。

### CourseBoard API の action ゲート（`src/course_authz.rs`）

tachyonfield の route classifier と同じフェイルクローズド方式。

- 全ルートを `Public / AuthenticatedOnly / UpstreamEnforced / Action(action)` に
  分類。**登録済みなのに未分類のルートは 403**（+ error ログ）
- `Action` ルートは利用者本人の bearer を
  `POST {tachyon-api}/v1/auth/policies/check` に転送して判定。テナント所属も
  オーナー特権（AdministratorAccess）も Tachyon 側で評価される
- 許可だけ 60 秒キャッシュ（key は bearer 全文 + operator + action）
- 拒否は `x-courseboard-auth-denial: action | tenant` 付き 403。`tenant` は
  UI の `onForbidden()`（テナントアクセス拒否画面）に繋がる
- check 不達は 424 `provider_error`（フェイルクローズド）
- opt-out は `COURSEBOARD_DISABLE_ACTION_AUTHZ`。`field:env`（CLI JWT）モードの
  生成 env にだけ入る。CLI JWT は tachyon-api が 401 にするため
- ルートを足すときは `src/course_authz.rs` の `ROUTES` と
  `every_registered_route_is_classified` テストに1行足す

## Field 側に残る粒度の課題（PLT 起票対象）

1. **給与ゲートの非対称**: tachyonfield は
   `GET /v1/erp/extensions/golf-course/caddie-payroll-summary` を PII として
   `field:ManageUsers` に格上げしているが、CourseBoard は
   `GET /v1/erp/hrm/staff-utilization` + roster から同等の給与集計を自前で組める
   （`field:ListHrm` + `field:ListReservations` で通る）。同じデータの読みに
   要求水準が2つある。
2. **golf extension config の一枚岩**: コース並び順・予約商品・キャディ等級料金・
   予約レポート設定が全部 `PATCH /v1/erp/extensions/golf_course/config` +
   `field:ManageReservations` に相乗りしており、「等級料金は経理だけ」のような
   分離ができない。日別予算の書き込みも `field:ManageReservations` に束ねられて
   いるため、accounting ロールに予算編集を渡すには予約書き込みまで付いてくる。

## 動作確認

- `cargo test`（644 件）/ `cargo clippy -D warnings` / `cd desktop && npm run
  type-check && vitest run src/features/members src/i18n` すべて通過
- 実環境確認は prod Field API → local courseboard API → local UI
  （`desktop/README.md`）。マニフェスト適用前は golf ロールがカタログに無いので、
  チェックリストには Field 汎用 policy だけが並ぶ
