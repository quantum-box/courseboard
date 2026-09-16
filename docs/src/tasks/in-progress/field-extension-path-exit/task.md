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
- ~~`/v1/` 内での endpoint 削除を禁じている versioning 方針との調整。~~ → 決着済み（下記「旧ルートは消えない」）。

**これらの実行設計は Field が持つ。** CourseBoard は起票して待ち、path 定数を追従させる。調査で分かった要点だけ親の [design.md](../courseboard-extension-exit/design.md) 末尾に覚え書きとして残してある。

## デプロイと切り戻し

順序は Field（新 path 追加・旧 path は生存）→ CourseBoard API（フラグ off）→ フラグ on → 観測。**Field が旧 path を消す段は無い**（下記）。

**切り戻しはフラグを戻すだけ。** Field 側は何もしなくてよい。旧 path は `/v1` にいる限り残るので、切り戻し先が期限切れで消える心配も無い。

データ形式は変わらず path が変わるだけなので、新 path で書いたデータを旧 Field が読めなくなることはない。パラメータ名が変わる束だけ、新 path 側で旧名も受ける。

## 旧ルートは消えない（PLT-3178）

Field の API バージョニング規約 CERP-25 は `/v1/` 内での endpoint 削除を禁じており、CI の breaking change 検出（`--fail-on WARN`）が機械的に落とす。Field 側 ADR（`golf-domain-courseboard-migration.md`）の Phase 3 は「旧ルートを一定期間 alias として残してから削除する」と書いていて、ここが衝突していた。

判断は **`/v1` に残したまま非推奨にする**（[PLT-3178](https://linear.app/issue/PLT-3178) のコメント）。`/v2` は切らず、CERP-25 に例外条項も足さない。Field 側に付いた条件は 4 つで、いずれも **Field の作業**である。

1. OpenAPI 上で `deprecated: true` を立てる。
2. ルートごとに置き換え先（汎用 `/v1/erp/*`）を明記する。
3. 次のメジャーバージョンでの削除候補として記録する。
4. 利用状況を観測できるようにする（手段が無いなら無いと書く）。

CourseBoard 側への影響は 2 つ。

- **完了条件は変わらない。** 目標は「CourseBoard が呼ばなくなること」で、「Field から消えること」ではない。
- **「Field が消すまで待つ」理由が無くなった。** 汎用 path が既に存在する束は、Field 側の汎用化を待たずに付け替えてよい。

### CourseBoard が呼んでいるルート（2026-09-16 時点）

条件 2・4 の材料として、既知の利用者である CourseBoard 側から出せる棚卸し。`src/course/infrastructure/` の本番コードを読んだもので、テストは除く。「汎用 path」は Field 側 ADR の対応表の値、「実在」は tachyonfield main に実装があるか。

| 呼んでいる `golf-course/*` | 呼び出し元 | 汎用 path（Field ADR） | 実在 | CourseBoard の扱い |
| --- | --- | --- | --- | --- |
| `caddie-profiles`、`caddie-profiles/:id` | `field_ops_gateway.rs` | `/v1/erp/staff-profiles` | あり | 付け替え可。レスポンスにゴルフ列（ランク等）が載るかを先に確認 |
| `caddie-assignments`、`caddie-assignments/:id` | `field_ops_gateway.rs` | `/v1/erp/staff-assignments` | あり | 同上（割当時のフィーが載るか） |
| `caddie-availabilities`、`caddie-availabilities/:caddie_id/:date` | `field_ops_gateway.rs` | `/v1/erp/staff-availability` | あり | 付け替え可 |
| `tabular/analyze` | `reservation_report_gateway.rs` | `/v1/bridge/tabular/analyze` | あり | `COURSEBOARD_FIELD_GENERIC_PATHS` で切替済み（既定 off、ポリシー適用待ち） |
| `caddie-profiles/:id/courses` | `field_ops_gateway.rs` | `/v1/erp/staff-profiles/:id/resource-groups` | なし | Field 待ち |
| `caddie-attendance-snapshot`、`caddie-attendance-snapshots` | `field_ops_gateway.rs` | `/v1/erp/staff-attendance-snapshot`（期間版は対応表に無い） | なし | Field 待ち。期間版を対応表に足す必要がある |
| `caddie-ratings` | `field_ops_gateway.rs` | `/v1/erp/staff-ratings` | なし | Field 待ち |
| `courses`、`courses/:id` | `field_gateway.rs` | `/v1/erp/reservation-resource-groups` | なし | Field 待ち |
| `resources` | `field_gateway.rs` | `/v1/erp/reservation-resources` | あり | 付け替え候補。コース・ナイン・カートの区別（`kind`）が汎用側で表せるかを先に確認 |
| `daily-budgets`、`daily-budgets/import` | `field_commercial_gateway.rs` | `/v1/erp/resource-daily-budgets` | なし | Field 待ち |
| `reservation-policy` | `field_commercial_gateway.rs` | extension config（Field ADR） | — | **Field ADR の置き換え先が ADR-0010 と矛盾する**。汎用の予約ポリシー API として起票し直す |
| `monthly-settlement`、`monthly-settlement/export.csv` | `field_commercial_gateway.rs` | 削除（CourseBoard 自前） | — | [phase1-settlement-achievement](../phase1-settlement-achievement/task.md)。キャンセル未収と Square が Field 待ち |

extension 自体の `/v1/erp/extensions/status` と `/v1/erp/extensions/golf_course/config` は path の付け替えではなく撤退の対象で、[extension-config-exit](../extension-config-exit/task.md) が持つ。

CourseBoard が**呼んでいない**ルート（給与サマリとその CSV、推薦、自動配置、需給、達成率、料金シミュレータ、custom-fields、reservation-products とその slots）は、CourseBoard から見れば今すぐ `deprecated` にしてよい。ただし他の利用者がいないことの証明にはならない（条件 4）。

## 完了条件

- CourseBoard が `/v1/erp/extensions/golf-course/*` を 1 本も呼ばない。
- 追従 PR がすべて `src/course/domain/` と `src/course/usecase/` の diff ゼロで通っている。
- Field への起票が、ゴルフの語彙を含まない受け入れ条件で出ている。
