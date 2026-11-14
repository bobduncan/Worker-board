// The made-up gate of test/landScript.test.mjs: prints where it ran (the script runs it in a worktree of the branch's head,
// with the junction to node_modules) and a summary the way the real gates do.
//   node gate.mjs board-pass | board-fail | board-fail-files | no-summary | print-env | mod-pass | mod-fail | board-pass-then-copy <from> <to>
//     | board-pass-then-empty (a gate that empties node_modules through the junction) | board-pass-then-block (a gate that leaves a
//     real folder where the junction was, so rmdir cannot remove it) | board-queued-then-pass (F14: waits in the one-at-a-time queue
//     for 2.5 s, then runs now and passes) | board-hang-after-start <pid file> (F14: runs now, starts a child that writes its pid there,
//     then hangs) | board-hang-after-noisy-start <pid file> (the same, with 64 KB of output right after the runs-now line)
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'

const [mode, from, to] = process.argv.slice(2)
console.log(`gate cwd: ${process.cwd()}`)
console.log(`node_modules marker: ${existsSync('node_modules/marker.txt') ? 'present' : 'missing'}`)
const board = fails => {
  console.log('✔ a made-up test (0.1ms)')
  console.log('✔ a test that prints fail 0 in its name (0.1ms)')
  console.log('ℹ tests 2')
  console.log(`ℹ pass ${2 - fails}`)
  console.log(`ℹ fail ${fails}`)
  console.log('ℹ cancelled 0')
}
if (mode === 'board-pass') board(0)
else if (mode === 'print-env') {
  console.log(`env NO_COLOR=${process.env.NO_COLOR ?? 'unset'} FORCE_COLOR=${process.env.FORCE_COLOR ?? 'unset'}`)
  board(0)
} else if (mode === 'board-fail-files') {
  console.log('✖ a made-up failing test (2ms)')
  console.log('✖ failing tests:')
  console.log('test at test/alpha.test.mjs:12:1')
  console.log('test at test/beta.test.mjs:3:1')
  board(2)
  process.exitCode = 1
}
else if (mode === 'board-pass-then-copy') {
  // A debugger comes during the gate: the list of connections the script reads changes before the gate ends.
  copyFileSync(from, to)
  board(0)
} else if (mode === 'board-pass-then-empty') {
  // The harm of 2026-11-07: the target of the junction is emptied while the gate passes.
  rmSync('node_modules/marker.txt')
  board(0)
} else if (mode === 'board-pass-then-block') {
  // The junction is gone and a real folder with a file stands in its place: `rmdir` of it fails, and a recursive delete would be wrong.
  rmdirSync('node_modules')
  mkdirSync('node_modules')
  writeFileSync('node_modules/held.txt', 'a real folder where the junction was')
  board(0)
} else if (mode === 'board-fail') {
  board(2)
  process.exitCode = 1
} else if (mode === 'board-queued-then-pass') {
  // F14: the one-at-a-time helper's words while the run waits, then the moment it runs; the gate's clock must start at the second.
  console.error('waiting for test in C:/elsewhere (since 10:00)')
  setTimeout(() => {
    console.error(`one-at-a-time: test runs now (waited 2 s) first=${process.env.HEAVY_RUN_FIRST ?? 'unset'}`)
    setTimeout(() => board(0), 300)
  }, 2500)
} else if (mode === 'board-hang-after-start' || mode === 'board-hang-after-noisy-start') {
  // F14: the run holds its slot and hangs; a child of its own too, its pid written to `from` so the test can see it gone. The noisy
  // one writes 64 KB right after the runs-now line (more than a tail): the script must read all that is new, not a tail.
  console.error('one-at-a-time: test runs now (waited 0 s)')
  if (mode === 'board-hang-after-noisy-start') process.stderr.write(`${'a test line that says nothing, repeated\n'.repeat(1700)}`)
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true })
  writeFileSync(from, String(child.pid))
  setTimeout(() => {}, 120000)
}
else if (mode === 'no-summary') console.log('everything looked fine, and no summary was printed')
else if (mode === 'mod-pass') console.log('(pass) a made-up mod test [0.4ms]\n\n 2 pass\n 0 fail\nRan 2 tests across 1 files. [10ms]')
else if (mode === 'mod-fail') {
  console.log('(fail) a made-up mod test [0.4ms]\n\n 0 pass\n 3 fail\nRan 3 tests across 1 files. [10ms]')
  process.exitCode = 1
} else {
  console.error(`a made-up gate mode: ${mode}`)
  process.exitCode = 2
}
