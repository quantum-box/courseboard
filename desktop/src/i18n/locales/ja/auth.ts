/**
 * Sign-in surfaces only. Deployment-time configuration errors (missing env vars,
 * wrong redirect URI) stay untranslated in `auth/adapters.ts` because they are
 * read by whoever deploys the app, not by course staff.
 */
export const auth = {
  brand: {
    title: 'クラブ運営を、ひとつの画面で。',
    description: '予約、キャディ、コース、キャンセル料まで。現場と経営をつなぐゴルフ場の運用画面です。',
  },
  loading: {
    label: '読み込み中',
    redirecting: 'ログイン画面へ移動しています…',
    wait: '安全なログイン画面を開いています。少しお待ちください。',
    dismiss: '閉じる',
  },
  signIn: {
    kicker: 'ログイン',
    title: 'おかえりなさい',
    description: 'Tachyon アカウントで Course Board にログインします。',
    username: 'ユーザー名またはメールアドレス',
    password: 'パスワード',
    submit: 'ログイン',
    google: 'Google でログイン',
    legal: '続けると、利用規約とプライバシーポリシーに同意したことになります。',
    expired: {
      title: 'ログインの有効期限が切れました',
      description: '安全のためログアウトしました。もう一度ログインしてください。',
    },
  },
  session: {
    verifying: 'ログインの状態を確認しています…',
    expired: 'ログインの有効期限が切れました。もう一度ログインしてください。',
  },
  tenant: {
    kicker: '施設',
    title: '使う施設を選んでください',
    description: 'このログインで操作する施設を選びます。',
    production: '本番',
    sandbox: 'テスト',
    otherAccount: '別のアカウントでログイン',
    select: '施設を選ぶ',
  },
  problem: {
    forbidden: {
      title: 'この施設を見る権限がありません',
      description: '使える施設に切り替えるか、管理者に権限を確認してください。',
    },
    unknown: {
      title: 'ログインの状態を確認できませんでした',
      description: 'ログインの状態を確認できませんでした。',
    },
    initFailed: 'ログインの準備ができませんでした。',
    startFailed: 'ログインを始められませんでした。',
    signInFailed: 'ログインできませんでした。',
    tenantUnverified: {
      title: '施設の情報を確認できません',
      description: 'この施設の権限を確認できませんでした。少し時間をおいて、もう一度お試しください。',
    },
  },
  error: {
    missingCredentials: 'ユーザー名とパスワードを入力してください。',
    passwordChangeRequired:
      '最初のパスワード変更が必要です。Tachyon Account Center で変更してから、もう一度ログインしてください。',
    invalidCredentials: 'ユーザー名かパスワードが違うか、アカウントが使えない状態です。',
    userUnconfirmed: 'アカウントの確認が終わっていません。',
    passwordResetRequired: 'パスワードの再設定が必要です。',
    tooManyAttempts: 'ログインを試した回数が多すぎます。少し待ってからもう一度お試しください。',
    rejected: 'ログインが受け付けられませんでした。',
    serviceUnavailable: 'ログインのしくみが一時的に使えません。少し待ってからお試しください。',
    unreachable: 'ログインのしくみにつながりませんでした。',
    requestExpired: 'ログインの受付時間が過ぎました。もう一度ログインしてください。',
    responseMissing: 'ログインの返事を受け取れませんでした。もう一度ログインしてください。',
    profileFailed: 'ログインした人の情報を取得できませんでした。',
  },
} as const
