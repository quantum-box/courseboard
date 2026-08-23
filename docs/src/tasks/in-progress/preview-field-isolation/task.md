# PR previewを本番Fieldから切り離す

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

`tachyon.yaml` の preview 環境は TiDB だけを isolated に provision し、`TACHYON_FIELD_API_URL` は本番 Field を指したままになっている。つまり PR の preview は常に本番 Field を相手に動く。

`POST /v1/course/demo-seed` は本番テナントへコース・予約・キャディを書く。extension config は compare-and-set を持たず、CourseBoard は configJson を丸ごと PATCH するため、preview のブランチが本番テナントの設定を巻き込んで上書きしうる。

移行の検証を始めた瞬間にこれを踏む。gateway を差し替えたブランチが本番 Field に対して読み書きすることになる。

## やること

### preview の Field 接続先を変える

段階を 2 つに分ける。

1. **すぐやる** — preview の `TACHYON_FIELD_API_URL` を `empty://` にする。`src/config.rs` は既にこのスキームをサポートしていて、proxy とプロフィール取得はそれぞれ 503 と None に落ちる。壊れずに「Field 依存機能だけ無効」になる。
2. **望ましい形** — Field の sandbox テナントを 1 つ用意し、preview はそこを指す。Field は `x-platform-id` で prod と sandbox を区別する仕組みを既に持っている。

### demo-seed に本番ガードを入れる

本番 platform に対する実行を既定で拒否し、環境変数で明示的に許可されたときだけ通す。

## 完了条件

- preview 環境が本番 Field に書き込めない。
- preview で Field 依存機能を開いても 500 ではなく「利用できない」旨が出る。
- `demo-seed` が本番 platform では既定で拒否される。
