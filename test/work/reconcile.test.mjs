// B300: the reconciler (spec 2026-10-17, section 7): one rule per row, over the store's files and the board's lanes.
// It moves only what the flow lets the server move, and names the deliveries and the flags. T8.5 step 6: a line for a
// queued step goes only to the main chat; a worker gets its line in its hand-over's envelope. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS } from '../../src/config.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'

const NOW = new Date(2026, 9, 17, 12, 0).getTime()
const MIN = 60_000
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }

/** An item file's text from its head and its sections. */
const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, sections = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: '2026-10-17 11:00', ...more }, sections)
const store = (items, problems = []) => ({ items: new Map(items.map(item => [item.head.get('Id'), item])), flow: DEFAULT_FLOW, problems })
const lane = (name, state = 'free', more = {}) => ({ name, state, isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, ...more })
/** The main chat's lane: the one chat a step's line still goes to from this pass. */
const main = (name, state = 'free', more = {}) => lane(name, state, { isMain: true, ...more })
const run = (items, lanes, more = {}) => reconcile({ store: store(items, more.problems), flow: more.flow ?? DEFAULT_FLOW, lanes, now: more.now ?? NOW, times: TIMES, prefix: 'Team - ' })

test('the times stand in the config beside the board\'s other times', () => {
  assert.equal(GRACE_MS, 10 * MIN)
  assert.equal(ASK_MS, 60 * MIN)
})

test('a queued step whose guards hold and whose Owner, the main chat, is free is delivered to it, not moved; a worker gets no line here', () => {
  const done = run([step('B1', 'done'), step('B286', 'queued', { Owner: 'Team - Units', 'Blocked by': 'B1' }), step('B287', 'queued', { Owner: 'Units' })], [main('Units')])
  // One line per chat: the first of its steps.
  assert.deepEqual(done.deliveries, [{ id: 'B286', chat: 'Units', since: '2026-10-17 11:00', why: 'deliver B286 to Units' }])
  assert.deepEqual(done.moves, [])
  // A worker: its hand-over carries its line (mutant: a delivery of the old pass left in).
  assert.deepEqual(run([step('B287', 'queued', { Owner: 'Units' })], [lane('Units')]).deliveries, [])
})

test('no delivery while the Owner works, holds another step, is not on the board, or the step waits on another', () => {
  assert.deepEqual(run([step('B286', 'queued', { Owner: 'Units' })], [lane('Units', 'working')]).deliveries, [])
  assert.deepEqual(run([step('B286', 'queued', { Owner: 'Units' }), step('B12', 'in progress', { Owner: 'Units' })], [lane('Units')]).deliveries, [])
  assert.deepEqual(run([step('B286', 'queued', { Owner: 'Units' })], [lane('Board')]).deliveries, [])
  assert.deepEqual(run([step('B1', 'queued', { Owner: 'Board' }), step('B286', 'queued', { Owner: 'Units', 'Blocked by': 'B1' })], [lane('Units')]).deliveries, [])
})

test('a step held by a chat that is not running is flagged after the grace time, not before', () => {
  const held = [step('B285', 'in progress', { Owner: 'Support', Since: '2026-10-17 11:30' })]
  const early = run(held, [lane('Support', 'free', { isRunning: false, lastActivityAt: NOW - 5 * MIN })])
  assert.deepEqual(early.flags, [])
  const late = run(held, [lane('Support', 'free', { isRunning: false, lastActivityAt: NOW - 11 * MIN })])
  assert.deepEqual(late.flags, [{ kind: 'stuck', id: 'B285', chat: 'Support', text: 'B285: Support holds it but is not running', button: 'Start Support' }])
  // Running, held by the limit, or not known: no flag.
  assert.deepEqual(run(held, [lane('Support', 'free', { lastActivityAt: NOW - 30 * MIN })]).flags, [])
  assert.deepEqual(run(held, [lane('Support', 'suspended', { isRunning: false })]).flags, [])
  assert.deepEqual(run(held, [lane('Support', 'free', { isRunning: null })]).flags, [])
})

test('a blocking ask open longer than the ask time is marked old; nothing is sent again', () => {
  const ask = since => file({ Id: 'Q4', Kind: 'ask', Title: 'Which port?', State: 'open', Owner: 'Units', Since: since, Asks: 'decide', Blocking: 'yes', Of: 'B12' })
  assert.deepEqual(run([ask('2026-10-17 11:30')], [lane('Units')]).flags, [])
  const old = run([ask('2026-10-17 10:30')], [lane('Units')])
  assert.deepEqual(old.flags, [{ kind: 'old ask', id: 'Q4', chat: 'Units', text: 'Q4 has waited for your answer for 1 h 30 min', button: null }])
  assert.deepEqual([old.moves, old.deliveries], [[], []])
})

test('an open instruction is the Open instructions list\'s: no flag, no move', () => {
  const told = file({ Id: 'I17', Kind: 'instruction', Chat: 'Units', State: 'open', Since: '2026-10-17 09:00:00', Missed: '3', Text: 'Make it blue' })
  const quiet = run([told], [lane('Units')])
  assert.deepEqual({ ...quiet, ready: undefined }, { moves: [], deliveries: [], flags: [], notes: [], partnerAsks: [], escalations: [], restFree: [], handedBack: [], start: null, retired: [], stranded: [], handOutHeld: false, ready: undefined })
})

test('a step in review whose check failed is flagged on the lane of its Owner; the pass tells it nothing (its hand-over does)', () => {
  const failed = step('B285', 'review', { Owner: 'Support' }, { History: ['- 2026-10-17 11:40 server: check pending', '- 2026-10-17 11:41 server: check failed: the branch b285-strip is still there'] })
  assert.deepEqual(run([failed], [lane('Support')]).flags, [{
    kind: 'check failed', id: 'B285', chat: 'Support', text: 'B285: the board\'s check failed: the branch b285-strip is still there', button: null,
  }])
})

test('a broken file, an id twice and a state the flow does not know make one line on top each; nothing is moved', () => {
  const odd = step('B9', 'parked', { Owner: 'Units' })
  const done = run([odd, step('B10', 'queued', { Owner: 'Units' })], [lane('Units')], { problems: [{ file: 'B10.md', line: 'B10.md: line 3 is no head line: "oops"' }, { file: 'B11.md', line: 'B11.md: the id B10 stands twice' }] })
  assert.deepEqual(done.flags, [
    { kind: 'broken', id: null, chat: null, text: 'B10.md: line 3 is no head line: "oops"', button: null },
    { kind: 'broken', id: null, chat: null, text: 'B11.md: the id B10 stands twice', button: null },
    { kind: 'broken', id: 'B9', chat: null, text: 'B9: its state "parked" is not in flow.json; it is shown as it is, not moved', button: null },
  ])
  // B10's file is broken: it is not delivered.
  assert.deepEqual([done.moves, done.deliveries], [[], []])
})

test('a card that names a step the store does not hold in progress for that chat is flagged', () => {
  const card = text => ({ text, stepId: null, source: 'plan' })
  const items = [step('B281', 'queued', { Owner: 'Units' }), step('B12', 'in progress', { Owner: 'Units' }), step('B13', 'in progress', { Owner: 'Board' })]
  assert.deepEqual(run(items, [lane('Units', 'working', { task: card('B281 Give the golem') })]).flags, [{ kind: 'card', id: 'B281', chat: 'Units', text: 'Units\' card says B281 but B281 is queued', button: null }])
  assert.deepEqual(run(items, [lane('Units', 'working', { task: card('B12 The strip') })]).flags, [])
  assert.deepEqual(run(items, [lane('Units', 'working', { task: card('B13 Menu') })]).flags[0].text, 'Units\' card says B13 but B13 is in progress for Board')
  assert.deepEqual(run(items, [lane('Units', 'working', { task: card('B99 Gone') })]).flags[0].text, 'Units\' card says B99 but the store has no B99')
  // A task the board read from the store, not from the card, is no card.
  assert.deepEqual(run(items, [lane('Units', 'working', { task: { text: 'B281', stepId: 'B281', source: 'step' } })]).flags, [])
})

test('the server\'s own moves of the flow are made when their guard holds: a review closed once its look is answered', () => {
  const review = step('B285', 'review', { Owner: 'Support' }, { History: ['- 2026-10-17 11:41 server: check passed: base equals remote'] })
  const look = state => file({ Id: 'Q7', Kind: 'ask', Title: 'Look at it', State: state, Owner: 'Support', Since: '2026-10-17 11:42', Asks: 'look', Blocking: 'no', Of: 'B285' })
  assert.deepEqual(run([review, look('open')], [lane('Support')]).moves, [])
  assert.deepEqual(run([review, look('answered')], [lane('Support')]).moves, [{ id: 'B285', to: 'done', why: 'review → done (the check passed and no ask of kind look is open)' }])
})

test('the reconciler never moves against the flow: a flow without the server\'s moves gives none, and no delivery', () => {
  const flow = { step: { states: DEFAULT_FLOW.step.states, moves: DEFAULT_FLOW.step.moves.map(move => (move.by === 'server' ? { ...move, by: 'main' } : move)) } }
  const review = step('B285', 'review', { Owner: 'Support' }, { History: ['- 2026-10-17 11:41 server: check passed'] })
  const done = run([review, step('B286', 'queued', { Owner: 'Units' })], [lane('Units'), lane('Support')], { flow })
  assert.deepEqual([done.moves, done.deliveries], [[], []])
})

test('B308: "Done: yes" flags nothing: it says the turn did what it asked, not that the step is finished', () => {
  const held = [step('B12', 'in progress', { Owner: 'Units', Since: '2026-10-17 11:00' })]
  const said = lane('Units', 'working', { saidDone: { at: NOW - 5 * MIN } })
  assert.deepEqual(run(held, [said]).flags.filter(flag => flag.kind === 'unreported'), [])
  assert.deepEqual(run([step('B12', 'waiting on you', { Owner: 'Units' })], [said]).flags, [])
})

test('B308: a worker that holds steps, has ended its turn with nothing running and asked nothing is named once, after the idle time', () => {
  const held = [step('B269', 'in progress', { Owner: 'Board' }), step('B280', 'taken', { Owner: 'Team - Board' }), step('B12', 'queued', { Owner: 'Board' }), step('B9', 'review', { Owner: 'Board' })]
  const resting = since => lane('Board', 'working', { resting: { since } })
  const idle = flags => flags.filter(flag => flag.kind === 'idle hold')
  assert.equal(IDLE_HOLD_MS, 5 * MIN)
  // One line for the chat, naming every step it holds (taken or in progress).
  assert.deepEqual(idle(run(held, [resting(NOW - 6 * MIN)]).flags), [{ kind: 'idle hold', id: 'B269', ids: ['B269', 'B280'], chat: 'Board', text: 'Board holds B269 and B280 but is not working and asked you nothing: it may wait for you', button: null }])
  assert.equal(idle(run([step('B31', 'in progress', { Owner: 'Board' })], [resting(NOW - 6 * MIN)]).flags)[0].text, 'Board holds B31 but is not working and asked you nothing: it may wait for you')
  assert.match(idle(run([...held, step('B281', 'in progress', { Owner: 'Board' })], [resting(NOW - 6 * MIN)]).flags)[0].text, /^Board holds B269, B280 and B281 but/)
  // Within the idle time: from the turn's end, or from a step it took after that.
  assert.deepEqual(idle(run(held, [resting(NOW - 4 * MIN)]).flags), [])
  assert.deepEqual(idle(run([step('B269', 'in progress', { Owner: 'Board', Since: '2026-10-17 11:57' })], [resting(NOW - 30 * MIN)]).flags), [])
  // Working (no rest), suspended for the limit, the main chat, holding nothing: no line.
  assert.deepEqual(idle(run(held, [lane('Board', 'working')]).flags), [])
  assert.deepEqual(idle(run(held, [lane('Board', 'suspended', { resting: { since: NOW - 30 * MIN } })]).flags), [])
  assert.deepEqual(idle(run(held, [lane('Board', 'free', { isMain: true, resting: { since: NOW - 30 * MIN } })]).flags), [])
  assert.deepEqual(idle(run([step('B12', 'queued', { Owner: 'Board' })], [resting(NOW - 30 * MIN)]).flags), [])
  // An open ask of its own, blocking or not, says what it waits for; an answered one does not.
  const ask = (state, blocking) => file({ Id: 'Q7', Kind: 'ask', Title: 'Look at it', State: state, Owner: 'Team - Board', Since: '2026-10-17 11:42', Asks: 'look', Blocking: blocking, Of: 'B269' })
  assert.deepEqual(idle(run([...held, ask('open', 'no')], [resting(NOW - 30 * MIN)]).flags), [])
  assert.deepEqual(idle(run([...held, ask('open', 'yes')], [resting(NOW - 30 * MIN)]).flags), [])
  assert.equal(idle(run([...held, ask('answered', 'no')], [resting(NOW - 30 * MIN)]).flags).length, 1)
})

test('B305: a step blocked by an ask that is answered or withdrawn is delivered, as after a step done or dropped; an open ask still holds it', () => {
  const ask = (id, state) => file({ Id: id, Kind: 'ask', Title: `Ask ${id}`, State: state, Since: '2026-10-17 11:00' })
  const after = on => step('B286', 'queued', { Owner: 'Units', 'Blocked by': on })
  assert.deepEqual(run([ask('B279', 'answered'), after('B279')], [main('Units')]).deliveries.map(one => one.id), ['B286'])
  assert.deepEqual(run([ask('B279', 'withdrawn'), after('B279')], [main('Units')]).deliveries.map(one => one.id), ['B286'])
  assert.deepEqual(run([ask('B279', 'open'), after('B279')], [main('Units')]).deliveries, [])
})
