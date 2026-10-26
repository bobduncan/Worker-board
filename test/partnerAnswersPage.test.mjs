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
Object.assign(this, { partnerSwitchView, focusNoteView, partnerAnswerView, withPartnerView, decidedView, laneStateText })`, made)
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

test('the daily note: a partner\'s answer of an ask has its Undo, then "taken back" by its field; other lines keep "undo asked"', () => {
  const focus = { note: { id: 'N4', decided: [
    { text: 'Q1 (Digger, B1): Number or bar? → A number (your advice)', undoAsked: false, ask: 'Q1', takenBack: false },
    { text: 'Q2 (Digger, B1): Yellow? → A (your advice)', undoAsked: true, ask: 'Q2', takenBack: true },
    { text: 'Kept the icons', undoAsked: true },
    // The review's findings: a line that only looks like an answer is the partner's own line.
    { text: 'Q9 (old notes): kept the icons', undoAsked: false },
  ] }, needs: [] }
  const view = plain(made.focusNoteView(focus, true, null))
  assert.deepEqual(view.decided.map(one => [one.undo.label, one.undo.isEnabled, one.ask ?? null]), [['Undo', true, 'Q1'], ['taken back', false, 'Q2'], ['undo asked', false, null], ['Undo', true, null]])
  assert.match(view.decided[0].undo.title, /Take back your partner's answer: the question comes to you/)
  assert.equal(view.decided[3].undo.title, 'Ask your partner to undo this')
  // The line after a take-back says so, by the line's field (the review's findings), not "Your partner is asked to undo it".
  assert.match(script, /undo\.dataset\.focusAsk = one\.ask/)
  assert.match(script, /extra\.ask \? 'Taken back: /)
})

test('the review\'s findings: "With your partner" (count, a click lists them), "Decided for you" with Undo, the lane waiting for the partner', () => {
  assert.equal(made.withPartnerView([]), null)
  assert.deepEqual(plain(made.withPartnerView([{ id: 'Q1', from: 'Digger', title: 'Number or bar?' }, { id: 'Q2', from: 'Lead', title: 'Icons?' }])), {
    // The person, 2026-10-26: each row is a link that opens its ask ("i just need it clickable").
    text: 'With your partner: 2 questions', rows: [
      { id: 'Q1', href: '#details=Q1', text: 'Q1 · Digger: Number or bar?' },
      { id: 'Q2', href: '#details=Q2', text: 'Q2 · Lead: Icons?' },
    ],
  })
  const drawn = script.slice(script.indexOf('function drawWithPartner(state)'), script.indexOf('function drawDecidedForYou(state)'))
  assert.match(drawn, /el\('a', 'with-partner-ask', row\.text\)/)
  assert.match(drawn, /link\.href = row\.href/)
  assert.equal(plain(made.withPartnerView([{ id: 'Q1', from: 'Digger', title: 'Number or bar?' }])).text, 'With your partner: 1 question')
  assert.equal(made.decidedView([]), null)
  const decided = plain(made.decidedView([{ ask: 'Q5', line: 'Q5 (Digger, B12): Icons? → A (your advice)', at: 0 }]))
  assert.equal(decided.title, 'Decided for you by your partner')
  assert.deepEqual(decided.rows, [{ ask: 'Q5', text: 'Q5 (Digger, B12): Icons? → A (your advice)', undo: { id: 'Q5', label: 'Undo', title: 'Take back your partner\'s answer: the question comes to you, and its chat waits for your answer' } }])
  const STATES = { working: 'Working', waiting: 'Waiting for you' }
  assert.equal(made.laneStateText({ state: 'working', waitsForPartner: ['Q1'] }, STATES), 'Waiting for your partner (Q1)')
  assert.equal(made.laneStateText({ state: 'waiting', waitsForPartner: null }, STATES), 'Waiting for you')
  const draw = script.slice(script.indexOf('function drawNeeds(state)'), script.indexOf('/** Who runs and who was asked'))
  assert.match(draw, /drawWithPartner\(state\)/)
  assert.match(draw, /drawDecidedForYou\(state\)/)
  // B392: in a colour of its own.
  assert.match(script, /el\('span', `pill is-\$\{\(lane\.waitsForPartner \?\? \[\]\)\.length > 0 && !lane\.isLeftover \? 'partner' : lane\.state\}`, lane\.isLeftover \? 'Leftover' : laneStateText\(lane\)\)/)
  assert.match(script, /if \(\(lane\.waitsForPartner \?\? \[\]\)\.length > 0\) return `waits for your partner/)
})

test('the ask\'s card: the partner\'s answer with its why and Undo; the line of an ask handed on or taken back', () => {
  const answered = plain(made.partnerAnswerView({ workId: 'Q1', answer: { by: 'partner', text: 'A number', why: 'your advice', at: 0 }, canTakeBack: true, routeNote: null }))
  assert.deepEqual(answered, { text: 'Your partner answered: A number', why: 'Why: your advice', undo: { id: 'Q1', label: 'Undo', title: 'Take back your partner\'s answer: the question comes to you, and its chat waits for your answer' } })
  const handed = plain(made.partnerAnswerView({ workId: 'Q2', answer: null, routeNote: 'Your partner hands this to you: it is about money', canTakeBack: false }))
  assert.deepEqual(handed, { text: 'Your partner hands this to you: it is about money', why: null, undo: null })
  assert.equal(made.partnerAnswerView({ workId: 'Q3', answer: null, routeNote: null }), null)
  // The card draws it, and its Undo goes the way of the note's Undo (the server's undoNow).
  assert.match(script, /partnerAnswerParts\(need\)/)
  // B408: through the page's click table, wherever the button is drawn (test/redrawKeys.test.mjs clicks it).
  assert.match(script, /'take-back': button => sendWork\(\{ action: 'undo', id: button\.dataset\.takeBack \}/)
})

test('the server: the work tool\'s answer wakes the asking chat as the page\'s does; an Undo of a partner\'s answer tells the asking chat', () => {
  // B412: a chat's work call is made once, in bridgeWorkOnce.
  const bridge = server.slice(server.indexOf('const bridgeWorkOnce = async'), server.indexOf('const server = createBoard({'))
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

function build(items, partnerAnswers, goalsText = undefined, more = {}) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  if (partnerAnswers !== undefined) work.partnerAnswers = partnerAnswers
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, ...(goalsText === undefined ? {} : { goalsText }), ...more,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the state: a routed ask is not under Needs your attention; the partner is woken for it; the switch as the store keeps it', () => {
  const state = build([ask('Q1', 'partner', NOW - 20 * MIN), ask('Q2', 'person', NOW - 40 * MIN), ask('Q3', null, NOW - 40 * MIN)])
  assert.deepEqual(state.forYou.filter(one => one.workId !== undefined).map(one => one.workId).sort(), ['Q2', 'Q3'])
  assert.deepEqual(state.reconciled.partnerAsks.map(one => [one.id, one.chat]), [['Q1', 'Advisor']])
  // Filed 20 minutes ago: not handed on yet; 40 minutes ago: handed on (the review's findings: from its filing).
  assert.deepEqual(state.reconciled.escalations, [])
  assert.deepEqual(build([ask('Q1', 'partner', NOW - 40 * MIN)]).reconciled.escalations, [{ id: 'Q1', why: 'the partner did not answer in 30 min' }])
  assert.deepEqual(state.partnerAnswers, { on: true })
  assert.deepEqual(build([], { on: false, since: NOW }).partnerAnswers, { on: false, since: NOW })
})

const DAY = 24 * 60 * MIN
const parsed = text => parseItem(text.replace(/^ +/gm, ''))
const answered = (id, note, line, at) => parsed(`Id: ${id}\nKind: ask\nTitle: Icons?\nState: answered\nOwner: Digger\nSince: ${sinceOf(at)}\nFiled: ${at - MIN}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A icons | B words\nAdvice: A\nRoute: partner\nAnswered by: partner\nDaily note: ${note}\n\n## Answer\nA\n\n## Why\nyour advice\n\n## Note line\n${line}\n`)
const L1 = 'Q5 (Digger, B12): Icons? → A (your advice)'
const L2 = 'Q6 (Digger, B12): Icons? → A (your advice)'
const L3 = 'Q8 (Digger, B12): Icons? → A (your advice)'
const L4 = 'Q7 (Digger, B12): Icons? → A (your advice)'
const note = (id, at, decided, undone = []) => parsed([`Id: ${id}`, 'Kind: note', 'From: Advisor', 'To: you', 'Of: G6', 'State: unread', `Since: ${sinceOf(at)}`, 'Text: the note', '',
  '## Decided for you', ...decided.map(one => `- ${one}`), '', '## Needs you', '', ...(undone.length === 0 ? [] : ['## Undo asked', ...undone.map(one => `- ${one} (2026-10-19 09:30)`), '']), '## History', `- ${sinceOf(at)} Advisor: noted (the daily note)`, ''].join('\n'))
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')

test('the review\'s findings, the state: the lane waits for the partner; "With your partner"; the note\'s lines by their asks; 7 days of Undo', () => {
  const waiting = parsed(`Id: B12\nKind: step\nTitle: Plant the hedge\nState: waiting on you\nOwner: Digger\nSince: ${sinceOf(NOW - 30 * MIN)}\n`)
  const routed = parsed(`Id: Q1\nKind: ask\nTitle: Box or yew?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 20 * MIN)}\nFiled: ${NOW - 20 * MIN}\nAsks: decide\nBlocking: yes\nOf: B12\nOptions: A box | B yew\nAdvice: B\nRoute: partner\n`)
  const takenBack = parsed(`Id: Q8\nKind: ask\nTitle: Icons?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 10 * MIN)}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: person\nDaily note: N2\n\n## Route\nYour partner had answered: A; you took it back\n\n## Note line\n${L3}\n`)
  const state = build([
    waiting, routed, takenBack,
    answered('Q5', 'N1', L1, NOW - 2 * DAY), answered('Q6', 'N2', L2, NOW - 30 * MIN), answered('Q7', 'N0', L4, NOW - 8 * DAY),
    note('N1', NOW - 2 * DAY, [L1]), note('N2', NOW - 60 * MIN, [L2, 'Kept the icons', L3], [L3]),
  ], undefined, GOALS)
  const digger = state.chats.find(one => one.name === 'Digger')
  assert.deepEqual([digger.state, digger.waitsForPartner], ['working', ['Q1']])
  assert.match(digger.between, /waits for your partner's answer \(Q1\)/)
  // A chat that does not run (the app started after its last word) says "Not running", not that it waits for the partner.
  const gone = build([waiting, routed], undefined, undefined, { appStartedAt: NOW + 1 }).chats.find(one => one.name === 'Digger')
  assert.deepEqual([gone.state, gone.waitsForPartner], ['off', null])
  assert.deepEqual(state.withPartner.map(one => [one.id, one.from, one.title]), [['Q1', 'Digger', 'Box or yew?']])
  // Today's note: every line, the answers by their asks (a field), one taken back.
  assert.deepEqual(state.focus.note.decided, [
    { text: L2, undoAsked: false, ask: 'Q6', takenBack: false },
    { text: 'Kept the icons', undoAsked: false },
    { text: L3, undoAsked: true, ask: 'Q8', takenBack: true },
  ])
  // An answer not on that note keeps its Undo under Needs your attention for 7 days.
  assert.deepEqual(state.partnerDecided.map(one => [one.ask, one.line]), [['Q5', L1]])
  // Without a focus every answer of the last 7 days is there.
  assert.deepEqual(build([answered('Q5', 'N1', L1, NOW - 2 * DAY), answered('Q6', 'N2', L2, NOW - 30 * MIN)]).partnerDecided.map(one => one.ask), ['Q6', 'Q5'])
})
