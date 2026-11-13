// The bridge note's claim (src/bridgeClaim.mjs, 2026-11-13): a rename refused once right after the PC woke left .claude/board.json
// unwritten and "telling the chats where the board is" failing for over an hour. The claim tries until the note stands, with a
// backoff up to a minute, reports each failure and the success, writes nothing while another board delivers, and stops when the
// board closes. An injected EPERM-then-ok write; made-up samples.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { CLAIM_BACKOFF_MS, claimUntilWritten } from '../src/bridgeClaim.mjs'

const busy = code => Object.assign(new Error(code), { code })

test('a write refused twice with EPERM goes through on the third try: two failures reported, then the success; the waits grow', async () => {
  let writes = 0
  const failed = []
  const succeeded = []
  const waits = []
  const done = await claimUntilWritten({
    write: async () => { if (writes++ < 2) throw busy('EPERM') },
    onFailed: (error, tries) => failed.push([error.code, tries]),
    onSucceeded: () => succeeded.push(writes),
    wait: async ms => { waits.push(ms) },
  })
  assert.deepEqual(done, { written: true, taken: false, tries: 3 })
  assert.deepEqual(failed, [['EPERM', 1], ['EPERM', 2]])
  assert.deepEqual(succeeded, [3], 'the success is reported once, after the write')
  assert.deepEqual(waits, [2_000, 4_000])
  // The mutant (one try, no retry): the note stays unwritten and nothing ever reports a success.
  assert.deepEqual(CLAIM_BACKOFF_MS, [2_000, 4_000, 8_000, 16_000, 30_000, 60_000])
})

test('the backoff grows to a minute and stays there; the board closing ends the tries, unwritten', async () => {
  const waits = []
  let closing = false
  const done = await claimUntilWritten({
    write: async () => { throw busy('EACCES') },
    wait: async ms => { waits.push(ms); if (waits.length === 8) closing = true },
    isClosing: () => closing,
  })
  assert.deepEqual(done, { written: false, taken: false, tries: 8 })
  assert.deepEqual(waits, [2_000, 4_000, 8_000, 16_000, 30_000, 60_000, 60_000, 60_000])
})

test('another board that delivers already: nothing is written and nothing reported', async () => {
  let writes = 0
  const reported = []
  const done = await claimUntilWritten({ isTaken: async () => true, write: async () => { writes += 1 }, onFailed: () => reported.push('failed'), onSucceeded: () => reported.push('ok') })
  assert.deepEqual([done, writes, reported], [{ written: false, taken: true, tries: 0 }, 0, []])
  // A write that goes through at once: one try, one success.
  const once = await claimUntilWritten({ write: async () => {}, onSucceeded: () => reported.push('ok') })
  assert.deepEqual([once, reported], [{ written: true, taken: false, tries: 1 }, ['ok']])
})

test('the start goes on while the claim keeps failing: neither caller in server.mjs awaits it, and a claim that never writes holds nothing of its caller', async () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.equal((server.match(/void claimBridge\(\)/g) ?? []).length, 2, 'both callers let it run')
  assert.doesNotMatch(server, /await claimBridge\(\)/)
  // The claim itself: a write that never goes through, a wait held by the test: the caller's own work runs on at once.
  let release = () => {}
  let closing = false
  const held = new Promise(done => { release = done })
  const failures = []
  const claim = claimUntilWritten({ write: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }, onFailed: (error, tries) => failures.push(tries), wait: () => held, isClosing: () => closing })
  const went = await Promise.race([claim.then(() => 'claim ended'), Promise.resolve('the start went on')])
  assert.equal(went, 'the start went on')
  await new Promise(done => setTimeout(done, 20))
  assert.deepEqual(failures, [1], 'one failure recorded so far')
  // The board closes: the claim ends, unwritten.
  closing = true
  release()
  assert.deepEqual(await claim, { written: false, taken: false, tries: 1 })
})
