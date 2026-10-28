import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// The dev server's stand-in for the desktop bridge: when the browser cannot fetch a page itself (cross-origin), it asks
// here, and the page is fetched through the same net-guard the Electron app uses — http(s) only, no loopback or private
// addresses (checked again on every redirect), a size cap and a time limit. It used to fetch whatever it was handed.
const require = createRequire(import.meta.url)
type Fetched = { ok: boolean; html?: string; error?: string; code?: string }
const { fetchArticleHtml } = require('./electron/net-guard.cjs') as { fetchArticleHtml: (url: string) => Promise<Fetched> }

function devProxyPlugin(): Plugin {
  return {
    name: 'dev-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        const u = new URL(req.url || '', 'http://localhost').searchParams.get('url')
        if (!u) {
          res.statusCode = 400
          res.end('Missing url parameter')
          return
        }
        const r = await fetchArticleHtml(u).catch((e: unknown): Fetched => ({ ok: false, error: String(e), code: 'network_error' }))
        if (!r.ok || r.html == null) {
          res.statusCode = r.code === 'private_address' || r.code === 'invalid_protocol' ? 403 : 502
          res.end(r.error || 'fetch failed')
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(r.html)
      })
    },
  }
}

// base './' so the built app also loads from file:// inside Electron
export default defineConfig({
  base: './',
  plugins: [react(), devProxyPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})

