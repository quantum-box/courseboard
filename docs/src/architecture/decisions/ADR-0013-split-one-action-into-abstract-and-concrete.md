# ADR-0013: ひとつの操作を抽象と具体へ分解し、両方へ書く

## Status

Proposed (2026-08-24)

この決定は一度書かれたあと push されずに失われた。内容を復元し、Status は
Proposed に戻してある。合意が取れた時点で Accepted にする。

## Context

CourseBoard の画面で行う操作の多くは、**業種非依存の事実**と**ゴルフ固有の事実**が
1 つになっている。キャディの確定シフトがその典型で、`golf_caddie_shifts` は
2 種類のものを同じ行に持っている。

| カラム | 性質 | 本来の置き場 |
| -- | -- | -- |
| `is_working` | 出勤するかしないか。業種非依存 | Field |
| `span` | 時間帯。業種非依存 | Field |
| `golf_course_id` | どのコースに入るか | CourseBoard |
| `rounds_capacity` | 回れる組数 | CourseBoard |
| `origin` | 自動配置か手動か | CourseBoard |

`MySqlCaddieShiftRepository` は `CaddieShiftGateway` の実装として
**CourseBoard の MySQL にしか書いていない**。ファイル冒頭のコメントもそう宣言している。

```rust
//! Unlike the Field gateways in this module, this one reads and writes
//! CourseBoard's MySQL (`golf_caddie_shifts`). Field holds the shift request
//! but has no column for the course a caddie works, and that placement is what
//! a course's caddie-attached capacity is counted from; see ADR-0005.
```

コメントが説明しているのは `golf_course_id` を CourseBoard が持つ理由であって、
**`is_working` と `span` まで CourseBoard だけが持つ理由ではない。** 結果として、
CourseBoard でシフトを確定しても **Field から見るとそのキャディの出勤は存在しない**。
勤怠・人件費・要員計画など Field 側の汎用機能はこの事実に到達できない。

ADR-0005 は「ゴルフドメイン知識は CourseBoard が所有する」と決めているが、
逆向き — **Field が既に表現できるものを CourseBoard が二重に持たない** — は
明文化されていなかった。ここを埋める。

## Decision

ひとつの操作を、**業種非依存の部分**と**ゴルフ固有の部分**に分解し、それぞれの
所有者へ書く。4 つのルールで運用する。

### 1. Field の汎用モデルが既に表現しているものを CourseBoard で持たない

「出勤するかしないか」「いつからいつまで」は Field の `StaffShift` が既に持っている。
CourseBoard 側の同名カラムは、置き場所の選択ではなく重複である。

### 2. 写すのではなく参照する

CourseBoard 側は Field のシフト ID を持ち、**ゴルフ固有の属性だけを足す**。
Field の行を CourseBoard へ複製しない。複製した瞬間に「どちらが正か」という
問いが生まれ、それは答えの無い問いになる。

これは ADR-0010 の「汎用 ERP レコードの正は Field DB に残す」と同じ方針を、
1 レコードの内部にまで適用したもの。

### 3. Field に置き場が無いものは、業種非依存の contract として起票する

CourseBoard から Field を直接書き換えない。**ゴルフの文脈を剥がした**汎用の
capability として issue を立て、Field 側の判断を待つ。CLAUDE.md の指示どおり。

「キャディ」「コース」「組数」という語彙を contract に持ち込まない。
持ち込むと Field が golf を知ることになり、ADR-0005 の裏返しの違反になる。

### 4. 書き順は Field が先、CourseBoard が後

途中で失敗した場合に残る状態が、既存モデルで意味を持つ側に倒す。

* **Field → CourseBoard の順**で失敗すると、Field にシフトがあり CourseBoard に
  ゴルフ属性が無い状態が残る。これは `golf_course_id` が NULL の行と同じ形で、
  既存モデルが「確定したがコース未配置」として扱える。**破綻せずに落ちる。**
* **逆順**にすると、CourseBoard にシフトがあり Field に無い状態が残る。
  これは**いま起きているズレとまったく同じもの**で、失敗のたびに現状の不具合を
  作り足すことになる。

## Consequences

### Positive

* Field 側の汎用機能（勤怠・人件費・要員計画）がキャディの出勤に到達できる
* 「どちらが正か」を都度判断しなくてよくなる。カラムの性質で機械的に決まる
* 部分的に失敗しても、残る状態が既存モデルの語彙で読める

### Negative

* ~~**Field の `StaffShift` には `list` と `create` しか無い。**~~ PLT-3835 で
  PATCH / DELETE が入った（field-sdk rev `0df2300`）。片道の制約は解消済み。

  ただし**一意制約は入らなかった**。`(tenantId, staffId, date)` の一意化か upsert 口を
  あわせて検討依頼していたが、POST は 201 のみで 409 を返さない。つまり CourseBoard 側が
  shift ID を見失うと、同じスタッフの同じ日に shift が二重に積まれる。**ID の保存は
  Field への書き込みと同じくらい重要な操作**として扱う必要がある。

* **ひとつの操作が動かす日数は、経路によって3桁違う。** 受付が1日直すのは1日、
  月を確定するのは名簿全員×30日。ルール4の「Field が先」を後者にそのまま適用すると、
  1リクエストの中で千件規模の Field 呼び出しになる。そこで書き込みの器を分けた。

  * **単日編集** — 同じリクエストの中で Field → CourseBoard の順。Field が落ちていれば
    編集ごと失敗する。1呼び出しなので待ち時間の問題が無く、即時に一致する。
  * **月の一括確定** — 確定は CourseBoard だけに書いて即返す。Field へはそのあと
    バッチで押し出す（`field_synced_at` が遅れている日を200件ずつ）。確定そのものが
    Field の可用性に引きずられない、というのが分けた理由。

  後者はルール4の順序を月全体では保証しない代わりに、**1日単位では保証する**
  （Field が受け取ってから ID を保存する）。バッチごとに ID を記録するので、
  途中で落ちても失われるのは実行中のバッチぶんだけになる。
* 1 つの操作が 2 つの書き込みになる。Field が落ちているときの挙動を、
  操作ごとに決める必要がある
* 既存の `golf_caddie_shifts` には移行が要る。`is_working` と `span` を Field へ
  移し、CourseBoard 側を Field のシフト ID への参照に置き換える作業が残る。
  現状は参照（`field_shift_id`）を**足した**段階で、まだ複製は消していない

### 見送った案

**CourseBoard 側を正として Field へ非同期に同期する** — 「どちらが正か」を
運用で解く形になり、ズレたときに直す手段が無い。ADR-0010 の物理移送禁止とも
向きが逆。

**Field に `golfCourseId` を足してもらう** — Field が golf を知ることになる。
ADR-0005 が禁じている方向で、次は「シミュレーターの打席」「レストランの卓」が
続く。汎用の器を借りて具体を CourseBoard が持つ、が正しい形。

## References

- ADR-0005: ゴルフドメイン知識は CourseBoard が所有する
- ADR-0010: CourseBoard は Field の extension を使わない独立 Cloud App である
- PLT-3835: [field-api] スタッフの勤務予定に更新・削除の口が無い
- `src/course/infrastructure/caddie_shift_repository.rs`
- `migrations/202608090002_create_golf_caddie_shifts.sql`
