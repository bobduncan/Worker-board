// eta-remaining (chat 1's brief, the person 2026-11-11: "i want the board to reflect the remainting ETA", then "good." to the design).
// The live case: Worker 1's row read "2 h 30 min over" in amber on B1125: its last minutes-left was 60 min at 13:44 while it worked
// on, its last turn at 19:46; G64's line read "about 10 h left" from the how made at the start. B1125's Plan line and take are the
// live ones (the store, 11 Nov); the chat is Digger in the test garden, G64's other steps are made up.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { etaAsksDue } from '../src/say.mjs'
import { workApi } from '../src/work/api.mjs'
import { MIN, digger, stampSec, stateAt, stepItem } from './heldFixtures.mjs'
import { openPage } from './pageHarness.mjs'

const t = (h, m, s = 0) => new Date(2026, 10, 11, h, m, s).getTime()
const hhmm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const WORKING = [{ at: t(12, 21), chat: 'Digger', state: 'working', task: null, source: 'step' }]

/** B1125 as the store held it: taken 12:21, Taken for 150 min, Size about 2 h, its last minutes-left 60 min at 13:44:38. */
const b1125 = (plan = `Plan: step 4/5 | parts Worktree and brief; Codex sheets; Converter, lab, tests; Judges, pictures, docs; Gate, merge, report | until 2026-11-11 14:44:38 | step until 2026-11-11 14:04:38 | at 2026-11-11 13:44:38`) => stepItem('B1125', {
  title: 'Give each of the Knight\'s six abilities its own move', owner: 'Digger', size: 'about 2 h', since: t(19, 2),
  head: [`Checkpoint: 534e1de3 · Enlarged re-judge after Q735 round · ${stampSec(t(19, 2, 1))}`, plan, 'Taken for: 150 min'],
  history: [[t(12, 21), 'Digger', 'queued → taken'], [t(12, 21), 'Digger', 'taken → in progress'], [t(13, 44), 'Digger', 'step 4, about 60 min left']],
})
/** The same after the worker's fresh `work step minutes=70` at 19:46. */
const b1125New = () => b1125(`Plan: step 4/5 | parts Worktree and brief; Codex sheets; Converter, lab, tests; Judges, pictures, docs; Gate, merge, report | until 2026-11-11 20:56:00 | at 2026-11-11 19:46:00 | estimated 2026-11-11 19:46:00`)

// 1. The worker row: the latest estimate minus the running time since it was said

test('1. B1125 at 19:50 after a fresh 70 min at 19:46: "about 1 h 06 left · re-estimated 19:46", from its own estimate', async () => {
  const lane = digger(stateAt(t(19, 50), { items: [b1125New()], lines: WORKING }))
  assert.deepEqual([lane.held.eta.from, lane.held.eta.saidAt, lane.held.eta.leftMs, lane.held.eta.isOver], ['own', t(19, 46), 66 * MIN, false])
  const page = await openPage({ state: JSON.parse(JSON.stringify(stateAt(t(19, 50), { items: [b1125New()], lines: WORKING }))), now: t(19, 50) })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Digger')
    assert.equal(row.querySelector('.eta').textContent.replace(/\s+/g, ' ').trim(), 'about 1 h 06 left · re-estimated 19:46')
  } finally { await page.close() }
})

test('1. a checkpoint without minutes is kept and its answer asks for minutes left in one line; with minutes it asks nothing', async t2 => {
  const dir = await mkdtemp(join(tmpdir(), 'eta-remaining-'))
  t2.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeFile(join(dir, 'B1125.md'), `${['Id: B1125', 'Kind: step', 'Title: Give each ability its own move', 'State: in progress', 'Owner: Worker 1', `Since: 2026-11-11 12:21`, 'Activity: Garden', '', '## History', '- 2026-11-11 12:21 Worker 1: taken → in progress', ''].join('\n')}`)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B1125'] }] }, null, 1)}\n`)
  const ctx = { dir, now: t(19, 46), prefix: '', roleOf: name => (name === 'Worker 1' ? 'worker' : null), chats: ['Worker 1'], pictureProblem: async () => null }
  const bare = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'rejudge on en' }, ctx)
  assert.equal(bare.ok, true, bare.why)
  assert.match(bare.result.text, /Give your minutes left with every checkpoint: work step id=B1125 minutes=/)
  assert.equal(bare.result.text.split('\n').length, 1, 'one line')
  const timed = await workApi({ action: 'step', chat: 'Worker 1', id: 'B1125', commit: '534e1de3', next: 'rejudge on en', minutes: 70 }, ctx)
  assert.equal(timed.ok, true, timed.why)
  assert.doesNotMatch(timed.result.text, /Give your minutes left/)
})

// 2. Past its estimate with no new one: quiet, and asked once per estimate

test('2. B1125 at 19:46 on its 13:44 estimate: "past its estimate since 14:44", quiet, never amber; asked once, then "new estimate asked"', async () => {
  const before = stateAt(t(19, 46), { items: [b1125()], lines: WORKING })
  const eta = digger(before).held.eta
  assert.deepEqual([eta.from, eta.isOver, eta.isOverdue, eta.asked, hhmm(eta.at)], ['own', true, false, false, '14:44'])
  // The board's word: one, to Digger, about B1125's estimate of 13:44:38.
  const words = etaAsksDue(before, [])
  assert.deepEqual(words.map(one => [one.to, one.command, one.about, one.saidAt]), [['Digger', 'eta-ask', 'B1125', t(13, 44, 38)]])
  assert.match(words[0].text, /^B1125 is past its estimate: give a fresh minutes-left with your next checkpoint/)
  // Sent: none again for the same estimate, and the row says it was asked.
  const outbox = [{ ...words[0], id: 'w1', at: t(19, 46), state: 'taken' }]
  assert.deepEqual(etaAsksDue(stateAt(t(20, 30), { items: [b1125()], lines: WORKING, outbox }), outbox), [])
  const asked = stateAt(t(19, 47), { items: [b1125()], lines: WORKING, outbox })
  assert.equal(digger(asked).held.eta.asked, true)
  const page = await openPage({ state: JSON.parse(JSON.stringify(asked)), now: t(19, 47) })
  try {
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Digger')
    assert.equal(row.querySelector('.eta').textContent.replace(/\s+/g, ' ').trim(), 'past its estimate since 14:44 · new estimate asked')
    assert.equal(page.all('#lanes .is-attn, #lanes .is-blocked, #lanes .is-overdue, #simple-workers .is-attn, #simple-workers .is-overdue').length, 0, 'never amber')
  } finally { await page.close() }
  // A fresh estimate is a new spell: not past, nothing asked; once past again, one new word.
  assert.deepEqual(etaAsksDue(stateAt(t(19, 50), { items: [b1125New()], lines: WORKING, outbox }), outbox), [])
  assert.equal(etaAsksDue(stateAt(t(21, 0), { items: [b1125New()], lines: WORKING, outbox }), outbox).length, 1)
})

test('2. no word while the person pauses all chats, nor to a worker that is not working', () => {
  const state = stateAt(t(19, 46), { items: [b1125()], lines: WORKING })
  assert.deepEqual(etaAsksDue({ ...state, pause: { state: 'pausing', since: t(19, 0) } }, []), [])
  assert.deepEqual(etaAsksDue({ ...state, chats: state.chats.map(lane => ({ ...lane, state: 'free' })) }, []), [])
})

// 3. The goal line: the open steps' latest remaining estimates added up

const G64 = ['Last id: G64', 'Focus: G64', '', '- [~] G64 The Knight attacks', '    Done when: you judge each ability reads', '    Goal definition: an own attack move per ability',
  '    Goal definition agreed: 2026-11-11 00:09', '    Part: Base moves · about 4 h · steps B1124', '    Part: Ability moves · about 6 h · steps B1125, B1140',
  '    Part: Polish · about 2 h', '    How agreed: 2026-11-11 01:00', '    Go: 2026-11-11 01:05', ''].join('\n')
const g64Items = () => [
  stepItem('B1124', { owner: 'Worker 2', state: 'done', size: 'about 4 h', since: t(11, 0) }),
  b1125New(),
  stepItem('B1140', { owner: null, state: 'refined', size: 'about 1 h', since: t(12, 0) }),
]

test('3. G64 at 19:50: B1125\'s 66 min left + B1140\'s Size 1 h + Polish\'s 2 h (no steps yet) = about 4 h, ready around 23:56', async () => {
  const state = stateAt(t(19, 50), { items: g64Items(), lines: WORKING, goals: G64 })
  assert.equal(state.focus.id, 'G64')
  assert.equal(state.focus.progress.minutesLeft, 66 + 60 + 120)
  assert.equal(state.focus.progress.readyAt, t(19, 50) + 246 * MIN)
  const page = await openPage({ state: JSON.parse(JSON.stringify(state)), now: t(19, 50) })
  try {
    assert.match(page.text('#simple-bar'), /Focus G64 · The Knight attacks · .* · about 4 h left · ready around 23:56/)
  } finally { await page.close() }
})
