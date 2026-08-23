# ADR-0009: extension configを運用データの保存先にしない

## Status

Accepted (2026-08-23)

## Context

Field の extension config（`PATCH /v1/erp/extensions/{key}/config` が
読み書きする tenant scope の JSON）に、CourseBoard の設定・業務ルール値・
運用データが 9 系統たまっている。

- 予約商品の定義（`reservationProducts`）
- キャディのランク別ラウンド単価（`caddieRankFees`）
- 台帳のコース並び順（`golfCourseOrder`）
- 何日先まで予約を開けるか（`bookingHorizon`）
- テナントのタイムゾーン（`timezone`）
- 外部帳票の日別集計（`courseBoardReservationReport`）
- 表示設定（`defaultCurrency` / `playerTagOptions`）
- 料金シミュレータの前提（都道府県、利用税の等級、課税割合、価格弾力性、固定費、変動費）
- 予約ポリシーの写し（既定ホール数、1 組の上限人数、カート方針、預り金比率ほか）

置き場所として config を選んだのは、Field に受け皿となる汎用テーブルが
無かったからで、[ADR-0007](./ADR-0007-external-reservation-report-snapshots.md)
自身が「config は本来運用データの永続先ではない」と Negative に書いている。
その後、この選択が支えられなくなる事実が 4 つ出てきた。

1. **書き込み権限が lifecycle 権限に寄った。**
   Field は `PATCH .../{key}/config` に `field:ManageExtensions` を要求する。
   これは extension の enable / disable と同じ権限で、
   `field-extension:golf:*` の 5 ロールはどれも持っていない。
   料金表を直したい経理に extension のオンオフを渡さない限り、
   上記 9 系統の保存が全部通らない。
2. **compare-and-set が無い。**
   config API は全体置換で、CourseBoard は read → write → read-back を
   リトライして自分の key だけを照合している。他 key の巻き込みは検出できない。
   さらに設定画面は config 全体をブラウザに持ち、数個の key を差し替えて
   丸ごと返す。**タブを開いている時間だけ、他画面の編集を巻き戻す窓が開き続ける。**
3. **cutover 中に全部止まる。**
   Field 側で外部集計 snapshot を汎用 capability へ移す作業（PLT-3574）は、
   locked から cutover までの間、対象 extension の config write を
   423 で拒否する。CourseBoard は configJson を丸ごと PATCH するため、
   移行対象でない key の保存も巻き込まれる。
4. **読み取りが hot path に乗っている。**
   config は `GET /v1/erp/extensions/status` の応答として全量が返る。
   台帳を 1 回開くとタイムゾーン・商品・コース並び順の 3 つを並列に取りに行き、
   **そのたびに config 全体が転送される**。外部帳票の日別集計は
   コース数 × 日数 × 午前午後で行が増え続けるので、この転送量が
   運用期間に比例して膨らむ。

加えて [ADR-0010](./ADR-0010-courseboard-is-not-a-field-extension.md) で
CourseBoard が extension を一切使わないことを決めたため、
「受け皿ができるまで config に置く」という暫定案そのものが選べなくなった。

## Decision

extension config を CourseBoard の保存先として使わない。
現在 config に載っている 9 系統は、次の 2 択で行き先を決める。

- **ゴルフの知識である**（Field が汎用として持つ意味がない）→ **CourseBoard ローカル DB**
- **業種非依存で、Field の他機能も参照する** → **Field に汎用 capability を起票して待つ**

「暫定的に config へ置く」という 3 番目の選択肢は採らない。
暫定が恒久になったのが現状だからである。

### 行き先

**CourseBoard ローカル DB へ移すもの**

- `caddieRankFees` — 「ランク」はゴルフの語彙。Field に置いてはいけない知識。
- `golfCourseOrder` — 台帳の並び順で、Field が知る必要がまったくない。最も移しやすい。
- `playerTagOptions` — 来場者の区分はゴルフ運用の語彙。
- `defaultCurrency` — Rust に読み手がおらず、実際に使われている通貨は
  ランク単価のものだけ。独立した設定として残さず、そちらへ統合する。
- 料金シミュレータの前提 — 都道府県と利用税の等級は、ゴルフ場利用税の
  税率表を引く鍵である。**税率表は既に CourseBoard ローカル DB にあり、
  表と鍵が別のストアに分かれている**。統一する。
- `courseBoardReservationReport` — 集計の中身は「組数」と
  「**キャディ付き**組数」で、ゴルフの語彙。ADR-0007 の暫定措置を置き換える。
  9 系統で唯一、設定値ではなく履歴データであり、**読み取り時の
  フォールバックでは済まず一回限りの移送が要る**（2 つのストアに
  同じ日付の答えが並ぶと、どちらが新しいかを誰も維持できない）。

**Field に起票して待つもの**

- `timezone` — タイムゾーンは究極的に業種非依存で、Field 自身が
  公開ストアフロントと予約ポリシーガードで使っている。CourseBoard が
  勝手にローカルへ移すと、**Field の知らないところで公開サイトの
  日付解釈がずれる**。
- `bookingHorizon` — 何日先まで販売するかは業種非依存で、
  Field の在庫と枠生成が本来参照すべき値。

**Field の商品テーブルを待ちつつ、ゴルフの意味づけだけ先に出すもの**

- `reservationProducts` — この配列は Field の公開ストアフロントが
  商品カタログとして読んでおり、Field 側に商品テーブルが存在しない。
  CourseBoard 単独では動かせない。ただし CourseBoard が付け足した
  ゴルフの key（プレー種別、ホール数、対象コース、1 組の上限人数）は
  **Field が一切読んでいない**ので、これだけ先にローカル DB へ出せる。
  残る汎用の形状は Field の商品テーブルを待つ。

**削除するもの**

- 予約ポリシーの写し — 既定ホール数・1 組の上限人数・カート方針・
  預り金比率の正は Field の予約ポリシーテーブルにあり、CourseBoard は
  既にそれを読み書きする経路を持っている。config 側は誰も読まない写しで、
  移すのではなく消す。同じ場所にある公開商品名・説明・既定所要時間は
  読み手が 1 つも存在しない。

CourseBoard ローカル DB へ移すものは、ゴルフ利用税マスタやシフト規則と
同じ流儀で扱う。Field DB からの物理移送ではなく、Field が持つべきでない
知識を最初から CourseBoard 側で持ち直すため、ADR-0005 の
「データ物理移送を行わない」とは衝突しない。

## Consequences

### Positive

- 設定の保存が `field:ManageExtensions` から外れ、業務ロールで通るようになる。
- config の同時編集者が減り、compare-and-set が無いことによる
  巻き戻しの窓が閉じる。設定画面が config 全体をブラウザへ往復させる
  経路も消える。
- 台帳やティーシートを開くたびに帳票集計の全量を転送する経路が消える。
- PLT-3574 の cutover に巻き込まれなくなる。

### Negative

- CourseBoard ローカル DB のテーブルが増える。CLAUDE.md の責務分担の
  記述を改める。
- `timezone` と `bookingHorizon` は Field の実装待ちになる。
  ただし「待つ間は config に置いたまま」ではなく、**待っている状態を
  明示的に管理する**（起票して、来なければローカル化に切り替える判断をする）。
- `reservationProducts` の汎用部分は Field の商品テーブルができるまで
  config に残る。**これが撤退完了の最後のブロッカーになる。**
- `caddieRankFees` を CourseBoard へ移すと、Field 側の extension audit
  （PLT-3381）が想定していた最初の利用者が消える。値の正は CourseBoard、
  変更イベントの追記先は Field、という切り分けを先方と合意する必要がある。

### Neutral

- ほとんどの系統は行数が小さく、読み取り時のフォールバックで移行できる。
  一括の移送バッチが要るのは外部帳票の日別集計だけ。

## Alternatives Considered

- **`field:ManageExtensions` を golf ロールに足す**:
  1 ファイルの変更で済むが、料金表を直したいだけの経理に extension の
  enable / disable を渡すことになる。ADR-0010 で extension から撤退する以上、
  そもそも不要になった。
- **config 書き込みだけサービスアカウント token を使う**:
  現在の実装は全アウトバウンドに同じ bearer を使うため gateway の分岐が要る。
  かつサインインした全ユーザーが実質サービスアカウント権限を得る形になる。
  これも撤退により不要。
- **すべて CourseBoard ローカル DB へ移す**:
  `timezone` と `bookingHorizon` は Field の在庫・枠生成・公開ストアフロントも
  参照すべき値で、CourseBoard だけが持つと Field 側が古い値で動く。不採用。
- **外部帳票の日別集計を Field の汎用 snapshot capability（PLT-3574）へ**:
  ADR-0007 の当初案。集計の中身がゴルフの語彙であること、config の
  大きさを支配していること、cutover 中に他の設定保存まで止まることから、
  ローカル DB を採用した。

## References

- [ADR-0005: ゴルフドメイン知識はCourseBoardが所有する](./ADR-0005-golf-domain-ownership.md)
- [ADR-0007: 外部予約帳票の集計をField extension configへ暫定保存する](./ADR-0007-external-reservation-report-snapshots.md)
- [ADR-0010: CourseBoardはFieldのextensionを使わない](./ADR-0010-courseboard-is-not-a-field-extension.md)
- [ロードマップ](../../tasks/in-progress/courseboard-extension-exit/task.md)
- [extension configから撤退する](../../tasks/in-progress/extension-config-exit/task.md)
- [PLT-3574](https://linear.app/issue/PLT-3574)
- [PLT-3381](https://linear.app/issue/PLT-3381)
