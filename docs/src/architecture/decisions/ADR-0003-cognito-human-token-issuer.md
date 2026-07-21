# ADR-0003: Courseboardの人間ユーザーtoken issuerをCognitoに統一する

## Status

Proposed (2026-07-21)

## Context

Courseboardの旧Next.js/Auth.js経路はCognito access tokenを使用していたが、
React/Vite移行時にplatform-ui互換のTachyon JSON PKCEへ切り替えた。その結果、
Cognitoがpasswordを検証した後にTachyonが別のaccess / refresh tokenを発行し、
Courseboard APIとFieldで二つのissuerを扱う必要が生じた。

local Courseboard APIはTachyon tokenを検証できた一方、production Fieldが利用する
`/auth/v1beta/verify`は既存Cognito検証経路で401となった。Fieldをdual issuer対応に
すると、Tachyon独自issuerの鍵、claim、audience、refresh、失効契約を恒久的に
維持する必要がある。

## Decision

Courseboard Web/Tauriの人間ユーザーtokenはCognito User Poolだけが発行する。

- React内password formからsecretなしpublic Cognito App Clientへ
  `USER_PASSWORD_AUTH`と`REFRESH_TOKEN_AUTH`を直接実行する。
- Cognito Hosted UI、Amplify、client secretを使用しない。
- API BearerにはCognito access tokenだけを使う。
- `courseboard-api`はCognito issuer、JWKS署名、expiry、`token_use=access`、
  public client ID allowlistを検証する。
- Tachyon `/v1/me`はCognito access tokenから既存Tachyon Userを解決する。
- 旧`browser-pkce` modeはローカル設定移行用aliasとして当面受け付けるが、
  実処理はCognito直接認証とする。

ADR-0002のReact SPA、独立courseboard-api、非Hosted UIという判断は維持する。
同ADRのTachyon JSON PKCEを使う部分だけを本ADRでsupersedeする。

## Consequences

- Fieldへ渡すtokenとCourseboard APIが検証するtokenがCognitoへ統一される。
- Tachyon独自issuerをFieldへ追加する変更は不要になる。
- React/TauriはCognito AWS JSON protocolの小さなadapterを持つ。
- public clientは`ALLOW_USER_PASSWORD_AUTH`と`ALLOW_REFRESH_TOKEN_AUTH`が必要になる。
- 既存localStorage session keyはsession移行を壊さないため名称を当面維持する。

## Alternatives Considered

- FieldをTachyon/Cognito dual issuer対応にする: 独自issuer保守を増やすため不採用。
- Tachyon APIがCognito authをproxyする: password/refresh仲介契約が残るため不採用。
- Hosted UIへ戻す: React内ログインとTauri共通UXを崩すため不採用。

## References

- [ADR-0001: production Cognito client allowlist](ADR-0001-production-cognito-client-allowlist.md)
- [ADR-0002: React SPAとcourseboard-apiを独立配信する](ADR-0002-react-spa-courseboard-api-boundary.md)
- [Task](../../tasks/completed/v0.1.6/cognito-human-token-issuer/task.md)
- Tachyon Apps ADR-0035
