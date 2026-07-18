export type PageHelpSection = {
  heading: string
  body: string
}

export type PageHelp = {
  title: string
  summary: string
  usage: PageHelpSection[]
  data: PageHelpSection[]
}

const fallbackHelp: PageHelp = {
  title: 'Course Board',
  summary:
    'ゴルフ場オペレーション向けの運用画面です。左のサイドバーから業務ごとに画面を開けます。右のガイドパネルは、いま開いている画面の操作手順とデータの意味を示します。',
  usage: [
    {
      heading: '画面の探し方',
      body: 'サイドバーは「コース予約」「キャディ管理」「経理・精算」に分かれています。よく使う画面はピンアイコンで上部に固定できます。ホームの「運用機能」タイルからも同じ画面へ移動できます。',
    },
    {
      heading: '検索で移動する',
      body: '⌘K（Windows は Ctrl+K）でコマンドパレットを開き、画面名（例: 配置、月次精算）を入力して移動します。数字ショートカットがある項目はサイドバーにも表示されています。',
    },
    {
      heading: 'ガイドの使い方',
      body: '右上付近のヘルプからこのパネルを開きます。画面を切り替えると内容が自動で変わります。「使い方」は操作手順、「データ構造」は画面上の項目がどのマスタ・APIに対応するかを説明します。',
    },
    {
      heading: 'テナントを確認する',
      body: '右上に表示されている名前が、いま操作している施設（tenant）です。保存・一覧はすべてこのテナントの範囲に限定されます。別施設のデータは見えません。',
    },
  ],
  data: [
    {
      heading: 'Tenant',
      body: 'Field API 上の施設単位。ヘッダー表示と API リクエストのテナントコンテキストが一致している必要があります。',
    },
    {
      heading: 'golf_course extension',
      body: 'コース・予約商品・キャディ・予算・精算など、ゴルフ固有機能の多くは Field の golf_course extension 配下の API を使います。設定画面で有効化状態を確認できます。',
    },
  ],
}

const helpByRoute: Record<string, PageHelp> = {
  golf: {
    title: 'ホーム',
    summary:
      '当日運用の入口です。サイドバーと同じ運用画面へのショートカットと、マスタ更新から締めまでの推奨作業順序を確認できます。',
    usage: [
      {
        heading: 'まず予約商品を開く',
        body: '右上の「予約商品を開く」からゴルフ予約商品へ直接移動できます。公開前のプレー区分・受付枠確認から始める運用に合わせてあります。',
      },
      {
        heading: '運用機能タイルを使う',
        body: '「運用機能」の各タイル（ゴルフ予約商品、予約ポリシー、名簿、配置、勤怠、給与、予算マスタ、月次精算、キャンセル料）を押すと該当画面へ移動します。コースマップはサイドバー「コース予約」から、コース管理は設定（テナントマスタ）から開きます。',
      },
      {
        heading: '今日の運用順序に沿う',
        body: '下の「今日の運用順序」は 01 商品と枠 → 02 キャディ配置 → 03 売上と請求 → 04 月次精算 です。同じ予約・キャディ・請求データを順番に引き継ぐ想定なので、途中の画面だけを飛び飛びに更新すると整合が崩れやすくなります。',
      },
      {
        heading: '01 商品と枠',
        body: '導入時に設定のコース管理でコースとスタート間隔を整えたうえで、ゴルフ予約商品でプレー区分と曜日別受付枠を確認し、必要なら予約ポリシーで締切・デポジット・セルフロックを見直します。',
      },
      {
        heading: '02 キャディ配置',
        body: '名簿で希望休とスタッフ紐付けを確認してから、配置で当日の割当を確定します。勤怠打刻は配置ではなく勤怠画面で行います。',
      },
      {
        heading: '03〜04 売上・請求・締め',
        body: '予算マスタで日次目標と達成率を見つつ、キャンセル料で未収請求を処理し、月次精算で予約売上・キャディ費用・Square 照合を締め前確認します。',
      },
    ],
    data: [
      {
        heading: 'ホームの役割',
        body: 'ホーム自体はマスタや請求の一覧を保持しません。ナビゲーションと運用順序の案内だけを表示し、実データは各機能画面が Field API / golf_course extension 経由で読み書きします。',
      },
      {
        heading: '関連ルート',
        body: 'golf/products（予約商品）、golf/caddies/dispatch（配置）、golf/budgets（予算）、golf/settlement（月次精算）、cancellation-fees（キャンセル料）が主な後続画面です。',
      },
    ],
  },

  'golf/courses': {
    title: 'コース管理',
    summary:
      'テナント導入時に整えるコースマスタです（名称、ホール数、スタート間隔、タイムゾーン、有効/無効）。日常運用のサイドバーには出さず、設定から開きます。予約商品やキャディ対応コースの前提になります。',
    usage: [
      {
        heading: '開き方',
        body: 'アカウントメニューまたは ⌘K の「設定」→「テナントマスタ」の「コース管理」から開きます。画面上部の「設定へ戻る」で設定ハブに戻れます。',
      },
      {
        heading: '一覧を確認する',
        body: '上部メトリクスで「登録コース」「営業中（有効）」「18ホール」件数を確認し、「コース一覧」テーブルでコース名・ホール・スタート間隔・営業時間・タイムゾーン・状態を見ます。',
      },
      {
        heading: 'コースを追加する',
        body: '「コース追加」を押し、「コース名」（必須）、「略称」、「ホール数」（9ホール / 18ホール）、「スタート間隔」（1〜60分）、「タイムゾーン」（例: Asia/Tokyo）を入力して「変更を保存」します。新規作成時は状態が有効で登録されます。',
      },
      {
        heading: '既存コースを編集する',
        body: '行の「編集」で編集パネルを開きます。編集時のみ「状態」を有効 / 無効に切り替えられます。無効にしても削除ではなく、予約商品側からの参照可否に影響します。',
      },
      {
        heading: 'スタート間隔の意味',
        body: 'スタート間隔はティータイム密度の土台です。短くしすぎると現場の回転が追いつかず、長すぎると販売枠が減ります。変更後はゴルフ予約商品の受付枠と現場運用をあわせて見直してください。',
      },
      {
        heading: '削除するときの注意',
        body: '「削除」は確認ダイアログのあと完全削除します。予約商品・予算・キャディ対応コースが参照している可能性があるため、運用中コースは削除より「無効」を優先してください。',
      },
      {
        heading: '次に開く画面',
        body: 'コースが1件以上ある状態で、ゴルフ予約商品の受付枠設定、キャディ名簿の「対応コース」、予算マスタのコース別日次予算へ進みます。',
      },
    ],
    data: [
      {
        heading: 'Course（コース）',
        body: '施設内のコース実体。画面上のコース名・略称・ホール数・タイムゾーン・有効フラグに対応します。API: GET/POST /v1/erp/extensions/golf-course/courses、PATCH/DELETE …/courses/{id}',
      },
      {
        heading: 'startIntervalMinutes',
        body: 'スタート間隔（分）。一覧の「スタート間隔」列と編集フォームの同名項目です。予約スロット生成の前提条件になります。',
      },
      {
        heading: 'businessHoursJson',
        body: '営業時間。一覧に open–close として表示されます。この画面の編集フォームからは直接変更せず、未設定の場合は「未設定」と出ます。',
      },
    ],
  },

  'golf/products': {
    title: 'ゴルフ予約商品',
    summary:
      '公開する予約サービス（プレー区分）、曜日別受付枠、キャディ付き商品の供給量連携を扱います。既定通貨・タイムゾーンは設定画面の「ゴルフ拡張設定」で変更します。',
    usage: [
      {
        heading: '画面の読み方',
        body: '上から「予約サービス」一覧→選択中サービスの「受付枠」→（キャディ付きのとき）「キャディ供給量から枠数を算出」の順です。メトリクスでサービス数・受付枠合計を確認できます。',
      },
      {
        heading: '予約サービスを追加・編集する',
        body: '「予約サービスを追加」で「予約サービスID」（英数字と ._:-）、プレー区分（キャディ付き / セルフ）、ホール数、想定所要時間（30〜720分）を入力し「プレー設定を保存」します。編集時はサービスIDを変更できません。一覧の行クリックまたは「編集」で選択し、下の受付枠がそのサービスに切り替わります。',
      },
      {
        heading: '受付枠を編集・保存する',
        body: '選択中サービスのパネルで曜日・開始・終了・最大組数・最大人数を編集します。「受付枠を追加」で行を足し、「受付枠を保存」でサーバー上の枠を置き換えます。0 は制限なし。同じ曜日・開始・終了の重複は保存できません。枠読み込み失敗時は空のまま保存すると既存枠を消す恐れがあるので、先に「再読み込み」してください。',
      },
      {
        heading: 'キャディ供給量から枠数を反映する',
        body: 'プレー区分がキャディ付きのときだけ下部パネルが出ます。「対象日」を選び「供給量を算出」→午前/午後の組数と稼働キャディを確認→「この曜日の枠数へ反映」で選択中サービスの同一曜日へ書き込みます。反映直後は未保存なので、必ず「受付枠を保存」まで実行してください。希望休未登録者は稼働可能とみなす警告が出ます。',
      },
      {
        heading: 'よくあるミス',
        body: 'プレー設定と受付枠は別々に保存します。「未保存」バッジがあるまま画面を離れると変更が失われます。セルフ商品では供給量パネルは出ず、組数・人数を受付枠で直接設定します。',
      },
      {
        heading: '関連画面',
        body: '通貨・タイムゾーンは設定の「ゴルフ拡張設定」。コースは設定のコース管理。名簿の希望休・配置のキャディ付枠・予約ポリシーとあわせて運用します。',
      },
    ],
    data: [
      {
        heading: 'Reservation product',
        body: '予約サービス（商品）。reservationServiceId・playType（caddie/self）·holeCount·expectedDurationMinutes。API: /v1/erp/extensions/golf-course/reservation-products',
      },
      {
        heading: 'Product slot',
        body: '曜日別受付枠。weekday / startTime / endTime / maxGroups / maxPlayers。PUT …/reservation-products/{serviceId}/slots で一括置き換えます。',
      },
      {
        heading: 'Caddie capacity',
        body: '名簿の caddie-profiles と caddie-availabilities から算出する午前・午後の販売上限。枠への反映はローカル編集で、保存するまで API には書き込まれません。',
      },
    ],
  },

  'golf/policy': {
    title: '予約ポリシー',
    summary:
      'ティータイムの基本条件、会員/ゲストのデポジット率、セルフを止める時間帯（セルフロック）、客単価判定をテナント共通の予約ルールとして管理します。',
    usage: [
      {
        heading: '設定の有無を確認する',
        body: 'ヘッダー右のバッジが「設定済み」か「未作成」かを見ます。未作成（API 404）でもフォームは出せるので、入力して初めて PATCH で作成されます。「再読み込み」でサーバー値に戻せます。',
      },
      {
        heading: '予約枠の基本条件を入れる',
        body: '「予約種別ID」（空なら既存/既定値）、「既定ホール数」（9/18）、「1枠の最大人数」（1〜4）、「カート利用」（任意 / 必須 / 利用不可）、「予約締切」（ティータイム開始の何時間前まで受付）を設定します。',
      },
      {
        heading: 'デポジットを設定する',
        body: '「会員デポジット率」「ゲストデポジット率」を 0〜100% で入力します。保存時は内部的に basis points（百分率×100）へ変換されます。公開予約の事前決済割合に使われます。',
      },
      {
        heading: 'セルフロックを使う',
        body: 'パネル右の「有効」をオンにすると、指定曜日・時間帯はセルフ予約を止め、キャディ付き優先にできます。曜日ボタン（未選択＝全曜日）と開始/終了を設定し、「時間帯を追加」で複数帯を登録します。重なる時間帯があると保存できません。',
      },
      {
        heading: '客単価判定を使う',
        body: '「客単価判定」を有効にし、「1人あたり基準額」と「基準未満の扱い」（管理者確認待ち / 予約を拒否）を選びます。基準額を空欄にすると予算マスタの目標客単価に連動します。',
      },
      {
        heading: '保存する',
        body: '上部または下部の「変更を保存」「予約ポリシーを保存」で一括保存します。保存後の新規予約判定から反映されます。他システム連携用の metadataJson は設定画面の「連携メタデータ」で編集します。',
      },
    ],
    data: [
      {
        heading: 'Reservation policy',
        body: 'テナント1件の予約ポリシー。API: GET/PATCH /v1/erp/extensions/golf-course/reservation-policy。defaultHoles、maxPlayersPerTeeTime、cartPolicy、cutoffHours、member/guestDepositBps を持ちます。',
      },
      {
        heading: 'policyHooksJson.selfLock',
        body: 'セルフロック。enabled と windows（weekdays / start / end）。需要の高い帯でセルフを抑止します。',
      },
      {
        heading: 'policyHooksJson.spendJudgment',
        body: '客単価判定。enabled、minPerPlayer、action（review/reject）。予算マスタの目標客単価や予約受付可否と連動します。',
      },
      {
        heading: 'metadataJson',
        body: 'PMS / OTA 連携用の任意 JSON。現場運用画面には出さず、設定 → 連携メタデータで編集します。',
      },
    ],
  },

  'course-map': {
    title: 'コースマップ',
    summary:
      'コース俯瞰図の上にカート位置をリアルタイム（または開発モック）で重ねて表示します。現場の位置把握用で、予約や配置の編集は行いません。',
    usage: [
      {
        heading: 'ツールバーを読む',
        body: '左に接続状態と台数が出ます。「リアルタイム · N台」は本番 WS 接続、「開発モック · N台」はブラウザ開発用シミュレーター、「接続中」「オフライン」は WS の状態です。右には接続先の説明（Desktop simulator / Browser mock）が表示されます。',
      },
      {
        heading: 'マーカーの見方',
        body: '色付きの丸がカートです。位置はマップ画像上の座標に追従して動きます。台数が変わるとマーカーの増減も連動します。',
      },
      {
        heading: 'デスクトップ（Tauri）で実データを見る',
        body: 'デスクトップアプリでは ws://127.0.0.1:9001 のカート WebSocket から位置を受け取ります。シミュレーターが止まっていると「オフライン」になり、再接続を自動で試します。',
      },
      {
        heading: 'ブラウザ開発時',
        body: 'Vite などブラウザ開発ではモックカートが優先され、実 WS へは接続しません（接続失敗のちらつきを避けるため）。表示は「開発モック」になります。',
      },
      {
        heading: 'この画面でしないこと',
        body: '割当変更・勤怠・予約編集はできません。担当の変更は配置、出退勤は勤怠画面で行います。',
      },
    ],
    data: [
      {
        heading: 'Cart update',
        body: '各マーカーの元データ。id / x / y / heading / color / caddieNumber。x は画像幅を 0–100 とした座標、y はアスペクト比に合わせた同系の座標です。',
      },
      {
        heading: 'CartsMessage',
        body: 'WebSocket メッセージ type: "carts" と carts 配列。useCartUpdates が受け取り、CourseMap（Three.js）が描画します。',
      },
      {
        heading: '接続状態',
        body: 'connecting / online / offline / mock。mock のときは mockCartSimulator が一定間隔で位置を更新します。',
      },
    ],
  },

  'golf/caddies': {
    title: '名簿',
    summary:
      'キャディ個人のプロフィール、Field スタッフ連携、対応コース、希望休、割当履歴、顧客評価を管理します。配置・勤怠・給与の前提マスタです。',
    usage: [
      {
        heading: '一覧から選ぶ',
        body: '左の「キャディ名簿」で名前・ID・スタッフID検索、雇用状態（稼働中/休止/停止）、スキル（新人/レギュラー/ベテラン）、スタッフ紐付け（紐付け済み/未紐付け）で絞り込み、行を押して右に詳細を開きます。',
      },
      {
        heading: 'キャディを追加する',
        body: '「キャディを追加」で表示名・基本費用・スキル・ランク（A〜D）を入れ、既存スタッフへの紐付けまたは新規スタッフ作成を選んで「キャディを作成」します。勤怠と給与 CSV のため、スタッフ紐付けは必須運用です。',
      },
      {
        heading: '基本・連携タブ',
        body: '「基本情報を編集」でプロフィールを更新します。「スタッフ・勤怠」で未紐付けならスタッフを連携し、「対応コース」で担当可能コースとメイン拠点を保存します。未紐付け人数がいると上部に警告が出ます。',
      },
      {
        heading: '希望休タブ',
        body: '「希望休・体調カレンダー」で日付を選び、稼働可否（available / unavailable / morning_only など）や2ラウンド希望を登録します。配置の供給計算と予約商品のキャディ供給量算出の入力になります。',
      },
      {
        heading: '割当・評価タブ',
        body: '「割当」でそのキャディの割当履歴を見たり完了/キャンセルできます。「評価」で顧客評価の一覧を確認します。当日の一括配置作業はサイドバーの「配置」画面が主戦場です。',
      },
      {
        heading: 'よくあるミス',
        body: 'スタッフ未連携のまま配置や勤怠に進むと打刻できません。希望休を入れ忘れると、予約商品の供給量計算で「希望休未登録＝稼働可能」とみなされ、枠を過剰に開けてしまうことがあります。',
      },
    ],
    data: [
      {
        heading: 'Caddie profile',
        body: 'キャディ個人マスタ。displayName、skillLevel、rank、baseFeeAmount、maxRoundsPerDay、employmentStatus、staffId など。API: /v1/erp/extensions/golf-course/caddie-profiles',
      },
      {
        heading: 'Staff link',
        body: 'Field の /v1/erp/staff との紐付け。出勤/退勤 API（/v1/erp/staff/{id}/clock-in|out）と給与 CSV のキーになります。',
      },
      {
        heading: 'Availability / time-off',
        body: '希望休・勤務希望レコード（date / status / twoRoundRequest）。配置供給と予約商品のキャディ容量計算が参照します。',
      },
      {
        heading: 'Course membership',
        body: 'キャディが担当可能なコースと isPrimary。コース管理で登録した有効コースが一覧の候補になります。',
      },
    ],
  },

  'golf/caddies/dispatch': {
    title: '配置',
    summary:
      '運用日ごとのキャディ割当が主作業です。割当ボードで完了・取消を更新し、キャディ付枠・スマート自動配置・推薦候補は補助として使います。',
    usage: [
      {
        heading: '運用日を合わせる',
        body: '「運用日」を当日（または対象日）にしてから作業します。メトリクスの登録キャディ・勤務中・本日の割当・要確認（pending 等）は、この日付基準です。',
      },
      {
        heading: '割当ボードで確定する',
        body: '当日の割当一覧が中心です。各行でステータスを「完了」または「キャンセル」に更新します。ここが配置の本番操作で、勤怠打刻はサイドバーの「勤怠」で行います（説明文にも明記されています）。',
      },
      {
        heading: 'キャディ付枠を確認する',
        body: '「供給と自動配置」内の「キャディ付枠」で、勤務希望と2ラウンド可否から販売上限（供給力・安全上限・予約済み・残枠）を見ます。「安全予備（組）」を増やすと上限が下がります。販売枠そのものの変更はゴルフ予約商品側で行います。',
      },
      {
        heading: 'スマート自動配置を使う',
        body: '「配置をプレビュー」（dry-run）で未割当のキャディ付き予約への候補を確認し、内容がよければ「この配置を確定」します。スキップ件数と理由も表示されます。プレビューなしのいきなり確定はできません（確定ボタンはプレビュー結果があるときだけ有効）。',
      },
      {
        heading: '推薦候補を参考にする',
        body: '「推薦候補」はスキル・評価・割当負荷などから候補を示します。そのまま確定する機能ではなく、手動判断の補助です。',
      },
      {
        heading: '事前に名簿を整える',
        body: '希望休未登録・スタッフ未連携・対応コース未設定のままだと、供給や自動配置の精度が落ちます。問題があるキャディは名簿へ戻って修正します。',
      },
    ],
    data: [
      {
        heading: 'Assignment',
        body: '運用日 × 予約/ラウンド × キャディの割当。scheduledAt、status、assignmentRole、feeAmount など。API: /v1/erp/extensions/golf-course/caddie-assignments',
      },
      {
        heading: 'Caddie supply',
        body: 'GET …/caddie-supply?date=&safetyBuffer=。availableCaddies、caddieAttachedCap、remaining など。販売上限の参考値です。',
      },
      {
        heading: 'Auto-assignment',
        body: 'POST …/caddie-auto-assignments（dryRun true/false）。未割当予約への提案と確定を行います。',
      },
      {
        heading: 'Recommendation',
        body: 'GET …/caddie-recommendations。推薦スコアと rationale テキストを返します。',
      },
    ],
  },

  'golf/caddies/attendance': {
    title: '勤怠',
    summary:
      '運用日の出勤状態と当日割当を照合し、その場で出勤・退勤を打刻します。誰がどの枠かは配置、実際に出退勤したかは勤怠、と役割を分けて使います。',
    usage: [
      {
        heading: '運用日を選ぶ',
        body: '「運用日」を対象日に合わせると、出勤ボードがその日のスナップショットを読み込みます。',
      },
      {
        heading: '出勤ボードを読む',
        body: '各行にキャディ名、本日の組数、出勤状態（未連携 / 未打刻 / 勤務中 / 退勤済）、要確認（割当があるのに未出勤など）が出ます。',
      },
      {
        heading: '出勤・退勤を打刻する',
        body: '「出勤」「退勤」ボタンで Field スタッフの clock-in / clock-out を実行します。勤務中は出勤ボタンが無効、勤務中以外は退勤が無効です。',
      },
      {
        heading: '未連携を先に直す',
        body: '状態が未連携、または打刻時に「スタッフが未紐付けです」と出る場合は、名簿でスタッフを紐付けてからやり直します。未連携のままでは打刻できません。',
      },
      {
        heading: '配置との違い',
        body: '配置は「誰をどの予約に割り当てたか」、勤怠は「実際に出退勤したか」です。割当完了と出勤は別操作なので、ラウンド開始前に出勤、終了後に退勤、をセットで確認します。',
      },
      {
        heading: '給与への影響',
        body: '退勤未記録や割当に対する未出勤は、給与画面の「要確認」に残り CSV 出力前のチェック対象になります。',
      },
    ],
    data: [
      {
        heading: 'Attendance snapshot',
        body: 'GET …/caddie-attendance-snapshot?date=。caddieProfileId、attendanceStatus、todayAssignments、roundsWithoutClockInToday を返します。',
      },
      {
        heading: 'Clock event',
        body: '実打刻は POST /v1/erp/staff/{staffId}/clock-in および clock-out。キャディ ID ではなく紐づいたスタッフ ID がキーです。',
      },
    ],
  },

  'golf/caddies/payroll': {
    title: '給与',
    summary:
      '月次でキャディごとの実働・シフト・担当ラウンド・確定費用を照合し、給与連携用 CSV を出力します。',
    usage: [
      {
        heading: '対象月を選ぶ',
        body: '「給与連携」パネルの月選択（type=month）を対象年月にすると、集計期間とキャディ別行が読み込まれます。',
      },
      {
        heading: 'サマリーを確認する',
        body: '実働合計、担当ラウンド、確定費用、要確認件数を見ます。要確認は退勤未記録や割当に対する未出勤の合計です。0 になるまで勤怠・配置を直すのが安全です。',
      },
      {
        heading: 'キャディ別集計を見る',
        body: '「キャディ別集計」で表示名・スタッフID、実働、シフト、担当 R、確定費用、確認バッジ（確認済み / 退勤未記録 / 未出勤 nR）を確認します。スタッフ未連携は「スタッフ未連携」と出ます。',
      },
      {
        heading: 'CSV を出力する',
        body: '「CSVを出力」で caddie-payroll-{yearMonth}.csv をダウンロードします。給与システムへ渡す前に、要確認行がないことを確認してください。',
      },
      {
        heading: 'データが空のとき',
        body: '勤務や確定割当がない月は空表になります。先に配置で割当を完了し、勤怠で出退勤を記録してから再読み込みします。',
      },
    ],
    data: [
      {
        heading: 'Payroll summary',
        body: 'GET …/caddie-payroll-summary?yearMonth=。キャディ単位の workedMinutes、shiftedMinutes、assignedRounds、confirmedFeeTotal、openClockIn、roundsWithoutClockIn など。',
      },
      {
        heading: 'Payroll CSV',
        body: 'GET …/caddie-payroll-summary/export.csv?yearMonth=。画面の「CSVを出力」がこのエンドポイントをダウンロードします。',
      },
    ],
  },

  'golf/budgets': {
    title: '予算マスタ',
    summary:
      'コース×日付の日次予算（目標売上・目標客単価・キャディ付き比率）を登録し、予約実績との達成率を月単位で確認します。画面タイトルは「日次予算」です。',
    usage: [
      {
        heading: '対象月とコースを選ぶ',
        body: '「対象月」で年月を選びます。「コース」フィルタは「登録済み予算」一覧の絞り込みに使います（月間進捗の実績は全コース集計）。期間は from–to として表示されます。',
      },
      {
        heading: '月間の進捗を見る',
        body: '「月間の進捗」で目標売上・実績売上・達成率・予約/プレイヤーを確認し、日別テーブルで売上・客単価・キャディ比率の実績/目標を並べて見ます。実績 API が失敗しても予算編集は続けられます。',
      },
      {
        heading: '1日分を追加・更新する',
        body: '「1日分を追加・更新」でコース・日付・目標売上・目標客単価・キャディ付き比率（0〜100%）を入れ「予算を保存」します。同じコース・日付を再保存するとその日の予算が更新されます。コース未登録時は設定 → コース管理へ進みます。',
      },
      {
        heading: 'CSV で一括投入する',
        body: '「テンプレート」でヘッダー付き CSV をダウンロードし、編集後にファイル選択→プレビュー確認→「プレビュー内容を反映」でインポートします。ヘッダーは golf_course_id,date,target_revenue,target_average_spend,target_caddy_attached_ratio である必要があります（比率は 0.70 のような小数）。',
      },
      {
        heading: '予約ポリシーとの関係',
        body: '予約ポリシーの客単価判定で基準額を空欄にしている場合、ここで設定した目標客単価が判定の参照になります。',
      },
      {
        heading: '運用のコツ',
        body: '週次で達成率の低い日を見直し、キャディ付き比率の目標と配置・受付枠の実態がずれていないか確認します。',
      },
    ],
    data: [
      {
        heading: 'Daily budget',
        body: 'コース×日付の予算。targetRevenue、targetAverageSpend、targetCaddyAttachedRatio（API 上は 0–1）。POST /v1/erp/extensions/golf-course/daily-budgets',
      },
      {
        heading: 'Achievement',
        body: 'GET …/daily-budgets/achievement。実績売上・客単価・キャディ比率・予約数・プレイヤー数と達成率を返します。',
      },
      {
        heading: 'CSV import',
        body: 'POST …/daily-budgets/import（Content-Type: text/csv）。テンプレートの列順・列名と一致させる必要があります。',
      },
    ],
  },

  'golf/settlement': {
    title: '月次精算',
    summary:
      '対象月の予約売上・入金・返金、キャディ費用、未収キャンセル料、Square 照合を締め前に一覧確認し、必要なら CSV 出力や Square 請求書発行を行います。',
    usage: [
      {
        heading: '対象月を選んで読み込む',
        body: '「対象月」を選び、期間（startDate — endDate）が表示されることを確認します。「更新」で再集計します。',
      },
      {
        heading: '精算サマリーを照合する',
        body: '予約売上・入金済み・未収・返金済み、キャディ費用（割当件数）、未収キャンセル料、Square 入金/返金/未照合を上から順に見ます。会計の月次締めそのものではなく、ゴルフ運用精算の締め前チェックです。',
      },
      {
        heading: 'Square 警告を読む',
        body: '照合テーブル未設定などの警告が出ることがあります。その場合、Square 系の数値は参考値として扱い、未照合件数の解消を優先します。',
      },
      {
        heading: 'ドリルダウンで対象を特定する',
        body: '「対象予約」「未収キャンセル予約」に予約 ID が一覧されます。詳細操作は下の「未収キャンセル料」テーブルで行います。',
      },
      {
        heading: '未収キャンセル料を処理する',
        body: '行ごとに支払状態・金額・請求の発行済み/未発行を確認します。「請求書を発行」または「既存請求を確認」で Square 請求を発行/再利用し、「開く」「決済ページを開く」で支払い URL をブラウザ表示します。同じ予約への再実行は既存請求の再利用になります。',
      },
      {
        heading: 'CSV を出力する',
        body: '「CSVを出力」で golf-monthly-settlement-{yearMonth}.csv をダウンロードし、経理共有や保管に使います。',
      },
      {
        heading: '締め前チェックの観点',
        body: '画面下部の案内どおり、予約（売上/入金/返金の差分）、キャディ（割当件数と費用）、決済（未収と Square 未照合）を解消してから月を閉じます。単独のキャンセル料請求作成は「キャンセル料」画面でも行えます。',
      },
    ],
    data: [
      {
        heading: 'Monthly settlement report',
        body: 'GET …/monthly-settlement?yearMonth=。reservations / caddieFees / cancellations / square / drilldown をまとめた締め前レポートです。',
      },
      {
        heading: 'Unpaid cancellation item',
        body: 'drilldown.unpaidCancellationItems。reservationId、cancellationFeeAmount、checkoutUrl、linkIssued、paymentStatus。請求発行は POST /v1/erp/reservations/{id}/billing-invoice',
      },
      {
        heading: 'Settlement CSV',
        body: 'GET …/monthly-settlement/export.csv?yearMonth=。画面の CSV 出力がこの API を使います。',
      },
    ],
  },

  'cancellation-fees': {
    title: 'キャンセル料',
    summary:
      'キャンセル料請求だけを一覧し、新規作成（Stripe 支払いリンク付き）・メール/SMS 送信・入金確認・PDF 取得を行います。詳細・新規ルートでも同じガイドを表示します。',
    usage: [
      {
        heading: '一覧で未収を把握する',
        body: 'メトリクスの未入金・期限超過・入金済を確認し、「請求一覧」で状態フィルタ（下書き/送付済/送信失敗/入金済/期限超過）を切り替えて行を開きます。Course Board 識別子または「キャンセル料」明細を持つ請求だけが表示されます。',
      },
      {
        heading: '新規請求を作成する',
        body: '「新規請求」で作成画面へ進みます。「キャンセル内容」（対象予約・注文、金額、税、理由、備考）、「請求先」（請求先名、取引先ID、支払期限）、「送信」（メール/SMS の少なくとも一方）を入力し「請求を作成して送信」します。SMS 時は同意確認と日本の携帯/E.164 番号が必要です。',
      },
      {
        heading: '作成後の送信失敗に対応する',
        body: '請求自体は作成済みでも通知だけ失敗することがあります。警告から「請求詳細へ」を開き、「リンク発行・再送」で支払いリンクと通知をやり直せます。',
      },
      {
        heading: '詳細画面で入金を追う',
        body: '詳細では請求額・状態・メール/SMS 配信状態を確認し、「支払いページ」「URLコピー」「PDF」「リンク発行・再送」を使います。状態の手動更新や支払いリンク再作成も操作パネルから行えます。Stripe 入金後に Paid（入金済）へ同期されます。',
      },
      {
        heading: '月次精算との使い分け',
        body: '個別の顧客向け請求・通知はこの画面。月次で未収キャンセルをまとめて Square 請求する作業は月次精算の「未収キャンセル料」でも行えます。',
      },
      {
        heading: 'よくあるミス',
        body: 'メールも SMS もオフのまま作成できない、SMS 同意チェック漏れ、金額 0 円、電話番号形式不正、が典型です。notes に [courseboard:cancellation-fee] が付くため、通常の請求一覧とは別フィルタでここだけに出ます。',
      },
    ],
    data: [
      {
        heading: 'Cancellation fee invoice',
        body: 'Field Invoice。notes に [courseboard:cancellation-fee] または明細 description が「キャンセル料」で始まるもの。API: /v1/invoices、fulfill でリンク発行・通知。',
      },
      {
        heading: 'Payment link (Stripe)',
        body: 'createPaymentLink + paymentLinkProvider: stripe。paymentLinkUrl / paymentLinkStatus。公開支払いページ経由の入金で status が Paid になります。',
      },
      {
        heading: 'Delivery status',
        body: 'emailDeliveryStatus / smsDeliveryStatus（Pending / Sent / Failed）。画面のメール・SMS メトリクスに対応します。',
      },
      {
        heading: 'PDF',
        body: 'Course Board API の /api/courseboard/invoices/{id}/pdf から請求書 PDF を取得します。',
      },
    ],
  },

  settings: {
    title: '設定',
    summary:
      '初期設定や普段ほぼ触らない項目のハブです。テナントマスタ（コース管理）、Extension runtime、ゴルフ拡張設定（通貨・タイムゾーン）、連携メタデータをまとめています。',
    usage: [
      {
        heading: 'コース管理を開く',
        body: '「テナントマスタ」の「コース管理」を押すと、コース名・ホール数・スタート間隔を編集できます。テナント導入時に一度整えれば、日常のサイドバーには出しません。',
      },
      {
        heading: 'Extension runtime を見る',
        body: '「Extension runtime」パネルにテナント状態（有効/無効）、Registry ステータスとバージョン、設定バージョン、Validation（正常 / エラー件数）が表示されます。',
      },
      {
        heading: 'ゴルフ拡張設定を保存する',
        body: '「既定通貨」（JPY など）と「タイムゾーン」（例: Asia/Tokyo）を変え、「設定を保存」します。金額表示と日付判定の基準になるため、導入時に先に合わせておくのが安全です。予約商品画面には出しません。',
      },
      {
        heading: '連携メタデータを編集する',
        body: '下の「連携メタデータ」は PMS / OTA 連携用の任意 JSON です。プレースホルダとユースケース例を参考にキーを入れ、「メタデータを保存」します。日常の受付運用では空の {} のままで構いません。',
      },
      {
        heading: 'その他の設定変更の場所',
        body: 'プレー区分・受付枠は「ゴルフ予約商品」、受付条件は「予約ポリシー」画面です。',
      },
    ],
    data: [
      {
        heading: 'Tenant masters',
        body: 'コース管理など、導入時マスタ。ルート例: golf/courses。設定ハブから遷移します。',
      },
      {
        heading: 'Extension config (tenant)',
        body: '既定通貨・タイムゾーン。PATCH /v1/erp/extensions/golf_course/config（scopeType: tenant）。',
      },
      {
        heading: 'Extension status',
        body: 'GET /v1/erp/extensions/status の1行。extensionKey: golf_course、tenantStatus、registryStatus、version、configVersion、validation。',
      },
      {
        heading: 'metadataJson',
        body: '予約ポリシーに付く連携用 JSON。PATCH /v1/erp/extensions/golf-course/reservation-policy の metadataJson。',
      },
    ],
  },
}

function normalizeHelpRoute(route: string) {
  if (route.startsWith('cancellation-fees')) return 'cancellation-fees'
  if (route === 'golf/caddies' || (route.startsWith('golf/caddies/') && !['dispatch', 'attendance', 'payroll'].includes(route.split('/')[2] ?? ''))) {
    return 'golf/caddies'
  }
  if (helpByRoute[route]) return route
  // Longest matching prefix for nested routes.
  const candidates = Object.keys(helpByRoute)
    .filter(key => route === key || route.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)
  return candidates[0] ?? null
}

export function getPageHelp(route: string): PageHelp {
  const key = normalizeHelpRoute(route)
  return (key && helpByRoute[key]) || fallbackHelp
}
