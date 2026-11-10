import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'

const Studio = import.meta.env.MODE === 'pages' ? lazy(() => import('./browser/Studio')) : App
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<p className="site-width">Loading HorizonRelay…</p>}><Studio /></Suspense></StrictMode>)
