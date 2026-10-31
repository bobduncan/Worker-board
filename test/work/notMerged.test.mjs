// 2026-10-31 (B799): Worker 1 built B799 on a branch of another step's name (commits that name B799, not merged), the
// step's Branch named a branch that never existed, and the board's check looked for the files on main and failed for the
// person ("work outside git ... not there"). When the work sits on a branch that is not merged, the step goes back to
// its worker with the words "merge it, then report again": a quiet line on the page, no Check again button. Made-up
// repository, branches and chats; git is a stand-in that answers from a table.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { workApi } from '../../src/work/api.mjs'
import { findUnmerged, notMergedWords, reportCheck } from '../../src/work/check.mjs'
import { parseItem, serializeItem } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { buildState } from '../withStore.mjs'

const SAID = 'Context: The list of pages was hard to read. Change: The page list has a mockup now. Details: src/pages/list.mjs and pages/list-mock.html.'
const DIR = '/projects/board'
const repos = [{ dir: DIR, base: 'main' }]
const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const key = rest => `${DIR} ${rest}`
const heads = 'for-each-ref --format=%(refname:short) refs/heads'
const unmergedList = 'for-each-ref --no-merged main --format=%(refname:short) refs/heads'
const grep = (id, branch) => `log --no-merges --fixed-strings --grep=${id} --format=%x1e%B main..${branch}`
const added = branch => `diff --name-only --diff-filter=A main...${branch}`
/** The live shape: b775-mock-details holds two commits naming B799, the step's own branch never existed, an old branch names B790. */
const world = {
  [key(heads)]: 'main\nb775-mock-details\nb790-old\n',
  [key('for-each-ref --format=%(refname:short) refs/remotes')]: 'origin/main\n',
  [key('log -g --all --format=%gs')]: 'checkout: moving from main to b775-mock-details\n',
  [key(unmergedList)]: 'b790-old\nb775-mock-details\n',
  [key(grep('B799', 'b790-old'))]: '\x1eB790: another step\n',
  [key(grep('B799', 'b775-mock-details'))]: '\x1eB799: page list mockup\n\x1eB799 and B7990 more\n',
  [key('rev-list --count main..b775-mock-details')]: '2\n',
  [key('rev-list --count main..b790-old')]: '1\n',
  [key('worktree list --porcelain')]: 'worktree /projects/board\nHEAD aaa\nbranch refs/heads/main\n',
}
const outside = (extra = {}) => ({
  id: 'B799', branch: 'b799-page-list-mockup', merged: '', result: SAID, repos, run: git(world), project: '/projects', exists: async () => false, ...extra,
})
const WORDS = 'not merged: Your work for B799 is on branch b775-mock-details (2 commits) but not on main: merge it into main, then report again.'

test('the live shape: the step\'s Branch is missing, the commits naming B799 sit on another branch: not merged, back to the worker', async () => {
  const done = await reportCheck(outside())
  assert.deepEqual(done, { passed: false, notMerged: { branch: 'b775-mock-details', commits: 2, base: 'main', repo: 'board' }, lines: [WORDS] })
  assert.equal(notMergedWords('B799', done.notMerged), WORDS)
  assert.equal(notMergedWords('B1', { branch: 'b1-x', commits: 1, base: 'main' }), 'not merged: Your work for B1 is on branch b1-x (1 commit) but not on main: merge it into main, then report again.')
})

test('the step\'s own branch is looked at first; a branch that adds the files the result names holds the work when no commit names the id', async () => {
  const own = { ...world, [key(heads)]: 'main\nb799-own\nb775-mock-details\n', [key(unmergedList)]: 'b775-mock-details\nb799-own\n', [key('rev-list --count main..b799-own')]: '3\n' }
  assert.deepEqual((await reportCheck(outside({ branch: 'b799-own', run: git(own) }))).notMerged, { branch: 'b799-own', commits: 3, base: 'main', repo: 'board' })
  const byFile = { ...world, [key(grep('B799', 'b775-mock-details'))]: '\x1eMock-up of the pages\n', [key(added('b775-mock-details'))]: 'src/pages/list.mjs\nREADME.md\n' }
  assert.deepEqual((await reportCheck(outside({ run: git(byFile) }))).notMerged, { branch: 'b775-mock-details', commits: 2, base: 'main', repo: 'board' })
  // The id inside another id (B7990) or no file named is no proof.
  const other = { ...byFile, [key(added('b775-mock-details'))]: 'README.md\n' }
  assert.equal((await reportCheck(outside({ run: git(other) }))).notMerged, undefined)
})

test('no branch anywhere holds the work: the check fails as before, work outside git, not there', async () => {
  const none = { ...world, [key(grep('B799', 'b775-mock-details'))]: '\x1eB775: its own work\n', [key(unmergedList)]: 'b775-mock-details\n' }
  const done = await reportCheck(outside({ run: git(none) }))
  assert.equal(done.passed, false)
  assert.equal(done.notMerged, undefined)
  // T8: a file not there goes back to the worker ("back: "), as any mismatch it can fix.
  assert.deepEqual(done.lines.slice(0, 2), ['work outside git', 'back: not there: src/pages/list.mjs, pages/list-mock.html'])
  assert.equal(await findUnmerged(outside({ run: git(none) })), null)
  // Git that answers none: today's failure.
  assert.equal((await reportCheck(outside({ run: async () => null }))).notMerged, undefined)
})

test('a pass, and a step with a merged commit a repository holds, are left as they are', async () => {
  const there = await reportCheck(outside({ exists: async () => true }))
  assert.equal(there.passed, true)
  const merged = { ...world, [key('rev-parse --verify --quiet c0ffee1^{commit}')]: 'c0ffee1c0ffee1\n', [key('rev-parse main')]: 'bbb\n', [key('rev-parse origin/main')]: 'bbb\n' }
  const done = await reportCheck(outside({ merged: 'c0ffee1', branch: 'b799-page-list-mockup', run: git(merged) }))
  assert.equal(done.notMerged, undefined)
})

test('the step\'s own branch is there and already merged (only not deleted): no other branch is searched', async () => {
  const mergedOwn = { ...world, [key(heads)]: 'main\nb799-own\nb775-mock-details\n' }
  assert.equal(await findUnmerged(outside({ branch: 'b799-own', run: git(mergedOwn) })), null)
})

// What the board does with the line: the lane flag, the word to the worker, the wait line, `work next`.
const MIN = 60_000
const NOW = new Date(2026, 9, 31, 1, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const stepItem = history => parseItem(`Id: B799\nKind: step\nTitle: Page list mockup\nState: review\nOwner: Digger\nSince: ${stamp(ago(60))}\n\n## History\n${history.join('\n')}\n`)
const notMerged = (...after) => stepItem([line(40, 'Digger', 'in progress → review'), line(40, 'server', 'check pending'), line(39, 'server', `check failed: ${WORDS}`), ...after])
const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: ago(2), lastAssistantUuid: 'u-1' })
const idle = { state: 'idle', since: ago(20), busyAt: ago(28), background: false, at: ago(0.1), session: 'cli-Digger', mod: '0.26.9' }
function build(item) {
  const work = storeFromText('## Board\n', { now: ago(120) })
  work.items.set('B799', item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: ago(1) }, 'cli-Digger': { text: '', isCut: false, modifiedAt: ago(20) } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(180),
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' }, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: ago(60), offSince: null }, reports: new Map([['Digger', idle]]),
  })
}

test('the lane shows "not merged yet: back with Digger" (no Check again) and the worker is sent the words once; a failed check keeps its flag', () => {
  const state = build(notMerged())
  const digger = built => built.chats.find(chat => chat.name === 'Digger')
  assert.equal(digger(state).state, 'free')
  assert.deepEqual(digger(state).flags.map(({ kind, id, text, button }) => [kind, id, text, button]), [['not merged', 'B799', 'B799: not merged yet: back with Digger', null]])
  const says = state.reconciled.says.filter(flag => flag.id === 'B799')
  // The check failed 39 minutes ago: the word at once, and the 30-minute reminder (B740) with the same words.
  const words = `work: ${WORDS.slice('not merged: '.length)}`
  assert.deepEqual(says.map(flag => flag.say), [words, words])
  assert.match(says[1].key, /report-again/)
  assert.match(says[0].key, /^B799 Digger check /)
  // Any other failed check is still "check failed", with its Check again button for the person.
  const other = build(stepItem([line(40, 'Digger', 'in progress → review'), line(39, 'server', 'check failed: work outside git; not there: a/b.md')]))
  assert.deepEqual(digger(other).flags.map(flag => [flag.kind, flag.button]), [['check failed', null]])
  assert.match(other.reconciled.says[0].say, /the board's check of B799 failed/)
})

test('the wait line of the step reads "not merged yet: back with Digger"', () => {
  assert.equal(reviewWaitOf(notMerged(), new Map()).text, 'not merged yet: back with Digger')
  assert.equal(reviewWaitOf(stepItem([line(40, 'Digger', 'in progress → review'), line(39, 'server', 'check failed: work outside git; not there: a/b.md')]), new Map()).text, 'waits for Digger to report again: its report check failed at 01:51 (work outside git)'.replace('01:51', stamp(ago(39)).slice(-5)).replace(' (work outside git)', ' (not there)'))
})

test('work next gives the worker the words, and no new step before the report passes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'not-merged-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('## Art\n', { now: ago(120) }), undefined, { now: ago(120) })
  const next = async item => {
    await writeFile(join(dir, 'B799.md'), serializeItem(item))
    return (await workApi({ action: 'next', chat: 'Digger' }, { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, as: 'Digger' })).result?.text ?? ''
  }
  assert.match(await next(notMerged()), /Your work for B799 is on branch b775-mock-details \(2 commits\) but not on main: merge it into main, then report again\. The board gives you no new step/)
  assert.doesNotMatch(await next(notMerged(line(5, 'Digger', 'reported again'), line(5, 'server', 'check pending'))), /no new step before that report passes/)
  assert.equal((await readStore(dir)).items.has('B799'), true)
})

test('the board writes the check to the History as "check failed: not merged: ..." from the outcome', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'not-merged-api-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('## Art\n', { now: ago(120) }), undefined, { now: ago(120) })
  await writeFile(join(dir, 'B799.md'), serializeItem(stepItem([line(40, 'Digger', 'in progress → review'), line(40, 'server', 'check pending')])))
  const outcome = await reportCheck(outside())
  const done = await workApi({ action: 'check', id: 'B799', ...outcome }, { dir, now: NOW, prefix: 'Team - ', roleOf: () => null, as: 'server' })
  assert.equal(done.ok, true)
  const history = (await readStore(dir)).items.get('B799').sections.get('History')
  assert.match(history.at(-1), /server: check failed: not merged: Your work for B799 is on branch b775-mock-details \(2 commits\) but not on main: merge it into main, then report again\.$/)
})
