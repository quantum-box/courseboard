# 日次サマリから必要キャディ数と月間過不足を作る設計

## Status

Approved (2026-08-10). 現場運用値は `PLT-3262` / `PLT-3263` の確認待ち。
実装は含まない。

## 目的

ICグリーンの日別サマリを取り込んだ後、次のデモ導線へ渡せる
CourseBoard の domain contract を定める。

1. 予約表を入れる
2. 月の必要数を算出する
3. 在籍・シフトの供給力と「ガッチャンコ」して1か月分の過不足を作る
4. 足りない日と多い日を色で判別する
5. CSV で出す

第一段階では個人名を割り振らない。日次サマリには誰をどの組へ付けるかの根拠がなく、
デモの価値も月の必要人数と過不足を一目で把握できることにあるためである。
個人 allocation は `PLT-3341` の CEO 判断にも関係し得る後続範囲とし、
本設計の bucket / coverage identity へ追加できるようにする。

PLT-3248 が担当する xlsx の読取り自体は対象外である。本設計は
「取り込まれた `日 × コース × 午前/午後 × キャディ付き組数` を何へ変換するか」
だけを扱う。

## 制約

- source に予約 ID、開始時刻、終了時刻、予約ごとのキャディ有無はない。
- `全体(81H)` は3コースの合計、`合計` は午前と午後の合計である。
  いずれも計画入力に加えると二重計上になるため検算専用とする。
- 午前と午後は時間帯ラベルであって、個々のスタート時刻を復元できない。
- 実予約由来の tenant では、既存の予約単位 assignment を維持する。
- ゴルフの需要算出と配置ルールは ADR-0005 に従って CourseBoard が所有する。

## Option

### 案 A: 集約需要と集約割当を持つ

`日 × コース × 時間帯` の需要を正本とし、個人への割り振りも予約 ID ではなく
需要 bucket に紐付ける。

利点:

- source が述べている以上の明細を作らず、数字の由来を説明できる。
- 再取り込みは同じ bucket の置換と再計算にできる。
- 月単位の必要数、過不足、CSV というデモの主目的と粒度が合う。
- PLT-2296 のコース別需給へ、コース×時間帯の demand として渡せる。

コスト:

- 予約単位の assignment とは write model が分かれる。
- シフト表と配車ボードを共通 projection へ接続する改修が必要になる。
- PLT-2294 の planner を予約 ID / 実時刻から抽象化するか、集約用 planner を
  同じ policy component 上に作る必要がある。

### 案 B: ダミー予約を N 件作る

集約数を実在しない reservation に展開し、現行の予約単位 assignment へ渡す。

利点:

- tee sheet、未割当一覧、手動指名、自動配置、assignment table の形を再利用できる。
- Field の保存 API をそのまま使える。

失うもの・新たに作る問題:

- source にない予約 ID、顧客、開始時刻、終了時刻、人数、状態を決める必要がある。
- 現行 planner は開始時刻と270分の占有を使うため、架空時刻が
  「午前担当が午後も可能か」を決めてしまう。
- Field の重複検査、1予約1 primary、キャンセル連動、orphan 警告、給与、評価、
  顧客台帳、予約一覧へ合成予約が漏れる。
- 再取り込みで必要数が減ると、ダミー予約と assignment のどちらを先に消すか、
  手動変更済みのものをどう守るかが必要になる。
- UI は成功して見えても、予約詳細を開くと存在しない業務事実を表示する。

### 判断

案 A を採用する。案 B の「既存資産が効く」は UI と API の形が合うという意味に
限られ、計画結果の正しさは保証しない。特に開始時刻を持たない source に対して
架空時刻で重複判定を通すことは、午前→午後の再稼働を誤る直接原因になる。

さらに `PLT-3362` では、Field で取り消された予約を CourseBoard が知れず、
消えた予約を指す staff assignment が担当上限や月次給与集計へ残る問題が
すでに確認されている。ダミー予約は、同種の orphan と誤集計を自分たちで
新たに作ることになる。

ただし案 A でも planner 内部では、count を
`PlanningWorkItem { date, course, band, ordinal }` に一時展開してよい。
これは計算中の識別子であり、Field reservation や利用者向け予約 ID として
永続化しない。この実装上の adapter は案 B ではなく案 A の内部表現である。

## Domain model

### 1. Imported fact

PLT-3248 から受け取る最小の事実は次である。

```text
CaddieDemandBucket
  business_date
  golf_course_id
  time_band: morning | afternoon
  caddie_attached_groups
  source_import_id / source_version
```

`source_import_id / source_version` は PLT-3249 と allocation の stale 判定に使う。
未マージの PLT-3248 案は `source_file` と `updated_at` を持つが、計画がどの版を
入力にしたかを機械的に判別できる contract はまだ確定していない。

### 2. Calculation policy

```text
CaddieRequirementPolicy
  caddies_per_group
  continuation_rule
  continuation_scope
```

- `caddies_per_group`: 全組で一様な正整数。現場が1組1人と確認するまでは未設定。
  組ごとに例外がある場合、現行 xlsx だけでは必要人数を復元できないため、
  別の入力が必要になる。
- `continuation_rule`: 午前担当が午後を担当できる条件。未設定を値として持つ。
- `continuation_scope`: 同一コースだけか、コース間移動を許すか。
  コース間を許すなら移動可能な組合せと turnaround 条件が必要になる。

未設定を `1` や「全員2ラウンド可能」へ黙って default しない。

### 3. Requirement result

```text
DailyCaddieRequirement
  business_date
  per_course[]
    morning_round_slots
    afternoon_round_slots
    reusable_second_round_slots
    minimum_unique_caddies
  club_minimum_unique_caddies
  calculation_status: calculated | unconfigured
  policy_version
  source_version
```

人数だけでなく、午前何枠、午後何枠、何人に2ラウンド目を依頼する計画かを返す。
同じ「56人必要」でも「56人が1組ずつ」と「15人が2組担当」では供給条件が違うためである。

### 4. Coverage と後続の個人 allocation

```text
DailyCaddieCoverage
  requirement
  available_morning_capacity
  available_afternoon_capacity
  reusable_second_round_capacity
  uncovered_morning
  uncovered_afternoon
  surplus_capacity
  status: shortage | balanced | surplus | unknown | stale
```

デモ第一段階は `DailyCaddieCoverage` までを作り、個人名を保存・表示しない。
供給力の算出時には shift / availability / profile を個人単位で検査できるが、
外部 contract は時間帯別の capacity と過不足を返す。

後続の個人割当は次を追加する。

```text
CaddieDemandAllocation
  caddie_id
  demand_bucket_id
  business_date
  golf_course_id
  time_band
  origin: generated | edited | pinned
  source_version
  policy_version
```

同じ人を午前と午後の2 allocation に出すことで再稼働を表せる。
安定した `demand_bucket_id` と source / policy version を第一段階から保つため、
coverage を作り直さず個人 allocation を後から重ねられる。実予約の
`CaddieAssignment` と write model は分けるが、画面と CSV は
`source_kind = reservation | daily_summary` を保った共通 projection を読む。

## 必要人数の算出

### Demand-only calculation

1組1人が現場確認された場合、コース `c` の必要 round slots を次で置く。

```text
M_c = morning_caddie_groups × caddies_per_group
P_c = afternoon_caddie_groups × caddies_per_group
R_c = min(M_c, P_c, continuation_policy_limit_c)
U_c = M_c + P_c - R_c
```

- `R_c`: 午前担当が午後も担当する人数。
- `U_c`: そのコースで理論上最低限必要なユニーク人数。
- コース間移動を認めない場合、1日の必要人数は `sum(U_c)`。
- コース間移動を認める場合は course pair と移動制約を含む matching が必要で、
  単純な club 合計の `max(sum(M), sum(P))` にはしない。

例: 全体の午前56組、午後15組、1組1人、15人が継続可能なら、
`56 + 15 - 15 = 56人`。継続可能が10人なら61人、0人なら71人である。

`max(午前, 午後)` は「少ない側の全員が条件を満たして再稼働できる」場合だけの
短縮形であり、無条件には使わない。

### Roster-aware coverage

過不足の色は理論値だけでなく、実際に割り当て可能かで決める。
2ラウンド目の候補は少なくとも次をすべて満たす必要がある。

- active / assignable
- 確定 shift が勤務で、span が午前と午後を覆う
- 確定 shift の `rounds_capacity >= 2`
- profile の `can_two_rounds` と `max_rounds_per_day >= 2`
- 当日の `two_round_request`
- tenant の shift rule が2を許す
- 午前と午後の course が continuation scope を満たす
- 後続の個人割当では pinned / edited allocation と衝突しない

現行 CourseBoard planner はこのうち確定 shift の span / capacity と
day request を完全には使っていないため、そのまま再利用しない。
第一段階では ranking や個人 allocation は実行しない。ただし capacity の数え方と
後続 planner の eligibility が食い違わないよう、eligibility は共通 policy component に
切り出す。

集約 planner は実時刻を発明せず、morning と afternoon を順序のある2 band として扱う。
現場が「午前の終了条件次第で午後へ間に合わない」と回答した場合、xlsx だけでは
個別判定できない。安全な集約 policy（再稼働可能数の上限など）を別途入力するか、
その日の結果を unknown にする。

## 色分けの contract

日合計だけが合っていても、午前が不足し午後が余る日は shortage である。
表示は `DailyCaddieCoverage.status` だけを色へ写像し、画面ごとに再計算しない。

| status | 意味 | 表示 |
| --- | --- | --- |
| `shortage` | 午前または午後に未充足がある | 不足色。コース・時間帯・不足人数を表示 |
| `balanced` | 全 bucket を充足し、余剰がない | 充足色 |
| `surplus` | 全 bucket を充足し、利用可能な余剰 capacity がある | 余剰色と余剰人数/枠 |
| `unknown` | 1組あたり人数または continuation policy が未設定 | 中立色。「運用条件を確認」と表示 |
| `stale` | 再取り込みまたは policy 変更後に coverage / allocation が未再計算 | 警告色。旧結果を green にしない |

policy 未設定時に午前+午後を71人として赤くすることも、max を56人として緑にすることも
禁止する。`unknown` を0、空欄、通常の「データなし」へ変換することも禁止する。
いずれも根拠のない断定または見落としを作るためである。

## 既存画面との接続

### シフト表（PLT-2827）

シフト表は引き続き1行1キャディ、1セル1日とする。第一段階では個人セルへ
集約 assignment を足さず、月の必要数・供給力・coverage を日×コースの summary として
同じ画面に置く。

- 必要数: aggregate demand / requirement projection
- 供給力: `CaddieShift`、availability、profile から作る capacity projection
- 色: 共通 `DailyCaddieCoverage`

月の「ガッチャンコ」は需要を見ない現行 shift generator とは別 step とし、
確定 shift の capacity と requirement を比較する。後続で個人 allocation を追加しても、
reservation assignment 件数へ黙って足さず、午前/午後と source label を分ける。

### 当日配車ボード（PLT-1687）

実予約がある日は現行の未割当ラウンドを維持する。daily summary source の日は、
予約一覧を装わず、次を表示する aggregate mode を設ける。

- コース × 午前/午後の必要枠、供給 capacity、未充足
- 午前→午後に再利用する必要枠と、再利用可能な capacity
- policy / source version と stale / unknown の理由

第一段階では個人名と「この人が継続する」という表示は出さない。後続の
`CaddieDemandAllocation` が存在するときだけ同じ aggregate mode に追加する。

`caddie-course-supply` は1日合計の `rounds_capacity - groups` ではなく、
この coverage projection を返すようにする。実予約由来の tee sheet も adapter で
同じ bucket demand へ投影すれば、色分けの policy は両 source で共有できる。

### 自動配置（PLT-2294）

reservation 固有の `PlannableRound` を直接 daily summary へ流用しない。
第一段階では planner を起動せず、必要数と aggregate capacity の coverage までを返す。
個人割当を追加するときに共通化する境界は次である。

- work item の需要量、course、band / time window
- caddie eligibility
- ranking / tie break
- generated / edited / pinned の上書き規則

実予約 adapter は reservation ID と実時刻を持つ。aggregate adapter は
bucket と band を持つ。planner の出力も source identity を保ち、
aggregate を Field reservation assignment として保存しない。

### 3コース間貸借（PLT-2296）

現行 UI は `CaddieShift.course_id` をその日全体で別コースへ動かす。
午前と午後で別コースへ動くことは表現できない。

- 現場が同一コース内の継続だけを認めるなら、現行 day placement と整合する。
- 現場がコース間の午前→午後移動を行うなら、band ごとの placement と
  移動制約を PLT-2296 に追加する必要がある。現行の「その日だけ移動」を
  そのまま使うと午前の配置まで書き換えるため不正確である。

### 再取り込み（PLT-3249）

再取り込み後は source version を比較し、古い allocation を `stale` にする。
第一段階の coverage も同じ version で stale を判定する。必要数が減った場合の
個人 allocation の規則は次とする。

- `generated`: 新しい需要で再計算し、不要分を外せる。
- `edited` / `pinned`: 黙って外さない。余剰として残し、対象者と日を要確認にする。
- completed の実予約 assignment: aggregate 再取り込みの対象外。
- 再計算完了前は旧 allocation を green / export-ready と扱わない。

## CSV

CSV は予約明細の代用品ではなく、月間 coverage projection の export とする。
第一段階では、日、コース、午前/午後、キャディ付き組数、必要人数、供給 capacity、
不足/余剰、`calculation_status`、source/policy version を含める。後続の個人割当 CSV は
キャディ、source kind、origin を追加する。

`unknown` / `stale` が含まれても出力は許可する。ただし次の両方を必須とする。

1. 出力操作の前に、対象範囲の `unknown` 件数と `stale` 件数をそれぞれ表示する。
2. CSV の各行に `calculation_status` を入れ、通常行へ黙って混ぜない。

この2条件を満たせない実装は CSV 出力を拒否する。現場を手集計へ戻さず、同時に
未確定値を確定値に見せないための fail-loud contract である。

## 承認済み判断と現場確認

### Requester が承認したもの（2026-08-10）

1. 案 A を正本とし、ダミー reservation を作らない。
2. write model は分け、画面と CSV は source kind 付き共通 projection を読む。
3. 運用 policy 未設定時は人数と色を `unknown` にし、0、空欄、仮 default へ倒さない。
4. 色を午前/午後の feasible coverage から一意に決め、画面側の独自計算を禁じる。
5. `PLT-3249` で generated だけを自動再計算し、edited / pinned は要確認にする。
6. CSV は状態付きで許可し、出力前の件数表示とファイル内 status を必須にする。
7. デモ第一段階は必要数と不足/余剰までとし、個人名は後続拡張にする。
   `PLT-3341` の判断で個人割当を追加できる contract は維持する。

### 現場に確認しないと決められないもの

`PLT-3262` と `PLT-3263` で次を確認する。

1. キャディ付き1組は常に1キャディか。assistant / trainee など2人以上の例外はあるか。
2. 午前担当者が午後も回るための条件。全員か、希望者だけか、経験・雇用形態・
   勤務時間等の制限があるか。`two_round_request` が必須か、未提出をどう扱うか。
3. xlsx の午前/午後境界と、4.5〜5時間後の再稼働を保証できる運用条件。
4. 同一コース内だけか、真駒内・滝の・羊ケ丘を午前/午後で移動できるか。
   移動時間と許可される組合せ。
5. shortage / surplus に安全予備人数を含めるか、その値と適用単位。
6. 組数に仮予約、取消待ち、コンペ調整分などが含まれるか。どの時点の数字を
   staffing の確定値として使うか。

## Open questions / blocked facts

- `PLT-3262` / `PLT-3263` の現場回答がないため、`caddies_per_group` と
  continuation policy の値は未確定。
- 実 xlsx の個別時刻は source に存在しないため、どの回答を得ても予約単位の
  overlap は復元できない。
- PLT-3248 の未マージ branch を採用・破棄・rebase する判断は本設計では行わない。
- demo tenant / sandbox の live 値は SCC の運用根拠にならないため取得していない。

## Implementation entry points

承認後に主に影響する候補であり、今回は変更していない。

- `src/course/domain/`: requirement service、work item、coverage policy
- `src/course/usecase/auto_assign_caddies.rs`: 後続個人割当で eligibility を共通化
- `src/course/domain/caddie_plan.rs`: 後続個人割当で reservation 固有入力から抽象化
- `src/course/domain/course_supply.rs`: 時間帯別 coverage への拡張
- `src/course/usecase/generate_caddie_shifts.rs`: 需要非依存の shift 生成との境界
- `desktop/src/features/golf/ShiftBoardPage.tsx`: aggregate requirement / coverage 表示
- `desktop/src/features/golf/CaddiesPage.tsx`: aggregate dispatch mode
- `desktop/src/features/golf/UnassignedRounds.tsx`: 実予約 mode の維持
