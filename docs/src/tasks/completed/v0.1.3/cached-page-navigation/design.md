# ページ遷移キャッシュの設計

## Links

- [taskdoc](./task.md)

## Context

React SPAのroute切替で各ページはunmountされる。読み取り結果をページ内stateだけに置く画面は、
再訪時に空stateから始まり、API応答まで全面ローディングになる。既存の `useResource` は
module-level `Map` を持ち、cache hitを即表示しながらbackground revalidateできるため、これを
CourseBoardの標準経路としてコース導線と日次運用導線から段階的に広げる。

## Goals

- 再訪した画面は前回の成功データを同期的に描画する。
- 画面表示と同時に再取得し、キャッシュを最新化する。
- tenant/auth境界とmutation後の整合性を守る。

## Options

### A. routeを非表示のままmountし続ける

不採用。副作用、navigation guard、page reload handlerまで残り、DOMと通信量も増える。

### B. TanStack Query等を追加する

不採用。要件を満たす既存hookがあり、依存追加と全画面移行の負担が大きい。

### C. `useResource` を標準化する（採用）

読み取り結果だけをメモリに保持する。cache missでは従来のloading、cache hitでは直近データを
表示したままbackground revalidateする。

## Proposed design

1. キャッシュキーは読み取り対象とfilterを含む安定した文字列とする。
2. 依存条件が変わり新しいkeyにcacheが無い場合、前のkeyのデータは表示しない。
3. 成功レスポンスだけを保存し、失敗は成功済みcacheを消さない。
4. 明示refreshと再訪時revalidateは既存表示を保持する。
5. tenant切替、sign out、authorization denialで全cacheを消す。
6. mutation後は同じresourceのrefreshまたはcache-aware `setData` で更新する。
7. cacheはtenantとplatformで分離し、上限を設けて古いentryから破棄する。
8. 予約台帳と予定表は日付・コースfilterをkeyに含め、同じ条件へ戻った時だけ再利用する。
9. プレー商品一覧と詳細は同じlist cacheを共有し、保存レスポンスで先にcacheを更新する。
10. キャディ名簿は予定表とprofile cacheを共有し、シフト表は表示月のpadded rangeをkeyに含める。
11. キャディ給与集計は対象月をkeyに含め、CSV出力は明示操作のためキャッシュしない。

キャッシュはタブ内メモリだけとし、認証token、入力draft、支払情報は保存しない。

## Error behavior

- cache無しの失敗は従来どおりhard errorを表示する。
- cache有りの再取得失敗は既存内容を残し、既存のinline error/再試行導線を表示する。
- tenant切替後は旧tenant cacheを破棄してから新tenantの画面を描画する。

## Test plan

- `useResource`: prefix clear、cache hit、key分離、cache-aware update。
- コース一覧、コース設定、プレー商品、予約台帳、予定表、キャディ名簿、シフト表、給与: loading表示は `loading && !data` に限定する。
- コース設定: background revalidateで未保存draftを上書きしない。
- Playwright: 画面Aを表示、画面Bへ遷移、Aへ戻り、遅延中もAの既存内容が見えることを確認する。
- TypeScriptと変更対象のVitestを実行する。

## ADR decision

API、永続データ、provider、security modelは変更しない。既存frontend hookの適用範囲なので
新しいADRは不要。
