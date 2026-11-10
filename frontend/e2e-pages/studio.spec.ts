import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { NightlyCatalog } from '../src/browser/types'

test('static Pages processes a multi-JAR batch without network uploads', async ({page}) => {
  const outbound: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' || new URL(request.url()).origin !== 'http://127.0.0.1:5175') outbound.push(request.url())
  })
  await page.goto('./#/versions')
  const picker = page.getByRole('combobox', {name: 'Horizon Nightly target'})
  await expect(picker).toBeEnabled()
  const catalog = await (await page.request.get('./browser/nightlies.json')).json() as NightlyCatalog
  await expect(picker).toHaveValue(catalog.current)
  const known = catalog.targets.find((item) => item.horizonRevision.startsWith('fdc87ae'))!
  if (await picker.locator(`option[value="${known.id}"]`).count() === 0) {
    await page.getByRole('checkbox', {name: /Show archived Nightlies/}).check()
  }
  await picker.selectOption(known.id)
  await page.getByRole('link', {name: 'Back to Studio'}).click()
  await page.getByRole('button', {name: 'Java arithmetic', exact: true}).click()
  await expect(page.getByText('logic.jar', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Crafting recipe', exact: true}).click()
  await expect(page.getByText('asset.jar', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: 'Fabric startup hook', exact: true}).click()
  await expect(page.getByText('startup.jar', {exact: true})).toBeVisible()
  const convert = page.getByRole('button', {name: 'Convert 3 JARs'})
  await expect(convert).toBeDisabled()
  await page.getByRole('checkbox', {name: /I own/}).check()
  await convert.click()
  const results = page.getByRole('button', {name: 'View result', exact: true})
  await expect(results).toHaveCount(3)
  await expect(page.getByRole('button', {name: 'src/translated.rs', exact: true})).toBeVisible()
  await results.nth(1).click()
  await page.getByText('Search the resource inventory').click()
  await page.getByRole('textbox', {name: 'Filter resources by path'}).fill('test.json')
  await expect(page.getByText('data/hb_recipe/recipe/test.json', {exact: true})).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: 'Download Horizon asset mod'}).click()])
  expect(download.suggestedFilename()).toBe('hb_recipe.hmod')
  expect((await readFile((await download.path())!)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]))
  await results.nth(2).click()
  await expect(page.getByText('Native startup project', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Download Horizon native mod'})).toHaveCount(0)
  expect(outbound).toEqual([])
})

test('older targets move to the archive and conversion uses the chosen revision', async ({page}) => {
  const catalog = await (await page.request.get('./browser/nightlies.json')).json() as NightlyCatalog
  const old = catalog.targets.at(-1)!
  await page.clock.setFixedTime(new Date(Date.parse(old.date) + 30 * 86_400_000 + 3_600_000))
  await page.goto('./#/versions')
  const picker = page.getByRole('combobox', {name: 'Horizon Nightly target'})
  await expect(picker).toBeEnabled()
  await expect(picker.locator(`option[value="${old.id}"]`)).toHaveCount(0)
  await page.getByRole('checkbox', {name: /Show archived Nightlies/}).check()
  await picker.selectOption(old.id)
  await page.getByRole('link', {name: 'Back to Studio'}).click()
  await page.getByRole('button', {name: 'Java arithmetic', exact: true}).click()
  await expect(page.getByText('logic.jar', {exact: true})).toBeVisible()
  await page.getByRole('checkbox', {name: /I own/}).check()
  await page.getByRole('button', {name: 'Convert 1 JAR'}).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', {name: 'Download Conversion report'}).click(),
  ])
  const report = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(report.target.horizonRevision).toBe(old.horizonRevision)
  expect(report.target.date).toBe(old.date)
})

test('malformed input is rejected on a mobile viewport', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('./')
  await page.locator('input[accept=".jar"]').setInputFiles({name: 'broken.jar', mimeType: 'application/java-archive', buffer: Buffer.from('this is not a zip')})
  await page.getByRole('checkbox', {name: /I own/}).check()
  await page.getByRole('button', {name: 'Convert 1 JAR'}).click()
  await expect(page.getByRole('alert')).toContainText(/JAR|archive|ZIP/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('module board highlights capabilities and basic mode exports Rust without recipes', async ({page}) => {
  await page.goto('./')
  const module = page.getByRole('link', {name: /^Basic functions —/})
  await module.hover()
  await expect(page.locator('.module-detail')).toContainText('arithmetic and control flow')
  expect(await page.locator('.module-board').evaluate((node) => (node as HTMLElement).style.getPropertyValue('--relay-ry'))).not.toBe('')
  await module.focus()
  await expect(page.locator('.module-detail')).toContainText('arithmetic and control flow')
  await page.getByLabel('Conversion mode').selectOption('basic')
  await page.getByRole('button', {name: 'Java arithmetic', exact: true}).click()
  await expect(page.getByText('logic.jar', {exact: true})).toBeVisible()
  await page.getByRole('checkbox', {name: /I own/}).check()
  await page.getByRole('button', {name: 'Convert 1 JAR'}).click()
  await expect(page.getByRole('button', {name: 'src/translated.rs', exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Download Horizon asset mod'})).toHaveCount(0)
  await page.getByRole('link', {name: 'Open result in AI'}).click()
  await expect(page.getByRole('heading', {name: 'On-device AI rewrite'})).toBeVisible()
  await expect(page.getByRole('combobox', {name: 'JAR to use for the draft'}).locator('option:checked')).toContainText('logic.jar')
  await page.getByRole('navigation', {name: 'Primary'}).getByRole('link', {name: 'Studio', exact: true}).click()
  await expect(page.getByRole('button', {name: 'src/translated.rs', exact: true})).toBeVisible()
})
