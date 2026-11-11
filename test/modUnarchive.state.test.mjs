// The Workers mod release 0.32.0, chat 1's verifier (blockers 1 and 2): the board's state wires the unarchive guard with the chats the
// app lists, so a MAIN chat stuck archived (its partner cut off between archive and unarchive) gets its word, and the workers archived
// along with it theirs: the restarters are named from the list of chats, not from the open lanes. Made-up samples, through `buildState`.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const app = (name, more = {}) => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1', ...more })
const config = { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\game' }
const restart = (chat, to, minutesAgo, more = {}) => ({ id: `r-${chat}`, at: NOW - minutesAgo * MIN, deliveredAt: NOW - minutesAgo * MIN + 30_000, to, command: 'mod-restart', about: chat, session: `local_${chat}`, version: '0.32.0', state: 'delivered', text: 'restart for mod', ...more })

function build({ apps, outbox = [], modsLately = null }) {
  const raw = { listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: apps, tails: {}, planLineTexts: {}, work: storeFromText('## Work\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 5 * 60 * MIN }
  return buildState(raw, { lines: [], outbox, runs: [], now: NOW, config, seen: { shown: { Advisor: NOW - 5000, 'Worker 2': NOW - 5000 }, other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map(), mods: {}, modsLately })
}

test('a main chat stuck archived after its restart word gets the partner\'s unarchive word; the workers archived with it get the main chat\'s', () => {
  const chats = [{ name: 'Worker 1', session: 'local_Worker 1' }, { name: 'Worker 2', session: 'local_Worker 2' }]
  const apps = [app('Lead', { isArchived: true }), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  // The verifier's mutant: the main chat is archived, so no open lane is the main chat; the word came 6 min ago to the Advisor.
  const state = build({ apps, outbox: [restart('Lead', 'Advisor', 6, { chats })] })
  assert.deepEqual(state.reconciled.unarchives.map(one => [one.to, one.chat, one.session]).sort(), [['Advisor', 'Lead', 'local_Lead'], ['Lead', 'Worker 1', 'local_Worker 1']])
  // The main chat back and Worker 1 still archived: its word to the main chat.
  assert.deepEqual(build({ apps: [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')], outbox: [restart('Lead', 'Advisor', 6, { chats })] }).reconciled.unarchives.map(one => [one.to, one.chat]), [['Lead', 'Worker 1']])
  // Worker 1's mod said the installed version since (it came back; archived on purpose later): nothing.
  assert.deepEqual(build({ apps, outbox: [restart('Lead', 'Advisor', 6, { chats })], modsLately: { installed: '0.32.0', chats: { 'Worker 1': '0.32.0' } } }).reconciled.unarchives.map(one => one.chat), ['Lead'])
  // Within the grace (the word reached the Advisor a minute ago): nothing yet.
  assert.deepEqual(build({ apps, outbox: [restart('Lead', 'Advisor', 6, { chats, deliveredAt: NOW - MIN })] }).reconciled.unarchives, [])
  // No restart word: the person archived them.
  assert.deepEqual(build({ apps }).reconciled.unarchives, [])
})
