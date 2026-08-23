# Field依存の残骸を消す

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

extension 撤退の調査で、**もう誰も使っていないのに残っている Field 結合**が 3 つ見つかった。どれも独立して消せて、リスクがほぼゼロで、消すと以降の作業の見通しが良くなる。

## やること

### 1. `/field-api/*` proxy の extension allowlist

ブラウザから Field を叩く proxy の許可リストに、extension 関連が 4 行ある。`/v1/erp/extensions/status`、`golf_course/config`、`golf-course` とその配下。

**desktop の非モックコードから extension path を叩いている箇所はゼロ。** UI が extension config と status を触るのは CourseBoard 自前のルート経由で、この 4 行は dead。

しかも配下を許す行は DELETE まで含めて通しており、レビュー観点としては現時点でも過剰。単純に削除できる（UI の回帰は起きない）。

### 2. 残骸の `tenants` テーブル

最初の migration が作り、`'scc'` を 1 行入れて二度と書いていない。CourseBoard のコードから SELECT も INSERT も 1 件も無い。

しかも後の migration が外部キーを全部外していて、そのコメントに経緯が書かれている。「実テナント ID を挿入できないので参照が一度も一致せず、料金計算が全テナントで 400 を返していた」。

テナント判定に転用する案もあったが、[ADR-0011](../../../architecture/decisions/ADR-0011-policy-based-tenant-selection.md) でポリシーベースに決まったので不要になった。撤去する。

### 3. デッドな port

`GolfOpsGateway` の推薦と自動配置は、CourseBoard 側で純粋関数として実装済みで、**呼び出し元がゼロ**。実装本体とテストスタブにしか参照がない。

あわせて開発モックが持っている「CourseBoard のパス → Field の extension パス」の逆マップも、対応する実装が消えたぶんを解体する。

※ これは [月次精算と予算達成率をCourseBoardで計算する](../phase1-settlement-achievement/task.md) の後始末と重なる。どちらか片方でやる。

## 進捗（2026-08-23）

1〜3 とも実施済み。allowlist の extension 4 行を削除（拒否側のテストに反転）、`tenants` テーブルを DROP する migration を追加、`GolfOpsGateway` から `list_caddie_recommendations` / `auto_assign_caddies` と対応 DTO を削除。開発モックの逆マップは**意図的に残した**: mock モードの配置画面がまだその 2 パスを mock の extension handler で受けており、解体すると「UI の挙動を変えない」の完了条件に反する。mock の fixture を CourseBoard パスへ付け替えるときに一緒に解体する（[phase1-settlement-achievement](../phase1-settlement-achievement/task.md) の後始末側）。

## 完了条件

- `/field-api/*` の許可リストに extension path が無い。
- `tenants` テーブルが無い。
- `GolfOpsGateway` に呼び出し元のないメソッドが無い。
- どの変更も UI の挙動を変えていない。
