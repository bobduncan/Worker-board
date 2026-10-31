// B462: a refine question is an ask too, so it leads with the same short title as one (B452): the question itself in at
// most 12 words, first, with its numbers, why and advice after it in the same line. Seen live: refine questions of 24
// to 32 words stood as bold headers. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { askPartsOf, refineQuestionProblem, refineTitleOf } from '../../src/work/askWords.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 21, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B7 A hedge along the river path', ''].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor' }
const LONG = 'The hedge: yew, 40 plants along the whole river path, planted in two rows a hand apart so it closes in three years and keeps the sheep out? Advised: yes, it closes fast'
const SHORT = 'Should the hedge be yew? 40 plants in two rows a hand apart, closed in three years. Advised: yes, it keeps the sheep out'
const BRIEF = 'Should the gate face the river? Advised: no, the path floods'
const LATE = 'Box grows slowly, stays low and needs little cutting. Should the hedge be box instead? Advised: no, it would not keep the sheep out'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'refine-title-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() }
  return { dir, advisor: body => workApi({ chat: 'Advisor', ...body }, ctx), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const gone = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('a refine question leads with a short question: its title, found before the advice', () => {
  assert.equal(refineQuestionProblem(SHORT), null)
  assert.equal(refineTitleOf(SHORT), 'Should the hedge be yew?')
  assert.equal(refineQuestionProblem(BRIEF), null)
  assert.equal(refineTitleOf(BRIEF), 'Should the gate face the river?', 'a short line keeps its advice out of the title')
  assert.equal(refineQuestionProblem('Yew? Advised: yes'), null)
  assert.equal(refineQuestionProblem('Should Dr. Smith plant the hedge in spring? Advised: yes'), null, 'an abbreviation ends no sentence')
})

test('a refine question without a short question first is refused, with why and where the rest goes', () => {
  const long = refineQuestionProblem(LONG)
  assert.match(long, /^leads with a question of 28 words: put the question itself first, in at most 12 words/)
  assert.match(long, /"Advised: \.\.\." after it/)
  assert.match(refineQuestionProblem(LATE), /^starts with words before its question: /, 'the step\'s window shows the line from its start')
  assert.match(refineQuestionProblem('Plant the hedge along the river path in two rows spaced a hand apart. Advised: yes, why not?'), /^leads with a question of 14 words/, 'a "?" in the advice is no question')
  assert.match(refineQuestionProblem('Should Dr. Smith plant the hedge along the whole river path in spring?'), /13 words/)
  assert.match(refineQuestionProblem(`Should we plant the ${'Pseudotsuga-menziesii-'.repeat(5)}glauca hedge? Advised: yes`), /^leads with a question of \d+ characters/)
})

test('a refine with a question too long is refused before anything is written, also a second round', async () => {
  const { dir, advisor } = await fresh()
  try {
    const before = await item(dir, 'B7')
    const refused = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [SHORT, LONG] })
    assert.equal(refused.ok, false)
    assert.equal(refused.status, 400)
    assert.match(refused.why, /^Question 2 leads with a question of 28 words/)
    assert.equal((await item(dir, 'B7')).sections.get('Refined'), before.sections.get('Refined'))
    assert.equal([...(await readStore(dir)).items.values()].some(one => valueOf(one, 'Kind') === 'ask'), false, 'no ask is filed')
    // A first round with its asks; a second one refused leaves them open, not replaced.
    const first = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [`- ${SHORT}`] })
    assert.equal(first.ok, true, first.why)
    assert.deepEqual(first.result.asks, ['Q1'])
    assert.equal(valueOf(await item(dir, 'Q1'), 'Title'), 'Should the hedge be yew?', 'a leading "- " is no part of it')
    const second = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [LATE] })
    assert.match(second.why, /^Question 1 starts with words before its question/)
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'open')
  } finally {
    await gone(dir)
  }
})

test('a refine question with a short title: the ask leads with it, its context under it, and its answer still folds in', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    const refined = await advisor({ action: 'refine', id: 'B7', summary: 'A hedge along the path.', questions: [SHORT, BRIEF] })
    assert.equal(refined.ok, true, refined.why)
    assert.deepEqual(refined.result.asks, ['Q1', 'Q2'])
    const q1 = await item(dir, 'Q1')
    assert.equal(valueOf(q1, 'Title'), 'Should the hedge be yew?')
    assert.deepEqual(q1.sections.get('Text'), [SHORT], 'its words stay one line, as the refine block holds them')
    assert.deepEqual(askPartsOf(q1), { title: 'Should the hedge be yew?', context: ['40 plants in two rows a hand apart, closed in three years. Advised: yes, it keeps the sheep out'] })
    const q2 = await item(dir, 'Q2')
    assert.equal(valueOf(q2, 'Title'), 'Should the gate face the river?')
    assert.deepEqual(askPartsOf(q2), { title: 'Should the gate face the river?', context: ['Advised: no, the path floods'] })
    const answered = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'yes' }, { index: 1, answer: 'no' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'answered')
    assert.equal(valueOf(await item(dir, 'Q2'), 'State'), 'answered')
    const folded = await advisor({ action: 'refined', size: '30 min', id: 'B7', what: ['A yew hedge in two rows.'] })
    assert.equal(folded.ok, true, folded.why)
  } finally {
    await gone(dir)
  }
})
