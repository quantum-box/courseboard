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

### 基本ロール名の取り違えを直す（`desktop/src/features/members/models.ts`）

本番テナントのカタログを引いて発覚した既存バグ。`ROLE_OPTIONS` が
`field:{administrator,operator,reader}` を「改称後の名前」として持ち、実在する
`field:{admin,staff,viewer}` を「廃止名」として一覧から除外していた。改称は
Field 側で起きておらず（tachyonfield 全体で `field:administrator` は 0 件、
manifest の policy 名と `ErpRole::as_str` はどちらも `field:admin` 系）、結果:

- チェックリストに基本ロールが 1 つも出ない
- **メンバーを保存するとロールが外れる。** `memberPolicyIds` はカタログに無い名前を
  解決できず id を落とすが、保存は policy 全置換なので、業務ポリシーを 1 つ足した
  だけでスタッフロールが剥がれる
- ロールバッジが `field:staff` と生表示、招待の既定 `field:operator` も空振り

名前は Field の auth manifest が持つものに合わせ、`RETIRED_POLICY_NAMES` は前提ごと
削除した。mock も本番カタログと同じ名前に直し、回帰テストを追加した。

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

- action: `field_extension_golf:*` を業務単位で 36 件（`src/course/domain/actions.rs`
  が SSoT。マニフェストとの整合はテストで固定）
- policy（ロール）: `field-extension:golf:{viewer, reception, caddie-master,
  accounting, manager}`
- 各ロールは必要な `field:*` / `accounting:*` action を同梱する。理由は2つ:
  1. Field IAM カタログは context `field` の action を含む policy しか出さない
     （`field_policy_matching.rs::policy_applies_to_field`）
  2. 画面の大半は利用者本人の bearer で Field を呼ぶので、Field 側 action が
     無いロールは「付与できるのに使えない」ロールになる
- `global: true`。ゴルフ場テナントが prod / sandbox platform に分かれているため、
  platform 単位の `shared: true` では届かないテナントが出る

> **デプロイ順序（必須）**: このマニフェストを **apply してからコードを出す**。
> コードは 36 個の action を要求するが、Tachyon Auth に宣言が無い action は
> 誰にも grant されていないため、先にコードが出ると全 usecase が 403 になる。
> 逆順（apply が先）は無害で、使われない宣言が増えるだけ。
>
> 初回の 8 action / 6 policy は 2026-08-18 に apply 済み。**36 action への
> 拡張分は未適用**（apply しようとした時点で `api.n1.tachy.one` が応答せず、
> healthz も含めて全滅していたため。ネットワーク側の問題ではない）。復旧後に
> 下記 plan → apply を実行すること。

**適用手順**（profile `admin` / `--tenant-id tn_01ks18jhh1xvggktfzjx5jqsen`）:

```bash
tachyon --profile admin --tenant-id <tenant> auth manifest plan  -f .tachyon/manifests/tachyonfield-golf-auth.yml
tachyon --profile admin --tenant-id <tenant> auth manifest apply -f .tachyon/manifests/tachyonfield-golf-auth.yml
```

- `--prune` は付けない（opt-in。付けなければ追加と更新だけで、既存 policy を消さない）
- `-f` で golf マニフェストだけを指定する。auto-discovery は `.tachyon/manifests/` の
  他のファイル（OAuth client、Field 本体マニフェストの古いコピー）も拾う
- 初回の結果: action 8 件 / policy 6 件を作成、エラー 0。再 plan で action は
  unchanged（policy は list endpoint が無いため常に register 表示になる）
- apply 後は、ロールの action 一覧が新しい語彙に入れ替わったことを確認する
  （policy の中身は plan では見えない）
- 検証: golf テナント（`tn_01kxd5gdvm9thcbj8c2e8c6yhq`）の
  `GET /v1/field/iam/users` の `customPolicies` に 5 ロールが載ることを確認した。
  `field-extension:golf:calculator` は載らない。`field:*` action を持たないので
  Field のカタログ条件（`policy_applies_to_field`）から外れる — machine-to-machine
  専用として意図どおり

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

### usecase 層の認可（`src/course/domain/actions.rs`、`ports.rs`）

ルート表だけだと、Field 経由のルートは CourseBoard 側の判定が無く、粒度も Field の
`field:ManageReservations` 止まりだった（等級料金・予算・extension config が全部同じ
1 グラント。PLT-3639）。そこで **usecase を強制点にした**。

- `field_extension_golf:*` の action を業務単位で 36 件定義（`domain/actions.rs`）。
  URL ではなく操作に紐づくので、別ルート・バッチから呼ばれても付いて回る
- `CourseAuthorizer` ポートを `GatewayCredentials` に載せ、各 usecase の `execute`
  先頭で `credentials.require(actions::X).await?`。62/68 の usecase が既に
  credentials を受け取っていたので、コンストラクタは変えずに済む
- 残り 6 usecase（`tenant_id: &str` だけを取っていたローカル系）は credentials
  受け取りに揃えた。呼び出し側は元々 `credentials.operator_id` を渡していたので
  意味は変わらない
- gateway が並行 fan-out のために再構築する credentials は
  `GatewayCredentials::for_outbound`。認可には使えず、誤用時は 403（fail closed）
- ルート表は残す。**新しいルートを足して分類し忘れたら 403** という網は
  usecase 側では張れない（新しい usecase の require 忘れは開いてしまう）ため、
  二重にする意味がある。ローカルルートは表と usecase が同じ action を使うので、
  60 秒キャッシュにより問い合わせは 1 回で済む
- `actions::ALL` とマニフェストの整合をテストで固定（宣言漏れ・grant 漏れ・
  コードが要求しない宣言の 3 方向）

**運用上の注意**: 認可はフェイルクローズドなので、**Tachyon Auth が落ちると
CourseBoard の業務画面も 424 で止まる**。今までローカルルートだけだった影響範囲が
全 usecase に広がった。可用性を優先するなら、読み取り系だけ猶予を持たせるといった
緩和を別途決める必要がある。

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

- `cargo test`（647 件）/ `cargo clippy --all-targets --all-features -- -D warnings`
  / `cd desktop && npm run type-check && vitest run`（714 件）すべて通過
- 実環境確認は prod Field API → local courseboard API → local UI
  （`desktop/README.md`）。マニフェスト適用前は golf ロールがカタログに無いので、
  チェックリストには Field 汎用 policy だけが並ぶ
