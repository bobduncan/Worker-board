// B299: asks `Q<n>` by kind (spec 2026-10-17, sections 5 and 8): the "For you" block in the project's form, an answer
// that carries the ask's own id, refine questions as asks, the app's question form, and notes read. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseBacklog, refinedOf, withoutRefined } from '../../src/backlog.mjs'
import { stepLine, stepNotes, storeProblems } from '../../src/work/adapter.mjs'
import { forYouBlock, workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const BACKLOG = [
  '# Backlog', '', '## Board work',
  '- [ ] B1 Draw the strip (for Board; about 1 h)',
  '- [ ] B2 Keep the cards apart (for Support; about 30 min)',
  '- [ ] B7 An unrefined step',
  '- [ ] B9 Pick the colour of the strip @you',
  '',
].join('\n')
const ROLES = { Main: 'main', Board: 'worker', Support: 'worker', Advisor: 'advisor' }
const URL = 'http://127.0.0.1:4310'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-asks-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Board', 'Support']), boardUrl: URL }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, main: as('Main'), board: as('Board'), support: as('Support'), advisor: as('Advisor'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const state = async (dir, id) => valueOf(await item(dir, id), 'State')

test('the block of a look with a picture and a play link, in the project\'s form, opening the board', () => {
  assert.equal(forYouBlock({ id: 'Q4', of: 'B1', kind: 'look', blocking: true, title: 'Is the strip readable?', options: ['A thin', 'B thick'], advice: 'B', pictures: ['art-inbox/strip/thin-or-thick.png'], play: 'b1-strip&screen=shop' }, URL), [
    '> **For you**',
    '> 1. **Answer:** Is the strip readable? A thin or B thick; I advise B (Q4, look, blocks task B1)',
    '>    [See the picture: thin or thick](http://127.0.0.1:4310/#picture=art-inbox/strip/thin-or-thick.png)',
    '>    [Play it: screen shop](http://127.0.0.1:4310/#play=b1-strip&screen=shop)',
  ].join('\n'))
  // A do is a "Do:"; an ask under no step names none; a play link with only a branch names the branch.
  assert.equal(forYouBlock({ id: 'Q5', kind: 'do', title: 'Restart the app', play: 'main' }, URL), '> **For you**\n> 1. **Do:** Restart the app (Q5, do)\n>    [Play it: main](http://127.0.0.1:4310/#play=main)')
  assert.equal(forYouBlock({ id: 'Q6', of: 'B2', kind: 'provide', title: 'The sound file', advice: 'a short one' }), '> **For you**\n> 1. **Do:** The sound file I advise a short one. (Q6, provide on task B2)')
})

test('ask answers with that block and keeps the advice; an answer carries the ask\'s id, not the chat\'s state', async () => {
  const { dir, board, person } = await fresh()
  try {
    // Partner answers (2026-10-19) off: the person answers it, as before.
    await writeFile(join(dir, 'partner-answers.json'), '{"on":false}\n')
    await board({ action: 'take', id: 'B1' })
    const first = await board({ action: 'ask', of: 'B1', kind: 'decide', text: 'Thin or thick?', options: ['A thin', 'B thick'], advice: 'B', blocking: true })
    assert.equal(first.ok, true, first.why)
    assert.equal(first.result.text, '> **For you**\n> 1. **Answer:** Thin or thick? A thin or B thick; I advise B (Q1, decide, blocks task B1)')
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
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('review: the asking chat closes its own ask with the person\'s words from the chat; the step it blocked goes on', async () => {
  const { dir, board, support } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Thin or thick?' })
    assert.equal(await state(dir, 'B1'), 'waiting on you')
    assert.equal((await support({ action: 'answered-in-chat', id: 'Q1', text: 'thick' })).status, 409)
    const done = await board({ action: 'answered-in-chat', id: 'Q1', text: 'thick, the person said in the chat' })
    assert.equal(done.ok, true, done.why)
    assert.equal(await state(dir, 'Q1'), 'answered')
    assert.deepEqual((await item(dir, 'Q1')).sections.get('Answer'), ['thick, the person said in the chat'])
    assert.equal((await item(dir, 'Q1')).sections.get('History').at(-1), '- 2026-10-17 11:06 Board: answered in the chat: thick, the person said in the chat')
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.equal((await board({ action: 'answered-in-chat', id: 'Q1', text: 'again' })).result.changed, false)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B293: a refine question answered under Needs your attention is answered in the block, and lines added under the step stay out of it', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    await advisor({ action: 'refine', id: 'B7', summary: 'One strip per step.', size: '1 h', questions: ['Thin, not thick? Advised: yes, quicker to read', 'Blue? Advised: no, too dark'] })
    await person({ action: 'answer', id: 'Q1', text: 'no' })
    const step = await item(dir, 'B7')
    const notes = parseBacklog(`## Board work\n${stepLine(step)}\n${stepNotes(step).join('\n')}\n`).activities[0].steps[0].notes
    const refined = refinedOf(notes)
    assert.deepEqual(refined.questions, [
      { text: 'Thin, not thick?', answer: 'no', advice: 'yes', why: 'quicker to read' },
      { text: 'Blue?', answer: null, advice: 'no', why: 'too dark' },
    ])
    assert.equal(refined.size, 'about 1 h')
    // What the store wrote under the step about the asks stands apart from the block, before it.
    const rest = withoutRefined(notes)
    assert.ok(rest.some(line => /^Q1 answered by you on .*: no$/.test(line.trim())))
    // Answered in the window too: the other ask follows, and none is left open.
    await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 1, answer: 'yes' }], feedback: '' })
    assert.deepEqual([await state(dir, 'Q1'), await state(dir, 'Q2')], ['answered', 'answered'])
    const after = await item(dir, 'B7')
    const again = refinedOf(parseBacklog(`## Board work\n${stepLine(after)}\n${stepNotes(after).join('\n')}\n`).activities[0].steps[0].notes)
    assert.deepEqual(again.questions.map(one => one.answer), ['no', 'yes'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

// B305: an ask carried over from the old backlog has no asking chat; the person answers it in the main chat or the
// Advisor's, and that chat closes it with their words. Made-up samples only.
test('B305: an ask with no asking chat is closed in the main chat or the Advisor\'s with the person\'s words; a worker may not', async () => {
  const { dir, main, advisor, board } = await fresh()
  try {
    assert.equal(valueOf(await item(dir, 'B9'), 'Owner'), null)
    assert.equal(await state(dir, 'B9'), 'open')
    // A worker may not close an ask that is not its own.
    const refused = await board({ action: 'answered-in-chat', id: 'B9', text: 'blue' })
    assert.equal(refused.status, 409)
    assert.match(refused.why, /no asking chat: only the main chat or the Advisor/)
    // The person's words are needed.
    assert.equal((await main({ action: 'answered-in-chat', id: 'B9' })).status, 400)
    const done = await main({ action: 'answered-in-chat', id: 'B9', text: 'blue (2026-10-17)' })
    assert.equal(done.ok, true, done.why)
    const b9 = await item(dir, 'B9')
    assert.equal(valueOf(b9, 'State'), 'answered')
    assert.deepEqual(b9.sections.get('Answer'), ['blue (2026-10-17)'])
    assert.equal(b9.sections.get('History').at(-1), '- 2026-10-17 11:06 Main: answered in its chat by the person: blue (2026-10-17)')
    const store = await readStore(dir)
    assert.deepEqual(storeProblems(store.items, store.activities), [])
    // The Advisor may do the same with another one; an Owner of "-" is no asking chat either.
    const again = await readStore(dir)
    again.items.get('B9').head.set('State', 'open')
    again.items.get('B9').head.set('Owner', '-')
    await writeStore(dir, again, undefined, { now: NOW })
    const byAdvisor = await advisor({ action: 'answered-in-chat', id: 'B9', text: 'green, said in the Advisor\'s chat' })
    assert.equal(byAdvisor.ok, true, byAdvisor.why)
    assert.equal((await item(dir, 'B9')).sections.get('History').at(-1), '- 2026-10-17 11:06 Advisor: answered in its chat by the person: green, said in the Advisor\'s chat')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B305: an ask with an asking chat stays that chat\'s to close, also for the main chat and the Advisor', async () => {
  const { dir, main, advisor, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Thin or thick?' })
    assert.equal((await main({ action: 'answered-in-chat', id: 'Q1', text: 'thick' })).status, 409)
    assert.equal((await advisor({ action: 'answered-in-chat', id: 'Q1', text: 'thick' })).status, 409)
    assert.equal((await main({ action: 'withdraw', id: 'Q1', why: 'gone' })).status, 409)
    assert.equal(await state(dir, 'Q1'), 'open')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B305: the step an ask with no asking chat blocked goes on when the main chat closes it', async () => {
  const { dir, main, board } = await fresh()
  try {
    await board({ action: 'take', id: 'B1' })
    await board({ action: 'ask', of: 'B1', kind: 'decide', blocking: true, text: 'Thin or thick?' })
    assert.equal(await state(dir, 'B1'), 'waiting on you')
    const store = await readStore(dir)
    store.items.get('Q1').head.delete('Owner')
    await writeStore(dir, store, undefined, { now: NOW })
    const done = await main({ action: 'answered-in-chat', id: 'Q1', text: 'thick, the person said on 2026-10-17' })
    assert.equal(done.ok, true, done.why)
    assert.equal(await state(dir, 'Q1'), 'answered')
    assert.equal(await state(dir, 'B1'), 'in progress')
    assert.ok((await item(dir, 'B1')).sections.get('Context').some(one => /Q1 answered in Main's chat by the person on .*: thick, the person said on 2026-10-17$/.test(one.trim())))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B305: withdraw of an ask with no asking chat: the main chat only, with a why', async () => {
  const { dir, main, advisor, board } = await fresh()
  try {
    assert.equal((await board({ action: 'withdraw', id: 'B9', why: 'gone' })).status, 409)
    assert.equal((await advisor({ action: 'withdraw', id: 'B9', why: 'gone' })).status, 409)
    assert.equal((await main({ action: 'withdraw', id: 'B9' })).status, 400)
    const done = await main({ action: 'withdraw', id: 'B9', why: 'the strip has no colour any more' })
    assert.equal(done.ok, true, done.why)
    assert.equal(await state(dir, 'B9'), 'withdrawn')
    assert.equal((await item(dir, 'B9')).sections.get('History').at(-1), '- 2026-10-17 11:06 Main: withdrawn: the strip has no colour any more')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B305: a step blocked by an ask no longer shows "after" it once the ask is answered', async () => {
  const { dir, main, board } = await fresh()
  try {
    assert.equal((await main({ action: 'block', id: 'B1', on: 'B9' })).ok, true)
    assert.match((await board({ action: 'next' })).result.text, /- B1 \w+ \(after B9\)/)
    await main({ action: 'answered-in-chat', id: 'B9', text: 'blue (2026-10-17)' })
    assert.doesNotMatch((await board({ action: 'next' })).result.text, /after B9/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
