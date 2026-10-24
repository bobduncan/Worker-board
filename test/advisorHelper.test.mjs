// B424: the partner's helper. The person, 2026-10-19: "make advisor 2 visible on the board, and is advisor given
// instructions to utilise advisor 2 when it's not working, if advisor 2 is busy it can pick up stuff itself", and "make
// advisor show under the advisor tab and not an worker". The list of chats names the helper ("helper"); the board shows
// it on its own card under the Advisor's, never as a worker, never with a queue; the work tool takes its refines and
// result checks as the partner's own, its History lines naming it. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, assistant, step, text, tool, typed } from '../fixtures/lines.mjs'
import { parseList } from '../src/appChats.mjs'
import { checkTake, shownChats } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 19, 14, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { isReported: false, ...task }, at: NOW - 10 * MIN })

function build({ list = '{"prefix":"Garden · ","main":"Lead","helper":"Second"}', chats = ['Lead', 'Digger', 'Advisor', 'Second'], second = [answer(NOW - 30 * MIN, 'ok')], plan = null } = {}) {
  const raw = {
    listText: list,
    appChatTexts: chats.map(app),
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Second': tail(second) },
    planLineTexts: plan === null ? {} : { 'cli-Second': planLine(plan) },
    backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the list of chats names the helper with "helper"; a list without one has none', () => {
  assert.deepEqual(parseList('{"prefix":"Team - ","main":"Lead","helper":" Second "}'), { prefix: 'Team - ', main: 'Lead', problem: null, helper: 'Second' })
  assert.deepEqual(parseList('{"prefix":"Team - ","main":"Lead"}'), { prefix: 'Team - ', main: 'Lead', problem: null })
  assert.equal(parseList('{"prefix":"Team - ","main":"Lead","helper":""}').helper, undefined)
  assert.equal(parseList('{"prefix":"Team - ","main":"Lead","helper":3}').helper, undefined)
})

test('the helper is no worker: no lane, no queue, not counted; its card carries how it stands, its task and its time', () => {
  const state = build({
    second: [typed(NOW - 12 * MIN, 'Refine B12'), step(NOW - MIN, 'Read the step')],
    plan: { text: 'Refine B12', step: 2, steps: 3, names: ['Read', 'Draft', 'File'], left: 20 * MIN, stepLeft: 5 * MIN },
  })
  assert.deepEqual(state.chats.map(lane => lane.name), ['Lead', 'Digger'])
  assert.equal(state.workers.count, 1)
  assert.equal(state.advisor.name, 'Advisor')
  const helper = state.advisorHelper
  assert.equal(helper.name, 'Second')
  assert.equal(helper.state, 'working')
  assert.equal(helper.task.text, 'Refine B12')
  assert.deepEqual([helper.task.step, helper.task.steps], [2, 3])
  assert.notEqual(helper.eta, null)
  assert.equal(helper.doingNow, 'Read the step')
  assert.equal(helper.asksYou, false)
  assert.equal(helper.session, 'cli-Second')
  // The name is the list's, in any case of letters.
  assert.equal(build({ list: '{"prefix":"Garden · ","main":"Lead","helper":"second"}' }).advisorHelper.name, 'Second')
})

test('a helper that asks with the app\'s question form gets its card under Needs your attention, from your partner', () => {
  const state = build({
    second: [typed(NOW - 12 * MIN, 'Refine B12'), step(NOW - MIN, 'Ask about the lamps')],
    plan: { text: 'Refine B12', step: 2, steps: 3, left: 20 * MIN },
  })
  assert.equal(state.forYou.some(need => need.from === 'Second'), false)
  const form = assistant(NOW - 9 * MIN, 'tool_use', [text('One choice.'), tool('AskUserQuestion', {
    questions: [{ question: 'Thin or thick lamps?', header: 'Lamps', options: [{ label: 'Thin', description: '' }, { label: 'Thick', description: '' }], multiSelect: false }],
  })])
  const asking = build({ second: [typed(NOW - 20 * MIN, 'Refine B12'), form] })
  assert.equal(asking.advisorHelper.state, 'waiting')
  assert.equal(asking.advisorHelper.asksYou, true)
  const card = asking.forYou.find(need => need.from === 'Second')
  assert.equal(card?.title, 'Asked you a question in its chat')
  assert.equal(card.isPartner, true)
})

test('without "helper" in the list, or without its chat, there is no helper card and the chat stays a worker', () => {
  const plain = build({ list: '{"prefix":"Garden · ","main":"Lead"}' })
  assert.equal(plain.advisorHelper, null)
  assert.deepEqual(plain.chats.map(lane => lane.name), ['Lead', 'Digger', 'Second'])
  assert.equal(build({ chats: ['Lead', 'Digger', 'Advisor'] }).advisorHelper, null)
  // The main chat or the Advisor named as the helper stay what they are.
  assert.equal(build({ list: '{"prefix":"Garden · ","main":"Lead","helper":"Advisor"}' }).advisorHelper, null)
  assert.equal(build({ list: '{"prefix":"Garden · ","main":"Lead","helper":"Lead"}' }).advisorHelper, null)
})

test('the board\'s words reach the helper as they reach the Advisor: the mod takes for it, and an answer may go to it', () => {
  const board = { chats: [{ name: 'Digger', session: 's-digger' }], advisor: { name: 'Advisor', session: 's-advisor' }, advisorHelper: { name: 'Second', session: 's-second' } }
  assert.deepEqual(checkTake({ chat: 'Second', session: 's-second' }, board), { ok: true, chat: 'Second' })
  assert.equal(checkTake({ chat: 'Second', session: 's-other' }, board).status, 409)
  assert.equal(checkSay({ to: 'Second', text: 'thick' }, board, 4000).ok, true)
  assert.equal(checkSay({ to: 'Nobody', text: 'thick' }, board, 4000).ok, false)
})

// The work tool, as the server gives it the roles: the helper is 'helper'.
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', '- [ ] B2 A new idea', ''].join('\n')
const ROLES = { Keeper: 'main', Lamplighter: 'worker', Partner: 'advisor', Second: 'helper' }
const STAMP = new Date(2026, 9, 19, 9, 0).getTime()

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'work-helper-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: STAMP }), undefined, { now: STAMP })
  const ctx = { dir, now: STAMP + MIN, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter']), chats: Object.keys(ROLES) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, keeper: as('Keeper'), lamplighter: as('Lamplighter'), partner: as('Partner'), second: as('Second'), server: body => workApi(body, { ...ctx, as: 'server' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('the work tool takes the helper\'s refine and refined as the partner\'s own, with its name on the lines', async () => {
  const store = await fresh()
  try {
    const drafted = await store.second({ action: 'refine', id: 'B2', summary: 'One lamp per bench.', size: '1 h' })
    assert.equal(drafted.ok, true, drafted.why)
    const ready = await store.second({ action: 'refined', id: 'B2', what: ['a lamp at every bench', 'Not in it: new paths'] })
    assert.equal(ready.ok, true, ready.why)
    const two = await item(store.dir, 'B2')
    assert.deepEqual(['State', 'Refined'].map(key => valueOf(two, key)), ['refined', 'ready'])
    assert.match(two.sections.get('Refined')[0], /^ {2}Refined \(round 1, by Second, .*; ready\):$/)
    assert.ok(two.sections.get('History').some(one => /Second: refined, round 1$/.test(one)), two.sections.get('History').join('\n'))
    // In all else the helper is a worker: no partner's answer, no draft of the focus, no step of its own made for it.
    assert.equal((await store.second({ action: 'partner-answer', id: 'Q1', text: 'x', why: 'y' })).status, 403)
    assert.equal((await store.second({ action: 'how-draft', goal: 'G1', parts: ['x · about 1 h'] })).status, 403)
    assert.equal((await store.second({ action: 'next' })).ok, true)
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the helper files a result check as the partner would', async () => {
  const store = await fresh()
  try {
    const made = await store.partner({ action: 'new', title: 'Light the lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light.', summary: 'A warm lamp on every path.', size: '1 h', what: ['a lamp at every bench'] })
    const id = made.result.id
    assert.equal((await store.keeper({ action: 'queue', id, for: 'Lamplighter', about: '1 h' })).ok, true)
    assert.equal((await store.lamplighter({ action: 'take', id, branch: 'b3-lamps' })).ok, true)
    assert.equal((await store.lamplighter({ action: 'report', id, result: 'Every bench has a lamp.', merged: 'c0ffee1' })).ok, true)
    assert.equal((await store.server({ action: 'check', id, passed: true, lines: ['branch gone'] })).ok, true)
    const checked = await store.second({ action: 'checked', id, evidence: 'pictures/b3/evidence.png', points: ['pass: a lamp at every bench'] })
    assert.equal(checked.ok, true, checked.why)
    const three = await item(store.dir, id)
    assert.equal(valueOf(three, 'State'), 'done')
    assert.ok(three.sections.get('History').some(one => one.includes('Second:')), three.sections.get('History').join('\n'))
    // A point only the person can judge: the helper asks it under the worker's step, as the partner's job says.
    const asked = await store.second({ action: 'ask', of: 'B1', kind: 'look', text: 'Is the wick short enough?' })
    assert.equal(asked.ok, true, asked.why)
    // A goal stays the partner's: no re-check, no daily note, no ask of a goal by the helper.
    assert.equal((await store.second({ action: 'checked', id: 'G3', evidence: 'none (x)', points: ['pass: x'] })).status, 403)
    assert.equal((await store.second({ action: 'ask', of: 'G3', kind: 'decide', text: 'x' })).status, 403)
    assert.equal((await store.second({ action: 'note', to: 'you', of: 'G3', decided: ['x'] })).status, 403)
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('no step is queued or requeued for the helper', async () => {
  const store = await fresh()
  try {
    const queued = await store.keeper({ action: 'queue', id: 'B2', for: 'Second', about: '1 h' })
    assert.equal(queued.status, 409)
    assert.equal(queued.why, 'Second is the partner\'s helper: no step is queued for it. The partner hands it the next refine or result check; queue the step for a worker.')
    const moved = await store.keeper({ action: 'requeue', id: 'B1', for: 'Second' })
    assert.equal(moved.status, 409)
    assert.equal(valueOf(await item(store.dir, 'B1'), 'Owner'), 'Lamplighter')
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')

test('the Overview draws the helper\'s card right under the Advisor\'s, set apart, with no queue, no worker buttons and nothing to open', () => {
  const part = script.slice(script.indexOf('function drawAdvisorLane'), script.indexOf('function drawLanes'))
  assert.ok(part.includes('const helper = drawHelperCard(state)'))
  assert.ok(part.includes('part.append(label, card, ...(helper === null ? [] : [helper]))'))
  // A helper without an Advisor on the board still shows, under the Advisor's label.
  assert.ok(part.includes('if (advisor === null && helper === null) return null'))
  const from = script.indexOf('function drawHelperCard')
  const card = script.slice(from, script.indexOf('\n}\n', from))
  for (const words of ["el('article', 'lane is-advisor is-helper')", 'const standing = advisorStanding(helper)', "el('h3', '', helper.name)", 'taskTitle(lane)', 'drawEta(lane, state.readAt)', 'advisorProgress(lane.task)', 'refines and result checks']) {
    assert.ok(card.includes(words), words)
  }
  for (const worker of ['openAdvisor', 'data-open', 'data-remove', 'dataset.remove', 'queue-item', 'data-lane', 'dataset.lane', 'stopPart', 'tabIndex']) assert.ok(!card.includes(worker), `no ${worker}`)
  assert.match(style, /\.workers-panel \.lane\.is-advisor\.is-helper \{[^}]*cursor: default/)
  assert.match(style, /\.lane\.is-helper \.who \{ padding-left: 14px; \}/)
})

test('the Simple view lists the partner and its helper under the workers, apart and not counted among them', () => {
  const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
  const page = {}
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\n${cut('calmoverview')}\n${cut('focus')}\n${cut('runchip')}\n${cut('simpleoverview')}\nObject.assign(this, { simpleWorkers })`, page)
  const AT = new Date(2026, 9, 19, 16, 0).getTime()
  const lane = (name, state, more = {}) => ({ name, state, isMain: false, isLeftover: false, task: null, eta: null, ...more })
  const second = lane('Second', 'working', { task: { text: 'Refine B12', step: 2, steps: 4, startedAt: AT - 10 * MIN }, eta: { at: AT + 20 * MIN, leftMs: 20 * MIN, isOverdue: false, isOwn: true } })
  const view = JSON.parse(JSON.stringify(page.simpleWorkers([lane('Digger', 'free')], { working: 0, free: 1 }, AT, [lane('Advisor', 'free'), second])))
  assert.equal(view.busy, '0 of 1 busy')
  assert.deepEqual(view.rows.map(row => row.name), ['Digger'])
  assert.deepEqual(view.partner, [
    { name: 'Advisor', code: null, task: null, percent: null, left: 'free', tone: 'free' },
    { name: 'Second', code: null, task: 'Refine B12', percent: 50, left: '20 min', tone: 'working' },
  ])
  // Without a partner or a helper on the board there is no such group; a page that passes none has none.
  assert.deepEqual(JSON.parse(JSON.stringify(page.simpleWorkers([], {}, AT, [null, undefined]))).partner, [])
  assert.deepEqual(JSON.parse(JSON.stringify(page.simpleWorkers([], {}, AT))).partner, [])
  assert.ok(script.includes('simpleWorkers(state.chats ?? [], state.counts ?? {}, state.readAt, [state.advisor, state.advisorHelper])'))
  assert.ok(script.includes("[el('h3', 'simple-sub-head', 'Advisor'), ...workers.partner.map(rowOf)]"))
  assert.match(style, /\.simple-sub-head \{/)
})

test('the server gives the helper its role, its words and its place in a pause, as it does the Advisor', () => {
  assert.ok(server.includes("if (state.advisorHelper) roles.set(state.advisorHelper.name, 'helper')"))
  assert.ok(server.includes('lanes: [...lanes, ...(state.advisor ? [state.advisor] : []), ...(state.advisorHelper ? [state.advisorHelper] : [])],'))
  // The supervisor (2026-10-24): the chats the board shows by name are one list in bridge.mjs (`shownChats`), the helper in it.
  assert.ok(server.includes('shownChats(state).some(chat => chat.name === wake.to)'))
  assert.equal(shownChats({ chats: [], advisorHelper: { name: 'Second' } })[0].name, 'Second')
})
