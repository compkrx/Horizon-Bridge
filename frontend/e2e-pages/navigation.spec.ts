import { expect, test } from '@playwright/test'

test('separate mobile pages follow links, old bookmarks, and browser history', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  await page.goto('./#native-package')
  const nav = page.getByRole('navigation', {name: 'Primary'})
  const heading = page.getByRole('heading', {level: 1})
  await expect(heading).toHaveText('Packages')
  await expect(nav.getByRole('link', {name: 'Packages', exact: true})).toHaveAttribute('aria-current', 'page')

  const screens = [
    {link: 'Versions', route: 'versions', title: 'Horizon versions'},
    {link: 'AI', route: 'ai', title: 'AI rewrite'},
    {link: 'Guide', route: 'guide', title: 'Guide'},
    {link: 'Look', route: 'look', title: 'Look'},
    {link: 'Studio', route: 'studio', title: /Bring Java mods/},
  ]
  for (const screen of screens) {
    const link = nav.getByRole('link', {name: screen.link, exact: true})
    await link.click()
    await expect(page).toHaveURL(new RegExp(`#/${screen.route}$`))
    await expect(heading).toHaveText(screen.title)
    await expect(link).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  }
  await page.goBack()
  await expect(heading).toHaveText('Look')
  await page.getByRole('button', {name: 'Ember accent'}).click()
  await nav.getByRole('link', {name: 'Packages', exact: true}).click()
  await expect(page).toHaveURL(/#\/packages$/)
  await page.reload()
  await expect(heading).toHaveText('Packages')
  await expect(page.locator('html')).toHaveAttribute('style', /--relay-accent: #ee875a/)
  await page.goBack()
  await expect(heading).toHaveText('Look')
})
