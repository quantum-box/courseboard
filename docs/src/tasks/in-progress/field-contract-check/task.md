# Field APIとの契約ずれをCIで検知する

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

[ADR-0005](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md) は「Field 側のゴルフ e2e が無くなるため、回帰検知の責任が CourseBoard に移る」と書いているが、受け皿がない。

- CourseBoard の CI は fmt / clippy / test / type-check / Playwright / bundle 検査で、**Field API contract に対するチェックがゼロ**。Field の変更が CourseBoard を壊しても CI では検出できない。
- Playwright の 4 spec は全部モックモードで、Field には一切触らない。
- Field 側は OpenAPI spec を checked-in で持ち、oasdiff で破壊的変更を機械的に落としている。**この spec は CourseBoard から取り込める。**

extension からの撤退では gateway の呼び先を広範囲に書き換える。契約ずれを見つける手段がないまま進めると、壊れたことに本番で気づくことになる。

しかも**依存先が 2 つに増える**。テナント選択をポリシーベースにすると（[ADR-0011](../../../architecture/decisions/ADR-0011-policy-based-tenant-selection.md)）、CourseBoard は Field だけでなく platform の `/v1/me` と `POST /v1/auth/policies/check-tenants` にも直接依存する。**契約の検査対象が 2 リポジトリになる。**

## やること

### 1. 上流の spec を vendor して差分 gate を作る

`contracts/` に Field と platform の spec を取り込み、CI で「CourseBoard が実際に呼ぶパス」だけを突き合わせる。呼ぶパスは `src/course/infrastructure/*.rs` の path 定数から抽出する（Field 側は実測で 32 パス）。

platform 側は `/v1/me`（レスポンスの `platform_id` と階層上の役割を読む）と `POST /v1/auth/policies/check-tenants`（リクエスト body が余計なキーを許さないので、形が変わると 400 になる）の 2 本。

チェックするのは 2 つだけでよい。

- 呼ぶパスが spec に存在すること
- レスポンスのうち CourseBoard が読むフィールドが spec に存在し、必須かどうかが変わっていないこと

`src/field_proxy.rs` の allowlist にハードコードされたパスも同じ抽出に含める。allowlist の更新を忘れると 403 ではなく 404 で落ちて原因が見えにくいので、ここで先に捕まえる。

vendored spec の更新は手動 PR にする。Field が壊す変更を出したとき、更新 PR が赤くなる形で見える。追随の自動化は後から足せばよい。

### 2. スタブFieldを契約テストに育てる

`src/course/interfaces/persistence_tests.rs` の `FieldState` は「CourseBoard が書いたものを覚えて返す」だけのスタブになっている。ここに vendored spec 由来の検証を足し、スタブが受けた body と返す body を schema で validate する。

上流の実装バグは捕まらないが、CourseBoard 側の思い込みは全部捕まる。gateway の書き換えで最も効く。

### 3. 本番スモークをCIに組み込む

`desktop/e2e` は `E2E_TARGET=prod` で実環境に対して回せる仕組みを既に持っているが、CI には入っていない。撤退の各段階のデプロイ直後に、全ルートへ直アクセスして 404 と JS エラーがないことを確認する spec を sandbox テナントに対して回す。

テナント選択の付け替えは**サインインそのもの**を変えるので、ここが特に効く。

## 完了条件

- Field と platform の spec が vendor され、CourseBoard が呼ぶパスの存在と読むフィールドの必須性が CI で検査される。
- `field_proxy.rs` の allowlist が同じ検査の対象になっている。
- スタブ上流が request / response を spec で validate する。
- デプロイ後に全画面が開くことを確認するスモークが回る。
