// B775, the real case it was made for: on 2026-10-28 the person closed seven obsolete items by hand ("Close all seven"): six
// refine questions on steps the goal chat had built (B753, B755, B766 to B769: Q441, Q443 to Q447) and one Do left from the
// outage of 2026-10-27 (Q435). This replays them from the store the project keeps, put back as they stood open: the
// check's evidence names the commits that built each step, and the close ends where the person's hand did. It reads the
// project's own store beside the board, so it is skipped where there is none (a copy of the board, another PC).

import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { gitRunner } from '../../src/folders.mjs'
import { parseItem, serializeItem } from '../../src/work/item.mjs'
import { workApi } from '../../src/work/api.mjs'
import { obsoleteEvidence } from '../../src/work/obsoleteEvidence.mjs'
import { openItemsOf } from '../../src/work/obsolete.mjs'
import { readStore } from '../../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REAL = join(ROOT, '..', '.claude', 'work')
const STEPS = ['B753', 'B755', 'B766', 'B767', 'B768', 'B769']
const QUESTIONS = ['Q441', 'Q443', 'Q444', 'Q445', 'Q446', 'Q447']
const hasReal = [...STEPS, ...QUESTIONS, 'Q435'].every(id => existsSync(join(REAL, `${id}.md`)))

/** An item of the project's store as it stood open on 2026-10-28 at 16:00. */
async function openAgain(id) {
  const item = parseItem(await readFile(join(REAL, `${id}.md`), 'utf8'))
  const history = (item.sections.get('History') ?? []).filter(line => !/ person: /.test(line))
  item.sections.set('History', history)
  item.sections.delete('Answer')
  if (id.startsWith('B')) item.head.set('State', 'new')
  else {
    item.head.set('State', 'open')
    item.head.set('Since', (history[0] ?? '').match(/\d{4}-\d\d-\d\d \d\d:\d\d/)?.[0] ?? '2026-10-28 12:59')
  }
  return item
}

test('the seven items closed by hand on 2026-10-28, put back open: the check finds the commits that built the steps, and the close ends as the person did', { skip: !hasReal && 'the project\'s own store is not beside this board' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'obsolete-replay-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  for (const id of [...STEPS, ...QUESTIONS, 'Q435']) await writeFile(join(dir, `${id}.md`), serializeItem(await openAgain(id)))
  const now = new Date(2026, 9, 28, 16, 0).getTime()
  const as = chat => ({ dir, now, prefix: 'Game - ', roleOf: name => (name === 'Advisor' ? 'advisor' : null), obsoleteEvidence: async (open, items) => obsoleteEvidence(open, {
    items, lanes: [{ name: 'Worker 2', state: 'working', task: 'a step', isRunning: true }], prefix: 'Game - ', repos: [{ dir: ROOT, base: 'main' }], run: gitRunner(), board: null, mod: null,
  }), ...(chat === null ? { as: 'person' } : {}) })
  const person = body => workApi(body, as(null))
  const advisor = body => workApi({ chat: 'Advisor', ...body }, as('Advisor'))

  assert.deepEqual(openItemsOf((await readStore(dir)).items).map(one => one.id), ['Q435', 'Q441', 'Q443', 'Q444', 'Q445', 'Q446', 'Q447'])
  const started = await person({ action: 'obsolete-check' })
  assert.equal(started.ok, true, started.why)
  // What the Advisor reads: each refine question carries its step, "refined" or new, and the commits that name it since.
  const read = await advisor({ action: 'obsolete' })
  assert.equal(read.ok, true, read.why)
  for (const [question, step] of QUESTIONS.map((one, at) => [one, STEPS[at]])) {
    const block = read.result.text.split('\n').filter((_line, at, all) => all.findIndex(one => one.startsWith(`${question} (`)) <= at).slice(0, 8).join('\n')
    assert.match(block, new RegExp(`${step} is new since`), `${question}: its step stands`)
    assert.match(block, new RegExp(`commits? naming ${step}: `), `${question}: a commit names ${step}`)
  }
  assert.match(read.result.text, /Q435 \(Do\): Restart the worker board/)
  assert.match(read.result.text, /Worker 2 is in the list, working: a step/)

  // The judgement is the Advisor's (a model); here it says what the person said. All seven close as it answers (2026-10-31).
  const points = [...QUESTIONS.map((one, at) => `obsolete: ${one} · ${STEPS[at]} was built by the goal chat · commits name ${STEPS[at]}`), 'obsolete: Q435 · the board works again since the outage · Worker 2 worked on since']
  const closed = await advisor({ action: 'obsolete', points })
  assert.equal(closed.ok, true, closed.why)
  assert.deepEqual(closed.result.failed, [])
  assert.equal(closed.result.closed.length, 7)
  const items = (await readStore(dir)).items
  for (const id of STEPS) assert.equal(items.get(id).head.get('State'), 'done', id)
  for (const id of [...QUESTIONS, 'Q435']) assert.equal(items.get(id).head.get('State'), 'withdrawn', id)
  assert.deepEqual(openItemsOf(items), [], 'nothing is left open')
})
