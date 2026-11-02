// Copies the MediaPipe vision wasm runtime from node_modules into public/mediapipe/wasm, so the app loads it locally
// (no CDN, nothing sent anywhere). Runs before dev and build. The copy is git-ignored.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dst = join(root, 'public', 'mediapipe', 'wasm')
if (!existsSync(src)) {
  console.error('MediaPipe wasm not found; run npm install first.')
  process.exit(1)
}
mkdirSync(dst, { recursive: true })
let copied = 0
for (const f of readdirSync(src)) {
  const from = join(src, f)
  const to = join(dst, f)
  if (!statSync(from).isFile()) continue
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  cpSync(from, to)
  copied++
}
console.log(`mediapipe wasm: ${copied} file(s) copied to public/mediapipe/wasm`)
