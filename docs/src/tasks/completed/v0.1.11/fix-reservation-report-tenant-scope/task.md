# 予約表集計を有効なテナントスコープへ保存する

## 概要

本番の予約表取込画面で、保存済み集計の読み込みが
`BadRequest: invalid extension config scope: store` により失敗していた。CourseBoardが
Fieldのextension configで定義されていない `store` scopeを指定していたことが原因である。
Fieldが対応する `tenant` scopeへ保存先を改め、CourseBoard namespace内でコースIDごとに
集計を分離した。

任意形式のCSV・Excelで日付を安全に読めるよう、既存のExcelシリアルとISO表記に加えて、
全角数字、`YYYY年M月D日`、時刻付きISO文字列を選択年の年月日へ正規化する。

## 関連文書

- [ADR-0007](../../../../architecture/decisions/ADR-0007-external-reservation-report-snapshots.md)
- 元機能: [予約表取込](../../v0.1.10/reservation-report-import/task.md)
- Linear: 未起票

## 対応

1. extension configの読み書きを `tenant` scopeへ統一した。
2. `courseBoardReservationReport.courses[courseId]` の下へコース別の行を保存した。
3. 複数コースの変更をメモリ上で構築し、テナント設定を1回だけ更新するようにした。
4. 予約表以外の既存テナント設定を保持した。
5. Excel日付シリアル、全角区切り、和文日付、時刻付きISO日付を決定的に正規化した。
6. 選択年と異なる年、存在しない日付、日/月と月/日を推測しなければならない形式は拒否した。
7. 予約表設定またはコース別コンテナが壊れている場合は、空データとして扱わず上流エラーを返すようにした。

## 変更しないもの

- Fieldの予約、在庫、商品、請求は作成・更新しない。
- 元の午前・午後集計モデルと画面フローは変更しない。
- スタート時刻およびスタート枠照合は別タスクとする。

## 検証

- `cargo test reservation_report --lib`: 17件成功
- `cargo test`: lib 681件、lambda 1件成功
- `cargo clippy --all-targets --all-features -- -D warnings`: 成功
- `cargo fmt --check`: 成功
- `git diff --check`: 成功

## ブラウザ確認

本番で報告されたエラーは旧リリース上のため、このPRのデプロイ前には修正後の認証済み確認を
実施できない。PRのpreviewまたは本番反映後に、対象テナントで保存済み集計の読み込みと
同一ファイルの再取込を確認する。

## 残タスク

- スタート時刻付き入力と既存スタート枠の照合は別PRで実装する。
- マージ後のデプロイと認証済み本番確認は別のリリース証跡として記録する。
