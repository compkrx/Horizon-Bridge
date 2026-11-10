import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { NightlyCatalog } from '../src/browser/types'

test('Nightly search includes archived hashes and dates without changing the target or full export', async ({page}) => {
  const catalog = await (await page.request.get('./browser/nightlies.json')).json() as NightlyCatalog
  const old = catalog.targets.at(-1)!
  await page.clock.setFixedTime(new Date(Date.parse(old.date) + 30 * 86_400_000 + 3_600_000))
  await page.goto('./#/versions')
  const panel = page.getByRole('region', {name: 'Conversion target'})
  const picker = panel.getByRole('combobox', {name: 'Horizon Nightly target'})
  const search = panel.getByRole('searchbox', {name: 'Search Nightlies'})
  const archive = panel.getByRole('checkbox', {name: /Show archived Nightlies/})
  const summary = panel.getByRole('status')
  await expect(picker).toHaveValue(catalog.current)
  await expect(picker.locator(`option[value="${old.id}"]`)).toHaveCount(0)

  await search.fill(` ${old.horizonRevision.toUpperCase()} `)
  await expect(summary).toContainText('1 of ')
  await expect(picker).toHaveValue(catalog.current)
  await expect(picker.locator(`optgroup[label="Archived Nightlies"] option[value="${old.id}"]`)).toHaveCount(1)
  await picker.selectOption(old.id)

  await search.fill(old.date)
  await expect(summary).toContainText(`${catalog.targets.filter((item) => item.date === old.date).length} of `)
  await expect(picker).toHaveValue(old.id)
  await search.fill(`Minecraft ${old.minecraft}`)
  await expect(summary).toContainText(`${catalog.targets.filter((item) => item.minecraft === old.minecraft).length} of `)

  await search.fill('999.999')
  await expect(summary).toContainText('No Nightlies match')
  await expect(picker).toHaveValue(old.id)
  const [download] = await Promise.all([
    page.waitForEvent('download'), panel.getByRole('link', {name: 'Download full catalog (JSON)'}).click(),
  ])
  expect(download.suggestedFilename()).toBe('horizon-nightlies.json')
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(catalog)

  await panel.getByRole('button', {name: 'Clear search'}).click()
  await expect(search).toHaveValue('')
  await expect(picker).toHaveValue(old.id)
  await expect(archive).toBeChecked()
  await archive.uncheck()
  await expect(picker).toHaveValue(catalog.current)
  await expect(picker.locator(`option[value="${old.id}"]`)).toHaveCount(0)
})
