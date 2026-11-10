// Every program the board's code starts is started with `windowsHide: true`. A process without a console of its own (a board
// started by start-board.mjs is `detached`) that starts a console program without it opens a NEW, VISIBLE console, and with
// Windows Terminal as the PC's default terminal that is a terminal window popping up on the person's screen. The land script's
// made-up board (fixtures/land/server.mjs) did that with git on every gate (2026-11-09, traced: "terminal popups").
// Scope: all code outside test/ (tests run inside the test runner's own hidden console); see DESIGN.md "No terminal windows".

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.git', 'data', 'test'])
const CALL = /(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g

/** The child_process calls in `text` (a file that imports child_process) whose call has no windowsHide: `{ line, call }`. */
export function unhidden(text) {
  if (!/child_process/.test(text)) return []
  const found = []
  for (const match of text.matchAll(CALL)) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < text.length; end += 1) {
      if (text[end] === '(') depth += 1
      else if (text[end] === ')' && (depth -= 1) === 0) break
    }
    const call = text.slice(match.index, end + 1)
    if (!/windowsHide/.test(call)) found.push({ line: text.slice(0, match.index).split('\n').length, call: call.replace(/\s+/g, ' ').slice(0, 120) })
  }
  return found
}

function codeFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) codeFiles(path, out)
    else if (/\.(mjs|cjs|js|ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

test('the check finds a start without windowsHide, also over several lines, and lets a hidden one and a RegExp exec pass', () => {
  const file = [
    "import { execFileSync, spawn } from 'node:child_process'",
    "const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })",
    "spawn(process.execPath, ['server.mjs'], {",
    '  detached: true,',
    '  windowsHide: true,',
    '})',
    "const words = /a(b)/.exec('ab')",
    "spawn('node', [String(Math.max(1, 2))], { stdio: 'ignore' })",
  ].join('\n')
  assert.deepEqual(unhidden(file).map(found => found.line), [2, 8])
  assert.deepEqual(unhidden("const words = /x/.exec('x')"), [], 'a file without child_process is not looked at')
})

test('every program the board code starts is started hidden (windowsHide: true), so no terminal window pops up', () => {
  const missing = codeFiles(ROOT).flatMap(path => unhidden(readFileSync(path, 'utf8')).map(found => `${relative(ROOT, path)}:${found.line}  ${found.call}`))
  assert.deepEqual(missing, [], `add windowsHide: true to:\n${missing.join('\n')}`)
})
