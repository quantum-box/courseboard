# 既存予約システムの日別予約表をとりこむ

## Links

- [設計](./design.md)
- [ADR-0007](../../../../architecture/decisions/ADR-0007-external-reservation-report-snapshots.md)
- Linear issue: 未作成

## 概要

既存予約システムは、施設別・日別・午前/午後別の組数とキャディ付き組数を
Excelで出力できる。一方、CourseBoardにはこの集計を取り込む入口がなく、
移行期間の予約状況をCourseBoard上で確認できない。専用画面でExcelを選び、
対象年と施設からCourseBoardのコースへの対応を確認したうえで、日別集計を
冪等に保存できるようにする。

## Scope

- `日別予約状況` シートの `本年` にある午前・午後の `組数` と `キャ付` を読み取る。
- Excel内に年がないため、取り込み画面で対象年を必須選択する。
- `全体` 行は重複集計になるため保存せず、個別施設だけを対象にする。
- 施設名をCourseBoardのコースへ明示的に対応付け、取込前に月間プレビューを出す。
- 同じ施設・日付・時間帯を再取込した場合は追加せず、最新値でupsertする。
- 取込済み集計を対象月ごとに一覧できるようにする。

## Non-goals

- 予約者名、プレイヤー、ティータイム、商品、支払状態を持つ予約明細の生成。
- 集計値を予約台帳の具体的なスタート枠へ割り当てること。
- Fieldの汎用予約レコード、在庫、売上実績をこの集計で書き換えること。
- `前年実績`、`前年同日`、`予算`、`差異` の取込。

## 対象モジュール

- `src/course/domain/` — 外部予約集計の値と一意キー
- `src/course/usecase/` — Excelプレビュー、取込、月次一覧
- `src/course/infrastructure/` — Field extension config gateway
- `src/course/interfaces/` — multipart APIとOpenAPI
- `desktop/src/features/golf/` — 予約表取込画面

## Plan

- [x] Excel解析と入力検証を実装する。
- [x] Fieldのcourse scope configに対する冪等upsertを実装する。
- [x] プレビュー・取込・一覧APIを実装する。
- [x] 専用画面、コース対応、月間プレビュー、結果表示を実装する。
- [x] Rust / TypeScript testsと実ファイル検証を行う。
- [x] Playwright MCPでUI操作と表示を確認する。
- [x] 固定帳票に一致しないCSV/XLS/XLSX/PDFはFieldのtabular analyzeで列対応を確認し、同じ行の不変条件を再検証する。
- [x] previewのnormalizedFingerprint（mappingと正規化済み行）を保存前に再解析して比較し、fallback結果が変わった場合は409で再previewを要求する（固定xlsxは旧client互換）。

## 完了条件

- UIからCSV/XLS/XLSX/PDFを選び、対象年と施設の対応を確認して取り込める。
- 同じファイルを2回取り込んでも保存件数が増えず、同じ一意キーが1件だけ残る。
- 同一キーの値が変わったファイルは、新しい組数とキャディ付き組数へ更新される。
- 同じ内容を並列取込しても、日付と時間帯をkeyにしたmap構造により重複行ができない。
- 不正なシート名、見出し、日付、負数、キャディ付き組数が組数を超える入力を拒否する。
- 施設の対応が未選択または重複している状態では取込を開始できない。
- 取込結果に対象月、施設数、行数、組数、キャディ付き組数が表示される。

## リスクと保留

- 元ファイルには年がないため、利用者が選んだ年を正として扱う。
- 固定の `日別予約状況` xlsxを最初に解析し、形式が異なる場合だけCourseBoard APIからField
  `POST /v1/erp/extensions/golf-course/tabular/analyze`へmultipartで転送する。ブラウザからFieldへは接続しない。
- PDFは固定parserの対象外としてField analyzeへfallbackし、PDF MIME typeと元ファイル名を保持して転送する。
- PDFは5MiBまでとし、OCRで時間がかかるためtabular analyzeのField転送timeoutは90秒にする（通常のJSON gatewayは15秒）。
- tabular analyzeのrequestは `mappingMode=auto`、Field responseのmapping modeは `alias` または `ai` とする。
- analyzeの対象項目は `facilityName`、`date`、`dayPart`、`groupCount`、
  `caddieAttachedGroupCount` に限定する。返却された列mappingと行はCourseBoard側で必須列、日付の対象年、
  午前/午後、非負値、キャディ付き組数が組数を超えないこと、重複keyがないことを再検証する。
- プレビューのmapping表示は確認材料であり保存入力ではない。確定時にも元ファイルを再送して固定解析または
  tabular analyzeを再実行し、fallback解析時はnormalizedFingerprintの一致を確認する。固定xlsxではfingerprintなしの旧clientも許容する。
- この集計は予約明細ではないため、台帳・空き枠・請求・月次精算の正本にはしない。
- 暫定保存先はFieldのcourse scope extension configとする。全体置換APIのため、異なる
  内容を同時更新した場合は後勝ちになる。将来はFieldの業種非依存snapshot capabilityへ移す。
- PR準備、version bump、commit、push、デプロイは本作業の範囲外。

## Verification

### 入力ファイル

- 指定xlsxの `日別予約状況` シートを確認し、`全体` を除く3施設、
  31日 × 午前/午後 = 186行、組数6,314、キャディ付き2,476と照合した。
- Rust parserで同じ実ファイルを読み、3施設・186行、先頭日2026-07-01を確認した。

### Host checks

- `cargo fmt --all -- --check`
- `cargo check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test reservation_report` — 6 passed
- `cargo test` — 434 passed
- `cd desktop && npm run type-check`
- `cd desktop && npm test` — 48 files / 413 passed
- `cd desktop && npm run build` — 成功（既存のchunk size warningのみ）
- `git diff --check`

### Browser evidence

Playwright MCPを本worktreeのVite `127.0.0.1:5174` へ接続し、xlsx選択、2026年、
3施設の別コース対応、月間確認、確定、同一ファイル再取込を操作した。

- 初回: created 186 / updated 0 / unchanged 0
- 再取込: created 0 / updated 0 / unchanged 186
- 保存済み一覧: 186行、組数6,314、キャディ付き2,476
- console error / warning なし、操作対象network errorなし

ブラウザ証拠はdevelopment mockであり、実Field tenantへの認証済みE2E、デプロイ、
本番HTTP確認は未実施。Field gatewayはローカルmock server testで、既存config保持、
同一再取込、修正版更新、別コースへの再mapping時の旧行除去を検証した。
