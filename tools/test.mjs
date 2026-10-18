// B351: the board's tests on at most half the PC's cores (node --test starts one test file per core otherwise, which
// took the whole PC while a chat tested). `npm test` runs this; arguments after it go to node --test.
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Half the cores, at least one. */
export function halfTheCores(cores) {
  return Math.max(1, Math.floor(cores / 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : ['test/**/*.test.mjs']
  const run = spawnSync(process.execPath, ['--test', `--test-concurrency=${halfTheCores(availableParallelism())}`, ...files], { stdio: 'inherit' })
  process.exit(run.status ?? 1)
}
