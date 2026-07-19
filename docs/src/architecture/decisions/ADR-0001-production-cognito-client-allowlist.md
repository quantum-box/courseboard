# ADR-0001: production Cognito client allowlistをコードとmanifestで保持する

## Status

Proposed (2026-07-19)

## Context

`courseboard-api`はCognito access tokenの署名、issuer、有効期限、client IDを検証する。Cloud App registry上の`EXPECTED_CLIENT_ID`が正しくても、active Lambda versionの環境同期がずれると、既知のlocal production PKCE clientが`401`になり、ログイン後の全course APIが利用不能になる事象を確認した。

OAuth public client IDは秘密ではない。一方、任意のclient IDを許可したり、issuerや署名の検証を緩和したりすることは認証境界を壊す。

## Decision

production Cognito issuerから発行され、署名と標準claim検証を通過したtokenに限り、既知のfirst-party local production PKCE client IDをコード側allowlistへ追加する。manifestの`EXPECTED_CLIENT_ID`もdesired stateとして維持する。

認証失敗時はtokenやclaim値を記録せず、失敗分類だけをruntime logへ記録する。

## Consequences

- Lambda環境変数の同期driftがあっても、既知のfirst-party clientによるproduction API利用を維持できる。
- 別issuer、無効署名、期限切れ、未知client IDは従来どおり拒否される。
- public clientを追加・廃止する場合はコードとmanifestの両方を更新する必要がある。
- Cloud App providerの環境同期不具合自体は別途修正する必要がある。

## Alternatives Considered

- production applyの承認ゲートを迂回してenvを直接更新する案は、change controlを形骸化するため採用しない。
- client ID検証を廃止する案は、任意clientを許可するため採用しない。
- local APIを恒久的にproduction dataへ接続する案は、本番Lambdaの障害を隠すだけなので採用しない。

## References

- `docs/src/tasks/completed/v0.1.2/courseboard-api-cloud-app/task.md`
- `docs/src/tasks/completed/v0.1.2/courseboard-api-cloud-app/design.md`
