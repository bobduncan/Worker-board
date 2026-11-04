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
import { ARENA_NAME, checkList, checkTries, checkWords, demoPage } from '../src/demo.mjs'
import { checkSend, isAfterSend, makingOf, roundPage, roundsOf, withRound } from '../src/demoFeedback.mjs'
import { nextTriesOf, recapCardOf, recapMakingOf, recapRoundDue } from '../src/recapCard.mjs'
import { recapRoundOf } from '../src/recapRound.mjs'
import { recapWaitsOf } from '../src/recaps.mjs'
import { recapRoundWords } from '../src/say.mjs'
import { parseItem, sinceMs } from '../src/work/item.mjs'
import { arenaCheckOf, writeDemo } from '../tools/demo.mjs'
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
/** T17.2: a checker's word on a row's close-up, written after the Send of these tests (16:17): "this shows what you asked". */
const OK = { verdict: 'yes', by: 'Checker', at: '2026-11-02 16:30', why: 'the tall props fade behind the wizard' }
/** A close-up of the spot their words name: the after picture `path`, the before picture beside it, the box in each picture's own pixels. */
const closeup = (path = 'PA.png') => ({ kind: 'closeup', caption: 'the prop, up close', path, before: 'PB.png', box: [40, 24, 64, 48] })
/** A row's words when its new try is in and checked: the whole-screen shot `whole` beside the close-up `path`, `changed`, the checker's yes. */
const tried = (whole, path = 'PA.png', more = {}) => ({ changed: 'limit kept', shows: OK, pictures: [{ kind: 'final', caption: 'in the game', path: whole }, closeup(path)], ...more })
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
  const next = page({ props: { changed: 'tall props -> limit kept, see-through behind a unit', shows: OK }, ring: { pending: 'B925 not started' } })
  const shown = roundPage(next, round1(), written)
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

test('the recap\'s waits: a part pending, or with no "changed" line, stays sent back after the rewrite; while being made no part of it is a verdict', () => {
  const recap = (changedAt, more = {}) => ({
    path: 'pictures/g6/demo.json', goal: 'G6', changedAt, rounds: roundsOf(round1()),
    parts: [['2. Cliffs', 'B2'], ['3. Props', 'B3'], ['4. Ring', 'B4']].map(([key, step]) => ({ key, title: key, steps: [step], pending: false, changed: true, shows: OK, ...(more[key] ?? {}) })),
  })
  const before = recapWaitsOf([recap(SENT_MS - MIN)])
  assert.deepEqual(before.map(one => [one.step, one.verdict, one.making]), [['B2', null, true], ['B3', 'sent-back', true], ['B4', 'sent-back', true]], 'the undecided Cliffs is no verdict while the round is being made')
  const after = recapWaitsOf([recap(SENT_MS + 60_000, { '4. Ring': { pending: true } })])
  assert.deepEqual(after.map(one => [one.step, one.verdict, one.making]), [['B2', null, false], ['B3', null, false], ['B4', 'sent-back', false]], 'Props is tried; Ring is still pending')
  // The coordinator's review of 6f197a4: a demo.json written by hand (a later minute, the old pictures, no "changed" line) is no new try, whatever the file's time.
  const hand = recapWaitsOf([recap(SENT_MS + 90 * MIN, { '3. Props': { changed: false }, '4. Ring': { changed: false } })])
  assert.deepEqual(hand.map(one => [one.step, one.verdict]), [['B2', null], ['B3', 'sent-back'], ['B4', 'sent-back']], 'the undecided Cliffs still waits; the two sent back do not')
  // T17.2: a part whose close-up no checker said shows their words, after the Send, stays sent back: no word, a no, or a yes of before the Send.
  for (const [what, shows] of [['no word', null], ['a no', { ...OK, verdict: 'no' }], ['a yes of before the Send', { ...OK, at: '2026-11-02 16:10' }]]) {
    assert.deepEqual(recapWaitsOf([recap(SENT_MS + 90 * MIN, { '3. Props': { shows } })]).map(one => [one.step, one.verdict]), [['B2', null], ['B3', 'sent-back'], ['B4', null]], what)
  }
})

test('a demo.json written by hand, a later minute and the old pictures, no "changed" line: the rows sent back stay being reworked, whatever the file\'s time', () => {
  const written = { changedAt: SENT_MS + 90 * MIN }
  const hand = roundPage(page(), round1(), written)
  assert.equal(hand.feedback.making, null, 'by its time the recap was written')
  assert.deepEqual(rowsOf(hand).map(one => [one.key, one.reworking === true, one.pictures.length, Boolean(one.said)]), [
    ['2. Cliffs', false, 1, false], ['3. Props', true, 0, true], ['4. Ring', true, 0, true], ['5. Bridges', false, 1, false],
  ], 'Cliffs and Bridges were not sent back: theirs to judge; the two sent back show no old picture')
  assert.equal(hand.feedback.answerable, 2)
  assert.match(checkSend(hand, { round: 2, parts: [{ key: '3. Props', verdict: 'approved' }] }).why, /"3\. Props" is being reworked/)
  // The same wording without the changed line, whatever "changed" holds that is no words.
  for (const changed of [undefined, '', '   ']) assert.equal(roundPage(page({ props: { changed } }), round1(), written).sections.at(-1).rows[0].reworking, true, JSON.stringify(changed))
  // With the line it is the new try; a row sent back in an older round without it is no different.
  assert.equal(roundPage(page({ props: { changed: 'limit kept', shows: OK } }), round1(), written).sections.at(-1).rows[0].reworking ?? false, false)
  const second = withRound(round1(), 2, [{ key: '3. Props', verdict: 'approved', comment: '' }], '2026-11-02 18:30')
  assert.deepEqual(rowsOf(roundPage(page(), second, { changedAt: SENT_MS + 300 * MIN })).filter(one => one.said).map(one => [one.key, one.reworking === true]), [['4. Ring', true]], 'Ring was sent back in round 1 and is still owed its line')
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
    assert.match(lines[0], /does not answer every row the person sent back/)
    assert.match(lines[1], /"3\. Props" \(sent back in round 1, 2026-11-02 16:17\) has no "changed"/)
    assert.match(lines[2], /"4\. Ring" \(sent back in round 1, 2026-11-02 16:17\) has no "changed"/)
    return true
  })
  // "changed" with the old pictures: the pictures are the old try's.
  assert.throws(() => checkList(list({ props: { changed: 'limit kept' }, ring: { changed: 'rounder' } }), { feedback, mtimeOf: old }), /"3\. Props".*no picture was written after that Send[^]*"4\. Ring".*no picture was written after that Send/)
  // A picture written in the Send's own minute is not after it; the next minute is.
  const same = mtimes({ 'P.png': SENT_MS + 30_000, 'PA.png': SENT_MS + 30_000, 'R.png': SENT_MS + 60_000, 'RA.png': SENT_MS + 60_000 })
  assert.throws(() => checkList(list({ props: tried('P.png'), ring: tried('R.png', 'RA.png', { changed: 'rounder' }) }), { feedback, mtimeOf: same }), error => /"3\. Props"/.test(error.message) && !/"4\. Ring"/.test(error.message))
  // One new picture among old ones is enough; "pending" needs neither changed nor pictures newer than the Send; grids count too.
  const fresh = mtimes({ 'P.png': SENT_MS - MIN, 'P2.png': SENT_MS + 5 * MIN, 'PA.png': SENT_MS + 5 * MIN, 'R.png': SENT_MS - MIN })
  const both = list({ props: tried('P.png', 'PA.png', { pictures: [{ kind: 'final', path: 'P.png' }, { kind: 'final', path: 'P2.png' }, closeup()] }), ring: { pending: 'B925 not started' } })
  assert.equal(checkList(both, { feedback, mtimeOf: fresh }), both)
  // T17.2: a grid row has no close-up to carry: it needs the checker's word only.
  const grid = list({ props: { changed: 'limit kept', shows: OK, pictures: undefined, grid: [{ caption: 'A', path: 'P2.png' }] }, ring: { pending: 'B925 not started' } })
  assert.doesNotThrow(() => checkList(grid, { feedback, mtimeOf: fresh }))
  assert.throws(() => checkList(list({ props: { changed: 'limit kept', pictures: undefined, grid: [{ caption: 'A', path: 'P2.png' }] }, ring: { pending: 'B925 not started' } }), { feedback, mtimeOf: fresh }), /"3\. Props".*no "shows"/)
  // No feedback yet, or no tries given: the shape only.
  assert.doesNotThrow(() => checkList(list(), { feedback: null, mtimeOf: old }))
  assert.doesNotThrow(() => checkList(list()))
  // A row sent back in round 1 and approved in round 2 is owed nothing; one sent back again is owed a picture after round 2.
  const later = withRound(feedback, 2, [{ key: '3. Props', verdict: 'approved', comment: '' }, { key: '4. Ring', verdict: 'sent-back', comment: 'still a square' }], '2026-11-02 18:30')
  const sentTwice = sinceMs('2026-11-02 18:30')
  assert.throws(() => checkTries(list({ ring: { changed: 'rounder' } }), { feedback: later, mtimeOf: mtimes({ 'R.png': sentTwice - MIN }) }), /"4\. Ring" \(sent back in round 2, 2026-11-02 18:30\)/)
  const secondTry = tried('R.png', 'RA.png', { changed: 'rounder', shows: { ...OK, at: '2026-11-02 18:40' } })
  const written = mtimes({ 'R.png': sentTwice + 2 * MIN, 'RA.png': sentTwice + 2 * MIN })
  assert.doesNotThrow(() => checkTries(list({ ring: secondTry }), { feedback: later, mtimeOf: written }))
  // The checker's word of round 1 (16:30) is of the first Send: it does not stand for the second.
  assert.throws(() => checkTries(list({ ring: { ...secondTry, shows: OK } }), { feedback: later, mtimeOf: written }), /"4\. Ring" \(sent back in round 2, 2026-11-02 18:30\): its "shows" is dated before that Send/)
})

const tool = { feedback: null, mtimeOf: () => null }

test('the list: the partner\'s "changed" and "pending" are one line, "play" an arena name (letters, digits, dashes, underscores, at most 60) the game has; the board\'s read drops what is none', () => {
  for (const good of ['ring', 'moat-keep', 'g60-stairs-sizes', 'A1', 'long_ledge', 'x'.repeat(60)]) {
    assert.match(good, ARENA_NAME)
    assert.doesNotThrow(() => checkList(list({ ring: { play: good } }), tool), good)
  }
  for (const bad of ['', 'moat keep', 'ring/../x', 'ring&arena=x', 'ring.json', 'x'.repeat(61), 'rïng', 7, null]) {
    assert.throws(() => checkList(list({ ring: { play: bad } }), tool), /"play" is an arena name/, String(bad))
    // The board reading a demo.json never refuses the whole recap for it: that link is left out.
    assert.doesNotThrow(() => checkList(list({ ring: { play: bad } })), String(bad))
    assert.equal(demoPage(list({ ring: { play: bad } })).sections[1].rows[1].play, null, String(bad))
  }
  for (const field of ['changed', 'pending']) {
    for (const bad of ['', '  ', 'two\nlines', 4, null]) {
      assert.throws(() => checkList(list({ ring: { [field]: bad } }), tool), new RegExp(`"${field}" is one line`), `${field}: ${JSON.stringify(bad)}`)
      assert.doesNotThrow(() => demoPage(list({ ring: { [field]: bad } })), `${field}: ${JSON.stringify(bad)}`)
    }
  }
  // The arena must be one the game has (the tool looks it up); a name it has not is refused, one line per row.
  const has = name => ['ring', 'long_ledge'].includes(name)
  assert.doesNotThrow(() => checkWords(list({ ring: { play: 'long_ledge' } }), has))
  assert.throws(() => checkWords(list({ props: { play: 'moat-keep' }, ring: { play: 'rin' } }), has), error => error.message.split('\n').length === 3 && /"moat-keep"/.test(error.message) && /"rin"/.test(error.message))
  assert.doesNotThrow(() => checkWords(list({ ring: { play: 'anything' } })), 'without a way to look it up, no name is looked up')
  // The page model carries them: null for none; the board squeezes the spaces of a line.
  const shown = roundPage(demoPage(list({ props: { changed: ' limit  kept ', play: 'ring' }, ring: { pending: ' later ' } })), null)
  assert.deepEqual(rowsOf(shown).slice(2).map(one => [one.changed, one.pending, one.play]), [['limit kept', null, 'ring'], [null, 'later', null], [null, null, null]])
})

test('the game\'s arenas: its arenas folder and the dev folder in it, from the board\'s gameRepo; none to look at, none looked up', () => {
  const there = new Set(['G:/game', 'G:/game/src', 'G:/game/src/content', 'G:/game/src/content/arenas', 'G:/game/src/content/arenas/dev', 'G:/game/src/content/arenas/long_ledge.json', 'G:/game/src/content/arenas/dev/ring.json'])
  const exists = path => there.has(String(path).replace(/\\/g, '/'))
  const has = arenaCheckOf('G:/game', exists)
  assert.deepEqual(['long_ledge', 'ring', 'moat-keep', ''].map(has), [true, true, false, false])
  assert.equal(arenaCheckOf('', exists), undefined)
  assert.equal(arenaCheckOf(undefined, exists), undefined)
  assert.equal(arenaCheckOf('G:/other', exists), undefined, 'a repository with no arenas folder says nothing')
})

test('the list keeps every row the person sent back: a renamed row is refused (it would lose their words); its title kept, or an "id", passes', () => {
  const old = mtimes({ 'P.png': SENT_MS + 5 * MIN, 'R.png': SENT_MS + 5 * MIN, 'PA.png': SENT_MS + 5 * MIN, 'RA.png': SENT_MS + 5 * MIN })
  const tries = { feedback, mtimeOf: old }
  const props = tried('P.png')
  const ring = tried('R.png', 'RA.png', { changed: 'rounder' })
  const renamed = list({ props, ring: { ...ring, title: '4. A round pool' } })
  renamed.sections[1].rows[1].title = '4. A round pool'
  assert.throws(() => checkList(renamed, tries), error => {
    const lines = error.message.split('\n')
    assert.equal(lines.length, 2, error.message)
    assert.match(lines[1], /"4\. Ring" \(sent back in round 1, 2026-11-02 16:17\) is in no row of the list: keep the row's title, or give the row "id": "4\. Ring"/)
    return true
  })
  // Given its old key as an id it is the same part: its words stay, and the page keys it by it.
  const kept = list({ props, ring: { ...ring, id: '4. Ring' } })
  kept.sections[1].rows[1].title = '4. A round pool'
  assert.doesNotThrow(() => checkList(kept, tries))
  assert.deepEqual(rowsOf(roundPage(demoPage(kept), feedback, { changedAt: SENT_MS + 5 * MIN })).filter(one => one.said).map(one => [one.key, one.title, one.said.comment]), [
    ['3. Props', '3. Props', 'keep the limit for tall props'], ['4. Ring', '4. A round pool', 'not round enough'],
  ])
  // A part dropped from the list is refused as much as a renamed one; a row approved since may go.
  const dropped = list({ props, ring })
  dropped.sections[1].rows.splice(1, 1)
  assert.throws(() => checkList(dropped, tries), /"4\. Ring" .* is in no row of the list/)
  const approved = withRound(feedback, 2, [{ key: '4. Ring', verdict: 'approved', comment: '' }], '2026-11-02 18:30')
  assert.doesNotThrow(() => checkList(dropped, { feedback: approved, mtimeOf: mtimes({ 'P.png': SENT_MS + 5 * MIN, 'PA.png': SENT_MS + 5 * MIN }) }))
})

test('an answer in words passes on a new note: the row says what changed and its note differs from the demo it replaces; the same list taken twice passes again', () => {
  const stale = mtimes({ 'P.png': SENT_MS - MIN, 'R.png': SENT_MS - MIN })
  const row = (note, changed = 'asked for guidelines -> the study is written out', shows = OK) => list({ props: { note, changed, ...(shows === false ? {} : { shows }) }, ring: { pending: 'B925 not started' } })
  const replaced = (note, changed, writtenAt) => ({ list: row(note, changed), writtenAt })
  // No new picture and the note as it was: refused. A different note: passes. An empty note is no answer.
  assert.throws(() => checkList(row('the old note'), { feedback, mtimeOf: stale, previous: replaced('the old note', 'x', SENT_MS - 4 * 60 * MIN) }), /"3\. Props".*the old one, so this is the old try/)
  assert.throws(() => checkList(row('the old note'), { feedback, mtimeOf: stale, previous: null }), /"3\. Props"/, 'nothing to compare with: the pictures decide')
  assert.doesNotThrow(() => checkList(row('Guidelines: 1. two ways up every floor. 2. a fight fits the view.'), { feedback, mtimeOf: stale, previous: replaced('the old note', 'x', SENT_MS - 4 * 60 * MIN) }))
  assert.throws(() => checkList(row(''), { feedback, mtimeOf: stale, previous: replaced('the old note', 'x', SENT_MS - 4 * 60 * MIN) }), /"3\. Props"/)
  // T17.2 (row 8 of G60's recap): an answer in words needs no close-up, but the same check: a checker's yes dated at or after the Send.
  const words = { feedback, mtimeOf: stale, previous: replaced('the old note', 'x', SENT_MS - 4 * 60 * MIN) }
  assert.throws(() => checkList(row('Guidelines: two ways up every floor.', undefined, false), words), /"3\. Props".*no "shows"/)
  assert.throws(() => checkList(row('Guidelines: two ways up every floor.', undefined, { ...OK, verdict: 'no', why: 'it says nothing of the stairs' }), words), /"3\. Props".*does not show their words yet: "it says nothing of the stairs"/)
  assert.throws(() => checkList(row('Guidelines: two ways up every floor.', undefined, { ...OK, at: '2026-11-02 16:00' }), words), /"3\. Props".*dated before that Send/)
  // The demo about to be replaced was taken after the Send with the same "changed" line: the tool run again passes (words only).
  const again = { feedback, mtimeOf: stale, previous: replaced('Guidelines: 1. two ways up every floor.', 'asked for guidelines -> the study is written out', SENT_MS + 30 * MIN) }
  assert.doesNotThrow(() => checkList(row('Guidelines: 1. two ways up every floor.'), again))
  // ... but not when that demo was older than the Send, or said something else.
  assert.throws(() => checkList(row('Guidelines: 1. two ways up every floor.'), { ...again, previous: replaced('Guidelines: 1. two ways up every floor.', 'asked for guidelines -> the study is written out', SENT_MS - MIN) }), /"3\. Props"/)
  assert.throws(() => checkList(row('Guidelines: 1. two ways up every floor.'), { ...again, previous: replaced('Guidelines: 1. two ways up every floor.', 'something else', SENT_MS + 30 * MIN) }), /"3\. Props"/)
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
  // T17.2: a checker's word dated 30 minutes after the Send.
  const checked = new Date(sentAt.getTime() + 30 * MIN)
  const shows = { verdict: 'yes', by: 'Checker', at: `${checked.getFullYear()}-${two(checked.getMonth() + 1)}-${two(checked.getDate())} ${two(checked.getHours())}:${two(checked.getMinutes())}`, why: 'the tall props fade behind the unit' }
  await writeFile(file('feedback.json'), JSON.stringify(withRound(null, 1, [{ key: '3. Props', verdict: 'sent-back', comment: 'keep the limit' }], at)))
  const names = ['L.png', 'C.png', 'P.png', 'R.png', 'B.png', 'PA.png', 'PB.png']
  for (const name of names) await writeFile(file(name), 'x')
  const old = new Date(sentAt.getTime() - 10 * MIN)
  for (const name of names) await utimes(file(name), old, old)
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
  // T17.2: a whole-screen shot alone is not enough: it needs the close-up (its after picture written after the Send) and a checker's word.
  const props = { changed: 'tall props -> limit kept', play: 'ring', pictures: [{ kind: 'final', caption: 'in the game', path: 'P.png' }, { kind: 'closeup', caption: 'the crystal', path: 'PA.png', before: 'PB.png', box: [40, 24, 64, 48] }] }
  await assert.rejects(write({ props: { changed: 'tall props -> limit kept', play: 'ring' } }), /"3. Props".*no close-up; no "shows"/)
  await assert.rejects(write({ props: { ...props, shows } }), /"3. Props".*written before that Send, so it is the old try/)
  await utimes(file('PA.png'), fresh, fresh)
  await assert.rejects(write({ props }), /"3. Props".*no "shows"/)
  const done = await write({ props: { ...props, shows } })
  assert.equal(done.pictures, 7, 'the before picture counts')
  const written = JSON.parse(await readFile(file('demo.json'), 'utf8'))
  assert.deepEqual(written.sections[1].rows[0].changed, 'tall props -> limit kept')
  assert.equal(written.sections[1].rows[0].play, 'ring')
  // The demo.json holds the close-up first, its paths from demo.json's own folder, and the checker's word.
  assert.deepEqual(written.sections[1].rows[0].pictures.map(one => [one.kind, one.path, one.before ?? null]), [['closeup', 'PA.png', 'PB.png'], ['final', 'P.png', null]])
  assert.equal(written.sections[1].rows[0].shows.by, 'Checker')
  // Or the row says it is pending: no picture needed.
  await utimes(file('P.png'), old, old)
  await utimes(file('PA.png'), old, old)
  assert.equal((await write({ props: { pending: 'B925 not started' } })).pictures, 5)
  // An answer in words: no new picture, but a note that differs from the demo.json it replaces; taken again as it is, it passes again.
  await write({ props: { pending: 'B925 not started', note: 'the old note' } })
  await assert.rejects(write({ props: { changed: 'asked for guidelines -> written out', note: 'the old note', shows } }), /the old one, so this is the old try/)
  await assert.rejects(write({ props: { changed: 'asked for guidelines -> written out', note: 'Guidelines: two ways up every floor.' } }), /"3. Props".*no "shows"/)
  await write({ props: { changed: 'asked for guidelines -> written out', note: 'Guidelines: two ways up every floor.', shows } })
  await write({ props: { changed: 'asked for guidelines -> written out', note: 'Guidelines: two ways up every floor.', shows } })
  // The arena must be one the game has; without a way to look it up the name is taken as it is.
  const has = name => name === 'ring'
  const arena = play => (async () => {
    await writeFile(file('list.json'), JSON.stringify(list({ props: { pending: 'B925 not started', play } })))
    return writeDemo({ listFile: file('list.json'), out: file('demo.json'), hasArena: has })
  })()
  await assert.rejects(arena('no-such-map'), /the game has no arena "no-such-map"/)
  assert.equal((await arena('ring')).pictures, 5)
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
/** T17.2: a checker's word on the close-up of a row, 30 minutes ago: after the Send of an hour ago. */
const CHECKED = { verdict: 'yes', by: 'Checker', at: sinceOf(NOW - 30 * MIN), why: 'the ring reads round' }
/** The garden recap: Block 1 sent back an hour ago, Block 2 not decided; B1 and B2 older than the Send, B5 B6 B7 made after it. */
const stateOf = ({ changedAt, pending = false, items = [], rounds = sent(60, SENT_BACK), config = ON }) => asSent(build(
  [step('B1', 'review', 300), step('B2', 'review', 300), ...items], undefined, goals,
  { recaps: [{ path: PATH, goal: 'G6', changedAt, rounds, parts: ['Block 1', 'Block 2'].map((key, at) => ({ key, title: key, steps: [`B${at + 1}`], pending: pending && at === 0, changed: true, shows: CHECKED })) }], goalRecap: { goal: 'G6', path: PATH, pictures: {}, changedAt, rounds }, config },
))

test('the focus recap while round 2 is being made: no verdict card at all (not for the undecided part either), and the quiet card says how many next tries are done', () => {
  const items = [step('B5', 'done', 30), step('B6', 'in progress', 20), step('B7', 'dropped', 10), step('B8', 'review', 5)]
  const state = stateOf({ changedAt: NOW - 200 * MIN, items })
  assert.equal(state.recapCard, null, 'nothing waits for the person\'s verdict')
  assert.deepEqual(state.recapMaking, { goal: 'G6', path: PATH, round: 2, done: 2, total: 4, doneSteps: ['B5'] }, 'B5 done and B7 dropped of the four steps made after the Send; B1 and B2 are older')
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
  assert.deepEqual(recapMakingOf({ goal: 'G6', recap, items }), { goal: 'G6', path: PATH, round: 2, done: 1, total: 1, doneSteps: ['B6'] }, 'by the first History line, not the Since')
  assert.deepEqual(recapMakingOf({ goal: 'G6', recap, items: new Map() }), { goal: 'G6', path: PATH, round: 2, done: 0, total: 0, doneSteps: [] })
  assert.equal(recapMakingOf({ goal: 'G7', recap, items }), null, 'not the focus goal\'s recap')
  assert.equal(recapMakingOf({ goal: 'G6', recap: null, items }), null)
})

test('the next tries: the goal\'s steps filed or reopened after the Send, no Quality Assurance task (it checks a try, it is none)', () => {
  const at = sinceMs(sinceOf(NOW - 60 * MIN))
  const history = (...lines) => `\n## History\n${lines.map(line => `- ${line}`).join('\n')}\n`
  const made = (id, state, minutes, more = '', lines = []) => parseItem(`Id: ${id}\nKind: step\nTitle: Task ${id}\nState: ${state}\nOwner: Digger\nGoal: G6\nSince: ${sinceOf(NOW - minutes * MIN)}\n${more}${lines.length === 0 ? '' : history(...lines)}`)
  const items = new Map([
    made('B1', 'review', 300),
    made('B2', 'in progress', 300, '', [`${sinceOf(NOW - 300 * MIN)} Digger: new → queued`, `${sinceOf(NOW - 20 * MIN)} Digger: done → in progress`]),
    made('B3', 'done', 300, '', [`${sinceOf(NOW - 300 * MIN)} Digger: new → done`, `${sinceOf(NOW - 20 * MIN)} server: review → done`]),
    made('B4', 'queued', 10),
    made('B5', 'done', 15, 'Checks: B4\n'),
    made('B6', 'done', 15, '', [`${sinceOf(NOW - 15 * MIN)} Digger: new → done`]),
    parseItem(`Id: B7\nKind: step\nTitle: Task B7\nState: done\nOwner: Digger\nGoal: G7\nSince: ${sinceOf(NOW - 15 * MIN)}\n`),
    made('B8', 'queued', 300, '', [`${sinceOf(NOW - 300 * MIN)} Digger: new → queued`, `${sinceOf(NOW - 30 * MIN)} person: dropped → queued`]),
  ].map(one => [one.head.get('Id'), one]))
  assert.deepEqual(nextTriesOf(items, 'G6', at).map(one => one.head.get('Id')), ['B2', 'B4', 'B6', 'B8'], 'B2 and B8 were reopened, B4 and B6 filed; B5 checks B4, B1 and B3 are old, B7 is of another goal')
  const recap = { goal: 'G6', path: PATH, rounds: sent(60, SENT_BACK), changedAt: NOW - 200 * MIN }
  assert.deepEqual(recapMakingOf({ goal: 'G6', recap, items }), { goal: 'G6', path: PATH, round: 2, done: 1, total: 4, doneSteps: ['B6'] })
})

test('the coordinator\'s ruling: while round 2 is being made the focus recap is always the quiet card, whatever else waits; a step a part of it names does not wait for the verdict', () => {
  const open = (id, fields) => parseItem(`${Object.entries({ Id: id, Kind: 'ask', State: 'open', Owner: 'Digger', Since: sinceOf(NOW - 30 * MIN), Filed: NOW - 30 * MIN, Blocking: 'no', ...fields }).map(([key, value]) => `${key}: ${value}`).join('\n')}\n`)
  // Block 1: a look stands with the person (a verdict of a step no part names); the goal's own ask "play it"; Block 2's step B2 is a part of the recap, with a look too.
  const asks = [
    open('Q21', { Title: 'Approve the first block at 68 of 75?', Asks: 'look', Of: 'B1' }),
    open('Q22', { Title: `Open the recap and try it: [Open the recap](http://127.0.0.1:4314/#demo=${PATH}).`, Asks: 'do' }),
    open('Q23', { Title: 'Approve the second block?', Asks: 'look', Of: 'B2' }),
  ]
  const build2 = changedAt => asSent(build([step('B1', 'review', 300), step('B2', 'review', 300), ...asks], undefined, goals,
    { recaps: [{ path: PATH, goal: 'G6', changedAt, rounds: sent(60, [{ key: 'Block 1', verdict: 'approved', comment: '' }, { key: 'Block 3', verdict: 'sent-back', comment: 'x' }]), parts: [{ key: 'Block 2', title: 'Block 2', steps: ['B2'], pending: false, changed: true }] }],
      goalRecap: { goal: 'G6', path: PATH, pictures: {}, changedAt, rounds: sent(60, [{ key: 'Block 1', verdict: 'approved', comment: '' }, { key: 'Block 3', verdict: 'sent-back', comment: 'x' }]) } }))
  const written = build2(NOW - 20 * MIN)
  assert.equal(written.recapMaking, null)
  // The review of 2026-11-04: the card counts the popup's N: the part Block 2 (a row ready to judge); the look of B1 and the goal's own ask stand as
  // cards of their own (or, routed to the recap, outside the card).
  assert.equal(written.recapCard.count, 1, 'the part Block 2 waits for the person once the recap is written')
  assert.equal(written.focus.parts[1].steps[0].waitsForVerdict, true)
  const making = build2(NOW - 200 * MIN)
  assert.equal(making.recapCard, null, 'no card of verdicts at all')
  assert.deepEqual([making.recapMaking.round, making.recapMaking.path], [2, PATH])
  // Block 2's step is a part of the recap whose round is being made: no "Waits for your verdict", no arrow; Block 1's step is no part of it.
  assert.deepEqual(making.focus.parts[1].steps.map(one => [one.waitsForVerdict, one.verdictAt, one.state]), [[false, null, 'Waits for the next round']])
  assert.notEqual(making.focus.parts[1].state, 'verdict')
  assert.equal(making.focus.parts[0].steps[0].waitsForVerdict, true, 'a step no part of the recap names keeps its own chip')
})

test('the partner\'s word for a next try that turned done: the board\'s own line, once per step (recap: G<n> round <N+1>: <B..> is done; ...)', () => {
  const words = recapRoundWords('Advisor', { goal: 'G60', round: 2, step: 'B930', path: 'art/g60/recap/demo.json', job: 'roles/partner.md' })
  assert.deepEqual([words.to, words.command, words.about, words.step], ['Advisor', 'recap-round', 'G60', 'B930'])
  assert.equal(words.text.split('\n')[0], 'recap: G60 round 2: B930 is done; write the round with its row, `pending` for the rest')
  assert.match(words.text, /\nDemo: art\/g60\/recap\/demo\.json\nYour job: roles\/partner\.md, "Recap feedback"$/)
})

test('each step is told once: the steps done that no word of the board names yet, whatever the state of that word; again after a restart (the outbox is kept)', () => {
  const making = { goal: 'G60', round: 2, doneSteps: ['B930', 'B931'] }
  const told = (step, state = 'delivered', more = {}) => ({ command: 'recap-round', about: 'G60', step, state, ...more })
  assert.deepEqual(recapRoundDue(making, []), ['B930', 'B931'])
  assert.deepEqual(recapRoundDue(making, [told('B930')]), ['B931'])
  for (const state of ['waiting', 'taken', 'delivered', 'expired', 'dropped']) assert.deepEqual(recapRoundDue(making, [told('B930', state), told('B931', state)]), [], state)
  // A word of another goal, another command or another step is not this one's.
  assert.deepEqual(recapRoundDue(making, [told('B930', 'delivered', { about: 'G7' }), { command: 'recap-feedback', about: 'G60', step: 'B931' }]), ['B930', 'B931'])
  assert.deepEqual(recapRoundDue(null, [told('B930')]), [])
  assert.deepEqual(recapRoundDue({ goal: 'G60', doneSteps: [] }, []), [])
})

const round1ish = withRound(null, 1, [{ key: 'Block 1', verdict: 'sent-back', comment: 'still stepped' }], SENT)

test('the card function itself gives none while the recap\'s round is being made: by its `making`; the round reads no row as ready then, and keeps its looks for the round after', () => {
  const blocks = [{ title: 'Ring', state: 'open', steps: [{ id: 'B920', waitsForVerdict: true, verdictAt: { step: 'B920' } }] }]
  const rows = [{ key: 'Block 1', title: 'Block 1', steps: ['B821'], ready: true, path: PATH }]
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, rows, blocks }).count, 1, 'written: the row waits (the block that waits for its own card is no count of the recap card)')
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, rows, blocks, making: { round: 2 } }), null)
  assert.equal(recapCardOf({ goal: 'G6', recapPath: PATH, rows: [], blocks, making: { round: 2 } }), null)
  // The round itself (src/recapRound.mjs): the Send sent Block 1 back and the recap was not written since: nothing to judge, no look either.
  const look = { route: 'recap', isKept: true, asks: 'look', of: 'B9', goal: 'G6', id: 'Q5', title: 'A look', text: '', pictures: [] }
  const recap = changedAt => ({ path: PATH, goal: 'G6', changedAt, rounds: roundsOf(round1ish), parts: [{ key: 'Block 1', title: 'Block 1', steps: ['B821'], pending: false, changed: true, shows: { ...CHECKED, at: '2026-11-02 16:30' } }, { key: 'Block 2', title: 'Block 2', steps: ['B2'], pending: false, changed: true }] })
  const made = recapRoundOf({ goal: 'G6', goalRecap: { goal: 'G6', path: PATH, pictures: {} }, recaps: [recap(SENT_MS - MIN)], routed: [look] })
  assert.deepEqual([made.making, made.toJudge, made.ready.length, made.looks.length], [{ round: 2 }, 0, 0, 0])
  const written = recapRoundOf({ goal: 'G6', goalRecap: { goal: 'G6', path: PATH, pictures: {} }, recaps: [recap(SENT_MS + 2 * MIN)], routed: [look] })
  assert.deepEqual([written.making, written.ready.map(one => one.key), written.looks.map(one => one.ask), written.toJudge], [null, ['Block 1', 'Block 2'], ['Q5'], 3])
})
