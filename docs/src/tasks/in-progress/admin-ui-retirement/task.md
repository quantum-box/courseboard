# 旧admin画面と素通しproxyの認可を塞ぐ

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

`/v1/course/*` の認可はフェイルクローズドで、`src/course_authz.rs` の `ROUTES` に未登録のルートは通らない。分類のうち `UpstreamEnforced`（Field が 403 を返すから CourseBoard では検査しない）は約 62 件あるが、その大半は `src/course/usecase/` の `require(actions::…)` がバックストップになっている。69 ファイル中 66 に入っていて、これは Tachyon Auth を直接叩く Field 独立の経路である。

バックストップが**無い**のは 10 エントリだけ。

- `/admin/caddies`、`/admin/caddies/:id`、`/admin/shifts`、`/admin/shifts/:id`、`/admin/shifts/:id/cancel`、`/admin/reservations`、`/admin/reservations/:id/assign`、`/admin/reservations/:id/unassign`、`/admin/dispatch` の 9 本。ハンドラは `src/admin_ui.rs`（1,579 行）で、`actions::` を 1 回も参照せず `src/field_api.rs` 経由で Field の汎用 HRM を直接叩く。旧世代のサーバレンダリング管理画面。
- `/field-api/*` の proxy（`src/field_proxy.rs`）。allowlist は golf extension 配下に加えて IAM のメンバー編集、請求書、注文まで通す。Field 側の認可が唯一の防壁になっている。

## やること

### 1. `/admin/*` の生死を確認して、死んでいれば消す

desktop は `desktop/src/api.ts` 経由で `/v1/course/*` を叩く設計なので、`/admin/*` は使われていない可能性が高い。まず確認する。

死んでいれば **`src/admin_ui.rs` と、それ専用の `src/field_api.rs` / `src/smart_assign.rs` ごと削除する。** 認可の穴が消えるだけでなく、Phase 1 と Phase 3 の作業面も減る。

生きているなら 9 本に `Action(...)` を付ける。既存の action 定数（36 個）で足り、新規追加は要らない。

### 2. `/field-api/*` の extension allowlist を消し、残りを細分類する

許可リストのうち extension 関連の 4 行（status、config、extension 配下）は、**desktop の非モックコードから呼ばれておらず既に dead**。しかも配下を許す行は DELETE まで通しており、現時点でも過剰。単純に削除できる。詳細は [Field依存の残骸を消す](../dead-field-coupling-cleanup/task.md)。

残りは今もワイルドカードの 1 エントリになっている。allowlist と同じ粒度でパターンを分け、IAM 系は Field の IAM 認可が正なので `AuthenticatedOnly` のまま、他は該当 action の `Action(...)` にする。更新漏れが 404 ではなく 403 として先に見えるようになる。

### 3. `UpstreamEnforced` を格上げする

**Phase 3 を待つ必要はない。今すぐやれる。**

理由は「認可が消えるから」でも「Field が汎用 action しか見なくなるから」でもない。調べた結果、**Field の認可経路はそもそも extension も細かい action も見ていない**（JWT のメンバーシップ、Tachyon Auth のポリシー、platform と operator の親子関係の 3 つだけ）。つまり `src/course_authz.rs` の「Field が細かく 403 を返すから CourseBoard では検査しない」という設計コメントは、**既に事実ではない**。実質の防壁は usecase 側の `require(actions::…)` だけになっている。

usecase 側が常に効いているので**移行中に空白は生まれず**、順序も問われない。認可チェックのキャッシュが gate と usecase で共有されているので往復も増えない。レビューしやすい一括を推奨する。

格上げ後は「viewer で開ける画面が減っていないか」の確認が要る。ロールごとの権限差は意図的に付けてあり、`manager` は税計算以外の全 action を持つが `viewer` は給与や精算の閲覧を持たない。

## 完了条件

- `/admin/*` が削除されているか、9 本すべてが `Action(...)` に分類されている。
- `/field-api/*` の allowlist から extension path が消えている。
- `/field-api/*` が allowlist と同じ粒度で分類されている。
- ルート分類のテストが「登録されているか」ではなく「期待する分類か」を検査している。
- 拒否する認可クライアントで全ルートを叩いて全部 403 になる統合テストがある。
