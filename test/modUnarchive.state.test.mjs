// The Workers mod release 0.32.0, the rollout's guard as a journal through the board's state (src/work/rolloutJournal.mjs,
// state.mjs): a restart word takes a record of the project's open chats; a MAIN chat stuck archived (its partner cut off between
// archive and unarchive) gets its word, and the workers archived along with it theirs, the restarters named from the LIST of chats,
// not from the open lanes; the journal comes back out of the state for the server to write. Made-up samples, through `buildState`.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { emptyJournal } from '../src/work/rolloutJournal.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const app = (name, more = {}) => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 2 * MIN, lastAssistantUuid: 'u-1', ...more })
const config = { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\game' }
const restart = (chat, to, minutesAgo, more = {}) => ({ id: `r-${chat}`, at: NOW - minutesAgo * MIN, deliveredAt: NOW - minutesAgo * MIN + 30_000, to, command: 'mod-restart', about: chat, session: `local_${chat}`, version: '0.32.0', state: 'delivered', text: 'restart for mod', ...more })

function build({ apps, outbox = [], journal = emptyJournal(), now = NOW }) {
  const raw = { listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: apps, tails: {}, planLineTexts: {}, work: storeFromText('## Work\n', { now: NOW - 60 * MIN }), adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: NOW - 5 * 60 * MIN }
  return buildState(raw, { lines: [], outbox, runs: [], now, config, seen: { shown: { Advisor: now - 5000, 'Worker 2': now - 5000 }, other: {} }, board: { startedAt: NOW - 30 * MIN, offSince: null }, reports: new Map(), mods: {}, modsLately: null, rolloutJournal: journal })
}

test('a main chat stuck archived after its restart word gets the partner\'s unarchive word; the workers archived with it get the main chat\'s; the journal comes back out of the state', () => {
  // The word is still waiting (Main busy): the state takes the record of every open chat; nothing is due.
  const open = [app('Lead'), app('Worker 1'), app('Worker 2'), app('Advisor')]
  const taken = build({ apps: open, outbox: [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })] })
  assert.deepEqual(taken.reconciled.unarchives, [])
  assert.deepEqual(taken.rolloutJournal.records.map(record => [record.word, record.chats.map(chat => chat.name)]), [['r-Lead', ['Lead', 'Worker 1', 'Worker 2', 'Advisor']]])
  assert.deepEqual(taken.openSessions, ['local_Lead', 'local_Worker 1', 'local_Worker 2', 'local_Advisor'])
  // The verifier's mutant: the main chat is archived (no open lane is the main chat), Worker 1 with it; the word reached the Advisor 6 min ago.
  const apps = [app('Lead', { isArchived: true }), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const due = build({ apps, outbox: [restart('Lead', 'Advisor', 7)], journal: taken.rolloutJournal })
  assert.deepEqual(due.reconciled.unarchives.map(one => [one.to, one.chat, one.session, one.record]), [['Advisor', 'Lead', 'local_Lead', 'r-Lead'], ['Lead', 'Worker 1', 'local_Worker 1', 'r-Lead']])
  assert.deepEqual(due.rolloutJournal.records[0].chats.map(chat => chat.state), ['archived', 'archived', 'open', 'open'])
  assert.deepEqual(due.openSessions, ['local_Worker 2', 'local_Advisor'])
  // Within the grace (the word reached the Advisor a minute ago): nothing yet.
  assert.deepEqual(build({ apps, outbox: [restart('Lead', 'Advisor', 7, { deliveredAt: NOW - MIN })], journal: taken.rolloutJournal }).reconciled.unarchives, [])
  // No restart word: the person archived them; no record, no word.
  assert.deepEqual(build({ apps }).reconciled.unarchives, [])
  assert.deepEqual(build({ apps }).rolloutJournal.records, [])
})
