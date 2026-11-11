// B570: a new Workers mod reaches the chats between their steps. The board asks the main chat to restart (archive and
// unarchive) each idle chat on an older mod, and the partner for the main chat; a chat with a step in progress waits for
// its report. T8.5 step 6: a worker gets no word (one on the hand-over sequence restarts by its envelope; one on an older
// mod is handed nothing until it is restarted by hand), and no line waits here. No word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { RESTART_AGAIN_MS, RESTART_CAUSE_MS, RESTART_TRIES, UNARCHIVE_AFTER_MS, UNARCHIVE_AGAIN_MS, archivedAfterRestart, restartWords, rolloutPlan, unarchiveWords } from '../src/work/modRollout.mjs'
import { archivedChatsOf } from '../src/appChats.mjs'
import { isPartnerWord } from '../src/say.mjs'
import { outboxNow } from '../src/store.mjs'
import { readFileSync } from 'node:fs'

const MIN = 60_000
const NOW = new Date(2026, 9, 24, 22, 0).getTime()
const item = head => ({ head: new Map(Object.entries(head)), sections: new Map() })
const step = (id, state, owner) => item({ Id: id, Kind: 'step', State: state, Owner: owner })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const chat = (name, role = 'worker', more = {}) => ({ name, role, state: 'free', isRunning: true, session: `local_${name.toLowerCase()}`, idleSince: NOW - 5 * MIN, ...more })
const CHATS = [chat('Lead', 'main'), chat('Painter'), chat('Mason'), chat('Guide', 'partner'), chat('Watch', 'supervisor')]
const MODS = { installed: '0.17.0', chats: { Lead: '0.16.1', Painter: '0.16.1', Mason: '0.17.0', Guide: '0.16.1', Watch: '0.16.1' } }
const plan = (more = {}) => rolloutPlan({ mods: MODS, chats: CHATS, items: new Map(), sent: [], now: NOW, main: 'Lead', partner: 'Guide', ...more })
const sentWord = (chat, minutesAgo, more = {}) => ({ command: 'mod-restart', about: chat, version: '0.17.0', at: NOW - minutesAgo * MIN, state: 'taken', ...more })

test('every idle chat on an older mod but a worker gets a word: the main chat for the others, the partner for the main chat', () => {
  const { words, runs } = plan()
  assert.deepEqual(words.map(one => [one.to, one.chat, one.runs, one.installed]), [
    ['Guide', 'Lead', '0.16.1', '0.17.0'], ['Lead', 'Guide', '0.16.1', '0.17.0'], ['Lead', 'Watch', '0.16.1', '0.17.0'],
  ])
  assert.equal(runs.has('Mason'), false, 'on the installed mod: nothing to do')
  assert.equal(runs.get('Guide').text, 'Workers mod 0.16.1: Lead is asked to restart it')
  assert.equal(words[1].session, 'local_guide')
})

test('step 6: an idle worker on an older mod gets no word and no line waits: its lane says it gets no task until it is restarted', () => {
  const { words, runs, held } = plan()
  assert.equal(words.some(one => one.chat === 'Painter'), false)
  assert.equal(held, undefined)
  assert.deepEqual([runs.get('Painter').status, runs.get('Painter').text], ['by-hand', 'Workers mod 0.16.1: gets no task until its chat is restarted on 0.17.0'])
  // A worker holding a step still restarts after it, as before.
  assert.equal(plan({ items: items(step('B7', 'in progress', 'Painter')) }).runs.get('Painter').text, 'Workers mod 0.16.1: restarts after B7')
})

test('only an idle chat is restarted: not in a turn, not one whose process ended, not with a step in progress', () => {
  const chats = [chat('Lead', 'main'), chat('Painter', 'helper', { state: 'working' }), chat('Mason', 'helper', { isRunning: false }), chat('Stone', 'helper'), chat('Clay', 'helper', { isRunning: null })]
  const mods = { installed: '0.17.0', chats: { Painter: '0.16.1', Mason: '0.16.1', Stone: '0.16.1', Clay: '0.16.1' } }
  const { words, runs } = plan({ chats, mods, items: items(step('B7', 'in progress', 'Stone')) })
  assert.deepEqual(words, [])
  assert.equal(runs.get('Painter').text, 'Workers mod 0.16.1: restarts once it is free', 'in a turn, or with work in the background')
  assert.equal(runs.get('Stone').text, 'Workers mod 0.16.1: restarts after B7', 'its step in progress waits for its report')
  assert.equal(runs.get('Mason').status, 'after-step', 'its process ended: it starts on the installed mod')
  assert.equal(runs.get('Clay').status, 'after-step', 'whether it runs is not known: no archive on a guess')
  // Taken and waiting on you hold too; a step in review is reported: the chat is free.
  for (const state of ['taken', 'waiting on you']) assert.deepEqual(plan({ chats: [chat('Lead', 'main'), chat('Stone', 'helper')], mods, items: items(step('B7', state, 'Stone')) }).words, [])
  assert.equal(plan({ chats: [chat('Lead', 'main'), chat('Stone', 'helper')], mods, items: items(step('B7', 'review', 'Stone')) }).words.length, 1)
})

test('the word goes once per half hour, three times at most; after that the chat is shown as tried', () => {
  const only = { chats: [chat('Lead', 'main'), chat('Painter', 'helper')], mods: { installed: '0.17.0', chats: { Painter: '0.16.1' } } }
  assert.deepEqual(plan({ ...only, sent: [sentWord('Painter', 10)] }).words, [])
  assert.equal(plan({ ...only, sent: [sentWord('Painter', 10)] }).runs.get('Painter').status, 'asked')
  assert.equal(plan({ ...only, sent: [sentWord('Painter', RESTART_AGAIN_MS / MIN)] }).words.length, 1, 'still on the older mod after half an hour: again')
  const tried = Array.from({ length: RESTART_TRIES }, (_, n) => sentWord('Painter', 40 + n * 31))
  assert.deepEqual(plan({ ...only, sent: tried }).words, [])
  assert.equal(plan({ ...only, sent: tried }).runs.get('Painter').text, 'Workers mod 0.16.1: asked 3 times, still not restarted')
  // A word for an older install does not count for this one.
  assert.equal(plan({ ...only, sent: [sentWord('Painter', 10, { version: '0.16.1' })] }).words.length, 1)
})

test('the main chat without a partner is not restarted; nothing is done without an installed version', () => {
  assert.equal(plan({ partner: null }).runs.get('Lead').text, 'Workers mod 0.16.1: no partner on the board to restart it')
  assert.deepEqual(plan({ mods: { installed: null, chats: MODS.chats } }).words, [])
  assert.deepEqual(plan({ mods: null }).words, [])
})

test('a mod that says no version runs one older than 0.16.0; versions compare as numbers', () => {
  const only = { chats: [chat('Lead', 'main'), chat('Painter', 'helper')] }
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

test('the Workers mod release 0.32.0 (chat 1\'s review and verifier): a chat still archived after its restart for the mod gets its restarter an unarchive word, once per half hour, three times at most', () => {
  // A restart word as the outbox holds it: made `minutesAgo`, delivered a minute later (reached its restarter), naming the chat's session.
  const restart = (chat, minutesAgo, more = {}) => ({ id: `r-${chat}-${minutesAgo}`, to: 'Lead', command: 'mod-restart', about: chat, session: `local_${chat.toLowerCase().replace(/\W+/g, '')}`, version: '0.32.0', at: NOW - minutesAgo * MIN, deliveredAt: NOW - minutesAgo * MIN + MIN, state: 'delivered', ...more })
  const file = (name, more = {}) => ({ name, session: `local_${name.toLowerCase().replace(/\W+/g, '')}`, lastActivityAt: NOW - 10 * MIN, hasOpenTwin: false, ...more })
  const archived = [file('Painter'), file('Lead'), file('Old chat')]
  // Painter: restart word reached 6 min ago, still archived: the main chat is asked to unarchive it. Lead (the main chat): the partner. Old chat: no restart word (the person archived it): nothing.
  const words = archivedAfterRestart({ archived, sent: [restart('Painter', 7), restart('Lead', 7, { to: 'Guide' })], now: NOW, main: 'Lead', partner: 'Guide' })
  assert.deepEqual(words.map(one => [one.to, one.chat, one.session]), [['Lead', 'Painter', 'local_painter'], ['Guide', 'Lead', 'local_lead']])
  assert.match(words[0].why, /^Painter is still archived 6 min after its restart for the mod \(asked at \d\d:\d\d\): unarchive it, archive nothing$/)
  // The verifier: the grace counts from when the word REACHED its restarter (made 12 min ago, delivered 20 s ago: the main chat is at it), not from its making.
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 12, { deliveredAt: NOW - 20_000 })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 5)], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.equal(UNARCHIVE_AFTER_MS, 5 * MIN)
  // Asked 10 min ago and still archived: not again before the half hour; after it, once more.
  const asked = (minutesAgo, more = {}) => ({ id: `u-${minutesAgo}`, to: 'Lead', command: 'mod-unarchive', about: 'Painter', session: 'local_painter', at: NOW - minutesAgo * MIN, state: 'delivered', ...more })
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 40), asked(10)], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.equal(archivedAfterRestart({ archived, sent: [restart('Painter', 40), asked(31)], now: NOW, main: 'Lead', partner: 'Guide' }).length, 1)
  assert.equal(UNARCHIVE_AGAIN_MS, 30 * MIN)
  // A restart word that failed or expired caused nothing; one still waiting or taken made no archive yet; no restarter on the board: nothing.
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 7, { state: 'failed' })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 7, { state: 'taken', deliveredAt: undefined })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 7)], now: NOW, main: null, partner: null }), [])
  // The review: at most three words per restart; the verifier: counted through the outbox's own view, which keeps unarchive words a day (else the
  // first drops out after two hours and a fourth word goes).
  const three = [95, 65, 35].map(minutesAgo => asked(minutesAgo))
  assert.deepEqual(archivedAfterRestart({ archived, sent: outboxNow([restart('Painter', 100), ...three], NOW, () => false), now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.equal(archivedAfterRestart({ archived, sent: outboxNow([restart('Painter', 100), ...three.slice(1)], NOW, () => false), now: NOW, main: 'Lead', partner: 'Guide' }).length, 1)
  assert.equal(outboxNow([asked(3 * 60)], NOW, () => false).length, 1)
  // The verifier: a restart word is the cause of an archive only while it reached its restarter within RESTART_CAUSE_MS (the archive follows
  // within a minute); an older word is none: the person archived the chat since, or the board removed it.
  assert.equal(RESTART_CAUSE_MS, 2 * 60 * MIN)
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 6 * 60)], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  // The verifier: a chat whose mod said the word's version since came back and was archived on purpose; a chat whose card says it left the list too.
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 40)], mods: { Painter: '0.32.0' }, now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.equal(archivedAfterRestart({ archived, sent: [restart('Painter', 40)], mods: { Painter: '0.31.0' }, now: NOW, main: 'Lead', partner: 'Guide' }).length, 1)
  assert.deepEqual(archivedAfterRestart({ archived, sent: [restart('Painter', 40)], left: ['Garden - Painter'], prefix: 'Garden - ', now: NOW, main: 'Lead', partner: 'Guide' }), [])
  // The verifier (blocker): same-title archived twins (the replaced routine-run chats): the word names the file with the restart word's SESSION,
  // never the first in file order; a word with no session goes by name to the newest archived file of that name, and not at all while an
  // open chat carries the name.
  const twins = [file('Painter', { session: 'local_old', lastActivityAt: 1000 }), file('Painter', { session: 'local_real', lastActivityAt: 9000 })]
  assert.deepEqual(archivedAfterRestart({ archived: twins, sent: [restart('Painter', 7, { session: 'local_real' })], now: NOW, main: 'Lead', partner: 'Guide' }).map(one => one.session), ['local_real'])
  assert.deepEqual(archivedAfterRestart({ archived: twins, sent: [restart('Painter', 7, { session: null, text: 'restart for mod\nChat: Painter\nSession: local_real\nWhy: x' })], now: NOW, main: 'Lead', partner: 'Guide' }).map(one => one.session), ['local_real'])
  assert.deepEqual(archivedAfterRestart({ archived: twins, sent: [restart('Painter', 7, { session: null, text: 'restart for mod\nChat: Painter\nWhy: x' })], now: NOW, main: 'Lead', partner: 'Guide' }).map(one => one.session), ['local_real'])
  assert.deepEqual(archivedAfterRestart({ archived: twins.map(one => ({ ...one, hasOpenTwin: true })), sent: [restart('Painter', 7, { session: null, text: 'x' })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  // A word whose session no archived file carries (the chat is open again, or gone): nothing, whatever the names.
  assert.deepEqual(archivedAfterRestart({ archived: twins, sent: [restart('Painter', 7, { session: 'local_other' })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  // The review and the verifier: a chat archived WITH the main chat (its archive takes the chats it started): the main chat's restart word
  // carries the chats on the board when it went (`chats`), by session; one not on it does not; a restart word to another chat is no cause.
  const mason = [file('Mason')]
  const mainWord = restart('Lead', 9, { to: 'Guide', chats: [{ name: 'Mason', session: 'local_mason' }, { name: 'Painter', session: 'local_painter' }] })
  assert.deepEqual(archivedAfterRestart({ archived: mason, sent: [mainWord], now: NOW, main: 'Lead', partner: 'Guide' }).map(one => [one.to, one.chat, one.session]), [['Lead', 'Mason', 'local_mason']])
  assert.deepEqual(archivedAfterRestart({ archived: mason, sent: [restart('Lead', 9, { to: 'Guide', chats: [{ name: 'Painter', session: 'local_painter' }] })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  assert.deepEqual(archivedAfterRestart({ archived: mason, sent: [restart('Painter', 9, { chats: [{ name: 'Mason', session: 'local_mason' }] })], now: NOW, main: 'Lead', partner: 'Guide' }), [])
  // The verifier (blocker): the main chat itself archived (cut off between its archive and unarchive): named from the LIST, it still gets the
  // partner's word, and its workers theirs, to it.
  const both = archivedAfterRestart({ archived: [...mason, file('Lead')], sent: [mainWord], now: NOW, main: 'Lead', partner: 'Guide' })
  assert.deepEqual(both.map(one => [one.to, one.chat]), [['Lead', 'Mason'], ['Guide', 'Lead']])
  // The word itself: a partner word (a partner that does not run is started for it); it carries the session on the record too.
  const word = unarchiveWords({ to: 'Lead', chat: 'Painter', session: 'local_painter', why: 'still archived' })
  assert.equal(word.text, 'unarchive chat\nChat: Painter\nSession: local_painter\nWhy: still archived')
  assert.deepEqual([word.command, word.about, word.to, word.session], ['mod-unarchive', 'Painter', 'Lead', 'local_painter'])
  assert.equal(isPartnerWord('mod-unarchive'), true)
  // The restart word carries its session and, for the main chat, the chats on the board (restartWords, rolloutPlan).
  const named = restartWords({ to: 'Guide', chat: 'Lead', session: 'local_lead', runs: '0.31.0', installed: '0.32.0', why: 'x', chats: [{ name: 'Mason', session: 'local_mason' }, { name: 'Bad', session: 'no id!' }] })
  assert.deepEqual([named.session, named.chats], ['local_lead', [{ name: 'Mason', session: 'local_mason' }, { name: 'Bad', session: null }]])
  assert.equal(Object.hasOwn(restartWords({ to: 'Lead', chat: 'Painter', session: 'local_painter', runs: '0.31.0', installed: '0.32.0', why: 'x' }), 'chats'), false)
  const planned = rolloutPlan({ mods: { installed: '0.32.0', chats: { Lead: '0.31.0', Mason: '0.32.0' } }, chats: [{ name: 'Lead', role: 'main', state: 'free', isRunning: true, session: 'local_lead' }, { name: 'Mason', role: 'worker', state: 'free', isRunning: true, session: 'local_mason' }], now: NOW, main: 'Lead', partner: 'Guide' })
  assert.deepEqual(planned.words.map(one => [one.chat, one.chats]), [['Lead', [{ name: 'Mason', session: 'local_mason' }]]])
  // The project's archived chats (appChats.mjs): in the project, titled with the prefix, no launch stub, newest first, each with its session,
  // its last activity and whether a real open chat of the project carries its title (a launch stub, or a chat elsewhere, is none).
  const app = (title, more = {}) => ({ title, sessionId: `local_${title.toLowerCase().replace(/\W+/g, '')}`, cwd: 'C:\\garden', isArchived: true, isStub: false, lastActivityAt: 5000, ...more })
  const apps = [app('Garden - Painter'), app('Garden - Mason'), app('Garden - Mason', { isArchived: false, sessionId: 'local_mason2' }), app('Garden - Stub', { isStub: true }), app('Garden - Far', { cwd: 'C:\\elsewhere' }), app('Other - Painter'), app('Garden - Open', { isArchived: false }), app('Garden - Newer', { lastActivityAt: 9000 })]
  assert.deepEqual(archivedChatsOf(apps, { project: 'C:\\garden', prefix: 'Garden - ' }), [
    { name: 'Newer', session: 'local_gardennewer', lastActivityAt: 9000, hasOpenTwin: false },
    { name: 'Painter', session: 'local_gardenpainter', lastActivityAt: 5000, hasOpenTwin: false },
    { name: 'Mason', session: 'local_gardenmason', lastActivityAt: 5000, hasOpenTwin: true },
  ])
  const hidden = [app('Garden - Painter'), app('Garden - Painter', { isArchived: false, isStub: true, sessionId: 'local_stub' }), app('Garden - Painter', { isArchived: false, cwd: 'C:\\elsewhere', sessionId: 'local_far' })]
  assert.deepEqual(archivedChatsOf(hidden, { project: 'C:\\garden', prefix: 'Garden - ' }).map(one => [one.name, one.hasOpenTwin]), [['Painter', false]])
  // The board's state wires the guard with the project's archived chats, the restarters from the LIST (the main chat archived or not), what
  // each chat's mod said and the cards that left (the verifier: a pin; the real case is test/modUnarchive.state.test.mjs).
  const state = readFileSync(new URL('../src/state.mjs', import.meta.url), 'utf8')
  assert.match(state, /unarchives: rollout === null \? \[\] : archivedAfterRestart\(\{ archived: archivedChatsOf\(apps, \{ project: config\.project, prefix \}\), sent, now, main: isBridgeMissing === true \? null : list\.main \?\? null, partner: isBridgeMissing === true \? null : config\.advisor \?\? null, prefix, mods: modsLately\?\.chats \?\? null, left: apps\.filter\(chat => removedAt\.has\(chat\.cliSessionId\)\)\.map\(chat => chat\.title\) \}\)/)
})

test('the review: a restart word stays known a day, so the three tries are counted beyond the outbox\'s two hours', () => {
  const word = { id: 'r1', to: 'Lead', command: 'mod-restart', about: 'Painter', version: '0.17.0', at: NOW - 3 * 60 * MIN, state: 'taken', text: 'restart for mod' }
  const other = { ...word, id: 'e1', command: 'worker-start' }
  const known = outboxNow([word, other], NOW, null).map(one => one.id)
  assert.deepEqual(known, ['r1'])
  assert.deepEqual(outboxNow([{ ...word, at: NOW - 25 * 60 * MIN }], NOW, null), [], 'after a day it goes')
  const tried = Array.from({ length: RESTART_TRIES }, (_, n) => ({ ...word, id: `r${n}`, at: NOW - (40 + n * 60) * MIN }))
  const chats = [chat('Lead', 'main'), chat('Painter', 'helper')]
  assert.deepEqual(plan({ chats, mods: { installed: '0.17.0', chats: { Painter: '0.16.1' } }, sent: outboxNow(tried, NOW, null) }).words, [])
})
