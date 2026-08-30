# SCC-27 詳細設計: キャディ供給ガードの撤去と未割り当ての可視化

task.md の「確定事項（骨格）」は変更しない。本書はその実現方法を具体化し、
「詳細計画エージェントへの委譲事項」に決定を下す。実装は行わない。

対象読者は実装担当の別エージェント2名（backend / frontend）。互いのコードを
読まずに着手できるよう、各パッケージのセクションだけで完結するように書く。

## 0. 前提として確認した事実（両パッケージ共通）

- `POST /v1/course/reservations` の認可分類（`src/course_authz.rs:1032` の
  `classify(&Method::POST, "/v1/course/reservations")`）はガード撤去後も
  変わらない。エンドポイントの追加・削除がないため authz の変更は不要。
- `GET /v1/course/caddie-assignments` は既に `from`/`to`（`NaiveDate`）でしか
  絞り込めない（`src/course/interfaces/http.rs:2373-2378` の
  `CaddieAssignmentQueryParams`）。単日取得は `from=date&to=date` で行う。
  台帳が使う `CaddieAssignmentDto`（`src/course/interfaces/http.rs:2307-2324`）
  は既に `id` / `reservationId` / `status` を返しており、フロントの
  `CaddiesPage.tsx:601` や `ShiftBoardPage.tsx:323` が同じ形で使っている。
  → **バックエンドの変更は不要**（task.md の見込み通り）。
- プラン変更（セルフ→キャディ付き）経路は現状ガード無しを確認済み：
  - backend: `src/course/usecase/change_reservation_plan.rs` にキャディ関連の
    分岐は存在しない。
  - frontend: 既存予約のプラン変更 UI `PartyEditor.tsx:317-321` は
    `<PlanPicker>` を `caddieSoldOut` を渡さずに呼んでおり（デフォルト
    `false`）、ガードは元々かかっていない。
  - よって「撤去後は一貫するはず」は事実であり、追加対応は不要。
    `PlanPicker` から `caddieSoldOut` prop 自体を削除しても
    `PartyEditor.tsx` の呼び出しは無変更で動く。

## 1. 委譲事項への決定

task.md 「詳細計画エージェントへの委譲事項」の5項目に対する決定。

### 1-1. 赤背景か赤枠か、文言、i18n キー設計

**決定: 赤枠**（`.ledger-cell-group` への destructive カラーの
inset **outline**。**[レビュー反映により box-shadow から変更、詳細は
3-1節 CSS・7節 review #7]**）+ セル内に小さな赤文字テキスト
「未割り当て」。

根拠:
- 行 (`tr.ledger-row-*`) の背景は `slotTone()`（open/partial/full/special/
  closed/retired）が既に専有している（`ledgerLayout.ts:54-61`、CSS
  `styles.css:5253-5278`）。同じ `<td>` に別の背景を上書きで重ねると
  tone 表示と衝突するため、行/セルの背景ではなくセル内のリング／枠線で
  表現する。
- 選択状態の表現に既に近い手法がある: `.ledger-cell-group.is-selected` が
  `box-shadow: inset 0 0 0 2px hsl(var(--nui-primary) / 45%)`
  （`LedgerBoard.tsx:480`, `styles.css:5347-5349`）。ただし同じ
  `box-shadow` プロパティを使うと選択中の行で片方の状態が消える
  （review #7）ため、未割り当て側は `outline` +
  `outline-offset: -2px` にして両立させる —
  `.ledger-plan-option:focus-within`（`styles.css:5563-5566`）に
  既にある手法。
- destructive トークンは `.ledger-column-oversold` で既に「デスクが対処すべき
  一項目」を示す色として使われている（`styles.css:5123-5128`）。同じ意味
  （対応が必要）なので流用する。

i18n キー（`ledger` namespace、`cell` セクションに追加）:
- `ledger:cell.unassignedCaddie` = 「未割り当て」（en: `Unassigned`,
  ja-plain: `未割り当て`は漢字のままでよい — completeness テストの
  `プロパティ description|summary|message|body` 限定ルールには掛からない
  短いバッジ文言であり、既存 `cell.closed`/`cell.special` も ja-plain で
  意味を変えていない。念のため読みやすさだけ調整するなら
  ja-plain: `だれも 決まっていません` でも可。実装エージェントの裁量とする）。

新規追加が不要な理由: 撤去する `ledger:newReservation.caddieSoldOut` /
`caddieSoldOutTitle` / `caddieSoldOutBody` はこの1キーで置き換わり、
ツールチップ等の追加キーは骨格上不要（バッジ文言のみで足りる）。

### 1-2. 共通ヘルパーの置き場所と命名

**決定: 新規ファイル `desktop/src/features/golf/caddieRoundCoverage.ts`** を
作り、`UnassignedRounds.tsx` からロジックを移し、ledger 側はそこから import
する。

根拠（依存方向の一貫性）:
- 現状 `desktop/src/features/golf/ledger/*` は golf ルート
  （`../caddieCourseSupply`）と `golf/timeline/*`
  （`../timeline/models`）に依存している。逆方向（golf ルートや
  timeline が ledger を import する例）は grep で1件も存在しない。
- `UnassignedRounds.tsx` は golf ルート直下にあるため、ヘルパーを
  `ledger/` 配下に置くと golf ルート → ledger という新しい依存方向が
  生まれ、既存の一方向性を崩す。golf ルート直下の新規ファイルに置けば
  `UnassignedRounds.tsx`（golf ルート）にも `ledger/*`
  （golf ルートに依存できる）にも自然に使える。
- 命名は既存の `caddieCourseSupply.ts`（golf ルートの「その日のキャディ
  供給を表す純粋関数群」）と対にした `caddieRoundCoverage.ts`
  （「1ラウンドがキャディで塞がれているか」）とする。

エクスポート内容（`UnassignedRounds.tsx:51-83` から移動、ジェネリック化）:
```ts
export type CoverageAssignment = { reservationId?: string | null; status: string }
export type CoverableRound = { id: string; playType: string; status?: string }

export function holdsTheRound(assignment: CoverageAssignment): boolean
export function roundIsStillOn(row: CoverableRound): boolean
export function unassignedCaddieRounds<T extends CoverableRound>(
  rows: T[],
  assignments: CoverageAssignment[],
): T[]
```
`<T extends CoverableRound>` にジェネリック化する理由: 呼び出し元が
`UnassignedRounds.tsx` の `TeeSheetRow`（`golf/timeline` 由来ではない
tee-sheet DTO 形）と、ledger 側の `TeeReservation`
（`golf/timeline/models.ts:15-34`、`tee-ledger` DTO 由来で status の
値集合が異なる）の**2つの異なる型**である。両方とも `id` /
`playType: string` / `status?: string` を構造的に満たすが、ノミナルに
共通化するとどちらかの型に無理に寄せることになる。ジェネリクスなら
呼び出し元の型をそのまま返せて、以後 `.courseName` 等の追加フィールドも
失わない。

`assignmentsOnCancelledRounds` / `wallClock` / `dayLabel` / `horizonEnd`
は `UnassignedRounds.tsx` 画面固有の関心事なので**移動しない**。ただし
`assignmentsOnCancelledRounds` は移動後の `holdsTheRound` /
`roundIsStillOn` を `./caddieRoundCoverage` から import して使う。

ledger 側の消費点は `ledgerLayout.ts` に薄いラッパー関数群を追加する
（1-3 節を参照）。

### 1-3. 「シフト確定済みの日」の判定に使うデータソース

**[レビュー反映により変更] 当初案（`knowsCaddieCapacity()` の転用）を撤回し、
確定シフト行の存在を明示的に取得する方式に変更した。判定の単位も骨格どおり
「日単位」に戻す。**

#### 当初案が成立しない理由（review-sol-1.md #1 の指摘を検証し、事実と確認）

`knowsCaddieCapacity()` は
`supply.roundsCapacity > 0 || supply.caddieAttachedGroups > 0`
（`ledgerLayout.ts:263-280`）。このうち `caddieAttachedGroups` は
`get_course_caddie_supply.rs:151-167` の `caddie_attached_by_course()` が
計算しており、**シフトの確定有無とは無関係に**その日のキャディ付き予約
（未キャンセル）の数を数えているだけ（`compute_course_supply` 内で
`rounds_capacity` はシフト由来、`caddie_attached_groups` は予約由来の別系統
であることを `course_supply.rs:96-143` で確認済み）。したがって:

- シフトが1件も確定していない将来日でも、キャディ付き予約が1件でも
  入っていれば `caddieAttachedGroups > 0` となり `knowsCaddieCapacity` は
  `true` を返す。
- その日その他の未割り当てキャディ予約が「確定日」の条件を誤って満たし、
  骨格2「未確定の将来日は表示しない（赤だらけ防止）」に反して赤表示
  されてしまう。
- さらに骨格は「その日のシフトが確定済みの日」という**日単位**の条件
  （task.md 17行目、撤去する backend ガードの `confirmed.is_empty()` も
  `list_shifts(operator_id, date, date)` というテナント全体＝日単位の
  判定 — `create_reservation.rs:218-224`）だったが、当初案は根拠なく
  コース単位に意味を変えていた。骨格に無い変更であり、撤回する。

#### 修正後の方式

**確定シフトの存在は `GET /v1/course/caddie-shifts?from=date&to=date`
（1件でも返れば確定済み）で明示的に取得する。** 新しい backend エンドポイント
は作らない — 既存の
`ListCaddieShiftsUseCase::execute`（`list_caddie_shifts.rs:20-35`、
`credentials.require(actions::LIST_SHIFTS)`）をそのまま呼ぶ
`GET /v1/course/caddie-shifts` を使う。撤去した backend ガードが呼んでいた
`self.shifts.list_shifts(operator_id, date, date)` と全く同じデータ・
同じ粒度（日単位、テナント全体）なので、骨格の判定基準と完全に一致する。

新規 backend エンドポイントを作らなかった理由: 台帳1日分の未割り当て有無
だけを返す専用エンドポイントの方が転送量は小さくできるが、(a) 新しい
DTO・ハンドラ・authz 分類が増え「バックエンド変更は不要」という骨格の
見込みから逸脱する範囲が大きい、(b) `caddie-shifts` は `ShiftBoardPage.tsx:353`
が既に `from`/`to` で同じ形で叩いており（`ShiftRangeQuery` は `from`/`to`
のみ必須、コース指定は無い — `http_ops.rs:1513-1516`）、1日分でも同じ
呼び出し方が通ることを確認済み。(c) 1日分の返却行数はクラブの在籍キャディ
数（実運用で数十件程度）に収まり、台帳が既に取得している `tee-ledger` /
`caddie-assignments` と同程度のサイズ。以上より、専用エンドポイントの新設
は本タスクの範囲に対して過大と判断し、既存エンドポイントの再利用を採る。

#### 受付担当（front desk）への公開が抜けていた問題（review #1 後半）

`GET /v1/course/caddie-shifts` は `actions::LIST_SHIFTS`
（`field_extension_golf:ListShifts`）を要求する。ところが
`.tachyon/manifests/tachyonfield-golf-auth.yml:198-242` の
`field-extension:golf:reception`（台帳の主利用者である受付担当のポリシー）
には `ListShifts` も `ListCaddieInsights` も付与されていない
（`ListCaddieAssignments` はある）。台帳の主画面が `ListTeeSheet` で
reception に開放されている一方、確定シフトの有無を読む権限が無いため、
**このまま実装すると受付担当の画面では常に 403 になり、未割り当て表示が
一度も出ない**（レビューの指摘どおり）。

**決定: `.tachyon/manifests/tachyonfield-golf-auth.yml` の
`field-extension:golf:reception` ポリシーに
`field_extension_golf:ListShifts` の `allow` を1行追加する。**
`ListCaddieInsights` は追加しない（1-3節の方式変更により
`caddie-course-supply` に依存しなくなったため不要）。

根拠・最小限であることの確認:
- `ListShifts` は新規アクションではなく、`actions:` セクションに既に
  宣言済み（`tachyonfield-golf-auth.yml:86-89`）。`src/course/domain/actions.rs:200-218`
  の manifest 整合性テスト（`include_str!` でこの YAML を読み、
  Rust 側で使う action 名がすべて宣言済みか検証する）に抵触しない
  ―― 新しい action 名を増やすのではなく、既存 action の付与先ポリシーを
  1つ増やすだけなので、この Rust テストは無変更で通る。
- `course_authz.rs` 側は無変更でよい: `GET /v1/course/caddie-shifts` は
  既に `RouteAuthorization::Action(LIST_SHIFTS)` に分類済み
  （`course_authz.rs:148-152`）。ルート分類テーブルは新規ルートを
  追加するときだけ更新が要る（CLAUDE.md）。
- `CaddieShiftDto`（`http_ops.rs:1476-1491`）は誰がどのコースに入るか
  ・時間帯・枠数のみで、給与・査定などの機微情報は含まない
  （`ListPayroll`/`ListCaddieRankFees` はそれぞれ別 action）。
  「予約を受け付ける担当が、当日キャディが配置されているかを読める」
  ことは reception のポリシー説明（"Front-desk work - take and change
  bookings, run the tee sheet..."）の範囲内と判断する。
- 挿入位置は `field-extension:golf:reception` ブロック内の
  `field_extension_golf:ListCaddieAssignments`（`tachyonfield-golf-auth.yml:236-237`）
  の直後。他ポリシー（`caddie-master` 等）でも
  `ListCaddieAssignments` → (`ListCaddieAvailability` →) `ListShifts` の
  並びになっており、既存の並び順の慣習に合わせる。

#### API 失敗・未着時の扱い（tri-state、review #2 を統合）

「配置（`caddie-assignments`）」と「確定シフト（`caddie-shifts`）」は
どちらも `useResource` 経由の非同期取得であり、レンダリング時点では
「まだ取得中（unknown）」「取得できた（loaded）」「失敗した（failed）」の
3状態のいずれかである。**`data: T | null` を `?? []` や `?? false` で
安易に潰すと、「読み込み中 / 失敗」を「確定シフト無し」や「配置なし
（＝全部未割り当て）」と誤判定し、過剰な赤表示につながる**
（review #2 の指摘のとおり。`useResource.ts:70-79` は `data: T | null` と
`error: unknown` を明確に区別しており、この情報を捨てるべきではない）。

`ledgerLayout.ts` に汎用の3状態ラッパーを追加する:

```ts
export type ResourceStatus<T> =
  | { kind: 'unknown' }
  | { kind: 'failed' }
  | { kind: 'loaded'; value: T }

/** `useResource` の戻り値をそのまま渡せる。data/error の握り潰しを防ぐ。 */
export function resourceStatus<T>(resource: {
  data: T | null
  error: unknown
  loading: boolean
}): ResourceStatus<T> {
  if (resource.error) return { kind: 'failed' }
  if (resource.data === null) return { kind: 'unknown' }
  return { kind: 'loaded', value: resource.data }
}

/** その日にシフトが1件でも確定していれば true。unknown/failed は false
 *  （＝赤表示を出さない安全側）。 */
export function dayHasConfirmedShifts(
  shifts: ResourceStatus<{ items: unknown[] }>,
): boolean {
  return shifts.kind === 'loaded' && shifts.value.items.length > 0
}
```

`unassignedCaddieReservationIds`（1-2節で新設）も `ResourceStatus` を
受け取るよう変更する:

```ts
export function unassignedCaddieReservationIds(
  columns: LedgerColumn[],
  assignments: ResourceStatus<{ items: CoverageAssignment[] }>,
): Set<string> {
  if (assignments.kind !== 'loaded') return new Set()
  const rows = columns.flatMap(column => column.slots.flatMap(slot => slot.items))
  return new Set(unassignedCaddieRounds(rows, assignments.value.items).map(row => row.id))
}
```

**未取得・失敗時は空集合を返す（＝未割り当て0件として扱う）。** これは
「配置ゼロ」と「取得できていない」を区別した上で、どちらであっても
「わからないものは赤くしない」という同じ安全側に倒す設計であり、
`caddieSupply` が未着のとき `knowsCaddieCapacity` が `false` を返して
キャディプランを塞がない、という既存コードの安全側設計方針
（`ledgerLayout.ts:283-291` の doc comment）と一貫している。

#### 適用方法（最終）

「未割り当て」バッジは次の3条件が揃ったときだけ描画する:

```ts
item.playType === 'caddie'
  && shiftsConfirmed          // dayHasConfirmedShifts() の結果、日単位の真偽値
  && unassignedIds.has(item.id) // unassignedCaddieReservationIds() の結果
```

`shiftsConfirmed` は台帳全体で1つの真偽値（列 = コースに依存しない、
骨格どおりの日単位判定）であり、`unassignedIds` は台帳全体で1つの
`Set<string>`。どちらも `LedgerBoard` で1回だけ計算し、以降は
そのまま下位コンポーネントへ配る（2-1節・3-1節で配線を具体化する）。
`caddieSupply`（列ヘッダの `キャディ 8/12` 表示、SCC-28）はこの判定に
一切使わない — 完全に独立させる。

### 1-4. テスト計画

2-2 節・3-2 節に記載。要点だけここに書く。**[レビュー反映により更新]**
当初は「新規テスト不要／コンポーネントテストは任意」としていたが、
review #3・#5 を受けて両方とも必須に変更した。

- backend: 削除対象にのみ既存テストがある
  （`course_supply.rs` の `room_tests` モジュール3件）。
  加えて `CreateReservationUseCase::execute` の Fake gateway 回帰
  テストを1件必須で追加する（review #5。撤去した挙動そのものを
  検証するテストがこれまで無かったため）。
- frontend: 移動するロジックのテストは移動先に付け替え、新規の可視化
  ロジック（`ResourceStatus` の3状態・日単位の確定判定込み、1-3節）を
  `ledgerLayout.test.ts` に追加。撤去する `caddieSoldOut` 系のテストは
  削除する（後述、リライトではなく削除が妥当と判断した理由も記載）。
  加えて、確定日ゲートと配置の3状態を掛け合わせた最終描画判定を
  検証する `LedgerBoard.test.tsx`（新規・必須）を追加する（review #3）。

### 1-5. プラン変更経路の扱い

0節に記載の通り確認済み。**追加対応不要**。`PlanPicker` から
`caddieSoldOut` prop を削除しても `PartyEditor.tsx` は無変更で動作する
（そもそも渡していないため）。

## 2. backend パッケージ（Rust）

### 2-1. 変更対象ファイルと変更内容

#### `src/course/usecase/create_reservation.rs`

1. `use` ブロック（12-19行目）から `has_room_for_one_more_caddie_round`,
   `CaddieShiftGateway` を削除。20行目の
   `use crate::course::usecase::GetCourseCaddieSupplyUseCase;` を削除
   （このファイルから参照が無くなるため）。
2. `struct CreateReservationUseCase`（48-55行目）から
   `shifts: Arc<dyn CaddieShiftGateway>,` フィールドを削除。
3. `impl CreateReservationUseCase::new`（57-74行目）のシグネチャから
   `shifts: Arc<dyn CaddieShiftGateway>,` 引数を削除し、
   body の `shifts,` を削除。
4. `execute()` 内、102-105行目:
   ```rust
   self.refuse_a_tee_time_the_desk_shut(credentials, &input)
       .await?;
   self.refuse_a_round_the_course_cannot_walk(credentials, &input, product.as_ref())
       .await?;
   ```
   の2つ目の呼び出し（`refuse_a_round_the_course_cannot_walk`）を削除。
   `refuse_a_tee_time_the_desk_shut` 呼び出しは残す（売り止めガードは
   本タスクの対象外）。
5. `refuse_a_round_the_course_cannot_walk` メソッド全体
   （196-239行目、doc comment 含む）を削除。
6. `product_for_service` の戻り値 `product` は
   `validate_product_course(product.as_ref(), &input.golf_course_id)?;`
   （100行目）で引き続き使われるため、`product_for_service` 自体・
   `ReservationProduct` の import は残す。
7. テストモジュール（412-643行目）は変更不要
   （このガードに関する単体テストはここに存在しない）。

#### `src/course/usecase/get_course_caddie_supply.rs`

1. `for_capacity_guard` メソッド（99-105行目、doc comment 88-98行目含む）
   を削除。呼び出し元が無くなるため必須の削除
   （`pub(crate)` だが実質使用者が消えるので clippy の dead_code
   対象になる）。
2. `for_capacity_guard` を消すと `pub fn new(...)`（29-42行目、
   roster を受け取らないコンストラクタ）の唯一の呼び出し元
   （`create_reservation.rs:226`）も消える。
   **[レビュー反映により訂正]** この crate は `src/lib.rs` を持つ
   ライブラリ構成のため（`Cargo.toml` に `[[bin]]` が複数、`src/lib.rs`
   と `src/main.rs` が併存）、`pub fn` は公開 API とみなされ
   `clippy -D warnings` の dead_code では検出されない
   （`for_capacity_guard` は `pub(crate)` なので検出されるが、`new` は
   `pub` なので検出されない）。したがって「clippy が保証する」とは
   書けない。削除するかどうかは可読性の判断であり、削除する場合は
   `rg "GetCourseCaddieSupplyUseCase::new\(" src/` がこのファイル以外に
   ヒットしないことを目視で確認してから消す（2-3節の完了条件に追記）。
3. `new` を消すと `struct GetCourseCaddieSupplyUseCase` の
   `ops: Option<Arc<dyn GolfOpsGateway>>`（26行目）は常に `Some` になる。
   **推奨（必須ではないが強く推奨）**: `Option` をやめて
   `ops: Arc<dyn GolfOpsGateway>` に単純化し、`with_roster` を
   `new`（唯一のコンストラクタ）にリネームするか、あるいは
   `with_roster` の名前のまま残す（呼び出し元
   `http_ops.rs:1927` の可読性が落ちないなら現状名を維持でよい）。
   これに伴い:
   - `execute()`（60-86行目）の `match self.ops.as_ref() { Some(...) => ..., None => None }` を、
     常に roster を読む素直なコードに簡略化する。
   - `supply()`（110-148行目）の引数 `known_caddies: Option<&HashSet<String>>`
     を `known_caddies: &HashSet<String>` に変え、130-136行目の
     `match known_caddies { Some(known) => ..., None => shifts }` を
     単純なフィルタに変える。
   - 25-26行目・107-109行目の doc comment
     （`for_capacity_guard` を名指しした説明）を書き直す。
   - **理由**: `Option` を常に `Some` でしか呼ばれない状態のまま残すのは
     「使われなくなった分岐を残す」ことに相当し、CLAUDE.md
     の「半端な実装を残さない」方針に反する。ただし clippy
     `-D warnings` では検出されない任意の簡略化なので、実装エージェントが
     時間的制約で見送る場合は最小差分（1-2番のみ）でも完了条件は満たす。

#### `src/course/domain/course_supply.rs`

1. `has_room_for_one_more_caddie_round` 関数（218-225行目、doc comment
   含む）を削除。
2. `room_tests` モジュール（499-553行目、3テスト）を削除。
3. モジュール冒頭の doc comment（1-8行目）に
   `has_room_for_one_more_caddie_round` を直接名指しした記述はないため
   変更不要（一般的な供給計算の説明のみ）。

#### `src/course/domain/mod.rs`

- 78行目の re-export リストから `has_room_for_one_more_caddie_round` を
  削除（`compute_course_supply, reinforcements_for` は残す）。

#### `src/course/interfaces/http.rs`

- `create_reservation` ハンドラ（868-883行目付近）の
  `CreateReservationUseCase::new(...)` 呼び出しから
  `state.caddie_shifts(),`（881行目）を削除。
  `state.caddie_shifts()` 自体は他の10箇所超で使われ続けるため
  （`http_ops.rs` 内の shift 関連ハンドラ群）、`AppState` 側の変更は無い。

#### `.tachyon/manifests/tachyonfield-golf-auth.yml`

**[レビュー反映により追加]** `field-extension:golf:reception` ポリシー
（198-242行目）の `field_extension_golf:ListCaddieAssignments`
（236-237行目）の直後に1行追加する:

```yaml
  - action: field_extension_golf:ListCaddieAssignments
    effect: allow
  # SCC-27: 台帳の「未割り当て」赤表示は、その日にシフトが確定している
  # かどうかを GET /v1/course/caddie-shifts で読んで判定する。受付担当が
  # 台帳の主利用者である以上、この読み取りだけは front desk にも要る。
  - action: field_extension_golf:ListShifts
    effect: allow
```

新しい `actions:` 定義は追加しない（`ListShifts` は1行目のブロックに
既存宣言済み、86-89行目）。`ListCaddieInsights` は付与しない
（1-3節の方式変更により不要）。理由・安全性の確認は1-3節を参照。
このファイルはフロントエンド側の実装（3-1節、`caddie-shifts` の
新規取得）と対になっているため、**frontend パッケージがこのマニフェスト
変更に依存する**（4節で明記）。

### 2-2. テスト計画

- 削除: `src/course/domain/course_supply.rs` の `room_tests` モジュール
  3件（対象関数を消すため）。
- **[レビュー反映により追加・必須]** `create_reservation.rs` のテスト
  モジュールに、`CreateReservationUseCase::execute` を通しで叩く
  回帰テストを1件追加する。

  理由（review-sol-1.md #5 を採用）: 既存の `ensure_slot_available`
  系テストは枠競合の検証であり、「シフト確定済み・供給ゼロでもキャディ
  付き予約が作成される」ことの証拠にはならない。ガード削除の当のふるまい
  を確認するテストが1件も無い状態は、このタスクの中心的な変更に対して
  検証が欠けている。

  実装方法: `src/course/usecase/get_tee_sheet.rs:245-339` の
  `FakeReservationGateway` / `FakeGolfCatalogGateway` と同じ流儀
  （trait の全メソッドを実装し、テストで使わないものは
  `unimplemented!("not used")` にする）で、`CreateReservationUseCase` が
  要求する5つの Gateway 分の Fake を用意する。必要なメソッドは:
  - `ReservationGateway`（`ports.rs:604-` 、10メソッド）:
    実装が要るのは `list_reservations`（空でよい）,
    `list_reservation_type_ids`（1件返す）, `create_reservation`
    （成功として `ReservationId` を返す — **ここに到達することが
    このテストの合否そのもの**）。残りは `unimplemented!`。
  - `GolfCatalogGateway`（`ports.rs:814-`、14メソッド）: 実装が要るのは
    `get_tenant_timezone`, `list_resources`,
    `list_reservation_products`（`play_type: Caddie` の商品を1件返す）。
    残りは `unimplemented!`。
  - `GolfCommercialGateway`（`ports.rs:1070-`、11メソッド）: 実装が要る
    のは `get_reservation_policy`（`CourseError::NotFound` を返せば
    `reservation_type_id()` フォールバック経路をそのまま通せる）。
    残りは `unimplemented!`。
  - `ReservationScheduleGateway`（`ports.rs:560-`、3メソッド）: 実装が
    要るのは `list_resource_time_slots`（空きのあるスロットを1件返す）。
  - `SlotOverrideGateway`（`ports.rs:217-`、3メソッド）: 実装が要るのは
    `list_slot_overrides`（空配列でよい）。

  テストケース: 「`play_type: Caddie` の商品でキャディ供給が無い
  （またはそもそも `CaddieShiftGateway` を持たない現在のシグネチャで
  当然に）状態でも `execute()` が `Ok(ReservationId)` を返す」ことを
  1テストで確認する。`CreateReservationUseCase` は本タスクの変更後
  `CaddieShiftGateway` に依存しなくなるため、この Fake 群にキャディ供給
  用の Fake は含まれない点自体が「ガードが完全撤去された」ことの
  構造的な証拠にもなる。

  この追加は手間が大きいが（trait メソッド数の合計は約40）、
  `get_tee_sheet.rs` に確立された同一パターンの踏襲であり新しい
  テスト基盤を作るものではない。
- 検証コマンド:
  ```
  cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test
  ```
  （事前に `docker run --rm -d -p 4000:4000 pingcap/tidb:v8.5.7` で TiDB
  を起動。`cargo test` 自体はこのユースケースに関して DB 直叩きの
  結合テストを持たないが、他のドメイン/ユースケースのテストが
  TiDB 前提のため、リポジトリ標準コマンドとして実行する）。

### 2-3. 完了条件（backend）

- [ ] `refuse_a_round_the_course_cannot_walk` と、そこからしか呼ばれない
      `for_capacity_guard` が削除されている。
      `rg "for_capacity_guard|refuse_a_round_the_course_cannot_walk" src/`
      がゼロ件になることを確認する
      （**[レビュー反映]** clippy の dead_code は `pub(crate)` /
      非公開項目にしか効かないため、`pub` API については rg での
      参照ゼロ件確認を必須の確認手段とする — 2-1節参照）。
- [ ] `GetCourseCaddieSupplyUseCase::new` を削除した場合は、
      `rg "GetCourseCaddieSupplyUseCase::new\(" src/` が
      `get_course_caddie_supply.rs` 自身の定義以外にヒットしないことを
      確認している（削除しない場合はこのチェックは不要）。
- [ ] `has_room_for_one_more_caddie_round` と対応する3テストが削除されて
      いる。
- [ ] `.tachyon/manifests/tachyonfield-golf-auth.yml` の
      `field-extension:golf:reception` ポリシーに
      `field_extension_golf:ListShifts` の `allow` が追加されている。
- [ ] `CreateReservationUseCase::execute` の Fake gateway 回帰テスト
      （2-2節）が追加され、キャディ付き商品でも `create_reservation`
      （生成 gateway 呼び出し）まで到達することを確認している。
- [ ] `POST /v1/course/reservations` で、キャディ付きプランかつ当日の
      キャディ供給が0でも 400 を返さず予約が作成できる（上記の Fake
      gateway テストで自動検証される）。
- [ ] `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test` が通る。
- [ ] `CaddieShiftGateway` トレイト自体・`state.caddie_shifts()` は
      他ユースケースで使われ続けており、削除していない。

## 3. frontend パッケージ（React / desktop）

### 3-1. 変更対象ファイルと変更内容

#### 新規: `desktop/src/features/golf/caddieRoundCoverage.ts`

1-2節のエクスポート内容をそのまま新規作成する
（`UnassignedRounds.tsx:51-83` のロジックを移植し、ジェネリック化）。

#### 新規: `desktop/src/features/golf/caddieRoundCoverage.test.ts`

`unassignedRounds.test.ts` の `describe('unassignedCaddieRounds', ...)`
ブロック（24-64行目、6テスト）をここに移す。import 元を
`./caddieRoundCoverage` に変える。

#### `desktop/src/features/golf/UnassignedRounds.tsx`

- `holdsTheRound`（66-68行目）, `unassignedCaddieRounds`（70-83行目）,
  `roundIsStillOn`（86-88行目）のローカル定義を削除し、
  `import { holdsTheRound, roundIsStillOn, unassignedCaddieRounds } from './caddieRoundCoverage'`
  に置き換える。
- `assignmentsOnCancelledRounds`（102-112行目）はそのまま残す
  （画面固有: 消えた予約に残ったアサインを検出する処理）。
- `DayAssignment` / `TeeSheetRow` 型は画面のローカル定義のまま残してよい
  （`caddieRoundCoverage.ts` の `CoverageAssignment` /
  `CoverableRound` は構造的に互換な最小形なので、既存の広い型を
  そのまま渡せる）。

#### `desktop/src/features/golf/unassignedRounds.test.ts`

- `unassignedCaddieRounds` の import と `describe` ブロック
  （3-9行目の import 対象および24-64行目）を削除。
  残る `assignmentsOnCancelledRounds` / `wallClock` / `dayLabel` /
  `horizonEnd` のテストはそのまま。

#### `src/course/usecase` 相当 … 該当なし（backend パッケージ側）

#### `desktop/src/features/golf/ledger/ledgerLayout.ts`

1. 先頭の import に `caddieRoundCoverage.ts` から
   `unassignedCaddieRounds`, `type CoverageAssignment` を追加。
2. `caddieRoundsSoldOut`（292-297行目）を削除
   （撤去対象。`knowsCaddieCapacity` / `formatCaddieCapacity` /
   `formatCaddieShortfall` は SCC-28 の表示専用ロジックなので残す。
   この判定は「確定済みの日」ゲートには使わない — 1-3節参照）。
3. **[レビュー反映により変更]** 新規関数を3つ追加する
   （`ResourceStatus` 型と `resourceStatus`/`dayHasConfirmedShifts`/
   `unassignedCaddieReservationIds` — 1-3節に全文を記載済み）。
   置き場所: `knowsCaddieCapacity` の近く（同じ「キャディ関連の列/行判定」
   セクション）。

#### `desktop/src/features/golf/ledger/ledgerLayout.test.ts`

1. `caddieRoundsSoldOut` の import・`describe('caddieRoundsSoldOut', ...)`
   ブロック（386-419行目付近）を削除。
2. `resourceStatus` / `dayHasConfirmedShifts` / `unassignedCaddieReservationIds`
   の新規 `describe` を追加。最低限のケース:
   - `resourceStatus`: `{data: null, error: null, loading: true}` →
     `unknown`。`{data: null, error: new Error(...), loading: false}` →
     `failed`。`{data: {items: []}, error: null, loading: false}` →
     `loaded`（`error` があれば `data` の有無に関わらず `failed` を
     優先することも確認する）。
   - `dayHasConfirmedShifts`: `loaded` かつ `items.length > 0` →
     `true`。`loaded` かつ空配列 → `false`。`unknown` / `failed` →
     `false`。
   - `unassignedCaddieReservationIds`: 対象コースの caddie ラウンドで
     対応する（cancelled でない）assignment がない → id が含まれる。
     self プランの行 → 含まれない。assignment が cancelled → 含まれる
     （＝再び未割り当て扱い）。複数列（columns）にまたがるケースが
     正しく1つの Set に集約される。`assignments` が `unknown` /
     `failed` → 空集合を返す（＝取得できないときは何も未割り当てと
     判定しない）。
   （「確定済みの日だけ赤くする」ゲーティング自体は `dayHasConfirmedShifts`
   の責務であり、両者を掛け合わせた最終的な描画判定は `LedgerBoard`
   のコンポーネントテストで検証する — 3-2節参照。）

#### `desktop/src/features/golf/ledger/LedgerBoard.tsx`

**[レビュー反映により配線を訂正]** 当初案は「`caddieSupply` が既に
`SlotRows`/`GroupCell` まで渡っている」と誤って前提していた
（review #8b）。実際には `caddieSupply` は `LedgerColumnTable` の
ヘッダ表示（201-227行目）までにしか渡っておらず、`<SlotRows>` の呼び出し
（264-277行目）には含まれていない。今回追加する `shiftsConfirmed` /
`unassignedIds` は**新規の配線**として `LedgerColumnTable` → `SlotRows`
→ `GroupCell` まで明示的に props で通す（`caddieSupply` 自体はヘッダ表示
専用のまま変更しない — 1-3節の判定はもう `caddieSupply` を使わない）。

1. 3行目の React import に `useMemo` を追加:
   `import { Fragment, useMemo, type MouseEvent as ReactMouseEvent } from 'react'`
   （**[レビュー反映]** 現状 `useMemo` は import されていない —
   review #8a）。
2. import に `unassignedCaddieReservationIds`, `type ResourceStatus`
   (`./ledgerLayout`) を追加。（`dayHasConfirmedShifts`/`resourceStatus`
   は `LedgerPage.tsx` 側で解決済みの `shiftsConfirmed: boolean` を
   渡すだけなので、`LedgerBoard.tsx` 自身が呼ぶ必要はない。）
3. `LedgerBoard` 関数コンポーネントの props に
   ```ts
   /** その日にキャディシフトが1件でも確定しているか。unknown/failed の
    *  状態は呼び出し側で false に畳んでから渡す（1-3節）。 */
   shiftsConfirmed: boolean
   /** その日の配置。loaded のときだけ「未割り当て」を判定する。 */
   assignments: ResourceStatus<{ items: CoverageAssignment[] }>
   ```
   を追加する（`CoverageAssignment` は `../caddieRoundCoverage` から
   import）。
4. `LedgerBoard` 本体で
   ```ts
   const unassignedIds = useMemo(
     () => unassignedCaddieReservationIds(columns, assignments),
     [columns, assignments],
   )
   ```
   を計算し、`LedgerColumnTable` に `shiftsConfirmed` と `unassignedIds`
   を新規の prop として渡す。
5. `LedgerColumnTable` → `SlotRows` → `GroupCell` の props に
   `shiftsConfirmed: boolean` と `unassignedIds: Set<string>` を追加し、
   そのまま素通しする（`caddieSupply` の配線には触れない）。
6. `GroupCell`（468-492行目）で判定を追加:
   ```ts
   const isUnassignedCaddie =
     item.playType === 'caddie'
     && shiftsConfirmed
     && unassignedIds.has(item.id)
   ```
   `<td className="ledger-cell-group">` に
   `${isUnassignedCaddie ? ' is-unassigned-caddie' : ''}` を足し、
   `organizer` の下（または代わり）に
   ```tsx
   {isUnassignedCaddie ? (
     <small className="ledger-unassigned-badge">
       {t('ledger:cell.unassignedCaddie')}
     </small>
   ) : null}
   ```
   を追加する。

#### 新規: `desktop/src/features/golf/ledger/LedgerBoard.test.tsx`

**[レビュー反映により追加・必須]** review #3 を採用。ケースの内訳は
3-2節に記載。

#### `desktop/src/features/golf/ledger/LedgerPage.tsx`

**[レビュー反映により2系統のフェッチに変更]** 「配置」（assignments）と
「確定シフトの有無」（shifts）は別々の API・別々の意味論なので、
それぞれ独立した `useResource` にする。どちらも `?? []` / `?? false`
で握り潰さず、`resourceStatus()` でラップしてから渡す（1-3節）。

1. `caddie-course-supply` の取得（259-265行目）と同じパターンで、
   当日のキャディ配置とキャディシフトを取得する:
   ```ts
   const caddieAssignmentsResource = useResource(
     () => courseboardApiJson<ListResponse<{ reservationId?: string | null; status: string }>>(
       `${COURSE_API}/caddie-assignments?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`,
     ),
     [date],
     { cacheKey: `caddie-assignments:${date}` },
   )

   /** その日にシフトが1件でも確定しているか（日単位、コースを問わない
    *  ―― 1-3節）。行の中身自体は使わず存在確認だけに使う。 */
   const caddieShiftsResource = useResource(
     () => courseboardApiJson<ListResponse<unknown>>(
       `${COURSE_API}/caddie-shifts?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`,
     ),
     [date],
     { cacheKey: `caddie-shifts:${date}:${date}` },
   )
   ```
   （`ListResponse<T>` は76行目に既存定義があるのでそれを使う。）
2. `refreshAll`（267-275行目）に
   `caddieAssignmentsResource.refresh()` と
   `caddieShiftsResource.refresh()` を追加。
3. `<LedgerBoard>` への props（743行目付近）に
   ```tsx
   shiftsConfirmed={dayHasConfirmedShifts(resourceStatus(caddieShiftsResource))}
   assignments={resourceStatus(caddieAssignmentsResource)}
   ```
   を追加する（`dayHasConfirmedShifts`, `resourceStatus` は
   `./ledgerLayout` から import）。
4. 予約作成シート `<NewReservationEditor>` に渡している
   `caddieSupply={...}`（800行目付近）は 3-1 節の
   `NewReservationEditor.tsx` 変更に合わせて削除する
   （既存の `caddieSupplyResource` 自体・列ヘッダへの
   `caddieSupply={...}` prop（`<LedgerBoard>` への、743行目付近）は
   SCC-28 の表示専用なので変更しない）。
5. `caddieShiftsResource` が 403 になる場合（1-3節で修正する manifest
   変更が未反映のテナント、または reception 以外で `ListShifts` を
   持たない未知のロールを想定）は `resourceStatus` が `failed` を返し、
   `dayHasConfirmedShifts` が `false` になるため、未割り当てバッジが
   出ないだけで台帳自体はエラーにならない（1-3節のフェイルセーフ設計）。

#### `desktop/src/features/golf/ledger/NewReservationEditor.tsx`

1. import から `caddieRoundsSoldOut`（14行目）と
   `type CourseCaddieSupply`（10行目）を削除。
2. props から `caddieSupply`（53行目, 71行目）を削除。
3. `caddieSoldOut`（104行目）, `sellablePlans`
   （105-107行目でのフィルタ）を削除し、`coursePlans` をそのまま
   使う（`defaultPlanId` は `coursePlans[0]?.reservationServiceId ?? ''`
   に変える）。
4. `planSoldOut`（167行目）を削除し、`canSave`（168-175行目）から
   `&& !planSoldOut` を削除。
5. `<PlanPicker caddieSoldOut={caddieSoldOut} .../>`（316行目）から
   `caddieSoldOut` prop を削除。
6. `caddieSoldOut && sellablePlans.length === 0` の分岐
   （322-325行目、`<Notice>` ブロック）を削除。

#### `desktop/src/features/golf/ledger/PlanPicker.tsx`

1. props から `caddieSoldOut`（17行目, 32行目とその doc comment）を削除。
2. `soldOut`（41行目）のローカル計算を削除し、`disabled={soldOut}` /
   `is-sold-out` クラス付与 / 67-71行目の
   `<span className="ledger-plan-sold-out">` ブロックを削除。

#### `desktop/src/features/golf/ledger/NewReservationEditor.caddie-supply.test.tsx`

**削除する**（リライトではなく削除と判断）。

理由: このファイルの6テストは全て「`caddieSupply` によってキャディ
プランが選べなくなる／保存できなくなる」ことの検証であり、
`NewReservationEditor` から `caddieSupply` prop 自体を削除する
（3-1節）ため、テストの前提そのものが無くなる。書き換えて
「常に選択可能である」ことだけを確認する回帰テストにするより、
既存の `NewReservationEditor.test.tsx`
（無印、通常のプラン選択フローをカバーする既存ファイル）に
1テストだけ追加する方が筋が良い:
```ts
it('keeps the caddie plan selectable and saveable regardless of supply', () => {
  // caddieSupply prop はもう存在しない。plans にキャディプランを含めて
  // レンダーし、radio が disabled でないこと・Save が押せることだけを見る。
})
```
このテストは `NewReservationEditor.test.tsx` に追加する
（新規ファイルを増やさない）。

#### CSS: `desktop/src/styles.css`

1. `.ledger-plan-option.is-sold-out` とその2ルール
   （5534-5548行目、コメント含む）を削除。
2. `.ledger-plan-sold-out`（5550-5555行目）を削除。
3. 新規追加（`.ledger-cell-group.is-selected`
   （5347-5349行目）の直後が自然な位置）:
   ```css
   /* シフトが確定している日だけ点く。未確定日や配置の取得中・失敗時は
      点かない（LedgerBoard 側のゲーティング、1-3節）。
      .is-selected は box-shadow を使っているため、同じプロパティで
      重ねると宣言順で片方が消える（review #7）。outline なら
      box-shadow と独立して同時に見えるので、選択中の未割り当て行でも
      両方の状態が分かる。 */
   .ledger-cell-group.is-unassigned-caddie {
     outline: 2px solid hsl(var(--nui-destructive) / 65%);
     outline-offset: -2px;
   }

   .ledger-unassigned-badge {
     display: block;
     color: hsl(var(--nui-destructive));
     font-size: 10px;
     font-weight: 700;
   }
   ```
   **[レビュー反映により変更]** 当初案は `.is-unassigned-caddie` にも
   `box-shadow` を使っており、`.is-selected`（同じく `box-shadow`、
   5347-5349行目）と同時に付くと後に定義した方が勝って選択状態のリングが
   消えていた（review #7）。`outline` に変更することで、選択中かつ
   未割り当ての行でも両方のスタイルが同時に見える。
   `.ledger-plan-option:focus-within`（5563-5566行目）が既に同じ
   `outline` + `outline-offset: -2px` の手法を使っており、このコード
   ベースで前例のあるパターン。

#### i18n: `desktop/src/i18n/locales/{ja,ja-plain,en}/ledger.ts`

各ファイルで:
1. `newReservation.caddieSoldOut` / `caddieSoldOutTitle` /
   `caddieSoldOutBody`（ja: 170-173行目付近、en: 165-170行目付近、
   ja-plain: 161-164行目付近）を削除。
2. `cell` セクションに `unassignedCaddie` を追加。
   - ja: `unassignedCaddie: '未割り当て',`
   - ja-plain: `unassignedCaddie: '未割り当て',`
     （意味を変えない短いラベルであり、対象読者にも漢字4文字は既知語彙
     — `caddies:unassigned.title` 等で既に「未割り当て」表記が
     使われている）
   - en: `unassignedCaddie: 'Unassigned',`
3. 3ファイルとも変更後、`npm run test`（vitest）で
   `desktop/src/i18n/completeness.test.ts` を必ず通す
   （キー集合・プレースホルダ・空文字列・ja-plain 変換ルールの4観点を
   自動検証している）。

### 3-2. テスト計画

- 移動: `unassignedRounds.test.ts` の `unassignedCaddieRounds`
  ブロック → `caddieRoundCoverage.test.ts`（新規）。
- 追加: `ledgerLayout.test.ts` に `resourceStatus` /
  `dayHasConfirmedShifts` / `unassignedCaddieReservationIds` の
  describe ブロック（3-1節参照）。
- 削除: `ledgerLayout.test.ts` の `caddieRoundsSoldOut` ブロック。
- 削除: `NewReservationEditor.caddie-supply.test.tsx`
  （全体削除。理由は3-1節）。
- 追加: `NewReservationEditor.test.tsx` に1テスト
  （キャディプランが常に選択可能であることの回帰テスト）。
- **[レビュー反映により必須化]** 新規 `LedgerBoard.test.tsx` を追加する
  （review #3 を採用。当初「任意」としていたのを撤回する — 理由は
  下記）。

  撤回の理由: `ledgerLayout.test.ts` の純関数テストは
  「`unassignedCaddieReservationIds` 単体が正しいか」
  「`dayHasConfirmedShifts` 単体が正しいか」しか見ておらず、
  review #1・#2 で見つかった**2つの値を掛け合わせる場所**
  （`GroupCell` の `isUnassignedCaddie` 判定、3-1節）の誤りは
  この2つの単体テストでは検出できない。誤判定が実際に起きたのは
  まさにこの「掛け合わせ」の設計ミスだったので、掛け合わせ自体を
  コンポーネントレベルで検証しないと同種の不具合を再発させうる。

  最低限のケース（`LedgerBoard` に直接 props を渡してレンダーする
  形でよい。`LedgerPage` を経由した結合テストまでは要求しない）:
  1. 確定日（`shiftsConfirmed: true`）・配置なし → バッジが出る。
  2. 確定日・有効な（cancelled でない）配置あり → バッジが出ない。
  3. 未確定日（`shiftsConfirmed: false`）・配置なし → バッジが出ない
     （確定日でも配置なしなら出る #1 と対にして、日単位ゲートが
     効いていることを示す）。
  4. `assignments` が `{kind: 'unknown'}` → バッジが出ない
     （取得中を「配置なし」と誤判定しない）。
  5. `assignments` が `{kind: 'failed'}` → バッジが出ない
     （失敗時も同様）。
  6. 配置が cancelled → バッジが出る（＝未割り当て扱いに戻る）。
  7. `item.playType === 'self'` → `shiftsConfirmed` や配置の状態に
     関わらずバッジが出ない。
  8. 同じ予約が選択状態（`.is-selected` を付与する呼び出し方）かつ
     未割り当てのとき、`<td>` の class に `is-selected` と
     `is-unassigned-caddie` の両方が含まれる（review #7 の CSS 修正が
     機能面でも両立していることの確認。ピクセル単位の見た目検証までは
     求めない）。
- **[レビュー反映により追加]** `LedgerPage.loading.test.tsx` の
  `api.json.mockImplementation`（90-111行目）に `caddie-assignments`
  と `caddie-shifts` のモック応答を追加する:
  ```ts
  if (path.startsWith('/v1/course/caddie-assignments')) {
    expect(path).toContain('from=2026-07-20')
    expect(path).toContain('to=2026-07-20')
    return Promise.resolve({ items: [] })
  }
  if (path.startsWith('/v1/course/caddie-shifts')) {
    expect(path).toContain('from=2026-07-20')
    expect(path).toContain('to=2026-07-20')
    return Promise.resolve({ items: [] })
  }
  ```
  （review #6 を採用。ただし**技術的な前提は訂正する**: `useResource`
  は fetcher の例外を `try/catch` で `error` state に落とし込み
  （`useResource.ts:128-146`）、`LedgerPage.tsx` は `caddieSupplyResource`
  / `playerTagResource` の `.error` を読んでいない。実際、この既存
  テストは今も `player-tag-options` を一切モックしておらず未知パスとして
  例外を投げているが、それでも現行テストは失敗しない
  ―― `unexpected request` の throw は同期的に `loaderRef.current()`
  の呼び出し内で起きるため `await` の `try` に捕捉される。つまり
  「モックしないと壊れる」という指摘の**メカニズムの説明は不正確**
  だが、「明示的にモックし、`from=date&to=date` になっていることを
  アサートする」という**対応そのものは有用**なので採用する
  ―― カバレッジの空白を埋め、クエリ形状の回帰も検出できるため。）
- 検証コマンド:
  ```
  cd desktop && npm run type-check && npm run test
  ```

### 3-3. 完了条件（frontend）

- [ ] `caddieRoundCoverage.ts` が新設され、`UnassignedRounds.tsx` は
      そこから import している（ロジックの重複が無い）。
- [ ] `NewReservationEditor` / `PlanPicker` からキャディ供給に基づく
      選択不可・保存不可・警告表示が完全に消えている
      （`caddieSupply` prop・`caddieSoldOut` 系がどちらのファイルにも
      残っていない）。
- [ ] `ledger:newReservation.caddieSoldOut{,Title,Body}` が ja / ja-plain
      / en の3ロケールから削除され、`i18n/completeness.test.ts` が通る。
- [ ] **[レビュー反映により変更]** LedgerBoard で、その日にシフトが
      1件でも確定している（日単位、コース非依存 — `dayHasConfirmedShifts`）
      ときだけ、`caddie-assignments` に非cancelled の配置が無い caddie
      ラウンドが赤枠 + 「未割り当て」表示になる。未確定日は表示されない。
      配置 API が未着（`unknown`）または失敗（`failed`）のときは
      赤表示が出ない（「配置ゼロ」と誤判定しない）。
- [ ] `formatCaddieCapacity` / `formatCaddieShortfall` /
      `knowsCaddieCapacity`（列ヘッダの `キャディ 8/12・あと N 組`
      表示、SCC-28）は変更されていない。**この関数は上記の未割り当て
      ゲートには使われていない**（1-3節で完全に切り離した）。
- [ ] **[レビュー反映により追加]** `LedgerBoard.test.tsx`
      （3-2節、8ケース）が追加され、通っている。
- [ ] **[レビュー反映により追加]** `LedgerPage.loading.test.tsx` に
      `caddie-assignments` / `caddie-shifts` のモックとクエリ形状の
      アサーションが追加され、通っている。
- [ ] `cd desktop && npm run type-check && npm run test` が通る。

## 4. パッケージ間の依存関係

**[レビュー反映により全面的に書き直し]** review #4 のとおり、
「PR・ビルドは独立、機能として揃うのは依存あり」を分けて書く。

- **コンパイル/ビルド上の依存は無い。** backend と frontend は互いの
  コードを直接参照しないため、どちらの PR を先に作成・レビュー・
  マージしてもビルドは通る。
- **ただし frontend パッケージは backend パッケージのマニフェスト変更
  （2-1節、`.tachyon/manifests/tachyonfield-golf-auth.yml` への
  `ListShifts` 追加）が本番反映されていることに機能上依存する。** この
  変更が無いまま frontend だけを出すと、受付担当には `caddie-shifts` が
  403になり続け、未割り当て表示が主要利用者に対して一度も出ない
  （表示が出ないだけで壊れはしないが、この機能自体が意味を失う）。
- **機能としての互換性は「どちらを先に出すか」で非対称**（review #4）:
  - **backend 先行・frontend 未反映**: 旧 UI がキャディプランの
    選択・保存を引き続き止める。ユーザー体験は変わらない（従来どおり
    保守的）ままなので、実害は無い。
  - **frontend 先行・backend 未反映**: 新 UI はキャディプランの選択・
    保存を止めなくなるが、旧 backend はまだ 400 を返す。デスクが
    フォームを最後まで埋めてから保存に失敗する、以前より悪い体験に
    なる。
  - 上記の非対称性から、**展開順は backend → frontend を推奨する**
    （同一リリースに含めて同時に出す場合はこの限りではない）。
    frontend 単独で先行展開する場合はこの非互換をリスクとして
    関係者に共有すること。
- 2パッケージとも、それぞれの完了条件（2-3節・3-3節）を満たせば
  レビュー・マージには出せる（コードレベルではブロックしない）。
  実際の本番反映順序だけ上記に従う。

## 5. その他の作業（どちらのパッケージが担当してもよい）

### `docs/src/tasks/in-progress/caddie-course-shifts/task.md` の更新

Phase 4「予約枠への接続」（75-78行目）に、本タスクで方針転換した旨を
追記する:

```markdown
### 4. 予約枠への接続

> **[SCC-27 により方針転換]** コース別供給を予約の販売上限として
> ガードする方式は撤去した。現場運用はシフト状況に関係なく予約を
> 受け付け、キャディの割り当ては後から調整する運用に変更している
> （SCC-27）。以下は撤去前の設計として記録のみ残す。

- コース別供給をキャディ付き商品の販売上限として予約時にガードする。...
```

その上で、Phase 1〜3（確定シフトの保存・生成、コース別過不足、配車の
連動）が実装済みかどうかを確認し、済んでいれば
`docs/src/tasks/completed/` への移動を検討する
（本書は移動の要否までは判定しない — 実装エージェントか人間が
Phase 1〜3 の実装状況を別途確認して判断すること）。

このファイルは backend・frontend どちらのパッケージにも属さない
ドキュメントのみの変更なので、どちらか先に着手した側が行ってよい。
コードの変更を待つ必要はない。

## 6. 検証（両パッケージ共通、再掲）

```bash
cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test
# 事前に: docker run --rm -d -p 4000:4000 pingcap/tidb:v8.5.7

cd desktop && npm run type-check && npm run test
```

コミットは日本語の Conventional Commits。UI の fetch は
`desktop/src/api.ts` 経由のみ（ADR-0004、本タスクで新規に追加する
`courseboardApiJson` 呼び出しもこれに従う）。

## 7. レビュー対応記録（review-sol-1.md, レビュアー: Codex GPT-5.6 Sol）

骨格（ガード完全撤去・配置基準による可視化・確定日のみ赤表示・
赤枠+未割り当てテキスト）は変更していない。8件すべて実コードで裏を
取った上で対応した。

| # | 重要度 | 指摘 | 対応 |
|---|---|---|---|
| 1 | 重大 | `knowsCaddieCapacity` は確定判定に使えない。判定単位も日単位に戻す。受付ポリシーに ListShifts/ListCaddieInsights が無い | **対応済み。** `course_supply.rs:96-143` を再読し、`caddieAttachedGroups` がシフト確定と無関係に予約数だけを数えていることを確認 — 指摘は事実。1-3節を全面差し替え: `GET /v1/course/caddie-shifts?from=date&to=date`（既存エンドポイント、日単位・コース非依存）で確定シフトの有無を明示的に取得する方式に変更。`.tachyon/manifests/tachyonfield-golf-auth.yml` の `field-extension:golf:reception` に `field_extension_golf:ListShifts` の `allow` を1行追加（2-1節）。`ListCaddieInsights` は不要と判断し追加しない。`course_authz.rs` はルート分類済みのため無変更。manifest 整合性テスト（`actions.rs:200-218`）への影響が無いことも確認済み |
| 2 | 重大 | 配置 API の未取得・失敗を「配置ゼロ」と誤判定する | **対応済み。** `useResource.ts:70-79` を確認し `data`/`error` が区別されていることを確認。`ResourceStatus<T>`（unknown/failed/loaded）型と `resourceStatus()` を新設し、`unassignedCaddieReservationIds` は `loaded` のときだけ判定、それ以外は空集合（＝赤表示なし）を返すよう変更（1-3節）。同じ考え方を確定シフト側（`dayHasConfirmedShifts`）にも適用し、2つのデータソースを対称に扱っている |
| 3 | 高 | 確定ゲートのテストが未検証。LedgerBoard を任意テスト扱いにしていた | **対応済み。** 当初「任意」としていた判断を撤回し、新規 `LedgerBoard.test.tsx` を必須項目にした（3-1節・3-2節・3-3節）。指摘の8ケースをベースに、実際の設計（`shiftsConfirmed` 真偽値 + `ResourceStatus` 三態 + `unassignedIds`）に合わせて8ケースを再構成した |
| 4 | 高 | 「どちらを先にマージしても壊れない」は機能上誤り | **対応済み。** 4節を全面書き直し。「ビルド上の依存は無い／機能としての反映順には依存がある」ことを明記し、backend→frontend を推奨する非対称性（frontend 先行時は保存が土壇場で失敗する退行がある）を具体的に記述した |
| 5 | 中 | backend の主要な受け入れ条件が自動テストされない | **対応済み。** `create_reservation.rs` に `CreateReservationUseCase::execute` の Fake gateway 回帰テストを追加する計画を2-2節に追加（必須）。`get_tee_sheet.rs:245-339` の既存 Fake パターンを踏襲する方針とし、必要な5つの Gateway・メソッドを具体的に列挙した |
| 6 | 中 | 新規 API 呼び出しで既存 `LedgerPage.loading.test.tsx` が失敗する | **一部不採用（メカニズムの説明のみ）、対応そのものは採用。** `useResource.ts:128-146` を確認したところ、fetcher の例外は `try/catch` で `error` state に落ちており、`LedgerPage.tsx` はどの箇所でも `caddieSupplyResource.error` / `playerTagResource.error` を読んでいない。現に既存テストは `player-tag-options` を一度もモックしていないが、それでも落ちていない（`unexpected request` の throw は `await` の `try` に捕捉されるため）。**したがって「モックしないとテストが失敗する」という技術的な説明は不正確と判断した。** ただし「明示的にモックし `from=date&to=date` をアサートする」という対応自体はカバレッジ向上として有用なので、3-2節にそのまま採用した |
| 7 | 中 | 赤枠が選択状態の box-shadow を上書きする | **対応済み。** `.ledger-cell-group.is-selected`（`styles.css:5347-5349`）と同じ `box-shadow` プロパティを使っていたのを `outline` + `outline-offset: -2px` に変更し、両状態が独立して同時に見えるようにした（3-1節 CSS）。前例として `.ledger-plan-option:focus-within`（`styles.css:5563-5566`）が同じ手法を既に使っていることを確認した。`LedgerBoard.test.tsx` のケース8（選択中かつ未割り当ての行で両方のクラスが付くこと）で機能面の併存を検証する |
| 8 | 軽微 | useMemo の import 漏れ／`caddieSupply` が実際は `SlotRows`/`GroupCell` まで届いていない／`GetCourseCaddieSupplyUseCase::new` は clippy で必ず検出されるとは限らない | **すべて対応済み。** (a) `LedgerBoard.tsx:3` の React import に `useMemo` を追加する手順を明記。(b) `caddieSupply` が現状 `LedgerColumnTable` のヘッダまでしか渡っていないことを実コードで確認し、「既に同じ経路」という誤った記述を削除。新設する `shiftsConfirmed`/`unassignedIds` は `caddieSupply` とは独立の新規配線として `LedgerColumnTable`→`SlotRows`→`GroupCell` まで明示的に通す設計に修正。(c) 本 crate が `src/lib.rs` を持つライブラリ構成であるため `pub fn` は dead_code 検出対象外であることを確認し、「clippy が保証する」という記述を「`rg` でゼロ件確認する」に差し替え、2-3節の完了条件にも追加した |

不採用（骨格変更）: なし。骨格そのものへの異議は無かった
（レビュー冒頭にも明記されている）。
