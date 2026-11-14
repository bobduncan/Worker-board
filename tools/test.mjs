// B351: the board's tests on at most half the PC's cores (node --test starts one test file per core otherwise, which
// took the whole PC while a chat tested). `npm test` runs this; arguments after it go to node --test.
//
// 2026-11-11, the person: "too often claude slows down my pc very often ... the test suite", then "lets do A": the tests
// run at low priority, so Windows gives games and programs the CPU first, and one run at a time across all chats
// (tools/one-at-a-time.mjs). This process lowers itself to below normal before it starts node --test, which inherits it
// at its start (a below-normal parent's child is below normal on Windows, a nice value is inherited elsewhere), and so do
// its test files; node --test is lowered once more by its id, in case it was not. The cores are the PC's (os.cpus), not
// what this process may use (availableParallelism): under the board's "CPU for Claude: Low" a chat sees two of them,
// which gave one test file at a time and an hour-long gate; the affinity still holds the run to those two then.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

/** Half the cores, at least one. */
export function halfTheCores(cores) {
  return Math.max(1, Math.floor(cores / 2))
}

export const LOW = os.constants.priority.PRIORITY_BELOW_NORMAL

/**
 * Runs node --test on `files` at below-normal priority, on half of `cores`; resolves to its exit code. `start` and
 * `setPriority` are child_process.spawn and os.setPriority (the tests give stand-ins).
 */
export function runTests({ files, cores = os.cpus().length, start = spawn, setPriority = os.setPriority, node = process.execPath }) {
  const lower = (...args) => {
    try {
      setPriority(...args)
    } catch {
      // not allowed or gone: the run goes on at the priority it has
    }
  }
  lower(LOW)
  const child = start(node, ['--test', `--test-concurrency=${halfTheCores(cores)}`, ...files], { stdio: 'inherit', windowsHide: true })
  if (child.pid) lower(child.pid, LOW)
  return new Promise((resolve) => {
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : ['test/**/*.test.mjs']
  runTests({ files }).then((code) => process.exit(code))
}
