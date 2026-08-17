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
    status: 'いまの様子',
    role: 'できること',
    self: 'あなた',
  },
  status: {
    active: '参加している',
    pending: 'お知らせを送った',
  },
  searchPlaceholder: '名前やメールアドレスでさがす',
  checklist: {
    selectAll: '全部つける',
    clearAll: '全部外す',
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
    description: 'すでに登録がある人には、すぐに使えるようにします。登録がない人には、お知らせのメールだけを送ります。相手が受け取ったあとで、できることをこの画面で決め直してください。',
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
  policies: {
    golfManager: {
      label: '支配人',
      description: 'ゴルフ場の仕事ぜんぶ（予約・ティーシート・キャディ・シフト・お客さま・お金）を入れたり直したりできます。メンバーを決めることはできません。',
    },
    golfReception: {
      label: 'フロント・予約',
      description: '予約とティーシート、お客さまと会員の登録や書きかえ、料金の計算ができます。キャディとシフトは扱えません。',
    },
    golfCaddieMaster: {
      label: 'キャディマスター',
      description: 'キャディの名簿・割り当て・出勤・シフトを入れたり直したりできます。お客さまの情報は扱えません。',
    },
    golfAccounting: {
      label: 'ゴルフ経理',
      description: '月のしめ・給与のまとめ・料金の計算・キャンセル料の請求ができます。予約は見るだけです。',
    },
    golfViewer: {
      label: 'ゴルフ閲覧',
      description: 'ティーシート・予約・キャディ・シフトを見ることと、料金の計算ができます。入れたり直したりはできません。',
    },
    fieldSales: {
      label: '営業のしごと',
      description: 'お客さま・注文・会員の登録と書きかえができます。商品と売上のまとめは見るだけです。',
    },
    fieldFinance: {
      label: 'お金のしごと',
      description: '請求書・入金・帳簿・経費の登録と書きかえができます。お客さまの情報は見るだけです。',
    },
    fieldProcurement: {
      label: '仕入れと在庫のしごと',
      description: '在庫・注文・仕入れ先・商品の登録と書きかえができます。売上のまとめは見るだけです。',
    },
    fieldReservations: {
      label: '予約のしごと',
      description: '予約・枠・プランの登録と書きかえができます。お客さまの情報と売上のまとめは見るだけです。',
    },
    fieldHr: {
      label: 'スタッフのしごと',
      description: 'スタッフ・シフト・勤怠の登録と書きかえができます。売上のまとめは見るだけです。',
    },
    fieldAccountingManager: {
      label: '経理のまとめ役',
      description: '帳簿と決算の登録と書きかえ、入金の確認ができます。ほかのお金の情報は見るだけです。',
    },
    fieldExpenseApprover: {
      label: '経費をみとめる役',
      description: '経費の申請を見て、みとめたり、断ったりできます。申請そのものは作れません。',
    },
    fieldPurchaseApprover: {
      label: '仕入れをみとめる役',
      description: '仕入れの帳簿の登録と書きかえができます。注文と入荷は見るだけです。',
    },
    fieldExtensionManager: {
      label: '追加機能の係',
      description: '追加の機能を入れたり、設定を直したりできます。予約は見るだけです。',
    },
    fieldSaasApprover: {
      label: 'SaaS をみとめる役',
      description: 'SaaS の変更の申請を見て、みとめたり、返したりできます。申請そのものは作れません。',
    },
  },
}
