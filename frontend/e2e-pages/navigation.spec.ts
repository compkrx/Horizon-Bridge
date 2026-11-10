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
    {link: 'Studio', route: 'studio', title: 'Studio'},
  ]
  for (const screen of screens) {
    const link = nav.getByRole('link', {name: screen.link, exact: true})
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/${screen.route}/$`))
    await expect(heading).toHaveText(screen.title)
    await expect(link).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  }
  await page.goBack()
  await expect(heading).toHaveText('Look')
  await page.getByRole('button', {name: 'Ember accent'}).click()
  await nav.getByRole('link', {name: 'Packages', exact: true}).click()
  await expect(page).toHaveURL(/\/packages\/$/)
  await page.reload()
  await expect(heading).toHaveText('Packages')
  await expect(page.locator('html')).toHaveAttribute('style', /--relay-accent: #ee875a/)
  await page.goBack()
  await expect(heading).toHaveText('Look')
})

test('direct page URLs reload and guides, device checks, and appearance controls work', async ({page}) => {
  for (const [route, title] of [['studio', 'Studio'], ['versions', 'Horizon versions'], ['packages', 'Packages'], ['ai', 'AI rewrite'], ['guide', 'Guide'], ['look', 'Look']]) {
    const response = await page.goto(`./${route}/`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', {level: 1})).toHaveText(title)
    await expect(page.getByRole('navigation', {name: 'Primary'}).getByRole('link', {name: title === 'Horizon versions' ? 'Versions' : title === 'AI rewrite' ? 'AI' : title, exact: true})).toHaveAttribute('aria-current', 'page')
  }
  await page.getByRole('button', {name: /^Sunset Amber/}).click()
  await expect(page.locator('html')).toHaveAttribute('style', /--relay-accent: #ee875a/)
  await page.getByRole('checkbox', {name: 'Cursor tilt and interface motion'}).uncheck()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
  await page.getByRole('button', {name: 'Reset appearance'}).click()
  await expect(page.locator('html')).toHaveAttribute('style', /--relay-accent: #8267ff/)
  await page.goto('./guide/')
  await page.getByRole('searchbox', {name: 'Search guides'}).fill('Vineflower')
  const topics = page.getByRole('navigation', {name: 'Guide topics'})
  await expect(topics.getByRole('link')).toHaveCount(1)
  await topics.getByRole('link').click()
  await expect(page.getByRole('heading', {name: 'Self-hosted AI and native builds'})).toBeVisible()
  await page.getByRole('navigation', {name: 'Primary'}).getByRole('link', {name: 'AI', exact: true}).click()
  await page.getByRole('button', {name: 'Check this device'}).click()
  await expect(page.getByRole('status').filter({hasText: /WebGPU adapter/})).toContainText(/available|unavailable|could not/)
})
