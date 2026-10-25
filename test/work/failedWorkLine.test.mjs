// B589 (the fix of X3, after B532, B577 and B571): four work lines to Worker 5 failed at 21:41 because its session was
// stopped as it took them, and nothing ever judged them: withdrawStale (deliver.mjs) judged only waiting work lines, and
// the outbox sweep's whyClosed skipped every work line. So they stayed failed after B522 and B567 were done, and rule 8
// named them again and again. B577's revive did not hand them to the new session either: they failed before the board
// kept a failure's session (`failedSession`). Now one judge (workLines.mjs) closes a work line, waiting or failed for good,
// once its step is no longer that chat's, and the health summary and rule 8 ask the same judge. Made-up samples in the
// shape of the board's outbox.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FOCUS_COMMANDS } from '../../src/say.mjs'
import { memoryStore } from '../../src/store.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { RESTART_COMMAND } from '../../src/work/modRollout.mjs'
import { sweepOutbox, whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 24, 23, 10).getTime()
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const ROOT = new URL('../../', import.meta.url)

const LANES = [
  { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true, queue: [] },
  { name: 'Digger', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] },
]
const STOPPED = 'a hook dropped it: the session was stopped and nobody has sent input since'
const line = (id, when, about, more = {}) => ({ id, at: when, to: 'Digger', ask: null, step: null, title: null, version: null, verdict: null,
  command: 'work', about, text: `work: ${about} is yours; run work next`, state: 'failed', failedAt: when + 2000, tries: 1, why: STOPPED, ...more })
// X3's four: the check of B22 failed (twice), B27 is yours (twice).
const x3 = () => [
  line('k1', at(21, 41), 'B22', { kind: 'check', text: 'work: the board\'s check of B22 failed (a stand-in); see work next' }),
  line('k2', at(21, 41) + 5000, 'B22', { kind: 'check', text: 'work: the board\'s check of B22 failed (a stand-in); see work next' }),
  line('k3', at(21, 41) + 9000, 'B27'),
  line('k4', at(21, 42), 'B27'),
]
const head = fields => ({ head: new Map(Object.entries(fields)), sections: new Map() })
const step = (id, state, owner = 'Digger') => [id, head({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Owner: owner })]

const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const viewOf = (outbox, items, now = NOW) => buildView({ state: { chats: LANES, chatPrefix: '' }, items, outbox, keep, now })
const undelivered = view => WATCH_RULES.find(one => one.id === 'undelivered').check(view, { seen: new Map(), observed: [] })
const wordsPart = text => text.slice(text.indexOf('Words not delivered:'), text.indexOf('Limits and pause:'))

/** A work store folder with these items, as readStore reads one. */
async function storeWith(t, items) {
  const dir = await mkdtemp(join(tmpdir(), 'failed-work-line-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  for (const [id, item] of items) await writeFile(join(dir, `${id}.md`), [...item.head].map(([key, value]) => `${key}: ${value}`).join('\n') + '\n')
  return dir
}
const refresh = (dir, store) => deliverWork({ state: { reconciled: {}, chats: LANES, chatPrefix: '' }, dir, outbox: store, apply: async () => null, now: NOW, maxChars: 2000, newId: () => 'n', keep })

test('X3: the four failed work lines close at the next refresh, each with its why', async t => {
  const items = new Map([step('B22', 'done'), step('B27', 'done')])
  const dir = await storeWith(t, items)
  const store = outboxOf(x3())
  const done = await refresh(dir, store)
  assert.deepEqual(done.withdrawn.map(one => one.id), ['k1', 'k2', 'k3', 'k4'])
  assert.deepEqual(store.outbox().map(one => [one.id, one.state, one.why, one.closedAt]), [
    ['k1', 'dropped', 'B22 left review', NOW], ['k2', 'dropped', 'B22 left review', NOW], ['k3', 'dropped', 'B27 is done', NOW], ['k4', 'dropped', 'B27 is done', NOW],
  ])
})

test('X3: before the refresh closes them, rule 8 is silent and the health summary lists none of the four', () => {
  const items = new Map([step('B22', 'done'), step('B27', 'done')])
  const view = viewOf(x3(), items)
  assert.deepEqual(undelivered(view), [])
  assert.doesNotMatch(wordsPart(healthSummary(view, NOW)), /work B2[27]/)
  assert.deepEqual(x3().map(one => whyClosed(one, { all: x3(), items, now: NOW, keep })?.why), ['B22 left review', 'B22 left review', 'B27 is done', 'B27 is done'])
})

test('a failed work line whose step is still that chat\'s and open stays failed, and rule 8 names it', async t => {
  const items = new Map([step('B30', 'in progress')])
  const dir = await storeWith(t, items)
  const kept = line('k5', NOW - 40 * MIN, 'B30')
  const store = outboxOf([kept])
  const done = await refresh(dir, store)
  assert.deepEqual(done.withdrawn, [])
  assert.equal(store.outbox()[0].state, 'failed')
  const view = viewOf([kept], items)
  assert.deepEqual(undelivered(view).map(one => one.evidence), ['22:30 work B30 (failed)'])
  assert.match(wordsPart(healthSummary(view, NOW)), /^- ! 22:30 work B30 to Digger: failed for 40 min$/m)
  // Another chat's by now, or gone: closed with that why.
  const moved = new Map([step('B30', 'in progress', 'Builder')])
  assert.equal(whyClosed(kept, { all: [kept], items: moved, now: NOW, keep })?.why, 'B30 is Builder\'s now')
  assert.equal(whyClosed(kept, { all: [kept], items: new Map(), now: NOW, keep })?.why, 'B30 is gone')
  // Without a work store the board cannot judge it: it matters.
  assert.equal(whyClosed(kept, { all: [kept], items: null, now: NOW, keep }), null)
})

/** The kinds of work line the board sends (`kind: '<x>'` beside workWords in src), with the line of none and the sync check's. */
async function workLineKinds() {
  const kinds = new Set([undefined, 'sync'])
  for (const file of await sources()) {
    for (const row of (await readFile(file, 'utf8')).split('\n')) {
      if (!row.includes('workWords(')) continue
      for (const found of row.matchAll(/kind: '([a-z-]+)'/g)) kinds.add(found[1])
    }
  }
  return [...kinds]
}
/** Every command a word of the board's carries (`command: '<x>'` in src), with the ones named by a constant. */
async function commands() {
  const found = new Set([...FOCUS_COMMANDS, RESTART_COMMAND])
  for (const file of await sources()) for (const one of (await readFile(file, 'utf8')).matchAll(/command: '([a-z-]+)'/g)) found.add(one[1])
  return [...found]
}
async function sources(dir = new URL('src/', ROOT)) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await sources(new URL(`${entry.name}/`, dir)))
    else if (entry.name.endsWith('.mjs')) files.push(new URL(entry.name, dir))
  }
  return files
}

/** For each kind of work line, the item that makes its purpose gone. */
const GONE = {
  undefined: step('B40', 'done'),
  check: step('B40', 'done'),
  note: ['B40', head({ Id: 'B40', Kind: 'note', State: 'open', 'Main read': '2026-10-24 22:00' })],
  sync: step('B40', 'dropped'),
  'board-queued': step('B40', 'done'),
  'fix-held': step('B40', 'queued'),
  'held-twice': step('B40', 'taken'),
  'partner-ask': ['B40', head({ Id: 'B40', Kind: 'ask', State: 'answered', Route: 'partner' })],
}

test('the guard: every kind of work line, waiting or failed, whose purpose is gone is closed at a refresh; none is without a judge', async t => {
  const kinds = await workLineKinds()
  // Redesign Part 2: the board no longer sends board-queued and fix-held lines; their judges stay for lines sent before.
  assert.ok(kinds.length >= 5, `the scan found the kinds: ${kinds.join(', ')}`)
  for (const kind of kinds) {
    const gone = GONE[String(kind)]
    assert.ok(gone !== undefined, `a work line of kind ${kind} has a judge in workLines.mjs and a case here`)
    const items = new Map([gone])
    const dir = await storeWith(t, items)
    const words = ['waiting', 'failed'].map(state => line(`${kind}-${state}`, NOW - 50 * MIN, 'B40', { state, ...(kind === undefined ? {} : { kind }) }))
    const store = outboxOf(words)
    const done = await refresh(dir, store)
    assert.deepEqual(done.withdrawn.map(one => one.id).sort(), words.map(one => one.id).sort(), `kind ${kind}: both close`)
    assert.ok(store.outbox().every(one => one.state === 'dropped' && typeof one.why === 'string' && one.why !== ''), `kind ${kind}: closed with a why`)
  }
})

test('the guard: every other command, waiting past its keep, is closed by the sweep; failed, it is judged (named by its why, not for ever)', async () => {
  const all = (await commands()).filter(command => command !== 'work')
  assert.ok(all.length >= 30, `the scan found ${all.length} commands`)
  for (const command of all) {
    const waiting = { id: `${command}-w`, at: NOW - 60 * 24 * HOUR, to: 'Digger', ask: null, command, about: 'B40', text: command, state: 'waiting' }
    const failed = { ...waiting, id: `${command}-f`, state: 'failed', failedAt: waiting.at + MIN, tries: 3 }
    const store = outboxOf([waiting])
    const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: LANES }, now: NOW, keep })
    assert.deepEqual(closed.map(one => one.id), [waiting.id], `${command}: a word sixty days old is closed`)
    assert.notEqual(whyClosed(failed, { all: [failed], items: null, runs: new Map(), goals: [], now: NOW, keep, closing: new Map(), stopped: new Map() }), null, `${command}: a failed one is judged`)
  }
})
