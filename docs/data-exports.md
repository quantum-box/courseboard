# データ出力

設定の「データ出力」で、出力対象・列名・列順を保存し、CSVをダウンロードできる。
CSVにはUTF-8 BOMを付ける。文字列の引用や数式対策はFieldの汎用出力に任せる。

## 出力対象

Fieldが提供する出力元を、その参照権限に応じて動的に表示する。顧客・社員・会員・予約・請求・会計など、Field側で追加された出力元も利用できる。

CourseBoardが所有するデータも34種類追加する。

- 受付登録：受付表から登録済みの顧客の氏名・ふりがな・電話・メール・生年月日・性別・住所、登録日時と独自項目の回答。顧客が削除済みの場合も登録履歴と独自回答を残し、標準項目は空欄とし「顧客情報あり」をfalseにする。受付の独自項目は現在の設定に加え、削除済み項目の保存済み回答も列に選べる。
- 顧客登録履歴・受付項目設定・独自項目の回答一覧・顧客利用実績・来場履歴・予約キャンセル。
- キャディシフト・勤務希望提出期限・業務と配置・ランク単価・個別単価と変更履歴・シフトルール。
- 会員割引・予約可能期間・顧客等級・予約実績レポート・予約枠の調整・コース表示順・商品と対象コース・プレーヤー区分・料金設定。
- CourseBoardが現在参照しているコース・予約リソース・予約商品・キャディ名簿・社員名簿。
- 対象月を選べるキャディ給与・月次精算・精算予約明細・未払いキャンセル料。

受付OCRの未登録結果や一時ジョブは出力しない。公開決済トークン、Stripe client secret、決済用URLをCourseBoardの出力列に含めない。

## Fieldとの境界

出力定義の保存とCSV生成はField Bridge Export APIが所有する。CourseBoardに出力定義用のテーブルやCSV生成処理を増やさない。

| 操作 | API |
| --- | --- |
| Fieldの出力元一覧 | `GET /field-api/v1/bridge/exports/objects` |
| CourseBoardの出力元一覧 | `GET /v1/course/data-exports/objects` |
| CourseBoardのデータ取得 | `GET /v1/course/data-exports/{source}/rows` |
| 保存済み設定の取得・保存 | `GET/POST /field-api/v1/bridge/exports/definitions` |
| FieldのCSV取得 | `GET /field-api/v1/bridge/exports/definitions/{id}/csv` |
| CourseBoardデータのCSV生成 | `POST /field-api/v1/bridge/exports/definitions/{id}/render` |

CourseBoardの定義には`external:courseboard:<source>`を保存する。CourseBoardが各出力元の既存の参照権限でデータを取得し、選択した列だけをFieldへ渡す。Fieldは当該テナントの有効な定義とBridge出力権限を確認し、共通のマッピングでCSVを生成する。Fieldが所有する出力元に外部行を差し込むことはできない。

両APIはユーザーBearer token、operator/platformヘッダーを引き継ぐ。CourseBoardの一覧は参照できる出力元だけを返し、各ページの取得でも参照権限を確認する。SQLのテーブル・列はコンパイル済みのカタログだけを使い、テナントとページ値をバインドする。

## 件数と障害時の扱い

CourseBoardの保存データはページ末尾まで取得する。Fieldへの生成リクエストは4,000,000バイト以内に分割し、共通生成器が返した同一ヘッダーを使って1ファイルに結合する。10万行または64 MiBを超える、後続ページが失敗する、ページが進まない、生成ヘッダーが変わる、操作途中でテナントが変わる場合は、途中のCSVを保存しない。

給与・精算は対象月を選ぶ。その他の出力元は全件が対象で、期間の絞り込み、設定の編集・削除、Excel形式はこの画面では未対応。Field側の出力件数上限は各出力元の実装に従う。

## リリース順序と検証

ゴルフ場の既存ロール（閲覧・受付・キャディ管理・会計・管理者）に、Fieldの出力設定参照・保存・CSV生成権限を追加する。リリース時に`.tachyon/manifests/tachyonfield-golf-auth.yml`の更新も反映する。各出力元の参照権限による制限は維持する。計算専用ロールには追加しない。

Field PR [#1575](https://github.com/quantum-box/tachyonfield/pull/1575)を先に反映する。`clientDataSupported: true`を返すAPIでのみCourseBoardの追加出力元を表示する。従来のAPIではFieldの既存出力元を引き続き使える。

ローカルの開発用モックには全出力元カタログと受付の独自項目回答を用意する。E2Eで設定保存・並び替え・受付CSVの実バイト・3言語・200%相当と390px表示を検証する。Rustでは出力元の権限、未認証リクエスト、SQLと実スキーマの整合、テナントをまたぐ回答の分離、Field標準項目と独自回答の結合を検証する。
