import type { DeepPartial } from '../../types'
import type { auth as source } from '../ja/auth'

/** See `ja-plain/common.ts` for what this locale is for. */
export const auth: DeepPartial<typeof source> = {
  brand: {
    title: 'ゴルフ場の仕事を、ひとつの画面で。',
    description: '予約、キャディ、コース、キャンセル料まで、この画面でまとめて扱えます。',
  },
  loading: {
    label: '開いています',
    redirecting: 'ログインの画面に移っています…',
    wait: '安全なログインの画面を開いています。少しお待ちください。',
  },
  signIn: {
    description: 'Tachyon のアカウントで Course Board に入ります。',
    username: 'ユーザー名、またはメールアドレス',
    submit: 'ログインする',
    google: 'Google のアカウントでログインする',
    legal: '続けると、利用規約とプライバシーポリシーに同意したことになります。',
    expired: {
      title: 'ログインしてから時間がたちすぎました',
      description: '安全のため、いったんログアウトしました。もう一度ログインしてください。',
    },
  },
  session: {
    verifying: 'ログインの状態を確かめています…',
    expired: 'ログインしてから時間がたちすぎました。もう一度ログインしてください。',
  },
  tenant: {
    kicker: 'ゴルフ場',
    title: '使うゴルフ場を選んでください',
    description: 'これから操作するゴルフ場を選びます。',
    sandbox: '練習用',
    otherAccount: '別のアカウントでログインする',
    select: 'ゴルフ場を選ぶ',
  },
  problem: {
    forbidden: {
      title: 'このゴルフ場は見られません',
      description: '見られるゴルフ場に切り替えるか、担当の人に連絡してください。',
    },
    unknown: {
      title: 'ログインの状態が分かりませんでした',
      description: 'ログインの状態が分かりませんでした。',
    },
    initFailed: 'ログインの準備ができませんでした。',
    startFailed: 'ログインを始められませんでした。',
    signInFailed: 'ログインできませんでした。',
    tenantUnverified: {
      title: 'ゴルフ場の情報を確かめられません',
      description: 'このゴルフ場を使えるかどうか、今は分かりません。少し待ってから、もう一度お試しください。',
    },
  },
  error: {
    missingCredentials: 'ユーザー名とパスワードを入力してください。',
    passwordChangeRequired:
      '最初にパスワードを変える必要があります。Tachyon Account Center で変えてから、もう一度ログインしてください。',
    invalidCredentials: 'ユーザー名かパスワードが違います。または、そのアカウントは今使えません。',
    userUnconfirmed: 'アカウントの確認がまだ終わっていません。',
    passwordResetRequired: 'パスワードを決め直す必要があります。',
    tooManyAttempts: '何度も間違えたため、しばらくログインできません。少し待ってからお試しください。',
    rejected: 'ログインが受け付けられませんでした。',
    serviceUnavailable: 'ログインのしくみが今は使えません。少し待ってからお試しください。',
    unreachable: 'ログインのしくみにつながりませんでした。',
    requestExpired: 'ログインの受け付け時間が過ぎました。もう一度ログインしてください。',
    responseMissing: 'ログインの返事が届きませんでした。もう一度ログインしてください。',
    profileFailed: 'ログインした人の情報を受け取れませんでした。',
  },
}
