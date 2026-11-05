// B1049 (2026-11-04 22:26: the measure loop failed every few minutes with EPERM renaming onto data/spending.json; an
// orphaned grep.exe held the file open without share-delete, and the line said only EPERM until the person found the
// holder with Restart Manager by hand): a loop that fails with EPERM, EBUSY or EACCES on a file for 2 min in a row
// names what holds the file, from a read-only Restart Manager lookup, at most once a minute per file.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { fileHolders, holderLine, parseHolders } from '../src/work/holders.mjs'
import { HOLDER_AFTER_MS, HOLDER_EVERY_MS, failingLine, loopRecord, pathsOf } from '../src/loops.mjs'
import { writeAtomic } from '../src/write.mjs'

const at = (h, m, s = 0) => new Date(2026, 10, 4, h, m, s).getTime()
const clockOf = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const busy = file => new Error(`EPERM: operation not permitted, rename '${file}.57736.deadbeef.tmp' -> '${file}'`)

function fakeClock(start) {
  let now = start
  return { now: () => now, move: ms => { now += ms } }
}

const onlyWindows = { skip: process.platform !== 'win32' ? 'Restart Manager is Windows only' : false }

test('the real case: a program holds the file without share-delete, the rename gets EPERM, the loop fails 2 min, its line names the program and its pid', onlyWindows, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'holder-'))
  const file = join(dir, 'spending.json')
  await writeFile(file, '{}')
  // What grep.exe did: the file open for reading, others may read, nobody may delete or replace it.
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$f = [IO.File]::Open($env:HOLD_FILE, 'Open', 'Read', 'Read'); 'held'; Start-Sleep 120"], { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, HOLD_FILE: file }, windowsHide: true })
  try {
    await new Promise((resolve, reject) => {
      child.stdout.setEncoding('utf8').on('data', text => { if (text.includes('held')) resolve() })
      child.on('error', reject)
      child.on('close', () => reject(new Error('the holder ended')))
    })
    const clock = fakeClock(at(22, 26))
    const loops = loopRecord({ now: clock.now, holders: paths => fileHolders(paths) })
    const measure = async () => { await writeAtomic(file, '{"a":1}') }
    await loops.run('measure', measure)
    assert.equal(loops.failing()[0].error.startsWith('EPERM'), true, 'the rename past its five tries gets EPERM')
    clock.move(HOLDER_AFTER_MS)
    await loops.run('measure', measure)
    await loops.lookups()
    const line = failingLine(loops.failing(), clockOf)
    assert.match(line, /^Measuring the tasks failing since 22:26 \(EPERM/)
    assert.match(line, new RegExp(`held by powershell\\.exe, pid ${child.pid}, since \\d\\d:\\d\\d`))
  } finally {
    child.kill()
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test('no lookup before the loop has failed 2 min in a row; one at 2 min; none again within a minute, one after it', async () => {
  const clock = fakeClock(at(22, 26))
  const asked = []
  const loops = loopRecord({ now: clock.now, holders: async paths => { asked.push(paths); return [{ pid: 57736, name: 'grep.exe', since: at(19, 52) }] } })
  const fail = () => loops.run('measure', async () => { throw busy('C:\\p\\data\\spending.json') })
  await fail()
  clock.move(HOLDER_AFTER_MS - 1000)
  await fail()
  await loops.lookups()
  assert.equal(asked.length, 0, 'under 2 min: nothing is looked up')
  assert.doesNotMatch(failingLine(loops.failing(), clockOf), /held by/)
  clock.move(1000)
  await fail()
  await loops.lookups()
  assert.deepEqual(asked, [['C:\\p\\data\\spending.json']], 'at 2 min: one lookup, on the file and not on the temp file beside it')
  assert.match(failingLine(loops.failing(), clockOf), /; held by grep\.exe, pid 57736, since 19:52$/)
  clock.move(HOLDER_EVERY_MS / 2)
  await fail()
  await loops.lookups()
  assert.equal(asked.length, 1, 'half a minute later: no new lookup')
  clock.move(HOLDER_EVERY_MS)
  await fail()
  await loops.lookups()
  assert.equal(asked.length, 2, 'a minute later: the next one')
})

test('another file is looked up on its own clock; a success clears the names', async () => {
  const clock = fakeClock(at(10, 0))
  const asked = []
  const loops = loopRecord({ now: clock.now, holders: async paths => { asked.push(paths[0]); return [{ pid: 4, name: 'x.exe' }] } })
  await loops.run('look', async () => { throw busy('C:\\p\\data\\a.json') })
  clock.move(HOLDER_AFTER_MS)
  await loops.run('look', async () => { throw busy('C:\\p\\data\\a.json') })
  await loops.run('reconcile', async () => { throw busy('C:\\p\\data\\b.json') })
  await loops.lookups()
  assert.deepEqual(asked, ['C:\\p\\data\\a.json'], 'reconcile failed once only: not 2 min yet')
  await loops.run('look', async () => {})
  assert.deepEqual(loops.failing().map(one => one.name), ['reconcile'])
  assert.equal(loops.failing()[0].holders, undefined)
})

test('at most three holders are named, the rest counted; one without a start time says no time; unknown names nothing', () => {
  const list = [1, 2, 3, 4, 5].map(pid => ({ pid, name: `p${pid}.exe`, since: pid === 3 ? undefined : at(19, 52) }))
  assert.equal(holderLine(list, clockOf), 'held by p1.exe, pid 1, since 19:52; p2.exe, pid 2, since 19:52; p3.exe, pid 3; and 2 more')
  assert.equal(holderLine(null, clockOf), '')
  assert.equal(holderLine([], clockOf), '')
  const line = failingLine([{ name: 'measure', words: 'measuring the tasks', since: at(22, 26), error: 'EPERM: x', holders: null }], clockOf)
  assert.equal(line, 'Measuring the tasks failing since 22:26 (EPERM: x)')
})

test('only EPERM, EBUSY and EACCES errors with a file in them are looked up; a lookup that throws or says nothing names nothing', async () => {
  assert.deepEqual(pathsOf("EBUSY: resource busy or locked, unlink 'C:\\p\\a.json'"), ['C:\\p\\a.json'])
  assert.deepEqual(pathsOf("EACCES: permission denied, open 'C:\\p\\a.json.4120.0a1b2c3d.tmp'"), [], 'a temp file is ours')
  assert.deepEqual(pathsOf("ENOENT: no such file, open 'C:\\p\\a.json'"), [])
  assert.deepEqual(pathsOf('something odd'), [])
  const clock = fakeClock(at(1, 0))
  let asked = 0
  const loops = loopRecord({ now: clock.now, holders: async () => { asked += 1; throw new Error('no answer') } })
  const fail = () => loops.run('look', async () => { throw busy('C:\\p\\a.json') })
  await fail()
  clock.move(HOLDER_AFTER_MS)
  await fail()
  await loops.lookups()
  assert.equal(asked, 1)
  assert.equal(loops.failing()[0].holders, undefined)
  const none = loopRecord({ now: clock.now })
  await none.run('look', async () => { throw busy('C:\\p\\a.json') })
  clock.move(HOLDER_AFTER_MS)
  await none.run('look', async () => { throw busy('C:\\p\\a.json') })
  await none.lookups()
  assert.equal(none.failing()[0].holders, undefined, 'a record without a lookup works as before')
})

test('off Windows nothing is named; the answer of the lookup is read from its mark', async () => {
  assert.equal(await fileHolders(['/x/a.json'], { platform: 'linux', run: async () => { throw new Error('never') } }), null)
  assert.equal(await fileHolders([], { platform: 'win32', run: async () => { throw new Error('never') } }), null)
  assert.equal(await fileHolders(['C:\\a'], { platform: 'win32', run: async () => null }), null)
  const answer = await fileHolders(['C:\\a'], { platform: 'win32', run: async () => 'HOLDERS [{"pid":57736,"name":"grep.exe","since":1793814720000}]' })
  assert.deepEqual(answer, [{ pid: 57736, name: 'grep.exe', parent: null, command: null, since: 1793814720000 }])
  assert.equal(parseHolders('nothing marked'), null)
})
