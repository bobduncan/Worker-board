// B546 (incident X11: the board woke the partner's helper three times in a day, each just after the app started anew,
// while the partner ran and handed the work out itself): the helper is woken only when the partner cannot take the
// work (it does not run, or has said and done nothing about it for ten minutes), the wake says what to do, and a wake
// the app's restart caused does not count toward the day's repeated repairs. Made-up chats and steps only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { syncRunner } from '../../src/supervisor/loop.mjs'
import { PARTNER_QUIET_MS, REPAIR_RULES, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 15, 0).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(ago(60)), ...more }, sections)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true, session: 's-Lead' }
const PARTNER = { name: 'Partner', state: 'free', isRunning: true, messages: [] }
const HELPER = { name: 'Second', state: 'free', isRunning: false, writtenAt: ago(90) }
const checkLine = (minutes, about = 'B9') => ({ id: `c${about}${minutes}`, command: 'result-check', about, to: 'Partner', at: ago(minutes), state: 'delivered' })
const world = (more = {}) => ({
  items: items(step('B9', 'review')), lanes: [LEAD], partner: PARTNER, helper: HELPER, prefix: '', now: NOW,
  outbox: [checkLine(3)], limits: {}, pause: null, refused: [], ...more,
})
const helperOf = more => findStuck(world(more)).filter(one => one.check === 'helper')

test('B546: a running partner with a fresh check holds it: the helper is not woken', () => {
  assert.deepEqual(helperOf(), [])
  // Got the line long ago, but said or did something about it lately: still the partner's.
  const acted = items(step('B9', 'review', {}, { History: [`- ${stamp(ago(4))} Partner: check pending`] }))
  assert.deepEqual(helperOf({ items: acted, outbox: [checkLine(40)] }), [])
  const said = { ...PARTNER, messages: [{ at: ago(4), from: 'chat', who: 'Partner', text: 'Handed B9 to Second.' }] }
  assert.deepEqual(helperOf({ partner: said, outbox: [checkLine(40)] }), [])
  // A newer line about it holds it, also beside an older one.
  assert.deepEqual(helperOf({ outbox: [checkLine(40), checkLine(2)] }), [])
})

test('B546: a partner silent ten minutes about it gives one wake; another chat\'s words do not count as its own', () => {
  assert.equal(PARTNER_QUIET_MS, 10 * MIN)
  assert.equal(helperOf({ outbox: [checkLine(9)] }).length, 0)
  const woke = helperOf({ outbox: [checkLine(10)] })
  assert.deepEqual(woke.map(one => [one.fix.do, one.fix.chat, one.fix.id]), [['wake', 'Second', 'B9']])
  const other = items(step('B9', 'review', {}, { History: [`- ${stamp(ago(2))} Worker 1: in progress → review`] }))
  assert.equal(helperOf({ items: other, outbox: [checkLine(30)] }).length, 1)
  const aside = { ...PARTNER, messages: [{ at: ago(2), from: 'you', who: 'You', text: 'what about B9?' }, { at: ago(2), from: 'chat', who: 'Partner', text: 'B90 is done.' }] }
  assert.equal(helperOf({ partner: aside, outbox: [checkLine(30)] }).length, 1)
})

test('B546: a partner that does not run gives a wake at once', () => {
  assert.equal(helperOf({ partner: { ...PARTNER, isRunning: false } }).length, 1)
  assert.equal(helperOf({ partner: { ...PARTNER, state: 'off', isRunning: null } }).length, 1)
})

test('B546: the wake names the ids and says the partner hands them out by message, never "ask it which are yours"', () => {
  const [one] = helperOf({ items: items(step('B9', 'review'), step('B8', 'new')), outbox: [checkLine(20), { ...checkLine(20, 'B8'), command: 'refine' }] })
  assert.match(one.fix.text, /\(B8, B9\)/)
  assert.match(one.fix.text, /Partner hands you yours by message: wait for it, do not ask back/)
  assert.doesNotMatch(one.fix.text, /ask it which are yours/)
})

test('B546: a helper quiet since before the app started anew is a restart wake; one that stopped after it is not', () => {
  assert.equal(helperOf({ outbox: [checkLine(20)], appStartedAt: ago(30) })[0].cause, 'restart')
  assert.equal(helperOf({ outbox: [checkLine(20)], appStartedAt: ago(120) })[0].cause, undefined)
  assert.equal(helperOf({ outbox: [checkLine(20)] })[0].cause, undefined, 'the app\'s start not known')
  // The view carries the app's start from the board's state.
  assert.equal(buildView({ state: { appStartedAt: ago(30) }, now: NOW }).appStartedAt, ago(30))
  assert.equal(buildView({ state: {}, now: NOW }).appStartedAt, null)
})

/** Three app restarts in a day, each stopping the helper while a check waits and the partner is quiet about it. */
async function threeWakes({ restart }) {
  let clock = NOW
  let memory = null
  let sync = { noted: [], seen: {} }
  const outbox = []
  let helper = HELPER
  let appStartedAt = null
  const runner = syncRunner({
    state: async () => ({ chats: [LEAD], advisor: { ...PARTNER, isRunning: false }, advisorHelper: helper, appStartedAt, chatPrefix: '', limits: {}, pause: null, today: [] }),
    items: async () => items(step('B9', 'review')),
    outbox: () => outbox, refused: () => [],
    apply: async () => ({ ok: true, result: {} }),
    wake: async one => { outbox.push({ id: `w${outbox.length}`, command: 'work', about: one.id, to: one.chat, at: clock, state: 'waiting', kind: 'sync', syncKey: one.key }); return { id: 'w' } },
    clean: async () => ({ ok: true }),
    noted: { load: async () => sync, save: async value => { sync = value } },
    memory: { load: async () => memory, save: async value => { memory = value } },
    now: () => clock, settings: {},
  }, REPAIR_RULES, WATCH_RULES)
  outbox.push({ ...checkLine(0), at: clock })
  const found = []
  for (let round = 0; round < 3; round += 1) {
    // The helper ran a while (its watch ends), then stops: by the app's restart, or by itself after the app started.
    helper = { ...HELPER, isRunning: true }
    await runner.run()
    clock += 60 * MIN
    helper = restart ? { ...HELPER, writtenAt: clock - 30 * MIN } : { ...HELPER, writtenAt: clock - 5 * MIN }
    appStartedAt = clock - 10 * MIN
    found.push(...(await runner.run()).findings)
  }
  return { found, memory }
}

test('B546: wakes the app\'s restarts caused do not count toward the three repairs a day; others still do', async () => {
  const restarts = await threeWakes({ restart: true })
  assert.equal(restarts.memory.repairs.filter(one => one.rule === 'helper').length, 3, 'each wake is a repair of the day')
  assert.ok(restarts.memory.repairs.every(one => one.cause === 'restart'))
  assert.deepEqual(restarts.found.filter(one => one.rule === 'repair-repeats'), [])
  const own = await threeWakes({ restart: false })
  assert.equal(own.memory.repairs.filter(one => one.rule === 'helper').length, 3)
  assert.deepEqual(own.found.filter(one => one.rule === 'repair-repeats').map(one => one.key), ['repair-repeats helper Second'])
})
