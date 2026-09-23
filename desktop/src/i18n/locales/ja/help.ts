/**
 * Frame of the guide panel only. The per-page help text lives in
 * `src/features/help/` because it needs arrays of sections, which do not map
 * cleanly onto i18next resource keys.
 */
export const help = {
  panel: {
    kicker: '使い方',
    ariaLabel: '{{title}} の使い方',
    close: '使い方を閉じる',
    resize: '幅を変える',
    usage: 'この画面ですること',
    data: '出てくることば',
  },
} as const
