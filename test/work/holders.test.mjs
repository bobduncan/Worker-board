// B844 (X114): the report check names the programs that stand in an empty worktree folder it cannot remove. B821's
// folder was held 20 minutes by its chat's own background waits (a Monitor's "sleep 1500; tail ...") that went on past
// the step's end and a restart of the chat. The words, the reader's answer, and a real program standing in a folder on
// Windows. Made-up names.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { COMMAND_CHARS, NAMED_MAX, folderHolders, holderWords, parseHolders } from '../../src/work/holders.mjs'

const WAIT = { pid: 4242, name: 'bash.exe', parent: 'claude.exe', command: '"C:/Program Files/Git/usr/bin/bash.exe" -c "sleep 1500; tail -3 check.log"' }

test('the words: each program by name, process id, what started it and its command, and to stop it', () => {
  assert.equal(holderWords([WAIT]), ' (bash.exe 4242 from claude.exe: "C:/Program Files/Git/usr/bin/bash.exe" -c "sleep 1500; tail -3 check.log"): stop it (a chat\'s background command or monitor: TaskStop)')
  // Two: both named, "them".
  const sleep = { pid: 4243, name: 'sleep.exe', parent: 'bash.exe', command: 'sleep.exe 1500' }
  assert.equal(holderWords([WAIT, sleep]).endsWith('; sleep.exe 4243 from bash.exe: sleep.exe 1500): stop them (a chat\'s background command or monitor: TaskStop)'), true)
})

test('cases: none stands in it, not known, more than three, a long command, no parent or command', () => {
  assert.equal(holderWords([]), ' (no program stands in it as its working folder: one may hold a file of it open)')
  assert.equal(holderWords(null), '')
  const many = Array.from({ length: NAMED_MAX + 2 }, (_, at) => ({ pid: 100 + at, name: 'node.exe', parent: null, command: null }))
  assert.equal(holderWords(many), ' (node.exe 100; node.exe 101; node.exe 102; and 2 more): stop them (a chat\'s background command or monitor: TaskStop)')
  const long = holderWords([{ pid: 7, name: 'node.exe', parent: 'cmd.exe', command: `node ${'x'.repeat(200)}\n--watch` }])
  const command = long.slice(long.indexOf(': ') + 2, long.indexOf('): stop'))
  assert.equal(command.length, COMMAND_CHARS)
  assert.equal(command.endsWith('…'), true)
  assert.doesNotMatch(long, /\n/)
})

test('the reader: its JSON as holders; one process as an object; no list is not known; off Windows nothing is read', async () => {
  assert.deepEqual(parseHolders('[{"pid":5,"name":"bash.exe","parent":"node.exe","command":"bash"}]'), [{ pid: 5, name: 'bash.exe', parent: 'node.exe', command: 'bash' }])
  assert.deepEqual(parseHolders('{"pid":5,"name":"bash.exe","parent":null,"command":null}'), [{ pid: 5, name: 'bash.exe', parent: null, command: null }])
  assert.deepEqual(parseHolders(''), [])
  assert.equal(parseHolders('Add-Type: error'), null)
  let asked = 0
  const run = async () => { asked += 1; return '[]' }
  assert.equal(await folderHolders('/projects/game-b3', { platform: 'linux', run }), null)
  assert.equal(asked, 0)
  assert.deepEqual(await folderHolders('C:/projects/game-b3', { platform: 'win32', run }), [])
  assert.equal(await folderHolders('C:/projects/game-b3', { platform: 'win32', run: async () => null }), null)
})

test('the real case: a background wait standing in a folder is found by name and process id, and nothing once it ends (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'holders-'))
  const folder = join(root, 'game-b3')
  mkdirSync(folder)
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: folder, stdio: 'ignore' })
  try {
    await new Promise(resolve => setTimeout(resolve, 500))
    const found = await folderHolders(folder)
    assert.deepEqual(found.map(one => [one.pid, one.name]), [[child.pid, 'node.exe']])
    assert.match(found[0].command, /setInterval/)
    // The same folder written with "/" and an end "\" is the same folder; a folder beside it is not.
    assert.equal((await folderHolders(`${folder.replace(/\\/g, '/')}\\`)).length, 1)
    assert.deepEqual(await folderHolders(join(root, 'game-b')), [])
    child.kill()
    await new Promise(resolve => child.once('exit', resolve))
    assert.deepEqual(await folderHolders(folder), [])
  } finally {
    child.kill()
    rmSync(root, { recursive: true, force: true })
  }
})
