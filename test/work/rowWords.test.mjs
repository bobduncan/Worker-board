// 2026-11-07 (the person rejected G60's side stairs more than fifteen times; each new try saw only the last "no"): every try of a
// recap row sees all the person's earlier words on it. Pure tests of the words (recaps.mjs `recapVerdictsOf`, rowWords.mjs) and the
// work API on a made-up store (`new` with `of`, `next`, `take`, `refine`). The live case is modelled with made-up ids and words.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { recapVerdictsOf } from '../../src/recaps.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { rowWordsOf, rowWordsText } from '../../src/work/rowWords.mjs'
import { readItemFile, writeItem } from '../../src/work/store.mjs'
import { YOUR_WORDS, wordsPoint } from '../../src/work/yourWords.mjs'
import { fresh, item, remove } from '../qaKit.mjs'

const ERROR = 'The page shows an error from the build tool.'
const REJECTED = 'more then 1 cell wide need to feel like a single stair not multiple stairs'
const ROUND1 = 'the stairs are stepped, round them'
const ROUND7 = 'still looks like many stairs side by side'

/** A step of a made-up store: `fixOf`, `state`, `checks` (a QA task) and `points` ([at, ask id | null, words]). */
function step(id, { fixOf = null, state = 'review', checks = null, points = [] } = {}) {
  const head = new Map([['Id', id], ['Kind', 'step'], ['Title', `Title of ${id}`], ['State', state]])
  if (fixOf !== null) head.set('Fix of', fixOf)
  if (checks !== null) head.set('Checks', checks)
  const sections = new Map()
  if (points.length > 0) sections.set(YOUR_WORDS, points.flatMap(([at, ask, answer], n) => wordsPoint({ n: n + 1, at, how: ask === null ? 'note (on the board)' : `answer to ${ask}`, answer }).split('\n')))
  return { head, sections }
}
const storeOf = (...steps) => new Map(steps.map(one => [valueOf(one, 'Id'), one]))
const ROUNDS = [
  { n: 1, at: '2026-11-02 16:17', parts: [{ key: '14. Side stairs', verdict: 'sent-back', comment: ROUND1 }, { key: '2. Walls', verdict: 'approved', comment: '' }] },
  { n: 2, at: '2026-11-03 09:00', parts: [{ key: '14. Side stairs', verdict: 'sent-back', comment: '  ' }] },
  { n: 7, at: '2026-11-07 08:35', parts: [{ key: '14. Side stairs', verdict: 'sent-back', comment: ROUND7 }] },
]
const RECAP = { goal: 'G60', path: 'art-inbox/g60/recap/demo.json', parts: [], rows: [{ key: '14. Side stairs', title: 'Side stairs', steps: ['B1020'] }, { key: '2. Walls', title: 'Walls', steps: [] }, { key: '3. Roof', title: 'Roof', steps: ['B9'] }], rounds: ROUNDS }
const ROWS = recapVerdictsOf([RECAP])

/** B1020 has two points; B1031 (fix of B1020) carries only the first; B1046 fixes B1031, B1054 fixes B1046. */
const chain = (...more) => storeOf(
  step('B1020', { points: [['2026-11-02 21:27', 'Q600', ERROR], ['2026-11-04 23:03', 'Q610', REJECTED]] }),
  step('B1031', { fixOf: 'B1020', points: [['2026-11-02 21:27', 'Q600', ERROR]] }),
  step('B1046', { fixOf: 'B1031' }), step('B1054', { fixOf: 'B1046', state: 'in progress' }), ...more)

test('recapVerdictsOf: a row gets its comments per round, oldest first; a row without comments gets none; a blank comment is none', () => {
  const [stairs, walls, roof] = ROWS
  assert.deepEqual(stairs.words, [{ round: 1, at: '2026-11-02 16:17', verdict: 'sent-back', comment: ROUND1 }, { round: 7, at: '2026-11-07 08:35', verdict: 'sent-back', comment: ROUND7 }])
  assert.deepEqual([walls.words, roof.words], [[], []])
  assert.deepEqual([stairs.verdict, stairs.round, stairs.key], ['sent-back', 7, '14. Side stairs'])
  // Matched as standOf does: by the row's key.
  assert.deepEqual(recapVerdictsOf([{ ...RECAP, rows: [{ key: 'Side stairs', title: 'Side stairs', steps: [] }] }])[0].words, [])
})

test('rowWordsOf: B1054 holds the rejection, both recap comments and the first point once, sorted', () => {
  const found = rowWordsOf('B1054', chain(), ROWS)
  assert.deepEqual(found.rows, [{ key: '14. Side stairs', title: 'Side stairs', path: 'art-inbox/g60/recap/demo.json' }])
  assert.deepEqual(found.words.map(one => [one.at, one.where, one.words]), [
    ['2026-11-02 16:17', 'recap round 1, row "Side stairs", sent-back', ROUND1],
    ['2026-11-02 21:27', 'B1020, Q600', ERROR],
    ['2026-11-04 23:03', 'B1020, Q610', REJECTED],
    ['2026-11-07 08:35', 'recap round 7, row "Side stairs", sent-back', ROUND7],
  ])
})

test('rowWordsOf: a new step "Fix of: B1054" gets the same words plus the points of B1054', () => {
  const items = chain(step('B1064', { fixOf: 'B1054', state: 'new' }))
  items.get('B1054').sections.set(YOUR_WORDS, wordsPoint({ n: 1, at: '2026-11-06 12:00', how: 'note (on the board)', answer: 'the top is wrong too' }).split('\n'))
  const found = rowWordsOf('B1064', items, ROWS)
  assert.deepEqual(found.words.map(one => one.words), [ROUND1, ERROR, REJECTED, 'the top is wrong too', ROUND7])
  // The step's own point is left out: it is shown with the step.
  assert.equal(rowWordsOf('B1054', items, ROWS).words.some(one => one.words === 'the top is wrong too'), false)
})

test('rowWordsOf: no chain and no row gives null; own words alone are no earlier words; a step the row names sees the chain', () => {
  assert.equal(rowWordsOf('B5', storeOf(step('B5')), ROWS), null)
  assert.equal(rowWordsOf('B5', storeOf(step('B5', { points: [['2026-11-01 10:00', 'Q1', 'own words']] })), []), null)
  // B1020 is named by the row: its own points are shown with it, the copy on B1031 equals one of them; the recap comments remain.
  const found = rowWordsOf('B1020', chain(), ROWS)
  assert.deepEqual(found.words.map(one => one.words), [ROUND1, ROUND7])
})

test('rowWordsOf: a Quality Assurance task is left out, a cycle is safe, a dropped step counts', () => {
  const qa = step('B1100', { fixOf: 'B1054', checks: 'B1054', points: [['2026-11-05 10:00', 'Q700', 'a qa point']] })
  const dropped = step('B1101', { fixOf: 'B1054', state: 'dropped', points: [['2026-11-05 11:00', null, 'dropped but said']] })
  const items = chain(qa, dropped)
  const words = rowWordsOf('B1054', items, ROWS).words.map(one => one.words)
  assert.equal(words.includes('a qa point'), false)
  assert.equal(words.includes('dropped but said'), true)
  // A cycle: B1020 is a fix of B1054.
  items.get('B1020').head.set('Fix of', 'B1054')
  assert.ok(rowWordsOf('B1054', items, ROWS).words.length >= 4)
  assert.ok(rowWordsOf('B1020', items, ROWS).words.length >= 2)
})

test('rowWordsOf: the note the board writes on a step for a recap Send is the same words as the recap comment, shown once', () => {
  const items = chain()
  items.get('B1020').sections.set(YOUR_WORDS, [...items.get('B1020').sections.get(YOUR_WORDS), ...wordsPoint({ n: 3, at: '2026-11-07 08:35', how: 'note (on the board)', answer: `Sent back in the recap of G60, round 7: 14. Side stairs: "${ROUND7}"` }).split('\n')])
  const words = rowWordsOf('B1054', items, ROWS).words
  assert.equal(words.filter(one => one.words.includes(ROUND7)).length, 1)
  assert.equal(words.length, 4)
})

test('rowWordsText: the header, newest first, the cut at chars, the older line with the files', () => {
  const found = rowWordsOf('B1054', chain(), ROWS)
  const all = rowWordsText(found).split('\n')
  assert.equal(all[0], 'The person\'s earlier words on this part (recap row "Side stairs"; 4 in all, newest first). Check every one, met or not met, before you ask the person, report or suggest a new way; never ask what they answered there:')
  assert.deepEqual(all.slice(1), [
    `- 2026-11-07 08:35 · recap round 7, row "Side stairs", sent-back: "${ROUND7}"`,
    `- 2026-11-04 23:03 · B1020, Q610: "${REJECTED}"`,
    `- 2026-11-02 21:27 · B1020, Q600: "${ERROR}"`,
    `- 2026-11-02 16:17 · recap round 1, row "Side stairs", sent-back: "${ROUND1}"`,
  ])
  // The cut.
  assert.match(rowWordsText(found, { chars: 10 }).split('\n')[1], /: "still look…"$/)
  // The over-max line: a budget for one line (at least one is shown); the rest named by their files.
  const few = rowWordsText(found, { budget: 10 }).split('\n')
  assert.equal(few.length, 3)
  assert.equal(few[2], '(3 older words in .claude/work/B1020.md and art-inbox/g60/recap/feedback.json)')
  // No row: its earlier tries. Nothing: ''.
  assert.match(rowWordsText({ rows: [], words: [{ at: 'x', where: 'B1, a note', words: 'w', file: 'B1' }] }), /^The person's earlier words on this part \(its earlier tries; 1 in all/)
  assert.equal(rowWordsText(null), '')
})

const STAIRS = { goal: 'G3', path: 'art-inbox/g3/recap/demo.json', key: '1. Stairs', title: 'Stairs', steps: ['B1'], verdict: 'sent-back', round: 1, words: [{ round: 1, at: '2026-11-02 16:17', verdict: 'sent-back', comment: ROUND1 }] }

/** The first step of a fresh store, made by the partner: B1. */
async function origin(store) {
  const first = await store.partner({ action: 'new', title: 'Build the side stairs', activity: 'Lamps', goal: 'G3' })
  assert.equal(first.ok, true, first.why)
  return first.result.id
}

test('api: new with "of" writes Fix of and the history line; an unknown "of" and a goal are refused', async () => {
  const store = await fresh()
  try {
    const first = await origin(store)
    const made = await store.partner({ action: 'new', title: 'Build the side stairs again', activity: 'Lamps', goal: 'G3', of: first })
    assert.equal(made.ok, true, made.why)
    const file = await readFile(join(store.dir, `${made.result.id}.md`), 'utf8')
    assert.match(file, new RegExp(`Since: [^\\n]*\\nFix of: ${first}\\n`))
    assert.match(file, new RegExp(`made, the next try of ${first}`))
    assert.equal(valueOf(await item(store.dir, made.result.id), 'Fix of'), first)
    const unknown = await store.partner({ action: 'new', title: 'Another try', activity: 'Lamps', of: 'B999' })
    assert.equal(unknown.status, 400)
    assert.equal(unknown.why, '"of" names the step this is the next try of (B<n>); B999 is no step.')
    const goal = await store.partner({ action: 'new', title: 'Another try', activity: 'Lamps', of: 'G60' })
    assert.equal(goal.status, 400)
    assert.equal(goal.why, 'Name the goal in "goal".')
  } finally {
    await remove(store.dir)
  }
})

test('api: the refine reply shows words that landed on the origin after the try was made', async () => {
  const store = await fresh()
  try {
    const first = await origin(store)
    const made = await store.partner({ action: 'new', title: 'Build the side stairs again', activity: 'Lamps', goal: 'G3', of: first })
    const file = await readItemFile(store.dir, first)
    const written = await writeItem(store.dir, { ...file.item, sections: new Map([...file.item.sections, [YOUR_WORDS, wordsPoint({ n: 1, at: '2026-11-04 23:03', how: 'answer to Q610', answer: REJECTED }).split('\n')]]) }, undefined, { expected: file.text })
    assert.equal(written.ok, true, written.why)
    const refined = await store.partner({ action: 'refine', id: made.result.id, summary: 'Build it as one stair.' })
    assert.equal(refined.ok, true, refined.why)
    assert.match(refined.result.text, new RegExp(`The person's earlier words on this part \\(its earlier tries; 1 in all, newest first\\)[^\\n]*\\n- 2026-11-04 23:03 · ${first}, Q610: "${REJECTED}"`))
  } finally {
    await remove(store.dir)
  }
})

test('api: work next and take show the recap comments of the row below the step', async () => {
  const store = await fresh()
  try {
    // The fresh store holds B1 (queued for the Lamplighter, who sees it first).
    const first = 'B1'
    const none = await store.as('Lamplighter')({ action: 'next' })
    assert.doesNotMatch(none.result.text, /earlier words on this part/, 'no row names it')
    const ctx = { ...store.ctx, recapRows: [{ ...STAIRS, steps: [first] }] }
    const shown = await workApi({ chat: 'Lamplighter', action: 'next' }, ctx)
    assert.match(shown.result.text, new RegExp(`\\n\\nThe person's earlier words on this part \\(recap row "Stairs"; 1 in all, newest first\\)[^\\n]*\\n- 2026-11-02 16:17 · recap round 1, row "Stairs", sent-back: "${ROUND1}"$`))
    const taken = await workApi({ chat: 'Lamplighter', action: 'take', minutes: 30, id: first }, ctx)
    assert.match(taken.result.text, /\nThe person's earlier words on this part \(recap row "Stairs"/)
  } finally {
    await remove(store.dir)
  }
})
