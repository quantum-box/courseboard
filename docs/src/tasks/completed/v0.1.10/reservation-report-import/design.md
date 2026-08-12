# 日別予約表取込の設計

## Links

- [taskdoc](./task.md)
- [ADR-0005](../../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)
- [ADR-0007](../../../../architecture/decisions/ADR-0007-external-reservation-report-snapshots.md)

## Context

入力xlsxは `日別予約状況` 1シートで、施設ごとに `本年`、`前年実績`、
`前年同日`、`予算`、`差異` を持つ。各日は `組数` と `キャ付` の2列である。
予約ID、予約者、人数、ティータイムは存在しないため、Fieldの予約明細へ変換しては
ならない。一方、移行期間のキャディ需給や予約状況の確認には、日別の組数集計自体が
必要である。

## Proposed design

### Import flow

1. UIで対象年とCSV/XLS/XLSX/PDFを選び、CourseBoard APIへmultipartで送る。
2. APIはまず既存の `日別予約状況` xlsx parserを試し、固定形式に一致した場合は
   `本年` の午前・午後だけを正規化する。
3. 固定形式に一致しない場合、APIは受信したファイルをFieldの
   `POST /v1/erp/extensions/golf-course/tabular/analyze`へ、既存Bearer/operator/platformを付けてmultipart転送する。
   `context` とroot配列の `targetSchema` はCourseBoardの5項目に固定し、requestの `mappingMode=auto`を使う。
4. Fieldのheaders/rows/mappingをCourseBoardの不変条件で再検証し、施設名、日付、時間帯、組数、
   キャディ付き組数と集計値を返す。ブラウザはFieldへ直接接続しない。
5. UIはFieldの候補をCourseBoardの5項目ごとの選択欄として表示する。利用者は元列を変更でき、
   明示的な承認後に `columnMappings` と元ファイルをpreview APIへ再送する。
6. APIは利用者mappingの必須・元列存在・重複を検証し、そのmappingで値を再変換する。UIは更新された
   月間表と施設を使って保存先コースを選ばせる。
7. 同じ元ファイル、対象年、承認済み列対応、施設対応を取込APIへ送り直す。新しいUIはプレビューの
   `normalizedFingerprint`（承認済みmappingと正規化済み施設・行のsha256）も送る。
8. APIは固定parserまたはtabular analyzeを再実行し、承認済みmappingを再適用・再検証して、対応先コースごとのField extension configへupsertする。
   fallback解析時はfingerprintが一致しなければ409で保存を止めて再プレビューを要求する。
   固定xlsxはfingerprintなしの旧クライアントも受け付ける。

プレビュー結果をそのまま保存payloadとして信用せず、確定時にも元ファイルを再解析する。
これにより、ブラウザで書き換えた組数が保存される経路を作らない。

### Storage model

CourseBoard DBには保存せず、Fieldの既存extension config capabilityを暫定利用する。
対応先の `golfCourseId` を `scopeType=store` / `scopeId` とし、既存configを保持したまま
namespaced key `courseBoardReservationReport` だけをmergeする。

同keyには `sourceSystem`、正規化した元施設keyと表示名、ファイルhash、更新日時、
日別entry mapを保持する。entry mapのkeyは `YYYY-MM-DD:morning|afternoon` とし、値は
日付、時間帯、組数、キャディ付き組数である。store scope configが未作成の場合は
tenant configをbaseとして複製し、Field側schemaの必須設定を欠かさない。

### Idempotency

日付・時間帯をJSON objectのkeyにして、同じkeyへupsertする。同じファイルの再取込は
値を比較して `unchanged` とし、件数は増えない。修正版は同じkeyの値とファイルhashを
更新する。同一payloadの並列実行も最終状態は同一で、重複entryを構造上作れない。

Fieldのconfig APIはcompare-and-swapを持たないため、異なる内容の同時更新は後勝ちになる。
これは暫定gatewayの制約として明示し、Fieldに業種非依存の外部snapshot capabilityが
追加された時点で移行する。既存configの他keyはGETしてmergeし、上書きしない。

### Validation

- ファイル上限は5 MiB、CSV/XLS/XLSX/PDFを受け付ける。固定帳票のxlsxは厳密形式を優先し、row形式とPDFはField analyzeへfallbackする。PDFのField転送はOCRを考慮して90秒、通常のJSON gatewayは15秒のtimeoutとする。
- シート名、先頭見出し、日別2列構造、`本年` 行を厳密に確認する。
- 日付は見出しの月日と画面で選んだ年から作り、存在しない日付を拒否する。
- 組数とキャディ付き組数は0以上、キャディ付き組数は組数以下。
- `全体` は保存対象外。施設は1件以上必要。
- すべての施設に既存コースを1件ずつ対応させ、同じコースへの重複対応を拒否する。
- inbound bearer、`x-operator-id`、`x-platform-id` は既存API境界を維持する。

### Tabular analyze fallback contract

CourseBoardがFieldへ送るmultipartは `file`、`context`、root配列の `targetSchema`、`mappingMode=auto`。Field responseのmapping modeは `alias` または `ai` として表示する。
Fieldの返却 `headers`、`rows[{sourceRowNumber,values}]`、`mapping.fields` を保存入力として信用せず、
CourseBoardが対象列を1つずつ解決してから値を日付・時間帯・件数へ変換する。Fieldのmappingは候補であり、
UIは利用者が元列を修正して承認できるようにする。承認済みmappingは `target -> source header` の
`columnMappings` としてpreview/importの両方へ送り、サーバーが元ファイルへ再適用する。
fallback時は承認済みmappingを含むnormalizedFingerprintを比較する。FieldのAIは列候補を作る補助であり、予約明細は生成しない。

### API

- `POST /v1/course/reservation-report-imports/preview`
  - multipart: `file`, `year`, optional `columnMappings` JSON
  - parsed facilities, rows, totalsを返す。
- `POST /v1/course/reservation-report-imports`
  - multipart: `file`, `year`, `courseMappings` JSON, optional `columnMappings` JSON、optional `normalizedFingerprint`
  - fallback解析時は `columnMappings` と `normalizedFingerprint` を必須にする。
  - upsert結果とtotalsを返す。
- `GET /v1/course/reservation-report-entries?from=...&to=...`
  - tenant scopeの取込済み集計を返す。

### UI

予約領域に「予約表をとりこむ」専用画面を追加する。画面の仕事は
ファイル選択、列・施設対応、確認、取込の4段階に限定する。列対応では判定方法、確信度、
sampleを表示し、利用者が元列を変更して明示承認するまで先へ進ませない。主役は元帳票にならった
月間プレビューで、施設ごとに午前/午後の組数とキャディ付き組数を確認できる。
個別予約は作らないことを画面上に明記する。

新規の本文、表、補足、エラーは16px以上、操作部品は44px以上にする。
失敗時はファイルと施設対応を保持し、その場で再実行できるようにする。

## Alternatives

### Field予約を組数分だけ自動生成する

予約ID、予約者、人数、正確な時刻がなく、在庫と売上を架空データで汚すため不採用。

### CourseBoard DBに専用テーブルを作る

強い一意制約と検索性は得られるが、ADR-0005の「データはField DBへ残し、CourseBoardへ
物理移送しない」という境界に反するため不採用。

### ブラウザだけでxlsxを解析する

保存時の再検証を共有できず、改ざんされた中間payloadを信頼することになるため不採用。

## Rollout and operations

新しいCourseBoardテーブルは作らず、Field configのnamespaced keyだけを追加する。
既存予約と予算実績には影響しない。取込済み集計を実績計算へ接続する変更は別taskとし、
このPRでは保存・一覧・UI確認までに限定する。

## Test plan

- parser unit: 指定xlsx、見出し不正、日付不正、負数、キャディ数超過、全体除外。
- gateway/usecase: 初回insert、同一再取込、修正版update、既存config key保持、tenant分離。
- HTTP: multipart上限、認証、mapping不足・重複、preview/import response。
- TypeScript: column mapping、明示承認、course mapping、summary、month grid、file state。
- Playwright系CLI: ファイル選択、preview、mapping、確定、成功結果、再取込。

## ADR decision

運用データにextension configを暫定利用し、将来Field capabilityへ移す境界判断を
ADR-0007として記録する。
