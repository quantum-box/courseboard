# ADR-0002: React SPAとcourseboard-apiを独立配信する

## Status

Accepted (2026-07-20)

## Context

Course BoardのTauri UIはReact/Viteである一方、本番WebはNext.js/Vinext WorkerがReact成果物、Auth.js、API BFF、PDF routeを内包していた。Cognito access tokenをReact内のPKCEで取得する実装と独立した`courseboard-api`が既に存在するため、Next.js sessionとBFFを残すとWeb/Tauriで認証・API経路が二重になる。

## Decision

`courseboard` WebはReact/Viteの静的SPAとして配信し、Tauriと同じUI成果物を使う。Web/Tauri認証はplatform-ui互換のReactパスワードフォーム＋Tachyon JSON PKCEを使い、client secretとCognito Hosted UIは使用しない。ReactはBearer tokenを独立した`courseboard-api`へ直接送信し、業務API、Field APIの制限付きproxy、JWT検証は`courseboard-api`が所有する。

フロントエンド配信にNext.js、Vinext、Auth.js、サーバーsession、汎用BFFを置かない。表示用PDFは認証済みAPIデータを使ってReactで生成し、サーバーrouteを追加しない。

## Consequences

- WebとTauriのUI・認証adapter・API clientを共有できる。
- Web APIはcross-originになるため、`courseboard-api`は明示的なCORS policyを持つ。
- API側のJWT検証とclient allowlistはADR-0001を継続する。
- WebとTauriが同じReactログイン画面とpublic client設定を共有する。
- Auth.jsのHttpOnly cookieは使わず、PKCE token storageのリスクはReact側で管理する。
- フロント配信だけの変更でNode.js server runtimeをデプロイしない。

## Alternatives Considered

- Next.js WorkerをBFFとして維持する: 同一origin cookieは使えるが、Tauriとの二重構成が残るため不採用。
- TauriとWebを別アプリとして維持する: リリースと挙動の差分が増えるため不採用。
- Field APIへReactから直接接続する: proxy allowlistとCourse Board固有の統制が分散するため不採用。

## References

- [移行taskdoc](../../tasks/in-progress/migrate-nextjs-to-react/task.md)
- [設計](../../tasks/in-progress/migrate-nextjs-to-react/design.md)
- [ADR-0001: production Cognito client allowlist](ADR-0001-production-cognito-client-allowlist.md)
