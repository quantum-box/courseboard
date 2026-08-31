# 受付用紙のチェック欄を同意として記録する

## Links

- Field 側の実装: tachyonfield [#1242](https://github.com/quantum-box/tachyonfield/pull/1242)
  （[PLT-4041](https://linear.app/issue/PLT-4041) 同意記録と現在状態取得、
  [PLT-4040](https://linear.app/issue/PLT-4040) 生年月日・性別・住所、
  [PLT-4042](https://linear.app/issue/PLT-4042) Cloud App 向け権限の文書化）
- Field の権限 runbook: `docs/runbooks/cloud-app-field-api-permissions.md`（tachyonfield）
- 前段のタスク: `docs/src/tasks/in-progress/ai-ocr-customer-reception/task.md`

## 概要

受付用紙には氏名や電話番号のほかにチェック欄がある。反社会的勢力でないことの
表明、カート利用約款の遵守、クラブからの情報提供の可否。これまで OCR は氏名・
カナ・電話・メールの4項目しか読まず、チェック欄は保存する型すら無かった。

同意は bool 1本では足りない。「いつ・どの版の約款に・どの経路で同意したか」が
残らないと、約款を改訂したあとに過去の同意が何を指していたのか分からなくなる。
Field には既に `customer_consents`（append-only の証跡）と
`membership_consent_items`（テナントが項目自体を定義する）があり、CourseBoard が
新しくテーブルを作る必要はない。CourseBoard が持つのは**どのチェック欄があるか、
何と呼ぶか、どちら向きか**だけ（ADR-0005）。

## 用紙のチェック欄は3つ

札幌カントリー倶楽部の用紙で確認した。「個人情報の取扱いについて」は説明文で
あってチェック欄ではない。

| 用紙の文言 | consent_key | 必須 | 向き |
|---|---|---|---|
| 反社会的勢力でないことを表明し、ゴルフ場利用約款を遵守します | `golf_antisocial_and_course_terms` | ○ | チェック＝同意 |
| 乗用カート使用の際は、カート利用約款を遵守します | `golf_cart_terms` | — | チェック＝同意 |
| 当クラブからの情報提供が不要の場合はチェック | `golf_marketing_contact` | — | **チェック＝拒否** |

- 1つ目は1つの印刷枠で反社表明と利用約款遵守の両方を兼ねている。**2つに割らない。**
  割ると来場者が個別に同意していない記録を2件作ることになる。
- 3つ目が肝。紙は「不要ならチェック」という否定形だが、Field の絞り込みは
  `consent_accepted=true` で「同意した人」を抽出する。印刷どおりに記録すると
  **情報提供を断った人にだけ案内を送る**ことになる。OCR には紙のまま
  （「不要としてチェックが入っていれば true」）聞き、CourseBoard 側で1回だけ反転して
  Field に渡す。受付は読み取り結果を原本と見比べるので、質問文を反転させると
  紙と一致しなくなる。
- `consent_key` は `^[a-z][a-z0-9_]{0,63}$`。**ドットが使えない**ので名前空間の
  区切りは `golf_`。違反すると Field が 400 を返す。

## Scope

- 受付用紙の OCR スキーマに3つの `boolean` 列を足す。Field の汎用 OCR は
  `boolean` を正式サポートしていて、解決できない値は落として警告にする。
- 読み取った各行に「どのチェックがどう答えられたか」を持たせる。読めなかった欄は
  `None` のままにする（`false` にしない）。
- 登録時に `POST /v1/erp/customers/{id}/consents` へ記録する。
- 必須チェックが true でない受付用紙由来の登録は、**Field に何も書く前に**拒否する。
- 窓口で直接入力した登録（`source: manual`）には用紙が無いので必須チェックを課さない。

## Non-goals

- 生年月日・性別・住所の取り込み。Field 側は PLT-4040 で入ったが、CourseBoard の
  顧客作成は `/v1/storekit/customers` を通っていて、StoreKit 側は
  `birth_date: None` / `sex: None` を渡すだけで対応していない。別タスク。
- 同意の現在状態の表示・絞り込み（`GET /v1/erp/customers/{id}/consents`、
  顧客一覧の `consent_key` / `consent_accepted`）。記録が先。
- 約款改訂時の再同意フロー。Field は `outdated` を返せるが、運用は未設計。

## なぜ作成と同意が別リクエストなのか

Field の `POST /v1/erp/customers` は `consents` を同時に受け、同意の書き込みが
失敗したら顧客を `active=FALSE` にして補償ロールバックする。1リクエストで済む。

しかし CourseBoard の顧客作成は `/v1/storekit/customers` を通っている。StoreKit の
作成・更新は `consent: None` を渡すだけで同意に対応していない。ERP 側に移すと
名前だけの登録（受付では常態）が通るかが変わるおそれがあり、顧客まわり全体の
移行になる。今回は StoreKit の作成をそのままにし、同意だけ ERP ルートへ送る。

その代わり同意の記録は独立して失敗しうる。**失敗しても登録全体は成功として返す。**
「登録に失敗した」と伝えると受付は同じ人をもう一度登録し、それが重複の作られ方
だから。レスポンスの `consentsRecorded: false` で欠落を伝え、受付は**同意だけ**
やり直す。必須チェックのガードは作成より前に走るので、「登録は通ったが必須の
表明が無い」状態にはならない（記録に失敗した場合を除く）。

## 対象モジュール

- `src/course/domain/customer_consent.rs` — チェック欄の定義、向き、キー（新規）
- `src/course/domain/customer_reception.rs` — スキーマへの `boolean` 列追加、行が持つ答え
- `src/course/domain/ports.rs` — `CustomerConsentGateway`
- `src/course/infrastructure/field_customer_consent_gateway.rs` — Field への記録（新規）
- `src/course/infrastructure/field_customer_reception_gateway.rs` — 読み取り結果の写像
- `src/course/usecase/create_customer.rs` — 必須チェックのガード、記録、結果の報告
- `src/course/interfaces/http_customers.rs` — リクエスト DTO と `consentsRecorded`
- `desktop/src/features/golf/customers/reception/` — 受付画面

## 実装

- [x] ドメイン: 3つのチェック欄、向きの反転、Field のキー書式に対する検証
- [x] スキーマ: `boolean` 列を3つ追加。列数上限（20）に対するテスト
- [x] 読み取り: JSON boolean と `"true"` / `"false"` 文字列の両方を受け、
      それ以外は未読として `None`。オプトアウトはここで反転
- [x] port と gateway: `POST /v1/erp/customers/{id}/consents`、camelCase、
      `channel: "store"`。未読の欄は送らない（空配列なら送信自体しない）
- [x] usecase: 受付用紙由来のみ必須チェックを強制。作成前に拒否。
      記録失敗は `consentsRecorded: false` で報告し、登録は成功として返す
- [x] API: `POST /v1/course/customers` が `consents` を受ける。未知のキーは 400
- [x] `cargo test --lib`（969 件 green）、`cargo clippy --lib --tests`、`cargo fmt`
- [x] 画面: チェック欄を人ごとに縦積みで表示。読み取れなかった欄は
      「用紙から読み取れませんでした」と出し、空欄（＝拒否）と区別する。
      必須未チェックの行は登録ボタンを止め、どの欄かを文言で言う
      （名前が未入力のときは名前を先に言い、宣言の警告は出さない）。
      `consentsRecorded: false` は行を「登録済み」のまま残したうえで
      「登録はやり直さず同意だけ記録し直す」と出す
- [x] i18n: ja / ja-plain / en
- [x] モック: 読み取り fixture にチェック欄を追加（読めた行・読めなかった行の両方）
- [x] `npm run type-check`、`vitest run src/features/golf/customers`（67 件 green）
- [x] モック UI で確認（`courseboard-mock-5180`）。読み取り済み2行は登録可、
      必須が読めなかった行はブロックされ、チェックすると解除される
- [x] テナントへの同意項目の投入（`tn_01kygsqn7tnqexzzwe96z0ad17`、下記手順）
- [x] 実 Field API に対する動作確認（下記「確認済み」）

## テナントに同意項目を投入する手順

Field 側の `membership_consent_items` に3件を登録する。**マイグレーションは不要**で、
テナントごとに API で入れる。未登録のキーを送ると
`unknown consent item: <key>` の 400 になるので、受付を使い始める前に必ず入れる。

必要な権限は `field:ManageMembership`（`field:admin` のみ）。記録側の
`field:RegisterMembership` とは別 action で、定義を書ける相手と記録を書ける相手は
意図的に分けられている。

```
POST /v1/erp/membership/consent-items
{
  "consentKey": "golf_antisocial_and_course_terms",
  "label": "反社会的勢力でないことの表明・ゴルフ場利用約款の遵守",
  "body": "<用紙の文言をそのまま>",
  "required": true,
  "termsVersion": "1",
  "sortOrder": 10
}
```

同様に `golf_cart_terms`（`required: false`、`sortOrder: 20`）、
`golf_marketing_contact`（`required: false`、`sortOrder: 30`）。

- `required` は省略すると **true** になる。カートと情報提供は明示的に `false` を渡す。
- `termsVersion` は省略すると `"1"`。約款を改訂したら
  `PUT /v1/erp/membership/consent-items/{id}` で上げる（`PATCH` ではない）。
  過去の記録は改訂前の版を持ったまま残る。
- `body` に用紙の文言を入れておくと、画面に出す文と紙が一致する。
- 一覧は `GET /v1/erp/membership/consent-items?includeInactive=true`。
- 削除は `DELETE .../{id}`（204）。定義を消しても証跡は残り、
  `GET /v1/erp/customers/{id}/consents` では `label` が null で返る。

## 確認済み

本番 Field（テナント `tn_01kygsqn7tnqexzzwe96z0ad17`）で通した。投入前は
`GET /v1/erp/membership/consent-items` が `{"items":[]}` で、投入で3件とも 201。

顧客を StoreKit（CourseBoard と同じ経路）で作り、CourseBoard が送るのと同じ body で
`POST /v1/erp/customers/{id}/consents` → 201。結果は狙いどおり。

- 必須の表明は `accepted=true` / `acceptedTermsVersion=1` / `channel=store` で記録された
- **送らなかったカート欄は `accepted=null` のまま。** 拒否として積まれていない。
  未読の欄を送らない実装がそのまま効いている
- **オプトアウトの反転が実地で効いた。** 用紙で「情報提供は不要」に相当する
  `golf_marketing_contact: false` を記録した顧客は、
  `?consent_key=golf_marketing_contact&consent_accepted=true`（＝配信してよい人）に
  **含まれない**（0人）。`consent_accepted=false` 側にだけ出る。
  印刷どおりに記録していたら、この人が配信対象になっていた
- 未投入のキーを送ると 400 `unknown consent item: <key>`。投入が前提条件であることの実証

検証に使った顧客 `cus_01M1B2P8D59KB5P6YKXA284FTJ`（「受付検証 テスト太郎」）は
本番の台帳に残っている。同意は append-only で消せないため、消すなら顧客ごと。

## 未確認

- **受付担当のロールで同意を記録できるか。** 上の確認は CLI の `field` プロファイル
  （管理者相当）で通しただけで、`field:staff` では試していない。
  `POST /v1/erp/customers/{id}/consents` が要求する `field:RegisterMembership` は
  受付 OCR と同じ action なので通るはずだが、実証には staff ロールのユーザーが要る。
  前段タスクの「staff ロールでの実行可否」と同じ穴。
- **CourseBoard の API を通した実地確認。** Field 側の契約は上のとおり実測したが、
  ローカルの course-api を本番 Field に向けて `POST /v1/course/customers` から
  流すところまではやっていない。gateway が組む body は unit test で固定してあり、
  それが上で 201 を返した body と同一。
- **手書きのチェック欄をどの程度読めるか。** ☑ と ✓ と塗りつぶしが混在し、
  複写伝票では薄い。読めない欄は未読として受付に回るので安全側だが、
  毎回すべて手で入れることになると画面の意味が薄れる。実物での確認が要る。
- **同意記録の失敗時、受付が「同意だけ再送」する導線。** 画面は
  `consentsRecorded: false` を「登録はやり直さず同意だけ記録し直してください」と
  出すところまで。押せば再送されるボタンはまだ無く、いまは受付が手で対処する。
  Field 側は append-only なので再送は安全（同じ内容がもう1行積まれるだけ）。
