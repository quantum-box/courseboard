# 顧客・日次予算・予約表集計の共通取込

関連: [issue #381](https://github.com/quantum-box/courseboard/issues/381)、
[先行するField PR #1567](https://github.com/quantum-box/tachyonfield/pull/1567)。

`/golf/data-imports` の対象選択から、テンプレート取得、ファイル選択、全行検証、
実行確認、結果・履歴を利用する。顧客台帳・日次予算・予約表集計の既存画面からも
直接開ける。予約表集計は既存の機能フラグに従う。従来の予約表/PDF解析APIは維持する。

## データの所有境界

| 対象 | 共通対象キー | 検証・書込み先 | CourseBoardの業務権限 |
| --- | --- | --- | --- |
| 顧客台帳 | customer | Field顧客ドメイン | field_extension_golf:ManageCustomers |
| 日次予算 | dailyBudgets | Field予約ドメイン | field_extension_golf:ManageBudgets |
| 予約表集計 | courseboardReservationReports | CourseBoard予約表集計 | field_extension_golf:ImportReservationReports |

顧客・日次予算は既存の台帳・予算読込みで結果を表示する。予約表集計は
`golf_reservation_report_rows` を施設単位で置換する。個別の予約レコードには書き込まない。
FieldのジョブからCourseBoardのDBへ直接接続しない。

`GET/POST /v1/course/data-imports/{path}` は3対象だけのBFFで、`objects`、
`objects/{key}/template?format=csv|excel`、`objects/{key}/imports/preview|upload-url`、
`jobs`、`jobs/{id}`、`jobs/{id}/preview/{page}`、
`jobs/{id}/validate|advance|cancel|resume` を許可する。
既存ユーザーBearerと対象テナント・platformをFieldへ渡す。
一覧・履歴は業務権限とCourseBoard由来の取込に絞り、各ジョブ操作でも再確認する。
FieldはBridge権限、対象の所有側権限、委任、作成ユーザーを確認する。

## 予約表集計の所有API

`POST /v1/course/common-import-owner/{source|validate|ready|stage|finish}` は
`{jobId,actorId,sourceSha256,options,input}` を受ける。
`options` は年、列名対応、元施設名→有効なテナントコースIDの対応を含む。
施設・コースの多重対応、範囲外コース、年・件数・日付の不整合を拒否し、
未対応施設は未連携施設として保存する。空の列対応は自動対応を使用する。

検証は業務レコードを変更せず、所有DBの3つのcommon-importテーブルに
元行番号・確認済みオブジェクト・元ファイルSHA・ユーザー・施設の事前状態を保持する。
全ページ検証後にready、実行確認後にstageする。stage/finishは現在のFieldジョブ、
Bearer、元ユーザー・ファイル・設定・処理件数を照合する。
finishは施設の現在値を再確認し、100行のキー順ページで置換を作り、
全置換と保存結果receiptを同一トランザクションで確定する。
応答消失後の再送はreceiptを返し、新しい編集を上書きしない。

## ファイルと再開

Fieldと同じ判定器を使用する。3,000,000 bytes / 非空論理500行を超えるCSVと
すべてのExcelはStorage経由。引用符内改行・BOM・空行を判定時も保持する。
大容量CSVは1 GiB、Excelは32 MiBまで。ブラウザーは全件を保持せず
ファイルを分割してSHAを計算し、Storageへ直接PUTして100行の結果ページを読む。
旧「日別予約状況」Excelは所有側の既存解析を再利用し、元の物理行番号を引き継ぐ。

中止・再開は同じジョブの保存済み段階・件数を使用する。アップロード再開時は
元ファイルSHAを照合して同じStorageキーへPUTする。テナント変更・中止・ページ切替で
古い応答を無効にし、処理中や後続検証エラーでも直前のプレビューを保持する。
設定変更時は新しいジョブで全行を再検証し、再度実行確認を求める。

## 配備と確認

Field #1567のAPI契約を先行させ、CourseBoardの追加migrationと所有APIを配備する。
標準の経理・管理者ロールにはmanifestのBridge一覧・プレビュー・実行権限を反映する。
各取込対象の業務権限は引き続き必須で、Bridge権限だけでは書き込めない。
このPRの初回プレビューが適用済みの `20261007090000` は、番号・SQL・checksumを
不変に保つ。以降のmigrationは従来の `YYYYMMDDNNNN` を使用する。
両方が揃うまでは予約表集計の所有API不在を成功扱いにしない。
PRのCIと本番確認は別で、配備後には3対象の保存先画面への読戻し、対象テナント・
コース、失効/範囲外委任、別ユーザーの拒否を現行Bearerで確認する。

ローカル検証は関連Rustテスト、ファイル判定15ケース、CourseBoard共通取込の
通常/バッチブラウザーテストに限定する。DBの所有API契約（205行の施設置換、
確認前未書込み、設定・ユーザー・件数照合、receipt再送、変更後の置換拒否）と
アプリ全体は最新headのCIで確認する。
