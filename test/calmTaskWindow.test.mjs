// Calm task window, "layout A" (the person, 2026-10-31, on the window of B819: "this way is still too crowded" ... "i need to
// understand the context. like the clear backlog item description of context, problem, solution"): a task opens with three
// plain lines (Context, Problem, Solution), "Your words" under them, one quiet status line and its main action; What we
// build, Model and effort, Flow and History stand folded, closed; Refine again and Delete task sit behind "More". An ask of
// a task shows the same three lines above its question. The fixtures are the real texts of B819 (a fix) and B436.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { itemOfStep, storeFromText } from '../src/work/read.mjs'
import { openPage } from './pageHarness.mjs'
import { MIN, NOW, app, asSent, sinceOf, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('item')}\n${cut('story')}\nObject.assign(this, { stepStory, stepStatus, storyLabelled })`, page)

const FOUND = 'docs/game-design.md and the level playbook (rules 3 and 18) say the new rules; the picture art-inbox/levels-g28/gap/after-third-height.png shows the test map beside the Terraces painting.'
const B819 = [
  'Id: B819', 'Kind: step', 'Title: Fix: docs/game-design.md and the level playbook (rules 3 and 18) say the new rules; the picture…', 'State: refined',
  'Activity: Look: make the game compare to the reference pictures', 'Goal: G29', 'Since: 2026-10-31 00:11', 'Fix of: B436', 'Refined: ready', '',
  '## Context', '  Fix of B436: the result check by Worker 2 failed on one point.', `  - ${FOUND} (docs are written; the picture file does not exist)`,
  `  - Makes pass: ${FOUND}`, '(the refine block stands under ## Refined)', '',
  '## Summary', `Fix what the result check of B436 found, so its agreed point passes: ${FOUND}. Found: ${FOUND} (docs are written; the picture file does not exist)`, '',
  '## Standard', 'none (a core rule change; the tests are the check, its look is judged with the Terraces in B437)', '',
  '## What we build', `- ${FOUND} (docs are written; the picture file does not exist)`, `- Makes pass: ${FOUND}`, '',
  '## Refined', '  Refined (2026-10-31 00:11; ready; from the result check of B436 by Worker 2):', `  Summary: Fix what the result check of B436 found, so its agreed point passes: ${FOUND}. Found: ${FOUND} (docs are written; the picture file does not exist)`,
  '  Part of: G29', '  Size: about 20 min', '', '## History', '- 2026-10-31 00:11 Worker 2: made by the result check of B436', '',
].join('\n')
const B436 = [
  'Id: B436', 'Kind: step', 'Title: Add a third height: a second raised level', 'State: done', 'Owner: Worker 5', 'Activity: Look: make the game compare to the reference pictures',
  'Goal: G29', 'Since: 2026-10-30 21:41', '', '## Context', '  The person, 2026-10-19 22:15: "B all of A and the third height now".', '',
  '## What we build', '- a second raised level', '', '## History', '- 2026-10-30 20:15 person: added to the queue', '',
].join('\n')

const store = (...texts) => {
  const work = storeFromText('## Look: make the game compare to the reference pictures\n- [ ] B436 Add a third height: a second raised level\n- [ ] B819 Fix: the picture\n', { now: NOW - 60 * MIN })
  for (const text of texts) {
    const item = parseItem(text)
    work.items.set(item.head.get('Id'), item)
  }
  return work
}
const itemOf = (work, id) => JSON.parse(JSON.stringify(itemOfStep(work, id)))
const plain = value => JSON.parse(JSON.stringify(value))
const ITEMS = [{ id: 'B436', title: 'Add a third height: a second raised level' }]

test('lines the refine wrote itself win: in its Summary or in its Refined block', () => {
  const item = { summary: ['Context: The hedge is bare.', 'Problem: Nothing hides the road.', 'Solution: Plant yew along it.', 'More words.'], what: ['Something else.'], context: ['Not this.'], refinedLines: [] }
  assert.deepEqual(plain(page.stepStory(item, ITEMS)), { context: 'The hedge is bare.', problem: 'Nothing hides the road.', solution: 'Plant yew along it.' })
  // In the Refined block, after its "Summary:" label, one of them still wins over what would be derived.
  const refined = { summary: ['Plant a hedge.'], what: ['Plant yew.'], context: ['Old words.'], refinedLines: ['Summary: Context: The road is loud.', 'Problem: No screen.'] }
  assert.deepEqual(plain(page.stepStory(refined, ITEMS)), { context: 'The road is loud.', problem: 'No screen.', solution: 'Plant yew.' })
})

test('a fix of B436 (B819, real text): the B436 context, the missing picture file as its problem, the first point as its solution', () => {
  const work = store(B436, B819)
  const item = itemOf(work, 'B819')
  assert.deepEqual(item.context.slice(0, 1), ['Fix of B436: the result check by Worker 2 failed on one point.'], 'the store gives the Context section, not the line about the refine block')
  assert.ok(item.refinedLines.some(one => one.startsWith('Summary: Fix what')), 'and the Refined block as written')
  const story = page.stepStory(item, ITEMS, 'Make the game compare to the reference pictures')
  assert.equal(story.context, 'A fix of B436 (Add a third height: a second raised level): its result check found one point short.')
  assert.equal(story.problem, 'The result check found one point short: docs are written; the picture file does not exist.')
  assert.match(story.solution, /^docs\/game-design\.md and the level playbook \(rules 3 and 18\) say the new rules/)
  assert.doesNotMatch(story.solution, /does not exist/, 'the note in brackets is the problem, not the solution')
  // Without the fixed step\'s title the line still reads.
  assert.equal(page.stepStory(item, []).context, 'A fix of B436: its result check found one point short.')
})

test('a plain step: its Context section\'s first sentence, its Summary\'s first sentence, its first point; else the goal\'s title', () => {
  const item = { summary: ['A hedge round the garden. It grows slowly.'], what: ['Plant yew along the fence. Water it.', 'Trim it.'], context: ['The person asked for a hedge. Round, not square.'], refinedLines: [] }
  assert.deepEqual(plain(page.stepStory(item, [])), { context: 'The person asked for a hedge.', problem: 'A hedge round the garden.', solution: 'Plant yew along the fence.' })
  assert.equal(page.stepStory({ ...item, context: [] }, [], 'Garden polish').context, 'Garden polish')
  assert.deepEqual(plain(page.stepStory({ summary: [], what: [], context: [], refinedLines: [] }, [])), { context: '', problem: '', solution: '' })
})

test('each line is at most about 160 characters, cut at a word', () => {
  const long = `${'wordy '.repeat(60)}end.`
  const story = page.stepStory({ summary: [long], what: [long], context: [long], refinedLines: [] }, [])
  for (const line of Object.values(story)) {
    assert.ok(line.length <= 161, `${line.length} characters`)
    assert.match(line, /wordy…$/, 'cut after a whole word')
  }
})

test('the status line: model and effort, the time, who holds it since when', () => {
  const item = { effort: { level: 'medium' }, model: { family: 'sonnet' }, owner: null, state: 'refined', history: ['2026-10-31 00:11 Worker 2: made'] }
  assert.equal(page.stepStatus(item, { size: 'about 20 min' }), 'Sonnet · medium · about 20 min · Nobody has it yet (refined) since 2026-10-31 00:11')
  assert.equal(page.stepStatus({ ...item, owner: 'Worker 5', state: 'taken' }, { efforts: [{ level: 'medium', typicalMin: 90 }] }), 'Sonnet · medium · about 1 h 30 min · Worker 5 holds it (taken) since 2026-10-31 00:11')
})

// ---- the page ----
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
function stateWith(work) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  return asSent({ ...buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config }), goalsEdit: { canWrite: true } })
}
const ASK = [
  'Id: Q70', 'Kind: ask', 'Title: Drop B819 as well?', 'State: open', 'Owner: Digger', `Since: ${sinceOf(NOW - 10 * MIN)}`, `Filed: ${NOW - 10 * MIN}`, 'Asks: decide', 'Blocking: no',
  'Of: B819', 'Options: A yes | B no', 'Advice: A', '',
].join('\n')
const names = nodes => nodes.map(one => one.textContent.replace(/\s+/g, ' ').trim())

test('the window of B819: the three lines, the status line and the main action on top; four folds, closed; "More" holds Refine again and Delete task', async () => {
  const open = await openPage({ state: stateWith(store(B436, B819)), hash: 'details=B819' })
  try {
    const rows = open.all('#details .task-story-row')
    assert.deepEqual(rows.map(one => one.dataset.story), ['context', 'problem', 'solution'])
    assert.match(rows[0].textContent, /^Context A fix of B436 \(Add a third height: a second raised level\)/)
    assert.match(rows[1].textContent, /the picture file does not exist/)
    assert.match(rows[2].textContent, /^Solution docs\/game-design\.md/)
    assert.match(open.text('#details .task-status'), /^medium · about 20 min · Nobody has it yet \(refined\) since 2026-10-31 00:11$/)
    // Under Solution: the person's words, with "Add a note".
    assert.equal(open.all('#details [data-words-send="B819"]').length, 1)
    // The four folded parts, each closed by default.
    const folds = open.all('#details .task-calm > details.task-fold')
    assert.deepEqual(folds.map(one => one.dataset.fold), ['what', 'effort', 'flow', 'history'])
    assert.deepEqual(names(folds.map(one => one.querySelector('summary'))), ['What we build (2)', 'Model and effort', 'Flow', 'History (1)'])
    assert.deepEqual(folds.map(one => one.open), [false, false, false, false])
    // The main action stands in the foot, in view; Refine again and Delete task are behind More, closed.
    const foot = open.find('#details .details-foot')
    assert.ok(foot.querySelector('.step-queue-line, .step-edit-button.is-close'), 'a main action')
    const more = foot.querySelector('details.task-more')
    assert.equal(more.open, false)
    assert.equal(more.querySelector('summary').textContent, 'More')
    assert.deepEqual(names([...more.querySelectorAll('button')]), ['Refine again', 'Close task', 'Delete task'])
    assert.deepEqual([...foot.querySelectorAll('button')].filter(one => !more.contains(one)).map(one => one.textContent).includes('Delete task'), false)
    // Nothing about the Summary or the Flow strip is open on the page; the old parts are gone.
    assert.equal(open.all('#details .details-part h3').length === 0 || !open.all('#details .details-part h3').some(one => one.textContent === 'Summary'), true)
  } finally {
    await open.close()
  }
})

test('a fold the person opened stays open while the window is drawn anew', async () => {
  const opened = await openPage({ state: stateWith(store(B436, B819)), hash: 'details=B819' })
  try {
    opened.find('#details details[data-fold="what"]').open = true
    opened.find('#details details[data-fold="what"] ul, #details details[data-fold="what"] li')
    await opened.type('#details [data-words-text="B819"]', 'a draft')
    assert.equal(opened.find('#details details[data-fold="what"]').open, true)
  } finally {
    await opened.close()
  }
})

test('an ask of a task shows the task\'s Context, Problem and Solution above its question: on its card and in its calm window', async () => {
  const work = store(B436, B819, ASK)
  const seen = await openPage({ state: stateWith(work), hash: '' })
  try {
    const card = seen.all('#needs .need').find(one => one.dataset.id === 'work:Q70')
    assert.ok(card, 'the ask has a card')
    assert.deepEqual([...card.querySelectorAll('.task-story-row')].map(one => one.dataset.story), ['context', 'problem', 'solution'])
    assert.ok(card.querySelector('.task-story').compareDocumentPosition(card.querySelector('h4')) !== 0)
  } finally {
    await seen.close()
  }
  const calm = await openPage({ state: stateWith(work), hash: 'details=Q70' })
  try {
    const ask = calm.find('#details .calm-ask')
    assert.deepEqual([...ask.querySelectorAll('.task-story-row')].map(one => one.dataset.story), ['context', 'problem', 'solution'])
    assert.equal(ask.firstElementChild.className, 'task-story', 'above the question')
    assert.match(ask.querySelector('.task-story-row').textContent, /A fix of B436/)
  } finally {
    await calm.close()
  }
})

test('an ask of no task has no lines', async () => {
  const loose = ASK.replace('Of: B819\n', '')
  const seen = await openPage({ state: stateWith(store(B436, B819, loose)), hash: 'details=Q70' })
  try {
    assert.equal(seen.all('#details .task-story').length, 0)
  } finally {
    await seen.close()
  }
})
