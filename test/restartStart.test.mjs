// B587 (X36): a free worker restarted for a new Workers mod takes its next step within minutes. On 2026-10-24 a worker
// reported its step, the board asked the main chat to restart it for the new mod (archive and unarchive: its process
// ended), and the line of its next step waited for the clear it owed after that report, which a chat whose process
// ended cannot run: the line went only when the board started anew 8 minutes on, the start word a minute later. Now
// neither hold outlasts the restart: once the chat's process ended its line goes with the board's start the same
// minute, and a word its restarter did not carry out holds nothing. Made-up chats and steps only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { clearHolds } from '../src/clearOwed.mjs'
import { REFUSED_AFTER_MS, rolloutPlan } from '../src/work/modRollout.mjs'
import { wakeFor, workWords } from '../src/say.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 22, 46).getTime()
const owes = { step: 'B12', reportedAt: NOW - 2 * MIN, clearedAt: null, why: null, canClear: true }
const lane = (more = {}) => ({ name: 'Painter', isMain: false, isLeftover: false, state: 'free', isRunning: true, clearOwed: owes, ...more })
const LINE = [{ id: 'B13', chat: 'Painter' }]

test('X36: the clear it owes holds the next step\'s line only while the chat\'s process runs', () => {
  assert.deepEqual([...clearHolds({ lanes: [lane()], deliveries: LINE })], ['B13'], 'it runs: its mod clears it first')
  assert.deepEqual([...clearHolds({ lanes: [lane({ isRunning: null })], deliveries: LINE })], ['B13'], 'not known whether it runs: held as before')
  assert.deepEqual([...clearHolds({ lanes: [lane({ isRunning: false })], deliveries: LINE })], [], 'its process ended: the line goes')
  assert.deepEqual([...clearHolds({ lanes: [lane({ clearOwed: { ...owes, canClear: false } })], deliveries: LINE })], [], 'a mod that cannot clear holds nothing')
  assert.deepEqual([...clearHolds({ lanes: [lane({ clearOwed: null })], deliveries: LINE })], [])
})

test('X36: the line to a chat whose process ended goes with the main chat\'s start in the same refresh', () => {
  const state = { restart: { main: 'Lead' }, chats: [{ name: 'Lead', isMain: true, isRunning: true }, lane({ isRunning: false, appSession: 'local_painter' })] }
  const start = wakeFor({ ...workWords('Painter', 'B13'), at: NOW }, state, [], NOW, 2000)
  assert.equal(start?.command, 'start')
  assert.equal(start?.about, 'Painter')
  assert.equal(start?.to, 'Lead')
})

const chat = (name, role = 'worker', more = {}) => ({ name, role, state: 'free', isRunning: true, session: `local_${name.toLowerCase()}`, idleSince: NOW - 5 * MIN, ...more })
const MODS = { installed: '0.18.0', chats: { Painter: '0.17.0' } }
const word = (minutesAgo, more = {}) => ({ command: 'mod-restart', about: 'Painter', version: '0.18.0', at: NOW - minutesAgo * MIN, state: 'delivered', deliveredAt: NOW - minutesAgo * MIN + 3000, ...more })
const plan = (more = {}) => rolloutPlan({ mods: MODS, chats: [chat('Lead', 'main', { state: 'working' }), chat('Painter')], deliveries: LINE, sent: [word(1)], now: NOW, main: 'Lead', partner: 'Guide', ...more })

test('X36: the restart\'s hold lets go once the chat\'s process ended, at once', () => {
  assert.deepEqual([...plan().held], ['B13'], 'the word was typed a minute ago and the chat still runs: it waits')
  const ended = plan({ chats: [chat('Lead', 'main'), chat('Painter', 'worker', { isRunning: false })] })
  assert.deepEqual([...ended.held], [], 'archived: its process ended, its line goes')
})

test('the restart\'s hold lets go when the restarter\'s turn ended without the restart, or the word was lost', () => {
  const left = minutes => plan({ chats: [chat('Lead', 'main', { state: 'free' }), chat('Painter')], sent: [word(minutes)] })
  assert.deepEqual([...left(REFUSED_AFTER_MS / MIN + 1).held], [], 'the main chat is done and the chat still runs: refused, its line goes')
  assert.deepEqual([...left(1).held], ['B13'], 'a minute after the word: the archive may be on its way')
  assert.deepEqual([...plan({ sent: [word(5)] }).held], ['B13'], 'the main chat still works: it may yet restart it')
  assert.deepEqual([...plan({ sent: [word(5, { state: 'failed' })] }).held], [], 'a lost word holds nothing')
})

test('X35: a worker that takes its step two minutes after the word was never held by the restart', () => {
  // The main chat answered that the chat was working; it took its step from its own turn, on the older mod.
  const working = plan({ chats: [chat('Lead', 'main', { state: 'free' }), chat('Painter', 'worker', { state: 'working' })], sent: [word(2)] })
  assert.deepEqual([...working.held], [])
})
