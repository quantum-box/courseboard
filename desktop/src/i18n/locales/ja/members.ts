/** Tenant member and role management (`settings/members`). */
export const members = {
  title: 'メンバーと権限',
  description: 'このテナントを操作できるメンバーの一覧、招待、ロールの管理を行います。',
  loading: 'メンバーを読み込み中',
  forbidden: {
    title: 'メンバーを管理する権限がありません',
    body: 'この画面の操作には field:ManageUsers を許可されている必要があります。テナントのオーナーは常に許可されます。管理者ロールの付与を依頼するか、プラットフォーム管理者に相談してください。',
  },
  list: {
    title: 'メンバー一覧',
    description: 'ロールは「編集」から付け替えます。管理者 / スタッフ / 閲覧者 はいずれかひとつ、業務領域のロールはあわせて複数付与できます。',
    empty: {
      title: 'ロールを持つメンバーがいません',
      description: '「メンバーを招待」からメールアドレスとロールを指定して招待できます。',
    },
  },
  table: {
    name: '名前',
    email: 'メール',
    status: '状態',
    role: 'ロール',
    self: '自分',
  },
  status: {
    active: '参加済み',
    pending: '招待中',
  },
  searchPlaceholder: '名前・メール・IDで検索',
  checklist: {
    selectAll: '全てチェック',
    clearAll: '全て外す',
  },
  action: {
    editRole: '編集',
    editRoleAria: '{{name}} のロールを編集',
    remove: '外す',
    removeAria: '{{name}} のアクセス権を外す',
  },
  remove: {
    confirm: '「{{name}}」のロールをすべて外します。よろしいですか？',
    success: '{{name}} のアクセス権を外しました。',
    failed: 'メンバーの削除に失敗しました。',
  },
  roleField: 'ロール',
  roles: {
    owner: 'オーナー',
    ownerSummary: 'テナントのオーナー。AdministratorAccess により常にすべての操作ができます。',
    unassigned: '未割り当て',
    unassignedSummary: 'ロール未割り当て。ロールを割り当てるまで Field の業務データは操作できません。',
    admin: {
      label: '管理者',
      summary: '全機能の操作に加えて、メンバーと設定も管理できます。ほかのロールを付与する必要はありません。',
    },
    staff: {
      label: 'スタッフ',
      summary: '日常の業務データを作成・更新できます。メンバー管理と設定変更はできません。',
    },
    viewer: {
      label: '閲覧者',
      summary: '業務データの閲覧のみできます。作成・更新・削除はできません。',
    },
  },
  edit: {
    title: '{{name}} のロールを編集',
    description: '管理者 / スタッフ / 閲覧者 はいずれかひとつ、業務領域のロールはあわせて複数付与できます。保存すると即時に反映されます。',
    saveFailedTitle: '保存できませんでした',
    saveFailed: 'ロールの更新に失敗しました。',
    success: '{{name}} のロールを更新しました。',
  },
  invite: {
    trigger: 'メンバーを招待',
    title: 'メンバーを招待',
    description: '既存の Tachyon ユーザーには即時にアクセスとロールを付与します。未登録のアドレスには招待メールだけが送られ、ロールは承諾後にこの画面で割り当て直します。',
    email: 'メールアドレス',
    emailPlaceholder: 'staff@example.com',
    hint: 'メンバー管理には field:ManageUsers の許可が必要です（オーナーは常に許可、管理者ロールにも含まれます）。',
    submit: '招待を送信',
    submitting: '招待を送信中…',
    failedTitle: '招待できませんでした',
    failed: '招待に失敗しました。時間をおいて再試行してください。',
    validation: {
      emailRequired: 'メールアドレスを入力してください。',
      emailFormat: 'メールアドレスの形式が正しくありません。',
      roleRequired: 'ロールをひとつ以上選択してください。',
    },
    result: {
      sent: '{{email}} 宛に招待メールを送信しました。承諾後にこの画面でロールを割り当ててください。',
      sentFallback: '指定のアドレス',
      applied: '{{name}} は既存ユーザーのため、アクセス付与とロール割り当てを直ちに行いました。',
      appliedFallback: '既存ユーザー',
    },
  },
  /**
   * カタログの policy 名 → 画面の言葉。マニフェストの識別子と英語説明を
   * そのまま見せない。「何を書けて、何が閲覧のみか」で書く。
   */
  policies: {
    golfManager: {
      label: '支配人',
      description: 'ゴルフ運用のすべて（予約・ティーシート・キャディ・シフト・顧客・会員・精算・キャンセル料）を登録・更新できます。メンバー管理は含みません。',
    },
    golfReception: {
      label: 'フロント・予約',
      description: '予約・ティーシート・顧客・会員の登録・更新と料金シミュレーションができます。キャディとシフトは扱えません。',
    },
    golfCaddieMaster: {
      label: 'キャディマスター',
      description: 'キャディ名簿・配置・出勤可否・シフトを登録・更新できます。顧客・会員は扱えません。',
    },
    golfAccounting: {
      label: 'ゴルフ経理',
      description: '月次精算・給与集計・料金シミュレーション・キャンセル料の請求ができます。予約は閲覧のみ。',
    },
    golfViewer: {
      label: 'ゴルフ閲覧',
      description: 'ティーシート・予約・キャディ・シフトを閲覧し、料金シミュレーションができます。登録・更新はできません。',
    },
    fieldSales: {
      label: '営業',
      description: '商談・顧客・受注・会員・営業タスクを登録・更新できます。商品と売上分析は閲覧のみ。',
    },
    fieldFinance: {
      label: '経理・財務',
      description: '請求・入金・売上台帳・仕入台帳・経費・販売契約を登録・更新し、経費と SaaS の申請を承認できます。顧客と各ダッシュボードは閲覧のみ。',
    },
    fieldProcurement: {
      label: '購買・在庫',
      description: '在庫・発注・仕入先・商品を登録・更新できます。売上分析は閲覧のみ。',
    },
    fieldReservations: {
      label: '予約管理',
      description: '予約・枠・プランを登録・更新できます。顧客と売上分析は閲覧のみ。',
    },
    fieldHr: {
      label: '人事・労務',
      description: 'スタッフ・シフト・勤怠を登録・更新できます。売上分析は閲覧のみ。',
    },
    fieldAccountingManager: {
      label: '経理マネージャー',
      description: '会計帳簿と決算を登録・更新し、入金の確認と消込ができます。それ以外の会計データは閲覧のみ。',
    },
    fieldExpenseApprover: {
      label: '経費承認者',
      description: '経費申請を閲覧して承認・却下できます。申請の登録・編集はできません。',
    },
    fieldPurchaseApprover: {
      label: '発注承認者',
      description: '仕入台帳と仕入仕訳の候補を登録・更新できます。発注と入荷は閲覧のみ。',
    },
    fieldExtensionManager: {
      label: '拡張機能マネージャー',
      description: '拡張機能を導入・有効化・設定できます。予約は閲覧のみ。',
    },
    fieldSaasApprover: {
      label: 'SaaS 承認者',
      description: 'SaaS の変更申請を閲覧して承認・差し戻しできます。申請の登録はできません。',
    },
  },
} as const
