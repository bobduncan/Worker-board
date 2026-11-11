// The review of 2026-11-04 on "one count for the recap" (T20.1): the counts still differed in places. The block chips and the Open now line read
// the same round as the card; the card's N is exactly the popup's N (rows ready + kept looks and dos), whatever else waits; whenever N > 0 the card
// shows; a kept look carries its Play link and its words' links; "Being reworked" names the step a worker holds first, by state. Made-up garden names.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { demoPage } from '../src/demo.mjs'
import { roundPage } from '../src/demoFeedback.mjs'
import { recapCardOf } from '../src/recapCard.mjs'
import { keptLooksOf, lookKey, recapRoundOf, reworkOf as reworkOfBare } from '../src/recapRound.mjs'
import { stepStatusOf } from '../src/stepStatus.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

/** P7, the review: `reworkOf` takes the caller's one status (`statusOf`, REQUIRED); these tests pass the store's, as the state does. */
const reworkOf = (ids, items, options = {}) => reworkOfBare(ids, items, { ...options, statusOf: item => stepStatusOf(item, { items, workerOf: options.workerOf ?? (() => null), openChecks: options.openChecks ?? new Set(), now: options.now ?? null }) })

const PATH = 'pictures/g6/recap/demo.json'
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const OFF = { ...parseConfig('{}', {}), project: 'C:\\garden' }
const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
const HANDED_ON = 'Kept for the goal\'s recap: the main chat handed it on'
const at = minutes => sinceOf(NOW - minutes * MIN)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()

/** A step in review whose board check passed and whose result check `result` (passed), or none yet. */
const built = (id, { result = 'passed', more = '' } = {}) => parseItem([
  `Id: ${id}`, 'Kind: step', `Title: Task ${id}`, 'State: review', 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, '',
  '## What we build', '- a round pond', '', ...(more === '' ? [] : ['## Context', `  ${more}`, '']),
  '## History', `- ${at(300)} Digger: in progress → review`, `- ${at(299)} server: check passed: merged`,
  ...(result === null ? [] : [`- ${at(200)} Checker: result check ${result}: 2 of 2 points pass`]), ''].join('\n'))
const step = (id, state, more = []) => parseItem([`Id: ${id}`, 'Kind: step', `Title: Task ${id}`, `State: ${state}`, 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, ...more, ''].join('\n'))
const itemsOf = list => new Map(list.map(one => [one.head.get('Id'), one]))
const keptAsk = (n, of, { asks = 'look', route = KEPT, play = null, title = `Does ${n} look right?`, text = null } = {}) => parseItem([
  `Id: Q${n}`, 'Kind: ask', `Title: ${title}`, 'State: open', 'Owner: Digger', `Since: ${at(40)}`, `Filed: ${NOW - 40 * MIN}`, `Pictures: art/B9/after${n}.jpg`,
  `Asks: ${asks}`, 'Blocking: no', 'Advice: yes', `Of: ${of}`, 'Route: recap', '', '## Text', text ?? title, '',
  ...(play === null ? [] : ['## Play', play, '']), '## Route', route, ''].join('\n'))
const row = (key, steps) => ({ key, title: key, steps, pending: false, changed: true })
const goalsOf = parts => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...parts.map(([title, ids], n) => `    Part: ${title} · about 1 h · steps ${ids.join(', ')} · done when: line ${n + 1}`), '    How agreed: 2026-10-18 11:00', ''].join('\n')
const stateOf = (items, parts, rows, { config = ON, rounds = [] } = {}) => asSent(build(items, undefined, goalsOf(parts),
  { recaps: rows.length === 0 ? [] : [{ path: PATH, goal: 'G6', parts: rows, rounds, changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {}, ...(rows.length === 0 ? {} : { rows }) }, config }))

// ---------------------------------------------------------------------------------------------------------------------
// 1. Open now and All work blocks read the same round as the card

const blocksState = (rows = [row('Ring', ['B1'])]) => stateOf(
  [built('B1'), step('B2', 'in progress'), built('B3'), keptAsk(9, 'B3'), step('B4', 'done'), ...(rows.length > 1 ? [built('B5')] : [])],
  [['Rounds', ['B1', 'B2', ...(rows.length > 1 ? ['B5'] : [])]], ['Looks', ['B3']], ['Finished', ['B4']]], rows)

test('a block with a row ready to judge, or a kept look, of its steps waits for the verdict in the recap, whatever its own state; the line counts the card\'s N', async () => {
  const state = blocksState()
  assert.deepEqual([state.recapCard.count, state.recapRound.toJudge], [2, 2])
  // Block 1 is still in progress (B2 is being worked on), yet its row Ring is ready; Block 2's step carries a kept look.
  assert.deepEqual(state.focus.parts.map(one => [one.state, one.toJudge ?? 0, one.recapAt ?? null]), [
    ['now', 1, { path: PATH, key: 'Ring' }], ['now', 1, { path: PATH, key: 'look:Q9' }], ['done', 0, null],
  ])
  const page = await openPage({ state })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.match(words(page.find('.focus-round')), /· 1 of 3 done · 2 wait for your verdict · the next evaluation starts round 2$/, 'the line\'s N is the card\'s N')
    assert.deepEqual(page.all('.focus-open-block').map(one => [words(one.querySelector('.focus-bullet-text')), one.querySelector('.focus-chip')?.textContent ?? null]), [
      ['Rounds', 'Waits for your verdict in the recap →'], ['Looks', 'Waits for your verdict in the recap →'], ['Finished', null],
    ])
    assert.deepEqual(page.all('.focus-open-block .focus-chip.is-verdict').map(one => [one.tagName, one.dataset.demo, one.dataset.demoPart]), [['A', PATH, 'Ring'], ['A', PATH, 'look:Q9']])
    assert.doesNotMatch(page.text('.focus-open-now'), /In progress|is on it|Waiting, nobody on it now/)
    // All work blocks: the same chips.
    await page.click('[data-focus-blocks="all"]')
    assert.deepEqual(page.all('.focus-part .focus-chip').map(words), ['Waits for your verdict in the recap →', 'Waits for your verdict in the recap →', 'Done'])
  } finally { await page.close() }
})

test('the line says the card\'s N when it differs from the number of blocks: two ready rows of one block and a look are 3 to wait for, in 2 blocks', async () => {
  const state = blocksState([row('Ring', ['B1']), row('Moat', ['B5'])])
  assert.equal(state.recapCard.count, 3)
  assert.deepEqual(state.focus.parts.map(one => one.toJudge ?? 0), [2, 1, 0])
  const page = await openPage({ state })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.match(words(page.find('.focus-round')), /· 1 of 3 done · 3 wait for your verdict · /)
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 3 to judge')
  } finally { await page.close() }
})

test('a block with no row ready and no kept look keeps its own words: a block in progress names its worker; a done one has no chip', async () => {
  // Ring's step is still being worked on: the row is being reworked, nothing waits for the verdict.
  const state = stateOf([step('B1', 'in progress'), step('B4', 'done')], [['Rounds', ['B1']], ['Finished', ['B4']]], [row('Ring', ['B1'])])
  assert.equal(state.recapCard, null)
  const page = await openPage({ state })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.deepEqual(page.all('.focus-open-block').map(one => one.querySelector('.focus-chip')?.textContent ?? null), ['Digger is on it', null])
    assert.doesNotMatch(words(page.find('.focus-round')), /wait for your verdict/)
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// 2. The card's N is the popup's N, whatever else waits

test('the card counts the popup\'s N only: an Accept card, a look that stands with the person and the goal\'s own ask are cards of their own, never tiles or a count (pure)', () => {
  const goal = 'G60'
  const path = 'art-inbox/g60/recap/demo.json'
  const goalRecap = { goal, path, rows: [{ key: 'r1', title: '1. A', steps: ['B1'], changed: false, pending: false }], rounds: [], changedAt: null }
  const round = recapRoundOf({ goal, goalRecap, items: new Map() })
  const card = recapCardOf({
    goal, recapPath: path, rows: round.rows.map(one => ({ ...one, path })), looks: round.looks,
    blocks: [{ title: 'Block X', state: 'verdict', steps: [{ id: 'B2', tone: 'wait', waitsForVerdict: true, verdictAt: { step: 'B2' } }] }],
    standing: [{ id: 'Q9', of: 'B2', asks: 'decide', via: 'accept', route: 'person', title: 'Accept B2?', text: '', pictures: [], options: [] },
      { id: 'Q10', of: null, asks: 'do', route: 'person', title: `Open the recap and try it: [Open the recap](#demo=${path})`, text: '', pictures: [], options: [] }],
  })
  assert.deepEqual([round.toJudge, card.count, card.tiles.map(one => one.title)], [1, 1, ['1. A']])
})

test('the card is the popup\'s N in the state, and Needs your attention counts N plus the cards it draws besides: the Accept card, the look and the goal\'s ask each once', async () => {
  const accept = parseItem(`Id: Q20\nKind: ask\nTitle: Accept B1 at 64 of 75, or send it back?\nState: open\nOwner: Digger\nSince: ${at(30)}\nFiled: ${NOW - 30 * MIN}\nAsks: decide\nBlocking: no\nOf: B1\nVia: accept\n`)
  const look = parseItem(`Id: Q21\nKind: ask\nTitle: Approve the second block as it is?\nState: open\nOwner: Digger\nSince: ${at(30)}\nFiled: ${NOW - 30 * MIN}\nAsks: look\nBlocking: no\nOf: B2\n`)
  const whole = parseItem(`Id: Q22\nKind: ask\nTitle: Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${PATH}).\nState: open\nOwner: Digger\nSince: ${at(30)}\nFiled: ${NOW - 30 * MIN}\nAsks: do\nBlocking: no\n`)
  const state = stateOf([built('B1', { result: null }), built('B2'), accept, look, whole], [['Block 1', ['B1']], ['Block 2', ['B2']]], [row('Row 2', ['B2'])], { config: OFF })
  assert.deepEqual([state.recapCard.count, state.recapRound.toJudge, state.recapCard.tiles.map(one => one.title)], [1, 1, ['Row 2']])
  assert.deepEqual(state.forYou.filter(need => need.workId !== undefined).map(need => need.workId).sort(), ['Q20', 'Q21', 'Q22'], 'each stands as its own card')
  const page = await openPage({ state })
  try {
    assert.equal(page.text('#needs-count'), '4', 'N (1) + the three cards')
    assert.equal(page.text('#needs .is-recap-ready h4'), 'G6 · Garden: your recap is ready · 1 to judge')
  } finally { await page.close() }
})

test('an ask the recap card counts as a kept look or do is no card of its own beside it: never counted, never drawn, twice', async () => {
  const state = stateOf([built('B1'), step('B9', 'done'), keptAsk(9, 'B9'), parseItem(`Id: Q30\nKind: ask\nTitle: Which map next?\nState: open\nOwner: Digger\nSince: ${at(30)}\nFiled: ${NOW - 30 * MIN}\nAsks: decide\nBlocking: no\nOptions: A ring | B moat\nRoute: person\n\n## Route\nYour partner hands this to you: it needs your choice\n`)],
    [['Block 1', ['B1', 'B9']]], [row('Ring', ['B1'])])
  assert.equal(state.recapCard.count, 2)
  // The board's state names the same ask twice (as a card of Needs your attention and as a look of the card): the page counts and draws it once.
  const need = state.forYou.find(one => one.workId === 'Q30')
  assert.ok(need !== undefined, 'the person\'s own question stands as a card')
  const twice = { ...state, forYou: [...state.forYou, { ...need, id: 'work:Q9', workId: 'Q9', title: 'Does 9 look right?' }] }
  const page = await openPage({ state: twice })
  try {
    assert.equal(page.text('#needs-count'), '3', 'N (2) + the question; the look is not a card')
    assert.deepEqual(page.all('#needs .need[data-id]').map(node => node.dataset.id), ['work:Q30'])
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// 3. One count wins: whenever N > 0 the card shows

test('whenever N > 0 the card shows "N to judge", also when only kept looks remain mid-goal; N = 0 shows none; the card is the popup\'s N in every shape', () => {
  const midGoal = stateOf([step('B1', 'in progress'), step('B9', 'done'), keptAsk(9, 'B9')], [['Block 1', ['B1']], ['Block 2', ['B9']]], [])
  assert.deepEqual([midGoal.recapCard.count, midGoal.recapRound.toJudge], [1, 1])
  const none = stateOf([step('B1', 'in progress')], [['Block 1', ['B1']]], [row('Ring', ['B1'])])
  assert.deepEqual([none.recapCard, none.recapRound.toJudge], [null, 0])
  for (const state of [blocksState(), blocksState([row('Ring', ['B1']), row('Moat', ['B5'])]), midGoal, none]) {
    assert.equal(state.recapCard?.count ?? 0, state.recapRound.toJudge)
  }
  // The pure card: kept looks alone are a card; no row and no look none.
  const asked = [{ id: 'Q5', of: 'B3', asks: 'look', isKept: true, title: 'Look', advice: null, pictures: [], text: '' }]
  const blocks = [{ title: 'Block Y', state: 'now', steps: [{ id: 'B4', tone: 'now' }] }]
  assert.equal(recapCardOf({ goal: 'G60', recapPath: PATH, rows: [], looks: keptLooksOf([{ id: 'Q5', route: 'recap', isKept: true, asks: 'look', of: 'B3', goal: 'G60', title: 'Look', text: '', pictures: [] }], 'G60'), blocks, asked }).count, 1)
  assert.equal(recapCardOf({ goal: 'G60', recapPath: PATH, rows: [], looks: [], blocks, asked: [] }), null)
})

// ---------------------------------------------------------------------------------------------------------------------
// 4. A kept look carries its Play link; its words' links are links

const Q600 = parseItem(`Id: Q600\nKind: ask\nTitle: Check the stairs in the game, west and east.\nState: answered\nOwner: Digger\nSince: ${at(500)}\nFiled: ${NOW - 500 * MIN}\nAsks: look\nBlocking: no\nOf: B924\nRoute: person\n\n## Text\nCheck the stairs in the game.\n\n## Play\nmain&arena=g60-stairs-side\n`)
const Q616 = keptAsk(616, 'B924', { asks: 'do', route: HANDED_ON, title: 'After the step in Q600, reopen the Q600 play link. [Q600](http://127.0.0.1:4310/#details=Q600)' })
const Q628 = keptAsk(628, 'B920', { play: 'main&arena=ring', title: 'Is the thicker Ring good enough now? I advise yes.', text: 'After your note, the ring is 4 cells at its narrowest. Yes closes it; no sends it back.' })

test('a kept look carries the ask\'s own Play; a kept do that links another ask carries that ask\'s Play (Q616 → Q600\'s map)', () => {
  const state = stateOf([built('B1'), step('B924', 'done'), step('B920', 'done'), Q600, Q616, Q628], [['Block 1', ['B1', 'B924', 'B920']]], [row('Ring', ['B1'])])
  assert.deepEqual(state.recapRound.looks.map(one => [one.ask, one.asks, one.play]), [['Q616', 'do', 'main&arena=g60-stairs-side'], ['Q628', 'look', 'main&arena=ring']])
  assert.deepEqual(state.routedAway.map(one => [one.id, one.play]), [['Q616', 'main&arena=g60-stairs-side'], ['Q628', 'main&arena=ring']])
  // No Play anywhere: none (and a #play= in the words still counts).
  assert.deepEqual(keptLooksOf([{ id: 'Q5', route: 'recap', isKept: true, asks: 'look', of: 'B3', goal: 'G60', title: 'See #play=main&arena=moat', text: '', pictures: [] }, { id: 'Q6', route: 'recap', isKept: true, asks: 'look', of: 'B3', goal: 'G60', title: 'Look', text: '', pictures: [] }], 'G60').map(one => one.play), ['main&arena=moat', null])
})

const popupOf = state => {
  const page = roundPage(demoPage({ goal: 'G6', title: 'Garden', sections: [{ kind: 'open', rows: [{ title: 'Ring', note: 'Ring note', pictures: [{ kind: 'final', caption: 'in the game', path: 'Ring.png' }] }] }] }, 'pictures/g6/recap'), null,
    { rework: new Map(Object.entries(state.recapRound.rework)), looks: state.recapRound.looks })
  return { ...page, feedback: { ...page.feedback, canSend: page.feedback.toJudge > 0, whyNot: null } }
}

test('the popup draws a kept look\'s Play link, and the markdown links of its words as links, never raw', async () => {
  const state = stateOf([built('B1'), step('B924', 'done'), step('B920', 'done'), Q600, Q616, Q628], [['Block 1', ['B1', 'B924', 'B920']]], [row('Ring', ['B1'])])
  const page = await openPage({ state, answers: request => (request.url.startsWith('/api/demo?') ? reply(popupOf(state)) : reply({})) })
  try {
    await page.click('[data-tab="advice"]')
    await page.click('.focus-recap-open')
    await settle(10)
    const [todo, look] = page.all('.demo-section.is-looks .demo-row')
    assert.deepEqual(page.all('.demo-play').map(one => one.getAttribute('href')), ['/#play=main&arena=g60-stairs-side', '/#play=main&arena=ring'])
    assert.equal(todo.querySelectorAll('.demo-play').length, 1)
    assert.equal(look.querySelectorAll('.demo-play').length, 1)
    // The do's title: its words, and "[Q600](...)" drawn as the link to Q600's window.
    assert.doesNotMatch(page.text('.demo-section.is-looks'), /\[Q600\]|\]\(http/, 'no raw markdown')
    const link = todo.querySelector('.ask-link')
    assert.deepEqual([link.tagName, words(link), link.dataset.askLink], ['BUTTON', 'Q600', 'Q600'])
    assert.match(words(todo.querySelector('.demo-row-title')), /After the step in Q600, reopen the Q600 play link\. Q600$/)
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// 5. "Being reworked" names the step a worker holds first, with its words by state

test('rework: the step a worker holds first, else the newest under way; its words by state', () => {
  const chain = itemsOf([built('B1'), step('B2', 'in progress', ['Fix of: B1']), step('B3', 'new', ['Fix of: B2'])])
  // B2 is in progress with its owner (a worker holds it); B3, newer, waits for a worker: B2 first.
  assert.deepEqual(reworkOf(['B1'], chain), { step: 'B2', state: 'in progress', worker: 'Digger', words: 'B2 · Digger is on it' })
  // The worker whose card shows it, when the board knows one.
  assert.deepEqual(reworkOf(['B1'], chain, { workerOf: id => (id === 'B2' ? 'Worker 4' : null) }).words, 'B2 · Worker 4 is on it')
  // A card that shows a newer step is the one a worker holds.
  assert.equal(reworkOf(['B1'], chain, { workerOf: id => (id === 'B3' ? 'Worker 2' : null) }).step, 'B3')
  // No worker anywhere: the newest under way, by its state.
  const queue = itemsOf([step('B5', 'new'), step('B6', 'refined', ['Fix of: B5']), step('B7', 'queued', ['Fix of: B6'])])
  // P7: the words are the step's one status (src/stepStatus.mjs): a queued step is given to its Owner, never "waiting for a worker".
  assert.deepEqual(reworkOf(['B5'], queue), { step: 'B7', state: 'queued', worker: null, words: 'B7 · given to Digger' })
  const ready = [{ id: 'B1' }]
  for (const [state, expected] of [['new', 'waits for its refine: nothing sent to the Advisor yet'], ['refined', 'waiting for a worker'], ['queued', 'given to Digger'], ['taken', 'Digger is on it'], ['in progress', 'Digger is on it'], ['waiting on you', 'waits on you']]) {
    const one = step('B1', state)
    assert.equal(stepStatusOf(one, { items: itemsOf([one]), ready, held: [] }).words, expected, state)
  }
  assert.equal(stepStatusOf(step('B1', 'taken'), { items: itemsOf([step('B1', 'taken')]), workerOf: () => 'Worker 1' }).words, 'Worker 1 is on it')
  // In review with its check still to run: "being checked".
  assert.equal(reworkOf(['B8'], itemsOf([built('B8', { result: null })])).words, 'B8 · being checked')
  assert.equal(reworkOf(['B9'], itemsOf([step('B9', 'waiting on you')])).words, 'B9 · waits on you')
  assert.equal(reworkOf(['B1'], itemsOf([built('B1')])), null)
})

test('the popup\'s row and the block chip say the same words: the worker\'s step first, by state', async () => {
  const items = [built('B1', { result: null }), step('B2', 'in progress'), step('B3', 'new')]
  const state = stateOf(items, [['Block 1', ['B1', 'B2', 'B3']]], [row('Ring', ['B1', 'B2', 'B3'])])
  assert.equal(state.recapRound.rework.Ring.words, 'B2 · Digger is on it')
  assert.equal(state.focus.openNow[0].rework?.words ?? null, null, 'round 1: every block is new, none is reworked')
})
