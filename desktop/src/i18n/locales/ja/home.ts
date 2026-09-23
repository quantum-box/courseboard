export const home = {
  title: 'ホーム',
  description: '今日の仕事はここから始めます。',
  launcher: {
    eyebrow: '今日の業務',
    title: 'どこから始めますか',
    description: '予約の確認からキャディ配置、精算まで、行う仕事を選んでください。',
    featured: 'よく使う業務',
  },
  features: {
    title: 'そのほかの業務',
  },
  flow: {
    title: '今日の進めかた',
    description: '上から順に進めると、同じ予約データがそのまま次の画面に引き継がれます。',
    steps: {
      ledger: {
        label: '予約台帳',
        detail: '今日の予約とスタート枠を確認する',
      },
      dispatch: {
        label: 'キャディの配置',
        detail: '空いている組と重なりを直して担当を決める',
      },
      revenue: {
        label: '売上と請求',
        detail: '目標の達成ぐあいとキャンセル料を確認する',
      },
      settlement: {
        label: '月次精算',
        detail: '1か月の売上と費用をしめる',
      },
    },
  },
} as const
