# 来場勧奨の架電を、目視のリストから抽出に変える

## Links

- 前提: `docs/src/tasks/in-progress/reception-and-visit-records/task.md`（来場の実測、マージ済み）
- Linear issue（Field への起票分）:
  - [PLT-4049](https://linear.app/issue/PLT-4049) 予約一覧の増分取得（期間 / updatedSince / 総件数）
  - [PLT-4050](https://linear.app/issue/PLT-4050) 顧客一覧の `ids` フィルタと `offset`
  - [PLT-4051](https://linear.app/issue/PLT-4051) 顧客ごとの購買サマリ
  - [PLT-4052](https://linear.app/issue/PLT-4052) 顧客への接触履歴（activity log）
  - [PLT-4053](https://linear.app/issue/PLT-4053) 連絡拒否（do-not-contact）

## 概要

コースは「またお越しください」の電話を、リストを目で見ながらかけている。
誰にかけるかは勘で決まり、かけた記録はどこにも残らない。

CourseBoard 側から見ると、目視になっているのは運用の怠慢ではなく作りの問題である。
顧客1人の累計来場・累計金額・客単価は
`GET /v1/course/customers/{id}/visits` が出すが、これは開くたびに
Field の予約を全ページ舐めて数えている。1人あたり最大4コール、上限2000行。
横断で「累計金額の多い順」「最終来場が古い順」に並べる手段が無いので、
リストは人が作るしかない。グレードの閾値（`golf_customer_grade_rules`）も
すでにあるのに、1人開かないと判定が出ない。

やることは3つ。集計を持つ、抽出できるようにする、かけた記録を残す。
このうち CourseBoard が作るのは前の2つで、かけた記録は汎用 CRM なので
Field に起票する（下記）。

## Scope

### A. 顧客サマリの集計（バッチ）

- `golf_customer_summaries`: tenant / customer_id と、`CustomerVisitSummary` が
  すでに定義している数字（visits / players / total_amount / unpriced_visits /
  spend_per_player / cancelled / no_shows / first_visit_at / last_visit_at）。
- 集計は既存の `CustomerVisitHistory::build_with_checkins` を再利用する。
  テナントの予約を全ページ舐めて customer_id で束ね、ローカルの打刻
  （`golf_visit_checkins`）を合流させて、顧客ごとに1行 upsert する。
  1人ずつ計算するのと同じ規則で出すので、カルテと一覧で数字が食い違わない。
- `golf_customer_summary_runs`: いつ走って、何行読んで、何人書いて、落ちたか。
  一覧に「最終集計: …」を出すのはこの行。集計が止まっていることに気づけないと、
  古い数字で架電することになる。
- 実行は CLI（`courseboard-refresh-customer-summaries`）。定期実行の配線は別。

### B. 横断一覧とセグメント抽出

- `GET /v1/course/customer-summaries` — 並べ替え（累計金額 / 来場回数 /
  最終来場）、絞り込み（最終来場からN日以上、グレード、来場回数の下限）、ページング。
- 名前・電話は保存せず、表示するページの分だけ Field から引く。
  台帳のコピーは持たない（ADR-0005）。
- 画面は顧客の下に「架電リスト」。抽出条件と結果、1行ずつ電話番号と前回架電。

### C. 架電の記録 — Field 起票（CourseBoard では作らない）

かけた記録も架電拒否も、ゴルフの語彙を1つも含まない汎用 CRM である。
とくに拒否は Field に既にある同意証跡の延長で、CourseBoard 側に別に持つと
「連絡してよい人」の正が2箇所に分かれる。二重管理になるので作らない。
下の「Field に起票する汎用 contract」を参照。

## Non-goals

- メール / LINE / DM などの他チャネル。まず電話。
- 自動架電・IVR・電話システム連携。
- 接触履歴・連絡拒否を CourseBoard に持つこと。汎用なので Field に起票する。
- セグメントの保存・共有（名前を付けた抽出条件）。まず条件を毎回入れる形で出す。

## 対象モジュール

- `migrations/` — 上の2テーブル
- `src/course/domain/customer_summary.rs`
- `src/course/domain/ports.rs` — `CustomerSummaryGateway`
- `src/course/infrastructure/customer_summary_repository.rs`
- `src/course/infrastructure/field_gateway.rs` — テナント全体の予約 sweep（offset 対応）
- `src/course/usecase/refresh_customer_summaries.rs`, `list_customer_summaries.rs`
- `src/course/interfaces/http_customers.rs`, `src/course_authz.rs`, `openapi.rs`
- `bin/refresh_customer_summaries.rs`
- `desktop/src/features/golf/customers/CallListPage.tsx`, `callList.ts`

## 実装

- [x] A: migration / domain / repository / sweep usecase / CLI
- [x] B: 一覧 API / authz / 画面
- [x] i18n（ja / ja-plain / en）、テスト、type-check
- [x] 実 Field API に対する動作確認
- [ ] 定期実行の配線（いまは CLI のみ。本番 DB は PrivateLink 内なので Lambda 側の仕事）
- [x] Field 起票（下記5本 = PLT-4049 / PLT-4050 / PLT-4051 / PLT-4052 / PLT-4053）


## Field に起票する汎用 contract

ゴルフの文脈を剥がした業種非依存の要求として起票する。CourseBoard 側は
待つか、gateway の裏で暫定対応する（CLAUDE.md）。

1. **予約一覧の増分取得（PLT-4049）。** `GET /v1/erp/reservations` に期間
   （`from` / `to`）と `updatedSince`、総件数を足す。`offset` は既にある。
   いまは `limit` が黙って500に丸められ、総数も返らず、日付でも絞れないので、
   テナント全体を読むには先頭から順に全ページ舐めるしかない。
   これが無い限り CourseBoard 側の集計は毎回フルスキャンで、
   予約が増えるほど時間が延びていく。**優先度は最も高い。**
2. **顧客の一括取得（PLT-4050）。** `GET /v1/storekit/customers` に `ids` フィルタと
   `offset` を足す。いまは名前・電話・メールの部分一致でしか引けないので、
   一覧に名前を出すのに ID ごとの GET を並べることになる。
3. **顧客ごとの購買サマリ（PLT-4051）。** 顧客の累計購入額・購入回数・初回/最終購入日を
   Field が持つ。予約も請求も顧客台帳も Field にあるのだから、集計も Field
   にあるのが筋で、CourseBoard が全予約を HTTP 越しに舐めているのは
   受け皿が無いことの代償でしかない。これが入れば本 taskdoc の A は消える。
4. **顧客への接触履歴（PLT-4052）。** 顧客に対する接触（電話 / メール / 訪問）を
   いつ誰がどういう結果で行ったかの記録。チャネル・結果・メモ・次回予定。
   完全に汎用の CRM 機能で、ゴルフの語彙は1つも要らない。
5. **連絡拒否（do-not-contact）（PLT-4053）。** 顧客単位の連絡可否と、その根拠。
   Field には既に同意証跡のテーブルがあるので、その延長に置くのが正しい。
   CourseBoard 側に別に持つと「連絡してよい人」の正が2箇所に分かれる。

3 が入るまでの CourseBoard 側は暫定である。差し替えられるように、集計の
読み書きは `CustomerSummaryGateway` 1本に閉じてある。Field が持ったら
実装を Field gateway に替えるだけで、usecase から上は変わらない。


## 確認済み

prod Field に対して、テナント `tn_01kygsqn7tnqexzzwe96z0ad17` の実データで確認した
（サマリは CourseBoard ローカル DB にだけ書くので、Field 側は読むだけ）。

- `courseboard-refresh-customer-summaries` が予約55件を舐め、顧客4人分を書いた。
  run は `succeeded`、`reservationsScanned=55`、`customersWritten=4`。
- **一覧の数字が単票と一致した。** 顧客 `cus_01M0KD1SCXR26892Q0CDRA3MT1` は
  `GET /v1/course/customer-summaries` でも `GET /v1/course/customers/{id}/visits` でも
  `visits=5 / players=20 / cancelled=5 / firstVisitAt=2026-08-22T01:36:00Z /
  lastVisitAt=2026-08-26T23:12:00Z`。`CustomerVisitHistory` を共有している効果が
  実データで出ている。
- 名前は Field から解決された（`test user 3` / `山田 花子` / `テスト顧客` / `たかのり`）。
  台帳のコピーは持っていない。
- `minDaysSinceLastVisit=90` は0人。このテナントは全員が直近2週間の来場なので正しい。
- `sort=last_visit&ascending=true` で最終来場の古い順に並んだ。
- `minDaysSinceLastVisit=90&maxDaysSinceLastVisit=30` は 400。空になる窓は答えずに断る。
- UI（架電リスト画面）で条件・件数・最終集計・行が出た。行クリックで顧客カルテへ。
- **台帳が読めない行の劣化も実地で出た。** UI の既定 `x-platform-id` がこのテナントの
  platform と食い違うと Tachyon Auth が顧客参照を拒否する（既知の
  tenant / platform ミスマッチ）。そのとき一覧は消えず、名前の列だけが
  「台帳から読めませんでした」になり、来場回数と最終来場はそのまま読めた。

## 未確認

- **live の authz gate を通していない。** 検証に使った `.env.prod-field` は
  `COURSEBOARD_DISABLE_ACTION_AUTHZ=true`。新ルートは既存 action（`ListCustomers`）
  なので付与済みのはずだが、実地で 403 が出ないことは確かめていない。
  ルート分類のテストは通っている。
- **売上のあるテナントで確かめていない。** 検証テナントの予約は金額を持たないので、
  `totalAmount` は全員0、`unpricedVisits` に落ちた。累計金額での並べ替えと
  グレード判定は、金額のあるデータで一度見る必要がある。
- **大きなテナントでの sweep 時間。** 55件では一瞬だが、数万件のときに
  `MAX_SWEEP_ROWS`（50,000）まで何分かかるかは測っていない。
- 定期実行。いまは CLI だけで、本番 DB は PrivateLink 内なのでこの binary は届かない。

## 決めたこと

- **新しい action は作らない。** 読み取りは `ListCustomers` を使う。
  新しい action 名は manifest とテナントのポリシー両方を更新するまで
  fail-closed で 403 になる。
- **台帳のコピーを持たない。** サマリは customer_id と数字だけ。名前で並べ替えたり
  名前で検索したりはできなくなるが、一覧は「金額」「最終来場」で引くものなので
  名前の索引は要らない。名前を持つと台帳の正がどちらか分からなくなる。
- **集計は同期リクエストにしない。** 予約一覧に日付の絞り込みが無く、Field は
  limit を黙って500に丸め、総数も返さない。テナント全体の sweep は
  数十〜数百ページになりうるので、API のタイムアウトに乗せない。
- **数字は1人ずつの計算と同じ規則で出す。** `CustomerVisitHistory` を再利用する。
  一覧用に別の計算を書くと、カルテと一覧で違う数字が出て、どちらも信用されなくなる。

## 既知の穴

- **同伴者専門の常連は、打刻がある回しか拾えない。** Field は1予約1顧客で、
  組の同伴者は CourseBoard の `golfParty` にしかいない。打刻を始める前の
  同伴の来場は誰の履歴にも無い。LTV をこの数字で出すと、その分だけ低く出る。
- **売上は予約を取った人に全部付く。** 4人組の代金は代表者の LTV になる。
  組で割るのは数字の発明になるので割らない（既存の規則のまま）。
  つまり「幹事の LTV が高い」であって「個人の支払額が高い」ではない。
