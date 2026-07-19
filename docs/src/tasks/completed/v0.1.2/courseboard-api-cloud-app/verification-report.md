# courseboard-api Cloud App検証報告

## 対象

- tenant: `tn_01ks18jhh1xvggktfzjx5jqsen`
- app: `courseboard-api` / `app_01kxwr0rmr0dt208z7spd2cfk4`
- source branch: `cursor/3c9450c9`
- last deployed source commit: `341dca6fa01a94d2f346175b8c29986c24a32ac0`

## ローカル検証

- `ruby`による`tachyon.yaml` parseとapp名重複確認: 成功。
- `tachyon compute apps apply ... --environment production --dry-run`: 成功。
- `mise exec -- cargo fmt --all -- --check`: 成功。
- `mise exec -- cargo check --locked --bin lambda-courseboard`: 成功。
- `mise exec -- cargo test --locked`: 66 passed、0 failed。
- Web host Vitest: 18 files / 112 tests passed。
- `corepack pnpm --dir desktop/web-host run build`: 成功。
- production相当envでローカルcold startし、`GET http://127.0.0.1:18081/healthz`: `200` / `{"status":"ok"}`。

## Cloud App検証

### 成功

- Cloud App登録: `app_01kxwr0rmr0dt208z7spd2cfk4`。
- 修正後Build: `bld_01kxwtc1sexs37twe1hs5q7xvm` succeeded。
- Build JobRun: `jr_01kxwtc1wz4tvhxzchc6he56gv` succeeded。
- Preview Deployment: `dep_01kxwtf5s7per5s28b1j9z3g0w` active。
- `GET https://pr65--courseboard-api.txcloud.app/healthz`: `200` / `{"status":"ok"}`。
- 未認証の`GET /v1/course/extension-status`: `401` / `unauthorized`。

### 失敗と対応

1. 初回applyはCloud App作成後、既存`courseboard-web` OAuth provider secret driftで停止した。Build履歴とappレコードは削除せず保持した。
2. APIが必要とする公開client IDだけをplain configとして設定し、OAuth provider secretを参照しない形で再applyした。
3. 現行branch Build後のLambda candidate serving smokeは3回失敗した。
   - `dep_01kxwrhd5jqrjyeppzrt9bpq4q`
   - `dep_01kxwrkhrr597e5y03y210q8dm`
   - `dep_01kxwrnq1ky4d5r2r99c16qfxh`
4. エラーは`attempts=8`、`last_error=HTTP 502`、`marker_len=0`。`/healthz`と`"status":"ok"` markerを`readinessProof`へ追加し、次のBuildでは`marker_len=13`になったがHTTP 502は継続した。
5. Preview環境に`DATABASE_URL`、OIDC issuer、audience/client IDが未登録で、Lambda cold startが失敗していた。Preview manifestをapplyし、必須envの登録を確認した。
6. 同時に起動したBuildはすべて成功したが、同じ`preview-pr-65` aliasへのDeploymentが競合した。履歴を残したまま、stuck/pendingの3 Deploymentをcancelした。
   - `dep_01kxwse145yya4m0bstprtt3kr`
   - `dep_01kxwsfjbj5yh4896vgqten1sb`
   - `dep_01kxwshtffkb00tgey2mgwbdq6`
7. cancel後の再Build `bld_01kxwsr6bh54cdte2mj1fgvt4f` は成功したが、Lambda alias leaseのTTL内だったためauto-deployはlease heldで停止した。lease失効後に単一Buildで再検証する。
8. TTL失効後の単一Buildは成功し、candidate smokeを通過してPreview Deploymentがactiveになった。旧Build由来で残った`dep_01kxwstnqnasy39y91kjh4bvjv`は、active Deployment確認後にcancelした。

## 未完了の確認

- main merge後のproduction Buildとactive Deployment。
- `https://courseboard-api.txcloud.app/healthz`のproduction live HTTP 200。
- `courseboard` Cloud Appの`COURSEBOARD_API_URL`反映と再Deployment。
- 認証済みWeb host BFF経由の`/v1/course/*`応答。
- local production PKCE clientでのproduction `courseboard-api`認証済み`200`。

## 2026-07-19 production認証調査

- Cognito Hosted UI loginとtoken refreshは成功した。
- tokenのissuer、client ID、署名key ID、Bearer headerは期待値と一致した。
- active Deployment `dep_01kxxb477qqw937na0wj0h9svm`でも`/v1/course/*`は`401 authorization failed`だった。
- 同じtokenとOIDC設定をローカルの同一Rust検証器へ渡すと`200`となり、本番Fieldのコース2件を取得できた。
- production manifest dry-runはOIDC環境変数の再適用を差分として報告した。変更承認を迂回せず、既知のfirst-party clientをproduction issuer限定でコード側allowlistにも保持する。
- 修正後コードを`EXPECTED_CLIENT_ID=courseboard-web`だけのprovider drift相当設定で起動し、local production PKCE tokenから本番Fieldを参照した。`courses`、`tee-sheet`、`caddie-profiles`、`caddie-assignments`はすべて`200`で、IN／OUTコースとキャディ3名が画面に表示された。

## スキップした確認

- 実顧客データを使う書き込みAPI: 本番データ変更を避けるため未実施。
- SMS送信: 実送信になるため未実施。
