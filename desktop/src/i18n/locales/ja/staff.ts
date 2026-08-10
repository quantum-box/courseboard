/** Staff roster: the club's own employees, caddies among them. */
export const staff = {
  loading: '社員を読み込んでいます…',
  caddieUnavailable: 'キャディの情報を読み込めないので、役割の列は空欄になります。',
  filter: {
    search: 'さがす',
    searchPlaceholder: '名前または社員ID',
    employment: '働いているか',
    employmentActive: '働いている人',
    employmentRetired: '退職した人',
    role: '役割',
    roleCaddie: 'キャディを担当',
    roleOther: 'キャディ以外の社員',
    all: 'すべて',
  },
  list: {
    empty: {
      title: '該当する社員がいません',
      description: 'さがす条件を変えるか、社員を登録してください。',
    },
  },
  table: {
    name: '名前',
    employmentType: '雇用のかたち',
    caddie: 'キャディ',
  },
  retired: '退職ずみ',
  employmentType: {
    full_time: '常勤',
    part_time: 'パート・アルバイト',
  },
  role: {
    caddie: '{{rank}}ランク・{{skill}}',
  },
  action: {
    makeCaddie: 'キャディにする',
  },
  detail: {
    back: '名簿へ戻る',
    basics: '基本情報',
    openCaddie: 'キャディの画面を開く',
    noCaddie: 'キャディの担当はありません。',
    notFound: {
      title: '社員が見つかりません',
      description: '削除されたか、IDが違います。名簿へ戻ってさがし直してください。',
    },
  },
  editName: {
    action: '名前を直す',
    title: '{{name}}さんの名前を直す',
    description: '社員名簿の名前を変更します。キャディ名簿など、この社員を使う画面にも反映されます。',
    name: '名前',
    submit: '名前を保存',
    submitting: '保存しています…',
    success: '{{name}}さんの名前を社員名簿に保存しました。',
    error: {
      name: '名前を入力してください。',
      forbidden: '社員名を変更する権限がありません。管理者に field:ManageHrm 権限を確認してください。',
      notFound: '社員が見つかりませんでした。名簿を読み込み直してください。',
      failed: '社員名を保存できませんでした。もう一度お試しください。',
    },
  },
  create: {
    open: '社員を登録',
    title: '社員を登録',
    description: '会社の名簿に社員を追加します。キャディにするかどうかは、あとから決められます。',
    name: '名前',
    employmentType: '雇用のかたち',
    submit: '社員を登録する',
    submitting: '登録しています…',
    success: '{{name}}さんを社員名簿に追加しました。',
    error: {
      name: '名前を入力してください。',
      failed: '社員を登録できませんでした。もう一度お試しください。',
    },
  },
  makeCaddie: {
    title: '{{name}}さんをキャディにする',
    description: 'この社員にキャディの役割をつけます。出勤と給与は社員のまま引き継がれます。',
    target: 'キャディの情報',
    targetNew: '新しく作る',
    targetExisting: '{{name}}（{{id}}）に紐づける',
    linkNotice: 'すでにあるキャディの情報を、この社員に紐づけます。ラウンドと評価はそのまま残ります。',
    submit: 'キャディにする',
    submitting: '設定しています…',
    success: '{{name}}さんをキャディにしました。',
    error: {
      baseFee: '費用は 0 円以上で入力してください。',
      failed: 'キャディにできませんでした。もう一度お試しください。',
    },
  },
} as const
