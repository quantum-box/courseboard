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
    aria: '{{name}}、{{date}}、{{state}}',
    ariaWithAssignments: '{{name}}、{{date}}、{{state}}、担当{{n}}件',
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
  deadline: {
    label: '休みの希望を出す締め切り',
    save: '締め切りを決める',
  },
  unsubmitted: {
    title: 'まだ休みの希望が届いていない人がいます',
    body: '{{names}} は、この月の休みの希望がまだ届いていません。聞き漏れがないか確かめてください。',
  },
  confirmation: {
    title: '休みたい日を聞けたか',
    description: '話を聞き終えた人を「聞きました」にしてください。休みたい日が0日でも押せます。',
    loading: 'だれに聞けたかを読み込んでいます',
    uncheckedTitle: 'まだ聞けていない人が{{n}}人います',
    uncheckedDescription: '休みたい日を聞き終えたら、その人の「聞きました」を押してください。',
    uncheckedList: 'まだ聞けていない人',
    completeTitle: '全員に聞きました',
    completeDescription: 'この月は、聞き漏れがありません。',
    markConfirmed: '聞きました',
    confirmedTitle: '聞き終えた人（{{n}}人）',
    undoConfirmed: 'まだ聞いていないにもどす',
    saving: '保存しています…',
    saveFailed: '確認したことを保存できませんでした',
  },
  navigation: {
    label: '表に出す週を変える',
    previous: '前の週',
    current: '今週',
    next: '次の週',
  },
  empty: {
    title: 'この月の予定はまだありません',
    description: '担当や休みの希望が入ると、ここに表として出ます。',
  },
}
