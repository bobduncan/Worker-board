// B962, the fix of X137: B944's report failed the board's check twice on "not merged" because its branch was kept on
// purpose (Q610); its commit reached main that night, and nothing checked again until the worker reported 33 hours
// later. The repair merged-now checks the step again once its branch is merged or gone. Made-up repositories and items.

import assert from 'node:assert/strict'
import test from 'node:test'

import { applySync } from '../../src/supervisor/loop.mjs'
import { findStuck } from '../../src/supervisor/rules/repair.mjs'
import { basesNow, notMergedWords } from '../../src/work/check.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 4, 9, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const inReview = (id, ...history) => item({ Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(20)) }, { History: history })
const UNMERGED = notMergedWords('B944', { branch: 'b944-clear-idle', commits: 1, base: 'main' })
const failedOn = (minutes, ...faults) => `- ${stamp(ago(minutes))} server: check failed: ${['work in lantern', ...faults].join('; ')}`
const repo = unmerged => [{ name: 'lantern', base: 'main', equal: true, unmerged }]
const stuck = (store, bases) => findStuck({ items: store, lanes: [], now: NOW, bases }).filter(one => one.check === 'merged-now')

test('merged-now: the real case of B944, two failures then its branch gone from the unmerged ones, is checked again once', () => {
  const b944 = inReview('B944', `- ${stamp(ago(30))} Worker 4: in progress → review`, failedOn(25, UNMERGED), failedOn(24, UNMERGED))
  const found = stuck(items(b944), repo([]))
  assert.deepEqual(found.map(one => [one.key, one.fix]), [[`merged-now B944 ${stamp(ago(24))}`, { do: 'recheck', id: 'B944', why: 'b944-clear-idle is on main now' }]])
  // Its branch still lacks from main, git silent, no look: it waits.
  assert.deepEqual(stuck(items(b944), repo(['b944-clear-idle', 'other'])), [])
  assert.deepEqual(stuck(items(b944), repo(null)), [])
  assert.deepEqual(stuck(items(b944), []), [])
  // Another branch unmerged does not hold it.
  assert.equal(stuck(items(b944), repo(['other'])).length, 1)
})

test('merged-now: a second fault, a check run again, a pass, or a step out of review leaves the step as it is', () => {
  assert.deepEqual(stuck(items(inReview('B2', failedOn(5, UNMERGED, 'the branch b2-wicks is still there'))), repo([])), [])
  assert.deepEqual(stuck(items(inReview('B3', failedOn(5, UNMERGED), `- ${stamp(ago(1))} server: check pending`)), repo([])), [])
  assert.deepEqual(stuck(items(inReview('B4', failedOn(5, UNMERGED), `- ${stamp(ago(1))} server: check passed: work in lantern`)), repo([])), [])
  assert.deepEqual(stuck(items(item({ Id: 'B5', Kind: 'step', Title: 'x', State: 'done', Owner: 'Painter' }, { History: [failedOn(5, UNMERGED)] })), repo([])), [])
  // A base fault is the rule base-equal's, not this one's.
  assert.deepEqual(stuck(items(inReview('B6', failedOn(5, 'main of lantern is not the same as origin/main'))), repo([])), [])
})

test('merged-now: once per failed check (the key names the check), through the recheck port', async () => {
  const b1 = inReview('B1', failedOn(10, UNMERGED))
  assert.equal(stuck(items(b1), repo([]))[0].key, `merged-now B944 ${stamp(ago(10))}`.replace('B944', 'B1'))
  const again = inReview('B1', failedOn(10, UNMERGED), failedOn(3, UNMERGED))
  assert.equal(stuck(items(again), repo([]))[0].key, `merged-now B1 ${stamp(ago(3))}`)
  const asked = []
  const done = await applySync(stuck(items(b1), repo([])), { recheck: async (id, why) => { asked.push([id, why]); return { ok: true } } })
  assert.deepEqual(asked, [['B1', 'b944-clear-idle is on main now']])
  assert.deepEqual(done.rows.map(one => [one.check, one.status]), [['merged-now', 'Fixed']])
})

test('basesNow carries the branches the base lacks, null where git did not answer', async () => {
  const dir = '/projects/lantern'
  const run = async args => ({
    [`${dir} rev-parse main`]: 'a\n', [`${dir} rev-parse origin/main`]: 'a\n',
    [`${dir} for-each-ref --no-merged main --format=%(refname:short) refs/heads`]: 'b944-clear-idle\nb1-x\n',
  })[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
  assert.deepEqual(await basesNow({ repos: [{ dir, base: 'main' }, { dir: '/projects/quiet', base: 'main' }], run }),
    [{ name: 'lantern', base: 'main', equal: true, unmerged: ['b944-clear-idle', 'b1-x'] }, { name: 'quiet', base: 'main', equal: null, unmerged: null }])
})
