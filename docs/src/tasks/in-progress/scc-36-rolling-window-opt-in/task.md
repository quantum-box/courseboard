---
title: "SCC-36 Field ローリング窓へのオプトイン"
type: "feature"
emoji: "🗓️"
topics:
  - "golf"
  - "field-integration"
published: true
linear: "SCC-36"
---

# SCC-36 Field ローリング窓へのオプトイン

CTO 承認済みの骨格。詳細設計は design.md で具体化する。

## 背景

PLT-3361 で Field 側にローリング窓が本番稼働した（tachyonfield PR #1212 /
#1227。毎時ジョブ、初日 29/29 実行成功・全 no-op を確認済み）。
`PUT /v1/erp/reservation-resources/{id}/schedule` のトップレベルに
`rollingWindowDays`（1〜365、省略=維持 / null=解除）が追加されており、
設定されたリソースは Field の毎時ジョブが「現地今日 + rollingWindowDays」まで
枠在庫の先端を自動で進める。

courseboard は現在、訪問駆動の肩代わり実装（`ExtendCourseInventoryUseCase`、
`GET /v1/course/tee-ledger` から相乗り実行）で先端を進めている。本タスクは
オプトイン（第1段）のみを行い、肩代わりの撤去・SCC-35 警告の切替（第2段）は
Field ジョブの実生成を確認してから別タスクで行う。両者は同じ冪等な生成経路を
共有するため併走しても安全（PLT-3361 設計で保証済み）。

## 確定事項（骨格）

1. **設定値はテナントの BookingHorizon から導出**: 定数 180 を直書きせず、
   `BookingHorizon`（`src/course/domain/schedule.rs:186`、既定180日）の日数を
   使い、1..=365 にクランプする。SCC-35 警告の比較元（bookable_through）と
   同じ設定に追随させることで、テナントが受付期間を変えても Field の先端と
   警告が整合し続ける。
2. **スケジュール保存経路への同送**: `schedule_replace_body`
   （`src/course/infrastructure/field_gateway.rs:1169-1195`）を拡張し、
   PUT ボディのトップレベルに `rollingWindowDays` を含める。受付枠を保存する
   たびに再送される（自己修復）。rules 全置換契約は既存の GET→PUT パターン
   （`field_gateway.rs:944-947`）のまま壊さない。
3. **台帳フックでの自動バックフィル**: `GET /v1/course/tee-ledger` の
   `ExtendCourseInventoryUseCase` 実行箇所（`src/course/interfaces/http.rs:620-630`
   付近）で、コースリソースの `rollingWindowDays` が未設定または期待値と
   異なる場合に設定する。これにより既存コース全件が通常運用の中で自動的に
   オプトインされ、別建ての運用スクリプト・認証情報が不要になる。
   ベストエフォート（失敗しても台帳表示を妨げない）とする。
4. **肩代わり実装には手を入れない**: `ExtendCourseInventoryUseCase` の
   延長処理・`golf_generated_through` ウォーターマーク・警告ロジックは
   本タスクでは変更しない（第2段の範囲）。

## design.md へ委譲する詳細

- **off-by-one の検証（必須）**: `BookingHorizon::last_bookable_date`
  （`src/course/domain/schedule.rs:250`）の式と Field 側の先端
  （現地今日 + rollingWindowDays、文字どおりの加算）を突き合わせ、
  Field の先端が常に bookable_through 以上になる rollingWindowDays の導出式を
  確定する（タイムゾーンの前提も明記）
- GET schedule 応答からの現在値（`rollingWindowDays`）の読み取りと、
  設定不要判定（毎回 PUT しない。台帳フックは読み取り主体で、差分がある
  ときだけ書く）
- `ReservationScheduleGateway`（`src/course/domain/ports.rs:603-643`）への
  メソッド追加 or 既存 replace の入力拡張のどちらを採るか
- バックフィルの実行頻度制御（台帳フックは訪問ごとに走る。GET 1回の
  追加コストの評価と、テナント内キャッシュ等の要否）
- テスト計画（gateway のボディ組み立て、バックフィルの分岐、
  ExtendCourseInventoryUseCase との併走不変性）
- Field 側 API のエラー（400 など）時のフォールバック（台帳表示を妨げない）

## 後続タスク（本タスクの範囲外・第2段）

- Field ジョブの workflow サマリーで candidates>0 / generated>0 を確認後:
  肩代わり実装・ウォーターマーク・台帳フックの撤去、SCC-35 警告の
  generated_through 取得元の切替（SCC-35 の修正①②の要否も再判断）
