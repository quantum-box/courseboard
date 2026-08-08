import type { DeepPartial } from '../../types'
import type { common as source } from '../ja/common'

/**
 * Plain Japanese for adults who are not comfortable with IT or industry jargon —
 * not for children or language learners. Kanji and normal spacing stay; what
 * changes is the vocabulary (no loanword jargon, no internal terms), sentence
 * length, and how concrete the instructions are. Keys that would read the same
 * as `ja` are omitted and fall back.
 */
export const common: DeepPartial<typeof source> = {
  app: {
    eyebrow: 'ゴルフ場の仕事',
  },
  action: {
    save: '保存する',
    saving: '保存しています…',
    cancel: 'やめる',
    add: '新しく作る',
    edit: '直す',
    delete: '消す',
    remove: '外す',
    apply: '反映する',
    reset: '元に戻す',
    search: 'さがす',
    refresh: '最新にする',
    reload: 'もう一度読み込む',
    retry: 'もう一度やってみる',
    create: '作る',
    submit: '送る',
    confirm: 'これで決定',
    download: 'ファイルを保存する',
    goHome: '最初の画面に戻る',
  },
  state: {
    loading: '開いています',
    empty: '中身がありません',
    emptyRows: '表示するものがありません',
    required: '入力が必要',
    optional: '入力しなくてもよい',
    enabled: '使える',
    disabled: '止まっている',
    active: '動いている',
    inactive: '動いていない',
    unset: 'まだ決めていない',
  },
  error: {
    loadFailed: '開けませんでした',
    generic: 'うまくいきませんでした',
    unknown: '中身を開けませんでした',
    authRejected:
      'ログインが受け付けられませんでした。一度ログアウトして、もう一度ログインしてください。',
    providerError:
      'システムの問題でできませんでした。システムの担当の人に連絡してください。',
    apiUnreachable:
      'Course Board につながりませんでした。少し待ってから、もう一度開いてください。',
    offline:
      'インターネットにつながっていません。つながっているか確かめて、もう一度開いてください。',
    badRequest:
      '送った内容を受け取ってもらえませんでした。入力したところを見直してください。',
    forbidden: 'この操作をする権限がありません。担当の人に聞いてください。',
    notFound: 'さがしているものが見つかりませんでした。すでに消されているかもしれません。',
    conflict:
      'ほかの人が先に直したため、うまくいきませんでした。もう一度開いてから、やり直してください。',
    unprocessable: '入力したところに間違いがあります。直してから、もう一度やってください。',
    serverError: 'Course Board 側で問題が起きました。少し待ってから、もう一度やってください。',
    unexpected: '思いがけない問題が起きました。少し待ってから、もう一度やってください。',
    authNotReady: 'ログインの準備が終わっていません。もう一度開いてください。',
    sessionExpired: 'ログインしてから時間がたちすぎました。もう一度ログインしてください。',
  },
  external: {
    notAllowed: 'このリンクは開けない決まりになっています。',
    blocked: 'リンクを開けませんでした。新しい画面が開かない設定になっていないか確かめてください。',
  },
  locale: {
    label: '画面のことば',
    description: '画面に出ることばを選びます。',
  },
  theme: {
    label: '画面の色',
    description: '明るい / 暗い',
    toLight: '明るい色にする',
    toDark: '暗い色にする',
  },
}
