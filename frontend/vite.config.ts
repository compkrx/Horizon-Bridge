import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'HB_DEV_')
  const proxy = { '/api': env.HB_DEV_API_ORIGIN || 'http://127.0.0.1:8788' }
  return {
    base: mode === 'pages' ? './' : '/',
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', proxy },
    preview: { host: '127.0.0.1', proxy },
  }
})
