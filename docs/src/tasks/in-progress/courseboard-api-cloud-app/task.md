# courseboard-api Cloud App deployment

## 概要

CourseBoardのRust APIは現行リポジトリで`course-api`として拡張されているが、Tachyon Cloud Appsには旧`quantum-box/tachyonfield-golf`由来の`tachyonfield-golf`しかデプロイされていない。現行`quantum-box/courseboard`から`courseboard-api`を独立したLambda Cloud Appとして登録し、Web hostの`/v1/course/*` BFFから接続できる状態にする。

## スコープ

1. `tachyon.yaml`に`courseboard-api`のCargo Lambda buildを追加する。
2. 既存`courseboard-web`と同じ公開client IDをOIDC audienceとして設定する。
3. productionでは`courseboard`から`courseboard-api`を内部Serviceとして参照する。
4. Build、Deployment、`/healthz`、Web host経由の接続状態を確認する。

## 非ゴール

- 旧`tachyonfield-golf` Cloud Appの削除またはroute切り替え。
- SQLiteに保存される税・キャンセル料データの永続ストレージ移行。
- 実顧客データを使う書き込みAPIの本番テスト。

## 対象

- `tachyon.yaml`
- `Cargo.toml`
- `bin/lambda.rs`
- `desktop/web-host/src/app/v1/course/[...path]/route.ts`

## 関連文書

- [設計](design.md)
- Linear issue: 未作成
- ADR: 既存のCargo Lambda運用を踏襲するため新規作成なし

## 実装フェーズ

1. [x] 現行Cloud App登録・Build・Deploymentを確認する。
2. [x] `courseboard-api` manifestとWeb host接続設定を追加する。
3. [x] manifest dry-runとRust/Web hostの対象チェックを通す。
4. [ ] APIをBuild・Deployし、Web host設定を反映する。
5. [ ] live HTTPと認証済みBFF経由の挙動を確認する。

## 完了条件

- `courseboard-api`のCloud App ID、成功Build ID、active Deployment IDが取得できる。
- `https://courseboard-api.txcloud.app/healthz`が`200`と`{"status":"ok"}`を返す。
- `courseboard` production envに`COURSEBOARD_API_URL`が反映される。
- 未認証の保護APIが成功扱いにならず、認証済みWeb host経由の`/v1/course/*`がAPIへ到達する。

## リスクと保留

- Lambdaの`/tmp` SQLiteは永続ストレージではない。現行のcourse運用データはField側に保持するが、税・キャンセル料の永続化は別タスクで扱う。
- `main`へ未反映のcourse-api変更を先行デプロイする場合、Build対象branchとPRの状態を明示する。
- OAuth client refは既存provider secret driftの検査でapplyが停止したため使わない。APIが必要とする公開client IDだけを既存`tachyonfield-golf`のaudienceと一致させる。
- 初回Buildは成功したが、readiness未指定時は`/`をprobeして失敗した。`/healthz`を明示した後もHTTP 502が継続し、Preview環境に必須envが未反映だったことを切り分けた。Preview設定をapply済みで、競合Buildが保持したLambda alias leaseの失効後に再検証する。
