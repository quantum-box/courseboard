# 予約ルールの「未設定」を正常系として返す

## Links

- [PLT-3234](https://linear.app/issue/PLT-3234)

## 調べて分かったこと

- 予約ルールの正は Field の予約ポリシーテーブル（`golf_reservation_policies`）。CourseBoard ローカル DB にも
  extension config にも写しは無い（config 側の写しは ADR-0009 で削除対象）。
- 経路は `GET/PATCH /v1/course/reservation-policy` → Field `/v1/erp/extensions/golf-course/reservation-policy`。
  **extension-scoped path への依存が残っている**が、これは
  [field-extension-path-exit](../field-extension-path-exit/task.md) の束の 1 つで、Field の汎用 API を待つ。
- Field の PATCH は `INSERT … ON DUPLICATE KEY UPDATE` で、**行が無いテナントでも最初の 1 件を作れる**。
  画面の「保存」がそのまま設定導線になる。
- 行が無いと Field の予約時ガードは素通し（セルフロック・客単価判定がかからない）。予約作成は
  テナントの最初の予約種別へフォールバックする。未設定は運用上ありうる正常な状態。
- Field の 404 は 2 種類あった。行が無い 404 は `code: NOT_FOUND` 付き、ルートが無い 404（axum の未登録）は本文なし。
  これまで CourseBoard はどちらも 404 のまま画面へ流し、画面はどちらも「未設定」と表示していた。
- Field は読み書きとも `tenant_extensions` の `golf_course` が有効かを見ており、無効なら 400
  `golf_course extension is not enabled` を返す。ADR-0010 の「extension 有効判定に依存しない」に反する
  Field 側の依存で、CourseBoard からは解消できない。

## 決めたこと

- 未設定は正常系として扱い、`GET /v1/course/reservation-policy` は 200 `{ "policy": null }` を返す。
  port も `Option<ReservationPolicy>` にし、予約作成が上流の 404 を握りつぶす分岐を消す。
- `NOT_FOUND` の無い 404 と、読み取りの 400 は 424 `provider_error`。利用者が CourseBoard から直せない上流起因の失敗なので。
- 設定導線は既存の予約ルール画面の保存ボタン。未設定のときは「保存するまで判定がかからない」と画面に出す。

## 残り

- [ ] Field に「予約ポリシーの保存先を extension 有効判定から切り離す」汎用 capability を起票する
  （field-extension-path-exit の「予約ポリシー」と同じ束）。
- [ ] 連携メタデータの保存が `metadataJson` だけを PATCH し、Field 側で他の列が初期値に戻る問題を別タスクで直す。
