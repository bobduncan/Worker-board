// P1 of the one wait system, the core review's fixes (chat 1, 2026-11-09): the Late card drawn on the page; the landing guard on
// the periodic pass, read from the gate log too, and a landed line as progress; the timers read the step's record whatever the
// lane says; a wait's record and clear as progress; the person's pause; the clear's `on`; the prefix; a rename. Made-up chats, the
// live step B1081 and its times.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { landedLines, runningLanding } from '../src/landing.mjs'
import { memoryStore } from '../src/store.mjs'
import { workApi } from '../src/work/api.mjs'
import { HANDOVER_COMMAND, decide } from '../src/work/handover.mjs'
import { factsOf, handoverPass } from '../src/work/handoverBoard.mjs'
import { holderTimers } from '../src/work/holderTimers.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { renamedItem } from '../src/work/names.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { lateWaitOf, waitsOnOf } from '../src/work/waitsOn.mjs'
import { openPage } from './pageHarness.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const at = (h, m, s = 0) => new Date(2026, 10, 9, h, m, s).getTime()
const WAIT_AT = at(11, 18)
const IDLE_AT = at(11, 19, 11)
const BRANCH = 'b1081-open-fix-check'
const WAITS_ON = `chat 1 · its go to land · ${stamp(WAIT_AT).slice(0, 16)}`
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const PREFIX = 'Garden · '
const NAMES = ['Lead', 'Worker 4', 'Worker 5', 'Advisor']
const ROLES = { Lead: 'main', 'Worker 4': 'worker', 'Worker 5': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const GO_ONS = [`- ${stamp(at(11, 24))} server: the board asked Worker 4 to go on (stopped since 11:19)`, `- ${stamp(at(11, 30))} server: the board asked Worker 4 to go on (stopped since 11:25)`]
const b1081 = ({ waits = null, history = [], owner = 'Worker 4', state = 'in progress', branch = BRANCH } = {}) => text(
  { Id: 'B1081', Kind: 'step', Title: 'Fix: the board makes a check task for a step whose fix is still open', Priority: 'fix', State: state, Owner: owner, Activity: 'Garden', Goal: 'G15', ...(waits === null ? {} : { 'Waits on': waits }), Since: stamp(at(10, 58)), Branch: branch, Checkpoint: `8522bc6c · gate green, branch pushed; wait for its go · ${stamp(WAIT_AT)}`, 'Taken for': '30 min', Refined: 'ready' },
  { History: [`- ${stamp(at(10, 58))} Worker 4: queued → taken`, `- ${stamp(at(10, 58))} Worker 4: taken → in progress`, `- ${stamp(WAIT_AT)} Worker 4: checkpoint 8522bc6c · gate green, branch pushed; wait for its go`, ...history] })

/** The app's id of a chat: `local_` and a uuid (the fourth one for Worker 4). */
const appId = name => `local_00000000-0000-4000-8000-${String(NAMES.indexOf(name) + 1).padStart(12, '0')}`
const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: appId(name), cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: at(11, 19), lastAssistantUuid: 'u-1' })
const typed = (when, said) => JSON.stringify({ type: 'user', timestamp: new Date(when).toISOString(), message: { role: 'user', content: said } })
const answer = (when, said) => JSON.stringify({ type: 'assistant', timestamp: new Date(when).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: said }] } })
const tail = { text: [typed(at(10, 58), 'Take B1081.'), answer(at(11, 19), 'Gate green, branch pushed; waiting for chat 1\'s go.')].join('\n'), isCut: false, modifiedAt: at(11, 19) }
const report = (name, state, since, heard, more = {}) => [name, { state, since, background: false, run: 1, seq: 1, at: heard, session: `cli-${name}`, mod: '0.31.0', busyAt: null, ...more }]
function storeWith(items, pause = null) {
  const work = storeFromText('## Garden\n', { now: at(9, 0) })
  if (pause !== null) work.pause = pause
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    work.activities[0].steps.push(item.head.get('Id'))
  }
  return work
}
/** The board at `now`: Worker 4 on B1081 (its report `w4`: idle since 11:19:11 by default, or none for an unknown lane), Worker 5 idle on B5. */
function build({ now, waits = WAITS_ON, history = [], lines = [], pause = null, w4 = 'idle', work = null, outbox = [] }) {
  const store = work ?? storeWith([parseItem(b1081({ waits, history })), parseItem(text({ Id: 'B5', Kind: 'step', Title: 'Step B5', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Since: stamp(at(10, 30)) }))], pause)
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work: store, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: at(9, 0),
  }
  // `w4`: 'idle' a fresh idle report (interrupted: it holds a step); 'stale' the same report not heard since 11:19:11 (unknown); 'ended' its session ended (off).
  const w4Report = w4 === 'idle' ? report('Worker 4', 'idle', IDLE_AT, now - 5_000) : w4 === 'stale' ? report('Worker 4', 'idle', IDLE_AT, IDLE_AT) : report('Worker 4', 'ended', IDLE_AT, IDLE_AT)
  const reports = [report('Lead', 'idle', at(11, 0), now - 5_000), w4Report, report('Worker 5', 'idle', at(11, 10), now - 5_000), report('Advisor', 'idle', at(11, 0), now - 5_000)]
  const state = buildState(raw, { lines, outbox, runs: [], now, config, seen: { shown: {}, other: {} }, board: { startedAt: at(9, 0), offSince: null }, reports: new Map(reports) })
  return { state, work: store }
}
const laneOf = (state, name) => state.chats.find(one => one.name === name)
const decided = ({ state, work }, now, more = {}) => decide({ ...factsOf({ lane: laneOf(state, 'Worker 4'), state: { chatPrefix: PREFIX, readyList: null, limits: state.limits, gaps: state.gaps ?? [] }, items: work.items, pause: work.pause ?? null, sent: [], config, now, event: { kind: 'pass' }, ...more }), ready: [], owed: null })
const cleanUp = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

test('blocker 1: the Late card is drawn on the page (its kind, its tag, the step linked in its title, one way: open the chat) and its window opens', async t => {
  const now = WAIT_AT + 95 * MIN
  const built = build({ now, history: GO_ONS })
  const card = built.state.forYou.find(one => one.kind === 'wait late')
  assert.ok(card, 'the Late stands in forYou')
  assert.equal(card.workId, undefined, 'no workId: the page would read it as an ask of the store')
  assert.equal(card.step, 'B1081')
  assert.equal(card.title, 'Worker 4 waits for chat 1 (its go to land) since 11:18 (95 min) on B1081')
  const page = await openPage({ state: built.state, now })
  t.after(() => page.close?.())
  const drawn = page.all('#needs .need.is-wait').filter(one => one.dataset.id === card.id)
  assert.equal(drawn.length, 1, page.all('#needs .need').map(one => one.dataset.id).join(', '))
  assert.equal(words(drawn[0].querySelector('.tag')), 'Waits late')
  assert.equal(words(drawn[0].querySelector('.kind')), '!')
  assert.match(words(drawn[0].querySelector('h4')), /^Worker 4 waits for chat 1 \(its go to land\) since 11:18 \(95 min\) on B1081$/)
  assert.deepEqual([...drawn[0].querySelectorAll('h4 button.ask-link')].map(link => link.dataset.askLink), ['B1081'], 'the step is linked in the title')
  // Its one way really opens the worker's chat: a link to the app by the chat's id (as the pause banner's link does).
  assert.deepEqual([...drawn[0].querySelectorAll('.choices a.choice')].map(link => [words(link), link.getAttribute('href')]), [['Open Worker 4\'s chat', `claude://claude.ai/epitaxy/${appId('Worker 4')}`]])
  assert.deepEqual([...drawn[0].querySelectorAll('.choices button')].map(words), [])
  // Its window: the card's head opens the details without a throw, with the title and the board's text.
  drawn[0].querySelector('[data-details]').click()
  await new Promise(done => setTimeout(done, 50))
  const box = page.find('#details')
  assert.ok(box, 'the details window is there')
  assert.match(words(box), /Worker 4 waits for chat 1 \(its go to land\) since 11:18 \(95 min\) on B1081/)
  assert.match(words(box), /It recorded at 11:18 that it waits for chat 1/)
  assert.deepEqual([...box.querySelectorAll('a.choice')].map(link => link.getAttribute('href')), [`claude://claude.ai/epitaxy/${appId('Worker 4')}`], 'the window has the link too')
  assert.deepEqual(page.errors ?? [], [])
})

test('blocker 2: the periodic pass gives nothing back while a landing runs for the step\'s branch: read from the lock, from the gate log without a landings line, and passed through handoverPass', async t => {
  // The landing's record, in a data folder of its own.
  const data = await mkdtemp(join(tmpdir(), 'waits-data-'))
  t.after(() => cleanUp(data))
  await mkdir(join(data, 'landings'))
  const now = at(11, 46)
  assert.equal(runningLanding({ dir: data, now }), null, 'nothing runs')
  // A fresh gate log with no landings line: the gate of a landing in progress.
  const log = join(data, 'landings', `20261109-114741-${BRANCH}.log`)
  await writeFile(log, 'gate running\n')
  utimesSync(log, new Date(at(11, 47)), new Date(at(11, 47)))
  assert.equal(runningLanding({ dir: data, now: at(11, 48) }), BRANCH)
  // Once its landings line names the log, the landing is over.
  await writeFile(join(data, 'landings.jsonl'), `${JSON.stringify({ at: new Date(at(11, 55)).toISOString(), by: 'Worker 4', branch: BRANCH, result: 'landed', gateLog: `C:\\board\\data\\landings\\20261109-114741-${BRANCH}.log` })}\n`)
  assert.equal(runningLanding({ dir: data, now: at(11, 56) }), null)
  assert.deepEqual(landedLines({ dir: data }), [{ branch: BRANCH, at: at(11, 55), result: 'landed', gateLog: `20261109-114741-${BRANCH}.log` }])
  // An old log nobody wrote a line for (a cut landing) runs no landing; the lock, while fresh, names its branch first.
  const old = join(data, 'landings', '20261109-090000-old-branch.log')
  await writeFile(old, 'cut\n')
  utimesSync(old, new Date(at(9, 0)), new Date(at(9, 0)))
  assert.equal(runningLanding({ dir: data, now: at(11, 56) }), null)
  await writeFile(join(data, 'landing.lock'), JSON.stringify({ by: 'Worker 4', branch: 'locked-branch', at: new Date(at(11, 50)).toISOString(), pid: 1 }))
  assert.equal(runningLanding({ dir: data, now: at(11, 56) }), 'locked-branch')
  assert.equal(runningLanding({ dir: data, now: at(12, 30) }), null, 'a stale lock names nothing')
  await rm(join(data, 'landing.lock'))
  // A branch with a slash: the log carries it cleaned (land.ps1: every other character is "-"), and the guard compares both cleaned.
  const slashed = join(data, 'landings', '20261109-150000-qa-b866-x.log')
  await writeFile(slashed, 'gate running\n')
  utimesSync(slashed, new Date(at(15, 0)), new Date(at(15, 0)))
  assert.equal(runningLanding({ dir: data, now: at(15, 5) }), 'qa-b866-x')
  const slashBuilt = build({ now: at(11, 46), waits: null, history: GO_ONS, work: storeWith([parseItem(b1081({ history: GO_ONS, branch: 'qa/b866-x' }))]) })
  assert.equal(decided(slashBuilt, at(11, 46), { landing: 'qa-b866-x' }).giveBack, null, 'qa/b866-x is guarded by its log name')
  assert.notEqual(decided(slashBuilt, at(11, 46), { landing: 'qa-b866-y' }).giveBack, null)
  await rm(slashed)

  // The pass: the live 11:46 (two "go on" lines, nothing since 11:30) without the record, through handoverPass.
  const dir = await mkdtemp(join(tmpdir(), 'waits-pass-'))
  t.after(() => cleanUp(dir))
  const run = async ({ landingNow = null, landingsOf = null }) => {
    await writeStore(dir, storeWith([parseItem(b1081({ history: GO_ONS })), parseItem(text({ Id: 'B5', Kind: 'step', Title: 'Step B5', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Since: stamp(at(10, 30)) }))]), undefined, { now: at(9, 0) })
    const outbox = memoryStore()
    const { state } = build({ now, waits: null, history: GO_ONS, work: { ...await readStore(dir), ok: true }, outbox: outbox.outbox() })
    const apply = body => workApi(body, { dir, now, prefix: PREFIX, roleOf, as: 'server' })
    let n = 0
    const passed = await handoverPass({ state, dir, outbox, apply, config, installed: '0.31.0', now, newId: () => `m${++n}`, landingNow, landingsOf })
    const step = (await readStore(dir)).items.get('B1081')
    return { passed, state: valueOf(step, 'State'), owner: valueOf(step, 'Owner') }
  }
  const bare = await run({})
  assert.deepEqual([bare.state, bare.owner, bare.passed.decided.map(one => one.chat)], ['refined', null, ['Worker 4', 'Worker 5']], 'without the guard the live give-back')
  const guarded = await run({ landingNow: () => BRANCH })
  assert.deepEqual([guarded.state, guarded.owner], ['in progress', 'Worker 4'], 'the lock branch holds the step with Worker 4')
  // A throw in the landed lines' reading leaves the running landing's fact standing (and the other way round).
  assert.equal((await run({ landingNow: () => BRANCH, landingsOf: () => { throw new Error('torn file') } })).state, 'in progress', 'the landing fact survives a throw in landingsOf')
  assert.equal((await run({ landingNow: () => { throw new Error('no lock') }, landingsOf: () => [{ branch: BRANCH, at: at(11, 40), result: 'landed' }] })).state, 'in progress', 'the landed line survives a throw in landingNow')
  // The log-based reading, as the server wires it.
  await writeFile(log, 'gate running\n')
  utimesSync(log, new Date(at(11, 45)), new Date(at(11, 45)))
  await rm(join(data, 'landings.jsonl'))
  assert.deepEqual((await run({ landingNow: () => runningLanding({ dir: data, now }) })).state, 'in progress')
  // The landed line for the branch (11:40) is progress: no give-back at 11:46; fifteen minutes after it, yes.
  const landed = [{ branch: BRANCH, at: at(11, 40), result: 'landed' }]
  assert.equal((await run({ landingsOf: () => landed })).state, 'in progress')
  const laterBuilt = build({ now: at(11, 56), waits: null, history: GO_ONS })
  assert.notEqual(decided(laterBuilt, at(11, 56), { landings: landed }).giveBack, null, 'fifteen minutes after the release the give-back is due again')
  assert.equal(decided(build({ now, waits: null, history: GO_ONS }), now, { landings: [{ branch: 'other', at: at(11, 40), result: 'landed' }] }).giveBack?.step, 'B1081', 'another branch\'s landing is no progress')
})

test('should-fix 3: the timers read the step\'s record, whatever the lane says: an unknown or off lane with a Waits on gets no "go on" line and no give-back; a waiting "go on" line is closed once the lane is parked', () => {
  // Worker 4 never reported (unknown), then off: with the record, nothing; without it, the line goes.
  for (const w4 of ['stale', 'ended']) {
    const built = build({ now: at(11, 46), history: GO_ONS, w4 })
    const lane = laneOf(built.state, 'Worker 4')
    assert.ok(['unknown', 'off', 'suspended'].includes(lane.state), `${w4}: ${lane.state}`)
    const decision = decided(built, at(11, 46))
    assert.deepEqual([decision.envelope, decision.giveBack, decision.goOn], [null, null, null], `${w4}: ${JSON.stringify(decision)}`)
    const bare = decided(build({ now: at(11, 46), waits: null, history: GO_ONS, w4 }), at(11, 46))
    assert.ok(bare.giveBack !== null || bare.envelope !== null || bare.takeBack !== null, `${w4}: without the record the board acts: ${JSON.stringify(bare)}`)
  }
  // The timers themselves, on a lane that reads unknown or off while it holds the step (a 30 s report blip, a failed wake): null with the
  // record, whatever the lane says; without it the live rule.
  for (const state of ['unknown', 'off', 'interrupted']) {
    const lane = { name: 'Worker 4', state, isRunning: false, suspended: null, report: null, turnAt: at(10, 58) }
    const timers = holding => holderTimers({ worker: lane, holding, items: new Map(), prefix: '', runningMs: from => at(11, 46) - from })
    assert.equal(timers(parseItem(b1081({ waits: WAITS_ON, history: GO_ONS }))), null, state)
    assert.notEqual(timers(parseItem(b1081({ history: GO_ONS }))), null, `${state}: without the record`)
  }
  // The late read: from the record, also for a lane that is not parked (unknown).
  const unknown = build({ now: WAIT_AT + 95 * MIN, history: GO_ONS, w4: 'stale' })
  assert.equal(unknown.state.forYou.filter(one => one.kind === 'wait late').length, 1)
  // A "go on" line written at 11:24 still waiting at 11:26, when the record came (the lane parked): the decision closes it.
  const waiting = { id: 'm1', kind: 'resume', command: HANDOVER_COMMAND, to: 'Worker 4', at: at(11, 24), state: 'waiting', resume: `resume B1081 ${IDLE_AT}`, line: 'go on' }
  const parked = build({ now: at(11, 26), outbox: [waiting] })
  const decision = decide({ ...factsOf({ lane: laneOf(parked.state, 'Worker 4'), state: { chatPrefix: PREFIX, readyList: null, limits: parked.state.limits, gaps: [] }, items: parked.work.items, pause: null, sent: [waiting], config, now: at(11, 26), event: { kind: 'pass' } }), ready: [], owed: null })
  assert.deepEqual([decision.state, decision.close], ['suspended', 'm1'])
})

test('should-fix 4: the record and the clear of a wait are progress: the B1081 timeline with an unblock at 12:40 gives nothing back on the next pass, and the "go on" count starts anew', () => {
  const history = [...GO_ONS, `- ${stamp(at(11, 35))} Worker 4: waits on chat 1 · its go to land`, `- ${stamp(at(12, 40))} Worker 4: no longer waits on chat 1 (its go to land, since 2026-11-09 11:35)`]
  const first = decided(build({ now: at(12, 41), waits: null, history }), at(12, 41))
  assert.deepEqual([first.giveBack, first.envelope], [null, null], JSON.stringify(first))
  // Five running minutes after the clear: one "go on" line again (the count started anew), no give-back.
  const later = decided(build({ now: at(12, 46), waits: null, history }), at(12, 46))
  assert.deepEqual([later.giveBack, later.envelope === null], [null, false], JSON.stringify(later))
  // Without the wait's lines the two old ones count: the step goes back at once.
  assert.notEqual(decided(build({ now: at(12, 41), waits: null, history: GO_ONS }), at(12, 41)).giveBack, null)
})

test('should-fix 5: no Late while the person pauses; a pause\'s time is no waiting; the worker\'s answer names the setting', async t => {
  // Pausing at 12:00, read at 12:53: no Late.
  assert.deepEqual(build({ now: WAIT_AT + 95 * MIN, history: GO_ONS, pause: { state: 'pausing', since: at(12, 0) } }).state.forYou.filter(one => one.kind === 'wait late'), [])
  // Paused 11:30 to 12:00, running again since 12:00: 53 running minutes at 12:53 (no Late), 91 at 13:31 (a Late).
  const resumed = { state: 'running', since: at(12, 0), pausedSince: at(11, 30), resumedSince: at(12, 0) }
  assert.deepEqual(build({ now: WAIT_AT + 95 * MIN, history: GO_ONS, pause: resumed }).state.forYou.filter(one => one.kind === 'wait late'), [])
  assert.equal(build({ now: at(13, 31), history: GO_ONS, pause: resumed }).state.forYou.filter(one => one.kind === 'wait late').length, 1)
  assert.equal(lateWaitOf({ chat: 'Worker 4', wait: waitsOnOf(parseItem(b1081({ waits: WAITS_ON }))), stepId: 'B1081', runningMs: () => 90 * MIN }).text, 'Worker 4 waits for chat 1 (its go to land) since 11:18 (90 min)')
  // The answer to the record names the board's setting.
  const dir = await mkdtemp(join(tmpdir(), 'waits-min-'))
  t.after(() => cleanUp(dir))
  await writeFile(join(dir, 'B1081.md'), b1081())
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B1081'] }] }, null, 1)}\n`)
  const made = await workApi({ action: 'block', chat: 'Worker 4', id: 'B1081', on: 'chat 1', why: 'its go to land' }, { dir, now: WAIT_AT, prefix: '', roleOf, chats: NAMES, waitOnMinutes: 45 })
  assert.match(made.result.text, /no give-back for 45 min of its running time/)
})

test('minor 6 and 7: unblock on=<who> must name the standing who (any case, with or without the prefix), b1080 is a step id, and the same who with the prefix keeps the since', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'waits-on-'))
  t.after(() => cleanUp(dir))
  await writeFile(join(dir, 'B1081.md'), b1081())
  await writeFile(join(dir, 'B1080.md'), text({ Id: 'B1080', Kind: 'step', Title: 'Drop me', State: 'refined', Activity: 'Garden', Since: stamp(at(10, 0)) }))
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B1080', 'B1081'] }] }, null, 1)}\n`)
  const ctx = (now, as) => ({ dir, now, prefix: PREFIX, roleOf, chats: NAMES.map(name => `${PREFIX}${name}`), ...(as === undefined ? {} : { as }) })
  const chat = (who, body, now) => workApi({ ...body, chat: who }, ctx(now))
  const field = async (id, key) => valueOf((await readStore(dir)).items.get(id), key)
  assert.equal((await chat('Worker 4', { action: 'block', id: 'B1081', on: `${PREFIX}Worker 5`, why: 'its review' }, WAIT_AT)).ok, true)
  assert.equal(await field('B1081', 'Waits on'), `Worker 5 · its review · ${stamp(WAIT_AT).slice(0, 16)}`, 'the record keeps the bare name of the list')
  // The same who without the prefix, in another case: the record stands.
  const again = await chat('Worker 4', { action: 'block', id: 'B1081', on: 'worker 5', why: 'its review' }, WAIT_AT + 2 * MIN)
  assert.deepEqual([again.ok, again.result.changed], [true, false])
  assert.equal(await field('B1081', 'Waits on'), `Worker 5 · its review · ${stamp(WAIT_AT).slice(0, 16)}`)
  // A clear naming another chat: refused, nothing cleared.
  const wrong = await chat('Worker 4', { action: 'unblock', id: 'B1081', on: 'chat 1' }, WAIT_AT + 3 * MIN)
  assert.equal(wrong.status, 409)
  assert.match(wrong.why, /waits on Worker 5, not on chat 1/)
  assert.notEqual(await field('B1081', 'Waits on'), null)
  // on=b1080 is the step id: the Blocked by path (B1081 is not blocked by it: no change), the chat wait stands.
  const blocked = await chat('Worker 4', { action: 'block', id: 'B1081', on: 'b1080' }, WAIT_AT + 3 * MIN)
  assert.equal(blocked.ok, true, blocked.why)
  assert.equal(await field('B1081', 'Blocked by'), 'B1080')
  const unblocked = await chat('Worker 4', { action: 'unblock', id: 'B1081', on: 'b1080' }, WAIT_AT + 4 * MIN)
  assert.equal(unblocked.ok, true, unblocked.why)
  assert.deepEqual([await field('B1081', 'Blocked by'), await field('B1081', 'Waits on')], [null, `Worker 5 · its review · ${stamp(WAIT_AT).slice(0, 16)}`])
  // The right who, in another case and without the prefix: cleared.
  const cleared = await chat('Worker 4', { action: 'unblock', id: 'B1081', on: 'WORKER 5' }, WAIT_AT + 5 * MIN)
  assert.equal(cleared.ok, true, cleared.why)
  assert.equal(await field('B1081', 'Waits on'), null)
})

test('minor 8: a rename follows the who of a Waits on; another who and the other fields stay', () => {
  const step = parseItem(b1081({ waits: `Worker 5 · its review · ${stamp(WAIT_AT).slice(0, 16)}` }))
  const moved = renamedItem(step, 'Worker 5', 'Worker 7', '')
  assert.equal(valueOf(moved, 'Waits on'), `Worker 7 · its review · ${stamp(WAIT_AT).slice(0, 16)}`)
  assert.equal(valueOf(moved, 'Owner'), 'Worker 4')
  assert.equal(renamedItem(step, 'Worker 6', 'Worker 7', ''), null, 'a rename of a chat the step does not name moves nothing')
  // The rename named with the prefix (the app's title): the record's bare who follows all the same.
  const withPrefix = renamedItem(parseItem(b1081({ waits: 'Worker 5 · its review · 2026-11-09 11:18' })), `${PREFIX}Worker 5`, 'Worker 7', PREFIX)
  assert.equal(valueOf(withPrefix, 'Waits on'), 'Worker 7 · its review · 2026-11-09 11:18')
})
