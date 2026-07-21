# Courseboard human token issuer の Cognito 統一

## Links

- [ADR-0003](../../../../architecture/decisions/ADR-0003-cognito-human-token-issuer.md)
- [Tachyon Apps Issue #6998](https://github.com/quantum-box/tachyon-apps/issues/6998)

## 概要

Courseboard React/Tauriの人間ユーザーloginとrefreshをTachyon JSON PKCEから
secretなしCognito public clientの直接利用へ切り替える。Hosted UIとAmplifyは使わない。

## Scope

- `BrowserPkceAdapter`の内部をCognito `USER_PASSWORD_AUTH` / `REFRESH_TOKEN_AUTH`へ変更する。
- production/local manifestと設定生成をCognito issuerへ戻す。
- Courseboard APIの既存Cognito issuer/client allowlist検証を利用する。
- Tachyon発行access tokenをFieldへ送らない。

## Plan

- [x] Cognito直接auth adapterとunit testを追加する。
- [x] browser adapterのlogin/refreshをCognitoへ切り替える。
- [x] `tachyon.yaml`のfrontend/API issuer設定をCognitoへ変更する。
- [x] local設定生成をCognito issuer/client契約へ変更する。
- [x] READMEと移行時の名称を更新する。
- [x] frontend/API test、build、formatを実行する。
- [x] headed browserで実ユーザーloginとproduction Field endpointを確認する。

## Verification results

- frontend type check、121 unit tests、production buildが成功した。
- Courseboard APIのfmt、clippy、69 unit tests、buildが成功した。
- headed browserでCognito実ユーザーlogin、`/v1/me` 200、tenant選択を確認した。
- Cognito access tokenのissuer、`token_use=access`、許可client IDをtoken本体なしで確認した。
- local Courseboard APIのcourse endpointが200になり、production Field course一覧も200（2件）になった。

## Security

- browser bundleへclient secretを入れない。
- API BearerにID tokenを使わない。
- provider error、password、access/refresh tokenをログへ出さない。
- issuer、署名、expiry、`token_use=access`、client ID allowlistを緩和しない。
