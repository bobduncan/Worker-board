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

// P4 (chat 1, 2026-11-27): a process made through WMI (Win32_Process Create) has WMI as its parent, not the caller's hidden console,
// so windowsHide does not reach it: without a startup of ShowWindow 0 a console program opens a visible window (a test's stand-in
// keeper opened one for up to 60 s on every run, while the person played). This check covers every file, test/ and fixtures too.
// A start: Invoke-CimMethod / Invoke-WmiMethod on the class with the method Create, or the old [wmiclass]'...'.Create(...); words
// that only name it (a comment, a message "Win32_Process.Create answered 2") are no start.
const WMI_CREATE = new RegExp(`\\bWin32_${'Process'}\\b[^\\n]*-(?:MethodName|Name)\\s+Create\\b|\\[wmiclass\\][^\\n]*\\bWin32_${'Process'}\\b[^\\n]*\\)\\.Create\\(`, 'i')
// ShowWindow = [uint16]0, also as a test's pattern of it (\[uint16\]).
const SHOW_WINDOW_0 = /ShowWindow\s*=\s*\\?\[uint16\\?\]\s*0/

/** The lines of `text` that make a process through WMI without passing a hidden startup (ShowWindow 0): `{ line, text }`. */
export function wmiUnhidden(text) {
  const hidden = SHOW_WINDOW_0.test(text)
  return String(text).split('\n').flatMap((line, index) => (WMI_CREATE.test(line) && !(hidden && /ProcessStartupInformation/.test(line)) ? [{ line: index + 1, text: line.trim().slice(0, 120) }] : []))
}

function allFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'data'].includes(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) allFiles(path, out)
    else if (/\.(mjs|cjs|js|ts|tsx|ps1)$/.test(name)) out.push(path)
  }
  return out
}

test('P4: the WMI check flags a Win32_Process Create without a hidden startup, and lets one with ShowWindow 0 pass', () => {
  const kind = `Win32_${'Process'}`
  const bare = `$r = Invoke-CimMethod -ClassName ${kind} -MethodName Create -Arguments @{ CommandLine = $line }`
  const hidden = [`$startup = New-CimInstance -CimClass $class -ClientOnly -Property @{ ShowWindow = [uint16]0 }`, `$r = Invoke-CimMethod -ClassName ${kind} -MethodName Create -Arguments @{ CommandLine = $line; ProcessStartupInformation = $startup }`].join('\n')
  assert.deepEqual(wmiUnhidden(bare).map(one => one.line), [1])
  assert.deepEqual(wmiUnhidden(hidden), [])
  assert.deepEqual(wmiUnhidden(`([wmiclass]'${kind}').Create($line)`).map(one => one.line), [1], 'the old way too')
  assert.deepEqual(wmiUnhidden(`Get-CimInstance ${kind} | Where-Object { $_.CreationDate -ge $since }`), [], 'a listing is no start')
  assert.deepEqual(wmiUnhidden(`$r = Invoke-CimMethod -ClassName ${kind} -MethodName Create -Arguments @{ CommandLine = $line; ProcessStartupInformation = $startup }`).map(one => one.line), [1], 'a startup that is not ShowWindow 0 is no hidden one')
})

test('P4: every process made through WMI, in any file (test/ and fixtures too), starts hidden (ShowWindow 0)', () => {
  const missing = allFiles(ROOT).flatMap(path => wmiUnhidden(readFileSync(path, 'utf8')).map(found => `${relative(ROOT, path)}:${found.line}  ${found.text}`))
  assert.deepEqual(missing, [], `pass ProcessStartupInformation with ShowWindow = [uint16]0 (as src/keeperStart.mjs) in:\n${missing.join('\n')}`)
})
