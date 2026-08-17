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
    recent: 'あたらしく のせた 順に {{count}}人まで 出して います。ここに いない 人は、名前・カナ・電話ばんごう・メールアドレスで さがして ください。',
    emptyLedgerTitle: 'まだ お客さまが いません',
    emptyLedger: '「お客さまを あたらしく のせる」から 入れられます。',
    noMatchesTitle: '「{{term}}」に あう 人は いません',
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
  reception: {
    open: '受付の 紙から のせる',
    title: '受付の 紙から お客さまを のせる',
    description: '受付の 紙を うつした 画像や PDFを 読んで、書いて ある 人を 台帳に のせます。',
    back: 'お客さま台帳に もどる',
    reading: '受付の 紙を 読んで います。すこし 待って ください。',
    choose: {
      open: '受付の 紙を えらぶ',
      again: 'ほかの 紙を 読む',
      hint: 'JPEG・PNG・HEIC/HEIF・PDFが 読めます。1つ 10MBまで。iPhoneで とった 写真は JPEGに かえてから 読みます。紙は のこりません。',
    },
    file: {
      required: '受付の 紙の ファイルを えらんで ください。',
      size: 'ファイルが 大きすぎます。10MBまでの ファイルを えらんで ください。',
      type: 'JPEG・PNG・HEIC/HEIF・PDFの ファイルを えらんで ください。',
      convert: 'iPhoneの 写真（HEIC/HEIF）を かえられませんでした。写真アプリで JPEGに 書き出してから ためして ください。',
    },
    empty: {
      title: '受付の 紙を えらんで ください',
      description: 'うつした 画像や PDFから、書いて ある 人を 読みます。読んだ ことは、のせる 前に なおせます。',
    },
    rows: {
      title: '読めた 人',
      description: '右の 紙と 見くらべて、なおしてから のせて ください。読んだ ことは 下書きです。',
      person: '{{index}}人め',
      add: '行を たす',
      register: 'この 人を のせる',
      registerAll: 'まとめて のせる（{{count}}人）',
      registeredCount: '{{count}}人を のせました',
      savedSoFar: 'この 紙から {{count}}人を のせました。',
      saved: 'のせました',
      duplicate: '同じ 名前が いくつか あります',
      openCustomer: 'お客さまの ページを ひらく',
      readAs: '読んだ もの：{{value}}',
      emptyTitle: '読めた 人が いません',
      emptyDescription: '紙を 見ながら「行を たす」で 入れるか、ほかの 紙を 読んで ください。',
    },
    preview: {
      title: '受付の 紙',
      description: '読む もとに した 紙です。',
      alt: '受付の 紙を うつした 画像',
    },
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
