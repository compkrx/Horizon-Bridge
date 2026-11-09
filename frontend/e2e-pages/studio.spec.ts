import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('static Pages processes a multi-JAR batch without network uploads', async ({page}) => {
  const outbound: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' || new URL(request.url()).origin !== 'http://127.0.0.1:5175') outbound.push(request.url())
  })
  await page.goto('./')
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

test('malformed input is rejected on a mobile viewport', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('./')
  await page.locator('input[type=file]').setInputFiles({name: 'broken.jar', mimeType: 'application/java-archive', buffer: Buffer.from('this is not a zip')})
  await page.getByRole('checkbox', {name: /I own/}).check()
  await page.getByRole('button', {name: 'Convert 1 JAR'}).click()
  await expect(page.getByRole('alert')).toContainText(/JAR|archive|ZIP/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
