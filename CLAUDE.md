# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CourseBoard は TACHYON Field 上のゴルフ場向け Cloud App。Rust + axum の API（`src/`、Lambda）と React 19 + Vite の SPA（`desktop/`、Workers static assets / Tauri）を 1 リポジトリで持つ（`tachyon.yaml`）。

## tachyonfield と CourseBoard の責務分担

**ゴルフのドメイン知識は CourseBoard が単独で所有し、Field は業種非依存の汎用 ERP capability だけを提供する**（ADR-0005）。

| | 所有するもの |
|---|---|
| **CourseBoard** | ゴルフの語彙（キャディ、ラウンド、ティータイム、OUT/IN、組、セルフ/キャディ付き）、計算（料金シミュレーション、キャディフィー、月次精算、予算達成率、自動配置、需給）、運用ルール値（セルフロック時間帯、客単価閾値、グレード判定、税ルール）、ゴルフ運用 UI、Field の汎用モデルにゴルフの意味を与える anti-corruption layer |
| **Field** | 予約 / 予約商品 / 枠 / リソース、スタッフ profile・配置・出勤可否・出退勤・評価（HRM）、日別予算の汎用構造、extension lifecycle と config、予約時の**汎用**ポリシーガード機構（値と意味づけは CourseBoard が供給） |

- **ゴルフ場の知識を Field 側に入れない。** ゴルフの語彙・業務ルール・計算を Field に実装するのは常に間違い。二重管理になり、どちらが正か分からなくなる。
- **Field に足りない汎用機能が必要になったら、Field 側の実装は CourseBoard から勝手に書かず issue を立てる。** ゴルフの文脈を剥がした業種非依存の contract として起票し、CourseBoard 側はその Field 実装を待つか、gateway 側で暫定対応する。既存の taskdoc（`docs/src/tasks/`）と同じく Linear（PLT-…）で管理する。
- データは Field DB に残す。CourseBoard への物理移送はしない。CourseBoard 自身の DB が持つのはゴルフ利用税マスタとキャンセル料 collection だけ。
- **CourseBoard の利用者は Field UI を触らない。** ゴルフ運用は CourseBoard で完結させる。Field admin を開かないと終わらないフローを設計しない。
- ゴルフ固有の状態は汎用 staff の metadata ではなく caddie / golf extension 側に置く。Field staff への紐付けは可、Field で編集させるのは不可。

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
- 認証は inbound の Cognito access token を OIDC 検証し、**同じ bearer をそのまま Field へ転送**する。`/v1/course/*` は `x-operator-id`（= テナント ID、必須）と `x-platform-id`（prod / sandbox の不一致で Field が 403）を要求する。
- 上流起因の失敗は 5xx ではなく **424 `provider_error`**。Cloudflare が origin の 5xx を CORS ヘッダの無い HTML に差し替え、ブラウザに "Failed to fetch" しか届かないため。
- 設定は `src/config.rs` の `RuntimeConfig` に集約。module から `env::var` を直接呼ばない。
- 認可はフェイルクローズド。新しいルートを足したら `src/course_authz.rs` の `ROUTES`（と同ファイルのルート網羅テスト）に分類を足す。未分類の登録済みルートは 403 になる。CourseBoard ローカル DB を触るルートは `field_extension_golf:*` action、Field を呼ぶルートは `UpstreamEnforced`。
- UI の fetch は `desktop/src/api.ts` 経由。Tachyon platform API を直接叩かない（ADR-0004、CI が bundle を検査）。
- `README.md` / `.env.example` の SQLite 記述は古い。実体は MySQL/TiDB。

commit message は日本語の conventional commits。ADR は `docs/src/architecture/decisions/`、進行中の作業は `docs/src/tasks/in-progress/<slug>/`。
