// F23 (chat 1, 2026-11-14): words going to a chat whose board link is gone (F9's `modGone`: its Workers mod was unloaded) are held
// quietly for its restart: never expired, never named undelivered, no second word beside them, and taken once the link is back. The
// garden is made up; the chats are the Advisor (rounds, refines), the Supervisor (sweep words) and a worker (resume words).

import assert from 'node:assert/strict'
import test from 'node:test'

import { isHeldForLink, linkGoneNames, wordLanesOf } from '../src/modGone.mjs'
import { resumesDue } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { sweepOutbox } from '../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 14, 0).getTime()
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const GONE = { at: NOW - 30 * MIN }
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, isRunning: true, state: 'free', appSession: `local_${name}`, modGone: null, ...more })
const stateOf = ({ chats = [lane('Lead', { isMain: true })], advisor = null, supervisorChat = null } = {}) => ({ chats, advisor, supervisorChat, chatPrefix: '', restart: { main: 'Lead' }, pause: null, today: [], limits: {} })
const round = { id: 'r1', at: NOW - 40 * MIN, to: 'Advisor', ask: null, command: 'round', round: 'morning', text: 'the morning round', state: 'waiting' }
const refine = { id: 'f1', at: NOW - 40 * MIN, to: 'Advisor', ask: null, command: 'refine', step: 'B12', text: 'refine B12', state: 'waiting' }
const sweep = { id: 's1', at: NOW - 40 * MIN, to: 'Supervisor', ask: null, command: 'sweep', text: 'sweep', state: 'waiting' }

test('the link-gone rule: the chats whose mod was unloaded, among the board\'s chats and the side chats; a waiting word to one is held', () => {
  const state = stateOf({ chats: [lane('Lead', { isMain: true }), lane('Digger', { modGone: GONE })], advisor: lane('Advisor', { modGone: GONE }), supervisorChat: lane('Supervisor') })
  assert.deepEqual([...linkGoneNames(wordLanesOf(state))].sort(), ['Advisor', 'Digger'])
  assert.equal(isHeldForLink(round, linkGoneNames(wordLanesOf(state))), true)
  assert.equal(isHeldForLink({ ...round, state: 'taken' }, linkGoneNames(wordLanesOf(state))), false)
  assert.equal(isHeldForLink(sweep, linkGoneNames(wordLanesOf(state))), false, 'the Supervisor\'s link is there')
  assert.deepEqual([...linkGoneNames(wordLanesOf(stateOf({ chats: [lane('Old', { modGone: GONE, isLeftover: true })] })))], [], 'not a leftover')
})

test('the outbox sweep never expires a word held for a gone link (its purpose still closes it); with the link back it expires as before', async () => {
  const gone = stateOf({ advisor: lane('Advisor', { modGone: GONE }), supervisorChat: lane('Supervisor', { modGone: GONE }) })
  const back = stateOf({ advisor: lane('Advisor'), supervisorChat: lane('Supervisor') })
  const closesOf = async state => {
    const outbox = memoryStore()
    for (const one of [round, sweep]) await outbox.say({ ...one })
    return (await sweepOutbox({ dir: null, outbox, state, now: NOW, keep: KEEP, dry: true })).map(one => [one.id, one.state])
  }
  assert.deepEqual(await closesOf(gone), [])
  // (A round waits long by itself, B532: only the sweep word expires once the link is back.)
  assert.deepEqual(await closesOf(back), [['s1', 'expired']])
})

test('rule 8 never names a word held for a gone link undelivered; the same word to a chat with its link is named', () => {
  const viewOf = advisor => buildView({ state: stateOf({ advisor }), items: new Map(), outbox: [round, refine], settings: {}, now: NOW })
  assert.equal(isUndelivered(viewOf(lane('Advisor', { modGone: GONE })), round), false)
  assert.equal(isUndelivered(viewOf(lane('Advisor', { modGone: GONE })), refine), false)
  assert.equal(isUndelivered(viewOf(lane('Advisor')), round), true)
})

test('resumesDue writes no resume word for a worker whose link is gone; with its link it does', () => {
  const worker = more => lane('Digger', { isRunning: false, state: 'off', storeSteps: [{ id: 'B12', state: 'in progress' }], lastActivityAt: NOW - 60 * MIN, ...more })
  assert.deepEqual(resumesDue(stateOf({ chats: [lane('Lead', { isMain: true }), worker({ modGone: GONE })] }), []), [])
  assert.deepEqual(resumesDue(stateOf({ chats: [lane('Lead', { isMain: true }), worker()] }), []).map(one => [one.to, one.about]), [['Digger', 'B12']])
})

test('the server\'s sent view and the supervisor\'s sweep hold the words for a gone link (no second round, refine or sweep word beside it)', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /isLate\(message, now, keep\) && !isHeldForLink\(message, gone\) \? \{ \.\.\.message, state: 'expired' \}/)
  const supervisor = await readFile(new URL('../src/supervisor/index.mjs', import.meta.url), 'utf8')
  assert.match(supervisor, /if \(gone\.has\(card\.name\) && ports\.outbox\(\)\.some\(message => message\.to === card\.name && message\.command === 'sweep' && message\.state === 'waiting'\)\) return true/)
})
