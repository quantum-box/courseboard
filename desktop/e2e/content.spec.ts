import { expect, test, type Page } from '@playwright/test'
import { e2eManagedMockServer, MOCK_FIXTURE_DATE } from './routes'

/**
 * 各画面の中身と操作の検証。モックデータ（src/dev/mockFieldApi.ts）の
 * 固定値を前提にしているためローカル専用（playwright.config.ts が
 * 本番ターゲット時にこのファイルを除外する）。
 *
 * 方針:
 * - 手書きフィクスチャの安定した値（山田組・佐藤 彩・本田 康彦・CF-2026-0001 など）だけを検証する
 * - 操作は読み取り専用か、セッション内メモリにしか書かないものに限る
 * - モックが対応していないエンドポイント（打刻・請求書発行・シミュレータ計算など）は叩かない
 */

const D = MOCK_FIXTURE_DATE

test.describe('ホーム', () => {
  test('業務タイルが表示され、予約台帳へ遷移できる', async ({ page }) => {
    await page.goto('/golf')
    await expect(page.getByRole('heading', { name: 'どこから始めますか' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'そのほかの業務' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '今日の進めかた' })).toBeVisible()

    await page.locator('main').getByRole('button', { name: '予約台帳' }).first().click()
    await expect(page).toHaveURL(/golf\/ledger/)
  })
})

test.describe('予約台帳', () => {
  test('基準日の予約が表示される', async ({ page }) => {
    await page.goto(`/golf/ledger?date=${D}`)
    await expect(page.getByRole('region', { name: '東コース' })).toBeVisible()
    // 手書きフィクスチャのコンペ（山田会）と幹事名が台帳に載る
    await expect(page.getByText('山田会 1組').first()).toBeVisible()
    await expect(page.getByText('幹事 山田 太郎').first()).toBeVisible()
    // 事前設定の枠マーク（東 07:32 売り止め）
    await expect(page.getByText('売り止め').first()).toBeVisible()
  })

  test('コースのしぼり込みと日送りが URL に反映される', async ({ page }) => {
    await page.goto(`/golf/ledger?date=${D}`)
    const toolbar = page.locator('[aria-label="しぼり込み"]')
    await toolbar.getByRole('button', { name: '東コース', exact: true }).click()
    await expect(page).toHaveURL(/courses=course_east/)

    await page.getByRole('button', { name: '前の日' }).click()
    await expect(page).toHaveURL(/date=2026-07-17/)
  })
})

test.describe('タイムライン', () => {
  test('空の日は空状態、基準日はスタート表が埋まる', async ({ page }) => {
    // データの無い日（今日）は空状態
    await page.goto('/golf/timeline')
    await expect(page.getByText('この日のスタートはありません')).toBeVisible()

    // 基準日はスタート表とキャディの列が埋まる
    await page.goto(`/golf/timeline?date=${D}`)
    await expect(page.getByRole('heading', { name: 'スタート表' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'キャディの列' })).toBeVisible()
    await expect(page.getByText('この日のスタートはありません')).toBeHidden()
  })
})

test.describe('顧客台帳', () => {
  test('一覧・検索・空検索が動く', async ({ page }) => {
    await page.goto('/golf/customers')
    await expect(page.getByText('辻 俊行')).toBeVisible()
    await expect(page.getByText('増田 公陽')).toBeVisible()
    await expect(page.getByText('本田 康彦')).toBeVisible()

    const search = page.getByLabel('名前・カナ・電話番号・メールアドレス')
    await search.fill('本田')
    await expect(page.getByText('本田 康彦')).toBeVisible()
    await expect(page.getByText('辻 俊行')).toBeHidden()

    await search.fill('ZZZ')
    await expect(page.getByText('「ZZZ」に該当する顧客はいません')).toBeVisible()
  })

  test('一覧から顧客詳細へ遷移できる', async ({ page }) => {
    await page.goto('/golf/customers')
    await page.getByText('本田 康彦').click()
    await expect(page).toHaveURL(/golf\/customers\/cus_honda/)
    await expect(page.getByRole('heading', { name: '本田 康彦' })).toBeVisible()
    await expect(page.getByText('正会員').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '顧客台帳にもどる' })).toBeVisible()
  })

  test('受付用紙の読み取りで登録候補が出る', async ({ page }) => {
    await page.goto('/golf/customers/reception')
    await expect(page.getByRole('button', { name: '受付用紙をえらぶ' }).first()).toBeVisible()

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await page.locator('input[type="file"]').setInputFiles({
      name: 'reception.png',
      mimeType: 'image/png',
      buffer: tinyPng,
    })

    // 読み取り結果は編集用の入力欄に値として入る
    // 項目名は受付票設定から来る。モック設定の標準ラベル「氏名」で探し、
    // 表示文言を固定していた旧ラベル「名前 必須」には依存しない。
    const names = page.getByRole('textbox', { name: '氏名', exact: true })
    await expect(names.first()).toHaveValue('本田 康彦')
    await expect(names.nth(1)).toHaveValue('増田 公陽')
    await expect(page.getByText('読み取れない項目があります', { exact: false })).toBeVisible()

    // 3人目は必須の表明が読み取れていないので、名前があっても登録できない。
    // 読み取れた2人だけが対象になる。
    await expect(page.getByRole('button', { name: 'まとめて登録する（2人）' })).toBeVisible()
    await expect(
      page.getByText('にチェックが必要です', { exact: false }).first(),
    ).toBeVisible()

    // 受付が原本を見て必要なチェックを入れると、その行も対象に入る。
    const rows = page.locator('li.reception-row')
    await rows.nth(2).getByRole('checkbox').first().check()
    await expect(page.getByRole('button', { name: 'まとめて登録する（3人）' })).toBeVisible()
  })
})

test.describe('プレー商品', () => {
  test('一覧の内容とコース未設定の警告、詳細への遷移', async ({ page }) => {
    await page.goto('/golf/products')
    await expect(page.getByText('キャディ付き18ホール')).toBeVisible()
    await expect(page.getByText('コース未設定のプランが 1 件あります', { exact: false })).toBeVisible()

    await page.getByText('キャディ付き18ホール').click()
    await expect(page).toHaveURL(/golf\/products\/svc/)
    await expect(page.getByRole('heading', { name: 'キャディ付き18ホール' })).toBeVisible()
  })
})

test.describe('コース', () => {
  test('一覧から受付枠画面へ遷移できる', async ({ page }) => {
    await page.goto('/golf/courses')
    await expect(page.getByText('東コース')).toBeVisible()
    await expect(page.getByText('西コース')).toBeVisible()
    await expect(page.getByText('羊ケ丘コース')).toBeVisible()

    await page.getByRole('button', { name: '東コース の受付枠を開く' }).click()
    await expect(page).toHaveURL(/golf\/courses\/course_east/)
    // 見出しはコースの略称（東）を使う
    await expect(page.getByRole('heading', { name: '受付枠 · 東' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '受付する時間' })).toBeVisible()
  })
})

test.describe('キャディ名簿', () => {
  test('名簿の検索と詳細表示', async ({ page }) => {
    await page.goto('/golf/caddies')
    await expect(page.getByText('40 / 40人')).toBeVisible()

    await page.getByLabel('キャディをさがす').fill('佐藤')
    await expect(page.getByText('1 / 40人')).toBeVisible()

    await page.getByText('佐藤 彩').first().click()
    await expect(page).toHaveURL(/golf\/caddies\/caddie_aya/)
    await expect(page.getByRole('heading', { name: '佐藤 彩' })).toBeVisible()
    await expect(page.getByText('Aランク').first()).toBeVisible()
  })

  test('配置画面に割当とおすすめが出る', async ({ page }) => {
    await page.goto(`/golf/caddies/dispatch?date=${D}`)
    await expect(page.getByRole('heading', { name: '未配置を解消する' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '自動で配置する' })).toBeVisible()
    const assigned = page.getByText('配置済み 70組', { exact: true })
    await expect(assigned).toBeVisible()
    await assigned.click()
    await expect(page.getByText(/担当を変えるときは、その行の「付け替え」から/)).toBeVisible()
  })

  test('出勤ボードが表示される', async ({ page }) => {
    await page.goto(`/golf/caddies/attendance?date=${D}`)
    await expect(page.getByRole('heading', { name: '出勤のボード' })).toBeVisible()
    await expect(page.getByText('佐藤 彩').first()).toBeVisible()
  })

  test('シフト表と休みのルールが開ける', async ({ page }) => {
    await page.goto('/golf/caddies/shifts?yearMonth=2026-07')
    await expect(page.getByRole('button', { name: 'シフト案を作る' })).toBeVisible()
    await expect(page.getByText('佐藤 彩').first()).toBeVisible()

    await page.getByRole('button', { name: '休みのルール' }).click()
    await expect(page.getByText('連続勤務の上限', { exact: false }).first()).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('給与画面にランク別の支給額が出る', async ({ page }) => {
    await page.goto('/golf/caddies/payroll?yearMonth=2026-07')
    await expect(page.getByRole('heading', { name: '給与への受け渡し' })).toBeVisible()
    await expect(page.getByText('144,000').first()).toBeVisible()
    // 個人単価の上書き（田中 美香）
    await expect(page.getByText('本人ごとの単価').first()).toBeVisible()
  })
})

test.describe('社員名簿', () => {
  test('在籍フィルタで退職者が出し入れされる', async ({ page }) => {
    await page.goto('/staff')
    await expect(page.getByText('小林 大輔')).toBeVisible()
    await expect(page.getByText('高橋 一')).toBeHidden()

    await page.getByLabel('在籍の状態').selectOption({ label: 'すべて' })
    await expect(page.getByText('高橋 一')).toBeVisible()
  })
})

test.describe('売上目標', () => {
  test('月の進みぐあいが集計される', async ({ page }) => {
    await page.goto('/golf/budgets?yearMonth=2026-08')
    await expect(page.getByRole('heading', { name: 'この月の進みぐあい' })).toBeVisible()
    await expect(page.getByText('￥16,740,000').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '登録ずみの目標' })).toBeVisible()
  })
})

test.describe('月次精算', () => {
  test('精算のまとめと予約明細が出る', async ({ page }) => {
    await page.goto('/golf/settlement?yearMonth=2026-08')
    await expect(page.getByRole('heading', { name: '精算のまとめ' })).toBeVisible()
    await expect(page.getByText('￥1,280,000').first()).toBeVisible()
    await expect(page.getByText('山田組').first()).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '未入金のキャンセル', exact: true }),
    ).toBeVisible()
  })
})

test.describe('料金計算', () => {
  test('計算フォームと税設定が表示される', async ({ page }) => {
    // 計算の実行はモック対象外（POST /v1/course/simulator/*）なので表示のみ検証する
    await page.goto('/golf/simulator')
    await expect(page.getByRole('heading', { name: 'このコースの税設定' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '料金・利用税計算' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '売上幅シミュレーション' })).toBeVisible()
  })
})

test.describe('予約ルール', () => {
  test('設定ずみのポリシーが表示される', async ({ page }) => {
    await page.goto('/golf/policy')
    await expect(page.getByText('設定ずみ').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '予約の基本' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '前払い（デポジット）' })).toBeVisible()
    await expect(page.getByRole('button', { name: '予約ルールを保存' })).toBeVisible()
  })
})

test.describe('予約表のとりこみ', () => {
  test('とりこみ手順と保存済み一覧が表示される', async ({ page }) => {
    await page.goto('/golf/reservation-report-import')
    await expect(
      page.getByRole('heading', { level: 1, name: '日別予約表をとりこむ' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '表ファイルを選ぶ', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '取込済みの月次集計' })).toBeVisible()
  })
})

test.describe('キャンセル料', () => {
  test('請求一覧と状態フィルタが動く', async ({ page }) => {
    await page.goto('/cancellation-fees')
    await expect(page.getByText('CF-2026-0001')).toBeVisible()
    await expect(page.getByText('Taro Yamada')).toBeVisible()
    await expect(page.getByText('￥11,000').first()).toBeVisible()

    await page.getByLabel('状態').selectOption({ label: '入金ずみ' })
    await expect(page.getByText('キャンセル料の請求はありません')).toBeVisible()
  })

  test('請求詳細が表示される', async ({ page }) => {
    await page.goto('/cancellation-fees/inv_mock_001')
    await expect(page.getByRole('heading', { name: 'Taro Yamada' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '請求の明細' })).toBeVisible()
    await expect(page.getByText('￥11,000').first()).toBeVisible()
  })

  test('新規請求フォームが表示される', async ({ page }) => {
    // 送信はモック対象外（POST /v1/invoices）なので表示のみ検証する
    await page.goto('/cancellation-fees/new')
    await expect(
      page.getByRole('heading', { level: 1, name: 'キャンセル料の請求' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: '請求先' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '送る方法' })).toBeVisible()
  })
})

test.describe('コースマップ', () => {
  test('テストデータのカートと地図が表示される', async ({ page }) => {
    await page.goto('/course-map')
    await expect(page.getByText('ブラウザ用のテストデータです')).toBeVisible()
    await expect(page.getByText(/テストデータを表示中 · \d+台/)).toBeVisible()
    await expect(page.locator('canvas').first()).toBeVisible()
  })
})

test.describe('設定', () => {
  test('設定ハブから詳細へ行き来できる', async ({ page }) => {
    await page.goto('/settings')

    await page.getByText('システム連携の詳細').first().click()
    await expect(page).toHaveURL(/settings\/advanced/)
    await expect(page.getByRole('heading', { name: 'ゴルフ機能の動作状態' })).toBeVisible()

    await page.getByRole('button', { name: '設定へ戻る' }).click()
    await expect(page).toHaveURL(/settings$/)
  })

  /**
   * マスタはハブの下に積まれたフォームではなく自分のルートを持つ。
   * ハブに一覧が出ないこと自体が直したかったところなので、リンクから
   * たどり着いた先に表があることまで見る。
   */
  test('ハブのリンクからマスタの表へ入れる', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'マスタ' })).toBeVisible()

    await page.getByText('このコースが売っている会員の種類').click()
    await expect(page).toHaveURL(/settings\/membership-plans/)
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByText('販売終了').first()).toBeVisible()

    await page.getByRole('button', { name: '設定へ戻る' }).click()
    await expect(page).toHaveURL(/settings$/)
  })

  test('キャディの別業務は行から編集シートが開く', async ({ page }) => {
    await page.goto('/settings/caddie-duties')

    await page.getByRole('cell', { name: 'コース整備' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('textbox')).toHaveValue('コース整備')
    await page.keyboard.press('Escape')
  })

  test('メンバー一覧とロール編集ダイアログ', async ({ page }) => {
    await page.goto('/settings/members')
    await expect(page.getByRole('heading', { name: 'メンバー一覧' })).toBeVisible()
    await expect(page.getByText('高橋 誠')).toBeVisible()
    await expect(page.getByText('makoto@example.com')).toBeVisible()

    await page.getByRole('button', { name: '高橋 誠 のロールを編集' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

test.describe('予約表のとりこみ（通し）', () => {
  /**
   * 表を選ぶところから保存結果まで。コースに紐づけない施設があっても
   * 止まらずに保存できることが主眼で、ここが通らないと「対応するコースが
   * 無いゴルフ場は取り込めない」に逆戻りする。
   *
   * モックは実ファイルと同じ合計（186 行・6,314 組・キャディ付き 2,476 組）を
   * 返すので、画面に出る数字がそのまま期待値になる。
   */

  // このファイルで唯一、保存まで進むスイート。接続先が差し替えられていると
  // その先がモックである保証が無く、実バックエンドへ本物の取込を書いてしまう。
  test.skip(
    !e2eManagedMockServer(),
    'E2E_BASE_URL / E2E_API_URL で接続先が差し替えられているため、保存を伴う検証は行わない',
  )

  const REPORT = {
    name: 'daily-reservations.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // 中身は読まれない。モックが固定の集計を返す。
    buffer: Buffer.from('PK'),
  }

  /**
   * 対象年に選ぶ年。
   *
   * 選択肢は現在年の -2〜+4 しか描かれないので、年を固定で書くと**その年が窓から
   * 外れた日に初めて落ちる**テストになる。モックは渡された年で同じ集計を返すため、
   * 常に選べる現在年（コース時計）を選ぶ。
   */
  const CURRENT_YEAR = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
  }).format(new Date())

  /**
   * 保存結果の 1 項目の値。
   *
   * grid 全体を対象に数字を探すと、狙った項目が欠けていても別の項目が同じ数字を
   * 持っているだけで通ってしまう。ラベルで項目を特定してから値だけを見る。
   */
  function statValue(page: Page, label: string) {
    return page
      .locator('.reservation-report-result-grid > div')
      .filter({ has: page.locator('span').filter({ hasText: new RegExp(`^${label}$`) }) })
      .locator('strong')
  }

  async function chooseReport(page: Page) {
    await page.goto('/golf/reservation-report-import')
    await page.locator('input[type="file"]').setInputFiles(REPORT)
    await page.getByLabel('対象年', { exact: false }).selectOption(CURRENT_YEAR)
    await page.getByRole('button', { name: '内容を確認する' }).click()
    await expect(page.getByRole('button', { name: '月間表へ進む' })).toBeVisible()
  }

  async function approveColumnsAndSave(page: Page) {
    await page.getByRole('checkbox', { name: 'この列の対応を確認しました' }).check()
    await page.getByRole('button', { name: '月間表へ進む' }).click()
    await page.getByRole('button', { name: 'この内容を保存する' }).click()
    await expect(page.getByText('保存しました').first()).toBeVisible()
  }

  test('選んだファイルが空の状態と見分けられる', async ({ page }) => {
    await page.goto('/golf/reservation-report-import')
    await expect(page.getByText('まだ選んでいません。')).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(REPORT)

    await expect(page.getByText(REPORT.name)).toBeVisible()
    await expect(page.getByText('まだ選んでいません。')).toBeHidden()
    await expect(page.getByRole('button', { name: '別のファイルを選ぶ', exact: true })).toBeVisible()

    // 取り消しは意図的な操作なので、未入力エラーではなく手つかずの状態へ戻る
    await page.getByRole('button', { name: '選択を取り消す', exact: true }).click()
    await expect(page.getByText('まだ選んでいません。')).toBeVisible()
    await expect(page.getByText('表ファイルを選んでください。')).toBeHidden()
  })

  test('施設をコースに紐づけないまま保存できる', async ({ page }) => {
    await chooseReport(page)

    // 施設名はホール数の接尾と一緒に読み取られる
    await expect(page.getByText('真駒内 36H')).toBeVisible()
    await expect(page.getByText('滝の 27H')).toBeVisible()
    await expect(page.getByText('羊ケ丘 18H')).toBeVisible()

    // 名前の合うコースが無い施設は、勝手に作らずコース登録へ送る
    await expect(
      page.getByRole('button', { name: 'この名前でコースを登録' }).first(),
    ).toBeVisible()

    await approveColumnsAndSave(page)

    await expect(page.getByText('未紐づけの施設も保存しました')).toBeVisible()

    await expect(statValue(page, '日別の行数')).toHaveText('186')
    await expect(statValue(page, '組数')).toHaveText(/^6,?314$/)
    await expect(statValue(page, 'キャディ付きの組数')).toHaveText(/^2,?476$/)
  })

  test('同じ表をもう一度入れても行が増えない', async ({ page }) => {
    await chooseReport(page)
    await approveColumnsAndSave(page)

    await chooseReport(page)
    await approveColumnsAndSave(page)

    // 施設・日付・時間帯が揃うので二重には積まれない。倍の 372 行になったら
    // 冪等性が壊れている。
    await expect(statValue(page, '新しく保存した行')).toHaveText('0')
    await expect(statValue(page, '変更がなかった行')).toHaveText('186')
    await expect(statValue(page, '日別の行数')).toHaveText('186')
  })
})
