// B452: an ask leads with a short title, the question itself, and carries its brief context apart: the work tool's ask
// takes "title" (at most 12 words, refused when longer) and "text" (the context); an ask without a title field must
// open with a short first line. An ask from before (one long line) shows its question, or its first sentence, as the
// title and the rest as context. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { TITLE_WORDS, askTitleOf, titleProblem } from '../../src/work/askWords.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { storeNeeds } from '../../src/work/lists.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 20, 22, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Digger: 'worker', Advisor: 'advisor' }
const URL = 'http://127.0.0.1:4310'

/** A long ask as one line, the way asks were written before B452: two sentences of numbers, then the question. */
const LONG = 'The re-check of the hedge, the point only you can judge: of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds. '
  + 'That was 11 nettles, 4 thistles and 11 brambles. Does that weeding belong to the hedge, or to the lawn, where "no weed twice" is already the goal?'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-ask-title-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Digger']), boardUrl: URL }
  return { dir, digger: body => workApi({ chat: 'Digger', ...body }, ctx) }
}
const needOf = async (dir, id) => storeNeeds({ ok: true, dir, ...(await readStore(dir)) }, { now: NOW + 120_000 }).find(one => one.workId === id)

test('a title is the question itself: at most 12 words, and a longer one says why', () => {
  assert.equal(TITLE_WORDS, 12)
  assert.equal(titleProblem('Should the hedge be yew or box, cut low along the path?'), null)
  const why = titleProblem('Should the hedge along the path be yew or box, and cut low or high this year?')
  assert.match(why, /17 words/)
  assert.match(why, /at most 12 words/)
  assert.match(why, /"text"/, 'it says where the rest goes')
  assert.match(titleProblem(`${'Hedgerowsandmeadowsandorchards'.repeat(5)}?`), /characters/, 'a few very long words are too long too')
})

test('an ask with a title: the title is its first line, the context the lines after it', () => {
  assert.deepEqual(askTitleOf(['Yew or box for the hedge?', 'Yew grows slowly. Box is cheaper.']),
    { title: 'Yew or box for the hedge?', context: ['Yew grows slowly. Box is cheaper.'] })
  assert.deepEqual(askTitleOf(['Yew or box for the hedge?']), { title: 'Yew or box for the hedge?', context: [] })
})

test('an ask from before B452, one long line: its question is the title, the rest of its words the context in their order', () => {
  const { title, context } = askTitleOf([LONG])
  assert.equal(title, 'Does that weeding belong to the hedge, or to the lawn, where "no weed twice" is already the goal?')
  assert.deepEqual(context, ['The re-check of the hedge, the point only you can judge: of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds. That was 11 nettles, 4 thistles and 11 brambles.'])
  // Without a question: its first sentence; an abbreviation ends none.
  assert.deepEqual(askTitleOf(['Plant the hedge before Tuesday along the long path by the barn, e.g. Yew. The cows wait. The rain comes on Wednesday.', 'More below.']),
    { title: 'Plant the hedge before Tuesday along the long path by the barn, e.g. Yew.', context: ['The cows wait. The rain comes on Wednesday.', 'More below.'] })
})

test('the work tool files a title and its context apart; the "For you" block carries the title, not the context', async () => {
  const { dir, digger } = await fresh()
  const asked = await digger({ action: 'ask', of: 'B1', kind: 'decide', title: 'Yew or box for the hedge?', text: 'Yew grows slowly but lives long.\nBox is cheaper and grows fast.' })
  assert.equal(asked.ok, true, asked.why)
  const q = (await readStore(dir)).items.get(asked.result.id)
  assert.equal(valueOf(q, 'Title'), 'Yew or box for the hedge?')
  assert.deepEqual(q.sections.get('Text'), ['Yew or box for the hedge?', 'Yew grows slowly but lives long.', 'Box is cheaper and grows fast.'])
  assert.match(asked.result.text, /\*\*Answer:\*\* Yew or box for the hedge\? \(Q\d+, decide on B1\)/)
  assert.doesNotMatch(asked.result.text, /grows slowly/, 'the context stays on the board')
  // The board's card and window: the title as the header, the context as the words under it.
  const need = await needOf(dir, asked.result.id)
  assert.equal(need.title, 'Yew or box for the hedge?')
  assert.equal(need.question, 'Yew or box for the hedge?')
  assert.equal(need.text, 'Yew grows slowly but lives long.\nBox is cheaper and grows fast.')
})

test('a title over 12 words is refused with why, and nothing is filed', async () => {
  const { dir, digger } = await fresh()
  const before = (await readStore(dir)).items.size
  const long = await digger({ action: 'ask', of: 'B1', kind: 'decide', title: 'Should the hedge along the path be yew or box, and cut low or high this year?', text: 'Yew grows slowly.' })
  assert.equal(long.ok, false)
  assert.equal(long.status, 400)
  assert.match(long.why, /17 words/)
  // Without a title field, the text's first line is the title: one long line is refused the same way, naming "title".
  const oneLine = await digger({ action: 'ask', of: 'B1', kind: 'decide', text: LONG })
  assert.equal(oneLine.ok, false)
  assert.match(oneLine.why, /"title"/)
  assert.equal((await readStore(dir)).items.size, before)
  // A short first line stays an ask as before: its title, and the lines after it its context.
  const short = await digger({ action: 'ask', of: 'B1', kind: 'look', text: 'Is the hedge straight?\nThe picture shows it from the gate.' })
  assert.equal(short.ok, true, short.why)
  assert.equal(valueOf((await readStore(dir)).items.get(short.result.id), 'Title'), 'Is the hedge straight?')
})

test('an ask the mod files from the app\'s form keeps its words; its title is its question', async () => {
  const { dir, digger } = await fresh()
  const asked = await digger({ action: 'ask', kind: 'decide', via: 'form', text: LONG })
  assert.equal(asked.ok, true, asked.why)
  const q = (await readStore(dir)).items.get(asked.result.id)
  assert.equal(valueOf(q, 'Title'), 'Does that weeding belong to the hedge, or to the lawn, where "no weed twice" is already the goal?')
  assert.deepEqual(q.sections.get('Text'), [LONG], 'its words as the form had them')
})

test('the review of B452: a short question the mod filed shows once; an abbreviation ends no sentence; a repeated title is dropped', async () => {
  const { dir, digger } = await fresh()
  const words = 'Of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds, mostly nettles and thistles pulled by hand. Does the weeding belong to the hedge?'
  const filed = await digger({ action: 'ask', kind: 'decide', via: 'chat', text: words })
  const need = await needOf(dir, filed.result.id)
  assert.equal(need.title, 'Does the weeding belong to the hedge?')
  assert.equal(need.text, 'Of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds, mostly nettles and thistles pulled by hand.')
  assert.equal(askTitleOf(['Plant approx. 40 hedges along the whole river path before the rain comes on Wednesday, as agreed. Then rest.']).title,
    'Plant approx. 40 hedges along the whole river path before the rain comes on Wednesday, as agreed.')
  const twice = await digger({ action: 'ask', of: 'B1', kind: 'decide', title: 'Yew or box?', text: 'Yew or box? Yew grows slowly.' })
  assert.deepEqual((await readStore(dir)).items.get(twice.result.id).sections.get('Text'), ['Yew or box?', 'Yew grows slowly.'])
})

test('an old ask, one long line in the store: the board shows its question as the title and the rest as the context', async () => {
  const { dir, digger } = await fresh()
  const asked = await digger({ action: 'ask', kind: 'decide', via: 'form', text: LONG })
  const need = await needOf(dir, asked.result.id)
  assert.equal(need.title, 'Does that weeding belong to the hedge, or to the lawn, where "no weed twice" is already the goal?')
  assert.equal(need.question, need.title)
  assert.equal(need.text, 'The re-check of the hedge, the point only you can judge: of 65 plants that reached the garden in two days, 39 were yew and 26 were weeds. That was 11 nettles, 4 thistles and 11 brambles.')
})
