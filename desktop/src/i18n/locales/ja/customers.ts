/** 顧客台帳。会員もビジターも同じ台帳に載る。 */
export const customers = {
  search: {
    title: '顧客をさがす',
    description: '会員もビジターも、来場した人はここに載ります。',
    label: '名前・カナ・電話番号・メールアドレス',
    placeholder: '例）本田、ホンダ、090-1234、honda@example.com',
    prompt: '名前・カナ・電話番号・メールアドレスを入力してください。1文字の名前から検索できます。',
    recent: '新しく登録した順に{{count}}人まで表示しています。ここにいない人は、名前・カナ・電話番号・メールアドレスで検索してください。',
    emptyLedgerTitle: 'まだ顧客がいません',
    emptyLedger: '「顧客を新しく登録する」から追加できます。',
    condition: {
      name: '名前・カナ',
      phone: '電話番号',
      email: 'メールアドレス',
    },
    noMatchesTitle: '「{{term}}」に該当する顧客はいません',
    noMatches: '「{{term}}」を{{condition}}として検索しましたが、該当する顧客は見つかりませんでした。入力を確認し、正しければ新しく登録できます。',
  },
  create: {
    open: '顧客を新しく登録する',
    title: '顧客を新しく登録する',
    description: '名前だけで登録できます。電話でお名前しか聞けていない予約もそのまま入れられます。',
    namePlaceholder: '例）本田 康彦',
    saved: '顧客を登録しました',
    failed: '顧客を登録できませんでした',
  },
  detail: {
    description: '台帳に入っている内容です。',
    back: '顧客台帳にもどる',
    missing: 'この顧客は見つかりませんでした。台帳から消えている可能性があります。',
    membershipTitle: '会員種別',
    membershipDescription: '会員かビジターかと、その種別です。',
  },
  field: {
    name: '名前',
    nameKana: 'カナ',
    phone: '電話番号',
    email: 'メール',
    membership: '会員種別',
  },
  noContact: '連絡先の登録なし',
} as const
