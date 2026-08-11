# ADR-0006: 日次サマリは集約需要として扱いダミー予約を作らない

## Status

Accepted (2026-08-10).

運用ルール値は `PLT-3262` / `PLT-3263` の現場確認後に設定する。

## Context

ICグリーンが出力できる予約データは、
`日 × コース × 午前/午後 × キャディ付き組数` の日次サマリだけである。
予約 ID、スタート時刻、終了時刻、予約ごとのキャディ有無は取得できない。

既存の CourseBoard / Field のキャディ assignment は予約またはラウンド単位で、
実時刻を使った重複検査と `reservation_id` 単位の未割当判定を行う。
一方、シフトとコース別供給は日単位の capacity をすでに持つ。

集約数を既存 assignment へ接続するためにダミー予約を作ると、source にない
予約 ID と時刻が業務事実として保存され、その架空時刻が午前→午後の再稼働可否を
決める。集約需要を別系統にするだけでは、シフト表と配車ボードの参照先が
二系統になり、両画面で過不足が食い違う。

`PLT-3362` では、Field で取り消された予約を CourseBoard が知れず、
消えた予約を指す staff assignment が担当上限や月次給与集計へ残る問題が
すでに起きている。ダミー予約は、同じ orphan と誤集計の経路を新しく増やす。

ADR-0005 はゴルフの需給と自動配置を CourseBoard の責務としている。

## Decision

ICグリーンの日次サマリには案 A を採用する。

1. 日次サマリを CourseBoard 所有の aggregate demand として保持する。
2. Field reservation、tee time、予約 ID を生成しない。
3. デモ第一段階は必要人数と過不足までとし、個人名を割り振らない。
4. 後続の個人割当は aggregate demand bucket に紐付く allocation として扱い、
   実予約の `CaddieAssignment` とは write model を分ける。
5. シフト表、配車ボード、過不足表示、CSV は、実予約由来か日次サマリ由来かを
   保った共通 work / coverage projection を読む。
6. planner 内部で count を一時的な work item へ展開することは許すが、
   reservation として永続化・表示しない。
7. 必要人数は午前+午後を単純加算せず、現場確認済みの1組あたり人数、
   午前→午後の継続条件、コース間移動条件から domain service が算出する。
8. 運用条件が未設定、または再取り込み後に再計算されていない日は、
   過不足を unknown / stale とし、0、空欄、成功色へ黙って fallback しない。
9. 再取り込みでは generated のみ再計算し、edited / pinned は要確認として残す。
10. CSV は unknown / stale があっても出力可能にする。ただし出力前に状態別件数を
    表示し、各行にも calculation status を含める。両方を満たせなければ出力を拒否する。

## Consequences

### Positive

- source が持たない予約明細を捏造せず、数字と割当の由来を追跡できる。
- 7月1日の午前56組・午後15組を、確認済みの再稼働条件に従って
  56〜71人の範囲で正しく説明できる。
- PLT-3249 の再取り込みを aggregate demand の置換と allocation 再計算として扱える。
- 実予約 tenant と日次サマリ tenant で、同じ coverage status と色分けを使える。
- ADR-0005 の CourseBoard / Field 境界を維持する。

### Negative

- aggregate coverage の保存・projection と、既存2画面の adapter が必要になる。
- 予約単位画面をそのまま再利用できず、配車ボードに aggregate mode が必要になる。
- 個人割当を追加する段階で、PLT-2294 の planner を work item / eligibility / ranking に
  分ける必要がある。
- 午前と午後で別コースへ移る運用なら、PLT-2296 の日単位 course placement も
  band 単位へ拡張する必要がある。

### Constraints for follow-up work

- `全体(81H)` と午前午後の `合計` を需要へ二重に加えない。
- 実時刻がない aggregate work item に架空時刻を持たせない。
- 色は日合計ではなく、コース×午前/午後の feasible coverage から決める。
- generated allocation と edited / pinned allocation を区別し、再取り込みで
  手動・固定を黙って外さない。
- source / policy version が変わった旧結果を green または確定 CSV として扱わない。
- デモ第一段階の aggregate demand / coverage に stable identity を持たせ、
  `PLT-3341` の判断後に個人 allocation を追加できるようにする。

## Alternatives Considered

### 案 B: サマリからダミー予約を N 件生成する

Rejected. 既存の未割当一覧、自動配置、assignment table は再利用できるが、
予約 ID、顧客、開始時刻、所要時間、状態を発明する必要がある。架空時刻が
overlap と午前→午後の再稼働を決め、予約・給与・評価・取消の各 read model へ
偽の明細が漏れるため採用しない。

### 案 A を画面ごとに直接読む

Rejected. シフト表は assignment 件数、配車ボードは tee sheet と reservation ID、
コース別需給は日合計をそれぞれ読むため、画面ごとに別計算すると同じ日の色が
食い違う。共通 coverage projection を境界にする。

### 午前+午後を必要人数とする

Rejected. 午前担当者が午後にもう1ラウンド回れる運用を無視し、例の56+15を
毎日71人必要と誤表示し得る。

### `max(午前, 午後)` を常に必要人数とする

Rejected. 少ない側の全員が2ラウンド可能、時間帯とコース移動が成立するという
未確認の前提を置く。個人の shift capacity / request を満たさない日を充足と誤表示する。

## References

- `PLT-3339`, `PLT-3362`, `PLT-3262`, `PLT-3263`, `PLT-3341`
- `PLT-3248`, `PLT-3249`, `PLT-2294`, `PLT-2296`, `PLT-2827`, `PLT-1687`
- [ADR-0005: ゴルフドメイン知識は CourseBoard が所有する](./ADR-0005-golf-domain-ownership.md)
- [PLT-3339 taskdoc](../../tasks/in-progress/plt-3339-daily-summary-caddie-demand/task.md)
- [PLT-3339 design](../../tasks/in-progress/plt-3339-daily-summary-caddie-demand/design.md)
