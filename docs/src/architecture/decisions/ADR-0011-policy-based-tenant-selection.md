# ADR-0011: テナント選択はextension有効判定ではなくポリシーで行う

## Status

Accepted (2026-08-23)

[ADR-0004](./ADR-0004-ui-platform-api-access-via-courseboard-api.md) のうち
テナントの絞り込み方に関する部分を置き換える。ADR-0004 の中核である
「UI のアクセス先を Cognito と courseboard-api の 2 つに限定する」は有効。

## Context

CourseBoard は `/v1/me` の実装として Field の `/v1/erp/me?extensionKey=golf_course`
を proxy し、`tenant_extensions` で golf_course が有効なテナントだけを
残している。[ADR-0010](./ADR-0010-courseboard-is-not-a-field-extension.md) で
extension への依存をやめると、この軸が使えなくなる。

調べた結果、代替は Tachyon Auth に既にあった。

**`POST /v1/auth/policies/check-tenants` が「このユーザーがこの action を
持つテナント一覧」を返す。** Field 自身がこれを使っており、Field のコードは
「平のポリシーチェックより厳密に強い。provider 側の platform と operator の
関係まで検証する」と書いている。テナントスコープが決まる前に呼べる
（スコープヘッダを要求しない）ので、テナント選択の前段に置ける。

**Field の `/v1/erp/me` は素の `/v1/me` の情報を捨てている。**
platform 側の `/v1/me` はテナントごとに `platform_id` と階層上の役割を
返すが、Field はそのうち id と名前しか受け取っていない。そのため
CourseBoard は `platform_id` を埋めるために Tachyon Auth へテナント数ぶん
問い合わせており、しかも先頭 20 件で打ち止めている。
**21 件目以降のテナントは `platform_id` が欠け、Field のテナントチェックで
拒否される。これは現に存在するバグである。** 素の `/v1/me` を直接叩けば
この往復ごと消える。

## Decision

テナント一覧は courseboard-api が platform の素の `/v1/me` を proxy し、
`POST /v1/auth/policies/check-tenants` の結果で絞る。

**「ポリシー付与＝契約」を規約とする。** CourseBoard の業務ポリシーが
付与されているテナントだけが一覧に出る。テナントに CourseBoard を
使わせる手続きには、ポリシーの付与が含まれる。

委譲チェーンは **UI → courseboard-api → tachyon-api** になる。
テナント一覧の経路から field-api が外れる。

`/v1/erp/me` proxy と `extensionKey` パラメータは廃止する。

絞り込みに使う代表 action は `field_extension_golf:ListTeeSheet` とする。
業務ロールが共通して持つ action のうち、アプリの正面玄関にあたるものを
選んだ。ティーシートが読めないテナントで CourseBoard は成立しない。
extension の概念に縛られた action（`ListExtensionStatus`）は、
extension から撤退する以上、契約を表す軸として不適切なので使わない。
Field コアの action（`field:ListReservations`）は、CourseBoard を
契約していないテナントも持ちうるので使わない。

## Consequences

### Positive

- `platform_id` を埋めるための N+1 と 20 件上限が消える。
  21 件目以降のテナントが使えないバグが直る。
- 絞り込みの正が Tachyon Auth に一本化される。`tenant_extensions` と
  ポリシーの二重管理が消える。
- テナント選択がポリシー評価より前に成立していた不自然さが解消する。
  「一覧に出るが開くと 403」が構造的に起きにくくなる。

### Negative

- **既存テナントへのポリシー付与をやり切る必要がある。**
  付与漏れのテナントは一覧に出ず、そのテナントのユーザーが
  CourseBoard を開けなくなる。**これが本 ADR 最大のリスク**で、
  切り替え前に「現在 extension が有効なテナント集合」と
  「ポリシー付与済みのテナント集合」の突き合わせを必須とする。
- テナント一覧の可用性が Tachyon Auth のポリシー評価に乗る。
  従来は Field 経由でポリシーと無関係に返っていた。
  絞り込みに失敗したときは絞らずに返し、その旨のフラグを立てる
  （後続の API がそれぞれ独立に認可するため、テナント一覧は
  認可の境界ではなく発見の手がかりである）。
- 意味が「契約している」から「このユーザーが権限を持つ」に変わる。
  契約はあるが権限を持たないユーザーには、そのテナントが見えなくなる。

### Neutral

- 新しいテーブルも運用画面も要らない。既存の API と既存のポリシーで足りる。

## Alternatives Considered

- **extension 有効判定を続ける**: ADR-0010 と両立しない。
- **絞り込みをやめて全テナントを出す**: platform の他の Cloud App は
  この形を採っている（絞らず、選んだ先の認可に任せる）。実装はほぼ削除で
  済むが、ADR-0004 が解決した「選択後に Field 依存機能が全滅する」が戻る。
  ただし**絞り込みが失敗したときの縮退先としては採用する**。
- **CourseBoard ローカル DB に契約テナントの allowlist を持つ**:
  契約と権限を独立に表現できるが、投入経路（管理 API か migration）と
  preview 環境の seed を新設する必要がある。`check-tenants` が既に
  実在する以上、先に作る理由がない。
- **Field に「CourseBoard 契約テナント」の新 capability を起票して待つ**:
  待つ理由がない。

## References

- [ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する](./ADR-0004-ui-platform-api-access-via-courseboard-api.md)
- [ADR-0010: CourseBoardはFieldのextensionを使わない](./ADR-0010-courseboard-is-not-a-field-extension.md)
- [テナント選択をポリシーで行う](../../tasks/in-progress/tenant-selection-policy-check/task.md)
- [メンバーへの policy 単位の権限付与](../../tasks/completed/v0.1.11/permission-policy-granularity/task.md)
