# Design QA: キャディ配置タブ分離

**Comparison Target**

- Source visual truth: `docs/src/tasks/completed/v0.1.10/caddie-dispatch-tabs/screenshots/source-before.png`
- Implementation (ラウンド配置): `docs/src/tasks/completed/v0.1.10/caddie-dispatch-tabs/screenshots/local-rounds.png`
- Implementation (別業務): `docs/src/tasks/completed/v0.1.10/caddie-dispatch-tabs/screenshots/local-duties.png`
- Combined comparison input: `docs/src/tasks/completed/v0.1.10/caddie-dispatch-tabs/screenshots/comparison.png`
- Viewport: 1280 × 720 CSS px, device scale factor 1
- Source pixels: 1040 × 987。Implementation pixels: 1280 × 720。Combined input: 1280 × 720。
- Normalization: 同じCourseBoard desktop shellとlight themeを比較し、ブラウザchromeは含めていない。Sourceはproductionの空状態、implementationはlocal fixtureの予約あり状態なので、予約行の量ではなくタブ、共通サマリー、主要セクションの階層と密度を比較対象とした。
- State: `2026-07-18` のラウンド配置、および同日の別業務空状態。

**Findings**

- P0/P1/P2の未解決事項なし。
- 情報設計: タブが画面内の最初の操作要素になり、日付と4件の指標は直下の1行に収まっている。変更前に同じ縦列へ混在していた別業務は、対応するtabpanelへ分離された。
- Fonts and typography: 既存のCourseBoard font stack、見出し、本文、補助テキスト、太字の件数を再利用しており、新しい視覚言語は持ち込んでいない。タブとサマリーの小さい文字も判読可能。
- Spacing and layout rhythm: 既存の6単位のセクション間隔、border、radiusを維持し、タブから主作業までの垂直距離を短くした。Sourceより上部の作業モードと当日状況が明確で、主作業の幅を狭めていない。
- Colors and visual tokens: `border-border`、`bg-surface`、`bg-background`、`text-muted-foreground`など既存tokenだけを使用し、選択状態は背景・文字色・`aria-selected`の両方で表現している。
- Image quality and asset fidelity: 新しい写真・ロゴ・装飾画像はない。タブには既存のLucide iconを使用し、CourseBoardロゴや既存iconを置換していない。
- Copy and content: 「ラウンド配置」「別業務」「未配置」「配置済み」「別業務」「空きあり」で運用上の意味を短く示している。別業務側では既存の説明と空状態を保持した。
- Interaction/accessibility: クリック、ArrowLeft/ArrowRight、Home/End、roving `tabIndex`、`aria-controls` / `aria-labelledby`、URLの `tab` 保持を確認。非選択tabpanelは非表示。
- Browser console: local fixtureでwarning/error 0件。

**Open Questions**

- Sourceとimplementationは予約件数が異なるため、実データ量が同じ状態での行単位の高さ比較はPreviewで再確認する。

**Focused Region Comparison**

- タブ＋共通サマリー、および別業務の空状態を個別のimplementation captureで確認した。新規の画像assetや複雑な重なりはなく、重要な文字・境界・選択状態がfull viewportで判読できたため、それ以上のcrop比較は不要だった。

**Comparison History**

- Pass 1: 初回のcombined comparisonでP0/P1/P2なし。コード修正を要する視覚差分はなかった。

**Implementation Checklist**

- [x] タブを日付・指標より上へ置く
- [x] 日付と当日件数をコンパクトな1行へまとめる
- [x] ラウンド配置と別業務を別tabpanelへ分ける
- [x] URL、キーボード、ARIAを確認する
- [x] local fixtureで両タブとconsoleを確認する
- [ ] Previewの認証済み実データで同じ状態を再確認する

**Follow-up Polish**

- P3なし。Previewで実際の長いゴルフ場名や件数を使った折り返しだけを再確認する。

final result: passed
