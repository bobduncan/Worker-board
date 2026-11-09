// P2 of the one wait system (T2.11, plan .claude/plans/2026-11-09-one-wait-system-plan.md): the repair rule faults-gone. A step
// in review whose board check failed only on a branch or worktree its worker left, or a branch left on origin that is merged
// now, is checked again once every one of those faults is gone, without a new report. The real cases are copies of two steps
// from the store (fixtures/faults-gone): B1042 (5 Nov: branch and worktree left; it sat failed until its worker reported
// again) and B1071 (9 Nov: its branch left on origin). Today (without the rule) nothing checks either again.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applySync, runRules, syncRunner } from '../../src/supervisor/loop.mjs'
import { FAULTS_GONE_START_MS, REPAIR_RULES, findStuck } from '../../src/supervisor/rules/repair.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { STUCK_CHECK_MS, stuckChecks, workApi } from '../../src/work/api.mjs'
import { faultsNow } from '../../src/work/check.mjs'
import { HANDOVER_COMMAND, HANDOVER_MOD, decide } from '../../src/work/handover.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { reportCheckFailedOf } from '../../src/work/resultCheck.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 12, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const fixture = async name => parseItem(await readFile(new URL(`../../fixtures/faults-gone/${name}.md`, import.meta.url), 'utf8'))
const items = (...all) => new Map(all.map(one => [valueOf(one, 'Id'), one]))
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const inReview = (id, ...history) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(60)) }, { History: history })
const failedOn = (minutes, ...faults) => `- ${stamp(ago(minutes))} server: check failed: ${['work in lantern', ...faults].join('; ')}`

/** What git says about the repository of the real cases, with its branch and worktree gone. */
const REPO = { name: 'worker-board', base: 'main', heads: ['main', 'other'], remotes: ['origin/main'], remoteUnmerged: [], worktrees: ['D:/proj/worker-board'] }
const facts = (more = {}) => [{ ...REPO, ...more }]
const stuck = (store, branches, more = {}) => findStuck({ items: store, lanes: [], now: NOW, branches, ...more }).filter(one => one.check === 'faults-gone')

test('the real case B1042: branch and worktree left, both gone now, is checked again once; without the rule nothing does', async () => {
  const b1042 = await fixture('B1042')
  const found = stuck(items(b1042), facts())
  assert.deepEqual(found.map(one => [one.key, one.fix]), [['faults-gone B1042 2026-11-05 22:53', {
    do: 'recheck', id: 'B1042', why: 'the branch b1042-chain-long is gone, the worktree w1-b1042 is gone', again: true,
  }]])
  assert.equal(found[0].text, 'B1042: its check failed only on what is gone now, and the branch b1042-chain-long is gone, the worktree w1-b1042 is gone')
  // Today (the two older rules only): nothing checks it again.
  const view = { items: items(b1042), lanes: [], now: NOW, bases: [{ name: 'worker-board', base: 'main', equal: true, unmerged: [] }], branches: facts(), live: {} }
  assert.deepEqual(REPAIR_RULES.filter(one => one.id !== 'faults-gone' && one.id !== 'worktrees').flatMap(one => one.check(view, { seen: new Map(), observed: [] })).filter(one => one.subject === 'B1042'), [])
})

test('faults-gone fires only when EVERY fault is gone: a branch still local, a worktree still listed (any slash, any case), git silent, or no look: nothing', async () => {
  const store = items(await fixture('B1042'))
  assert.equal(stuck(store, facts({ heads: ['main', 'b1042-chain-long'] })).length, 0)
  assert.equal(stuck(store, facts({ worktrees: ['D:/proj/worker-board', 'D:/proj/w1-b1042'] })).length, 0)
  assert.equal(stuck(store, facts({ worktrees: ['d:\\proj\\W1-B1042\\'] })).length, 0)
  assert.equal(stuck(store, facts({ heads: null })).length, 0)
  assert.equal(stuck(store, facts({ worktrees: null })).length, 0)
  assert.equal(stuck(store, []).length, 0)
  // One repository more that still lists the branch holds it.
  assert.equal(stuck(store, [...facts(), { ...REPO, name: 'other', heads: ['b1042-chain-long'] }]).length, 0)
  // A fault it cannot test (a folder, work not merged, a base off its remote) leaves the step to a report.
  assert.equal(stuck(items(inReview('B7', failedOn(5, 'the branch b7-x is still there', 'the folder C:/p/w7 of a worktree is still there, and no repository lists it: look'))), facts()).length, 0)
  assert.equal(stuck(items(inReview('B8', failedOn(5, 'main of lantern is not the same as origin/main'))), facts()).length, 0)
  // Only the local branch left: gone is enough.
  assert.equal(stuck(items(inReview('B9', failedOn(5, 'back: the branch b9-x is still there'))), facts()).length, 1)
})

test('the real case B1071: a branch left on origin is gone, or merged into origin/main now, else it waits', async () => {
  const store = items(await fixture('B1071'))
  const merged = stuck(store, facts({ remotes: ['origin/main', 'origin/b1071-stop-word-settle'], remoteUnmerged: [] }))
  assert.deepEqual(merged.map(one => [one.key, one.fix.why, one.fix.again]), [['faults-gone B1071 2026-11-09 08:24', 'origin/b1071-stop-word-settle is on main now', true]])
  assert.equal(stuck(store, facts({ remotes: ['origin/main'] }))[0].fix.why, 'origin/b1071-stop-word-settle is gone')
  assert.equal(stuck(store, facts({ remotes: ['origin/main', 'origin/b1071-stop-word-settle'], remoteUnmerged: ['origin/b1071-stop-word-settle'] })).length, 0)
  assert.equal(stuck(store, facts({ remotes: ['origin/main', 'origin/b1071-stop-word-settle'], remoteUnmerged: null })).length, 0)
  assert.equal(stuck(store, facts({ remotes: null })).length, 0)
  assert.equal(stuck(store, facts({ name: 'elsewhere', remotes: [] })).length, 0)
})

const GONE = 'the branch b3-x is still there'
const skipCases = (...history) => stuck(items(inReview('B3', ...history)), facts())

test('faults-gone skips a step whose check runs, one reported after the failed check, one already run again', () => {
  const one = failedOn(30, GONE)
  assert.equal(skipCases(one).length, 1)
  // a check runs: the board's own memory, or its last line
  assert.equal(stuck(items(inReview('B3', one)), facts(), { live: { checking: ['B3'] } }).length, 0)
  assert.equal(stuck(items(inReview('B3', one)), facts(), { live: { checking: ['B4'] } }).length, 1)
  assert.equal(skipCases(one, `- ${stamp(ago(5))} server: check pending`).length, 0)
  // a report after the failed check (its check is the new one)
  assert.equal(skipCases(one, `- ${stamp(ago(5))} Painter: reported again`).length, 0)
  assert.equal(skipCases(one, `- ${stamp(ago(5))} Painter: in progress → review`).length, 0)
  assert.equal(skipCases(one, `- ${stamp(ago(5))} server: check asked again`.replace('server', 'You')).length, 0)
  // the rule's own re-run
  assert.equal(skipCases(one, `- ${stamp(ago(5))} server: check run again by the board (faults gone): the branch b3-x is gone`).length, 0)
  assert.equal(skipCases(one, `- ${stamp(ago(5))} server: check run again by the board: failed: the branch b3-x is still there`).length, 0)
  // a pass
  assert.equal(skipCases(one, `- ${stamp(ago(5))} server: check passed: work in lantern`).length, 0)
})

test('faults-gone looks at nothing while a landing runs and in the first minutes after a board start, and says so', () => {
  const rule = REPAIR_RULES.find(one => one.id === 'faults-gone')
  const board = (live, now = NOW) => buildView({ state: {}, items: items(inReview('B3', failedOn(30, GONE))), branches: facts(), live, now })
  assert.equal(rule.skips(board({})), null)
  assert.equal(rule.skips(board({ landing: true })), 'a landing runs')
  assert.equal(rule.skips(board({ startedAt: NOW - 2 * MIN })), 'the board started minutes ago')
  assert.equal(rule.skips(board({ startedAt: NOW - FAULTS_GONE_START_MS - 1 })), null)
  const run = live => runRules([rule], board(live), { seen: new Map(), observed: [] })
  assert.equal(run({}).findings.length, 1)
  assert.deepEqual(run({ landing: true }).findings, [])
  assert.equal(run({ landing: true }).states[0].skipped, 'a landing runs')
  assert.deepEqual(run({ startedAt: NOW - MIN }).findings, [])
})

test('once per failed check: its key names the check; a re-run ends the case, a later report and failure opens a new one', () => {
  const first = failedOn(60, GONE)
  const one = skipCases(first)
  assert.equal(one[0].key, `faults-gone B3 ${stamp(ago(60))}`)
  const second = failedOn(10, GONE)
  const again = skipCases(first, `- ${stamp(ago(30))} Painter: reported again`, second)
  assert.equal(again[0].key, `faults-gone B3 ${stamp(ago(10))}`)
  assert.notEqual(again[0].key, one[0].key)
  // a re-run of the first check, then it fails again quietly: the same failed check is not run a third time
  assert.equal(skipCases(first, `- ${stamp(ago(50))} server: check run again by the board (faults gone): x`, `- ${stamp(ago(50))} server: check run again by the board: failed: y`).length, 0)
})

test('the fix runs through the recheck port with again, once per key in the runner end to end; the other rechecks carry no again', async () => {
  const found = stuck(items(inReview('B3', failedOn(30, GONE))), facts())
  const asked = []
  const done = await applySync(found, { recheck: async (id, why, more) => { asked.push([id, why, more]); return { ok: true } } })
  assert.deepEqual(asked, [['B3', 'the branch b3-x is gone', { again: true }]])
  assert.deepEqual(done.rows.map(row => [row.check, row.status]), [['faults-gone', 'Fixed']])
  const plain = []
  await applySync([{ check: 'x', key: 'x', text: 'x', fix: { do: 'recheck', id: 'B1', why: 'w' } }], { recheck: async (id, why, more) => { plain.push(more); return { ok: true } } })
  assert.deepEqual(plain, [{}])
  // the runner: the ports branches / landing / startedAt / checking feed the view
  const store = items(inReview('B3', failedOn(30, GONE)))
  const calls = []
  const ports = live => ({
    state: async () => ({ chats: [] }), items: async () => store, outbox: () => [], refused: () => [], now: () => NOW,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} }, apply: async () => ({ ok: true }), wake: async () => null,
    branches: async () => facts(), recheck: async (id, why, more) => { calls.push([id, why, more]); return { ok: true } }, ...live,
  })
  assert.ok((await syncRunner(ports({ landing: () => false, startedAt: () => ago(60), checking: () => [] })).run()).rows.some(row => row.check === 'faults-gone' && row.status === 'Fixed'))
  assert.deepEqual(calls, [['B3', 'the branch b3-x is gone', { again: true }]])
  calls.length = 0
  await syncRunner(ports({ landing: () => true })).run()
  await syncRunner(ports({ startedAt: () => ago(1) })).run()
  await syncRunner(ports({ checking: () => ['B3'] })).run()
  await syncRunner(ports({ landing: () => { throw new Error('unreadable') } })).run()
  assert.deepEqual(calls, [])
})

test('faultsNow carries the local branches, the remote ones, the ones origin lacks and the worktrees; null where git did not answer', async () => {
  const dir = '/projects/lantern'
  const answers = {
    [`${dir} for-each-ref --format=%(refname:short) refs/heads`]: 'main\nb1-x\n',
    [`${dir} for-each-ref --format=%(refname:short) refs/remotes`]: 'origin/main\norigin/b1-x\n',
    [`${dir} for-each-ref --no-merged origin/main --format=%(refname:short) refs/remotes`]: 'origin/b1-x\n',
    [`${dir} worktree list --porcelain`]: `worktree ${dir}\nHEAD a\nbranch refs/heads/main\n\nworktree /projects/w1\r\nHEAD b\nbranch refs/heads/b1-x\n`,
  }
  const run = async args => answers[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
  assert.deepEqual(await faultsNow({ repos: [{ dir, base: 'main' }, { dir: '/projects/quiet', base: 'main' }], run }), [
    { name: 'lantern', base: 'main', heads: ['main', 'b1-x'], remotes: ['origin/main', 'origin/b1-x'], remoteUnmerged: ['origin/b1-x'], worktrees: [dir, '/projects/w1'] },
    { name: 'quiet', base: 'main', heads: null, remotes: null, remoteUnmerged: null, worktrees: null },
  ])
})

// The action and the lines it writes.
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Light the lamps (for Painter; about 1 h)', ''].join('\n')
const ROLES = { Lead: 'main', Painter: 'worker' }
const BRANCH_LEFT = 'the branch b1-lamps is still there'

/** A store with B1 reported and its check failed on a branch left; `step(body, minutes)` calls the work API at that minute. */
async function failedStore(dir) {
  const start = new Date(2026, 10, 9, 8, 0).getTime()
  await writeStore(dir, migrateBacklog(BACKLOG, { now: start }), undefined, { now: start })
  const call = (minutes, as) => body => workApi(as === undefined ? { chat: 'Painter', ...body } : body, { dir, now: start + minutes * MIN, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Painter']), ...(as === undefined ? {} : { as }) })
  await call(1)({ action: 'take', minutes: 30, id: 'B1', branch: 'b1-lamps' })
  await call(2)({ action: 'report', id: 'B1', result: 'The lamps glow.', merged: 'c0ffee1' })
  await call(3, 'server')({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', `${'back: '}${BRANCH_LEFT}`] })
  return { start, at: minutes => call(minutes, 'server'), history: async () => (await readStore(dir)).items.get('B1').sections.get('History'), item: async () => (await readStore(dir)).items.get('B1') }
}
const withStore = async job => {
  const dir = await mkdtemp(join(tmpdir(), 'work-faults-gone-'))
  try {
    return await job(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

test('the board re-run of the rule: the start is one marker line, a failure is "check run again by the board: failed: ...", a plain recheck is as before', async () => {
  await withStore(async dir => {
    const board = await failedStore(dir)
    const again = await board.at(30)({ action: 'recheck-base', id: 'B1', why: 'the branch b1-lamps is gone', again: true })
    assert.equal(again.ok, true, again.why)
    assert.equal(again.result.check.id, 'B1')
    let history = await board.history()
    assert.equal(history.at(-1), '- 2026-11-09 08:30 server: check run again by the board (faults gone): the branch b1-lamps is gone')
    const failed = await board.at(31)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', `back: ${BRANCH_LEFT}`] })
    assert.equal(failed.ok, true, failed.why)
    history = await board.history()
    assert.equal(history.at(-1), `- 2026-11-09 08:31 server: check run again by the board: failed: work in lantern; back: ${BRANCH_LEFT}`)
    assert.equal(history.filter(line => / server: check failed/.test(line)).length, 1)
    // The failed check the step stands on is still the first one: its stamp (the back word's key) did not move.
    assert.equal(reportCheckFailedOf(await board.item()).stamp, '2026-11-09 08:03')
    // Not the old way: a plain recheck writes "check run again" and "check pending", and its failure is a failed check.
    await board.at(40)({ action: 'recheck-base', id: 'B1', why: 'x' })
    history = await board.history()
    assert.deepEqual(history.slice(-2), ['- 2026-11-09 08:40 server: check run again: x', '- 2026-11-09 08:40 server: check pending'])
    await board.at(41)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern'] })
    assert.match((await board.history()).at(-1), / server: check failed: work in lantern$/)
  })
})

test('report-check-twice skips the board re-run failure line; two real failed checks still trip it', async () => {
  await withStore(async dir => {
    const board = await failedStore(dir)
    await board.at(30)({ action: 'recheck-base', id: 'B1', why: 'x', again: true })
    await board.at(31)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', `back: ${BRANCH_LEFT}`] })
    const now = new Date(2026, 10, 9, 10, 0).getTime()
    const rule = WATCH_RULES.find(one => one.id === 'report-check-twice')
    const board1 = store => rule.check(buildView({ state: {}, items: new Map([['B1', store]]), now }), { seen: new Map(), observed: [] })
    assert.deepEqual(board1(await board.item()), [])
    // A real second failed check (a report and its failure) is counted as before.
    await board.at(50)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', 'a second fault'] })
    assert.equal(board1(await board.item()).length, 1)
  })
})

const worker = (since, name = 'Painter') => ({ name, state: 'free', isMain: false, isLeftover: false, isRunning: true, mod: HANDOVER_MOD, model: 'claude-sonnet-5-5', report: { state: 'idle', since, background: false, at: since } })
const backWord = (key, state = 'delivered') => ({ id: 'e1', at: new Date(2026, 10, 9, 8, 44).getTime(), to: 'Painter', command: HANDOVER_COMMAND, kind: 'back', step: null, clear: null, restart: false, set: null, line: 'work: ...', back: key, state })

test('no back word is sent for a failure of the re-run: the hand-over keeps the key of the failed check it told', async () => {
  await withStore(async dir => {
    const board = await failedStore(dir)
    const now = new Date(2026, 10, 9, 8, 45).getTime()
    const idle = worker(now - 20 * MIN)
    const decideNow = (store, envelopes) => decide({ worker: idle, items: new Map([['B1', store]]), ready: [], envelopes, now })
    const key = `B1 ${reportCheckFailedOf(await board.item()).stamp}`
    // The failed check is told once: nothing more while it stands, and nothing sent before either way a new one would.
    assert.equal(decideNow(await board.item(), [backWord(key)]).envelope, null)
    assert.equal(decideNow(await board.item(), []).envelope?.back, key)
    await board.at(30)({ action: 'recheck-base', id: 'B1', why: 'x', again: true })
    await board.at(31)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', `back: ${BRANCH_LEFT}`] })
    assert.equal(decideNow(await board.item(), [backWord(key)]).envelope, null)
    // A plain failed check (as every other re-run writes it) is a new failed check with a new key and a new word.
    await board.at(35)({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', `back: ${BRANCH_LEFT}`] })
    assert.notEqual(decideNow(await board.item(), [backWord(key)]).envelope?.back, undefined)
  })
})

test('the outbox sweep closes a waiting back word once its step check passed since (the re-run); a later word, another step, a taken word, a failure stay', async () => {
  await withStore(async dir => {
    const board = await failedStore(dir)
    await board.at(30)({ action: 'recheck-base', id: 'B1', why: 'x', again: true })
    const key = `B1 ${reportCheckFailedOf(await board.item()).stamp}`
    const at = minutes => board.start + minutes * MIN
    const judge = (store, word, more = {}) => whyClosed(word, { all: [word], items: new Map([['B1', store]]), runs: new Map(), goals: [], now: at(60), keep: { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }, closing: new Map(), ...more })
    const early = { ...backWord(key, 'waiting'), at: at(20) }
    // Still failed (the re-run has not ended): the waiting back word stays on its way.
    assert.equal(judge(await board.item(), early), null)
    const passed = await board.at(31)({ action: 'check', id: 'B1', passed: true, lines: ['work in lantern', 'branch gone'] })
    assert.equal(passed.ok, true, passed.why)
    const store = await board.item()
    assert.match((await board.history()).at(-2), / server: check passed: work in lantern; branch gone$/)
    assert.equal(valueOf(store, 'State'), 'done')
    assert.deepEqual(judge(store, early), { state: 'dropped', why: 'its check passed since (board re-run)' })
    // Made after the pass, for another step, already taken, or not a back word: stays.
    assert.equal(judge(store, { ...early, at: at(40) }), null)
    assert.equal(judge(store, { ...early, back: key.replace('B1', 'B2') }), null)
    assert.equal(judge(store, { ...early, state: 'taken' }), null)
    assert.equal(judge(store, { ...early, kind: 'restart', back: null }), null)
    // A pass long ago, then a failure: the check does not stand passed, so the word stays.
    const failedLater = inReview('B1', `- ${stamp(at(25))} server: check passed: x`, `- ${stamp(at(28))} server: check failed: x`)
    assert.equal(judge(failedLater, early), null)
  })
})

test('a re-run whose start stands over 2 minutes is stuck like a pending check; its failure line ends that', () => {
  const start = `- ${stamp(ago(5))} server: check run again by the board (faults gone): x`
  const failed = `- ${stamp(ago(4))} server: check run again by the board: failed: y`
  const stuckIds = (...history) => stuckChecks([inReview('B1', failedOn(10, GONE), ...history)], NOW)
  assert.deepEqual(stuckIds(start), ['B1'])
  assert.deepEqual(stuckIds(`- ${stamp(ago(1))} server: check run again by the board (faults gone): x`), [])
  assert.deepEqual(stuckIds(start, failed), [])
  assert.ok(STUCK_CHECK_MS >= 2 * MIN)
})
