import type { DeepPartial } from '../../types'
import type { home as source } from '../ja/home'

/** See `ja-plain/common.ts` for what this locale is for. */
export const home: DeepPartial<typeof source> = {
  title: '最初の画面',
  description: '今日の仕事は、この画面から始めます。',
  launcher: {
    eyebrow: '今日の仕事',
    title: '何をしますか',
    description: '下の四角から、これからする仕事を選んでください。',
    featured: 'よく使う仕事',
  },
  features: {
    title: 'そのほかの仕事',
  },
  flow: {
    title: '今日の進めかた',
    description: '上から順に進めてください。前の画面で入れた内容が、次の画面にそのまま引き継がれます。',
    steps: {
      ledger: {
        label: '予約台帳',
        detail: '今日の予約と、空いているスタートを見ます',
      },
      dispatch: {
        label: 'キャディの担当決め',
        detail: '担当がいない組と、二重になっている人を直します',
      },
      revenue: {
        label: '売上とキャンセル料',
        detail: '目標にどこまで届いたかと、まだ入っていないお金を見ます',
      },
      settlement: {
        label: '1か月のしめ',
        detail: '1か月の売上と費用を合わせて確かめます',
      },
    },
  },
}
