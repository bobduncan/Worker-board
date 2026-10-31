// B826 (X109): at 22:06 on 2026-10-30, with Claude's CPU set low, the board's look ran slower than its one-minute timer,
// and three looks ran side by side: each read the outbox before the others wrote, and each said the week's stop word to
// Worker 4. B812 made the stop words alone safe; the look's other words (resumes, reported-background, start and wake
// words, rounds, refine words, stranded questions, the ask for workers) are said one await at a time. Now one look runs
// at a time: a tick while the last look still runs starts none, and a look that runs over 10 min shows as failing in the
// page's head while the next tick runs again, so a hung look never makes the board deaf. Made-up chats, fake clocks.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { failingLine, loopRecord, STALE_MS } from '../src/loops.mjs'
import { memoryStore } from '../src/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIN = 60_000
const SAID = 1793394412408 // 2026-10-30 22:06, the first of X109's three words

const clockAt = start => {
  let t = start
  return { now: () => t, add: ms => { t += ms } }
}

/** A gate the test opens: the slow part of a look (a read that waits for the CPU). */
function gate() {
  let open
  const opened = new Promise(done => { open = done })
  return { opened, open }
}

/**
 * A look as the board's: reads what was sent, waits (the slow part), then says the word to Worker 4 when it was not
 * sent yet, one await at a time, as resumesDue and wakesDue are said.
 */
const lookOf = (store, slow) => async () => {
  // What the look read before its slow part, as the board's state is read once at the look's start.
  const sent = [...store.outbox()]
  await slow.opened
  if (!sent.some(one => one.to === 'Worker 4' && one.command === 'week-stop')) await store.say({ id: `w${store.outbox().length + 1}`, at: SAID, to: 'Worker 4', command: 'week-stop', state: 'waiting' })
}

test('X109: three ticks while one slow look runs say the word once', async () => {
  const clock = clockAt(SAID)
  const loops = loopRecord({ now: clock.now })
  const store = memoryStore()
  const slow = gate()
  const look = () => loops.single('look', lookOf(store, slow))
  // The timer fires three times while the first look still waits for the CPU.
  const ticks = [look(), (clock.add(MIN), look()), (clock.add(MIN), look())]
  slow.open()
  await Promise.all(ticks)
  assert.deepEqual(store.outbox().map(one => [one.to, one.command]), [['Worker 4', 'week-stop']])
  assert.equal(loops.all()[0].runs, 1, 'the two ticks that came while it ran started no look')
  assert.deepEqual(loops.failing(), [])
})

test('the mutant without the skip says the word three times (the test above catches it)', async () => {
  const loops = loopRecord({ now: () => SAID })
  const store = memoryStore()
  const slow = gate()
  const look = () => loops.run('look', lookOf(store, slow))
  const ticks = [look(), look(), look()]
  slow.open()
  await Promise.all(ticks)
  assert.equal(store.outbox().length, 3)
})

test('the tick after a look ends runs a new look', async () => {
  const loops = loopRecord({ now: () => SAID })
  let calls = 0
  const look = () => loops.single('look', async () => { calls += 1 })
  await look()
  await look()
  assert.equal(calls, 2)
})

test('a look that throws frees the next tick, and its error shows as before', async () => {
  const loops = loopRecord({ now: () => SAID })
  let calls = 0
  const look = () => loops.single('look', async () => {
    calls += 1
    if (calls === 1) throw new Error('EBUSY: the store')
  })
  assert.equal(await look(), undefined)
  assert.equal(loops.failing()[0].error, 'EBUSY: the store')
  await look()
  assert.equal(calls, 2)
  assert.deepEqual(loops.failing(), [])
})

test('a look that runs over 10 min shows as failing since it began, and the next tick runs again', async () => {
  const clock = clockAt(SAID)
  const lines = []
  const loops = loopRecord({ now: clock.now, write: line => lines.push(line) })
  const hung = gate()
  let calls = 0
  const look = () => loops.single('look', async () => {
    calls += 1
    if (calls === 1) await hung.opened
  })
  const first = look()
  clock.add(STALE_MS - 1)
  await look()
  assert.equal(calls, 1, 'under 10 min the tick waits for the look that runs')
  assert.deepEqual(loops.failing(), [])
  clock.add(1)
  await look()
  assert.equal(calls, 2, 'at 10 min the next tick runs a look again')
  const [failing] = loops.failing()
  assert.equal(failing.since, SAID, 'failing since the hung look began')
  const timeOf = at => new Date(at).toTimeString().slice(0, 5)
  assert.equal(failingLine(loops.failing(), timeOf), `The board's look failing since ${timeOf(SAID)} (still running after 10 min)`)
  assert.equal(lines.length, 1, 'the log names it once')
  // The new look ended well: the board hears again, and the head still names the hung one while it runs.
  clock.add(MIN)
  await look()
  assert.equal(calls, 3)
  assert.equal(loops.failing()[0].since, SAID)
  hung.open()
  await first
  assert.deepEqual(loops.failing(), [])
})

test('a hung look that ends late does not free the tick of the look that runs after it', async () => {
  const clock = clockAt(SAID)
  const loops = loopRecord({ now: clock.now })
  const hung = gate()
  const slow = gate()
  let calls = 0
  const look = () => loops.single('look', async () => {
    calls += 1
    await (calls === 1 ? hung.opened : slow.opened)
  })
  const first = look()
  clock.add(STALE_MS)
  const second = look()
  hung.open()
  await first
  clock.add(MIN)
  await look()
  assert.equal(calls, 2, 'the second look still runs, so this tick starts none')
  slow.open()
  await second
})

test('the board\'s look goes through the one-at-a-time run', async () => {
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  assert.match(server, /const look = \(\) => isClosing \? Promise\.resolve\(\) : loops\.single\('look',/)
})
