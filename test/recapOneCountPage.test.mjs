// One count for the recap, everywhere (T17.1 / T20.1, the person, 2026-11-04: "I'm confused. what do you mean 5 verdicts wait while of the 5
// open now, only 1 is done? And when we open the demo i see only 3 items... These numbers are all over the place and non consistent."),
// the page's side: the same "N to judge" on the card in Needs your attention, the Focus page's card (tiles at most 3, then "+K more in the
// recap"), the popup's head and the Needs count; the popup's rows being reworked and its section of kept looks; the work blocks' chips and
// the line under "Open now" in the same words. Made-up garden names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { demoPage } from '../src/demo.mjs'
import { roundPage } from '../src/demoFeedback.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const PATH = 'pictures/g6/recap/demo.json'
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = minutes => sinceOf(NOW - minutes * MIN)

const built = (id, { result = null, fix = null, fixOf = null, more = '' } = {}) => parseItem([
  `Id: ${id}`, 'Kind: step', `Title: Task ${id}`, 'State: review', 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, ...(fixOf === null ? [] : [`Fix of: ${fixOf}`]), '',
  '## What we build', '- a round pond', '', ...(more === '' ? [] : ['## Context', `  ${more}`, '']),
  '## History', `- ${at(300)} Digger: in progress → review`, `- ${at(299)} server: check passed: merged`,
  ...(result === null ? [] : [`- ${at(200)} Checker: result check ${result === 'failed' ? `failed: 1 of 2 points pass; fix ${fix} for Digger` : `${result}: 2 of 2 points pass`}`]), ''].join('\n'))
const step = (id, state, fixOf = null) => parseItem([`Id: ${id}`, 'Kind: step', `Title: Task ${id}`, `State: ${state}`, 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, ...(fixOf === null ? [] : [`Fix of: ${fixOf}`]), ''].join('\n'))
const askKept = (n, title) => parseItem(`Id: Q${n}\nKind: ask\nTitle: ${title}\nState: open\nOwner: Digger\nSince: ${at(40)}\nFiled: ${NOW - 40 * MIN}\nPictures: art/B9/after${n}.jpg\nAsks: look\nBlocking: no\nAdvice: yes\nOf: B9\nRoute: recap\n\n## Route\n${KEPT}\n`)
const row = (key, steps) => ({ key, title: key, steps, pending: false, changed: true })
const goals = (count, round = false) => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...Array.from({ length: count }, (_, n) => `    Part: Block ${n + 1} · about 1 h · steps B${n + 1} · done when: line ${n + 1}`), '    How agreed: 2026-10-18 11:00',
  ...(round ? [`    Round: ${at(100)} · the evaluation of 2026-10-18`] : []), ''].join('\n')
const classesOf = node => [...node.children].map(child => child.className.split(' ')[0])

/** `rows` ready rows (steps B1..) and two kept looks of the done step B9, Autopilot on. */
const withLooks = rows => asSent(build(
  [...Array.from({ length: rows }, (_, n) => built(`B${n + 1}`, { result: 'passed' })), step('B9', 'done'), askKept(590, 'Does the wizard\'s move range look right?'), askKept(591, 'Does the bridge look right?')],
  undefined, goals(rows), { recaps: [{ path: PATH, goal: 'G6', parts: Array.from({ length: rows }, (_, n) => row(`Row ${n + 1}`, [`B${n + 1}`])), rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON },
))

/** What the board answers to GET /api/demo for the state's recap round: the page of the round, with the rows being reworked and the looks of the state. */
const popupOf = (state, rows, more = {}) => {
  const page = roundPage(demoPage({ goal: 'G6', title: 'Garden', sections: [{ kind: 'open', rows: rows.map(title => ({ title, note: `${title} note`, pictures: [{ kind: 'final', caption: 'in the game', path: `${title.replace(/\W+/g, '-')}.png` }], ...(more[title] ?? {}) })) }] }, 'pictures/g6/recap'), null,
    { rework: new Map(Object.entries(state.recapRound.rework)), looks: state.recapRound.looks })
  return { ...page, feedback: { ...page.feedback, canSend: page.feedback.toJudge > 0, whyNot: null } }
}
const opened = async (state, give) => {
  const page = await openPage({ state, answers: request => (request.url.startsWith('/api/demo?') ? reply(give) : reply({})) })
  await settle(10)
  return page
}

// ---------------------------------------------------------------------------------------------------------------------
// The same number

test('1 ready row and 2 kept looks are 3 to judge on the Product owner\'s card, the Needs count, the Focus card, the progress line and the popup\'s head', async () => {
  const state = withLooks(1)
  const page = await opened(state, popupOf(state, ['Row 1']))
  try {
    assert.equal(page.text('#needs .is-recap-ready h4'), 'G6 · Garden: your recap is ready · 3 to judge')
    assert.equal(page.text('#needs-count'), '3', 'the Needs count carries the same number')
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 3 to judge')
    assert.match(words(page.find('.focus-progress small')), / · 3 to judge$/)
    assert.equal(page.all('.focus-recap-tile').length, 3, 'three tiles: the row and the two looks')
    assert.equal(page.all('.focus-recap-more').length, 0, 'nothing is left out')
    await page.click('.focus-recap-open')
    await settle(10)
    assert.equal(page.find('#demo-page').open, true)
    assert.equal(words(page.find('.demo-round')), 'Round 1 · 3 to judge')
    // The words of the popup\'s Send panel agree: 3 to answer, in the order of the page (the row, then the looks).
    assert.deepEqual(page.all('.demo-answer-jump').map(words), ['Row 1', 'Does the wizard\'s move range look right?', 'Does the bridge look right?'])
  } finally { await page.close() }
})

test('the Focus card shows three tiles whatever waits, and what is left out is one quiet link: 4 ready rows and 2 looks are 6 to judge, "+3 more in the recap"', async () => {
  const state = withLooks(4)
  const page = await opened(state, popupOf(state, ['Row 1', 'Row 2', 'Row 3', 'Row 4']))
  try {
    assert.equal(page.text('#needs-count'), '6')
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 6 to judge')
    assert.deepEqual([page.all('.focus-recap-tiles').length, page.all('.focus-recap-tile').length], [1, 3], 'one row of three')
    const more = page.find('.focus-recap-more')
    assert.equal(words(more), '+3 more in the recap')
    assert.equal(more.dataset.demo, PATH, 'it opens the recap')
    await page.click('.focus-recap-more')
    await settle(10)
    assert.equal(words(page.find('.demo-round')), 'Round 1 · 6 to judge')
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The popup

test('the popup: a row being reworked says which step and who, with no picture, no buttons and no place in the Send; the kept looks have a section of their own', async () => {
  const base = asSent(build(
    [built('B1', { result: 'passed' }), built('B2', { result: 'failed', fix: 'B22' }), step('B22', 'new', 'B2'), built('B3', { result: 'failed', fix: 'B33' }), step('B33', 'in progress', 'B3'), step('B9', 'done'), askKept(590, 'Does the wizard\'s move range look right?'), askKept(591, 'Does the bridge look right?')],
    undefined, goals(3), { recaps: [{ path: PATH, goal: 'G6', parts: [row('Row 1', ['B1']), row('Row 2', ['B2']), row('Row 3', ['B3'])], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON },
  ))
  // The state names the worker of a card that shows B33: here none does, the page words what the board gave it.
  const give = popupOf(base, ['Row 1', 'Row 2', 'Row 3'])
  give.looks[0] = { ...give.looks[0], text: 'It stands a little low.\nSee the second picture.', play: 'main&arena=ring' }
  give.sections[0].rows[2].rework = { step: 'B33', worker: 'Worker 4', words: 'B33 · Worker 4' }
  const page = await opened(base, give)
  try {
    await page.click('[data-tab="advice"]')
    await page.click('.focus-recap-open')
    await settle(10)
    assert.equal(words(page.find('.demo-round')), 'Round 1 · 3 to judge', '1 ready row + 2 looks')
    assert.deepEqual(page.all('.demo-row').map(one => one.dataset.demoRow), ['Row 1', 'Row 2', 'Row 3', 'look:Q590', 'look:Q591'])
    const [ready, ground, cliffs] = page.all('.demo-row')
    assert.deepEqual(classesOf(ready), ['demo-row-title', 'demo-row-note', 'demo-pictures', 'demo-feedback'])
    // A row being reworked: the title, then one line, nothing else.
    assert.deepEqual(classesOf(ground), ['demo-row-title', 'demo-reworking'], 'no note, no picture')
    assert.equal(words(ground.querySelector('.demo-reworking')), 'Being reworked: B22 · waiting for a worker')
    assert.equal(words(cliffs.querySelector('.demo-reworking')), 'Being reworked: B33 · Worker 4')
    assert.equal(ground.querySelectorAll('.demo-picture, .demo-feedback, [data-demo-verdict]').length, 0)
    // The section of the kept looks.
    const section = page.find('.demo-section.is-looks')
    assert.equal(words(section.querySelector('.demo-band')), 'Looks kept for your recap')
    const [first, second] = [...section.querySelectorAll('.demo-row')]
    assert.deepEqual(classesOf(first), ['demo-row-title', 'demo-row-note', 'demo-row-note', 'demo-pictures', 'demo-play', 'demo-feedback'], 'title, its words, its pictures, its Play link, Approve / Send back')
    assert.match(words(first.querySelector('.demo-row-title')), /Does the wizard's move range look right\?/)
    assert.deepEqual([...first.querySelectorAll('.demo-row-note')].map(words), ['It stands a little low.', 'See the second picture.'])
    assert.equal(first.querySelectorAll('.demo-picture').length, 1)
    assert.equal(first.querySelector('.demo-play').getAttribute('href'), '/#play=main&arena=ring')
    assert.deepEqual([...first.querySelectorAll('.demo-feedback button')].map(words), ['Approve', 'Send back'])
    assert.deepEqual(classesOf(second), ['demo-row-title', 'demo-pictures', 'demo-feedback'], 'a look with no words and no play link draws neither')
    // The side panel lists what can be answered: the ready row and the two looks, never a row being reworked.
    assert.deepEqual(page.all('.demo-answer-jump').map(words), ['Row 1', 'Does the wizard\'s move range look right?', 'Does the bridge look right?'])
    // One Send: the row and the looks, the looks keyed by their ask.
    await page.click('[data-demo-verdict="approved"][data-demo-key="Row 1"]')
    await page.click('[data-demo-verdict="approved"][data-demo-key="look:Q590"]')
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="look:Q591"]')
    await page.type('[data-demo-comment="look:Q591"]', 'the bridge is too long')
    await page.click('[data-demo-send]')
    await settle(10)
    assert.deepEqual(page.sent('/api/demo-feedback').map(one => one.body.parts), [[
      { key: 'Row 1', verdict: 'approved', comment: '' }, { key: 'look:Q590', verdict: 'approved', comment: '' }, { key: 'look:Q591', verdict: 'sent-back', comment: 'the bridge is too long' },
    ]])
  } finally { await page.close() }
})

test('a kept do is a row of the section like a look, with "Done" in place of "Approve", and counts with the looks', async () => {
  const state = withLooks(1)
  state.recapRound.looks[1] = { ...state.recapRound.looks[1], asks: 'do', title: 'Reopen the Q600 play link' }
  const give = popupOf(state, ['Row 1'])
  const page = await opened(state, give)
  try {
    await page.click('[data-tab="advice"]')
    await page.click('.focus-recap-open')
    await settle(10)
    assert.equal(words(page.find('.demo-round')), 'Round 1 · 3 to judge', '1 ready row + a kept look + a kept do')
    const [look, todo] = page.all('.demo-section.is-looks .demo-row')
    assert.deepEqual([[...look.querySelectorAll('.demo-feedback button')].map(words), words(look.querySelector('.demo-verdict'))], [['Approve', 'Send back'], 'A look'])
    assert.deepEqual([[...todo.querySelectorAll('.demo-feedback button')].map(words), words(todo.querySelector('.demo-verdict'))], [['Done', 'Send back'], 'To do'])
    await page.click('[data-demo-verdict="approved"][data-demo-key="look:Q591"]')
    assert.equal(words(page.all('.demo-answer')[2].querySelector('.demo-answer-words')), 'done', 'the side panel says done for a do')
    await page.click('[data-demo-send]')
    await settle(10)
    assert.deepEqual(page.sent('/api/demo-feedback').map(one => one.body.parts), [[{ key: 'look:Q591', verdict: 'approved', comment: '' }]])
  } finally { await page.close() }
})

test('a Send of looks alone is a Send; a look sent back needs its note; with every row approved the looks are still to answer', async () => {
  const state = withLooks(1)
  const give = popupOf(state, ['Row 1'])
  const page = await opened(state, give)
  try {
    await page.click('[data-tab="advice"]')
    await page.click('.focus-recap-open')
    await settle(10)
    await page.click('[data-demo-verdict="sent-back"][data-demo-key="look:Q590"]')
    await page.click('[data-demo-send]')
    assert.match(page.text('.demo-problem'), /a part sent back needs a comment/)
    assert.deepEqual(page.sent('/api/demo-feedback'), [])
    await page.type('[data-demo-comment="look:Q590"]', 'too low')
    await page.click('[data-demo-send]')
    await settle(10)
    assert.deepEqual(page.sent('/api/demo-feedback').map(one => one.body.parts), [[{ key: 'look:Q590', verdict: 'sent-back', comment: 'too low' }]])
  } finally { await page.close() }
  // Every row approved, a look left: no "the recap is done", the looks are to answer.
  const all = roundPage(demoPage({ goal: 'G6', title: 'Garden', sections: [{ kind: 'open', rows: [{ title: 'Row 1', pictures: [{ kind: 'final', caption: 'x', path: 'a.png' }] }] }] }, 'pictures/g6/recap'),
    { rounds: [{ n: 1, at: '2026-11-02 16:17', parts: [{ key: 'Row 1', verdict: 'approved', comment: '' }] }] }, { looks: state.recapRound.looks })
  const left = await opened(state, { ...all, feedback: { ...all.feedback, canSend: true, whyNot: null } })
  try {
    await left.click('[data-tab="advice"]')
    await left.click('.focus-recap-open')
    await settle(10)
    assert.equal(left.all('.demo-done').length, 0, 'not done: two looks are left')
    assert.deepEqual(left.all('.demo-answer-jump').map(words), ['Does the wizard\'s move range look right?', 'Does the bridge look right?'])
    assert.equal(words(left.find('.demo-round')), 'Round 1 · 2 to judge')
  } finally { await left.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// Open now

const live = () => asSent(build(
  [
    parseItem(`Id: B1\nKind: step\nTitle: Task B1\nState: done\nOwner: Digger\nGoal: G6\nSince: ${at(50)}\n\n## History\n- ${at(300)} Digger: new\n- ${at(50)} Digger: review → done\n`),
    built('B2', { result: 'passed', more: 'Recap verdict: waits (Q2)' }),
    built('B3', { result: 'failed', fix: 'B31' }), built('B31', { result: 'failed', fix: 'B32', fixOf: 'B3' }), step('B32', 'new', 'B31'),
    built('B4', { result: 'failed', fix: 'B41' }), built('B41', { result: 'failed', fix: 'B42', fixOf: 'B4' }), step('B42', 'new', 'B41'),
    step('B5', 'in progress'),
    parseItem(`Id: Q2\nKind: ask\nTitle: Approve block 2?\nState: open\nOwner: Digger\nSince: ${at(40)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: B2\nRoute: recap\n`),
  ],
  undefined, goals(5, true), { recaps: [{ path: PATH, goal: 'G6', parts: [row('Ring', ['B2']), row('Ground', ['B3']), row('Cliffs', ['B4'])], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON },
))

test('Open now in the same words as the recap: one block waits for the verdict in the recap, three are being reworked, one is done; the line under it counts the same', async () => {
  const state = live()
  const page = await opened(state, {})
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.match(words(page.find('.focus-round')), /· 1 of 5 done · 1 waits for your verdict · 3 being reworked · the next evaluation starts round 3$/)
    assert.deepEqual(page.all('.focus-open-block').map(one => [words(one.querySelector('.focus-bullet-text')), one.querySelector('.focus-chip')?.textContent ?? null]), [
      ['Block 1', null],
      ['Block 2', 'Waits for your verdict in the recap →'],
      ['Block 3', 'Being reworked: B32 · waiting for a worker'],
      ['Block 4', 'Being reworked: B42 · waiting for a worker'],
      ['Block 5', 'Being reworked: B5 · Digger is on it'],
    ])
    // The worker is the one whose card shows the step (Digger's does, B5 is his); a step nobody's card shows is "waiting for a worker".
    // The block that waits for the verdict opens the recap at its row; "Waiting, nobody on it now" is said of none of them.
    assert.deepEqual(page.all('.focus-open-block .focus-chip.is-verdict').map(one => [one.tagName, one.dataset.demo, one.dataset.demoPart]), [['A', PATH, 'Ring']])
    assert.equal(page.all('.focus-open-block .focus-chip.is-rework').length, 3)
    assert.doesNotMatch(page.text('.focus-open-now'), /Waiting, nobody on it now|In progress/)
    // All work blocks says the same of each block.
    await page.click('[data-focus-blocks="all"]')
    assert.deepEqual(page.all('.focus-part .focus-chip').map(words), ['Done', 'Waits for your verdict in the recap →', 'Being reworked: B32 · waiting for a worker', 'Being reworked: B42 · waiting for a worker', 'Being reworked: B5 · Digger is on it'])
  } finally { await page.close() }
})

test('a block being reworked names the worker whose card shows its step', async () => {
  const state = live()
  const open = state.focus.openNow.find(one => one.title === 'Block 5')
  open.rework = { step: 'B5', worker: 'Worker 4', words: 'B5 · Worker 4' }
  const page = await opened(state, {})
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.equal(words(page.all('.focus-open-block')[4].querySelector('.focus-chip')), 'Being reworked: B5 · Worker 4')
  } finally { await page.close() }
})

test('a block made in this round is being built, not reworked: it keeps its own chip', async () => {
  const state = live()
  // Block 5 is new in this round (the page never calls a block made in the round "reworked", whatever it is handed).
  const open = state.focus.openNow.find(one => one.title === 'Block 5')
  open.kind = 'new'
  const page = await opened(state, {})
  try {
    await page.click('[data-tab="advice"]')
    await page.click('[data-focus-blocks="open"]')
    assert.match(words(page.find('.focus-round')), /· 1 of 5 done · 1 waits for your verdict · 2 being reworked · /)
    assert.doesNotMatch(words(page.all('.focus-open-block')[4]), /Being reworked/)
    assert.equal(words(page.all('.focus-open-block')[4].querySelector('.focus-chip')), 'Digger is on it')
  } finally { await page.close() }
})
