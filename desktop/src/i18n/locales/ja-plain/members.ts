import type { DeepPartial } from '../../types'
import type { members as source } from '../ja/members'

/** See `ja-plain/common.ts` for what this locale is for. */
export const members: DeepPartial<typeof source> = {
  title: 'メンバーとできること',
  description: 'このゴルフ場の画面を使う人の一覧です。人を呼んだり、その人ができることを決めたりします。',
  loading: 'メンバーを読み込んでいます',
  forbidden: {
    title: 'メンバーを決める役目がありません',
    body: 'この画面を使うには「メンバーを決める」役目が必要です。ゴルフ場の持ち主はいつでも使えます。管理者にしてもらうか、担当の人に頼んでください。',
  },
  list: {
    title: 'メンバーの一覧',
    description: 'できることは「編集」から変えます。管理者・スタッフ・見るだけ、のどれかひとつを選びます。仕事ごとの追加のできることは、いくつでもつけられます。',
    empty: {
      title: 'できることをつけた人が、まだいません',
      description: '「メンバーを呼ぶ」から、メールアドレスとできることを決めて呼べます。',
    },
  },
  table: {
    name: '名前',
    email: 'メールアドレス',
    role: 'できること',
    self: 'あなた',
  },
  action: {
    editRole: '編集',
    editRoleAria: '{{name}} のできることを変える',
    remove: '外す',
    removeAria: '{{name}} を使えないようにする',
  },
  remove: {
    confirm: '「{{name}}」のできることを、すべて外します。よろしいですか？',
    success: '{{name}} は、この画面を使えないようにしました。',
    failed: 'メンバーを外せませんでした。',
  },
  roleField: 'できること',
  roles: {
    owner: '持ち主',
    ownerSummary: 'このゴルフ場の持ち主です。いつでも、すべてのことができます。',
    unassigned: 'まだ決めていません',
    unassignedSummary: 'できることが、まだ決まっていません。決めるまで、この画面の中身は使えません。',
    admin: {
      label: '管理者',
      summary: 'すべての画面を使えます。メンバーを決めたり、最初の設定を直したりもできます。ほかのものをつける必要はありません。',
    },
    staff: {
      label: 'スタッフ',
      summary: 'ふだんの仕事の入力や書きかえができます。メンバーを決めることと、設定を直すことはできません。',
    },
    viewer: {
      label: '見るだけ',
      summary: '中身を見ることだけできます。入れたり、直したり、消したりはできません。',
    },
  },
  edit: {
    title: '{{name}} のできることを変える',
    description: '管理者・スタッフ・見るだけ、のどれかひとつを選びます。仕事ごとの追加のできることは、いくつでもつけられます。保存すると、すぐに変わります。',
    saveFailedTitle: '保存できませんでした',
    saveFailed: 'できることを変えられませんでした。',
    success: '{{name}} のできることを変えました。',
  },
  invite: {
    trigger: 'メンバーを呼ぶ',
    title: 'メンバーを呼ぶ',
    description: 'すでに登録がある人には、すぐに使えるようにします。登録がない人には、お知らせのメールを送ります。',
    email: 'メールアドレス',
    emailPlaceholder: 'staff@example.com',
    hint: 'メンバーを決めるには「メンバーを決める」役目が必要です（持ち主と管理者は、はじめから持っています）。',
    submit: 'お知らせを送る',
    submitting: 'お知らせを送っています…',
    failedTitle: '呼べませんでした',
    failed: 'うまくいきませんでした。少し時間をおいて、もう一度やってみてください。',
    validation: {
      emailRequired: 'メールアドレスを入れてください。',
      emailFormat: 'メールアドレスの形が正しくありません。',
      roleRequired: 'できることを、ひとつ以上選んでください。',
    },
    result: {
      sent: '{{email}} にお知らせのメールを送りました。相手がそれを受け取ったあと、この画面でできることを決めてください。',
      sentFallback: 'そのアドレス',
      applied: '{{name}} はすでに登録があるので、すぐに使えるようにして、できることもつけました。',
      appliedFallback: 'その人',
    },
  },
}
