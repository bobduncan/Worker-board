// Focus 3: a refine answer also answers its ask, and an ask answered on its own also answers its question in the
// refine block, also for a question longer than an ask's title (seen live: a title cut at a space no longer matched
// its question, the asks stayed open and the store refused the fold). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseBacklog, refinedOf } from '../../src/backlog.mjs'
import { stepLine, stepNotes } from '../../src/work/adapter.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const NOW = new Date(2026, 9, 18, 14, 55).getTime()
const BACKLOG = ['# Backlog', '', '## Board work', '- [ ] B7 Bats, a fast and weak swarm', ''].join('\n')
const ROLES = { Main: 'main', Advisor: 'advisor' }
// Longer than an ask's title once was (200), with a space where it was cut. B462: it leads with a short question.
const LONG = `Do bats ignore lava? They fly: they cross lava and gaps while moving, and a push into lava does not kill them, so you must hit them instead of pushing them off. I advise yes: then they need their own answer, as you asked, where a push would solve them as it solves the rest.`
const SHORT = 'Three bats at a time?'

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'refine-asks-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Team - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set() }
  return { dir, advisor: body => workApi({ chat: 'Advisor', ...body }, ctx), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)
const questionsOf = async dir => {
  const step = await item(dir, 'B7')
  return refinedOf(parseBacklog(`## Board work\n${stepLine(step)}\n${stepNotes(step).join('\n')}\n`).activities[0].steps[0].notes).questions
}

test('the long question has a space at 200 characters, where an ask\'s title was once cut', () => {
  assert.equal(LONG.replace(/\s+/g, ' ').trim().slice(0, 200).at(-1), ' ')
})

test('an answer in the refine window answers the ask made for that question, with a History line, also a long one', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    const refined = await advisor({ action: 'refine', id: 'B7', summary: 'A swarm of bats.', questions: [SHORT, LONG] })
    assert.deepEqual(refined.result.asks, ['Q1', 'Q2'])
    const answered = await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 1, answer: 'yes' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    const q2 = await item(dir, 'Q2')
    assert.equal(valueOf(q2, 'State'), 'answered')
    assert.deepEqual(q2.sections.get('Answer'), ['yes'])
    assert.match(q2.sections.get('History').at(-1), /person: answered in the step's window: yes$/)
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'open')
    // The other one in the window too: the fold is no longer refused.
    await person({ action: 'refine-answer', id: 'B7', answers: [{ index: 0, answer: 'no' }], feedback: '' })
    assert.equal(valueOf(await item(dir, 'Q1'), 'State'), 'answered')
    const folded = await advisor({ action: 'refined', id: 'B7', what: ['Bats come one at a time.'] })
    assert.equal(folded.ok, true, folded.why)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('an ask answered on its own writes its answer into the block\'s question, also a long one', async () => {
  const { dir, advisor, person } = await fresh()
  try {
    await advisor({ action: 'refine', id: 'B7', summary: 'A swarm of bats.', questions: [SHORT, LONG] })
    const answered = await person({ action: 'answer', id: 'Q2', text: 'yes' })
    assert.equal(answered.ok, true, answered.why)
    assert.deepEqual((await questionsOf(dir)).map(one => one.answer), [null, 'yes'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
