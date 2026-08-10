---
title: "CourseBoard feature flag evaluation boundary"
type: "feature"
emoji: "🚩"
topics:
  - PLT-3384
  - Feature Flags
  - IaC
published: false
---

# CourseBoard feature flag evaluation boundary

## 方針

CourseBoard が所有する flag は `courseboard-flags` manifest の
`feature.courseboard.*` に限定する。Field が先に確定した `field-flags` / `feature.field.*`
と同じ tenant でも key と managed-set marker が衝突しない。最初の宣言は
`feature.courseboard.flag-evaluation-smoke` だけで、既存機能の gate には使わない。

Rust は tachyon-apps 内部の大きな `FeatureFlagApp` を import せず、read-only の
`FeatureFlagEvaluator` port を usecase に注入する。HTTP adapter だけが Tachyon GraphQL
`featureFlagValues` を知り、未登録または response に無い key は必ず `false` にする。
既存の `TACHYON_AUTH_API_URL` と同じ base URL contract を identity lookup と共有し、
新しい production env や secret は追加しない。

Vite client は Tachyon API を直接呼ばない。CourseBoard API の
`POST /v1/course/feature-flags/evaluate` を通じて一括評価し、Provider/hook は missing と
障害時を無効側へ倒す。canary は経路確認のため取得するだけで、画面や業務処理を
分岐させない。

## 反映時間

Tachyon API の feature flag cache は ECS task ごとのインメモリ cache で TTL 60 秒である。
apply または toggle の直後は最大60秒、新旧の評価が混在しうる。CI では待機テストを
行わず、この制約を運用 contract として扱う。

CourseBoard API は追加 cache を持たない。client は tenant 変更、window focus、60秒 interval
で再評価する。したがって開いたままの画面に見える反映時間には、upstream TTL に加えて
次の client 再取得までの時間が含まれうる。厳密な60秒以内の UI 反映が必要な機能は、
利用開始時に別途 invalidation 方式を決める。

## apply safety

- marker: `iac:manifest:courseboard-flags`
- apply 前に per-key dry-run で created / updated / pruned を確認する
- `pruned` が空であることを確認できない限り apply しない
- key を削除するときは consumer code を先に削除して deploy する
- 評価履歴を残す必要がある key は削除せず `enabled: false` にする

production manifest の apply は本 PR の範囲外であり、明示承認後にのみ行う。

2026-08-10 の production read-only snapshot では、共有 tenant の resolved flag は26件、
`tn_01ks18jhh1xvggktfzjx5jqsen` が直接所有する flag は0件、
`iac:manifest:courseboard-flags` marker を持つ flag も0件だった。manifest と同じ reconcile
条件で per-key dry-run した結果は canary 1件が `CREATE`、既存26件が `IGNORE`、`PRUNE`
は0件である。CLI 0.6.30 の `iac plan` は local state との resource-level 比較しか行わないため、
この確認は production GraphQL の live inventory を production の managed-set marker 条件へ
入力した read-only per-key dry-run として実施する。saved manifest を必要とする
`applyManifest(dryRun: true)` のために production へ manifest を先行保存することはしない。
