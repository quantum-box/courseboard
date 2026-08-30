# design.md レビュー結果（第1回 / レビュアー: Codex GPT-5.6 Sol）

骨格への異議ではなく、design.md の具体化への修正要求。重要度順。

## 1. 重大 — 「シフト確定済み」の判定が成立しない

対象: design.md:115, design.md:378

`knowsCaddieCapacity()` は `roundsCapacity > 0 || caddieAttachedGroups > 0`
（desktop/src/features/golf/ledger/ledgerLayout.ts:263）。供給 API は未キャンセルの
キャディ付き予約を `caddieAttachedGroups` に数える（src/course/usecase/
get_course_caddie_supply.rs:151）ため、表示対象の予約が 1 件あればシフト未確定でも
true になり、未確定の将来日まで赤表示される。

また骨格は「その日のシフトが確定済み」という日単位の条件だが、design は根拠なく
コース単位へ意味を変更している。

修正提案: `knowsCaddieCapacity` を確定判定に流用せず、確定シフト行の存在を明示的に
取得する。既存の `GET /v1/course/caddie-shifts?from=date&to=date` を使うか、台帳向け
に確定有無だけを返す方法を設計し、`shiftConfirmed && unassigned` を描画条件にする。

さらに受付ポリシーには ListShifts と ListCaddieInsights が無い
（.tachyon/manifests/tachyonfield-golf-auth.yml:198）。現在の caddie-course-supply も
受付担当には 403 となるため、design のままでは主要利用者に警告が一度も表示されない。
確定情報をどの action で受付担当へ公開するかまで計画に含めること。

## 2. 重大 — 配置 API の未取得・失敗を「配置ゼロ」と誤判定する

対象: design.md:400

`assignments={caddieAssignmentsResource.data?.items ?? []}` はロード中・403・424・
通信失敗をすべて空配列へ変換する。その状態で供給側の条件が true なら、全キャディ付き
予約が未割り当てとして赤表示される。既存 useResource は data: null と error を区別
しているため、この情報を捨てない。

修正提案: 配置情報を unknown / loaded / failed の三状態で扱い、成功して items を取得
した場合だけ「存在しない」と判定する。失敗時は台帳を止めず、警告表示だけ抑止する
設計とテストを追加する。

## 3. 高 — 確定ゲートのテストが実際の計画では未検証

対象: design.md:345, design.md:509

3-1 節はゲーティングを LedgerBoard 側でテストするとしつつ、3-2 節で LedgerBoard
テストを任意扱いにしている。ledgerLayout.test.ts の集合計算だけでは重大 2 件の誤判定・
描画条件・API 失敗時挙動を検出できない。

修正提案: LedgerBoard または LedgerPage のコンポーネントテストを必須化し、最低限:
確定日・配置なし→表示 / 確定日・有効配置あり→非表示 / 未確定日・配置なし→非表示 /
配置取得中・失敗→非表示 / cancelled assignment→表示 / cancelled reservation→非表示 /
セルフ→キャディ変更後の表示 / キャディ→セルフ変更後の解除 を検証する。

## 4. 高 — 「どちらを先にマージしても壊れない」は機能上誤り

対象: design.md:550

コンパイル依存は無いが、frontend 先行展開では UI が選択・保存を許すのに旧 backend が
400 を返す。backend 先行では旧 UI が選択を阻止する。

修正提案: 「PR・ビルドは独立、機能リリースは依存あり」と書き分け、展開順を
backend → frontend とする。frontend 単独展開の非互換をリスクとして明記する。

## 5. 中 — backend の主要な受け入れ条件が自動テストされない

対象: design.md:254, design.md:273

既存の ensure_slot_available テストは枠競合のテストであり、「確定シフトあり・供給
ゼロでもキャディ付き予約が作成される」ことの証明にならない。

修正提案: gateway mock を用いた CreateReservationUseCase::execute の回帰テスト、
または HTTP 層テストを 1 件追加し、キャディ付き商品でも作成 gateway まで到達する
ことを必須にする。

## 6. 中 — 新規 API 呼び出しで既存 LedgerPage テストが失敗する

対象: design.md:400

desktop/src/features/golf/ledger/LedgerPage.loading.test.tsx:90 は未知の API パスを
例外にする。caddie-assignments 追加でこのテストが失敗するが、変更対象一覧に無い。

修正提案: 同テストの mock に日付付き caddie-assignments 応答を追加し、取得 URL が
from=date&to=date であることも検証する。

## 7. 中 — 赤枠が予約の選択状態を上書きする

対象: design.md:469

`.is-selected` と `.is-unassigned-caddie` がともに box-shadow を指定し後勝ちになる。

修正提案: 複合セレクタで 2 本の inset shadow を重ねる、または一方を outline にする
など両状態を同時に識別できる CSS にする。併存ケースのテストか visual QA を完了条件へ。

## 8. 軽微 — 実コードとの細かな不一致・記載漏れ

対象: design.md:359, design.md:200

- LedgerBoard.tsx で useMemo を新規使用するが React import に useMemo が無く、変更
  手順にも追加が無い。
- caddieSupply は現在 LedgerColumnTable のヘッダまでで SlotRows → GroupCell には
  渡されていない。「既に同じ経路」との説明は不正確。
- GetCourseCaddieSupplyUseCase::new は公開・re-export された public method のため、
  未使用でも必ずしも dead_code 警告にならない。clippy -D warnings が取り残し検出を
  保証するという説明は修正する。

修正提案: import と全 prop 配線を変更一覧へ明記し、死にコード確認には clippy に
加えて対象シンボルの rg ゼロ件確認を完了条件へ追加する。

## レビュー範囲の補足

削除対象の Rust シンボルと 3 テスト、PlanPicker のプラン変更経路、配置 API の
from/to と DTO、i18n の 3 ロケール、CSS の既存セレクタは、サンプリングした参照が
概ね実コードと一致していることを確認済み。
