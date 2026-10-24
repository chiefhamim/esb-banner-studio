// Runs before `npm run app`: a `git pull` that adds a dependency brings the code that imports it but not the package,
// and the build then fails with "Cannot find module" (it did for @anthropic-ai/sdk). If any dependency named in
// package.json is missing from node_modules, install first.
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
const missing = names.filter((n) => !existsSync(new URL(`node_modules/${n}/package.json`, root)))
if (missing.length) {
  console.log(`Installing missing packages (${missing.join(', ')})…`)
  execSync('npm install', { cwd: root, stdio: 'inherit', shell: true })
}
