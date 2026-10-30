import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const root = path.resolve(import.meta.dirname, '../..')
const suiteDir = 'C:\\Users\\hamim\\Desktop\\visual-excellence-suite'
const beforeDir = path.join(suiteDir, 'before')
const afterDir = path.join(suiteDir, 'after')
const compDir = path.join(suiteDir, 'comparison')

fs.mkdirSync(compDir, { recursive: true })

const beforeFiles = fs.readdirSync(beforeDir).filter((f) => f.endsWith('.png'))
console.log(`Found ${beforeFiles.length} before screenshots to compare.`)

for (const file of beforeFiles) {
  const beforePath = path.join(beforeDir, file)
  const afterPath = path.join(afterDir, file)

  if (!fs.existsSync(afterPath)) {
    console.log(`Skipping ${file}: after image does not exist.`)
    continue
  }

  const beforeData = fs.readFileSync(beforePath)
  const afterData = fs.readFileSync(afterPath)

  const pngA = PNG.sync.read(beforeData)
  const pngB = PNG.sync.read(afterData)

  const W = pngA.width
  const H = pngA.height
  const gap = 4

  const combined = new PNG({ width: W * 2 + gap, height: H })

  // Fill background with subtle divider line
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < combined.width; x++) {
      const idx = (combined.width * y + x) << 2
      combined.data[idx] = 40     // R
      combined.data[idx + 1] = 40 // G
      combined.data[idx + 2] = 44 // B
      combined.data[idx + 3] = 255 // A
    }
  }

  // Copy Left (Before)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcIdx = (W * y + x) << 2
      const dstIdx = (combined.width * y + x) << 2
      combined.data[dstIdx] = pngA.data[srcIdx]
      combined.data[dstIdx + 1] = pngA.data[srcIdx + 1]
      combined.data[dstIdx + 2] = pngA.data[srcIdx + 2]
      combined.data[dstIdx + 3] = pngA.data[srcIdx + 3]
    }
  }

  // Copy Right (After)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcIdx = (W * y + x) << 2
      const dstIdx = (combined.width * y + (x + W + gap)) << 2
      combined.data[dstIdx] = pngB.data[srcIdx]
      combined.data[dstIdx + 1] = pngB.data[srcIdx + 1]
      combined.data[dstIdx + 2] = pngB.data[srcIdx + 2]
      combined.data[dstIdx + 3] = pngB.data[srcIdx + 3]
    }
  }

  const outPath = path.join(compDir, file.replace('.png', '-comparison.png'))
  const buffer = PNG.sync.write(combined)
  fs.writeFileSync(outPath, buffer)
  console.log(`✓ Generated comparison: ${path.basename(outPath)}`)
}

console.log('All comparisons stitched successfully!')
