# CourseBoard videos

CourseBoard の動画を置く Remotion プロジェクトである。プロモーション動画と、機能ごとの使い方動画をひとつのプロジェクトで持つ。
画面内の組名・担当者名・数値はすべてデモ用であり、実在顧客の情報を含まない。

## Commands

```bash
npm install
npm run studio
npm run type-check
npm run narration             # 受付の使い方動画のナレーションを作り直す
npm run narration:dispatch    # キャディの配置の使い方動画のナレーションを作り直す
```

```bash
npm run render                            # プロモ本編
npm run render:poster                     # プロモのポスター
npm run render:reception-tutorial         # 受付の使い方動画
npm run render:reception-tutorial:poster  # 受付の使い方動画のサムネイル
npm run render:dispatch-tutorial          # キャディの配置の使い方動画
npm run render:dispatch-tutorial:poster   # キャディの配置の使い方動画のサムネイル
```

成果物は `out/` に生成される。

## Compositions

すべて 1920 × 1080 / 30 fps / H.264。

### `CourseBoardPromo` — プロモーション動画（900 frames・約 30 秒）

「受付 → キャディ → 予約 → 顧客管理」の4セクション構成。各セクションに専用の区切り画面と背景色を設け、キャディは需給、ラウンド配置、別業務、シフト、出勤・給与の5画面を連続して見せる。

簡易 BGM は `public/audio/courseboard-promo-bed.wav` に同梱したオリジナル生成音源である。

### `ReceptionTutorial` — 受付の使い方動画（約 97 秒）

受付用紙から顧客を登録するまでを1手順ずつ追う。読み上げと、画面下のテロップで進む。

1. 顧客台帳から「受付用紙から登録する」をひらく
2. 用紙をえらぶ（対応形式・上限・用紙は保存されないこと）
3. 読み取りを待つ
4. 用紙と見比べて直す（直すと元の読み取りが残る）
5. 同意を確認する（必須が埋まるまで登録できない）
6. 登録する（1人ずつ／まとめて）

このあとに「読み取れなかったとき」（行を足す）と「用紙に合わせる」（受付票の項目設定）の補足がつく。

画面は `desktop/src/features/golf/customers/reception/ReceptionPage.tsx` の再現で、文言は日本語 locale の `customers.reception.*` に合わせている。**受付画面の UI や文言を変えたら `src/reception-tutorial.tsx` も直す。**

#### ナレーション

読み上げは Tachyon CLI の TTS（`tachyon tts synthesize`）で作る。原稿は `scripts/narration/reception.mjs` にあり、`npm run narration` で `public/audio/reception/*.wav` と `src/narration.json` を作り直す。原稿が変わっていないクリップは作り直さない（TTS は毎回まったく同じ音にはならないため）。全部やり直すときは `npm run narration -- --force`。

**シーンの尺と画面の動きは、この音声の長さから決まる。** `narration.json` の秒数から各シーンのフレーム数が決まり、カーソルの移動やチェックの入るタイミングは読み上げの進み具合（0〜1）で置いてある。原稿を直せば尺も動きも勝手に合うので、`src/reception-tutorial.tsx` 側で尺を数字で持たない。

認証は Tachyon CLI の profile を使う。既定は `admin` プロファイルと CourseBoard のテナントで、`TACHYON_PROFILE` / `TACHYON_TENANT_ID` で上書きできる。声とモデルは `NARRATION_VOICE` / `NARRATION_MODEL`（既定は `Kore` / `gemini-2.5-flash-preview-tts`）。

### `DispatchTutorial` — キャディの配置の使い方動画（約 103 秒）

その日、だれがどの組につくかを決めるまでを1手順ずつ追う。読み上げと、画面下のテロップで進む。

1. 日付をえらぶ（当日でも先の日でも。未配置・配置済みの組数が出る）
2. 自動で試す（「配置を試す」は候補を並べるだけで、まだ何も決まらない）
3. この配置で決める（割り当てた件数と飛ばした件数が出る）
4. 残りを1組ずつ（「キャディを決める」→ おすすめの候補 → 「この人にする」）
5. 割当を直す（「この日の割当」の付け替え・完了・取り消し）

このあとに「人数の目安」（キャディ付き枠と予備に残す組数）の補足がつく。

画面は `desktop/src/features/golf/CaddiesPage.tsx` の dispatch タブと `UnassignedRounds.tsx` の再現で、文言は日本語 locale の `caddies.dispatch.* / autoAssign.* / unassigned.* / reassign.* / supply.*` に合わせている。**配置画面の UI や文言を変えたら `src/dispatch-tutorial.tsx` も直す。**

原稿は `scripts/narration/dispatch.mjs`。`npm run narration:dispatch` で `public/audio/dispatch/*.wav` と `src/narration-dispatch.json` を作り直す。尺と動きの決まり方は受付の動画と同じ。

## 素材

映像素材はリポジトリ内の CourseBoard ブランド資産とデモ画面のみを利用している。和文フォントは `public/fonts/ipag.ttf` で、読み込みは `src/font.ts` に集約している。
