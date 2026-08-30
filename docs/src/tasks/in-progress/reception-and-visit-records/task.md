# 受付の記録を残す（登録の来歴と来場の実測）

## Links

- 前提: `docs/src/tasks/in-progress/ai-ocr-customer-reception/task.md`（受付用紙 OCR、マージ済み）
- Linear issue: 未作成

## 概要

受付用紙から人を台帳に入れられるようにしたが、その行為も、その人が実際に
来たことも、どこにも残らない。顧客管理から見ると穴が2つある。

1. **登録の来歴がない。** 誰がいつ何を見てこの人を作ったのか追えない。受付票 OCR は
   同姓同名を消さずに印を付ける設計なので重複は必ず出るが、出たあとに原本へ
   戻る手がかりがない。
2. **来場が推定でしかない。** 顧客カルテの来場履歴は Field の予約から
   「ティータイムを過ぎた confirmed なら来た」と割り出しているだけで、受付を
   通った事実の記録ではない。しかも Field は1予約1顧客なので、同伴者として
   毎月来る人は履歴が空のまま。グレード判定はこの履歴を入力にしているため、
   同伴者専門の常連は永久に最下位に張り付く。

どちらも Field の汎用モデルには無い概念（組の同伴者は CourseBoard の
`golfParty`）なので、CourseBoard ローカル DB が持つ（ADR-0009）。

## Scope

### A. 登録の来歴

- `golf_customer_registrations`: tenant / customer_id / source / 登録者 / 日時 / 用紙の何行目か。
- `POST /v1/course/customers` に `source` を足す（`manual` 既定、`reception_sheet`、`ledger`）。
  受付画面と台帳の名前登録ダイアログはそれぞれ自分の出所を送る。
- `GET /v1/course/customers/{id}/registration` で1件返す。顧客カルテに「台帳に入れた記録」を出す。
- 登録者は検証済みトークンの `sub`。いまミドルウェアが捨てているので extension に載せる。

### B. 来場の実測

- `golf_visit_checkins`: tenant / 日付 / 予約 / 組の何番目 / customer_id（任意）/ 名前 / 打刻時刻 / 打刻者。
- customer_id は任意のまま。台帳の誰かに決まっていない同伴者でも「来た人数」は正しく残る
  （`PartyPlayer.customer_id` が任意なのと同じ理由）。カルテが読むのは紐付いた行だけ。
- 打刻は冪等。(tenant, 予約, 組の何番目) で一意。
- `GET /v1/course/customers/{id}/visits` を実測優先に変える。
  - 予約から推定した来場のうち、打刻がある予約は実測として確定する。
  - 打刻はあるが本人名義の予約が無い行（＝同伴者）は履歴に足す。
  - 同伴者の行に売上は付けない。売上は代表者の予約に付いており、割り方を発明することになる。
    来場回数は増え、客単価の分母には入らない。グレード判定の入力もこの規則に従う。

## Non-goals

- 受付用紙の画像・読み取り結果の保存。既存の非目標のまま（Field も CourseBoard も持たない）。
- 予約の無い当日飛び込みの受付。まず予約のある組から。
- Field への打刻の書き戻し。Field に汎用のチェックインは無く、同伴者単位の来場は
  Field の予約モデルに存在しない。要るとなったら業種非依存の contract として別途起票する。
- 既存顧客との自動名寄せ。

## 対象モジュール

- `migrations/` — 上の2テーブル
- `src/course/domain/customer_registration.rs`, `src/course/domain/visit_checkin.rs`
- `src/course/domain/ports.rs` — 2つの gateway
- `src/course/infrastructure/customer_registration_repository.rs`, `visit_checkin_repository.rs`
- `src/course/usecase/` — 記録・取得、`get_customer_visits` の実測合流
- `src/course/interfaces/http_customers.rs`, `src/course_authz.rs`
- `desktop/src/features/golf/customers/`, `desktop/src/features/golf/ledger/`

## 実装

- [x] 検証済み principal を request extension に載せる（`CallerPrincipal`）
- [x] A: migration / domain / repository / usecase / API / authz
- [x] A: 受付画面と台帳ダイアログが source を送る、カルテに来歴を出す
- [x] B: migration / domain / repository / usecase / API / authz
- [x] B: `get_customer_visits` の実測合流とグレード入力の規則
- [x] B: 打刻の UI。予約台帳の組の編集シートに「受付」を置く
- [x] i18n（ja / ja-plain / en）、テスト、type-check
- [x] DB-backed の repository テストを実行（TiDB 起動、`cargo test --lib` 885 passed / 0 failed）
- [x] 実 Field API に対する動作確認（下記）

## 決めたこと

- **新しい action は作らない。** 打刻の書き込みは `ManageReservations`、読み取りは
  `ListTeeSheet`、来歴の読み取りは `ListCustomers` を使う。新しい action 名は
  manifest とテナントのポリシー両方を更新するまで fail-closed で 403 になり、
  最初に試した1コースが機能ではなく 403 に当たる。
- **打刻が無いことは来場を取り消さない。** 打刻がある予約は実測として確定し、
  無い予約はこれまで通り「ティータイムを過ぎた予約＝来場」の推定のまま。
  打刻の不在で降格させると、この機能を出した日に台帳の履歴が全部消える。
- **同伴の回に売上と人数を付けない。** どちらも予約を取った人のもので、組で割るのは
  数字の発明になり、そのままグレード判定に入る。回数だけ増え、`unpricedVisits` として
  客単価の計算から外れたことが画面に出る。

## 確認済み

prod Field に対して、テナント `tn_01kygsqn7tnqexzzwe96z0ad17` の実データで確認した
（打刻は CourseBoard ローカル DB にだけ書くので、Field 側は読むだけ）。

- 実予約 `rsv_01kzgg443t88erhpxpyrj1gkgp`（ティータイム 2026-08-08T06:53+09:00）に対して
  座席0（顧客に紐づけ）と座席1（未紐づけ）を打刻 → 両方記録された。
- `playedOn` は `2026-08-08`。この予約は UTC では 08-07 なので、テナントのタイムゾーンで
  日付を出せていることが実データで確認できた。
- `checkedInBy` に検証済みトークンの subject が入った。
- 同じ座席をもう一度打刻しても行は増えず、`checkedInAt` も最初のまま（到着時刻は書き換えない）。
- **同伴の穴が埋まった。** 顧客 `cus_01KZRRFXETGQ25ZWGM6GX4RWWB`（本田）は本人名義の予約が
  無く、打刻前は来場0件だった。他人の組に打刻したあとは `visits: 1`、行は
  `booked=false / checkedIn=true`、`players=0 / amount=0`、`unpricedVisits: 1`。
  回数だけ増え、売上と人数は予約を取った人に残っている。

## 未確認

- **live の authz gate を通していない。** 検証に使った `.env.prod-field` は
  `COURSEBOARD_DISABLE_ACTION_AUTHZ=true` で、Tachyon Auth への `check` が走らない。
  新ルートは既存 action（`ManageReservations` / `ListTeeSheet` / `ListCustomers`）を
  使っており、いずれも台帳と顧客画面が本番で動いている以上は付与済みのはずだが、
  実地で 403 が出ないことは確かめていない。ルート分類のテスト自体は通っている。
- 打刻は保存済みの組の名前に対して記録する。編集中は受付ボタンを止めている。
  実際の朝の受付で「名前を直しながら受付する」流れが多いなら、保存と受付を
  1つのボタンにまとめ直す。
