import type { DeepPartial } from '../../types'
import type { customers as source } from '../ja/customers'

/** See `ja-plain/common.ts` for what this locale is for. */
export const customers: DeepPartial<typeof source> = {
  search: {
    title: 'お客さまを さがす',
    description: '会員の 人も ビジターの 人も、来た 人は ここに のります。',
    label: '名前・カナ・電話ばんごう',
    placeholder: 'たとえば）本田、ホンダ、090-1234',
    prompt: '名前か カナ、電話ばんごうを 2文字いじょう 入れて ください。',
    noMatches: '「{{term}}」に あう 人は いませんでした。あたらしく のせられます。',
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
