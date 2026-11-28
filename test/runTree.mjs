// B1575: a test's run of a program that may start programs of its own (land.ps1 starts git, gates, boards). On 2026-11-27
// (the big run of 2093e58) a landing ran past its late timer under load; `child.kill()` ended powershell.exe alone, its
// children kept the piped stdout open, and landScript.test.mjs stayed open at its top level for 15 minutes until the big
// suite's stall watchdog ended the run. Here a late run is ended with its whole tree (taskkill /T /F, as the boards are),
// the same in a test's clean-up while it still runs, and the pipes are destroyed once it ended, so nothing a leftover
// holds keeps the test file open.
import { spawn } from 'node:child_process'

import { stopTree } from '../tools/test.mjs'

/** Ends `child` with every process it started (tools/test.mjs stopTree: taskkill /T /F; elsewhere the process alone). */
export function endTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  stopTree(child)
}

/**
 * Runs `command` with `args` and piped output; resolves `{ status, out }` once it ended (stdout and stderr as one text).
 * Past `lateMs` the run is ended with its whole tree. `runs` (a Set) holds it while it runs, so a clean-up can end it
 * with `endRuns(runs)`.
 */
export function runTree(command, args, options, { lateMs, runs = null } = {}) {
  return new Promise(done => {
    const child = spawn(command, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    runs?.add(child)
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    const late = setTimeout(() => endTree(child), lateMs)
    let status = null
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      // A process the run left (a grandchild that inherited the pipe) must not keep this test file open.
      child.stdout.destroy()
      child.stderr.destroy()
      done({ status, out: out.replace(/\r/g, '').trim() })
    }
    child.on('exit', code => {
      status = code
      clearTimeout(late)
      runs?.delete(child)
      // The output is read to its end ('close'); a pipe a leftover still holds is let go after a short grace.
      setTimeout(finish, 2000).unref()
    })
    child.on('close', finish)
  })
}

/** Ends every run still in `runs` with its tree (a test's clean-up). */
export function endRuns(runs) {
  for (const child of runs) endTree(child)
}
