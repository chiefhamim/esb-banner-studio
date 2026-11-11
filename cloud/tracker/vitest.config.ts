import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // R2 is not in wrangler.jsonc yet (needs a card); tests still cover the file routes for when it is
          r2Buckets: ['FILES'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            // test-only values; production secrets are set with `wrangler secret put`
            TRACK_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
            API_TOKEN: 'test-api-token',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'], testTimeout: 60_000 },
  }
})
