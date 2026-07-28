export const map = {
  status: {
    live: 'カートの位置を表示中 · {{n}}台',
    mock: 'テストデータを表示中 · {{n}}台',
    connecting: 'つないでいます…',
    offline: 'つながっていません',
  },
  demoCourseName: '空沼コース',
  legend: {
    inProgress: 'まわっています',
    delayed: 'おくれています',
    waiting: '待っています',
  },
  source: {
    mock: 'ブラウザ用のテストデータです',
    desktop: 'コース内の計測機とつないでいます',
  },
} as const
