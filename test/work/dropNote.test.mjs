// B464: a refine question that asks to drop a step, answered "yes", goes to the main chat as a note at once: the
// partner cannot drop a step, so the answer never waits on it (B17 waited two days). The person, 2026-10-21: "i dont
// see this. please fix the notification for that". Made-up samples only.
// B810: the question names the step itself ("Drop B7?", "drop it"); a question about dropping one part of the step
// (B804's "Drop the one-minute guess once ...?") makes no note: its yes had Main drop the whole step.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 21, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Pond', '- [ ] B7 Dig the old pond', ''].join('\n')
const ROLES = { Main: 'main', Digger: 'worker', Advisor: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'drop-note-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Digger']) }
  return {
    dir,
    advisor: body => workApi({ chat: 'Advisor', ...body }, ctx),
    person: body => workApi(body, { ...ctx, as: 'person' }),
  }
}
const notesToMain = async dir => [...(await readStore(dir)).items.values()]
  .filter(item => valueOf(item, 'Kind') === 'note' && valueOf(item, 'To') === 'main')

test('B464: "yes" to a refine question that drops the step is a note to the main chat at once, in the step\'s window', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    await advisor({ action: 'refine', id: 'B7', summary: 'All of it stands elsewhere.', questions: ['Which spade?', 'Drop B7, since every part of it stands in another step?'] })
    assert.deepEqual(await notesToMain(dir), [])
    const done = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 1, answer: 'yes' }], feedback: '' })
    assert.equal(done.ok, true, done.why)
    const notes = await notesToMain(dir)
    assert.equal(notes.length, 1)
    assert.equal(valueOf(notes[0], 'From'), 'person')
    assert.deepEqual(notes[0].sections.get('About'), ['B7'])
    assert.match(notes[0].sections.get('Text').join(' '), /^B7: the person answered "yes" to "Drop B7, since .*": drop it; the partner cannot drop a step\.$/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B464: the same when the drop question is answered under Needs your attention; "no" and other questions make no note', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    await advisor({ action: 'refine', id: 'B7', summary: 'Maybe.', questions: ['Drop B7?', 'Which spade?'] })
    // Another question, answered yes: no note.
    assert.equal((await person({ action: 'answer', id: 'Q2', text: 'yes, the big one' })).ok, true)
    assert.deepEqual(await notesToMain(dir), [])
    assert.equal((await person({ action: 'answer', id: 'Q1', text: 'Yes, drop it' })).ok, true)
    const notes = await notesToMain(dir)
    assert.equal(notes.length, 1)
    assert.match(valueOf(notes[0], 'Text'), /^B7: the person answered "Yes, drop it" to "Drop B7\?": drop it/)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  const again = await fresh()
  try {
    await again.advisor({ action: 'refine', id: 'B7', summary: 'Maybe.', questions: ['Drop B7?'] })
    await again.person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'no, keep it' }], feedback: '' })
    assert.deepEqual(await notesToMain(again.dir), [])
    // A question about another drop, or a yes with a but: no note either.
    await again.advisor({ action: 'refine', id: 'B7', summary: 'Again.', questions: ['A drop shadow under the pond?', 'Drop B7?'] })
    await again.person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'yes' }, { index: 1, answer: 'yes, but not yet' }], feedback: '' })
    assert.deepEqual(await notesToMain(again.dir), [])
  } finally {
    await rm(again.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('B810: "yes" to dropping a part of the step makes no note; a question that names the step still does', async () => {
  const cases = [
    ['Drop the one-minute guess once the app\'s signal works? Then each card comes from one source and no popup shows twice; a call that hangs without a popup is no approval. Advised: yes, one source, no double cards', 0],
    ['Drop the spade rack before digging?', 0],
    ['Drop B7, since every part of it stands in another step?', 1],
    ['Drop B7?', 1],
    ['Should we drop it?', 1],
    ['Drop this step, as B9 covers it?', 1],
  ]
  for (const [question, want] of cases) {
    const { dir, advisor, person } = await fresh()
    try {
      await advisor({ action: 'refine', id: 'B7', summary: 'Maybe.', questions: [question] })
      const done = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'yes' }], feedback: '' })
      assert.equal(done.ok, true, done.why)
      assert.equal((await notesToMain(dir)).length, want, question)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})
