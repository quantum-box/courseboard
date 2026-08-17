# ADR-0008: URLを `/{tenantId}/{route}?{filters}` にする

## Status

Accepted (2026-08-17)

## Context

desktop SPAは `#/golf/ledger` というhash routingで、テナントは `?tenant=` という
query parameterだった。この形には2つの問題がある。

- **画面の状態がURLに無い。** 予約台帳の日付、コースの絞り込み、月次画面の年月は
  すべてコンポーネントのstateだった。リロードで今日に戻り、送ったリンクは受け手の
  今日を開く。デスクが電話口で「明日の東コース」を共有できない。
- **テナントがpathより後ろにある。** `?tenant=` はフィルタではなく、URLの残り全部が
  どのクラブの話かを決める前提である。route配下のIDはすべてそのテナント内でしか
  意味を持たない。

## Decision

URLを `{base}/{tenantId}/{route}?{filters}` にする。

- **tenantIdはpathの第1セグメント。** フィルタではないのでqueryに置かない。
  第1セグメントがCourseBoardのroute root（`golf` / `staff` / `settings` /
  `cancellation-fees` / `course-map` / `pay` / `download`）ならテナント無しと読む。
- **`pay` と `download` はテナントレス。** 支払いリンクを開く客に自分のテナントは無い。
- **画面の絞り込みはquery。** 日付は `date`、年月は `yearMonth`、コースは `course` /
  `courses`。書き込みは `replaceState`。日付送りで履歴を増やすと、戻るが「前の画面」
  ではなく「前の日」になる。
- **Tauri と `file://` はhashのまま**、中身は同じ `#/{tenantId}/{route}?{filters}`。
  webviewはindex.htmlをディスクから読むので、深いpathは存在しないファイルになる。
- **旧形式は起動時に一度だけ変換する。** `#/route` と `?tenant=` は、bookmarkと
  発行済みの支払いSMSにまだ生きている。404にせず新しい形へ移す。
- **HTTPで配るビルドのbaseは絶対パス。** 相対baseだと `/tn_x/golf/ledger` から
  `./assets/...` が別ディレクトリを指す。Tauri向けビルドだけ相対のままにする。

## Consequences

### Positive

- 予約台帳の1日、1コースの盤面がそのままリンクになる。リロードでも同じ盤面が開く。
- URLを見ればどのテナントの話か分かる。テナント切替がpathに出る。
- 発行済みの支払いリンクは変換で生き続ける。新規発行分は `/pay/{token}`。

### Negative

- 静的配信側にSPA fallbackが要る。Workers static assetsは
  `not_found_handling = "single-page-application"`、axumの `/ui` は
  `not_found_service` で既に満たしている。別の配信先を足すときは同じ設定が必要。
- route rootの一覧がrouterと`App`の両方に必要になる。新しいtop-level routeを足すときは
  `ROUTE_ROOTS` も更新しないと、そのrouteがテナントIDと読まれる。
- 1画面の中でタブを移る遷移は、`navigate` がrouteだけからpathを組み直すため、
  保ちたい絞り込みを明示的にrouteへ載せる必要がある（`golf/caddies/attendance?date=…`）。
