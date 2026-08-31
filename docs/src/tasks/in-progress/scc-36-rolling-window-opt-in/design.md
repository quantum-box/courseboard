---
title: "SCC-36 Field ローリング窓へのオプトイン 詳細設計"
type: "design"
emoji: "🗓️"
topics:
  - "golf"
  - "field-integration"
linear: "SCC-36"
published: false
---

# SCC-36 Field ローリング窓へのオプトイン 詳細設計

本書は `task.md` の骨格（確定事項1〜4）を変更しない。「design.md へ委譲する詳細」を
すべて決定し、実装エージェントが本書だけを見て着手できる粒度まで具体化する。

## 改訂履歴

`review-sol.md`（判定「修正後着手可」、重大3・中3・軽微2）を受けた改訂。
判断が割れた点はオーケストレーターが決定済みの内容をそのまま反映した。
`review-sol.md` 自体は変更していない。

| 指摘 | 指摘の要旨 | 本改訂での対応 |
| --- | --- | --- |
| 重大1 | `Days(366..=399)` を365にクランプすると Field の先端が `bookable_through` に最大34日届かず、「常に以上」という完了条件を満たさない | クランプをやめ、`Through` と同様に**オプトイン対象外**（明示 `null` を送信）とする。本タスクの整合保証は `Days(1..=365)` に限定し、`Days(366..=399)` は引き続き肩代わり実装がカバー。Field の366日以上対応は PLT 側への将来課題として明記（3章・6章・7章・13章） |
| 重大2 | バックフィルが `GET A -> GET B(既存replaceの内部GET) -> PUT` の2段GETになり、`GET A` 直後の他プロセスによる保存を巻き戻し得る | 読取・差分判定・全置換PUTを1つの gateway 操作 `sync_rolling_window_opt_in` に統合。1回のGETで得た `FieldResourceScheduleDto` の rules から response-only フィールドだけを除いてPUTに使い、別時点のドメイン `AvailabilityRule` は重ねない（4章・5章・7章） |
| 重大3 | 台帳フックが同期処理を直列 `await` し、共有 `reqwest::Client` にリクエスト全体の timeout が無いため、Field 無応答時に台帳表示自体が止まりかねない | 同期処理全体を `tokio::time::timeout` 1本の絶対 deadline（5秒）で包む。コースごとの逐次 timeout の合算にはしない。detached task には逃さない。deadline 超過を通常のベストエフォート失敗として扱い、`GetTeeLedgerUseCase` へ進むテストを必須化（7章・9章・11章） |
| 中1 | 日付境界をまたいだ場合の差を「最大1時間程度」と述べているが、それは通常時の再試行間隔であってジョブ成功の時間上限ではない。chrono-tz の版差にも触れていない | 「数式上の目標終端の一致」と「実際に生成済みの先端」を区別し、第1段は肩代わりが日付境界の一時差分を補う条件付き保証であると明記。CourseBoard（chrono-tz 0.10.4）と Field（chrono-tz 0.8.6）の版差が厳密一致を保証しない旨も追記（2.3節） |
| 中2 | 負荷評価が horizon GET・timezone GET・差分時の2回目の schedule GET を見落としている | 重大2対応で timezone GET 自体が不要になったことを含め、定常時・差分時のコース当たり上流リクエスト数を明記し直す（8章） |
| 中3 | 古い rules 再送防止・response-only fields 回帰・無応答時の台帳継続・Days↔Through 往復・バックフィル対象フィルタの5テストが不足 | 5テストすべてをテスト計画に追加（11章） |
| 軽微1 | `Through` の説明が「未設定（null）」と「明示解除」を書き分けていない | 送信意図を述べる箇所は「明示解除（`Some(None)`）」、GET後の状態を述べる箇所は「未設定（`None`）」に統一（3章・6章・7章） |
| 軽微2 | `FIELD_ROLLING_WINDOW_MAX_DAYS` の配置が曖昧 | コード例に `impl BookingHorizon { ... }` ブロックを明示（3章） |

## 0. 調査基準

- リポジトリ: `quantum-box/courseboard`（本ワークツリー、ブランチ
  `scc-36-rolling-window-opt-in`）
- 参照した Field 側確定版設計: `quantum-box/tachyonfield`
  ブランチ `plt-3361-slot-rolling-window` の
  `docs/src/tasks/in-progress/plt-3361-slot-rolling-window/design.md`
  （「2026-08-29 第5改訂（確定版）」、1.2節・1.3節・4章を主に参照）
- 本改訂で追加調査したもの: `src/course/infrastructure/field_gateway.rs` の
  `FieldAvailabilityRuleDto`・`schedule_replace_body`・
  `field_rule_passthrough_fields`・`FIELD_UPSTREAM_TIMEOUT` の実装、
  `src/course/infrastructure/field_sdk_capabilities_gateway.rs` の
  `tokio::time::timeout` 使用例、`src/lib.rs` の `reqwest::Client` 生成箇所、
  `tachyon.yaml` の Lambda 設定。
- `review-sol.md`（「修正後着手可」、重大3・中3・軽微2）を受けて本書を改訂した。
  `review-sol.md` 自体は変更していない。
- 実装は行っていない。以下はすべて読み取り調査に基づく。

## 1. スコープの再確認

骨格の確定事項どおり、本タスクは以下の3箇所のみを変更する。

1. `BookingHorizon` から `rollingWindowDays` を導出するドメインロジック
   （`src/course/domain/schedule.rs`）
2. `PUT .../schedule` のボディ組み立てへの同送
   （`src/course/infrastructure/field_gateway.rs`、呼び出し元は
   `ReplaceCourseScheduleUseCase`）
3. `GET /v1/course/tee-ledger` からの自動バックフィル（新規ユースケース、
   `src/course/interfaces/http.rs` の既存フックに並置）

`ExtendCourseInventoryUseCase`・`golf_generated_through` ウォーターマーク・
SCC-35 警告ロジックには一切触れない（確定事項4）。新しい HTTP ルートは
追加しない（既存の `PUT .../schedule` 相当の保存経路と `GET
/v1/course/tee-ledger` のみを使う）ため、`src/course_authz.rs` の
`ROUTES` 分類の追加も不要。新規の環境変数・設定キーも追加しない
（テナントの `bookingHorizon` 設定とタイムゾーン設定のみから導出する）。

**本タスクが Field の先端と `bookable_through` の整合を保証する範囲は
`BookingHorizon::Days(1..=365)` に限定する**（重大1対応、3章・6章・7章で
詳述）。`Days(366..=399)` と `Through` はいずれもオプトイン対象外とし、
Field のローリング窓ではなく既存の肩代わり実装
（`ExtendCourseInventoryUseCase`）が引き続き `bookable_through` を保証する。

フロントエンド（`desktop/`）は変更しない。UI に新しい表示・入力を追加する
要求は task.md になく、`rollingWindowDays` は CourseBoard が Field へ
書き込むだけの内部設定であり、既存の予約可能期間 UI
（`booking-horizon` 画面）が示す情報から独立した新しい概念をユーザーに
見せる必要がない。10章で理由を補足する。

## 2. off-by-one の検証（必須）

### 2.1 突き合わせる2つの式

- CourseBoard 側「受付終端」: `BookingHorizon::last_bookable_date`
  （`src/course/domain/schedule.rs:250-255`）

  ```rust
  pub fn last_bookable_date(&self, today: NaiveDate) -> NaiveDate {
      match self {
          Self::Days(days) => today + Duration::days(*days),
          Self::Through(date) => (*date).min(today + Duration::days(Self::MAX_DAYS)),
      }
  }
  ```

  `Days(n)` の場合: `bookable_through = today + n`。

- Field 側「ローリング窓の先端」（tachyonfield design.md 1.2節、
  `plan_rolling_window_generation`、`plt-3361-slot-rolling-window/design.md:537`）:

  ```rust
  let candidate_to = local_today + Duration::days(i64::from(rolling_window_days));
  ```

  骨格の式を文字どおり採用しているため `-1` は無い
  （tachyonfield design.md 1.2節、重大3対応）。すなわち
  `field_to = local_today + rolling_window_days`。

両者とも「`today` に `days` を単純加算するだけ」で、`-1` を含まない同じ形
をしている。したがって `rolling_window_days = n` を送れば
`field_to = local_today + n` と `bookable_through = today + n` は
**同じ式**になる。残る論点は `local_today`（Field側）と `today`
（CourseBoard側）が同じ日を指すかどうかに絞られる。

### 2.2 `today` の一致を保証する経路

CourseBoard 側で `last_bookable_date` に渡す `today` は、すべて
`course_today(now, timezone)`（`src/course/usecase/course_schedule.rs:31-33`）
経由で計算される。

```rust
fn course_today(now: DateTime<Utc>, timezone: &str) -> Result<NaiveDate, CourseError> {
    tenant_date_at(now, timezone)
}
```

`tenant_date_at`（`src/course/domain/tenant_timezone.rs:34-38`）は
`now.with_timezone(&tz).date_naive()` で、`timezone` はテナントの golf
extension config が持つ単一の IANA タイムゾーン文字列
（`tenant_timezone_from_config`、`tenant_timezone.rs:17-25`、既定
`Asia/Tokyo`）。`BookingHorizon` もこの同じ config オブジェクトの
`bookingHorizon` キーに格納される（`src/course/infrastructure/
booking_horizon_config.rs:21,30-56`）ので、**テナントに対して常に単一の
タイムゾーン・単一の horizon** という前提が成り立つ。

Field 側は `plan_rolling_window_generation` が対象リソースの「通常ルール
のタイムゾーン集合」（`rule_timezones`）ごとに
`now.with_timezone(&tz).date_naive()` を計算する
（`plt-3361-slot-rolling-window/design.md:530-534`）。CourseBoard が
Field へ送るルールは、`rule_to_field`（`src/course/infrastructure/
field_gateway.rs:1147-1160`）が**常に呼び出し元から渡された同じ
`timezone` 文字列**を `"timezone"` フィールドへ書き込み、その
呼び出し元（`replace_resource_schedule` → `schedule_replace_body`、
`field_gateway.rs:938-968,1169-1195`）は `ReplaceCourseScheduleUseCase`
から `self.catalog.get_tenant_timezone(credentials)`
（`course_schedule.rs:124,135`）で取得した**テナントタイムゾーンそのもの**
を渡す。CourseBoard が管理する1コースリソースのルールは全件が同一の
`timezone` 文字列を持つため、Field 側の `rule_timezones` は単一要素
（テナントタイムゾーンと同じ文字列）になる。

したがって、CourseBoard の `today`（`tenant_date_at(now, tz)`）と Field
の `local_today`（`now.with_timezone(&tz).date_naive()`、同じ `tz`
文字列）は、**同じタイムゾーン文字列を chrono の同名タイムゾーン
データベースに適用した結果**であり、評価する瞬間（`now`）が同じ暦日の
範囲内にある限り一致する。ただし、この一致には2.3節に述べる留保がある。

### 2.3 数式上の一致と、実際に生成済みの先端との違い（タイムゾーンの前提を含む）

**2.1節・2.2節で示したのは「同じ `now` で評価すれば目標終端の数式が
一致する」ことであり、「Field 側のジョブが実際に生成を完了した瞬間の
先端が常に `bookable_through` 以上である」ことの保証ではない。**
この2つは区別する必要がある。

- CourseBoard 側の `today` は、リクエストを処理した瞬間の
  `Utc::now()` をテナントタイムゾーンへ変換して得る
  （`ReplaceCourseScheduleUseCase::build_window` は `Utc::now()` を
  直接使う、`course_schedule.rs:172`）。この `today` から求めた
  `bookable_through` は「あるべき受付終端」を即座に表す。
- Field 側の `local_today` は、**毎時ジョブが実行された瞬間**の Field
  サーバーの `now` をテナントタイムゾーンへ変換して得る。この
  `local_today` から求めた `candidate_to` は「そのジョブ実行が成功して
  初めて」実際の生成済み先端に反映される。
- 毎時実行は**通常時の再試行間隔**を与えるものであり、ジョブ成功までの
  時間上限を保証するものではない。ジョブの実行失敗や workflow の遅延が
  あれば、実際の生成済み先端が目標終端に追いつくまでの時間は1時間を
  超えうる。
- 現地日付境界（現地深夜0時）をまたぐ瞬間には、目標終端の数式自体が
  1日進む一方、Field の毎時ジョブがまだそれを検出していない期間が
  生じる（最大1時間程度、Field は毎時実行のため）。

**したがって、第1段（本タスク）における Field ローリング窓の役割は
「肩代わり実装と同じ結果に自己修復で追随する冗長な経路」に留まり、
`bookable_through` の保証そのものは、日付境界の一時差分やジョブ失敗中の
遅延を含めて既存の肩代わり実装（`ExtendCourseInventoryUseCase`）が
担い続ける。ただし肩代わりも、認可が成功し、Field と CourseBoard の
上流呼出しが成功することを前提にしたベストエフォート経路であり、
バックフィルの完了時間上限やコース間の公平性を保証しない。** 本タスクの
安全性はこの肩代わりの継続に依存しており、Field 側のローリング窓が数式
どおりに動くことには依存しない。
（肩代わりの撤去は task.md の「後続タスク（第2段）」で、Field ジョブの
実生成を確認してから別途判断する。）

**タイムゾーンデータの版差について**: CourseBoard は `chrono-tz 0.10.4`
を固定しており、参照した Field 確定版は `chrono-tz 0.8.6` を固定して
いる（`Cargo.lock` の該当エントリと、tachyonfield 確定版設計の記載を
突き合わせ済み）。同じ IANA タイムゾーン文字列（例: `Asia/Tokyo`）を
指定しても、両者が内包する tzdata のスナップショットが異なれば、政治的な
タイムゾーン規則変更（夏時間の新設・廃止、標準時変更など）の反映時期が
ずれる可能性がある。通常の `Asia/Tokyo`（夏時間なし、規則変更も稀）では
実害になりにくいが、**「同じ timezone 文字列を指定していれば常に同じ
現地日になる」という前提は、tzdata のバージョンが完全に同一であることを
検証していない以上、厳密には保証されない**。これも2.3節前段の「実際の
生成済み先端が常に一致するとは限らない」ことの一因であり、肩代わり実装
がこの差分を吸収する対象に含まれる。

### 2.4 導出式の結論（`Days(1..=365)` のみを対象とする）

`rolling_window_days` を **`BookingHorizon::Days(n)` の `n` そのもの
（`n <= 365` の場合に限る）** として Field へ送れば、

```text
field_to = local_today + rolling_window_days
bookable_through = today + n
```

- `n <= 365` のとき: `rolling_window_days = n` なので、同じ `now` で
  評価する限り `field_to = today + n = bookable_through`（等号で成立、
  「以上」を満たす）。ただし2.3節の留保（ジョブ失敗・日付境界・tzdata版差）
  により、これは「肩代わりが補う条件付きの一致」である。
- `n > 365`（`BookingHorizon::MAX_DAYS = 399` まで運用者が明示的に
  設定できる、`schedule.rs:189,192-196`）のとき: `n` を365へクランプして
  送ると `field_to = today + 365 < bookable_through = today + n`
  となり、**「Field の先端が常に `bookable_through` 以上」という条件を
  満たせない**（review-sol.md 重大1）。この場合、Field のローリング窓は
  最大34日 `bookable_through` に届かない冗長経路になってしまい、
  「冗長な経路である」という2.3節の前提が崩れる。したがって、
  `Days(366..=399)` は Field へのオプトイン対象そのものから外す
  （3.2節）。この範囲のテナントについては、Field のローリング窓は
  一切関与せず、`ExtendCourseInventoryUseCase` のみが
  `horizon.last_bookable_date(today)` を直接使って `bookable_through`
  までの在庫生成を、認可成功と上流成功を前提にした既存のベストエフォート
  経路として担い続ける（`course_schedule.rs:173, 183-184,384-385,412`、
  確定事項4によりこの経路は本タスクで変更しない）。5秒 deadline と逐次
  処理は、Field が継続的に遅い場合やコース数が多い場合に後方のコースを
  未試行のまま終える可能性があり、バックフィルの完了時間上限や公平性を
  保証しない。

`BookingHorizon::Through(date)` の場合は「日数」という概念そのものが
存在しない（`.days()` は `None` を返す、`schedule.rs:204-209`）ため
`Days(366..=399)` とは別の理由でオプトイン対象外になる。3.1節で扱う。

## 3. `rollingWindowDays` の導出関数

`src/course/domain/schedule.rs` の `impl BookingHorizon` ブロック
（186行目 `DEFAULT_DAYS` 定数のそば）に、Field 用の上限定数と導出メソッド
を追加する。

```rust
impl BookingHorizon {
    /// The largest value Field's `rollingWindowDays` accepts.
    ///
    /// `generate_resource_time_slots` rejects a range whose span is 366 days or
    /// more (tachyonfield design.md PLT-3361 ch.1.2), so 365 is the largest
    /// single-timezone opt-in that a first-time generate call never trips.
    pub const FIELD_ROLLING_WINDOW_MAX_DAYS: i64 = 365;

    /// What Field's `rollingWindowDays` opt-in should hold for this horizon,
    /// or `None` when Field's rolling window cannot represent it — meaning
    /// this horizon should be sent as an explicit `null` (opt-out), never as
    /// "leave the existing value alone".
    ///
    /// Two distinct horizons return `None` here, for two distinct reasons:
    ///
    /// - `Through` shrinks toward a fixed point as today advances; a static
    ///   day count sent once would instead keep pushing Field's generated
    ///   inventory past that date every hour (see the docs on `Through`
    ///   opting out, below).
    /// - `Days(n)` for `n` above `FIELD_ROLLING_WINDOW_MAX_DAYS` (366..=399,
    ///   `BookingHorizon::MAX_DAYS`) has no value that keeps Field's target
    ///   at or beyond `bookable_through`: clamping to 365 would leave
    ///   Field's rolling window up to 34 days short, silently pretending an
    ///   alignment that does not hold (review-sol.md 重大1). Rather than
    ///   encode that gap, this range opts out exactly like `Through` — the
    ///   existing shoring-up path (`ExtendCourseInventoryUseCase`) remains the
    ///   only responsible path for `bookable_through` for these tenants. It is
    ///   best effort after authorization and upstream success, and makes no
    ///   completion-time or fairness guarantee.
    ///
    /// Only `Days(1..=365)` — which matches Field's rolling semantics
    /// exactly (§2.4) — opts in.
    pub fn field_rolling_window_days(&self) -> Option<i32> {
        self.days()
            .filter(|&days| days <= Self::FIELD_ROLLING_WINDOW_MAX_DAYS)
            .map(|days| days as i32)
    }
}
```

- `Days(1..=365)` → `Some(n as i32)`。
- `Days(366..=399)` → `None`（明示 `null` として送る。3.2節）。
- `Through(_)` → `None`（明示 `null` として送る。3.1節）。

`self.days()` は `Days` のときだけ `Some(n)`（`n: i64`、`schedule.rs:
204-209`）を返すため、`filter` は `Days(366..=399)` にだけ効き、
`Through` は `days()` の時点ですでに `None` になっている。単一の
`Option` チェーンで両方の対象外条件を表現できる。

### 3.1 なぜ `Through` は対象外か

`BookingHorizon::Through` は実際に運用者が設定できる値で
（`SetBookingHorizonUseCase`・`GetBookingHorizonUseCase` 経由、
`http.rs:1969-1970,2015-2016` で `mode=through` として API に露出、
`booking_horizon_config.rs:43-56,66-82` で config に永続化）、
「シーズンの最終営業日」を表す。`last_bookable_date` はこの日付に
向かって縮んでいく（`schedule.rs:253`、`date.min(today + 399日)`）。

Field のローリング窓は「毎時、現地今日 + N 日まで先端を進める」という
一方向にしか動かない機構であり、一度 `rollingWindowDays` を設定すると
`N` を変えるか解除するまで**縮まない**。もし `Through` の残り日数を
`rollingWindowDays` として都度計算して送るとしても、値を送った次の瞬間
から `today` が進むにつれて実際に必要な日数は減っていくのに、Field 側
は送った時点の値のまま先端を伸ばし続けるため、**シーズンの最終営業日
より後の日付にも予約可能な枠が生成されてしまう**。CourseBoard の予約
作成フロー（`src/course/usecase/create_reservation.rs`）は
`BookingHorizon` を一切参照しておらず（`create_reservation.rs` に
`BookingHorizon`/`bookable_through` の実利用箇所は無く、テストの
フェイク実装にのみ現れる）、予約可否は「その日時の枠が生成されている
かどうか」だけで決まる。したがって Field が先端を縮められないまま
シーズン最終日を超えて生成し続けると、**運用者が閉じたはずの season
の後ろに実際に予約が入ってしまう**という業務ルール違反になる
（性能上の無駄ではなく正当性のバグ）。

このリスクを避けるため、`Through` では `rollingWindowDays` を常に
**明示解除（`Some(None)`、6章・7章で送信する値）**として扱う。既に
オプトイン済みのリソースが `Through` に切り替わった場合も、6章・7章の
同送経路が毎回明示的に `null` を送るため、取り残された古い設定値
（GET 応答上は「未設定」＝`None` として観測される）が残り続けることは
ない。`Through` の在庫生成は従来どおり `ExtendCourseInventoryUseCase`
のみが担い、Field の毎時ジョブは関与しない。

### 3.2 なぜ `Days(366..=399)` は対象外か（重大1対応）

2.4節で示したとおり、`Days(n)` の `n` が365を超える場合に365へ
クランプして送ると、`field_to = today + 365` は `bookable_through =
today + n`（最大 `today + 399`）に最大34日届かない。これは
`Through` のケース（縮む方向へのズレで season 終端を超過する）とは
逆に、**Field の先端が受付終端に足りないまま静止する**という不整合
であり、レビュー（review-sol.md 重大1）が指摘したとおり「Field の
先端が常に `bookable_through` 以上になる」という委譲事項の条件を
満たさない。

クランプで曖昧に整合を装うのではなく、**`Through` と同じ扱い（明示
`null` による対象外）にする**ことで、この範囲のテナントについては
「Field のローリング窓は一切関与せず、肩代わり実装だけが
`bookable_through` を保証する」という事実を設計上も運用上も明確にする。
これにより:

- 本タスクの完了条件は `Days(1..=365)` のテナントに限定して成立する。
- `Days(366..=399)` を設定しているテナントが存在する限り、
  `ExtendCourseInventoryUseCase`・`golf_generated_through` ウォーター
  マーク・台帳フックの撤去（task.md 後続タスク・第2段）はブロックされる。
  第2段に着手する際は、まずこの範囲のテナントの有無を確認する必要が
  ある（13章）。
- Field 側で366日以上のローリング窓を表現できる汎用 capability が
  必要になった場合は、ゴルフの文脈を剥がした業種非依存の contract として
  PLT 側へ起票する（CLAUDE.md の方針どおり、CourseBoard から Field の
  実装を勝手に書かない）。これは本タスクの範囲外の将来課題である。

`Days(366..=399)` は運用者が明示的に設定した値であり、上限を399から
365へ変更する（＝ `Days` そのものの上限を下げる）という選択肢は
task.md の骨格が「1..=365 にクランプする」とした前提を変えてしまう
ため採らない。

## 4. `ReservationScheduleGateway` の変更方針

`src/course/domain/ports.rs:729-769` の `ReservationScheduleGateway` は
現在4メソッド（`get_resource_schedule`・`replace_resource_schedule`・
`generate_resource_time_slots`・`list_resource_time_slots`）。

重大2対応により、読み取り専用のメソッドを追加する当初案を撤回し、
**「読取・差分判定・全置換PUTを1つの gateway 操作にまとめた新規メソッド」
を1つだけ追加**する。書き込み側は別途 `replace_resource_schedule` の
入力も拡張するため、変更点は次の2つになる。

### 4.1 バックフィル専用: 読取・差分判定・PUTを一体化した新規メソッド

```rust
/// Reads the resource's current schedule and `rollingWindowDays` in a
/// single GET, and — only when the current value differs from
/// `rolling_window_days` — immediately PUTs the same rules back (echoed
/// verbatim from that GET, response-only fields stripped) with
/// `rollingWindowDays` set to the new value. Returns whether a write
/// happened.
///
/// This does the GET, diff, and PUT as one gateway call rather than
/// composing a read method with the existing `replace_resource_schedule`
/// deliberately (review-sol.md 重大2). `replace_resource_schedule` issues
/// its own internal GET immediately before its PUT (§4.2's "Field's PUT is
/// a full replacement" comment) to merge in Field-owned passthrough
/// fields against a caller-supplied *edited* rule set. Composing that with
/// a separate backfill-side GET would read the schedule twice at two
/// different instants — `GET A` here, then a second `GET B` inside
/// `replace_resource_schedule` — and PUT `GET A`'s rules as the "edited"
/// set. Any schedule save that completed between `GET A` and `GET B` would
/// have its new rules read by `GET B` only to be overwritten by `GET A`'s
/// stale ones, because `schedule_replace_body` treats the edited set as
/// authoritative. Folding everything into one GET removes that window
/// entirely: there is exactly one read, and its rules are what gets PUT
/// back, unmodified except for the response-only fields Field itself
/// rejects on the way in.
///
/// No `timezone` parameter: unlike `replace_resource_schedule`, this call
/// never constructs a rule from domain data, so it never needs to stamp a
/// timezone onto one — each rule's own `timezone` field round-trips as
/// part of the fields this call echoes back untouched (§5.4).
async fn sync_rolling_window_opt_in(
    &self,
    credentials: GatewayCredentials<'_>,
    resource_id: &ResourceId,
    rolling_window_days: Option<i32>,
) -> Result<bool, CourseError>;
```

- Field に条件付き更新や設定専用 PATCH が無い以上、**この呼び出しの
  「最後のGET」と、それより後に開始される別の保存操作の「PUT」との
  競合窓は残る**（Field 側の全置換契約そのものに起因する既知の制約で
  あり、既存の `replace_resource_schedule` が持つ GET→PUT 間の競合と
  同種のもの）。本メソッドが解消するのは「バックフィル自身が持ち込む
  **余分な**GETと、それによる古い `edited` rules の巻き戻し」であり、
  Field 契約そのものが持つ残存競合ではない。この不変条件（「余分な GET
  と古い `edited` rules による巻き戻しを増やさない」）を5.4節の実装が
  満たすことをテスト計画（11章）で確認する。
- `rolling_window_days: Option<i32>` は「設定するか解除するかが常に
  定まっている」バックフィルの意図をそのまま表す二値であり、4.3節で
  述べる三値（`Option<Option<i32>>`、6章の「わからないので触らない」を
  表す省略）はここでは登場しない。

### 4.2 書き込み側: `replace_resource_schedule` の入力拡張（6章専用）

```rust
async fn replace_resource_schedule(
    &self,
    credentials: GatewayCredentials<'_>,
    resource_id: &ResourceId,
    timezone: &str,
    rules: &[AvailabilityRule],
    rolling_window_days: Option<Option<i32>>,
) -> Result<Vec<AvailabilityRule>, CourseError>;
```

`rolling_window_days` は Field の `double_option` 契約
（`rollingWindowDays`: 省略=維持 / 明示 `null`=解除 / 値=設定、
tachyonfield design.md 3.2節・4章）をそのまま写した三値。

- `None`（外側）: PUT ボディに `rollingWindowDays` キー自体を含めない
  （Field 側で現状維持）。
- `Some(None)`: 明示的に `null` を送る（解除）。
- `Some(Some(n))`: `n` を送る（設定）。

この入力拡張は6章のスケジュール保存経路（`ReplaceCourseScheduleUseCase`）
だけが使う。呼び出し元は実装1箇所（`course_schedule.rs:139`）と
テスト1箇所（`field_gateway.rs:2127` 付近）のみ
（`grep -rn "\.replace_resource_schedule("` の結果）で、影響範囲が小さい。
7章のバックフィルは4.1節の新規メソッドを使うため、この三値を扱わない
（4.1節末尾のとおり）。

呼び出し元（4トレイト実装 + 1本番呼び出し）への影響は12章にまとめる。

### 4.3 なぜ `replace_resource_schedule` だけ三値 (`Option<Option<i32>>`) が必要か

`ReplaceCourseScheduleUseCase::execute` は `horizon` の取得に失敗しても
週の保存自体は止めない設計になっている（`course_schedule.rs:126-130`
のコメント、「Deliberately not `?`-ed here」）。horizon が読めない場合に
`rollingWindowDays` として何を送るべきか決め打ちできない
（設定すべきでも解除すべきでもない、単に「わからない」）ため、この
ケースだけ PUT ボディから `rollingWindowDays` キーを丸ごと省略して
Field 側の現状維持に委ねる必要がある。二値の `Option<i32>`
（`None`=解除、`Some(n)`=設定）では「わからないので触らない」を
表現できない。

7章のバックフィル経路は horizon の読み取り失敗をそのまま呼び出し元へ
伝播させる（早期 `?`）ため、実際にこの三値の「省略」を使うのは6章の
スケジュール保存経路だけになる。4.1節の新規メソッドが二値で足りるのは
この理由による。

## 5. `FieldGolfCatalogGateway`（infrastructure）の変更

`src/course/infrastructure/field_gateway.rs` に対する変更。

### 5.1 `FieldResourceScheduleDto` の拡張（1083-1086行目）

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldResourceScheduleDto {
    #[serde(default)]
    rolling_window_days: Option<i32>,
    #[serde(default)]
    rules: Vec<FieldAvailabilityRuleDto>,
}
```

GET・PUT のどちらのレスポンスも `rollingWindowDays` をトップレベルの
`null` または数値として返す契約（tachyonfield design.md 4章、
`solarWindow` と同型）なので `#[serde(default)]` を付けて後方互換にする
（未対応の Field バージョンが `rollingWindowDays` キー自体を返さない
場合でも decode を落とさない）。

### 5.2 GET 経路の共通化

`get_resource_schedule`（910-932行目）・`replace_resource_schedule`の
内部GET（948-956行目）・5.4節の `sync_rolling_window_opt_in` は、
いずれも同一の `GET /v1/erp/reservation-resources/{id}/schedule` を
発行してから `FieldResourceScheduleDto` へデコードするだけの処理を
含む。3箇所の重複を避けるため、GET とデコードを共通の private 関数へ
切り出す。

```rust
async fn fetch_resource_schedule_dto(
    client: &reqwest::Client,
    base_url: &str,
    resource_id: &ResourceId,
    credentials: GatewayCredentials<'_>,
) -> Result<FieldResourceScheduleDto, CourseError> {
    if is_empty_course_store(base_url) {
        return Ok(FieldResourceScheduleDto { rolling_window_days: None, rules: Vec::new() });
    }
    field_send_json(
        client,
        base_url,
        reqwest::Method::GET,
        &format!(
            "/v1/erp/reservation-resources/{}/schedule",
            urlencoding_path(resource_id.as_str())
        ),
        credentials,
        None,
    )
    .await
}
```

`get_resource_schedule` はこれを呼んで `rules` だけを `rule_to_domain`
に通す。`replace_resource_schedule` の内部GETと5.4節の
`sync_rolling_window_opt_in` も同じ関数を呼ぶ。`is_empty_course_store`
（デモ用の空ストア）の早期リターンは既存の `get_resource_schedule`
（916-918行目）と同じ動作をすべての呼び出し元で保つ。

### 5.3 PUT 経路の拡張（`replace_resource_schedule`、6章用）

`replace_resource_schedule`（934-968行目）に
`rolling_window_days: Option<Option<i32>>` を追加し、
`schedule_replace_body`（1169-1195行目）にも同じ引数を追加する。

```rust
fn schedule_replace_body(
    current: &[FieldAvailabilityRuleDto],
    edited: &[AvailabilityRule],
    timezone: &str,
    rolling_window_days: Option<Option<i32>>,
) -> Value {
    let current_by_id: HashMap<&str, &FieldAvailabilityRuleDto> = /* 既存のまま */;
    let rules = /* 既存のまま */;
    let mut body = json!({ "rules": rules });
    if let (Some(object), Some(value)) = (body.as_object_mut(), rolling_window_days) {
        object.insert("rollingWindowDays".into(), json!(value));
    }
    body
}
```

`json!(value)` は `value: Option<i32>` を `null` または数値へ
シリアライズする（serde_json の `Option` 対応）。`rolling_window_days`
が外側 `None`（=このPUTでは触れない）のときはキー自体を挿入しない。
既存の GET→PUT パターン（現在の rules を読み、passthrough フィールドを
維持しつつ差し替える、`field_gateway.rs:944-967`）はそのまま保つ。

### 5.4 `sync_rolling_window_opt_in` の実装（4.1節、7章用）

`schedule_replace_body`（5.3節）は「ドメインの `edited: &[AvailabilityRule]`
を正として、Field 由来の passthrough フィールドを重ねる」実装であり、
バックフィルには使えない（4.1節のとおり、`edited` を作る時点で別読みが
必要になる）。バックフィルは代わりに、GET で得た
`FieldAvailabilityRuleDto` そのものから PUT 用 JSON を組み立てる。

```rust
fn rule_dto_to_put_json(rule: &FieldAvailabilityRuleDto) -> Value {
    let mut body = json!({
        "dayOfWeek": rule.day_of_week,
        "startTime": rule.start_time,
        "endTime": rule.end_time,
        "capacity": rule.capacity,
        "slotIntervalMinutes": rule.slot_interval_minutes,
    });
    let object = body
        .as_object_mut()
        .expect("object literal always serializes to a JSON object");
    if let Some(id) = &rule.id {
        object.insert("id".into(), json!(id));
    }
    // Reuses the same deny-list `replace_resource_schedule` uses (§5.3), so a
    // rule echoed back unchanged keeps every Field-owned mutable field
    // (`effectiveFrom`, `effectiveTo`, season, `solarWindow`, `timezone`,
    // and anything Field adds later) and drops only what its PUT rejects.
    object.extend(field_rule_passthrough_fields(rule));
    body
}

/// Build the PUT body for the rolling-window backfill directly from the GET
/// response this call just made — no domain `AvailabilityRule` round-trip,
/// no second read (§4.1).
fn rolling_window_sync_body(current: &FieldResourceScheduleDto, rolling_window_days: Option<i32>) -> Value {
    let rules: Vec<Value> = current.rules.iter().map(rule_dto_to_put_json).collect();
    json!({ "rules": rules, "rollingWindowDays": rolling_window_days })
}
```

```rust
async fn sync_rolling_window_opt_in(
    &self,
    credentials: GatewayCredentials<'_>,
    resource_id: &ResourceId,
    rolling_window_days: Option<i32>,
) -> Result<bool, CourseError> {
    if is_empty_course_store(&self.base_url) {
        return Ok(false);
    }
    let path = format!(
        "/v1/erp/reservation-resources/{}/schedule",
        urlencoding_path(resource_id.as_str())
    );
    let current =
        fetch_resource_schedule_dto(&self.client, &self.base_url, resource_id, credentials).await?;
    if current.rolling_window_days == rolling_window_days {
        return Ok(false);
    }
    let body = rolling_window_sync_body(&current, rolling_window_days);
    let _: FieldResourceScheduleDto = field_send_json(
        &self.client,
        &self.base_url,
        reqwest::Method::PUT,
        &path,
        credentials,
        Some(&body),
    )
    .await?;
    Ok(true)
}
```

`field_rule_passthrough_fields`（既存、`field_gateway.rs:1197-1203`）を
そのまま再利用しているため、`FIELD_RULE_RESPONSE_ONLY_FIELDS`
（`active`・`createdAt`・`updatedAt`・`revision`）の除外規則は5.3節の
スケジュール保存経路と1箇所のロジックを共有する。除外規則を2箇所に
複製すると、Field が response-only フィールドを追加・削除したときに
一方だけ更新し忘れる回帰が起きうるため、共有は意図的な選択である。

`current == rolling_window_days` の比較は両方 `Option<i32>` の単純な
等値比較で足りる（Days から Through への切り替えなど、`None` 同士・
`Some` 同士の比較も含めて正しく機能する）。

## 6. スケジュール保存経路への同送（`ReplaceCourseScheduleUseCase`）

`src/course/usecase/course_schedule.rs:111-161`
`ReplaceCourseScheduleUseCase::execute` は既に

```rust
let (courses, timezone, resource_id, horizon) = tokio::join!(
    self.catalog.list_courses(credentials),
    self.catalog.get_tenant_timezone(credentials),
    resolve_resource(&self.catalog, credentials, course_id),
    self.commercial.get_booking_horizon(credentials),
);
```

で `horizon: Result<BookingHorizon, CourseError>` を `replace_resource_schedule`
呼び出し（139行目）より前に取得済みである。この `horizon` から
`rolling_window_days: Option<Option<i32>>` を導出して渡すだけでよい。

```rust
let rolling_window_days = horizon
    .as_ref()
    .ok()
    .map(BookingHorizon::field_rolling_window_days);
let saved = self
    .schedules
    .replace_resource_schedule(credentials, &resource_id, &timezone, &rules, rolling_window_days)
    .await?;
```

- `horizon` が `Err`（Field の horizon が読めない）→ `None`（外側）→
  PUT に `rollingWindowDays` を含めない。週の保存を止めないという
  既存の設計方針（`horizon` を `?` しない、126-130行目のコメント）を
  壊さない。
- `horizon` が `Ok(Days(n))` かつ `n <= 365` →
  `Some(Some(n as i32))` → 設定。
- `horizon` が `Ok(Days(n))` かつ `n` が366..=399（`field_rolling_window_days`
  が `None` を返す、3.2節）→ `Some(None)` → **明示解除**。365への
  クランプはしない（重大1対応）。
- `horizon` が `Ok(Through(_))` → `Some(None)` → **明示解除**
  （3.1節の理由により、`Through` へ切り替わったリソースの古い設定を
  この保存のタイミングで確実に消す）。

`Days(366..=399)` と `Through` はどちらも `field_rolling_window_days()`
が `None` を返すため、この分岐は実装上1本の `map` にまとまり、
特別扱いのコードを追加する必要はない（3章の実装がすでに両者を吸収する）。

以降の `build_window`（163-209行目、`horizon` を2回目に使う箇所）は
無変更。`horizon` を2回 clone/使い回すことになるが、`BookingHorizon`
は `Copy`（`schedule.rs:175`）なので問題ない。

「受付枠を保存するたびに再送される（自己修復）」という骨格の要求は
これで満たされる。毎回の保存で必ず `rollingWindowDays` が正しい値
（または明示的な解除）で上書きされるため、Field 側の値が
`BookingHorizon` の変更に取り残されることはない。

### 6.1 コールドスタート時の検証済み安全性

`horizon.field_rolling_window_days()` が返す値は必ず
`1..=365` の範囲内（`Days(1..=365)`）か `None`（`Days(366..=399)` と
`Through` の両方）であり、Field が `1..=365` を要求する仕様
（tachyonfield design.md 3.2節 `MAX_ROLLING_WINDOW_DAYS = 365`）と
厳密に一致する。したがってこの同送によって PUT 全体が 400 で失敗する
経路は理論上発生しない（`rules` の妥当性とは独立）。ただし PUT は
一つのリクエストで `rules` と `rollingWindowDays` を両方検証する契約
であるため、仮に導出関数にバグがあれば「rollingWindowDays が不正な
値のせいで、本来無関係なスケジュール保存全体が失敗する」という結合が
生まれる。このリスクを潰すため、11章のテスト計画に
`field_rolling_window_days` の全域テスト（`1..=399` すべての `Days`
入力で、返り値が `Some` のとき常に `1..=365` に収まることを確認する）
を含める。

## 7. 台帳フックでの自動バックフィル

### 7.1 新規ユースケース `SyncRollingWindowOptInUseCase`

`course_schedule.rs` に `ExtendCourseInventoryUseCase`
（319-448行目）と同じ形の依存関係を持つ新規ユースケースを追加する。
`watermarks`（`GeneratedThroughGateway`）は使わない
（確定事項4により肩代わり実装のウォーターマークには触れない）。

```rust
pub struct SyncRollingWindowOptInUseCase {
    catalog: Arc<dyn GolfCatalogGateway>,
    schedules: Arc<dyn ReservationScheduleGateway>,
    commercial: Arc<dyn GolfCommercialGateway>,
}

impl SyncRollingWindowOptInUseCase {
    pub fn new(
        catalog: Arc<dyn GolfCatalogGateway>,
        schedules: Arc<dyn ReservationScheduleGateway>,
        commercial: Arc<dyn GolfCommercialGateway>,
    ) -> Self {
        Self { catalog, schedules, commercial }
    }

    /// The courses whose Field opt-in was actually written this run.
    pub async fn execute(
        &self,
        credentials: GatewayCredentials<'_>,
    ) -> Result<Vec<CourseId>, CourseError> {
        credentials.require(actions::MANAGE_COURSES).await?;
        let (horizon, resources) = tokio::join!(
            self.commercial.get_booking_horizon(credentials),
            self.catalog.list_resources(credentials),
        );
        let expected = horizon?.field_rolling_window_days();
        let resources = resources?;

        let courses: Vec<(ResourceId, CourseId)> = resources
            .iter()
            .filter(|resource| resource.is_active())
            .filter(|resource| resource.kind() == ResourceKind::Course)
            .filter_map(|resource| {
                resource.golf_course_id().cloned().map(|course_id| {
                    let resource_id = resource
                        .reservation_resource_id()
                        .cloned()
                        .unwrap_or_else(|| resource.id().clone());
                    (resource_id, course_id)
                })
            })
            .collect();

        let mut synced = Vec::new();
        for (resource_id, course_id) in courses {
            match self
                .schedules
                .sync_rolling_window_opt_in(credentials, &resource_id, expected)
                .await
            {
                Ok(true) => synced.push(course_id),
                Ok(false) => {}
                Err(error) => tracing::warn!(%error, course_id = %course_id.as_str(),
                    "could not sync the Field rolling window opt-in for this course"),
            }
        }
        Ok(synced)
    }
}
```

4.1節の新規メソッドが読取・差分判定・PUTを内包するため、ユースケース側の
ロジックは「horizon とコース一覧を取り、コースごとに1回呼ぶだけ」まで
単純化される。差分の有無（`Ok(true)`/`Ok(false)`）とコースごとの失敗
（`Err`、`continue` 相当でループを止めない）が gateway 呼び出し1回の
戻り値だけで表現できる。

### 7.2 テナントタイムゾーンが不要な理由

`ExtendCourseInventoryUseCase` は自身の在庫生成のために
`get_tenant_timezone` を呼ぶ（`course_schedule.rs:352`）が、
`SyncRollingWindowOptInUseCase` は**呼ばない**。4.1節・5.4節のとおり、
`sync_rolling_window_opt_in` は PUT する rules を「GET で得た DTO
そのもの」から組み立てるため、各ルールの `timezone` フィールドは
（`effectiveFrom`・`effectiveTo`・season・`solarWindow` と同様に）
`field_rule_passthrough_fields` を経由してそのまま往復する。ドメインの
`AvailabilityRule` からルールを新たに構成する6章の保存経路とは異なり、
バックフィルはタイムゾーンを新たに書き込む必要がない。

これは当初案（task.md「design.md へ委譲する詳細」時点、および本書の
旧版）が `get_tenant_timezone` を horizon 取得と並行して呼ぶ設計だった
点からの変更であり、4章・5章の統合（重大2対応）の直接の副産物として、
テナントあたりの上流リクエストを1回減らす（8章）。

### 7.3 `http.rs` への配線（絶対 deadline、重大3対応）

`get_tee_ledger`（`src/course/interfaces/http.rs:618-648`）の
`ExtendCourseInventoryUseCase` 呼び出し（630-640行目）の直後に、同じ
ベストエフォート方針で並べる。ただし重大3対応として、**同期処理全体を
1本の絶対 deadline で包む**。

```rust
/// Absolute budget for the whole rolling-window backfill sync (list +
/// per-course GET/PUT), not per Field call.
///
/// The shared Field HTTP client (`reqwest::Client::new()`, `src/lib.rs`)
/// carries no request-level timeout of its own; individual Field calls in
/// this codebase that do set one use `FIELD_UPSTREAM_TIMEOUT`/
/// `FIELD_REQUEST_TIMEOUT` = 15s per call
/// (`field_gateway.rs`/`field_sdk_capabilities_gateway.rs`). This sync can
/// issue up to `2 + C + k` Field calls per ledger visit (at most `2 + 2C`, §8)
/// — waiting out a slow-but-eventually-successful Field at 15s *per call* would make the
/// ledger's added latency scale with course count. 5s keeps the ledger's
/// worst-case added latency to a small, bounded fraction of a single
/// call's own timeout regardless of `C`, while comfortably covering the
/// steady-state case (a handful of calls at typical Field latency).
const ROLLING_WINDOW_SYNC_DEADLINE: std::time::Duration = std::time::Duration::from_secs(5);
```

```rust
let catalog = catalog_gateway(&state);
if let Err(error) = ExtendCourseInventoryUseCase::new(
    catalog.clone(),
    catalog.clone(),
    commercial_gateway(&state),
    generated_through_gateway(&state),
)
.execute(credentials, &tenant_id)
.await
{
    tracing::warn!(%error, "could not extend the booking window while reading the ledger");
}
match tokio::time::timeout(
    ROLLING_WINDOW_SYNC_DEADLINE,
    SyncRollingWindowOptInUseCase::new(catalog.clone(), catalog, commercial_gateway(&state))
        .execute(credentials),
)
.await
{
    Ok(Ok(_synced)) => {}
    Ok(Err(error)) => {
        tracing::warn!(%error, "could not sync the Field rolling window opt-in while reading the ledger");
    }
    Err(_) => {
        tracing::warn!(
            deadline = ?ROLLING_WINDOW_SYNC_DEADLINE,
            "Field rolling window opt-in sync exceeded its deadline; continuing without it",
        );
    }
}
```

（`catalog` を2回 `clone()` する必要があるため、既存の
`ExtendCourseInventoryUseCase::new(catalog.clone(), catalog, ...)`
の2引数目で `catalog` を消費している箇所を `catalog.clone()` に
変える一手間が生じる。既存コードの意味は変えない。）

設計上の要点（レビュー重大3への直接の応答）:

- **deadline は同期処理全体に1本だけ適用する。** コースごとに
  `tokio::time::timeout` を足し合わせる実装は採らない。コース数が
  多いテナントで「1コースあたりの許容時間 × コース数」に latency が
  比例してしまうと、絶対時間の上限を主張できなくなるため。
- **detached task（`tokio::spawn` で背後に逃がして応答を先に返す）には
  しない。** Lambda はレスポンスを返した後の実行継続を保証しないため
  （AWS Lambda のフリーズ/リサイクルの一般的な性質）、`await` せずに
  切り離すと同期処理が完走しないまま実行環境が凍結・再利用される
  リスクがある。`tokio::time::timeout` で上限を切りつつ、
  `GetTeeLedgerUseCase` の実行前に `await` し切る。
- **個々の Field 呼び出し自身の timeout（15秒、`FIELD_UPSTREAM_TIMEOUT`/
  `FIELD_REQUEST_TIMEOUT`）はそのまま残る。** 今回追加する
  `tokio::time::timeout` はその外側を包む追加の安全弁であり、個別呼び出し
  の timeout を置き換えるものではない（多重の防御）。
- **deadline 超過はベストエフォート失敗として扱う。** `Err(_)`
  （`Elapsed`）を warn ログに変換するだけで、`GetTeeLedgerUseCase`
  （642行目以降）の実行は妨げない。次回の台帳アクセス時に同じ差分が
  また検出され、冪等に再試行される（9章）。
- 「Field が無応答でも所定時間内に `GetTeeLedgerUseCase` へ進む」
  ことを固定するテストを11章に必須項目として追加する。

実装では `run_rolling_window_sync_then` が deadline を引数で受け取り、
本番コードだけが `ROLLING_WINDOW_SYNC_DEADLINE`（5秒）を渡す。テストは
この引数に短い実時間の deadline を渡して無応答を再現するため、
`tokio::time::pause`/`advance` は使わず、`tokio` の `test-util` feature、
`Cargo.toml`、`Cargo.lock` の変更も行わない。

## 8. 実行頻度制御とコスト評価（中2対応）

**結論: 新しいローカルキャッシュ・DBテーブルは追加しない。**
`GET /v1/course/tee-ledger` へのアクセスのたびに実行する。ただし、
`SyncRollingWindowOptInUseCase` 自身が追加する Field への上流リクエスト
数を、定常時・差分時それぞれについて明記する（レビュー中2はこの明記が
欠けていた点を指摘している）。

### 8.1 コース数 `C` 当たりの上流リクエスト数

| 呼び出し | 頻度 | 定常時（差分なし） | 差分時（`k` 件が差分あり、`0 <= k <= C`） |
| --- | --- | --- | --- |
| `get_booking_horizon`（horizon GET） | テナントあたり1回 | 1 | 1 |
| `list_resources`（Field リソース一覧 GET） | テナントあたり1回 | 1 | 1 |
| `sync_rolling_window_opt_in` 内部の schedule GET | コースごとに1回 | `C` | `C` |
| `sync_rolling_window_opt_in` 内部の schedule PUT | 差分があるコースのみ | 0 | `k` |
| `get_tenant_timezone`（timezone GET） | — | **0（呼ばない、7.2節）** | **0（呼ばない、7.2節）** |
| **合計** | | `C + 2` | `C + 2 + k` |

`get_tenant_timezone` を表に明記した上で「呼ばない」としているのは、
当初案（レビューが指摘した時点の設計）ではこれを追加で呼ぶ想定だった
ものを、4.1節・7.2節の gateway 統合によって不要にできたことを明示する
ためである。バックフィルの schedule GET も、重大2対応前の設計では
`replace_resource_schedule` 経由で1コースあたり2回（バックフィル用GET
+ `replace_resource_schedule` 内部GET）になり得たが、4.1節の統合により
差分時でも1回のGET+1回のPUTに収まる。

### 8.2 根拠

- tachyonfield 側の設計は「courseboard がローリング窓の初期利用者で
  あり、1テナントあたり数リソース」という前提に立っている
  （`plt-3361-slot-rolling-window/design.md:363-367`）。CourseBoard
  のテナントは通常1〜数コース（`ExtendCourseInventoryUseCase` も
  同じ前提でコース単位のループを組んでいる、
  `course_schedule.rs:356-366`）であり、追加コストは
  「テナントあたり定数回（horizon GET + list_resources、8.1節）+
  コース数ぶんの schedule GET」に収まる。テナント当たりコース数の
  実測値や上限はコード上の制約ではなく運用上の想定に留まる点は、
  重大3の deadline（7.3節）が「コース数に latency が比例しても
  同期処理自身の追加待ち時間は固定される」という形で吸収する。ただし
  これはバックフィルの完了時間やコース間の公平性を保証するものではない。
- フロントエンドの `GET /v1/course/tee-ledger` 呼び出しは
  `desktop/src/features/golf/ledger/LedgerPage.tsx:207-213` の
  `useResource` フックで日付・コース選択が変わるたびに1回発火する
  設計で、`refetchInterval` のような自動ポーリングは同ファイルに
  存在しない（確認済み: `LedgerPage.tsx` 内に
  `refetchInterval`/`setInterval` の定期再取得は無く、`setInterval`
  は時計表示用の `NOW_TICK_MS`（30秒毎、99行目）のみで API
  呼び出しを伴わない）。したがって「訪問ごと」は「画面を開く・日付を
  変える操作のたび」であり、継続ポーリングではない。
- 差分がない限り PUT は発行しない（`sync_rolling_window_opt_in` が
  `Ok(false)` を返す）ため、定常状態でのコストは `C + 2` 回の GET に
  収束する。書き込みが起きるのは実質「初回オプトイン時」と「運用者が
  `BookingHorizon` を変更した直後の最初の1リクエスト」に限られる。
- `get_booking_horizon`・`get_tenant_timezone` はどちらも Field の
  golf extension config を読む実装だが**別々の GET**である
  （`field_commercial_gateway.rs:241-247` の `read_extension_config`
  と `field_gateway.rs:603-610` の `read_config`）。両者を同時に
  呼べば2回の Field 往復になる。`SyncRollingWindowOptInUseCase` は
  `get_tenant_timezone` を呼ばない（7.2節）ため、この2回化は起きない。
- `ExtendCourseInventoryUseCase` 自体が既に同じ `GET /v1/course/
  tee-ledger` の中で `list_resources` を呼んでいる
  （`course_schedule.rs:355`）。`SyncRollingWindowOptInUseCase` は
  確定事項4によりこのユースケースを直接再利用できないため、
  `list_resources` をもう一度呼ぶ（テナントあたり Field への GET が
  1回増える、8.1節の表に計上済み）。

将来テナントあたりのコース数が数十〜百規模に増える、または
`GET /v1/course/tee-ledger` に自動ポーリングが追加されるなど前提が
変わった場合は、`InventoryWatermark`/`golf_generated_through`
と同型の「`checked_on` が今日ならスキップ」というキャッシュを
別テーブルで追加する再検討ポイントとする。現時点でその複雑さを
先取りする理由はない（本文冒頭の CLAUDE.md 方針「三行の重複は
早すぎる抽象化よりまし」に沿う）。

## 9. Field 側 API のエラー時のフォールバック

- **6章（スケジュール保存経路）**: `replace_resource_schedule` の
  呼び出し自体は従来どおり `?` で伝播する（`course_schedule.rs:139`
  相当）。`rollingWindowDays` の値は6.1節の理由により常に Field の
  受け入れ範囲内（`1..=365` または省略・明示解除）なので、これが原因で
  PUT 全体が失敗することは想定しない。ネットワーク断や Field 側の
  障害で PUT 自体が失敗した場合の挙動は既存のスケジュール保存の
  失敗と同一（操作全体がエラーとして運用者に返る）であり、本タスクで
  新しく壊れる経路はない。
- **7章（台帳フック）**: 3段階でベストエフォートにする。
  1. `SyncRollingWindowOptInUseCase::execute` 全体が
     `credentials.require` や `get_booking_horizon`/`list_resources`
     の失敗で `Err` を返しても、`http.rs` 側は `tracing::warn!` する
     だけで `GetTeeLedgerUseCase` の実行に進む（7.3節）。
  2. コースごとの `sync_rolling_window_opt_in` の失敗（内部の GET・PUT
     いずれが失敗した場合も1つの `Err` として返る、5.4節）は、その
     コースを `continue` 相当でスキップし、他のコースの同期は継続する
     （7.1節のループ本体）。
  3. コースごとの失敗も冪等: 差分がある限り毎回同じ書き込みを試みる
     だけで、次回の台帳アクセス時に同じ差分がまた検出されて再試行
     される（副作用は蓄積しない）。
  4. **同期処理全体が `ROLLING_WINDOW_SYNC_DEADLINE`（5秒、7.3節）を
     超過した場合も同様にベストエフォート失敗として扱い、
     `GetTeeLedgerUseCase` の実行を妨げない**（重大3対応）。
  5. いずれの失敗も台帳の表示 (`TeeLedgerResponse`) の内容には
     影響しない。

## 10. フロントエンド変更の要否: 不要

- `rollingWindowDays` は Field のリソーススケジュール API
  内部の設定であり、CourseBoard の UI が新たに表示・編集する項目を
  必要としない（task.md の骨格・delegated detail のいずれにも
  UI 要求がない）。
- 既存の予約可能期間 UI（`desktop/src/features/golf/ledger/
  LedgerPage.tsx:224-228` が読む `GET /v1/course/booking-horizon`）
  は `BookingHorizon` を見せるだけで、これは本タスクで一切変更しない
  （`GetBookingHorizonUseCase`/`SetBookingHorizonUseCase` は
  確定事項4のとおり無変更）。運用者から見た「受付終端がどこまでか」
  という情報は今までどおり `bookable_through` のまま変わらない。
  `Days(366..=399)` がオプトイン対象外になったことも運用者からは
  見えない（Field 側の内部設定の話であり、`bookable_through` の計算
  自体は変わらないため）。
- `desktop/src/api.ts` 経由の fetch にも変更するエンドポイントはない
  （`PUT .../schedule` 相当の保存は既存の courseboard API
  エンドポイント経由のままで、リクエスト/レスポンスの外部契約
  <sup>※</sup>は変えない）。

<sup>※</sup> CourseBoard の `PUT /v1/course/.../schedule`
相当のエンドポイント自体のリクエスト/レスポンス JSON 形状は変更しない。
`rollingWindowDays` は CourseBoard から Field への PUT ボディにのみ
追加され、CourseBoard の外部 API のレスポンスには現れない。

## 11. テスト計画

既存のテスト慣習（`#[test]`/`#[tokio::test]`、`Fake*` 構造体による
ポートのモック、`Mutex` で呼び出し引数を捕捉、`unimplemented!("not
used")` で無関係なメソッドを埋める、モック axum サーバーで実際の
JSON ボディを検証する）に倣う。中3で指摘された5テスト（古い rules
再送防止・response-only fields 回帰・無応答時の台帳継続・Days↔Through
往復・バックフィル対象フィルタ）はそれぞれ該当する節に明記した。

### 11.1 `schedule.rs`: `BookingHorizon::field_rolling_window_days`

`schedule.rs:264` 以降の既存 `mod tests` に追加。

- `Days(1)`〜`Days(365)` は入力そのものが返る（境界値 1・365・180
  を個別に）。
- `Days(366)`〜`Days(399)`（`MAX_DAYS`）は**すべて `None`**
  （重大1対応、クランプではなく対象外）。
- `Through(date)` は常に `None`。
- 全域プロパティテスト: `MIN_DAYS..=MAX_DAYS` の全 `i64` について、
  返り値が `Some` のとき常に `1..=365` に収まることを検証する
  （6.1節で述べた「PUT 全体を巻き込む 400」を防ぐための回帰テスト）。

### 11.2 `field_gateway.rs`: ボディ組み立て

`mod tests`（1965行目）内、`schedule_save_round_trips_a_field_owned_
unknown_field`（2103-2162行目）と同じ `ScheduleServerState` +
axum モックサーバーの型を使う。

- `schedule_replace_body` の単体テスト（現状この関数に専用のテストが
  無いため新設）: `rolling_window_days` が `None`（外側）のとき
  ボディに `"rollingWindowDays"` キーが存在しないこと、
  `Some(None)` のとき `body["rollingWindowDays"]` が `Value::Null`
  であること、`Some(Some(90))` のとき `json!(90)` であることを
  それぞれアサートする。
- `replace_resource_schedule` の統合テスト（既存テストの隣に追加）:
  モックサーバーの PUT ハンドラが受け取った生の JSON ボディを
  `state.put_body` から取り出し、`rolling_window_days: Some(Some(90))`
  を渡した呼び出しで `body["rollingWindowDays"] == 90` を確認する。
  既存テスト（2148-2159行目）と同様に `rules` 側の既存アサーションも
  壊れていないことを確認する。
- **`sync_rolling_window_opt_in` の統合テスト（新設、モック axum
  サーバー）**:
  - **差分なしで PUT が発行されないこと**: GET モックのレスポンスで
    `rollingWindowDays` が期待値と一致する場合、`sync_rolling_window_
    opt_in` が `Ok(false)` を返し、モックサーバーの PUT ハンドラが
    一度も呼ばれないこと（呼び出し回数アサート）。
  - **古い rules を再送しないこと（中3列挙・重大2の直接回帰テスト）**:
    GET モックのレスポンスにある `rules` の内容が、PUT ハンドラが
    受け取った `rules` と（response-only フィールドを除いて）完全に
    一致することを確認する。加えて、このテストケースでは
    `sync_rolling_window_opt_in` の実行中に GET が**一度しか**発行
    されないことをモックサーバーの呼び出し回数で確認する（GET が
    2回発行される実装に戻る回帰を検知する）。
  - **`FIELD_RULE_RESPONSE_ONLY_FIELDS` を除外し、可変フィールドを
    保持すること（中3列挙）**: GET モックのレスポンスの各ルールに
    `active`・`createdAt`・`updatedAt`・`revision`（response-only）と
    `effectiveFrom`・`effectiveTo`・season・`solarWindow`・未知の
    フィールド（可変）を両方含めておき、PUT ハンドラが受け取った
    ボディで前者が消え、後者がすべて保持されていることを確認する。
  - **`rollingWindowDays` の設定・明示解除**: `rolling_window_days:
    Some(90)` で `body["rollingWindowDays"] == 90`、`None` で
    `body["rollingWindowDays"] == Value::Null` であることを確認する。

### 11.3 `course_schedule.rs`: ユースケース単体

`mod tests`（624行目）内の既存 `FakeSchedules`
（864-915行目）・`FakeCommercial`（917-939行目）・`FakeCatalog`
（`Resource::reconstitute` を使う既存ヘルパー）を再利用・拡張する。

- **`ReplaceCourseScheduleUseCase`（6章）**:
  - `FakeSchedules::replace_resource_schedule` のシグネチャに
    `rolling_window_days` 引数を足し、`Mutex` に捕捉する
    （既存の `timezone_used` と同じパターン）。
  - horizon が `Days(90)` のとき `Some(Some(90))` が渡ることを検証。
  - horizon が `Days(399)`（366..=399 の代表値）のとき `Some(None)`
    （明示解除、クランプではない）が渡ることを検証（重大1対応の
    直接テスト）。
  - horizon が `Through(date)` のとき `Some(None)` が渡ることを検証。
  - `FakeCommercial::get_booking_horizon` が `Err` を返すとき
    `None`（外側、キー省略）が渡り、かつ週の保存自体
    （`saved`/`rules`）は成功し続けることを検証
    （既存の「horizon 取得失敗は保存を止めない」不変条件、
    `course_schedule.rs:126-130` のコメントが指す挙動の直接テスト）。

- **`SyncRollingWindowOptInUseCase`（7章）**:
  - `FakeSchedules` に `sync_rolling_window_opt_in` を追加し、
    コースごとに `Result<bool, CourseError>` を返せるようにする
    （呼び出し引数 `resource_id`・`rolling_window_days` を `Mutex` で
    捕捉）。
  - **未設定→設定**: horizon `Days(90)` のとき、対象コースに対して
    `sync_rolling_window_opt_in` が `Some(90)` 付きで1回呼ばれ、
    `Ok(true)` を返すコースが `synced` に含まれる。
  - **既に一致**: `sync_rolling_window_opt_in` が `Ok(false)` を
    返すコースは `synced` に含まれない。
  - **`Days -> Through` で明示 `null`、`Through -> Days` で数値を送る
    往復テスト（中3列挙）**: horizon が `Through` のとき
    `sync_rolling_window_opt_in` に `None` が渡ることを確認し、続けて
    同じ `FakeSchedules` に対して horizon を `Days(90)` に変えて
    もう一度 `execute` し、今度は `Some(90)` が渡ることを確認する。
  - **399日ホライズンの対象外化**: horizon `Days(399)` のとき
    `sync_rolling_window_opt_in` に `None` が渡ることを確認する
    （`field_rolling_window_days` 経由の統合的な確認、重大1対応）。
  - **複数コースの独立性**: 1コースの `sync_rolling_window_opt_in`
    が `Err` を返しても、他のコースは処理が継続し `synced` に
    含まれる（`ExtendCourseInventoryUseCase` の既存テスト
    `only_the_course_that_was_behind_should_be_built` 相当の書き方
    に倣い、`FakeSchedules` の該当コースだけエラーを返すよう分岐する）。
  - **バックフィル対象フィルタ（中3列挙）**: `is_active() == false`
    のリソース、`kind() != ResourceKind::Course` のリソース、
    `golf_course_id()` が `None` のリソースが、いずれも
    `sync_rolling_window_opt_in` の呼び出し対象から除外される
    （`Mutex<Vec<_>>` に捕捉した呼び出し引数にそのリソースの
    `resource_id` が現れないことをアサートする）ことを、それぞれ
    独立したケースとして確認する。
  - **`MANAGE_COURSES` が無い認可情報**: `credentials.require` が
    失敗し、`Err` が伝播すること（`ExtendCourseInventoryUseCase`
    のテストに認可失敗のケースがあればそれに倣う。無ければ
    `authorizer` を拒否設定にした `GatewayCredentials` で新設）。

### 11.4 `ExtendCourseInventoryUseCase` との併走不変性

`course_schedule.rs` の既存 `mod tests` に、両ユースケースを**同じ
`FakeSchedules`/`FakeCatalog`/`FakeCommercial` インスタンス**に対して
順に実行する統合的なテストを1本追加する。

- 同一の horizon・同一のコース群に対して
  `ExtendCourseInventoryUseCase::execute` →
  `SyncRollingWindowOptInUseCase::execute` の順に呼び、
  前者が書く `watermarks`（`FakeWatermarks`）と後者が
  `FakeSchedules` 内に捕捉する `sync_rolling_window_opt_in` の
  呼び出しが互いに独立して正しく行われることを確認する。
- 呼び出し順を入れ替えても（`SyncRollingWindowOptInUseCase` →
  `ExtendCourseInventoryUseCase`）結果が変わらないことを確認する
  （`http.rs` 側の実行順に依存しないことの保証、7.3節の配線が
  どちらを先に呼んでも安全であることの根拠）。
- `ExtendCourseInventoryUseCase` が呼ぶメソッド
  （`generate_resource_time_slots`）と `SyncRollingWindowOptInUseCase`
  が呼ぶメソッド（`sync_rolling_window_opt_in`）が同じ `FakeSchedules`
  上で互いに干渉しないこと（呼び出し回数がそれぞれ期待どおりで、
  片方の呼び出しがもう片方の `Mutex` 状態を汚さないこと）を確認する。

### 11.5 `http.rs`: 無応答時でも台帳本体へ進むこと（重大3・中3対応、必須）

`get_tee_ledger` のハンドラテスト、または `SyncRollingWindowOptInUseCase`
を注入するオーケストレーション層のテストとして追加する。

- `FakeSchedules::sync_rolling_window_opt_in` を
  注入したテスト用 deadline より長く `tokio::time::sleep` してから返す
  実装に差し替え、`run_rolling_window_sync_then` へ短い deadline を渡して
  実時間を短くしたまま deadline 超過を再現する（`tokio::time::pause`/
  `advance` は使わない）。
- テストの期待値: `tokio::time::timeout` が `Err(Elapsed)` を返し、
  `GetTeeLedgerUseCase` が実行されて `TeeLedgerResponse` が返ること
  （ハンドラ全体が deadline 超過後も正常応答を返す）。
- 併せて、`SyncRollingWindowOptInUseCase::execute` 自体が `Err` を
  返すケース（Field 400 等の即時エラー）でも同様に
  `GetTeeLedgerUseCase` の実行が妨げられないことを確認する
  （9章の3段階ベストエフォートのうち1.の直接テスト）。

### 11.6 実行コマンド

```bash
cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test
```

`cargo test` は TiDB 互換 DB を要求する（`AGENTS.md`）。本タスクは
新しいテーブル・マイグレーションを追加しないため、DB 統合テストの
追加は不要（`GeneratedThroughGateway` 実装
（`generated_through_repository.rs`）に相当する新規リポジトリを
作らない）。

## 12. 変更ファイル一覧（まとめ）

| ファイル | 変更内容 |
| --- | --- |
| `src/course/domain/schedule.rs` | `impl BookingHorizon` に `FIELD_ROLLING_WINDOW_MAX_DAYS` 定数と `field_rolling_window_days`（`Days(1..=365)` のみ `Some`、`Days(366..=399)`/`Through` は `None`）を追加、ユニットテスト追加 |
| `src/course/domain/ports.rs` | `ReservationScheduleGateway` に `sync_rolling_window_opt_in`（読取・差分判定・PUTを一体化）を追加、`replace_resource_schedule` に `rolling_window_days: Option<Option<i32>>` を追加 |
| `src/course/infrastructure/field_gateway.rs` | `FieldResourceScheduleDto` に `rolling_window_days` を追加、GET 経路の共通化（`fetch_resource_schedule_dto`）、`schedule_replace_body`/`replace_resource_schedule` の拡張、`rule_dto_to_put_json`/`rolling_window_sync_body`/`sync_rolling_window_opt_in` の新設、テスト追加 |
| `src/course/usecase/course_schedule.rs` | `ReplaceCourseScheduleUseCase::execute` から導出値を同送、新規 `SyncRollingWindowOptInUseCase` を追加（`get_tenant_timezone` は呼ばない）、テスト追加 |
| `src/course/usecase/mod.rs` | `SyncRollingWindowOptInUseCase` の re-export 追加 |
| `src/course/interfaces/http.rs` | `get_tee_ledger` に `SyncRollingWindowOptInUseCase` 呼び出しを `tokio::time::timeout`（`ROLLING_WINDOW_SYNC_DEADLINE` = 5秒）で包んで追加 |
| `src/course/usecase/create_reservation.rs`<br>`src/course/usecase/mirror_shift_to_field.rs`<br>`src/course/usecase/sync_caddie_shifts_to_field.rs` | `ReservationScheduleGateway` の各テスト用モック実装に、新規メソッドと拡張後のシグネチャを追加（`unimplemented!("not used")` で埋めてよい箇所がほとんど） |

新規マイグレーション・新規 DB テーブル・新規環境変数・新規 HTTP
ルート・新規 authz 分類・フロントエンド変更は無い。

## 13. 第2段への申し送り

task.md の「後続タスク」節のとおり、Field ジョブの workflow サマリーで
`candidates>0`/`generated>0` を確認したのち、別タスクで
`ExtendCourseInventoryUseCase`・ウォーターマーク・台帳フックの撤去と
SCC-35 警告の `generated_through` 取得元の切替を行う。本タスクは
その前段階の「Field 側にも同じ設定を伝える」オプトインのみを行う。

**重大1対応で追加した申し送り事項**: `BookingHorizon::Days(366..=399)`
を設定しているテナントが1つでも存在する限り、そのテナントについては
Field のローリング窓が関与せず、`ExtendCourseInventoryUseCase` のみが
`bookable_through` を、認可成功と上流成功を前提にしたベストエフォート経路
として担い続ける。5秒 deadline と逐次処理は、Field が継続的に遅い場合や
コース数が多い場合に後方のコースを未試行のまま終える可能性があり、
バックフィルの完了時間上限や公平性を保証しない。したがって、肩代わり実装の撤去
（第2段）に着手する前に、**運用中のテナントに `Days(366..=399)` の
設定が残っていないかを確認する**ことをブロッカーとして明記する。
残っている場合は、次のいずれかを選んでから第2段に進む。

- 該当テナントの運用者に `BookingHorizon` を365日以内へ変更してもらう
  （運用上の合意が必要）。
- Field 側に366日以上のローリング窓を表現できる汎用 capability を
  追加してもらう。CourseBoard からゴルフの文脈を剥がした業種非依存の
  contract として Linear（PLT-…）へ起票し、実装を待つ（CLAUDE.md の
  方針どおり、CourseBoard から Field の実装を勝手に書かない）。
- 該当テナントに限り、肩代わり実装を撤去せず併存させる。

いずれも本タスクの範囲外であり、本書では選択肢の提示のみを行う。
