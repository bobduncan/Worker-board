// B299: asks `Q<n>` by kind (spec 2026-10-17, sections 5 and 8): the "For you" block in the project's form, an answer
// that carries the ask's own id, refine questions as asks, the app's question form, and notes read. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { storeProblems } from '../../src/work/adapter.mjs'
import { forYouBlock, workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore, writeTruth } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = [
  '# Backlog', '', '## Board work',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Support; about 30 min)',
  '- [ ] B7 An unrefined step',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker', Advisor: 'advisor' }
const URL = 'http://127.0.0.1:4310'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-asks-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  await writeTruth(dir, { truth: 'store', since: '2026-10-17 11:05' })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']), boardUrl: URL }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, board: as('Board'), support: as('Support'), advisor: as('Advisor'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const state = async (dir, id) => valueOf(await item(dir, id), 'State')

test('the block of a look with a picture and a play link, in the project\'s form, opening the board', () => {
  assert.equal(forYouBlock({ id: 'Q4', of: 'B1', kind: 'look', blocking: true, title: 'Is the strip readable?', options: ['A thin', 'B thick'], advice: 'B', pictures: ['art-inbox/strip/thin-or-thick.png'], play: 'b1-strip&screen=shop' }, URL), [
    '> **For you**',
    '> 1. **Answer:** Is the strip readable? A thin or B thick; I advise B (Q4, look, blocks B1)',
    '>    [See the picture: thin or thick](http://127.0.0.1:4310/#picture=art-inbox/strip/thin-or-thick.png)',
    '>    [Play it: screen shop](http://127.0.0.1:4310/#play=b1-strip&screen=shop)',
  ].join('\n'))
  // A do is a "Do:"; an ask under no step names none; a play link with only a branch names the branch.
  assert.equal(forYouBlock({ id: 'Q5', kind: 'do', title: 'Restart the app', play: 'main' }, URL), '> **For you**\n> 1. **Do:** Restart the app (Q5, do)\n>    [Play it: main](http://127.0.0.1:4310/#play=main)')
  assert.equal(forYouBlock({ id: 'Q6', of: 'B2', kind: 'provide', title: 'The sound file', advice: 'a short one' }), '> **For you**\n> 1. **Do:** The sound file I advise a short one. (Q6, provide on B2)')
})

test('ask answers with that block and keeps the advice; an answer carries the ask\'s id, not the chat\'s state', async () => {
  const { dir, board, person } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    const first = await board({ action: 'ask', of: 'B1', kind: 'decide', text: 'Thin or thick?', options: ['A thin', 'B thick'], advice: 'B', blocking: true })
    assert.equal(first.ok, true, first.why)
    assert.equal(first.result.text, '> **For you**\n> 1. **Answer:** Thin or thick? A thin or B thick; I advise B (Q1, decide, blocks B1)')
    assert.equal(valueOf(await item(dir, 'Q1'), 'Advice'), 'B')
    // The chat moves on and asks again before the person answers the first.
    await board({ action: 'ask', of: 'B1', kind: 'look', text: 'Is the colour right?', pictures: ['art-inbox/strip/colour.png'], blocking: true })
    const answered = await person({ action: 'answer', id: 'Q1', text: 'B, thick' })
    assert.equal(answered.ok, true, answered.why)
    assert.deepEqual(answered.result.wake, { to: 'Board', id: 'Q1', title: 'Thin or thick?', text: 'B, thick' })
    assert.deepEqual([await state(dir, 'Q1'), await state(dir, 'Q2')], ['answered', 'open'])
    // B1 still waits on Q2.
    assert.equal(await state(dir, 'B1'), 'waiting on you')
    // A look is approved or rejected; a rejection needs words.
    assert.equal((await person({ action: 'answer', id: 'Q2', verdict: 'reject' })).why, 'Say why you reject it.')
    const approved = await person({ action: 'answer', id: 'Q2', verdict: 'approve', text: 'nice' })
    assert.equal(approved.result.wake.text, 'Approved. nice')
    assert.equal(await state(dir, 'B1'), 'in progress')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refine makes one decide ask per question under the step; refined with one open is refused naming it', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    const refined = await advisor({ action: 'refine', id: 'B7', summary: 'One strip per step.', questions: ['Thin or thick?', 'Which colour?'] })
    assert.deepEqual(refined.result.asks, ['Q1', 'Q2'])
    const q1 = await item(dir, 'Q1')
    assert.deepEqual(['Asks', 'Of', 'Via', 'Owner', 'Blocking', 'Title'].map(key => valueOf(q1, key)), ['decide', 'B7', 'refine', 'Advisor', 'no', 'Thin or thick?'])
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['x'] })).why, 'B7: Q1 ("Thin or thick?"), Q2 ("Which colour?") are still open: the person answers first.')
    // Answered in the step's window: the ask with that question is answered too.
    await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 1, answer: 'blue' }], feedback: '' })
    assert.deepEqual([await state(dir, 'Q1'), await state(dir, 'Q2')], ['open', 'answered'])
    assert.deepEqual((await item(dir, 'Q2')).sections.get('Answer'), ['blue'])
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['x'] })).why, 'B7: Q1 ("Thin or thick?") is still open: the person answers first.')
    // Answered under Needs your attention: it wakes the Advisor, and the refine may be ready.
    const answered = await person({ action: 'answer', id: 'Q1', text: 'thick' })
    assert.equal(answered.result.wake.to, 'Advisor')
    assert.equal((await advisor({ action: 'refined', id: 'B7', what: ['x'] })).ok, true)
    // A new round withdraws the questions of the one before that are still open.
    await advisor({ action: 'refine', id: 'B7', summary: 'Again.', questions: ['Left or right?'] })
    await advisor({ action: 'refine', id: 'B7', summary: 'Once more.', questions: ['Up or down?'] })
    assert.deepEqual([await state(dir, 'Q3'), await state(dir, 'Q4')], ['withdrawn', 'open'])
    // Accepting the refine answers the rest.
    await person({ action: 'refine-accept', id: 'B7' })
    assert.equal(await state(dir, 'Q4'), 'answered')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a question of the app\'s form stands alone, is answered in its chat only, and never stands on the backlog', async () => {
  const { dir, board, support, person } = await fresh()
  try {
    const asked = await board({ action: 'ask', kind: 'decide', via: 'form', text: 'Which port?', options: ['4320', '4330'] })
    assert.equal(asked.ok, true, asked.why)
    assert.equal(asked.result.text, '> **For you**\n> 1. **Answer:** Which port? 4320 or 4330 (Q1, decide)')
    const q = await item(dir, 'Q1')
    assert.deepEqual(['Of', 'Via', 'Owner'].map(key => valueOf(q, key)), [null, 'form', 'Board'])
    assert.equal((await person({ action: 'answer', id: 'Q1', text: '4320' })).why, 'Q1 was asked with the app\'s question form: answer it in Board\'s chat.')
    assert.equal((await support({ action: 'answered-in-chat', id: 'Q1' })).status, 409)
    const done = await board({ action: 'answered-in-chat', id: 'Q1', text: '4320' })
    assert.equal(done.ok, true, done.why)
    assert.equal(await state(dir, 'Q1'), 'answered')
    const store = await readStore(dir)
    assert.deepEqual(storeProblems(store.items, store.activities), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a note is read by the person and by nobody else', async () => {
  const { dir, board, person } = await fresh()
  try {
    await board({ action: 'note', to: 'you', text: 'The strip is merged.' })
    assert.equal((await board({ action: 'read', id: 'N1' })).status, 403)
    assert.equal((await person({ action: 'read', id: 'N1' })).ok, true)
    assert.equal(await state(dir, 'N1'), 'read')
    assert.equal((await person({ action: 'read', id: 'B1' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
