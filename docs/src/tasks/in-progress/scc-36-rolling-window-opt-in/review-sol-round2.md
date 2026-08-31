---
title: "SCC-36 Field ローリング窓へのオプトイン 詳細設計レビュー 第2回"
type: "review"
emoji: "🔎"
topics:
  - "golf"
  - "field-integration"
linear: "SCC-36"
published: false
---

# SCC-36 詳細設計レビュー 第2回

## 判定

**修正後着手可**。

前回の重大1〜3は、実害を生じさせた機構まで遡って修正されている。

新設計にも実装前の再設計を要する問題はない。

以下の軽微修正は実装時に反映し、設計またはコードコメントとテスト計画を一致させること。

1. 5秒 deadline のコメントにある最大呼出数を `2 + C` から `2 + C + k`（最大 `2 + 2C`）へ直す。
2. 仮想時刻テストで `tokio::time::pause` と `advance` を使うなら、`tokio` の `test-util` feature と `Cargo.toml`、`Cargo.lock` の変更を変更一覧へ追加する。依存を増やさない場合は、deadline をテスト時に注入して短い実時間で検証する。
3. 肩代わり実装を「条件なしの保証」とする記述を、認可成功と上流成功を前提にした既存のベストエフォート経路へ直す。5秒 deadline と逐次処理は、Field が継続的に遅い場合やコース数が多い場合に後方のコースを毎回未試行のまま終える可能性があるため、バックフィル完了の時間上限や公平性を保証しないことも併記する。

## 前回の重大指摘

### `Days(366..=399)` の扱い

重大1は解消している。

`BookingHorizon::field_rolling_window_days` は `Days(1..=365)` だけを `Some(n)` にし、`Days(366..=399)` と `Through` を `None` にする（`design.md:238-289`）。

スケジュール保存は、この `None` を外側の `Some` で包んだ `Some(None)` として Field へ渡すため、省略ではなく明示 `null` になる（`design.md:646-689`）。

バックフィル用 gateway は二値の `Option<i32>` を受け、期待値が `None` で現在値が `Some(n)` なら `rollingWindowDays: null` を送る（`design.md:400-419,603-632`）。

したがって、365へのクランプで Field 先端が `bookable_through` より短くなる状態は作られない。

整合保証の対象を `Days(1..=365)` に限定し、`Days(366..=399)` が残る限り第2段の肩代わり撤去へ進まない条件も `design.md:1210-1234` に明記された。

この境界は妥当である。

### rules の巻き戻し競合

重大2は解消している。

新設の `sync_rolling_window_opt_in` は、GET、現在値との比較、必要時の PUT を一つの gateway メソッドに閉じ込める（`design.md:369-419`）。

既存の `replace_resource_schedule` を呼ばないため、前回問題にした `GET A -> GET B -> PUT` は発生しない。

`rule_dto_to_put_json` は、同じ GET が返した `FieldAvailabilityRuleDto` から PUT 用 rules を構築する（`design.md:562-600`）。

既知の必須フィールドと `id` を DTO から入れ、`field_rule_passthrough_fields` で `timezone`、effective range、season、`solarWindow`、Field 所有の可変フィールドを同じ取得結果から重ねる。

この変換では別時点のドメイン `AvailabilityRule` を使わないため、運用者の新しい rules を古い編集集合で巻き戻した前回の機構は除去されている。

`FIELD_RULE_RESPONSE_ONLY_FIELDS` を共通利用し、`active`、`createdAt`、`updatedAt`、`revision` だけを PUT から落とす方針も、確認済みの Field `deny_unknown_fields` 契約と一致する。

Field の全置換 API に由来する最後の GET と PUT の競合は残るが、設計はこれを既存経路と同じ既知制約として限定している。

この残存競合を完全に解消するには Field 側の条件付き更新または設定専用 API が必要であり、SCC-36 が新たに持ち込む欠陥ではない。

### 台帳表示の時間上限

重大3は解消している。

`SyncRollingWindowOptInUseCase::execute` 全体を1本の `tokio::time::timeout` で包み、deadline 超過後も `GetTeeLedgerUseCase` へ進む（`design.md:811-895`）。

コースごとに timeout を足し合わせず、detached task にもしていないため、追加待ち時間の上限と Lambda 上での実行確実性を両立している。

実コードも `field_request` で各 Field リクエストに15秒の timeout を設定している（`src/course/infrastructure/field_gateway.rs:1873-1892`）。

外側の5秒 deadline は、この個別 timeout より先に同期全体をキャンセルする追加の上限として機能する。

GET 中のキャンセルには書き込みがなく、PUT 中に呼び出し側から結果を確認できなくなった場合も、次回 GET が Field の確定状態を読み直す。

書き込む値と rules が冪等であるため、この不確定結果は次回同期で収束できる。

## 新設計の検証

### 三値契約とモード切替

スケジュール保存の `Option<Option<i32>>` とバックフィルの `Option<i32>` は、責務の違いに沿って使い分けられている。

前者だけが horizon 読取失敗時の「省略して維持」を必要とし、後者は期待値を取得できた場合にだけ呼ばれるため「数値を設定するか明示解除するか」の二値で足りる。

`Days -> Through`、`Through -> Days`、`Days(399)` の対象外化をポート引数まで確認するテストも追加されている（`design.md:1109-1125`）。

### DTO から PUT JSON への変換

`FieldAvailabilityRuleDto` の named fields と `#[serde(flatten)] additional_fields` の分担に対し、`rule_dto_to_put_json` の構築順は正しい。

named fields は明示的に JSON へ戻し、それ以外は response-only deny-list を通して追加するため、同じキーを別の時点の値で上書きする経路はない。

GET 一回、PUT 最大一回、差分なしでは PUT ゼロ回というテスト計画も、重大2の回帰を直接検出できる（`design.md:1064-1086`）。

### 5秒 deadline と再試行

5秒という値は、個別 Field timeout の15秒より短く、台帳へ追加する待ち時間を固定する目的に合っている。

同期処理が即時エラーを返す場合と deadline を超える場合の両方で、台帳本体へ進むテストが計画されている（`design.md:1165-1181`）。

ただし、deadline はバックフィルの完了時間を保証しない。

たとえば horizon GET と resource GET、および先頭コースの schedule GET が合計5秒を消費する状態が継続すると、逐次ループの後方コースは毎回未試行になる。

第1段では既存の肩代わりを維持し、想定規模も1〜数コースであるため、この制約は実装を止めるほどではない。

設計上の保証範囲だけは、軽微修正3のとおり正確に限定する必要がある。

### 負荷評価

定常時 `C + 2`、差分 `k` 件のとき `C + 2 + k` という8.1節の表は正しい。

timezone GET を不要にした説明も `rule_dto_to_put_json` の実装案と整合する。

一方、7.3節の定数コメントにある「up to `2 + C` Field calls」は差分時の PUT を数えていない。

これは deadline の正しさには影響しないが、軽微修正1のとおり表と同じ式へ統一する必要がある。

## テスト計画と対応漏れ

前回求めた次のテストは、すべて改訂版へ追加されている。

- 古い rules を再送せず、GET が一回だけであること。
- response-only fields を除外し、PUT 可能な Field 所有属性を保持すること。
- 無応答と即時エラーのどちらでも台帳本体へ進むこと。
- `Days` と `Through` の双方向切替で、数値と明示 `null` を送ること。
- inactive、非Course、`golf_course_id` 無しをバックフィル対象外にすること。

既存の axum モックサーバー、`Fake*`、`Mutex` による引数捕捉を使う配置も現行テストの慣習に沿っている。

ただし、現在の `Cargo.toml` の `tokio` features には `test-util` がない。

このままでは、11.5節が指定する `tokio::time::pause` と `advance` をコンパイルできない。

軽微修正2のいずれかを実装時に選び、テスト手段と変更ファイル一覧を一致させればよい。

## 最終ゲート

重大1〜3、中1〜3、軽微1〜2への対応は、上記の軽微な文言とテスト基盤の補正を除いて完了している。

実運用で rules を巻き戻す経路、365日超を短い窓へ誤ってオプトインする経路、Field 無応答で台帳を無期限に待たせる経路は、いずれも改訂設計から除かれた。

軽微修正1〜3を実装と同時に反映することを条件に、SCC-36 は実装へ進める。
