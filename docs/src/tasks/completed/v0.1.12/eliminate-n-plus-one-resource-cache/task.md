# 一覧の N+1 と再訪時の再読み込みをなくす

## Links

- [設計](./design.md)
- [Field 起票案：予約 ID の集合で予約一覧を取得する](./field-reservation-ids-filter-issue.md)
- [予約と顧客台帳の紐付けの設計](../../../in-progress/reservation-customer-ledger/design.md)
- [ページ遷移キャッシュの設計](../../v0.1.3/cached-page-navigation/design.md)
- Linear issue: 未作成

## 概要

顧客台帳は最大 100 人を 20 人ずつ表示する一方、表示行ごとに会員情報 API を呼んでいた。
そのため初回表示とページ切替のたびに最大 20 本の CourseBoard API 呼び出しが発生し、各呼び
出しがさらに Field の会員 API を 1 本呼ぶ。行コンポーネントの state だけに結果を持つため、
前のページへ戻ると同じ取得と loading 表示も繰り返していた。

一覧行からの個別取得を横断監査し、一覧 API で完結できない情報は一覧へ載せない。顧客を選択
した後に必要な単件取得は既存の `useResource` キャッシュへ統一し、同じ resource key の同時
取得を 1 本へまとめる。サーバー側で同じ個別 API を繰り返す疑似 batch は作らない。

## Scope

- `desktop/src` の一覧・テーブル・候補表示にある行単位 API 取得を監査し、N+1 を除去する。
- `src` の一覧 usecase / gateway にあるレコード単位の上流・DB 取得を監査する。
- 顧客台帳の会員種別セルによる 20 本の個別取得を廃止する。
- 顧客選択後と顧客詳細の会員情報を `useResource` で共有し、再訪時の loading をなくす。
- 顧客来場履歴の予約詳細 N+1 を Field の汎用予約一括取得 contract として切り出す。
- 同じ scoped cache key の同時取得を共有し、重複リクエストを 1 本にする。
- 会員情報・会員種別の mutation 後に関連キャッシュを更新または無効化する。

## Non-goals

- Field の顧客一覧へゴルフ固有の会員判定を追加すること。
- CourseBoard API に、内部で顧客ごとの Field API を繰り返す batch endpoint を追加すること。
- `localStorage` / IndexedDB への永続キャッシュ、オフライン対応。
- 入力途中のフォーム、認証 token、決済情報のキャッシュ。

## Plan

- [x] フロントエンドの一覧行・候補行から発火する API を監査する。
- [x] Rust usecase / gateway のループ内 I/O を監査する。
- [x] 顧客台帳の会員情報 N+1 を除去する。
- [x] `MembershipBadge` を tenant / platform scoped cache へ移す。
- [x] `useResource` に in-flight request の重複排除を追加する。
- [x] 会員情報と会員種別の mutation 後キャッシュを整合させる。
- [x] Field に必要な予約 ID 集合 filter を汎用 contract として切り出し、起票案を作成する。
- [x] unit test、type-check、build で確認する。
- [x] 実ブラウザ確認を実施できないローカル環境の理由と、deploy 後の確認項目を記録する。

## 完了条件

- 顧客台帳の初回表示とページ切替で、顧客ごとの membership GET が発生しない。
- 同じ顧客を予約入力と顧客詳細で続けて表示しても、キャッシュ済み値を即表示する。
- 同じ cache key を複数コンポーネントが同時に要求しても loader は 1 回だけ実行される。
- tenant / platform をまたいでキャッシュを共有しない。
- 会員種別の変更後に古い会員表示や選択肢へ巻き戻らない。
- 監査で確認した N+1 を修正するか、意図的なページングとして根拠を記録する。

## リスクと保留

- 会員種別を顧客一覧から外すため、会員確認は顧客詳細または予約で顧客を選択した後に行う。
- cache hit 後も background revalidate は行う。表示を古い値で固定するキャッシュにはしない。
- Field に業種非依存の一括照会が必要と判明した場合は、CourseBoard から実装せず別途起票する。
- legacy extension tenant source の `/v1/me` は最大 20 件の operator lookup を持つ。既存の
  `tenant-selection-policy-check` が policy source へ切り替えることで廃止する経路であり、
  本変更で別の cache を重ねない。
- Field issue の実起票と、Field deploy 後の来場履歴一括取得への切替は別タスクとする。
- desktop version は `origin/main` の `0.1.11` から patch bump し、`0.1.12` とする。

## 監査結果

- 顧客台帳の行ごとの membership GET は無制限の一覧 N+1 であり、一覧から削除した。
- 選択済みプレイヤーの会員確認は最大 4 人、候補一覧では発火しない。共有 cache と in-flight
  dedupe を適用した。
- 顧客来場履歴の guest reservation 解決は最大 100 本の detail GET。Field の予約一覧に ID
  集合 filter がないため、[起票案](./field-reservation-ids-filter-issue.md)を作成した。
- legacy extension tenant source の `/v1/me` は最大 20 本の operator lookup。ADR-0011 の policy
  source では発生せず、既存の `tenant-selection-policy-check` rollout で旧経路ごと廃止する。
- tee ledger のコース単位 inventory / schedule、キャディの所属コース取得は resource 単位の
  bounded fan-out。行一覧の N+1 とは分離し、別のTTL / bulk contract検討対象とした。
- 複数顧客登録、複数日の希望保存、assignment 更新は行単位の結果を持つ write fan-out であり、
  読み取り N+1 として一括化しなかった。

## 検証

- `cd desktop && npm run type-check`: 成功。
- `cd desktop && npm run test`: 111 files / 946 tests 成功。
- `cd desktop && npm run build`: 成功。既存の bundle size warning のみ。
- `CustomersPage.requests.test.tsx`: 100 人を返す一覧でも API は顧客一覧 1 本だけで、ページ切替
  後も membership GET が増えないことを確認。
- `MembershipBadge.test.tsx`: cache hit の即時表示、再検証失敗時の直近値維持、会員付与・会員
  番号更新後の cache 更新を確認。
- `useResource.test.ts`: tenant / platform 分離、同一 key の同時 loader 共有、in-flight invalidation、
  失敗後 retry を確認。
- ブラウザ確認は未完了。`:5173` は別 worktree `f5cc/courseboard` の Vite で、修正前bundleを表示
  していた。既存 dev server は停止・再起動していない。`:8080` は listen していなかった。
- PR CI と deploy 後の production network 計測を残りの検証ゲートとする。
