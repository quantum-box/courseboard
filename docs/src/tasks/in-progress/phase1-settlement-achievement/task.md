# 月次精算と予算達成率をCourseBoardで計算する

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

[ADR-0005](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md) の Phase 1 は 7 系統中 5 系統が完了している。給与集計・推薦・自動配置・需給・料金シミュレータは `src/course/domain/` に純粋関数として実装済みで、Field には素材を取りに行くだけになっている。

Field の計算ルートへ委譲しているのは 2 箇所だけ。

- `usecase/get_monthly_settlement.rs` — Field の月次精算をそのまま受け取り、予約名・ティータイム・コース名を後付けしているだけ。CSV は完全な素通し。
- `usecase/list_budget_achievements.rs` — 40 行の素通し。

あわせて `GolfOpsGateway` の `list_caddie_recommendations` と `auto_assign_caddies` が、実装とテストスタブにしか参照のないデッドメソッドとして残っている。

Field 側の変更なしで進められる。同時デプロイも要らない。

## やること

### 0. 下ごしらえ（実装済み・2026-08-23）

予約の金額を CourseBoard 側へ通す部分は済んでいる。**Field の予約 API は
`priceAmount` / `depositAmount` / `paidAmount` / `currency` / `paymentStatus` /
`invoiceId` / `cancelledAt` を返しており**（tachyonfield の
`packages/reservation/src/lib.rs` の `Reservation` を確認）、CourseBoard 側が
復号していなかっただけだった。`ReservationBilling` にまとめて
`Reservation::with_billing` で載せる形にしたので、**`reconstitute` の引数は
増えず呼び出し 6 箇所は無改修**。金額を持たない予約（この列ができる前のもの、
テストの素材）は 0 に落ちて失敗しない。

つまり達成率の実績側に必要な素材は**もう手元にある**。残りは集計そのもの。

### 1. 予算達成率（実装済み・2026-08-23）

`src/course/domain/budget_achievement.rs` に純粋関数 2 本（日次実績の畳み込みと、予算との突き合わせ）。usecase は Field 委譲をやめ、予算・予約・商品を取って自前で計算する。Field の達成率ルートへの経路（port・Field 実装・path builder・DTO・mapper）は削除済み。

**Field の実装と算術を意図的に一致させた**（`packages/reservation/src/golf_achievement.rs` と `sqlx_golf_settlement_repository.rs` を読んで移植）。実績は `price_amount` の合計、`status NOT IN ('cancelled','rejected')`、テナント TZ でのローカル日付、`play_type=caddie` の件数。平均は整数除算のまま。丸めを変えると差分が「本物の変化」と見分けられなくなる。

**期間フィルタは Rust 側で切っている。** Field の予約一覧に期間指定が無い（PLT-3858）ため全件取得しており、台帳やティーシートと同じ制約を共有する。起票が通ったら差し替える。

残: 本番/sandbox の実データで新旧の差分ゼロを確認する作業（taskdoc の方針どおり flag は持たせていない）。

### 1b. 元の記述

**これを最初の 1 本にする。** Field 側の実装が既に純粋関数でテスト付きで、そのまま持ってこられる。新しい Field API を 1 本も必要としない。`src/course/domain/payroll.rs` が完全に同型のお手本になる。

実績側は予約を日付で group して金額・件数・数量・キャディ付き件数を数えるだけで、素材は全部そろっている。予約商品からキャディ要否を引く経路は需給計算が既に使っている。

ここで **予約 DTO に金額フィールド（価格・入金額・支払状態・請求書 ID・キャンセル日時）を足す下ごしらえ**を済ませる。`Reservation::reconstitute` の引数が増えて呼び出し側に広く波及するので、金額計算の検証と同じ PR で扱わずに済むよう先に通す。**これが順序の最大の理由。**

desktop の変更はない。既存の達成率テストが回帰網になる。

Field 版のテストケース（日付マージ、実績のみの日、予算のみの日、複数コースの合算）を移植して受け入れ条件にする。

### 2. 後始末

デッドメソッド 2 本と、`desktop/src/dev/mockFieldApi.ts` の該当マッピングを消す。これで Field のゴルフ計算ルートへの参照が精算だけになり、Phase 3 への引き渡し表が機械的に作れる。

### 3. 月次精算（実装済み・2026-08-24 / 段階移行）

`src/course/domain/settlement.rs` に純粋関数。`SettlementWindow`（テナント TZ のローカル月初 00:00 〜 翌月初 00:00 の半開区間）、`reservation_totals`、`caddie_fee_totals`、`settlement_reservation_lines`、`merge_settlement`、`settlement_csv`。

**移せたのは予約集計とキャディフィーの 2 ブロックだけ。** 残り 2 つは Field 側の受け皿が無い。

- **予約集計** — `starts_at` が月に入る予約を全部。**status フィルタは無い**（Field の SQL に無い）。達成率が cancelled / rejected を落とすのと逆だが、締めは業績ではなく突合で、取り消された組に入った金も会計から見える所に無いと困る。未収は `max(0, price - paid)` を**行ごとに**クランプしてから合算（先に合計して差を取ると、過払いの組が別の組の未収を相殺してしまう）。返金は入金から引かない。
- **キャディフィー** — `golf_caddie_assignments` の `scheduled_at` × `assigned|completed`。**割当時に押された `fee_amount` をそのまま合算する**。給与サマリが現在のランク表で再計算するのと意図的に違う。給与は「いくら払うべきか」、締めは「いくら約束済みか」を答えている。
- **キャンセル未収 — Field のまま。** taskdoc の前提が崩れた。`/v1/erp/reservation-reports/cancellation-fees` は tachyonfield の `route_authorization.rs` で quarantine されていて、middleware が **常に 403**（`"Route is unavailable until its authorization policy is configured"`、review 期限 2026-09-30）。解除されても golf スコープ無し・予約種別を判別する列も無し・`timezone` 無し（境界が実質 UTC 日付）・`invoiceId` 無し・LEFT JOIN で同一予約が複数行になりうる。**Field 側に起票が要る。**
- **Square — Field のまま。** 期間サマリを返す業種非依存ルートが Field に存在しない（`/v1/invoice-reconciliations/square-payments` は明細で期間指定不可、`/v1/field/reports/payout` は Square ではなく別物でこれも quarantine）。**そもそも CourseBoard の決済は Stripe** なので、Square 相当を自前で作る価値は薄い。作るなら Stripe の集計。
- 0 で埋めずに Field の値を素通しする。0 は「未収なし・突合済み」と読めてしまい、締めが「知らない」ときに一番言ってはいけないこと。

CSV は自前生成に切り替えた。サマリ 6 列 9 行（+ 警告行）→ 明細 7 列の複合フォーマットで、**ヘッダ文字列・metric 名・列順は Field 版と一字一句同じ**。会計がスクリプトで取り込んでいる可能性があるため。

期間フィルタは達成率と同じく Rust 側（PLT-3858 待ち）。**予約一覧が 2000 件で切れるため、忙しいクラブでは月の予約を取りこぼしうる。** compare の `reservationCount` 差分がこれを検出する唯一の手段なので、警告文にその旨を入れてある。

### 4. キャディフィーの残骸

Field 側に 2 つの計算が残っていて、条件次第でまだ発火する。

- 割当保存時、料金が未指定なら Field がホール数と人数から計算する。CourseBoard の自動配置は明示送信するので通らないが、手動で割当を作る経路は通りうる。CourseBoard 側で必ず明示送信して塞ぐ。
- キャディ作成時、月間契約ラウンド数が未指定ならランクごとの既定値が Field 側で埋まる。CourseBoard に対応する既定値表がないので追加する。

ホール数による係数を移植するか廃止するかは仕様判断を含む。CourseBoard のランク別単価は「1 ラウンドいくら」の表で係数を持っておらず、desktop がホール数を送っていないなら Field 側では常に 18 ホール既定が使われていたことになる。確認してから決める。

## 切り替え

扱いを 2 つに分ける。

- **達成率は flag を持たない。** 出力は率と件数で誤りが画面に出る。金銭の移動もない。恒久的な flag は設定に負債として残る。代わりに PR 内で一時的な比較コードを書き、sandbox の実データで新旧の差分ゼロを確認したログを貼り、マージ後は残さない。
- **月次精算は env flag を必ず入れる。** 会計に流れる数字で、丸めとタイムゾーン境界の違いが「静かに合わない」形で出る。off で Field を正としつつ新実装も並列に走らせて差分を構造化ログに出し、1 締め分の差分ゼロを確認してから on にする。1 締め様子見してから flag と Field 呼び出しを消す。CSV は差分の目視のほうが速いので、同じ月の新旧を手元で比較する手順を受け入れ条件にする。

テナント出し分け用の feature flag は使わない。ここで要るのは実装の切り替えで、テナント差も動的変更も要らない。

**`COURSEBOARD_SETTLEMENT_SOURCE` = `field` | `compare` | `courseboard`**（既定 `field`）。`COURSEBOARD_TENANT_SOURCE` と同じ 3 段（ADR-0011 の切り替えで実績のある形）。

- `field` — 今までどおり Field の答えを返す。自前計算は走らない。
- `compare` — Field の答えを返しつつ自前でも組み立て、`target: "settlement_source_compare"` に差分を出す。一致で `info`、不一致で `warn`。比較するのは移した 2 ブロックだけ（残り 2 つは素通しなので自分と食い違いようがない）。CSV はバイト一致を判定して、開くべき月だけログに出す。
- `courseboard` — 自前の答えを返す。キャンセルと Square は Field から取ったまま合成する。

**compare は上流呼び出しが増える。** JSON は Field 精算 + 予約一覧 + コース + リソース + 割当。CSV はそれに Field CSV が乗る。恒久運用する mode ではないので、1 締め見たら落とす。

**切り替え後も Field の精算ルートは呼び続ける。** キャンセルと Square の受け皿ができるまで、Field のゴルフ計算ルートへの参照はゼロにならない。

### Field に起票するもの

ゴルフの文脈を剥がした汎用 contract として。

1. `/v1/erp/reservation-reports/cancellation-fees` の quarantine 解除（`erp_route_actions.rs` に `field:ListReservations` を割り当てる）。加えて汎用の絞り込み手段（予約種別 / industry extension を行に含めるか、クエリで絞れるようにする）と `timezone` パラメータ。
2. Square の期間サマリ — **優先度は低い。** CourseBoard は Stripe で決済しているので、Square ブロックはそもそも実体を映していない。Field 側で消すか、CourseBoard 側で Stripe の集計に置き換えるかを先に決める。

## 完了条件

- 予算達成率と月次精算が CourseBoard 側の計算で返り、Field の対応ルートを呼ばない。
- 月次精算は 1 締め分の shadow 比較で差分ゼロを確認してから切り替えた記録がある。
- CSV の列順とヘッダが Field 版と一致する。
- 割当とキャディ作成で、料金と月間契約ラウンド数が Field 側の計算に落ちない。
- デッドメソッドが消え、Field のゴルフ計算ルートへの参照がゼロになる。

## 完了後にFieldから消せるもの

Phase 3 への引き渡し事項。月次精算とその CSV、予算達成率、給与サマリとその CSV、推薦、自動配置の 7 ルートと、対応する集計クエリ・アルゴリズム・純粋関数。

勤怠スナップショットは計算ではなくデータ取得で、CourseBoard から現役で呼んでいるため**消さない**。Phase 3 で汎用化する対象になる。
