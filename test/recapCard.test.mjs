// "Your recap is ready" (the person, 2026-11-01: "where do i see this recap... I expected a button where is clearly visually i
// need to give a recap?"; on the mock: "i never want more then 1 row of information. if e.g. 6 verdicts await then i want it
// visually to look the same, except the 3 into 6"; and on a block that read "Waiting, nobody on it now": "says waiting for
// verdict or something"). The card on the Focus page (one row of at most 3 tiles, one big button), its count with Autopilot's
// recap asks folded in, and the chip "Waits for your verdict →" on a block, in both views. Made-up garden project.
import assert from 'node:assert/strict'
import test from 'node:test'

import { recapCardOf, scoreOf, tilePictureOf } from '../src/recapCard.mjs'
import { recapWaitsOf } from '../src/recaps.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const PATH = 'pictures/g6/recap/demo.json'
/** The garden goal with `count` work blocks, each one task (B1, B2, ...), in its run. */
const goals = count => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...Array.from({ length: count }, (_, at) => `    Part: Block ${at + 1} · about 1 h · steps B${at + 1} · done when: line ${at + 1}`), '    How agreed: 2026-10-18 11:00', ''].join('\n')
/** A task of the garden, built and in review, its ask Q<n> routed to the goal's recap (Autopilot: `Recap verdict: waits`). */
const task = (n, more = '', sections = '') => parseItem(`Id: B${n}\nKind: step\nTitle: Task B${n}\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n${more}\n## Context\n  Recap verdict: waits (Q${n})\n${sections}`)
const askFor = (n, of = `B${n}`) => parseItem(`Id: Q${n}\nKind: ask\nTitle: Approve block ${n} at 64 of 75?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 40 * MIN)}\nFiled: ${NOW - 40 * MIN}\nAsks: look\nBlocking: no\nOf: ${of}\nRoute: recap\n`)
/** The recap: one part per block (`names`), each naming its task; `rounds` the person's sends. */
const recap = (count, rounds = []) => ({ path: PATH, goal: 'G6', parts: Array.from({ length: count }, (_, at) => ({ key: `Block ${at + 1}`, title: `Block ${at + 1}`, steps: [`B${at + 1}`] })), rounds, changedAt: null })
/** The state the board sends for `count` blocks all waiting in a recap (their tasks in review, their asks routed to it). */
const waiting = (count, { rounds = [], pictures = [], extra = [] } = {}) => asSent(build(
  [...Array.from({ length: count }, (_, at) => task(at + 1)), ...Array.from({ length: count }, (_, at) => askFor(at + 1)), ...extra],
  undefined, goals(count), { recaps: [recap(count, rounds)], recapPictures: pictures },
))
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const focusOf = async state => {
  const page = await openPage({ state })
  await page.click('[data-tab="advice"]')
  return page
}

test('the card: its count is the parts waiting ("1 verdict waits"), with at most 3 tiles in the recap\'s order, whatever waits', () => {
  for (const [count, tiles, title] of [[1, 1, '1 verdict waits'], [3, 3, '3 verdicts wait'], [6, 3, '6 verdicts wait']]) {
    const card = waiting(count).recapCard
    assert.equal(card.count, count)
    assert.equal(card.tiles.length, tiles, `${count} waiting show ${tiles} tiles`)
    assert.deepEqual(card.tiles.map(one => one.title), Array.from({ length: tiles }, (_, at) => `Block ${at + 1}`))
    assert.equal(card.path, PATH)
    assert.ok(card.isBuilt, 'every block waits for the verdict: everything is built')
    assert.equal(title, `${count} ${count === 1 ? 'verdict waits' : 'verdicts wait'}`)
  }
})

test('the card is gone once nothing waits: every part approved, or no recap at all', () => {
  const approved = [{ n: 1, at: '2026-10-31 12:40', parts: [1, 2].map(n => ({ key: `Block ${n}`, verdict: 'approved', comment: '' })) }]
  assert.equal(waiting(2, { rounds: approved }).recapCard, null)
  assert.equal(asSent(build([task(1), askFor(1)], undefined, goals(1))).recapCard, null)
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
  const state = waiting(2, { pictures: [{ path: PATH, pictures: { 'Block 1': 'pictures/g6/b1.png' } }], extra: [scoredTask] })
  assert.deepEqual(state.recapCard.tiles.map(one => [one.title, one.picture, one.line]), [['Block 1', 'pictures/g6/b1.png', '64 of 75 · approve or send back'], ['Block 2', null, 'approve or send back']])
})

test('Autopilot\'s recap asks are counted: a part sent back that still has an open ask waits; an ask whose step no part names stays listed, under the card', () => {
  const sentBack = [{ n: 1, at: sinceOf(NOW - 3 * 60 * MIN), parts: [{ key: 'Block 1', verdict: 'sent-back', comment: 'still stepped' }] }]
  // B1's part was sent back and its ask Q1 is still open: it waits. B3 is no part of the recap: its ask Q3 is outside it.
  const state = asSent(build([task(1), task(2), task(3), askFor(1), askFor(2), askFor(3)], undefined, goals(3), { recaps: [recap(2, sentBack)] }))
  assert.equal(state.recapCard.count, 2, 'Block 1 (its ask) and Block 2 (not judged yet)')
  assert.deepEqual(state.recapCard.outside, ['Q3'])
  assert.equal(state.recapCard.isBuilt, false, 'a part is out with the partner: the card says what is ready')
  // Without the open ask the sent-back part is the partner\'s, not the person\'s.
  const quiet = asSent(build([task(1), task(2), askFor(2)], undefined, goals(2), { recaps: [recap(2, sentBack)] }))
  assert.deepEqual([quiet.recapCard.count, quiet.recapCard.tiles.map(one => one.title)], [1, ['Block 2']])
})

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
    assert.equal(page.text('.focus-progress small'), '0 of 3 work blocks done · the rest waits for your verdict')
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
  const page = await focusOf(asSent(build(items, undefined, goals(2), { recaps: [recap(1)] })))
  try {
    assert.equal(page.text('.focus-recap-ready h3'), 'Your recap is ready · 1 verdict waits')
    assert.equal(page.text('.focus-recap-ready p'), 'Judge what is ready: approve it, or send it back with a note.')
    assert.doesNotMatch(page.text('.focus-progress small'), /waits for your verdict/, 'Block 2 is still being built')
  } finally { await page.close() }
})

test('the page: the card\'s links open the recap, a tile at its part; an ask outside the recap stands under the card, one line', async () => {
  const demo = { goal: 'G6', title: 'Garden', intro: 'x', step: null, followUp: null, sections: [{ kind: 'reached', band: 'REACHED', verdict: 'Reached', intro: [], items: [], rows: [1, 2, 3].map(n => ({ key: `Block ${n}`, steps: [`B${n}`], title: `Block ${n}`, note: '', pictures: [] })) }] }
  const answers = request => (request.url.startsWith('/api/demo?') ? reply(demo) : reply({}))
  const state = asSent(build([task(1), task(2), task(3), askFor(1), askFor(2), askFor(3, 'B9'), parseItem(`Id: B9\nKind: step\nTitle: A task outside\nState: review\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 90 * MIN)}\n`)], undefined, goals(3), { recaps: [recap(2)] }))
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

// ---------------------------------------------------------------------------------------------------------------------
// The chip on a block

const ago = minutes => NOW - minutes * MIN
const reviewed = (id, minutes, more = [], head = {}, sections = {}) => parseItem([
  ...Object.entries({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'review', Owner: 'Digger', Goal: 'G6', Since: stamp(ago(minutes)), ...head }).map(([key, value]) => `${key}: ${value}`), '',
  '## What we build', '- a round pond', '', ...Object.entries(sections).flatMap(([name, lines]) => [`## ${name}`, ...lines, '']),
  '## History', `- ${stamp(ago(minutes))} server: check passed: merged`, ...more, ''].join('\n'))
const failedCheck = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 1 of 2 points pass; fix ${fix} for Digger`
const CHECKED = { Checked: ['Score: 1 of 2', '- pass: round', '- fail: smooth'] }
const fixOf = (id, of, state, head = {}) => parseItem(`Id: ${id}\nKind: step\nTitle: Fix: ${of}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${stamp(ago(100))}\nFix of: ${of}\n${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)

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
  assert.deepEqual(focus.parts[0].verdictAt, { path: PATH, key: 'Block 1' })
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
  const asks = asSent(build([task(1), askFor(1)], undefined, goals(1)))
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
  const page = await focusOf(asSent(build([done, task(2), askFor(2)], undefined, goals(2), { recaps: [recap(2)] })))
  try {
    assert.equal(page.text('.focus-progress small'), '1 of 2 work blocks done · the rest waits for your verdict')
  } finally { await page.close() }
})

test('the recap\'s waits as the board reads them: only a part the person has not judged waits for them (the card counts those)', () => {
  const waits = recapWaitsOf([recap(2, [{ n: 1, at: sinceOf(NOW), parts: [{ key: 'Block 1', verdict: 'approved', comment: '' }] }])])
  assert.deepEqual(waits.map(one => [one.step, one.verdict]), [['B2', null]])
  assert.equal(recapCardOf({ goal: 'G6', waits, blocks: [] }).count, 1)
  assert.equal(recapCardOf({ goal: 'G7', waits, blocks: [] }), null, 'another goal\'s recap is no card of this one')
})
