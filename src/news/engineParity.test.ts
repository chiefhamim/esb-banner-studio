// The news engine is one engine in two apps: when the ESB Studio Phone checkout is beside this one, its copies
// (src/mobile/watch, written by its tools/sync-pc.mjs news) must equal these. Change the engine here, then sync the phone.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ENGINE = [
  'matcher.ts', 'matcher.test.ts', 'feedparse.ts', 'feedparse.test.ts', 'ewSources.ts', 'portalBrands.ts',
  'rangeSearch.ts', 'rangeSearch.test.ts', 'dates.ts', 'dates.test.ts', 'dedupe.ts', 'dedupe.test.ts',
  'pressParse.ts', 'pressParse.test.ts',
]
const HERE = path.resolve(__dirname)
const textSha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex')
const PHONE = [process.env.ESB_PHONE_REPO, 'C:/Users/hamim/esb-studio-phone', path.resolve(HERE, '../../../esb-studio-phone')]
  .filter((p): p is string => !!p)
  .map((p) => path.join(p, 'src', 'mobile', 'watch'))
  .find((p) => fs.existsSync(p))

describe('shared news engine', () => {
  it.runIf(!!PHONE).each(ENGINE)('%s equals the phone copy (run npm run sync:news in the phone after a change)', (f) => {
    expect(textSha(path.join(PHONE!, f))).toBe(textSha(path.join(HERE, f)))
  })
})
