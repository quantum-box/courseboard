# データ出力

設定の「データ出力」で、出力するデータ・列名・列順を保存し、一覧からCSVをダウンロードできる。
CSVにはUTF-8 BOMを付け、日本語の列名をExcelでも開けるようにする。

## Fieldとの境界

CourseBoardは既存のField Bridge Export APIを、認証済みの`/field-api`プロキシから呼ぶ。
出力元カタログ、出力定義の永続化、データ取得、CSV生成はFieldが所有する。
CourseBoard独自の出力テーブル、出力元の固定リスト、認証設定は追加しない。

| 操作 | Field API |
| --- | --- |
| 出力元と列の取得 | `GET /v1/bridge/exports/objects` |
| 保存済み設定の取得 | `GET /v1/bridge/exports/definitions` |
| 設定の保存 | `POST /v1/bridge/exports/definitions` |
| CSVの取得 | `GET /v1/bridge/exports/definitions/{id}/csv` |

プロキシは上記のパスとHTTPメソッドだけを許可し、既存のユーザーBearer tokenと
operator/platformヘッダーを引き継ぐ。認可はFieldのBridge操作権限と出力元の参照権限で行う。
取得できない出力元と停止中の設定はダウンロード不可とし、403などの失敗本文をファイルに保存しない。

## 現在の範囲

- Fieldに登録された出力元を動的に表示する。出力元の追加はCourseBoard側の変更を必要としない。
- 列の選択・列名変更・上下ボタンによる順序変更、新しい出力設定の保存と再利用に対応する。
- 設定の編集・削除、期間フィルター、Excel形式の出力は現在のField汎用APIに含まれない。
- 出力件数はFieldの各出力元の取得上限に従う。予約の現在の実装は最大500件で、全件のページングは行わない。
- ブラウザの開発用モックに予約の出力元・保存済み設定・CSVを用意し、本番APIと分離して確認できる。
