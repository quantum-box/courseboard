# PLT-3339 日次サマリを必要キャディ数と割当に接続する

## Links

- Linear: `PLT-3339`
- [設計](./design.md)
- [ADR-0006](../../../architecture/decisions/ADR-0006-aggregate-caddie-demand-without-dummy-reservations.md)
- 関連: `PLT-3248`（取り込み）、`PLT-3249`（再取り込み）、
  `PLT-2294`（自動配置）、`PLT-2296`（3コース間の貸借）、
  `PLT-2827`（シフト表）、`PLT-1687`（当日配車ボード）、
  `PLT-3362`（取り消し予約に残る配置）、`PLT-3262` / `PLT-3263`（現場確認）、
  `PLT-3341`（デモ台本）

## 目的

ICグリーンの日別予約状況から得られる
「日 × コース × 午前/午後 × キャディ付き組数」を、予約明細を捏造せず、
CourseBoard の必要人数算出、月間割り振り、過不足表示へ接続する設計を決める。

この文書は調査と設計だけを扱う。実装、migration、データ変更、
tenant へのアクセスは行わない。設計だけを docs-only PR としてレビュー可能にする。

## 調査基準

2026-08-10 に fresh な remote ref を取得し、作業中の共有 working tree ではなく
次の commit を基準にコードを読んだ。

| repository | ref | commit |
| --- | --- | --- |
| CourseBoard | `origin/main` | `dc3154f0b716d5d19e65390951c6020d635b677d` |
| Field | `origin/main` | `b54403675bec197f2865454cb2ecf630b28db09b` |

CourseBoard は fresh な `origin/main` から専用 worktree
`/home/takanori/courseboard.plt3339` と branch
`feature/plt-3339-daily-summary` を作成した。共有の
`/home/takanori/courseboard` と `/home/takanori/tachyonfield` は branch を
切り替えず、Field は `git show origin/main:<path>` / `git grep origin/main` で
読んだ。

## 前提確認

- CourseBoard の fresh な `origin/main` には、日別予約状況 xlsx の取り込み、
  日次サマリの保存、サマリからの必要人数算出は存在しない。
- remote branch `origin/claude/reservation-csv-import-8kiqop` には、
  `0779fe2ac3018e0ca5b9c9bae4ac889df12aa3de` という未マージ commit がある。
  commit 名は CSV ではなく「日別予約状況」の xlsx 取り込みであり、
  `golf_reservation_day_summaries` と
  `ReservationDaySummary` を実装している。この commit は
  `origin/main` の ancestor ではなく、2026-08-10 時点で branch は main から
  diverge している。したがって現行機能には数えないが、PLT-3248 の実装開始時に
  重複作業と契約衝突を確認する必要がある。
- 未マージ案も `全体(81H)` と `合計` を取り込まず、真駒内・滝の・羊ケ丘の
  午前/午後だけを集約行として持つ方針である。これは二重計上を防ぐ上で
  PLT-3339 と整合する。ただし未マージ案には割当への接続はない。

## 実測した既存モデル

### CourseBoard

- `CaddieAssignment` は「予約 / ラウンドにキャディを付けた事実」である。
  `reservation_id` は型上 optional だが、`scheduled_at` は必須で、標準占有時間は
  270分である。
- 自動配置 `AutoAssignCaddiesUseCase` は tee sheet の
  `requires_caddie` 予約を列挙し、`reservation_id`、開始時刻、所要時間、人数、
  コースを持つ `PlannableRound` を入力にする。結果も `reservation_id` 単位で、
  primary の `CaddieAssignment` を1件書く。
- `plan_caddie_assignments` は開始時刻順に処理し、所要時間との重なり、
  個人の `max_rounds_per_day`、午前/午後の休み希望、配置コースを判定する。
  rookie と veteran の組合せは推薦理由だけであり、2人目を自動配置しない。
- `CaddieShift` は「キャディ × 日」の確定勤務で、配置コースは1つ、
  `span` は終日/午前/午後、`rounds_capacity` は0〜2、由来は
  generated/edited/pinned である。これは予約割当ではなく勤務・供給の事実である。
- 月間シフト生成は roster、休み希望、メイン所属、勤務ルールを入力にする。
  予約数や必要キャディ数は入力にせず、需要に合わせた割り振りではない。
- 現行の CourseBoard 自動配置は確定シフトについて `is_working` と
  配置コースだけを見る。確定シフトの `span` と `rounds_capacity`、
  日別の `two_round_request` を planner の上限に渡さず、profile の
  `max_rounds_per_day` を使う。このため現行シフト表で「1枠」と確定した人へ、
  時刻が重ならなければ2組目を付け得る。集約需要へ接続する前に解消すべき
  既存ギャップである。
- `compute_course_supply` の domain 境界は、コース別需要をすでに
  `HashMap<CourseId, i64>` として受ける。一方 usecase はその map を
  tee sheet のキャディ付き予約件数から作り、午前/午後の内訳は持たない。

### Field

- `golf_caddie_assignments` はキャディ、optional な reservation、
  `scheduled_at`、role、status、fee を持つ。コメントも
  “Caddie assignments to golf reservation rounds” である。
- 汎用 `staff_assignments` は別の保存モデルではなく、
  `golf_caddie_assignments` の view である。粒度は変わらない。
- primary は1予約につき1人までである。assistant / trainee role は存在するが、
  現行の自動配置は primary を1人だけ作る。
- 時間重複検査は assignment と実予約を join して予約の開始・終了を読む。
  reservation を持たない assignment には同じ検査を適用できない。
- Field にも legacy 自動配置は残るが、実予約を日付で列挙して
  `reservation_id` 単位で返す。Field 側 ADR と CourseBoard の ADR-0005 は、
  自動配置・需給というゴルフ計算を CourseBoard の責務としている。

## シフト表と配車ボードの参照先

### シフト表（PLT-2827）

`desktop/src/features/golf/ShiftBoardPage.tsx` は表示月の前後を含めて、
次を別々に取得する。

- `/caddie-profiles`
- `/caddie-availabilities?from=...&to=...`
- `/caddie-assignments?from=...&to=...`
- `/caddie-shifts?from=...&to=...`
- course、締切、shift rules

`buildShiftRow` は1行を1キャディ、1セルを1日として作る。非 cancelled の
assignment を `caddieProfileId × scheduledAt の日` で数え、1件でもあれば
availability / confirmed shift より `assigned` 表示を優先する。
確定シフトは勤務、時間帯、コースの表示には使うが、必要数は読まない。

案 A を需要テーブルだけ追加して終えると、必要数が存在しても
シフト表の assignment 件数は0のままである。案 A の個人別割り振りを表示するには、
集約割当を共通 read model へ投影する必要がある。

### 当日キャディ配車ボード（PLT-1687）

`desktop/src/features/golf/CaddiesPage.tsx` の dispatch view は次を読む。

- 月範囲の `/caddie-assignments`
- 選択日から1/7/14日範囲の `/tee-sheet`
- `/caddie-attendance-snapshot`
- 支援欄の `/caddie-supply` と `/caddie-course-supply`

未割当ラウンドは「tee sheet の caddie play type の予約」から、
standing assignment の `reservation_id` が一致するものを引いて作る。
手動指名、自動配置、確定済み一覧、取り消された予約に残る orphan 警告も
reservation ID と実時刻を前提にする。

案 A を需要テーブルだけ追加して終えると、未割当一覧、自動配置結果、
確定済み一覧には何も出ない。`caddie-course-supply` は demand map の供給元を
差し替えやすいが、現行の1日合計だけでは午前不足・午後余剰を相殺してしまう。

案 B は既存画面へ機械的には現れる。しかし、存在しない予約名、予約番号、
開始時刻、所要時間が表示・重複判定・orphan 判定を動かすため、
「既存資産を使える」と同時に「偽の明細が業務判断を変える」ことになる。

## 既存設定の所在

| 前提 | 現在あるもの | 足りないもの |
| --- | --- | --- |
| 1組に何人 | 1予約に primary 1人の制約。role は assistant / trainee も持てる。現行 planner は1人だけ選ぶ | SCC の運用が常に1組1人であるという設定・確認。例外組の表現 |
| 1人の1日上限 | profile の `max_rounds_per_day` と `can_two_rounds`、tenant の shift rule `max_rounds_per_day`（既定2、最大2） | どの値を集約計画の hard limit とするかの統一 |
| 当日の2ラウンド | availability の `two_round_request`、確定 shift の `rounds_capacity` | ICグリーンの午前→午後を誰に認めるか、未提出時の扱い |
| 午前/午後 | availability と確定 shift の span。予約 planner は tenant local 12:00 を境界にする | xlsx の「午前/午後」が12:00境界と同じか、4.5〜5時間後に確実に再稼働できる条件 |
| コース間移動 | membership と、PLT-2296 の日単位の shift 配置コース変更 | 午前と午後で別コースへ移れるか、移動時間、許可される組合せ |

したがって「2ラウンド上限を表す材料」はすでにあるが、
「午前の需要を担当した人を午後需要へ何人再利用してよいか」という
クラブ運用ルールは存在しない。sandbox の設定値を見ても SCC の運用は決められないため、
live tenant の読み取りは実施しなかった。

## 設計判断

2026-08-10 の requester review で案 A の採用とダミー予約の禁止が承認された。
詳細と算出式は [設計](./design.md)、
長期的な境界は [ADR-0006](../../../architecture/decisions/ADR-0006-aggregate-caddie-demand-without-dummy-reservations.md)
に記載する。

案 A でも既存画面の参照先を二系統のまま露出させない。実予約由来と
日次サマリ由来は write model を分け、画面と CSV は source kind を保った
共通 projection を読む。planner 内では集約数を一時的な work item へ展開できるが、
それを Field の reservation として保存しない。

同じ review で次も承認された。

- policy が未設定なら `unknown` とし、0、空欄、仮の既定値へ倒さない。
- 再取り込みでは generated だけを再計算し、edited / pinned は要確認として残す。
- CSV は `unknown` / `stale` があっても出力可能にする。ただし出力前に各件数を
  表示し、ファイル各行にも状態を入れる。この2条件を満たせない実装は出力を拒否する。
- デモ第一段階は月の必要数と過不足までとし、個人名の割り振りは作らない。
  個人割当は `PLT-3341` の CEO 判断にも関係し得る後続拡張とするが、
  aggregate demand / coverage の安定した識別子へ後から接続できるようにする。

ダミー予約を禁止する判断には `PLT-3362` の既存障害も関係する。Field で消えた予約を
CourseBoard が知れず、その予約を指す staff assignment が担当上限や月次給与へ
残り続ける経路がすでにある。実在しない予約を生成すると、同じ orphan 問題を
自分たちで増やすためである。

## 実装フェーズ案（今回は未実施）

1. PLT-3248 の aggregate summary contract を確定し、未マージ branch と
   fresh main の差分を整理する。
2. 現場回答を tenant の計算 policy として設定し、未設定を表現できるようにする。
3. pure domain service で必要人数と必要な2ラウンド数を算出する。
4. デモ第一段階として、月の aggregate capacity と必要数から coverage projection を作る。
5. シフト表、配車ボード、コース貸借、CSV を同じ coverage projection へ接続する。
6. `PLT-3249` の再取り込みで generated のみ再計算し、手動/固定の超過を警告する。
7. 後続で個人 allocation を bucket へ接続する。実 reservation は作らない。

## 検証計画

- domain test: 午前56、午後15、再稼働15なら必要56人。再稼働10なら61人。
- domain test: 午前/午後の片方だけ、0件、複数コース、1組あたり人数。
- domain test: 同日合計は足りても午前または午後が足りなければ shortage。
- domain test: policy 未設定なら required count と色を返さず unknown。
- planner test: `span`、`rounds_capacity`、`two_round_request`、個人上限、
  tenant 上限をすべて満たす人だけ午前→午後へ継続する。
- projection test: 実予約 assignment と aggregate allocation が混同されず、
  シフト表と配車ボードで同じ coverage を示す。
- re-import test: generated は再計算、edited / pinned は保持して要確認になる。
- UI test: shortage / balanced / surplus / unknown / stale の色と説明が一致する。
- CSV test: unknown / stale 件数を出力前に表示し、全行に status が入る。

## 取れなかったもの・確認しなかったもの

- SCC 実顧客 tenant `tn_01kxt866zs9vj2p8ks33sfh2eh` には読み書きとも
  アクセスしていない。
- demo tenant と Field Golf Sandbox にもアクセスしていない。コード上のモデルと
  設定の所在は確認できたが、sandbox の値は SCC の運用前提を証明しないためである。
- xlsx バイナリ自体は開いていない。入力レイアウトは issue 提示内容と、
  未マージ branch の parser/taskdoc との一致までを確認した。
- Linear は参照していない。関連 issue の Done や運用回答は、ユーザーから提示された
  内容以外は確認していない。
- 1組1キャディ、午前→午後の対象者、コース間移動の可否はコードから確定できない。
  推測で既定値を置いていない。

## Docs-only PR の検証

- 完了直前に `origin/main` を再取得し、調査・branch 作成時と同じ
  `dc3154f0b716d5d19e65390951c6020d635b677d` であることを確認した。
- 変更対象が `docs/` だけで、code、migration、version、lockfile の変更が0件であることを
  `git status --short` から確認した。
- `git diff --check`、変更文書の末尾空白検査、Markdown 相対リンクの実在検査を通した。
- build、unit test、browser test は、実行対象となる code / UI の変更がないため
  ローカルでは実施しない。PR の GitHub Actions は green まで確認する。

## 完了条件

- [x] CourseBoard / Field の fresh `origin/main` で割当粒度を実測した。
- [x] PLT-2827 / PLT-1687 の実参照先と案 A/B の影響を実測した。
- [x] 必要人数算出に必要な既存設定と不足前提を切り分けた。
- [x] 案 A/B を比較し、案 A の設計提案を作成した。
- [x] 午前→午後を単純加算しない算出・coverage・色分けの境界を設計した。
- [x] requester 判断と現場確認を分けた。
- [x] requester が案 A、fail-loud 表示、再取り込み、CSV、デモ範囲を承認した。
- [ ] `PLT-3262` / `PLT-3263` で現場が1組あたり人数と午前→午後の運用条件を回答する。
- [ ] `PLT-3341` の CEO 判断とデモ台本の境界を確認する。
- [ ] 現場回答後、別の implementation phase を開始する。
