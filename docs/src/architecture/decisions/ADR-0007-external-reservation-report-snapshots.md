# ADR-0007: 外部予約帳票の集計をField extension configへ暫定保存する

## Status

Accepted (2026-08-11)

## Context

ADR-0005は、予約明細、予約商品、予約枠、予約リソースをFieldの汎用ERP capabilityとし、
ゴルフの語彙、計算、運用UIをCourseBoardの責務としている。

既存予約システムから得られる `日別予約状況` 帳票には、施設別・日別・午前/午後別の
組数とキャディ付き組数しかない。予約ID、予約者、人数、ティータイムがないため、
Fieldの汎用予約レコードへ安全に変換できない。しかし、移行期間の予約状況を
CourseBoardで確認するためには、このゴルフ固有集計を保持する必要がある。

## Decision

外部帳票から取り込んだ日別の組数集計は、予約明細ではなく、出典付きの
**運用スナップショット**としてField DBへ残す。専用の汎用snapshot capabilityが
まだないため、既存extension configを暫定gatewayとして利用する。

- Fieldの予約、在庫、商品、請求を作成・更新しない。
- CourseBoard DBには新しい保存テーブルを作らない。
- 対応先コースごとのField `store` scope configへ、既存keyを保持したmergeで保存する。
- namespaced keyのentry mapを日付・午前/午後で一意にし、再取込をupsertにする。
- この集計を予約明細へ推測変換しない。
- 将来Fieldに業種非依存の外部集計snapshot capabilityができた場合は、そこへ移行する。

## Consequences

### Positive

- 架空の予約や時刻を作らず、既存システムの予約状況をCourseBoardで確認できる。
- map keyにより、同じファイルの再送や並列実行でも重複entryを作らない。
- 元帳票の修正版を同じ外部行として更新できる。
- 予約系データをCourseBoard DBへ物理移送しないADR-0005の境界を維持できる。

### Negative

- Fieldの予約明細と外部集計という2種類の情報が存在するため、画面と計算は出典を区別する必要がある。
- 元帳票の列構造変更ごとにparserの明示的な追従が必要になる。
- config APIは全体置換でcompare-and-swapを持たないため、異なる内容の同時更新は後勝ちになる。
- configは本来運用データの永続先ではなく、Field側の汎用snapshot capabilityまでの暫定措置である。

### Neutral

- 既存の予約台帳、在庫、月次精算、請求の正本はFieldのまま変わらない。
- 将来の実績計算への接続は別の設計判断とする。

## Alternatives Considered

- 組数分のField予約を作る: 不明な予約者、人数、時刻を捏造するため不採用。
- CourseBoard DBへ専用テーブルを作る: 一意制約は強いがADR-0005の物理移送禁止に反するため不採用。
- UIのlocal storageだけに保持する: tenant共有、監査、再現性を満たさないため不採用。

## References

- [ADR-0005](./ADR-0005-golf-domain-ownership.md)
- [taskdoc](../../tasks/completed/v0.1.10/reservation-report-import/task.md)
- [設計](../../tasks/completed/v0.1.10/reservation-report-import/design.md)
