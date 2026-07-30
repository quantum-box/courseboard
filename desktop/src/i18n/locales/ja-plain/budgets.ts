import type { DeepPartial } from '../../types'
import type { budgets as source } from '../ja/budgets'

/** See `ja-plain/common.ts` for what this locale is for. */
export const budgets: DeepPartial<typeof source> = {
  title: '日ごとの売上目標',
  description:
    'その月の売上の目標を、日ごとに決めます。実際の予約と並べて見られるので、どこまで届いているかが分かります。',
  loading: '目標と実際の数字を読み込んでいます',
  filter: {
    month: '見たい月',
    allCourses: 'すべてのコース',
    courseNote: 'コースをしぼると、下の一覧だけが変わります',
  },
  progress: {
    title: 'この月の進みぐあい',
    description: 'すべてのコースの実際の予約を、日ごとの目標と重ねて見ます。',
    badge: 'すべてのコース · {{n}}日分',
    unavailable: {
      title: '実際の数字を出せません',
      description: '目標を直すことはできます。実際の数字は、あとでもう一度開いてみてください。',
    },
    empty: {
      title: 'この月の目標がまだありません',
      description: '日ごとの目標を登録すると、実際の売上とくらべた結果がここに出ます。',
    },
    metrics: {
      target: '目標の売上',
      actual: '実際の売上',
      rate: '目標にどこまで届いたか',
      bookings: '予約の数 / 人数',
      bookingsDetail: '件 / 人',
    },
    table: {
      revenue: '売上（実際 / 目標）',
      rate: '目標に届いた割合',
      perPlayer: '1人あたり（実際 / 目標）',
      caddieRate: 'キャディ付き（実際 / 目標）',
    },
  },
  editor: {
    title: '1日分を入れる',
    description: '同じコース・同じ日付で保存すると、前に入れた目標を書きかえます。',
    noCourses: {
      title: 'コースがまだ登録されていません',
      description: '「設定」から「コースの登録」を開いて、先にコースを登録してください。',
    },
    targetRevenue: '目標の売上',
    targetRevenueHint: '円（税込み）',
    targetPerPlayer: '1人あたりの目標',
    targetPerPlayerHint: '1人あたり何円か',
    caddieRate: 'キャディが付く割合',
    caddieRateHint: '0〜100% の間で入れてください',
    save: '目標を保存する',
    saved: '{{date}} の目標を保存しました。',
  },
  csv: {
    title: '表のファイルからまとめて入れる',
    description: '読み込む中身を画面で確かめてから、まとめて登録します。',
    template: 'ひな形をもらう',
    file: '表のファイル（CSV）',
    fileHint: '1行目の見出し: {{header}}',
    columns: {
      title: 'それぞれの列に入れるもの',
      description:
        '1行目の見出しは、この英語のまま変えずに使ってください。変えると読み込めません。2行目から下に、1日分ずつ書きます。',
      header: '列の名前（このまま使う）',
      meaning: '入れるもの',
      example: '書き方の見本',
      golfCourseId:
        'コースの管理用の番号です。下の「登録した目標」の一覧で、コースの名前の下に出ています。「設定」→「コースの登録」でも見られます。',
      date: 'いつの分かを書きます。2026-04-01 のように、年-月-日 の順で書きます。',
      targetRevenue: 'その日にいくら売りたいかを、円で書きます。数字だけで、カンマは入れません。',
      targetAverageSpend: '1人あたりいくらにしたいかを、円で書きます。数字だけで、カンマは入れません。',
      targetCaddyAttachedRatio:
        'キャディが付く割合を、0 から 1 までの小数で書きます。70% にしたいときは 0.70 と書きます。',
      courseIdsTitle: 'いま使えるコースの管理用の番号',
    },
    importing: '読み込んでいます…',
    apply: '確かめた内容を登録する',
    imported: '{{name}} を読み込みました。',
    headerError: 'ファイルの1行目を見直してください。必要な列: {{header}}',
    readError: 'ファイルを読み込めませんでした。',
    importError: 'ファイルの中身を登録できませんでした。',
  },
  list: {
    title: '登録した目標',
    description: '{{from}} から {{to}} まで',
    empty: {
      title: '合う目標がありません',
      description: '上の入力欄か、表のファイルから登録できます。',
    },
    table: {
      targetRevenue: '目標の売上',
      targetPerPlayer: '1人あたりの目標',
      caddieRate: 'キャディが付く割合',
    },
  },
  validation: {
    courseAndDate: 'コースと日付を選んでください。',
    targetRevenue: '目標の売上は 0 円以上で入れてください。',
    targetPerPlayer: '1人あたりの目標は 0 円以上で入れてください。',
    caddieRate: 'キャディが付く割合は 0〜100% で入れてください。',
  },
  saveFailed: '目標を保存できませんでした。',
}
