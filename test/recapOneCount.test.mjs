// One count for the recap, everywhere (T17.1 / T20.1, the person, 2026-11-04, looking at G60's Focus page and its recap: "I'm confused.
// what do you mean 5 verdicts wait while of the 5 open now, only 1 is done? And when we open the demo i see only 3 items... These numbers
// are all over the place and non consistent."). The data side: a row of the recap whose steps (or a fix in their chains) are under way is
// being reworked and asks nothing; the kept looks are rows of the recap; "N to judge" = the rows ready + the kept looks is the one number.
// Made-up garden names only.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { demoPage } from '../src/demo.mjs'
import { checkSend, roundPage, withRound } from '../src/demoFeedback.mjs'
import { readGoalRecap, recapCardOf } from '../src/recapCard.mjs'
import { isUnderWay, keptLooksOf, lookKey, playOf, recapRoundOf, reworkOf, roundRowsOf } from '../src/recapRound.mjs'
import { recapWaitsOf } from '../src/recaps.mjs'
import { parseItem, sinceMs } from '../src/work/item.mjs'
import { recapPartOf } from '../src/work/resultCheck.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'
import { tempDir } from './tempDir.mjs'

const PATH = 'pictures/g6/recap/demo.json'
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const at = minutes => sinceOf(NOW - minutes * MIN)
const KEPT = 'Your partner hands this to you; Autopilot keeps it for the goal\'s recap'

/** A step of the garden in `state`, a fix of `fixOf` when given; `more` are more head lines. */
const step = (id, state, fixOf = null, more = []) => parseItem([`Id: ${id}`, 'Kind: step', `Title: Task ${id}`, `State: ${state}`, 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, ...(fixOf === null ? [] : [`Fix of: ${fixOf}`]), ...more, ''].join('\n'))
/** A step in review whose board check passed and whose result check is `result` ("passed", "failed" with its fix, "waits"), or none yet. */
const built = (id, { result = null, fix = null, fixOf = null, pending = false } = {}) => parseItem([
  `Id: ${id}`, 'Kind: step', `Title: Task ${id}`, 'State: review', 'Owner: Digger', 'Goal: G6', `Since: ${at(300)}`, ...(fixOf === null ? [] : [`Fix of: ${fixOf}`]), '',
  '## What we build', '- a round pond', '',
  '## History', `- ${at(300)} Digger: in progress → review`, `- ${at(299)} server: ${pending ? 'check pending' : 'check passed: merged'}`,
  ...(result === null ? [] : [`- ${at(200)} Checker: result check ${result === 'failed' ? `failed: 1 of 2 points pass; fix ${fix} for Digger` : `${result}: 2 of 2 points pass`}`]), ''].join('\n'))
const itemsOf = list => new Map(list.map(one => [one.head.get('Id'), one]))

// ---------------------------------------------------------------------------------------------------------------------
// A row is ready only when nothing more is done on it

test('under way: a step that is new, refined, queued, taken, in progress or waiting on you; one in review only while its check is still to run', () => {
  for (const state of ['new', 'refined', 'queued', 'taken', 'in progress', 'waiting on you']) assert.equal(isUnderWay(step('B1', state), itemsOf([step('B1', state)])), true, state)
  for (const state of ['done', 'closed', 'dropped']) assert.equal(isUnderWay(step('B1', state), itemsOf([step('B1', state)])), false, state)
  const items = list => itemsOf(list)
  // In review: the result check passed, or waits for the person's answer: nothing is left to do on it.
  assert.equal(isUnderWay(built('B1', { result: 'passed' }), items([built('B1', { result: 'passed' })])), false)
  assert.equal(isUnderWay(built('B1', { result: 'waits' }), items([built('B1', { result: 'waits' }), parseItem(`Id: Q1\nKind: ask\nTitle: Look?\nState: open\nOwner: Digger\nOf: B1\nAsks: look\nSince: ${at(100)}\nFiled: ${NOW - 100 * MIN}\n`)])), false)
  // In review with its check still to run: never filed ("waits for its first check"), a Quality Assurance task open, the board's own check running.
  assert.equal(isUnderWay(built('B1'), items([built('B1')])), true, 'its result check was never filed')
  assert.equal(isUnderWay(built('B1', { result: 'passed' }), items([built('B1', { result: 'passed' })]), { openChecks: new Set(['B1']) }), true, 'a check of it is open')
  assert.equal(isUnderWay(built('B1', { result: 'passed', pending: true }), items([built('B1', { result: 'passed', pending: true })])), true, 'the board\'s check of its report is running')
  // A failed check whose fix is done waits for its check again: still to run.
  assert.equal(isUnderWay(built('B1', { result: 'failed', fix: 'B2' }), items([built('B1', { result: 'failed', fix: 'B2' }), step('B2', 'done', 'B1')])), true)
})

test('rework: the newest step under way among a row\'s steps and every fix in their chains, with its worker or "waiting for a worker"; none when everything is built or done', () => {
  // The live shapes: row 12 (B926 → B963 → B977 new) and row 13 (B927, B966 → B981 new).
  const items = itemsOf([
    built('B2', { result: 'failed', fix: 'B21' }), built('B21', { result: 'failed', fix: 'B22', fixOf: 'B2' }), step('B22', 'new', 'B21'),
    built('B3', { result: 'failed', fix: 'B33' }), built('B33', { result: 'failed', fix: 'B34', fixOf: 'B3' }), step('B34', 'new', 'B33'),
    built('B1', { result: 'passed' }),
  ])
  assert.deepEqual(reworkOf(['B2'], items), { step: 'B22', state: 'new', worker: null, words: 'B22 · waiting for a worker' })
  assert.deepEqual(reworkOf(['B3', 'B1'], items), { step: 'B34', state: 'new', worker: null, words: 'B34 · waiting for a worker' }, 'a row of two steps: the one under way decides')
  assert.deepEqual(reworkOf(['B2'], items, { workerOf: id => (id === 'B22' ? 'Worker 4' : null) }), { step: 'B22', state: 'new', worker: 'Worker 4', words: 'B22 · waiting for a worker' }, 'a card that shows a step under a state that is not taken is still "waiting for a worker"')
  assert.equal(reworkOf(['B1'], items), null, 'every link built and checked: ready')
  assert.equal(reworkOf([], items), null)
  // Every link done or in review with its check done is ready, however long the chain.
  const done = itemsOf([built('B2', { result: 'failed', fix: 'B21' }), built('B21', { result: 'passed', fixOf: 'B2' })])
  assert.equal(reworkOf(['B2'], done), null)
  // The step a worker holds comes first (B5 is in progress with its owner), else the newest under way; a loop in the chain ends it; an id the store does not hold is none.
  const two = itemsOf([step('B5', 'in progress'), step('B25', 'queued', 'B5'), step('B30', 'done', 'B25')])
  assert.equal(reworkOf(['B5'], two).step, 'B5')
  assert.equal(reworkOf(['B5'], itemsOf([step('B5', 'new'), step('B25', 'queued', 'B5'), step('B30', 'done', 'B25')])).step, 'B25')
  const loop = itemsOf([step('B5', 'new', 'B6'), step('B6', 'new', 'B5')])
  assert.equal(reworkOf(['B5'], loop).step, 'B6')
  assert.equal(reworkOf(['B99'], two), null)
})

// ---------------------------------------------------------------------------------------------------------------------
// The state: the live shape

const goals = count => ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', ...Array.from({ length: count }, (_, n) => `    Part: Block ${n + 1} · about 1 h · steps B${n + 1} · done when: line ${n + 1}`), '    How agreed: 2026-10-18 11:00', ''].join('\n')
const row = (key, steps, more = {}) => ({ key, title: key, steps, pending: false, changed: true, ...more })

/** Rows 11, 12 and 13 of G60's shape: the Ring is ready; the Ground has a fix new at the end of its chain; the Cliffs too. Sent back in round 1, the recap written since. */
const live = (more = {}) => {
  const rounds = [{ n: 1, at: at(240), parts: ['Ring', 'Ground', 'Cliffs'].map(key => ({ key, verdict: 'sent-back', comment: 'again' })) }]
  const items = [
    built('B1', { result: 'passed' }),
    built('B2', { result: 'failed', fix: 'B21' }), built('B21', { result: 'failed', fix: 'B22', fixOf: 'B2' }), step('B22', 'new', 'B21'),
    built('B3', { result: 'failed', fix: 'B33' }), built('B33', { result: 'failed', fix: 'B34', fixOf: 'B3' }), step('B34', 'new', 'B33'),
    ...(more.items ?? []),
  ]
  const recap = { path: PATH, goal: 'G6', parts: [row('Ring', ['B1']), row('Ground', ['B2']), row('Cliffs', ['B3', 'B33'])], rounds, changedAt: NOW - 100 * MIN }
  return asSent(build(items, undefined, goals(3), { recaps: [recap], goalRecap: { goal: 'G6', path: PATH, pictures: {}, rounds, changedAt: NOW - 100 * MIN }, config: ON, ...(more.raw ?? {}) }))
}

test('the live shape: the Ring is ready; the Ground and the Cliffs, with a fix new at the end of their chains, are being reworked, asked nothing and counted nowhere', () => {
  const state = live()
  assert.deepEqual(state.recapRound.ready, 1)
  assert.deepEqual(state.recapRound.reworking.map(one => [one.key, one.rework.step, one.rework.words]), [['Ground', 'B22', 'B22 · waiting for a worker'], ['Cliffs', 'B34', 'B34 · waiting for a worker']])
  assert.deepEqual(state.recapRound.rework, { Ground: { step: 'B22', state: 'new', worker: null, words: 'B22 · waiting for a worker' }, Cliffs: { step: 'B34', state: 'new', worker: null, words: 'B34 · waiting for a worker' } })
  assert.equal(state.recapRound.toJudge, 1)
  // The card counts the one ready row, and says nothing of the other two.
  assert.deepEqual([state.recapCard.count, state.recapCard.tiles.map(one => one.title), state.recapCard.isBuilt], [1, ['Ring'], false])
  // The waits of the other two carry that they are being reworked; recapPartOf finds no verdict part in them.
  const waits = state.recapWaits
  assert.deepEqual(waits.map(one => [one.step, one.verdict, one.rework?.step ?? null]), [['B1', null, null], ['B2', null, 'B22'], ['B3', null, 'B34'], ['B33', null, 'B34']], 'every row was tried (the recap was written since); B2, B3 and B33 stand with a fix under way')
  assert.equal(recapPartOf(waits, 'B2'), null, 'a row being reworked waits for no verdict')
  assert.equal(recapPartOf(waits, 'B1').key, 'Ring')
  // The steps of the rows being reworked wait for no verdict either.
  assert.deepEqual(state.focus.parts.map(one => one.steps[0].waitsForVerdict), [false, false, false])
})

test('the same rows with every link built (the fix in review with its check passed): all three are ready, the popup lets the person judge all three', () => {
  const state = live()
  const ready = asSent(build([
    built('B1', { result: 'passed' }), built('B2', { result: 'failed', fix: 'B21' }), built('B21', { result: 'passed', fixOf: 'B2' }),
    built('B3', { result: 'failed', fix: 'B33' }), built('B33', { result: 'passed', fixOf: 'B3' }),
  ], undefined, goals(3), { recaps: [{ path: PATH, goal: 'G6', parts: [row('Ring', ['B1']), row('Ground', ['B2']), row('Cliffs', ['B3', 'B33'])], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON }))
  assert.deepEqual([ready.recapRound.ready, ready.recapRound.reworking.length, ready.recapRound.toJudge, ready.recapCard.count], [3, 0, 3, 3])
  assert.notEqual(state.recapRound.toJudge, ready.recapRound.toJudge, 'the same rows with a fix new at the end are 2 fewer')
})

test('a row that names no step counts too: the card counts the rows the popup shows, from the file\'s rows', () => {
  const rounds = []
  const rows = [row('Loose', []), row('Named', ['B1'])]
  const round = recapRoundOf({ goal: 'G6', goalRecap: { goal: 'G6', path: PATH, rows, rounds, changedAt: null }, recaps: [], items: itemsOf([built('B1', { result: 'passed' })]) })
  assert.deepEqual(round.ready.map(one => one.key), ['Loose', 'Named'])
  assert.equal(round.toJudge, 2)
  // The card: both rows are tiles.
  const card = recapCardOf({ goal: 'G6', recapPath: PATH, rows: round.rows.map(one => ({ ...one, path: PATH })), looks: [] })
  assert.deepEqual([card.count, card.tiles.map(one => one.target)], [2, [{ path: PATH, key: 'Loose' }, { path: PATH, key: 'Named' }]])
  // Without a goal there is no round.
  assert.equal(recapRoundOf({ goal: null }), null)
})

test('readGoalRecap carries every row of the file, with its steps and whether it says what changed or that its try is not in', async t => {
  const dir = await tempDir(t, 'one-count-')
  await mkdir(join(dir, 'pictures', 'g6', 'recap'), { recursive: true })
  const list = { goal: 'G6', title: 'The polish', sections: [{ kind: 'open', rows: [
    { title: '1. Loose', pictures: [{ kind: 'final', caption: 'x', path: 'a.png' }] },
    { title: '2. Named', steps: ['B1', 'B2'], changed: 'asked -> done', pictures: [{ kind: 'final', caption: 'x', path: 'a.png' }] },
    { title: '3. Later', pending: 'B3 not started', pictures: [{ kind: 'final', caption: 'x', path: 'a.png' }] },
  ] }] }
  await writeFile(join(dir, 'pictures', 'g6', 'recap', 'demo.json'), JSON.stringify(list))
  const goalsText = ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: x', ''].join('\n')
  const read = await readGoalRecap({ ...parseConfig('{}', {}), project: dir }, goalsText)
  assert.equal(read.path, 'pictures/g6/recap/demo.json')
  assert.deepEqual(read.rows, [
    { key: '1. Loose', title: '1. Loose', steps: [], changed: false, pending: false },
    { key: '2. Named', title: '2. Named', steps: ['B1', 'B2'], changed: true, pending: false },
    { key: '3. Later', title: '3. Later', steps: [], changed: false, pending: true },
  ])
})

// ---------------------------------------------------------------------------------------------------------------------
// The popup's round: rows being reworked, the kept looks

const list = (rows = ['1. Ring', '2. Ground', '3. Cliffs']) => ({ goal: 'G6', title: 'The polish', step: 'B7', sections: [{ kind: 'open', rows: rows.map(title => ({ title, pictures: [{ kind: 'final', caption: 'in the game', path: `${title.split('. ')[1]}.png` }] })) }] })
const lookOf = (ask, more = {}) => ({ ask, key: lookKey(ask), title: `Does ${ask} look right?`, text: 'It stands low.', advice: 'yes', step: 'B9', pictures: ['art/B9/after.jpg'], play: null, ...more })
const rework = new Map([['2. Ground', { step: 'B22', worker: null, words: 'B22 · waiting for a worker' }], ['3. Cliffs', { step: 'B34', worker: 'Worker 4', words: 'B34 · Worker 4' }]])
const keysOf = shown => shown.sections.flatMap(section => section.rows).map(one => one.key)

test('the popup: a row being reworked says which step and who, shows no old picture and asks nothing, in round 1 and later; it is no part of the Send', () => {
  const first = roundPage(demoPage(list(), 'pictures/g6/recap'), null, { rework })
  assert.deepEqual(first.sections[0].rows.map(one => [one.key, one.reworking ?? false, one.rework?.words ?? null, one.pictures.length]), [['1. Ring', false, null, 1], ['2. Ground', true, 'B22 · waiting for a worker', 0], ['3. Cliffs', true, 'B34 · Worker 4', 0]])
  assert.deepEqual([first.feedback.round, first.feedback.parts, first.feedback.answerable, first.feedback.toJudge], [1, 3, 1, 1])
  const refused = checkSend(first, { round: 1, parts: [{ key: '2. Ground', verdict: 'approved' }] })
  assert.deepEqual([refused.ok, refused.status], [false, 400])
  assert.match(refused.why, /"2\. Ground" is being reworked/)
  assert.equal(checkSend(first, { round: 1, parts: [{ key: '1. Ring', verdict: 'approved' }] }).ok, true)
  // Round 2: the row the person sent back whose new try is in, but whose step is under way again, is being reworked too; an undecided one as well.
  const sent = withRound(null, 1, [{ key: '3. Cliffs', verdict: 'sent-back', comment: 'again' }], '2026-11-02 16:17')
  const written = { changedAt: sinceMs('2026-11-02 16:17') + 90 * MIN, rework }
  const second = roundPage(demoPage({ ...list(), sections: [{ kind: 'open', rows: list().sections[0].rows.map(one => (one.title === '3. Cliffs' ? { ...one, changed: 'again -> rounder' } : one)) }] }, 'pictures/g6/recap'), sent, written)
  assert.deepEqual(second.sections[0].rows.map(one => [one.key, one.reworking ?? false, one.said?.comment ?? null]), [['1. Ring', false, null], ['2. Ground', true, null], ['3. Cliffs', true, 'again']])
  assert.equal(second.feedback.toJudge, 1)
  // With no rows being reworked nothing changes: the older rounds read as they did.
  const plain = roundPage(demoPage(list(), 'pictures/g6/recap'), null)
  assert.deepEqual([plain.feedback.answerable, plain.feedback.toJudge, plain.looks], [3, 3, []])
})

test('the kept looks are rows of the round: each with its title, words, pictures and play link; part of the same Send, answered as approved or sent back with a note', () => {
  const shown = roundPage(demoPage(list(), 'pictures/g6/recap'), null, { rework, looks: [lookOf('Q590', { play: 'main&arena=ring' }), lookOf('Q591', { title: 'Second look', pictures: [] })] })
  assert.deepEqual(shown.looks.map(one => [one.key, one.ask, one.title, one.text, one.pictures.map(picture => picture.path), one.play]), [
    ['look:Q590', 'Q590', 'Does Q590 look right?', 'It stands low.', ['art/B9/after.jpg'], 'main&arena=ring'],
    ['look:Q591', 'Q591', 'Second look', 'It stands low.', [], null],
  ])
  assert.deepEqual([shown.feedback.answerable, shown.feedback.looks, shown.feedback.toJudge], [1, 2, 3], '1 ready row + 2 looks')
  // The Send: the looks come back apart from the rows, so feedback.json holds the rows only.
  const sent = checkSend(shown, { round: 1, parts: [{ key: '1. Ring', verdict: 'approved' }, { key: 'look:Q590', verdict: 'approved', comment: '' }, { key: 'look:Q591', verdict: 'sent-back', comment: ' too   low ' }] })
  assert.deepEqual(sent, { ok: true, round: 1, parts: [{ key: '1. Ring', verdict: 'approved', comment: '' }], looks: [{ ask: 'Q590', verdict: 'approved', comment: '' }, { ask: 'Q591', verdict: 'sent-back', comment: 'too low' }] })
  assert.match(checkSend(shown, { round: 1, parts: [{ key: 'look:Q591', verdict: 'sent-back', comment: ' ' }] }).why, /"Second look" is sent back without a comment/)
  assert.match(checkSend(shown, { round: 1, parts: [{ key: 'look:Q999', verdict: 'approved' }] }).why, /no part "look:Q999"/)
  assert.match(checkSend(shown, { round: 1, parts: [{ key: 'look:Q590', verdict: 'approved' }, { key: 'look:Q590', verdict: 'approved' }] }).why, /twice/)
  // A kept do is a row of the round like a look, and counts with them (one count includes the kept dos).
  const withDo = roundPage(demoPage(list(), 'pictures/g6/recap'), null, { looks: [lookOf('Q590'), lookOf('Q616', { asks: 'do', title: 'Reopen the Q600 play link' })] })
  assert.deepEqual([withDo.looks.map(one => [one.ask, one.asks]), withDo.feedback.toJudge], [[['Q590', 'look'], ['Q616', 'do']], 5])
  assert.deepEqual(checkSend(withDo, { round: 1, parts: [{ key: 'look:Q616', verdict: 'approved' }] }).looks, [{ ask: 'Q616', verdict: 'approved', comment: '' }])
  // A look alone is a Send.
  assert.deepEqual(checkSend(shown, { round: 1, parts: [{ key: 'look:Q590', verdict: 'approved' }] }), { ok: true, round: 1, parts: [], looks: [{ ask: 'Q590', verdict: 'approved', comment: '' }] })
  // Every row approved: the looks are still to answer (the Send is refused only when nothing is left).
  const approved = withRound(null, 1, ['1. Ring', '2. Ground', '3. Cliffs'].map(key => ({ key, verdict: 'approved', comment: '' })), '2026-11-02 16:17')
  const rest = roundPage(demoPage(list(), 'pictures/g6/recap'), approved, { looks: [lookOf('Q590')] })
  assert.deepEqual([rest.feedback.done, rest.feedback.toJudge, keysOf(rest)], [true, 1, []])
  assert.equal(checkSend(rest, { round: 1, parts: [{ key: 'look:Q590', verdict: 'approved' }] }).ok, true)
  assert.equal(checkSend(roundPage(demoPage(list(), 'pictures/g6/recap'), approved), { round: 1, parts: [{ key: '1. Ring', verdict: 'approved' }] }).status, 409, 'with no look left, a recap all approved takes no more')
  // While the next round is being made nothing can be judged: no look is shown either.
  const sentBack = withRound(null, 1, [{ key: '3. Cliffs', verdict: 'sent-back', comment: 'again' }], '2026-11-02 16:17')
  const making = roundPage(demoPage(list(), 'pictures/g6/recap'), sentBack, { changedAt: sinceMs('2026-11-02 16:17') - MIN, looks: [lookOf('Q590')] })
  assert.deepEqual([making.feedback.making, making.looks, making.feedback.toJudge], [{ round: 2 }, [], 0])
})

test('keptLooksOf: only the looks Autopilot keeps for the recap, of a step of the goal, oldest first; a play link in the words is carried', () => {
  const routed = [
    { id: 'Q5', route: 'recap', isKept: true, asks: 'look', of: 'B9', goal: 'G6', title: 'Second', text: 'See [play](http://127.0.0.1:4310/#play=main&arena=ring).', pictures: ['a.png'], advice: 'yes' },
    { id: 'Q6', route: 'recap', isKept: false, asks: 'look', of: 'B9', goal: 'G6', title: 'A checker\'s look', text: '', pictures: [] },
    { id: 'Q7', route: 'recap', isKept: true, asks: 'decide', of: 'B9', goal: 'G6', title: 'A decide', text: '', pictures: [] },
    { id: 'Q8', route: 'recap', isKept: true, asks: 'look', of: 'B9', goal: 'G7', title: 'Another goal', text: '', pictures: [] },
    { id: 'Q9', route: 'main', isKept: true, asks: 'look', of: 'B9', goal: 'G6', title: 'The main chat\'s', text: '', pictures: [] },
    { id: 'Q10', route: 'recap', isKept: true, asks: 'look', of: null, goal: null, title: 'Of no step', text: '', pictures: [] },
    // A kept do (an own-senses do the main chat or the partner handed on) is a row too, "Done" in place of "Approve".
    { id: 'Q11', route: 'recap', isKept: true, asks: 'do', of: 'B9', goal: 'G6', title: 'Reopen the Q5 play link', text: '', pictures: [] },
    { id: 'Q12', route: 'recap', isKept: true, asks: 'provide', of: 'B9', goal: 'G6', title: 'A provide', text: '', pictures: [] },
  ]
  assert.deepEqual(keptLooksOf(routed, 'G6').map(one => [one.ask, one.asks, one.key, one.play, one.pictures]), [['Q5', 'look', 'look:Q5', 'main&arena=ring', ['a.png']], ['Q11', 'do', 'look:Q11', null, []]])
  assert.equal(playOf('Play it: #play=main&sandbox&unit=wizard now'), 'main&sandbox&unit=wizard')
  assert.equal(playOf('nothing to play'), null)
  assert.equal(playOf('#play=<script>'), null, 'only plain characters')
})

// ---------------------------------------------------------------------------------------------------------------------
// One count: 1 ready row + 2 looks, on the card, the popup and the round alike

const askKept = (n, title) => parseItem(`Id: Q${n}\nKind: ask\nTitle: ${title}\nState: open\nOwner: Digger\nSince: ${at(40)}\nFiled: ${NOW - 40 * MIN}\nPictures: art/B9/after${n}.jpg\nAsks: look\nBlocking: no\nAdvice: yes\nOf: B9\nRoute: recap\n\n## Route\n${KEPT}\n`)

/** A recap of one ready row and two kept looks of the done step B9: the card, the round and the popup all read the same. */
const withLooks = (rows = 1) => asSent(build(
  [built('B1', { result: 'passed' }), ...Array.from({ length: rows - 1 }, (_, n) => built(`B${n + 2}`, { result: 'passed' })), step('B9', 'done'), askKept(590, 'Does the wizard\'s move range look right?'), askKept(591, 'Does the bridge look right?')],
  undefined, goals(rows), { recaps: [{ path: PATH, goal: 'G6', parts: Array.from({ length: rows }, (_, n) => row(`Row ${n + 1}`, [`B${n + 1}`])), rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: ON },
))

test('one count: 1 ready row and 2 kept looks are 3 to judge on the card, in the round and in the popup\'s page', () => {
  const state = withLooks(1)
  assert.deepEqual([state.recapCard.count, state.recapRound.toJudge, state.recapRound.ready, state.recapRound.looks.map(one => one.ask)], [3, 3, 1, ['Q590', 'Q591']])
  assert.deepEqual(state.recapCard.tiles.map(one => one.title), ['Row 1', 'Does the wizard\'s move range look right?', 'Does the bridge look right?'])
  assert.deepEqual(state.recapCard.outside, [], 'the looks are rows of the recap, never asks outside it')
  const popup = roundPage(demoPage(list(['Row 1']), 'pictures/g6/recap'), null, { rework: new Map(Object.entries(state.recapRound.rework)), looks: state.recapRound.looks })
  assert.equal(popup.feedback.toJudge, state.recapCard.count, 'the popup\'s head carries the card\'s number')
  assert.deepEqual(popup.looks.map(one => one.ask), ['Q590', 'Q591'])
  // Autopilot off: the looks stand in Needs your attention, not in the recap.
  const off = asSent(build([built('B1', { result: 'passed' }), step('B9', 'done'), askKept(590, 'A look')], undefined, goals(1), { recaps: [{ path: PATH, goal: 'G6', parts: [row('Row 1', ['B1'])], rounds: [], changedAt: null }], goalRecap: { goal: 'G6', path: PATH, pictures: {} }, config: { ...parseConfig('{}', {}), project: 'C:\\garden' } }))
  assert.deepEqual([off.recapRound.looks, off.recapRound.toJudge], [[], 1])
})

test('the card shows at most 3 tiles however many wait, and the count is the whole: 4 ready rows and 2 looks are 6', () => {
  const state = withLooks(4)
  assert.deepEqual([state.recapCard.count, state.recapCard.tiles.length, state.recapCard.looks.length, state.recapRound.toJudge], [6, 3, 2, 6])
})

test('the same rows, no rounds yet and one sent back: roundRowsOf is the very reading of the popup (a sent-back row with no new try is not ready)', () => {
  const rows = [row('A', ['B1']), row('B', ['B2'], { changed: false })]
  const rounds = [{ n: 1, at: '2026-11-02 16:17', parts: [{ key: 'B', verdict: 'sent-back', comment: 'again' }] }]
  const shown = roundRowsOf({ rows, rounds, changedAt: sinceMs('2026-11-02 16:17') + 90 * MIN })
  assert.deepEqual(shown.rows.map(one => [one.key, one.ready]), [['A', true], ['B', false]])
  const popup = roundPage(demoPage({ goal: 'G6', sections: [{ kind: 'open', rows: [{ title: 'A', pictures: [{ kind: 'final', path: 'a.png' }] }, { title: 'B', pictures: [{ kind: 'final', path: 'b.png' }] }] }] }), { rounds }, { changedAt: sinceMs('2026-11-02 16:17') + 90 * MIN })
  assert.equal(popup.feedback.answerable, shown.rows.filter(one => one.ready).length)
  assert.equal(recapWaitsOf([{ path: PATH, goal: 'G6', parts: rows, rounds, changedAt: sinceMs('2026-11-02 16:17') + 90 * MIN }]).filter(one => one.verdict === null).length, 1)
})
