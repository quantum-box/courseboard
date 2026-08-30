# Fieldのextension path依存を外す

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

CourseBoard の gateway 3 本が `/v1/erp/extensions/golf-course/*` を呼んでいる。Field 側にはこの配下に 30 パスあり、ゴルフ固有のテーブルが 12。

Field 側 ADR はテーブルの汎用名への対応表と、各ルートの扱い（汎用として残す / 削除する）を既に持っている。未着手なのは実行だけで、**その実行設計は Field が持つ**。CourseBoard の関心は「extension path を呼ばなくなること」だけである。

## やること

### CourseBoard 単独でできること

- **gateway の path 定数を関数化し、フラグで新旧を切り替えられるようにする。** 分岐は gateway ファイルあたり 1 箇所に集約する。フラグは 1 つにする（束ごとに分けると運用できない）。
- **usecase の gateway モック回帰テストを補強する。** レスポンスの形が変わる箇所（リソースグループ、日別予算）は先に網を張る。
- **デッドな port を消す。** `GolfOpsGateway` の推薦と自動配置は呼び出し元がゼロ。

### Field の汎用 path が出てから

束ごとに 1 PR で gateway の呼び先を差し替える。

各 PR の受け入れ条件に **`git diff --stat -- src/course/domain/ src/course/usecase/` が空であること**を入れる。空でなければ「gateway で閉じる」前提が崩れているので、レビューで理由を問う。`ports.rs` の trait シグネチャが 1 行も変わらないことも同様に見る。

レスポンスからゴルフ固有の列が消えるなら、gateway が汎用の属性 JSON を読んで既存の domain 型へ詰め直す。CLAUDE.md が言う anti-corruption layer がまさにこれで、domain と usecase を無傷に保つ手段になる。

gateway のテストが path を定数で assert しているので、path を変えるとテストが確実に落ちて変更点が可視化される。この性質を全束で維持する。

### Field に起票して待つもの

- 汎用 API（スタッフ、出退勤スナップショット、リソースグループ、日別予算、予約商品と枠、予約ポリシー）。既存の汎用 path が既にゴルフ実装を呼んでいるスタッフから始めるのが安い。
- ゴルフ固有テーブルの汎用化。
- 予約ポリシーガードの汎用化と、タイムゾーン解決の設定由来化。
- `/v1/` 内での endpoint 削除を禁じている versioning 方針との調整。

**これらの実行設計は Field が持つ。** CourseBoard は起票して待ち、path 定数を追従させる。調査で分かった要点だけ親の [design.md](../courseboard-extension-exit/design.md) 末尾に覚え書きとして残してある。

## デプロイと切り戻し

順序は Field（新 path 追加・旧 path は生存）→ CourseBoard API（フラグ off）→ フラグ on → 観測 → Field が旧 path 削除。

**切り戻しはフラグを戻すだけ。** Field 側は何もしなくてよい。旧 path を一定期間残すのはこのためである。

データ形式は変わらず path が変わるだけなので、新 path で書いたデータを旧 Field が読めなくなることはない。パラメータ名が変わる束だけ、新 path 側で旧名も受ける。

## 完了条件

- CourseBoard が `/v1/erp/extensions/golf-course/*` を 1 本も呼ばない。
- 追従 PR がすべて `src/course/domain/` と `src/course/usecase/` の diff ゼロで通っている。
- Field への起票が、ゴルフの語彙を含まない受け入れ条件で出ている。
