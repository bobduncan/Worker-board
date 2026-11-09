// Autopilot (the person, 2026-10-31: "idk what bother me, approve rebuild all mean but i kind of want to have an option to
// autoapprove and only get bothered by real issues and the product owner"): the settings panel's Autopilot (Off / On and its
// one line; On hides "Bother me" and "Approve rebuilds by itself"), what reads those two while it is on, Needs your attention
// with its one quiet line on top (the board's own wake lines always stay), the header's count, the Focus page's switch
// ("covered by Autopilot") and "For your recap". Made-up garden project; no word names a project.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { answer, typed } from '../fixtures/lines.mjs'
import { AUTOPILOT_OFF_WORDS, AUTOPILOT_ON_WORDS } from '../src/work/autopilot.mjs'
import { checkSetting, panelSettings, rebuildsApproved, recapsShowOf, settingChanged } from '../src/boardSettings.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, RUN_GOALS, app, asSent, sinceOf, tail } from './partnerState.mjs'
import { buildState } from './withStore.mjs'

// 2026-11-01: "Bother me" is gone from the panel's answer (it was `botherMe` here).
const ON = { approveRebuilds: false, maxWorkers: 5, autopilot: true, canSet: true, whyNot: null }
const OFF = { ...ON, autopilot: false }

/** The garden's state as the board builds it, with the settings `settings` (config.json) and the store's `items`. */
function garden(items = [], settings = {}, goalsText = RUN_GOALS, more = {}) {
  const config = { ...parseConfig(JSON.stringify(settings), {}), project: 'D:\\garden' }
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, goalsText, ...more,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}
/** The garden's recap (T20.1: the card counts the recap's rows): one row, `Show damage`, which shows B1. */
const RECAP_PATH = 'pictures/g6/recap/demo.json'
const withRecap = { recaps: [{ path: RECAP_PATH, goal: 'G6', parts: [{ key: 'Show damage', title: 'Show damage', steps: ['B1'] }], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: RECAP_PATH, pictures: {} } }
const askOf = (id, fields) => parseItem(`${Object.entries({ Id: id, Kind: 'ask', State: 'open', Owner: 'Digger', Since: sinceOf(NOW - 40 * MIN), Filed: String(NOW - 40 * MIN), Asks: 'decide', Blocking: 'no', ...fields }).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

test('the setting: off unless switched on, in config.json and on the panel, and only true or false', () => {
  assert.equal(parseConfig('{}', {}).autopilot, false)
  assert.equal(parseConfig('{"autopilot":true}', {}).autopilot, true)
  assert.equal(parseConfig('{"autopilot":"yes"}', {}).autopilot, false)
  assert.deepEqual(checkSetting({ key: 'autopilot', value: true }), { ok: true, key: 'autopilot', value: true })
  assert.equal(checkSetting({ key: 'autopilot', value: 'on' }).status, 400)
  assert.equal(settingChanged('{\n  "name": "Garden"\n}\n', 'autopilot', true).text, '{\n  "name": "Garden",\n  "autopilot": true\n}\n')
  assert.equal(panelSettings(parseConfig('{"autopilot":true}', {})).autopilot, true)
})

test('while Autopilot is on, every reader of "Approve rebuilds by itself" reads it as off, and the recaps of finished work go to the daily note', () => {
  // The coordinator's ruling (2026-10-31): a goal stuck after the guard's tries is the person's; Autopilot approves no rebuild.
  assert.equal(rebuildsApproved({ approveRebuilds: false, autopilot: true }), false)
  assert.equal(rebuildsApproved({ approveRebuilds: true, autopilot: true }), false)
  assert.equal(rebuildsApproved({ approveRebuilds: false, autopilot: false }), false)
  assert.equal(rebuildsApproved({ approveRebuilds: true }), true)
  // 2026-11-01 (the person: "so bother me is obsolete"): the setting is gone; the recaps of finished work (B360) are gathered under
  // the partner's daily note while Autopilot is on (it was "now" then), and reach Needs your attention while it is off.
  assert.equal(recapsShowOf({ autopilot: true }), 'daily')
  assert.equal(recapsShowOf({ autopilot: false }), 'now')
  assert.equal(recapsShowOf({}), 'now')
  assert.equal(garden([], { autopilot: true }).recapsShow, 'daily')
  assert.equal(garden([], { botherMe: 'daily' }).recapsShow, 'now', 'an old botherMe in the file changes nothing')
})

test('the panel: Autopilot with Off and On and its line; On hides "Approve rebuilds by itself", Off shows both', async () => {
  const on = await openPage({ state: { ...asSent(garden()), boardSettings: ON } })
  try {
    assert.equal(on.find('#autopilot').hidden, false)
    assert.equal(on.text('#autopilot .cpu-label'), 'Autopilot')
    assert.deepEqual(on.all('#autopilot [data-setting="autopilot"]').map(one => [one.textContent, one.classList.contains('is-on')]), [['Off', false], ['On', true]])
    assert.equal(on.text('#autopilot-words'), AUTOPILOT_ON_WORDS)
    assert.equal(on.text('#autopilot-words'), 'The work runs until a goal is ready. You are asked when a goal starts, when it is ready, and for what no chat can do. Everything else is decided for you, with Undo.')
    assert.deepEqual([on.find('#approve-rebuilds').hidden, on.find('#max-workers').hidden], [true, false])
    assert.equal(on.all('#bother-me').length, 0, '"Bother me" is gone from the panel (2026-11-01)')
    assert.match(on.find('#settings-button').title, /Autopilot: on/)
  } finally { await on.close() }
  const off = await openPage({ state: { ...asSent(garden()), boardSettings: OFF } })
  try {
    assert.equal(off.text('#autopilot-words'), AUTOPILOT_OFF_WORDS)
    assert.equal(off.text('#autopilot-words'), 'Questions come to you as before.')
    assert.deepEqual([off.find('#autopilot').hidden, off.find('#approve-rebuilds').hidden], [false, false])
  } finally { await off.close() }
  // A board that sends no Autopilot (an older one) shows the panel as before.
  const { autopilot, ...older } = OFF
  const old = await openPage({ state: { ...asSent(garden()), boardSettings: older } })
  try {
    assert.deepEqual([old.find('#autopilot').hidden, old.find('#approve-rebuilds').hidden], [true, false])
  } finally { await old.close() }
})

test('the panel: a click on On sends the flag; the board\'s answer hides the setting it covers', async () => {
  let shown = OFF
  const page = await openPage({ state: () => ({ ...asSent(garden()), boardSettings: shown }), answers: request => { shown = { ...shown, autopilot: request.body.value }; return reply(shown) } })
  try {
    await page.click('[data-setting="autopilot"][data-value="true"]')
    assert.deepEqual(page.sent('/api/settings').map(one => one.body), [{ key: 'autopilot', value: true }])
    assert.equal(page.find('#approve-rebuilds').hidden, true)
    await page.click('[data-setting="autopilot"][data-value="false"]')
    assert.deepEqual(page.sent('/api/settings').map(one => one.body.value), [true, false])
    assert.equal(page.find('#approve-rebuilds').hidden, false)
  } finally { await page.close() }
})

// 2026-11-01 (the person: "a little tooltip next to the autopilot setting with making it clear what is and isnt being signalled"):
// the "ⓘ" right of the Autopilot label; its box holds what Autopilot asks and what it decides for you.
// Autopilot v2 (the person's "B", 2026-11-02), on purpose: a goal's Go and a focus switch are asked, a stuck goal's rebuild takes its
// advice, the hands stand in one line, and the rest the partner decides.
const TIP = [
  'With Autopilot on, you are asked for:',
  "a new goal's start: its goal definition, work blocks and Go",
  'a switch of focus',
  "a goal's recap, once it is ready",
  'what only you can do, in one line: sign-ins, accounts, money, installs, deleting things, publishing, restarting the Claude app',
  "Decided for you instead (with Undo, listed in your partner's note):",
  "a question with advice: the advice is taken (never for a rebuild, an accept or a picture)",
  'the rest: your partner decides it, or hands it to you',
  "looks below their target: they wait for the goal's recap",
  'chores a chat can do: Main does them',
  'While Autopilot is on, "Approve rebuilds by itself" is covered and hidden; it works again when Autopilot is off.',
]
test('the "ⓘ" beside Autopilot: a focusable button described by a calm box that holds what is asked and what is decided for you; it opens inline, by click only; Escape closes only the box', async () => {
  const page = await openPage({ state: { ...asSent(garden()), boardSettings: ON } })
  try {
    const button = page.find('#autopilot-info')
    assert.deepEqual([button.tagName, button.type, button.textContent, button.getAttribute('aria-describedby'), button.getAttribute('aria-expanded')], ['BUTTON', 'button', 'ⓘ', 'autopilot-tip', 'false'])
    assert.ok(button.getAttribute('aria-label').length > 0, 'a name for a screen reader')
    assert.equal(page.find('#autopilot-tip').getAttribute('role'), 'tooltip')
    assert.deepEqual(page.all('#autopilot-tip p, #autopilot-tip li').map(one => one.textContent.trim()), TIP)
    assert.deepEqual(page.all('#autopilot-tip ul').map(one => one.children.length), [4, 4], 'asked for: 4 lines; decided for you: 4')
    // Right of the label, in the same row; the label's own words stay "Autopilot".
    assert.equal(page.find('#autopilot-info').closest('.autopilot-title').querySelector('.cpu-label').textContent, 'Autopilot')
    // The box is in the panel's flow, right under the Autopilot line, before the Off and On buttons (it pushes them down, covers nothing).
    const group = page.find('#autopilot')
    assert.deepEqual([...group.children].slice(0, 3).map(one => one.id || one.className.split(' ')[0]), ['autopilot-title', 'autopilot-tip', 'cpu-level'])
    const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')
    assert.doesNotMatch(css, /\.info-tip[^{]*\{[^}]*position:\s*(?:absolute|fixed)/, 'no overlay')
    assert.doesNotMatch(css, /:hover[^{]*\.info-tip|:focus[^{]*\.info-tip/, 'nothing opens on hover or focus')
    // A click (Enter and Space click a button) opens it, a second one closes it.
    await page.click('#autopilot-info')
    assert.deepEqual([button.getAttribute('aria-expanded'), group.classList.contains('is-tip-open')], ['true', true])
    await page.click('#autopilot-info')
    assert.deepEqual([button.getAttribute('aria-expanded'), group.classList.contains('is-tip-open')], ['false', false])
    // Escape on the focused ⓘ, where the panel's own Escape handler sees it first: it closes only the box; the panel stays open, the focus returns to the ⓘ.
    const settings = page.find('#settings')
    settings.open = true
    await page.click('#autopilot-info')
    button.focus()
    const escape = () => button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    escape()
    assert.deepEqual([settings.open, button.getAttribute('aria-expanded'), group.classList.contains('is-tip-open'), page.document.activeElement === button], [true, 'false', false, true])
    // With the box closed, the next Escape closes the panel as before.
    escape()
    assert.equal(settings.open, false)
  } finally { await page.close() }
})

test('Needs your attention with Autopilot on: only the person\'s asks, counted on top; one quiet line; the wake lines always stay', async () => {
  const items = [
    askOf('Q1', { Title: 'Icons or words on the bar?', Options: 'A icons | B words', Advice: 'A', Route: 'partner' }),
    askOf('Q2', { Title: 'Export the map of B12', Asks: 'do', Route: 'main' }),
    askOf('Q3', { Title: 'Approve the hedge at 64 of 75?', Asks: 'look', Of: 'B12', Route: 'recap' }),
    askOf('Q4', { Title: 'Sign in to the seed shop account?', Options: 'A now | B later', Advice: 'A', Route: 'person' }),
  ]
  const state = asSent(garden(items, { autopilot: true }))
  assert.deepEqual(state.forYou.filter(one => one.workId !== undefined).map(one => one.workId), ['Q4'])
  assert.deepEqual(state.autopilot, { on: true, decidedToday: 0 })
  assert.deepEqual(state.routedAway.map(one => [one.id, one.route]), [['Q2', 'main'], ['Q3', 'recap']])
  const page = await openPage({
    state: {
      ...state, autopilot: { on: true, decidedToday: 3 },
      // Signals change 4: the one wake notice of the wake record (src/wake.mjs `noticeOf`) in place of the three older lines.
      wakeNotice: { tone: 'attention', text: 'nobody answers the board\'s wake-ups: open any chat · could not wake Advisor: the app did not start it (launched 09:58); open its chat' },
    },
  })
  try {
    const top = page.all('#needs > *').slice(0, 2).map(words)
    assert.match(top[0], /^Nobody answers the board's wake-ups: open any chat · could not wake Advisor: the app did not start it \(launched 09:58\); open its chat\.$/)
    // Autopilot v2 (on purpose): "Decided for you" folds into this one line with today's count.
    assert.equal(top[1], 'Autopilot decided 3 today →')
    assert.equal(page.find('#needs .autopilot-line a').getAttribute('href'), '#advice/focus')
    assert.equal(page.text('#waits-for-you'), '1 waits for you')
    // Autopilot v2 (on purpose): the sign-in is the person's hands, so it stands in the one hands line, not as a card.
    assert.equal(page.all('#needs [data-id^="work:"]').filter(card => !card.classList.contains('is-closed')).map(card => card.dataset.id).join(), '')
    assert.equal(words(page.find('#needs .hands-line')), 'Needs your hands: Sign in to the seed shop account? →')
    // Signals change 4: the opener's line above the lanes went into the one wake notice.
    assert.doesNotMatch(words(page.find('#restart')), /Opened .* to wake the chats/)
  } finally { await page.close() }
  // Off: no line on top.
  const off = await openPage({ state: asSent(garden(items)) })
  try {
    assert.equal(off.all('#needs .autopilot-line').length, 0)
  } finally { await off.close() }
})

test('the task window of an ask with the main chat or waiting for the recap names its route', async () => {
  const items = [askOf('Q2', { Title: 'Export the map of B12', Asks: 'do', Route: 'main' })]
  const page = await openPage({ state: asSent(garden(items, { autopilot: true })), hash: 'details=Q2' })
  try {
    assert.match(words(page.find('#details')), /With the main chat \(Autopilot\)/)
    assert.match(words(page.find('#details')), /the main chat does it if a chat can/)
  } finally { await page.close() }
})

test('a card the board decided for the person: "Decided for you" with its answer and the Undo', async () => {
  const decided = parseItem(`Id: Q9\nKind: ask\nTitle: Shorter names?\nState: answered\nOwner: Advisor\nSince: ${sinceOf(NOW - 5 * MIN)}\nAsks: decide\nBlocking: no\nAdvice: yes\nRoute: advice\nAnswered by: autopilot\nDaily note: N3\n\n## Answer\nyes\n\n## Why\nautopilot: took the advice\n\n## Note line\nQ9 (Advisor): Shorter names? → yes (autopilot: took the advice)\n`)
  const state = asSent(garden([decided], { autopilot: true }, undefined))
  assert.equal(state.autopilot.decidedToday, 1)
  const page = await openPage({ state, hash: 'details=Q9' })
  try {
    assert.match(words(page.find('#details')), /Decided for you: yes/)
    assert.equal(page.all('#details [data-take-back="Q9"]').length, 1)
  } finally { await page.close() }
})

test('the Focus page: the switch reads "covered by Autopilot"; the asks that wait for the recap are counted in the recap card', async () => {
  const items = [
    parseItem(`Id: B1\nKind: step\nTitle: Show damage\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`),
    askOf('Q3', { Title: 'Approve the damage numbers at 64 of 75?', Asks: 'look', Of: 'B1', Route: 'recap', Pictures: 'pictures/B1/check.png' }),
  ]
  const page = await openPage({ state: { ...asSent(garden(items, { autopilot: true }, RUN_GOALS, withRecap)), goalsEdit: { canWrite: true } } })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.find('[data-partner-answers="switch"]').disabled, true)
    assert.equal(page.find('[data-partner-answers="switch"]').checked, true)
    assert.equal(page.text('.focus-partner-switch small'), 'covered by Autopilot')
    // 2026-11-01: the list "For your recap (n)" is folded into the recap card: the row whose step waits for the person is one
    // verdict there (its tile opens the recap at its row; T20.1: the card counts the recap's rows), and no second list stands on the page.
    assert.equal(page.all('.focus-recap-wait').length, 0)
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 1 to judge')
    const tile = page.find('.focus-recap-tile')
    assert.deepEqual([tile.querySelector('b').textContent, tile.dataset.demo, tile.dataset.demoPart], ['Show damage', RECAP_PATH, 'Show damage'])
  } finally { await page.close() }
  const off = await openPage({ state: { ...asSent(garden(items)), goalsEdit: { canWrite: true } } })
  try {
    await off.click('[data-tab="advice"]')
    assert.equal(off.find('[data-partner-answers="switch"]').disabled, false)
    assert.equal(off.text('.focus-partner-switch small'), 'on: detail questions go to your partner first')
  } finally { await off.close() }
})

test('the recap moment (the coordinator\'s ruling, 2026-10-31): a step that waits only for the recap counts as done for asking the goal demo; 2026-11-01: the recap card comes first, the question after it', async () => {
  const items = [
    parseItem(`Id: B1\nKind: step\nTitle: Show damage\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n\n## Context\n  Recap verdict: waits (Q3)\n`),
    askOf('Q3', { Title: 'Approve the damage numbers at 64 of 75?', Asks: 'look', Of: 'B1', Route: 'recap', Pictures: 'pictures/B1/check.png' }),
  ]
  const state = { ...asSent(garden(items, { autopilot: true }, RUN_GOALS, withRecap)), goalsEdit: { canWrite: true } }
  assert.deepEqual([state.focus.progress.done, state.focus.progress.forDemo, state.focus.progress.total], [0, 1, 1])
  assert.deepEqual(state.focus.recapRows, [{ step: 'B1', asks: ['Q3'] }])
  const page = await openPage({ state })
  try {
    await page.click('[data-tab="advice"]')
    // 2026-11-01: while a verdict waits the recap card shows and "Did we reach the goal?" is not drawn (it was drawn with the asks
    // first, "For your recap (1)", and a Yes that waited); the asks are counted in the card.
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 1 to judge')
    assert.equal(page.all('.focus-there').length, 0)
    assert.equal(page.all('.focus-recap-wait, .focus-recap-head').length, 0, 'listed once, in the card')
  } finally { await page.close() }
})
