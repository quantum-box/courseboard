import type { DeepPartial } from '../../types'
import type { dataExports as source } from '../ja/dataExports'

export const dataExports: DeepPartial<typeof source> = {
  title: 'データを表に保存',
  linkDescription: '保存する情報と列を選び、表のファイルにする',
  create: '保存する表の設定を追加',
  name: '設定の名前',
  source: '表にする情報',
  sourceLabels: {
    reservation: '予約',
    sales: '売上の記録',
    purchases: '仕入れの記録',
    journal: '仕訳の明細',
    generalLedger: '科目ごとの取引記録',
    trialBalance: '科目ごとの合計と残高',
    arAp: '受け取るお金・支払うお金',
  },
  chooseSource: '情報を選んでください',
  description: '何に使う設定か',
  columns: '表に入れる列（左から順）',
  download: '表のファイル（CSV）を保存',
  downloadNamed: '{{name}}の表のファイル（CSV）を保存',
  editorDescription: '表に入れる情報と列を選んでください。列の名前と順番を保存すると、次も同じ形で出せます。',
  emptyDescription: '「保存する表の設定を追加」を押し、表にする情報と列を選んでください。',
  helpDescription: '設定を追加したら、一覧から表のファイル（CSV）を保存できます。日付では絞り込めません。情報の種類ごとに出せる件数が決まっています。保存した表はExcelで開けます。',
}
