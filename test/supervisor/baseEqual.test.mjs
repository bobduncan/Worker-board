// B598, the fix of X45: a report failed the board's check four times on "main of the board is not the same as
// origin/main" while the worker had pushed and another chat's edits held the person's folder back; the words named
// neither side nor the way out, and nothing checked again once the folder caught up. Now the check says which case it
// is, and the repair base-equal checks the step again once the two are equal. Made-up repositories and items.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applySync, syncRunner } from '../../src/supervisor/loop.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { workApi } from '../../src/work/api.mjs'
import { baseFault, basesNow, reportCheck } from '../../src/work/check.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

/** A git that answers from a table of "<repo> <args>" lines; null where it has none. */
const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const DIR = '/projects/lantern'
const ahead = `${DIR} rev-list --count origin/main..main`
const behind = `${DIR} rev-list --count main..origin/main`
const status = `${DIR} status --porcelain --untracked-files=no`
const upstream = `${DIR} diff --name-only main origin/main`
const fault = table => baseFault({ dir: DIR, base: 'main', name: 'lantern', run: git(table) })
const PLAIN = 'main of lantern is not the same as origin/main'
const AGAIN = 'the board checks again by itself once they are equal'

test('behind its remote: fast-forward it; uncommitted edits in files the fast-forward changes are named as what blocks it', async () => {
  assert.equal(await fault({ [ahead]: '0\n', [behind]: '7\n', [status]: '', [upstream]: 'public/page.js\n' }),
    `${PLAIN}: it is 7 commits behind: fast-forward it (git merge --ff-only origin/main in lantern), ${AGAIN}`)
  // Edits in other files do not block it.
  assert.equal(await fault({ [ahead]: '0\n', [behind]: '1\n', [status]: ' M notes.md\n', [upstream]: 'public/page.js\n' }),
    `${PLAIN}: it is 1 commit behind: fast-forward it (git merge --ff-only origin/main in lantern), ${AGAIN}`)
  const blocked = { [ahead]: '0\n', [behind]: '7\n', [status]: ' M public/page.js\nM  server.mjs\n M notes.md\nMM test/a.test.mjs\n M "docs/two words.md"\n', [upstream]: 'public/page.js\nserver.mjs\ntest/a.test.mjs\ndocs/two words.md\n' }
  assert.equal(await fault(blocked),
    `${PLAIN}: it is 7 commits behind, and uncommitted edits block the fast-forward (public/page.js, server.mjs, test/a.test.mjs and 1 more): another chat's work, ${AGAIN}`)
})

test('ahead of its remote, or both: push them; git that does not count leaves the plain words', async () => {
  assert.equal(await fault({ [ahead]: '2\n', [behind]: '0\n' }), `${PLAIN}: it holds 2 commits origin/main lacks: push them (or another chat's merge is under way), ${AGAIN}`)
  assert.equal(await fault({ [ahead]: '1\n', [behind]: '3\n' }), `${PLAIN}: it holds 1 commit origin/main lacks and lacks 3 commits of it: bring them together and push, ${AGAIN}`)
  assert.equal(await fault({ [ahead]: '1\n' }), PLAIN)
  assert.equal(await fault({}), PLAIN)
})

test('the report check carries the words, without the "; " that parts a check line', async () => {
  const world = {
    [`${DIR} for-each-ref --format=%(refname:short) refs/heads`]: 'main\n',
    [`${DIR} for-each-ref --format=%(refname:short) refs/remotes`]: 'origin/main\n',
    [`${DIR} rev-parse --verify --quiet c0ffee1^{commit}`]: 'c0ffee1\n',
    [`${DIR} rev-parse main`]: 'aaa\n',
    [`${DIR} rev-parse origin/main`]: 'bbb\n',
    [`${DIR} worktree list --porcelain`]: `worktree ${DIR}\nHEAD aaa\nbranch refs/heads/main\n`,
    [ahead]: '0\n', [behind]: '2\n', [status]: ' M page.js\n', [upstream]: 'page.js\n',
  }
  const said = 'Context: The lamps stayed dark. Change: Every lamp glows. Details: x'
  const done = await reportCheck({ id: 'B1', branch: 'b1-lamps', result: said, merged: 'c0ffee1', repos: [{ dir: DIR, base: 'main' }], run: git(world) })
  assert.equal(done.passed, false)
  const line = done.lines.find(one => one.startsWith(PLAIN))
  assert.equal(line, `${PLAIN}: it is 2 commits behind, and uncommitted edits block the fast-forward (page.js): another chat's work, ${AGAIN}`)
  assert.doesNotMatch(line, /; /)
  assert.deepEqual(await basesNow({ repos: [{ dir: DIR, base: 'main' }, { dir: '/projects/quiet', base: 'main' }], run: git(world) }),
    [{ name: 'lantern', base: 'main', equal: false }, { name: 'quiet', base: 'main', equal: null }])
})

const MIN = 60_000
const NOW = new Date(2026, 9, 25, 12, 30).getTime()
const ago = minutes => NOW - minutes * MIN
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const inReview = (id, ...history) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(20)) }, { History: history })
const failedOn = (minutes, ...faults) => `- ${stamp(ago(minutes))} server: check failed: ${['work in lantern', ...faults].join('; ')}`
const EQUAL = [{ name: 'lantern', base: 'main', equal: true }]
const stuck = (store, bases = EQUAL) => findStuck({ items: store, lanes: [], now: NOW, bases }).filter(one => one.check === 'base-equal')

test('the repair base-equal: a step whose check failed only on main against origin/main is checked again once they are equal', () => {
  const b1 = inReview('B1', `- ${stamp(ago(15))} Painter: in progress → review`, failedOn(14, PLAIN), failedOn(12, `${PLAIN}: it is 7 commits behind: fast-forward it`))
  const found = stuck(items(b1))
  assert.deepEqual(found.map(one => [one.key, one.fix]), [[`base-equal B1 ${stamp(ago(12))}`, { do: 'recheck', id: 'B1', why: 'main of lantern equals origin/main now' }]])
  assert.equal(found[0].text, 'B1: its check failed only on main of lantern against origin, and main of lantern equals origin/main now')
  // Not yet equal, or not known: it waits.
  assert.deepEqual(stuck(items(b1), [{ name: 'lantern', base: 'main', equal: false }]), [])
  assert.deepEqual(stuck(items(b1), [{ name: 'lantern', base: 'main', equal: null }]), [])
  assert.deepEqual(stuck(items(b1), []), [])
  // Another fault too: a new report is the way, not a check again.
  assert.deepEqual(stuck(items(inReview('B2', failedOn(5, PLAIN, 'the branch b2-wicks is still there')))), [])
  // Its check runs again already, or passed: nothing.
  assert.deepEqual(stuck(items(inReview('B3', failedOn(5, PLAIN), `- ${stamp(ago(1))} server: check pending`))), [])
  assert.deepEqual(stuck(items(inReview('B4', failedOn(5, PLAIN), `- ${stamp(ago(1))} server: check passed: work in lantern`))), [])
  // 2026-10-25: a pass with warnings is a pass too (the step waits for its result check, not for another check).
  assert.deepEqual(stuck(items(inReview('B4', failedOn(5, PLAIN), `- ${stamp(ago(1))} server: check passed with warnings: the result names no Context`))), [])
  // Not in review: nothing.
  const done = item({ Id: 'B5', Kind: 'step', Title: 'x', State: 'done', Owner: 'Painter' }, { History: [failedOn(5, PLAIN)] })
  assert.deepEqual(stuck(items(done)), [])
})

test('the fix recheck runs through its port: Fixed when it went, For Main without telling when it did not', async () => {
  const found = stuck(items(inReview('B1', failedOn(5, PLAIN))))
  const asked = []
  const done = await applySync(found, { recheck: async (id, why) => { asked.push([id, why]); return { ok: true } } })
  assert.deepEqual(asked, [['B1', 'main of lantern equals origin/main now']])
  assert.deepEqual(done.rows.map(one => [one.check, one.status]), [['base-equal', 'Fixed']])
  assert.deepEqual(done.note, [])
  const refused = await applySync(found, { recheck: async () => ({ ok: false, why: 'B1 is done' }) })
  assert.deepEqual(refused.rows.map(one => one.status), ['For Main'])
  assert.deepEqual(refused.note, [])
})

const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Light the lamps (for Painter; about 1 h)', ''].join('\n')
const ROLES = { Lead: 'main', Painter: 'worker' }

test('the action recheck-base: the board only, a step in review only; History says why and the check comes back to run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-base-equal-'))
  try {
    const start = new Date(2026, 9, 25, 12, 0).getTime()
    await writeStore(dir, migrateBacklog(BACKLOG, { now: start }), undefined, { now: start })
    const ctx = { dir, now: start + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Painter']) }
    const painter = body => workApi({ chat: 'Painter', ...body }, ctx)
    const server = body => workApi(body, { ...ctx, as: 'server' })
    assert.equal((await server({ action: 'recheck-base', id: 'B1', why: 'x' })).status, 409)
    await painter({ action: 'take', id: 'B1', branch: 'b1-lamps' })
    await painter({ action: 'report', id: 'B1', result: 'The lamps glow.', merged: 'c0ffee1' })
    await server({ action: 'check', id: 'B1', passed: false, lines: ['work in lantern', PLAIN] })
    assert.equal((await painter({ action: 'recheck-base', id: 'B1' })).status, 403)
    const again = await server({ action: 'recheck-base', id: 'B1', why: 'main of lantern equals origin/main now' })
    assert.equal(again.ok, true, again.why)
    assert.deepEqual(again.result.check, { id: 'B1', branch: 'b1-lamps', result: 'The lamps glow.', merged: 'c0ffee1', touches: [] })
    const b1 = (await readStore(dir)).items.get('B1')
    assert.equal(valueOf(b1, 'State'), 'review')
    assert.deepEqual(b1.sections.get('History').slice(-2), ['- 2026-10-25 12:01 server: check run again: main of lantern equals origin/main now', '- 2026-10-25 12:01 server: check pending'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the runner looks at the bases through its port and checks the step again through its own', async () => {
  const store = items(inReview('B1', failedOn(5, PLAIN)))
  const asked = []
  const runner = syncRunner({
    state: async () => ({ chats: [] }), items: async () => store, outbox: () => [], refused: () => [], now: () => NOW,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} }, apply: async () => ({ ok: true }), wake: async () => null,
    bases: async () => EQUAL, recheck: async (id, why) => { asked.push([id, why]); return { ok: true } },
  })
  const answer = await runner.run()
  assert.deepEqual(asked, [['B1', 'main of lantern equals origin/main now']])
  assert.ok(answer.rows.some(one => one.check === 'base-equal' && one.status === 'Fixed'))
  // A look that throws leaves the rule nothing to act on.
  const failing = syncRunner({
    state: async () => ({ chats: [] }), items: async () => store, outbox: () => [], refused: () => [], now: () => NOW,
    noted: { load: async () => ({ noted: [], seen: {} }), save: async () => {} }, apply: async () => ({ ok: true }), wake: async () => null,
    bases: async () => { throw new Error('git is gone') }, recheck: async () => { throw new Error('not to be called') },
  })
  assert.equal((await failing.run()).rows.some(one => one.check === 'base-equal'), false)
})
