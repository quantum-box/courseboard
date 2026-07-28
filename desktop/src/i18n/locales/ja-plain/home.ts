import type { DeepPartial } from '../../types'
import type { home as source } from '../ja/home'

/** See `ja-plain/common.ts` for what this locale is for. */
export const home: DeepPartial<typeof source> = {
  title: '最初の画面',
  description: '今日の仕事は、この画面から始めます。',
  openTimeline: '今日の予定表を開く',
  flow: {
    title: '今日の進めかた',
    description: '上から順に進めてください。前の画面で入れた内容が、次の画面にそのまま引き継がれます。',
    steps: {
      timeline: {
        label: '今日の予定表',
        detail: '今日の予約と、だれが担当かを見ます',
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
