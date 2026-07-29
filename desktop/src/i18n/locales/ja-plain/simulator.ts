import type { DeepPartial } from '../../types'
import type { simulator as source } from '../ja/simulator'

/** See `ja-plain/common.ts` for what this locale is for. */
export const simulator: DeepPartial<typeof source> = {
  title: 'プレー料金の計算',
  description: 'プレー料金から税を計算します。1か月の売上のめやすも出せます。',
  quote: {
    title: '料金と税の計算',
    description: 'プレー料金を入れると、等級と税、合計金額がわかります。',
    field: {
      greenFee: 'プレー料金',
      numHoles: '回るホールの数',
      cartFee: 'カート代（入れなくてもよい）',
      caddyFee: 'キャディ代（入れなくてもよい）',
    },
    submit: '計算する',
    submitting: '計算しています',
    prompt: '金額を入れて計算してください。',
    metric: {
      taxRate: '税の割合',
      taxAmount: '税の金額',
      total: '合計',
    },
    table: {
      player: 'プレーする人',
      tax: '税',
      exempt: '税がかからない（{{reason}}）',
      taxable: '税がかかる',
    },
    reason: {
      minor: '18さい未満',
      senior: '年上の人',
      disability_cert: '障害者手帳あり',
      unknown: '理由がわからない',
    },
  },
  range: {
    title: '売上のめやす',
    description: '来る人の数を入れると、売上と利益のめやすが出ます。',
    field: {
      dateFrom: 'はじめの日',
      dateTo: 'おわりの日',
      visitorsMin: '来る人（少ないとき）',
      visitorsMax: '来る人（多いとき）',
      avgGreenFee: 'ふつうのプレー料金',
    },
    submit: 'めやすを出す',
    submitting: '計算しています',
    prompt: '日にちと人数を入れてください。',
    metric: {
      revenueMin: '売上（少ないとき）',
      revenueMax: '売上（多いとき）',
      taxTotal: '税（多いとき）',
    },
    table: {
      greenFee: 'プレー料金',
      visitors: '来る人の数',
      revenue: '売上',
      taxTotal: '税',
      profit: 'もうけ',
      margin: 'もうけの割合',
    },
  },
}
