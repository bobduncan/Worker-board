// Reactive board, brief P4c round 3 (the re-review): a plan word with no pickedUpAt whose page was written after it stays quiet (never Late);
// Start again keeps the kind apart from the person's own words; a decision word that went Late brings its slide back; the regex byte in board.js.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { planStarting, planState, withPlanWork } from '../src/plan.mjs'
import { planMove } from '../src/planMoves.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { waitsOf } from '../src/waitLine.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, asSent, build } from './partnerState.mjs'

const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const at = minutesAgo => NOW - minutesAgo * MIN
const lane = name => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null })
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: NOW }).keep
const NL = String.fromCharCode(10)
const text = parts => parts.join(NL) + NL
const PLAN_K = text(['# G', '', 'Pitch: A.', '', '## K1 · Paths', '', '- State: decided (you, 2026-10-19)'])
const PLAN_P1 = text(['# G', '', 'Pitch: A.', '', '## P1 · What', '', '- State: decided (you, 2026-10-19)'])
const PLAN_ROAD = text(['# G', '', 'Pitch: A.', '', '## P7 · The road', '', '- State: assumed (partner, 2026-10-18)', '- Point: **First** a bench'])
const PLAN_OPEN = text(['# G', '', 'Pitch: A.', '', '## P1 · What', '', '- State: open'])
const lineOf = (state, lead, rest, more = {}) => ({ state, lead, rest, at: at(3), chat: 'Advisor', canSendAgain: false, link: null, place: 'plan', command: 'plan-change', about: 'P7', goal: null, ask: null, sentAt: at(3), title: 'plan', ...more })
const stateOf = (pageText, outbox, waits, more = {}) => {
  const base = asSent({ ...build([], undefined, ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join(String.fromCharCode(10))), goalsEdit: { canWrite: true } })
  return { ...base, advisor: lane('Advisor'), plan: withPlanWork(planState(pageText, [], 'p.md'), outbox, null, NOW), waits, readAt: NOW, ...more }
}
const planWord = (command, about, more = {}) => ({ id: `w-${command}-${about}`, to: 'Advisor', ask: null, step: null, text: `plan: ${command}`, command, about, at: at(3), state: 'delivered', ...more })

test('a plan word with no pickedUpAt and the page written after it stays quiet when its turn ended, never Late; a turn report that names the word is its pick-up record', () => {
  const idle = (more = {}) => ({ state: 'idle', since: at(8), background: false, run: 1, seq: 1, busyAt: null, turn: at(9), ...more })
  const run = (word, pageAt, report) => {
    const state = { chats: [], supervisorChat: null, advisor: lane('Advisor'), plan: withPlanWork(planState(PLAN_K, [], 'p.md'), [word], pageAt, NOW) }
    const judge = wordJudge({ state, items: new Map(), outbox: [word], settings: {}, now: NOW })
    return waitsOf({ state, outbox: [word], now: NOW, keep, judge, reports: new Map([['Advisor', report]]), items: new Map() })[word.id]
  }
  const word = { id: 'w1', to: 'Advisor', ask: null, step: null, text: 'plan: measure', command: 'plan-measure', about: 'K1', at: at(10), state: 'delivered', takenAt: at(9), deliveredAt: at(9) + 1000 }
  // The word merged into a turn (its turn ended "by"), the partner wrote the page after the word, no pickedUpAt anywhere: quiet.
  const merged = { ...word, answeredAt: at(8), answeredBound: true }
  const quiet = run(merged, at(5), idle())
  assert.equal(quiet.state, 'sent', 'never the amber Late')
  assert.deepEqual([quiet.isTurnEnded, quiet.isUnconfirmed], [true, true])
  assert.match(`${quiet.lead} ${quiet.rest}`, /turn ended by \d\d:\d\d without it.*plan written \d\d:\d\d; not confirmed for this word/)
  // With no page written after the word, P3's rule is as it was: Late.
  assert.equal(run(merged, at(20), idle()).state, 'late')
  // The report that names this word is the pick-up record: the page written after its turn began is its Done.
  const named = run(word, at(5), idle({ word: 'w1' }))
  assert.deepEqual([named.state, named.lead], ['done', `Done ${hhmm(at(5))}`])
  // A page written BEFORE that turn began is not.
  assert.notEqual(run(word, at(9.5), idle({ word: 'w1' })).state, 'done')
})

test('the Vision button is free on the quiet "not confirmed" line, and busy on a plain Sent line', async () => {
  const measure = planWord('plan-deeper', 'P1')
  const waits = isUnconfirmed => ({ [measure.id]: lineOf('sent', "Advisor's turn ended by 11:52 without it", 'plan written 11:55; not confirmed for this word', { command: 'plan-deeper', about: 'P1', isTurnEnded: true, ...(isUnconfirmed ? { isUnconfirmed: true } : {}) }) })
  for (const [flag, disabled] of [[true, false], [false, true]]) {
    const page = await openPage({ state: stateOf(PLAN_P1, [measure], waits(flag)), now: NOW })
    try {
      await page.click('[data-tab="vision"]')
      const button = page.all('[data-vision-act="deeper"][data-vision-id="P1"]')[0]
      assert.ok(button, 'the Go deeper button stands on the card')
      assert.equal(button.disabled, disabled, flag ? 'quiet line: free' : 'plain Sent: busy')
    } finally { await page.close() }
  }
})

test('Start again keeps the kind apart from the own words: Start again, then Start, sends "Game: a tactics game" once', async () => {
  // The server keeps the kind and the own words on the word, apart from the whole text.
  const made = planMove({ command: 'plan-start', text: 'Game: a tactics game', kind: 'Game', ownWords: 'a tactics game' }, { canWrite: true, partner: { name: 'Advisor' }, job: 'J' })
  assert.equal(made.ok, true)
  assert.deepEqual([made.words.startKind, made.words.ownWords, made.words.said], ['Game', 'a tactics game', 'Game: a tactics game'])
  assert.deepEqual(planStarting([{ ...made.words, at: at(30), state: 'delivered' }], NOW), { at: at(30), state: 'working', kind: 'Game', words: 'a tactics game' })
  // The page: Start again puts only the own words in the box and the kind back; Start sends the text again, the kind once.
  const state = { ...stateOf(PLAN_OPEN, [], {}), plan: null, planStart: { at: at(30), state: 'working', kind: 'Game', words: 'a tactics game' } }
  const page = await openPage({ state, now: NOW, answers: () => reply({}) })
  try {
    await page.click('[data-tab="vision"]')
    await page.click('[data-vision-act="start-again"]')
    assert.equal(page.find('#vision-extra-words').value, 'a tactics game')
    await page.click('[data-vision-act="start-plan"]')
    assert.deepEqual(page.sent('/api/plan').map(one => one.body), [{ command: 'plan-start', text: 'Game: a tactics game', kind: 'Game', ownWords: 'a tactics game' }])
  } finally { await page.close() }
})

test('a decision sent in your own words whose word went Late or ended brings its slide back (its line has Send again); while Sent or Picked up the slide stays away', async () => {
  const change = planWord('plan-change', 'P7')
  const shows = async line => {
    const page = await openPage({ state: stateOf(PLAN_ROAD, [change], { [change.id]: line }), now: NOW })
    try {
      await page.click('[data-tab="vision"]')
      await page.click('[data-vision-act="page"][data-vision-id="interview"]')
      return page.all('#view-vision [data-vision-act="decide-words"]').length
    } finally { await page.close() }
  }
  assert.equal(await shows(lineOf('picked-up', 'Advisor is on it', 'since 11:57')), 0)
  assert.equal(await shows(lineOf('late', 'No answer since 11:00', 'ask Advisor in its chat')), 1)
  assert.equal(await shows(lineOf('sent', 'Sent 11:00', 'no answer recorded in 24 h', { isEnded: true })), 1)
})

test('the story-context filter has a real word boundary (a backspace byte once stood in its regex), and board.js holds no stray control characters', async () => {
  const source = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source), false, 'no control character in board.js')
  const at1 = source.indexOf('/^(?:Touches:|Requirements:|Reported')
  assert.ok(at1 > 0, 'the filter is found')
  const literal = source.slice(at1, source.indexOf('.test(one)', at1))
  const filter = new Function(`return ${literal}`)()
  assert.equal(filter.test('Reported by the person: it is slow'), true)
  assert.equal(filter.test('Touches: board.js'), true)
  assert.equal(filter.test('Reportedly fine'), false, 'a word boundary, not a prefix')
})
