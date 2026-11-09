// Sets design-token values in place in src/styles/tokens.css (light = first `:root {`, dark = `:root[data-theme="dark"] {`).
// One source of truth: values are rewritten where they are declared, never overridden by a later block.
// Usage: node tools/set-tokens.mjs  (edit the maps below)
import fs from 'node:fs'

const FILE = new URL('../src/styles/tokens.css', import.meta.url)

// "Newsroom" edition (2026-11-09): newsprint paper, warm ink, ESB brand stripe as the only colour, warm depth.
export const LIGHT = {
  '--surface-app': '#ebe7df', '--surface-panel': '#fbfaf6', '--surface-raised': '#fffefb', '--surface-sunken': '#f3f0e9',
  '--surface-hover': '#ece8df', '--border-subtle': '#e7e2d7', '--border-default': '#d8d1c3', '--border-strong': '#bfb6a5',
  '--text-primary': '#1c1916', '--text-secondary': '#57504a', '--text-tertiary': '#6f675e', '--text-disabled': 'rgba(28, 25, 22, 0.42)',
  '--accent': '#1c1916', '--accent-soft': 'rgba(28, 25, 22, 0.06)', '--focus-ring': 'rgba(28, 25, 22, 0.22)',
  '--tip-fg': '#1c1916', '--tip-bg': '#fffefb', '--scrim': 'rgba(28, 22, 16, 0.42)', '--side': '#f3f0e9',
  '--ctl-shadow': '0 0 0 .5px rgba(48, 36, 24, 0.12), 0 1px 1.5px rgba(48, 36, 24, 0.08)',
  '--ctl-shadow-hover': '0 0 0 .5px rgba(48, 36, 24, 0.24), 0 1px 2px rgba(48, 36, 24, 0.12)',
  '--menu-bg': 'rgba(253, 252, 249, 0.86)',
  '--shadow-1': '0 .5px 1px rgba(48, 36, 24, 0.08)',
  '--shadow-2': '0 0 0 .5px rgba(48, 36, 24, 0.1), 0 12px 36px rgba(48, 36, 24, 0.16), 0 2px 8px rgba(48, 36, 24, 0.06)',
  '--shadow-l2': '0 12px 32px rgba(48, 36, 24, 0.14), 0 2px 6px rgba(48, 36, 24, 0.06)',
  '--shadow-l3': '0 18px 44px rgba(48, 36, 24, 0.2), 0 3px 8px rgba(48, 36, 24, 0.08)',
  '--card': '#fffefb', '--card-line': 'rgba(48, 36, 24, 0.08)',
  '--card-shadow': '0 0 0 .5px rgba(48, 36, 24, 0.07), 0 1px 2px rgba(48, 36, 24, 0.05), 0 2px 6px rgba(48, 36, 24, 0.03)',
  '--card-shadow-open': '0 0 0 .5px rgba(48, 36, 24, 0.09), 0 2px 4px rgba(48, 36, 24, 0.05), 0 10px 28px rgba(48, 36, 24, 0.08)',
  '--fill': 'rgba(48, 36, 24, 0.05)', '--fill-hover': 'rgba(48, 36, 24, 0.08)', '--fill-active': 'rgba(48, 36, 24, 0.11)',
  '--field': 'rgba(48, 36, 24, 0.045)', '--field-hover': 'rgba(48, 36, 24, 0.07)', '--raised': '#fffefb',
  '--raised-shadow': '0 0 0 .5px rgba(48, 36, 24, 0.1), 0 1px 2px rgba(48, 36, 24, 0.12), 0 1px 1px rgba(48, 36, 24, 0.04)',
  '--header-bg': 'rgba(248, 246, 241, 0.92)', '--bg-4': '#e2ddd2', '--ink-2': '#3e3832', '--ink-ring': 'rgba(28, 25, 22, 0.14)',
}

export const DARK = {
  '--surface-app': '#100f0e', '--surface-panel': '#191816', '--surface-raised': '#201e1b', '--surface-sunken': '#1d1b19',
  '--surface-hover': '#282522', '--border-subtle': '#2a2724', '--border-default': '#3a3631', '--border-strong': '#524c45',
  '--text-primary': '#f3efe8', '--text-secondary': '#bfb7ab', '--text-tertiary': '#a69e92', '--text-disabled': 'rgba(243, 239, 232, 0.42)',
  '--accent': '#f3efe8', '--on-accent': '#191816', '--accent-soft': 'rgba(243, 239, 232, 0.08)', '--focus-ring': 'rgba(243, 239, 232, 0.28)',
  '--tip-bg': '#2c2926', '--tip-fg': '#f3efe8', '--side': '#1a1917', '--menu-bg': 'rgba(38, 35, 32, 0.82)',
  '--card': '#221f1c', '--card-line': 'rgba(255, 245, 230, 0.07)',
  '--card-shadow': '0 0 0 .5px rgba(255, 245, 230, 0.06), 0 1px 2px rgba(0, 0, 0, 0.45)',
  '--card-shadow-open': '0 0 0 .5px rgba(255, 245, 230, 0.09), 0 4px 18px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4)',
  '--fill': 'rgba(255, 245, 230, 0.06)', '--fill-hover': 'rgba(255, 245, 230, 0.09)', '--fill-active': 'rgba(255, 245, 230, 0.13)',
  '--field': 'rgba(255, 245, 230, 0.055)', '--field-hover': 'rgba(255, 245, 230, 0.08)', '--raised': '#3b3732',
  '--header-bg': 'rgba(26, 24, 22, 0.92)', '--bg-4': '#34302b', '--ink-2': '#d8d1c6', '--ink-ring': 'rgba(243, 239, 232, 0.2)',
}

// Tokens that did not exist yet: added once to the light :root (shared by both themes unless DARK names them).
export const ADD = {
  '--brand-g': '#1e9b4a', '--brand-r': '#e52d2d', '--brand-o': '#ec8e3c',
  '--brand-stripe': 'linear-gradient(90deg, var(--brand-g) 0 33.4%, var(--brand-r) 33.4% 66.7%, var(--brand-o) 66.7% 100%)',
  '--font-display': '"Source Serif 4", "Noto Serif Bengali", Georgia, serif',
  '--desk-accent': 'var(--accent)',
}

function setIn(block, map) {
  for (const [k, v] of Object.entries(map)) {
    const re = new RegExp(`(\\n\\s*${k.replace(/[-]/g, '\\-')}:\\s*)[^;]+;`)
    if (re.test(block)) block = block.replace(re, `$1${v};`)
    else block = block.replace(/\n}\s*$/, `\n  ${k}: ${v};\n}`)
  }
  return block
}

let css = fs.readFileSync(FILE, 'utf8')
const lightStart = css.indexOf(':root {')
const lightEnd = css.indexOf('\n}', lightStart) + 2
const darkStart = css.indexOf(':root[data-theme="dark"] {')
const darkEnd = css.indexOf('\n}', darkStart) + 2
const light = setIn(setIn(css.slice(lightStart, lightEnd), LIGHT), ADD)
const dark = setIn(css.slice(darkStart, darkEnd), DARK)
css = css.slice(0, lightStart) + light + css.slice(lightEnd, darkStart) + dark + css.slice(darkEnd)
fs.writeFileSync(FILE, css)
console.log('tokens updated')
