---
title: "SCC-36 Field ローリング窓へのオプトイン 詳細設計レビュー"
type: "review"
emoji: "🔎"
topics:
  - "golf"
  - "field-integration"
linear: "SCC-36"
published: false
---

# SCC-36 詳細設計レビュー

## 判定

**修正後着手可**。

`Days(1..=365)` の off-by-one、`Through` の明示 `null`、Field 所有ルール属性の往復、既存の認可境界は正しく設計されている。

一方、`Days(366..=399)` の整合、バックフィル PUT によるスケジュール巻き戻し競合、台帳応答を待たせないための時間上限は、実装前に設計を修正する必要がある。

これらは骨格を破棄する問題ではなく、導出不能値の扱い、ポートの書き込み単位、台帳フックの実行予算を確定すれば着手できる。

## 調査範囲

`task.md` は CTO 承認済みの前提として読み、確定事項自体は評価対象にしていない。

`design.md` の主張は、CourseBoard の現行コードと既存テストに照合した。

指定された tachyonfield の作業ツリーには文書が残っていなかったため、同リポジトリの確定版コミット `4296bc2a` から `plt-3361-slot-rolling-window/design.md` と API 実装を読み出して照合した。

## 重大

### 1. `Days(366..=399)` は Field 先端と `bookable_through` を整合させない

`design.md:152-176` は、`Days(n)` の `n > 365` を 365 にクランプし、Field の目標終端が `bookable_through` より最大34日短くなることを認めている。

これは、委譲事項にある「Field の先端が常に `bookable_through` 以上になる導出式」を満たさない。

実コードでは `BookingHorizon::MAX_DAYS = 399` であり、`last_bookable_date(Days(n), today) = today + n` である（`src/course/domain/schedule.rs:183-197,250-254`）。

Field の確定版は `candidate_to = local_today + rolling_window_days` を採用し、API 上限を365としている。

したがって、同じ暦日を使っても次の不等式は避けられない。

```text
n = 399
Field target = local_today + 365
bookable_through = today + 399
Field target < bookable_through
```

`ExtendCourseInventoryUseCase` が差分を埋めるという説明だけでは、この不整合を解消できない。

同ユースケースは `MANAGE_COURSES` を要求し（`src/course/usecase/course_schedule.rs:347-352`）、Field 呼び出しやローカルウォーターマーク更新も失敗し得るため、すべての台帳閲覧で生成を保証する仕組みではない。

後続段階で肩代わり実装を撤去すれば、365日より先の不足は恒久化する。

実装前に、少なくとも次のどれを契約にするか決める必要がある。

- `Days(366..=399)` は `Through` と同様にオプトイン対象外とし、`rollingWindowDays: null` を送る。
- CourseBoard の `Days` 上限を365へ変更し、既存設定と外部 API の移行方針を定める。
- Field に366日以上を表現できる汎用 capability を追加してからオプトインする。

骨格が `1..=365` へのクランプを確定しているためクランプ自体を残す場合でも、「Field と受付終端が整合する」という完了条件にはできない。

その場合は、本タスクの対象を `Days(1..=365)` に限定し、`Days(366..=399)` を第2段のブロッカーとして明記する必要がある。

### 2. バックフィルが並行するスケジュール保存を古い rules で上書きし得る

`design.md:259-275,542-565` のバックフィルは、最初の GET で `(rules, current)` を取得し、差分があればその `rules` を既存の `replace_resource_schedule` へ渡す。

しかし、既存の `replace_resource_schedule` は Field の全置換契約に対応するため、内部でも GET を行ってから PUT する（`src/course/infrastructure/field_gateway.rs:934-967`）。

このため、バックフィルは差分時に `GET A -> GET B -> PUT` となる。

たとえば `GET A` の後に運用者のスケジュール保存が完了すると、`GET B` は新しい rules を読む一方、PUT の編集値には `GET A` 由来の古い `rules` が使われる。

`schedule_replace_body` は `edited` を正としてルール集合を構築するため（`field_gateway.rs:1169-1195`）、新しいルールの追加や削除を巻き戻し得る。

Field の GET レスポンス自体も、`rollingWindowDays` と rules を非スナップショットの別読み取りで構成する契約である。

したがって、1回目の GET のタプルが常に一貫しているという前提も置けない。

既存の GET 直後に PUT する競合窓は骨格が受容した前提だが、設計案はその手前にもう1回の GET とドメイン変換を追加し、競合窓を広げている。

バックフィル用ポートは、設定の読取、差分判定、全置換 PUT を一つの gateway 操作へまとめる必要がある。

その操作は、1回の GET で得た `FieldResourceScheduleDto` の rules から、`FIELD_RULE_RESPONSE_ONLY_FIELDS` だけを除いた PUT 用 rules を構築し、同じ取得値の `rollingWindowDays` と期待値を比較し、差分時だけ直後に PUT する形が妥当である。

このとき、別の時点に取得したドメイン `AvailabilityRule` を編集値として重ねてはならない。

Field に条件付き更新や設定専用 PATCH が無い以上、最後の GET と PUT の競合は残る。

設計には、その残存競合を既存保存経路と同じ既知制約として明記し、少なくとも余分な GET と古い `edited rules` による巻き戻しを増やさないことを不変条件として置くべきである。

### 3. エラーを握りつぶすだけでは台帳表示を妨げない保証にならない

`design.md:591-630` は、同期ユースケースを `GetTeeLedgerUseCase` より前に直列で `await` し、`Err` だけを warn に変換する。

この構造では、Field が応答するまで台帳本体の取得を開始できない。

アプリケーションの共有 HTTP クライアントは `reqwest::Client::new()` で作られており（`src/lib.rs:145`）、この経路にリクエスト全体の timeout は設定されていない。

さらに、同期ユースケースはコースごとの schedule GET を逐次実行するため、遅い応答の待ち時間がコース数に応じて累積する。

定常時でも新規同期が追加する Field 読み取りは、`list_resources` とコース数分の schedule GET だけではない。

設計どおりなら horizon と timezone の取得も別々の上流 GET になり、差分時は各コースで既存 `replace_resource_schedule` 内部の再GETと PUT も増える。

台帳フックに短い絶対 deadline を設け、期限超過を通常のベストエフォート失敗として扱う設計が必要である。

その deadline は同期全体に適用し、コースごとの逐次 timeout を足し合わせる形にしない方がよい。

実装方式を決める際は、レスポンス後の detached task が Lambda の実行継続を保証しない点も考慮する必要がある。

少なくとも、「Field が無応答でも所定時間内に `GetTeeLedgerUseCase` へ進む」ことを handler または orchestration のテストで固定すべきである。

## 中

### 1. 日付境界とタイムゾーンデータの前提が不足している

`design.md:137-150` は、CourseBoard と Field の評価時刻が現地日付境界をまたいだ場合の差を「最大1時間程度」としている。

毎時スケジュールが与えるのは通常時の再試行間隔であり、ジョブ成功の時間上限ではない。

実行失敗や workflow 遅延があれば、実在庫の先端が追いつくまでの時間は1時間を超える。

また、同じ `n` を使えば「同一の `now` で計算した目標日は一致する」が、現地深夜から次の成功ジョブまで「実際に生成済みの Field 先端が `bookable_through` 以上である」とは限らない。

設計では、数式上の目標終端と実際の生成済み先端を区別し、第1段では既存肩代わりが日付境界の一時差分を補うという条件付きの説明に直す必要がある。

さらに、`design.md:123-127` の「同一の実装」という説明は実際の依存関係と一致しない。

CourseBoard は `chrono-tz 0.10.4`、参照した Field 確定版は `chrono-tz 0.8.6` を固定している。

同じ IANA timezone 文字列を使っても、政治的なタイムゾーン規則変更の反映時期が異なれば、境界付近の現地日が一致する保証はない。

通常の `Asia/Tokyo` では実害になりにくいが、設計上は「同じ timezone 文字列と互換な tzdata を使う」を前提として明記するか、少なくともバージョン差が厳密な一致保証を与えないことを記載すべきである。

### 2. 負荷評価はリクエスト数と直列待ち時間を過小評価している

`design.md:639-666` が確認したとおり、LedgerPage は API の定期ポーリングを行っていない（`desktop/src/features/golf/ledger/LedgerPage.tsx:95-102,207-213`）。

この点と、差分が無ければ PUT しない判断は妥当である。

一方、追加コストの算定から horizon GET、timezone GET、差分時の2回目の schedule GET が抜けている。

現行の `get_booking_horizon` と `get_tenant_timezone` は、どちらも extension config を別々に読む実装である。

テナント当たりコース数の実測値や上限もコード上の制約ではなく運用上の想定に留まる。

重大3の deadline と合わせ、定常時と差分時について `C` コース当たりの上流リクエスト数を明記し、許容する根拠を更新する必要がある。

### 3. テスト計画に競合と表示継続の受入条件が無い

既存テストの慣習に関する調査は正しい。

`field_gateway.rs` には axum のモックサーバーで `GET -> PUT` と生 JSON を検証するテストがあり、usecase テストには `Fake*`、`Mutex`、`unimplemented!("not used")` を使う実例がある。

提案された三値、クランプ、差分なし、複数コース独立性、肩代わりとの併走テストも実質的である。

ただし、重大2と重大3を防ぐ次のテストが不足している。

- バックフィルの読取と PUT の間に schedule が更新されても、古い rules を `edited` として再送しないテスト。
- `FIELD_RULE_RESPONSE_ONLY_FIELDS` を除外し、`effectiveFrom`、`effectiveTo`、season、`solarWindow`、未知の可変フィールドを保持する回帰テスト。
- 同期先が無応答または deadline 超過でも、台帳本体の取得へ進むテスト。
- `Days -> Through` で明示 `null`、`Through -> Days` で数値を送る往復テスト。
- inactive、非Course、`golf_course_id` 無しをバックフィル対象外にするフィルタテスト。

実装方式の修正後に、これらをテスト計画へ追加すべきである。

## 軽微

### 1. `Through` の説明は「未設定」ではなく「明示解除」に統一した方がよい

`design.md:241-247` は `Through` を「未設定（null）」と表現している。

Field 契約では、リクエストの省略が維持、明示 `null` が解除、レスポンスの `null` が未設定を表す。

送信意図を説明する箇所では「明示解除（`Some(None)`）」、GET 後の状態を説明する箇所では「未設定（`None`）」と書き分けると、三値の誤読を避けられる。

### 2. `FIELD_ROLLING_WINDOW_MAX_DAYS` の配置をコード例で明確にした方がよい

`design.md:184-207` は定数を `pub const` として示す一方、メソッドから `Self::FIELD_ROLLING_WINDOW_MAX_DAYS` と参照している。

関連定数として `impl BookingHorizon` 内へ置く意図なら、そのコードブロックに `impl BookingHorizon { ... }` を含めると実装者が自由定数として追加する誤読を避けられる。

## 検証済み

### off-by-one とタイムゾーン

Field 確定版の式は `candidate_to = local_today + Duration::days(rolling_window_days)` であり、`-1` は無い。

CourseBoard の `Days(n)` も `today + n` であり、`n <= 365` かつ同じ現地日なら目標終端は一致する。

CourseBoard の `tenant_date_at` と Field の計画関数は、どちらも同じ IANA timezone に `chrono` の `date_naive()` を適用する。

ただし、固定している `chrono-tz` の版は異なるため、同一 tzdata であることまでは検証済みではない。

CourseBoard の保存経路が全ルールへテナント timezone を書くことも、`rule_to_field` と呼び出し元から確認した。

### `Through` と三値契約

`Through` を固定日までの残日数へ変換して Field に設定しない判断は正しい。

固定した日数を設定すると Field が毎日同じ日数だけ先へ進め、シーズン終端を越えて在庫を生成するためである。

スケジュール保存では `Some(None)` を渡して明示 `null` を送る設計になっており、Days から Through へ切り替えたときに古い値を解除できる。

バックフィルでも `current = Some(n)`、`expected = None` のとき `Some(expected) = Some(None)` を渡すため、同じ解除契約を守る。

Through から Days へ切り替えた場合は `current = None`、`expected = Some(n)` となり、数値を設定する分岐へ入る。

省略を解除に使っていない点も正しい。

### rules 全置換契約

現行 gateway は PUT 直前に GET し、既知の編集値を重ねながら Field 所有属性を往復させる。

`FIELD_RULE_RESPONSE_ONLY_FIELDS` の `active`、`createdAt`、`updatedAt`、`revision` は、Field のレスポンスに存在し、`deny_unknown_fields` の PUT 入力には存在しないため、除外リストは現行 Field 契約と一致する。

`effectiveFrom`、`effectiveTo`、season、`solarWindow` と未知の可変属性を deny-list 以外で保持する方針も、Field が可変フィールドを追加した場合の消失を避ける既存方針と整合する。

ただし、この検証結果は重大2の並行更新問題を解消しない。

### 台帳フックと認可

`get_tee_ledger` は既に `ExtendCourseInventoryUseCase` を台帳本体の前に実行し、エラーを warn にして処理を継続する（`src/course/interfaces/http.rs:618-659`）。

新規ルートを追加しないため `course_authz.rs` の `ROUTES` 追加が不要という判断は正しい。

新規同期ユースケースが `MANAGE_COURSES` を要求する設計も、Field 設定を書き換える usecase の防壁として既存の延長処理と一致する。

### 既存テストの慣習

gateway 層には axum モックサーバーで JSON と呼出順を検証するテストがある。

usecase 層には `FakeSchedules`、`FakeCommercial`、`FakeCatalog`、`FakeWatermarks` と `Mutex` による引数捕捉がある。

無関係な trait メソッドを `unimplemented!("not used")` で埋める慣習も確認した。

このため、設計が選んだテストの配置と基本手法は既存コードに沿っている。
