// The Backlog tab's blocks (2026-10-25; the person's yes on the mockup art-inbox/board-backlog-lists/mock.png, with
// "In progress is higher than queue"): under "Recently finished" the tab lists its tasks in blocks, each folding:
// In progress, Queue (the ready list, numbered as a free worker takes them), Refined (held for the person's choice,
// with "Add to queue"), Not refined yet. A row's goal links to the Goals part. "One list, newest first" and "Hide in
// progress and queued" are gone. The page's own code is run here, cut out of board.js. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { storeFromText } from '../src/work/read.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(HERE, '..', 'public', 'board.js'), 'utf8')
const html = await readFile(join(HERE, '..', 'public', 'index.html'), 'utf8')
const style = await readFile(join(HERE, '..', 'public', 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
/** A function of board.js, cut out from its start to the end of its body. */
const fn = name => {
  const from = script.indexOf(`function ${name}(`)
  assert.ok(from >= 0, `board.js has no function ${name}`)
  return script.slice(from, script.indexOf('\n}\n', from) + 3)
}
/** A top-level const of board.js, its one line. */
const constant = name => {
  const from = script.indexOf(`const ${name} = `)
  assert.ok(from >= 0, `board.js has no const ${name}`)
  return script.slice(from, script.indexOf('\n', from) + 1)
}
const plain = value => JSON.parse(JSON.stringify(value))

/** A small stand-in for the page's document: enough for `el` and what a block and its rows do with it. */
class Node {
  constructor(tag) {
    Object.assign(this, { tag, tagName: tag.toUpperCase(), className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', value: '', id: '', hidden: false, href: '' })
    this.classList = { add: name => { this.className = `${this.className} ${name}`.trim() } }
  }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [], dataset: {}, attrs: {}, className: '' } : one) }
  setAttribute(name, value) { this.attrs[name] = value }
}
const text = node => [node.textContent, ...(node.children ?? []).map(text)].join('')
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]
const page = { document: { createElement: tag => new Node(tag) }, problems: new Map(), sending: new Set() }
vm.runInNewContext([
  'const MIN = 60000', cut('times'), cut('coordinate'), fn('el'), fn('fixChip'), constant('BLOCK_EMPTY'), fn('drawBlock'), fn('blockChip'), fn('blockLine'), fn('queueButton'), fn('editPart'),
  'Object.assign(this, { coordinateList, backlogBlocks, isBlockOpen, goalPlace, drawBlock, blockLine, BACKLOG_BLOCKS })',
].join('\n'), page)

const NOW = new Date(2026, 9, 25, 12, 0).getTime()
const GOALS = ['Last id: G33', 'Focus: G33', '', '- [~] G33 The refactor', '- [ ] G9 Crumbling tiles', ''].join('\n')

/** A board's state from a store of these items (`Key: value` heads), through the server's own `buildState`. */
function stateOf(heads, more = {}) {
  const work = storeFromText('## Work\n', { now: NOW - 60 * 60_000 })
  for (const { Body = '', ...head } of heads) {
    const one = parseItem(`${Object.entries({ Kind: 'step', Since: stamp(NOW - 60 * 60_000), ...head }).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Body}`)
    work.items.set(one.head.get('Id'), one)
    work.activities[0].steps.push(one.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: 1, lastActivityAt: NOW - 60_000, lastAssistantUuid: 'u' })
  return buildState({ listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1', 'Worker 3'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, goalsText: GOALS, ...more },
    { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' } })
}

const STORE = [
  { Id: 'B1', Title: 'Split the state', State: 'in progress', Owner: 'Worker 1', Goal: 'G33' },
  { Id: 'B2', Title: 'Pick the tile art', State: 'waiting on you', Owner: 'Worker 3', Goal: 'G9' },
  { Id: 'B3', Title: 'Check the lanes', State: 'review', Owner: 'Worker 1' },
  { Id: 'B10', Title: 'Fix the loop lock', State: 'refined', Refined: 'ready', Priority: 'fix', Goal: 'G9' },
  { Id: 'B11', Title: 'Split the cards', State: 'refined', Refined: 'ready', Goal: 'G33' },
  { Id: 'B12', Title: 'The Ranger as a pick', State: 'refined', Refined: 'ready', Goal: 'G9', 'Queued by': 'person, 2026-10-25 11:00:00' },
  { Id: 'B13', Title: 'Mend the fence', State: 'refined', Refined: 'ready', Goal: 'G9', Pinned: 'Worker 1' },
  { Id: 'B14', Title: 'Close the tile gaps', State: 'refined', Refined: 'ready', Goal: 'G9' },
  { Id: 'B15', Title: 'Hang the sign', State: 'refined', Refined: 'ready', Goal: 'G9', 'Blocked by': 'B1' },
  { Id: 'B16', Title: 'Paint the sign', State: 'refined', Refined: 'ready', Goal: 'G9', 'Blocked by': 'B1', 'Queued by': 'person, 2026-10-25 11:05:00' },
  { Id: 'B20', Title: 'A shorter morning note', State: 'new', Goal: 'G9' },
  { Id: 'B21', Title: 'Done long ago', State: 'done', Goal: 'G9' },
]

test('the blocks in order, In progress above the Queue; each task in the block of where it stands, from the board\'s own state', () => {
  const state = stateOf(STORE)
  const blocks = plain(page.backlogBlocks(page.coordinateList(state.backlog), state.readyList))
  assert.deepEqual(blocks.map(block => [block.key, block.title, block.note]), [
    ['progress', 'In progress', ''],
    ['queue', 'Queue', 'a free worker takes the top one'],
    ['refined', 'Refined', 'waiting for your choice'],
    ['new', 'Not refined yet', 'the Advisor refines these first'],
  ])
  const ids = Object.fromEntries(blocks.map(block => [block.key, block.rows.map(row => row.step.id)]))
  assert.deepEqual(ids, { progress: ['B1', 'B2', 'B3'], queue: ['B10', 'B11', 'B12', 'B13'], refined: ['B16', 'B15', 'B14'], new: ['B20'] })
  const [progress, queue, refined, fresh] = blocks
  // In progress: with its worker and its state; green only while worked on, the person's colour only when it waits on them.
  assert.deepEqual(progress.rows.map(row => [row.who, row.state, row.tone]), [['Worker 1', 'In progress', 'progress'], ['Worker 3', 'Waiting on you', 'you'], ['built by Worker 1', 'In review', 'review']])
  // Queue: numbered as a free worker takes them: the fix, the focus goal's, the person's addition, then the pin.
  assert.deepEqual(queue.rows.map(row => [row.n, row.isFix, row.isFocus, row.isAdded, row.who, row.canRemove]), [
    [1, true, false, false, 'any free worker', false],
    [2, false, true, false, 'any free worker', false],
    [3, false, false, true, 'any free worker', true],
    [4, false, false, false, 'for Worker 1 only', true],
  ])
  // Refined: held for the person's choice has "Add to queue"; held for another reason says why, quietly; the person's
  // own addition that something holds keeps "Remove".
  assert.deepEqual(refined.rows.map(row => [row.step.id, row.canAdd, row.why, row.isAdded, row.canRemove]), [
    ['B16', false, 'blocked by B1 (in progress)', true, true],
    ['B15', false, 'blocked by B1 (in progress)', false, false],
    ['B14', true, '', false, false],
  ])
  assert.deepEqual(fresh.rows.map(row => [row.step.id, row.wait]), [['B20', 'waits for its refine']])
  // Every row carries its goal.
  assert.deepEqual(blocks.flatMap(block => block.rows.map(row => row.goal)), ['G33', 'G9', null, 'G9', 'G33', 'G9', 'G9', 'G9', 'G9', 'G9', 'G9'])
  // Finished only with "Show finished", in its own block at the end.
  const shown = plain(page.backlogBlocks(page.coordinateList(state.backlog, { showDone: true }), state.readyList, { showDone: true }))
  assert.deepEqual(shown.map(block => block.key), ['progress', 'queue', 'refined', 'new', 'done'])
  assert.deepEqual(shown.at(-1).rows.map(row => row.step.id), ['B21'])
})

test('the Queue keeps each task\'s place when the search narrows it; the waits of a task not refined yet; without a store the status decides', () => {
  const state = stateOf(STORE)
  const found = plain(page.backlogBlocks(page.coordinateList(state.backlog, { find: 'Ranger' }), state.readyList))
  assert.deepEqual(found[1].rows.map(row => [row.step.id, row.n]), [['B12', 3]])
  const step = (id, more) => ({ key: id, id, title: `Task ${id}`, status: 'open', worker: null, ...more })
  const list = { groups: [{ name: 'Work', steps: [
    step('B30', { refineState: 'asking', item: { state: 'new', goal: null } }),
    step('B31', { refineState: 'answers', item: { state: 'new', goal: 'G9' } }),
    step('B32', { refineState: 'stopped', item: { state: 'new', goal: null, pinned: 'Worker 3' } }),
    step('B33', { status: 'progress', worker: 'Worker 1' }),
    step('B34', { status: 'queued', worker: 'Worker 3' }),
    step('B35', { status: 'you' }),
  ] }] }
  const blocks = plain(page.backlogBlocks(list, null))
  assert.deepEqual(blocks[3].rows.map(row => [row.step.id, row.wait, row.who, row.canRemove]), [
    ['B35', 'waits for your answer', '', false],
    ['B32', 'its refine stopped', 'for Worker 3 only', true],
    ['B31', 'waits for your answer', '', false],
    ['B30', 'being refined', '', false],
  ])
  assert.deepEqual(blocks[0].rows.map(row => [row.step.id, row.state, row.who]), [['B33', 'In progress', 'Worker 1'], ['B34', 'Given', 'Worker 3']])
  assert.deepEqual([blocks[1].rows, blocks[2].rows], [[], []])
})

test('a block folds with a click on its head, kept in this browser; a folded block keeps its head and count', () => {
  const block = { key: 'queue', title: 'Queue', note: 'a free worker takes the top one', rows: [] }
  const open = page.drawBlock(block, false)
  const head = all(open, node => node.dataset.blockFold !== undefined)[0]
  assert.deepEqual([head.dataset.blockFold, head.attrs['aria-expanded'], head.attrs['aria-controls']], ['queue', 'true', 'block-queue'])
  assert.match(text(head), /^▾Queue0 · a free worker takes the top one$/)
  const body = all(open, node => node.id === 'block-queue')[0]
  assert.deepEqual([body.hidden, text(body)], [false, 'Nothing waits for a free worker.'])
  const folded = page.drawBlock(block, true)
  assert.equal(all(folded, node => node.dataset.blockFold !== undefined)[0].attrs['aria-expanded'], 'false')
  assert.equal(all(folded, node => node.id === 'block-queue')[0].hidden, true)
  assert.match(folded.className, /is-folded/)
  assert.deepEqual([page.isBlockOpen('queue', {}), page.isBlockOpen('queue', { queue: true }), page.isBlockOpen('queue', { queue: false }), page.isBlockOpen('new', null)], [true, false, true, true])
  // The page keeps the folds in this browser, in try/catch, and redraws; a head the keyboard was on keeps the focus.
  const draw = fn('drawCoordinate')
  assert.match(draw, /const folds = blockFolds\(\)/)
  assert.match(draw, /querySelector\(`\[data-block-fold="\$\{focused\}"\]`\)\?\.focus\(\)/)
  assert.match(fn('blockFolds'), /try \{\n    const kept = JSON\.parse\(localStorage\.getItem\('backlog-blocks-folded'\) \?\? 'null'\)/)
  assert.match(script, /folds\[fold\.dataset\.blockFold\] = fold\.getAttribute\('aria-expanded'\) === 'true'\n    blockFoldsHere = folds\n    try \{\n      localStorage\.setItem\('backlog-blocks-folded', JSON\.stringify\(folds\)\)/)
  // Narrowed by a filter, the search or a goal, a block with nothing left is left out.
  assert.match(draw, /\.filter\(block => !isNarrowed \|\| block\.rows\.length > 0\)/)
})

test('a row: its place, its id and title with its chips, its goal as a link to the Goals part, for whom, why, and its button', () => {
  const state = stateOf(STORE)
  const blocks = page.backlogBlocks(page.coordinateList(state.backlog), state.readyList)
  const queue = blocks.find(block => block.key === 'queue')
  const added = page.blockLine(queue.rows[2], 'queue')
  assert.deepEqual(added.children.slice(0, 6).map(one => one.className), ['block-n', 'block-open', 'block-goal', 'block-who', 'block-why', 'block-action is-quiet'])
  assert.equal(text(added.children[0]), '3')
  assert.equal(added.children[1].dataset.openStep, 'B12')
  assert.match(text(added.children[1]), /^B12added by you The Ranger as a pick$/)
  const goal = added.children[2]
  assert.deepEqual([goal.tag, goal.href, goal.dataset.place, goal.title, goal.textContent], ['a', '#advice/goals/G9', '#advice/goals/G9', 'Open G9 on Goals', 'G9'])
  assert.equal(text(added.children[3]), 'any free worker')
  const remove = added.children[5]
  assert.deepEqual([remove.textContent, remove.dataset.queueRemove, remove.attrs['aria-label']], ['Remove', 'B12', 'Remove: B12 The Ranger as a pick'])
  // The fix chip keeps its look; the focus chip is quiet; a fix and a focus task have no Remove.
  const fix = page.blockLine(queue.rows[0], 'queue')
  assert.equal(all(fix, node => node.className === 'fix-chip').length, 1)
  assert.equal(all(fix, node => node.dataset.queueRemove !== undefined || node.dataset.queueAdd !== undefined).length, 0)
  assert.equal(all(page.blockLine(queue.rows[1], 'queue'), node => node.className === 'block-chip is-focus')[0].textContent, 'focus')
  assert.equal(text(page.blockLine(queue.rows[3], 'queue').children[3]), 'for Worker 1 only')
  // Refined: "Add to queue" on the person's choice; the reason, quietly, on the rest.
  const refined = blocks.find(block => block.key === 'refined')
  const pick = page.blockLine(refined.rows[2], 'refined')
  assert.deepEqual(all(pick, node => node.tag === 'button' && node.dataset.queueAdd !== undefined).map(one => [one.textContent, one.dataset.queueAdd, one.className]), [['Add to queue', 'B14', 'block-action']])
  const held = page.blockLine(refined.rows[1], 'refined')
  assert.deepEqual([held.children[4].className, held.children[4].textContent, held.children[5].className], ['block-why', 'blocked by B1 (in progress)', 'block-act'])
  // In progress: the state as a pill; a row without a goal has an empty goal cell, no link.
  const busy = page.blockLine(blocks[0].rows[2], 'progress')
  assert.deepEqual([busy.children[4].className, busy.children[4].textContent], ['step-state is-review', 'In review'])
  assert.deepEqual([busy.children[2].tag, busy.children[2].textContent], ['span', ''])
  // Close and Delete (B221) stay, left of the row's button when it has one.
  assert.equal(all(added, node => node.dataset.editAction !== undefined).length, 2)
  assert.match(added.className, /has-action/)
  assert.deepEqual([page.goalPlace('G15'), page.goalPlace('B12'), page.goalPlace(null)], ['#advice/goals/G15', null, null])
})

test('the clicks: a goal goes to the Goals part; "Add to queue" and "Remove" go through the work API as the person', () => {
  const click = script.slice(script.indexOf("$('coordinate-list').addEventListener('click'"), script.indexOf('// Design (B99)'))
  assert.match(click, /const place = event\.target\.closest\('\[data-place\]'\)\n  if \(place !== null\) \{\n    event\.preventDefault\(\)\n    return goToPlace\(place\.dataset\.place\)/)
  assert.match(click, /const queue = event\.target\.closest\('\[data-queue-add\], \[data-queue-remove\]'\)\n  if \(queue !== null\) return queueClick\(queue\)/)
  assert.match(fn('queueClick'), /return sendWork\(\{ action: isAdd \? 'add-to-queue' : 'remove-from-queue', id \}, `queue:\$\{id\}`\)/)
  // A send on its way or refused redraws the tab, as do the ready list's changes.
  assert.match(script, /once\('coordinate', \[state\.backlog \?\? null, state\.readyList \?\? null, queueing\], \(\) => drawCoordinate\(state\)\)/)
  assert.match(script, /const queueing = \[\[\.\.\.sending\]\.filter\(key => key\.startsWith\('queue:'\)\), \[\.\.\.problems\]\.filter\(\(\[key\]\) => key\.startsWith\('queue:'\)\)\]/)
  // A sending button says so; a refused one says "Try again", with why on hover.
  page.sending.add('queue:B14')
  const state = stateOf(STORE)
  const row = page.backlogBlocks(page.coordinateList(state.backlog), state.readyList).find(block => block.key === 'refined').rows.find(one => one.step.id === 'B14')
  assert.deepEqual([page.blockLine(row, 'refined').children[5].textContent, page.blockLine(row, 'refined').children[5].disabled], ['Adding…', true])
  page.sending.delete('queue:B14')
  page.problems.set('queue:B14', 'Not sent: refused')
  assert.deepEqual([page.blockLine(row, 'refined').children[5].textContent, page.blockLine(row, 'refined').children[5].title], ['Try again', 'Not sent: refused'])
  page.problems.delete('queue:B14')
})

test('"One list, newest first", "Hide in progress and queued" and the goal headers are gone, with their code', () => {
  const top = html.slice(html.indexOf('class="coordinate-top"'), html.indexOf('</header>', html.indexOf('class="coordinate-top"')))
  assert.match(top, /id="coordinate-done"> Show finished/)
  for (const gone of ['coordinate-one', 'coordinate-busy', 'One list, newest first', 'Hide in progress and queued']) assert.ok(!html.includes(gone), `index.html: ${gone}`)
  for (const gone of ["'backlog-one'", "'backlog-hide-busy'", "'backlog-goal-folds'", 'Every task, newest first', 'function goalRows(', 'function drawGoalRows(', 'asOne', 'hideBusy', 'coordinateLine']) assert.ok(!script.includes(gone), `board.js: ${gone}`)
  for (const gone of ['.goal-head', '.coordinate-group', '.step-row', '.step-queue-line.is-row']) assert.ok(!style.includes(gone), `board.css: ${gone}`)
  // Options of before are no longer read.
  assert.deepEqual(plain(page.coordinateList([{ name: 'A', steps: [{ key: 'B1', id: 'B1', title: 'One', status: 'open' }] }], { asOne: true })).groups.map(group => group.name), ['A'])
})

test('quiet styling: the Queue in a quiet blue, the chips and buttons quiet; amber, orange and red only for attention', () => {
  assert.match(style, /\.backlog-block\.is-queue \{ border-color: #2b4f80; \}/)
  const rules = style.split('\n').filter(line => /^\.(?:backlog-block|block-[a-z]+|step-line\.block-line|a\.block-goal)/.test(line) && !line.startsWith('.block-action.is-error'))
  assert.ok(rules.length > 10)
  for (const rule of rules) assert.doesNotMatch(rule, /--warn|--waiting|#f6b93b|#ff7a59|orange|#e05a4f/, rule)
  // The row's button is quiet until the row is pointed at (the row fix of 2026-10-25).
  assert.match(style, /\.block-action \{[^}]*opacity: \.75; \}/)
  assert.match(style, /\.block-line:hover \.block-action, \.block-action:focus-visible \{ opacity: 1; \}/)
  // The fix chip keeps its look.
  assert.match(style, /\.fix-chip \{ display: inline-block; padding: 0 6px; border: 1px solid var\(--warn\);/)
})

// B179, kept from the one list's tests: the user, 2026-10-14: "Make the backlog 'recently finished' collapsible."
test('"Recently finished" folds away with a click on its head, kept in this browser', () => {
  const draw = script.slice(script.indexOf('function drawFinished('), script.indexOf("$('finished').addEventListener"))
  // The head is a button that says whether the list is open, and names what it folds.
  assert.match(draw, /fold\.setAttribute\('aria-expanded', String\(!finishedFolded\)\)/)
  assert.match(draw, /fold\.setAttribute\('aria-controls', 'finished-body'\)/)
  assert.match(draw, /list\.id = 'finished-body'\n  list\.hidden = finishedFolded/)
  // The arrow is not read out, and a redraw keeps the keyboard on the head.
  assert.match(draw, /arrow\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(draw, /fill\(box, \[head, list\]\)\n  if \(wasOnHead\) fold\.focus\(\)/)
  // Unfolded unless this browser folded it; a click turns it and keeps the choice.
  assert.match(script, /finishedFolded = localStorage\.getItem\('finished-folded'\) === 'yes'/)
  const click = script.slice(script.indexOf("$('finished').addEventListener"), script.indexOf("$('finished').addEventListener") + 700)
  assert.match(click, /closest\('\[data-fold-finished\]'\)/)
  assert.match(click, /finishedFolded = !finishedFolded/)
  assert.match(click, /localStorage\.setItem\('finished-folded', finishedFolded \? 'yes' : 'no'\)/)
  // Above the blocks.
  assert.ok(html.indexOf('id="finished"') < html.indexOf('id="coordinate-list"'))
})

test('T9.1.1: a Quality Assurance task stands first in the Queue, for any free worker but the ones that built the step it checks', () => {
  const state = stateOf([
    // In review with an agreed point and its board check passed: it waits for its result check (a task for a step that waits for none is held).
    { Id: 'B3', Title: 'Check the lanes', State: 'review', Owner: 'Worker 1', Goal: 'G9', Body: `
## What we build
- the lanes read right

## History
- ${stamp(NOW - 30 * 60_000)} server: check passed: merged
` },
    { Id: 'B10', Title: 'Fix the loop lock', State: 'refined', Refined: 'ready', Priority: 'fix', Goal: 'G9' },
    { Id: 'B30', Title: 'Quality Assurance: B3 Check the lanes', State: 'refined', Refined: 'ready', Checks: 'B3', 'Not by': 'Worker 1, Worker 2', Goal: 'G9' },
  ])
  const blocks = page.backlogBlocks(page.coordinateList(state.backlog), state.readyList)
  const queue = blocks.find(block => block.key === 'queue')
  assert.deepEqual(plain(queue.rows.map(row => [row.n, row.step.id, row.isFix, row.who])), [[1, 'B30', false, 'any free worker but Worker 1, Worker 2'], [2, 'B10', true, 'any free worker']])
})
