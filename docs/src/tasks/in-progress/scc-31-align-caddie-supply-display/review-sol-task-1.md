# SCC-31 骨格計画レビュー（第1巡）

## 結論

指摘は **重大 0 / 高 6 / 中 3 / 低 1 / 提案 0**。

`compute_course_supply()` が配置を参照しないこと、配置の作成・更新が Field の
`CaddieAssignment` だけを書き CourseBoard ローカルの確定シフトを変更しないこと、
シフト行の無いキャディが推薦候補に残ることは、いずれも実コードと一致する。
一方、主要利用者の認可、配置ステータスの backend/frontend 間の差、Field 障害時の
正しさ、ローカル日付境界が骨格から抜けており、このまま詳細設計へ渡すと同じ不整合を
残す可能性が高い。

## 重大

問題なし。

## 高

### 1. 受付ロールは「正」とする supply API を読めない

**指摘内容**

台帳の主要利用者である `field-extension:golf:reception` には
`ListCaddieInsights` が付与されていない。ところが
`GET /v1/course/caddie-course-supply` は usecase 冒頭で同 action を必須にする。
SCC-31 がこの API を過不足表示の唯一の正としても、受付ロールでは 403 のままであり、
修正対象のヘッダ自体が表示されない。SCC-27 で追加されたのは `ListShifts` だけで、
この穴は解消していない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:42-45`
- `src/course/usecase/get_course_caddie_supply.rs:46-52`
- `.tachyon/manifests/tachyonfield-golf-auth.yml:198-246`
- `.tachyon/manifests/tachyonfield-golf-auth.yml:277-282`

**修正提案**

詳細計画への委譲事項に、受付へこの集計を公開する action 設計を必須項目として追加する。
既存 `ListCaddieInsights` を受付へ付与すると同 action 配下の他画面まで広がるため、許容範囲を
確認した上で付与するか、台帳用のより狭い read action を設ける。受付ポリシーで supply API
が 200、権限無しポリシーで 403 になる認可テストを受け入れ条件に含める。

### 2. backend と SCC-27 バッジの「非キャンセル」は既に同じ判定ではない

**指摘内容**

task.md は `holdsTheRound() = 非キャンセル` として backend 側を整合させようとしているが、
Rust は trim・小文字化した上で `cancelled` と `canceled` の両方を取消扱いにする一方、
frontend は生の文字列が厳密に `cancelled` かだけを見る。さらに API DTO は正規化済み enum
ではなく Field の元の status token を返す。したがって Field が `canceled`、大文字、前後空白を
返すと、backend 新集計は未充足、SCC-27 バッジは充足となり、今回直すはずの判定分裂が残る。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:73-76`
- `src/course/domain/caddie.rs:105-139`
- `src/course/domain/caddie.rs:445-451`
- `src/course/interfaces/http.rs:2325-2335`
- `desktop/src/features/golf/caddieRoundCoverage.ts:7-12`

**修正提案**

「バッジ側を変更しない」ではなく、「判定基準を backend の正規化済み
`AssignmentStatus` に揃える」を確定事項にする。DTO で canonical status を返すか、frontend
helper を同じ正規化規則へ変更し、`cancelled` / `canceled` / 大文字 / 空白 / unknown status の
契約テストを backend と frontend の両方に置く。

### 3. シフト確定・コース配置・打刻を混同しており、警告に必要なデータ契約が無い

**指摘内容**

task.md の「シフト行が無く、『未出勤』表示のまま」という因果は不正確である。
推薦 usecase は確定シフトの有無・コース配置と attendance snapshot を別々に取得する。
シフト行無しは `Unconfirmed`、行ありでコース無しは `Unplaced` だが、レスポンス DTO が返すのは
`attendanceStatus` だけで、両者は frontend から識別できない。打刻済みだがシフト未確定、または
シフト確定済みだが未打刻という組合せも存在する。現在の実装アウトラインは frontend 変更しか
挙げておらず、「シフト未確定 / コース未割付」警告を正しく実装できない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:50-53`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:65-67`
- `src/course/usecase/list_caddie_recommendations.rs:52-86`
- `src/course/usecase/list_caddie_recommendations.rs:110-180`
- `src/course/domain/caddie_plan.rs:52-75`
- `src/course/interfaces/http_ops.rs:627-645`

**修正提案**

警告条件を少なくとも「確定シフト無し」「確定シフトはあるがコース未割付」「打刻前 / 打刻後」へ
分離し、どれを警告するかを骨格で明示する。推薦 DTO に additive な
`shiftPlacementStatus`（例: `unconfirmed` / `unplaced` / `on_course`）を追加する backend 作業を
アウトラインへ入れ、attendance とは別々に表示・テストする。

### 4. 配置取得失敗時に旧計算へフォールバックすると「正」が虚偽になる

**指摘内容**

task.md は supply API 全体を落とさないフォールバックを推奨するが、配置取得だけ失敗した状態で
旧計算を 200 として返すと、配置済みの組を未充足と断定し、今回の不具合そのものを再現する。
また、このリポジトリの上流失敗契約は 424 であり、現 API も roster / tee sheet / courses の
どれかが失敗すれば `try_join!` から失敗を返す。配置だけを黙って無視する根拠はない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:79-80`
- `src/course/usecase/get_course_caddie_supply.rs:59-67`
- `src/course/usecase/get_course_caddie_supply.rs:77-89`
- `src/course/interfaces/http_ops.rs:1907-1918`

**修正提案**

配置取得失敗は原則 424 とし、frontend がヘッダ値を非表示または「取得できません」にする。
API を 200 で保つ必要があるなら、旧値を確定値として返さず、`dataStatus: incomplete` と欠落した
source を DTO に明示して、frontend が過不足を表示しない契約にする。少なくとも失敗を空配列へ
変換する実装は禁止する。

### 5. Field の UTC 日付 filter をそのまま使うと日本時間の早朝配置を落とす

**指摘内容**

集計 usecase に配置取得を足すだけでは、`from=date&to=date` の単純な指定になりやすい。
Field は assignment を UTC 暦日で絞るため、日本時間 07:00 の配置は前日の UTC 日付に入る。
既存の推薦・自動配置 usecase はこの事情から検索範囲を広げ、取得後に tenant timezone の
日境界で絞り直している。SCC-31 の委譲事項と検証にはこの必須条件が無く、再現日時によっては
配置済みを取得できず警告が残る。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:57-61`
- `src/course/usecase/list_caddie_recommendations.rs:45-62`
- `src/course/usecase/list_caddie_recommendations.rs:97-104`
- `src/course/usecase/auto_assign_caddies.rs:144-167`
- `src/course/usecase/auto_assign_caddies.rs:193-200`

**修正提案**

詳細計画の必須事項に、tenant timezone の取得、`widen_for_utc_date_filter()` による Field 検索、
`tenant_day_bounds()` による再絞り込みを追加する。UTC 前日になる早朝、UTC 翌日になるタイムゾーン、
日付境界直前・直後を usecase テストに含める。

### 6. 二重緩和の委譲に、運用上必要な不変条件と永続的な異常表示が足りない

**指摘内容**

「需要・供給の両側から対応づけて除く」だけでは、何を一単位として対応づけるかが決まらない。
確定シフトは一人が `rounds_capacity = 2` を持ち得る一方、assignment は予約・キャディ・時刻を
持つ。少なくとも同一キャディの複数ラウンド、同一予約への重複 row、別コースへ確定された
キャディの assignment、コース未割付、シフト capacity 超過を定義しないと正しい残余を出せない。

さらに、シフトの無いキャディによる assignment を「充足」にして shortfall 警告を消すと、配置時の
一度きりの確認後には「その担当が確定シフトに裏付けられていない」という異常が画面から消える。
assignment は担当予定の事実ではあっても、確定シフト由来の供給そのものではない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:37-53`
- `src/course/domain/course_supply.rs:41-59`
- `src/course/domain/course_supply.rs:111-128`
- `src/course/domain/caddie.rs:325-341`
- `src/course/usecase/create_caddie_assignment.rs:114-151`

**修正提案**

骨格に次の不変条件を追加する。

- assignment で充足した需要一組につき、同じキャディの利用可能な shift capacity を最大一単位だけ
  消費する。capacity 2 の shift は一件の assignment 後も一単位残す。
- reservation ID は重複排除し、複数 assignment row で一組を複数回充足しない。
- 別コースの shift capacity を消費する場合、元コースの残余も減らし、course mismatch を異常として
  残す。
- shift で裏付けられない assignment、capacity 超過、course mismatch は
  `unbackedAssignedGroups` 等の独立した count として API・ヘッダに永続表示する。

この不変条件を満たす集計方式だけを design.md の裁量とし、異常を一時ダイアログだけで消さない。

## 中

### 7. backend 先行リリースの互換条件が未定義

**指摘内容**

PR 順序は backend → frontend と確定しているが、現 frontend は既存の
`roundsCapacity` / `caddieAttachedGroups` / `shortfall` を必須 number として読み、その意味を
固定文言で説明する。backend が既存フィールドの意味を先に変えるのか、旧値を維持して新規 field
を足すのかで、先行期間の表示と rollback 可否が変わる。「DTO の後方互換性を design.md で扱う」
だけでは、確定したマージ順の安全条件になっていない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:54-55`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:73-75`
- `desktop/src/features/golf/caddieCourseSupply.ts:10-26`
- `desktop/src/features/golf/ledger/LedgerBoard.tsx:229-245`

**修正提案**

backend 新旧 × frontend 新旧の互換表を design.md の必須成果物にする。新規 field は additive・
frontend では optional とし、旧 frontend が誤ったラベルで新しい意味を表示しないこと、new frontend
が旧 backend に当たった場合は旧表示へ安全に戻るか新表示を抑止することを明記する。

### 8. 警告対象の配置経路が手動配置だけに閉じている

**指摘内容**

手動配置は `NameCaddieSheet` から POST するが、自動配置も同じ日に確定シフト無し・未配置の
キャディを候補化し、実行時に assignment を作る。自動配置 preview が現在表示する警告は
attendance に関するものだけである。骨格の「配置時に警告」が手動の候補リスト・確定だけを指すと、
同じ不整合を作る自動配置経路では警告が出ない。

**根拠（file:line）**

- `desktop/src/features/golf/UnassignedRounds.tsx:292-324`
- `src/course/usecase/auto_assign_caddies.rs:159-191`
- `src/course/usecase/auto_assign_caddies.rs:244-263`
- `desktop/src/features/golf/CaddiesPage.tsx:1423-1440`
- `desktop/src/features/golf/CaddiesPage.tsx:1494-1507`

**修正提案**

警告対象を「手動 POST のみ」か「assignment を新規作成する全経路」か明記する。後者を推奨し、
自動配置 preview にも shift placement warning を出して、実行をブロックしないことをテストする。
意図的に自動配置を除外するなら、その理由と後続タスクを記録する。

### 9. 検証計画が domain 純粋関数に寄り、壊れやすい結合点を検証しない

**指摘内容**

既存の `compute_course_supply` テストは shift と需要 map を直接渡すだけで、SCC-31 で新しく増える
Field assignment 取得、tee sheet との reservation ID join、timezone 絞り込み、上流失敗、DTO、
認可を通らない。task.md の追加テストも「配置済みで充足」「二重緩和」だけであり、実装の最も
壊れやすい部分が未検証になる。プレビュー確認も再現一例と警告一例だけで、capacity 2、別コース、
取消 alias、API 失敗、受付ロールを含まない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:68-81`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:92-99`
- `src/course/domain/course_supply.rs:251-363`
- `src/course/usecase/get_course_caddie_supply.rs:71-106`

**修正提案**

Fake gateway を使う `GetCourseCaddieSupplyUseCase` テストを新設し、正常 join、取消・重複、
capacity 2、別コース、未確定・未配置、UTC 境界、assignment provider error を必須化する。
加えて DTO serialization、reception の認可、frontend の新旧 DTO、警告の非ブロッキング確認、
preview での persistent anomaly 表示を検証する。

## 低

### 10. 「CaddieAssignment 確定」は実在しない状態名

**指摘内容**

domain の assignment status は `assigned` / `in_progress` / `completed` / `cancelled` /
`other` で、「確定」という状態は無い。後段で判定を委譲しているものの、確定事項に実在しない語を
置くと、`assigned` だけを数えるのか `holds_the_round()` を使うのか実装者ごとに解釈が割れる。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:37-38`
- `src/course/domain/caddie.rs:105-139`
- `src/course/domain/caddie.rs:445-451`

**修正提案**

「reservation ID に紐づき、確定事項として定める coverage predicate を満たす assignment」と書き換え、
具体的な status 集合は指摘 2 の canonical 判定として design.md に決めさせる。

## 提案

問題なし。

## 観点別補足

- **事実の正確性**: 指摘 2・3 を除き、task.md が述べる主要なコード上の因果は問題なし。
- **骨格の妥当性**: backend 集計への一元化と、配置操作でローカル shift を暗黙更新しない方針は
  問題なし。指摘 4・6 の「不完全な値を正として返さない」「異常を永続表示する」を補う必要がある。
- **委譲事項**: 二重緩和、DTO、status、UI 形状を design.md へ委譲すること自体は問題なし。
  ただし指摘 1・3・5・6 の権限・データ契約・日付境界・不変条件を追加する必要がある。
- **スコープ境界**: SCC-27 のバッジ、SCC-28 のヘッダ集計、SCC-30 の UI 全般見直しとの境界は
  問題なし。指摘 8 の自動配置は UI 全般見直しではなく同じ assignment 作成経路の整合なので、
  SCC-31 内で明示すべきである。
- **検証計画**: 指摘 9 のとおり不足。
