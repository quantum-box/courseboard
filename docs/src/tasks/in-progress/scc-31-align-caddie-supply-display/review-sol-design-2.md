# SCC-31 詳細設計レビュー（第2巡）

## 集計

**重大 0 / 高 2**

第1巡の6件はすべて設計本文・テスト計画へ十分に反映されている。
一方、専用 read action の追加だけでは受付 bearer が Field の roster read を通れないことと、
既存 policy を更新できない manifest apply の特性がロールアウト計画へ反映されていないことから、
受付で 200 にする受け入れ条件は現状の計画では達成できない。

## 第1巡指摘の解消判定

| # | 第1巡の指摘 | 判定 | 確認内容 |
| --- | --- | --- | --- |
| 1 | 手動配置の候補・確定 UI が変更対象から漏れている | 解消 | `UnassignedRounds.tsx` の `NameCaddieSheet` を変更対象とし、候補 badge、POST 前 confirm、cancel/continue/POST の component test まで明記された（`design.md:163-165,184`）。 |
| 2 | capacity 超過時に course mismatch が消える | 解消 | mismatch を残 capacity と独立した predicate とし、exceeded との重複および複合 table test を明記した（`design.md:27-31,95,127`）。 |
| 3 | `widen_for_utc_date_filter()` の引数数が違う | 解消 | 二引数の `widen_for_utc_date_filter(date, date)` と、timezone を渡す `tenant_day_bounds()` に修正された（`design.md:97-99`）。 |
| 4 | 新 read action の degraded-mode allowlist が漏れている | 解消 | `READ_ONLY`、`ALL`、`is_read_only`、manifest grant、degraded-mode cache test が変更対象に追加された（`design.md:121-123,131`）。 |
| 5 | 424 / stale-data 非表示を必要な層で検証できない | 解消 | usecase の `CourseError::Provider`、HTTP/router の 424 JSON/CORS、frontend の初回・refresh 後エラーを層別に検証する計画になった（`design.md:127-131,181-185`）。 |
| 6 | `AssignmentStatus::as_str()` は既に public | 解消 | 新 getter の追加を取り消し、既存 `as_str()` の利用へ修正された（`design.md:59-61,101-103`）。 |

## 重大

問題なし。

## 高

### 1. 専用 action を付与しても受付 bearer は Field の roster read で 403 になる

**指摘内容**

design.md は `ListCourseCaddieSupply` を reception policy に付与すれば supply が 200 になる前提だが、
`GetCourseCaddieSupplyUseCase::execute()` は supply 集計の前に必ず
`GolfOpsGateway::list_caddie_roster()` を呼ぶ。実 adapter は caddie profile に加えて
`GET /v1/erp/staff` を利用者本人の bearer で読むため、CourseBoard の専用 action だけでは通らない。

reception policy は `field:ListReservations` 等を持つ一方、HRM roster read に必要な
`field:ListHrm` を持たない。既存の権限設計資料も、roster を含む読み取りには
`field:ListHrm` が必要であり、Field action を同梱しない golf policy は
「付与できるのに使えない」と明記している。fake gateway だけの「reception + 新 action で 200」
テストではこの上流 403 を再現できないため、骨格の受付 200 を満たしたように見えて本番では失敗する。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:96-100`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:65-71`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:97-99`
- `src/course/usecase/get_course_caddie_supply.rs:45-67`
- `src/course/infrastructure/field_ops_gateway.rs:62-68`
- `src/course/infrastructure/field_ops_gateway.rs:102-118`
- `.tachyon/manifests/tachyonfield-golf-auth.yml:198-246`
- `docs/src/tasks/completed/v0.1.11/permission-policy-granularity/task.md:59-63`
- `docs/src/tasks/completed/v0.1.11/permission-policy-granularity/task.md:200-207`

**修正提案**

受付が実 provider を通るために必要な Field 側 action を先に確認し、公開方式を設計へ追加する。
`field:ListHrm` を reception に付与するなら、受付へ全 HRM read を広げる影響を明記して承認対象にする。
それが過剰なら、full roster を読まずに削除済みキャディの shift を除外できる業種非依存の狭い
Field capability を起票し、利用可能になるまでの CourseBoard 側方針を決める。
認可テストには fake authorizer だけでなく、reception 相当 bearer で roster・assignment を含む
実 Field 呼び出しを通して endpoint が 200 になる integration/preview 確認を追加する。

### 2. manifest 変更を先に本番適用するロールアウト手順がない

**指摘内容**

新 action は usecase の必須 gate になるため、Tachyon Auth に action 宣言と policy grant が入る前に
backend を deploy すると、既存の全利用ロールで supply が 403 になる。ところが PR 分割は
backend PR に code と manifest を同居させて「deploy 後」を述べるだけで、必須の manifest-first
順序を定義していない。

さらにこのリポジトリの既存運用では manifest `apply` は同名 policy を 409 skip し、既存の
viewer/reception/caddie-master/accounting/manager へ新 action を追加しない。単に manifest を編集・apply
しても action 宣言だけが増え、利用者が持つ既存 policy には grant されないため、コード deploy 後の
403 が恒久化する。設計上の authorization test は静的 YAML と fake checker の整合しか見ないので、
本番 policy の更新漏れを検知できない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:121-123`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:196-204`
- `docs/src/tasks/completed/v0.1.11/permission-policy-granularity/task.md:67-70`
- `docs/src/tasks/completed/v0.1.11/permission-policy-granularity/task.md:89-103`
- `docs/src/tasks/completed/v0.1.11/permission-policy-granularity/task.md:194-198`

**修正提案**

PR 1 の deploy 手順を、(1) action 宣言、(2) 既存 policy への `actionsToAdd` 相当の更新、
(3) 各対象 policy の実 grant 確認、(4) backend deploy の順に固定する。
policy の delete/recreate は参照中だと失敗し ID も変わるため、既存割当を保つ PATCH を第一候補にし、
実行主体・対象環境・rollback を明記する。backend deploy 前の gate として、対象5 policy が
`ListCourseCaddieSupply` を実際に持つことを Tachyon Auth から読み返して確認する。

## 参考

- reservation ごとの候補順は定義されたが、複数 reservation が同じキャディの残 capacity を争う際の
  group 処理順は未定義である（`design.md:21-25`）。HashMap の反復順へ依存すると course 別の
  effective 値と anomaly 帰属が揺れるため、tee time + reservation ID 等の安定順を実装前に固定するとよい。
