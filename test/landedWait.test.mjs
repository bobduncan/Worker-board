// F33 (B1256): a landing ends its step's wait for the landing and tells the owner to report (src/work/landedWait.mjs, the work API's
// server action `landed-waits`). The live case, replayed: B1236's owner recorded "waits on chat 1 · its go to land" at 10:29 on
// 2026-11-16; chat 1 landed its branch b1236-x202-fix at 10:42 (4ba4f404, both boards, the branch removed on the remote) and sent no
// word, so the wait ran to 12:22. Made-up chat names (Lead the main chat, Worker 1 and Worker 2 workers, "Board lead" the chat that
// lands); the step, its branch, the times and the landing line's shape are the live ones.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { landedLines } from '../src/landing.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { LANDED_KIND, LANDING_WHAT, landedWaitOf, landedWord } from '../src/work/landedWait.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { readStore } from '../src/work/store.mjs'
import { workLineWhy } from '../src/work/workLines.mjs'

const at = (h, m, s = 0) => new Date(2026, 10, 16, h, m, s).getTime()
const WAIT_AT = at(10, 29)
const LANDED_AT = at(10, 42, 22)
const BRANCH = 'b1236-x202-fix'
const HEAD = '4ba4f404e34fa0863965b787990173d208510452'
const LANDER = 'Board lead'
const ROLES = { Lead: 'main', 'Worker 1': 'worker', 'Worker 2': 'worker' }
const roleOf = name => ROLES[name] ?? null

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** B1236 as Worker 1 held it at 10:29: in progress, its wait on chat 1 recorded. */
const b1236 = ({ id = 'B1236', branch = BRANCH, waits = `chat 1 · its go to land · ${stamp(WAIT_AT)}`, state = 'in progress', owner = 'Worker 1' } = {}) => text(
  { Id: id, Kind: 'step', Title: 'Fix of X202: a chain of fixes tries the same way again', Priority: 'fix', State: state, Owner: owner, Activity: 'Garden', Goal: 'G15', ...(waits === null ? {} : { 'Waits on': waits }), Since: stamp(at(10, 20)), ...(branch === null ? {} : { Branch: branch }), 'Taken for': '45 min', Refined: 'ready' },
  { History: [`- ${stamp(at(10, 20))} Worker 1: taken → in progress`, `- ${stamp(WAIT_AT)} Worker 1: waits on chat 1 · its go to land`] })
const stepOf = body => parseItem(body)

/** The 10:42 line of data/landings.jsonl, in its real shape. */
const landingLine = (more = {}) => ({
  at: new Date(LANDED_AT).toISOString(), by: LANDER, branch: BRANCH, head: HEAD, before: '3f75f9f900d49a3a786d6d495e79ef40cd9429a3', after: HEAD, trial: HEAD, result: 'landed', why: null,
  boards: [{ port: 4310, since: LANDED_AT, commit: '4ba4f404' }, { port: 4314, since: LANDED_AT, commit: '4ba4f404' }], cold: false, gateLog: `C:\\board\\data\\landings\\20261116-103248-${BRANCH}.log`,
  branches: { swept: [], kept: [], landed: { remote: 'removed', local: 'kept: checked out in C:/board-b1236' } }, ...more,
})
async function dataDir(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'landed-data-'))
  await writeFile(join(dir, 'landings.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n')
  return dir
}
async function storeDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'landed-store-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files) }] }, null, 1)}\n`)
  return dir
}
const server = (dir, body, now) => workApi(body, { dir, now, prefix: '', roleOf, chats: Object.keys(ROLES), pictureProblem: async () => null, as: 'server' })
const linesOf = async lines => {
  const dir = await dataDir(lines)
  try {
    return landedLines({ dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the live B1236 case: the 10:42 landing of its branch ends its 10:29 wait for the go to land, one History line, one word to Worker 1', async t => {
  const lines = await linesOf([landingLine()])
  assert.deepEqual(lines.map(({ branch, result, by, head, boards, remote }) => ({ branch, result, by, head, boards, remote })), [{ branch: BRANCH, result: 'landed', by: LANDER, head: HEAD, boards: 2, remote: 'removed' }])
  const dir = await storeDir({ B1236: b1236() })
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const done = await server(dir, { action: 'landed-waits', landings: lines }, at(10, 43))
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.cleared, ['B1236'])
  assert.deepEqual(done.result.wakes, [{ to: 'Worker 1', id: 'B1236', kind: LANDED_KIND, line: 'B1236 landed (4ba4f404, both boards): report it (merged 4ba4f404); its branch is gone from origin' }])
  const item = (await readStore(dir)).items.get('B1236')
  assert.equal(valueOf(item, 'Waits on'), null)
  assert.equal(valueOf(item, 'State'), 'in progress', 'the step stays its owner\'s to report')
  const added = item.sections.get('History').filter(line => / server: landed /.test(line))
  assert.deepEqual(added, [`- ${stamp(at(10, 43))} server: landed 4ba4f404 by ${LANDER} at 10:42: no longer waits on chat 1 (its go to land, since ${stamp(WAIT_AT)})`])
  // Once per landing: the board's next pass (or a restart re-reading landings.jsonl) clears nothing and words nobody.
  const again = await server(dir, { action: 'landed-waits', landings: lines }, at(12, 0))
  assert.deepEqual([again.result.cleared, again.result.wakes, again.result.changed], [[], [], false])
  assert.equal((await readStore(dir)).items.get('B1236').sections.get('History').filter(line => / server: landed /.test(line)).length, 1)
})

test('never: a refused, rolled-back or rollback-failed landing; another branch; a line older than the wait; a later rollback of that branch', async () => {
  const step = stepOf(b1236())
  assert.notEqual(landedWaitOf(step, await linesOf([landingLine()])), null)
  for (const result of ['refused', 'rolled-back', 'rollback-failed']) assert.equal(landedWaitOf(step, await linesOf([landingLine({ result })])), null, result)
  assert.equal(landedWaitOf(step, await linesOf([landingLine({ branch: 'b1245-effort-text-tests' })])), null, 'another branch')
  assert.equal(landedWaitOf(step, await linesOf([landingLine({ branch: 'b1236-x202-fix-two' })])), null, 'a branch that only starts the same')
  assert.equal(landedWaitOf(step, await linesOf([landingLine({ at: new Date(at(10, 28)).toISOString() })])), null, 'older than the wait')
  assert.equal(landedWaitOf(step, await linesOf([landingLine(), landingLine({ at: new Date(at(10, 50)).toISOString(), result: 'rolled-back' })])), null, 'rolled back later')
  // A refused try first, then the landing: the landing counts.
  assert.notEqual(landedWaitOf(step, await linesOf([landingLine({ at: new Date(at(10, 35)).toISOString(), result: 'refused' }), landingLine()])), null)
})

test('never: a step not waiting, a wait on chat 1 for something else, a step not open; the branch named after the step when none is recorded', async () => {
  const lines = await linesOf([landingLine()])
  assert.equal(landedWaitOf(stepOf(b1236({ waits: null })), lines), null, 'not waiting')
  for (const what of ['its review', 'its answer', 'gate queued behind two other test runs']) {
    assert.equal(landedWaitOf(stepOf(b1236({ waits: `chat 1 · ${what} · ${stamp(WAIT_AT)}` })), lines), null, what)
  }
  for (const state of ['done', 'dropped', 'queued']) assert.equal(landedWaitOf(stepOf(b1236({ state })), lines), null, state)
  assert.notEqual(landedWaitOf(stepOf(b1236({ state: 'review' })), lines), null, 'a report the check handed back')
  // The live words of earlier landing waits all name the landing.
  for (const what of ['its go to land', 'its go to land 10f1ce1d', 'its core review and go to land', 'its landing of b1207-effort-after-take 7da0ed73 (tomorrow)', 'its go to land, after the gate']) assert.match(what, LANDING_WHAT)
  assert.notEqual(landedWaitOf(stepOf(b1236({ branch: null })), lines), null, 'no Branch: b1236-...')
  assert.equal(landedWaitOf(stepOf(b1236({ id: 'B123', branch: null })), lines), null, 'B123 is not b1236-...')
})

test('the word: none when the owner landed it itself; a kept branch says so; the word holds until the owner reported', async t => {
  const dir = await storeDir({ B1236: b1236({ owner: 'Worker 2' }) })
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const done = await server(dir, { action: 'landed-waits', landings: await linesOf([landingLine({ by: 'Worker 2' })]) }, at(10, 43))
  assert.deepEqual([done.result.cleared, done.result.wakes], [['B1236'], []])
  assert.equal(landedWord('B1236', { head: HEAD, boards: 1, remote: 'kept: not merged into origin/main' }), 'B1236 landed (4ba4f404, the board): report it (merged 4ba4f404); its branch is kept: not merged into origin/main')
  const word = { command: 'work', kind: LANDED_KIND, to: 'Worker 1', about: 'B1236' }
  const items = state => new Map([['B1236', stepOf(b1236({ state, waits: null }))]])
  assert.equal(workLineWhy(word, items('in progress')), null)
  assert.match(workLineWhy(word, items('review')), /reported already/)
})
