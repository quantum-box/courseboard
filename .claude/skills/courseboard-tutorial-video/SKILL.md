---
name: courseboard-tutorial-video
description: CourseBoard の機能の使い方を解説する動画を Remotion で作るときの決まり。画面モックの組み方、カーソルと強調枠の置き方、Tachyon CLI の TTS で作るナレーション、尺を音声から決める仕掛け、静止画での座標確認。キャディ・予約・シフト・顧客管理などの使い方動画を新しく足すとき、既存の使い方動画を直すときに読む。
---

# CourseBoard の使い方解説動画

`video/` が動画置き場。プロモーション動画と機能ごとの使い方動画が同居する。完成形は
[reception-tutorial.tsx](../../../video/src/reception-tutorial.tsx)（受付）と
[dispatch-tutorial.tsx](../../../video/src/dispatch-tutorial.tsx)（キャディの配置）の2本で、
新しい動画はどちらかを写して作る。部品（Stage / Cursor / Ring / MockPanel …）は両方に同じものが
入っている。配置の方には、表・シート・タブ・数値カードの部品と、座標を定数から引く書き方がある。

プロモ動画（`rapid-video.tsx`）とは別物。**プロモは「何ができるか」を見せ、使い方動画は
「どう操作するか」を1手順ずつ追う。** 画面モックの作り込みと、カーソル・強調枠・
状態遷移の正確さが要る。

## 作る順番

1. **対象画面のコードと文言を読む。** 画面は `desktop/src/features/**` の再現で、
   文言は `desktop/src/i18n/locales/ja/*.ts` に合わせる。画面に無い言葉を動画で使わない。
   使う人は動画の言葉で画面を探す。
2. **ナレーション原稿を書く。** 生成スクリプトを作る（下記）。
3. **音声を作って尺を確定させる。** `npm run narration`。
4. **シーンを組む。** 動きは読み上げの進み具合で置く（下記）。
5. **静止画で座標を確かめる。** これを飛ばすとカーソルが必ずずれる（下記）。
6. **通しでレンダリングする。**

## ナレーションが尺を決める

尺を tsx に数字で持たせない。音声の長さから決める。

- 生成は `video/scripts/build-narration.mjs <機能>`。原稿と出力先は
  `video/scripts/narration/<機能>.mjs`（`audioDir` / `manifest` / `clips`）にある。
  **新しい動画はここにファイルを1つ足し、`package.json` に `narration:<機能>` を足す。**
- `npm run narration`（受付）/ `npm run narration:dispatch`（配置）が
  `public/audio/<機能>/*.wav` と、音声の長さを並べた JSON を書く。
  受付は `src/narration.json`、配置は `src/narration-dispatch.json`。
  原稿が変わっていないクリップは作り直さない（TTS は毎回まったく同じ音にならないため、
  作り直すと関係ないシーンの尺まで動く）。**流す前に `git status` で音声が触られていないことを
  確かめる。** manifest の `hash` が原稿とずれていると全クリップが作り直される。
- tsx 側は JSON の秒数から `sceneFrames(id)` を出し、`TransitionSeries.Sequence` に渡す。

```ts
const FPS = 30;
const LEAD = 12;  // 音声が鳴り出すまでの間。直前のトランジションが終わる長さ
const TAIL = 18;  // 言い終わってから次のシーンへ移るまでの間
const speechFrames = (id) => Math.round(narration.clips[id].seconds * FPS);
const sceneFrames = (id) => speechFrames(id) + LEAD + TAIL;
```

`LEAD` を挟むのは、トランジションで前後のシーンが重なるあいだに次の声が
かぶらないようにするため。`LEAD` は `FADE` と同じ値にしておく。

### 画面の動きは読み上げの進み具合で置く

フレーム数を直に書かない。`cue(speech, 0〜1)` で「この言葉のあたり」を指す。
原稿を直して尺が変わっても、押す位置と喋る位置の関係が崩れない。

```tsx
const ConsentScene = ({speech}: SceneProps) => {
  // 「チェックが入るまで登録できません」と言い終わってから入れる
  const ticks = [cue(speech, 0.34), cue(speech, 0.44)];
```

**言っていることと画面が食い違わないようにする。**「チェックが入るまで登録できません」
と言っている最中に登録可能にしてしまうと、意味が逆になる。まず制約が効いている状態を
見せ、言い終わってから解除する。

### TTS の読み

`tachyon tts synthesize`（既定は Gemini 2.5 Flash TTS / 声は `Kore`）。
`tachyon tts models` に声の一覧がある。

- **読ませたいとおりのかなで書く。** 「CourseBoard」→「コースボード」、
  「PDF」→「ピーディーエフ」、「10MB」→「10メガバイト」。記号と英字は読み違える。
- 認証は Tachyon CLI の profile。既定は `admin` / CourseBoard のテナントで、
  `TACHYON_PROFILE` と `TACHYON_TENANT_ID` で上書きできる。
- 声を変えるなら `NARRATION_VOICE=Charon npm run narration -- --force`。
- **音は自分で聴けない。** 抑揚と誤読は人に確かめてもらう。そう言って渡す。

## 画面モックの骨格

`Stage` が動画の枠、`AppWindow` がアプリの窓、その中に `MockPanel` を積む。
座標は下記の固定値を前提にしている。変えるとカーソルの座標を全部引き直すことになる。

```
WINDOW  = {left: 120, top: 104, width: 1680, height: 780}
CONTENT = {left: 356, top: 178, width: 1416, height: 678}   // 窓の中の描画領域
```

- 上部（0〜104）にロゴ・画面名・`STEP n / 5`
- 中央が窓。タイトルバー46px＋サイドバー208px
- 下部（908〜1024）にテロップ帯

部品は `MockPanel` / `Btn` / `Notice` / `Check` / `FieldBox` / `SavedBadge` / `PaperSheet`。
実画面の `Panel`・`Button`・`Notice` に対応させてあるので、新しい動画でも同じものを使う。

文字は本文18px以上。1920の画面で16px以下は読めない。業務画面の密度をそのまま
持ち込まない（画面そのものの決まりは [courseboard-screens](../courseboard-screens/SKILL.md)）。

## カーソルと強調枠

### `overlay` に渡す。`children` に置かない

`Stage` の `children` に置くと `AppWindow` が基準になり、**座標が窓の分（+120 / +104）
ずれるうえ、`overflow: hidden` で窓の外に出た部分が消える。** `Stage` の `overlay` は
動画の最上位に出るので、1920×1080 の絶対座標でそのまま置ける。

```tsx
<Stage
  narration={<Narration id="entry" />}
  overlay={
    <>
      <Ring x={1534} y={200} width={218} height={46} from={cue(speech, 0.32)} to={cue(speech, 1)} />
      <Cursor stops={[…]} clicks={[…]} />
    </>
  }
>
```

`Ring` には**対象の矩形をそのまま渡す。** 外に逃がす余白（`RING_PAD`）は `Ring` 側が持つ。

### 強調枠は赤

`T.guide`（`#e23b2e`）。**画面の色（緑・砂）で囲むと primary ボタンに埋もれて見えない。**
注釈は全部同じ赤で揃える。色を分けると「これは動画の注釈」という手がかりが弱くなる。
クリックの波紋も同じ赤。

### 座標は静止画で確かめる

目分量で書いた座標はまずずれる。シーンごとに1枚書き出して見る。

```bash
npx remotion still src/index.ts <CompositionId> out/check/f900.png --frame=900
```

見るのは、カーソルの先端が対象を指しているか、強調枠が対象を囲んでいるか、
その時点の状態遷移（チェック済み・登録済み・警告の有無）が合っているか。
チェックボックスのように小さい対象は、**行が1つずれていても一見それらしく見える。**
確認するフレーム番号は、シーンの開始フレーム（前のシーンの合計 − `FADE` × 本数）＋
シーン内の位置で出す。

## デモデータと文言

- **実在顧客の情報を入れない。** 名前・電話・住所はすべて架空の値にする。
  電話は `090-0000-0001` のような明らかなダミー。
- 画面は実物の写しではなく再現なので、**対象画面の UI や文言を変えたら動画側も直す。**
  どの画面の再現かをファイル冒頭のコメントと README に書いておく。
- OCR の誤読を見せるなら、実際に起きる形にする（`渡邊` → `渡辺` など）。

## 登録と書き出し

`src/root.tsx` に `Composition` と、サムネイル用の `Still` を足す。
`durationInFrames` は音声から出した定数を渡す。

```tsx
<Composition
  id="ReceptionTutorial"
  component={ReceptionTutorial}
  durationInFrames={RECEPTION_TUTORIAL_FRAMES}
  fps={30}
  width={1920}
  height={1080}
/>
```

`package.json` に `render:<機能>-tutorial` と `render:<機能>-tutorial:poster` を足す。
成果物は既存にならって `out/` にコミットしている（1本あたり10MB前後）。

## つまずきやすいところ

- **`resolveJsonModule`** が要る（`narration.json` を読むため）。`tsconfig.json` にある。
- **`loadFont` は `src/font.ts` に集約されている。** 動画ごとに `loadFont` を呼ばない。
- **`premountFor`** は先頭シーン以外に付ける。付けた区間は音が鳴らないので、
  `LEAD` があれば声が切れることはない。
- **音声トラックが入ったか**は書き出し後に確かめる。
  `npx remotion ffprobe out/….mp4` に `Stream #0:1 … Audio: aac` が出る。
- **プロモ動画を壊していないか。** `font.ts` など共通部分を触ったら、
  `CourseBoardPromo` も1フレーム書き出して見た目が変わっていないことを確かめる。
