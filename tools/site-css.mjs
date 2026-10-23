// Regenerates src/editorial/site-preview.css — the esbpowerline.com article-page stylesheet
// used by the Editorial Desk's "Web Article" preview — from a checkout of the website repo.
//
//   SITE_REPO=../esbpowerline node tools/site-css.mjs
//
// It takes the site's own theme tokens and the rules behind the article page, masthead, nav,
// footer and cards from app/globals.css, resolves their @apply with the site's Tailwind
// (3.4.x, run via npx), and emits plain CSS for the preview iframe. Nothing is restyled by hand.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'

const root = path.resolve(import.meta.dirname, '..')
const site = path.resolve(process.env.SITE_REPO ?? path.join(root, '..', 'esbpowerline'))
const globals = path.join(site, 'app', 'globals.css')
if (!fs.existsSync(globals)) { console.error(`site repo not found at ${site} (set SITE_REPO)`); process.exit(1) }
const src = fs.readFileSync(globals, 'utf8')

// Selectors the preview needs. Everything else on the site (homepage, grid explorer, CMS…) is left out.
const WANT = /(\.article-(page-root|header|excerpt|meta|body|reading|context|category|text-size|figure)|\.image-container-with-credit|\.image-credit-overlay|^\s*\.tag\b|\.fluid-article|\.container\b|\.breadcrumbs|\.article-card\b|\.article-card__|\.brand-logo|\.category-pill|\.article-page--with-sticky|\.public-footer-logo|html\.theme-|^\s*:root\s*$|\.public-nav-bar|\.category-nav|\.site-banner|\.icon-(sm|md|xs)\b|\.tap-safe|\.text-ui-|\.container--shell|^\s*body\b|^\s*html\b|\.masthead|\.locale-toggle|\.site-theme-toggle|\.brand-deck|\.btn-secondary|^\s*\.btn\b|\.pb-safe|\.cms-preview-public-surface|\.official-social|\.member-footer|\.account-menu__trigger|\.account-avatar|\.public-nav-bar__account)/

function walk(chunk, baseLine) {
  const res = []
  let i = 0
  while (i < chunk.length) {
    const j = chunk.indexOf('{', i)
    if (j < 0) break
    let depth = 1, k = j + 1
    while (k < chunk.length && depth > 0) { const c = chunk[k]; if (c === '{') depth++; else if (c === '}') depth--; k++ }
    const rawSel = chunk.slice(i, j)
    const sel = rawSel.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const line = baseLine + (chunk.slice(0, i).match(/\n/g) ?? []).length
    if (sel.startsWith('@')) {
      const inner = walk(chunk.slice(j + 1, k - 1), line)
      if (inner.length) res.push(`${sel} {\n${inner.join('\n')}\n}`)
    } else if (WANT.test(sel)) {
      res.push(`${sel} ${chunk.slice(j, k).trim()}`)
    }
    i = k
  }
  return res
}

const extracted = walk(src, 1).join('\n\n')
const component = path.join(root, 'src', 'editorial', 'SitePreview.tsx')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'esb-site-css-'))
const input = path.join(work, 'input.css')
const config = path.join(work, 'tailwind.config.cjs')
fs.writeFileSync(input, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n/* ---- extracted from ${path.relative(root, globals)} ---- */\n${extracted}\n`)
// Mirrors the site's tailwind.config.ts theme.extend (colors, radii, font families) so @apply and utilities resolve identically.
fs.writeFileSync(config, `module.exports = {
  content: [${JSON.stringify(component)}],
  safelist: ['theme-midnight', 'theme-dark', 'theme-white', 'dark', 'light'],
  darkMode: 'class',
  theme: { extend: {
    colors: {
      border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))',
      background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
      primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
      secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
      destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
      muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
      accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
      card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      navy: { 900: '#0a1628', 950: '#050d1a' },
    },
    borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    fontFamily: {
      sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
      display: ['var(--font-display)', 'Space Grotesk', 'system-ui', 'sans-serif'],
      mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
    },
  } },
  plugins: [],
}\n`)
const out = path.join(root, 'src', 'editorial', 'site-preview.css')
const bin = process.env.TAILWIND_BIN ?? 'npx'
const args = bin === 'npx' ? ['-y', '-p', 'tailwindcss@3.4.19', 'tailwindcss'] : []
execFileSync(bin, [...args, '-c', config, '-i', input, '-o', out, '--minify'], { stdio: 'inherit' })
const header = `/* GENERATED by tools/site-css.mjs from esbpowerline/esbpowerline app/globals.css — do not edit by hand. */\n`
fs.writeFileSync(out, header + fs.readFileSync(out, 'utf8'))
console.log(`wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} kB)`)
