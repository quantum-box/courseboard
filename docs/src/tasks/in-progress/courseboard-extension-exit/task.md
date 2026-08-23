# CourseBoardをField extensionから切り離す

## 現状

CourseBoard は Field の `golf_course` extension を 3 つの意味で使っている。設定と運用データの保存先、`/v1/erp/extensions/golf-course/*` のドメインルート、テナント選択のフィルタ。

このうち後者 2 つは、調べてみると**思っていたほどの仕事をしていなかった**。

- 認可の `field_extension_golf:*` は Tachyon Auth の独立した名前空間で、`tenant_extensions` に依存していない。名前に反して extension の有無と無関係に動く。
- Field 側の認可経路も `tenant_extensions` を読んでいない。見ているのは JWT のメンバーシップ、Tachyon Auth のポリシー、platform と operator の親子関係の 3 つ。**extension をやめてもセキュリティは後退しない。**
- `tenant_extensions` が実際にやっているのは「テナント選択のフィルタ」と「config の保管」だけ。
- `/field-api/*` proxy の extension allowlist 4 行は、desktop の非モックコードから呼ばれておらず既に dead。

一方で **Field の extension framework 自体は廃止できない**。公開ストアフロントの商品カタログ、予約通知メールのテンプレート、公開申込フォームの定義という、ゴルフとも業種拡張とも無関係な汎用機能が同じテーブル群を唯一の保存先にしている。extension を消すと業種拡張より先にこの 3 つが壊れる。これは Field の問題で、CourseBoard から一方的に廃止を求めるものではない。

したがって**CourseBoard 側だけ先に剥がす**。決定は [ADR-0010](../../../architecture/decisions/ADR-0010-courseboard-is-not-a-field-extension.md)（extension を使わない）、[ADR-0009](../../../architecture/decisions/ADR-0009-extension-config-is-not-a-data-store.md)（config は保存先にしない）、[ADR-0011](../../../architecture/decisions/ADR-0011-policy-based-tenant-selection.md)（テナント選択はポリシー）。

ゴルフドメインの移行そのものの進捗は [ADR-0005](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md) にある。Phase 2 は完了、Phase 1 は 7 系統中 5 系統が完了していて、残りは月次精算と予算達成率の 2 つ。

## 着手前に確かめること

コードを 1 行も書く前に片付ける。どれも安く、外すと設計の前提が崩れる。

- **Cognito の access token で `POST /v1/auth/policies/check-tenants` が通るか。** このエンドポイントは呼び出し元が人間のユーザーであることを要求する。sandbox に curl 1 本で確認できる。通らないとテナント選択の設計が成り立たない。
- **本番で config 保存が 403 になっているか。** ロール割当を読む。撤退の優先順位を決める材料で、机上では決まらない。
- **全ての予約商品が販売可能リソースを宣言済みか。** Field の公開ストアフロントは、未宣言の商品にだけ legacy のゴルフ用 key を読む。全商品が宣言済みなら、その key を config から落とせる。
- 預り金比率が Field の予約ポリシーテーブルと config で一致しているか。config 側だけ編集されて Field 側が初期値のまま、という状態がありうる。

## 実行順序

### 第0波 — 安全装置（Field 待ちなし）

**1. タイムゾーン Provider の耐障害化。最優先・単独 PR。**

`desktop/src/context/TenantTimezoneProvider.tsx` が全ページを包んでおり、解決に失敗すると throw し、ロード中は読み込み表示しか返さない。つまり **`/v1/course/extension-status` が取れないと UI が一切描画されない**。既定値で継続して警告を出す形に変える。

これが入っていれば、以降どの手順で API が失敗しても全画面ブラックアウトにならない。この PR 単体で今日の障害耐性が上がる。

**2. 商品枠の書き込みを照合つきの経路へ。**

`replace_product_slots` は読んで書くだけの生 PATCH で、書き戻しの照合もリトライも無い。しかも Field 側の枠取り込み処理が同じ配列を書く。**現時点で最も確実に失われる経路**で、既存のリトライ付きヘルパを通すだけで直る。

### 第1波 — ローカル DB への移送（Field 待ちなし）

コース並び順から始める。**最も移しやすく、間違えても被害が並び順だけに閉じる**ので、migration → repository → port → DI → usecase → 認可という 1 周をここで通す。

次にランク単価。**読み取りは 3 段のフォールバックが必須**（ローカル → config → 既定値）。単純に既定値へ落とすと、設定済みの単価が黙って戻ったまま給与計算がその金額で走る。

次に予約ポリシーの写しを削除し、シミュレータ画面の該当フォームを既存の予約ポリシー API へ付け替える。

最後に料金シミュレータの前提と表示設定。**都道府県が無いと料金計算が 400 で落ちる**設計なので、取りこぼすと料金画面が死ぬ。

DDL はシフト規則テーブルの流儀に揃える。テナントで一意、全カラムに既定値、既定値は「その列が無かった頃の挙動」を再現する値、外部キーは張らない、なぜ Field ではなく CourseBoard に置くのかを SQL コメントに ADR 参照つきで書く。コース ID やラベルは CSV に畳まず行に分ける。

### 第2波 — 新しい設定 API と UI の切替

`GET/PUT /v1/course/tenant-settings` を足し、読み手 4 画面を切り替える（**キャッシュキーを共有しているので同一 PR で全部**）。次に書き手 2 画面。そのあと extension status のレスポンスから config を落とし、**`PATCH /v1/course/config` を完全に廃止する**。ルートが残る限りどこかの画面がまた使う。

この時点でブラウザが config 全体を往復する経路が消える。

新しい API の契約で最も大事なのは、**行が 1 本も無いテナントでも 200 と既定値を返すこと**。404 も null も返さない。これがタイムゾーン Provider を throw させない条件になる。

### 第3波 — 外部帳票の日別集計

9 系統で唯一、読み取り時のフォールバックでは済まない。設定値ではなく履歴データで、2 つのストアに同じ日付の答えが並ぶと、どちらが新しいかを誰も維持できない。

一回限りの移送コマンドを `bin/` に足し、seed → 検証 → 切替 → legacy 削除の一方向で進める。dual-write はしない。**この key だけは切替後に config から明示的に消す**（config の大きさを支配していて、台帳を開くたびに転送されているため）。

### 第4波 — テナント選択の付け替え

まず `decode_and_filter_profile` を寛容にする。今は extension ブロックが欠けていると 502 を返すので、**Field が返さなくなった日に全ユーザーがサインイン不能になる**。欠落を「除外扱い」に落とすだけで、Field 側のデプロイ順への依存が消える。純粋な緩和なので即日出せて revert も自明。

そのうえで新方式をフラグ配下に足し、**新旧の絞り込み結果を比較するモードを本番で最低 1 営業週回す**（週 1 回しか触らないロールを拾うため）。旧方式にしか出ないテナントがあれば、それは今日動いているテナントがアクセスを失う意味なので、直し方はコードではなくポリシーの付与になる。差分が消えたら切り替え、1 締め経過してから Field 呼び出しを消す。

代表 action は `field_extension_golf:ListTeeSheet`。業務ロールが共通して持つ action のうち、アプリの正面玄関にあたるもの。**スコープのヘッダは付けない**（付けると 2 つ目のプラットフォームへの問い合わせが 400 になる）。

絞り込みに失敗したときは絞らずに返してフラグを立てる。UI 側に受け口が既にある。後続の API がそれぞれ独立に認可するので、テナント一覧は認可の境界ではなく発見の手がかりである。

副産物として、`platform_id` を埋めるための往復と 20 件の打ち止めが消える。**21 件目以降のテナントが使えないという現存のバグが直る。**

### 第5波 — Field 待ち

予約商品の**ゴルフ key だけ先に分割する**（プレー種別・ホール数・対象コース・1 組の上限人数は Field が読んでいない）。汎用の形状は Field の商品テーブルを待つ。

**タイムゾーンを商品配列より先に抜かない。** Field のストアフロントは「config に商品配列があること」を条件にタイムゾーンを解決しているので、先に抜くと公開サイトの日付が黙って既定値に落ちる。

## Fieldに起票する

ゴルフの語彙を 1 つも含まない形で。詳細は [design.md](./design.md)。

- **予約商品を汎用テーブルと CRUD API で持つ** — 本件の最長ポール。所有アプリだけが解釈する不透明な属性 JSON を持てること、「販売可能リソースを宣言したうえで対象 0 件」と「未宣言」が区別されることを受け入れ条件に入れる。
- **テナントのタイムゾーンを汎用属性として持つ** — 解決が商品配列の存在に依存しないこと。
- **予約の受付可能期間を汎用設定として持つ**。
- **予約一覧に期間フィルタとページング契約を足す** — 単独で最も価値が大きい。現状は全件取得の上に台帳・ティーシート・需給・精算・達成率が全部乗っている。

config の単一キー更新と権限分離も起票してよいが、**依存させない**。撤退が完走すれば不要になる緩和策である。

## Field側の実行設計について

Field のテーブルとルートをどう汎用化するかは Field の実行設計であり、CourseBoard のリポジトリで維持すると陳腐化する。調査で分かったことは [design.md](./design.md) の末尾に 1 節で残し、**Field 側へ移す前提**にする。CourseBoard 側の関心は「extension path を呼ばなくなること」だけで、それは [field-extension-path-exit](../field-extension-path-exit/task.md) が持つ。

## 子タスク

- [extension configから撤退する](../extension-config-exit/task.md)
- [テナント選択をポリシーで行う](../tenant-selection-policy-check/task.md)
- [PR previewを本番Fieldから切り離す](../preview-field-isolation/task.md)
- [Field APIとの契約ずれをCIで検知する](../field-contract-check/task.md)
- [旧admin画面と素通しproxyの認可を塞ぐ](../admin-ui-retirement/task.md)
- [Field依存の残骸を消す](../dead-field-coupling-cleanup/task.md)
- [月次精算と予算達成率をCourseBoardで計算する](../phase1-settlement-achievement/task.md)
- [Fieldのextension path依存を外す](../field-extension-path-exit/task.md)

## 完了条件

- CourseBoard が `/v1/erp/extensions/*` を 1 本も呼ばない。ただし予約商品の汎用部分だけは Field の商品テーブルができるまで例外として残り、それを明示的に記録している。
- ブラウザに configJson が渡らない（`grep -rn "configJson" desktop/src` がヒットゼロ）。
- テナント選択がポリシーで行われ、切替前に「extension が有効なテナント」と「ポリシー付与済みのテナント」の突き合わせが済んでいる。
- タイムゾーンの解決に失敗しても画面が描画される。
