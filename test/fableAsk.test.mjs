// 2026-10-24: never Fable without the person's yes. The person: "i want to prevent any chat running fable. i run out of
// tokens too quickly. maximum run opus. if you really require fable somereason exclicitly ask, you cant run fable
// without my permission"; and "on 3 failed attempts is important context. i want to be asked. hey this task failed 3
// times, we would like to evaluate strategy using fable. yes, or no use opus." The goal guard's third failed attempt
// files one ask to the person (A Fable 5.1 at max, only for this evaluation; B Opus 5.5 at max); the evaluation waits
// for the answer. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { evaluationsAgain, evaluationsMode, focusMove, goalChecked, guardGoal, guardsAsking } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { FABLE_OPTIONS, evaluationMode, fableAskOf, goalAttempts, guardOf, guardStep, modeOfAnswer, needsEvaluation, partnerModeFor } from '../src/goalGuard.mjs'
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
  '  Vibe: you sit down without thinking',
  '  Vibe agreed: 2026-10-19 07:00',
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
  const guard = async (id = 'G2', extra = FAILED) => guardGoal(id, { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: () => items(extra), approveRebuilds: false, fileAsk })
  const answer = (id, text) => workApi({ action: 'answer', id, text }, ctx('person'))
  const store = async () => (await readStore(dir)).items
  return { fs, dir, filed, guard, answer, store, items, later: ms => { clock.now += ms } }
}

test('the ask: a decide of the goal, blocking, its title the question, two plain lines, A Fable and B Opus, no advice', () => {
  const node = parseGoals(MAP).byId.get('G2')
  const body = fableAskOf({ goal: node, attempts: goalAttempts(node, FAILED) })
  assert.deepEqual([body.action, body.of, body.kind, body.blocking], ['ask', 'G2', 'decide', true])
  // B669: it names the part that failed three times.
  assert.equal(body.title, 'G2 · Wooden benches failed 3 times: evaluate the strategy with Fable?')
  // The person's framing: "we would like to evaluate strategy using fable. yes, or no use opus".
  assert.deepEqual(body.options, ['A Yes: Fable 5.1 (max), only for this evaluation', 'B No: Opus 5.5 (max)'])
  assert.deepEqual(FABLE_OPTIONS, body.options)
  assert.equal(body.advice, undefined)
  const lines = body.text.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /^G2 Benches that feel like home \(Wooden benches\): 3 checks failed since Go; the latest, B4: 0 of 1 points pass\.$/)
  assert.match(lines[1], /Fable 5\.1 is the strongest model but uses far more tokens than Opus 5\.5/)
  assert.match(lines[1], /nothing starts before your answer/)
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

test('the guard\'s steps: ask at the third failure, wait while the ask is open, start on its answer', () => {
  const node = text => parseGoals(text).byId.get('G2')
  assert.equal(guardStep(node(MAP), FAILED.slice(1)), null, 'two attempts')
  assert.deepEqual(guardStep(node(MAP), FAILED), { do: 'ask' })
  const asked = MAP.replace('  How agreed: 2026-10-19 08:00\n', '  How agreed: 2026-10-19 08:00\n  Fable asked: Q7\n')
  assert.equal(node(asked).fableAsked, 'Q7')
  assert.equal(needsEvaluation(node(asked), FAILED), false, 'an ask stands: the guard does not trip again')
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2')]), { do: 'wait', ask: 'Q7' })
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'answered', 'A')]), { do: 'start', ask: 'Q7', mode: 'fable', gone: false })
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'answered', 'B')]), { do: 'start', ask: 'Q7', mode: 'high', gone: false })
  // Withdrawn by the person: no yes to Fable, so Opus.
  assert.deepEqual(guardStep(node(asked), [...FAILED, boardAsk('Q7', 'G2', 'withdrawn')]), { do: 'start', ask: 'Q7', mode: 'high', gone: false })
  // Deleted from the store (the guard reads it fresh, after the ask was filed): Opus, never "asking" for ever.
  assert.deepEqual(guardStep(node(asked), FAILED), { do: 'start', ask: 'Q7', mode: 'high', gone: true })
  // Running, or done: nothing.
  assert.equal(guardStep(node(asked.replace('  Fable asked: Q7\n', '  Fable asked: Q7\n  Evaluation asked: 2026-10-19 09:40\n')), FAILED), null)
  assert.equal(guardStep(node(MAP.replace('- [~] G2', '- [x] G2')), FAILED), null)
  // The Focus page: the board asks the person.
  assert.deepEqual(guardOf(node(asked), FAILED, []), { attempts: 3, parts: [{ title: 'Wooden benches', count: 3 }], step: 'B4', of: 3, state: 'asking', ask: 'Q7' })
})

test('the third failure files exactly one ask and starts no evaluation and no mode word; not twice while it is open', async () => {
  const one = await board()
  const first = await one.guard()
  assert.equal(first.ok, true, first.why)
  assert.deepEqual([first.result.fired, first.words], [false, null])
  assert.equal(one.filed.length, 1)
  const id = first.result.asked
  assert.match(id, /^Q\d+$/)
  const goal = mapOf(one.fs).byId.get('G2')
  assert.deepEqual([goal.fableAsked, goal.evaluationAsked], [id, null])
  const ask = (await one.store()).get(id)
  assert.deepEqual(['Kind', 'Owner', 'Asks', 'Blocking', 'Of', 'State'].map(key => ask.head.get(key)), ['ask', 'server', 'decide', 'yes', 'G2', 'open'])
  assert.equal(ask.head.get('Title'), 'G2 · Wooden benches failed 3 times: evaluate the strategy with Fable?')
  assert.equal(ask.head.get('Options'), 'A Yes: Fable 5.1 (max), only for this evaluation | B No: Opus 5.5 (max)')
  assert.equal(ask.head.get('Advice') ?? null, null)
  assert.equal(ask.head.get('Route') ?? null, null, 'the person\'s, never routed to the partner')
  // Again while it is open (another failed check, the tick): nothing new.
  const again = await one.guard('G2', [...FAILED, step('B9', 'G2', ['2026-10-19 09:50 Partner: result check failed: 0 of 1 points pass; fix B10 for W1'])])
  assert.deepEqual([again.result.fired, again.words, one.filed.length], [false, null, 1])
  assert.deepEqual((await one.store()).values().filter(item => item.head.get('Kind') === 'ask').toArray().length, 1)
  // The tick finds the goal whose ask stands.
  assert.deepEqual(await guardsAsking({ fs: one.fs, goalsFile: FILE }), ['G2'])
})

test('A: the partner\'s mode is fable, then the evaluation starts as before', async () => {
  const one = await board()
  const { result: { asked } } = await one.guard()
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
  // Once: no second ask, no second start.
  assert.deepEqual([(await one.guard()).result.fired, one.filed.length], [false, 1])
})

test('B: the partner\'s mode is high (Opus 5.5 at max), then the evaluation starts', async () => {
  const one = await board()
  const { result: { asked } } = await one.guard()
  assert.equal((await one.answer(asked, 'B No: Opus 5.5 (max)')).ok, true)
  const started = await one.guard()
  assert.deepEqual([started.result.fired, started.result.mode], [true, 'high'])
  assert.equal(started.words.command, 'evaluate')
  assert.deepEqual(await evaluationsMode({ fs: one.fs, goalsFile: FILE, items: one.items }), { mode: 'high', yes: null })
  assert.deepEqual(PARTNER_MODES.high, { model: 'claude-opus-5-5', effort: 'max', label: 'Opus 5.5, max' })
})

test('the evaluation\'s end returns the partner to usual and ends the trip; the next trip asks anew', async () => {
  const one = await board()
  const { result: { asked } } = await one.guard()
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
  // The old A is no yes for the next trip: three new failures ask the person again.
  const later = [step('B11', 'G2', ['2026-10-19 10:10 Partner: result check failed: 0 of 1; fix B12', '2026-10-19 10:20 Partner: result check failed: 0 of 1; fix B13', '2026-10-19 10:30 Partner: result check failed: 0 of 1; fix B14'])]
  one.later(30 * 60_000)
  const next = await one.guard('G2', later)
  assert.deepEqual([next.result.fired, next.words, one.filed.length], [false, null, 2])
  assert.notEqual(next.result.asked, asked)
})

test('Go on the how ends a trip whose ask stands: a late A then starts nothing', async () => {
  const one = await board(MAP.replace('  How agreed: 2026-10-19 08:00\n', ''))
  const asked = (await one.guard('G2', [step('B1', 'G2', ['2026-10-19 07:30 Partner: new → refined', ...FAILED[0].sections.get('History').map(line => line.slice(2))]), FAILED[1]])).result.asked
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

test('the evaluation asked again keeps its own mode: Fable only after the A', async () => {
  const one = await board()
  const { result: { asked } } = await one.guard()
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
  // The guard without a way to ask starts nothing.
  const fs = fakeFs({ [FILE]: latin(MAP) })
  const silent = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs, partner: { name: 'Partner' }, job: 'j', items: FAILED })
  assert.deepEqual([silent.result.fired, silent.words], [false, null])
  assert.equal(mapOf(fs).byId.get('G2').evaluationAsked, null)
  // The server: its only Fable comes from the guard's answered ask; no default, setting or literal names it.
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  // It reads the mode, but never sends fable by itself: the mode it sends comes from the answered asks.
  assert.doesNotMatch(server, /partnerMode\(state, 'fable'|mode: 'fable'|partnerMode\(state, back\.mode, back\.why, /)
  assert.doesNotMatch(server, /claude-fable/)
  const guard = server.slice(server.indexOf('const guardNow = async id => {'), server.indexOf('const toPartner = async'))
  assert.match(guard, /fileAsk: body => workAction\(body, 'server'\)/)
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
  assert.match(partner, /failed 3 times: evaluate the strategy with Fable\?/)
  assert.match(protocol, /Mode `fable`: Fable 5\.1, max/)
  assert.doesNotMatch(protocol, /Mode `high`: Fable/)
})

test('the review: the ask is filed outside the map\'s turn, so a draft through the work API meanwhile never deadlocks', async () => {
  const one = await board()
  const focusCtx = { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', brainstormDir: 'D:/Work/p/talks', brainstormFolder: 'talks', now: NOW, fs: one.fs, partner: { name: 'Partner' }, job: 'j' }
  const ctx = as => ({ dir: one.dir, now: NOW + 60_000, prefix: '', ...(as === undefined ? {} : { as }), roleOf: name => (name === 'Partner' ? 'advisor' : null), freeChats: new Set(), hasGoal: id => mapOf(one.fs).byId.has(id), goalDraft: body => focusMove(body, focusCtx) })
  // As the server's workAction: it reads the board's state before it calls the work API.
  const fileAsk = async body => { await new Promise(done => setTimeout(done, 50)); return workApi(body, ctx('server')) }
  const guarded = guardGoal('G2', { ...focusCtx, items: await one.items(), approveRebuilds: false, fileAsk })
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
  assert.match(guard.result.asked, /^Q\d+$/)
  assert.equal(draft.ok, true, draft.why)
  assert.equal(mapOf(one.fs).byId.get('G2').fableAsked, guard.result.asked)
})

test('the review: two guards at once ask once; an ask filed for a trip that ended meanwhile is withdrawn', async () => {
  const one = await board()
  const [a, b] = await Promise.all([one.guard(), one.guard()])
  assert.equal(one.filed.length, 1)
  assert.deepEqual([a.result.asked, b.result.asked ?? null], [mapOf(one.fs).byId.get('G2').fableAsked, null])
  // The goal ticked between the ask and its line: the board takes its ask back.
  const other = await board()
  const withdrawn = []
  const ticking = async body => {
    other.fs.files[FILE] = latin(MAP.replace('- [~] G2', '- [x] G2'))
    return workApi(body, { dir: other.dir, now: NOW + 60_000, prefix: '', as: 'server', roleOf: () => null, freeChats: new Set(), hasGoal: () => true })
  }
  const late = await guardGoal('G2', { canWrite: true, goalsFile: FILE, historyDir: 'D:/Work/p/history', now: NOW, fs: other.fs, partner: { name: 'Partner' }, job: 'j', items: FAILED, approveRebuilds: false, fileAsk: ticking, withdrawAsk: async (id, why) => withdrawn.push([id, why]) })
  assert.deepEqual([late.result.fired, late.result.asked ?? null], [false, null])
  assert.equal(withdrawn.length, 1)
  assert.match(withdrawn[0][0], /^Q\d+$/)
  assert.equal(mapOf(other.fs).byId.get('G2').fableAsked, null)
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
