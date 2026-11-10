// Reactive board, brief P4b, round 2 (the review of 2026-11-10 and chat 1's pick B for finding 1): a word of a brainstorm talk has the thread's
// next stage as its own Done (as a change thread's word has), so a turn that ended without the next question is P3's own "turn ended without it":
// Late after the grace with the chat at rest, the quiet "still working" while it works, "not confirmed" with no report; the Late line carries the
// Retry and the list row stops reading "with your partner". Also: the pick row's "Ask again" for an ended line, the demo sentence, one line once,
// and a newer word that supersedes an older not-sent record. Made-up garden names.
import assert from 'node:assert/strict'
import test from 'node:test'

import { brainstormsState } from '../src/brainstorm.mjs'
import { movedOn, clickLedger } from '../src/clicks.mjs'
import { parseConfig } from '../src/config.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { talkPartnerOf } from '../src/talkPartner.mjs'
import { waitsOf } from '../src/waitLine.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, asSent, build } from './partnerState.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = (hour, minute, second = 0) => new Date(2026, 9, 19, hour, minute, second).getTime()
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: at(10, 0) }).keep
void parseConfig

const PATH = '.claude/brainstorms/2026-10-19-paths-through-the-garden.md'
const HEAD = '# Brainstorm: Paths through the garden\nGoal: G6 The polish\nStarted: 2026-10-19 09:00 · State: running\nOpening: Where do the paths go?\n\n'
const Q1 = '## Q1 (09:01)\nWhere first?\n- A: By the gate (advised)\n- B: By the pond\nAnswer (09:02): A\n'
const Q2 = '\n## Q2 (09:04)\nHow bright?\n- A: Dim (advised)\n- B: Bright\nAnswer (09:05): A\n'
const Q3 = '\n## Q3 (09:09)\nHow wide?\n- A: Wide (advised)\n- B: Narrow\n'
const STUCK = `${HEAD}${Q1}${Q2}`
const threadOf = text => brainstormsState([{ path: PATH, text, at: 1 }], 'b').threads[0]

const lane = (name, more = {}) => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null, ...more })
const word = (more = {}) => ({ id: 'w1', to: 'Advisor', ask: null, step: null, text: `brainstorm answer\nThread: ${PATH}\nQ2: A`, command: 'brainstorm-answer', about: PATH, at: at(9, 5, 20), state: 'delivered', takenAt: at(9, 5, 21), deliveredAt: at(9, 5, 22), ...more })
const said = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: null, ...more })
/** The server's `waits` for a thread, a word and the chat's report, at `now`. */
function waitsFor({ text = STUCK, outbox = [word()], report = null, now, advisor = lane('Advisor') }) {
  const state = { chats: [], supervisorChat: null, advisor, brainstorms: { threads: [threadOf(text)] } }
  const judge = wordJudge({ state, items: new Map(), outbox, settings: {}, now })
  return waitsOf({ state, outbox, now, keep, judge, reports: report === null ? null : new Map([['Advisor', { at: now - 2000, ...report }]]), items: new Map() })
}
/** The chat's turn on the word ended at 09:08 with no question written. */
const ended = said('idle', at(9, 8), { word: 'w1', turn: at(9, 6) })

// ---------------------------------------------------------------------------------------------------------------------
// Finding 1 (pick B): the talk word's own Done

test('the stuck brainstorm case: Q2 answered, the partner\'s turn ends without Q3: the quiet line, then Late after 5 minutes with the chat at rest, with the Retry', () => {
  // Two minutes after the turn ended: quiet, and it names what happened: no "answered".
  const quiet = waitsFor({ report: ended, now: at(9, 10) }).w1
  assert.deepEqual([quiet.state, quiet.lead, quiet.isTurnEnded], ['sent', `Advisor's turn ended at ${hhmm(at(9, 8))} without it`, true])
  // Past the grace (5 min from the turn's end, the chat at rest): Late, naming the action, flagged for the Retry.
  const late = waitsFor({ report: ended, now: at(9, 15) }).w1
  assert.deepEqual([late.state, late.isTurnEnded, late.place, late.command], ['late', true, 'talk', 'brainstorm-answer'])
  assert.match(`${late.lead} ${late.rest}`, /No answer since 09:08.*ask Advisor in its chat/)
  // The chat still works (a later turn running on something else): the quiet "still working", never Late.
  const working = waitsFor({ report: said('busy', at(9, 12), { word: null, turn: at(9, 12), lastIdle: { word: 'w1', since: at(9, 8) } }), advisor: lane('Advisor', { status: 'Working', state: 'working' }), now: at(9, 30) }).w1
  assert.deepEqual([working.state, working.rest], ['sent', 'Advisor still working'])
  // No report at all (a word with its turn end recorded and no report to read): quiet "not confirmed", never Late.
  const unknown = waitsFor({ outbox: [word({ answeredAt: at(9, 8) })], now: at(9, 40) }).w1
  assert.deepEqual([unknown.state, unknown.isTurnEnded, unknown.rest], ['sent', true, 'no report from Advisor: not confirmed'])
})

test('the thread\'s next stage is the Done of a talk word: a new question, what it understood, a proposal, or the talk over; before that none', () => {
  const asked = waitsFor({ text: `${STUCK}${Q3}`, report: ended, now: at(9, 30) }).w1
  assert.deepEqual([asked.state, asked.lead, asked.rest], ['done', `Done ${hhmm(at(9, 9))}`, 'a new question'])
  const over = waitsFor({ text: STUCK.replace('State: running', 'State: done'), report: ended, now: at(9, 30) }).w1
  assert.deepEqual([over.state, over.rest], ['done', 'the talk is over'])
  // The Focus talk bar's word names a goal, not a thread: no thread, so its fallback stays "answered".
  const bar = waitsFor({ outbox: [word({ command: 'talk', about: 'G6' })], report: ended, now: at(9, 30) }).w1
  assert.equal(bar.state, 'done')
  assert.match(bar.lead, /answered/)
})

/** The page over the real server lines of the stuck case. */
async function stuckPage(waits, more = {}) {
  const made = asSent({ ...build([], undefined, ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n'), { threadTexts: [{ path: PATH, text: STUCK, at: 1 }] }), goalsEdit: { canWrite: true }, waits, readAt: at(9, 15), ...more })
  const page = await openPage({ state: { ...made, talkPartner: talkPartnerOf(made) }, answers: () => reply({}) })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}

test('the stuck case on the page: Late line, the Retry in the card and the menu, and the list row no longer says "with your partner"; while it only waits, none of that', async () => {
  const late = waitsFor({ report: ended, now: at(9, 15) })
  const page = await stuckPage(late)
  try {
    assert.match(words(page.find('#brainstorm-card .wait-line')), /No answer since 09:08/)
    assert.equal(words(page.find('#brainstorm-card .brainstorm-again')), 'Type it to your partner again')
    assert.match(words(page.find('.brainstorm-row .brainstorm-status')), /^no answer from your partner/)
    assert.doesNotMatch(words(page.find('.brainstorm-row')), /with your partner/)
    await page.click('.brainstorm-menu-button')
    assert.ok(page.all('.brainstorm-menu-item').some(one => words(one) === 'Type it to your partner again'))
  } finally { await page.close() }
  const quiet = await stuckPage(waitsFor({ report: ended, now: at(9, 10) }))
  try {
    // The quiet "turn ended at … without it" is a record too: the Retry is offered (the turn ended without its answer), the row is honest.
    assert.equal(words(quiet.find('#brainstorm-card .brainstorm-again')), 'Type it to your partner again')
  } finally { await quiet.close() }
  const waiting = await stuckPage({ w1: { state: 'sent', lead: 'Sent 09:05', rest: 'waits for Advisor to pick it up', at: at(9, 5), chat: 'Advisor', canSendAgain: false, link: null, place: 'talk', command: 'brainstorm-answer', about: PATH, goal: 'G6', ask: null, sentAt: at(9, 5), title: 'x' } })
  try {
    assert.equal(waiting.all('#brainstorm-card .brainstorm-again').length, 0)
    assert.match(words(waiting.find('.brainstorm-row .brainstorm-status')), /^with your partner/)
  } finally { await waiting.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// Findings 3, 5, 6: the Focus page

const GOALS_PICK = ['Last id: G7', '', '- [ ] G1 A forest to walk', '    Done when: a player crosses the forest in five minutes', '- [ ] G7 A pond', ''].join('\n')
const GOALS_VIBE = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance', ''].join('\n')
const line = (state, lead, rest, more = {}) => ({ state, lead, rest, at: at(9, 5), chat: 'Advisor', canSendAgain: false, link: null, place: 'focus', command: 'done-when', about: 'G7', goal: 'G7', ask: null, sentAt: at(9, 5), title: 'words', ...more })

test('the pick row: "Ask again" is back when the line has ended ("no answer recorded in 24 h"), not while it waits', async () => {
  const base = asSent({ ...build([], undefined, GOALS_PICK), goalsEdit: { canWrite: true }, readAt: at(9, 6) })
  for (const [name, waits, shown] of [
    ['waiting', { w1: line('sent', 'Sent 09:05', 'waits for Advisor to pick it up') }, false],
    ['ended', { w1: line('sent', 'Sent 09:05', 'no answer recorded in 24 h', { isEnded: true }) }, true],
    ['late', { w1: line('late', 'Not picked up after 40 min', 'x') }, true],
  ]) {
    const page = await openPage({ state: { ...base, waits } })
    try {
      await page.click('[data-tab="advice"]')
      const row = page.all('.focus-goals li').find(one => one.textContent.includes('G7'))
      assert.equal(row.querySelectorAll('.focus-ask-done-when').length, shown ? 1 : 0, name)
    } finally { await page.close() }
  }
})

test('the Focus run\'s right column: the demo sentence checks a goal-demo line only, and one line stands once beside the re-check card', async () => {
  const run = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance', '    Goal definition agreed: 2026-10-18 10:00', '    Part: Show damage · about 1 h · steps B1', '    How agreed: 2026-10-18 11:00', ''].join('\n')
  void GOALS_VIBE
  const base = asSent({ ...build([], undefined, run), goalsEdit: { canWrite: true }, readAt: at(9, 6) })
  // The card is shown only when every part is done: the made-up garden has none, so this checks the page's own code paths by source.
  void base
  const { readFile } = await import('node:fs/promises')
  const script = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  assert.match(script, /focusWordLine\(state, \['goal-demo'\]\)\.length === 0\) card\.append\(el\('p', 'focus-demo-wait'/)
  assert.doesNotMatch(script, /focusWordLine\(state, FOCUS_LINE_COMMANDS\.there\)\.length === 0\) card\.append\(el\('p', 'focus-demo-wait'/)
  assert.match(script, /const isThereDrawn = recapReady === null && view\.vibeThere !== null/)
  assert.match(script, /\.\.\.\(isThereDrawn \? \[\] : focusWordLine\(state, FOCUS_LINE_COMMANDS\.there\)\)/)
})

// ---------------------------------------------------------------------------------------------------------------------
// Finding 7: a newer word supersedes an older not-sent record

test('a newer word of the person\'s for the talk (the Focus talk bar\'s, or a click) ends the older not-sent record, and its Retry is refused', async () => {
  const record = { click: 'click-aaaa-1111', route: '/api/brainstorm', key: PATH, at: at(9, 5), notSent: 'no chat takes it', say: { command: 'brainstorm-answer', n: 2 } }
  const state = { brainstorms: { threads: [threadOf(STUCK)] } }
  assert.equal(movedOn(record, state, []), null, 'no newer word: it stands')
  const barWord = { id: 'w9', to: 'Advisor', command: 'talk', about: 'G6', at: at(9, 7), state: 'waiting', text: `talk: more words\nGoal: G6 The polish\nThread: ${PATH}` }
  assert.equal(movedOn(record, state, [barWord]), 'a newer word for it was sent')
  assert.equal(movedOn(record, state, [{ ...barWord, at: at(9, 4) }]), null, 'an older word does not')
  assert.equal(movedOn(record, state, [{ ...barWord, command: 'brainstorm-fix', about: PATH }]), null, 'the board\'s own fix word is no word of the person\'s')
  assert.equal(movedOn(record, state, [{ ...barWord, text: 'x', about: PATH, command: 'brainstorm-answer' }]), 'a newer word for it was sent')
  // Through the ledger: the record is ended and the card's Not-sent line goes; the Retry is refused with the why.
  const ledger = clickLedger({})
  await ledger.put(record)
  await ledger.settle(one => movedOn(one, state, [barWord]), at(9, 8))
  assert.deepEqual(await ledger.unsent(), [])
  assert.equal((await ledger.get(record.click)).superseded.why, 'a newer word for it was sent')
})

void MIN
