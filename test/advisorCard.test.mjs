// B280: the Advisor on the Overview, set apart from the workers: how it stands, what it works on and what waits for it,
// and in the Advisor tab what it works on right above the typing box. The person, 2026-10-17: "i want to see what you
// are doing in the worker board so I dont stop your current task ... show the advisor in the workers tab on the
// overview but distinct from the workers". Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem, serializeItem, valueOf } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 10, 0)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }

const app = name => JSON.stringify({
  title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { isReported: false, ...task }, at: NOW - 10 * MIN })

function build({ advisor, plan = null, outbox = [], work }) {
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: plan === null ? {} : { 'cli-Advisor': planLine(plan) },
    backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {}, ...(work === undefined ? {} : { work }),
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}
const sent = (id, extra) => ({ id, at: NOW - MIN, to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, text: 'x', state: 'waiting', ...extra })

test('the Advisor carries what its card shows: its task as its own card names it, its time, and that it works', () => {
  const state = build({
    advisor: [typed(NOW - 12 * MIN, 'Plan the pond'), step(NOW - MIN, 'Read the backlog')],
    plan: { text: 'Plan the pond', step: 2, steps: 3, names: ['Read', 'Map', 'Write'], left: 20 * MIN, stepLeft: 5 * MIN },
  })
  assert.equal(state.advisor.state, 'working')
  assert.equal(state.advisor.task.text, 'Plan the pond')
  assert.deepEqual([state.advisor.task.step, state.advisor.task.steps], [2, 3])
  assert.notEqual(state.advisor.eta, null)
  assert.equal(state.advisor.doingNow, 'Read the backlog')
  assert.equal(state.advisor.asksYou, false)
  // It is still no worker: no lane, no queue.
  assert.ok(!state.chats.some(lane => lane.name === 'Advisor'))
})

test('what waits for it is counted by kind, only while it is not in its chat yet', () => {
  const state = build({
    advisor: [typed(NOW - 12 * MIN, 'Plan the pond'), step(NOW - MIN, 'Read')],
    outbox: [
      sent('r1', { command: 'refine', about: 'B12' }),
      sent('c1', { command: 'round', state: 'taken' }),
      sent('m1', {}),
      sent('a1', { ask: 'chat:Advisor:1', state: 'taken' }),
      sent('old', { state: 'delivered' }),
      sent('lost', { state: 'expired' }),
      { ...sent('lead', {}), to: 'Lead' },
    ],
  })
  assert.deepEqual(state.advisor.queued, { refines: 1, rounds: 1, words: 2 })
  // A message taken long ago and never settled waits no more; a round asked for by the person is a round.
  const later = build({
    advisor: [typed(NOW - 12 * MIN, 'Plan the pond'), step(NOW - MIN, 'Read')],
    outbox: [sent('stuck', { state: 'taken', at: NOW - 40 * MIN, takenAt: NOW - 30 * MIN }), sent('again', { command: 'recheck' })],
  })
  assert.deepEqual(later.advisor.queued, { refines: 0, rounds: 1, words: 0 })
})

test('an Advisor with an open ask in the work store says so on its card; a refine question is its refine state', () => {
  const ask = (id, more) => parseItem([`Id: ${id}`, 'Kind: ask', 'Title: Pond first?', `State: ${more.state ?? 'open'}`, 'Owner: Advisor',
    'Asks: decide', 'Blocking: no', 'Since: 2026-10-17 09:50', ...(more.via === undefined ? [] : [`Via: ${more.via}`]), '', '## Text', 'Pond first?', ''].join('\n'))
  const storeWith = items => {
    const work = storeFromText('', { now: NOW })
    for (const item of items) work.items.set(valueOf(item, 'Id'), item)
    return work
  }
  const turn = [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, 'I asked on the board.')]
  assert.equal(build({ advisor: turn, work: storeWith([ask('Q1', {})]) }).advisor.asksYou, true)
  const prefixed = parseItem(serializeItem(ask('Q2', {})).replace('Owner: Advisor', 'Owner: Garden · Advisor'))
  assert.equal(build({ advisor: turn, work: storeWith([prefixed]) }).advisor.asksYou, true, 'an owner with the prefix is the same chat')
  assert.equal(build({ advisor: turn, work: storeWith([ask('Q1', { via: 'refine' })]) }).advisor.asksYou, false)
  assert.equal(build({ advisor: turn, work: storeWith([ask('Q1', { state: 'answered' })]) }).advisor.asksYou, false)
  // The board reads no questions from its chat's words.
  const asking = ['> **For you**', '> 1. **Answer:** Pond first? I advise yes.'].join('\n')
  assert.equal(build({ advisor: [typed(NOW - 20 * MIN, 'What first?'), answer(NOW - 12 * MIN, asking)], work: storeWith([]) }).advisor.asksYou, false)
})

// The page's parts, cut out of board.js between their marks

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('advisorlane')}\nObject.assign(this, { advisorStanding, advisorQueued })`, page)

test('its card says how it stands: working, needs your answer, idle, or not running', () => {
  const at = advisor => page.advisorStanding({ isRunning: true, state: 'free', asksYou: false, ...advisor }).label
  assert.equal(at({ state: 'working' }), 'Working')
  assert.equal(at({ asksYou: true }), 'Needs your answer')
  assert.equal(at({}), 'Idle')
  assert.equal(at({ isRunning: false, state: 'working' }), 'Not running')
  assert.equal(at({ state: 'interrupted' }), 'Cut off')
  // A server without the card's fields: an Advisor that waits (its question form) still needs your answer.
  assert.equal(page.advisorStanding({ isRunning: true, state: 'waiting' }).label, 'Needs your answer')
  assert.equal(page.advisorStanding({ isRunning: true, state: 'waiting', asksYou: false }).label, 'Idle')
})

test('the card keeps the keyboard focus over a redraw, says its standing in its pill only, and shows no count it does not have', () => {
  const card = script.slice(script.indexOf('function drawAdvisorLane'), script.indexOf('function drawLanes'))
  // B307: the time column says its time while it works, nothing else; its pill says how it stands.
  assert.ok(!card.includes("el('span', 'state', standing.label)"))
  assert.ok(card.includes("el('span', `pill is-${standing.key}`, standing.label)"))
  // Nothing waiting, or a server without the count: the column stays empty.
  assert.ok(card.includes('if (queued !== null)'))
  assert.ok(!card.includes("'Nothing waits for it'"))
  const lanes = script.slice(script.indexOf('function drawLanes'), script.indexOf('function drawLanes') + 1200)
  assert.ok(lanes.includes("const wasOnAdvisor = document.activeElement?.dataset?.openAdvisor !== undefined"))
  assert.ok(lanes.includes("$('lanes').querySelector('[data-open-advisor]')?.focus()"))
  // The line over the typing box is written anew only when its words change, so a reader does not hear it again.
  assert.ok(script.includes('if (busy.dataset.words !== words)'))
  // Its own looks stay on its card.
  assert.match(style, /\.lane\.is-advisor \.worker-icon\.is-off/)
  assert.match(style, /\.lane\.is-advisor \.pill\.is-off/)
})

test('what waits for it, as a count and its kinds; nothing says nothing', () => {
  assert.deepEqual({ ...page.advisorQueued({ refines: 1, rounds: 0, words: 2 }) }, { count: 3, text: '1 refine, 2 messages' })
  assert.deepEqual({ ...page.advisorQueued({ refines: 0, rounds: 2, words: 0 }) }, { count: 2, text: '2 rounds of the clock' })
  assert.equal(page.advisorQueued({ refines: 0, rounds: 0, words: 0 }), null)
  assert.equal(page.advisorQueued(undefined), null)
})

test('the card stands under the workers, set apart, with no queue or worker buttons, and opens its chat on the Advisor tab', () => {
  assert.match(script, /fill\(\$\('lanes'\), \[\.\.\.state\.chats\.map\(lane => drawLane\(lane, state\)\), drawOpenChats\(state\), drawWorkers\(state\), drawAdvisorLane\(state\)\]/)
  const card = script.slice(script.indexOf('function drawAdvisorLane'), script.indexOf('function drawLanes'))
  for (const words of ["el('article', 'lane is-advisor')", "card.dataset.openAdvisor = ''", "el('b', '', 'Advisor')", 'takes no tasks', "icon('advisor')", '`${queued.count} waiting for it`', "show('advice')", "showAdvisorPane('chat')"]) {
    assert.ok(card.includes(words), words)
  }
  for (const worker of ['data-remove', 'dataset.remove', 'queue-item', 'lane-menu\'', 'stopPart', 'data-lane', 'dataset.lane']) assert.ok(!card.includes(worker), `no ${worker}`)
  // A worker's own clicks never take it for a worker: it has none of their state classes.
  assert.ok(!/el\('article', `lane is-\$\{/.test(card))
  // Set apart: its own line, label and accent; on a phone the lanes' own narrow layout holds it.
  assert.match(style, /\.advisor-part \{[^}]*border-top: 2px solid/)
  assert.match(style, /\.workers-panel \.lane\.is-advisor \{[^}]*box-shadow: inset 3px 0 0 var\(--advisor\)/)
  assert.match(style, /\.lane\.is-advisor:focus-visible/)
})

test('B287: the card says what it refines, as the Advisor tab does', () => {
  const card = script.slice(script.indexOf('function drawAdvisorLane'), script.indexOf('function drawLanes'))
  assert.ok(card.includes('const refine = advisorRefine(state.backlog)'))
  assert.ok(card.includes("el('span', `advisor-refine-state is-${refine.tone}`, refine.text)"))
  assert.match(style, /\.advisor-lane-refine \{/)
})

test('while it works, the Advisor tab says on what, right above the typing box, and that what you type waits', () => {
  assert.match(html, /<div class="messages" id="messages"><\/div>\n\s+<p class="talk-busy" id="talk-busy" role="status" hidden><\/p>\n\s+<form class="say" id="say">/)
  assert.ok(script.includes("busy.hidden = advisor?.state !== 'working'"))
  assert.ok(script.includes('const words = `Working: ${topic}`'))
  assert.ok(script.includes("el('b', '', words), el('span', '', 'What you type waits until it is done.')"))
})
