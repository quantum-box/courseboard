/** 予約状況の取り込み画面。 */
export const reservationImport = {
  title: '予約状況の取り込み',
  description: '予約システムが出す「日別予約状況」のファイルを読み込んで、日ごとの組数を取り込みます。',

  upload: {
    title: 'ファイルを選ぶ',
    description: '予約システムから出した xlsx をそのまま選んでください。ファイル名から対象の月を読み取ります。',
    file: '予約状況のファイル',
    fileHint: '例: 日別予約状況_組数_20260718_202607_真駒内_滝の_羊ケ丘.xlsx',
    month: '対象の月',
    monthHint: 'ファイル名に月が入っていないときだけ、ここで選びます。',
    check: '中身を確認する',
    checking: '読み込んでいます…',
    readError: 'ファイルを読み込めませんでした。もう一度選び直してください。',
  },

  preview: {
    title: '取り込む内容',
    description: '{{yearMonth}}の予約です。この内容でよければ取り込みます。',
    apply: 'この内容で取り込む',
    applying: '取り込んでいます…',
    cancel: 'やめる',
    metric: {
      month: '対象の月',
      courses: 'コース',
      days: '日数',
      groups: '組数',
      caddieGroups: 'キャディ付きの組数',
      skipped: '取り込まない',
    },
    unit: {
      courses: '{{n}}コース',
      days: '{{n}}日',
      groups: '{{n}}組',
      halfDays: '{{n}}件',
    },
    courses: {
      title: 'コースごとの内訳',
      sheetLabel: 'ファイルの表記',
      courseName: 'Course Board のコース',
      days: '日数',
      groups: '組数',
      caddieGroups: 'キャディ付き',
    },
    empty: {
      title: 'まだファイルを選んでいません',
      description: '上でファイルを選ぶと、取り込む前に中身を確認できます。',
    },
  },

  warnings: {
    title: '確認してください',
    description: '取り込みは止まりません。ここに出ている日だけ、あとで元の予約表と見比べてください。',
  },

  /** 行番号ではなく「いつ・どのコース」で書く。現場が確認しに行ける単位。 */
  warning: {
    unreadableCount:
      '{{date}}の{{course}}（{{half}}）の組数が数字として読めませんでした。この半日は取り込みません。',
    caddieGroupsExceedTotal:
      '{{date}}の{{course}}（{{half}}）は、キャディ付き{{caddieGroups}}組が全体の{{totalGroups}}組を超えています。ファイルのとおり取り込みますが、どちらかの数が違っている可能性があります。',
    courseTotalsDisagreeWithSheet:
      '{{date}}（{{half}}）の合計が合いません。ファイルの「全体」は{{sheetTotal}}組ですが、コースを足すと{{importedTotal}}組です。',
    unknownCourse:
      'ファイルの「{{course}}」に対応するコースが Course Board にありません。このコースの予約は取り込みません。コース設定で名前を合わせてください。',
    ambiguousCourse:
      'ファイルの「{{course}}」は {{candidates}} のどれか分かりません。このコースの予約は取り込みません。コース名を区別できるようにしてください。',
    coursesCombined:
      'ファイルの {{candidates}} が、どれも「{{course}}」に対応付けられています。組数は合算して取り込みました。分けて記録したい場合は、コースを分けて対応付けてください。',
    /** 画面がまだ知らない種類。文言が無いまま鍵を出すよりはこちら。 */
    unknown: 'ファイルに確認したほうがよい点があります。取り込んだあと、元の予約表と見比べてください。',
  },

  /** コースの対応付け。名前で当てられなかったものはここで答える。 */
  courses: {
    unanswered: '{{n}}件のコースが、どのコースのことか決まっていません。下で選ぶまで、そのコースの予約は入りません。',
    state: '状態',
    unset: '選んでください',
    ignore: '取り込まない',
    save: 'この対応付けで保存する',
    saving: '保存しています…',
    saveHint: '一度保存すれば、次の月からは選び直す必要はありません。',
    saveFailed: '対応付けを保存できませんでした。',
    resolution: {
      linked: '指定済み',
      suggested: '名前から推定',
      ignored: '取り込まない',
      unresolved: '対応するコースが不明',
      ambiguous: '候補が複数',
    },
  },

  daily: {
    title: '日ごとの組数',
    description: '{{from}} 〜 {{to}}',
    course: 'コース',
    allCourses: 'すべてのコース',
    date: '日付',
    morning: '午前',
    afternoon: '午後',
    total: '合計',
    caddieGroups: 'うちキャディ付き',
    empty: {
      title: 'この月の予約はまだ入っていません',
      description: '上でファイルを取り込むと、日ごとの組数がここに出ます。',
    },
  },

  imported: {
    title: '取り込みました',
    message: '{{yearMonth}}の予約を{{n}}件取り込みました。',
    skipped: '{{n}}件は取り込みませんでした。',
  },

  error: {
    monthRequired: 'ファイル名から対象の月が読み取れませんでした。上で月を選んでからもう一度お試しください。',
    failed: '取り込めませんでした。',
  },
} as const
