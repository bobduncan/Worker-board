// "Your recap is ready" (the person, 2026-11-01: "where do i see this recap... I expected a button where is clearly visually i
// need to give a recap?"; on the mock: "i never want more then 1 row of information. if e.g. 6 verdicts await then i want it
// visually to look the same, except the 3 into 6"; and on a block that read "Waiting, nobody on it now": "says waiting for
// verdict or something"). The card on the Focus page (one row of at most 3 tiles, one big button), its count (the recap's parts
// that wait, the work blocks whose step waits for the person in another form, the goal's own "play it" ask), and the chip
// "Waits for your verdict →" on a block, in both views. Made-up garden project.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { parseConfig } from '../src/config.mjs'
import { askedStepsOf, isVerdictAsk, recapCardOf, scoreOf, standingAsksOf, tilePictureOf, wholeGoalAskOf } from '../src/recapCard.mjs'
import { recapWaitsOf } from '../src/recaps.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const PATH = 'pictures/g6/recap/demo.json'
/** The garden's settings with Autopilot on (the default of the fixtures is off). */
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
/** The garden goal with `count` work blocks, each one task (B1, B2, ...), in its run. */
const goals = count => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...Array.from({ length: count }, (_, at) => `    Part: Block ${at + 1} · about 1 h · steps B${at + 1} · done when: line ${at + 1}`), '    How agreed: 2026-10-18 11:00', ''].join('\n')
/** A task of the garden, built and in review, its ask Q<n> routed to the goal's recap (Autopilot: `Recap verdict: waits`). */
const task = (n, more = '', sections = '', state = 'review') => parseItem(`Id: B${n}\nKind: step\nTitle: Task B${n}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n${more}\n## Context\n  Recap verdict: waits (Q${n})\n${sections}`)
const askFor = (n, of = `B${n}`, more = '') => parseItem(`Id: Q${n}\nKind: ask\nTitle: Approve block ${n} at 64 of 75?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: ${of}\nRoute: recap\n${more}`)
/** The recap: one part per block, each naming its task; `rounds` the person's sends. */
const recap = (count, rounds = []) => ({ path: PATH, goal: 'G6', parts: Array.from({ length: count }, (_, at) => ({ key: `Block ${at + 1}`, title: `Block ${at + 1}`, steps: [`B${at + 1}`] })), rounds, changedAt: null })
/** The state the board sends for `count` blocks all waiting in a recap (their tasks in review, their asks routed to it; Autopilot on). */
const waiting = (count, { rounds = [], pictures = {}, extra = [], config = ON } = {}) => asSent(build(
  [...Array.from({ length: count }, (_, at) => task(at + 1)), ...Array.from({ length: count }, (_, at) => askFor(at + 1)), ...extra],
  undefined, goals(count), { recaps: [recap(count, rounds)], goalRecap: { goal: 'G6', path: PATH, pictures }, config },
))
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const focusOf = async state => {
  const page = await openPage({ state })
  await page.click('[data-tab="advice"]')
  return page
}

test('the card: its count is the parts waiting ("1 verdict waits"), with at most 3 tiles in the recap\'s order, whatever waits', () => {
  for (const [count, tiles] of [[1, 1], [3, 3], [6, 3]]) {
    const card = waiting(count).recapCard
    assert.equal(card.count, count)
    assert.equal(card.tiles.length, tiles, `${count} waiting show ${tiles} tiles`)
    assert.deepEqual(card.tiles.map(one => one.title), Array.from({ length: tiles }, (_, at) => `Block ${at + 1}`))
    assert.deepEqual(card.tiles[0].target, { path: PATH, key: 'Block 1' })
    assert.deepEqual(card.open, { path: PATH })
    assert.ok(card.isBuilt, 'every block waits for the verdict: everything is built')
  }
})

test('the card is gone once nothing waits: every part approved and its task done, or no recap and nothing asked', () => {
  const approved = [{ n: 1, at: '2026-10-31 12:40', parts: [1, 2].map(n => ({ key: `Block ${n}`, verdict: 'approved', comment: '' })) }]
  const done = [task(1, '', '', 'done'), task(2, '', '', 'done')]
  assert.equal(asSent(build(done, undefined, goals(2), { recaps: [recap(2, approved)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON })).recapCard, null)
  // A goal with a recap file and nothing waiting: no card either (it shows only while a verdict waits).
  assert.equal(asSent(build(done, undefined, goals(2), { recaps: [], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON })).recapCard, null)
  assert.equal(asSent(build([task(1, '', '', 'in progress')], undefined, goals(1))).recapCard, null)
  assert.equal(asSent(build([], undefined)).recapCard, null, 'no focus, no card')
})

test('a tile: its part\'s picture (the last final one), its score beside its target when the step has one, else a calm line', () => {
  assert.equal(tilePictureOf([{ kind: 'target', path: 'a.png' }, { kind: 'final', path: 'b.png' }, { kind: 'between', path: 'c.png' }]), 'b.png', 'the result, not the last listed')
  assert.equal(tilePictureOf([{ kind: 'target', path: 'a.png' }, { kind: 'between', path: 'c.png' }]), 'c.png')
  assert.equal(tilePictureOf([]), null)
  const scored = parseItem('Id: B1\nKind: step\nTitle: t\nState: review\n\n## Standard\nlook · pictures/ref.png · target 75\n\n## Checked\nScore: 64 of 70\n- pass: round\n')
  assert.equal(scoreOf(scored), '64 of 75', 'the target is the standard\'s')
  assert.equal(scoreOf(parseItem('Id: B2\nKind: step\nTitle: t\nState: review\n')), null)
  // Block 1's task carries the score and the standard (the later item of the same id replaces the plain one).
  const scoredTask = task(1, '', ['', '## Standard', 'look · pictures/ref.png · target 75', '', '## Checked', 'Score: 64 of 70', '- pass: round', ''].join(String.fromCharCode(10)))
  const state = waiting(2, { pictures: { 'Block 1': 'pictures/g6/b1.png' }, extra: [scoredTask] })
  assert.deepEqual(state.recapCard.tiles.map(one => [one.title, one.picture, one.line]), [['Block 1', 'pictures/g6/b1.png', '64 of 75 · approve or send back'], ['Block 2', null, 'approve or send back']])
})

test('Autopilot\'s recap asks count only while Autopilot is on: a part sent back that still has an open ask waits; a block no part names is one more; an ask of no block stays listed', () => {
  const sentBack = [{ n: 1, at: sinceOf(NOW - 3 * 60 * MIN), parts: [{ key: 'Block 1', verdict: 'sent-back', comment: 'still stepped' }] }]
  const outsider = parseItem(`Id: B9\nKind: step\nTitle: A task outside\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
  const items = [task(1), task(2), task(3), outsider, askFor(1), askFor(2), askFor(3), askFor(9)]
  // On: B1's part was sent back and its ask Q1 is still open: it waits; Block 2 is not judged; Block 3 names no part (one more); Q9's step is of no block.
  const on = asSent(build(items, undefined, goals(3), { recaps: [recap(2, sentBack)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON }))
  assert.equal(on.recapCard.count, 3, 'Block 1 (its ask), Block 2 (not judged yet), Block 3 (no part names it)')
  assert.deepEqual(on.recapCard.tiles.map(one => one.title), ['Block 1', 'Block 2', 'Block 3'])
  assert.deepEqual(on.recapCard.tiles[2].target, { step: 'B3' })
  assert.deepEqual(on.recapCard.outside, ['Q9'])
  assert.equal(on.recapCard.isBuilt, false, 'a part is out with the partner: the card says what is ready')
  // Off: those asks stand in Needs your attention, not in the card: only the part nobody judged counts.
  const off = asSent(build(items, undefined, goals(3), { recaps: [recap(2, sentBack)], goalRecap: { goal: 'G6', path: PATH, pictures: {} } }))
  assert.deepEqual([off.recapCard.count, off.recapCard.tiles.map(one => one.title), off.recapCard.outside], [1, ['Block 2'], []])
})

// ---------------------------------------------------------------------------------------------------------------------
// The live G60's shape: a recap file whose rows name no steps; the person's verdicts stand as an Accept card, a look, an ask

const ago = minutes => NOW - minutes * MIN
const reviewed = (id, minutes, more = [], head = {}, sections = {}) => parseItem([
  ...Object.entries({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'review', Owner: 'Digger', Goal: 'G6', Since: stamp(ago(minutes)), ...head }).map(([key, value]) => `${key}: ${value}`), '',
  '## What we build', '- a round pond', '', ...Object.entries(sections).flatMap(([name, lines]) => [`## ${name}`, ...lines, '']),
  '## History', `- ${stamp(ago(minutes))} server: check passed: merged`, ...more, ''].join('\n'))
const failedCheck = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 1 of 2 points pass; fix ${fix} for Digger`
const CHECKED = { Checked: ['Score: 1 of 2', '- pass: round', '- fail: smooth'] }
const fixOf = (id, of, state, head = {}) => parseItem(`Id: ${id}\nKind: step\nTitle: Fix: ${of}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${stamp(ago(100))}\nFix of: ${of}\n${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const open = (id, fields) => parseItem(`${Object.entries({ Id: id, Kind: 'ask', State: 'open', Owner: 'Digger', Since: stamp(ago(30)), Filed: ago(30), Blocking: 'no', ...fields }).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
const qa = (id, of, state) => parseItem(`Id: ${id}\nKind: step\nTitle: Quality Assurance: ${of}\nState: ${state}\nOwner: Painter\nGoal: G6\nChecks: ${of}\nSince: ${stamp(ago(20))}\n`)

/**
 * Block 1: its check failed, its fix B11 failed too, B11's fix B12 was dropped, and the board filed the person's Accept card Q20 on
 * B11. Block 2: B2 is built; its look Q21 stands with the person. The goal's own ask Q22: "Open the recap and try it". The recap file
 * (\`PATH\`) has rows that name no steps, so no part of it waits.
 */
const live = (more = [], config = parseConfig('{}', {})) => asSent(build([
  reviewed('B1', 900, [failedCheck(800, 'B11')], {}, CHECKED),
  reviewed('B11', 170, [failedCheck(127, 'B12')], { 'Fix of': 'B1' }),
  fixOf('B12', 'B11', 'dropped'),
  open('Q20', { Title: 'Accept B11 at 64 of 75, or send it back?', Asks: 'decide', Of: 'B11', Via: 'accept', Pictures: 'pictures/g6/b11.png' }),
  reviewed('B2', 60, [], {}, { Checked: ['Score: 68 of 75', '- pass: round'] }),
  open('Q21', { Title: 'Approve the second block as it is, at 68 of 75?', Asks: 'look', Of: 'B2', Pictures: 'pictures/g6/b2.png' }),
  open('Q22', { Title: `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${PATH}).`, Asks: 'do' }),
  ...more,
], undefined, goals(2), { recaps: [], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: { ...config, project: 'C:\\garden' } }))

test('the live shape: blocks whose step waits for an Accept card or a look, and the goal\'s own ask, make the card: 3 verdicts, in that order', () => {
  const { focus, recapCard: card } = live()
  assert.deepEqual(focus.parts.map(one => [one.state, one.verdictAt]), [['verdict', { step: 'B11' }], ['verdict', { step: 'B2' }]])
  assert.equal(card.count, 3)
  assert.deepEqual(card.tiles.map(one => [one.title, one.target, one.picture, one.line]), [
    ['Block 1', { step: 'B11' }, 'pictures/g6/b11.png', 'approve or send back'],
    ['Block 2', { step: 'B2' }, 'pictures/g6/b2.png', '68 of 75 · approve or send back'],
    ['The whole goal: play it', { path: PATH }, null, 'is G6 reached?'],
  ])
  assert.deepEqual(card.open, { path: PATH }, 'the recap file when there is one')
  assert.equal(card.isBuilt, true)
  // The step lines say what they wait for; the chain's parent follows its last link.
  assert.deepEqual(focus.parts[0].steps.map(one => one.state), ['Waits for your verdict'])
  // With no recap file the button opens the first item's window.
  const bare = asSent(build([reviewed('B2', 60, [], {}, { Checked: ['Score: 68 of 75', '- pass: round'] }), open('Q21', { Title: 'Approve the second block?', Asks: 'look', Of: 'B2' })], undefined, goals(2)))
  assert.deepEqual([bare.recapCard.count, bare.recapCard.open], [1, { step: 'B2' }])
})

test('a verdict is none yet while a check of its step is still open: not counted, not "verdict"', () => {
  // B2's look stands with the person, but its Quality Assurance task is still in progress.
  const checking = live([qa('B30', 'B2', 'in progress')])
  assert.equal(checking.focus.parts[1].state, 'now', 'a step being checked is at work, not waiting for the verdict')
  assert.deepEqual(checking.recapCard.tiles.map(one => one.title), ['Block 1', 'The whole goal: play it'])
  // Done, the check no longer holds it.
  assert.equal(live([qa('B30', 'B2', 'done')]).focus.parts[1].state, 'verdict')
  // A recap part whose step is being checked does not count either.
  const part = asSent(build([task(1), askFor(1), qa('B31', 'B1', 'queued')], undefined, goals(1), { recaps: [recap(1)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON }))
  assert.equal(part.recapCard, null)
})

test('"Waits for your verdict" before any recap exists links to the step, never a dead arrow (Autopilot)', () => {
  const state = asSent(build([task(1), askFor(1)], undefined, goals(1), { config: ON }))
  assert.deepEqual([state.focus.parts[0].state, state.focus.parts[0].verdictAt], ['verdict', { step: 'B1' }])
  assert.deepEqual(state.recapCard.tiles[0].target, { step: 'B1' })
  // A route-recap ask counts only while Autopilot is on: off, nothing is a verdict.
  const off = asSent(build([task(1), askFor(1)], undefined, goals(1)))
  assert.notEqual(off.focus.parts[0].state, 'verdict')
  assert.equal(off.recapCard, null)
})

test('a worker\'s own question mid-build is no verdict: a step waiting on you with a blocking decide gives no card; a step in review whose decide approves or sends back does', () => {
  const step = state => parseItem(`Id: B1\nKind: step\nTitle: Plant the hedge\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
  const hedge = open('Q30', { Title: 'Which hedge do you want?', Asks: 'decide', Of: 'B1', Blocking: 'yes', Options: 'A box | B yew' })
  // The exact case: the worker waits on the person's choice mid-build.
  const mid = asSent(build([step('waiting on you'), hedge], undefined, goals(1)))
  assert.notEqual(mid.focus.parts[0].state, 'verdict')
  assert.equal(mid.focus.parts[0].steps[0].waitsForVerdict, false)
  assert.equal(mid.recapCard, null)
  // The same question on a step in review (its result built) is still a choice, not a verdict on a result.
  const built = asSent(build([step('review'), hedge], undefined, goals(1)))
  assert.notEqual(built.focus.parts[0].state, 'verdict')
  assert.equal(built.recapCard, null)
  // A step waiting on you with a look is a worker's question too: only a step in review has a result to judge.
  assert.equal(asSent(build([step('waiting on you'), open('Q31', { Title: 'Does this read right?', Asks: 'look', Of: 'B1' })], undefined, goals(1))).recapCard, null)
  // A decide between approving and sending back is a verdict; so is a look or an Accept card (the live shape above).
  const verdict = open('Q32', { Title: 'The hedge as it stands?', Asks: 'decide', Of: 'B1', Options: 'A Approve: keep it as it is | B Send back: the partner makes another try' })
  const judged = asSent(build([step('review'), verdict], undefined, goals(1)))
  assert.deepEqual([judged.focus.parts[0].state, judged.recapCard?.count], ['verdict', 1])
  assert.deepEqual([isVerdictAsk({ asks: 'look' }), isVerdictAsk({ asks: 'decide', via: 'accept', options: [] }), isVerdictAsk({ asks: 'decide', options: ['A box', 'B yew'] }), isVerdictAsk({ asks: 'decide', options: [] }), isVerdictAsk({ asks: 'do' })], [true, true, false, false, false])
})

test('the standing asks: a refine question, a partner\'s or the main chat\'s, and a route-recap ask with Autopilot off are not the person\'s', () => {
  const items = new Map([
    open('Q1', { Title: 'Look?', Asks: 'look', Of: 'B1' }), open('Q2', { Title: 'Refine?', Asks: 'decide', Of: 'B1', Via: 'refine' }), open('Q3', { Title: 'Partner?', Asks: 'decide', Of: 'B1', Route: 'partner' }),
    open('Q4', { Title: 'Main?', Asks: 'do', Route: 'main' }), open('Q5', { Title: 'Recap?', Asks: 'look', Of: 'B1', Route: 'recap' }), open('Q6', { Title: 'Do it', Asks: 'do', Of: 'B1' }),
  ].map(one => [one.head.get('Id'), one]))
  assert.deepEqual(standingAsksOf(items, { autopilot: false, now: NOW }).map(one => one.id), ['Q1', 'Q6'])
  assert.deepEqual(standingAsksOf(items, { autopilot: true, now: NOW }).map(one => one.id), ['Q1', 'Q5', 'Q6'])
  assert.deepEqual([...askedStepsOf(standingAsksOf(items, { autopilot: true, now: NOW })).entries()].map(([step, asks]) => [step, asks.map(one => one.id)]), [['B1', ['Q1', 'Q5']]], 'looks and decides of steps only')
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

test('the page: the card sits under the head and above the work-block switch; its words, one button and one row of tiles', async () => {
  const page = await focusOf(waiting(3))
  try {
    assert.deepEqual(page.all('#advisor-focus > *').slice(0, 4).map(one => one.className.split(' ')[0]), ['focus-head', 'focus-recap-ready', 'focus-blocks-switch', 'focus-body'])
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 3 verdicts wait')
    assert.equal(page.text('.focus-recap-ready p'), 'Everything is built. Judge each part: approve it, or send it back with a note.')
    const open = page.find('.focus-recap-open')
    assert.equal(open.textContent, 'Open the recap')
    assert.equal(open.getAttribute('href'), `#demo=${encodeURIComponent(PATH)}`)
    assert.equal(open.dataset.demo, PATH)
    assert.equal(page.all('.focus-recap-tiles').length, 1, 'one row')
    assert.deepEqual(page.all('.focus-recap-tile').map(one => [one.querySelector('b').textContent, one.querySelector('small').textContent, one.dataset.demoPart]), [1, 2, 3].map(n => [`Block ${n}`, 'approve or send back', `Block ${n}`]))
    assert.equal(page.all('.focus-recap-pic.is-none').length, 3, 'no picture: a calm placeholder')
    // The head's line: every block still open waits for the person.
    assert.equal(page.text('.focus-progress small'), '0 of 3 work blocks done · 3 verdicts wait for you' /* 2026-11-01 ("B"): the line counts the verdicts while the card shows */)
  } finally { await page.close() }
})

test('the page: with 6 waiting the card looks the same as with 3, only its title says 6; with 1 it reads "1 verdict waits"', async () => {
  const shapeOf = page => ({ rows: page.all('.focus-recap-tiles').length, tiles: page.all('.focus-recap-tile').length, button: page.text('.focus-recap-open'), line: page.text('.focus-recap-ready p'), outside: page.all('.focus-recap-outside').length })
  const six = await focusOf(waiting(6))
  const three = await focusOf(waiting(3))
  const one = await focusOf(waiting(1))
  try {
    assert.equal(six.text('.focus-recap-ready h3'), 'Your recap is ready · 6 verdicts wait')
    assert.deepEqual(shapeOf(six), shapeOf(three))
    assert.equal(shapeOf(six).tiles, 3)
    assert.deepEqual(six.all('.focus-recap-tile b').map(node => node.textContent), ['Block 1', 'Block 2', 'Block 3'], 'the first three, in the recap\'s order')
    assert.equal(one.text('.focus-recap-ready h3'), 'Your recap is ready · 1 verdict waits')
    assert.equal(one.all('.focus-recap-tile').length, 1)
    // The Autopilot list of "For your recap" is folded into the card: no second list on the page.
    assert.equal(six.all('.focus-recap-wait, .focus-recap-head').length, 0)
  } finally { await Promise.all([six.close(), three.close(), one.close()]) }
})

test('the page: parts still being built say so; a block still at work is not "waiting for the verdict"', async () => {
  const items = [task(1), askFor(1), parseItem(`Id: B2\nKind: step\nTitle: Task B2\nState: in progress\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)]
  const page = await focusOf(asSent(build(items, undefined, goals(2), { recaps: [recap(1)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON })))
  try {
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 1 verdict waits')
    assert.equal(page.text('.focus-recap-ready p'), 'Judge what is ready: approve it, or send it back with a note.')
    assert.doesNotMatch(page.text('.focus-progress small'), /waits for your verdict/, 'Block 2 is still being built')
  } finally { await page.close() }
})

test('"Did we reach the goal?" is not drawn while verdicts wait: the recap comes first; with none waiting it shows as before', async () => {
  // Every part waits for the recap: the goal is at its recap moment (src/state.mjs `forDemo`), so the question would show without the card.
  const card = await focusOf(waiting(2))
  try {
    assert.equal(card.all('.focus-recap-ready').length, 1)
    assert.equal(card.all('.focus-there').length, 0, 'no question while the card shows')
    assert.equal(card.all('.focus-yes').length, 0, 'and no Yes')
  } finally { await card.close() }
  // The person judged every part and their tasks are done: nothing waits for a verdict, the question comes back.
  const approved = [{ n: 1, at: '2026-10-31 12:40', parts: [1, 2].map(n => ({ key: `Block ${n}`, verdict: 'approved', comment: '' })) }]
  const done = await focusOf(asSent(build([task(1, '', '', 'done'), task(2, '', '', 'done')], undefined, goals(2), { recaps: [recap(2, approved)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON })))
  try {
    assert.equal(done.all('.focus-recap-ready').length, 0)
    assert.equal(done.text('.focus-there h3'), 'Did we reach the goal?')
  } finally { await done.close() }
})

test('the page: the card\'s links open the recap, a tile at its part; an ask outside the recap stands under the card, one line', async () => {
  const demo = { goal: 'G6', title: 'Garden', intro: 'x', step: null, followUp: null, sections: [{ kind: 'reached', band: 'REACHED', verdict: 'Reached', intro: [], items: [], rows: [1, 2, 3].map(n => ({ key: `Block ${n}`, steps: [`B${n}`], title: `Block ${n}`, note: '', pictures: [] })) }] }
  const answers = request => (request.url.startsWith('/api/demo?') ? reply(demo) : reply({}))
  const items = [task(1), task(2), task(3), askFor(1), askFor(2), askFor(3, 'B9'), parseItem(`Id: B9\nKind: step\nTitle: A task outside\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)]
  const state = asSent(build(items, undefined, goals(3), { recaps: [recap(2)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON }))
  const page = await openPage({ state, answers })
  try {
    await page.click('[data-tab="advice"]')
    const outside = page.find('.focus-recap-ready + .focus-recap-outside')
    assert.match(words(outside), /^For your recap, not in it yet \(1\):\s*Q3 · Approve block 3 at 64 of 75\?/)
    const scrolled = []
    page.window.HTMLElement.prototype.scrollIntoView = function scroll() { scrolled.push(this.dataset.demoRow) }
    await page.click('.focus-recap-tile:nth-child(2)')
    await settle(10)
    assert.deepEqual(page.requests.filter(one => one.url.startsWith('/api/demo?')).map(one => one.url), [`/api/demo?path=${encodeURIComponent(PATH)}`])
    assert.deepEqual(scrolled, ['Block 2'], 'the recap opens at the part of the tile')
    assert.doesNotMatch(page.window.location.hash, /demo/, 'the click opens it in place: the address names no demo')
    await page.click('[data-close-demo]')
    await page.click('.focus-recap-open')
    await settle(10)
    assert.equal(page.requests.filter(one => one.url.startsWith('/api/demo?')).length, 2)
    assert.deepEqual(scrolled, ['Block 2'], 'the button opens the top, no part')
  } finally { await page.close() }
  // The address names a part too: `#demo=<path>&part=<key>`.
  const linked = await openPage({ state, answers, hash: `demo=${encodeURIComponent(PATH)}&part=${encodeURIComponent('Block 3')}` })
  try {
    await settle(10)
    assert.deepEqual(linked.requests.filter(one => one.url.startsWith('/api/demo?')).map(one => one.url), [`/api/demo?path=${encodeURIComponent(PATH)}`], 'the part is no part of the path')
  } finally { await linked.close() }
})

test('the page, the live shape: three tiles, the step\'s window for an Accept card or a look, the recap for the goal\'s ask; the chips link to the step', async () => {
  const demo = { goal: 'G6', title: 'Garden', intro: 'x', step: null, followUp: null, sections: [] }
  const page = await openPage({ state: live(), answers: request => (request.url.startsWith('/api/demo?') ? reply(demo) : reply({})) })
  try {
    await page.click('[data-tab="advice"]')
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 3 verdicts wait')
    assert.deepEqual(page.all('.focus-recap-tile').map(one => [one.tagName, one.querySelector('b').textContent, one.dataset.askLink ?? one.dataset.demo]), [['BUTTON', 'Block 1', 'B11'], ['BUTTON', 'Block 2', 'B2'], ['A', 'The whole goal: play it', PATH]])
    assert.equal(page.all('.focus-recap-tiles').length, 1, 'still one row')
    assert.deepEqual([page.find('.focus-recap-open').tagName, page.find('.focus-recap-open').dataset.demo], ['A', PATH])
    assert.equal(page.text('.focus-progress small'), '0 of 2 work blocks done · 3 verdicts wait for you' /* 2026-11-01 ("B"): the line counts the verdicts while the card shows */)
    // The chips: "Waits for your verdict →", a button to the step where the card or the ask stands.
    assert.deepEqual(page.all('.focus-part .focus-chip').map(one => [one.textContent, one.tagName, one.dataset.askLink]), [['Waits for your verdict →', 'BUTTON', 'B11'], ['Waits for your verdict →', 'BUTTON', 'B2']])
    await page.click('[data-focus-blocks="open"]')
    assert.deepEqual(page.all('.focus-open-block .focus-chip').map(one => [one.textContent, one.dataset.askLink]), [['Waits for your verdict →', 'B11'], ['Waits for your verdict →', 'B2']])
  } finally { await page.close() }
})

// ---------------------------------------------------------------------------------------------------------------------
// The chip on a block

/**
 * Block 1: its check failed, its fix B11 failed too, B11's fix B12 was dropped while the part waits for the person's verdict in
 * the recap (the chain's last link waits for the recap). Block 2: the same chain, but B21 is blocked by the open B30, another task.
 */
const chains = () => asSent(build([
  reviewed('B1', 900, [failedCheck(800, 'B11')], {}, CHECKED),
  reviewed('B11', 170, [failedCheck(127, 'B12')], { 'Fix of': 'B1' }),
  fixOf('B12', 'B11', 'dropped'),
  reviewed('B2', 900, [failedCheck(800, 'B21')], {}, CHECKED),
  reviewed('B21', 170, [failedCheck(127, 'B22')], { 'Fix of': 'B2', 'Blocked by': 'B30' }),
  fixOf('B22', 'B21', 'dropped'),
  parseItem(`Id: B30\nKind: step\nTitle: Another task\nState: in progress\nOwner: Painter\nSince: ${stamp(ago(60))}\n`),
], undefined, goals(2), { recaps: [{ path: PATH, goal: 'G6', parts: [{ key: 'Block 1', title: 'Block 1', steps: ['B1', 'B11'] }], rounds: [], changedAt: null }] }))

test('a block whose fix chain waits for the person\'s verdict is "verdict"; one that waits for another task stays "waiting"', () => {
  const { focus } = chains()
  assert.deepEqual(focus.parts.map(one => one.state), ['verdict', 'waiting'])
  assert.deepEqual(focus.parts[0].verdictAt, { path: PATH, key: 'Block 1' }, 'the recap names the step: the arrow opens the recap')
  assert.equal(focus.parts[0].steps[0].state, 'Waits for your verdict')
  assert.match(focus.parts[0].steps[0].check.fix.note, /waits for your verdict in the recap of G6/)
  assert.equal(focus.parts[1].steps[0].state, 'Fix waiting')
  // Without the recap naming the step it is what it was: a stopped fix, not a verdict.
  const bare = asSent(build([
    reviewed('B1', 900, [failedCheck(800, 'B11')], {}, CHECKED), reviewed('B11', 170, [failedCheck(127, 'B12')], { 'Fix of': 'B1' }), fixOf('B12', 'B11', 'dropped'),
  ], undefined, goals(1)))
  assert.notEqual(bare.focus.parts[0].state, 'verdict')
})

test('a step with "Recap verdict: waits" and a dropped-fix step whose part waits are "verdict" too', () => {
  const asks = asSent(build([task(1), askFor(1)], undefined, goals(1), { config: ON }))
  assert.deepEqual([asks.focus.parts[0].state, asks.focus.parts[0].steps[0].state], ['verdict', 'Waits for your verdict'])
  const dropped = asSent(build([
    reviewed('B1', 170, [failedCheck(127, 'B12')], {}, CHECKED), fixOf('B12', 'B1', 'dropped'),
  ], undefined, goals(1), { recaps: [{ path: PATH, goal: 'G6', parts: [{ key: 'Block 1', title: 'Block 1', steps: ['B1'] }], rounds: [], changedAt: null }] }))
  assert.deepEqual([dropped.focus.parts[0].state, dropped.focus.parts[0].steps[0].tone], ['verdict', 'wait'], 'planned, never "Fix stopped"')
})

test('both views: the chip reads "Waits for your verdict →" and opens the recap at its part; the block waiting for a task keeps its words', async () => {
  const demo = { goal: 'G6', title: 'Garden', intro: 'x', step: null, followUp: null, sections: [] }
  const page = await openPage({ state: chains(), answers: request => (request.url.startsWith('/api/demo?') ? reply(demo) : reply({})) })
  try {
    await page.click('[data-tab="advice"]')
    // All work blocks.
    assert.deepEqual(page.all('.focus-part .focus-chip').map(one => one.textContent), ['Waits for your verdict →', 'Waiting, nobody on it now'])
    const chip = page.find('.focus-part .focus-chip.is-verdict')
    assert.deepEqual([chip.tagName, chip.dataset.demo, chip.dataset.demoPart], ['A', PATH, 'Block 1'])
    assert.equal(page.find('.focus-part .focus-chip.is-waiting').tagName, 'SPAN', 'the other chip is plain words')
    // Open now.
    await page.click('[data-focus-blocks="open"]')
    assert.deepEqual(page.all('.focus-open-block .focus-chip').map(one => one.textContent), ['Waits for your verdict →', 'Waiting, nobody on it now'])
    assert.equal(page.find('.focus-open-block .focus-chip.is-verdict').dataset.demoPart, 'Block 1')
    // A click on the chip opens the recap.
    await page.click('.focus-open-block .focus-chip.is-verdict')
    await settle(10)
    assert.deepEqual(page.requests.filter(one => one.url.startsWith('/api/demo?')).map(one => one.url), [`/api/demo?path=${encodeURIComponent(PATH)}`])
    // One block waits for another task: the head does not say the rest waits for the verdict.
    assert.doesNotMatch(page.text('.focus-progress small'), /waits for your verdict/)
  } finally { await page.close() }
})

test('the head\'s line: when every open block waits for the verdict it says so, with the done blocks counted', async () => {
  const done = parseItem(`Id: B1\nKind: step\nTitle: Task B1\nState: done\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
  const page = await focusOf(asSent(build([done, task(2), askFor(2)], undefined, goals(2), { recaps: [recap(2)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON })))
  try {
    assert.equal(page.text('.focus-progress small'), '1 of 2 work blocks done · 2 verdicts wait for you' /* 2026-11-01 ("B"): the line counts the verdicts while the card shows */)
  } finally { await page.close() }
})

test('the recap\'s waits as the board reads them: only a part the person has not judged waits for them (the card counts those)', () => {
  const waits = recapWaitsOf([recap(2, [{ n: 1, at: sinceOf(NOW), parts: [{ key: 'Block 1', verdict: 'approved', comment: '' }] }])])
  assert.deepEqual(waits.map(one => [one.step, one.verdict]), [['B2', null]])
  assert.equal(recapCardOf({ goal: 'G6', waits, blocks: [] }).count, 1)
  assert.equal(recapCardOf({ goal: 'G7', waits, blocks: [] }), null, 'another goal\'s recap is no card of this one')
  // Only ONE recap file counts: a part of another file of the goal is left out when the goal's file is named.
  const two = [...waits, { ...waits[0], path: 'pictures/g6/demo/demo.json', key: 'Old', title: 'Old' }]
  assert.deepEqual(recapCardOf({ goal: 'G6', recapPath: PATH, waits: two, blocks: [] }).tiles.map(one => one.title), ['Block 2'])
})

test('2026-11-01 (the person, "B"): while verdicts wait the run\'s stage reads "Your recap" in the attention colour; the progress line counts them', async () => {
  const page = await focusOf(waiting(3))
  try {
    const stages = page.all('.focus-stage').map(one => [one.className, words(one)])
    assert.deepEqual(stages.map(([, text]) => text), ['1The goal✓', '2Work blocks✓', '3Your recap'])
    assert.match(stages[2][0], /\bis-recap\b/)
    assert.match(words(page.find('.focus-progress small')), / · 3 verdicts wait for you$/)
    assert.ok(page.find('.focus-bar').className.includes('is-recap'))
  } finally { await page.close() }
})

test('2026-11-02 (the person: "Yes, fix it"): the recap\'s bar is amber, not the green of a wide bar', () => {
  const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')
  const green = css.indexOf('.focus-bar.is-wide span')
  const amber = css.search(/\.focus-bar\.is-wide\.is-recap span \{ background: #e3a52b; \}/)
  assert.ok(green >= 0 && amber > green, 'the amber rule outweighs the green one and stands after it')
  assert.doesNotMatch(css, /\.focus-bar\.is-recap span/, 'no lighter amber rule the green one overrides')
})

test('2026-11-02 (Autopilot, switched on): the goal\'s own ask moved into the recap still makes the "play it" tile, and is no ask outside the card', () => {
  const link = `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${PATH}).`
  const state = waiting(1, { extra: [open('Q23', { Title: link, Asks: 'do', Route: 'recap' }), open('Q24', { Title: 'Is the whole goal there?', Asks: 'look', Route: 'recap' })] })
  assert.deepEqual(state.routedAway.map(one => [one.id, one.route, one.of, one.asks]), [['Q1', 'recap', 'B1', 'look'], ['Q23', 'recap', null, 'do'], ['Q24', 'recap', null, 'look']])
  const card = state.recapCard
  assert.equal(card.count, 2, 'Block 1 and the whole goal')
  assert.deepEqual(card.tiles.map(one => [one.title, one.target]), [['Block 1', { path: PATH, key: 'Block 1' }], ['The whole goal: play it', { path: PATH }]])
  // Q23 links the recap, so it is the goal's own ask; Q24 (a step-less ask of no link) is listed under the card, as an ask of no block was.
  assert.deepEqual(state.recapCard.outside, ['Q24'])
  // Off, they stand in Needs your attention, not in the card.
  const off = waiting(1, { extra: [open('Q23', { Title: link, Asks: 'do', Route: 'recap' })], config: parseConfig('{}', {}) })
  assert.equal(off.recapCard.tiles.some(one => one.title === 'The whole goal: play it'), false)
  // The card itself, given the ask as an `asked` entry only (not a standing one).
  const asked = [{ id: 'Q23', of: null, asks: 'do', title: link, text: '', pictures: ['pictures/g6/whole.png'] }]
  const direct = recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], asked })
  assert.deepEqual([direct.count, direct.tiles.map(one => [one.title, one.picture]), direct.outside], [1, [['The whole goal: play it', 'pictures/g6/whole.png']], []])
  assert.deepEqual(recapCardOf({ goal: 'G6', recapPath: null, waits: [], asked }), null, 'with no recap file the ask is nothing to play')
})

test('2026-11-02 (review): only the first of the goal\'s own asks is the "play it" tile, every further one is listed outside the card; the link reads in any case and with any slashes', () => {
  const link = file => `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${file}).`
  const slash = String.fromCharCode(92)
  const extra = [
    open('Q23', { Title: link(PATH), Asks: 'do', Route: 'recap' }),
    open('Q25', { Title: link(PATH.toUpperCase().replace('.JSON', '.json')), Asks: 'do', Route: 'recap' }),
    open('Q26', { Title: link(PATH.replaceAll('/', slash)), Asks: 'look', Route: 'recap' }),
  ]
  const card = waiting(1, { extra }).recapCard
  assert.equal(card.count, 2, 'Block 1 and one "play it" tile, not three')
  assert.deepEqual(card.tiles.map(one => one.title), ['Block 1', 'The whole goal: play it'])
  assert.deepEqual(card.outside, ['Q25', 'Q26'], 'the second and third are listed under the card')
  // Given as routed asks only, the first is the tile and the rest are outside; a link in other case is the same file.
  const asked = ['Q31', 'Q32'].map((id, at) => ({ id, of: null, asks: 'do', title: link(at === 0 ? PATH.toUpperCase().replace('.JSON', '.json') : PATH), text: '', pictures: [] }))
  const direct = recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], asked })
  assert.deepEqual([direct.count, direct.tiles.length, direct.outside], [1, 1, ['Q32']])
  assert.equal(wholeGoalAskOf(asked, 'G6', PATH).id, 'Q31')
})

// ---------------------------------------------------------------------------------------------------------------------
// 2026-11-02, the person's "A" (the live Q590) and the coordinator's rulings: a look the partner handed to the person that Autopilot keeps
// for the recap (its Route line is the kept line) is a tile of its own where no recap part names its step; it raises no card mid-goal.

const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'
const keptLook = (n, of, more = '') => parseItem(`Id: Q${n}\nKind: ask\nTitle: Does the wizard's move range on the terraces look right?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nPictures: art/B9/terraces-after.jpg\nAsks: look\nBlocking: no\nAdvice: yes\nOf: ${of}\nRoute: recap\n${more}\n## Route\n${KEPT}\n`)
const doneStep = (n, state = 'done') => parseItem(`Id: B${n}\nKind: step\nTitle: Whole move squares ${n}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
const keptTile = { title: 'Does the wizard\'s move range on the terraces look right?', line: 'a look · advised: yes', picture: 'art/B9/terraces-after.jpg', target: { ask: 'Q590' } }
const stateOf = (items, count = 1, more = {}) => asSent(build(items, undefined, goals(count), { recaps: [recap(1)], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON, ...more }))

test('a kept look is a tile of its own where no part names its step: its title, "a look · advised: yes", its first picture, its window; it counts and is no ask outside', () => {
  // Block 1 waits in the recap (a reason for the card); B9 is a done step of the goal that no part names: the live Q590.
  const card = stateOf([task(1), askFor(1), doneStep(9), keptLook(590, 'B9')], 2).recapCard
  assert.equal(card.count, 2, 'Block 1 and the look')
  assert.deepEqual(card.tiles, [{ title: 'Block 1', line: 'approve or send back', picture: null, target: { path: PATH, key: 'Block 1' } }, keptTile])
  assert.deepEqual(card.looks, [keptTile])
  assert.deepEqual(card.outside, [], 'no longer listed under the card')
  assert.deepEqual(card.open, { path: PATH }, 'the recap is still what the card opens')
  // The same look without the kept line (a checker\'s, one below its target) is the old ask outside, no tile.
  const plain = parseItem(`Id: Q591\nKind: ask\nTitle: A checker\'s look\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: B9\nRoute: recap\n`)
  const old = stateOf([task(1), askFor(1), doneStep(9), plain], 2).recapCard
  assert.deepEqual([old.count, old.looks, old.outside], [1, [], ['Q591']])
  // Autopilot off: the look stands in Needs your attention, not in the card.
  assert.equal(stateOf([doneStep(9), keptLook(590, 'B9')], 1, { recaps: [], config: parseConfig('{}', {}) }).recapCard, null)
})

test('a kept look raises no card mid-goal: with no other reason and a block still being built the card is null; with every block built, or any other verdict waiting, it shows', () => {
  // Mid-goal: block 1 in progress, block 2 not started: nothing waits but the kept look, which waits quietly.
  const midGoal = [parseItem(`Id: B1\nKind: step\nTitle: Task B1\nState: in progress\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`), doneStep(9), keptLook(590, 'B9')]
  assert.equal(stateOf(midGoal, 2, { recaps: [] }).recapCard, null)
  // The state sends no look to the page either, and the ask is still among the recap asks (its window opens from the Focus list).
  assert.deepEqual(stateOf(midGoal, 2, { recaps: [] }).routedAway.map(one => [one.id, one.isKept]), [['Q590', true]])
  // Every block built: nothing is left to build, so the look is among the last things the recap waits for.
  const built = stateOf([doneStep(1), doneStep(9), keptLook(590, 'B9')], 1, { recaps: [] }).recapCard
  assert.deepEqual([built.count, built.looks, built.isBuilt], [1, [keptTile], true])
  // Any other verdict waiting is a reason (a part, a block, the goal's own ask).
  assert.equal(stateOf([task(1), askFor(1), doneStep(9), keptLook(590, 'B9')], 2).recapCard.count, 2)
  // Direct: the reasons and the built blocks, by the card's own inputs.
  const asked = [{ id: 'Q590', of: 'B9', asks: 'look', isKept: true, title: 'Look', advice: null, pictures: [], text: '' }]
  const building = [{ title: 'Block 1', state: 'now', steps: [] }]
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], blocks: building, asked }), null)
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], blocks: [{ title: 'Block 1', state: 'done', steps: [] }], asked }).count, 1)
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], blocks: building, asked, standing: [{ id: 'Q9', of: null, asks: 'do', title: 'Open the recap and try it', text: `[recap](#demo=${PATH})`, pictures: [], options: [] }] }).count, 2, 'the goal\'s own ask is a reason')
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [{ goal: 'G6', path: PATH, key: 'Block 1', title: 'Block 1', step: 'B1', verdict: null }], blocks: building, asked }).count, 2, 'a part is a reason')
})

test('a block that covers the kept look\'s step does not take its tile away: the step\'s card and the look are two tiles; a recap part that names the step does cover it', () => {
  // The step B61 is in review and waits for the person's verdict for its own reason (an Accept card): the block is the step's card, and the kept look is its own tile.
  const block = { title: 'Terraces', state: 'verdict', steps: [{ waitsForVerdict: true, verdictAt: { step: 'B61' } }] }
  const asked = [{ id: 'Q590', of: 'B61', asks: 'look', isKept: true, title: 'Look', advice: 'yes', pictures: ['a.png'], text: '' }]
  const card = recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], blocks: [block], asked })
  assert.deepEqual([card.count, card.tiles.map(one => one.target), card.looks.map(one => one.target), card.outside], [2, [{ step: 'B61' }, { ask: 'Q590' }], [{ ask: 'Q590' }], []])
  // A step still being checked holds nothing back for a kept look.
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [], blocks: [], asked, openChecks: new Set(['B61']) }).looks.length, 1)
  // A part of the recap that names the step is the look's verdict: no tile of its own, the part is the tile.
  const part = { goal: 'G6', path: PATH, key: 'Terraces', title: 'Terraces', step: 'B61', verdict: null }
  const covered = recapCardOf({ goal: 'G6', recapPath: PATH, waits: [part], blocks: [], asked })
  assert.deepEqual([covered.count, covered.tiles.map(one => one.title), covered.looks, covered.outside], [1, ['Terraces'], [], []])
})

test('a kept look under a step in review makes no block wait for a verdict and is no reason for the card: B1 in review with it and B2 in progress give no card', () => {
  const review = parseItem(`Id: B1\nKind: step\nTitle: Task B1\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n\n## Context\n  Recap verdict: waits (Q590)\n`)
  const building = parseItem(`Id: B2\nKind: step\nTitle: Task B2\nState: in progress\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)
  const state = stateOf([review, building, keptLook(590, 'B1')], 2, { recaps: [] })
  assert.equal(state.recapCard, null, 'one kept look mid-goal raises no "your recap is ready"')
  const blocks = state.focus.parts
  assert.deepEqual(blocks.map(one => one.state === 'verdict'), [false, false], 'no block waits for a verdict')
  assert.equal(blocks[0].steps[0].waitsForVerdict, false)
  assert.deepEqual(state.routedAway.map(one => [one.id, one.isKept]), [['Q590', true]], 'the ask waits for the recap, quietly')
  // Without the kept line it is the old recap wait: the step waits for the verdict and the card shows.
  const plain = parseItem(`Id: Q590\nKind: ask\nTitle: A checker's look\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: B1\nRoute: recap\n`)
  const old = stateOf([review, building, plain], 2, { recaps: [] })
  assert.equal(old.focus.parts[0].steps[0].waitsForVerdict, true)
  assert.equal(old.recapCard.count, 1)
})

test('which kept looks are tiles: only a look of a step; the line cuts a long advice, the first picture is the tile\'s; all are in `looks`, the row shows three', () => {
  const asked = (id, more = {}) => ({ id, of: 'B9', asks: 'look', isKept: true, title: `Look ${id}`, advice: null, pictures: [], text: '', ...more })
  const part = { goal: 'G6', path: PATH, key: 'Block 1', title: 'Block 1', step: 'B1', verdict: null }
  const tilesOf = list => recapCardOf({ goal: 'G6', recapPath: PATH, waits: [part], asked: list })
  const others = tilesOf([asked('Q5', { asks: 'decide' }), asked('Q6', { of: null }), asked('Q7', { of: 'G6' }), asked('Q8', { isKept: false })])
  assert.deepEqual([others.looks, others.outside], [[], ['Q5', 'Q6', 'Q7', 'Q8']], 'a decide, a look of no step or a goal, a look that is no kept one: listed outside as before')
  const lines = tilesOf([asked('Q8'), asked('Q9', { advice: 'accepting it and keeping 75' }), asked('Q10', { advice: 'A '.repeat(60) })]).looks.map(one => one.line)
  assert.equal(lines[0], 'a look')
  assert.equal(lines[1], 'a look · advised: accepting it and keeping 75')
  assert.match(lines[2], /^a look · advised: (A )+A…$/)
  assert.ok(lines[2].length <= 'a look · advised: '.length + 61, lines[2])
  assert.deepEqual(tilesOf([asked('Q11', { pictures: ['a.png', 'b.png'] }), asked('Q12')]).looks.map(one => one.picture), ['a.png', null])
  const five = tilesOf(['Q21', 'Q22', 'Q23', 'Q24', 'Q25'].map(id => asked(id)))
  assert.deepEqual([five.count, five.tiles.length, five.looks.length], [6, 3, 5])
  assert.deepEqual(five.tiles.map(one => one.title), ['Block 1', 'Look Q21', 'Look Q22'])
  assert.deepEqual(recapCardOf({ goal: 'G6', recapPath: PATH, waits: [part], asked: [] }).looks, [])
})
