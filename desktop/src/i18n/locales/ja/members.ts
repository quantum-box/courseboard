/** Tenant member and role management (`settings/members`). */
export const members = {
  title: 'メンバーと権限',
  description: 'このテナントを操作できるメンバーの一覧、招待、ロールの管理を行います。',
  loading: 'メンバーを読み込み中',
  forbidden: {
    title: 'メンバーを管理する権限がありません',
    body: 'この画面の操作には field:ManageUsers を許可されている必要があります。テナントのオーナーは常に許可されます。管理者ロール（pol_erp_admin）の付与、またはプラットフォーム管理者への依頼を検討してください。',
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
    role: 'ロール',
    self: '自分',
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
    description: '既存の Tachyon ユーザーには即時にアクセスとロールを付与し、未登録のアドレスには招待メールを送信します。',
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
} as const
