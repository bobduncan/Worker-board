// B462: a refine question is an ask too, so it leads with the same short title as one (B452): the question itself in at
// most 12 words, its numbers, why and advice after it in the same line. Seen live: refine questions of 24 to 32 words
// stood as bold headers. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { askPartsOf, refineQuestionProblem } from '../../src/work/askWords.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 21, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B7 A hedge along the river path', ''].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor' }
const LONG = 'The hedge: yew, 40 plants along the whole river path, planted in two rows a hand apart so it closes in three years and keeps the sheep out? Advised: yes, it closes fast'
const SHORT = 'Should the hedge be yew? 40 plants in two rows a hand apart, closed in three years. Advised: yes, it keeps the sheep out'
const LATE = 'Box grows slowly and stays low. Should the hedge be box instead? Advised: no, it would not keep the sheep out'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'refine-title-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() }
  return { dir, advisor: body => workApi({ chat: 'Advisor', ...body }, ctx), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const gone = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('a refine question must lead with a short question: its number and the rule, in the refusal', () => {
  assert.equal(refineQuestionProblem(SHORT), null)
  assert.equal(refineQuestionProblem(LATE), null, 'its question may come after a sentence of context')
  assert.equal(refineQuestionProblem('Yew? Advised: yes'), null)
  const problem = refineQuestionProblem(LONG)
  assert.match(problem, /28 words/)
  assert.match(problem, /at most 12 words/)
  assert.match(problem, /Advised: /, 'it says where the advice goes')
})

test('a refine with a question over 12 words is refused, and nothing is written', async () => {
  const { dir, advisor } = await fresh()
  try {
    const before = await item(dir, 'B7')
    const refused = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [SHORT, LONG] })
    assert.equal(refused.ok, false)
    assert.equal(refused.status, 400)
    assert.match(refused.why, /^Question 2 /)
    const after = await item(dir, 'B7')
    assert.equal(after.sections.get('Refined'), before.sections.get('Refined'))
    assert.equal([...(await readStore(dir)).items.values()].some(one => valueOf(one, 'Kind') === 'ask'), false, 'no ask is filed')
  } finally {
    await gone(dir)
  }
})

test('a refine question with a short title: the ask leads with it, its context under it, and its answer still folds in', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    const refined = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [SHORT, LATE] })
    assert.equal(refined.ok, true, refined.why)
    assert.deepEqual(refined.result.asks, ['Q1', 'Q2'])
    const q1 = await item(dir, 'Q1')
    assert.equal(valueOf(q1, 'Title'), 'Should the hedge be yew?')
    assert.deepEqual(q1.sections.get('Text'), [SHORT], 'its words stay one line, as the refine block holds them')
    assert.deepEqual(askPartsOf(q1), { title: 'Should the hedge be yew?', context: ['40 plants in two rows a hand apart, closed in three years. Advised: yes, it keeps the sheep out'] })
    assert.equal(valueOf(await item(dir, 'Q2'), 'Title'), 'Should the hedge be box instead?')
    const answered = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'yes' }, { index: 1, answer: 'no' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'answered')
    assert.equal(valueOf(await item(dir, 'Q2'), 'State'), 'answered')
    const folded = await advisor({ action: 'refined', id: 'B7', what: ['A yew hedge in two rows.'] })
    assert.equal(folded.ok, true, folded.why)
  } finally {
    await gone(dir)
  }
})
