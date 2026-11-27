// The made-up gate of test/landScript.test.mjs: prints where it ran (the script runs it in a worktree of the branch's head,
// with the junction to node_modules) and a summary the way the real gates do.
//   node gate.mjs board-pass | board-fail | board-fail-files | no-summary | print-env | mod-pass | mod-fail | board-pass-then-copy <from> <to>
//     | board-pass-then-empty (a gate that empties node_modules through the junction) | board-pass-then-block (a gate that leaves a
//     real folder where the junction was, so rmdir cannot remove it) | board-queued-then-pass (F14: waits in the one-at-a-time queue
//     for 2.5 s, then runs now and passes) | board-hang-after-start <pid file> (F14: runs now, starts a child that writes its pid there,
//     then hangs) | board-hang-after-noisy-start <pid file> (the same, with 64 KB of output right after the runs-now line)
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'

// F68: `--priority=<word>` (anywhere) makes it write tools/test.mjs's first line, "test run: priority <word>" (- as a space).
const words = process.argv.slice(2)
const asked = words.find(word => word.startsWith('--priority='))
const [mode, from, to] = words.filter(word => !word.startsWith('--priority='))
console.log(`gate cwd: ${process.cwd()}`)
if (asked !== undefined) console.log(`test run: priority ${asked.slice('--priority='.length).replace(/-/g, ' ')}`)
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
// P4: the light check's last line, with slow new or changed test files (board-pass-slow-new) or with none (board-pass-slow-none).
else if (mode === 'board-pass-slow-new' || mode === 'board-pass-slow-none') {
  board(0)
  console.log('test files by time (seconds), 2 files:\n    7.2  test/alpha.test.mjs\n    0.3  test/beta.test.mjs')
  console.log(`slow new or changed test files (over 5 s): ${mode === 'board-pass-slow-new' ? 'test/alpha.test.mjs (7.2 s)' : 'none'}`)
}
// F39: a gate that takes a while, so a second landing can start beside it.
// F39 (a): what tools/test.mjs writes when its stall watchdog ends a run: no summary, the open files as `test at` lines.
else if (mode === 'board-stalled') {
  console.error('one-at-a-time: test runs now (waited 1 s)')
  console.log('✔ a made-up test (0.1ms)')
  console.log('\nstalled: no test output for 15 minutes; files still open: test/alpha.test.mjs (waits for a page)')
  process.exitCode = 1
}
else if (mode === 'board-slow-pass') setTimeout(() => board(0), Number(process.env.GATE_SLOW_MS ?? 8000))
// F39 (part 6): a gate that leaves a process behind outside its tree, its folder in its command line (a WMI-started board's way).
else if (mode === 'board-pass-leave-sleeper') {
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', process.cwd()], { detached: true, stdio: 'ignore', windowsHide: true })
  sleeper.unref()
  writeFileSync(process.env.GATE_PID_FILE, String(sleeper.pid))
  board(0)
}
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
