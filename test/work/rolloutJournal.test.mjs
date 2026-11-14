// The Workers mod release 0.32.0, the rollout's guard as a journal (src/work/rolloutJournal.mjs, chat 1's decision after its
// second verifier; its verifier of the journal, 2026-11-14: a state machine per session): a restart word takes a record of every
// project chat open at that moment, kept current while the word waits; a session seen archived after the word reached and never
// seen open since gets an unarchive word, three times in all across records, counted on the records; a session leaves the
// record once seen open after an archive (or once the restarter's turn ended without archiving it), gone, removed, or given up
// on; the record goes when every session left. No clock but the grace and the spacing. Made-up outboxes and app lists; the
// restarters from the list.

import assert from 'node:assert/strict'
import test from 'node:test'

import { UNARCHIVE_AFTER_MS, UNARCHIVE_AGAIN_MS } from '../../src/work/modRollout.mjs'
import { MISSING_LOOKS, UNARCHIVE_TRIES, emptyJournal, journalNext, journalOfFile, journalText, openChatsOf, openSessionsOf } from '../../src/work/rolloutJournal.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 13, 12, 0).getTime()
const PROJECT = 'C:\\game'
const PREFIX = 'Studio · '
const app = (name, more = {}) => ({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, isStub: false, createdAt: 1, lastActivityAt: NOW - MIN, ...more })
const restart = (chat, to, minutesAgo, more = {}) => ({ id: `r-${chat}`, at: NOW - minutesAgo * MIN, deliveredAt: NOW - minutesAgo * MIN + 30_000, to, command: 'mod-restart', about: chat, session: `local_${chat}`, version: '0.32.0', state: 'delivered', ...more })
const asked = (record, chat, minutesAgo, n = 1, more = {}) => ({ id: `u-${chat}-${n}`, at: NOW - minutesAgo * MIN, to: 'Lead', command: 'mod-unarchive', about: chat, session: `local_${chat}`, record, state: 'delivered', ...more })
const facts = (more = {}) => ({ project: PROJECT, prefix: PREFIX, now: NOW, main: 'Lead', partner: 'Advisor', ...more })
/** The restarter's report: its turn ended (idle since `sinceMinutesAgo`), or busy. */
const idleSince = (name, sinceMinutesAgo) => who => (who === name ? { state: 'idle', since: NOW - sinceMinutesAgo * MIN } : null)
const busy = name => who => (who === name ? { state: 'busy', since: NOW - 10 * MIN } : null)
const OPEN = [app('Lead'), app('Worker 1'), app('Worker 2'), app('Advisor'), app('Elsewhere', { cwd: 'D:\\other' }), { title: 'Other - Chat', sessionId: 'local_o', cliSessionId: 'cli-o', cwd: PROJECT, isArchived: false }, app('Stub', { isStub: true })]
const ARCHIVED = [app('Lead', { isArchived: true }), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
const states = journal => journal.records[0]?.chats.map(chat => [chat.name, chat.state]) ?? []

test('a restart word takes a record of every project chat open at that moment, by session, with its restarter; a lost word takes none; the file round-trips', () => {
  assert.deepEqual(openChatsOf(OPEN, { project: PROJECT, prefix: PREFIX }).map(one => one.name), ['Lead', 'Worker 1', 'Worker 2', 'Advisor'])
  assert.deepEqual(openChatsOf(OPEN, { project: PROJECT, prefix: '' }), [])
  // The word still waiting (Main busy): the record is taken now, before any archive; nothing is due.
  const first = journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })], apps: OPEN }))
  assert.deepEqual(first.words, [])
  assert.deepEqual(first.journal.records.map(record => [record.word, record.about, record.to, record.reachedAt, record.chats.map(chat => [chat.name, chat.session, chat.state])]),
    [['r-Lead', 'Lead', 'Advisor', null, [['Lead', 'local_Lead', 'listed'], ['Worker 1', 'local_Worker 1', 'listed'], ['Worker 2', 'local_Worker 2', 'listed'], ['Advisor', 'local_Advisor', 'listed']]]])
  // A word that failed before it reached its restarter made no archive: no record.
  assert.deepEqual(journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'failed' })], apps: OPEN })).journal.records, [])
  // The journal's file: anything else than records is left out; the text round-trips; an older file's asks (ids alone) count as reached.
  assert.deepEqual(journalOfFile(JSON.parse(journalText(first.journal))), first.journal)
  assert.equal(journalOfFile({ records: 'x' }), null)
  assert.deepEqual(journalOfFile({ records: [{ word: 'r', chats: [{ session: 's', asks: ['u-1', { id: 'u-2', at: 5, reached: false }] }, 'bad'] }] }),
    { records: [{ word: 'r', about: '', to: null, at: 0, reachedAt: null, chats: [{ name: '', session: 's', state: 'listed', asks: [{ id: 'u-1', at: 0, reached: true }, { id: 'u-2', at: 5, reached: false }], missing: 0 }] }] })
  assert.deepEqual(openSessionsOf(OPEN).slice(0, 2), ['local_Lead', 'local_Worker 1'])
})

test('the verifier\'s blocker: a session is back only once seen archived and then open; a look between the word\'s reach and the archive drops nothing', () => {
  const taken = journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })], apps: OPEN })).journal
  // The word reached the Advisor 30 s ago; nothing is archived yet (the Advisor is still looking the tools up): every session stays listed.
  const mid = journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 1)], apps: OPEN, reportOf: busy('Advisor') }))
  assert.deepEqual(mid.words, [])
  assert.deepEqual(states(mid.journal), [['Lead', 'listed'], ['Worker 1', 'listed'], ['Worker 2', 'listed'], ['Advisor', 'listed']])
  assert.equal(mid.journal.records[0].reachedAt, NOW - MIN + 30_000, 'the reach is kept on the record')
  // Then the Advisor archives Lead (Worker 1 along), and its process ends: six minutes after the reach the words go.
  const later = NOW + 6 * MIN
  const due = journalNext(mid.journal, facts({ sent: [restart('Lead', 'Advisor', 1)], apps: ARCHIVED, now: later, reportOf: busy('Advisor') }))
  assert.deepEqual(due.words.map(one => [one.to, one.chat]), [['Advisor', 'Lead'], ['Lead', 'Worker 1']])
  assert.deepEqual(states(due.journal), [['Lead', 'archived'], ['Worker 1', 'archived'], ['Worker 2', 'listed'], ['Advisor', 'listed']])
  // A session open and never seen archived leaves once the restarter's turn that carried the word has ended (its report after the reach says idle).
  const ended = journalNext(due.journal, facts({ sent: [restart('Lead', 'Advisor', 1)], apps: ARCHIVED, now: later, reportOf: idleSince('Advisor', -3) }))
  assert.deepEqual(states(ended.journal), [['Lead', 'archived'], ['Worker 1', 'archived'], ['Worker 2', 'open'], ['Advisor', 'open']])
  // An idle report from BEFORE the reach is no end of that turn.
  assert.deepEqual(states(journalNext(due.journal, facts({ sent: [restart('Lead', 'Advisor', 1)], apps: ARCHIVED, now: later, reportOf: idleSince('Advisor', 20) })).journal).slice(2), [['Worker 2', 'listed'], ['Advisor', 'listed']])
  // The restart went through (every session open after the turn ended): the record goes.
  assert.deepEqual(journalNext(mid.journal, facts({ sent: [restart('Lead', 'Advisor', 1)], apps: OPEN, now: later, reportOf: idleSince('Advisor', -3) })).journal.records, [])
})

test('the main chat archived with its workers (the partner cut off): after the grace, the partner is asked for the main chat and the main chat for each worker; a session seen open again leaves; the record goes when all left', () => {
  const sent = [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent, apps: OPEN })).journal
  // The word reached the Advisor 6 minutes ago; Lead and Worker 1 are archived, Worker 2 and the Advisor open.
  const reached = [restart('Lead', 'Advisor', 7)]
  const due = journalNext(taken, facts({ sent: reached, apps: ARCHIVED }))
  assert.deepEqual(due.words.map(one => [one.to, one.chat, one.session, one.record]), [['Advisor', 'Lead', 'local_Lead', 'r-Lead'], ['Lead', 'Worker 1', 'local_Worker 1', 'r-Lead']])
  assert.match(due.words[0].why, /^Lead is still archived 6 min after its restart for the mod \(asked at \d\d:\d\d\): unarchive it, archive nothing$/)
  assert.deepEqual(states(due.journal), [['Lead', 'archived'], ['Worker 1', 'archived'], ['Worker 2', 'listed'], ['Advisor', 'listed']])
  // Within the grace (reached a minute ago): nothing yet. The verifier: the grace counts from when the word REACHED, not its making.
  assert.deepEqual(journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 12, { deliveredAt: NOW - MIN })], apps: ARCHIVED })).words, [])
  assert.equal(UNARCHIVE_AFTER_MS, 5 * MIN)
  // The words went (the outbox holds them with the record and the session): the tries are counted on the record, not again before the half hour.
  const sentOnce = [...reached, asked('r-Lead', 'Lead', 1), asked('r-Lead', 'Worker 1', 1)]
  const counted = journalNext(due.journal, facts({ sent: sentOnce, apps: ARCHIVED }))
  assert.deepEqual(counted.words, [])
  assert.deepEqual(counted.journal.records[0].chats.slice(0, 2).map(chat => chat.asks), [[{ id: 'u-Lead-1', at: NOW - MIN, reached: true }], [{ id: 'u-Worker 1-1', at: NOW - MIN, reached: true }]])
  assert.equal(journalNext(counted.journal, facts({ sent: sentOnce, apps: ARCHIVED, now: NOW + UNARCHIVE_AGAIN_MS })).words.length, 2)
  // The outbox forgot the words (a day passed, or the board's outbox was cut): the record still knows the tries.
  assert.deepEqual(journalNext(counted.journal, facts({ sent: reached, apps: ARCHIVED, now: NOW + 10 * MIN })).words, [])
  assert.equal(journalNext(counted.journal, facts({ sent: reached, apps: ARCHIVED, now: NOW + UNARCHIVE_AGAIN_MS })).words.length, 2)
  // Lead comes back (the partner acted on its word): Lead leaves the record; Worker 1 is still asked for, now to Lead.
  const leadBack = [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const half = journalNext(counted.journal, facts({ sent: sentOnce, apps: leadBack, now: NOW + UNARCHIVE_AGAIN_MS }))
  assert.deepEqual(half.words.map(one => [one.to, one.chat]), [['Lead', 'Worker 1']])
  assert.deepEqual(half.journal.records[0].chats.map(chat => chat.state), ['open', 'archived', 'listed', 'listed'])
  // Everyone back, the Advisor's turn long ended: the record goes.
  assert.deepEqual(journalNext(half.journal, facts({ sent: sentOnce, apps: OPEN, now: NOW + UNARCHIVE_AGAIN_MS, reportOf: idleSince('Advisor', 1) })).journal.records, [])
  // The restarters from the LIST: with the main chat archived, the list still names it (no open lane needed); without a partner, the main chat's own word has nobody.
  assert.deepEqual(journalNext(taken, facts({ sent: reached, apps: ARCHIVED, partner: null })).words.map(one => one.chat), ['Worker 1'])
  assert.deepEqual(journalNext(taken, facts({ sent: reached, apps: ARCHIVED, main: null, partner: null })).words, [])
})

test('while the word waits the record is kept current: a session archived meanwhile leaves it, one opened meanwhile joins; a removal counts from the word\'s making', () => {
  const waiting = [restart('Lead', 'Advisor', 40, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent: waiting, apps: OPEN })).journal
  // The person removed Worker 1 while the word waited (its remove word, its session archived), and opened Worker 3.
  const meanwhile = [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor'), app('Worker 3')]
  const kept = journalNext(taken, facts({ sent: waiting, apps: meanwhile }))
  assert.deepEqual(states(kept.journal), [['Lead', 'listed'], ['Worker 2', 'listed'], ['Advisor', 'listed'], ['Worker 3', 'listed']])
  // The verifier's case (2): the word reaches 6 min ago, Worker 1 is archived with a remove word from before the reach but after the making: no word for it.
  const remove = { id: 'rm', at: NOW - 20 * MIN, to: 'Lead', command: 'remove', about: 'Worker 1', state: 'delivered' }
  const reached = journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 40, { deliveredAt: NOW - 6 * MIN }), remove], apps: [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')] }))
  assert.deepEqual(reached.words, [])
  assert.deepEqual(states(reached.journal).find(([name]) => name === 'Worker 1'), ['Worker 1', 'removed'])
  // A remove word from BEFORE the word was made is no removal of this archive.
  const early = { ...remove, at: NOW - 50 * MIN }
  assert.deepEqual(journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 40, { deliveredAt: NOW - 6 * MIN }), early], apps: [app('Lead'), app('Worker 1', { isArchived: true })] })).words.map(one => one.chat), ['Worker 1'])
})

test('a session leaves the record when its file is gone (two looks, or missing from the folder), when the board or the person removed it, or when its tries are spent; three tries in all, counted on the records (no clock)', () => {
  const sent = [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent, apps: OPEN })).journal
  const reached = [restart('Lead', 'Advisor', 40)]
  // Worker 1 removed by the board after the word was made (its remove word); Worker 2's file missing from the folder; the Advisor's card says it left.
  const apps = [app('Lead'), app('Worker 1', { isArchived: true }), app('Advisor', { isArchived: true })]
  const remove = { id: 'rm', at: NOW - 20 * MIN, to: 'Lead', command: 'remove', about: 'Worker 1', state: 'delivered' }
  const files = ['local_Lead', 'local_Worker 1', 'local_Advisor']
  const next = journalNext(taken, facts({ sent: [...reached, remove], apps, appFiles: files, left: [`${PREFIX}Advisor`], reportOf: idleSince('Advisor', 30) }))
  assert.deepEqual(next.words, [])
  assert.deepEqual(next.journal.records, [], 'everyone left: the record goes')
  // The verifier (5): a file listed in the folder but unreadable this look is no verdict: kept, asked at the next look that has it; gone only on the second look.
  assert.equal(MISSING_LOOKS, 2)
  const torn = journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 7)], apps: [app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')], appFiles: ['local_Lead', 'local_Worker 1', 'local_Worker 2', 'local_Advisor'] }))
  assert.deepEqual(torn.words.map(one => one.chat), ['Worker 1'])
  assert.deepEqual(torn.journal.records[0].chats[0], { name: 'Lead', session: 'local_Lead', state: 'listed', asks: [], missing: 1 })
  const whole = journalNext(torn.journal, facts({ sent: [restart('Lead', 'Advisor', 8), asked('r-Lead', 'Worker 1', 1)], apps: ARCHIVED, appFiles: ['local_Lead', 'local_Worker 1', 'local_Worker 2', 'local_Advisor'] }))
  assert.deepEqual(whole.words.map(one => one.chat), ['Lead'])
  assert.equal(whole.journal.records[0].chats[0].missing, 0)
  assert.equal(journalNext(torn.journal, facts({ sent: [restart('Lead', 'Advisor', 8)], apps: [app('Worker 1', { isArchived: true })], appFiles: ['local_Lead', 'local_Worker 1'] })).journal.records[0].chats[0].state, 'gone', 'the second look')
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
  assert.deepEqual(journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: NOW + 3 * UNARCHIVE_AGAIN_MS, reportOf: idleSince('Advisor', 1) })).journal.records, [], 'given up: the record goes')
  assert.equal(journalNext(journal, facts({ sent: [...reached, ...asks], apps: archived, now: NOW + 30 * 24 * 60 * MIN })).words.length, 0)
  // The verifier's case: the board was off for 37 hours after a cut-off restart: the record waited, and asks when the board is back.
  assert.equal(journalNext(taken, facts({ sent: reached, apps: archived, now: NOW + 37 * 60 * MIN })).words.length, 1)
})

test('no clock (the verifier, 4): a record that reached judges from itself once the outbox forgot its word; a try counts only once its word reached, and no new word goes while one waits', () => {
  const taken = journalNext(emptyJournal(), facts({ sent: [restart('Lead', 'Advisor', 1, { state: 'waiting', deliveredAt: undefined })], apps: OPEN })).journal
  const archived = [app('Lead'), app('Worker 1', { isArchived: true }), app('Worker 2'), app('Advisor')]
  const reached = journalNext(taken, facts({ sent: [restart('Lead', 'Advisor', 2)], apps: archived })).journal
  // 37 hours later the outbox has forgotten the restart word (and no ask ever went: the board was off): the record still asks.
  const later = journalNext(reached, facts({ sent: [], apps: archived, now: NOW + 37 * 60 * MIN }))
  assert.deepEqual(later.words.map(one => one.chat), ['Worker 1'])
  // A record whose word the outbox forgot BEFORE it reached goes (it never archived anything).
  assert.deepEqual(journalNext(taken, facts({ sent: [], apps: archived })).journal.records, [])
  // Three asks that all still wait (none reached the restarter), 100 min after the reach: no fourth word, not given up, still archived.
  const after = NOW + 100 * MIN
  const waitingAsks = [10, 40, 70].map((minutes, i) => ({ ...asked('r-Lead', 'Worker 1', 0, i + 1, { state: 'waiting' }), at: NOW + minutes * MIN }))
  const held = journalNext(reached, facts({ sent: [restart('Lead', 'Advisor', 2), ...waitingAsks], apps: archived, now: after }))
  assert.deepEqual(held.words, [])
  assert.deepEqual(states(held.journal).find(([name]) => name === 'Worker 1'), ['Worker 1', 'archived'])
  // One ask waiting (the restarter busy): no new word while it waits, whatever the spacing says.
  const oneWaiting = journalNext(reached, facts({ sent: [restart('Lead', 'Advisor', 2), { ...asked('r-Lead', 'Worker 1', 0, 1, { state: 'waiting' }), at: NOW + 10 * MIN }], apps: archived, now: after }))
  assert.deepEqual(oneWaiting.words, [])
  // Once it reached, the spacing counts from that ask: 90 minutes on, the next goes.
  const reachedAsk = journalNext(reached, facts({ sent: [restart('Lead', 'Advisor', 2), { ...asked('r-Lead', 'Worker 1', 0, 1), at: NOW + 10 * MIN }], apps: archived, now: after }))
  assert.deepEqual(reachedAsk.words.map(one => one.chat), ['Worker 1'])
  // The same ask 20 minutes ago: too soon.
  assert.deepEqual(journalNext(reached, facts({ sent: [restart('Lead', 'Advisor', 2), { ...asked('r-Lead', 'Worker 1', 0, 1), at: after - 20 * MIN }], apps: archived, now: after })).words, [])
})

test('tries per session across records (the verifier, 3): a chat two restarts archived is asked three times in all, not per record', () => {
  // Two restart words (for the Supervisor and the Product owner, say) took records that both list Worker 1; Worker 1 is archived in both.
  const words = [restart('Supervisor', 'Lead', 1, { state: 'waiting', deliveredAt: undefined }), restart('Owner', 'Lead', 1, { state: 'waiting', deliveredAt: undefined })]
  const taken = journalNext(emptyJournal(), facts({ sent: words, apps: [app('Lead'), app('Worker 1'), app('Advisor')] })).journal
  assert.equal(taken.records.length, 2)
  const archived = [app('Lead'), app('Worker 1', { isArchived: true }), app('Advisor')]
  const reached = [restart('Supervisor', 'Lead', 100), restart('Owner', 'Lead', 100)]
  // The first record's three asks went, the last 31 minutes ago; the second record made none: no word (three in all were asked).
  const asks = [asked('r-Supervisor', 'Worker 1', 91, 1), asked('r-Supervisor', 'Worker 1', 61, 2), asked('r-Supervisor', 'Worker 1', 31, 3)]
  const spent = journalNext(taken, facts({ sent: [...reached, ...asks], apps: archived }))
  assert.deepEqual(spent.words, [])
  assert.deepEqual(spent.journal.records.map(record => record.chats.find(chat => chat.name === 'Worker 1').state), ['given up', 'given up'])
  // Two asks across the two records: the third goes once, from one record only.
  const two = [asked('r-Supervisor', 'Worker 1', 61, 1), asked('r-Owner', 'Worker 1', 31, 2)]
  const third = journalNext(taken, facts({ sent: [...reached, ...two], apps: archived }))
  assert.deepEqual(third.words.map(one => [one.chat, one.record]), [['Worker 1', 'r-Supervisor']])
})

test('the outbox\'s sweep: a waiting unarchive word whose chat is open again is dropped (by its session; by its name for a word without one)', () => {
  const ctx = { all: [], items: null, now: NOW, keep: () => true, openSessions: new Set(['local_Worker 1']), onBoard: new Set(['Worker 2']) }
  const word = (about, session) => ({ id: 'u', command: 'mod-unarchive', to: 'Lead', about, session, state: 'waiting', at: NOW - MIN, ask: null })
  assert.deepEqual(whyClosed(word('Worker 1', 'local_Worker 1'), ctx), { state: 'dropped', why: 'its chat is open again' })
  assert.equal(whyClosed(word('Worker 1', 'local_other'), ctx), null)
  assert.deepEqual(whyClosed(word('Worker 2', undefined), ctx), { state: 'dropped', why: 'its chat is open again' })
  assert.equal(whyClosed(word('Worker 3', undefined), ctx), null)
})
