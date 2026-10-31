// 2026-10-24: never Fable without the person's yes. The person: "i want to prevent any chat running fable. i run out of
// tokens too quickly. maximum run opus. if you really require fable somereason exclicitly ask, you cant run fable
// without my permission"; and "on 3 failed attempts is important context. i want to be asked. hey this task failed 3
// times, we would like to evaluate strategy using fable. yes, or no use opus." B752 (2026-10-28: "I really hate this
// message ... instead of asking for opus/fable"): that ask is gone; the guard starts the evaluation at once on Opus at
// max. An ask filed before B752 still reads: answered A it gave Fable for that evaluation only, open it is taken back.
// Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { evaluationsAgain, evaluationsMode, focusMove, goalChecked, guardGoal, guardsAsking } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { FABLE_OPTIONS, evaluationMode, goalAttempts, guardOf, guardStep, modeOfAnswer, needsEvaluation, partnerModeFor } from '../src/goalGuard.mjs'
import { PARTNER_MODES, SWITCH_MODES, effortBack, fableBack, partnerEffort, partnerEffortWords } from '../src/partnerEffort.mjs'
import { checkSay } from '../src/say.mjs'
import { parseTail } from '../src/transcript.mjs'
import { workApi } from '../src/work/api.mjs'
import { modelIds } from '../src/work/effort.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const step = (id, goal, history, checked = [], more = {}) => ({
  head: new Map([['Id', id], ['Kind', 'step'], ['Title', `Step ${id}`], ['State', 'in progress'], ['Goal', goal], ...Object.entries(more)]),
  sections: new Map([['History', history.map(line => `- ${line}`)], ['Checked', checked]]),
})
/** The board's ask as the store keeps it, open or answered with the person's words. */
const boardAsk = (id, goal, state = 'open', answer = null) => ({
  head: new Map([['Id', id], ['Kind', 'ask'], ['Title', `${goal} failed 3 times: evaluate the strategy with Fable?`], ['State', state], ['Owner', 'server'], ['Asks', 'decide'], ['Of', goal]]),
  sections: new Map(answer === null ? [] : [['Answer', [answer]]]),
})

const MAP = [
  '# Goals',
  'Last id: G3',
  'Focus: G2',
  '',
  '- [~] G2 Benches that feel like home',
  '  Done when: five visitors sit on a bench for a minute unasked',
  // Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
  '  Goal definition: you sit down without thinking',
  '  Goal definition agreed: 2026-10-19 07:00',
  '  Part: Wooden benches · 2 h · steps B1, B2',
  '  How agreed: 2026-10-19 08:00',
  '- [ ] G3 Lanterns',
  '  Done when: the square glows at night',
  '  Part: Paper lanterns · 1 h · steps B7',
  '  How agreed: 2026-10-19 08:00',
  '',
].join('\n')
const FAILED = [
  step('B1', 'G2', ['2026-10-19 08:40 Partner: result check failed: 1 of 3 points pass; fix B3 for W1', '2026-10-19 09:00 Partner: result check failed: 2 of 3 points pass; fix B4 for W1'], ['Evidence: none', '- fail: The seat is too high']),
  // B669: the failures are counted per part: B4 is a fix of B1, so it counts in B1's part (Wooden benches).
  step('B4', 'G2', ['2026-10-19 09:20 Partner: result check failed: 0 of 1 points pass; fix B5 for W1'], [], { 'Fix of': 'B1' }),
]
const LANTERNS = [step('B7', 'G3', ['2026-10-19 08:40 Partner: result check failed: 0 of 1; fix B8', '2026-10-19 09:00 Partner: result check failed: 0 of 1; fix B9', '2026-10-19 09:20 Partner: result check failed: 0 of 1; fix B10'])]

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
const FILE = 'D:/Work/p/goals.md'
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const NOW = new Date(2026, 9, 19, 10, 0).getTime()
const mapOf = fs => parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8'))

/** A work store of its own, the goal map beside it, and the board's ask filed through the work API as the board. */
async function board(text = MAP) {
  const fs = fakeFs({ [FILE]: latin(text) })
  const dir = await mkdtemp(join(tmpdir(), 'fable-'))
  await writeStore(dir, migrateBacklog(['# Backlog', '', '## Benches', '- [ ] B20 Paint the benches', ''].join('\n'), { now: NOW }), undefined, { now: NOW })
  const clock = { now: NOW + 60_000 }
  const ctx = as => ({ dir, now: clock.now, prefix: '', as, roleOf: () => null, freeChats: new Set(), hasGoal: id => mapOf(fs).byId.has(id) })
  const filed = []
  const fileAsk = async body => {
    filed.push(body)
    return workApi(body, ctx('server'))
  }
  const items = async (extra = FAILED) => [...extra, ...(await readStore(dir)).items.values()]
  const withdrawn = []
  const withdrawAsk = async (id, why) => { withdrawn.push([id, why]); return workApi({ action: 'withdraw', id, why }, ctx('server')) }
  const guard = async (id = 'G2', extra = FAILED) => guardGoal(id, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: () => items(extra), approveRebuilds: false, withdrawAsk })
  const answer = (id, text) => workApi({ action: 'answer', id, text }, ctx('person'))
  const store = async () => (await readStore(dir)).items
  /** An ask of the board's as it was filed before B752, with its line under the goal (as the board wrote both then). */
  const oldAsk = async (goalId = 'G2', part = 'Wooden benches') => {
    const filedOld = await fileAsk({ action: 'ask', of: goalId, kind: 'decide', blocking: true, title: `${goalId} · ${part} failed 3 times: evaluate the strategy with Fable?`, text: 'Three checks failed.', options: [...FABLE_OPTIONS] })
    assert.equal(filedOld.ok, true, filedOld.why)
    const id = filedOld.result.id
    const text = Buffer.from(fs.files[FILE], 'latin1').toString('utf8')
    fs.files[FILE] = latin(text.replace(`- [~] ${goalId} Benches that feel like home\n`, `- [~] ${goalId} Benches that feel like home\n  Fable asked: ${id}\n  Evaluation part: ${part}\n`))
    return id
  }
  return { fs, dir, filed, withdrawn, guard, answer, store, items, oldAsk, later: ms => { clock.now += ms } }
}

test('B752: no model question: the trip starts the evaluation at once on Opus at max, and files no ask', async () => {
  const one = await board()
  const fired = await one.guard()
  assert.equal(fired.ok, true, fired.why)
  assert.deepEqual([fired.result.fired, fired.result.mode, fired.result.ask], [true, 'high', null])
  assert.equal(fired.words.command, 'evaluate')
  assert.equal(one.filed.length, 0)
  assert.equal((await one.store()).values().filter(item => item.head.get('Kind') === 'ask').toArray().length, 0)
  const goal = mapOf(one.fs).byId.get('G2')
  assert.deepEqual([goal.evaluationAsked, goal.fableAsked, goal.evaluationPart], ['2026-10-19 10:00', null, 'Wooden benches'])
  // The word asks for other ways, never a stronger model.
  assert.match(fired.words.text, /\nYour answer: 2 or 3 different ways, not this way again/)
  assert.doesNotMatch(fired.words.text, /Fable/)
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'high', yes: null })
  // Once.
  assert.equal((await one.guard()).result.fired, false)
})

test('the person\'s answer: only a yes is Fable (A, A with its words, or yes first); B, a no and other words are Opus', () => {
  for (const words of ['A Yes: Fable 5.1 (max), only for this evaluation', 'A', 'a', 'A.', 'a!', 'A: yes', 'A. Yes, Fable', 'a yes fable 5.1 max', 'yes', 'Yes, Fable please', 'YES', 'A Fable', 'a fable 5.1', 'A: Fable 5.1 (max)']) {
    assert.equal(modeOfAnswer(boardAsk('Q1', 'G2', 'answered', words)), 'fable', words)
  }
  for (const words of ['B No: Opus 5.5 (max)', 'B', 'no, use opus', 'a bit pricey, use opus', 'A bit much', 'A y', 'A yes but no', 'Approved', 'Fable? not now', 'yesterday', 'ok', 'A fable is too pricey']) {
    assert.equal(modeOfAnswer(boardAsk('Q1', 'G2', 'answered', words)), 'high', words)
  }
  assert.equal(modeOfAnswer(boardAsk('Q1', 'G2', 'open')), 'high')
  assert.equal(modeOfAnswer(boardAsk('Q1', 'G2', 'withdrawn')), 'high')
  assert.equal(modeOfAnswer(undefined), 'high')
  // An answer by the partner is never the person's yes.
  const byPartner = boardAsk('Q1', 'G2', 'answered', 'A')
  byPartner.head.set('Answered by', 'partner')
  assert.equal(modeOfAnswer(byPartner), 'high')
})

test('the guard\'s steps: start at the trip; an ask from before: its answer keeps its mode, an open one is taken back', () => {
  const node = text => parseGoals(text).byId.get('G2')
  assert.equal(guardStep(node(MAP), FAILED.slice(1)), null, 'one attempt of the part')
  assert.deepEqual(guardStep(node(MAP), FAILED), { do: 'start', ask: null, mode: 'high', gone: false, withdraw: false })
  const asked = MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Fable asked: Q7\n')
  assert.equal(node(asked).fableAsked, 'Q7')
  assert.equal(needsEvaluation(node(asked), FAILED), false, 'an ask stands: the guard does not trip again')
  // B752: an open one no longer waits: it is taken back and the evaluation starts on Opus.
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2')]), { do: 'start', ask: 'Q7', mode: 'high', gone: false, withdraw: true })
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'answered', 'A')]), { do: 'start', ask: 'Q7', mode: 'fable', gone: false, withdraw: false })
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'answered', 'B')]), { do: 'start', ask: 'Q7', mode: 'high', gone: false, withdraw: false })
  // Withdrawn by the person: no yes to Fable, so Opus.
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'withdrawn')]), { do: 'start', ask: 'Q7', mode: 'high', gone: false, withdraw: false })
  // Deleted from the store: Opus, never "asking" for ever.
  assert.deepEqual(guardStep(node(asked), FAILED), { do: 'start', ask: 'Q7', mode: 'high', gone: true, withdraw: false })
  // Running, or done: nothing.
  assert.equal(guardStep(node(asked.replace('  Fable asked: Q7\n', '  Fable asked: Q7\n  Evaluation asked: 2026-10-19 09:40\n')), FAILED), null)
  assert.equal(guardStep(node(MAP.replace('- [~] G2', '- [x] G2')), FAILED), null)
  // The Focus page: the board asks the person.
  // B706: the step the question is about is the first of the chain whose newest failed check (B4, a fix of B1) tripped the guard.
  assert.deepEqual(guardOf(node(asked), FAILED, []), { attempts: 3, parts: [{ title: 'Wooden benches', count: 3 }], step: 'B1', of: 3, state: 'asking', ask: 'Q7' })
})

test('B752: an ask from before that still stands open is taken back, and the evaluation starts on Opus', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  assert.deepEqual(await guardsAsking({ fs: one.fs, goalsFile: FILE }), ['G2'])
  const started = await one.guard()
  assert.equal(started.ok, true, started.why)
  assert.deepEqual([started.result.fired, started.result.mode, started.result.ask], [true, 'high', asked])
  assert.deepEqual(one.withdrawn.map(([id]) => id), [asked])
  assert.match(one.withdrawn[0][1], /without a model question/)
  assert.equal((await one.store()).get(asked).head.get('State'), 'withdrawn')
  const goal = mapOf(one.fs).byId.get('G2')
  assert.deepEqual([goal.evaluationAsked, goal.evaluationPart], ['2026-10-19 10:00', 'Wooden benches'])
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'high', yes: null })
})

test('an ask from before answered A: the partner\'s mode is fable for that evaluation, then it starts as before', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  assert.equal((await one.answer(asked, 'A Yes: Fable 5.1 (max), only for this evaluation')).ok, true)
  const started = await one.guard()
  assert.equal(started.ok, true, started.why)
  assert.deepEqual([started.result.fired, started.result.mode, started.result.ask], [true, 'fable', asked])
  assert.deepEqual([started.words.command, started.words.to, started.words.about], ['evaluate', 'Partner', 'G2'])
  assert.match(started.words.text, /^evaluate G2 Benches that feel like home\nPart: Wooden benches \(steps B1, B4\)[^\n]*\nAttempts: 3 failed checks of this part since Go/)
  const goal = mapOf(one.fs).byId.get('G2')
  assert.deepEqual([goal.evaluationAsked, goal.fableAsked], ['2026-10-19 10:00', asked])
  // The partner's mode while it runs, and the word to the main chat names the person's yes.
  assert.equal(evaluationMode(goal, await one.items()), 'fable')
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'fable', yes: asked })
  const word = partnerEffortWords({ to: 'Main', partner: 'Partner', session: null, mode: 'fable', why: 'the goal guard', yes: asked })
  assert.equal(word.text, `partner effort\nChat: Partner\nMode: fable\nModel: claude-fable-5-1\nEffort: max\nYes: ${asked}, the person's yes: Fable for this evaluation only\nWhy: the goal guard`)
  // Once: no second start, no ask.
  assert.deepEqual([(await one.guard()).result.fired, one.filed.length], [false, 1])
})

test('an ask from before answered B: the partner\'s mode is high (Opus 5.5 at max), then the evaluation starts', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  assert.equal((await one.answer(asked, 'B No: Opus 5.5 (max)')).ok, true)
  const started = await one.guard()
  assert.deepEqual([started.result.fired, started.result.mode], [true, 'high'])
  assert.equal(started.words.command, 'evaluate')
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'high', yes: null })
  assert.deepEqual(PARTNER_MODES.high, { model: 'claude-opus-5-5', effort: 'max', label: 'Opus 5.5, max' })
})

test('the evaluation\'s end returns the partner to usual and ends the trip; the next trip starts anew, with no ask', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  await one.answer(asked, 'A')
  assert.equal((await one.guard()).result.fired, true)
  const drafted = await focusMove({ command: 'how-draft', id: 'G2', parts: ['Stone benches · 3 h'], partnerDecides: ['Evaluation: wood caps the comfort'], youDecide: [] }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW + 5 * 60_000, fs: one.fs, partner: { name: 'Partner' }, job: 'j' })
  assert.equal(drafted.ok, true, drafted.why)
  assert.equal(drafted.result.evaluated, true)
  const goal = mapOf(one.fs).byId.get('G2')
  assert.deepEqual([goal.evaluationAsked, goal.fableAsked], [null, null])
  // None runs: the usual partner (Fable never stays on).
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'usual', yes: null })
  assert.deepEqual(await guardsAsking({ fs: one.fs, goalsFile: FILE }), [])
  // The old A is no yes for the next trip: new failures without progress start the next evaluation on Opus, no ask.
  const later = [step('B11', 'G2', ['2026-10-19 10:10 Partner: result check failed: 0 of 1; fix B12', '2026-10-19 10:20 Partner: result check failed: 0 of 1; fix B13'])]
  one.later(30 * 60_000)
  const next = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW + 31 * 60_000, fs: one.fs, partner: { name: 'Partner' }, job: 'j', items: () => one.items(later), approveRebuilds: false })
  assert.deepEqual([next.result.fired, next.result.mode, next.result.ask, one.filed.length], [true, 'high', null, 1])
})

test('Go on the how ends a trip whose ask from before stands: a late A then starts nothing', async () => {
  const one = await board(MAP.replace('  How agreed: 2026-10-19 08:00\n', ''))
  const asked = await one.oldAsk()
  assert.match(asked, /^Q\d+$/)
  const go = await focusMove({ command: 'how-go', id: 'G2' }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW + 60_000, fs: one.fs, partner: { name: 'Partner' }, job: 'j' })
  assert.equal(go.ok, true, go.why)
  assert.equal(mapOf(one.fs).byId.get('G2').fableAsked, null)
  // The board withdraws its own ask (the server, outside the map's turn).
  assert.equal(go.result.withdraw, asked)
  await one.answer(asked, 'A')
  const late = await one.guard('G2', FAILED)
  assert.deepEqual([late.result.fired, late.words], [false, null])
})

test('two evaluations at once run on Fable only when the person said A to both', () => {
  const text = MAP
    .replace('  How agreed: 2026-10-19 08:00\n- [ ] G3', '  How agreed: 2026-10-19 08:00\n  Fable asked: Q1\n  Evaluation asked: 2026-10-19 09:40\n- [ ] G3')
    .replace('  Part: Paper lanterns · 1 h · steps B7\n  How agreed: 2026-10-19 08:00\n', '  Part: Paper lanterns · 1 h · steps B7\n  How agreed: 2026-10-19 08:00\n  Fable asked: Q2\n  Evaluation asked: 2026-10-19 09:45\n')
  const nodes = parseGoals(text).nodes
  assert.deepEqual(partnerModeFor(nodes, [boardAsk('Q1', 'G2', 'answered', 'A'), boardAsk('Q2', 'G3', 'answered', 'A')]), { mode: 'fable', yes: 'Q1' })
  assert.deepEqual(partnerModeFor(nodes, [boardAsk('Q1', 'G2', 'answered', 'A'), boardAsk('Q2', 'G3', 'answered', 'B')]), { mode: 'high', yes: null })
  // An evaluation from before this change (no ask under it) runs on Opus.
  const old = parseGoals(MAP.replace('  How agreed: 2026-10-19 08:00\n- [ ] G3', '  How agreed: 2026-10-19 08:00\n  Evaluation asked: 2026-10-19 09:40\n- [ ] G3')).nodes
  assert.deepEqual(partnerModeFor(old, []), { mode: 'high', yes: null })
  assert.deepEqual(partnerModeFor(parseGoals(MAP).nodes, []), { mode: 'usual', yes: null })
})

test('the evaluation asked again keeps its own mode: Fable only after an A from before', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  await one.answer(asked, 'A')
  const started = await one.guard()
  const outbox = [{ id: 'm1', at: NOW, ...started.words, state: 'failed' }]
  const words = await evaluationsAgain({ canWrite: true, goalsFile: FILE, fs: one.fs, partner: { name: 'Partner' }, job: 'j', approveRebuilds: false, outbox, items: one.items, now: NOW + 31 * 60_000 })
  assert.equal(words.length, 1)
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'fable', yes: asked })
})

test('no code path sends mode fable without an answered A', async () => {
  // The word itself refuses Fable without the person's yes on the board's ask.
  assert.throws(() => partnerEffortWords({ to: 'Main', partner: 'Partner', session: null, mode: 'fable', why: 'w' }), /yes/)
  assert.throws(() => partnerEffortWords({ to: 'Main', partner: 'Partner', session: null, mode: 'fable', why: 'w', yes: 'G2' }), /yes/)
  assert.throws(() => partnerEffortWords({ to: 'Main', partner: 'Partner', session: null, mode: 'max', why: 'w' }), /mode/)
  // The person's switch on the Focus page sets high or usual, never Fable.
  assert.deepEqual(SWITCH_MODES, ['usual', 'high'])
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isMain: true, isLeftover: false }], advisor: { name: 'Partner', appSession: null } }
  assert.equal(checkSay({ to: 'Main', command: 'partner-effort', mode: 'fable' }, state, 50).status, 400)
  // B752: the guard needs no way to ask: it starts on Opus at max, never Fable.
  const fs = fakeFs({ [FILE]: latin(MAP) })
  const started = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: FAILED })
  assert.deepEqual([started.result.fired, started.result.mode], [true, 'high'])
  // The server: its only Fable comes from the guard's answered ask; no default, setting or literal names it.
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  // It reads the mode, but never sends fable by itself: the mode it sends comes from the answered asks.
  assert.doesNotMatch(server, /partnerMode\(state, 'fable'|mode: 'fable'|partnerMode\(state, back\.mode, back\.why, /)
  assert.doesNotMatch(server, /claude-fable/)
  const guard = server.slice(server.indexOf('const guardNow = async id => {'), server.indexOf('const toPartner = async'))
  assert.doesNotMatch(guard, /fileAsk/)
  assert.match(guard, /withdrawAsk: async \(ask, why\) => withdrawGuardAsk\(ask, why\)/)
  assert.doesNotMatch(guard, /partnerMode\(state, 'high'/)
  for (const file of ['src/config.mjs', 'src/state.mjs', 'src/work/effort.mjs', 'src/say.mjs', 'src/boardSettings.mjs']) {
    assert.doesNotMatch(await readFile(join(ROOT, file), 'utf8'), /claude-fable|'fable'/i, file)
  }
})

test('the settings\' models never name Fable', () => {
  assert.equal(modelIds({ sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }).problem, null)
  const fable = modelIds({ sonnet: 'claude-sonnet-5-5', opus: 'claude-fable-5-1' })
  assert.deepEqual(fable.models, {})
  assert.match(fable.problem, /Fable/)
})

const MIN = 60_000
const at = Date.parse('2026-10-24T19:00:00Z')
const answerLine = (minute, model, effort) => JSON.stringify({ type: 'assistant', timestamp: new Date(at + minute * MIN).toISOString(), effort, message: { role: 'assistant', model, content: [{ type: 'text', text: 'Draft written.' }], stop_reason: 'end_turn' } })

test('the partner\'s mode reads Fable too, and Go switches it back as it does high', () => {
  const word = { to: 'Main', command: 'partner-effort', about: 'Partner', mode: 'fable', at: at + 5 * MIN, state: 'delivered' }
  const set = partnerEffort({ sent: [word], partner: 'Partner', entries: parseTail(answerLine(6, 'claude-fable-5-1', 'max'), false) })
  assert.deepEqual([set.mode, set.isSet, set.asked.label], ['fable', true, 'Fable 5.1, max'])
  assert.equal(set.labels.fable, 'Fable 5.1, max')
  // Set by hand, with no word: what it runs on says so.
  assert.equal(partnerEffort({ sent: [], partner: 'Partner', entries: parseTail(answerLine(1, 'claude-fable-5-1', 'max'), false) }).mode, 'fable')
  assert.equal(effortBack('how-go', { mode: 'fable' }), 'Go on the how: back to the usual partner')
  assert.equal(effortBack('focus', { mode: 'fable' }), 'a new focus: back to the usual partner')
})

test('the page: the switch shows Fable as on and flips it to usual; the run\'s card says the board asks you', async () => {
  const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
  const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`${cut('effortswitch')}\n${cut('focus')}\nObject.assign(this, { effortView, focusGuardView })`, page)
  const labels = { usual: 'Opus 5.5, extra high', high: 'Opus 5.5, max', fable: 'Fable 5.1, max' }
  const fable = page.effortView({ mode: 'fable', isSet: true, asked: { at, state: 'delivered' }, labels })
  assert.deepEqual([fable.isOn, fable.line], [true, 'on: Fable 5.1, max'])
  assert.match(fable.note, /with your yes/)
  assert.match(script, /mode: effort\.mode === 'usual' \? 'high' : 'usual'/)
  const asking = page.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'asking', ask: 'Q7' } })
  assert.equal(asking.tone, 'asking')
  assert.match(asking.text, /Q7/)
  assert.match(asking.text, /Nothing starts before your answer\./)
  assert.match(css, /\.focus-guard\.is-asking h3 \{/)
})

test('the roles: nothing but the board\'s word after the person\'s A sets Fable', async () => {
  const main = await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')
  const partner = await readFile(join(ROOT, 'roles', 'partner.md'), 'utf8')
  const protocol = await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')
  for (const [name, text] of [['main', main], ['partner', partner]]) {
    assert.match(text, /[Nn]ever set any chat to Fable/, name)
    assert.match(text, /model: "fable"/, name)
  }
  assert.match(main, /Mode: fable/)
  // B752: the evaluation brings other ways; it never asks the person for a model.
  assert.doesNotMatch(partner, /evaluate the strategy with Fable\?" \(A Yes/)
  assert.match(partner, /never a stronger model/)
  assert.match(protocol, /Mode `fable`: Fable 5\.1, max/)
  assert.doesNotMatch(protocol, /Mode `high`: Fable/)
})

test('the review: an ask from before is taken back outside the map\'s turn, so a draft through the work API meanwhile never deadlocks', async () => {
  const one = await board()
  const asked = await one.oldAsk()
  const focusCtx = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW, fs: one.fs, partner: { name: 'Partner' }, job: 'j' }
  const ctx = as => ({ dir: one.dir, now: NOW + 60_000, prefix: '', ...(as === undefined ? {} : { as }), roleOf: name => (name === 'Partner' ? 'advisor' : null), freeChats: new Set(), hasGoal: id => mapOf(one.fs).byId.has(id), goalDraft: body => focusMove(body, focusCtx) })
  // As the server's workAction: it reads the board's state before it calls the work API.
  const withdrawAsk = async (id, why) => { await new Promise(done => setTimeout(done, 50)); return workApi({ action: 'withdraw', id, why }, ctx('server')) }
  const guarded = guardGoal('G2', { ...focusCtx, items: await one.items(), approveRebuilds: false, withdrawAsk })
  await new Promise(done => setTimeout(done, 10))
  // The partner's how-draft (a step added to a part) arrives meanwhile, through the work tool: the work API's turn, then the map's.
  const drafted = workApi({ action: 'how-draft', chat: 'Partner', goal: 'G2', parts: ['Wooden benches · 2 h · steps B1, B2, B9'] }, ctx())
  let timer
  const late = new Promise(done => { timer = setTimeout(() => done('stuck'), 3000) })
  const both = await Promise.race([Promise.all([guarded, drafted]), late])
  clearTimeout(timer)
  assert.notEqual(both, 'stuck', 'the guard and the draft wait on each other')
  const [guard, draft] = both
  assert.equal(guard.ok, true, guard.why)
  assert.deepEqual([guard.result.fired, guard.result.ask], [true, asked])
  assert.equal(draft.ok, true, draft.why)
  assert.equal((await one.store()).get(asked).head.get('State'), 'withdrawn')
})

test('the review: two guards at once start one evaluation', async () => {
  const one = await board()
  const [a, b] = await Promise.all([one.guard(), one.guard()])
  assert.deepEqual([a.result.fired, b.result.fired].toSorted(), [false, true])
  assert.equal(one.filed.length, 0)
})

test('the review: an ask deleted from the store starts the evaluation on Opus and its line goes', async () => {
  const fs = fakeFs({ [FILE]: latin(MAP.replace('  How agreed: 2026-10-19 08:00\n- [ ] G3', '  How agreed: 2026-10-19 08:00\n  Fable asked: Q7\n- [ ] G3')) })
  const started = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: FAILED, approveRebuilds: false })
  assert.deepEqual([started.result.fired, started.result.mode], [true, 'high'])
  const goal = mapOf(fs).byId.get('G2')
  assert.deepEqual([goal.evaluationAsked, goal.fableAsked], ['2026-10-19 10:00', null])
  assert.deepEqual(partnerModeFor(mapOf(fs).nodes, FAILED), { mode: 'high', yes: null })
  assert.deepEqual(guardOf(goal, FAILED, []).state, 'evaluating')
})

test('the review: a goal ticked while its Fable evaluation runs ends the trip; a reopen does not bring Fable back', async () => {
  const running = MAP.replace('  How agreed: 2026-10-19 08:00\n- [ ] G3', '  How agreed: 2026-10-19 08:00\n  Fable asked: Q7\n  Evaluation asked: 2026-10-19 09:40\n  Recheck asked: 2026-10-19 09:50\n- [ ] G3')
  const fs = fakeFs({ [FILE]: latin(running) })
  const ticked = await goalChecked({ id: 'G2', verdict: 'passed', line: 'passed · 2 of 2 points pass · evidence none (x)', by: 'Partner' }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs })
  assert.equal(ticked.ok, true, ticked.why)
  const goal = mapOf(fs).byId.get('G2')
  assert.deepEqual([goal.state, goal.evaluationAsked, goal.fableAsked], ['done', null, null])
  assert.equal(ticked.result.withdraw, undefined, 'its ask was answered: nothing to withdraw')
  // Reopened: no evaluation, no Fable.
  const reopened = parseGoals(Buffer.from(fs.files[FILE], 'latin1').toString('utf8').replace('- [x] G2', '- [ ] G2')).nodes
  assert.deepEqual(partnerModeFor(reopened, [boardAsk('Q7', 'G2', 'answered', 'A')]), { mode: 'usual', yes: null })
  // Ticked while the board still asks: its ask is withdrawn.
  const asking = fakeFs({ [FILE]: latin(running.replace('  Evaluation asked: 2026-10-19 09:40\n', '')) })
  const early = await goalChecked({ id: 'G2', verdict: 'passed', line: 'passed · 2 of 2 points pass · evidence none (x)', by: 'Partner' }, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs: asking })
  assert.equal(early.result.withdraw, 'Q7')
})

test('the review: Fable never stays on: the tick sends the partner back when no evaluation with the person\'s yes runs', async () => {
  const fable = { mode: 'fable', asked: { at: 1, state: 'delivered', label: 'Fable 5.1, max' } }
  assert.deepEqual(fableBack(fable, { mode: 'usual', yes: null }).mode, 'usual')
  assert.deepEqual(fableBack(fable, { mode: 'high', yes: null }).mode, 'high')
  assert.equal(fableBack(fable, { mode: 'fable', yes: 'Q7' }), null)
  assert.equal(fableBack({ mode: 'high', asked: { at: 1 } }, { mode: 'usual', yes: null }), null)
  // Fable the person set by hand (no word of the board's) is theirs.
  assert.equal(fableBack({ mode: 'fable', asked: null }, { mode: 'usual', yes: null }), null)
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  const again = server.slice(server.indexOf('const evaluateAgainNow = async state => {'), server.indexOf('const toPartner = async'))
  assert.match(again, /fableBack\(state\.advisor\.effort/)
  // The why says the mode used.
  const guard = server.slice(server.indexOf('const guardNow = async id => {'), server.indexOf('const evaluateAgainNow'))
  assert.match(guard, /partnerModeNow\(state, \(mode, yes\) =>/)
})

test('the review: the supervisor never runs Fable either', async () => {
  assert.match(await readFile(join(ROOT, 'roles', 'supervisor.md'), 'utf8'), /[Nn]ever Fable/)
})
