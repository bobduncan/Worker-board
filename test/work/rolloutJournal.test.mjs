// The Workers mod release 0.32.0, the rollout's guard as a journal (src/work/rolloutJournal.mjs, chat 1's decision after its
// second verifier): a restart word takes a record of every project chat open at that moment; a session still archived after the
// word reached its restarter and never seen open since gets an unarchive word, three times at most, counted on the record; a
// session leaves the record once seen open, gone, removed, or given up on; the record goes when every session left. No clock
// but the grace and the spacing. Made-up outboxes and app lists; the restarters from the list.

import assert from 'node:assert/strict'
import test from 'node:test'

import { UNARCHIVE_AFTER_MS, UNARCHIVE_AGAIN_MS } from '../../src/work/modRollout.mjs'
import { UNARCHIVE_TRIES, emptyJournal, journalNext, journalOfFile, journalText, openChatsOf, openSessionsOf } from '../../src/work/rolloutJournal.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 12, 0).getTime()
const PROJECT = 'C:\\game'
const PREFIX = 'Studio · '
const app = (name, more = {}) => ({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, isStub: false, createdAt: 1, lastActivityAt: NOW - MIN, ...more })
const restart = (chat, to, minutesAgo, more = {}) => ({ id: `r-${chat}`, at: NOW - minutesAgo * MIN, deliveredAt: NOW - minutesAgo * MIN + 30_000, to, command: 'mod-restart', about: chat, session: `local_${chat}`, version: '0.32.0', state: 'delivered', ...more })
const asked = (record, chat, minutesAgo, n = 1) => ({ id: `u-${chat}-${n}`, at: NOW - minutesAgo * MIN, to: 'Lead', command: 'mod-unarchive', about: chat, session: `local_${chat}`, record, state: 'delivered' })
const facts = (more = {}) => ({ project: PROJECT, prefix: PREFIX, now: NOW, main: 'Lead', partner: 'Advisor', ...more })
const OPEN = [app('Lead'), app('Worker 1'), app('Worker 2'), app('Advisor'), app('Elsewhere', { cwd: 'D:\\other' }), { title: 'Other - Chat', sessionId: 'local_o', cliSessionId: 'cli-o', cwd: PROJECT, isArchived: false }, app('Stub', { isStub: true })]

test('a restart word takes a record of every project chat open at that moment, by session; a lost word takes none', () => {
  assert.deepEqual(openChatsOf(OPEN, { project: PROJECT, prefix: PREFIX }).map(one => one.name), ['Lead', 'Worker 1', 'Worker 2', 'Advisor'])
  assert.deepEqual(openChatsOf(OPEN, { project: PROJECT, prefix: '' }), [])
  // The word still waiting (Main busy): the record is taken now, before any archive; nothing is due.
  const first = journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })], apps: OPEN }))
  assert.deepEqual(first.words, [])
  assert.deepEqual(first.journal.records.map(record => [record.word, record.about, record.chats.map(chat => [chat.name, chat.session, chat.state])]), [['r-Lead', 'Lead', [['Lead', 'local_Lead', 'listed'], ['Worker 1', 'local_Worker 1', 'listed'], ['Worker 2', 'local_Worker 2', 'listed'], ['Advisor', 'local_Advisor', 'listed']]]])
  // A word that failed before it reached its restarter made no archive: no record.
  assert.deepEqual(journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'failed' })], apps: OPEN })).journal.records, [])
  // The journal's file: anything else than records is left out; the text round-trips.
  assert.deepEqual(journalOfFile(JSON.parse(journalText(first.journal))), first.journal)
  assert.equal(journalOfFile({ records: 'x' }), null)
  assert.deepEqual(journalOfFile({ records: [{ word: 'r', chats: [{ session: 's' }, 'bad'] }] }), { records: [{ word: 'r', about: '', at: 0, chats: [{ name: '', session: 's', state: 'listed', asks: [], lastAskAt: null }] }] })
  assert.deepEqual(openSessionsOf(OPEN).slice(0, 2), ['local_Lead', 'local_Worker 1'])
})

test('the main chat archived with its workers (the partner cut off): after the grace, the partner is asked for the main chat and the main chat for each worker; a session seen open again leaves; the record goes when all left', () => {
  const sent = [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent, apps: OPEN })).journal
  // The word reached the Advisor 6 minutes ago; Lead and Worker 1 are archived, Worker 2 and the Advisor open.
  const reached = [restart('Lead', 'Advisor', 7)]
  const archived = [app('Lead', { isArchived: true }), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const due = journalNext(taken, facts({ sent: reached, apps: archived }))
  assert.deepEqual(due.words.map(one => [one.to, one.chat, one.session, one.record]), [['Advisor', 'Lead', 'local_Lead', 'r-Lead'], ['Lead', 'Worker 1', 'local_Worker 1', 'r-Lead']])
  assert.match(due.words[0].why, /^Lead is still archived 6 min after its restart for the mod \(asked at \d\d:\d\d\): unarchive it, archive nothing$/)
  assert.deepEqual(due.journal.records[0].chats.map(chat => [chat.name, chat.state]), [['Lead', 'archived'], ['Worker 1', 'archived'], ['Worker 2', 'open'], ['Advisor', 'open']])
  // Within the grace (reached a minute ago): nothing yet. The verifier: the grace counts from when the word REACHED, not its making.
  assert.deepEqual(journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 12, { deliveredAt: NOW - MIN })], apps: archived })).words, [])
  assert.equal(UNARCHIVE_AFTER_MS, 5 * MIN)
  // The words went (the outbox holds them with the record and the session): the tries are counted on the record, not again before the half hour.
  const sentOnce = [...reached, asked('r-Lead', 'Lead', 1), asked('r-Lead', 'Worker 1', 1)]
  const counted = journalNext(due.journal, facts({ sent: sentOnce, apps: archived }))
  assert.deepEqual(counted.words, [])
  assert.deepEqual(counted.journal.records[0].chats.slice(0, 2).map(chat => [chat.asks, chat.lastAskAt]), [[['u-Lead-1'], NOW - MIN], [['u-Worker 1-1'], NOW - MIN]])
  assert.equal(journalNext(counted.journal, facts({ sent: sentOnce, apps: archived, now: NOW + UNARCHIVE_AGAIN_MS })).words.length, 2)
  // The outbox forgot the words (a day passed, or the board's outbox was cut): the record still knows the tries.
  assert.deepEqual(journalNext(counted.journal, facts({ sent: reached, apps: archived, now: NOW + 10 * MIN })).words, [])
  assert.equal(journalNext(counted.journal, facts({ sent: reached, apps: archived, now: NOW + UNARCHIVE_AGAIN_MS })).words.length, 2)
  // Lead comes back (the partner acted on its word): Lead leaves the record; Worker 1 is still asked for, now to Lead.
  const leadBack = [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const half = journalNext(counted.journal, facts({ sent: sentOnce, apps: leadBack, now: NOW + UNARCHIVE_AGAIN_MS }))
  assert.deepEqual(half.words.map(one => [one.to, one.chat]), [['Lead', 'Worker 1']])
  assert.deepEqual(half.journal.records[0].chats.map(chat => chat.state), ['open', 'archived', 'open', 'open'])
  // Everyone back: the record goes.
  assert.deepEqual(journalNext(half.journal, facts({ sent: sentOnce, apps: OPEN, now: NOW + UNARCHIVE_AGAIN_MS })).journal.records, [])
  // The restarters from the LIST: with the main chat archived, the list still names it (no open lane needed); without a partner, the main chat's own word has nobody.
  assert.deepEqual(journalNext(taken, facts({ sent: reached, apps: archived, partner: null })).words.map(one => one.chat), ['Worker 1'])
  assert.deepEqual(journalNext(taken, facts({ sent: reached, apps: archived, main: null, partner: null })).words, [])
})

test('a session leaves the record when its file is gone, when the board or the person removed it, or when its tries are spent; three tries at most, counted on the record (no clock)', () => {
  const sent = [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent, apps: OPEN })).journal
  const reached = [restart('Lead', 'Advisor', 40)]
  // Worker 1 removed by the board after the word reached (its remove word); Worker 2's file gone; the Advisor's card says it left.
  const apps = [app('Lead'), app('Worker 1', { isArchived: true }), app('Advisor', { isArchived: true })]
  const remove = { id: 'rm', at: NOW - 20 * MIN, to: 'Lead', command: 'remove', about: 'Worker 1', state: 'delivered' }
  const next = journalNext(taken, facts({ sent: [...reached, remove], apps, left: [`${PREFIX}Advisor`] }))
  assert.deepEqual(next.words, [])
  assert.deepEqual(next.journal.records, [], 'everyone left: the record goes')
  // A remove word from BEFORE the restart reached is no removal of this archive.
  const early = { ...remove, at: NOW - 50 * MIN }
  assert.deepEqual(journalNext(taken, facts({ sent: [...reached, early], apps: [app('Lead'), app('Worker 1', { isArchived: true })] })).words.map(one => one.chat), ['Worker 1'])
  // Three tries, spaced by the half hour, then given up (the person archived it on purpose): the record goes; no fourth word, however much time passes.
  assert.equal(UNARCHIVE_TRIES, 3)
  let journal = taken
  const archived = [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const asks = []
  for (let n = 1; n <= 3; n++) {
    const at = NOW + (n - 1) * UNARCHIVE_AGAIN_MS
    const due = journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: at }))
    assert.equal(due.words.length, 1, `try ${n}`)
    asks.push({ ...asked('r-Lead', 'Worker 1', 0, n), at })
    journal = journalNext(due.journal, facts({ sent: [...reached, ...asks], apps: archived, now: at + MIN })).journal
  }
  assert.equal(journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: NOW + 3 * UNARCHIVE_AGAIN_MS })).words.length, 0)
  assert.deepEqual(journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: NOW + 3 * UNARCHIVE_AGAIN_MS })).journal.records, [], 'given up: the record goes')
  assert.equal(journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: NOW + 30 * 24 * 60 * MIN })).words.length, 0)
  // The verifier's case: the board was off for 37 hours after a cut-off restart: the record waited, and asks when the board is back.
  assert.equal(journalNext(taken, facts({ sent: reached, apps: archived, now: NOW + 37 * 60 * MIN })).words.length, 1)
})

test('the outbox\'s sweep: a waiting unarchive word whose chat is open again is dropped (by its session; by its name for a word without one)', () => {
  const ctx = { all: [], items: null, now: NOW, keep: () => true, openSessions: new Set(['local_Worker 1']), onBoard: new Set(['Worker 2']) }
  const word = (about, session) => ({ id: 'u', command: 'mod-unarchive', to: 'Lead', about, session, state: 'waiting', at: NOW - MIN, ask: null })
  assert.deepEqual(whyClosed(word('Worker 1', 'local_Worker 1'), ctx), { state: 'dropped', why: 'its chat is open again' })
  assert.equal(whyClosed(word('Worker 1', 'local_other'), ctx), null)
  assert.deepEqual(whyClosed(word('Worker 2', undefined), ctx), { state: 'dropped', why: 'its chat is open again' })
  assert.equal(whyClosed(word('Worker 3', undefined), ctx), null)
})
