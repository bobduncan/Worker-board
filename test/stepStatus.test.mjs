// P7 of the one wait system (chat 1's plan 2026-11-09; the person, 2026-11-10 ~21:30, after three wrong signals: "something is not
// right", then "1 yes"): one status per step, src/stepStatus.mjs, read by every view. The real cases, trimmed from the live store
// with made-up paths (B323): B1096 at 21:30 on 10 Nov, refined for G60 with a Standard of the kind screen while K6 Screens had no
// foundation built (the hand-out held it; the Focus part said "B1096 · waiting for a worker"); B1030, new since 4 Nov, its refine
// block of round 2 standing and its last refine word delivered on 4 Nov 22:22 (the Advisor card said "Your answers on B1030 wait
// for the Advisor" with nothing sent). Then each view takes the one status, the guard, and the signal to Main and the partner.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { planState } from '../src/plan.mjs'
import { recapRoundOf, reworkOf } from '../src/recapRound.mjs'
import { FREE_SIGNAL_MINUTES, STATUS_PHRASES, WAITING_FOR_A_WORKER, blockChipWords, causeClassOf, noneReadyOf, stepStatusOf, stepStatusesOf } from '../src/stepStatus.mjs'
import { outboxKnown, outboxNow } from '../src/store.mjs'
import { incidentCards } from '../src/supervisor/cards.mjs'
import { applySync } from '../src/supervisor/loop.mjs'
import { REPAIR_RULES } from '../src/supervisor/rules/repair.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { stringLiterals } from './stringLiterals.mjs'
import { readyList } from '../src/work/handOut.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { standardHold } from '../src/work/standardHold.mjs'
import { openPage } from './pageHarness.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const MIN = 60_000
/** 10 Nov 2026, the local clock (as the store's stamps are). */
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime()
const NOW = at(10, 21, 30)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

// ---- the real records, trimmed ----

/** K6 as the product plan held it on 10 Nov: confirmed, of the kind screen, its foundation (the one frame) not built. */
const PLAN = ['# Product plan', '', '## Standards', '', '### K6 · Screens', '', '- State: confirmed (you, 2026-10-24)', '- Kind: screen',
  '- Foundation: one frame every painted screen shares (the 16:9 stage, the words laid on it by shares, the stone tablet button) · about 6 h', ''].join('\n')

/** B1096 at 21:30 on 10 Nov: refined (round 1), ready, for G60, its Standard of the kind screen. */
const B1096 = () => parseItem(['Id: B1096', 'Kind: step', 'Title: Old maps always recognisable, and no new code-drawn map is made', 'State: refined',
  'Activity: Look: make the game compare to the reference pictures', 'Goal: G60', 'Since: 2026-11-09 16:16', 'Refined: ready', '',
  '## Standard', 'screen · art-inbox/anywhere/plate.png · target 75', '',
  '## Refined', '  Refined (round 1, by Advisor, 2026-11-09 16:16; ready):', '  Summary: A plate in every fight on a map without a painting.', '  Size: about 3 h', '',
  '## History', '- 2026-11-09 15:48 Main: made', '- 2026-11-09 16:16 Advisor: refined, round 1', '- 2026-11-09 16:16 Advisor: new → refined', ''].join('\n'))

/** B1030 as the store holds it: new, a fix of B1011, its refine block of round 2 written 4 Nov 22:17, no question open. */
const B1030 = (extra = []) => parseItem(['Id: B1030', 'Kind: step', 'Title: Fix: The new Done when, harm as the measure', 'Priority: fix', 'State: new',
  'Activity: Worker board for any project (B126)', 'Goal: G15', 'Since: 2026-11-04 22:10', 'Fix of: B1011', 'Refined: open', ...extra, '',
  '## Refined', '  Refined (round 2, by Advisor, 2026-11-04 22:17):', '  Summary: Answer the chat at once, then rebuild and run the jobs.', '  Part of: G15', '',
  '## History', '- 2026-11-04 22:10 Worker 1: made by the result check of B1011', '- 2026-11-04 22:17 Advisor: refined, round 2', ''].join('\n'))

/** The board's last three refine words about B1030 (outbox.jsonl, folded): all delivered on 4 Nov. */
const B1030_WORDS = [
  { id: 'w1', to: 'Advisor', command: 'refine', about: 'B1030', round: 2, at: at(4, 22, 15), state: 'delivered', takenAt: at(4, 22, 15), deliveredAt: at(4, 22, 15) },
  { id: 'w2', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: at(4, 22, 18), state: 'delivered', takenAt: at(4, 22, 18), deliveredAt: at(4, 22, 20) },
  { id: 'w3', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: at(4, 23, 20), state: 'delivered', takenAt: at(4, 23, 20), deliveredAt: at(4, 23, 22) },
]

const itemsOf = (...list) => new Map(list.map(one => [valueOf(one, 'Id'), one]))
const standards = () => planState(PLAN, [], 'docs/product-plan.md').standards
const handOut = items => readyList(items, { now: NOW, focus: 'G60', standardHold: item => standardHold(item, standards()), beyondFocus: false })

const GOALS = ['Last id: G60', 'Focus: G60', '', '- [~] G60 Every map painted whole', '    Done when: every map is painted', '    Goal definition: painted maps',
  '    Goal definition agreed: 2026-11-09 10:00', '    Part: Old maps · about 3 h · steps B1096 · done when: an old map is known', '    Part: New maps · about 2 h · steps B1098 · done when: a new map is painted', '    How agreed: 2026-11-09 11:00', '- [ ] G15 The board for any project', ''].join('\n')
const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\anywhere', isArchived: false, createdAt: 1, lastActivityAt: NOW - MIN, lastAssistantUuid: 'u' })

/** The board's state at `now` with the two real steps (and `more`), the plan with K6, the goal map with focus G60 and `outbox`. */
function stateWith({ now = NOW, outbox = [], words = null, more = [], lines = [], reports = null, goalRecap = null, pause = null, chats = ['Lead', 'Worker 1', 'Advisor'], noWorkSeen = null, b1030 = B1030() } = {}) {
  const work = storeFromText('## Look\n', { now: now - 60 * MIN })
  for (const one of [B1096(), b1030, ...more]) {
    work.items.set(valueOf(one, 'Id'), one)
    work.activities[0].steps.push(valueOf(one, 'Id'))
  }
  if (pause !== null) work.pause = pause
  return buildState({
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: chats.map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null,
    askTexts: [], pictureLists: {}, work, goalsText: GOALS, productPlanText: PLAN, ...(goalRecap === null ? {} : { goalRecap }),
  }, { lines, outbox, ...(words === null ? {} : { words }), runs: [], now, noWorkSeen, ...(reports === null ? {} : { reports: new Map(reports), board: { startedAt: now - 120 * MIN, offSince: null } }), config: { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\anywhere', productPlan: 'docs/product-plan.md' } })
}
/** B1030's words, as its status says them since the review: no word in flight, with when the last one went. */
const B1030_NO_WORD = 'refine open: no word in flight (last sent 4 Nov 23:20)'

// ---- the real cases ----

test('B1096 (the real case): the hand-out holds it for K6 Screens, and its one status says so, with the hand-out\'s own words; never "waiting for a worker"', () => {
  const items = itemsOf(B1096())
  const list = handOut(items)
  assert.deepEqual(list.ready, [])
  assert.equal(list.held.length, 1)
  assert.match(list.held[0].why, /the foundation of the screen standard \(K6 Screens\) is not built yet/)
  const one = stepStatusOf(items.get('B1096'), { items, ...list, now: NOW })
  assert.equal(one.kind, 'held')
  assert.equal(one.why, list.held[0].why, 'the hand-out\'s own why, word for word')
  assert.equal(one.words, `held: ${list.held[0].why}`)
  assert.notEqual(one.words, WAITING_FOR_A_WORKER)
  assert.equal(one.link, '#details=B1096')
  // Ready only when the hand-out's list has it.
  assert.equal(stepStatusOf(items.get('B1096'), { items, ready: [{ id: 'B1096' }], held: [], now: NOW }).words, WAITING_FOR_A_WORKER)
})

test('B1030 (the real case): its last refine word was delivered on 4 Nov and nothing is open now: never "waits for the Advisor"', () => {
  const items = itemsOf(B1030())
  const one = stepStatusOf(items.get('B1030'), { items, outbox: B1030_WORDS, now: NOW })
  assert.equal(one.kind, 'refine')
  assert.equal(one.toAdvisor, false)
  // The review: B1030 had three words, all delivered on 4 Nov: "no word in flight", with when the last one went.
  assert.equal(one.words, B1030_NO_WORD)
  assert.equal(one.line, `B1030: ${B1030_NO_WORD}`)
  assert.doesNotMatch(one.line, /wait for the Advisor/)
  // With a word open (the person's Send answers, waiting for the Advisor's chat), and only then, it waits for the Advisor.
  const sent = [...B1030_WORDS, { id: 'w4', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'waiting' }]
  const waits = stepStatusOf(items.get('B1030'), { items, outbox: sent, now: NOW })
  assert.equal(waits.toAdvisor, true)
  assert.equal(waits.line, 'Your answers on B1030 wait for the Advisor')
  // A word that arrived 40 minutes ago with no block written since is no longer open (a fix is not on the Advisor's own list).
  const old = [...B1030_WORDS, { id: 'w5', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 40 * MIN, state: 'delivered', deliveredAt: NOW - 40 * MIN }]
  assert.equal(stepStatusOf(items.get('B1030'), { items, outbox: old, now: NOW }).toAdvisor, false)
})

// ---- every view takes the one status ----

test('the state: every step\'s one status, the backlog rows carry it, and the Focus part says B1096 is held (not "on the list", not "waiting for a worker")', () => {
  const state = stateWith({ outbox: B1030_WORDS })
  assert.equal(state.stepStatus.B1096.kind, 'held')
  assert.equal(state.stepStatus.B1096.why, state.readyList.held.find(one => one.id === 'B1096').why)
  assert.equal(state.stepStatus.B1030.toAdvisor, false)
  const rows = state.backlog.flatMap(activity => activity.steps)
  assert.deepEqual(rows.find(one => one.id === 'B1096').stepStatus, state.stepStatus.B1096)
  const part = state.focus.parts.find(one => one.title === 'Old maps')
  assert.equal(part.state, 'waiting')
  assert.equal(part.chip, `Held: B1096 · ${state.stepStatus.B1096.why}`)
})

test('the Focus parts\' rework words (Open now, the recap popup): "B1096 · held: <the hand-out\'s why>", the status the state passes', () => {
  const items = itemsOf(B1096())
  const list = handOut(items)
  const statusOf = item => stepStatusOf(item, { items, ...list, now: NOW })
  const rework = reworkOf(['B1096'], items, { statusOf, now: NOW })
  assert.equal(rework.words, `B1096 · held: ${list.held[0].why}`)
  assert.doesNotMatch(rework.words, /waiting for a worker/)
})

const SCRIPT = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const slice = (start, end) => SCRIPT.slice(SCRIPT.indexOf(start), SCRIPT.indexOf(end))
const plain = value => JSON.parse(JSON.stringify(value))

test('the Goals step rows: B1096\'s badge is Held, its status on hover', () => {
  const page = {}
  vm.runInNewContext(`${slice('// goalsteps:start', '// goalsteps:end')}\nObject.assign(this, { goalStepsView, goalStepBadge })`, page)
  const state = stateWith({ outbox: B1030_WORDS })
  const view = page.goalStepsView(state.goals, 'G60', state.backlog, {})
  const row = view.rows.find(one => one.id === 'B1096')
  assert.deepEqual([row.badge, row.tone], ['Held', 'held'])
  assert.equal(row.status, state.stepStatus.B1096.words)
})

test('the Advisor card: B1030 with nothing sent says so; with a word open, "Your answers on B1030 wait for the Advisor"', () => {
  const page = {}
  vm.runInNewContext(`${slice('// advisorrefine:start', '// advisorrefine:end')}\nObject.assign(this, { advisorRefine })`, page)
  const none = stateWith({ outbox: B1030_WORDS })
  assert.deepEqual(plain(page.advisorRefine(none.backlog)), { step: 'B1030', text: `B1030: ${B1030_NO_WORD}`, tone: 'answered' })
  const open = stateWith({ outbox: [...B1030_WORDS, { id: 'w4', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'delivered', deliveredAt: NOW - MIN }] })
  // A word delivered a minute ago is the refine on its way (the card's first line); the step's own status waits for the Advisor.
  assert.equal(open.stepStatus.B1030.line, 'Your answers on B1030 wait for the Advisor')
})

/** A function of board.js, cut out from its start to the end of its body. */
const fn = name => SCRIPT.slice(SCRIPT.indexOf(`function ${name}(`), SCRIPT.indexOf('\n}\n', SCRIPT.indexOf(`function ${name}(`)) + 3)

test('the backlog: B1096 held with the hand-out\'s why, B1030 "refine open: no word in flight"', () => {
  const page = { document: { createElement: () => ({}) }, problems: new Map(), sending: new Set() }
  vm.runInNewContext(['const MIN = 60000', slice('// times:start', '// times:end'), slice('// chatstatus:start', '// chatstatus:end'), slice('// coordinate:start', '// coordinate:end'), fn('queueChoice'),
    'Object.assign(this, { coordinateList, backlogBlocks })'].join('\n'), page)
  const state = stateWith({ outbox: B1030_WORDS })
  const blocks = plain(page.backlogBlocks(page.coordinateList(plain(state.backlog)), plain(state.readyList)))
  const rowsOf = key => blocks.find(block => block.key === key).rows
  assert.equal(rowsOf('refined').find(row => row.step.id === 'B1096').why, state.stepStatus.B1096.why)
  assert.equal(rowsOf('new').find(row => row.step.id === 'B1030').wait, B1030_NO_WORD)
})

/** A step Worker 1 holds in progress that waits on chat 1's go (P1), for the worker row and the details window. */
const B1081 = () => parseItem(['Id: B1081', 'Kind: step', 'Title: Waits on purpose', 'State: in progress', 'Owner: Worker 1', 'Goal: G15', 'Since: 2026-11-10 21:00',
  'Waits on: chat 1 · its go to land · 2026-11-10 21:10', '', '## History', '- 2026-11-10 21:00 Worker 1: taken → in progress', ''].join('\n'))

test('the worker rows\' task column and the details window take the one status', async () => {
  const state = stateWith({ outbox: B1030_WORDS, more: [B1081()] })
  const status = state.stepStatus.B1081
  assert.equal(status.kind, 'waits-on')
  assert.equal(status.words, 'waits for chat 1: its go to land')
  const shown = plain(state)
  const page = await openPage({ state: shown, now: NOW })
  try {
    // The row of Worker 1, which holds B1081 (the store's record): its task says the status beside the title, and on hover.
    const row = page.all('#lanes [data-lane]').find(one => one.dataset.lane === 'Worker 1')
    assert.ok(row !== undefined, 'Worker 1 has its row')
    const task = row.querySelector('.held-task')
    assert.ok(task !== null, 'its row draws its held step')
    assert.match(words(task), /^B1081 Waits on purpose · waits for chat 1: its go to land$/)
    assert.match(task.title, /Status: waits for chat 1: its go to land/)
  } finally { await page.close() }
  // The details window of the step: its state chip is the status's label, its words on hover.
  const details = await openPage({ state: shown, now: NOW, hash: 'details=B1081' })
  try {
    const chip = details.all('.details-chips .chip')[0]
    assert.ok(chip !== undefined, 'the window has its chips')
    assert.equal(words(chip), 'Waits')
    assert.equal(chip.title, status.words)
  } finally { await details.close() }
})

// ---- the guard ----

const CODE_DIRS = ['src', 'public', 'mods']
async function codeFiles(dir) {
  const out = []
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await codeFiles(path))
    else if (/\.(?:mjs|js|ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}
/**
 * Whether `text` holds `phrase` as words: "is on it" is not in "is on its way". Case-insensitive, but a phrase that starts with a
 * capital ("Refining", the Advisor card's and the Focus chip's word) only as written: "the Advisor is refining it" is a sentence.
 */
const holds = (text, phrase) => new RegExp(`(?<![a-z])${phrase}(?![a-z])`, /^[A-Z]/.test(phrase) ? '' : 'i').test(text)
/**
 * The strings of code that write a status phrase (test/stringLiterals.mjs: every literal, joined across `+`, a template's static
 * parts, never a comment): `[{ line, phrase, text }]`.
 */
export function phraseWriters(text, phrases = STATUS_PHRASES) {
  return stringLiterals(text).flatMap(one => phrases.filter(phrase => holds(one.text, phrase)).map(phrase => ({ line: one.line, phrase, text: one.text })))
}
/**
 * The strings that hold a guarded phrase but say no step's status, each with why (the review asked for the wider phrases; these
 * are a list's name, a chat's pick-up of a word, a block's or a question's worker, a hint): `file`, the literal's words.
 */
const NOT_A_STEP_STATUS = [
  ['src/clicks.mjs', 'the Advisor is on it', "a click's result: the refine gate's own ask (refineAsk) is open"],
  ['src/say.mjs', 'Ready for a worker:  ', "the sync check's name of the ready list"],
  ['src/waitLine.mjs', '  is on it', 'a word picked up by its chat (P3), not a step'],
  ['src/work/handOut.mjs', ' for a worker on  ', "the hand-out's give reason"],
  ['public/board.js', 'Ready for a worker ( )', "the ready list's heading"],
  ['public/board.js', 'the Advisor is on it', "a question's stand with the partner"],
  ['public/board.js', "Every task a chat can do, by where its refine stands: a task goes on the board's list for a worker once it is ready. Click one to open it.", 'the Refine part\'s hint'],
  ['public/board.js', '  is on it', "a block's worker (its card, B689) and a step's card worker beside its status"],
  ['public/board.js', 'The Advisor is on it', "the Refine button's hover while the Advisor's card names the refine"],
  ['public/board.js', 'put on the list for a worker', 'what an idea sent asks of the main chat'],
  // The review: "on it" and "Refining" are guarded too; these say no step's status (a long text by its start, PREFIX characters).
  ['public/board.js', 'The Advisor on it now', "the Refine part's group title (its steps go by their status, src/stepStatus.mjs refineGroupOf)"],
  ['public/board.js', 'Refining', "a Focus block's plain chip word on a board with no chip"],
  ['public/board.js', 'Your words on this task: every chat on it reads them', "the Your words part's hint"],
  ['public/board.js', 'Next for you: one question with 2 or 3 ways, each with a picture. Noth', "the brainstorm's hint"],
  ['public/board.js', 'Switching… the main chat sets it; the line turns solid once your partn', "the partner's mode switch"],
  ['public/board.js', '  done ·   on the backlog ·   not on it yet', "a goal's way totals"],
  ['src/rounds.mjs', "Your focus:     ( ). Write today's note on it", "the partner's daily round word"],
  ['src/say.mjs', 'Own rows: give each of these steps a row of its own', 'a word to the main chat about a recap'],
  ['src/supervisor/rules/watch.mjs', 'a step in progress whose worker works on it for hours', "a rule's description"],
  ['src/waitLine.mjs', '  was on it since  ', 'a word picked up by its chat (P3), not a step'],
  ['src/work/api.mjs', "\n\nTest server port for  :  . Start the game's vite of your worktree on", "the work tool's test port line"],
  ['mods/workers/hooks/chats.ts', 'This chat is " ", a worker in a project where the main chat', "a worker's role text"],
  ['mods/workers/hooks/chats.ts', '(3) the focus goal: its id, its goal definition and how as agreed or d', "the partner's role text"],
  ['mods/workers/hooks/hands.test.ts', 'Message delivered to session local_w1 ("Worker 1"); its turn has start', "a mod test's delivery line"],
  ['mods/workers/hooks/register.tsx', "The project's work items, kept by the person's worker board: one recor", "the work tool's description"],
]
/** An exception names a long literal by its start (at least this many characters); a short one word for word. */
const PREFIX = 30
const isException = (at, text) => NOT_A_STEP_STATUS.some(([where, words]) => where === at && (words === text || (words.length >= PREFIX && text.startsWith(words))))

test('the guard: the known status phrases are written only by src/stepStatus.mjs', async () => {
  const files = [join(ROOT, 'server.mjs'), ...(await Promise.all(CODE_DIRS.map(dir => codeFiles(join(ROOT, dir))))).flat()]
  const writers = []
  for (const file of files) {
    const at = relative(ROOT, file).replace(/\\/g, '/')
    if (at === 'src/stepStatus.mjs') continue
    for (const one of phraseWriters(await readFile(file, 'utf8'))) {
      if (isException(at, one.text)) continue
      writers.push(`${at}:${one.line} "${one.phrase}" in ${JSON.stringify(one.text.slice(0, 80))}`)
    }
  }
  assert.deepEqual(writers, [], 'a status phrase belongs to src/stepStatus.mjs: take the words from there')
  // It sees a writer: a string in code, not a comment.
  assert.deepEqual(phraseWriters("const a = 'waiting for a worker'\n// waiting for a worker\n/* nobody on it */\n").map(one => one.line), [1, 1], 'two phrases of one string, no comment')
  // The review: a phrase split across `+`, over lines too, a template's static part, and a code line that starts with `*`.
  assert.deepEqual(phraseWriters("const a = 'waiting for ' +\n  'a worker'").map(one => one.phrase), ['waiting for a worker', 'for a worker'])
  assert.deepEqual(phraseWriters('const b = `${who} is on it`').map(one => one.phrase), ['is on it', 'on it'])
  assert.deepEqual(phraseWriters("const c = 2\n  * 'being refined'.length").map(one => one.phrase), ['being refined'])
  assert.deepEqual(phraseWriters("const d = /\"x/.test(s) ? 'being refined' : ''").map(one => one.phrase), ['being refined'], 'a regex with a quote in it is no string')
  assert.deepEqual(phraseWriters("const e = 'its way'\nconst f = 'it is on its way'"), [], 'words, not letters')
  // And stepStatus.mjs does write them.
  assert.ok(phraseWriters(await readFile(join(ROOT, 'src', 'stepStatus.mjs'), 'utf8')).length >= 3)
  for (const phrase of ['for a worker', 'being refined', 'is on it', 'on it', 'Refining']) assert.ok(STATUS_PHRASES.includes(phrase), phrase)
  // The review: "on it" and "Refining" outside stepStatus are writers ("The Advisor on it now", the Advisor card's "Refining B1030"),
  // a sentence's "refining" is not; an exception names its literal (a long one by its start).
  assert.deepEqual(phraseWriters("const g = 'The Advisor on it now'\nconst h = `Refining ${id}, round 3`\nconst i = 'the Advisor is refining it'").map(one => [one.line, one.phrase]), [[1, 'on it'], [2, 'Refining']])
  assert.ok(isException('public/board.js', 'The Advisor on it now') && !isException('public/board.js', 'The Advisor on it now and then'), 'a short exception word for word')
  assert.ok(isException('src/say.mjs', 'Own rows: give each of these steps a row of its own, and more'), 'a long one by its start')
})

// ---- the review's points ----

/** A step of the store, its lines given whole. */
const item = (...lines) => parseItem([...lines, ''].join('\n'))

test('1. the recap popup takes the state\'s one status: B1096 held, a refine with its word in flight waits for the Advisor; reworkOf works none out itself', () => {
  const goalRecap = { goal: 'G60', path: 'art-inbox/anywhere/recap.json', rows: [{ key: 'r1', title: '1. Old maps', steps: ['B1096'], changed: false, pending: false }, { key: 'r2', title: '2. Answers', steps: ['B1030'], changed: false, pending: false }], rounds: [], changedAt: null }
  const word = { id: 'w9', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'waiting' }
  const state = stateWith({ outbox: [...B1030_WORDS, word], goalRecap })
  assert.equal(state.recapRound.rework.r1.words, `B1096 · held: ${state.stepStatus.B1096.why}`)
  assert.equal(state.recapRound.rework.r2.words, 'B1030 · waits for the Advisor')
  // No status given: no words worked out here ("unknown"), never "refined" or "nothing sent".
  const items = itemsOf(B1096())
  assert.equal(reworkOf(['B1096'], items, { now: NOW }).words, 'B1096 · unknown')
  assert.equal(recapRoundOf({ goal: 'G60', goalRecap, items }).rework.r1.words, 'B1096 · unknown')
})

test('2. a word the pause holds (waiting, isHeld) is held: "waits for Resume all", never "waits for the Advisor"', () => {
  const items = itemsOf(B1030())
  const paused = { id: 'w9', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'waiting', isHeld: true }
  const one = stepStatusOf(items.get('B1030'), { items, outbox: [...B1030_WORDS, paused], now: NOW })
  assert.deepEqual([one.held, one.toAdvisor, one.words], [true, false, 'its word to the Advisor waits for Resume all'])
  // The state marks it so while the person pauses.
  const state = stateWith({ outbox: [...B1030_WORDS, { ...paused, isHeld: undefined }], pause: { state: 'pausing', since: NOW - 5 * MIN, by: 'person' } })
  assert.equal(state.stepStatus.B1030.held, true)
})

test('3. a failed report check says the review\'s own words, never "being checked"', () => {
  const step = item('Id: B9001', 'Kind: step', 'Title: Report checked', 'State: review', 'Owner: Worker 4', 'Goal: G15', 'Since: 2026-11-10 20:00', '', '## History',
    '- 2026-11-10 20:00 Worker 4: in progress → review', '- 2026-11-10 20:00 server: check pending', '- 2026-11-10 20:01 server: check failed: a worktree of the step is left: C:/anywhere/b1')
  const one = stepStatusOf(step, { items: itemsOf(step), now: NOW })
  assert.equal(one.words, 'waits for Worker 4 to report again: its report check failed at 20:01 (a worktree of the step is left)')
  assert.notEqual(one.words, 'being checked')
})

test('4. one shape of the outbox everywhere: every word, a late waiting one expired as outboxNow times it; the refine gate\'s refineAsk; partner words; "no word in flight (last sent HH:MM)"', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  // A refine waiting 50 hours: past its keep (store.mjs isLate, 48 h for a refine), so expired in the one shape: while the person
  // pauses it is no word the pause holds, and it is the last one sent (outboxNow drops it, the raw outbox keeps it waiting).
  const late = { id: 'w8', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 50 * 60 * MIN, state: 'waiting' }
  const raw = [...B1030_WORDS, late]
  const state = stateWith({ outbox: outboxNow(raw, NOW, keep), words: outboxKnown(raw, NOW, keep), pause: { state: 'pausing', since: NOW - 5 * MIN, by: 'person' } })
  assert.deepEqual([state.stepStatus.B1030.toAdvisor, state.stepStatus.B1030.held], [false, false])
  assert.equal(state.stepStatus.B1030.words, 'refine open: no word in flight (last sent 8 Nov 19:30)')
  // Without the late word: the 4 Nov words outboxNow drops still name the last one sent.
  assert.equal(stateWith({ outbox: outboxNow(B1030_WORDS, NOW, keep), words: outboxKnown(B1030_WORDS, NOW, keep) }).stepStatus.B1030.words, B1030_NO_WORD)
  // refineAsk's own rule: a word taken 40 minutes ago with no block since is stale; taken 5 minutes ago it is in flight.
  const items = itemsOf(B1030())
  const taken = at => ({ id: 'w7', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at, state: 'taken', takenAt: at })
  assert.equal(stepStatusOf(items.get('B1030'), { items, outbox: [...B1030_WORDS, taken(NOW - 40 * MIN)], now: NOW }).toAdvisor, false)
  assert.equal(stepStatusOf(items.get('B1030'), { items, outbox: [...B1030_WORDS, taken(NOW - 5 * MIN)], now: NOW }).toAdvisor, true)
  // A question of the step routed to the partner, its word on its way: in flight.
  const ask = item('Id: Q900', 'Kind: ask', 'State: answered', 'Of: B1030', 'Route: partner', 'Asks: decide', 'Title: Which harm counts')
  const withAsk = itemsOf(B1030(), ask)
  const partnerWord = { id: 'p1', to: 'Advisor', command: 'work', about: 'Q900', kind: 'partner-ask', at: NOW - 3 * MIN, state: 'waiting', text: 'work: Q900 is yours to answer for the person; run work next' }
  assert.equal(stepStatusOf(withAsk.get('B1030'), { items: withAsk, outbox: [...B1030_WORDS, partnerWord], now: NOW }).toAdvisor, true)
  // The rule tells Main the state's own words (its signal, view.noWork): the Overview and the note cannot disagree.
  const report = (name, st, since) => [name, { state: st, since, background: false, run: 1, seq: 1, at: NOW - 5_000, session: `cli-${name}`, mod: '0.19.0', busyAt: null }]
  const live = stateWith({ outbox: B1030_WORDS, reports: [report('Lead', 'idle', NOW - 5_000), report('Worker 1', 'idle', NOW - 30 * MIN), report('Advisor', 'idle', NOW - 5_000)] })
  const found = REPAIR_RULES.find(one => one.id === 'none-ready').check(buildView({ state: live, items: new Map(), outbox: [], now: NOW }), {})
  assert.ok(found.length > 0)
  assert.equal(found[0].text, `${live.noWork.text} (${live.noWork.worker} free for ${live.noWork.minutes} min)`)
})

test('5. an ask routed to the partner: its step waits for the partner, not for the person (kind partner)', () => {
  const step = item('Id: B9003', 'Kind: step', 'Title: Asks the partner', 'State: waiting on you', 'Owner: Worker 1', 'Goal: G15', 'Since: 2026-11-10 21:00')
  const ask = item('Id: Q901', 'Kind: ask', 'State: open', 'Of: B9003', 'Blocking: yes', 'Route: partner', 'Asks: decide', 'Title: Which way')
  const items = itemsOf(step, ask)
  const one = stepStatusOf(step, { items, now: NOW })
  assert.deepEqual([one.kind, one.label, one.words], ['partner', 'Waits for your partner', 'waits for your partner: Q901'])
  // Handed on to the person (Route: person): it needs the person.
  const handed = itemsOf(step, item('Id: Q901', 'Kind: ask', 'State: open', 'Of: B9003', 'Blocking: yes', 'Route: person', 'Asks: decide', 'Title: Which way'))
  assert.equal(stepStatusOf(step, { items: handed, now: NOW }).kind, 'you')
  // A new step whose refine question is routed to the partner waits for the partner too.
  const fresh = item('Id: B9004', 'Kind: step', 'Title: New', 'State: new', 'Goal: G15', 'Since: 2026-11-10 21:00')
  const refineAsk = item('Id: Q902', 'Kind: ask', 'State: open', 'Of: B9004', 'Route: partner', 'Asks: decide', 'Title: Which')
  assert.equal(stepStatusOf(fresh, { items: itemsOf(fresh, refineAsk), now: NOW }).kind, 'partner')
})

test('6. the views that worked a status out themselves take it: the Focus part\'s list and chips, the incident cards', () => {
  const B1098 = item('Id: B1098', 'Kind: step', 'Title: A new map', 'State: new', 'Goal: G60', 'Since: 2026-11-10 20:00')
  const state = stateWith({ outbox: B1030_WORDS, more: [B1098] })
  const old = state.focus.parts.find(one => one.title === 'Old maps')
  // The part's list: the step's one status, not "Waiting".
  assert.equal(old.steps[0].state, `Held: ${state.stepStatus.B1096.why}`)
  // A block being refined says its step's status, never "Waiting for its refine, then it goes on the list".
  const fresh = state.focus.parts.find(one => one.title === 'New maps')
  assert.equal(fresh.state, 'refining')
  assert.equal(fresh.chip, 'Refining: B1098 · waits for its refine: nothing sent to the Advisor yet')
  // A block on the list says the step the hand-out has on it.
  assert.equal(blockChipWords('ready', [{ kind: 'ready', id: 'B7' }]), 'On the list for a worker: B7')
  // The incident cards: a queued step and one at work say their one status.
  const queued = item('Id: B9005', 'Kind: step', 'Title: Q', 'State: queued', 'Owner: Worker 4', 'Goal: G15', 'Since: 2026-11-10 21:00')
  const items = itemsOf(queued)
  const cards = incidentCards({ incidents: [{ id: 'X1', state: 'fix', fix: 'B9005', title: 'x', foundAt: NOW, since: NOW }], items, statuses: stepStatusesOf(items, { items, now: NOW }) })
  assert.equal(cards.find(one => one.step === 'B9005')?.state.text, 'queued · given to Worker 4')
})

const lane = (name, { free = true, since = NOW - 30 * MIN } = {}) => ({ name, isMain: false, isLeftover: false, state: free ? 'free' : 'working', isRunning: true, report: { state: free ? 'idle' : 'busy', since } })

test('7b. a blocked step whose blocker CHAIN leads to a step at work is the work of someone, too (the live B1123 to B1126, 11 Nov); a root not at work still lists them; a loop ends', () => {
  const step = (id, state, by = null, goal = 'G64') => item(`Id: ${id}`, 'Kind: step', `Title: ${id}`, `State: ${state}`, `Goal: ${goal}`, 'Refined: ready', ...(by === null ? [] : [`Blocked by: ${by}`]), 'Since: 2026-11-10 20:00')
  const signalOf = items => {
    const list = handOut(items)
    return noneReadyOf({ items, focus: 'G64', goals: [{ id: 'G64', children: [] }], ...list, lanes: [lane('Worker 2')], now: NOW })
  }
  // A step unrelated to the chain keeps the signal alive, so what is left in `causes` and `left` can be told apart.
  const other = step('B1200', 'refined')
  const chain = root => itemsOf(step('B1123', root), step('B1124', 'refined', 'B1123'), step('B1125', 'refined', 'B1124'), step('B1126', 'refined', 'B1125'), other)
  const at = signalOf(chain('in progress'))
  assert.deepEqual(at.causes.map(one => one.id), ['B1200'])
  assert.deepEqual(at.left.map(one => one.id), ['B1124', 'B1125', 'B1126'])
  assert.equal(at.left.find(one => one.id === 'B1126').why, 'its blocker chain reaches B1123, which is at work')
  // The root is not at work: it and all three are listed.
  assert.deepEqual(signalOf(chain('new')).causes.map(one => one.id), ['B1123', 'B1124', 'B1125', 'B1126', 'B1200'])
  // A loop A to B to A ends without hanging, and lists both.
  const loop = signalOf(itemsOf(step('B1300', 'refined', 'B1301'), step('B1301', 'refined', 'B1300'), other))
  assert.deepEqual(loop.causes.map(one => one.id), ['B1200', 'B1300', 'B1301'].sort())
})

test('7. the signal leaves out what someone has; the rule: one note per cause, ONE partner word per signal listing them, none while a limit is full', async () => {
  const B9000 = state => item('Id: B9000', 'Kind: step', 'Title: Blocker', `State: ${state}`, 'Goal: G15', 'Since: 2026-11-10 20:00')
  const blocked = item('Id: B1097', 'Kind: step', 'Title: Blocked', 'State: refined', 'Goal: G60', 'Refined: ready', 'Blocked by: B9000', 'Since: 2026-11-10 20:00')
  const asked = item('Id: B1099', 'Kind: step', 'Title: Asked', 'State: new', 'Goal: G60', 'Since: 2026-11-10 20:00')
  const fresh = item('Id: B1098', 'Kind: step', 'Title: A new map', 'State: new', 'Goal: G60', 'Since: 2026-11-10 20:00')
  const signalOf = (items, more = {}) => {
    const list = handOut(items)
    return noneReadyOf({ items, focus: 'G60', goals: [{ id: 'G60', children: [] }], ...list, lanes: [lane('Worker 2')], now: NOW, outbox: [{ id: 'w', to: 'Advisor', command: 'refine', about: 'B1099', at: NOW - 2 * MIN, state: 'waiting' }], ...more })
  }
  const items = itemsOf(B1096(), blocked, B9000('in progress'), asked, fresh)
  const signal = signalOf(items)
  assert.deepEqual(signal.causes.map(one => one.id), ['B1096', 'B1098'])
  assert.deepEqual(signal.left.map(one => [one.id, one.why]), [['B1097', 'its blocker B9000 is at work'], ['B1099', 'a word to the Advisor is in flight']])
  // A blocker nobody has yet keeps it a cause; the refine gate's line (`skip`) leaves a step out.
  assert.deepEqual(signalOf(itemsOf(B1096(), blocked, B9000('new'), asked, fresh)).causes.map(one => one.id), ['B1096', 'B1097', 'B1098'])
  assert.deepEqual(signalOf(items, { skip: new Map([['B1098', "in the refine gate's line (new)"]]) }).causes.map(one => one.id), ['B1096'])
  // Nothing left: no signal.
  assert.equal(signalOf(itemsOf(blocked, B9000('in progress'), asked)), null)
  // A worker its failed check was handed back to (`stuck`) is not free.
  assert.equal(signalOf(items, { stuck: new Set(['Worker 2']) }), null)
  // The rule: a note per cause, one word to the partner listing both.
  const rule = REPAIR_RULES.find(one => one.id === 'none-ready')
  const view = more => ({ noWork: signal, items, lanes: [], partner: { name: 'Advisor' }, outbox: [], now: NOW, prefix: '', limits: {}, pause: null, ...more })
  const found = rule.check(view(), {})
  assert.deepEqual(found.map(one => [one.fix.do, one.fix.chat ?? null]), [['send', null], ['send', null], ['wake', 'Advisor']])
  assert.match(found[2].fix.text, /B1096 held \(.*\); B1098 waits for its refine/)
  assert.doesNotMatch(found[2].fix.text, /refine (?:the step|it) /i, 'never a refine outside the gate')
  assert.ok(found.every(one => one.fix.do !== 'person'), 'never to the person')
  // Its word went (the finding's key is its syncKey): only the notes.
  assert.deepEqual(rule.check(view({ outbox: [{ id: 'p', to: 'Advisor', syncKey: found[2].key, state: 'delivered', at: NOW }] }), {}).map(one => one.fix.do), ['send', 'send'])
  // A limit full: the hand-out gives nothing, the rule says nothing.
  assert.deepEqual(rule.check(view({ limits: { fiveHour: { level: 'full' } } }), {}), [])
  // Main is told once per key.
  const ports = { wake: async () => ({ id: 'm' }), person: async () => { throw new Error('never the person') } }
  const first = await applySync(found, ports, new Set())
  assert.equal(first.note.length, 2)
  assert.deepEqual((await applySync(found.slice(0, 2), ports, new Set(first.keys))).note, [])
  // The role texts never ask for a refine outside the gate.
  for (const file of ['partner.md', 'main.md']) {
    const text = await readFile(join(ROOT, 'roles', file), 'utf8')
    const said = text.split('\n\n').filter(one => one.includes('none-ready')).join('\n')
    assert.ok(said !== '', file)
    assert.doesNotMatch(said, /refine the step it names|a refine with nothing sent: the partner/i, file)
  }
})

test('8. a cause\'s key is stable: the blocker\'s ids, not its state; not the refine\'s stage; the free spell\'s stamp is in it', () => {
  const held = why => ({ kind: 'held', why })
  assert.equal(causeClassOf(held('blocked by B9000 (in progress)')), causeClassOf(held('blocked by B9000 (review)')))
  assert.equal(causeClassOf(held('blocked by B9001 (new), B9000 (queued)')), 'blocked B9000,B9001')
  assert.equal(causeClassOf({ kind: 'refine', where: 'none', words: 'a' }), causeClassOf({ kind: 'refine', where: 'open', words: 'b' }))
  assert.equal(causeClassOf(held('waits for: chat 1')), 'waits-for')
  assert.equal(causeClassOf(held('waits for the answer to Q1')), 'answer')
  assert.equal(causeClassOf(held('B1 is a screen step, and the foundation of the screen standard (K6 Screens) is not built yet')), 'standard')
  assert.equal(causeClassOf(held('held by its routing record')), 'routing')
  // The rule's keys carry the free spell: next week's same hold is a new note.
  const rule = REPAIR_RULES.find(one => one.id === 'none-ready')
  const signal = freeSince => ({ goal: 'G60', worker: 'Worker 2', freeSince, minutes: 12, causes: [{ key: 'B1096 held standard', id: 'B1096', kind: 'held', words: 'B1096 held (x)', link: '#details=B1096' }], text: 't', link: '#details=B1096' })
  const keys = freeSince => rule.check({ noWork: signal(freeSince), items: new Map(), lanes: [], partner: { name: 'Advisor' }, outbox: [], now: NOW, limits: {}, pause: null }, {}).map(one => one.key)
  assert.deepEqual(keys(NOW - 12 * MIN), keys(NOW - 12 * MIN))
  assert.notDeepEqual(keys(NOW - 12 * MIN), keys(NOW - 7 * 24 * 60 * MIN))
  assert.match(keys(NOW - 12 * MIN)[0], /^none-ready G60 B1096 held standard 2026-11-10 21:18 main$/)
})

test('9. the signal counts no paused time while the board resumes', () => {
  const items = itemsOf(B1096())
  const base = { items, focus: 'G60', goals: [{ id: 'G60', children: [] }], ...handOut(items), now: NOW, lanes: [lane('Worker 2', { since: NOW - 30 * MIN })] }
  assert.ok(noneReadyOf(base) !== null)
  assert.equal(noneReadyOf({ ...base, pause: { state: 'resuming', since: NOW - 2 * MIN, pausedSince: NOW - 28 * MIN } }), null)
})

test('10. the state\'s stepStatus leaves done and dropped steps out; every view falls back to their state', () => {
  const done = item('Id: B9006', 'Kind: step', 'Title: Done one', 'State: done', 'Goal: G60', 'Since: 2026-11-10 20:00')
  const state = stateWith({ outbox: B1030_WORDS, more: [done] })
  assert.equal(Object.hasOwn(state.stepStatus, 'B9006'), false)
  assert.ok(Object.hasOwn(state.stepStatus, 'B1096'))
  const row = state.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B9006')
  assert.equal(row.stepStatus, null)
  const page = {}
  vm.runInNewContext(`${slice('// goalsteps:start', '// goalsteps:end')}\nObject.assign(this, { goalStepsView, goalStepBadge })`, page)
  assert.deepEqual(plain(page.goalStepBadge(row)), ['Done', 'done'])
  // The incident card of a done step says its state.
  const items = itemsOf(done)
  assert.equal(incidentCards({ incidents: [{ id: 'X1', state: 'fix', fix: 'B9006', title: 'x', foundAt: NOW, since: NOW }], items, statuses: state.stepStatus }).find(one => one.step === 'B9006')?.state.text, 'done · fixed')
})

// ---- the signal: never to the person ----

test('the signal: the focus goal has work, Ready is 0, a worker free for 10 running minutes: one cause per step, with its status', () => {
  const items = itemsOf(B1096())
  const list = handOut(items)
  const base = { items, focus: 'G60', goals: [{ id: 'G60', children: [] }], ...list, now: NOW }
  const signal = noneReadyOf({ ...base, lanes: [lane('Worker 2', { since: NOW - 12 * MIN })] })
  assert.equal(signal.goal, 'G60')
  assert.equal(signal.worker, 'Worker 2')
  assert.equal(signal.causes.length, 1)
  assert.equal(signal.text, `focus goal G60 has work, none can be handed out: B1096 held (${list.held[0].why})`)
  assert.equal(signal.link, '#details=B1096')
  // 9 minutes: nothing yet.
  assert.equal(noneReadyOf({ ...base, lanes: [lane('Worker 2', { since: NOW - 9 * MIN })] }), null)
  // Running minutes: 12 minutes on the clock, 5 of them paused by the person: 7 running, nothing yet.
  const pause = { state: 'running', since: NOW - 7 * MIN }
  assert.equal(noneReadyOf({ ...base, pause, lanes: [lane('Worker 2', { since: NOW - 12 * MIN })] }), null)
  // The board off for 5 of them: 7 running, nothing.
  assert.equal(noneReadyOf({ ...base, gaps: [{ from: NOW - 10 * MIN, to: NOW - 5 * MIN }], lanes: [lane('Worker 2', { since: NOW - 12 * MIN })] }), null)
  // Something ready, a busy worker, or no unstarted step of the focus: nothing.
  assert.equal(noneReadyOf({ ...base, ready: [{ id: 'B1' }], lanes: [lane('Worker 2')] }), null)
  assert.equal(noneReadyOf({ ...base, lanes: [lane('Worker 2', { free: false })] }), null)
  assert.equal(noneReadyOf({ ...base, focus: 'G15', lanes: [lane('Worker 2')] }), null)
  // While the person pauses: nothing.
  assert.equal(noneReadyOf({ ...base, pause: { state: 'pausing', since: NOW - 20 * MIN }, lanes: [lane('Worker 2')] }), null)
  assert.equal(FREE_SIGNAL_MINUTES, 10)
})

test('the Overview: a quiet line with the same words and a link to the step; no amber', async () => {
  // Worker 1 reported idle 30 minutes ago (its Workers mod's own word), heard 5 seconds ago: free.
  const report = (name, state, since) => [name, { state, since, background: false, run: 1, seq: 1, at: NOW - 5_000, session: `cli-${name}`, mod: '0.19.0', busyAt: null }]
  const state = stateWith({ outbox: B1030_WORDS, reports: [report('Lead', 'idle', NOW - 5_000), report('Worker 1', 'idle', NOW - 30 * MIN), report('Advisor', 'idle', NOW - 5_000)] })
  assert.ok(state.noWork !== null, 'the state carries the signal')
  assert.equal(state.noWork.worker, 'Worker 1')
  assert.equal(state.noWork.text, `focus goal G60 has work, none can be handed out: B1096 held (${state.stepStatus.B1096.why})`)
  const page = await openPage({ state: plain(state), now: NOW })
  try {
    const line = page.window.document.querySelector('#simple-bar .simple-nowork')
    assert.ok(line !== null)
    assert.match(words(line), /^focus goal G60 has work, none can be handed out: B1096 held \(/)
    assert.equal(line.querySelector('a').getAttribute('href'), '#details=B1096')
    assert.doesNotMatch(line.className, /amber|attention|warn/)
  } finally { await page.close() }
})

test('11. an ask held for the person\'s words (rule 15): its step waits for the asker\'s re-check, quiet, never "you"; an unheld ask reads as before', () => {
  const step = item('Id: B9011', 'Kind: step', 'Title: Side stairs', 'State: waiting on you', 'Owner: Studio · Worker 3', 'Goal: G15', 'Since: 2026-11-10 14:00')
  const ask = (id, { held, blocking }) => parseItem(['Id: ' + id, 'Kind: ask', 'Title: Which stairs', 'State: open', 'Owner: Studio · Worker 3', 'Of: B9011', `Blocking: ${blocking}`, 'Asks: decide', `Route: ${held ? 'asker' : 'person'}`, '',
    '## Route', ...(held ? ['held from person: your words at 14:05 may change this (chat 2)'] : []), '', '## History', '- 2026-11-10 13:50 Worker 3: asked (decide)',
    ...(held ? ['- 2026-11-10 14:05 server: held: the person\'s words at 14:05 on G15 may change this'] : []), ''].join('\n'))
  const read = (...asks) => stepStatusOf(step, { items: itemsOf(step, ...asks), now: NOW, prefix: 'Studio · ' })
  // A held BLOCKING ask: the step waits for Worker 3's re-check (Worker 3 is the ask's Owner), linked to the ask; quiet.
  const blocking = read(ask('Q711', { held: true, blocking: 'yes' }))
  assert.deepEqual([blocking.kind, blocking.words, blocking.who, blocking.link, blocking.tone], ['held-ask', 'waits for Worker 3\'s re-check of Q711 (your words at 14:05)', 'Worker 3', '#details=Q711', 'quiet'])
  // A held NON-blocking ask reads the same (the step has no unheld blocking ask).
  const open = read(ask('Q712', { held: true, blocking: 'no' }))
  assert.deepEqual([open.kind, open.words, open.link], ['held-ask', 'waits for Worker 3\'s re-check of Q712 (your words at 14:05)', '#details=Q712'])
  // The same asks unheld read as before: the person's.
  assert.deepEqual(['blocking', 'non-blocking'].map(kind => read(ask('Q713', { held: false, blocking: kind === 'blocking' ? 'yes' : 'no' })).kind), ['you', 'you'])
  // A held ask beside an unheld blocking one: the step still needs the person.
  assert.equal(read(ask('Q711', { held: true, blocking: 'yes' }), ask('Q714', { held: false, blocking: 'yes' })).kind, 'you')
  // Through the state's index (stepStatusesOf) as well.
  assert.equal(stepStatusesOf(itemsOf(step, ask('Q711', { held: true, blocking: 'yes' })), { now: NOW, prefix: 'Studio · ' }).B9011.kind, 'held-ask')
})

// ---- the last review's four points ----

/** B9003 waits on you, its one blocking ask routed to the partner (test 5): the step waits for the partner. */
const partnerWaitItems = () => [item('Id: B9003', 'Kind: step', 'Title: Asks the partner', 'State: waiting on you', 'Owner: Worker 1', 'Goal: G15', 'Since: 2026-11-10 21:00'),
  item('Id: Q901', 'Kind: ask', 'State: open', 'Of: B9003', 'Blocking: yes', 'Route: partner', 'Asks: decide', 'Title: Which way')]

test('12. the task window\'s "Where it stands" says the step\'s one status: a partner wait, a failed report check, a Waits on; only done and dropped say their state', async () => {
  const page = {}
  vm.runInNewContext(['const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1)', fn('taskStanding'), 'Object.assign(this, { taskStanding })'].join('\n'), page)
  const items = itemsOf(...partnerWaitItems())
  const partner = stepStatusOf(items.get('B9003'), { items, now: NOW })
  assert.equal(page.taskStanding({ state: 'waiting on you', owner: 'Worker 1' }, partner), 'It waits for your partner: Q901.')
  const checked = item('Id: B9001', 'Kind: step', 'Title: Report checked', 'State: review', 'Owner: Worker 4', 'Goal: G15', 'Since: 2026-11-10 20:00', '', '## History',
    '- 2026-11-10 20:00 Worker 4: in progress → review', '- 2026-11-10 20:00 server: check pending', '- 2026-11-10 20:01 server: check failed: a worktree of the step is left: C:/anywhere/b1')
  assert.equal(page.taskStanding({ state: 'review', owner: 'Worker 4' }, stepStatusOf(checked, { items: itemsOf(checked), now: NOW })), 'It waits for Worker 4 to report again: its report check failed at 20:01 (a worktree of the step is left).')
  // Done and dropped carry no status in the state: their own state.
  assert.deepEqual([page.taskStanding({ state: 'done' }, null), page.taskStanding({ state: 'dropped' }, null)], ['It is done.', 'It was dropped.'])
  // The window itself: B1081 is in progress and waits on chat 1 (P1): "It waits for chat 1: its go to land.", never "is working on it".
  const state = stateWith({ outbox: B1030_WORDS, more: [B1081()] })
  const details = await openPage({ state: plain(state), now: NOW, hash: 'details=B1081' })
  try {
    const part = details.all('.task-part').find(one => words(one.querySelector('h3') ?? { textContent: '' }) === 'Where it stands')
    assert.ok(part !== undefined, 'the Summary has its Where it stands')
    assert.equal(words(part.querySelector('p')), 'It waits for chat 1: its go to land.')
  } finally { await details.close() }
})

test('13. the backlog\'s In progress rows take the step\'s one status, words and tone: a partner wait is not "Waiting on you", a Waits on not "In progress"', () => {
  const page = { document: { createElement: () => ({}) }, problems: new Map(), sending: new Set() }
  vm.runInNewContext(['const MIN = 60000', slice('// times:start', '// times:end'), slice('// chatstatus:start', '// chatstatus:end'), slice('// coordinate:start', '// coordinate:end'), fn('queueChoice'),
    'Object.assign(this, { coordinateList, backlogBlocks })'].join('\n'), page)
  const state = stateWith({ outbox: B1030_WORDS, more: [...partnerWaitItems(), B1081()] })
  const blocks = plain(page.backlogBlocks(page.coordinateList(plain(state.backlog)), plain(state.readyList)))
  const rows = blocks.find(block => block.key === 'progress').rows
  const row = id => rows.find(one => one.step.id === id)
  assert.deepEqual([row('B9003').state, row('B9003').tone], ['Waits for your partner: Q901', 'partner'])
  assert.deepEqual([row('B1081').state, row('B1081').tone], ['Waits for chat 1: its go to land', 'progress'])
})

test('14. the Refine part and the Advisor card read the same words as the status: B1030 stopped after 3 board rounds is Stopped, with Send again; a word in flight is "Refining"', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  // The live B1030: three refine words of the board's own, all delivered on 4 Nov (outbox.jsonl, folded); outboxNow drops them.
  const board = B1030_WORDS.map(one => ({ ...one, board: true }))
  const state = stateWith({ outbox: outboxNow(board, NOW, keep), words: outboxKnown(board, NOW, keep) })
  assert.match(state.stepStatus.B1030.words, /^its refine stopped after 3 rounds: no word in flight/)
  const row = state.backlog.flatMap(activity => activity.steps).find(one => one.id === 'B1030')
  // The refine gate's own reading stays its own (outboxNow); the part's group is the status's.
  assert.deepEqual([row.refineState, row.refineGroup, row.refineStopped?.rounds], ['answered', 'stopped', 3])
  const page = {}
  vm.runInNewContext(`${slice('// advisorrefine:start', '// advisorrefine:end')}\n${slice('// refinelist:start', '// refinelist:end')}\nObject.assign(this, { advisorRefine, refineGroups })`, page)
  const groups = plain(page.refineGroups(plain(state.backlog)))
  assert.deepEqual(groups.filter(group => group.steps.some(one => one.id === 'B1030')).map(group => group.title), ['Stopped: no new answers since its last rounds'])
  // refine-stop-tone: nothing open for the person: quiet, and it names who picks it up; Send again stays (quiet).
  assert.deepEqual(plain(page.advisorRefine(plain(state.backlog))), { step: 'B1030', text: 'B1030: refine stopped after 3 rounds; the Advisor or Main picks it up', tone: 'quiet', canSend: true })
  // A word in its hand (delivered a minute ago) and one on its way: the card's line is the status's.
  const inHand = { id: 'w4', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'delivered', deliveredAt: NOW - MIN }
  const asking = stateWith({ outbox: [...B1030_WORDS, inHand], words: [...B1030_WORDS, inHand] })
  assert.deepEqual(plain(page.advisorRefine(plain(asking.backlog))), { step: 'B1030', text: 'Refining B1030, round 3', tone: 'working' })
  assert.deepEqual(page.refineGroups(plain(asking.backlog)).find(group => group.state === 'asking').steps.map(one => one.id), ['B1030'])
  const onItsWay = { ...inHand, state: 'waiting', deliveredAt: undefined }
  assert.equal(page.advisorRefine(plain(stateWith({ outbox: [...B1030_WORDS, onItsWay], words: [...B1030_WORDS, onItsWay] }).backlog)).text, 'B1030 to refine, on its way')
})

test('14b. refine-stop-tone (the person, 11-11: "if red text remains idk if its correct"): a stopped refine is red only while its next move is the person\'s; B1030 with Main\'s hold is quiet "refine held", no Send again', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
  const board = B1030_WORDS.map(one => ({ ...one, board: true }))
  const page = {}
  vm.runInNewContext(`${slice('// advisorrefine:start', '// advisorrefine:end')}\nObject.assign(this, { advisorRefine })`, page)
  const cardOf = (b1030, more = []) => plain(page.advisorRefine(plain(stateWith({ outbox: outboxNow(board, NOW, keep), words: outboxKnown(board, NOW, keep), b1030, more }).backlog)))
  // The live case: Main records B1030's hold as its Waits for.
  const HOLD = "chat 1's decision after the 3-day stability count (Fri 11-13)"
  assert.deepEqual(cardOf(B1030([`Waits for: ${HOLD}`])), { step: 'B1030', text: `B1030: refine held · waits for ${HOLD}`, tone: 'quiet', canSend: false })
  const heldStatus = stateWith({ outbox: outboxNow(board, NOW, keep), words: outboxKnown(board, NOW, keep), b1030: B1030([`Waits for: ${HOLD}`]) }).stepStatus.B1030
  assert.deepEqual([heldStatus.kind, heldStatus.words], ['held', `held: waits for ${HOLD}`])
  // A question to the person still open is their move: the status says "waits for your answers" (Your answers waiting), never a
  // stop, so no stop line is red; the same question routed to the partner waits for the partner.
  const ask = route => parseItem(['Id: Q990', 'Kind: ask', 'Title: Which way for B1030?', 'State: open', 'Of: B1030', 'Blocking: no', ...route, 'Since: 2026-11-04 22:30', ''].join('\n'))
  const statusWith = more => stateWith({ outbox: outboxNow(board, NOW, keep), words: outboxKnown(board, NOW, keep), more }).stepStatus.B1030
  assert.deepEqual([statusWith([ask([])]).where, statusWith([ask([])]).words], ['answers', 'its refine waits for your answers'])
  assert.equal(statusWith([ask(['Route: partner'])]).kind, 'partner')
  assert.equal(cardOf(B1030(), [ask([])]), null)
  // Every other stop is quiet: the stop line's tone is never red.
  assert.equal(statusWith([]).stop.tone, 'quiet')
})

test('15. the none-ready episode: worker A busy while B stays free is the same episode (no second partner word, no second note per cause); the signal gone and back is a new one', async () => {
  const items = itemsOf(B1096())
  const list = handOut(items)
  const base = { items, focus: 'G60', goals: [{ id: 'G60', children: [] }], ...list, now: NOW }
  const rule = REPAIR_RULES.find(one => one.id === 'none-ready')
  const viewOf = (signal, outbox = []) => ({ noWork: signal, items, lanes: [], partner: { name: 'Advisor' }, outbox, now: NOW, prefix: '', limits: {}, pause: null })
  const ports = { wake: async () => ({ id: 'm' }), person: async () => { throw new Error('never the person') } }
  // A free 30 minutes, B 20: the signal names A, and its episode begins.
  const first = noneReadyOf({ ...base, lanes: [lane('Worker A', { since: NOW - 30 * MIN }), lane('Worker B', { since: NOW - 20 * MIN })] })
  assert.equal(first.worker, 'Worker A')
  const told = rule.check(viewOf(first), {})
  const sent = await applySync(told, ports, new Set())
  const partnerWord = told.find(one => one.fix.do === 'wake')
  // A gets busy, B stays free: the state's kept episode holds it.
  const seen = { since: first.episodeSince, free: first.freeFrom }
  const second = noneReadyOf({ ...base, seen, lanes: [lane('Worker A', { free: false }), lane('Worker B', { since: NOW - 20 * MIN })] })
  assert.equal(second.worker, 'Worker B')
  assert.equal(second.episodeSince, first.episodeSince)
  const again = rule.check(viewOf(second, [{ id: 'p', to: 'Advisor', syncKey: partnerWord.key, state: 'delivered', at: NOW }]), {})
  assert.deepEqual(again.filter(one => one.fix.do === 'wake'), [], 'no second word to the partner')
  assert.deepEqual((await applySync(again, ports, new Set(sent.keys))).note, [], 'no second note per cause')
  // B's report goes idle → ended (a new since): still the same episode, counted from its first free since.
  const ended = noneReadyOf({ ...base, seen: { since: second.episodeSince, free: second.freeFrom }, lanes: [lane('Worker A', { free: false }), { ...lane('Worker B', { since: NOW - MIN }), asleep: true, report: { state: 'ended', since: NOW - MIN } }] })
  assert.deepEqual([ended.episodeSince, ended.freeSince], [first.episodeSince, NOW - 20 * MIN])
  // Through the state: the kept episode goes from read to read, and the signal gone ends it; back again it is a new one.
  const report = (name, st, since) => [name, { state: st, since, background: false, run: 1, seq: 1, at: NOW - 5_000, session: `cli-${name}`, mod: '0.19.0', busyAt: null }]
  const chats = ['Lead', 'Worker 1', 'Worker 2', 'Advisor']
  const lead = [report('Lead', 'idle', NOW - 5_000), report('Advisor', 'idle', NOW - 5_000)]
  const s1 = stateWith({ chats, reports: [...lead, report('Worker 1', 'idle', NOW - 30 * MIN), report('Worker 2', 'idle', NOW - 20 * MIN)] })
  assert.deepEqual([s1.noWork.worker, s1.noWorkSeen.since], ['Worker 1', NOW - 30 * MIN])
  const s2 = stateWith({ chats, noWorkSeen: s1.noWorkSeen, reports: [...lead, report('Worker 1', 'busy', NOW - MIN), report('Worker 2', 'idle', NOW - 20 * MIN)] })
  assert.deepEqual([s2.noWork.worker, s2.noWork.episodeSince], ['Worker 2', NOW - 30 * MIN])
  const s3 = stateWith({ chats, noWorkSeen: s2.noWorkSeen, reports: [...lead, report('Worker 1', 'busy', NOW - MIN), report('Worker 2', 'busy', NOW - MIN)] })
  assert.deepEqual([s3.noWork, s3.noWorkSeen], [null, null])
  const s4 = stateWith({ chats, noWorkSeen: s3.noWorkSeen, reports: [...lead, report('Worker 1', 'busy', NOW - MIN), report('Worker 2', 'idle', NOW - 15 * MIN)] })
  assert.equal(s4.noWork.episodeSince, NOW - 15 * MIN, 'a new episode')
  assert.notDeepEqual(rule.check(viewOf(s4.noWork), {}).map(one => one.key), told.map(one => one.key))
})
