import type { DeepPartial } from '../../types'
import type { customers as source } from '../ja/customers'

/** See `ja-plain/common.ts` for what this locale is for. */
export const customers: DeepPartial<typeof source> = {
  search: {
    title: 'お客さまを さがす',
    description: '会員の 人も ビジターの 人も、来た 人は ここに のります。',
    label: '名前・カナ・電話ばんごう・メールアドレス',
    placeholder: 'たとえば）本田、ホンダ、090-1234、honda@example.com',
    prompt: '名前・カナ・電話ばんごう・メールアドレスを 入れて ください。名前は 1文字から さがせます。',
    condition: {
      name: '名前・カナ',
      phone: '電話ばんごう',
      email: 'メールアドレス',
    },
    noMatches: '「{{term}}」を {{condition}}として さがしましたが、あう 人は いませんでした。入力を たしかめて、正しければ あたらしく のせられます。',
  },
  create: {
    open: 'お客さまを あたらしく のせる',
    title: 'お客さまを あたらしく のせる',
    description: '名前だけで のせられます。電話で 名前しか きけて いなくても だいじょうぶです。',
    namePlaceholder: 'たとえば）本田 康彦',
    saved: 'お客さまを のせました',
    failed: 'お客さまを のせられませんでした',
  },
  detail: {
    description: '台帳に 入って いる ことです。',
    back: 'お客さま台帳に もどる',
    missing: 'この お客さまは 見つかりませんでした。台帳から きえて いるかも しれません。',
    membershipTitle: '会員の しゅるい',
    membershipDescription: '会員か ビジターかと、その しゅるいです。',
  },
  field: {
    name: '名前',
    nameKana: 'カナ',
    phone: '電話ばんごう',
    email: 'メール',
    membership: '会員の しゅるい',
  },
  noContact: 'れんらくさきの とうろくなし',
}
