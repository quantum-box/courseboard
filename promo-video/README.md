# CourseBoard promotion video

CourseBoard の受付、キャディ、予約、顧客管理を約 30 秒で紹介する Remotion 動画である。
画面内の組名・担当者名・数値はデモ用であり、実在顧客の情報を含まない。

## Commands

```bash
npm install
npm run studio
npm run type-check
npm run render:poster
npm run render
```

成果物は `out/courseboard-promo.mp4` と `out/courseboard-promo-poster.png` に生成される。

## Composition

- 1920 × 1080
- 30 fps
- 900 frames（約 30 秒）
- H.264 / AAC

簡易 BGM は `public/audio/courseboard-promo-bed.wav` に同梱したオリジナル生成音源である。
映像素材はリポジトリ内の CourseBoard ブランド資産とデモ画面のみを利用している。

現行版は「受付 → キャディ → 予約 → 顧客管理」の4セクション構成である。各セクションに専用の区切り画面と背景色を設け、キャディは需給、ラウンド配置、別業務、シフト、出勤・給与の5画面を連続して見せる。
