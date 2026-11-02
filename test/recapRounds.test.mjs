// T17.1 (the person, 2026-11-02, after sending round 1 of G60's recap at 16:17 with 8 rows sent back: "the new recap, after round 1 is
// not finetuned to my feedback. the same pictures are provided and i see no evidence of what i asked it to fix/change. i need this
// before i can evaluate and preferably also have a link to open the game so i can see it myself"; their yes: "Yes, build it"):
// the rounds after a Send. The data side: round N+1 is "being made" until the demo was written again, each row sent back carries
// what changed and a picture newer than the Send (or says it is pending), a row may carry a map to play; tools/demo.mjs refuses
// a list that shows old pictures as a new try; the recap cards say "being made", never "verdict waits". Made-up garden names only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../src/config.mjs'
import { ARENA_NAME, checkList, checkTries, demoPage } from '../src/demo.mjs'
import { checkSend, isAfterSend, makingOf, roundPage, roundsOf, withRound } from '../src/demoFeedback.mjs'
import { recapMakingOf } from '../src/recapCard.mjs'
import { recapWaitsOf } from '../src/recaps.mjs'
import { parseItem, sinceMs } from '../src/work/item.mjs'
import { writeDemo } from '../tools/demo.mjs'
import { MIN, NOW, asSent, build, sinceOf } from './partnerState.mjs'

const SENT = '2026-11-02 16:17'
const SENT_MS = sinceMs(SENT)

/** A row whose picture is named by its first letter: "3. Props" shows P.png. */
const row = (title, more = {}) => ({ title, pictures: [{ kind: 'final', caption: 'in the game', path: `${title.split('. ')[1].slice(0, 1)}.png` }], ...more })
const list = (more = {}) => ({
  goal: 'G6', title: 'The polish', step: 'B7',
  sections: [
    { kind: 'reached', rows: [row('1. Lava'), row('2. Cliffs')] },
    { kind: 'not-reached', rows: [row('3. Props', more.props), row('4. Ring', more.ring), row('5. Bridges')] },
  ],
})
/** Round 1 at 16:17: Lava approved, Props and Ring sent back, Cliffs and Bridges not decided. */
const round1 = () => withRound(null, 1, [
  { key: '1. Lava', verdict: 'approved', comment: '' },
  { key: '3. Props', verdict: 'sent-back', comment: 'keep the limit for tall props' },
  { key: '4. Ring', verdict: 'sent-back', comment: 'not round enough' },
], SENT)
const page = (more = {}) => demoPage(list(more), 'pictures/g6')
const rowsOf = shown => shown.sections.flatMap(section => section.rows)
const keysOf = shown => rowsOf(shown).map(one => one.key)

test('after a Send that sent rows back, round 2 is being made until the demo is written in a later minute: the rows sent back, their words, no picture, nothing to answer', () => {
  // The demo is as it was (written before the Send), or written in the Send's own minute: still being made.
  for (const changedAt of [SENT_MS - 4 * 60 * MIN, SENT_MS + 30_000, SENT_MS + 59_999]) {
    const shown = roundPage(page(), round1(), { changedAt })
    assert.deepEqual(shown.feedback.making, { round: 2 }, `written at ${changedAt - SENT_MS} ms after the Send`)
    assert.deepEqual(keysOf(shown), ['3. Props', '4. Ring'], 'only what the Send sent back: not the approved Lava, not the undecided ones')
    assert.deepEqual(rowsOf(shown).map(one => [one.reworking, one.pictures, one.note, one.said.comment]), [
      [true, [], '', 'keep the limit for tall props'], [true, [], '', 'not round enough'],
    ])
    assert.deepEqual([shown.feedback.round, shown.feedback.answerable, shown.feedback.done, shown.followUp], [2, 0, false, null])
    // Nothing can be sent while it is being made.
    const refused = checkSend(shown, { round: 2, parts: [{ key: '3. Props', verdict: 'approved' }] })
    assert.deepEqual([refused.ok, refused.status], [false, 409])
    assert.match(refused.why, /Round 2 is being made/)
  }
})

test('after the rewrite round 2 is ready: a row sent back shows its new try; one that is pending stays being reworked and is no part of the Send', () => {
  const written = { changedAt: SENT_MS + 60_000 }
  const tried = page({ props: { changed: 'tall props -> limit kept, see-through behind a unit' }, ring: { pending: 'B925 not started' } })
  const shown = roundPage(tried, round1(), written)
  assert.equal(shown.feedback.making, null)
  assert.deepEqual(keysOf(shown), ['2. Cliffs', '3. Props', '4. Ring', '5. Bridges'], 'the undecided rows come back with the rows sent back')
  const [cliffs, props, ring] = rowsOf(shown)
  assert.deepEqual([props.reworking ?? false, props.changed, props.pictures.length, props.said.comment], [false, 'tall props -> limit kept, see-through behind a unit', 1, 'keep the limit for tall props'])
  assert.deepEqual([ring.reworking, ring.pending, ring.pictures, ring.said.comment], [true, 'B925 not started', [], 'not round enough'])
  assert.equal(cliffs.reworking ?? false, false)
  assert.deepEqual([shown.feedback.round, shown.feedback.answerable], [2, 3], 'Cliffs, Props and Bridges can be answered; Ring cannot yet')
  assert.equal(checkSend(shown, { round: 2, parts: [{ key: '3. Props', verdict: 'approved' }] }).ok, true)
  const early = checkSend(shown, { round: 2, parts: [{ key: '4. Ring', verdict: 'approved' }] })
  assert.deepEqual([early.ok, early.status], [false, 400])
  assert.match(early.why, /"4\. Ring" is being reworked/)
  // Every row left pending: nothing to answer yet.
  const decided = [...['1. Lava', '2. Cliffs', '5. Bridges'].map(key => ({ key, verdict: 'approved', comment: '' })), { key: '3. Props', verdict: 'sent-back', comment: 'x' }, { key: '4. Ring', verdict: 'sent-back', comment: 'y' }]
  const idle = roundPage(page({ props: { pending: 'B924 waits' }, ring: { pending: 'B925 not started' } }), withRound(null, 1, decided, SENT), written)
  assert.deepEqual([idle.feedback.making, idle.feedback.answerable, keysOf(idle)], [null, 0, ['3. Props', '4. Ring']])
})

test('being made needs a Send that sent rows back and a date to compare: approvals only, no changedAt, no usable time: never being made', () => {
  const approvals = withRound(null, 1, [{ key: '1. Lava', verdict: 'approved', comment: '' }, { key: '2. Cliffs', verdict: 'approved', comment: '' }], SENT)
  assert.equal(roundPage(page(), approvals, { changedAt: SENT_MS - MIN }).feedback.making, null)
  assert.equal(roundPage(page(), round1()).feedback.making, null, 'a caller with no file time does not know')
  assert.equal(roundPage(page(), withRound(null, 1, [{ key: '3. Props', verdict: 'sent-back', comment: 'x' }], 'x'), { changedAt: 0 }).feedback.making, null, 'a Send with no time cannot be dated')
  assert.deepEqual(makingOf(roundsOf(round1()), null), { round: 2, at: SENT_MS }, 'never written since: being made')
  assert.equal(isAfterSend(SENT_MS + 59_999, SENT_MS), false)
  assert.equal(isAfterSend(SENT_MS + 60_000, SENT_MS), true)
  // Round 3: the last Send decides. Round 2 sent Ring back again, so round 3 is being made until the demo is written after round 2.
  const second = withRound(round1(), 2, [{ key: '3. Props', verdict: 'approved', comment: '' }, { key: '4. Ring', verdict: 'sent-back', comment: 'still a square' }], '2026-11-02 18:30')
  const made = roundPage(page(), second, { changedAt: SENT_MS + 90 * MIN })
  assert.deepEqual([made.feedback.making, keysOf(made)], [{ round: 3 }, ['4. Ring']])
  assert.equal(made.sections.at(-1).rows[0].said.round, 2, 'with the words of the round that sent it back')
})

test('the recap\'s waits: a part pending stays sent back after the rewrite; while being made no part of the recap counts as a verdict that waits', () => {
  const recap = (changedAt, pending = false) => ({
    path: 'pictures/g6/demo.json', goal: 'G6', changedAt, rounds: roundsOf(round1()),
    parts: [['2. Cliffs', 'B2'], ['3. Props', 'B3'], ['4. Ring', 'B4']].map(([key, step]) => ({ key, title: key, steps: [step], pending: pending && key === '4. Ring' })),
  })
  const before = recapWaitsOf([recap(SENT_MS - MIN)])
  assert.deepEqual(before.map(one => [one.step, one.verdict, one.making]), [['B2', null, true], ['B3', 'sent-back', true], ['B4', 'sent-back', true]], 'the undecided Cliffs is no verdict while the round is being made')
  const after = recapWaitsOf([recap(SENT_MS + 60_000, true)])
  assert.deepEqual(after.map(one => [one.step, one.verdict, one.making]), [['B2', null, false], ['B3', null, false], ['B4', 'sent-back', false]], 'Props is tried; Ring is still pending')
})

// ---------------------------------------------------------------------------------------------------------------------
// The list: what the partner writes, and what tools/demo.mjs refuses

const mtimes = table => path => table[path] ?? null
const feedback = round1()

test('the list: a row sent back without "changed", or with only pictures older than the Send, is refused, one line per row; "pending" passes', () => {
  const old = mtimes({ 'P.png': SENT_MS - 3 * 60 * MIN, 'R.png': SENT_MS - 3 * 60 * MIN })
  // Neither: both rows sent back are refused, each with its own line; the others (approved, undecided) need nothing.
  assert.throws(() => checkList(list(), { feedback, mtimeOf: old }), error => {
    const lines = error.message.split('\n')
    assert.equal(lines.length, 3, error.message)
    assert.match(lines[1], /"3\. Props" \(sent back in round 1, 2026-11-02 16:17\) has no "changed"/)
    assert.match(lines[2], /"4\. Ring" \(sent back in round 1, 2026-11-02 16:17\) has no "changed"/)
    return true
  })
  // "changed" with the old pictures: the pictures are the old try's.
  assert.throws(() => checkList(list({ props: { changed: 'limit kept' }, ring: { changed: 'rounder' } }), { feedback, mtimeOf: old }), /"3\. Props".*no picture was written after that Send[^]*"4\. Ring".*no picture was written after that Send/)
  // A picture written in the Send's own minute is not after it; the next minute is.
  const same = mtimes({ 'P.png': SENT_MS + 30_000, 'R.png': SENT_MS + 60_000 })
  assert.throws(() => checkList(list({ props: { changed: 'limit kept' }, ring: { changed: 'rounder' } }), { feedback, mtimeOf: same }), error => /"3\. Props"/.test(error.message) && !/"4\. Ring"/.test(error.message))
  // One new picture among old ones is enough; "pending" needs neither changed nor pictures newer than the Send; grids count too.
  const fresh = mtimes({ 'P.png': SENT_MS - MIN, 'P2.png': SENT_MS + 5 * MIN, 'R.png': SENT_MS - MIN })
  const both = list({ props: { changed: 'limit kept', pictures: [{ kind: 'final', path: 'P.png' }, { kind: 'final', path: 'P2.png' }] }, ring: { pending: 'B925 not started' } })
  assert.equal(checkList(both, { feedback, mtimeOf: fresh }), both)
  const grid = list({ props: { changed: 'limit kept', pictures: undefined, grid: [{ caption: 'A', path: 'P2.png' }] }, ring: { pending: 'B925 not started' } })
  assert.doesNotThrow(() => checkList(grid, { feedback, mtimeOf: fresh }))
  // No feedback yet, or no tries given: the shape only.
  assert.doesNotThrow(() => checkList(list(), { feedback: null, mtimeOf: old }))
  assert.doesNotThrow(() => checkList(list()))
  // A row sent back in round 1 and approved in round 2 is owed nothing; one sent back again is owed a picture after round 2.
  const later = withRound(feedback, 2, [{ key: '3. Props', verdict: 'approved', comment: '' }, { key: '4. Ring', verdict: 'sent-back', comment: 'still a square' }], '2026-11-02 18:30')
  const sentTwice = sinceMs('2026-11-02 18:30')
  assert.throws(() => checkTries(list({ ring: { changed: 'rounder' } }), { feedback: later, mtimeOf: mtimes({ 'R.png': sentTwice - MIN }) }), /"4\. Ring" \(sent back in round 2, 2026-11-02 18:30\)/)
  assert.doesNotThrow(() => checkTries(list({ ring: { changed: 'rounder' } }), { feedback: later, mtimeOf: mtimes({ 'R.png': sentTwice + 2 * MIN }) }))
})

test('the list: "changed", "pending" are one line, "play" is an arena name (letters, digits, dashes, at most 60)', () => {
  for (const good of ['ring', 'moat-keep', 'g60-stairs-sizes', 'A1', 'x'.repeat(60)]) {
    assert.match(good, ARENA_NAME)
    assert.doesNotThrow(() => checkList(list({ ring: { play: good } })), good)
  }
  for (const bad of ['', 'moat keep', 'ring/../x', 'ring&arena=x', 'ring.json', 'x'.repeat(61), 'rïng', 7, null]) {
    assert.throws(() => checkList(list({ ring: { play: bad } })), /"play" is an arena name/, String(bad))
  }
  for (const field of ['changed', 'pending']) {
    for (const bad of ['', '  ', 'two\nlines', 4, null]) assert.throws(() => checkList(list({ ring: { [field]: bad } })), new RegExp(`"${field}" is one line`), `${field}: ${JSON.stringify(bad)}`)
  }
  // The page model carries them: null for none.
  const shown = roundPage(demoPage(list({ props: { changed: ' limit kept ', play: 'ring' }, ring: { pending: ' later ' } })), null)
  assert.deepEqual(rowsOf(shown).slice(2).map(one => [one.changed, one.pending, one.play]), [['limit kept', null, 'ring'], [null, 'later', null], [null, null, null]])
})

test('tools/demo.mjs reads the feedback beside the demo it writes: old pictures are refused and nothing is written; the new try passes, with its words and its map', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-rounds-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(join(dir, 'recap'), { recursive: true })
  const file = name => join(dir, 'recap', name)
  const sentAt = new Date(Date.now() - 60 * MIN)
  const stamp = new Date(sentAt)
  const two = value => String(value).padStart(2, '0')
  const at = `${stamp.getFullYear()}-${two(stamp.getMonth() + 1)}-${two(stamp.getDate())} ${two(stamp.getHours())}:${two(stamp.getMinutes())}`
  await writeFile(file('feedback.json'), JSON.stringify(withRound(null, 1, [{ key: '3. Props', verdict: 'sent-back', comment: 'keep the limit' }], at)))
  for (const name of ['L.png', 'C.png', 'P.png', 'R.png', 'B.png']) await writeFile(file(name), 'x')
  const old = new Date(sentAt.getTime() - 10 * MIN)
  for (const name of ['L.png', 'C.png', 'P.png', 'R.png', 'B.png']) await utimes(file(name), old, old)
  const write = async more => {
    await writeFile(file('list.json'), JSON.stringify(list(more)))
    return writeDemo({ listFile: file('list.json'), out: file('demo.json') })
  }
  await assert.rejects(write({ props: { changed: 'limit kept' } }), /"3\. Props".*no picture was written after that Send/)
  await assert.rejects(write(), /"3\. Props".*has no "changed"/)
  await assert.rejects(write({ props: { changed: 'limit kept', play: 'not an arena' } }), /"play" is an arena name/)
  assert.equal((await readdir(join(dir, 'recap'))).includes('demo.json'), false, 'a refused list writes no demo.json')
  // The new try's picture is written after the Send: it passes, and the demo keeps the words and the map.
  const fresh = new Date(sentAt.getTime() + 20 * MIN)
  await utimes(file('P.png'), fresh, fresh)
  const done = await write({ props: { changed: 'tall props -> limit kept', play: 'ring' } })
  assert.equal(done.pictures, 5)
  const written = JSON.parse(await readFile(file('demo.json'), 'utf8'))
  assert.deepEqual(written.sections[1].rows[0].changed, 'tall props -> limit kept')
  assert.equal(written.sections[1].rows[0].play, 'ring')
  // Or the row says it is pending: no picture needed.
  await utimes(file('P.png'), old, old)
  assert.equal((await write({ props: { pending: 'B925 not started' } })).pictures, 5)
})

// ---------------------------------------------------------------------------------------------------------------------
// The state: the focus goal's cards

const PATH = 'pictures/g6/recap/demo.json'
const ON = { ...parseConfig('{"autopilot":true}', {}), project: 'C:\\garden' }
const goals = ['Last id: G6', 'Focus: G6', '', '- [~] G6 Garden', '    Done when: you walk it at night', '    Goal definition: calm',
  '    Goal definition agreed: 2026-10-18 10:00', '    Part: Block 1 · about 1 h · steps B1', '    Part: Block 2 · about 1 h · steps B2', '    How agreed: 2026-10-18 11:00', ''].join('\n')
const step = (id, state, minutes) => parseItem(`Id: ${id}\nKind: step\nTitle: Task ${id}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - minutes * MIN)}\n`)
const sent = (minutes, parts) => [{ n: 1, at: sinceOf(NOW - minutes * MIN), parts }]
const SENT_BACK = [{ key: 'Block 1', verdict: 'sent-back', comment: 'still stepped' }]
/** The garden recap: Block 1 sent back an hour ago, Block 2 not decided; B1 and B2 older than the Send, B5 B6 B7 made after it. */
const stateOf = ({ changedAt, pending = false, items = [], rounds = sent(60, SENT_BACK) }) => asSent(build(
  [step('B1', 'review', 300), step('B2', 'review', 300), ...items], undefined, goals,
  { recaps: [{ path: PATH, goal: 'G6', changedAt, rounds, parts: ['Block 1', 'Block 2'].map((key, at) => ({ key, title: key, steps: [`B${at + 1}`], pending: pending && at === 0 })) }], goalRecap: { goal: 'G6', path: PATH, pictures: {}, changedAt, rounds }, config: ON },
))

test('the focus recap while round 2 is being made: no verdict card at all (not for the undecided part either), and the quiet card says how many new steps are done', () => {
  const items = [step('B5', 'done', 30), step('B6', 'in progress', 20), step('B7', 'dropped', 10), step('B8', 'review', 5)]
  const state = stateOf({ changedAt: NOW - 200 * MIN, items })
  assert.equal(state.recapCard, null, 'nothing waits for the person\'s verdict')
  assert.deepEqual(state.recapMaking, { goal: 'G6', path: PATH, round: 2, done: 2, total: 4 }, 'B5 done and B7 dropped of the four steps made after the Send; B1 and B2 are older')
  // Written again after the Send (a later minute): the card is the verdict card again, and the quiet one is gone.
  const written = stateOf({ changedAt: NOW - 20 * MIN, items })
  assert.equal(written.recapMaking, null)
  assert.deepEqual(written.recapCard.tiles.map(one => one.title), ['Block 1', 'Block 2'])
  // Block 1 still pending after the rewrite: only Block 2 waits.
  assert.deepEqual(stateOf({ changedAt: NOW - 20 * MIN, pending: true, items }).recapCard.tiles.map(one => one.title), ['Block 2'])
  // Nothing sent back, no quiet card.
  assert.equal(stateOf({ changedAt: NOW - 200 * MIN, rounds: sent(60, [{ key: 'Block 2', verdict: 'approved', comment: '' }]) }).recapMaking, null)
})

test('recapMakingOf: the focus goal\'s recap only; steps of other goals and older steps do not count; none yet is 0 of 0', () => {
  const recap = { goal: 'G6', path: PATH, rounds: sent(60, SENT_BACK), changedAt: NOW - 200 * MIN }
  const other = parseItem(`Id: B9\nKind: step\nTitle: Other\nState: done\nOwner: Digger\nGoal: G7\nSince: ${sinceOf(NOW - 10 * MIN)}\n`)
  const ask = parseItem(`Id: Q4\nKind: ask\nTitle: A question\nState: open\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 10 * MIN)}\n`)
  const first = parseItem(`Id: B6\nKind: step\nTitle: Made at 14:00\nState: done\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - 500 * MIN)}\n\n## History\n- ${sinceOf(NOW - 30 * MIN)} Digger: made\n- ${sinceOf(NOW - 500 * MIN)} Digger: older line\n`)
  const items = new Map([step('B1', 'done', 300), other, ask, first].map(one => [one.head.get('Id'), one]))
  assert.deepEqual(recapMakingOf({ goal: 'G6', recap, items }), { goal: 'G6', path: PATH, round: 2, done: 1, total: 1 }, 'by the first History line, not the Since')
  assert.deepEqual(recapMakingOf({ goal: 'G6', recap, items: new Map() }), { goal: 'G6', path: PATH, round: 2, done: 0, total: 0 })
  assert.equal(recapMakingOf({ goal: 'G7', recap, items }), null, 'not the focus goal\'s recap')
  assert.equal(recapMakingOf({ goal: 'G6', recap: null, items }), null)
})
