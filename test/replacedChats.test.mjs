// B847 (the person, 2026-10-31: "why do we still have worker 1 leftovers?"): a routine opens a new chat on each run; once the
// newer chat of a worker's title has checked in, the board archives the older ones that are idle, hold no step and leave no
// unsaved work. Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ARCHIVE_MOD, QUIET_MS, archiveJobId, archivedBy, hasNothingUncommitted, replacedChats } from '../src/replacedChats.mjs'
import { handResults, isHandWord } from '../src/hands.mjs'
import { parseAppChat, boardChats } from '../src/appChats.mjs'

const MIN = 60_000
const NOW = 10_000 * MIN
const live = (over = {}) => ({
  name: 'Worker 1', isLeftover: false, appSession: 'local_live', isRunning: true, report: { state: 'idle', since: NOW - MIN, at: NOW },
  createdAt: NOW - 30 * MIN, cwd: 'C:\\proj', storeSteps: [], task: null, ...over,
})
const old = (over = {}) => ({
  name: 'Worker 1', isLeftover: true, appSession: 'local_old', isRunning: null, createdAt: NOW - 600 * MIN, lastActivityAt: NOW - 60 * MIN,
  cwd: 'C:\\proj', needsAction: null, ...over,
})
const named = lanes => replacedChats({ lanes, now: NOW }).map(one => one.session)

test('an older idle chat beside a newer one that checked in is named, with its why', () => {
  const found = replacedChats({ lanes: [live(), old()], now: NOW })
  assert.equal(found.length, 1)
  assert.deepEqual([found[0].session, found[0].chat], ['local_old', 'Worker 1'])
  assert.match(found[0].why, /newer chat of the same name \(local_live\) has checked in/)
})

test('the live chat is never named, nor a leftover with no live chat of its name', () => {
  assert.deepEqual(named([live()]), [])
  assert.deepEqual(named([old()]), [])
  assert.deepEqual(named([live({ name: 'Worker 2' }), old()]), [])
})

test('the newer chat must have checked in: running and a report of its own', () => {
  assert.deepEqual(named([live({ report: null }), old()]), [])
  assert.deepEqual(named([live({ isRunning: false }), old()]), [])
  assert.deepEqual(named([live({ isRunning: null }), old()]), [])
})

test('the older chat must have stopped before the newer was made (it cannot be the one working)', () => {
  assert.deepEqual(named([live({ createdAt: NOW - 90 * MIN }), old({ lastActivityAt: NOW - 60 * MIN })]), [])
  assert.deepEqual(named([live(), old({ lastActivityAt: null })]), [])
  assert.deepEqual(named([live({ createdAt: null }), old()]), [])
})

test('a step of the name that the live chat does not show as its task keeps the older chat open', () => {
  const step = { id: 'B9', state: 'in progress' }
  assert.deepEqual(named([live({ storeSteps: [step], task: null }), old()]), [])
  assert.deepEqual(named([live({ storeSteps: [step], task: { stepId: 'B8' } }), old()]), [])
  assert.deepEqual(named([live({ storeSteps: [{ id: 'B9', state: 'waiting on you' }] }), old()]), [])
  // the live chat's own step, and a step in review, do not hold it
  assert.deepEqual(named([live({ storeSteps: [step], task: { stepId: 'B9' } }), old()]), ['local_old'])
  assert.deepEqual(named([live({ storeSteps: [{ id: 'B9', state: 'review' }] }), old()]), ['local_old'])
})

test('a chat quiet for less than five minutes, or one the app says needs the person, is left alone', () => {
  assert.deepEqual(named([live({ createdAt: NOW - 1 }), old({ lastActivityAt: NOW - QUIET_MS + 1 })]), [])
  assert.deepEqual(named([live({ createdAt: NOW - 1 }), old({ lastActivityAt: NOW - QUIET_MS })]), ['local_old'])
  assert.deepEqual(named([live(), old({ needsAction: 'Answer the question' })]), [])
  assert.deepEqual(named([live(), old({ needsAction: '  ' })]), ['local_old'])
})

test('a chat in another folder, or with no app id, is left alone; a missing folder on one side is no difference', () => {
  assert.deepEqual(named([live(), old({ cwd: 'C:\\other' })]), [])
  assert.deepEqual(named([live(), old({ cwd: 'c:/PROJ/' })]), ['local_old'])
  assert.deepEqual(named([live(), old({ appSession: null })]), [])
  assert.deepEqual(named([live(), old({ appSession: 'cli-old' })]), [])
})

test('one word per chat, and again only after five minutes', () => {
  const given = new Map([['local_old', NOW - 4 * MIN]])
  assert.deepEqual(replacedChats({ lanes: [live(), old()], now: NOW, given }), [])
  assert.equal(replacedChats({ lanes: [live(), old()], now: NOW, given: new Map([['local_old', NOW - 5 * MIN]]) }).length, 1)
})

test('two older chats of one worker are both named; a fork of another name is not', () => {
  const lanes = [live(), old(), old({ appSession: 'local_older', lastActivityAt: NOW - 700 * MIN }), old({ name: 'Worker 1 (copy)', appSession: 'local_fork' })]
  assert.deepEqual(named(lanes), ['local_old', 'local_older'])
})

test('the job id names the app chat and reads back only its own shape', () => {
  assert.equal(archiveJobId('local_old'), 'archive:local_old')
  assert.equal(archivedBy('archive:local_old'), 'local_old')
  for (const id of ['archive:cli-1', 'resume:1:Worker 1', 'archive:', null, undefined]) assert.equal(archivedBy(id), null, String(id))
  const { sent, failed } = handResults({ results: [{ id: 'archive:local_old', ok: true }, { id: 'archive:local_x', ok: false, why: 'working' }] })
  assert.deepEqual([sent, failed], [['archive:local_old'], ['archive:local_x']])
})

test('an archive is no hand word of the outbox: it is derived from the state, never filed', () => {
  assert.equal(isHandWord({ command: 'archive', about: 'Worker 1' }, { canRestart: true, workers: new Set(['Worker 1']) }), false)
  assert.match(ARCHIVE_MOD, /^\d+\.\d+\.\d+$/)
})

test('uncommitted work: a work tree with changes, or one git cannot read, is kept; a folder that is no work tree is not', async () => {
  const git = answers => async args => (args.includes('rev-parse') ? answers.inside : answers.status)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: 'true\n', status: '' })), true)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: 'true\n', status: ' M a.mjs\n' })), false)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: 'true\n', status: '?? new.txt\n' })), false)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: 'true\n', status: null })), false)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: null, status: null })), true)
  assert.equal(await hasNothingUncommitted('C:\\proj', git({ inside: 'false\n', status: ' M a.mjs\n' })), true)
  assert.equal(await hasNothingUncommitted(null, git({ inside: 'true\n', status: '' })), false)
})

test('the app\'s list gives a leftover its folder and app id: the routine\'s older chat comes out as a leftover of the same name', () => {
  const file = (sessionId, cliSessionId, createdAt, lastActivityAt) => JSON.stringify({ title: 'Proj - Worker 1', sessionId, cliSessionId, cwd: 'C:\\proj', createdAt, lastActivityAt })
  const chats = [file('local_old', 'cli-old', 1, 5), file('local_live', 'cli-live', 10, 20)].map(parseAppChat)
  const lanes = boardChats(chats, { project: 'C:\\proj', prefix: 'Proj - ', main: 'Main' })
  const leftover = lanes.find(lane => lane.isLeftover)
  assert.deepEqual([leftover.name, leftover.appSessionId, leftover.cwd, leftover.createdAt], ['Worker 1', 'local_old', 'C:\\proj', 1])
  assert.equal(lanes.filter(lane => !lane.isLeftover)[0].appSessionId, 'local_live')
})
