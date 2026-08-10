# 予約作成時プレイヤー情報の設計

## Links

- [taskdoc](./task.md)

## Context

`NewReservationEditor` は `POST /v1/course/reservations` へ基本項目だけを送り、
`CreateReservationUseCase` は空の `PartyDetails` をFieldへ渡している。一方、既存の
`PATCH /v1/course/reservations/{id}/party` と `PartyEditor` はプレイヤー情報を扱える。

## Proposed design

- create requestへ `competitionName`、`organizer`、`groupNumber`、`players` をoptionalで追加する。
- requestを既存 `party_from_request` で検証し、`CreateReservationInput.party` としてusecaseへ渡す。
- Field gatewayは既に `NewReservation.party` を `customFields.golfParty` へ含めるため、
  新しい上流APIやDB変更は行わない。
- UIは人数分の空行を初期表示し、名前がある行だけを送る。区分または会員番号だけを
  入れた行は入力誤りとして保存を止める。
- tenant scopeのextension configに `playerTagOptions: string[]` を追加する。Fieldの汎用configを
  利用し、CourseBoard固有DBやField schemaは増やさない。
- 設定画面では候補を追加・削除できる。空値、重複、上限超過を保存前に検証し、config全体の
  read-modify-writeでは既存の未知キーを保持する。
- 新規予約と予約後の「組の中身」は、設定候補と「その他（自由入力）」を表示する。既存予約の
  `tag` が候補外なら、自動的に「その他」として現在値を表示する。

## Alternatives

予約作成後にparty PATCHを追加する案は不採用。2回目だけ失敗すると、予約は入ったが
プレイヤー情報は失われた中間状態になる。作成payloadへ含めればFieldの1回のcreateで
同時に保存できる。

区分をenum化する案も不採用。施設ごとに語彙が異なり、過去の値を無効化した後も予約履歴で
読める必要がある。永続化contractは自由文字列のままにし、候補は入力支援として扱う。

## Security and compatibility

全項目は既存party contractと同じ上限・正規化を使う。追加項目はoptionalなので既存clientは
無変更で動作する。認証・認可・tenant contextは既存create endpointを維持する。

## Test plan

- Rust: create requestから `PartyDetails` がField create bodyへ入ること、空名拒否。
- TypeScript: draftから送信playerへの変換と名前なし付随情報の検出。
- TypeScript: config候補の正規化・検証、候補外の既存値が自由入力になること。
- Playwright: Sheetの入力欄と作成後の台帳表示。

## ADR decision

既存party contractの適用範囲を広げるだけで、永続的なarchitecture判断は増えないためADRは不要。
