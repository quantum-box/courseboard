import type { DeepPartial } from '../../types'
import type { courses as source } from '../ja/courses'

/** See `ja-plain/common.ts` for what this locale is for. */
export const courses: DeepPartial<typeof source> = {
  title: 'コースの登録',
  description:
    'コースの名前、ホールの数、組と組の間の時間を登録します。料金プランと、キャディが担当できるコースは、ここで登録したコースから選びます。',
  add: 'コースを登録する',
  notice: {
    added: '「{{name}}」を登録しました。',
    deleted: '「{{name}}」を消しました。',
    failed: 'うまくいきませんでした',
    checkInput: '入力した内容を見直してください',
  },
  editor: {
    createTitle: 'コースを登録する',
    editTitle: 'コースの内容を直す',
    description: '予約の枠を作るときに使う、基本の内容です。',
  },
  field: {
    name: 'コースの名前',
    shortName: '短い名前',
    status: '今の状態',
    holeCount: 'ホールの数',
    startInterval: '組と組の間の時間',
    startIntervalHint: '1〜60分の間で入れてください',
    timezone: '時刻の基準（タイムゾーン）',
    timezoneHint: '「Asia/Tokyo」のように入れてください',
  },
  table: {
    interval: '組と組の間',
    hours: '営業している時間',
    timezone: '時刻の基準',
    status: '今の状態',
    updated: '最後に直した日',
    actions: '操作',
    editAria: '{{name}} を直す',
    deleteAria: '{{name}} を消す',
    deleting: '消しています',
  },
  confirmDelete: '「{{name}}」を消します。よろしいですか。',
  loading: 'コースを読み込んでいます',
  list: {
    title: '登録したコース',
    description: '料金プランと予約の枠が、このコースを使います。',
  },
  empty: {
    title: 'コースがまだ登録されていません',
    description: '最初のコースを登録すると、料金プランと予約の枠を決められるようになります。',
    action: '最初のコースを登録する',
  },
  validation: {
    name: 'コースの名前を入れてください。',
    timezone: '時刻の基準を入れてください。',
    timezoneFormat: '時刻の基準は「Asia/Tokyo」のように、地域の名前で入れてください。「JST」のような短い書き方は使えません。',
    holeCount: 'ホールの数は 9 か 18 を選んでください。',
    startInterval: '組と組の間の時間は 1〜60 分で入れてください。',
  },
  error: {
    generic: 'うまくいきませんでした。',
  },
}
