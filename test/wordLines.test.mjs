// Reactive board, brief P4b (the person, 2026-11-09: "i submit things but i see not enough loaders. or it tries to react directly to the
// CHAT instead of code just submitting an item in a queue and then waiting for the chat to pick it up"): every Focus and Goals click that
// sends a word gets P3's wait line where its button was, drawn from the records only (the outbox and the mod's turn report); the note or
// toast that said "Sent..." goes, and so does the page's own memory of "asked" (`focusUi.asked`). The server tracks the words
// (src/waitLine.mjs `FOCUS_COMMANDS`, place 'focus'); the page draws them (`wordLineOf`). Made-up garden chats; the real case replays real
// records of the board's own outbox, copied into a temp folder.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { fileStore } from '../src/store.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { FOCUS_COMMANDS, isPersonWord, placeOfWord, splitSeen, waitsOf } from '../src/waitLine.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, RUN_GOALS, app, asSent, build, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = minutesAgo => NOW - minutesAgo * MIN
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: NOW }).keep
const lane = (name, more = {}) => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null, ...more })
const said = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: null, ...more })

/** The server's `waits` for a state and an outbox (the judge as the server makes it). */
function waitsFor({ state, outbox, reports = null, now = NOW }) {
  const judge = wordJudge({ state, items: new Map(), outbox, settings: {}, now })
  return waitsOf({ state, outbox, now, keep, judge, reports, items: new Map() })
}
const sentWord = (command, more = {}) => ({ id: 'w1', to: 'Advisor', ask: null, step: null, text: `${command}: G6`, command, about: 'G6', at: at(3), state: 'waiting', ...more })
const taken = (command, more = {}) => sentWord(command, { state: 'delivered', takenAt: at(2), deliveredAt: at(2) + 1000, ...more })

// ---------------------------------------------------------------------------------------------------------------------
// The server: the commands are tracked

test('every word the Focus and Goals pages send is a person\'s word with a place of its own: Sent, then Picked up, then Done by P3\'s general rule', () => {
  assert.deepEqual(FOCUS_COMMANDS, ['focus', 'vibe-agreed', 'vibe-there-yes', 'vibe-there-no', 'goal-recheck', 'goal-demo', 'done-when', 'undo'])
  const advisor = lane('Advisor')
  const base = { chats: [], supervisorChat: null, advisor }
  for (const command of FOCUS_COMMANDS) {
    const word = sentWord(command)
    assert.equal(isPersonWord(word), true, `${command} is tracked`)
    assert.equal(placeOfWord(word), 'focus', `${command} has its place`)
    // Sent: in the outbox, not picked up.
    const sent = waitsFor({ state: base, outbox: [word] }).w1
    assert.deepEqual([sent.state, sent.lead, sent.rest, sent.place, sent.command, sent.goal], ['sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up · next in its queue', 'focus', command, 'G6'], command)
    // Picked up: after the mod's turn report names the word.
    const onIt = waitsFor({ state: { ...base, advisor: lane('Advisor', { status: 'Working', state: 'working' }) }, outbox: [taken(command)], reports: new Map([['Advisor', said('busy', at(2), { word: 'w1', turn: at(2) })]]) }).w1
    assert.deepEqual([onIt.state, onIt.lead, onIt.rest], ['picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`], command)
    // Done: the chat's turn on the word ended (no record of its own yet: P3's general rule).
    const done = waitsFor({ state: base, outbox: [taken(command)], reports: new Map([['Advisor', said('idle', at(1), { word: 'w1', turn: at(2) })]]) }).w1
    assert.deepEqual([done.state, done.lead], ['done', `Advisor answered ${hhmm(at(1))}`], command)
    // Late: its chat does not pick it up for long: the one Late of P3, never a guess.
    const late = waitsFor({ state: base, outbox: [sentWord(command, { at: at(40) })] }).w1
    assert.equal(late.state, 'late', command)
  }
})

test('no record, no line: a word that is not in the outbox, and the board\'s own words, give no line and no text', () => {
  const state = { chats: [], supervisorChat: null, advisor: lane('Advisor') }
  assert.deepEqual(waitsFor({ state, outbox: [] }), {})
  // Words that are no click of the person's: the partner's own commands stay without a line.
  for (const command of ['brainstorm-fix', 'judge', 'note-undo', 'part-drop', 'vibe-agree']) assert.deepEqual(Object.keys(waitsFor({ state, outbox: [sentWord(command)] })), [], command)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page: where the button was

const PICK_GOALS = ['Last id: G7', '', '- [ ] G1 A forest to walk', '    Done when: a player crosses the forest in five minutes', '- [ ] G7 A pond', ''].join('\n')
const VIBE_GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance', ''].join('\n')
// "Did we reach the goal?": every part is done (the work block's step B1 is done in the store of the made-up garden).
const line = (state, lead, rest, more = {}) => ({ state, lead, rest, at: at(3), chat: 'Advisor', canSendAgain: false, link: null, place: 'focus', command: 'done-when', about: 'G7', goal: 'G7', ask: null, sentAt: at(3), title: 'words', ...more })
const sentLine = (command, goal, more = {}) => line('sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up · next in its queue', { command, about: goal, goal, ...more })

test('Pick list: Ask your partner to write it sends ONE word and its line stands in the row; no note, no page memory; the line is still there after a reload', async () => {
  const base = asSent({ ...build([], undefined, PICK_GOALS), goalsEdit: { canWrite: true } })
  const page = await openPage({ state: base, answers: () => reply({ id: 'G7' }) })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.all('.focus-goals .wait-line').length, 0, 'no record: no line and no text')
    assert.doesNotMatch(page.text('.focus-goals'), /asked|Asked|writes its Done when/)
    assert.equal(page.all('.focus-note').length, 0)
  } finally { await page.close() }
  // The word is in the outbox now: its line stands in the row where the button was, and the button has gone.
  const withLine = { ...base, waits: { w1: sentLine('done-when', 'G7') } }
  const again = await openPage({ state: withLine })
  try {
    await again.click('[data-tab="advice"]')
    const row = again.all('.focus-goals li').find(one => one.textContent.includes('G7'))
    assert.equal(words(row.querySelector('.wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(row.querySelectorAll('.focus-ask-done-when').length, 0, 'while the word waits, the button does not ask twice')
    assert.doesNotMatch(row.textContent, /Your partner writes its Done when|No Done when yet/)
    assert.equal(again.all('.focus-note').length, 0, 'the line is the one status: no note beside it')
  } finally { await again.close() }
  // Late: "Ask again" comes back, by the record.
  const late = await openPage({ state: { ...base, waits: { w1: line('late', 'Not picked up after 40 min', 'it waits in Advisor\'s queue', { at: at(40), sentAt: at(40) }) } } })
  try {
    await late.click('[data-tab="advice"]')
    const row = late.all('.focus-goals li').find(one => one.textContent.includes('G7'))
    assert.equal(words(row.querySelector('.wait-lead')), 'Not picked up after 40 min')
    assert.equal(words(row.querySelector('.focus-ask-done-when')), 'Ask again')
  } finally { await late.close() }
})

test('a click sends the word and shows no "Sent..." note: Pick, Start the talk, This is the goal definition, the talk bar', async () => {
  const base = asSent({ ...build([], undefined, VIBE_GOALS), goalsEdit: { canWrite: true } })
  const page = await openPage({ state: base, answers: () => reply({ id: 'G6' }) })
  try {
    await page.click('[data-tab="advice"]')
    const yes = page.find('.focus-yes')
    assert.equal(words(yes), 'This is the goal definition')
    await page.click('.focus-yes')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body.command), ['vibe-agree'])
    assert.equal(page.all('.focus-note').length, 0, 'no "Agreed. Your partner proposes the how next."')
  } finally { await page.close() }
  // After the click the record stands: the line is under the button, and it is still there after a reload (the same state, drawn anew).
  for (const turn of [1, 2]) {
    const lined = await openPage({ state: { ...base, waits: { w1: sentLine('vibe-agreed', 'G6') } } })
    try {
      await lined.click('[data-tab="advice"]')
      assert.equal(words(lined.find('#advisor-focus .focus-draft .wait-words, #advisor-focus .focus-body .wait-line .wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`, `draw ${turn}`)
      assert.equal(lined.all('.focus-note').length, 0)
    } finally { await lined.close() }
  }
})

test('the Focus talk card: the Start the talk word\'s line is the card\'s one status, with no sentence of its own beside it', async () => {
  const base = asSent({ ...build([], undefined, VIBE_GOALS), goalsEdit: { canWrite: true } })
  const lined = await openPage({ state: { ...base, waits: { w1: sentLine('focus', 'G6') } } })
  try {
    await lined.click('[data-tab="advice"]')
    const card = lined.find('#advisor-focus .focus-talk')
    assert.equal(card.querySelectorAll('.wait-line').length, 1, 'one line')
    assert.equal(words(card.querySelector('.wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`)
    assert.doesNotMatch(card.textContent, /thinking|Your partner is told/)
  } finally { await lined.close() }
})

test('Goals: Mark done\'s re-check and Ask your partner for a Done when show their line under the goal\'s tools, with no toast and no "asked" sentence', async () => {
  const goals = ['Last id: G6', '', '- [ ] G6 The polish', ''].join('\n')
  const base = asSent({ ...build([], undefined, goals), goalsEdit: { canWrite: true } })
  const plain = await openPage({ state: base, hash: 'advice/goals/G6', answers: () => reply({ id: 'G6' }) })
  try {
    assert.equal(plain.all('#goals-frame .wait-line').length, 0, 'no record: no line')
    await plain.click('#goals-frame [data-goal-tool="done-when"]')
    assert.deepEqual(plain.sent('/api/goals').map(one => one.body.command), ['done-when'])
    assert.equal(plain.find('#goals-note').hidden, true, 'no 8-second toast: "Your partner is asked to write its Done when."')
    assert.doesNotMatch(plain.text('#goals-frame'), /is asked/)
  } finally { await plain.close() }
  for (const command of ['goal-recheck', 'done-when']) {
    const page = await openPage({ state: { ...base, waits: { w1: sentLine(command, 'G6') } }, hash: 'advice/goals/G6' })
    try {
      const found = page.all('#goals-frame .wait-line')
      assert.equal(found.length, 1, command)
      assert.equal(words(found[0].querySelector('.wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`)
      assert.equal(page.find('#goals-note').hidden, true)
    } finally { await page.close() }
  }
})

test('the page keeps no memory of "asked": no `focusUi.asked`, no "asked" row sentence, no "Sent..." note for these clicks', async () => {
  const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
  const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  assert.doesNotMatch(script, /focusUi\.asked|isAsked: asked|asked: \[\.\.\.focusUi/)
  assert.doesNotMatch(script, /Your partner is told: the talk|Your partner is asked to write its Done when|Agreed\. Your partner proposes the how|Go: your partner makes the steps, and the board|The talk starts again: your partner is told|Sent to your partner, in the talk|Sent to your partner: (it proposes a changed how|the talk goes on)|asked to undo it|re-checks it against its Done when and its goal definition: it gets/)
  assert.doesNotMatch(css, /\.focus-done-when\.is-asked/)
  // Every click of the list passes no note text to `sendFocus`.
  for (const command of ['focus', 'done-when', 'goal-demo', 'vibe-agree', 'how-go', 'vibe-there-yes', 'vibe-there-no', 'talk']) {
    const calls = [...script.matchAll(new RegExp(`sendFocus\\(\\{ command: '${command}'[^\\n]*`, 'g'))].map(one => one[0])
    assert.notEqual(calls.length, 0, command)
    for (const call of calls) assert.match(call, /, ''\)/, `${command} sends no "Sent..." note: ${call.slice(0, 90)}`)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// The real case: real records of the board's own outbox and history (fixtures/p4b, copied from data/ of 2026-11-10), copied into a temp
// folder and read by the board's own store, then through the server's own wait pass (`waitsOf`, with the judge as the server makes it).
// A board that never had a `done-when` word (0 of 14404 records) shows the words that were really sent from the same pages: the focus
// pick, "This is the goal definition", the goal's re-check, the goal demo, and a brainstorm answer the chat did answer.

test('the real case: real outbox and history records, copied to a temp folder, read by the store and put through the wait pass: the line reads what really happened', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p4b-real-'))
  try {
    for (const name of ['outbox.jsonl', 'history.jsonl']) await writeFile(join(dir, name), await readFile(join(ROOT, 'fixtures', 'p4b', name)))
    const store = await fileStore(dir, 1_795_000_000_000)
    const real = id => store.outbox().find(word => word.id === id)
    const lineAt = (id, minutesAfter, chat = real(id).to) => {
      const word = real(id)
      const now = word.at + minutesAfter * MIN
      const advisor = lane(chat, { status: 'Free' })
      const state = { chats: [], supervisorChat: null, advisor, productOwner: null }
      return waitsFor({ state, outbox: [word], now })[id]
    }
    // The real "This is the goal definition" (vibe-agreed): typed 14 s after the click; the chat's report is not in the records: Sent.
    const agreed = lineAt('8dd1db2230e4f323', 1)
    assert.deepEqual([agreed.place, agreed.command, agreed.goal, agreed.state, agreed.lead], ['focus', 'vibe-agreed', 'G60', 'sent', `Sent ${hhmm(real('8dd1db2230e4f323').at)}`])
    // The real Pick (focus): the chat ran a turn after it and never said (delivered-unconfirmed): still the record, never a guess of "thinking".
    const picked = lineAt('7081ed29bfce5856', 2)
    assert.deepEqual([picked.place, picked.command, picked.goal], ['focus', 'focus', 'G60'])
    assert.doesNotMatch(`${picked.lead} ${picked.rest}`, /thinking|preparing/)
    // The real re-check and demo: tracked and drawn by the same rule.
    assert.deepEqual([lineAt('bfc880fbff1abf50', 1).place, lineAt('5be5bf0ba15aff98', 1).place], ['focus', 'focus'])
    // The real brainstorm answer the Product owner answered 16 s after the click: Done, "answered", by the record's own `answeredAt`.
    const answered = real('a6bcaed875f02871')
    assert.equal(typeof answered.answeredAt, 'number')
    const done = lineAt('a6bcaed875f02871', 1)
    assert.deepEqual([done.state, done.place, done.lead], ['done', 'talk', `Product owner answered ${hhmm(answered.answeredAt)}`])
    // A day later, with no answer recorded: P3's honest end ("no answer recorded in 24 h"), not a guess; and after that the line is gone.
    const old = lineAt('8dd1db2230e4f323', 26 * 60)
    assert.deepEqual([old.state, old.rest, old.isEnded], ['sent', 'no answer recorded in 24 h', true])
    assert.equal(lineAt('8dd1db2230e4f323', 4 * 24 * 60), undefined)
    assert.equal(real('7081ed29bfce5856').why.startsWith('delivered-unconfirmed'), true, 'the real record says what really happened')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
