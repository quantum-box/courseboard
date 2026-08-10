# 予約作成時にプレイヤー情報を入力する

## Links

- [設計](./design.md)
- Linear issue: 未作成

## 概要

予約台帳の「予約を入れる」Sheetは、予約者名・人数・プレー商品しか入力できず、
プレイヤー名、区分、会員番号を登録できない。予約後の「組の中身」では同じ情報を
編集できるため、作成後にもう一度Sheetを開く二度手間になっている。新規予約APIへ
組情報を含め、予約とプレイヤー情報を一度に保存する。

## Scope

- 新規予約Sheetへプレイヤー名・区分・会員番号の入力行を追加する。
- 入力したプレイヤー情報を新規予約APIで予約と同時に保存する。
- 施設設定でプレイヤー区分の候補を定義し、予約入力では候補選択と「その他」の自由入力を使う。
- 予約後の「組の中身」編集でも同じ候補を使い、既存の未定義値は自由入力として保持する。
- 空の入力行は保存対象にせず、名前なしで区分・会員番号だけがある行は拒否する。
- 既存の予約者名、人数、商品、在庫競合の挙動は維持する。

## Non-goals

- Field側の予約モデルやDB schemaの変更。
- プレイヤーの顧客マスタ検索・自動補完。
- 予約後の「組の中身」編集画面の再設計。

## Plan

- [x] 新規予約request/usecaseへ既存 `PartyDetails` を渡す。
- [x] Sheetへプレイヤー入力欄を追加する。
- [x] API payload、入力変換、既存挙動のtestを追加する。
- [x] TypeScriptとRustの自動検証を行う。
- [x] extension configへプレイヤー区分候補を追加する。
- [x] 新規予約と「組の中身」を候補選択＋その他入力へ変更する。
- [x] 区分設定・選択・既存自由入力のtestを追加する。
- [x] PlaywrightでSheet表示、送信payload、作成後の台帳表示を確認する。

## 完了条件

- 「予約を入れる」Sheetを開くと人数に対応したプレイヤー入力欄が見える。
- 入力した名前・区分・会員番号が作成直後の予約台帳へ表示される。
- 予約とプレイヤー情報が別々に成功・失敗する中間状態を作らない。
- 未入力のプレイヤー情報は従来どおり予約作成を妨げない。
- 設定済み区分を選択でき、「その他」では任意の区分を入力できる。
- 過去の予約にある設定外の区分は消えず、自由入力として編集できる。

## リスクと保留

- プレイヤー検索は別機能として扱う。
- Playwrightの独立セッションではroute stubを使ったため、実Cognito認証・実Field接続を含む
  統合確認はPR CIとデプロイ後確認へ委ねる。
- PR準備、version bump、commit、pushは本作業の範囲外。

## Verification

- `cd desktop && npm run type-check`
- `cd desktop && npm run test`（47 files / 406 tests）
- `cd desktop && npm run build`（成功。既存のchunk size warningのみ）
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test create_reservation_request_accepts_player_details`
- `cargo test desk_booking_targets_generated_inventory_and_skips_online_prepayment`
- `cargo test`（428 tests）
- `127.0.0.1:8080/healthz` が `{"status":"ok"}` を返すこと。
- `127.0.0.1:5174` が変更済み `NewReservationEditor` moduleを配信していること。
- Playwright: 予約Sheetで予約者名、プレイヤー名、設定済み区分、会員番号を入力し、
  `players` payloadと作成後の台帳表示を確認した。console errorは0件。
