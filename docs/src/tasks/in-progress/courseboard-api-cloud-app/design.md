# courseboard-api Cloud App設計

## 背景

`courseboard` Cloud AppはCloudflare Workers上のWeb hostだけをデプロイしている。Web hostには`/v1/course/*`をRust APIへ転送するBFFが実装済みだが、productionの`COURSEBOARD_API_URL`が未設定であり、現行CourseBoardリポジトリのRust APIもCloud Appとして登録されていない。

## 採用案

- app名は`courseboard-api`とし、同じ`quantum-box/courseboard`リポジトリをsourceにする。
- runtimeは既存Rust Lambdaと同じ`cargo_lambda` / `arm64`を使い、binaryは`lambda-courseboard`とする。
- candidate serving smokeは静的UIへredirectする`/`ではなく、API固有の`/healthz`と`"status":"ok"` markerで判定する。
- Web hostからはproductionで`internalService.appName: courseboard-api`を解決し、previewのみ公開`txcloud.app` URLを使う。
- APIのOIDC issuerは既存Cognito user pool、audience/client idは`courseboard-web`と同じ公開client IDとする。OAuth provider secretは参照・変更しない。
- Field APIはproductionで`tachyon-field-api` internal service、previewで公開URLを使う。

## 代替案

- 旧`tachyonfield-golf`を更新する案は、repositoryとapp identityが旧実装に固定されているため採用しない。
- Rust APIをWeb host Workerへ同梱する案は、Rust/Axum/Lambdaの既存実装と運用を大きく変えるため採用しない。
- public URLだけでservice間通信する案は、既存Cloud Appの内部Service解決と整合せず、Cloudflare経由の制約もあるためproductionでは採用しない。

## データとセキュリティ

保護APIは既存OIDC JWT検証を継続し、Cloud App login gatewayは有効化しない。OAuth client secretやprovider credentialはmanifestに直接記述しない。`/tmp` SQLiteはLambda instance内の一時領域であり、永続性が必要な税・キャンセル料データの保存先にはしない。

## Rollout

1. `courseboard-api`だけをdry-run/applyする。
2. 現行作業branchを指定してBuildを起動し、active Deploymentと`/healthz`を確認する。
3. `courseboard`をdry-run/applyして`COURSEBOARD_API_URL`を内部Service参照へ更新する。
4. Web hostをBuild・Deployし、BFF経由の接続を確認する。
5. 旧`tachyonfield-golf`は削除せず、互換利用の調査後に別タスクで扱う。

## 検証

- YAML parseとCloud Apps dry-run。
- `cargo fmt --check`、`cargo check --locked`、`cargo test --locked`。
- Web hostのcourse API proxy対象テストとbuild。
- API public health、保護routeの未認証拒否、認証済みWeb host BFFの実レスポンス。
