// Partner answers (the person, 2026-10-19), what the board shows: the switch on the Focus page, the routed ask kept
// out of Needs your attention, the partner's answer with its Undo on the ask's closed card and in the daily note, the
// line of an ask handed on or taken back; and the server's part: the asking chat woken from the work tool too, an Undo
// of a partner's answer told to the asking chat, not typed to the partner. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
const cut = (from, to) => script.slice(script.indexOf(from), script.indexOf(to))
const made = {}
vm.runInNewContext(`${cut('// focus:start', '// focus:end')}\n${cut('// partner-answers:start', '// partner-answers:end')}
Object.assign(this, { partnerSwitchView, focusNoteView, partnerAnswerView })`, made)
const plain = value => JSON.parse(JSON.stringify(value))

test('the Focus page\'s switch: "Your partner answers detail questions", on or off as the store keeps it', () => {
  assert.equal(made.partnerSwitchView(null), null, 'no store: no switch')
  const on = plain(made.partnerSwitchView({ on: true }))
  assert.deepEqual([on.label, on.on, on.isEnabled], ['Your partner answers detail questions', true, true])
  assert.match(on.title, /questions only you can answer still come to you/)
  const off = plain(made.partnerSwitchView({ on: false }))
  assert.equal(off.on, false)
  assert.match(off.title, /every question comes to you/)
  // Drawn on top of the Focus page, sent as the person's change of the store.
  const draw = script.slice(script.indexOf('function drawFocus(state)'), script.indexOf('/** Focus 2: one move of the page'))
  assert.match(draw, /partnerSwitch\(state\)/)
  assert.match(script, /action: 'partner-answers', on: /)
})

test('the daily note: a partner\'s answer of an ask has its Undo, then "taken back"; other lines keep "undo asked"', () => {
  const focus = { note: { id: 'N4', decided: [{ text: 'Q1 (Digger, B1): Number or bar? → A number (your advice)', undoAsked: false, ask: 'Q1' }, { text: 'Q2 (Digger, B1): Yellow? → A (your advice)', undoAsked: true, ask: 'Q2' }, { text: 'Kept the icons', undoAsked: true, ask: null }] }, needs: [] }
  const view = plain(made.focusNoteView(focus, true, null))
  assert.deepEqual(view.decided.map(one => [one.undo.label, one.undo.isEnabled]), [['Undo', true], ['taken back', false], ['undo asked', false]])
  assert.match(view.decided[0].undo.title, /Take back your partner's answer: the question comes to you/)
})

test('the ask\'s card: the partner\'s answer with its why and Undo; the line of an ask handed on or taken back', () => {
  const answered = plain(made.partnerAnswerView({ workId: 'Q1', answer: { by: 'partner', text: 'A number', why: 'your advice', at: 0 }, canTakeBack: true, routeNote: null }))
  assert.deepEqual(answered, { text: 'Your partner answered: A number', why: 'Why: your advice', undo: { id: 'Q1', label: 'Undo', title: 'Take back your partner\'s answer: the question comes to you, and its chat waits for your answer' } })
  const handed = plain(made.partnerAnswerView({ workId: 'Q2', answer: null, routeNote: 'Your partner hands this to you: it is about money', canTakeBack: false }))
  assert.deepEqual(handed, { text: 'Your partner hands this to you: it is about money', why: null, undo: null })
  assert.equal(made.partnerAnswerView({ workId: 'Q3', answer: null, routeNote: null }), null)
  // The card draws it, and its Undo goes the way of the note's Undo (the server's undoNow).
  assert.match(script, /partnerAnswerParts\(need\)/)
  assert.match(script, /closest\('\[data-take-back\]'\)/)
  assert.match(script, /action: 'undo', id: takeBack\.dataset\.takeBack/)
})

test('the server: the work tool\'s answer wakes the asking chat as the page\'s does; an Undo of a partner\'s answer tells the asking chat', () => {
  const bridge = server.slice(server.indexOf('bridgeWork: async body => {'), server.indexOf('take: async body => {'))
  assert.match(bridge, /await sendWakes\(done/)
  const page = server.slice(server.indexOf('work: async body => {'), server.indexOf('bridgeWork: async body => {'))
  assert.match(page, /await sendWakes\(done/)
  const undo = server.slice(server.indexOf('const undoNow = async body => {'), server.indexOf('/** What the API goes by'))
  assert.match(undo, /tell: wake => sendWakes\(/)
  // The partner's own ask is answered in its chat; the board's work context knows the focus goal for the note.
  assert.match(server, /focusGoal: state\.focus\?\.id \?\? null/)
})

// ---- the state ----

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 19, 10, 0)
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\garden', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const sinceOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const ask = (id, route, at) => parseItem(`Id: ${id}\nKind: ask\nTitle: Number or bar?\nState: open\nOwner: Digger\nSince: ${sinceOf(at)}\nFiled: ${at}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A number | B bar\nAdvice: A\n${route === null ? '' : `Route: ${route}\n`}`)

function build(items, partnerAnswers) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  if (partnerAnswers !== undefined) work.partnerAnswers = partnerAnswers
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the state: a routed ask is not under Needs your attention; the partner is woken for it; the switch as the store keeps it', () => {
  const state = build([ask('Q1', 'partner', NOW - 40 * MIN), ask('Q2', 'person', NOW - 40 * MIN), ask('Q3', null, NOW - 40 * MIN)])
  assert.deepEqual(state.forYou.filter(one => one.workId !== undefined).map(one => one.workId).sort(), ['Q2', 'Q3'])
  assert.deepEqual(state.reconciled.partnerAsks.map(one => [one.id, one.chat]), [['Q1', 'Advisor']])
  // Free for 12 minutes only: not handed on yet.
  assert.deepEqual(state.reconciled.escalations, [])
  assert.deepEqual(state.partnerAnswers, { on: true })
  assert.deepEqual(build([], { on: false, since: NOW }).partnerAnswers, { on: false, since: NOW })
})
