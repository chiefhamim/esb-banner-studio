/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, type Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))

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
  // a second checkout (git worktree) running a dev server at the same time gets its own dependency cache
  // (a worktree marks itself with .esb-port-offset — see tools/port-offset.mjs — and then caches in its own tree)
  cacheDir: process.env.VITE_CACHE_DIR || (existsSync(resolve(__dirname, '.esb-port-offset')) ? '.vite-cache' : 'node_modules/.vite'),
  base: './',
  plugins: [react(), devProxyPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // cloud/tracker has its own suite that runs inside the Workers runtime (cd cloud/tracker && npm test)
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'cloud/**'] },
})

