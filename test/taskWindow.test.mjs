// B701: a step's window opens on a Summary in plain words (the person, 2026-10-26: "way too much information ... 2
// lines of context, then brief what happened, conclusion, possible options ... i want lots of pictures"). The checker
// files the plain lines (`tried:`, `why:`, `conclusion:`) beside the points; the board keeps them apart and never counts
// them; the page draws the Summary from them, the older checks from their counts. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { workApi } from '../src/work/api.mjs'
import { itemOfStep, storeFromText } from '../src/work/read.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { parseItem } from '../src/work/item.mjs'
import { checkedOf, parsePoints, triesOf } from '../src/work/resultCheck.mjs'
import { checkLinesWarning } from '../src/work/recapWords.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { queueFor } from './queueFor.mjs'
import { checkedBy } from './qaKit.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('item')}\n${cut('lanewindow')}\n${cut('taskwindow')}\nObject.assign(this, { summaryOf, plainSentences, isTaskStep, TASK_TABS, standardPicture })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the points of a check keep the plain lines apart: never counted as points, in any order', () => {
  const read = parsePoints(['pass: a lamp at every bench', 'tried: moved the lamps by hand', 'fail: warm light, never white', 'why: the glow comes out white', 'conclusion: the glow needs its own pass'])
  assert.equal(read.ok, true)
  assert.deepEqual(read.points, [{ verdict: 'pass', text: 'a lamp at every bench' }, { verdict: 'fail', text: 'warm light, never white' }])
  assert.deepEqual(read.notes, { tried: 'moved the lamps by hand', why: 'the glow comes out white', conclusion: 'the glow needs its own pass' })
  // Plain lines alone are no check; another word is still no point.
  assert.equal(parsePoints(['tried: x', 'why: y']).ok, false)
  assert.equal(parsePoints(['harm: x']).ok, false)
})

const CHECKED = ['Evidence: pictures/b2/evidence.png', 'Score: 61 of 75', 'Tried: repaint to fit the layout', 'Why: the edges are cut off', '- pass: a lamp at every bench', '- fail: warm yellow light, never white']
const step = (id, state, checked = null, extra = '') => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-10-19 09:00\n${extra}${checked === null ? '' : `\n## Checked\n${checked.join('\n')}\n`}`)

test('a step\'s check reads its plain lines when it has them, and nothing more when it has none', () => {
  const check = checkedOf(step('B2', 'review', CHECKED))
  assert.equal(check.tried, 'repaint to fit the layout')
  assert.equal(check.why, 'the edges are cut off')
  assert.equal(check.conclusion, undefined)
  assert.equal(check.passed, 1)
  assert.equal(check.total, 2)
  assert.deepEqual(checkedOf(step('B3', 'review', ['Evidence: none (x)', '- pass: a'])), { evidence: 'none (x)', score: null, points: [{ verdict: 'pass', text: 'a' }], passed: 1, total: 1 })
})

test('the tries of a chain: the first step and each fix, oldest first, each with its own check', () => {
  const items = new Map([
    ['B2', step('B2', 'review', CHECKED)],
    ['B5', step('B5', 'review', ['Evidence: pictures/b5/evidence.png', 'Tried: painted on the layout', '- fail: edges cut off', '- fail: a band of still lava'], 'Fix of: B2\n')],
    ['B7', step('B7', 'in progress', null, 'Fix of: B5\n')],
    ['B8', step('B8', 'dropped', null, 'Fix of: B2\n')],
    ['B6', step('B6', 'dropped', ['Evidence: pictures/b6/evidence.png', 'Tried: cut it by colour', '- fail: floors cut away'], 'Fix of: B2\n')],
  ])
  const tries = plain(triesOf('B5', items))
  // B706: a dropped fix that was checked is a try (B670's B683, 72 of 75: dropped by the person, but tried); one that never was (B8) is none.
  assert.deepEqual(tries.map(one => [one.id, one.state, one.check === null ? null : [one.check.passed, one.check.total]]), [['B2', 'review', [1, 2]], ['B5', 'review', [0, 2]], ['B6', 'dropped', [0, 1]], ['B7', 'in progress', null]])
  assert.deepEqual(tries[0].check.failed, ['warm yellow light, never white'])
  assert.deepEqual(tries[0].check.points, [{ verdict: 'pass', text: 'a lamp at every bench' }, { verdict: 'fail', text: 'warm yellow light, never white' }])
  assert.equal(tries[1].check.tried, 'painted on the layout')
  assert.equal(tries[1].check.why, null)
  // The same chain from any of its steps; a step with no fix is a chain of one.
  assert.deepEqual(plain(triesOf('B2', items)).map(one => one.id), ['B2', 'B5', 'B6', 'B7'])
  assert.deepEqual(plain(triesOf('B6', items)).map(one => one.id), ['B2', 'B5', 'B6', 'B7'])
  assert.deepEqual(plain(triesOf('B8', new Map([['B8', step('B8', 'review')]]))).map(one => one.id), ['B8'])
})

test('the work store gives a step its tries and its standard, and "checked" files the plain lines without counting them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-window-'))
  const at = new Date(2026, 9, 26, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Lava', '- [ ] B1 Moving lava on a painted map', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker', Checker: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter', 'Checker'] }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  // T9.1.1: the result check is filed by the worker that holds the step's QA task, a worker that did not build it.
  const checkedAs = (id, body) => checkedBy({ as, server: call => workApi(call, { ...ctx, as: 'server' }), dir, now: at + 60_000 }, id, body)
  assert.equal((await as('Partner')({ action: 'refine', id: 'B1', summary: 'A painted map where the lava really moves.' })).ok, true)
  assert.equal((await as('Partner')({ action: 'refined', id: 'B1', what: ['the lava moves', 'the painting sits on the layout'] })).ok, true)
  assert.equal((await queueFor(dir, 'B1', 'Painter', { now: at + 60_000 })).ok, true)
  assert.equal((await as('Painter')({ action: 'take', id: 'B1', branch: 'b1-lava' })).ok, true)
  assert.equal((await as('Painter')({ action: 'report', id: 'B1', result: 'Done.', merged: 'c0ffee1' })).ok, true)
  assert.equal((await workApi({ action: 'check', id: 'B1', passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  const checked = await checkedAs('B1', {
    evidence: 'none (nothing on screen)',
    points: ['pass: the lava moves', 'tried: cut the lava out by its colour', 'fail: the painting sits on the layout', 'why: floors and props were cut away too', 'conclusion: cutting it better will not solve that'],
  })
  assert.equal(checked.ok, true, checked.why)
  const work = { ok: true, dir, ...(await readStore(dir)) }
  const item = itemOfStep(work, 'B1')
  assert.deepEqual([item.checked.passed, item.checked.total], [1, 2])
  assert.deepEqual([item.checked.tried, item.checked.why, item.checked.conclusion], ['cut the lava out by its colour', 'floors and props were cut away too', 'cutting it better will not solve that'])
  assert.deepEqual(item.tries.map(one => [one.id, one.check?.failed ?? null]), [['B1', ['the painting sits on the layout']], [checked.result.fix, null]])
  // The plain lines stand in the record beside the points, so another reader finds them.
  assert.match((await readFile(join(dir, 'B1.md'), 'utf8')), /Tried: cut the lava out by its colour\nWhy: floors and props were cut away too\nConclusion: cutting it better will not solve that\n- pass: the lava moves\n- fail: the painting sits on the layout/)
})

// The Summary

const tryOf = (id, title, check) => ({ id, title, state: 'review', check })
const check = (passed, total, extra = {}) => ({ passed, total, failed: [], evidence: null, score: null, tried: null, why: null, conclusion: null, ...extra })
const base = { summary: ['A painted map where the lava really moves in the game. The painting should look like the target and the lava should flow around the floors. It also needs a third sentence.'], picture: null, standard: null }

test('the Summary: two plain lines of what we want, the target beside the latest result, why, one line per try, the conclusion', () => {
  const item = {
    ...base, standard: 'maps · art-inbox/vision/lava.png · target 75', picture: 'art-inbox/mockup.png (the mockup)',
    tries: [
      tryOf('B1', 'Moving lava', check(1, 3, { evidence: 'art-inbox/B1/evidence.png', tried: 'Cut the lava out by its colour.', why: 'Floors and props were cut away too.' })),
      tryOf('B2', 'Fix: the cut', check(1, 3, { evidence: 'art-inbox/B2/evidence.png', tried: 'Cut the lava out by the map\'s layout.', why: 'The painting does not line up with the layout.' })),
      tryOf('B3', 'Fix: the layout', check(2, 5, { evidence: 'art-inbox/B3/evidence.png', tried: 'Repaint to fit the layout.', why: 'Edges cut off, a band of still lava, 61 of 75.', conclusion: 'The painting never matches the layout. Cutting it better will not solve that.' })),
    ],
  }
  const view = plain(page.summaryOf(item))
  assert.deepEqual(view.want, ['A painted map where the lava really moves in the game.', 'The painting should look like the target and the lava should flow around the floors.'])
  assert.equal(view.target, 'art-inbox/vision/lava.png')
  assert.equal(view.now, 'art-inbox/B3/evidence.png')
  assert.deepEqual(view.why, ['Edges cut off, a band of still lava, 61 of 75.'])
  assert.deepEqual(view.tried.map(one => [one.n, one.way, one.result, one.isFailed]), [
    [1, 'Cut the lava out by its colour', 'Floors and props were cut away too', true],
    [2, 'Cut the lava out by the map\'s layout', 'The painting does not line up with the layout', true],
    [3, 'Repaint to fit the layout', 'Edges cut off, a band of still lava, 61 of 75', true],
  ])
  // A picture of each failed try, but the latest one stands as "now" already.
  assert.deepEqual(view.triedPictures.map(one => one.path), ['art-inbox/B1/evidence.png', 'art-inbox/B2/evidence.png'])
  assert.match(view.triedPictures[0].caption, /^Try 1 · /)
  assert.equal(view.conclusion, 'The painting never matches the layout. Cutting it better will not solve that.')
  assert.deepEqual([view.failed, view.isFailed], [3, true])
})

test('without a standard the step\'s own picture is the target; a part with nothing to show is left empty', () => {
  const view = plain(page.summaryOf({ ...base, picture: 'art-inbox/mockup.png (the mockup)', tries: [tryOf('B1', 'Moving lava', null)] }))
  assert.equal(view.target, 'art-inbox/mockup.png')
  assert.deepEqual([view.now, view.why, view.tried, view.triedPictures, view.conclusion, view.failed, view.isFailed], [null, [], [], [], null, 0, false])
  // A standard that names none gives none either.
  assert.equal(page.standardPicture('none (a board rule)'), null)
  assert.deepEqual(plain(page.summaryOf({ ...base, summary: [], tries: [] })).want, [])
})

test('an older check, with no plain lines, shows the step\'s title and its count; its failed points say why, cleaned', () => {
  const item = { ...base, tries: [
    tryOf('B1', 'Fix the old wording', check(7, 10, { failed: ['The guide page `docs/rules.md` still says the old rule.', 'One case is untested.'], evidence: 'none (nothing on screen)' })),
    tryOf('B2', 'Fix: the same wording again', check(8, 10, { failed: ['Old wording in three more pages. One case is untested.'], evidence: 'none (nothing on screen)' })),
  ] }
  const view = plain(page.summaryOf(item))
  assert.deepEqual(view.tried.map(one => [one.n, one.way, one.result]), [[1, 'Fix the old wording', '7 of 10 points passed'], [2, 'Fix: the same wording again', '8 of 10 points passed']])
  // Evidence "none" is no picture.
  assert.deepEqual([view.now, view.triedPictures], [null, []])
  // B706: the failed points are never quoted (B696: "Suite 2688 tests, 0 fail"); the count says what passed, so 7 of 10 never reads as 7 failed.
  assert.deepEqual(view.why, ['The latest check passed 8 of 10 points.'])
  assert.deepEqual(plain(page.summaryOf({ ...base, tries: [tryOf('B1', 'x', check(2, 5, { failed: ['Edit `a.mjs` now.'] }))] })).why, ['The latest check passed 2 of 5 points.'])
  // A fix whose title is not plain is just "a fix".
  assert.equal(plain(page.summaryOf({ ...base, tries: [tryOf('B1', 'x', check(1, 2)), tryOf('B2', 'Fix: the cut equals guide-lava.png exactly', check(1, 2))] })).tried[1].way, 'a fix')
})

test('the plain lines leave out code, files, paths and ids', () => {
  assert.deepEqual(plain(page.plainSentences('Floors were cut away. See B684 for why. It lives in public/board.js. The `probe` fails. The painting is off.')), ['Floors were cut away.', 'The painting is off.'])
  const item = { ...base, tries: [tryOf('B9', 'Fix', check(0, 2, { tried: 'Changed `board.css` in B9.', why: 'The page src/state.mjs broke.' }))] }
  const view = plain(page.summaryOf(item))
  // Nothing plain is left of either: the title, then the count.
  assert.deepEqual([view.tried[0].way, view.tried[0].result], ['Fix', '0 of 2 points passed'])
})

test('a passed latest check gives no "why" and no failure; the window opens on the Summary only from the taking on', () => {
  const view = plain(page.summaryOf({ ...base, tries: [tryOf('B1', 'x', check(2, 5, { tried: 'A first build.', why: 'Looks off.' })), tryOf('B2', 'Fix', check(2, 2, { tried: 'Fixed the look.' }))] }))
  assert.deepEqual([view.why, view.isFailed, view.failed], [[], false, 1])
  assert.deepEqual(view.tried.map(one => [one.n, one.isFailed, one.result]), [[1, true, 'Looks off'], [2, false, '']])
  for (const state of ['taken', 'in progress', 'waiting on you', 'review', 'done', 'dropped']) assert.equal(page.isTaskStep({ state }), true, state)
  for (const state of ['new', 'refined', 'queued']) assert.equal(page.isTaskStep({ state }), false, state)
  assert.equal(page.isTaskStep(null), false)
  assert.deepEqual(plain(page.TASK_TABS).map(([key]) => key), ['summary', 'checks', 'history', 'settings'])
})

// The options: the step's open questions, and the goal guard's question of its goal

const line = pattern => pattern.exec(script)[0]
const asks = {}
vm.runInNewContext(`${line(/const isStep = [^\n]*/)}\n${line(/const isCalm = [^\n]*\n[^\n]*/)}\n${cut('item')}\n${cut('lanewindow')}\n${cut('taskwindow')}\n${cut('focus')}\nObject.assign(this, { taskAsksOf, focusGuardView })`, asks)

const ask = (id, of, extra = {}) => ({ id: `ask:${id}`, workId: id, canAnswer: true, answer: null, of, at: Number(id.slice(1)), ...extra })

test('a step\'s window offers the open questions of the step, oldest first, and no other', () => {
  const needs = [
    ask('Q9', 'B1'), ask('Q4', 'B1'), ask('Q5', 'B2'), ask('Q6', 'B1', { answer: 'done' }), ask('Q7', 'B1', { canAnswer: false }),
    ask('Q8', 'B1', { isRefine: true }), { ...ask('Q10', 'B1'), activity: 'Maps' },
  ]
  assert.deepEqual(plain(asks.taskAsksOf('B1', needs)).map(one => one.workId), ['Q4', 'Q9'])
  assert.deepEqual(plain(asks.taskAsksOf('B3', needs)), [])
})

test('the question the goal guard asks of its goal (Fable or Opus) stands among the options of the step that failed', () => {
  const needs = [ask('Q4', 'G2'), ask('Q5', 'B1')]
  assert.deepEqual(plain(asks.taskAsksOf('B1', needs)).map(one => one.workId), ['Q5'])
  assert.deepEqual(plain(asks.taskAsksOf('B1', needs, 'Q4')).map(one => one.workId), ['Q4', 'Q5'])
})

test('the card of the three failed checks opens the failed step\'s window, where the question is the options', () => {
  const asking = plain(asks.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'asking', ask: 'Q7', step: 'B4' } }))
  assert.deepEqual(asking.needs, { label: 'See what was tried and answer Q7', ask: 'Q7', step: 'B4' })
  // Without a step to open it stays as it was; so do the other states.
  assert.deepEqual(plain(asks.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'asking', ask: 'Q7' } })).needs, { label: 'Answer Q7', ask: 'Q7' })
  assert.equal(plain(asks.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'rebuild', ask: 'Q9', step: 'B4' } })).needs.step, undefined)
  assert.match(script, /if \(needs\.dataset\.openStep !== undefined && board !== null\) return openStepWindow\(board, needs\.dataset\.openStep\)/)
})

test('the guard names the step whose failed check was the newest, for that card', async () => {
  const { guardOf } = await import('../src/goalGuard.mjs')
  const { parseGoals } = await import('../src/goals.mjs')
  const failed = (id, state, ...checks) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nGoal: G2\nSince: 2026-10-19 08:00\n\n## History\n${checks.map(one => `- ${one} Partner: result check failed: 1 of 3 points pass; fix B9 for W1`).join('\n')}\n`)
  const goal = parseGoals('Last id: G2\nFocus: G2\n\n- [~] G2 Benches\n    Done when: every bench is built\n    Vibe: warm\n    Vibe agreed: 2026-10-19 08:00\n    Part: Benches · about 1 h · steps B1, B2\n    How agreed: 2026-10-19 08:00\n    Fable asked: Q7\n').nodes[0]
  const guard = guardOf(goal, [failed('B1', 'review', '2026-10-19 08:40', '2026-10-19 09:00'), failed('B2', 'review', '2026-10-19 09:20')], [])
  assert.equal(guard.state, 'asking')
  assert.equal(guard.step, 'B2')
})

test('the checker\'s lines start with a capital where they stand as sentences: what we want, why, the conclusion', () => {
  const item = { ...base, summary: ['a painted map where the lava moves.'], tries: [tryOf('B1', 'x', check(1, 3, { tried: 'cut it out', why: 'the edges are cut off', conclusion: 'cutting it better will not help' }))] }
  const view = plain(page.summaryOf(item))
  assert.deepEqual([view.want, view.why, view.conclusion], [['A painted map where the lava moves.'], ['The edges are cut off'], 'Cutting it better will not help'])
  // A try's way and result read on after "Try n:", so they stay as written.
  assert.deepEqual([view.tried[0].way, view.tried[0].result], ['cut it out', 'the edges are cut off'])
})

test('the dialog itself carries none of the attributes the clicks look for: a tab, a card and Send are found from inside it', () => {
  assert.doesNotMatch(script, /box\.dataset\.task(?:Tab|Pick|Send|Words)\b/)
  assert.match(script, /closest\('\[data-task-tab\]'\)/)
})

test('Send in the Summary gives the picked option and the person\'s own words to the store as one answer; nothing picked, nothing sent', async () => {
  const functionSource = name => {
    const from = script.indexOf(`async function ${name}(`)
    return script.slice(from, script.indexOf('\n}\n', from) + 3)
  }
  const sent = []
  const shown = []
  const sandbox = {
    board: {}, detailsOf: { step: 'B1' }, detailsShown: 'x', calmBusy: false, problems: new Map(), sending: new Set(), calmPicks: new Map(), calmWords: new Map(),
    findNeed: id => (id === 'work:Q1' ? need : undefined), drawDetails: () => shown.push('drawn'),
    fail: (id, why) => sandbox.problems.set(id, why),
    sendEach: async (toSend) => { sent.push(...toSend.map(one => one.answer)) },
  }
  const need = { id: 'work:Q1', kind: 'decide', options: [{ label: 'A Paint on the layout' }, { label: 'B Build from pieces' }], advice: 'A' }
  vm.createContext(sandbox)
  vm.runInContext(`${cut('calm')}\n${functionSource('sendTask')}\nthis.sendTask = sendTask`, sandbox)
  // Nothing picked: it says so, sends nothing.
  await sandbox.sendTask('work:Q1')
  assert.deepEqual(sent, [])
  assert.equal(sandbox.problems.get('calm:work:Q1'), 'Pick an option, or write your own idea.')
  // A pick and words: one answer, the pick first, the words under it.
  sandbox.calmPicks.set('work:Q1', 'A Paint on the layout')
  sandbox.calmWords.set('work:Q1', 'Keep the old one as a backup')
  await sandbox.sendTask('work:Q1')
  assert.deepEqual(plain(sent), [{ verdict: null, text: 'A Paint on the layout\nKeep the old one as a backup' }])
  assert.equal(sandbox.problems.has('calm:work:Q1'), false)
  // Words alone are an answer of their own on a decide.
  sent.length = 0
  sandbox.calmPicks.delete('work:Q1')
  await sandbox.sendTask('work:Q1')
  assert.deepEqual(plain(sent), [{ verdict: null, text: 'Keep the old one as a backup' }])
})

test('the probe says which parts the Summary shows and the lines that hold what the person never wants there', async () => {
  const { report } = await import('../tools/task-probe.mjs')
  assert.deepEqual(report('B5', { parts: ['What we want', 'Options'], pictures: 3, loaded: 3, tabs: ['Summary', 'Checks'], bad: [] }), ['B5: What we want · Options', 'pictures: 3 of 3 loaded', 'tabs: Summary · Checks'])
  assert.deepEqual(report('B5', { parts: [], pictures: 2, loaded: 1, tabs: [], bad: ['Changed board.css in B5'] }).slice(3), ['not for the person: Changed board.css in B5'])
})

// B706: the fixes of the result check of B701

const fn = name => {
  const from = script.indexOf(`function ${name}(`)
  assert.ok(from >= 0, `board.js has no function ${name}`)
  return script.slice(from, script.indexOf('\n}\n', from) + 3)
}
const own = {}
vm.runInNewContext(`${line(/const isStep = [^\n]*/)}\n${cut('calm')}\n${cut('item')}\n${cut('lanewindow')}\n${cut('taskwindow')}\nObject.assign(this, { taskGuardAsk, taskQuestion, goalNameOf, taskCheckLines, taskAsksOf })`, own)

test('the chip names the goal as the goal map titles it, without its id', () => {
  const nodes = [{ id: 'G59', title: 'How we build good maps' }, { id: 'G60', title: 'G60 Sounds' }, { id: 'G61', title: '' }]
  assert.equal(own.goalNameOf('G59', nodes), 'How we build good maps')
  assert.equal(own.goalNameOf('G60', nodes), 'Sounds')
  // A goal the map does not know, or one with no title, keeps its id.
  assert.deepEqual(['G61', 'G9'].map(id => own.goalNameOf(id, nodes)), ['G61', 'G9'])
  assert.equal(own.goalNameOf('G9', undefined), 'G9')
  assert.match(script, /text: `Goal: \$\{goalNameOf\(item\.goal, state\.goals\?\.nodes\)\}`/)
})

test('the Checks tab shows one short line per point: a mark and the first words, the whole point on hover', () => {
  const lines = plain(own.taskCheckLines([
    { verdict: 'pass', text: 'The lava moves around the floors. Everything else holds.' },
    { verdict: 'fail', text: 'The painting does not sit on the guide: the painted platform is up to 52 px wider each side and its bottom cliff ends about 50 px above the guide, so the cut squares the outline of every floor' },
    { verdict: 'ask', text: 'Does the glow look right?' },
  ]))
  assert.deepEqual(lines.map(one => [one.verdict, one.mark]), [['pass', '✓'], ['fail', '✗'], ['ask', '?']])
  assert.equal(lines[0].text, 'The lava moves around the floors')
  assert.equal(lines[1].text, 'The painting does not sit on the guide')
  assert.match(lines[1].full, /so the cut squares the outline of every floor$/)
  const long = plain(own.taskCheckLines([{ verdict: 'fail', text: 'Floors and props and torches and stairs and boulders and barrels and crystals and ledges were all cut away by the colour rule at once' }]))
  assert.ok(long[0].text.length <= 111 && long[0].text.endsWith('…'), long[0].text)
  assert.deepEqual(plain(own.taskCheckLines(undefined)), [])
  assert.match(script, /function taskCheckPart\(/)
  assert.match(script, /for \(const one of taskCheckLines\(checked\.points\)\)/)
})

test('the guard\'s question (Fable or Opus) is offered by the one step it is about, with its question; the step\'s own asks by it', () => {
  const guard = { state: 'asking', ask: 'Q7', step: 'B4' }
  const focus = { id: 'G2', guard }
  assert.equal(own.taskGuardAsk({ id: 'B4', goal: 'G2' }, focus), 'Q7')
  // B702 and B696 beside B691: not theirs.
  assert.equal(own.taskGuardAsk({ id: 'B5', goal: 'G2' }, focus), null)
  assert.equal(own.taskGuardAsk({ id: 'B4', goal: 'G3' }, focus), null)
  assert.equal(own.taskGuardAsk({ id: 'B4', goal: 'G2' }, { id: 'G2', guard: { ...guard, state: 'rebuild' } }), null)
  assert.equal(own.taskGuardAsk({ id: 'B4', goal: 'G2' }, null), null)
  const needs = [ask('Q7', 'G2', { title: 'G2 · B4 A failed 3 times: evaluate the strategy with Fable?' }), ask('Q5', 'B5')]
  assert.deepEqual(plain(own.taskAsksOf('B5', needs, own.taskGuardAsk({ id: 'B5', goal: 'G2' }, focus))).map(one => one.workId), ['Q5'])
  assert.deepEqual(plain(own.taskAsksOf('B4', needs, own.taskGuardAsk({ id: 'B4', goal: 'G2' }, focus))).map(one => one.workId), ['Q7'])
  // The question stands above the cards: the guard's in plain words, another ask's without ids.
  assert.match(own.taskQuestion(needs[0], true), /^The checks failed three times\. Should the strategy be evaluated by Fable/)
  assert.equal(own.taskQuestion({ title: 'B12 or B13 first, thin or thick?', question: 'Q9 · Thin or thick strip?' }, false), 'Thin or thick strip?')
  assert.match(script, /part\.append\(el\('p', 'task-question', taskQuestion\(need, isGuard\)\)\)/)
  assert.doesNotMatch(script, /if \(asks\.length > 1\) part\.append/)
  assert.match(script, /taskAsksOf\(taskItem\.id, everyNeed\(state\), taskGuardAsk\(taskItem, state\.focus\)\)/)
})

test('the guard names the first step of the chain whose failed check was the newest: the step the question is about', async () => {
  const { guardOf } = await import('../src/goalGuard.mjs')
  const { parseGoals } = await import('../src/goals.mjs')
  const failed = (id, state, fixOf, ...checks) => parseItem(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nGoal: G2\n${fixOf === null ? '' : `Fix of: ${fixOf}\n`}Since: 2026-10-19 08:00\n\n## History\n${checks.map(one => `- ${one} Partner: result check failed: 1 of 3 points pass; fix B9 for W1`).join('\n')}\n`)
  const goal = parseGoals('Last id: G2\nFocus: G2\n\n- [~] G2 Benches\n    Done when: every bench is built\n    Vibe: warm\n    Vibe agreed: 2026-10-19 08:00\n    Part: Benches · about 1 h · steps B1, B2, B3\n    How agreed: 2026-10-19 08:00\n    Fable asked: Q7\n').nodes[0]
  // B1 failed, its fix B2 failed, its fix B3 failed: the third failure is B3's, the question is about the chain B1 started.
  const guard = guardOf(goal, [failed('B1', 'review', null, '2026-10-19 08:40'), failed('B2', 'review', 'B1', '2026-10-19 09:00'), failed('B3', 'review', 'B2', '2026-10-19 09:20')], [])
  assert.deepEqual([guard.state, guard.step], ['asking', 'B1'])
})

test('a failed check\'s plain lines are checked when it is filed: missing, or with file names, ids or counts, it is taken, and the answer and the History line say so', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-window-'))
  const at = new Date(2026, 9, 26, 12, 0).getTime()
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Lava', '- [ ] B1 Moving lava on a painted map', '- [ ] B2 Warm benches', '- [ ] B3 Soft rugs', ''].join('\n'), { now: at }), undefined, { now: at })
  const ctx = { dir, now: at + 60_000, prefix: '', roleOf: chat => ({ Partner: 'advisor', Keeper: 'main', Painter: 'worker', Checker: 'worker' })[chat] ?? null, freeChats: new Set(['Painter']), chats: ['Partner', 'Keeper', 'Painter', 'Checker'] }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  const checkedAs = (id, body) => checkedBy({ as, server: call => workApi(call, { ...ctx, as: 'server' }), dir, now: at + 60_000 }, id, body)
  for (const id of ['B1', 'B2', 'B3']) {
    assert.equal((await as('Partner')({ action: 'refine', id, summary: 'A thing that should work.' })).ok, true)
    assert.equal((await as('Partner')({ action: 'refined', id, what: ['it works'] })).ok, true)
    assert.equal((await queueFor(dir, id, 'Painter', { now: at + 60_000 })).ok, true)
    assert.equal((await as('Painter')({ action: 'take', id, branch: `${id.toLowerCase()}-x` })).ok, true)
    assert.equal((await as('Painter')({ action: 'report', id, result: 'Done.', merged: 'c0ffee1' })).ok, true)
    assert.equal((await workApi({ action: 'check', id, passed: true, lines: ['branch gone'] }, { ...ctx, as: 'server' })).ok, true)
  }
  const file = (id, points) => checkedAs(id, { evidence: 'none (x)', points })
  // Plain lines: no warning anywhere.
  const good = await file('B1', ['fail: it works', 'tried: cut the lava out by its colour', 'why: floors and props were cut away too'])
  assert.equal(good.ok, true, good.why)
  assert.equal(good.result.warnings, undefined)
  assert.doesNotMatch(good.result.text, /Board warning/)
  // None at all: taken, and said once in the answer and in the step's History line.
  const none = await file('B2', ['fail: it works'])
  assert.equal(none.ok, true, none.why)
  assert.match(none.result.warnings, /no "tried:" line; no "why:" line/)
  assert.match(none.result.text, /Board warning: the task window leaves out this check's plain lines/)
  const history = (await readFile(join(dir, 'B2.md'), 'utf8')).split('\n').filter(one => /result check failed/.test(one))
  assert.equal(history.length, 1)
  assert.match(history[0], /result check failed: 0 of 1 points pass; fix B\d+ for \w+; the task window leaves out this check's plain lines \(no "tried:" line; no "why:" line\)/)
  // File names, ids and counts: the same.
  const raw = await file('B3', ['fail: it works', 'tried: changed public/board.js in B3', 'why: 2688 tests pass but the suite 7 of 10 points holds'])
  assert.equal(raw.ok, true, raw.why)
  assert.match(raw.result.warnings, /"tried:" line holds file names \(public\/board\.js\), ids \(B3\)/)
  assert.match(raw.result.warnings, /"why:" line holds counts \(2688 tests, 7 of 10 points\)/)
  // A check that fails nothing has no tries to tell: no warning.
  assert.equal(checkLinesWarning({}, 0), '')
})

test('Settings holds what the step\'s window had: worker, state, model and effort, flow, folder and branch, pin, close and delete', () => {
  class Node {
    constructor(tag) { Object.assign(this, { tag, className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', value: '' }) }
    append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one) }
    setAttribute(name, value) { this.attrs[name] = value }
  }
  const text = node => [node.textContent, ...(node.children ?? []).map(text)].join(' ')
  const find = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => find(one, test))]
  const sandbox = { document: { createElement: tag => new Node(tag) }, problems: new Map(), sending: new Set() }
  const names = ['el', 'section', 'copyRow', 'flowPart', 'itemPart', 'holding', 'queueChoice', 'queueButton', 'pinPart', 'pinChangePart', 'editPart', 'taskSettings', 'taskSettingsTab']
  vm.runInNewContext(`${cut('item')}\n${cut('taskwindow')}\n${names.map(fn).join('\n')}\nObject.assign(this, { taskSettingsTab })`, sandbox)
  const item = {
    id: 'B12', state: 'in progress', owner: 'Worker 3', summary: [], picture: null, goal: 'G5', what: [], requirements: [], touches: [], history: [], checked: null, fixOf: null,
    effort: { level: 'high', isSet: true, why: 'the window is used everywhere' }, model: { family: 'sonnet', isSet: true, why: 'the design is agreed' },
  }
  const strip = { states: [{ name: 'taken', tone: 'plain' }, { name: 'in progress', tone: 'working' }], isKnown: true, state: 'in progress', next: ['review'] }
  const state = { chats: [{ name: 'Worker 1', isMain: false, isLeftover: false, folders: [] }, { name: 'Worker 3', isMain: false, isLeftover: false, folders: [{ branch: 'b12-x', path: 'C:/work/b12' }] }], otherFolders: [], taskTimes: { efforts: [] }, readyList: { ready: [], held: [{ id: 'B12', choice: true }] } }
  const step = { id: 'B12', title: 'Build the shop', status: 'open', item: { pinned: null, state: 'refined' }, branch: 'b12-x' }
  const nodes = sandbox.taskSettingsTab({ item, need: null, subject: { step }, lane: null, step, strip, state })
  const all = nodes.map(text).join(' | ')
  for (const word of ['Worker', 'Worker 3', 'State', 'in progress', 'Model and effort', 'Sonnet', 'high', 'Flow', 'taken', 'Files / Branch', 'C:/work/b12', 'b12-x']) assert.ok(all.includes(word), `Settings lacks "${word}": ${all}`)
  const buttons = nodes.flatMap(one => find(one, node => node.tag === 'button'))
  assert.deepEqual(plain(buttons.map(one => one.textContent).filter(one => one !== 'Copy')), ['Add to queue', 'Close task', 'Delete task'])
  assert.deepEqual(plain(buttons.filter(one => one.dataset.editAction !== undefined).map(one => [one.dataset.editAction, one.dataset.editStep])), [['close', 'B12'], ['delete', 'B12']])
  // Pinned: Unpin; a step the board gave to its lane: the lane's note.
  const pinned = sandbox.taskSettingsTab({ item, need: null, subject: { step: { ...step, item: { pinned: 'Worker 1' } } }, lane: null, step, strip, state })
  assert.ok(pinned.flatMap(one => find(one, node => node.tag === 'button')).some(one => one.textContent === 'Unpin'))
  const given = sandbox.taskSettingsTab({ item, need: null, subject: {}, lane: { name: 'Worker 3' }, step, strip, state }).map(text).join(' | ')
  assert.match(given, /The board gave it to Worker 3/)
  // A done step has no Close, a step without a flow no Flow part.
  const doneStep = sandbox.taskSettingsTab({ item: { ...item, state: 'done' }, need: null, subject: { step: { ...step, status: 'done' } }, lane: null, step, strip: null, state })
  assert.deepEqual(plain(doneStep.flatMap(one => find(one, node => node.tag === 'button')).map(one => one.dataset.editAction).filter(Boolean)), ['delete'])
  assert.doesNotMatch(doneStep.map(text).join(' | '), /Flow/)
})
