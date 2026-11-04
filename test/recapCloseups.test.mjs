// T17.2 (the person, 2026-11-04, looking at G60's recap row 7, tall props that fade while a unit stands behind them: "This demo never really
// updates it's images in the demo: I expect that when i promide feedback i get new tailored demo on the aspects i asked for.. e.g. a picture
// of a tall prop that is transparent like i asked for in this case."): the list's two new picture kinds (a close-up of the spot their words
// name, a clip where something moves) and a row's `shows` (a checker's word that the close-up shows their words); the tool's gate (a row sent
// back needs a close-up written after the Send and a `shows` of at or after it); the board's gate (a row sent back is the new try only with
// that word). Made-up garden names only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BOX_MIN, CLIP_MS, PICTURES, checkList, demoPage, orderedPictures, picturesOf } from '../src/demo.mjs'
import { checkSend, roundPage, showsCheck, withRound } from '../src/demoFeedback.mjs'
import { roundRowsOf } from '../src/recapRound.mjs'
import { sinceMs } from '../src/work/item.mjs'
import { demoFile, missingPictures, pictureFiles, writeDemo } from '../tools/demo.mjs'

const MIN = 60_000
const SENT = '2026-11-04 10:00'
const SENT_MS = sinceMs(SENT)
/** The checker's word: a yes at 10:20, after the Send of 10:00. */
const YES = { verdict: 'yes', by: 'Checker', at: '2026-11-04 10:20', why: 'the crystal fades while the wizard stands behind it' }
const CLOSE = { kind: 'closeup', caption: 'The crystal behind the wizard', path: 'after.png', before: 'before.png', box: [120, 64, 48, 40] }
const CLIP = { kind: 'clip', caption: 'The crystal fades', frames: ['f1.png', 'f2.png', 'f3.png'], box: [120, 64, 48, 40], ms: 600 }
const SHOT = { kind: 'final', caption: 'in the game', path: 'whole.png' }
const row = (more = {}) => ({ title: '7. Tall props', pictures: [SHOT], ...more })
const list = (...rows) => ({ goal: 'G6', title: 'The polish', step: 'B7', sections: [{ kind: 'open', rows }] })
const refusal = (value, tries) => { try { checkList(value, tries) } catch (error) { return error.message } return null }

// ---------------------------------------------------------------------------------------------------------------------
// The list's shape

test('a close-up and a clip pass; the optional parts may be left out', () => {
  assert.doesNotThrow(() => checkList(list(row({ pictures: [CLOSE, CLIP, SHOT], shows: YES }))))
  assert.doesNotThrow(() => checkList(list(row({ pictures: [{ kind: 'closeup', path: 'a.png', before: 'b.png', box: [0, 0, BOX_MIN, BOX_MIN], beforeBox: [3, 4, 20, 30] }] }))))
  assert.doesNotThrow(() => checkList(list(row({ pictures: [{ kind: 'clip', frames: ['a.png', 'b.png'] }] }))), 'a clip with no path, box or ms')
  assert.doesNotThrow(() => checkList(list(row({ pictures: [{ kind: 'clip', frames: Array.from({ length: 12 }, (_, at) => `f${at}.png`), ms: CLIP_MS.max, path: 'last.png' }] }))))
  assert.doesNotThrow(() => checkList(list(row({ pictures: [{ kind: 'clip', frames: ['a.png', 'b.png'], ms: CLIP_MS.min }] }))))
})

test('a box with a negative or a missing value, a clip with 1 or 13 frames, ms 100, and shows with the verdict "maybe" are each refused, in one line', () => {
  const boxes = [[-1, 0, 20, 20], [0, -1, 20, 20], [0, 0, 20], [0, 0, 20, undefined], [0, 0, BOX_MIN - 1, 20], [0, 0, 20, BOX_MIN - 1], [0.5, 0, 20, 20], ['0', 0, 20, 20], '0,0,20,20', null, {}]
  for (const box of boxes) {
    const said = refusal(list(row({ pictures: [{ ...CLOSE, box }] })))
    assert.match(said, /a close-up's "box"/, JSON.stringify(box))
    assert.equal(said.split('\n').length, 1, 'one line')
  }
  assert.match(refusal(list(row({ pictures: [{ ...CLOSE, beforeBox: [0, 0, 5, 5] }] }))), /a close-up's "beforeBox"/)
  assert.match(refusal(list(row({ pictures: [{ ...CLIP, box: [0, 0, 5, 5] }] }))), /a clip's "box"/)
  assert.match(refusal(list(row({ pictures: [{ kind: 'closeup', path: 'a.png', box: [0, 0, 20, 20] }] }))), /no "before"/)
  assert.match(refusal(list(row({ pictures: [{ kind: 'closeup', before: 'b.png', box: [0, 0, 20, 20] }] }))), /no path/)
  for (const frames of [['only.png'], Array.from({ length: 13 }, (_, at) => `f${at}.png`), [], undefined, 'a.png', ['a.png', '']]) {
    const said = refusal(list(row({ pictures: [{ kind: 'clip', frames }] })))
    assert.match(said, /a clip has 2 to 12 frames/, JSON.stringify(frames))
    assert.equal(said.split('\n').length, 1)
  }
  for (const ms of [100, 299, 3001, 900.5, '900', null]) assert.match(refusal(list(row({ pictures: [{ ...CLIP, ms }] }))), /a clip's "ms" is 300 to 3000/, String(ms))
  for (const shows of [{ ...YES, verdict: 'maybe' }, { ...YES, by: '' }, { ...YES, by: undefined }, { ...YES, why: 'two\nlines' }, { ...YES, why: '  ' }, { ...YES, at: '2026-11-04' }, { ...YES, at: '2026-13-45 99:99' }, 'yes', null, []]) {
    const said = refusal(list(row({ shows })))
    assert.match(said, /"shows"/, JSON.stringify(shows))
    assert.equal(said.split('\n').length, 1)
  }
  assert.doesNotThrow(() => checkList(list(row({ shows: { ...YES, verdict: 'no' } }))), 'a no is a word too')
})

test('the page model: the close-up and the clip first, their paths from the list\'s folder, the captions and pace by default, the checker\'s word cleaned', () => {
  const page = demoPage(list(row({ pictures: [SHOT, { kind: 'target', caption: 'target', path: 't.png' }, CLIP, CLOSE], shows: { ...YES, by: ' Checker ', why: 'it  fades' } })), 'pictures/g6/recap')
  const [one] = page.sections[0].rows
  assert.deepEqual(one.pictures.map(picture => [picture.kind, picture.label]), [['closeup', 'YOUR WORDS, UP CLOSE'], ['clip', 'YOUR WORDS, MOVING'], ['target', 'TARGET'], ['final', 'FINAL, IN THE GAME']])
  assert.deepEqual(one.pictures[0], {
    kind: 'closeup', label: 'YOUR WORDS, UP CLOSE', path: 'pictures/g6/recap/after.png', caption: 'The crystal behind the wizard', before: 'pictures/g6/recap/before.png',
    box: [120, 64, 48, 40], beforeBox: [120, 64, 48, 40], beforeCaption: 'Before your words', afterCaption: 'Now',
  })
  assert.deepEqual([one.pictures[1].frames, one.pictures[1].path, one.pictures[1].ms, one.pictures[1].box], [['pictures/g6/recap/f1.png', 'pictures/g6/recap/f2.png', 'pictures/g6/recap/f3.png'], 'pictures/g6/recap/f3.png', 600, [120, 64, 48, 40]], 'the last frame stands for the picture')
  assert.deepEqual(one.shows, { verdict: 'yes', by: 'Checker', at: '2026-11-04 10:20', why: 'it fades' })
  const plain = demoPage(list(row({ pictures: [{ kind: 'clip', frames: ['a.png', 'b.png'] }, { ...CLOSE, beforeBox: [1, 2, 30, 40], beforeCaption: 'Before', afterCaption: 'After' }] })), '').sections[0].rows[0]
  assert.deepEqual([plain.pictures[0].beforeBox, plain.pictures[0].beforeCaption, plain.pictures[0].afterCaption], [[1, 2, 30, 40], 'Before', 'After'])
  assert.deepEqual([plain.pictures[1].ms, plain.pictures[1].box, plain.pictures[1].path], [900, null, 'b.png'])
  assert.equal(demoPage(list(row())).sections[0].rows[0].shows, null)
  assert.deepEqual(Object.keys(PICTURES).slice(0, 2), ['closeup', 'clip'])
  assert.deepEqual(orderedPictures([SHOT, CLIP, CLOSE]).map(picture => picture.kind), ['closeup', 'clip', 'final'])
})

test('every file a picture names is known: the after and before pictures of a close-up and every frame of a clip', () => {
  const rows = list(row({ pictures: [SHOT, CLOSE, CLIP] }))
  assert.deepEqual(picturesOf(rows).map(one => one.path), ['after.png', 'before.png', 'f3.png', 'f1.png', 'f2.png', 'f3.png', 'whole.png'])
  const files = [...new Set(pictureFiles(rows, 'C:/garden'))].map(file => file.replace(/\\/g, '/'))
  assert.deepEqual(files, ['C:/garden/whole.png', 'C:/garden/after.png', 'C:/garden/before.png', 'C:/garden/f3.png', 'C:/garden/f1.png', 'C:/garden/f2.png'])
  const gone = missingPictures(list(row({ pictures: [CLOSE, CLIP] })), 'C:/garden', file => !/before|f2/.test(file))
  assert.deepEqual(gone.map(file => file.replace(/\\/g, '/')), ['C:/garden/before.png', 'C:/garden/f2.png'])
})

// ---------------------------------------------------------------------------------------------------------------------
// The tool's gate: G60 row 7's shape

const feedback = withRound(null, 1, [{ key: '7. Tall props', verdict: 'sent-back', comment: 'tall props fade while a unit stands behind them' }, { key: '8. Study', verdict: 'sent-back', comment: 'write the guidelines out' }], SENT)
/** Everything written 5 minutes after the Send, except what `old` names. */
const written = (old = []) => path => (old.includes(path) ? SENT_MS - 30 * MIN : SENT_MS + 5 * MIN)
const study = (more = {}) => ({ title: '8. Study', note: 'The guidelines: two ways up every floor.', changed: 'asked for guidelines -> written out', pictures: [{ kind: 'final', caption: 'x', path: 'study.png' }], shows: YES, ...more })
const props = (more = {}) => row({ changed: 'tall props -> they fade for a unit behind them', ...more })
const previous = { list: list(study({ note: 'The old note' })), writtenAt: SENT_MS - 4 * 60 * MIN }

test('G60 row 7\'s shape: only whole-screen shots written after the Send is refused for the missing close-up; with the close-up but no word of a checker, refused again', () => {
  const tries = (old = []) => ({ feedback, mtimeOf: written(old), previous })
  const said = refusal(list(props(), study()), tries())
  assert.match(said, /"7\. Tall props" \(sent back in round 1, 2026-11-04 10:00\): no close-up; no "shows"/)
  assert.match(said, /Make the close-up: the before and after pictures and the box of the spot their words name, a clip when it moves; then have a checker who did not make it write "shows"/)
  assert.equal(said.split('\n').length, 2, 'the head and one line for the row (row 8, an answer in words, is fine)')
  // With the close-up (written after the Send) and no word: refused for the word only.
  assert.equal(refusal(list(props({ pictures: [SHOT, CLOSE] }), study()), tries()).includes('no close-up'), false)
  assert.match(refusal(list(props({ pictures: [SHOT, CLOSE] }), study()), tries()), /"7\. Tall props".*: no "shows" \(the check\)\. Make the close-up/)
  // A yes dated before the Send checked an older try; a no says why; a yes at the Send's own minute or later is fine.
  assert.match(refusal(list(props({ pictures: [SHOT, CLOSE], shows: { ...YES, at: '2026-11-04 09:59' } }), study()), tries()), /"7\. Tall props".*its "shows" is dated before that Send, so it checked an older try/)
  assert.match(refusal(list(props({ pictures: [SHOT, CLOSE], shows: { ...YES, verdict: 'no', why: 'it shows the whole screen, not the prop' } }), study()), tries()), /its check says it does not show their words yet: "it shows the whole screen, not the prop"/)
  assert.equal(refusal(list(props({ pictures: [SHOT, CLOSE], shows: { ...YES, at: SENT } }), study()), tries()), null, 'a word of the Send\'s own minute is not before it')
  // The close-up and the word: passes. A clip beside it is no harm.
  assert.equal(refusal(list(props({ pictures: [SHOT, CLOSE, CLIP], shows: YES }), study()), tries()), null)
  // The close-up's after picture written before the Send is the old try's, whatever else is new.
  assert.match(refusal(list(props({ pictures: [SHOT, CLOSE], shows: YES }), study()), tries(['after.png'])), /"7\. Tall props".*its close-up's after picture was written before that Send, so it is the old try/)
  // "pending" needs none of it.
  assert.equal(refusal(list(props({ pending: 'B957 not started' }), study()), tries()), null)
})

test('row 8\'s shape, an answer in words: a new note passes with the checker\'s word and no close-up; without the word it is refused', () => {
  const tries = { feedback, mtimeOf: written(['study.png', 'whole.png']), previous }
  const closeupped = props({ pictures: [SHOT, CLOSE], shows: YES })
  assert.equal(refusal(list(closeupped, study()), tries), null)
  const noWord = refusal(list(closeupped, study({ shows: undefined })), tries)
  assert.match(noWord, /"8\. Study" \(sent back in round 1.*no "shows"/)
  assert.doesNotMatch(noWord, /no close-up/)
  assert.match(refusal(list(closeupped, study({ shows: { ...YES, at: '2026-11-04 09:00' } })), tries), /"8\. Study".*dated before that Send/)
  // A row whose pictures are a grid has no close-up to carry: the checker's word is what it needs.
  const grid = { title: '9. Grid', changed: 'asked for a grid -> the grid', grid: [{ caption: 'A', path: 'g.png' }], shows: YES }
  const all = withRound(null, 1, ['7. Tall props', '8. Study', '9. Grid'].map(key => ({ key, verdict: 'sent-back', comment: 'again' })), SENT)
  assert.equal(refusal(list(closeupped, study(), grid), { ...tries, feedback: all }), null)
  assert.match(refusal(list(closeupped, study(), { ...grid, shows: undefined }), { ...tries, feedback: all }), /"9\. Grid".*no "shows"/)
})

test('the checker\'s word is a check of its own time: showsCheck says yes, no or waits for the Send it is asked about', () => {
  assert.equal(showsCheck(YES, SENT_MS).state, 'yes')
  assert.deepEqual(showsCheck({ ...YES, verdict: 'no', why: 'not the prop' }, SENT_MS), { state: 'no', why: 'not the prop' })
  for (const word of [null, undefined, 'yes', {}, { ...YES, verdict: 'maybe' }, { ...YES, at: 'later' }, { ...YES, at: '2026-11-04 09:59' }]) assert.equal(showsCheck(word, SENT_MS).state, 'waits', JSON.stringify(word))
  assert.equal(showsCheck(YES, Number.NaN).state, 'yes', 'a Send with no readable time cannot date a word')
})

test('tools/demo.mjs: a close-up\'s missing before picture and a clip\'s missing frame are refused, nothing is written; present, they are written relative to demo.json', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'demo-closeup-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await mkdir(join(dir, 'pics'), { recursive: true })
  const file = name => join(dir, 'pics', name)
  for (const name of ['after.png', 'whole.png', 'f1.png', 'f3.png']) await writeFile(file(name), 'x')
  const write = () => (async () => {
    await writeFile(file('list.json'), JSON.stringify(list(row({ pictures: [SHOT, CLOSE, CLIP] }))))
    return writeDemo({ listFile: file('list.json'), out: join(dir, 'recap', 'demo.json') })
  })()
  await assert.rejects(write(), error => /These pictures are not there/.test(error.message) && /before\.png/.test(error.message) && /f2\.png/.test(error.message) && !/after\.png/.test(error.message))
  assert.equal((await readdir(dir)).includes('recap'), false, 'nothing is written')
  await writeFile(file('before.png'), 'x')
  await assert.rejects(write(), /f2\.png/)
  await writeFile(file('f2.png'), 'x')
  const done = await write()
  assert.equal(done.pictures, 6, 'the whole shot, the after and before pictures and three frames')
  const out = JSON.parse(await readFile(join(dir, 'recap', 'demo.json'), 'utf8'))
  const [closeup, clip, shot] = out.sections[0].rows[0].pictures
  assert.deepEqual([closeup.kind, closeup.path, closeup.before, clip.kind, clip.frames, shot.path], ['closeup', '../pics/after.png', '../pics/before.png', 'clip', ['../pics/f1.png', '../pics/f2.png', '../pics/f3.png'], '../pics/whole.png'])
  // A clip with no path of its own keeps none in demo.json: the board takes its last frame.
  const bare = demoFile(list(row({ pictures: [{ kind: 'clip', frames: ['a.png', 'b.png'] }] })), 'C:/garden', 'C:/garden/out')
  assert.equal('path' in bare.sections[0].rows[0].pictures[0], false)
})

// ---------------------------------------------------------------------------------------------------------------------
// The board's gate: a row sent back is the new try only with the checker's word

const page = (...rows) => demoPage(list(...rows), 'pictures/g6/recap')
const keyed = (shown, key) => shown.sections.flatMap(section => section.rows).find(one => one.key === key)
const afterWrite = { changedAt: SENT_MS + 90 * MIN }

test('the board: row 7 without the checker\'s word is being reworked, with the words that say why, and counts nowhere; a no says why; a yes after the Send makes it ready', () => {
  const noWord = roundPage(page(props({ pictures: [SHOT, CLOSE] }), study({ shows: undefined })), feedback, afterWrite)
  const waiting = keyed(noWord, '7. Tall props')
  assert.deepEqual([waiting.reworking, waiting.reworkWhy, waiting.pictures, waiting.changed], [true, 'the close-up of your words waits for its check', [], null])
  assert.equal(keyed(noWord, '8. Study').reworking, true, 'row 8 has no word either')
  assert.deepEqual([noWord.feedback.answerable, noWord.feedback.toJudge], [0, 0], 'it asks nothing and is not counted')
  assert.match(checkSend(noWord, { round: 2, parts: [{ key: '7. Tall props', verdict: 'approved' }] }).why, /"7\. Tall props" is being reworked/)
  const said = roundPage(page(props({ pictures: [SHOT, CLOSE], shows: { ...YES, verdict: 'no', why: 'it shows the whole screen' } }), study({ shows: undefined })), feedback, afterWrite)
  assert.equal(keyed(said, '7. Tall props').reworkWhy, 'the check says it does not show your words yet: it shows the whole screen')
  const old = roundPage(page(props({ pictures: [SHOT, CLOSE], shows: { ...YES, at: '2026-11-04 09:59' } }), study()), feedback, afterWrite)
  assert.equal(keyed(old, '7. Tall props').reworkWhy, 'the close-up of your words waits for its check', 'a yes of before the Send checked an older try')
  const ready = roundPage(page(props({ pictures: [SHOT, CLOSE], shows: YES }), study()), feedback, afterWrite)
  const now = keyed(ready, '7. Tall props')
  assert.deepEqual([now.reworking ?? false, now.pictures.map(one => one.kind), now.shows.by], [false, ['closeup', 'final'], 'Checker'])
  assert.deepEqual([ready.feedback.answerable, ready.feedback.toJudge], [2, 2])
  // The partner's own "pending" line still wins; a hand-written demo.json with no "changed" line is as before.
  assert.equal(keyed(roundPage(page(props({ pending: 'B957 not started', shows: YES }), study()), feedback, afterWrite), '7. Tall props').pending, 'B957 not started')
  assert.equal(keyed(roundPage(page(row({ pictures: [SHOT, CLOSE], shows: YES }), study()), feedback, afterWrite), '7. Tall props').reworking, true)
})

test('the counts follow: the same reading of the rows (src/recapRound.mjs) says a row sent back is ready only with the checker\'s word', () => {
  const rows = shows => [{ key: '7. Tall props', title: '7. Tall props', steps: ['B957'], changed: true, pending: false, shows }]
  const ready = shows => roundRowsOf({ rows: rows(shows), rounds: feedback.rounds, changedAt: SENT_MS + 90 * MIN }).rows[0].ready
  assert.deepEqual([ready(null), ready({ ...YES, verdict: 'no' }), ready({ ...YES, at: '2026-11-04 09:59' }), ready(YES)], [false, false, false, true])
})
