# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CourseBoard は TACHYON platform 上で動くゴルフ場向けの独立した Cloud App。Field の汎用 ERP capability を API 経由で利用するが、**Field の extension ではない**（ADR-0010）。Rust + axum の API（`src/`、Lambda）と React 19 + Vite の SPA（`desktop/`、Workers static assets / Tauri）を 1 リポジトリで持つ（`tachyon.yaml`）。

## tachyonfield と CourseBoard の責務分担

**ゴルフのドメイン知識は CourseBoard が単独で所有し、Field は業種非依存の汎用 ERP capability だけを提供する**（ADR-0005）。

| | 所有するもの |
|---|---|
| **CourseBoard** | ゴルフの語彙（キャディ、ラウンド、ティータイム、OUT/IN、組、セルフ/キャディ付き）、計算（料金シミュレーション、キャディフィー、月次精算、予算達成率、自動配置、需給）、運用ルール値（セルフロック時間帯、客単価閾値、グレード判定、税ルール）、ゴルフ運用 UI、Field の汎用モデルにゴルフの意味を与える anti-corruption layer |
| **Field** | 予約 / 予約商品 / 枠 / リソース、スタッフ profile・配置・出勤可否・出退勤・評価（HRM）、日別予算の汎用構造、extension lifecycle と config（**CourseBoard は使わない**、下記）、予約時の**汎用**ポリシーガード機構（値と意味づけは CourseBoard が供給） |

- **ゴルフ場の知識を Field 側に入れない。** ゴルフの語彙・業務ルール・計算を Field に実装するのは常に間違い。二重管理になり、どちらが正か分からなくなる。
- **Field に足りない汎用機能が必要になったら、Field 側の実装は CourseBoard から勝手に書かず issue を立てる。** ゴルフの文脈を剥がした業種非依存の contract として起票し、CourseBoard 側はその Field 実装を待つか、gateway 側で暫定対応する。既存の taskdoc（`docs/src/tasks/`）と同じく Linear（PLT-…）で管理する。
- **CourseBoard は Field の extension を使わない**（ADR-0010）。extension config・extension-scoped path・extension 有効判定のいずれにも依存しない。設定の置き場は 2 択で、**ゴルフ固有なら CourseBoard ローカル DB、業種非依存なら Field に汎用 capability を起票して待つ**（ADR-0009）。「受け皿ができるまで暫定的に extension config へ置く」は選ばない。Field の extension framework 自体の存廃は Field の判断で、CourseBoard から廃止を求めない。
- **テナント選択はポリシーで絞る**（ADR-0011）。CourseBoard の業務ポリシーが付与されたテナントだけが一覧に出る。**ポリシーの付与が契約の実体**であり、付与漏れは「そのテナントが一覧に出ない」形で現れる。
- 予約・スタッフ・商品・請求といった汎用 ERP レコードの正は Field DB に残す。Field から CourseBoard への物理移送はしない。一方、Field が持つべきでないゴルフ固有の設定・ルール・運用状態は CourseBoard ローカル DB が持つ（利用税マスタ、グレード閾値、キャンセル料 collection、確定シフトとシフト規則、スロット上書き、希望提出の締切、枠生成の水位）。これは Field からの移送ではなく最初から CourseBoard 側で持ち直すもので、上の物理移送禁止とは別の話（ADR-0009）。
- **CourseBoard の利用者は Field UI を触らない。** ゴルフ運用は CourseBoard で完結させる。Field admin を開かないと終わらないフローを設計しない。
- ゴルフ固有の状態は汎用 staff の metadata ではなく CourseBoard 側に置く。Field staff への紐付けは可、Field で編集させるのは不可。

## Commands

```bash
cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test
cd desktop && npm run type-check && npm run test
```

`cargo test` は MySQL 互換 DB を要求する（CI は TiDB）。既定は `127.0.0.1:4000` / `root` / `courseboard_test`、`COURSEBOARD_TEST_DB_{HOST,PORT,USER,PASSWORD,NAME}` で上書き。

```bash
docker run --rm -d -p 4000:4000 --name courseboard-tidb pingcap/tidb:v8.5.7
```

ローカル起動は mise task が正（詳細は `desktop/README.md`）。

```bash
mise run courseboard:pkce-env   # env 生成
mise run courseboard:api        # :8080 course-api（bacon hot-reload）
mise run courseboard:vite       # :5173 Vite
```

**ローカルの dev server を止めない。** :8080 / :5173 や bacon に対する `pkill` / 再起動は、ユーザーが明示的に依頼したときだけ。診断（`lsof -i :8080`）に留めて報告する。

## 実装上の要点

- 新しいゴルフドメインは `src/course/`（domain / usecase / infrastructure / interfaces の 4 層）に足す。`src/` 直下のフラット module は旧世代。
- 認証は inbound の Cognito access token を OIDC 検証し、**同じ bearer をそのまま Field へ転送**する。`/v1/course/*` は `x-operator-id`（= テナント ID、必須）と `x-platform-id`（prod / sandbox の不一致で Field が 403）を要求する。テナント一覧だけは Field ではなく platform（`/v1/me` と `POST /v1/auth/policies/check-tenants`）から取る（ADR-0011）。この 2 本には**スコープのヘッダを付けない**。
- 上流起因の失敗は 5xx ではなく **424 `provider_error`**。Cloudflare が origin の 5xx を CORS ヘッダの無い HTML に差し替え、ブラウザに "Failed to fetch" しか届かないため。
- 設定は `src/config.rs` の `RuntimeConfig` に集約。module から `env::var` を直接呼ばない。
- 認可はフェイルクローズド。新しいルートを足したら `src/course_authz.rs` の `ROUTES`（と同ファイルのルート網羅テスト）に分類を足す。未分類の登録済みルートは 403 になる。CourseBoard ローカル DB を触るルートは `field_extension_golf:*` action、Field を呼ぶルートは `UpstreamEnforced`。
- `field_extension_golf:*` は名前に反して **Tachyon Auth の独立した action 名前空間**で、Field の `tenant_extensions` とも extension の有効・無効とも無関係（`src/course_authz.rs` は `POST /v1/auth/policies/check` を直接叩く）。extension を使わなくなっても認可は 1 行も変わらないので、この名前は維持する。**実質の防壁は usecase 冒頭の `require(actions::…)`** で、Field 側の認可経路は extension も細かい action も見ていない。新しい usecase を書くときはここが穴になりやすい。
- UI の fetch は `desktop/src/api.ts` 経由。Tachyon platform API を直接叩かない（ADR-0004、CI が bundle を検査）。
- `README.md` / `.env.example` の SQLite 記述は古い。実体は MySQL/TiDB。

commit message は日本語の conventional commits。ADR は `docs/src/architecture/decisions/`、進行中の作業は `docs/src/tasks/in-progress/<slug>/`。
