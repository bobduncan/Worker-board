// The Brainstorm screen (the person, 2026-10-31: "it looks terrible. cluttered too much text to little focus on the
// interaction, no feedback if its working on it. ... i also dont know when the advisor is now working on it."). The mocks
// they approved (three mock pictures): slim rows with one status word; a head with the title, its status word and a
// "…" menu; one large calm card for the partner's turn (a softly pulsing dot, what it does, and when it is busy with
// something else, what and since when, and where the thread stands in its queue); one question card with big options on the
// person's turn, the earlier answers as chips; the Understood card; the opening as one collapsed line. The status words and
// the partner's lines are worked out without the page (the part between brainstorm:start and brainstorm:end); the card is
// clicked in happy-dom (B415). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { brainstormsState } from '../src/brainstorm.mjs'
import { talkPartnerOf } from '../src/talkPartner.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { asSent, build } from './partnerState.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const [script, css] = await Promise.all([readFile(join(PUBLIC, 'board.js'), 'utf8'), readFile(join(PUBLIC, 'board.css'), 'utf8')])
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// brainstorm:start'), script.indexOf('// brainstorm:end'))}
Object.assign(this, { brainstormCardView, brainstormListView, brainstormOpeningView, brainstormPartnerView, brainstormStatusOf })`, made)
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const view = Object.fromEntries(Object.entries(made).map(([name, fn]) => [name, (...args) => plain(fn(...args))]))

const PATH = '.claude/brainstorms/2026-10-31-lanterns.md'
// Reactive board, brief P4a: a click is ONE call with a click id, and the page never types the word itself.
const noClick = ({ click, ...rest }) => {
  assert.match(click, /^[\w-]{8,64}$/)
  return rest
}

const OTHER = '.claude/brainstorms/2026-10-30-benches.md'
const OPENING = 'Where should the lanterns go? I want the garden to glow at night without a lamp in every corner. Think about the gate, the pond and the benches first.'
const HEAD = `# Brainstorm: Lanterns\nGoal: G6 The polish\nStarted: 2026-10-31 21:00 · State: running\nOpening: ${OPENING}\n\n`
const Q1 = '## Q1 (21:01)\nWhere first?\nContext: Most visitors come in by the gate.\nWhy: it decides the order.\n- A: By the gate (advised)\n- B: By the pond\n'
const A1 = 'Answer (21:02): A\n'
const Q2 = '\n## Q2 (21:04)\nHow bright should they be?\nContext: Dim lanterns save the night sky; bright ones show every path.\n- A: Dim (advised)\n- B: Bright\n- C: Both\n'
const PROPOSAL = '\n## Proposal (21:20)\nDecided:\n- the gate first\nGoals:\n- [ ] Lanterns by the gate — under G6 — Done when: a visitor finds the gate at night\nSteps:\n- [ ] Make a lantern sprite — Units — about 1 h\nNote: most visitors come in by the gate.\n'
const CHANGE_HEAD = '# Brainstorm: Change: Lanterns\nGoal: G6 The polish\nKind: change\nStarted: 2026-10-31 21:00 · State: running\nOpening: Steps are missing; I want to rethink where the lanterns go.\n\n'
const UNDERSTOOD = '## Understood (21:10)\nA lantern is right when a visitor finds the gate at night\nwithout a map.\n'
const thread = (text, path = PATH) => brainstormsState([{ path, text, at: 1 }], 'b').threads[0]
const idle = { name: 'Oracle', isRunning: true, state: 'free', doingNow: null, on: null, next: [] }
const MIN = 60_000
/** HH:MM of a time as the page writes it (the local clock). */
const hhmm = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const AT = new Date(2026, 9, 31, 21, 10).getTime()
/** A row of the partner's queue (the state's `advisor.next`): a word of a brainstorm, or another item. */
const word = (stand, since, extra = {}) => ({ kind: 'brainstorm-answer', id: null, title: 'brainstorm answer', who: null, stand: { kind: stand, since }, thread: PATH, ...extra })
const other = (id, since = AT - 5 * MIN) => ({ kind: 'refine', id, title: `Title of ${id}`, who: null, stand: { kind: 'queued', since } })

/** The page over a made-up state: `texts` are [path, thread text] pairs, `advisor` what to change in the partner's part of the state. */
const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')
function pageState(texts, advisor = {}) {
  const state = asSent({ ...build([], undefined, GOALS, { threadTexts: texts.map(([path, text], at) => ({ path, text, at: at + 1 })) }), goalsEdit: { canWrite: true } })
  const changed = { ...state, advisor: { ...state.advisor, isRunning: true, ...advisor } }
  // The Product owner (2026-10-31): the talk partner as the server sends it, from the partner changed here.
  return { ...changed, talkPartner: talkPartnerOf(changed) }
}
/** The Brainstorm part opened on it. */
async function open(texts, { advisor, answers, hash, waits } = {}) {
  const page = await openPage({ state: { ...pageState(texts, advisor), ...(waits === undefined ? {} : { waits, readAt: AT }) }, answers, hash })
  await page.click('[data-tab="advice"]')
  await page.click('[data-advisor-pane="brainstorm"]')
  return page
}

// ---------------------------------------------------------------------------------------------------------------------
// The status words

test('the status word of a thread: your turn for a question, what the partner understood or a proposal; the partner\'s two states; how it ended', () => {
  const status = (text, advisor = idle) => view.brainstormStatusOf(thread(text), advisor)
  const words = (text, advisor) => status(text, advisor).word
  // The person's turn.
  assert.equal(words(`${HEAD}${Q1}`), 'your turn')
  assert.equal(words(`${CHANGE_HEAD}${Q1}${A1}\n${UNDERSTOOD}`), 'your turn', 'what the partner understood waits for the yes')
  assert.equal(words(`${HEAD}${Q1}${A1}${PROPOSAL}`), 'your turn', 'a proposal waits to be ticked')
  // P4b: the partner has the word: the word says whose turn it is, whatever its queue or its card say; how it does is the card's line (the records), never a guess here.
  for (const advisor of [idle, { ...idle, next: [word('working', AT)] }, { ...idle, state: 'working', doingNow: 'Brainstorm: Q2' }, { ...idle, next: [word('queued', AT)] }, { ...idle, state: 'working', doingNow: 'Morning round' }, { ...idle, isRunning: false }, null]) {
    assert.equal(words(`${HEAD}${Q1}${A1}`, advisor), 'with your partner')
    assert.doesNotMatch(words(`${HEAD}${Q1}${A1}`, advisor), /thinking|stopped|nothing sent/)
  }
  assert.equal(words(HEAD), 'with your partner', 'before the first question')
  // How it ended.
  const over = state => text => thread(text.replace('State: running', `State: ${state}`))
  assert.equal(view.brainstormStatusOf(over('done')(`${HEAD}${Q1}${A1}${PROPOSAL}Created (21:25): G10; 1 step asked of the main chat; left out: nothing\n`), idle).word, 'created')
  assert.equal(view.brainstormStatusOf(over('done')(`${HEAD}${Q1}${A1}`), idle).word, 'done')
  assert.equal(view.brainstormStatusOf(over('discarded')(`${HEAD}${Q1}`), idle).word, 'discarded')
  // Wrapping up: the partner writes the proposal.
  assert.equal(view.brainstormStatusOf(over('wrapping up')(`${HEAD}${Q1}`), idle).word, 'with your partner')
  // A tone for each, which the page colours (never amber or red).
  assert.deepEqual(['your turn', 'waiting'].map((tone, index) => status([`${HEAD}${Q1}`, `${HEAD}${Q1}${A1}`][index], idle).tone), ['person', 'waiting'])
})

test('the list rows carry the title and one status word; the date, the questions and what came of it are in the tooltip', () => {
  const threads = brainstormsState([
    { path: PATH, text: `${HEAD}${Q1}`, at: 3 },
    { path: OTHER, text: `${HEAD.replace('Lanterns', 'Benches')}${Q1}${A1}`, at: 2 },
    { path: '.claude/brainstorms/2026-10-29-gate.md', text: `${HEAD.replace('Lanterns', 'Gate').replace('State: running', 'State: done')}${Q1}${A1}${PROPOSAL}Created (21:25): G10; 2 steps asked of the main chat; left out: nothing\n`, at: 1 },
    { path: '.claude/brainstorms/2026-10-28-old.md', text: HEAD.replace('Lanterns', 'Old').replace('State: running', 'State: discarded'), at: 0 },
  ], '.claude/brainstorms').threads
  const list = view.brainstormListView(threads, idle)
  assert.deepEqual(list.running.map(row => [row.title, row.word]), [['Lanterns', 'your turn'], ['Benches', 'with your partner']])
  assert.deepEqual(list.done.map(row => [row.title, row.word]), [['Gate', 'created'], ['Old', 'discarded']])
  assert.equal(list.running[1].tip, '2026-10-31 · 1 question · with your partner')
  assert.equal(list.done[0].tip, '2026-10-31 · 1 question → G10, 2 steps')
  assert.ok(!('line' in list.running[0]), 'no line of dates and counts under the title')
})

// ---------------------------------------------------------------------------------------------------------------------
// The partner's turn

test('the partner\'s turn (P4b): the card holds no guess of its own: no "thinking", no queue place, no "usually under a minute"; only a chat that does not run has words', () => {
  const card = (text, advisor = idle) => view.brainstormCardView(thread(text), advisor).partner
  const busy = { ...idle, state: 'working', doingNow: 'Evening round', turnAt: AT, on: { kind: 'refine', id: 'B7', title: 'Hero hurt gets a sound', since: AT - 12 * MIN } }
  for (const text of [HEAD, `${HEAD}${Q1}${A1}`, `${HEAD}${Q1}`.replace('State: running', 'State: wrapping up'), `${CHANGE_HEAD}${Q1}${A1}\n${UNDERSTOOD}Answer (21:11): yes\n`]) {
    for (const advisor of [idle, busy, { ...busy, next: [word('queued', AT), other('B9')] }, { ...idle, next: [word('working', AT)] }]) {
      const found = card(text, advisor)
      assert.deepEqual([found.kind, found.headline, found.line], ['line', null, null], 'nothing of its own: the thread\'s line is its status')
    }
  }
  // A chat that does not run, or no partner: a fact of the chat, said as before.
  assert.deepEqual([card(`${HEAD}${Q1}${A1}`, { ...idle, isRunning: false }).kind, card(`${HEAD}${Q1}${A1}`, { ...idle, isRunning: false }).headline], ['off', 'Your partner\'s chat is not running'])
  assert.equal(card(`${HEAD}${Q1}${A1}`, null).kind, 'off')
  // Nothing of a card for the person's turn or the end.
  assert.equal(card(`${HEAD}${Q1}`), null)
  assert.equal(card(`${HEAD}${Q1}${A1}`.replace('State: running', 'State: done')), null)
})

test('the partner\'s turn on the page (P4b): no card, no "thinking", no status word in the head; only a chat that does not run says so, muted', async () => {
  const answered = [[PATH, `${HEAD}${Q1}${A1}`]]
  const page = await open(answered)
  try {
    assert.equal(page.all('.brainstorm-card .brainstorm-waiting').length, 0, 'no card of guesses')
    assert.equal(page.all('.brainstorm-wait-line, .brainstorm-wait-sub').length, 0)
    assert.equal(page.all('.brainstorm-option, #brainstorm-other').length, 0, 'nothing to answer while the partner has the turn')
    assert.equal(page.all('.brainstorm-head .brainstorm-status').length, 0, 'the head holds no second status')
    assert.equal(page.text('.brainstorm-row .brainstorm-status'), 'with your partner · just now')
    assert.doesNotMatch(page.text('.brainstorm-card'), /thinking|usually under a minute|Stopped|nothing sent/)
  } finally { await page.close() }
  const busy = await open(answered, { advisor: { state: 'working', doingNow: 'Evening round', turnAt: AT, on: { kind: 'refine', id: 'B7', title: 'Hero hurt gets a sound', since: AT - 12 * MIN }, next: [other('B8'), word('queued', AT)] } })
  try {
    assert.equal(busy.all('.brainstorm-waiting').length, 0, 'what the partner is busy with is no guess drawn here: the line of the word says it')
    assert.doesNotMatch(busy.text('.brainstorm-card'), /busy with|in its queue|waiting for your partner/)
  } finally { await busy.close() }
  const off = await open(answered, { advisor: { isRunning: false } })
  try {
    assert.equal(off.text('.brainstorm-wait-line'), 'Your partner\'s chat is not running')
    assert.equal(off.find('.brainstorm-waiting').classList.contains('is-off'), true)
  } finally { await off.close() }
})

test('no pulse is left for a guess; no amber or red for a plain state', () => {
  assert.doesNotMatch(css, /brainstorm-pulse/, 'the thinking pulse went with the thinking')
  assert.doesNotMatch(css, /brainstorm-status\.is-thinking|brainstorm-status\.is-stopped|brainstorm-waiting\.is-stopped/)
  const rules = selector => css.split('\n').filter(line => line.startsWith(selector) || line.includes(`${selector} {`))
  for (const selector of ['.brainstorm-status', '.brainstorm-row', '.brainstorm-waiting', '.brainstorm-dot', '.brainstorm-chip', '.brainstorm-next', '.brainstorm-opening']) {
    const body = rules(selector).join('\n')
    assert.notEqual(body, '', selector)
    assert.doesNotMatch(body, /var\(--(?:waiting|warn|ask)\)|#ff7a59|#f6b93b/, `${selector} stays in the quiet colours`)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// The person's turn

test('the question card: "Question n", the question large, its context as one short line, the options as buttons with the advised one marked, a line for your own words', async () => {
  const page = await open([[PATH, `${HEAD}${Q1}${A1}${Q2}`]])
  try {
    assert.equal(page.text('.brainstorm-qn'), 'Question 2')
    assert.equal(page.text('.brainstorm-question'), 'How bright should they be?')
    assert.equal(page.find('.brainstorm-question').tagName, 'H4')
    // This context is under 140 characters: the one muted line, nothing folded.
    assert.equal(page.text('.brainstorm-context'), 'Dim lanterns save the night sky; bright ones show every path.')
    assert.equal(page.all('.brainstorm-why-toggle').length, 0)
    assert.deepEqual(page.all('.brainstorm-option').map(one => [one.tagName, one.dataset.option, one.querySelector('.brainstorm-option-text').textContent, one.querySelector('.brainstorm-advised') === null ? '' : one.querySelector('.brainstorm-advised').textContent]), [
      ['BUTTON', 'A', 'Dim', 'advised'], ['BUTTON', 'B', 'Bright', ''], ['BUTTON', 'C', 'Both', ''],
    ])
    assert.equal(page.find('#brainstorm-other').placeholder, 'Or say it in your own words…')
    assert.equal(page.find('#brainstorm-other').tagName, 'INPUT')
    assert.equal(page.text('#brainstorm-send'), 'Send')
    assert.equal(page.find('#brainstorm-send').disabled, true, 'Send waits for words')
    assert.equal(page.text('.brainstorm-head .brainstorm-status'), 'your turn')
    // Gone with the old card: the about line, the meta line, the sentence of the change, the Answer, Skip, Back and wrap up buttons, the folded list.
    assert.equal(page.all('.brainstorm-about, .brainstorm-meta, .brainstorm-change-sub, .brainstorm-earlier, #brainstorm-answer, .brainstorm-file, .brainstorm-card .brainstorm-buttons').length, 0)
    assert.doesNotMatch(page.text('#brainstorm-card'), /about:|started 2026|Change of|Your partner asks until/)
  } finally { await page.close() }
})

test('an option answers at once, through today\'s answer path; your own words go as "Other" with Send or Enter', async () => {
  const answers = request => reply(request.url === '/api/brainstorm' ? {} : {})
  const page = await open([[PATH, `${HEAD}${Q1}${A1}${Q2}`]], { answers })
  try {
    await page.click('[data-option="A"]')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => noClick(one.body)), [{ path: PATH, n: 2, command: 'answer', key: 'A', words: '' }])
    assert.deepEqual(page.sent('/api/say'), [], 'the board types the word itself')
    // Words typed beside an option go with it, as before.
    await page.type('#brainstorm-other', 'and a lamp by the pond')
    assert.equal(page.find('#brainstorm-send').disabled, false)
    await page.click('[data-option="B"]')
    assert.deepEqual(noClick(page.sent('/api/brainstorm').at(-1).body), { path: PATH, n: 2, command: 'answer', key: 'B', words: 'and a lamp by the pond' })
    // Their own words alone: "Other".
    await page.type('#brainstorm-other', 'dim by the gate, bright by the pond')
    await page.click('#brainstorm-send')
    assert.deepEqual(noClick(page.sent('/api/brainstorm').at(-1).body), { path: PATH, n: 2, command: 'answer', key: 'Other', words: 'dim by the gate, bright by the pond' })
    assert.deepEqual(page.sent('/api/say'), [])
    assert.equal(new Set(page.sent('/api/brainstorm').map(one => one.body.click)).size, 3, 'each click has its own id')
    // Enter in the line sends too.
    await page.type('#brainstorm-other', 'a hum by the gate')
    page.find('#brainstorm-other').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    assert.deepEqual(noClick(page.sent('/api/brainstorm').at(-1).body), { path: PATH, n: 2, command: 'answer', key: 'Other', words: 'a hum by the gate' })
    // Send with no words sends nothing.
    const before = page.sent('/api/brainstorm').length
    await page.type('#brainstorm-other', '   ')
    assert.equal(page.find('#brainstorm-send').disabled, true)
    assert.equal(page.sent('/api/brainstorm').length, before)
  } finally { await page.close() }
})

test('a context over 140 characters, and the partner\'s reason, fold out under "Why I ask"', async () => {
  const LONGER = 'Dim lanterns save the night sky, but bright ones show every path and every step to a visitor who comes in late. The gate and the pond are the two places that need light first.'
  const page = await open([[PATH, `${HEAD}${Q1}${A1}${Q2.replace('Dim lanterns save the night sky; bright ones show every path.', LONGER)}`]])
  try {
    assert.equal(page.all('.brainstorm-context').length, 0, 'the long context is not on the card at first')
    assert.equal(page.text('.brainstorm-why-toggle'), 'Why I ask')
    assert.equal(page.find('.brainstorm-why-toggle').getAttribute('aria-expanded'), 'false')
    await page.click('.brainstorm-why-toggle')
    assert.deepEqual(page.all('.brainstorm-context').map(one => one.textContent), [LONGER])
    assert.equal(page.find('.brainstorm-why-toggle').getAttribute('aria-expanded'), 'true')
    await page.click('.brainstorm-why-toggle')
    assert.equal(page.all('.brainstorm-context').length, 0)
  } finally { await page.close() }
  // A short context and a reason ("Why:" of the thread): the line shows, and the reason folds.
  const short = await open([[PATH, `${HEAD}${Q1}`]])
  try {
    assert.equal(short.text('.brainstorm-context'), 'Most visitors come in by the gate.')
    await short.click('.brainstorm-why-toggle')
    assert.deepEqual(short.all('.brainstorm-why').map(one => one.textContent), ['I ask because it decides the order.'])
  } finally { await short.close() }
})

test('the earlier answers are chips above the card: a tooltip and a click show the question and the whole answer', async () => {
  const page = await open([[PATH, `${HEAD}${Q1}Answer (21:02): A — and a bench\n${Q2}Answer (21:05): Other — dim by the gate\n\n## Q3 (21:07)\nWhat sound do they make?\n- A: A hum (advised)\n- B: None\n`]])
  try {
    const chips = page.all('.brainstorm-chips .brainstorm-chip')
    assert.deepEqual(chips.map(one => one.textContent), ['1 · By the gate', '2 · dim by the gate'])
    assert.equal(chips[0].title, 'Q1 Where first?\nA, By the gate: "and a bench"')
    // The row stands above the card.
    assert.ok(page.find('.brainstorm-chips').compareDocumentPosition(page.find('.brainstorm-box')) & 4)
    assert.equal(page.all('.brainstorm-chip-detail').length, 0)
    await page.click('[data-brainstorm-chip="1"]')
    assert.deepEqual(page.all('.brainstorm-chip-detail span').map(one => one.textContent), ['A, By the gate: "and a bench"', 'Most visitors come in by the gate.'])
    assert.equal(page.text('.brainstorm-chip-detail b'), 'Q1 Where first?')
    await page.click('[data-brainstorm-chip="2"]')
    assert.equal(page.text('.brainstorm-chip-detail b'), 'Q2 How bright should they be?')
    await page.click('[data-brainstorm-chip="2"]')
    assert.equal(page.all('.brainstorm-chip-detail').length, 0)
  } finally { await page.close() }
})

test('the head: the title, its status word and a small "…"; the facts of the thread are in the title\'s tooltip, not on the screen', async () => {
  const page = await open([[PATH, `${CHANGE_HEAD}${Q1}`]])
  try {
    assert.equal(page.text('.brainstorm-head .brainstorm-title'), 'Change: Lanterns')
    assert.equal(page.text('.brainstorm-head .brainstorm-status'), 'your turn')
    assert.equal(page.text('.brainstorm-head .brainstorm-menu-button'), '…')
    assert.equal(page.find('.brainstorm-title').title, 'Change of G6 · with your partner · running · started 2026-10-31 21:00\nabout G6 The polish\nYour partner asks until it can say back what you want. Nothing about the goal changes before your yes.')
    assert.doesNotMatch(page.text('#brainstorm-card'), /G6|Change of|with the Advisor|running|asks until/)
  } finally { await page.close() }
})

test('the list at the left: a slim row each, the title and one status word, and the one chosen marked', async () => {
  const page = await open([[PATH, `${HEAD}${Q1}`], [OTHER, `${HEAD.replace('Lanterns', 'Benches')}${Q1}${A1}`]])
  try {
    // 2026-10-31: each word with its age after it (the made-up board's clock stands before these talks: "just now").
    assert.deepEqual(page.all('.brainstorm-row').map(one => [one.querySelector('b').textContent, one.querySelector('small').textContent, one.title, one.classList.contains('is-chosen')]), [
      ['Lanterns', 'your turn · just now', '2026-10-31 · 1 question · with your partner', true],
      ['Benches', 'with your partner · just now', '2026-10-31 · 1 question · with your partner', false],
    ])
    // The groups (2026-10-31): only "Active" holds a thread here.
    assert.deepEqual(page.all('.brainstorm-group').map(one => one.textContent), ['Active'])
    assert.equal(page.text('.brainstorm-start'), '+ New brainstorm…')
    await page.click(`[data-brainstorm-open="${OTHER}"]`)
    assert.equal(page.text('.brainstorm-head .brainstorm-title'), 'Benches')
    assert.deepEqual(page.all('.brainstorm-row').map(one => one.classList.contains('is-chosen')), [false, true])
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// What the partner understood

test('the Understood card: a thin green border, "Yes, that\'s it" and "Not quite…", the chips above and a muted line under it', async () => {
  const page = await open([[PATH, `${CHANGE_HEAD}${Q1}${A1}\n${UNDERSTOOD}`]])
  try {
    assert.equal(page.text('.brainstorm-understood h4'), 'What I understand you want')
    assert.equal(page.text('.brainstorm-understood-text'), 'A lantern is right when a visitor finds the gate at night without a map.')
    assert.deepEqual(page.all('.brainstorm-understood [data-brainstorm-act]').map(one => one.textContent), ['Yes, that\'s it', 'Not quite…'])
    assert.deepEqual(page.all('.brainstorm-chips .brainstorm-chip').map(one => one.textContent), ['1 · By the gate'])
    assert.equal(page.text('.brainstorm-next'), 'Next: your partner drafts the new goal')
    // The line stands under the card, the chips above it.
    assert.ok(page.find('.brainstorm-chips').compareDocumentPosition(page.find('.brainstorm-understood')) & 4)
    assert.ok(page.find('.brainstorm-understood').compareDocumentPosition(page.find('.brainstorm-next')) & 4)
    assert.equal(page.all('.brainstorm-waiting').length, 0, 'it waits for you, not for the partner')
    assert.match(css, /\.brainstorm-box\.brainstorm-understood \{[^}]*border-color: #2f7d57/)
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The opening

test('the opening is one collapsed line, "Your words: <the first of it>…", with "show all"', async () => {
  const shown = view.brainstormOpeningView(OPENING)
  assert.deepEqual([shown.isCut, shown.short.endsWith('…'), shown.short.length <= 91, shown.full], [true, true, true, OPENING])
  assert.deepEqual(view.brainstormOpeningView('Where do lanterns go?'), { short: 'Where do lanterns go?', full: 'Where do lanterns go?', isCut: false })
  assert.equal(view.brainstormOpeningView('  '), null)
  const page = await open([[PATH, `${HEAD}${Q1}`]])
  try {
    assert.equal(page.text('.brainstorm-opening'), `Your words: ${shown.short} show all`)
    assert.equal(page.all('.brainstorm-opening').length, 1)
    await page.click('.brainstorm-opening [data-brainstorm-act="opening"]')
    assert.equal(page.text('.brainstorm-opening'), `Your words: ${OPENING} show less`)
    await page.click('.brainstorm-opening [data-brainstorm-act="opening"]')
    assert.equal(page.text('.brainstorm-opening'), `Your words: ${shown.short} show all`)
    assert.doesNotMatch(page.text('#brainstorm-card'), /You opened with/)
  } finally { await page.close() }
  // A short opening is all there: no "show all".
  const short = await open([[PATH, HEAD.replace(OPENING, 'Where do lanterns go?') + Q1]])
  try {
    assert.equal(short.text('.brainstorm-opening'), 'Your words: Where do lanterns go?')
    assert.equal(short.all('.brainstorm-opening button').length, 0)
  } finally { await short.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The "…" menu

/** A line of a talk's word as the server puts it in the state's `waits` (P4b). */
const talkLine = (state, more = {}) => ({ w1: { state, lead: 'Sent 21:05', rest: 'waits for Oracle to pick it up', at: AT - 5 * MIN, chat: 'Oracle', canSendAgain: false, link: null, place: 'talk', command: 'brainstorm-answer', about: PATH, goal: 'G6', ask: null, sentAt: AT - 5 * MIN, title: 'words', ...more } })

test('the "…" menu holds the thread file and Discard; "Type it to your partner again" only where the records say so: the line is Late (P4b)', async () => {
  const answers = request => reply({})
  for (const waits of [undefined, talkLine('sent'), talkLine('picked-up', { lead: 'Oracle is on it', rest: 'since 21:06' })]) {
    const quiet = await open([[PATH, `${HEAD}${Q1}${A1}`]], { answers, waits })
    try {
      await quiet.click('.brainstorm-menu-button')
      assert.deepEqual(quiet.all('.brainstorm-menu-list .brainstorm-menu-item').map(one => one.textContent), ['The thread file', 'Discard'], 'no clock and no guess offers it')
      assert.equal(quiet.all('.brainstorm-again').length, 0)
    } finally { await quiet.close() }
  }
  const page = await open([[PATH, `${HEAD}${Q1}${A1}`]], { answers, waits: talkLine('late', { lead: 'Not picked up after 12 min', rest: 'it waits in the queue' }) })
  try {
    assert.equal(page.all('.brainstorm-menu-list').length, 0, 'closed at first')
    assert.equal(page.text('.brainstorm-again'), 'Type it to your partner again', 'Late: the card offers it')
    await page.click('.brainstorm-menu-button')
    assert.equal(page.find('.brainstorm-menu-button').getAttribute('aria-expanded'), 'true')
    assert.deepEqual(page.all('.brainstorm-menu-list .brainstorm-menu-item').map(one => one.textContent), ['The thread file', 'Type it to your partner again', 'Discard'])
    assert.equal(page.find('.brainstorm-menu-list [data-game-file]').dataset.gameFile, PATH)
    // "Type it again" types the word the thread waits on (the answer to the last question) and closes the menu.
    await page.click('[data-brainstorm-act="again"]')
    assert.deepEqual(page.sent('/api/say'), [])
    assert.deepEqual(page.sent('/api/brainstorm').map(one => noClick(one.body)), [{ command: 'again', path: PATH, word: { command: 'brainstorm-answer', n: 1 } }])
    assert.equal(page.all('.brainstorm-menu-list').length, 0)
    // Discard asks twice, and the first click keeps the menu open to say so.
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="discard"]')
    assert.equal(page.sent('/api/brainstorm').filter(one => one.body.command === 'discard').length, 0)
    assert.equal(page.text('.brainstorm-menu-list .is-delete'), 'Click again to discard it')
    await page.click('[data-brainstorm-act="discard"]')
    assert.deepEqual(page.sent('/api/brainstorm').filter(one => one.body.command === 'discard').map(one => one.body), [{ command: 'discard', path: PATH }])
    assert.equal(page.all('.brainstorm-menu-list').length, 0)
  } finally { await page.close() }
})

test('on a question the menu also holds Skip, Back to the question before and "Enough, wrap up"; it closes on Escape and on a click outside', async () => {
  const answers = request => reply({})
  const page = await open([[PATH, `${HEAD}${Q1}${A1}${Q2}`]], { answers })
  try {
    await page.click('.brainstorm-menu-button')
    assert.deepEqual(page.all('.brainstorm-menu-list .brainstorm-menu-item').map(one => one.textContent), ['Skip', 'Back to Q1', 'Enough, wrap up', 'The thread file', 'Discard'])
    // The partner has no turn: nothing to type again.
    assert.equal(page.all('[data-brainstorm-act="again"]').length, 0)
    await page.click('[data-brainstorm-act="back"]')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => noClick(one.body)), [{ path: PATH, n: 2, command: 'back', to: 1 }])
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="skip"]')
    assert.deepEqual(noClick(page.sent('/api/brainstorm').at(-1).body), { path: PATH, n: 2, command: 'skip' })
    await page.click('.brainstorm-menu-button')
    await page.click('[data-brainstorm-act="wrap"]')
    assert.deepEqual(noClick(page.sent('/api/brainstorm').at(-1).body), { command: 'wrap', path: PATH })
    assert.deepEqual(page.sent('/api/say'), [])
    // Closing without choosing.
    await page.click('.brainstorm-menu-button')
    assert.equal(page.all('.brainstorm-menu-list').length, 1)
    page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    assert.equal(page.all('.brainstorm-menu-list').length, 0)
    await page.click('.brainstorm-menu-button')
    await page.click('.brainstorm-start')
    assert.equal(page.all('.brainstorm-menu-list').length, 0, 'a click outside closes it')
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The proposal views and Needs your attention

test('the proposal views keep their function in the same calm frame', async () => {
  const page = await open([[PATH, `${HEAD}${Q1}${A1}${PROPOSAL}`]], { answers: () => reply({ goals: [{ id: 'G10', title: 'x' }], steps: [] }) })
  try {
    assert.equal(page.text('.brainstorm-head .brainstorm-status'), 'your turn')
    const frame = page.find('.brainstorm-box.is-proposal')
    assert.ok(frame.querySelector('.brainstorm-proposal'))
    assert.deepEqual([...frame.querySelectorAll('[data-tick]')].map(one => [one.dataset.tick, one.checked]), [['g0', true], ['s0', true]])
    assert.deepEqual([...frame.querySelectorAll('[data-brainstorm-act]')].map(one => one.textContent), ['Create what\'s ticked', 'Change…'])
    await page.change('[data-tick="s0"]', false)
    await page.click('[data-brainstorm-act="create"]')
    assert.deepEqual(page.sent('/api/brainstorm').map(one => [one.body.command, one.body.goals, one.body.steps]), [['create', [0], []]])
    assert.deepEqual(page.all('.brainstorm-chips .brainstorm-chip').map(one => one.textContent), ['1 · By the gate'])
  } finally { await page.close() }
})

test('a thread that waits for the person stays under Needs your attention, as before', async () => {
  const page = await openPage({ state: pageState([[PATH, `${HEAD}${Q1}`], [OTHER, `${HEAD.replace('Lanterns', 'Benches')}${Q1}${A1}`]]) })
  try {
    assert.deepEqual(page.all('[data-brainstorm-need]').map(one => one.dataset.brainstormNeed), [PATH], 'the one that waits for you, not the one the partner has')
  } finally { await page.close() }
})
