import { useSyncExternalStore } from 'react'

export const pages = [
  {id: 'studio', label: 'Studio', sections: ['studio', 'conversion-mode', 'browser-results']},
  {id: 'versions', label: 'Versions', sections: []},
  {id: 'packages', label: 'Packages', sections: []},
  {id: 'ai', label: 'AI', sections: ['on-device-ai', 'self-hosted']},
  {id: 'guide', label: 'Guide', sections: ['guide-ai', 'guide-local', 'compatibility']},
  {id: 'look', label: 'Look', sections: []},
] as const

type Page = typeof pages[number]['id']
type Location = {page: Page; section?: string}
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
  return section ? `#/${page}/${section}` : `#/${page}`
}

function subscribe(change: () => void) {
  window.addEventListener('hashchange', change)
  return () => window.removeEventListener('hashchange', change)
}

const currentHash = () => window.location.hash

export function usePage(): Location {
  const hash = useSyncExternalStore(subscribe, currentHash)
  if (legacy[hash]) return legacy[hash]
  const [id, section] = hash.startsWith('#/') ? hash.slice(2).split('/') : []
  const match = pages.find((page) => page.id === id)
  const sections: readonly string[] = match?.sections ?? []
  return {page: match?.id ?? 'studio', section: section && sections.includes(section) ? section : undefined}
}
