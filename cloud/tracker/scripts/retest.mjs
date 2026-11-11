// Run the whole suite N times in shuffled order (default 5): a flaky test or an order dependency shows up here.
import { spawnSync } from 'node:child_process'
const n = Number(process.argv[2] ?? 5)
for (let i = 1; i <= n; i++) {
  console.log(`\n── run ${i} of ${n} (shuffled) ──`)
  const r = spawnSync('npx', ['vitest', 'run', '--sequence.shuffle', '--sequence.seed', String(Date.now() % 100000)], { stdio: 'inherit', shell: true })
  if (r.status !== 0) { console.error(`FAILED on run ${i}`); process.exit(1) }
}
console.log(`\nAll ${n} shuffled runs passed.`)
