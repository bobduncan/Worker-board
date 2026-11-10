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
import { reworkOf } from '../src/recapRound.mjs'
import { FREE_SIGNAL_MINUTES, STATUS_PHRASES, WAITING_FOR_A_WORKER, noneReadyOf, stepStatusOf } from '../src/stepStatus.mjs'
import { applySync } from '../src/supervisor/loop.mjs'
import { REPAIR_RULES } from '../src/supervisor/rules/repair.mjs'
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
const B1030 = () => parseItem(['Id: B1030', 'Kind: step', 'Title: Fix: The new Done when, harm as the measure', 'Priority: fix', 'State: new',
  'Activity: Worker board for any project (B126)', 'Goal: G15', 'Since: 2026-11-04 22:10', 'Fix of: B1011', 'Refined: open', '',
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
  '    Goal definition agreed: 2026-11-09 10:00', '    Part: Old maps · about 3 h · steps B1096 · done when: an old map is known', '    How agreed: 2026-11-09 11:00', '- [ ] G15 The board for any project', ''].join('\n')
const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\anywhere', isArchived: false, createdAt: 1, lastActivityAt: NOW - MIN, lastAssistantUuid: 'u' })

/** The board's state at `now` with the two real steps (and `more`), the plan with K6, the goal map with focus G60 and `outbox`. */
function stateWith({ now = NOW, outbox = [], more = [], lines = [], reports = null } = {}) {
  const work = storeFromText('## Look\n', { now: now - 60 * MIN })
  for (const one of [B1096(), B1030(), ...more]) {
    work.items.set(valueOf(one, 'Id'), one)
    work.activities[0].steps.push(valueOf(one, 'Id'))
  }
  return buildState({
    listText: '{"prefix":"Studio · ","main":"Lead"}', appChatTexts: ['Lead', 'Worker 1', 'Advisor'].map(app), tails: {}, planLineTexts: {}, adviceText: null, folders: null,
    askTexts: [], pictureLists: {}, work, goalsText: GOALS, productPlanText: PLAN,
  }, { lines, outbox, runs: [], now, ...(reports === null ? {} : { reports: new Map(reports), board: { startedAt: now - 120 * MIN, offSince: null } }), config: { ...parseConfig('{"advisor":"Advisor"}', {}), project: 'C:\\anywhere', productPlan: 'docs/product-plan.md' } })
}

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
  assert.equal(one.words, 'refine open: nothing sent to the Advisor')
  assert.equal(one.line, 'B1030: refine open: nothing sent to the Advisor')
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
  assert.deepEqual(plain(page.advisorRefine(none.backlog)), { step: 'B1030', text: 'B1030: refine open: nothing sent to the Advisor', tone: 'answered' })
  const open = stateWith({ outbox: [...B1030_WORDS, { id: 'w4', to: 'Advisor', command: 'refine', about: 'B1030', round: 3, at: NOW - 2 * MIN, state: 'delivered', deliveredAt: NOW - MIN }] })
  // A word delivered a minute ago is the refine on its way (the card's first line); the step's own status waits for the Advisor.
  assert.equal(open.stepStatus.B1030.line, 'Your answers on B1030 wait for the Advisor')
})

/** A function of board.js, cut out from its start to the end of its body. */
const fn = name => SCRIPT.slice(SCRIPT.indexOf(`function ${name}(`), SCRIPT.indexOf('\n}\n', SCRIPT.indexOf(`function ${name}(`)) + 3)

test('the backlog: B1096 held with the hand-out\'s why, B1030 "refine open: nothing sent to the Advisor"', () => {
  const page = { document: { createElement: () => ({}) }, problems: new Map(), sending: new Set() }
  vm.runInNewContext(['const MIN = 60000', slice('// times:start', '// times:end'), slice('// chatstatus:start', '// chatstatus:end'), slice('// coordinate:start', '// coordinate:end'), fn('queueChoice'),
    'Object.assign(this, { coordinateList, backlogBlocks })'].join('\n'), page)
  const state = stateWith({ outbox: B1030_WORDS })
  const blocks = plain(page.backlogBlocks(page.coordinateList(plain(state.backlog)), plain(state.readyList)))
  const rowsOf = key => blocks.find(block => block.key === key).rows
  assert.equal(rowsOf('refined').find(row => row.step.id === 'B1096').why, state.stepStatus.B1096.why)
  assert.equal(rowsOf('new').find(row => row.step.id === 'B1030').wait, 'refine open: nothing sent to the Advisor')
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
/** The lines of code that write a status phrase in a string: comment lines and trailing comments left out. */
export function phraseWriters(text, phrases = STATUS_PHRASES) {
  const found = []
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    const code = line.replace(/\s\/\/\s.*$/, '')
    for (const phrase of phrases) if (code.toLowerCase().includes(phrase.toLowerCase())) found.push({ line: index + 1, phrase })
  })
  return found
}

test('the guard: the known status phrases are written only by src/stepStatus.mjs', async () => {
  const files = [join(ROOT, 'server.mjs'), ...(await Promise.all(CODE_DIRS.map(dir => codeFiles(join(ROOT, dir))))).flat()]
  const writers = []
  for (const file of files) {
    const at = relative(ROOT, file).replace(/\\/g, '/')
    if (at === 'src/stepStatus.mjs') continue
    for (const one of phraseWriters(await readFile(file, 'utf8'))) writers.push(`${at}:${one.line} "${one.phrase}"`)
  }
  assert.deepEqual(writers, [], 'a status phrase belongs to src/stepStatus.mjs: take the words from there')
  // It sees a writer: a string in code, not a comment.
  assert.equal(phraseWriters("const a = 'waiting for a worker'\n// waiting for a worker\n * nobody on it\n").length, 1)
  // And stepStatus.mjs does write them.
  assert.ok(phraseWriters(await readFile(join(ROOT, 'src', 'stepStatus.mjs'), 'utf8')).length >= 3)
})

// ---- the signal: never to the person ----

const lane = (name, { free = true, since = NOW - 30 * MIN } = {}) => ({ name, isMain: false, isLeftover: false, state: free ? 'free' : 'working', isRunning: true, report: { state: free ? 'idle' : 'busy', since } })

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

test('the signal goes to Main and the partner once per cause, never to the person', async () => {
  const rule = REPAIR_RULES.find(one => one.id === 'none-ready')
  const items = itemsOf(B1096(), B1030())
  const list = readyList(items, { now: NOW, focus: 'G60', standardHold: item => standardHold(item, standards()), beyondFocus: false })
  const view = outbox => ({ items, focus: 'G60', goals: [{ id: 'G60', children: [] }], ready: list.ready, held: list.held, lanes: [lane('Worker 2')], pause: null, gaps: [], now: NOW, prefix: '', partner: { name: 'Advisor' }, outbox })
  const found = rule.check(view([]), {})
  assert.deepEqual(found.map(one => [one.fix.do, one.fix.chat ?? null]), [['send', null], ['wake', 'Advisor']])
  assert.ok(found.every(one => one.fix.do !== 'person'), 'never to the person')
  assert.match(found[0].fix.text, /^focus goal G60 has work, none can be handed out: B1096 held \(/)
  // The partner's word went (its syncKey is the finding's key): not found again.
  const again = rule.check(view([{ id: 'p', to: 'Advisor', syncKey: found[1].key, state: 'delivered', at: NOW }]), {})
  assert.deepEqual(again.map(one => one.fix.do), ['send'])
  // Main is told once per key: the second run's note is empty.
  const ports = { wake: async () => ({ id: 'm' }), person: async () => { throw new Error('never the person') } }
  const first = await applySync(found, ports, new Set())
  assert.equal(first.note.length, 1)
  const second = await applySync(again, ports, new Set(first.keys))
  assert.deepEqual(second.note, [])
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
