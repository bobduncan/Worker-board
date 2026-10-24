// B570: a new Workers mod reaches the chats between their steps. The board asks the main chat to restart (archive and
// unarchive) each idle chat on an older mod, and the partner for the main chat; a chat with a step in progress waits for
// its report; the line of an idle worker's next step waits for the restart a few minutes at most. No word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { RESTART_AGAIN_MS, RESTART_HOLD_MS, RESTART_TRIES, restartWords, rolloutPlan } from '../src/work/modRollout.mjs'
import { isPartnerWord } from '../src/say.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 22, 0).getTime()
const item = head => ({ head: new Map(Object.entries(head)), sections: new Map() })
const step = (id, state, owner) => item({ Id: id, Kind: 'step', State: state, Owner: owner })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const chat = (name, role = 'worker', more = {}) => ({ name, role, state: 'free', isRunning: true, session: `local_${name.toLowerCase()}`, idleSince: NOW - 5 * MIN, ...more })
const CHATS = [chat('Lead', 'main'), chat('Painter'), chat('Mason'), chat('Guide', 'partner'), chat('Watch', 'supervisor')]
const MODS = { installed: '0.17.0', chats: { Lead: '0.16.1', Painter: '0.16.1', Mason: '0.17.0', Guide: '0.16.1', Watch: '0.16.1' } }
const plan = (more = {}) => rolloutPlan({ mods: MODS, chats: CHATS, items: new Map(), deliveries: [], sent: [], now: NOW, main: 'Lead', partner: 'Guide', ...more })
const sentWord = (chat, minutesAgo, more = {}) => ({ command: 'mod-restart', about: chat, version: '0.17.0', at: NOW - minutesAgo * MIN, state: 'taken', ...more })

test('every idle chat on an older mod gets a word: the main chat for the others, the partner for the main chat', () => {
  const { words, runs } = plan()
  assert.deepEqual(words.map(one => [one.to, one.chat, one.runs, one.installed]), [
    ['Guide', 'Lead', '0.16.1', '0.17.0'], ['Lead', 'Painter', '0.16.1', '0.17.0'], ['Lead', 'Guide', '0.16.1', '0.17.0'], ['Lead', 'Watch', '0.16.1', '0.17.0'],
  ])
  assert.equal(runs.has('Mason'), false, 'on the installed mod: nothing to do')
  assert.equal(runs.get('Painter').text, 'Workers mod 0.16.1: Lead is asked to restart it')
  assert.equal(words[1].session, 'local_painter')
})

test('only an idle chat is restarted: not in a turn, not one whose process ended, not with a step in progress', () => {
  const chats = [chat('Lead', 'main'), chat('Painter', 'worker', { state: 'working' }), chat('Mason', 'worker', { isRunning: false }), chat('Stone'), chat('Clay', 'worker', { isRunning: null })]
  const mods = { installed: '0.17.0', chats: { Painter: '0.16.1', Mason: '0.16.1', Stone: '0.16.1', Clay: '0.16.1' } }
  const { words, runs } = plan({ chats, mods, items: items(step('B7', 'in progress', 'Stone')) })
  assert.deepEqual(words, [])
  assert.equal(runs.get('Painter').text, 'Workers mod 0.16.1: restarts once it is free', 'in a turn, or with work in the background')
  assert.equal(runs.get('Stone').text, 'Workers mod 0.16.1: restarts after B7', 'its step in progress waits for its report')
  assert.equal(runs.get('Mason').status, 'after-step', 'its process ended: it starts on the installed mod')
  assert.equal(runs.get('Clay').status, 'after-step', 'whether it runs is not known: no archive on a guess')
  // Taken and waiting on you hold too; a step in review is reported: the chat is free.
  for (const state of ['taken', 'waiting on you']) assert.deepEqual(plan({ chats: [chat('Lead', 'main'), chat('Stone')], mods, items: items(step('B7', state, 'Stone')) }).words, [])
  assert.equal(plan({ chats: [chat('Lead', 'main'), chat('Stone')], mods, items: items(step('B7', 'review', 'Stone')) }).words.length, 1)
})

test('the word goes once per half hour, three times at most; after that the chat is shown as tried', () => {
  const only = { chats: [chat('Lead', 'main'), chat('Painter')], mods: { installed: '0.17.0', chats: { Painter: '0.16.1' } } }
  assert.deepEqual(plan({ ...only, sent: [sentWord('Painter', 10)] }).words, [])
  assert.equal(plan({ ...only, sent: [sentWord('Painter', 10)] }).runs.get('Painter').status, 'asked')
  assert.equal(plan({ ...only, sent: [sentWord('Painter', RESTART_AGAIN_MS / MIN)] }).words.length, 1, 'still on the older mod after half an hour: again')
  const tried = Array.from({ length: RESTART_TRIES }, (_, n) => sentWord('Painter', 40 + n * 31))
  assert.deepEqual(plan({ ...only, sent: tried }).words, [])
  assert.equal(plan({ ...only, sent: tried }).runs.get('Painter').text, 'Workers mod 0.16.1: asked 3 times, still not restarted')
  // A word for an older install does not count for this one.
  assert.equal(plan({ ...only, sent: [sentWord('Painter', 10, { version: '0.16.1' })] }).words.length, 1)
})

test('the line of an idle worker\'s next step waits for its restart, a few minutes at most', () => {
  const only = { chats: [chat('Lead', 'main'), chat('Painter')], mods: { installed: '0.17.0', chats: { Painter: '0.16.1' } }, deliveries: [{ id: 'B9', chat: 'Painter' }] }
  const first = plan(only)
  assert.deepEqual([...first.held], ['B9'], 'the word goes now: the line waits')
  assert.match(first.holds.get('B9'), /^B9 waits until Painter is restarted on Workers mod 0\.17\.0/)
  assert.deepEqual([...plan({ ...only, sent: [sentWord('Painter', 5)] }).held], ['B9'])
  assert.deepEqual([...plan({ ...only, sent: [sentWord('Painter', RESTART_HOLD_MS / MIN)] }).held], [], 'after the hold time it goes on the older mod')
  assert.deepEqual([...plan({ ...only, sent: [sentWord('Painter', 5, { state: 'expired' })] }).held], [], 'a lost word holds nothing')
  // With nobody to restart it, nothing waits.
  const alone = plan({ ...only, main: null })
  assert.deepEqual([alone.words, [...alone.held], alone.runs.get('Painter').status], [[], [], 'none'])
})

test('the main chat without a partner is not restarted; nothing is done without an installed version', () => {
  assert.equal(plan({ partner: null }).runs.get('Lead').text, 'Workers mod 0.16.1: no partner on the board to restart it')
  assert.deepEqual(plan({ mods: { installed: null, chats: MODS.chats } }).words, [])
  assert.deepEqual(plan({ mods: null }).words, [])
})

test('a mod that says no version runs one older than 0.16.0; versions compare as numbers', () => {
  const only = { chats: [chat('Lead', 'main'), chat('Painter')] }
  assert.equal(plan({ ...only, mods: { installed: '0.17.0', chats: { Painter: null } } }).words[0].runs, 'older than 0.16.0')
  assert.deepEqual(plan({ ...only, mods: { installed: '0.15.0', chats: { Painter: null } } }).words, [])
  assert.equal(plan({ ...only, mods: { installed: '0.10.0', chats: { Painter: '0.9.9' } } }).words.length, 1)
  assert.deepEqual(plan({ ...only, mods: { installed: '0.10.0', chats: { Painter: '0.10.1' } } }).words, [], 'a newer mod than the installed one is no case')
})

test('the word names the chat, its session and both versions; the partner\'s copy wakes a partner that does not run', () => {
  const words = restartWords({ to: 'Lead', chat: 'Painter', session: 'local_abc', runs: '0.16.1', installed: '0.17.0', why: 'Painter is idle' })
  assert.equal(words.text, 'restart for mod\nChat: Painter\nSession: local_abc\nFrom: 0.16.1\nTo: 0.17.0\nWhy: Painter is idle')
  assert.deepEqual([words.command, words.about, words.version, words.to], ['mod-restart', 'Painter', '0.17.0', 'Lead'])
  assert.doesNotMatch(restartWords({ to: 'Lead', chat: 'P', session: 'bad id!', runs: '1', installed: '2', why: 'x' }).text, /Session/)
  assert.equal(isPartnerWord('mod-restart'), true)
})
