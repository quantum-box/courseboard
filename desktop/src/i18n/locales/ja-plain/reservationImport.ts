import type { DeepPartial } from '../../types'
import type { reservationImport as source } from '../ja/reservationImport'

export const reservationImport: DeepPartial<typeof source> = {
  title: '予約の取りこみ',
  description: '予約システムから出したファイルを読みこんで、日ごとの組の数を入れます。',

  upload: {
    title: 'ファイルをえらぶ',
    description: '予約システムから出した xlsx を、そのままえらんでください。何月ぶんかは、ファイルの名前から読みとります。',
    file: '予約のファイル',
    fileHint: 'れい: 日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx',
    month: '何月ぶん',
    monthHint: 'ファイルの名前に月が入っていないときだけ、ここでえらびます。',
    check: '中身をたしかめる',
    checking: '読みこんでいます…',
    readError: 'ファイルを読めませんでした。もういちどえらんでください。',
  },

  preview: {
    title: '入れる中身',
    description: '{{yearMonth}}の予約です。これでよければ入れます。',
    apply: 'これで入れる',
    applying: '入れています…',
    cancel: 'やめる',
    metric: {
      month: '何月ぶん',
      courses: 'コース',
      days: '日にち',
      groups: '組の数',
      caddieGroups: 'キャディが付く組',
      skipped: '入れない',
    },
    unit: {
      courses: '{{n}}コース',
      days: '{{n}}日',
      groups: '{{n}}組',
      halfDays: '{{n}}件',
    },
    courses: {
      title: 'コースごと',
      sheetLabel: 'ファイルの書きかた',
      courseName: 'Course Board のコース',
      days: '日にち',
      groups: '組の数',
      caddieGroups: 'キャディが付く組',
    },
    empty: {
      title: 'まだファイルをえらんでいません',
      description: '上でファイルをえらぶと、入れる前に中身をたしかめられます。',
    },
  },

  warnings: {
    title: 'たしかめてください',
    description: '入れるのは止まりません。ここに出ている日だけ、あとで元の予約表と見くらべてください。',
  },

  warning: {
    unreadableCount:
      '{{date}}の{{course}}（{{half}}）の組の数が、数字として読めませんでした。この半日は入れません。',
    caddieGroupsExceedTotal:
      '{{date}}の{{course}}（{{half}}）は、キャディが付く組が{{caddieGroups}}組で、ぜんぶの{{totalGroups}}組より多いです。ファイルのとおり入れますが、どちらかの数がまちがっているかもしれません。',
    courseTotalsDisagreeWithSheet:
      '{{date}}（{{half}}）の合計が合いません。ファイルの「全体」は{{sheetTotal}}組ですが、コースをたすと{{importedTotal}}組です。',
    unknownCourse:
      'ファイルの「{{course}}」に合うコースが Course Board にありません。このコースの予約は入れません。コースの設定で名前を合わせてください。',
    ambiguousCourse:
      'ファイルの「{{course}}」は {{candidates}} のどれか分かりません。このコースの予約は入れません。コースの名前を見分けられるようにしてください。',
    unknown: 'ファイルに、たしかめたほうがよい点があります。入れたあとで、元の予約表と見くらべてください。',
  },

  daily: {
    title: '日ごとの組の数',
    description: '{{from}} 〜 {{to}}',
    course: 'コース',
    allCourses: 'ぜんぶのコース',
    date: '日にち',
    morning: '午前',
    afternoon: '午後',
    total: '合計',
    caddieGroups: 'うちキャディが付く組',
    empty: {
      title: 'この月の予約は、まだ入っていません',
      description: '上でファイルを入れると、日ごとの組の数がここに出ます。',
    },
  },

  imported: {
    title: '入れました',
    message: '{{yearMonth}}の予約を{{n}}件入れました。',
    skipped: '{{n}}件は入れませんでした。',
  },

  error: {
    monthRequired: 'ファイルの名前から、何月ぶんか読みとれませんでした。上で月をえらんで、もういちどためしてください。',
    failed: '入れられませんでした。',
  },
}
