# 経営会議向け機能紹介スライド

ゴルフ場の経営会議で CourseBoard を紹介するためのスライド。
ファイルは [`CourseBoard_機能紹介.pptx`](./CourseBoard_機能紹介.pptx)（23枚 / 16:9）。

## 何を載せているか

機能紹介が主で、課題提起や導入効果の試算は入れていない。扱う領域は3つ。

- **受付票の読み取り** — 用紙を読み取って顧客台帳へ登録するまでと、用紙ごとの項目設定
- **顧客台帳（CRM）** — 会員とビジターを同じ台帳に載せる、顧客カルテ、グレードと会員種別
- **キャディ運用** — 休みの希望からシフト・配置・出勤・給与までの流れ、自動配置、キャディ付き枠の需給

構成は 表紙 / 全体像 / アジェンダ → 3領域（各章に扉1枚＋説明と実画面）→ まとめ / クロージング。
各ページに発表者ノートを入れてある。

## 実画面のキャプチャについて

「実際の画面：」で始まるページは、モックモードで起動した desktop を Playwright で撮ったもの。
本番テナントには接続していないので、**画面に出ている顧客名・金額・キャディ名はすべて
`desktop/src/dev/mockFieldApi.ts` の fixture**であり、実在の来場者やスタッフではない。

```bash
cd desktop && npm ci
env VITE_BASE_PATH=/ \
    VITE_COURSEBOARD_AUTH_MODE=development \
    VITE_COURSEBOARD_API_BEARER=local-dev-token \
    VITE_COURSEBOARD_TENANT_ID=courseboard_id \
    VITE_COURSEBOARD_MOCK_DATA=true \
    VITE_COURSEBOARD_BROWSER_CLIENT_ID= \
    node_modules/.bin/vite --port 5174 --strictPort
```

このモードはログインもバックエンドも要らない（`e2e/auth.setup.ts` と同じ前提）。
`:5173` は他のセッションが使っていることがあるので、撮り直すときは別ポートを立てる。

## 受付票の扱い

OCR のページで原本として写っているのは、札幌カントリー倶楽部の「ゲスト受付票」の**書式を再現したもの**。
チェック欄・フリガナのマス・生年月日の元号・住所2行・個人情報の取り扱いの囲みまで実物に合わせてあるが、
**記入内容は実在の来場者ではなくデモ用の値**に差し替えている。
スライドが配布・回覧される前提なので、第三者の氏名・生年月日・住所・電話番号は載せない。

実物の受付票の写真をそのまま載せたい場合は、クラブ側で個人情報の取り扱いを判断してから差し替えること。

読み取り結果は1名分にしている（この用紙が1枚1名のため）。撮影時は fixture を1名分に、
受付票の項目設定を用紙に合わせて（メールアドレスを外し、生年月日・性別・住所を有効に）一時的に
変更しており、リポジトリには戻してある。撮り直すときは同じ調整が要る。

## 更新するとき

数字と文言はコードから起こしている。ずれたら次を見る。

- 画面の文言 — `desktop/src/i18n/locales/ja/`
- キャディ推薦の理由と重み — `src/course/domain/caddie_ranking.rs`
- 自動配置と配置できない理由 — `src/course/domain/caddie_plan.rs`
- 顧客グレードの判定 — `src/course/domain/customer_grade.rs`
- 受付票 OCR の仕様 — `docs/src/tasks/in-progress/ai-ocr-customer-reception/task.md`

「キャディ付き枠の需給」ページの組数（18 / 16 / 11 / 5）は表示例で、スライドにもその旨を書いている。
