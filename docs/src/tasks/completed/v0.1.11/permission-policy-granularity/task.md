# メンバーへの policy 単位の権限付与

> **(2026-08-23 追記)** [ADR-0011](../../../../architecture/decisions/ADR-0011-policy-based-tenant-selection.md)
> でテナント選択がポリシーベースになり、「**ポリシー付与＝契約**」が規約になる。
> ポリシーの付与漏れは権限の不足ではなく、そのテナントが一覧に出ないという形で現れる。
> 本 taskdoc の policy カタログ整備が、テナント選択の前提条件になった。

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

**適用済み**（2026-08-18、profile `admin` / `--tenant-id tn_01ks18jhh1xvggktfzjx5jqsen`）:

```bash
tachyon --profile admin --tenant-id <tenant> auth manifest plan  -f .tachyon/manifests/tachyonfield-golf-auth.yml
tachyon --profile admin --tenant-id <tenant> auth manifest apply -f .tachyon/manifests/tachyonfield-golf-auth.yml
```

- `--prune` は付けない（opt-in。付けなければ既存 policy を消さない）
- `-f` で golf マニフェストだけを指定する。auto-discovery は `.tachyon/manifests/` の
  他のファイル（OAuth client 定義）も拾う
- 結果: action 37 件、policy 6 件。golf テナント
  （`tn_01kxd5gdvm9thcbj8c2e8c6yhq`）の `GET /v1/field/iam/users` の
  `customPolicies` に 5 ロールが載ることを確認した。
  `field-extension:golf:calculator` は載らない。`field:*` action を持たないので
  Field のカタログ条件（`policy_applies_to_field`）から外れる — machine-to-machine
  専用として意図どおり

> **CLI の罠: `apply` は既存 policy を更新しない。**
> policy は `POST /v1/auth/policies` するだけで、409（already exists）は
> スキップ扱いになる（tachyon-apps `sdk/cli/src/commands/auth/manifest.rs`）。
> action は追加されるのに **ロールの中身は古いまま**という、いちばん危険な
> 中途半端さが起きる。実際に一度これを踏んだ。
>
> 見分け方: apply の出力が `N policy(ies) created, M skipped`。skipped なら
> 反映されていない。`tachyon org policies get <id>` の description が
> マニフェストと違えば確定。
>
> 直し方: `tachyon org policies delete <id>` してから apply し直す。delete は
> **参照されている policy を拒否する**ので、誰かが持っていれば止まる（＝安全）。
> ただし policy id は変わる。この画面は id を名前から引くので影響は無い。
> `PATCH /v1/auth/policies/{id}`（`actionsToAdd` / `actionsToRemove`）は API に
> あるが CLI からは叩けない。CLI 側の改善は PLT 起票対象。

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

### 認可基盤が落ちたときの degraded mode（`CachingPolicyChecker`）

認可はフェイルクローズドなので、素朴に作ると Tachyon Auth の停止がそのまま
CourseBoard の停止になる。ただし **Field の認可も同じ `check_policy` を叩く**
（tachyonfield `erp_authz.rs`）ので、停止時は Field 経由のルートもどのみち落ちる。
新たに落ちるようになるのは Field を叩かない操作だけ — シフトルール、シフト表、
出勤可否の締切、枠の手動開閉、料金シミュレーション、キャンセル料。

そこを次の形で緩和した。

- 許可は 60 秒（`CACHE_TTL`）覚える。**拒否は覚えない** — 権限を付けた直後の人を
  TTL 分待たせないため
- 問い合わせが `Provider` エラー（＝答えが得られない）で、かつ **action が読み取り
  専用**で、かつ **30 分以内（`CACHE_GRACE`）に許可が取れていた**ときだけ、その古い
  許可で通す。書き込みは常に止まる
- `Unauthorized` / `TenantRejected` は「この呼び出し元についての答え」なので、
  古い許可では救済しない
- 読み取り専用かどうかは `actions::READ_ONLY` の明示リストで決める。名前の
  `List` 接頭辞から導出しない（安全性を名前に持たせない）。`CalculateFees` は
  計算だけで何も書かないのでここに入る
- キャッシュは `CachingPolicyChecker` に置き、**ルート表と usecase が共有する**。
  同じ action を両方が要求しても問い合わせは 1 回
- メンバー画面が権限を変えたら（`PUT .../policies` / 招待 / 削除の成功時）、
  proxy がそのテナントの許可を捨てる。キーは bearer なので個人単位では消せず、
  テナント単位で捨てる

最悪ケースの露出は「停止が始まる前に剥奪された人が、読み取りだけ最大 30 分続けられる」。
書き込みと、停止中に初めて触る人は通らない。

### キャンセル料の送信 action の取りこぼし（2026-08-19 追加）

「キャンセル料の SMS が送れない」の調査で分かった、上のゴルフ業務ロールの穴。
`field-extension:golf:{accounting, manager}` は `accounting:CreateInvoice` しか
持っておらず、キャンセル料の画面が実際に使う残り 3 つが抜けていた。

- `accounting:ListInvoices` — 一覧と詳細（`GET /v1/invoices*`）
- `accounting:SendReminder` — 送信と送り直し（`POST /v1/invoices/{id}/fulfill`、
  `.../payment-link/resend`）
- `notification:SendSms` — 送信の SMS 側。Field は利用者本人の bearer を
  `POST {tachyon-api}/v1/notifications/sms` に転送し、そこで別途評価される
  （tachyon-apps `apps/tachyon-api/src/email_endpoint.rs`）

この action はプラットフォームでは `AdministratorAccess` にしか入っていないため、
**オーナー以外は SMS が必ず失敗する**。メール側は同じエンドポイント群のうち
認可も課金チェックも持たない唯一の経路なので、「メールは届くのに SMS だけ落ちる」
という形で表面化する。本番（デモテナント）の 2026-08-04 の失敗 3 件は Sentry の
`money_path_authz_denied` と時刻が一致し、これで確定した。

> **ロールアウト**: マニフェストを編集しただけでは本番の policy は変わらない。
> 上に書いたとおり `apply` は既存 policy を 409 skip するので、
> `tachyon org policies delete <id>` → `apply` の順が要る（delete は参照中の
> policy を拒否するので、先に誰かから外す必要がある）。本番の権限を動かす操作
> なので、実行はレビュー後に人が行う。

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

- `cargo test`（654 件）/ `cargo clippy --all-targets --all-features -- -D warnings`
  / `cd desktop && npm run type-check && vitest run`（714 件）すべて通過
- 実環境確認は prod Field API → local courseboard API → local UI
  （`desktop/README.md`）。マニフェスト適用前は golf ロールがカタログに無いので、
  チェックリストには Field 汎用 policy だけが並ぶ
