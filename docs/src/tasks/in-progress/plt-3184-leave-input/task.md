# 休み希望カレンダーの入力改善

## Scope

- 休み希望カレンダーで tenant timezone の「今日」を強調する。
- 通常クリックを起点に、Shift+クリックで連続日をまとめて選択・保存できるようにする。
- PLT-3183 は PR #162 で main へ merge 済みであり、本タスクへ取り込まない。

## Selection contract

- 通常クリックした日を anchor とする。
- Shift+クリックは anchor とクリック日の両端を含む範囲を選ぶ。
- Shift+クリックでは anchor を動かさず、次の通常クリックで置き換える。
- 範囲内の既存選択は toggle せず、全日を選択状態に揃える。
- Shift+クリックごとに範囲を作り直し、同じ anchor から伸縮できる。
- 選択範囲には同じ availability status、2ラウンド希望、メモを保存する。

## Today contract

`configJson.timezone` を tenant timezone の SoR とする。timezone key が無い、または空の既存
tenant だけは SCC-6 と同じ `Asia/Tokyo` を使う。設定取得に失敗した場合や、設定値が不正な
場合はブラウザのローカル日付へ fallback せず、カレンダーをエラー表示にする。

日付判定は `now` と timezone を受け取る pure helper に置く。実行日の偶然に依存しない固定
instant のテストで、UTC 日付と tenant 日付が異なる境界を確認する。

## Storage and API

schema、migration、Field contract は変更しない。既存の1日単位の availability upsert を選択日数分
呼び出し、全 request の終了後に表示を再取得する。途中失敗時は選択を残してエラーを表示し、
idempotent な upsert を再実行できるようにする。

## Verification

- 通常クリックの anchor が Shift+クリック後も固定される。
- 逆方向の範囲でも全日が日付順に選ばれる。
- 選択済み・未選択が混在する範囲を全選択に揃え、toggle しない。
- 固定 instant を tenant timezone で日付化し、その日だけを today と判定する。
- timezone 取得失敗・不正値をブラウザ時刻へ黙って fallback しない。
- frontend type-check、unit tests、build を通す。
