// F55 (chat 1's review 1 and 4): the claim file's ports: the claim is made with a hard link of a file written whole beside it (never
// seen empty, EEXIST when a claim stands), read as it is, and removed with the retrying removal; the file beside goes whatever happened.

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claimFileOf, claimPorts } from '../../src/supervisor/claimFile.mjs'

test('the claim is never written under its own name: the text goes whole to a file beside it, the link gives it the name in one step, and the file beside goes', async () => {
  const calls = []
  const made = new Map()
  const fs = {
    mkdir: async () => {},
    writeFile: async (file, text, options) => { calls.push(['writeFile', file, options?.flag]); if (options?.flag === 'wx' && made.has(file)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); made.set(file, text) },
    link: async (from, to) => { calls.push(['link', from, to]); if (made.has(to)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); made.set(to, made.get(from)) },
    rm: async file => { calls.push(['rm', file]); made.delete(file) },
    readFile: async file => { if (!made.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return made.get(file) },
  }
  const claim = claimFileOf('D:/p/.claude/sync-loop.json')
  assert.equal(claim, 'D:/p/.claude/sync-loop.json.claim')
  const ports = claimPorts(claim, fs)
  await ports.create('{"pid":7}')
  assert.ok(calls.every(([what, file]) => what !== 'writeFile' || file !== claim), 'nothing is ever written under the claim\'s own name')
  const beside = calls.find(([what]) => what === 'writeFile')[1]
  assert.match(beside, /sync-loop\.json\.claim\.\d+\.[0-9a-f]{8}\.tmp$/, 'written beside, as the board\'s cut-off sweep names such files')
  assert.deepEqual(calls.map(([what]) => what), ['writeFile', 'link', 'rm'])
  assert.deepEqual([made.has(beside), await ports.read()], [false, '{"pid":7}'])
  // a claim that stands: EEXIST from the link, and the file beside goes all the same
  await assert.rejects(ports.create('{"pid":8}'), error => error.code === 'EEXIST')
  assert.deepEqual([...made.keys()], [claim], 'only the claim stands; the second\'s file beside is gone')
  assert.equal(await ports.read(), '{"pid":7}')
  // the removal: the retrying one, and nothing there is fine
  await ports.remove()
  assert.deepEqual([...made.keys()], [])
  await ports.remove()
  let busy = 2
  const retrying = claimPorts(claim, { ...fs, rm: async file => { if (busy-- > 0) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); made.delete(file) } })
  await retrying.create('{"pid":9}')
  await retrying.remove()
  assert.deepEqual([busy <= 0, made.has(claim)], [true, false], 'a file Windows held for a moment is removed on a later try')
  // Review a: a folder without hard links: the link fails with ENOTSUP or EISDIR, and the claim is written under its own name with wx instead
  for (const code of ['ENOTSUP', 'EISDIR', 'ENOSYS']) {
    calls.length = 0
    made.clear()
    const noLinks = claimPorts(claim, { ...fs, link: async () => { calls.push(['link']); throw Object.assign(new Error(code), { code }) } })
    await noLinks.create('{"pid":7}')
    assert.deepEqual(calls.map(([what, file, flag]) => [what, file === claim ? 'claim' : 'beside', flag ?? null]), [['writeFile', 'beside', 'wx'], ['link', 'beside', null], ['writeFile', 'claim', 'wx'], ['rm', 'beside', null]], code)
    assert.deepEqual([[...made.keys()], await noLinks.read()], [[claim], '{"pid":7}'], `${code}: the claim is made all the same`)
    await assert.rejects(noLinks.create('{"pid":8}'), error => error.code === 'EEXIST', `${code}: a standing claim still refuses (wx)`)
    assert.equal(await noLinks.read(), '{"pid":7}')
  }
  // ... but EEXIST and a held file (EPERM, EBUSY) from the link are the claim's own answers: no fallback write
  for (const code of ['EEXIST', 'EPERM', 'EBUSY']) {
    calls.length = 0
    made.clear()
    const refusing = claimPorts(claim, { ...fs, link: async () => { throw Object.assign(new Error(code), { code }) } })
    await assert.rejects(refusing.create('{"pid":7}'), error => error.code === code, code)
    assert.ok(calls.every(([what, file]) => what !== 'writeFile' || file !== claim), `${code}: nothing written under the claim's name`)
    assert.deepEqual([...made.keys()], [], `${code}: the file beside is gone`)
  }
})

test('on the real file system: of many creates at once exactly one wins, the claim is never read empty, and no file is left beside it', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'claim-file-'))
  t.after(() => rm(dir, { recursive: true, force: true }).catch(() => {}))
  const claim = claimFileOf(join(dir, 'inner', 'sync-loop.json'))
  const ports = claimPorts(claim)
  const outcomes = await Promise.allSettled(Array.from({ length: 24 }, (_, n) => ports.create(JSON.stringify({ pid: 100 + n, at: n }))))
  const won = outcomes.filter(one => one.status === 'fulfilled')
  assert.equal(won.length, 1, `one winner: ${JSON.stringify(outcomes.filter(one => one.status === 'rejected').map(one => one.reason?.code))}`)
  assert.ok(outcomes.filter(one => one.status === 'rejected').every(one => one.reason?.code === 'EEXIST'))
  const text = await ports.read()
  assert.ok(/^\{"pid":1\d\d,"at":\d+\}$/.test(text), `the claim holds one whole text: ${text}`)
  // a reader beside 300 make-and-remove rounds never sees an empty claim (the link shows the whole text or nothing)
  let empties = 0
  let reads = 0
  let held = 0
  let stop = false
  // Windows answers EPERM for a file whose removal is under way: no text, not empty (loopOwner counts such a claim as the other's this round).
  const reader = (async () => {
    while (!stop) {
      reads += 1
      const seen = await readFile(claim, 'utf8').catch(error => (error?.code === 'ENOENT' ? null : ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) ? (held += 1, null) : Promise.reject(error)))
      if (seen === '') empties += 1
    }
  })()
  await ports.remove()
  for (let round = 0; round < 300; round++) {
    await ports.create(JSON.stringify({ pid: 7, at: round }))
    await ports.remove()
  }
  stop = true
  await reader
  assert.equal(empties, 0, `never read empty (${reads} reads, ${held} while Windows held the file)`)
  assert.ok(reads > 10, 'the reader read beside the rounds')
  const left = (await import('node:fs/promises')).readdir(join(dir, 'inner'))
  assert.deepEqual(await left, [], 'nothing left beside the claim')
  await assert.rejects(stat(claim), error => error.code === 'ENOENT')
})
