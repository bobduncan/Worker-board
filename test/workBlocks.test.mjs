// Work blocks (the person, 2026-10-31: "a goal has X workblocks. each workblock has X tasks. Rework during goal evaluation
// can produce more workblocks or tasks", and "the done when will only show the unfinished workblocks ... filtered once per
// evaluation"; names chosen: "All work blocks" and "Open now"). A block's done-when line on its Part line, the rounds of a
// goal's work, Open now as the state computes it, "Change this goal" re-planning in work blocks, and the Focus page's switch
// and both views, clicked in happy-dom. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { brainstormsState, editThread, parseThread } from '../src/brainstorm.mjs'
import { doneWhenText, hasDoneWhen, parseGoals, partOf, wentPastGo } from '../src/goals.mjs'
import { addPartStep, setGoalBlocks, setHow } from '../src/goalsWrite.mjs'
import { goalStepFor } from '../src/say.mjs'
import { focusState, roundOf } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

// ---------------------------------------------------------------------------------------------------------------------
// The done-when line of a block

test('a Part line ends with its done-when line: partOf reads it (null without it), its own " · " and steps after it too', () => {
  assert.deepEqual(partOf('Round ponds · about 1 h · steps B18, B19 · done when: a round pond of whole square cells reads round'),
    { title: 'Round ponds', size: 'about 1 h', steps: ['B18', 'B19'], doneWhen: 'a round pond of whole square cells reads round' })
  assert.deepEqual(partOf('Round ponds · about 1 h · steps B18'), { title: 'Round ponds', size: 'about 1 h', steps: ['B18'], doneWhen: null })
  assert.deepEqual(partOf('Paths · done when: a path, a gate · and a bench · steps B4'), { title: 'Paths', size: null, steps: ['B4'], doneWhen: 'a path, a gate · and a bench' })
  // An old Part line, as before.
  assert.deepEqual(parseGoals('- [ ] G6 Garden\n  Part: Paths · 30 min · steps B4\n').byId.get('G6').parts, [{ title: 'Paths', size: '30 min', steps: ['B4'], doneWhen: null }])
})

const BLOCKS = ['- [~] G6 Garden', '  Part: Paths · about 1 h · steps B4 · done when: every bench is on a path', '  Part: Lamps · 30 min', ''].join('\n')

test('every writer of Part lines keeps the done-when line: a task added, a how drafted without it', () => {
  const added = addPartStep(BLOCKS, 'G6', 'paths', 'B9').text
  assert.equal(added.split('\n')[1], '  Part: Paths · about 1 h · steps B4, B9 · done when: every bench is on a path')
  assert.equal(addPartStep(added, 'G6', 'Paths', 'B9').text, added, 'a task is added once')
  assert.equal(addPartStep(BLOCKS, 'G6', 'Ponds', 'B9').text, BLOCKS, 'a block the goal does not have changes nothing')
  assert.equal(addPartStep(BLOCKS, 'G6', 'Lamps', 'B7').text.split('\n')[2], '  Part: Lamps · 30 min · steps B7')
  // A draft that leaves a block's line out keeps the one it had; a line given is written.
  const how = setHow(BLOCKS, 'G6', { parts: [{ title: 'Paths', size: 'about 1 h', steps: ['B4', 'B5'] }, { title: 'Lamps', size: '30 min', doneWhen: 'every path is lit' }], partnerDecides: [], youDecide: [] }).text
  assert.deepEqual(parseGoals(how).byId.get('G6').parts.map(one => [one.title, one.steps, one.doneWhen]), [['Paths', ['B4', 'B5'], 'every bench is on a path'], ['Lamps', [], 'every path is lit']])
})

test('a goal whose every block has its line has its Done when; the word to the partner names the blocks\' lines', () => {
  const node = text => parseGoals(text).byId.get('G6')
  assert.equal(hasDoneWhen(node(BLOCKS)), false, 'one block has no line')
  const lined = BLOCKS.replace('  Part: Lamps · 30 min', '  Part: Lamps · 30 min · done when: every path is lit')
  assert.equal(hasDoneWhen(node(lined)), true)
  assert.equal(doneWhenText(node(lined)), 'every bench is on a path · every path is lit')
  // A dropped block counts out; the goal's own one line goes first.
  assert.equal(hasDoneWhen(node(`${BLOCKS}  Part dropped: Lamps · 2026-10-16 09:00 · not needed\n`)), true)
  assert.equal(doneWhenText(node(lined.replace('- [~] G6 Garden', '- [~] G6 Garden\n  Done when: you walk it at night'))), 'you walk it at night')
  assert.equal(hasDoneWhen(node('- [ ] G6 Garden\n')), false)
  // Went past Go once: a How agreed line, or a block with tasks.
  assert.deepEqual([wentPastGo(node(BLOCKS)), wentPastGo(node('- [ ] G6 Garden\n  Part: Paths · done when: x\n'))], [true, false])
})

// ---------------------------------------------------------------------------------------------------------------------
// Rounds

test('rounds: round 1 from How agreed; a Round line, a failed re-check and a recap round each start the next', () => {
  const node = lines => parseGoals(['- [~] G6 Garden', ...lines.map(one => `  ${one}`), ''].join('\n')).byId.get('G6')
  const first = roundOf(node(['How agreed: 2026-10-15 09:00']))
  assert.deepEqual([first.n, first.since, first.why], [1, '2026-10-15 09:00', 'your Go'])
  assert.equal(roundOf(node([])), null, 'no round before Go')
  const changed = node(['How agreed: 2026-10-15 09:00', 'Round: 2026-10-16 10:00 · the change of 2026-10-16'])
  assert.deepEqual([roundOf(changed).n, roundOf(changed).since, roundOf(changed).why], [2, '2026-10-16 10:00', 'the change of 2026-10-16'])
  const failed = node(['How agreed: 2026-10-15 09:00', 'Round: 2026-10-16 10:00 · the change of 2026-10-16', 'Rechecked (2026-10-17 08:00, Helper): failed · 1 of 3 points pass · gap: the gate'])
  assert.deepEqual([roundOf(failed).n, roundOf(failed).why], [3, 'the re-check'])
  // A re-check that waits for the person starts one too; one that passed does not.
  assert.equal(roundOf(node(['How agreed: 2026-10-15 09:00', 'Rechecked (2026-10-17 08:00, Helper): waits for you · 2 of 3 points pass · for you: the colour'])).n, 2)
  assert.equal(roundOf(node(['How agreed: 2026-10-15 09:00', 'Rechecked (2026-10-17 08:00, Helper): passed · 3 of 3 points pass'])).n, 1)
  // A round the person sent in the goal's recap (read only), not one of another goal's recap.
  const recaps = [{ goal: 'G6', rounds: [{ n: 1, at: '2026-10-18 09:30', parts: [] }] }, { goal: 'G7', rounds: [{ n: 1, at: '2026-10-18 09:40', parts: [] }] }]
  const sent = roundOf(failed, recaps)
  assert.deepEqual([sent.n, sent.since, sent.why], [4, '2026-10-18 09:30', 'your recap'])
  // Before Go counts nothing, and two in the same minute are one evaluation.
  assert.equal(roundOf(node(['Round: 2026-10-14 10:00 · early', 'How agreed: 2026-10-15 09:00'])).n, 1)
  assert.equal(roundOf(node(['How agreed: 2026-10-15 09:00', 'Round: 2026-10-16 10:00 · the change of 2026-10-16']), [{ goal: 'G6', rounds: [{ n: 1, at: '2026-10-16 10:00', parts: [] }] }]).n, 2)
})

// ---------------------------------------------------------------------------------------------------------------------
// Open now, computed

/** A task of the store: made at `made` (its first History stamp), in `state` since `since`. */
const task = (id, state, made, since = made) => parseItem([`Id: ${id}`, 'Kind: step', `Title: Task ${id}`, `State: ${state}`, `Since: ${since}`, '',
  '## History', `- ${made} Advisor: new`, ...(['done', 'closed', 'dropped'].includes(state) && since !== made ? [`- ${since} Worker: review → ${state}`] : []), ''].join('\n'))

const TEN = Array.from({ length: 10 }, (_, at) => at + 1)
/** The person's example: a goal of 10 blocks; the evaluation of 17 Oct reworks blocks 3, 5 and 8 (a new task each). */
function garden({ round = true, extra = [] } = {}) {
  const rework = { 3: 'B23', 5: 'B25', 8: 'B28' }
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  return ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Goal definition: calm', '    Goal definition agreed: 2026-10-15 08:00',
    ...TEN.map(n => `    Part: Block ${n} · about 1 h · steps B${n}${rework[n] && round ? `, ${rework[n]}` : ''} · done when: line ${n}`),
    ...extra, '    How agreed: 2026-10-15 09:00', ...(round ? ['    Round: 2026-10-17 10:00 · the evaluation of 2026-10-17'] : []), ''].join('\n')
}
/** Each block's first task done before the evaluation; the rework tasks made after it, B23 and B25 done since, B28 at work. */
const gardenTasks = [
  ...TEN.map(n => task(`B${n}`, 'done', '2026-10-15 10:00', '2026-10-16 12:00')),
  task('B23', 'done', '2026-10-17 11:00', '2026-10-18 09:00'),
  task('B25', 'done', '2026-10-17 11:05', '2026-10-18 09:30'),
  task('B28', 'in progress', '2026-10-17 11:10'),
]

test('Open now, the person\'s example: 10 blocks, 3 reworked after an evaluation are 3 lines; 2 of them done keep their tick', () => {
  const focus = focusState(parseGoals(garden()), gardenTasks, [], '')
  assert.deepEqual(focus.round, { n: 2, since: '2026-10-17 10:00', why: 'the evaluation of 2026-10-17' })
  assert.deepEqual(focus.openNow, [{ index: 2, title: 'Block 3', kind: 'rework' }, { index: 4, title: 'Block 5', kind: 'rework' }, { index: 7, title: 'Block 8', kind: 'rework' }])
  assert.deepEqual(focus.openNow.map(one => focus.parts[one.index].state), ['done', 'done', 'now'])
  assert.deepEqual(focus.progress, { done: 9, total: 10, minutesLeft: 60 })
  // Each block has its done-when line in the state.
  assert.equal(focus.parts[2].doneWhen, 'line 3')
  // Round 1 (no evaluation yet): every block is in the list, as All work blocks.
  const first = focusState(parseGoals(garden({ round: false })), gardenTasks, [], '')
  assert.equal(first.round.n, 1)
  assert.deepEqual(first.openNow.map(one => one.title), TEN.map(n => `Block ${n}`))
  assert.ok(first.openNow.every(one => one.kind === 'new'))
})

test('Open now: a block made in the round is New; one still open at its start is Rework; one with no task is open; a dropped one is not', () => {
  const extra = ['    Part: Lanterns · about 1 h · steps B40 · done when: every bench has a lantern', '    Part: Signs · done when: the gate is signed', '    Part: Maze · steps B41']
  const tasks = [...gardenTasks, task('B40', 'refined', '2026-10-17 10:30'), task('B41', 'in progress', '2026-10-16 09:00')]
  const text = garden({ extra }).replace('    Round:', '    Part dropped: Maze · 2026-10-17 10:00 · dropped in the change of 2026-10-17\n    Round:')
  const focus = focusState(parseGoals(text), tasks, [], '')
  const kinds = Object.fromEntries(focus.openNow.map(one => [one.title, one.kind]))
  assert.deepEqual(kinds, { 'Block 3': 'rework', 'Block 5': 'rework', 'Block 8': 'rework', Lanterns: 'new', Signs: 'new' })
  // A task not finished at the round's start keeps its block open, as Rework.
  const open = focusState(parseGoals(garden()), [...gardenTasks.filter(one => one.head.get('Id') !== 'B1'), task('B1', 'done', '2026-10-15 10:00', '2026-10-17 12:00')], [], '')
  assert.equal(open.openNow[0].title, 'Block 1')
  assert.equal(open.openNow[0].kind, 'rework')
})

// ---------------------------------------------------------------------------------------------------------------------
// "Change this goal" re-plans in work blocks

const FOLDER = '.claude/brainstorms'
const DIR = 'D:/work/garden/.claude/brainstorms'
const MAP = 'D:/work/garden/.claude/goals.md'
const at = new Date(2026, 9, 19, 9, 30).getTime()
const CHANGE_GOALS = [
  '# Goals',
  'Last id: G6',
  'Focus: G6',
  '',
  'Rules: a goal is one line "- [ ] G<n> <title>";',
  'two spaces of indentation per level is "part of".',
  '',
  '- [~] G6 Paths through the garden',
  '  Done when: a visitor walks every path without getting lost',
  '  Objective: An older aim.',
  '  Done when 1: An old bullet · steps B12',
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  '  Goal definition: calm',
  '  Goal definition agreed: 2026-10-18 10:00',
  '  Part: Lay the paths · about 1 h · steps B12 · done when: every path is laid',
  '  Part: Light the paths · 30 min · steps B13',
  '  Part: The maze · 1 h · steps B14',
  '  How agreed: 2026-10-18 11:00',
  '  - [ ] G7 The pond',
  '',
].join('\n')
const HEAD = '# Brainstorm: Change: Paths through the garden\nGoal: G6 Paths through the garden\nKind: change\nStarted: 2026-10-19 09:00 · State: running\nOpening: Rethink the paths.\n\n'
const UNDERSTOOD = '## Understood (09:05)\nA garden a visitor crosses without a map.\nAnswer (09:06): yes\n\n'
const PROPOSAL = [
  '## Proposal (09:10)',
  'Objective: A garden a visitor crosses without a map.',
  'Not in it: new benches, lights',
  'Work blocks:',
  '- 1. Lay the paths — done when: every bench is on a path — keep',
  '- 2. Light the paths — done when: a visitor sees the next bench at night — rework — Picture: pictures/garden/night.png',
  '- 3. Signs at the gate — done when: the gate is signed — from every bench — new',
  '- 4. The maze — done when: the maze is walked — drop',
  'Covered:',
  '- 1: B12',
  '- 3: B15',
  'Steps:',
  '- [ ] Brighter lamps — Digger — about 1 h — for 2',
  '- [ ] Paint the signs — Main decides — about 30 min — for 3',
  '- [ ] Sweep the gravel — Digger — about 15 min',
  'Drop:',
  '- [ ] B14 — the maze is dropped',
  '',
].join('\n')

function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => {
      files[to] = files[from]
      delete files[from]
    },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')
const options = (fs, extra = {}) => ({ canWrite: true, dir: DIR, folder: FOLDER, goalsFile: MAP, historyDir: 'D:/work/garden/.claude/goals-history', now: at, fs, ...extra })

test('a change\'s proposal lists the work blocks; an old one with Done when bullets still parses', () => {
  const proposal = parseThread(`${HEAD}${UNDERSTOOD}${PROPOSAL}`).proposal
  assert.deepEqual(proposal.blocks, [
    { n: 1, title: 'Lay the paths', doneWhen: 'every bench is on a path', kind: 'keep', picture: null },
    { n: 2, title: 'Light the paths', doneWhen: 'a visitor sees the next bench at night', kind: 'rework', picture: 'pictures/garden/night.png' },
    { n: 3, title: 'Signs at the gate', doneWhen: 'the gate is signed — from every bench', kind: 'new', picture: null },
    { n: 4, title: 'The maze', doneWhen: 'the maze is walked', kind: 'drop', picture: null },
  ])
  assert.deepEqual([proposal.objective, proposal.notInIt, proposal.doneWhen], ['A garden a visitor crosses without a map.', 'new benches, lights', []])
  assert.deepEqual(proposal.steps.map(one => one.for ?? null), [[2], [3], null])
  assert.deepEqual(parseThread(`${HEAD}${UNDERSTOOD}${PROPOSAL}`).problems, [])
  // The old form, as before.
  const old = parseThread(`${HEAD}${UNDERSTOOD}## Proposal (09:10)\nObjective: x\nDone when:\n- 1. Every bench is on a path\nSteps:\n- [ ] Sign it — Digger — about 1 h — for 1\n`).proposal
  assert.deepEqual([old.blocks, old.doneWhen.map(one => one.text), old.steps[0].for], [[], ['Every bench is on a path'], [1]])
})

test('create writes the Part lines with their done-when lines, Part dropped, a Round line and no Done when <n> lines; each new task joins its block', async () => {
  const path = `${FOLDER}/2026-10-19-change-paths.md`
  const fs = fakeFs({ [MAP]: latin(CHANGE_GOALS), [`${DIR}/2026-10-19-change-paths.md`]: latin(`${HEAD}${UNDERSTOOD}${PROPOSAL}`) })
  let next = 30
  // As the board does (server.mjs writeGoalStep): the task made, then added to the Part lines of the blocks it is for.
  const step = async ({ thread, index, goal }) => {
    const made = goalStepFor(thread, index, goal)
    const id = `B${next++}`
    let out = { ok: true, text: utf8(fs.files[MAP]) }
    for (const title of made.blocks ?? []) out = addPartStep(out.text, goal, title, id)
    fs.files[MAP] = latin(out.text)
    return { ok: true, result: { id } }
  }
  const dropped = []
  const done = await editThread({ command: 'create', path, steps: [0, 1, 2], drops: [0], seen: utf8(fs.files[`${DIR}/2026-10-19-change-paths.md`]).length }, options(fs, { step, drop: async id => (dropped.push(id), { ok: true }) }))
  assert.equal(done.ok, true, done.why)
  assert.deepEqual(done.result.steps.map(one => [one.title, one.blocks, one.id]), [['Brighter lamps', ['Light the paths'], 'B30'], ['Paint the signs', ['Signs at the gate'], 'B31'], ['Sweep the gravel', [], 'B32']])
  assert.deepEqual(dropped, ['B14'])
  const lines = utf8(fs.files[MAP]).split('\n')
  const own = lines.slice(lines.indexOf('- [~] G6 Paths through the garden') + 1, lines.indexOf('  - [ ] G7 The pond'))
  assert.deepEqual(own, [
    '  Done when: a visitor walks every path without getting lost',
    '  Objective: A garden a visitor crosses without a map.',
    '  Not in it: new benches, lights',
    // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
    '  Goal definition: calm',
    '  Goal definition agreed: 2026-10-18 10:00',
    '  Part: Lay the paths · about 1 h · steps B12 · done when: every bench is on a path',
    '  Part: Light the paths · 30 min · steps B13, B30 · done when: a visitor sees the next bench at night',
    '  Part: Signs at the gate · about 30 min · steps B15, B31 · done when: the gate is signed — from every bench',
    '  Part: The maze · 1 h · steps B14',
    '  How agreed: 2026-10-18 11:00',
    '  Part dropped: The maze · 2026-10-19 09:30 · dropped in the change of 2026-10-19',
    '  Round: 2026-10-19 09:30 · the change of 2026-10-19',
  ])
  assert.ok(!utf8(fs.files[MAP]).includes('Done when 1:'), 'no Done when <n> lines any more')
  const node = parseGoals(utf8(fs.files[MAP])).byId.get('G6')
  assert.deepEqual(node.rounds, [{ at: '2026-10-19 09:30', why: 'the change of 2026-10-19' }])
  assert.deepEqual(node.doneBullets, [])
  // The thread says what was made, and the step it closed.
  assert.match(utf8(fs.files[`${DIR}/2026-10-19-change-paths.md`]), /\nCreated \(09:30\): no goals; tasks B30, B31, B32; dropped: B14; left out: nothing\n$/)
})

test('setGoalBlocks: a kept block the goal does not have is written as new; a block named again is no longer dropped; a bad draft is refused', () => {
  const text = `${BLOCKS}  Part dropped: Lamps · 2026-10-16 09:00 · not needed\n  How agreed: 2026-10-15 09:00\n`
  const done = setGoalBlocks(text, 'G6', { objective: 'A lit garden', blocks: [{ title: 'Lamps', doneWhen: 'every path is lit', kind: 'rework', steps: ['B7'] }, { title: 'Ponds', doneWhen: 'a pond', kind: 'keep', size: 'about 1 h' }], at: '2026-10-19 09:30', date: '2026-10-19' })
  assert.equal(done.ok, true)
  const node = parseGoals(done.text).byId.get('G6')
  assert.deepEqual(node.parts.map(one => [one.title, one.steps, one.doneWhen]), [['Lamps', ['B7'], 'every path is lit'], ['Ponds', [], 'a pond'], ['Paths', ['B4'], 'every bench is on a path']])
  assert.deepEqual(node.partsDropped, [])
  assert.equal(setGoalBlocks(text, 'G6', { objective: '', blocks: [{ title: 'x', kind: 'keep' }] }).why, 'form')
  assert.equal(setGoalBlocks(text, 'G9', { objective: 'x', blocks: [{ title: 'x', kind: 'keep' }] }).why, 'gone')
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

const pageState = (goals, items = [], threads = []) => asSent({ ...build(items, undefined, goals, { threadTexts: threads }), goalsEdit: { canWrite: true } })

test('the Focus page: the switch with its counts; All work blocks with each block\'s line; Open now with its round, ticks and chips; no Done-when card', async () => {
  const page = await openPage({ state: pageState(garden(), gardenTasks) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-strip .focus-stage').map(one => one.children[1].textContent), ['The goal', 'Work blocks', 'The run'])
    assert.equal(page.text('.focus-progress small'), '9 of 10 work blocks done · about 1 h left')
    assert.deepEqual(page.all('[data-focus-blocks]').map(one => [one.dataset.focusBlocks, one.textContent, one.getAttribute('aria-pressed')]), [['all', 'All work blocks9/10', 'true'], ['open', 'Open now2/3', 'false']])
    // All work blocks: today's run card, renamed, each block with its done-when line and its tasks counted.
    assert.equal(page.text('.focus-run h3'), 'All work blocks')
    assert.equal(page.all('.focus-run .focus-part').length, 10)
    assert.equal(page.all('.focus-block-done-when')[2].textContent, 'Done when: line 3')
    assert.equal(page.all('.focus-part')[2].querySelectorAll('.focus-count')[1].textContent, '2 of 2 tasks finished')
    assert.equal(page.all('.focus-toggle')[2].textContent, '▸ Show the 2 tasks')
    assert.equal(page.all('.focus-done-when').length, 0, 'no Done-when card')
    // Open now: one card, the round's line, a line per open block.
    await page.click('[data-focus-blocks="open"]')
    assert.equal(page.window.localStorage.getItem('focus-blocks-view'), 'open', 'the pick is kept')
    assert.equal(page.all('.focus-run').length, 0)
    assert.equal(page.text('.focus-open-now h3'), 'Open now')
    assert.equal(page.text('.focus-round'), 'Round 2 · opened by the evaluation of 17 Oct · 2 of 3 done · the next evaluation starts round 3')
    const rows = page.all('.focus-open-block').map(one => [one.querySelector('.focus-bullet-mark').getAttribute('aria-label'), one.querySelector('.focus-bullet-text').textContent, one.querySelector('.focus-open-line').textContent, one.querySelector('.focus-chip')?.textContent ?? null])
    assert.deepEqual(rows, [
      ['done', 'Block 3', 'Rework: line 3', null],
      ['done', 'Block 5', 'Rework: line 5', null],
      ['not done yet', 'Block 8', 'Rework: line 8', 'In progress'],
    ])
    assert.equal(page.find('[data-focus-blocks="open"]').getAttribute('aria-pressed'), 'true')
    // And back.
    await page.click('[data-focus-blocks="all"]')
    assert.equal(page.all('.focus-run').length, 1)
  } finally {
    await page.close()
  }
})

test('the Focus page: a block made in the round is "New" with a "new" tag in All work blocks; a goal with no blocks has no switch', async () => {
  const extra = ['    Part: Lanterns · about 1 h · steps B40 · done when: every bench has a lantern']
  const page = await openPage({ state: pageState(garden({ extra }), [...gardenTasks, parseItem('Id: B40\nKind: step\nTitle: Hang lanterns\nState: refined\nSince: 2026-10-17 10:30\n')]) })
  try {
    await page.click('[data-tab="advice"]')
    const titles = page.all('.focus-part-top b').map(one => one.textContent)
    assert.equal(titles[10], 'Lanternsnew')
    assert.equal(titles.filter(one => one.endsWith('new')).length, 1)
    await page.click('[data-focus-blocks="open"]')
    const last = page.all('.focus-open-block').at(-1)
    assert.equal(last.querySelector('.focus-open-line').textContent, 'New: every bench has a lantern')
    assert.equal(last.querySelector('.focus-chip').textContent, 'On the list for a worker')
  } finally {
    await page.close()
  }
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  const bare = await openPage({ state: pageState(['Focus: G6', '', '- [~] G6 Garden', '    Done when: x', '    Goal definition: calm', '    Goal definition agreed: 2026-10-15 08:00', '    How agreed: 2026-10-15 09:00', ''].join('\n')) })
  try {
    await bare.click('[data-tab="advice"]')
    assert.equal(bare.all('[data-focus-blocks]').length, 0)
  } finally {
    await bare.close()
  }
})

test('"Did we reach the goal?" shows the blocks\' lines, all ticked, for a goal without its one-line Done when', async () => {
  const done = gardenTasks.map(one => (one.head.get('Id') === 'B28' ? task('B28', 'done', '2026-10-17 11:10', '2026-10-18 10:00') : one))
  const page = await openPage({ state: pageState(garden(), done) })
  try {
    await page.click('[data-tab="advice"]')
    assert.deepEqual(page.all('.focus-there .focus-done-when-line').map(one => one.textContent), TEN.map(n => `line ${n}`))
    // It has its Done when: Yes waits only for the goal demo.
    assert.equal(page.find('.focus-there [data-focus-act="vibe-there-yes"]').title, 'Your partner makes the goal demo first: you see it before you answer')
  } finally {
    await page.close()
  }
})

test('the Brainstorm part: a change in work blocks shows each block with what it does and its line; the Result says how many blocks', async () => {
  const path = `${FOLDER}/2026-10-19-change-paths.md`
  const page = await openPage({ state: pageState(CHANGE_GOALS, [], [{ path, text: `${HEAD}${UNDERSTOOD}${PROPOSAL}`, at: 1 }]), answers: () => reply({}) })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-advisor-pane="brainstorm"]')
    const blocks = page.all('.brainstorm-block').map(one => [one.querySelector('.brainstorm-block-title').textContent, one.querySelector('.brainstorm-block-kind').textContent, one.querySelector('.brainstorm-block-done-when').textContent])
    assert.deepEqual(blocks, [
      ['Lay the paths', 'kept', 'Done when: every bench is on a path'],
      ['Light the paths', 'to rework', 'Done when: a visitor sees the next bench at night'],
      ['Signs at the gate', 'new', 'Done when: the gate is signed — from every bench'],
      ['The maze', 'dropped', 'Done when: the maze is walked'],
    ])
    await page.click('[data-brainstorm-act="agree"]')
    assert.equal(page.text('.brainstorm-replan-title'), 'Re-plan G6 · each work block against its tasks')
    assert.deepEqual(page.all('.brainstorm-block-plan .brainstorm-bullet-title').map(one => one.textContent), ['1. Lay the pathskept', '2. Light the pathsto rework', '3. Signs at the gatenew', '4. The mazedropped'])
    assert.deepEqual(page.all('.brainstorm-block-plan')[1].querySelectorAll('[data-tick]').length, 1)
  } finally {
    await page.close()
  }
  const created = `${HEAD}${UNDERSTOOD}${PROPOSAL}Created (09:30): no goals; tasks B30, B31; dropped: B14; left out: Sweep the gravel\n`.replace('State: running', 'State: done')
  const items = [parseItem('Id: B30\nKind: step\nTitle: Brighter lamps\nState: new\nSince: 2026-10-19 09:30\n'), parseItem('Id: B31\nKind: step\nTitle: Paint the signs\nState: refined\nSince: 2026-10-19 09:30\n')]
  const result = await openPage({ state: pageState(CHANGE_GOALS, items, [{ path, text: created, at: 1 }]) })
  try {
    await result.click('[data-tab="advice"]')
    await result.click('[data-advisor-pane="brainstorm"]')
    assert.equal(result.text('.brainstorm-result-line'), 'G6 now has 3 work blocks: 1 new, 1 to rework, 1 dropped. See it on the Focus page')
    assert.deepEqual(result.all('.brainstorm-result-block').map(one => one.textContent), ['for Light the paths', 'for Signs at the gate'])
  } finally {
    await result.close()
  }
})

test('the change and this test hold no name of the first project', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const ties = [new RegExp(['Game', ' - '].join('')), new RegExp(['lava', '[ -]?', 'tactics'].join(''), 'i'), new RegExp(['C:', '[\\\\/]+', 'Web', '\\b'].join(''), 'i'), new RegExp(['art', '-inbox'].join('')), new RegExp(['bob', 'du'].join(''), 'i')]
  for (const file of ['test/workBlocks.test.mjs', 'roles/product-owner.md']) {
    const text = await readFile(join(root, file), 'utf8')
    for (const tie of ties) assert.equal(text.match(tie), null, `${file}: ${tie}`)
  }
})
