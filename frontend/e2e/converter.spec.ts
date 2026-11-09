import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { devices, expect, test, type Page } from '@playwright/test'

const fixtureDir = process.env.HB_E2E_FIXTURES || path.resolve('../.test-fixtures')
const assetFixture = process.env.HB_E2E_ASSET_FIXTURE

async function startJob(page: Page, filePath: string) {
  await page.goto('/')
  await expect(page.getByText('API online')).toBeVisible()
  await page.getByTestId('jar-input').setInputFiles(filePath)
  await expect(page.getByText('Archive signature detected', {exact: false})).toBeVisible()
  const start = page.getByRole('button', {name: 'Start conversion'})
  await expect(start).toBeDisabled()
  await page.getByRole('checkbox', {name: /I own this mod/}).check()
  await start.click()
  await expect(page).toHaveURL(/\/workspace$/)
}

test('authorized Java upload produces a report and reviewable Rust source', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await startJob(page, path.join(fixtureDir, 'logic.jar'))
  await expect(page.getByRole('heading', {name: 'Partial port', exact: true})).toBeVisible({timeout: 55_000})
  await expect(page.getByText('Bridge Fixture', {exact: true})).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Validation and diagnostics'})).toBeVisible()
  await expect(page.getByRole('button', {name: 'Download Horizon native mod'})).toHaveCount(0)
  const explorer = page.getByRole('region', {name: 'Source explorer'})
  await explorer.getByRole('button', {name: 'src/translated.rs', exact: true}).click()
  await expect(explorer.getByLabel('Source of src/translated.rs')).toContainText('fn ')
  await expect(explorer.locator('.code-keyword').first()).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', {name: 'Download Conversion report'}).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('conversion-report.json')
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const report = JSON.parse(await readFile(downloadedPath!, 'utf8'))
  expect(report.metadata.name).toBe('Bridge Fixture')
  expect(report.classification).toBe('partial')
  expect(report.target.minecraft).toBe('26.3')
  expect(report.validation.some((entry: {name: string; status: string}) => entry.name === 'Game behavior' && entry.status === 'skipped')).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('heading', {name: 'Partial port', exact: true})).toBeVisible()
  expect(errors).toEqual([])
})

test('previews recognized loader metadata before uploading', async ({page}) => {
  await page.goto('/')
  await expect(page.getByText('API online')).toBeVisible()
  for (const [fixture, loader] of [['logic.jar', 'Fabric'], ['forge.jar', 'Forge'], ['neoforge.jar', 'NeoForge'], ['quilt.jar', 'Quilt'], ['legacy.jar', 'Legacy']]) {
    await page.getByTestId('jar-input').setInputFiles(path.join(fixtureDir, fixture!))
    await expect(page.getByLabel('Local metadata preview').getByText(loader!, {exact: true})).toBeVisible()
    await page.getByRole('button', {name: 'Remove file'}).click()
  }
  expect(await page.evaluate(() => sessionStorage.getItem('horizonbridge-current-job'))).toBeNull()
})

test('downloads an actual verified asset bundle when the fixture is supplied', async ({page}) => {
  test.skip(!assetFixture, 'Set HB_E2E_ASSET_FIXTURE to an input with supported asset replacements.')
  await startJob(page, assetFixture!)
  await expect(page.getByRole('heading', {name: 'Verified package', exact: true})).toBeVisible({timeout: 55_000})
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', {name: 'Download Horizon asset mod'}).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/\.hmod$/)
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  expect((await readFile(downloadedPath!)).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
})

test.describe('mobile layout and client validation', () => {
  const {viewport, deviceScaleFactor, isMobile, hasTouch, userAgent} = devices['Pixel 7']
  test.use({viewport, deviceScaleFactor, isMobile, hasTouch, userAgent})

  test('rejects a renamed non-JAR and loads all documentation pages', async ({page}) => {
    await page.goto('/')
    await expect(page.getByRole('heading', {name: 'Convert Java Mods to Horizon'})).toBeVisible()
    await page.getByTestId('jar-input').setInputFiles({name: 'broken.jar', mimeType: 'application/java-archive', buffer: Buffer.from('not a jar')})
    await expect(page.getByRole('alert')).toHaveText('This file lacks a JAR/ZIP archive signature.')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    const nav = page.getByRole('navigation', {name: 'Main navigation'})
    await nav.getByRole('link', {name: 'Compatibility'}).click()
    await expect(page.getByRole('heading', {name: 'Compatibility', exact: true})).toBeVisible()
    await nav.getByRole('link', {name: 'Settings'}).click()
    await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toBeVisible()
    await expect(page.getByText('Maximum upload')).toBeVisible()
    await nav.getByRole('link', {name: 'Help'}).click()
    await page.getByText('What can I upload?', {exact: true}).click()
    await expect(page.getByText('Choose a Minecraft Java Edition', {exact: false})).toBeVisible()
  })
})
