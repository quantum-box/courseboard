# ADR-0010: CourseBoardはFieldのextensionを使わない独立Cloud Appである

## Status

Accepted (2026-08-23)

## Context

CourseBoard は Field の `golf_course` extension を 3 つの意味で使っている。

- extension config を設定と運用データの保存先にしている
- `/v1/erp/extensions/golf-course/*` のドメインルートを呼んでいる
- `tenant_extensions` の有効・無効をテナント選択のフィルタに使っている

このうち後者 2 つが本当に必要なのかを調べた結果、**extension という枠組みが
CourseBoard に与えているものは、当初考えていたより遥かに少ない**ことが分かった。

**認可は extension に依存していない。** `field_extension_golf:*` という
action 名は Tachyon Auth 上の独立した名前空間で、`src/course_authz.rs` は
Tachyon Auth の `POST /v1/auth/policies/check` を直接叩いている。
Field API も extension status も参照していない。名前に反して、
extension の有無とは無関係に動く。

**Field 側の認可経路にも extension 有効判定は入っていない。**
Field が `x-operator-id` によるテナント指定に対して課している検証は、
JWT のメンバーシップ、Tachyon Auth のポリシー、platform と operator の
親子関係の 3 つで、`tenant_extensions` を一度も読んでいない。
**extension を使うのをやめてもセキュリティは後退しない。**

**`tenant_extensions` が実際に果たしている仕事は 2 つだけである。**
テナント選択画面のフィルタと、extension config の保管。前者は
[ADR-0011](./ADR-0011-policy-based-tenant-selection.md) が、後者は
[ADR-0009](./ADR-0009-extension-config-is-not-a-data-store.md) が置き換える。

一方で、**extension framework を Field から廃止させることはできない**。
公開ストアフロントの商品カタログ、予約通知メールのテンプレート、
公開申込フォームの定義という、ゴルフとも業種拡張とも無関係な汎用機能が
同じテーブル群を唯一の保存先として使っている。extension を消すと、
業種拡張より先にこの 3 つが壊れる。これは Field の問題であって、
CourseBoard が一方的に廃止を求められるものではない。

なお CourseBoard は `tachyon.yaml` に `extensionTarget` を宣言しておらず、
platform 側にもその実装が無い。**CourseBoard は platform の extension
レジストリに最初から載っていない**。iframe で Field admin に埋め込まれる
extension ではなく、独自ドメインで動き Field API を消費するアプリである。
Field 側 ADR `plt-1549-cloud-app-industry-extension-boundary` も
「monorepo の extension framework を rich vertical product の主要な
拡張境界とはしない。Cloud App extension を優先する」と既に決めている。
本 ADR はその線上にある。

## Decision

CourseBoard は Field の extension を使わない。extension config、
extension-scoped path、extension 有効判定のいずれにも依存しない。

**Field の extension framework 自体の存廃は Field の判断に委ねる。**
CourseBoard から廃止を求めない。

設定の置き場は 2 択にする。

- **ゴルフ固有のもの** — CourseBoard ローカル DB
- **業種非依存のもの** — Field に汎用 capability を起票して待つ

「受け皿ができるまで暫定的に extension config へ置く」という
3 番目の選択肢を廃止する。暫定が恒久になり、置き場所の判断が
先送りされ続けたのが今の状態だからである。

`field_extension_golf:*` の action 名は**維持する**。Tachyon Auth の
独立した名前空間であり、extension の有無と無関係に機能する。
改名すると本番のポリシー割当の移行が要る一方、得られるものが
名前の座りの良さしかない。

## Consequences

### Positive

- **セキュリティは後退しない。** Field の認可も CourseBoard の認可も
  extension 有効判定を見ていないため。
- config への書き込みが `field:ManageExtensions`（extension の
  enable / disable と同じ lifecycle 権限）を要求する問題が消える。
  経理やマネージャーのロールで設定を保存できるようになる。
- Field 側で外部集計 snapshot を汎用 capability へ移す作業の
  cutover 中に、CourseBoard の設定保存が巻き添えで止まらなくなる。
- Field の extension framework の廃止時期に人質を取られない。
- 台帳やティーシートを開くたびに config 全体（帳票集計の全量を含む）を
  転送する経路が消える。

### Negative

- CourseBoard ローカル DB のテーブルが増える。CLAUDE.md の責務分担の
  記述を改める必要がある。
- 予約商品（`reservationProducts`）は Field の公開ストアフロントが
  同じ配列を読んでいるため、CourseBoard 単独では動かせない。
  Field の商品テーブルができるまで、**唯一の config 依存として残る**。
  この 1 点だけ撤退の完了が Field の時間軸に依存する。
- 「どのテナントが CourseBoard の契約者か」の情報源が
  `tenant_extensions` から失われる。ADR-0011 のポリシーが引き継ぐ。

### Neutral

- Field が extension lifecycle と config を所有し続けること
  （ADR-0005）と、CourseBoard がそれを使わないことは両立する。
  所有者の定義と利用者の選択は別の話である。

## Alternatives Considered

- **Field の extension framework の廃止を求める**: ゴルフと無関係な
  汎用機能 3 つが相乗りしており、その受け皿を Field に新設させる
  大工事になる。CourseBoard の撤退はそれを待たずに完了できるので、
  待つ理由がない。
- **extension を使い続け、権限と CAS の問題だけ Field に直してもらう**:
  緩和策としては有効だが、config を運用データの保存先にし続けること自体が
  ADR-0009 で否定された。直してもらっても置き場所として不適切なまま。
- **`field_extension_golf:*` を改名する**: 名前が誤解を招くのは事実だが、
  本番のポリシー割当の移行を伴い、得られるものが名前の座りの良さだけ。

## References

- [ADR-0005: ゴルフドメイン知識はCourseBoardが所有する](./ADR-0005-golf-domain-ownership.md)
- [ADR-0009: extension configを運用データの保存先にしない](./ADR-0009-extension-config-is-not-a-data-store.md)
- [ADR-0011: テナント選択はポリシーで行う](./ADR-0011-policy-based-tenant-selection.md)
- Field: `docs/adr/plt-1549-cloud-app-industry-extension-boundary.md`
- [ロードマップ](../../tasks/in-progress/courseboard-extension-exit/task.md)
