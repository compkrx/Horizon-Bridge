import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import type { NightlyCatalog } from '../src/browser/types'

async function readReport(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', {name: 'Download Conversion report'}).click(),
  ])
  return JSON.parse(await readFile((await download.path())!, 'utf8'))
}

test('requeues a completed JAR for a new target and mode while keeping prior approval', async ({page}) => {
  const catalog = await (await page.request.get('./browser/nightlies.json')).json() as NightlyCatalog
  const first = catalog.targets.find((item) => item.id === catalog.current)!
  const second = catalog.targets.find((item) => item.id !== first.id)!
  await page.clock.setFixedTime(new Date(`${first.date}T12:00:00Z`))
  await page.goto('./')
  const picker = page.getByRole('combobox', {name: 'Horizon Nightly target'})
  const permission = page.getByRole('checkbox', {name: /I own these mods/})
  const queue = page.getByRole('list', {name: 'Conversion queue'})
  const logic = queue.getByRole('listitem').filter({hasText: 'logic.jar'})
  await page.getByRole('button', {name: 'Java arithmetic', exact: true}).click()
  await expect(logic).toBeVisible()
  await permission.check()
  const start = page.getByRole('button', {name: 'Convert 1 JAR', exact: true})
  await start.click()
  await expect(logic).toContainText(first.label)
  await expect(logic).toContainText('All supported conversions')
  expect((await readReport(page)).target.id).toBe(first.id)

  await page.getByRole('button', {name: 'Crafting recipe', exact: true}).click()
  await expect(permission).not.toBeChecked()
  await expect(start).toBeDisabled()
  await queue.getByRole('button', {name: 'Remove asset.jar'}).click()
  await expect(permission).toBeChecked()

  await page.getByRole('link', {name: 'Choose version'}).click()
  await expect(picker).toBeEnabled()
  if (await picker.locator(`option[value="${second.id}"]`).count() === 0) {
    await page.getByRole('checkbox', {name: /Show archived Nightlies/}).check()
  }
  await picker.selectOption(second.id)
  await page.getByRole('link', {name: 'Back to Studio'}).click()
  await page.getByRole('combobox', {name: 'Conversion mode'}).selectOption('inspect')
  await expect(logic).toContainText('Requeue to apply the selected settings.')
  expect((await readReport(page)).target.id).toBe(first.id)
  await logic.getByRole('button', {name: 'Requeue logic.jar'}).click()
  await expect(logic).toContainText('queued')
  await expect(page.locator('#browser-results')).toHaveCount(0)
  await expect(permission).toBeChecked()
  await start.click()
  await expect(logic).toContainText(second.label)
  await expect(logic).toContainText('Inspect only')
  await expect(logic.getByText('Requeue to apply the selected settings.')).toHaveCount(0)
  expect((await readReport(page)).target.id).toBe(second.id)
  await expect(page.getByRole('button', {name: 'src/translated.rs', exact: true})).toHaveCount(0)
})

test('requeues failed and cancelled files on mobile without another upload', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('./')
  await page.getByRole('button', {name: 'Java arithmetic', exact: true}).click()
  const logic = page.getByRole('list', {name: 'Conversion queue'}).getByRole('listitem')
  await expect(logic).toHaveCount(1)
  const permission = page.getByRole('checkbox', {name: /I own these mods/})
  await permission.check()
  const start = page.getByRole('button', {name: 'Convert 1 JAR', exact: true})
  const requeue = logic.getByRole('button', {name: 'Requeue logic.jar'})

  await page.route('**/browser/engine.json', (route) => route.fulfill({status: 503}), {times: 1})
  await start.click()
  await expect(logic.getByRole('alert')).toContainText('Could not load the browser engine.')
  await requeue.click()
  await expect(logic.getByRole('alert')).toHaveCount(0)
  await expect(permission).toBeChecked()

  const gate = Promise.withResolvers<void>()
  await page.route('**/browser/engine.json', async (route) => {
    await gate.promise
    await route.continue().catch(() => undefined)
  }, {times: 1})
  try {
    await start.click()
    await expect(logic).toContainText('Loading engine')
    await page.getByRole('button', {name: 'Cancel batch'}).click()
    await expect(logic).toContainText('cancelled')
  } finally {
    gate.resolve()
  }

  await requeue.click()
  await expect(permission).toBeChecked()
  await start.click()
  await expect(logic.getByRole('button', {name: 'View result'})).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
