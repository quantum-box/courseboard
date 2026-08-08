import type { DeepPartial } from '../../types'
import type { shifts as source } from '../ja/shifts'

/** See `ja-plain/common.ts` for what this locale is for. */
export const shifts: DeepPartial<typeof source> = {
  title: 'シフト表',
  description: 'キャディ一人ひとりの出勤の予定を、ひと月まとめて見ます。休みなしで働き続けている人に早く気づけます。',
  loading: 'シフト表を読み込んでいます',
  month: '見たい月',
  legend: {
    label: 'しるしの意味',
    assigned: '担当が入っている',
    available: '仕事に出られる',
    off: '休みの希望',
    morning: '午前だけ出られる',
    afternoon: '午後だけ出られる',
    light: '軽い仕事なら出られる',
    unknown: '状態を確かめる必要がある',
    none: '予定なし',
  },
  cell: {
    available: '可',
    unknown: '？',
    assignments: '担当 {{n}}件',
  },
  employment: {
    inactive: 'しばらく休んでいる',
    suspended: '登録を止めている',
    unknown: '状態を確かめてください',
  },
  streak: {
    header: '連続',
    days: '{{n}}日',
    warningTitle: '休みなしが続いている人がいます',
    warningBody: '{{names}} は担当がある日や仕事に出られる日が {{n}}日以上つづいています。休みを入れられないか確かめてください。',
    threshold: '6日以上つづくと色がつきます',
  },
  empty: {
    title: 'この月の予定はまだありません',
    description: '担当や休みの希望が入ると、ここに表として出ます。',
  },
}
