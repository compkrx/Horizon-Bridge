import { useSyncExternalStore } from 'react'

export const pages = [
  {id: 'studio', label: 'Studio', description: 'Convert and review mods', sections: ['studio', 'conversion-mode', 'browser-results']},
  {id: 'versions', label: 'Versions', description: 'Choose a Horizon build', sections: []},
  {id: 'packages', label: 'Packages', description: 'Inspect and download', sections: []},
  {id: 'ai', label: 'AI', description: 'Draft Rust on your device', sections: ['on-device-ai', 'self-hosted']},
  {id: 'guide', label: 'Guide', description: 'Learn the porting workflow', sections: ['start', 'guide-packages', 'guide-ai', 'guide-local', 'compatibility', 'troubleshooting', 'privacy']},
  {id: 'look', label: 'Look', description: 'Make the workspace yours', sections: []},
] as const

type Page = typeof pages[number]['id']
type Location = {page: Page; section?: string}
const baseMeta = document.querySelector<HTMLMetaElement>('meta[name="horizonrelay-base"]')
export const appBase = new URL(baseMeta?.content ?? import.meta.env.BASE_URL, window.location.href)
const legacy: Record<string, Location> = {
  '#studio': {page: 'studio', section: 'studio'},
  '#conversion-mode': {page: 'studio', section: 'conversion-mode'},
  '#browser-results': {page: 'studio', section: 'browser-results'},
  '#versions': {page: 'versions'},
  '#native-package': {page: 'packages'},
  '#on-device-ai': {page: 'ai', section: 'on-device-ai'},
  '#guide': {page: 'guide'},
  '#guide-ai': {page: 'guide', section: 'guide-ai'},
  '#guide-local': {page: 'guide', section: 'guide-local'},
  '#compatibility': {page: 'guide', section: 'compatibility'},
  '#appearance': {page: 'look'},
}

export function pageHref(page: Page, section?: string) {
  return `${appBase.pathname}${page}/${section ? `#${section}` : ''}`
}

export function navigate(page: Page, section?: string) {
  window.history.pushState(null, '', pageHref(page, section))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function pathPage(url: URL) {
  if (!url.pathname.startsWith(appBase.pathname)) return undefined
  const path = url.pathname.slice(appBase.pathname.length).replace(/\/$/, '')
  return pages.find((page) => page.id === path)
}

function subscribe(change: () => void) {
  function follow(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest('a') : null
    if (!link || link.download || link.target) return
    const url = new URL(link.href)
    if (url.origin !== window.location.origin || url.search || !pathPage(url)) return
    event.preventDefault()
    if (url.href !== window.location.href) window.history.pushState(null, '', url.href)
    change()
  }
  window.addEventListener('hashchange', change)
  window.addEventListener('popstate', change)
  document.addEventListener('click', follow)
  return () => {
    window.removeEventListener('hashchange', change)
    window.removeEventListener('popstate', change)
    document.removeEventListener('click', follow)
  }
}

const currentLocation = () => window.location.href

export function usePage(): Location {
  const url = new URL(useSyncExternalStore(subscribe, currentLocation))
  const hash = url.hash
  if (legacy[hash]) return legacy[hash]
  const [id, section] = hash.startsWith('#/') ? hash.slice(2).split('/') : []
  const match = pages.find((page) => page.id === id) ?? pathPage(url)
  const sections: readonly string[] = match?.sections ?? []
  const anchor = section ?? hash.slice(1)
  return {page: match?.id ?? 'studio', section: sections.includes(anchor) ? anchor : undefined}
}
