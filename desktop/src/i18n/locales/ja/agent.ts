export const agent = {
  chat: {

  "activityRunning": "作業中…",
  "activityDone": "作業履歴（{{count}}件完了）",
  "activityErrors": "作業履歴（{{count}}件・要確認）",
  "operations": {
    "read": "{{resource}}を確認しています",
    "create": "{{resource}}を登録しています",
    "update": "{{resource}}を更新しています",
    "remove": "{{resource}}を削除しています"
  },
  "resources": {
    "reservations": "予約",
    "customers": "顧客情報",
    "settlement": "月次集計",
    "products": "プレー商品",
    "courses": "コース",
    "caddies": "キャディ情報",
    "assignments": "キャディの配置",
    "shifts": "シフト",
    "budgets": "売上目標",
    "information": "情報"
  }
,
  "history": {
  "open": "会話の履歴を開く",
  "title": "会話の履歴",
  "description": "このタブでの直近30件の会話です。会話を選ぶと続きから再開できます。",
  "empty": "まだ会話がありません。"
},
  "trace": {
  "running": "実行中",
  "ok": "完了",
  "error": "失敗",
  "input": "入力",
  "output": "結果",
  "failed": "操作に失敗しました。対象の画面で現在の状態を確認してください。"
},

  breakdown: {
  "title": "{{date}}のコース別予約内訳",
  "source": "予約台帳から取得した名称・数値をそのまま表示しています。",
  "course": "コース",
  "groups": "組数",
  "players": "人数",
  "self": "セルフ",
  "caddie": "キャディ付き",
  "total": "合計",
  "capacity": "空き枠：{{count}}枠",
  "capacityPartial": "把握済みの空き枠：{{count}}枠（{{missing}}コース分は不明）"
},
  reservationTotals: '予約台帳 {{date}}：{{groups}}組・{{players}}名',
  reservationIncomplete: '予約台帳を完全には取得できませんでした',
  reservationStatus: '予約台帳から予約状況を確認しています',
  "title": "Courseboard エージェント",
  "description": "予約・顧客・集計について、自然な言葉で依頼できます。",
  "new": "新しい会話",
  "conversation": "会話",
  "welcome": "調べたいことや、変更したい内容を入力してください。",
  "examples": {
    "reservations": "今日の予約状況を確認して",
    "customers": "顧客を名前で探したい",
    "summary": "今月の売上と来場者数を集計して"
  },
  "you": "あなた",
  "assistant": "エージェント",
  "working": "処理しています…",
  "searching": "使える業務操作を探しています",
  "describing": "操作内容を確認しています",
  "confirmTitle": "この変更を実行しますか？",
  "change": "業務データを変更します。",
  "confirmDescription": "以下の内容で実行します。実行済みの変更は、この画面から取り消せません。",
  "approve": "この内容で実行",
  "reject": "実行しない",
  "declined": "変更を実行しませんでした",
  "prompt": "依頼内容",
  "placeholder": "例：今日の予約状況を教えて",
  "send": "送信",
  "stop": "中断",
  "awaiting": "変更の確認を待っています",
  "tooLong": "依頼文が長すぎます。短くして送信してください。",
  "interrupted": "処理を中断しました。実行済みの変更は取り消されません。必要に応じて対象の画面で確認し、新しい会話から再開してください。",
  "forbidden": "エージェントを利用する権限またはAIの利用設定を確認できませんでした。管理者に確認してください。",
  "failed": "応答を完了できませんでした。変更が実行済みの可能性があるため、対象の画面で確認してから新しい会話を始めてください。",
  "demo": "デモ表示です。AIへの接続や業務データの変更は行いません。",
  "demoReply": "ここでは会話画面のデモを表示しています。実際の環境では、ログイン中の権限を使って予約・顧客・集計を確認できます。",
  "fields": {
    "name": "名前",
    "customerName": "顧客名",
    "customerId": "顧客",
    "reservationId": "予約",
    "date": "日付",
    "startTime": "開始時刻",
    "endTime": "終了時刻",
    "amount": "金額",
    "status": "状態",
    "reason": "理由",
    "phone": "電話番号",
    "email": "メールアドレス",
    "courseId": "コース",
    "partySize": "人数",
    "notes": "備考",
    "target": "対象",
    "body": "内容",
    "query": "条件"
  }
},
}
