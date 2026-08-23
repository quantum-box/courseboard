# tenant timezone を全計算経路で使う

> **(2026-08-23 追記)** SoR である extension config は
> [ADR-0010](../../../architecture/decisions/ADR-0010-courseboard-is-not-a-field-extension.md)
> により CourseBoard が使わなくなる。行き先は Field の汎用テナント属性で、起票して待つ。
> 読み手は全部同じ port を経由しているので、差し替えは gateway 1 箇所で済む。
> **本 taskdoc を進めるほど読み手が増えるため、Field への起票を先に出しておく。**

## 目的

SCC-6 で course から tenant extension config へ移した timezone を、予約、運用、集計、storefront の実際の日境界と時刻解釈に使う。availability rule 自身の timezone と予約 snapshot は履歴・slot generation の contract なので維持する。

## 実測した不具合

締切判定は `Utc::now().date_naive()` を `today` としていた。たとえば `2026-08-10T15:30:00Z` は東京では 8 月 11 日 00:30 だが旧判定は 8 月 10 日のままである。8 月 10 日締切は tenant 日付では経過済み、旧 UTC 判定では未経過となり、警告が 09:00 JST まで 1 日遅れる。これを固定時刻の回帰テストで再現する。

## この変更の範囲

- CourseBoard: tenant config を timezone の SoR とし、予約時刻、tee sheet / ledger、キャディ供給・推薦・手動配置・自動配置、シフト生成締切、schedule horizon、日次予算実績、月次精算、給与、operator UI の today / now に適用する。
- Field: 業種非依存の IANA timezone と半開 UTC 境界を受け取る加算的 contract を、ゴルフ集計・attendance snapshot・既存の直接自動配置 API・storefront inventory に追加する。timezone の値やゴルフ上の意味は所有しない。
- storefront: inventory が返した tenant timezone で browser の zone-less 入力と表示を解釈する。

Field の既存 caller は引数省略時に従来挙動を維持する。CourseBoard が新しい引数を送り始めてから集計境界が変わるため、Field 側だけを先に導入しても既存挙動は変わらない。

## fallback と検証

tenant timezone が未設定または空なら SCC-6 と同じ `Asia/Tokyo` を使う。設定された値が IANA timezone として不正なら UTC 等へ黙って落とさず provider/config error にする。DST を含む local midnight を UTC の半開区間 `[start, next_start)` に変換する。

## migration

schema 変更は不要。既存 migration は編集せず、新規 migration も作らない。
