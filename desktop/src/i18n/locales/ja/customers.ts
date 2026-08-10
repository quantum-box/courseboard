/** 顧客台帳。会員もビジターも同じ台帳に載る。 */
export const customers = {
  search: {
    title: '顧客をさがす',
    description: '会員もビジターも、来場した人はここに載ります。',
    label: '名前・カナ・電話番号',
    placeholder: '例）本田、ホンダ、090-1234',
    prompt: '名前かカナ、電話番号を2文字以上入れてください。',
    noMatches: '「{{term}}」に当てはまる人は見つかりませんでした。新しく登録できます。',
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
    description: '台帳に入っている内容と、会員種別です。',
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
