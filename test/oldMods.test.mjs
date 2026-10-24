// B541, the fix of incidents X4-X6: chats on an older Workers mod than the one installed get one card under Needs your
// attention, naming each with what it misses, and the one way to bring them up to date (pause all, restart the app,
// resume all). No word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { chatsByRole, oldModChats, oldModNeed, overdueChats } from '../src/oldMods.mjs'

const NOW = new Date(2026, 9, 24, 19, 0).getTime()
// B570: each idle 45 minutes, past the half hour in which the board has an idle chat restarted.
const IDLE = { state: 'free', isRunning: true, idle: { since: NOW - 45 * 60_000 } }
const STATE = {
  chats: [{ name: 'Lead', isMain: true, ...IDLE }, { name: 'Painter', ...IDLE }, { name: 'Mason', ...IDLE }, { name: 'Gone', isLeftover: true }],
  advisor: { name: 'Guide', ...IDLE }, advisorHelper: { name: 'Guide 2', ...IDLE }, supervisorChat: { name: 'Watch', ...IDLE },
}

test('the chats by role: the main chat, the workers (not one left behind), the partner, its helper and the supervisor', () => {
  assert.deepEqual(chatsByRole(STATE).map(one => [one.name, one.role]), [['Lead', 'main'], ['Painter', 'worker'], ['Mason', 'worker'], ['Guide', 'partner'], ['Guide 2', 'helper'], ['Watch', 'supervisor']])
  assert.deepEqual(chatsByRole({}), [])
})

test('three chats on an old mod give one card naming all three, with the one way and what each misses', () => {
  const mods = { installed: '0.16.0', chats: { Lead: '0.16.0', Painter: null, Mason: '0.15.2', Guide: null, Gone: null } }
  const need = oldModNeed(mods, chatsByRole(STATE), NOW)
  assert.equal(need.id, 'old-mod:0.16.0')
  assert.equal(need.kind, 'old-mod')
  assert.equal(need.title, '3 chats run an older Workers mod: restart the app to update')
  assert.equal(need.text, 'Painter, Mason and Guide run an older Workers mod than 0.16.0, the one installed, and the board could not get them restarted while idle. A chat takes a new mod only when it starts anew.')
  assert.deepEqual(need.chats.map(one => [one.name, one.runs, one.cost]), [
    ['Painter', 'older than 0.16.0', 'it says no version and misses the newer work calls'],
    ['Mason', '0.15.2', 'it misses what came after 0.15.2'],
    ['Guide', 'older than 0.16.0', 'it cannot name the fix of an incident'],
  ])
  assert.deepEqual(need.steps, ['Press Pause all and wait until every chat has stopped', 'Quit the Claude app and start it again', 'Press Resume all'])
  assert.equal(need.canAnswer, false, 'the person acts; there is nothing to answer')
  assert.equal(need.at, NOW)
})

test('one chat is named in the title; the supervisor\'s chat says it cannot sweep', () => {
  const need = oldModNeed({ installed: '0.16.0', chats: { Watch: null } }, chatsByRole(STATE), NOW)
  assert.equal(need.title, 'Watch runs an older Workers mod: restart the app to update')
  assert.equal(need.chats[0].cost, 'it cannot run a sweep')
})

test('all up to date, not known, or nothing installed gives no card: it clears by itself', () => {
  const chats = chatsByRole(STATE)
  assert.equal(oldModNeed({ installed: '0.16.0', chats: { Lead: '0.16.0', Painter: '0.16.0', Guide: '0.16.1' } }, chats, NOW), null)
  assert.equal(oldModNeed({ installed: '0.16.0', chats: {} }, chats, NOW), null, 'a chat whose mod did not ask lately is not known')
  assert.equal(oldModNeed({ installed: null, chats: { Painter: '0.1.0' } }, chats, NOW), null)
  assert.equal(oldModNeed(null, chats, NOW), null)
  // A mod that says no version is a case only once the first that says one is installed.
  assert.equal(oldModNeed({ installed: '0.15.9', chats: { Painter: null } }, chats, NOW), null)
  // A chat the board does not show (one left behind, or a stranger) is no case.
  assert.equal(oldModNeed({ installed: '0.16.0', chats: { Gone: null, Stranger: '0.1.0' } }, chats, NOW), null)
})

test('versions compare as numbers, not as text', () => {
  assert.deepEqual(oldModChats({ installed: '0.16.0', chats: { Painter: '0.9.9' } }, [{ name: 'Painter' }]).map(one => one.name), ['Painter'])
  assert.deepEqual(oldModChats({ installed: '0.10.0', chats: { Painter: '0.9.9', Mason: '0.10' } }, [{ name: 'Painter' }, { name: 'Mason' }]).map(one => one.name), ['Painter'])
})

test('B570: the chats by role carry their state, whether they run, their session and since when they are idle', () => {
  const [lead] = chatsByRole({ chats: [{ name: 'Lead', isMain: true, state: 'free', isRunning: true, appSession: 'local_1', idle: { since: 5 } }] })
  assert.deepEqual(lead, { name: 'Lead', role: 'main', state: 'free', isRunning: true, session: 'local_1', idleSince: 5 })
  assert.equal(chatsByRole({ chats: [{ name: 'A', state: 'working', idle: { since: 5 } }] })[0].idleSince, null, 'busy: not idle')
  assert.equal(chatsByRole({ chats: [{ name: 'A', state: 'free', isRunning: false, idle: { since: 5 } }] })[0].idleSince, null, 'not running: not idle')
})

test('B570: the card and the finding name only the chats the board did not get restarted: idle on the older mod over 30 min', () => {
  const mods = { installed: '0.17.0', chats: { Painter: '0.16.1', Mason: '0.16.1' } }
  const state = { chats: [{ name: 'Painter', ...IDLE }, { name: 'Mason', ...IDLE, idle: { since: NOW - 10 * 60_000 } }] }
  assert.deepEqual(overdueChats(mods, chatsByRole(state), NOW).map(one => one.name), ['Painter'])
  assert.equal(oldModNeed(mods, chatsByRole(state), NOW).title, 'Painter runs an older Workers mod: restart the app to update')
  const busy = { chats: [{ name: 'Painter', ...IDLE, state: 'working' }] }
  assert.equal(oldModNeed(mods, chatsByRole(busy), NOW), null, 'a busy chat is restarted after its step')
})
