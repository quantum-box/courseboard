# extension configから撤退する

親: [CourseBoardをField extensionから切り離す](../courseboard-extension-exit/task.md)

## 現状

Field の extension config に、CourseBoard の設定・業務ルール値・運用データが 9 系統たまっている。行き先は [ADR-0009](../../../architecture/decisions/ADR-0009-extension-config-is-not-a-data-store.md) で決めた。

置き場所として不適切であることは 4 つの形で表面化している。

- 書き込みが `field:ManageExtensions`（extension の enable / disable と同じ lifecycle 権限）を要求し、CourseBoard の 5 ロールはどれも持っていない。
- compare-and-set が無く、設定画面は config 全体をブラウザに持って丸ごと返す。**タブを開いている時間だけ他画面の編集を巻き戻す窓が開く。**
- Field 側の snapshot 移行（PLT-3574）の cutover 中は config write が全部 423 で止まり、移行対象でない設定の保存も巻き添えになる。
- 読み取りが hot path に乗っている。台帳を 1 回開くと 3 回、config 全体が転送される。外部帳票の集計が入っているので、この量は運用期間に比例して増える。

## やること

### 0. 本番の実態を確認する

- **config 保存で実際に 403 が起きているか。** ロール割当を読む。テナントオーナー権限で回避されている可能性もあり、机上では決まらない。撤退の優先順位を決める材料。
- **預り金比率が config と Field の予約ポリシーテーブルで一致しているか。** config 側だけ編集されて Field 側が初期値のまま、という状態がありうる。
- **全予約商品が販売可能リソースを宣言済みか。** legacy のゴルフ用 key を config から落とせるかの判定条件。
- 既定通貨の本番実値。

### 1. ローカル DB へ移す（Field 待ちなし）

コース並び順 → ランク単価 → 予約ポリシーの写しの削除 → 料金シミュレータの前提と表示設定、の順。手順と DDL の形は親の [design.md](../courseboard-extension-exit/design.md)。

コース並び順から始めるのは、**間違えても被害が並び順だけに閉じる**ため。ここで migration → repository → port → DI → usecase → 認可の 1 周を通す。

ランク単価は**読み取りを 3 段のフォールバックにする**。単純に「行が無ければ既定値」にすると、設定済みの単価が黙って戻ったまま給与計算がその金額で走る。

### 2. 新しい設定 API へ切り替える

`GET/PUT /v1/course/tenant-settings` を足し、読み手 4 画面（キャッシュキーを共有しているので同一 PR）→ 書き手 2 画面 → extension status から config を落とす → `PATCH /v1/course/config` を廃止、の順。

新 API は**行が 1 本も無いテナントでも 200 と既定値を返す**こと。404 も null も返さない。

### 3. 外部帳票の日別集計を移す

9 系統で唯一、一回限りの移送が要る。`bin/` にコマンドを足し、seed → 検証 → 切替 → legacy 削除の一方向。dual-write はしない。**この key は切替後に config から明示的に消す。**

実装済み（2026-08-23）: `golf_reservation_report_rows` テーブル、`MigratingReservationReportGateway`（ローカルが正。未 seed のテナントだけ legacy を読み、**最初のインポートの直前に legacy 全量を自動 seed** する）、`courseboard-migrate-reservation-reports` コマンド（seed → 全行照合 → `COURSEBOARD_MIGRATE_DELETE_CONFIG_KEY=1` で legacy key 削除）。残りは本番テナントごとのコマンド実行と key 削除という運用手順だけ。

**未解決: 移送コマンドが本番 DB に届かない。** 本番 TiDB は PrivateLink 経由でしか繋がらず（Lambda は VPC 内なので届く）、`courseboard-migrate-reservation-reports` を手元から実行できない。**データの移送自体は困らない**——ゲートウェイが最初のインポートの直前に自動 seed するので、Lambda の中で完結する。届かないのは**照合と legacy key の削除**だけ。key を消すには migration gate と同じく `lambdaInvoke` フックから走らせる形にするか、同等の入口を用意する必要がある。急ぎではない（key が残っていても動作は正しく、hot path のペイロードが太いままなだけ）が、「コマンドを実行すれば終わる」と思って放置すると終わらない類のもの。

### 4. 撤退までの暫定対応

- **商品枠の書き込みを照合つきの経路へ**（第0波、S）。今は読んで書くだけの生 PATCH で、Field 側の枠取り込みが同じ配列を書く。**現時点で最も確実に失われる経路。**
- 423 と 409 の受け皿。cutover 中の 423 が今は「上流エラー」としか出ない。「メンテナンス中」として区別して UI に出す。

### 5. Field に起票して待つもの

タイムゾーン、予約受付期間、予約商品の汎用テーブル。受け入れ条件は親の [design.md](../courseboard-extension-exit/design.md)。

**予約商品が撤退完了の最後のブロッカーになる。** Field の公開ストアフロントが同じ配列を読んでおり、Field 側に商品テーブルが無いため。ゴルフの key だけは先に分割できる。

## 完了条件

- 9 系統のうち、Field 待ちの 3 つを除く全てが CourseBoard ローカル DB にある。
- `grep -rn "configJson" desktop/src` がヒットゼロ。
- `PATCH /v1/course/config` が存在しない。
- 外部帳票の集計が config から消えている。
- Field 待ちの 3 つが起票済みで、待っている状態が記録されている。
