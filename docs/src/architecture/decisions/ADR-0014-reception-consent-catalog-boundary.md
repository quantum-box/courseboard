# ADR-0014: 受付用紙の同意カタログはFieldを正とする

## Status

Accepted (2026-09-01)

## Context

CourseBoard は受付用紙の3つのチェック欄をコード上の固定定義として持ち、
Field の `membership_consent_items` に同じキーが登録済みであることを前提に
同意証跡を記録している。この方式では確認した1種類の用紙は扱えるが、
テナントごとに異なる規約、注意事項、表明欄を設定画面から追加できない。

tachyonfield PR
[#1271](https://github.com/quantum-box/tachyonfield/pull/1271) は、空の受付用紙を
分析した結果に `consentItems` を追加し、確認後に既存の同意項目 API から
定義を作成できるようにした。CourseBoard の分析 adapter は現在この field を
捨てている。

Field は既に、同意キー、表示名、本文、必須性、規約バージョン、有効状態、並び順と、
顧客がいつどの版に同意したかという append-only の証跡を所有する。これらを
CourseBoard ローカル DB に投影すると、同じ同意カタログを二重管理することになる。

[ADR-0005](./ADR-0005-golf-domain-ownership.md) はゴルフの計算や運用ルールを
CourseBoard に置く一方、業種非依存の顧客・会員・同意 capability は Field に置くと
決めている。同意項目の文言がゴルフ場固有であっても、テナントが投入するデータであり、
Field のコードへゴルフ知識を実装することにはならない。

残る例外は、紙に「情報提供が不要ならチェック」と印刷されている既存項目である。
Field の同意は `accepted=true` を肯定として保存するが、紙のチェックは拒否を表す。
現在の Field 同意項目にはこの入力極性を表す field がない。

## Decision

Field の `membership_consent_items` を、CourseBoard が使用する受付用紙の
同意カタログの正とする。次の値はすべて Field が所有する。

- `consent_key`
- 表示名と規約本文
- 必須性
- `terms_version`
- 有効状態
- 並び順
- 顧客の同意証跡

CourseBoard は同意定義を永続化しない。projection table、repository、同意設定の
ローカル migration は作らない。CourseBoard は利用者の bearer を用いて Field の
同意項目 API を呼び、取得したカタログを次の処理へ接続する。

- 受付用紙の設定画面での一覧・重複判定・候補作成
- OCR schema の boolean 項目
- 読み取り結果の確認画面
- 必須項目の事前検証
- Field の顧客登録 API へ送る同意回答

CourseBoard の受付では、Field の active な同意項目を使用対象とする。将来 Field の
同意カタログを複数の登録用途で使い分ける必要が生じた場合は、用途指定を Field の
業種非依存 capability として追加する。CourseBoard ローカル allowlist で補わない。

`consentItems` は未保存の候補として返し、分析 API は DB を変更しない。設定権限を持つ
利用者が原本と照合した後、courseboard-api 経由で Field の既存同意項目 API に作成する。
候補の `required` は Field #1271 と同じ意味で扱い、確認後に Field の `required` として
保存する。既存定義を分析結果から上書きしない。

候補作成は1件ずつ行う。同じ `consent_key` が既にあれば候補から外し、並び順は既存の
最大 `sort_order` の次から採番する。Field の POST 応答が失われた場合は一覧を再取得し、
同じキーが存在すれば作成済みとして扱う。途中失敗時は成功済み候補を除き、未作成候補を
画面に残す。分析、受付項目保存、同意候補作成は相互にロックする。

新しく分析される同意候補は、Field #1271 の contract どおり、規約や注意事項への
明示的な acknowledgement に限る。チェックは `accepted=true` を意味する。通常の
yes/no 質問は boolean 追加項目として扱い、同意カタログへ入れない。

既存の `golf_marketing_contact` だけは、Field に入力極性を表す汎用 field ができるまで、
CourseBoard のコード上で「チェック＝拒否」の反転を維持する。これは同意定義の複製ではなく、
既存データを誤って配信許可として扱わないための互換処理である。新しい opt-out 項目を
CourseBoard 固有設定として追加しない。必要になった時点で Field に `response_mode` などの
業種非依存 capability を起票する。

受付 OCR の20列上限は、標準項目、追加項目、Field の active な同意項目を合算して、
分析・保存・読取の前に検証する。上限超過時に末尾の同意項目を黙って落とさない。

Field 同意定義の作成は Field の `ManageMembership` 相当権限を要求し、受付担当ロールへ
広い管理権限を追加しない。CourseBoard UI は Field API を直接叩かず、
[ADR-0004](./ADR-0004-ui-platform-api-access-via-courseboard-api.md) のとおり
courseboard-api の明示的な endpoint を経由する。

## Consequences

### Positive

- 同意カタログ、規約バージョン、有効状態、証跡の正が Field に一本化される。
- CourseBoard に同意用のテーブル、migration、同期処理を追加しなくてよい。
- Field #1271 の候補作成、重複回避、部分失敗時の再試行 contract をそのまま利用できる。
- テナント固有の規約を、固定3項目へ制限せず受付 OCR と顧客登録へ接続できる。

### Negative

- 受付用紙の設定、OCR、顧客登録が Field の同意カタログ取得に依存する。
- Field の active な同意項目はすべて CourseBoard の受付対象になる。用途分離が必要に
  なった場合は Field capability の追加を待つ必要がある。
- 動的同意を含めると OCR の20列上限へ達しやすくなる。
- 定義作成は受付担当ではなく、Field の membership 管理権限を持つ利用者に限られる。

### Neutral

- 顧客の同意証跡は従来どおり Field の append-only record に残る。
- `golf_marketing_contact` の反転だけは、Field capability ができるまで互換処理として残る。
- Field の extension lifecycle、extension config、Field UI には依存しない。
- 約款改訂と再同意の運用は本 ADR では設計しない。

## Alternatives Considered

### 固定3項目だけを分析候補と照合する

既存実装への影響は小さいが、PR #1271 が扱うテナント固有の規約・注意事項を
CourseBoard では利用できないため採用しない。

### Fieldの定義を参照するCourseBoardローカルprojectionを持つ

用紙ごとの掲載、OCR prompt、紙面必須、極性を表現できるが、現時点では Field の active な
同意項目をそのまま使えば足りる。テーブル、分散保存、再照合を増やすほどの要件がないため
採用しない。用途分離が必要になった場合も、まず Field の汎用 capability として扱う。

### 同意定義全体をCourseBoardローカルDBへ複製する

Field の `label`、`body`、`required`、`terms_version`、有効状態と二重管理になり、
同期失敗時にどちらが正か決められなくなるため採用しない。

### 空用紙分析から自動作成する

LLM のキーや必須性の誤認がそのまま同意契約になる。既存定義との衝突も確認できないため、
原本を確認する未保存候補の段階を残す。

## Follow-up

- task-local DD で Field consent item list/create の adapter、認可、20列検証、既存3項目から
  動的カタログへの移行、POST 応答喪失時の再照合 contract を確定する。
- ADR-only PR を先に Ready で取り込み、その後の実装 PR で API、UI、focused test、
  認証済み browser verification を行う。CourseBoard の DB migration は行わない。
- 新しい opt-out 同意が必要になった場合は、Field に入力極性を表す汎用 capability を起票する。
- 約款本文の改訂、`terms_version` 更新、再同意、inactive 化の運用は別タスクで扱う。

## References

- [tachyonfield PR #1271](https://github.com/quantum-box/tachyonfield/pull/1271)
- [ADR-0004: UIのplatform APIアクセスはcourseboard-apiを経由する](./ADR-0004-ui-platform-api-access-via-courseboard-api.md)
- [ADR-0005: ゴルフドメイン知識はCourseBoardが所有する](./ADR-0005-golf-domain-ownership.md)
- [ADR-0009: extension configを運用データの保存先にしない](./ADR-0009-extension-config-is-not-a-data-store.md)
- [ADR-0010: CourseBoardはFieldのextensionを使わない独立Cloud Appである](./ADR-0010-courseboard-is-not-a-field-extension.md)
- [受付用紙の画像から顧客を登録する（AI OCR）](../../tasks/in-progress/ai-ocr-customer-reception/task.md)
- [受付用紙のチェック欄を同意として記録する](../../tasks/in-progress/reception-sheet-consents/task.md)
