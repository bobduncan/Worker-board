// Signals change 4, B908 (2026-11-02): what makes a chat need waking, and the first line its wake message carries
// (src/wake.mjs `wakeNeeds`, B.1-B.5). The root cause of the morning: at 10:31 the hand-out gave B855 to an asleep Worker 2
// (envelope 83c1a7be1feab83b), and a task envelope was no wake word, so only the opener's launches tried; now the envelope
// is the need, and its message says "take B855 in this turn: run work next".

import assert from 'node:assert/strict'
import test from 'node:test'

import { ASLEEP_LINE } from '../src/hands.mjs'
import { WORDS_LINE, nobodyRunsSpell, wakeNeeds } from '../src/wake.mjs'

const at = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()
const UUID = n => `0000000${n}-aaaa-bbbb-cccc-ddddeeeeffff`
const lane = (name, more = {}) => ({
  name, isMain: false, isLeftover: false, isRunning: false, asleep: true, asleepSince: at(8, 0), state: 'free', appSession: `local_${name.replace(/\s/g, '')}`,
  session: UUID(name.length % 10), removedAt: null, queue: [], storeSteps: [], onSequence: true, clearOwed: null, ...more,
})
const stateOf = (chats, more = {}) => ({ chats, restart: { main: 'Main' }, chatPrefix: '', pause: null, ...more })
const envelope = (to, more = {}) => ({ id: '83c1a7be1feab83b', at: at(10, 31), to, command: 'handover', kind: 'task', step: 'B855', clear: null, line: 'work: B855 is yours; run work next', state: 'waiting', ...more })

test('B.1 the 10:31 case: a waiting task envelope to an asleep worker is a need with the take line', () => {
  const state = stateOf([lane('Main', { isMain: true, isRunning: true, asleep: false }), lane('Worker 2', { asleepSince: new Date(2026, 10, 1, 14, 16).getTime() })])
  const needs = wakeNeeds(state, [envelope('Worker 2')])
  assert.equal(needs.length, 1)
  assert.deepEqual({ ...needs[0] }, {
    chat: 'Worker 2', appSession: 'local_Worker2', session: UUID(8), spell: new Date(2026, 10, 1, 14, 16).getTime(),
    why: 'envelope', text: 'take B855 in this turn: run work next', step: 'B855', paths: ['message', 'launch'],
  })
})

test('B.1 an envelope with a clear, or a worker that owes a clear, gives the plain line (decision 12); a resume envelope its line', () => {
  const state = stateOf([lane('Worker 5'), lane('Worker 4', { clearOwed: { step: 'B821' } }), lane('Worker 3')])
  const needs = wakeNeeds(state, [
    envelope('Worker 5', { clear: { step: 'B821', reportedAt: at(9, 0) } }),
    envelope('Worker 4', { id: 'e4' }),
    envelope('Worker 3', { id: 'e3', kind: 'resume', step: null, line: 'go on with B700 from your checkpoint' }),
  ])
  assert.deepEqual(needs.map(one => [one.chat, one.text]), [['Worker 5', WORDS_LINE], ['Worker 4', WORDS_LINE], ['Worker 3', 'go on with B700 from your checkpoint']])
})

test('order B (the lead\'s live check, 2026-11-02): a worker held on a failed clear whose chat does not run is a need with the plain line; one whose chat runs is none', () => {
  const since = new Date(2026, 10, 2, 21, 27).getTime()
  const held = lane('Worker 3', { asleepSince: since, handover: { state: 'held', why: 'its clear did not run: /clear did not run within two minutes; next try 21:37', step: 'B930' } })
  const state = stateOf([lane('Main', { isMain: true, isRunning: true, asleep: false }), held])
  const needs = wakeNeeds(state, [])
  assert.deepEqual(needs.map(one => [one.chat, one.why, one.text, one.step]), [['Worker 3', 'held', 'The worker board holds words for you: run work next', 'B930']])
  // Its chat runs: the hold is released by its own report; no wake.
  assert.deepEqual(wakeNeeds(stateOf([lane('Main', { isMain: true, isRunning: true, asleep: false }), { ...held, isRunning: true, asleep: false }]), []), [])
  // A waiting envelope still comes first (case 1), the hold second.
  const envelope = { id: 'e1', at: since, to: 'Worker 3', command: 'handover', about: 'Worker 3', kind: 'clear', step: null, clear: { step: 'B930', reportedAt: since - 60_000 }, restart: false, set: null, line: null, state: 'waiting' }
  assert.equal(wakeNeeds(state, [envelope])[0].why, 'envelope')
})

test('B.2 the pause\'s resume list; B.3 asleep and interrupted; B.4 a word that wakes; B.5 a queued step of a worker not on the sequence', () => {
  const state = stateOf([
    lane('Worker 1'),
    lane('Worker 2', { state: 'interrupted', onSequence: false, storeSteps: [{ id: 'B12', state: 'in progress' }] }),
    lane('Worker 3', { state: 'interrupted', storeSteps: [] }),
    lane('Worker 4', { onSequence: false, queue: [{ id: 'B44' }] }),
    // A holder on the sequence gets its "go on" line from the hand-over (its envelope), not from here.
    lane('Worker 6', { state: 'interrupted', storeSteps: [{ id: 'B60', state: 'taken' }] }),
  ], { advisor: lane('Advisor') })
  const needs = wakeNeeds(state, [{ id: 'r', to: 'Advisor', command: 'refine', state: 'waiting', at: at(9, 0) }], { resumeList: [{ chat: 'Worker 1', step: 'B9', hasStarted: false }] })
  assert.deepEqual(needs.map(one => [one.chat, one.why, one.text]), [
    ['Advisor', 'words', WORDS_LINE],
    ['Worker 1', 'resume', 'resume your step B9 from your checkpoint'],
    ['Worker 2', 'asleep', 'resume your step B12 from your checkpoint'],
    ['Worker 3', 'asleep', ASLEEP_LINE],
    ['Worker 4', 'queue', 'take B44 in this turn: run work next'],
  ])
})

test('the Product owner first (its talk word), then the main chat, the partner, the supervisor, the workers in list order', () => {
  const state = stateOf([lane('Worker 1'), lane('Main', { isMain: true })], {
    advisor: lane('Advisor'), supervisorChat: lane('Supervisor'), productOwner: lane('Owner'),
  })
  const words = ['Worker 1', 'Main', 'Advisor', 'Supervisor'].map((to, i) => ({ id: `w${i}`, to, command: to === 'Worker 1' ? 'handover' : 'refine', kind: 'task', step: 'B1', state: 'waiting', at: at(9, i) }))
  // The owner's talk is a plain line typed on the board (no command).
  words.push({ id: 'o', to: 'Owner', command: 'talk', state: 'waiting', at: at(9, 9) })
  assert.deepEqual(wakeNeeds(state, words).map(one => one.chat), ['Owner', 'Main', 'Advisor', 'Supervisor', 'Worker 1'])
})

test('nothing while the person pauses; a running or unknown chat, a leftover and a removed one need nothing; a word the pause holds wakes nobody', () => {
  const chats = [lane('Worker 1', { isRunning: true }), lane('Worker 2', { isRunning: null }), lane('Worker 3', { isLeftover: true }), lane('Worker 4', { removedAt: at(9, 0) })]
  const words = chats.map((one, i) => envelope(one.name, { id: `e${i}` }))
  assert.deepEqual(wakeNeeds(stateOf(chats), words), [])
  assert.deepEqual(wakeNeeds(stateOf([lane('Worker 5')], { pause: { state: 'pausing' } }), [envelope('Worker 5')]), [])
  assert.deepEqual(wakeNeeds(stateOf([lane('Worker 5')]), [envelope('Worker 5', { isHeld: true })]), [])
})

test('decision 12: a chat with neither an app id nor a CLI session id gets its why and text but no path', () => {
  const needs = wakeNeeds(stateOf([lane('Worker 7', { appSession: null, session: null })]), [envelope('Worker 7')])
  assert.deepEqual(needs[0].paths, [])
  assert.equal(needs[0].text, 'take B855 in this turn: run work next')
  // A board that cannot launch: the message only.
  assert.deepEqual(wakeNeeds(stateOf([lane('Worker 7')]), [envelope('Worker 7')], { canLaunch: false })[0].paths, ['message'])
})

test('nobodyRunsSpell: a wake word (a task envelope now too) waits for an off chat and no chat that could carry a message may run', () => {
  const chats = [lane('Main', { isMain: true }), lane('Worker 2')]
  const spell = nobodyRunsSpell(stateOf(chats), [envelope('Worker 2'), { id: 'm', to: 'Main', command: 'refine', state: 'waiting', at: at(10, 20) }])
  assert.deepEqual(spell, { since: at(10, 20), chats: ['Worker 2', 'Main'] })
  // One that may run says nothing.
  assert.equal(nobodyRunsSpell(stateOf([lane('Main', { isMain: true, isRunning: null }), lane('Worker 2')]), [envelope('Worker 2')]), null)
  assert.equal(nobodyRunsSpell(stateOf([lane('Main', { isMain: true, isRunning: true }), lane('Worker 2')]), [envelope('Worker 2')]), null)
  // Nothing waits: none.
  assert.equal(nobodyRunsSpell(stateOf(chats), []), null)
})
