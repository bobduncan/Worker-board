// The made-up gate of test/landScript.test.mjs: prints where it ran (the script runs it in a worktree of the branch's head,
// with the junction to node_modules) and a summary the way the real gates do.
//   node gate.mjs board-pass | board-fail | no-summary | mod-pass | mod-fail | board-pass-then-copy <from> <to>
import { copyFileSync, existsSync } from 'node:fs'

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
else if (mode === 'board-pass-then-copy') {
  // A debugger comes during the gate: the list of connections the script reads changes before the gate ends.
  copyFileSync(from, to)
  board(0)
} else if (mode === 'board-fail') {
  board(2)
  process.exitCode = 1
} else if (mode === 'no-summary') console.log('everything looked fine, and no summary was printed')
else if (mode === 'mod-pass') console.log('(pass) a made-up mod test [0.4ms]\n\n 2 pass\n 0 fail\nRan 2 tests across 1 files. [10ms]')
else if (mode === 'mod-fail') {
  console.log('(fail) a made-up mod test [0.4ms]\n\n 0 pass\n 3 fail\nRan 3 tests across 1 files. [10ms]')
  process.exitCode = 1
} else {
  console.error(`a made-up gate mode: ${mode}`)
  process.exitCode = 2
}
