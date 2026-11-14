// F23 (chat 1, 2026-11-14): words going to a chat whose board link is gone (F9's `modGone`: its Workers mod was unloaded) are held
// quietly for its restart: never expired, never named undelivered, no second word beside them, and taken once the link is back. The
// garden is made up; the chats are the Advisor (rounds, refines), the Supervisor (sweep words) and a worker (resume words).

import assert from 'node:assert/strict'
import test from 'node:test'

import { SWEEP_LINK_GONE, isHeldForLink, linkGoneNames, wordLanesOf } from '../src/modGone.mjs'
import { resumesDue } from '../src/say.mjs'
import { isLate, memoryStore } from '../src/store.mjs'
import { isUndelivered } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { sweepOutbox, takeFor } from '../src/work/outboxSweep.mjs'
import { holderTimers } from '../src/work/holderTimers.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { whyNoSweep } from '../src/supervisor/sweep.mjs'
import { waitLineOf } from '../src/waitLine.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'

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

test('F23 review 1, 3: a held word stops its clock; at link back a sweep word is dropped with a why (its maker writes a fresh one), a round is released', async () => {
  const gone = stateOf({ advisor: lane('Advisor', { modGone: GONE }), supervisorChat: lane('Supervisor', { modGone: GONE }) })
  const back = stateOf({ advisor: lane('Advisor'), supervisorChat: lane('Supervisor') })
  const outbox = memoryStore()
  for (const one of [round, sweep]) await outbox.say({ ...one })
  assert.deepEqual(await sweepOutbox({ dir: null, outbox, state: gone, now: NOW, keep: KEEP }), [])
  assert.deepEqual(outbox.outbox().map(one => [one.id, one.state, one.linkHeldAt]), [['r1', 'waiting', NOW], ['s1', 'waiting', NOW]])
  await sweepOutbox({ dir: null, outbox, state: back, now: NOW + 30 * MIN, keep: KEEP })
  const after = Object.fromEntries(outbox.outbox().map(one => [one.id, one]))
  assert.deepEqual([after.s1.state, after.s1.why], ['dropped', 'its chat\'s board link was gone for 30 min: a fresh word comes'])
  assert.deepEqual([after.r1.state, after.r1.at, after.r1.linkHeldAt], ['waiting', NOW + 30 * MIN, null])
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
  // F23 review 6: no second sweep word beside a held one: a check of its own in the wake, never inside sweeping().
  assert.match(supervisor, /if \(linkGoneNames\(wordLanesOf\(await ports\.state\(\)\)\)\.has\(card\.name\) && ports\.outbox\(\)\.some\(message => message\.to === card\.name && message\.command === 'sweep' && message\.state === 'waiting'\)\) return \{ ok: false/)
})

test('F23 review 1, 3: a held word with a 10-minute keep, far older than its keep, is handed out at the chat\'s first take after the link is back', async () => {
  const next = { id: 'n1', at: NOW - 40 * MIN, to: 'Lead', ask: null, command: 'next', text: 'B8 and B9 may go now', state: 'waiting' }
  const goneLead = stateOf({ chats: [lane('Lead', { isMain: true, modGone: GONE })] })
  const backLead = stateOf({ chats: [lane('Lead', { isMain: true })] })
  const outbox = memoryStore()
  await outbox.say({ ...next })
  await sweepOutbox({ dir: null, outbox, state: goneLead, now: NOW, keep: KEEP })
  assert.equal(outbox.outbox()[0].state, 'waiting')
  // One clock: while held it is never late, for the take, the page's outbox and the wait line alike.
  assert.equal(isLate(outbox.outbox()[0], NOW + 50 * MIN, KEEP), false)
  // An hour later the person restarted Lead; its mod's first take (the state may still read the link gone: a take proves it is back).
  const taken = await takeFor({ dir: null, outbox, state: goneLead, now: NOW + 60 * MIN, keep: KEEP, chat: 'Lead', only: () => true })
  assert.deepEqual(taken.map(one => one.id), ['n1'])
  // The re-check, B: the take ran on a state that still read Lead gone: the word is not stamped held again, and the take cleared the mark.
  const after = outbox.outbox()[0]
  assert.deepEqual([after.state, after.linkHeldAt], ['taken', null])
  // The nit: the chat reads how long it waited, from when it was first sent (40 min before, plus the hour held).
  assert.equal(taken[0].lateMs, 100 * MIN)
  // A taken word never reads "Held for Lead's restart", whatever a cached lane says.
  const leadGone = lane('Lead', { isMain: true, modGone: GONE })
  const judge = wordJudge({ state: { chats: [leadGone], pause: null, chatPrefix: '' }, outbox: outbox.outbox(), settings: {}, now: NOW + 60 * MIN })
  assert.doesNotMatch(String(waitLineOf({ word: { ...after, linkHeldAt: NOW }, lane: leadGone, now: NOW + 60 * MIN, keep: KEEP, judge })?.lead ?? ''), /Held for/)
  // Rule 8 counts from the release: not undelivered at once.
  const view = buildView({ state: backLead, items: new Map(), outbox: outbox.outbox(), settings: {}, now: NOW + 61 * MIN })
  assert.equal(isUndelivered(view, { ...outbox.outbox()[0], state: 'waiting' }), false)
})

test('F23 review 4: a holder whose link is gone gets no "go on" line and is never given back', () => {
  const t = minutes => NOW + minutes * MIN
  const item = { head: new Map(Object.entries({ Id: 'B12', Kind: 'step', Title: 'Hang the gate', State: 'in progress', Owner: 'Worker 3', Since: stamp(t(-60)) })), sections: new Map([['History', [`- ${stamp(t(-60))} Worker 3: taken → in progress`]]]), problem: null }
  const worker = more => ({ name: 'Worker 3', isMain: false, isLeftover: false, isRunning: true, state: 'unknown', report: { state: 'busy', since: t(-30), at: t(-30) }, ...more })
  const decide = (minutes, more) => holderTimers({ worker: worker(more), holding: item, items: new Map([['B12', item]]), runningMs: from => t(minutes) - from })
  assert.equal(decide(40, { modGone: { at: t(-30) } }), null)
  assert.notEqual(decide(40, {})?.resume ?? null, null, 'with its link: the go on line is due')
})

test('F23 review 5: the wait line of a word held for a gone link says so, in the attention tone; never "the board wakes it"', () => {
  const advisor = lane('Advisor', { modGone: GONE, isRunning: false, status: 'Link gone' })
  const word = { id: 'a1', at: NOW - 20 * MIN, to: 'Advisor', ask: 'Q12', command: null, text: 'Yes, B', state: 'waiting', linkHeldAt: NOW - 19 * MIN }
  const judge = wordJudge({ state: { chats: [], advisor, pause: null, chatPrefix: '' }, outbox: [word], settings: {}, now: NOW })
  const line = waitLineOf({ word, lane: advisor, now: NOW, keep: KEEP, judge })
  assert.deepEqual([line.state, line.chat, line.lead], ['late', 'Advisor', 'Held for Advisor\'s restart'])
  assert.match(line.rest, /its board link is gone · restart this chat/)
  assert.doesNotMatch(JSON.stringify(line), /the board wakes it/)
})

test('F23 review 2, 6, 7: no sweep while the Supervisor\'s link is gone, an open one ends with that reason; no new refine for a gone Advisor', async () => {
  assert.equal(whyNoSweep({ named: 'Supervisor', title: 'Supervisor', card: { name: 'Supervisor', modGone: GONE }, withoutMod: false, mod: '0.40.0' }), SWEEP_LINK_GONE)
  const { readFile } = await import('node:fs/promises')
  const sweepFile = await readFile(new URL('../src/supervisor/sweep.mjs', import.meta.url), 'utf8')
  assert.match(sweepFile, /if \(isOpen\(\) && \(\(await chat\(\)\)\?\.card\?\.modGone \?\? null\) !== null\) \{\n\s+end\(now, 'quiet', \{ note: SWEEP_LINK_GONE \}\)/)
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const due = \(state\.advisor\?\.modGone \?\? null\) !== null \? \{ \.\.\.due0, refine: null \} : due0/)
})

test('F23 re-check A: at link back only a sweep or a set word is dropped (their makers write fresh ones); a partner switch, a spawn and a sync are released', async () => {
  const { linkReleaseOf } = await import('../src/modGone.mjs')
  for (const command of ['partner-effort', 'spawn', 'sync', 'next', 'round', null]) {
    assert.equal(linkReleaseOf({ command, at: NOW - 30 * MIN, linkHeldAt: NOW - 20 * MIN }, NOW).release?.at, NOW, String(command))
  }
  for (const command of ['sweep', 'worker-effort', 'effort']) assert.match(linkReleaseOf({ command, at: NOW - 30 * MIN, linkHeldAt: NOW - 20 * MIN }, NOW).drop, /a fresh word comes/, command)
})

test('F23 re-check B, each part on its own: a sweep with `back` never stamps that chat\'s words held; a take clears a held mark', async () => {
  const goneLead = stateOf({ chats: [lane('Lead', { isMain: true, modGone: GONE })] })
  const outbox = memoryStore()
  await outbox.say({ id: 'w1', at: NOW - MIN, to: 'Lead', ask: null, command: 'next', text: 'go', state: 'waiting' })
  await sweepOutbox({ dir: null, outbox, state: goneLead, now: NOW, keep: KEEP, back: 'Lead' })
  assert.equal(outbox.outbox()[0].linkHeldAt, undefined, 'its take proves the link is back')
  await outbox.update('w1', { linkHeldAt: NOW })
  const [taken] = await outbox.take('Lead', NOW + MIN, KEEP)
  assert.equal(taken.linkHeldAt, null)
  assert.equal(outbox.outbox()[0].linkHeldAt, null)
})
