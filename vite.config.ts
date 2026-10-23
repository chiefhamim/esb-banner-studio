import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function devProxyPlugin(): Plugin {
  return {
    name: 'dev-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        const u = new URL(req.url || '', 'http://localhost:5173').searchParams.get('url')
        if (!u) {
          res.statusCode = 400
          res.end('Missing url parameter')
          return
        }
        try {
          const resp = await fetch(u, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'bn,en-US;q=0.9,en;q=0.8',
            },
          })
          const body = await resp.text()
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(body)
        } catch (e) {
          res.statusCode = 502
          res.end(String(e))
        }
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

