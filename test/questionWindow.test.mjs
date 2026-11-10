// The task window's question (the person, 2026-10-31, on the window of B893: "i have no clue what this is about the UI sucks.
// too cluttered"; on the agreed mock: "yes this mockup is much better" and "i always want pictures in the main focus its the
// easiest for me to decide"): while a question waits for the person it stands first, large, with every option a card with its
// pictures large, and everything else folded under one "Details". The parser reads the question's words into one shape; the
// page is read and clicked through the DOM harness (B415). Made-up names only. The review of f0e130f (same day) added what
// went wrong in it: picks answering another question, words cut out of an option, an ask's options lost, advice that names
// no option, a window closed over an open question, a lost cursor.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseBacklog, refinedOf } from '../src/backlog.mjs'
import { findPicture } from '../src/pictures.mjs'
import { editStep } from '../src/tick.mjs'
import { parseItem } from '../src/work/item.mjs'
import { yourWordsOf } from '../src/work/yourWords.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, ask, asSent, build, sinceOf } from './partnerState.mjs'
import { fresh, item as storeItem, remove } from './qaKit.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('calm')}\n${cut('question')}\nObject.assign(this, { parseQuestionText, refineQuestionOf, askQuestionOf, questionLacking, questionTitle, questionPicked, questionPicturesRequest, adviceAnswerOf })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

// The shape of B893's question (its real text, rebuilt with made-up words): its options in one sentence, "Picture: <words>"
// that names no file, "Advised: A" with no reason, a time in each option, and a file in the first option's brackets.
const A_WORDS = 'keep the lamp\'s glow; the judges\' panel gets the sketch (sketch-glow.png) as the glow\'s target, so the glow is judged against what you agreed, about 1 h.'
const B_WORDS = 'try a calmer, dimmer glow, kept only if both panels gain 10 points and you approve it beside the sketch, about 2 h.'
const LANTERN = `Should the lantern's glow be judged against the sketch? A: ${A_WORDS} B: ${B_WORDS} Picture: the sketch's blue glow beside the game. Advised: A`
const A_PICTURE = A_WORDS.replace('(sketch-glow.png)', '(picture: pics/glow/sketch.png)')
const SHOWN_A = 'keep the lamp\'s glow; the judges\' panel gets the sketch as the glow\'s target, so the glow is judged against what you agreed'
const BASE = 'Is the lamp\'s base heavy enough? Advised: yes, it holds'

test('the real shape of B893 (options in one sentence, a picture wish, Advised: A): the question, no why, two options with their times, the one picture of A, the wish kept', () => {
  const shape = plain(page.parseQuestionText(LANTERN))
  assert.equal(shape.question, 'Should the lantern\'s glow be judged against the sketch?')
  assert.equal(shape.why, '', 'the options are not the why')
  assert.deepEqual(shape.options.map(one => [one.letter, one.time, one.pictures.map(picture => picture.path), one.isAdvised]), [['A', 'about 1 h', ['sketch-glow.png'], true], ['B', 'about 2 h', [], false]])
  assert.equal(shape.options[0].words, SHOWN_A, 'the picture mark and the time that ends the words are taken off what is shown')
  assert.equal(shape.options[1].words, 'try a calmer, dimmer glow, kept only if both panels gain 10 points and you approve it beside the sketch')
  // What Choose writes is the option's full original words.
  assert.equal(shape.options[0].answer, `A: ${A_WORDS}`)
  assert.equal(shape.options[1].answer, `B: ${B_WORDS}`)
  assert.deepEqual([shape.advice, shape.adviceWhy], ['A', ''])
  assert.deepEqual(shape.pictures, [], 'a "Picture:" that names no file is no picture')
  assert.equal(shape.wish, 'the sketch\'s blue glow beside the game', 'it is kept as the picture the question wished')
  assert.equal(shape.noPicture, false)
})

test('the new form: each option with its (picture: <path>), the advice with its reason, the question\'s own why before the options', () => {
  const shape = plain(page.parseQuestionText('Which door for the barn? It is seen from the road. A: red door (picture: pics/barn/red.png) about 30 min B: blue door (picture: pics/barn/blue.png, pics/barn/blue-night.png) about 1 h C) no door Advised: B — blue hides the dirt'))
  assert.equal(shape.question, 'Which door for the barn?')
  assert.equal(shape.why, 'It is seen from the road.')
  assert.deepEqual(shape.options.map(one => [one.letter, one.words, one.time, one.pictures.map(picture => picture.path)]), [
    ['A', 'red door', 'about 30 min', ['pics/barn/red.png']],
    ['B', 'blue door', 'about 1 h', ['pics/barn/blue.png', 'pics/barn/blue-night.png']],
    ['C', 'no door', '', []],
  ])
  assert.deepEqual([shape.advice, shape.adviceWhy], ['B', 'blue hides the dirt'])
  assert.deepEqual(shape.options.map(one => one.isAdvised), [false, true, false])
  assert.equal(shape.options[0].pictures[0].caption, 'red', 'a picture is captioned by its file name in words')
})

test('a path in an option\'s words belongs to that option: bare, in brackets or ending the words; a "Picture: <path>" sentence of the question belongs to the question, with its caption', () => {
  const shape = plain(page.parseQuestionText('Which look? Picture: pics/hedge/now.png (the hedge now) A: tall, see pics/hedge/tall.png B: low and wide pics/hedge/low.webp. C: none (pics/hedge/none.jpg) Advised: A'))
  assert.deepEqual(shape.pictures, [{ path: 'pics/hedge/now.png', caption: 'the hedge now' }])
  assert.deepEqual(shape.options.map(one => [one.letter, one.words, one.pictures.map(picture => picture.path)]), [
    ['A', 'tall', ['pics/hedge/tall.png']], ['B', 'low and wide', ['pics/hedge/low.webp']], ['C', 'none', ['pics/hedge/none.jpg']],
  ])
  // Not a picture: an extension in the middle of a word.
  assert.deepEqual(plain(page.parseQuestionText('Use the .png format? A: yes B: no')).options.map(one => one.pictures.length), [0, 0])
})

test('"no picture: <why>" says the options do not differ in look: in brackets or as a sentence, and "Picture: none (why)" says it too', () => {
  for (const text of ['Which name? A: Ivy B: Fern (no picture: names have no look) Advised: A', 'Which name? A: Ivy B: Fern. no picture: names have no look. Advised: A', 'Which name? Picture: none (names have no look) A: Ivy B: Fern Advised: A']) {
    const shape = plain(page.parseQuestionText(text))
    assert.deepEqual([shape.noPicture, shape.noPictureWhy, shape.options.map(one => one.words), shape.advice], [true, 'names have no look', ['Ivy', 'Fern'], 'A'], text)
    assert.deepEqual(plain(page.questionLacking(page.parseQuestionText(text))), [], 'its cards show no placeholder')
  }
})

test('a Yes/No question with advice has the options Yes and No (no letters), keeps its advice, its reason and its pictures; the older free-text form has no options', () => {
  const yes = plain(page.refineQuestionOf('B7', 1, { text: 'A roof of straw, not of stone? Picture: pics/stable/roof.png', advice: 'yes', why: 'straw is quicker to draw', answer: null }))
  assert.equal(yes.id, 'refine:B7:1')
  assert.equal(yes.question, 'A roof of straw, not of stone?')
  assert.deepEqual(yes.options.map(one => [one.letter, one.words, one.answer, one.isAdvised]), [['', 'Yes', 'yes', true], ['', 'No', 'no', false]])
  assert.deepEqual([yes.advice, yes.adviceWhy, yes.isYesNo], ['yes', 'straw is quicker to draw', true])
  assert.deepEqual(yes.pictures, [{ path: 'pics/stable/roof.png', caption: 'roof' }])
  assert.deepEqual(plain(page.questionLacking(yes)), [], 'Yes and No look alike: no placeholder')
  const old = plain(page.refineQuestionOf('B7', 2, { text: 'Which colour for the door?', advice: null, why: '', answer: null }))
  assert.deepEqual([old.question, old.options, old.advice, old.isYesNo], ['Which colour for the door?', [], null, false])
})

test('an ask with options and one picture per option: the pictures belong to the options in order, the first sentence of its context is the why, the rest is kept', () => {
  const need = { id: 'work:Q70', question: 'Which hedge?', text: 'The garden is bare on the road side. The yew is slow.', options: [{ label: 'A yew', picture: null, isRecommended: false }, { label: 'B box, about 2 h', picture: null, isRecommended: true }], advice: 'B', pictures: ['pics/hedge/yew.png', 'pics/hedge/box.png'], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.equal(shape.id, 'work:Q70')
  assert.equal(shape.question, 'Which hedge?')
  assert.deepEqual([shape.why, shape.more], ['The garden is bare on the road side.', 'The yew is slow.'])
  assert.deepEqual(shape.options.map(one => [one.letter, one.words, one.time, one.pictures.map(picture => picture.path), one.answer, one.pick, one.isAdvised]), [
    ['A', 'yew', '', ['pics/hedge/yew.png'], 'A: yew', 'A yew', false],
    ['B', 'box', 'about 2 h', ['pics/hedge/box.png'], 'B: box, about 2 h', 'B box, about 2 h', true],
  ])
  assert.deepEqual([shape.pictures, shape.advice], [[], 'B'])
})

test('an ask with fewer pictures than options: the pictures show above the options, every option still has none of its own', () => {
  const need = { id: 'work:Q71', question: 'Which hedge?', text: '', options: [{ label: 'A yew', picture: null }, { label: 'B box', picture: null }, { label: 'C holly', picture: null }], advice: 'A', pictures: ['pics/hedge/now.png'], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.deepEqual(shape.pictures.map(one => one.path), ['pics/hedge/now.png'])
  assert.deepEqual(shape.options.map(one => one.pictures.length), [0, 0, 0])
  assert.deepEqual(plain(page.questionLacking(shape)).map(one => one.letter), ['A', 'B', 'C'])
  // An option's own picture (the asks' JSON form) is its own, and the other pictures stay above.
  const own = plain(page.askQuestionOf({ ...need, options: [{ label: 'A yew', picture: 'pics/hedge/yew.png' }, { label: 'B box', picture: null }] }))
  assert.deepEqual(own.options.map(one => one.pictures.map(picture => picture.path)), [['pics/hedge/yew.png'], []])
  assert.deepEqual(own.pictures.map(one => one.path), ['pics/hedge/now.png'])
})

test('an ask with no options anywhere is a Yes/No question (a look: Approve and Reject); its pictures stand above and it asks for none', () => {
  const look = plain(page.askQuestionOf({ id: 'work:Q72', question: 'Is the flame tall enough?', text: '', options: [], advice: 'yes', pictures: ['pics/lamp/a.png', 'pics/lamp/b.png'], kind: 'verify', asks: 'look' }))
  assert.deepEqual(look.options.map(one => [one.words, one.answer]), [['Yes', 'approve'], ['No', 'reject']])
  assert.deepEqual(look.pictures.map(one => one.path), ['pics/lamp/a.png', 'pics/lamp/b.png'])
  assert.deepEqual([look.isYesNo, look.advice, plain(page.questionLacking(look))], [true, 'approve', []])
})

test('an option\'s title is its short head before ";" or ":", the rest its text; a pick is the option\'s pick, never another one\'s', () => {
  assert.deepEqual(plain(page.questionTitle('keep the bar\'s lava; the judges get the picture')), { title: 'keep the bar\'s lava', rest: 'the judges get the picture' })
  assert.deepEqual(plain(page.questionTitle('Yes')), { title: 'Yes', rest: '' })
  const shape = page.parseQuestionText(LANTERN)
  assert.equal(page.questionPicked(shape, `A: ${A_WORDS}`), 0)
  assert.equal(page.questionPicked(shape, 'something else'), -1)
})

test('the words that ask for pictures name the question and each option without one; for an ask they say to withdraw it and ask again', () => {
  const shape = page.parseQuestionText(LANTERN)
  const words = page.questionPicturesRequest(shape, 'Question 1')
  assert.match(words, /^Question 1, "Should the lantern's glow be judged against the sketch\?": give every option its picture/)
  assert.match(words, /No picture yet for B \(try a calmer, dimmer glow, kept only if both…\)\.$/)
  assert.doesNotMatch(words, /\bA \(/, 'A has its picture')
  const forAsk = page.questionPicturesRequest(shape, 'Your ask Q70', 'Q70')
  assert.match(forAsk, /^Your ask Q70, "Should the lantern's glow be judged against the sketch\?": its options need one picture each\. Withdraw it \(work withdraw Q70\) and ask it again with the same options and one picture per option in "pictures", in the options' order\. No picture yet for B/)
  // A picture the board cannot show counts as none.
  assert.match(page.questionPicturesRequest(shape, 'Question 1', null, path => path === 'sketch-glow.png'), /No picture yet for A \(keep the lamp's glow; the judges' panel gets the…\), B \(/)
})

// ---- review of f0e130f: what the parser must not do ----

test('never cut words out of an option: a time shows apart only when it ENDS the words (the live B890, Q585, Q51, Q396 and Q535 shapes, made-up words)', () => {
  // B890's shape: "about 3 h" in the middle of the words, "a map" after it.
  const wall = plain(page.parseQuestionText('Paint the walls whole, or one more round? A: Codex paints the drawn walls whole after its test wall; cliffs then come from the painting, about 3 h a wall. B: one more round on the top edge, about 2 h; closer, not the painting; stairs as today. Advised: A'))
  assert.deepEqual(wall.options.map(one => [one.words, one.time]), [
    ['Codex paints the drawn walls whole after its test wall; cliffs then come from the painting, about 3 h a wall', ''],
    ['one more round on the top edge, about 2 h; closer, not the painting; stairs as today', ''],
  ])
  assert.equal(wall.options[0].answer, 'A: Codex paints the drawn walls whole after its test wall; cliffs then come from the painting, about 3 h a wall.')
  // Q585's shape: a time in brackets with other words, then the colon and more words.
  const hold = plain(page.askQuestionOf({ id: 'work:Q85', question: 'How to stop a hung message?', text: '', options: [{ label: 'A Hold it until the board sees it went (board only, about 2 h): never sent again on a timer' }, { label: 'B Ask the app (board and a mod update, about 3.5 h): another chat checks the app\'s list' }], advice: 'A', pictures: [], kind: 'input', asks: 'decide' }))
  assert.deepEqual(hold.options.map(one => [one.words, one.time]), [['Hold it until the board sees it went (board only, about 2 h): never sent again on a timer', ''], ['Ask the app (board and a mod update, about 3.5 h): another chat checks the app\'s list', '']])
  assert.equal(hold.options[0].answer, 'A: Hold it until the board sees it went (board only, about 2 h): never sent again on a timer')
  // Q51's and Q396's shapes: a time inside brackets with more words after it or before the bracket closes.
  const tail = plain(page.parseQuestionText('Which? A: the first for you to pick from (about 30 min more). B: on this test map (about 15 min, little expected).'))
  assert.deepEqual(tail.options.map(one => [one.words, one.time]), [['the first for you to pick from (about 30 min more)', ''], ['on this test map (about 15 min, little expected)', '']])
  // Q535's shape: a time that opens the words stays in them; the one that ends them is shown apart.
  const both = plain(page.parseQuestionText('Which? A: About 1 h for the rule, then the two maps (about 3 h). B: nothing.'))
  assert.deepEqual([both.options[0].words, both.options[0].time], ['About 1 h for the rule, then the two maps', 'about 3 h'])
  assert.equal(both.options[0].answer, 'A: About 1 h for the rule, then the two maps (about 3 h).')
  // A time at the end after a comma, or in brackets with a full stop after it.
  assert.deepEqual(plain(page.parseQuestionText('Which? A: plant it, about 40 min. B: dig it (about 2 hours).')).options.map(one => [one.words, one.time]), [['plant it', 'about 40 min'], ['dig it', 'about 2 hours']])
})

test('a letter starts an option after the text\'s start, a sentence mark, a comma, "or"/"and", a bracket or plain space, in order from A; never right after a naming word: "plan B:" stays in A', () => {
  const road = plain(page.parseQuestionText('Which road? A: keep plan B: the old road. B: a new road. Advised: A'))
  assert.deepEqual(road.options.map(one => [one.letter, one.words]), [['A', 'keep plan B: the old road'], ['B', 'a new road']])
  for (const naming of ['plan', 'Option', 'step', 'PART', 'type', 'variant', 'version', 'case', 'side', 'team', 'round', 'level', 'tier', 'grade']) {
    assert.deepEqual(plain(page.parseQuestionText(`Which? A: keep ${naming} B: the old one. B: a new one`)).options.map(one => [one.letter, one.words]), [['A', `keep ${naming} B: the old one`], ['B', 'a new one']], naming)
  }
  // The shapes of Q365 and Q384: commas and "or" join the options; the join belongs to no option.
  const same = plain(page.parseQuestionText('is G33\'s approach right? A: keep going with the same plan, or B: change the approach (say what); I advise A.'))
  assert.deepEqual(same.options.map(one => [one.letter, one.words, one.answer]), [['A', 'keep going with the same plan', 'A: keep going with the same plan'], ['B', 'change the approach (say what)', 'B: change the approach (say what)']])
  assert.equal(same.advice, 'A')
  const fall = plain(page.parseQuestionText('How much damage should a fall from two floors up do? A: 1 per floor (your earlier yes, but every fall halves from 2 to 1), B: 2, +1 for each extra floor (today\'s maps unchanged), or C: 2 per floor (two floors kill most enemies). I advise B.'))
  assert.deepEqual(fall.options.map(one => [one.letter, one.words]), [
    ['A', '1 per floor (your earlier yes, but every fall halves from 2 to 1)'],
    ['B', '2, +1 for each extra floor (today\'s maps unchanged)'],
    ['C', '2 per floor (two floors kill most enemies)'],
  ])
  assert.deepEqual([fall.advice, fall.question], ['B', 'How much damage should a fall from two floors up do?'])
  // Plain space, commas, brackets, line breaks and the forms of the roles all start options; letters only in order from A.
  assert.deepEqual(plain(page.parseQuestionText('Which? A: red, B: blue')).options.map(one => [one.letter, one.words]), [['A', 'red'], ['B', 'blue']])
  assert.deepEqual(plain(page.parseQuestionText('Which? A: Ivy B: Fern')).options.map(one => one.words), ['Ivy', 'Fern'])
  assert.deepEqual(plain(page.parseQuestionText('Which? A: red; B: blue; C: green')).options.map(one => one.letter), ['A', 'B', 'C'])
  assert.deepEqual(plain(page.parseQuestionText('Which? C: green. A: red. B: blue')).options.map(one => one.letter), ['A', 'B'], 'a C before the A starts nothing')
  assert.deepEqual(plain(page.parseQuestionText('Which?\nA: red\nB: blue (the sea)\nC) green')).options.map(one => one.words), ['red', 'blue (the sea)', 'green'])
  assert.deepEqual(plain(page.parseQuestionText('Which? Option one (see below) A: red (picture: pics/r.png) B: blue')).options.map(one => one.letter), ['A', 'B'])
  assert.deepEqual(plain(page.parseQuestionText('Which? (A: red) (B: blue)')).options.map(one => one.letter), ['A', 'B'])
  // One letter alone is no list of options.
  assert.deepEqual(plain(page.parseQuestionText('Use e.g. A: here? Plan B: later')).options, [])
})

test('a picture path in a later sentence belongs to the option whose words it follows, for every option; one before the first option is the question\'s; "picture: <path>" without brackets inside an option is the option\'s', () => {
  const door = plain(page.parseQuestionText('Which door? A: red. See art-inbox/d/red.png. B: blue. See art-inbox/d/blue.png. Advised: A'))
  assert.deepEqual(door.options.map(one => [one.words, one.pictures.map(picture => picture.path)]), [['red', ['art-inbox/d/red.png']], ['blue', ['art-inbox/d/blue.png']]])
  assert.deepEqual(door.pictures, [], 'none of them is the question\'s')
  assert.deepEqual(door.options.map(one => one.answer), ['A: red. See art-inbox/d/red.png.', 'B: blue. See art-inbox/d/blue.png.'], 'the answer keeps the words whole')
  assert.deepEqual(plain(page.questionLacking(door)), [])
  // A sentence of words that names a picture stays in the option's words, the picture its own (the last option too).
  const road = plain(page.parseQuestionText('Which road? A: the old road. B: a new road. Both are judged against pics/roads/ref.png. Advised: A'))
  assert.deepEqual(road.options.map(one => [one.words, one.pictures.map(picture => picture.path)]), [['the old road', []], ['a new road. Both are judged against pics/roads/ref.png', ['pics/roads/ref.png']]])
  assert.deepEqual(road.pictures, [])
  // A path before the first option is the question's.
  const before = plain(page.parseQuestionText('Which road? See pics/roads/ref.png. A: the old road. B: a new road. Advised: A'))
  assert.deepEqual(before.pictures.map(one => one.path), ['pics/roads/ref.png'])
  assert.deepEqual(before.options.map(one => one.pictures.length), [0, 0])
  // The picture mark of the last option, in its own brackets after its sentence, stays its own.
  const marked = plain(page.parseQuestionText('Which door? A: red. (picture: pics/d/red.png) B: blue. (picture: pics/d/blue.png) Advised: A'))
  assert.deepEqual(marked.options.map(one => one.pictures.map(picture => picture.path)), [['pics/d/red.png'], ['pics/d/blue.png']])
  assert.deepEqual(marked.pictures, [])
  // "picture: <path>" with no brackets inside an option is the option's, not the question's (a capital "Picture:" is the question's).
  const plainDoor = plain(page.parseQuestionText('Which door? A: red, picture: pics/d/red.png B: blue, picture: pics/d/blue.png, pics/d/blue-night.png Advised: A'))
  assert.deepEqual(plainDoor.options.map(one => [one.words, one.pictures.map(picture => picture.path)]), [['red', ['pics/d/red.png']], ['blue', ['pics/d/blue.png', 'pics/d/blue-night.png']]])
  assert.deepEqual(plainDoor.pictures, [])
  assert.deepEqual(plain(page.questionLacking(plainDoor)), [])
})

test('only a decide ask (and a refine question) gets lettered cards: a look or a do keeps Approve and Reject or Done whatever its text lists, and the lettered lines stay its text', () => {
  const text = 'Two things changed.\nA: the glow is calmer.\nB: the base is wider.'
  const look = plain(page.askQuestionOf({ id: 'work:Q90', question: 'Do you accept it?', text, options: [], advice: 'yes', pictures: [], kind: 'verify', asks: 'look' }))
  assert.deepEqual(look.options.map(one => [one.letter, one.answer]), [['', 'approve'], ['', 'reject']])
  assert.equal(look.isYesNo, true)
  assert.deepEqual([look.why, look.more], ['Two things changed.', 'A: the glow is calmer. B: the base is wider.'])
  const done = plain(page.askQuestionOf({ id: 'work:Q91', question: 'Put the lamps up.', text, options: [], advice: null, pictures: [], kind: 'do', asks: 'do' }))
  assert.deepEqual(done.options.map(one => [one.letter, one.answer]), [['', 'done']])
  // The same text of a decide ask is lettered cards.
  const decide = plain(page.askQuestionOf({ id: 'work:Q92', question: 'Which change first?', text, options: [], advice: 'A', pictures: [], kind: 'input', asks: 'decide' }))
  assert.deepEqual(decide.options.map(one => [one.letter, one.answer]), [['A', 'A: the glow is calmer.'], ['B', 'B: the base is wider.']])
})

test('a look and a do ask whose text lists "A: … B: …" keep their own buttons in every window: Approve and Reject, Done', async () => {
  const lines = ['Kind: ask', 'State: open', 'Owner: Digger', `Since: ${sinceOf(NOW - 5 * MIN)}`, `Filed: ${NOW - 5 * MIN}`, 'Blocking: no', 'Of: B12', '', '## Text']
  const look = parseItem(['Id: Q90', 'Title: Do you accept it?', 'Asks: look', ...lines, 'Do you accept it?', 'Two things changed.', 'A: the glow is calmer.', 'B: the base is wider.', ''].join('\n'))
  const todo = parseItem(['Id: Q91', 'Title: Put the lamps up.', 'Asks: do', ...lines, 'Put the lamps up.', 'Two things changed.', 'A: the glow is calmer.', 'B: the base is wider.', ''].join('\n'))
  const calm = await open([waiting([]), look], { hash: 'details=Q90' })
  try {
    assert.deepEqual(calm.all('#details .calm-card .calm-card-title').map(words), ['Yes', 'No'])
    assert.equal(calm.all('#details .calm-card .calm-key').length, 0)
    assert.match(words(calm.find('#details .calm-why')), /A: the glow is calmer\./, 'its lettered lines are its text')
    await calm.click('#details .calm-card:nth-of-type(1)')
    await calm.click('#details [data-calm-send]')
    assert.deepEqual(calm.sent('/api/work', 'answer').map(one => [one.body.verdict, one.body.text]), [['approve', '']])
  } finally {
    await calm.close()
  }
  const task = await open([waiting([]), look])
  try {
    assert.deepEqual(task.all('#details .q-card .q-title').map(words), ['Yes', 'No'])
    assert.equal(task.all('#details .q-card .q-letter').length, 0)
    assert.match(words(task.find('#details .q-why')), /^Two things changed\.$/)
    assert.match(words(task.find('#details .q-more p')), /A: the glow is calmer\. B: the base is wider\./)
  } finally {
    await task.close()
  }
  const doing = await open([waiting([]), todo], { hash: 'details=Q91' })
  try {
    assert.deepEqual(doing.all('#details .calm-card .calm-card-title').map(words), ['Done'])
  } finally {
    await doing.close()
  }
})

test('Change does not send an unchanged answer again: the old answer comes back as it was (its card chosen, or its words in the field) and Send skips it', async () => {
  const shown = await open([waiting([`${LANTERN} Answer: A: ${A_WORDS}`, BASE])])
  try {
    await shown.click('.q-change')
    assert.deepEqual([...shown.all('#details .q-block:nth-of-type(1) .q-choose')].map(one => one.getAttribute('aria-pressed')), ['true', 'false'], 'its card is chosen as it was')
    assert.equal(shown.find('.q-block:nth-of-type(1) .q-send').disabled, true, 'nothing is changed: nothing to send')
    // Answering the other open question sends only that answer: the unchanged one is not sent again.
    await shown.click('.q-block:nth-of-type(2) [data-q-choose="0"]')
    await shown.click('.q-block:nth-of-type(2) .q-send')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 1, answer: 'yes' }]])
  } finally {
    await shown.close()
  }
  // An answer in the person's own words comes back as the words in the field, and is skipped the same way.
  const typed = await open([waiting([`${LANTERN} Answer: Neither: match the sketch exactly`, BASE])])
  try {
    await typed.click('.q-change')
    assert.equal(typed.find('.q-block:nth-of-type(1) .q-field').value, 'Neither: match the sketch exactly')
    assert.equal(typed.find('.q-block:nth-of-type(1) .q-send').disabled, true)
    await typed.click('.q-block:nth-of-type(2) [data-q-choose="1"]')
    await typed.click('.q-block:nth-of-type(2) .q-send')
    assert.deepEqual(typed.sent('/api/backlog').map(one => one.body.answers), [[{ index: 1, answer: 'no' }]])
    // A changed answer is sent.
    await typed.click('.q-block:nth-of-type(1) [data-q-choose="0"]')
    assert.equal(typed.find('.q-block:nth-of-type(1) .q-send').disabled, false)
  } finally {
    await typed.close()
  }
})

test('an ask whose options are in its text (title and context): lettered cards, the advice by its letter, "I advise A." no part of an option, the whole context kept', () => {
  const need = { id: 'work:Q81', question: 'for B12, which do you want?', text: 'The lamp is too bright at night. The judges mark it down. A: keep the lamp as your rules describe it, and show the judges your lamp picture (about 1 h). B: try a calmer, darker lamp, kept only if the scores rise by 10 (about 2 h). I advise A. [Open B12](http://127.0.0.1:4310/#details=B12)', options: [], advice: 'A', pictures: [], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.equal(shape.isYesNo, false)
  assert.deepEqual(shape.options.map(one => [one.letter, one.words, one.time, one.isAdvised]), [
    ['A', 'keep the lamp as your rules describe it, and show the judges your lamp picture', 'about 1 h', true],
    ['B', 'try a calmer, darker lamp, kept only if the scores rise by 10', 'about 2 h', false],
  ])
  assert.equal(shape.options[1].answer, 'B: try a calmer, darker lamp, kept only if the scores rise by 10 (about 2 h).')
  assert.equal(shape.question, 'for B12, which do you want?')
  // The first sentence of the context is the why; the rest is kept (and nothing of the options is in it).
  assert.equal(shape.why, 'The lamp is too bright at night.')
  assert.match(shape.more, /^The judges mark it down\./)
  assert.match(shape.more, /\[Open B12\]/)
  assert.equal(shape.advice, 'A')
  // Without lettered options anywhere it is a Yes/No question as before.
  assert.equal(plain(page.askQuestionOf({ ...need, text: 'The lamp is too bright. Keep it? I advise yes.' })).isYesNo, true)
  // The words of an advice that names no option stand as they were written.
  assert.equal(plain(page.askQuestionOf({ ...need, text: 'A: red. B: blue.', advice: 'C, the person decides' })).adviceLine, 'Advised: C, the person decides')
})

test('an advice that names no option shows as its words (the live B650 shape); a letter naming an option marks its card', () => {
  const shape = plain(page.refineQuestionOf('B7', 0, { text: 'Today\'s rows or the new rows (Q398)? With A this step is refined from the old lines; with B it is dropped.', advice: 'B', why: 'the person decides in Q398', answer: null }))
  assert.deepEqual([shape.options, shape.advice, shape.adviceLine, shape.why], [[], null, 'Advised: B, the person decides in Q398', 'With A this step is refined from the old lines; with B it is dropped.'])
  assert.equal(plain(page.refineQuestionOf('B7', 0, { text: LANTERN.replace(' Advised: A', ''), advice: 'A', why: 'it keeps the judges honest', answer: null })).adviceLine, '')
  // "Take the advice" writes the advised option as a pick of it would be; for advice that names none, nothing.
  assert.equal(page.adviceAnswerOf('B7', 0, { text: LANTERN.replace(' Advised: A', ''), advice: 'A', why: '', answer: null }), `A: ${A_WORDS}`)
  assert.equal(page.adviceAnswerOf('B7', 0, { text: 'Which? A: red. B: blue.', advice: 'C', why: '', answer: null }), null)
  assert.equal(page.adviceAnswerOf('B7', 1, { text: 'Is it heavy?', advice: 'yes', why: '', answer: null }), 'yes')
})

test('the store reads a letter as the advice of a question, as it reads yes and no', () => {
  const text = ['## Garden\n', '- [ ] B21 Hang the lamps (about 1 h)\n', '  Refined (round 1, by Oracle, 2026-10-17 10:05):\n', '  Summary: The lamps hang.\n', '  Questions:\n',
    '  - Which lamp? A: round. B: square. Advised: A — it is warmer\n', '  - Is the chain long enough? Advised: yes\n', '  - Which hook? A: brass. B: iron. Advised: B, it holds\n', '  - A or B, which colour? Advised: either one\n'].join('')
  const refined = refinedOf(parseBacklog(text).activities[0].steps[0].notes)
  assert.deepEqual(plain(refined.questions.map(one => [one.text, one.advice, one.why])), [
    ['Which lamp? A: round. B: square.', 'A', 'it is warmer'],
    ['Is the chain long enough?', 'yes', ''],
    ['Which hook? A: brass. B: iron.', 'B', 'it holds'],
    ['A or B, which colour? Advised: either one', null, ''],
  ])
})

// ---- the window ----

/** A picture the harness serves: every path but those with "gone" in them. */
function served(request) {
  const path = new URLSearchParams(request.url.split('?')[1] ?? '').get('path') ?? ''
  if (path.includes('gone')) return reply('No such picture.', 404)
  return { ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'image/png' }), json: async () => ({}), text: async () => '' }
}
const answering = other => request => (request.url.startsWith('/api/picture') ? served(request) : other(request))
const WITH_PICTURE = LANTERN.replace('(sketch-glow.png)', '(picture: pics/glow/sketch.png)')
/** A step B12 that waits for its refine answers: the given questions, one line each. */
const waiting = (questions, round = 1, more = []) => parseItem([
  'Id: B12', 'Kind: step', 'Title: Painted maps: lava layer matches the painting\'s calm glow', 'State: new', `Since: ${sinceOf(NOW - 30 * MIN)}`, 'Refined: open', '',
  '## Summary', 'Context: From the last round.', 'Problem: The judges mark the glow down as brighter than the sketch.', 'Solution: Judge it against the sketch.', '',
  '## Refined', `  Refined (round ${round}, by Oracle, 2026-10-19 09:30):`, '  Summary: The glow is judged against the sketch.', '  Part of: G6 · The polish', '  Size: about 1 hour',
  '  Questions:', ...questions.map(one => `  - ${one}`), ...more, '',
  '## History', `- ${sinceOf(NOW - 30 * MIN)} Oracle: refined, round ${round}`, '',
].join('\n'))
const stateWith = (...items) => asSent({ ...build(items), goalsEdit: { canWrite: true } })
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const open = (items, extra = {}) => openPage({ state: stateWith(...items), hash: 'details=B12', ...extra, answers: answering(extra.answers ?? (() => reply({}))) })
const Q81 = parseItem(`Id: Q81\nKind: ask\nTitle: for B12, which do you want?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 5 * MIN)}\nFiled: ${NOW - 5 * MIN}\nAsks: decide\nBlocking: no\nOf: B12\nAdvice: A\n\n## Text\nfor B12, which do you want? A: keep the lamp as your rules describe it (about 1 h). B: try a calmer, darker lamp, kept only if the scores rise by 10 and you approve it (about 2 h). I advise A.\n`)

test('B893\'s window: the question first and large, one line of why, the options as cards with their pictures, the advised card marked; the rest folded under Details, closed', async () => {
  const shown = await open([waiting([WITH_PICTURE])])
  try {
    const main = shown.find('#details .task-ask')
    assert.equal(main.firstElementChild.className, 'q-block', 'the question stands first, under the head')
    const block = shown.find('#details .q-block')
    assert.equal(words(block.querySelector('.q-question')), 'Should the lantern\'s glow be judged against the sketch?')
    // The line of why: the question has none, so the step's own problem line stands in.
    assert.equal(words(block.querySelector('.q-why')), 'The judges mark the glow down as brighter than the sketch.')
    assert.equal(shown.all('#details .q-count').length, 0, 'one question has no "1 of 1"')
    const cards = shown.all('#details .q-card')
    assert.deepEqual(cards.map(card => [words(card.querySelector('.q-letter')), card.classList.contains('is-advised'), words(card.querySelector('.q-time'))]), [['A', true, 'about 1 h'], ['B', false, 'about 2 h']])
    assert.equal(words(cards[0].querySelector('.q-advised')), 'advised')
    assert.equal(cards[1].querySelector('.q-advised'), null)
    assert.equal(words(cards[0].querySelector('.q-title')), 'Keep the lamp\'s glow', 'the short head of the words is the title')
    assert.match(words(cards[0].querySelector('.q-text')), /^The judges' panel gets the sketch as the glow's target/)
    // Its picture is large, and opens as the board's popup does (a click on it: the zoom address).
    assert.deepEqual([...cards[0].querySelectorAll('.q-pics .picture')].map(one => one.dataset.zoom), ['pics/glow/sketch.png'])
    assert.equal(cards[0].querySelectorAll('.q-pics.is-one').length, 1, 'one picture fills the card')
    // B has none: the calm placeholder and the quiet button that asks for it.
    assert.equal(words(cards[1].querySelector('.q-nopic')), 'No picture yet')
    assert.equal(shown.all('#details .q-nopic').length, 1)
    assert.equal(words(shown.find('#details .q-ask-pictures')), 'Ask for pictures')
    // Choose buttons: the advised one primary.
    assert.deepEqual(cards.map(card => [words(card.querySelector('.q-choose')), card.querySelector('.q-choose').classList.contains('is-primary')]), [['Choose A', true], ['Choose B', false]])
    // Under the cards: the field and Send.
    assert.equal(shown.find('#details .q-field').placeholder, 'Something else? Say it in your own words…')
    assert.equal(words(shown.find('#details .q-send')), 'Send')
    // Everything else under ONE Details, closed, with a line that names what is inside.
    const details = shown.all('#details .task-ask > details')
    assert.deepEqual(details.map(one => one.dataset.fold), ['details'])
    assert.equal(details[0].open, false)
    assert.match(words(details[0].querySelector('summary')), /^Details why it came up, add a note, model and effort, flow, history/)
    assert.ok(details[0].querySelector('.task-story'), 'the story is inside Details')
    assert.equal(shown.all('#details .task-ask > .task-story, #details .task-ask > .your-words-add, #details .task-ask > .refine-field').length, 0, 'nothing of it stands outside')
    assert.match(words(shown.find('#details .q-status')), /Nobody has it yet \(new\) since .* · it waits for your choice$/)
  } finally {
    await shown.close()
  }
})

test('the header counts exactly the questions the window shows: one, two (numbered "1 of 2"), and a question of the store beside the refine\'s', async () => {
  const one = await open([waiting([LANTERN])])
  try {
    assert.equal(words(one.find('#details .details-chips .chip.is-ask')), '1 question for you')
    assert.equal(one.all('#details .q-block').length, 1)
  } finally {
    await one.close()
  }
  const two = await open([waiting([LANTERN, 'A second question? Advised: yes, it is quick'])])
  try {
    assert.equal(words(two.find('#details .details-chips .chip.is-ask')), '2 questions for you')
    assert.deepEqual(two.all('#details .q-block').map(block => words(block.querySelector('.q-count'))), ['1 of 2', '2 of 2'])
    // The Yes/No question: Yes and No cards, no letters, the advice kept, no placeholder (Yes and No look alike).
    const [yes, no] = two.all('#details .q-block:nth-of-type(2) .q-card')
    assert.deepEqual([words(yes.querySelector('.q-title')), yes.classList.contains('is-advised'), words(no.querySelector('.q-title'))], ['Yes', true, 'No'])
    assert.equal(two.all('#details .q-block:nth-of-type(2) .q-nopic').length, 0)
    assert.equal(two.all('#details .q-block:nth-of-type(2) .q-ask-pictures').length, 0)
    // Not amber: the count is the calm blue chip, never the "waiting" one.
    assert.equal(two.all('#details .details-chips .chip.is-wait').length, 0)
  } finally {
    await two.close()
  }
  // An open ask of the store under the step stands beside the refine's question, and is counted once.
  const both = await open([waiting([LANTERN]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    assert.equal(words(both.find('#details .details-chips .chip.is-ask')), '2 questions for you')
    assert.deepEqual(both.all('#details .q-block').map(block => [words(block.querySelector('.q-count')), words(block.querySelector('.q-question'))]), [['1 of 2', 'Should the lantern\'s glow be judged against the sketch?'], ['2 of 2', 'Number or bar?']])
  } finally {
    await both.close()
  }
})

test('a question that says "no picture: <why>" shows no placeholder and no "Ask for pictures"; a question with a picture for every option shows none either', async () => {
  const none = await open([waiting(['Which name for the lamp? A: Ivy B: Fern (no picture: names have no look) Advised: A'])])
  try {
    assert.equal(none.all('#details .q-card').length, 2)
    assert.equal(none.all('#details .q-nopic').length, 0)
    assert.equal(none.all('#details .q-ask-pictures').length, 0)
  } finally {
    await none.close()
  }
  const every = await open([waiting(['Which look? A: round (picture: pics/lamp/a.png) B: square (picture: pics/lamp/b.png) Advised: A'])])
  try {
    assert.deepEqual(every.all('#details .q-card .picture').map(one => one.dataset.zoom), ['pics/lamp/a.png', 'pics/lamp/b.png'])
    assert.equal(every.all('#details .q-nopic').length, 0)
    assert.equal(every.all('#details .q-ask-pictures').length, 0)
  } finally {
    await every.close()
  }
})

test('two pictures stand side by side in a card, a picture of the question above the cards, and the picture wish is kept', async () => {
  const shown = await open([waiting(['Which look? Picture: pics/lamp/now.png (the lamp now) A: round (picture: pics/lamp/a.png, pics/lamp/a-night.png) B: square Advised: A'])])
  try {
    const above = shown.find('#details .q-block > .q-pics')
    assert.deepEqual([...above.querySelectorAll('.picture')].map(one => [one.dataset.zoom, one.dataset.caption]), [['pics/lamp/now.png', 'the lamp now']])
    const first = shown.all('#details .q-card')[0]
    assert.deepEqual([...first.querySelectorAll('.q-pics .picture')].map(one => one.dataset.zoom), ['pics/lamp/a.png', 'pics/lamp/a-night.png'])
    assert.equal(first.querySelectorAll('.q-pics.is-one').length, 0)
    assert.equal(words(first.querySelector('.q-pic-caption')), 'a')
  } finally {
    await shown.close()
  }
  const wish = await open([waiting([LANTERN])])
  try {
    assert.equal(words(wish.find('#details .q-wish')), 'Picture wished: the sketch\'s blue glow beside the game')
  } finally {
    await wish.close()
  }
})

test('a picture the board cannot show (a bare file name it does not find) makes its option one without a picture: "No picture yet", named when the chat is asked', async () => {
  const shown = await open([waiting(['Which look? A: round (picture: pics/gone/a.png). B: square (picture: pics/lamp/b.png) Advised: A'])])
  try {
    const cards = shown.all('#details .q-card')
    assert.equal(words(cards[0].querySelector('.q-nopic')), 'No picture yet', 'A\'s only picture is not found')
    assert.equal(cards[1].querySelector('.q-nopic'), null)
    assert.equal(words(shown.find('#details .q-ask-pictures')), 'Ask for pictures')
    await shown.click('.q-ask-pictures')
    assert.match(shown.sent('/api/backlog')[0].body.request, /No picture yet for A \(round\)\.$/)
  } finally {
    await shown.close()
  }
})

test('Choose marks the pick ("Chosen", pressed) and a second click takes it back; Send writes "<letter>: <the full words>" as the refine answer, with the Advisor asked once more', async () => {
  const shown = await open([waiting([LANTERN, 'A second question? Advised: yes, it is quick'])])
  try {
    const choose = at => shown.find(`#details .q-block:nth-of-type(1) [data-q-choose="${at}"]`)
    assert.equal(shown.find('#details .q-block:nth-of-type(1) .q-send').disabled, true, 'nothing to send yet')
    await shown.click('#details .q-block:nth-of-type(1) [data-q-choose="0"]')
    assert.deepEqual([words(choose(0)), choose(0).getAttribute('aria-pressed'), words(choose(1)), choose(1).getAttribute('aria-pressed')], ['Chosen', 'true', 'Choose B', 'false'])
    assert.equal(shown.all('#details .q-card')[0].classList.contains('is-chosen'), true)
    await shown.click('#details .q-block:nth-of-type(1) [data-q-choose="0"]')
    assert.deepEqual([words(choose(0)), choose(0).getAttribute('aria-pressed')], ['Choose A', 'false'])
    await shown.click('#details .q-block:nth-of-type(1) [data-q-choose="1"]')
    await shown.click('#details .q-block:nth-of-type(2) [data-q-choose="0"]')
    assert.equal(shown.find('#details .q-block:nth-of-type(1) .q-send').disabled, false)
    await shown.click('#details .q-block:nth-of-type(1) .q-send')
    // Reactive board, brief P4a: ONE call: the board writes the answers and queues the refine word; the page types nothing itself.
    const [written] = shown.sent('/api/backlog').map(one => one.body)
    assert.equal(written.action, 'refine-send')
    assert.match(written.click, /^[\w-]{8,64}$/)
    assert.equal(written.step, 'B12')
    assert.equal(written.feedback, '')
    assert.deepEqual(written.answers, [{ index: 0, answer: `B: ${B_WORDS}` }, { index: 1, answer: 'yes' }])
    assert.deepEqual(shown.sent('/api/say'), [])
  } finally {
    await shown.close()
  }
})

test('the live B890 shape: Choose A and Send write the option\'s whole words, with "a wall" after the time and no glued words', async () => {
  const text = 'Paint the walls whole, or one more round? A: Codex paints the drawn walls whole after its test wall; cliffs then come from the painting, about 3 h a wall. B: one more round on the top edge, about 2 h; closer, not the painting. Advised: A'
  const shown = await open([waiting([text])])
  try {
    const card = shown.all('#details .q-card')[0]
    assert.match(words(card), /Cliffs then come from the painting, about 3 h a wall/)
    assert.equal(shown.all('#details .q-time').length, 0, 'the time is inside the words, not at their end')
    await shown.click('[data-q-choose="0"]')
    await shown.click('.q-send')
    assert.equal(shown.sent('/api/backlog')[0].body.answers[0].answer, 'A: Codex paints the drawn walls whole after its test wall; cliffs then come from the painting, about 3 h a wall.')
  } finally {
    await shown.close()
  }
})

test('words of the person\'s own in the field are the answer instead of a pick, and a pick takes them away', async () => {
  const shown = await open([waiting([LANTERN])])
  try {
    await shown.click('[data-q-choose="0"]')
    await shown.type('.q-field', 'Neither: make it match the sketch exactly.')
    assert.equal(shown.find('[data-q-choose="0"]').getAttribute('aria-pressed'), 'false', 'the words are the answer now')
    await shown.click('[data-q-choose="1"]')
    assert.equal(shown.find('.q-field').value, '', 'the pick is the answer now')
    await shown.type('.q-field', 'Neither: make it match the sketch exactly.')
    await shown.click('.q-send')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 0, answer: 'Neither: make it match the sketch exactly.' }]])
  } finally {
    await shown.close()
  }
})

test('a pick and a Details the person opened stay while the window is drawn anew (a refused send changes what it shows)', async () => {
  const shown = await open([waiting([LANTERN])], { answers: request => (request.url === '/api/backlog' ? reply('the store is busy', 409) : reply({})) })
  try {
    await shown.click('[data-q-choose="1"]')
    shown.find('#details details[data-fold="details"]').open = true
    await shown.click('.q-send')
    assert.match(shown.text('#details .problem'), /Not done: the store is busy/)
    assert.equal(shown.find('#details details[data-fold="details"]').open, true, 'Details stays open')
    assert.equal(shown.find('[data-q-choose="1"]').getAttribute('aria-pressed'), 'true', 'the pick stays')
  } finally {
    await shown.close()
  }
})

test('a pick belongs to its question\'s words: after a new round that puts another question at its place (or words it differently) the old pick is no answer to it', async () => {
  const round1 = stateWith(waiting([LANTERN, BASE]))
  const round2 = stateWith(waiting([BASE, WITH_PICTURE.replace('Advised: A', 'Advised: B')], 2))
  let now = round1
  const shown = await openPage({ state: () => now, hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    await shown.click('.q-block:nth-of-type(1) [data-q-choose="1"]')
    assert.equal(shown.find('.q-block:nth-of-type(1) .q-send').disabled, false)
    // The Advisor's next round: the Yes/No question first, the lantern question second.
    now = round2
    await shown.reread()
    const blocks = shown.all('#details .q-block')
    assert.deepEqual(blocks.map(block => words(block.querySelector('.q-question'))), ['Is the lamp\'s base heavy enough?', 'Should the lantern\'s glow be judged against the sketch?'])
    assert.equal(blocks[0].querySelector('.q-field').value, '', 'the old pick is not the new first question\'s own words')
    assert.deepEqual([...blocks[0].querySelectorAll('.q-choose')].map(one => one.getAttribute('aria-pressed')), ['false', 'false'])
    assert.equal(blocks[0].querySelector('.q-send').disabled, true, 'nothing of it is left to send')
    await shown.click('.q-block:nth-of-type(2) [data-q-choose="0"]')
    await shown.click('.q-block:nth-of-type(2) .q-send')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 1, answer: `A: ${A_PICTURE}` }]], 'only the pick made for this question goes, to its own place')
  } finally {
    await shown.close()
  }
})

test('a pick or typed words belong to their question\'s words, never to the round: a new round keeps them with the same question wherever it stands, drops those of a question that is gone and sends nothing else', async () => {
  const DOOR = 'Which door? A: red B: blue Advised: A'
  const round1 = stateWith(waiting([LANTERN, BASE, DOOR]))
  const round2 = stateWith(waiting([BASE, LANTERN, 'Which wall? A: low B: high Advised: A'], 2))
  let now = round1
  const shown = await openPage({ state: () => now, hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    await shown.click('.q-block:nth-of-type(1) [data-q-choose="1"]')
    await shown.type('.q-block:nth-of-type(2) .q-field', 'Two fingers long, as on the old lamps in the hall')
    await shown.click('.q-block:nth-of-type(3) [data-q-choose="0"]')
    // The Advisor's next round: the Yes/No question first, the lantern question second, the door question gone.
    now = round2
    await shown.reread()
    const blocks = shown.all('#details .q-block')
    assert.deepEqual(blocks.map(block => words(block.querySelector('.q-question'))), ['Is the lamp\'s base heavy enough?', 'Should the lantern\'s glow be judged against the sketch?', 'Which wall?'])
    assert.equal(blocks[0].querySelector('.q-field').value, 'Two fingers long, as on the old lamps in the hall', 'the typed words went with their question')
    assert.deepEqual([...blocks[1].querySelectorAll('.q-choose')].map(one => one.getAttribute('aria-pressed')), ['false', 'true'], 'so did the pick')
    assert.deepEqual([...blocks[2].querySelectorAll('.q-choose')].map(one => one.getAttribute('aria-pressed')), ['false', 'false'], 'the pick of the question that is gone is no answer to the new one at its place')
    await shown.click('.q-block:nth-of-type(1) .q-send')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 0, answer: 'Two fingers long, as on the old lamps in the hall' }, { index: 1, answer: `B: ${B_WORDS}` }]])
  } finally {
    await shown.close()
  }
})

test('a pick whose question\'s options are worded anew is dropped (it could mean another option), the words typed under the same question stay; "Take the advice" is for the new round', async () => {
  const round1 = stateWith(waiting([LANTERN, BASE]))
  const round2 = stateWith(waiting([LANTERN.replace('about 2 h.', 'about 3 h.'), BASE], 2))
  let now = round1
  const shown = await openPage({ state: () => now, hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    await shown.click('.q-block:nth-of-type(1) [data-q-choose="1"]')
    await shown.type('.q-block:nth-of-type(2) .q-field', 'A hook at the top')
    now = round2
    await shown.reread()
    assert.deepEqual([...shown.all('#details .q-block:nth-of-type(1) .q-choose')].map(one => one.getAttribute('aria-pressed')), ['false', 'false'])
    assert.equal(shown.find('.q-block:nth-of-type(2) .q-field').value, 'A hook at the top')
    await shown.click('[data-refine-action="advice"]')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 0, answer: `A: ${A_WORDS}` }, { index: 1, answer: 'A hook at the top' }]], 'the advice for the question left open, the words for the one answered')
  } finally {
    await shown.close()
  }
})

test('"Ask for pictures" on a refine question goes to the Advisor as the board\'s own request (never the person\'s words) and a new round, and throws away nothing the person did: their picks and typed words stay and none is sent', async () => {
  const round1 = stateWith(waiting([LANTERN, BASE]))
  const round2 = stateWith(waiting([LANTERN.replace('(sketch-glow.png)', '(picture: pics/glow/sketch.png)').replace('about 2 h.', 'about 2 h (picture: pics/glow/b.png).'), BASE], 2))
  let now = round1
  const shown = await openPage({ state: requests => (requests.some(one => one.url === '/api/backlog' && one.body?.action === 'refine-send') ? round2 : now), hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    await shown.type('.q-block:nth-of-type(2) .q-field', 'Two fingers long, as on the old lamps in the hall')
    await shown.click('.q-ask-pictures')
    const [sent] = shown.sent('/api/backlog').map(one => one.body)
    assert.deepEqual([sent.action, sent.via, sent.step, sent.answers, sent.feedback], ['refine-send', 'refine-pictures', 'B12', [], ''], 'nothing unsent goes with it')
    assert.match(sent.request, /^Question 1, "Should the lantern's glow be judged against the sketch\?": give every option its picture/)
    assert.match(sent.request, /No picture yet for B \(try a calmer, dimmer glow/)
    assert.doesNotMatch(sent.request, /\bA \(/)
    assert.deepEqual(shown.sent('/api/say'), [])
    // The new round has the pictures; the words typed under the other question are where they were.
    await shown.reread()
    assert.equal(shown.find('.q-block:nth-of-type(2) .q-field').value, 'Two fingers long, as on the old lamps in the hall')
    assert.equal(shown.all('#details .q-ask-pictures').length, 0, 'every option has its picture now')
    assert.equal(shown.sent('/api/backlog').length, 1, 'and nothing was sent but the request')
  } finally {
    await shown.close()
  }
})

test('"asked at" belongs to the question\'s words: another question at the same place asks again', async () => {
  const round1 = stateWith(waiting([LANTERN]))
  const round2 = stateWith(waiting(['Which door? A: red. B: blue Advised: A'], 2))
  let now = round1
  const shown = await openPage({ state: () => now, hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    await shown.click('.q-ask-pictures')
    assert.match(words(shown.find('.q-ask-pictures')), /^Asked at/)
    now = round2
    await shown.reread()
    assert.equal(words(shown.find('.q-ask-pictures')), 'Ask for pictures')
    assert.equal(shown.find('.q-ask-pictures').disabled, false)
  } finally {
    await shown.close()
  }
})

test('"Ask for pictures" on an ask goes to its chat as words that say to withdraw it and ask again with one picture per option', async () => {
  const asked = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    assert.equal(asked.all('#details .q-nopic').length, 2, 'the ask has two options and no picture')
    await asked.click('.q-ask-pictures')
    assert.deepEqual(asked.sent('/api/backlog'), [], 'an ask has no refine feedback')
    const [said] = asked.sent('/api/say').map(one => one.body)
    assert.equal(said.to, 'Digger')
    assert.match(said.text, /^Your ask Q70, "Number or bar\?": its options need one picture each\. Withdraw it \(work withdraw Q70\) and ask it again/)
    assert.match(said.text, /No picture yet for A \(number\), B \(bar\)\.$/)
  } finally {
    await asked.close()
  }
})

test('an ask of the store beside the window: Choose writes "<letter>: <words>" through the ask\'s own answer, its pick kept as the other windows keep it; the words of the field go as they are', async () => {
  const shown = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    assert.equal(words(shown.find('#details .details-chips .chip.is-ask')), '1 question for you')
    assert.equal(shown.find('.q-card.is-advised .q-letter').textContent, 'A')
    await shown.click('[data-q-choose="1"]')
    // The pick is the option's label, as the calm window and the taken task's Options keep it: it shows pressed there too.
    await shown.click('.q-send')
    assert.deepEqual(shown.sent('/api/work', 'answer').map(one => one.body), [{ action: 'answer', id: 'Q70', verdict: null, text: 'B: bar' }])
  } finally {
    await shown.close()
  }
  // The pick is the option's label, as the calm window and the taken task's Options keep it: the ask's own window shows it pressed.
  const kept = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    await kept.click('[data-q-choose="1"]')
    await kept.click('#needs [data-details="work:Q70"]')
    assert.match(words(kept.find('#details .calm-card[aria-pressed="true"]')), /Bar/)
  } finally {
    await kept.close()
  }
  const typed = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    await typed.type('.q-field', 'Neither: a mix of both.')
    await typed.click('.q-send')
    assert.deepEqual(typed.sent('/api/work', 'answer').map(one => one.body), [{ action: 'answer', id: 'Q70', verdict: null, text: 'Neither: a mix of both.' }])
  } finally {
    await typed.close()
  }
})

test('an ask whose options are in its text shows them as cards, and Choose writes the option\'s whole words (the live Q581 shape)', async () => {
  const shown = await open([waiting([]), Q81])
  try {
    assert.deepEqual(shown.all('#details .q-card .q-letter').map(words), ['A', 'B'])
    assert.equal(shown.all('#details .q-card.is-advised .q-letter').map(words).join(), 'A')
    assert.deepEqual(shown.all('#details .q-card .q-time').map(words), ['about 1 h', 'about 2 h'])
    assert.match(words(shown.find('#details')), /Try a calmer, darker lamp/, 'option B is in the window')
    assert.doesNotMatch(words(shown.find('#details .q-cards')), /\bYes\b|\bNo\b/)
    await shown.click('[data-q-choose="1"]')
    await shown.click('.q-send')
    assert.deepEqual(shown.sent('/api/work', 'answer').map(one => one.body.text), ['B: try a calmer, darker lamp, kept only if the scores rise by 10 and you approve it (about 2 h).'])
  } finally {
    await shown.close()
  }
})

test('the rest of a question\'s context (after its first sentence) stands under Details, kept whole', async () => {
  const shown = await open([waiting(['Which door? It faces the road. It is used every day, by everyone. A: red. B: blue. Advised: A'])])
  try {
    assert.equal(words(shown.find('#details .q-why')), 'It faces the road.')
    assert.equal(words(shown.find('#details details[data-fold="details"] .q-more p')), 'It is used every day, by everyone.')
    assert.match(words(shown.find('#details details[data-fold="details"] summary')), /the rest of the question/)
  } finally {
    await shown.close()
  }
})

test('"Take the advice" beside a lettered question takes the advised option as a pick of it would be written; advice that names no option has none to take', async () => {
  const shown = await open([waiting([LANTERN, BASE])])
  try {
    await shown.click('[data-refine-action="advice"]')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 0, answer: `A: ${A_WORDS}` }, { index: 1, answer: 'yes' }]])
  } finally {
    await shown.close()
  }
  const none = await open([waiting(['Today\'s rows or the new rows (Q398)? With A this step is refined from the old lines; with B it is dropped. Advised: B, the person decides in Q398'])])
  try {
    await none.click('[data-refine-action="advice"]')
    assert.deepEqual(none.sent('/api/backlog'), [])
    assert.match(none.text('#details .problem'), /^Question 1 has no advice: answer it first\.$/)
  } finally {
    await none.close()
  }
})

test('an advice that names no option shows under the question as the words it was written in (the live B650 shape)', async () => {
  const shown = await open([waiting(['Today\'s rows or the new rows (Q398)? With A this step is refined from the old lines; with B it is dropped. Advised: B, the person decides in Q398'])])
  try {
    assert.equal(words(shown.find('#details .q-advice')), 'Advised: B, the person decides in Q398')
    assert.equal(shown.all('#details .q-cards').length, 0)
  } finally {
    await shown.close()
  }
})

test('Send under an ask does not close the window while another question in it is open, and its toast says what was sent; the last answer closes it', async () => {
  const shown = await open([waiting([LANTERN]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    await shown.click('.q-block:nth-of-type(1) [data-q-choose="1"]')
    await shown.click('.q-block:nth-of-type(2) [data-q-choose="0"]')
    await shown.click('.q-block:nth-of-type(2) .q-send')
    assert.equal(shown.find('#details').open, true, 'the window stays')
    assert.equal(shown.text('#toast'), 'Answer sent to Digger: A: number')
    assert.equal(shown.sent('/api/backlog').length, 0, 'the refine pick is not sent by the ask\'s Send')
    assert.equal(shown.find('.q-block:nth-of-type(1) [data-q-choose="1"]').getAttribute('aria-pressed'), 'true', 'and is still the person\'s pick')
  } finally {
    await shown.close()
  }
  const last = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    await last.click('[data-q-choose="0"]')
    await last.click('.q-send')
    assert.equal(last.find('#details').open, false, 'nothing else waits: it closes as before')
    assert.equal(last.text('#toast'), 'Answer sent to Digger')
  } finally {
    await last.close()
  }
})

test('the ask\'s "Something else?" field keeps its text and its cursor when the window is drawn anew (a chat starts or stops)', async () => {
  const first = stateWith(waiting([]), ask('Q70', null, NOW - 10 * MIN))
  const second = JSON.parse(JSON.stringify(first))
  second.chats[0].isRunning = !second.chats[0].isRunning
  let flip = false
  const shown = await openPage({ state: () => (flip ? second : first), hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    const field = shown.find('.q-field')
    field.focus()
    await shown.type('.q-field', 'Neither one')
    shown.find('.q-field').setSelectionRange(3, 7)
    flip = true
    await shown.reread()
    const after = shown.find('.q-field')
    assert.equal(shown.document.activeElement, after, 'the focus is back')
    assert.deepEqual([after.value, after.selectionStart, after.selectionEnd], ['Neither one', 3, 7])
  } finally {
    await shown.close()
  }
})

test('options joined by plain space, commas or "or" are cards in the window; "picture: <path>" with or without brackets is the option\'s', async () => {
  const space = await open([waiting(['Which door? A: red, picture: pics/d/red.png B: blue, picture: pics/d/blue.png Advised: A'])])
  try {
    assert.deepEqual(space.all('#details .q-card .q-letter').map(words), ['A', 'B'])
    assert.deepEqual(space.all('#details .q-card .picture').map(one => one.dataset.zoom), ['pics/d/red.png', 'pics/d/blue.png'])
    assert.equal(space.all('#details .q-nopic, #details .q-ask-pictures').length, 0)
    assert.equal(space.all('#details .q-block > .q-pics').length, 0, 'no picture of an option stands above the cards as the question\'s')
  } finally {
    await space.close()
  }
  const comma = await open([waiting(['Is the approach right? A: keep going with the same plan, or B: change the approach (say what) Advised: A'])])
  try {
    assert.deepEqual(comma.all('#details .q-card .q-title').map(words), ['Keep going with the same plan', 'Change the approach (say what)'])
    await comma.click('[data-q-choose="0"]')
    await comma.click('.q-send')
    assert.deepEqual(comma.sent('/api/backlog').map(one => one.body.answers), [[{ index: 0, answer: 'A: keep going with the same plan' }]], 'the join is no part of the answer')
  } finally {
    await comma.close()
  }
})

test('with no question open the window is as it was, the answered questions as quiet lines with Change: the three lines first, the folds closed, no question block, no count, no input', async () => {
  const answered = await open([waiting([`${LANTERN} Answer: A: keep the lamp's glow`])])
  try {
    assert.equal(answered.all('#details .q-block').length, 0)
    assert.equal(answered.all('#details .details-chips .chip.is-ask').length, 0)
    assert.deepEqual(answered.all('#details .task-calm > .task-story').length, 1, 'the three lines stand first, not under Details')
    assert.equal(answered.all('#details details[data-fold="details"]').length, 0)
    // The answered question is one line with the person's answer and Change; it has no Yes and No, no field.
    assert.match(words(answered.find('#details .q-answered')), /^Should the lantern's glow be judged against the sketch\? Your answer: A: keep the lamp's glow/)
    assert.equal(words(answered.find('#details .q-answered .q-change')), 'Change')
    assert.equal(answered.all('#details [data-refine-pick], #details [data-refine-field="B12:0"], #details .q-field').length, 0, 'the one field left is the feedback to the Advisor')
  } finally {
    await answered.close()
  }
})

test('an answered lettered question never gets Yes and No: Details reads it, answer and all, with no button and no field; Change opens it as a question block with its answer in it', async () => {
  const shown = await open([waiting([`${LANTERN} Answer: A: ${A_WORDS}`, BASE])])
  try {
    // Under Details the old refine part reads each question and nothing more.
    const read = shown.all('#details details[data-fold="details"] .refine-question.is-read')
    assert.equal(read.length, 1)
    assert.ok(words(read[0]).includes('Should the lantern'))
    assert.ok(words(read[0]).includes(`Your answer: A: ${A_WORDS}`))
    assert.equal(shown.all('#details details[data-fold="details"] button.refine-pick, #details details[data-fold="details"] [data-refine-field="B12:0"], #details details[data-fold="details"] [data-refine-field="B12:1"]').length, 0)
    assert.equal(shown.all('#details [data-refine-pick]').length, 0, 'no Yes or No anywhere for it')
    // The open question is a block; the answered one is a quiet line with Change.
    assert.equal(shown.all('#details .q-block').length, 1)
    assert.equal(words(shown.find('#details .details-chips .chip.is-ask')), '1 question for you')
    assert.match(words(shown.find('#details .q-answered')), /^Should the lantern's glow be judged against the sketch\? Your answer: A: keep the lamp's glow/)
    // The answer of the open question goes alone: the answered one is not overwritten.
    await shown.click('.q-block [data-q-choose="0"]')
    await shown.click('.q-block .q-send')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body.answers), [[{ index: 1, answer: 'yes' }]])
    // Change opens it again, in a block, as the option it was.
    await shown.click('.q-change')
    assert.equal(shown.all('#details .q-block').length, 2)
    assert.equal(words(shown.find('#details .details-chips .chip.is-ask')), '2 questions for you')
    assert.deepEqual([...shown.all('#details .q-block:nth-of-type(1) .q-choose')].map(one => one.getAttribute('aria-pressed')), ['true', 'false'], 'its answer is the pick')
    assert.equal(shown.all('#details .q-answered').length, 0)
    await shown.click('.q-block:nth-of-type(1) [data-q-choose="1"]')
    await shown.click('.q-block:nth-of-type(1) .q-send')
    assert.deepEqual(shown.sent('/api/backlog').at(-1).body.answers.filter(one => one.index === 0), [{ index: 0, answer: `B: ${B_WORDS}` }])
  } finally {
    await shown.close()
  }
  // An answer in the person's own words comes back as words in the field.
  const words2 = await open([waiting([`${LANTERN} Answer: Neither: match the sketch exactly`, BASE])])
  try {
    await words2.click('.q-change')
    assert.equal(words2.find('.q-block:nth-of-type(1) .q-field').value, 'Neither: match the sketch exactly')
  } finally {
    await words2.close()
  }
})

// An ask under the task whose options stand in its words (the live Q581 shape), in each window that draws its options.
const TAKEN = parseItem([
  'Id: B12', 'Kind: step', 'Title: Painted maps: lava layer matches the painting\'s calm glow', 'State: in progress', 'Owner: Digger', `Since: ${sinceOf(NOW - 30 * MIN)}`, '',
  '## Summary', 'The glow is judged against the sketch.', '', '## History', `- ${sinceOf(NOW - 30 * MIN)} Digger: taken → in progress`, '',
].join('\n'))

test('an ask whose options stand in its words has them as cards (never Yes and No) in the ask\'s own window and in a taken task\'s Options too, and a pick shows pressed in every window', async () => {
  const calm = await open([waiting([]), Q81], { hash: 'details=Q81' })
  try {
    assert.deepEqual(calm.all('#details .calm-card').map(one => words(one.querySelector('.calm-key'))), ['A', 'B'])
    assert.doesNotMatch(words(calm.find('#details .calm-cards')), /\bYes\b|\bNo\b/)
    await calm.click('#details .calm-card:nth-of-type(2)')
    assert.match(words(calm.find('#details .calm-card[aria-pressed="true"]')), /try a calmer, darker lamp/i)
  } finally {
    await calm.close()
  }
  const taken = await openPage({ state: stateWith(TAKEN, Q81), hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    assert.deepEqual(taken.all('#details .task-card .task-letter').map(words), ['A', 'B'])
    assert.equal(taken.all('#details .task-card.is-advised .task-letter').map(words).join(), 'A')
    await taken.click('#details .task-card:nth-of-type(2)')
    assert.equal(taken.all('#details .task-card.is-chosen .task-letter').map(words).join(), 'B')
    await taken.click('#details [data-task-send]')
    assert.deepEqual(taken.sent('/api/work', 'answer').map(one => one.body.text), ['B: try a calmer, darker lamp, kept only if the scores rise by 10 and you approve it (about 2 h).'])
  } finally {
    await taken.close()
  }
  // The task window of a step not taken: a pick made there is pressed in the ask's own window.
  const pick = await open([waiting([]), Q81])
  try {
    await pick.click('[data-q-choose="1"]')
    await pick.click('#needs [data-details="work:Q81"]')
    assert.match(words(pick.find('#details .calm-card[aria-pressed="true"]')), /try a calmer, darker lamp/i)
  } finally {
    await pick.close()
  }
})

test('an ask whose text says "no picture: <why>" shows no placeholder, and the words are no part of its why', () => {
  const need = { id: 'work:Q73', question: 'Which name?', text: 'Both names are fine. no picture: names have no look.', options: [{ label: 'A Ivy', picture: null }, { label: 'B Fern', picture: null }], advice: 'A', pictures: [], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.deepEqual([shape.noPicture, shape.noPictureWhy, shape.why], [true, 'names have no look', 'Both names are fine.'])
  assert.deepEqual(plain(page.questionLacking(shape)), [])
})

// ---- the board: the request, the lookup of a file name, what the answer keeps ----

test('the person\'s answer keeps its question: "<letter>: <words>" lands on the step\'s Your words with the question it answered', async () => {
  const store = await fresh()
  try {
    const question = 'Which holder? A: brass (picture: pics/lamp/brass.png) about 1 h B: iron (picture: pics/lamp/iron.png) about 2 h Advised: A — it lasts'
    const refined = await store.partner({ action: 'refine', id: 'B1', summary: 'Trim every wick to one length.', questions: [question] })
    assert.equal(refined.ok, true, refined.why)
    const answered = await store.person({ action: 'refine-answer', id: 'B1', answers: [{ index: 0, answer: 'A: brass (picture: pics/lamp/brass.png) about 1 h' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    const [point] = yourWordsOf(await storeItem(store.dir, 'B1'))
    assert.deepEqual([point.question, point.answer], [question, 'A: brass (picture: pics/lamp/brass.png) about 1 h'])
  } finally {
    await remove(store.dir)
  }
})

test('the board\'s request for pictures is one marked line under the step\'s Feedback, written once, never a point of Your words; the person\'s own feedback still is', async () => {
  const store = await fresh()
  try {
    const refined = await store.partner({ action: 'refine', id: 'B1', summary: 'Trim every wick to one length.', questions: ['Which holder? A: brass. B: iron. Advised: A — it lasts'] })
    assert.equal(refined.ok, true, refined.why)
    const options = { now: Date.now(), work: { dir: store.dir } }
    const request = 'Question 1, "Which holder?": give every option its picture. No picture yet for A (brass), B (iron).'
    for (let again = 0; again < 2; again += 1) {
      const done = await editStep({ action: 'refine-answer', step: 'B1', answers: [], feedback: '', request }, options)
      assert.equal(done.ok, true, done.why)
    }
    const block = (await storeItem(store.dir, 'B1')).sections.get('Refined')
    assert.equal(block.filter(one => one.includes(`Round 1: Asked by the board: ${request}`)).length, 1, 'a retry does not repeat it')
    assert.deepEqual(yourWordsOf(await storeItem(store.dir, 'B1')), [], 'nobody said it')
    // Its History line is the board's own, once: not the person's "answered the refine questions".
    const history = (await storeItem(store.dir, 'B1')).sections.get('History')
    assert.equal(history.filter(one => one.endsWith('board: asked for pictures, one per option')).length, 1)
    assert.equal(history.filter(one => one.includes('answered the refine questions')).length, 0)
    // The person's own feedback, with the request beside it, lands in Your words as theirs.
    const own = await editStep({ action: 'refine-answer', step: 'B1', answers: [], feedback: 'Make them round.', request }, options)
    assert.equal(own.ok, true, own.why)
    assert.deepEqual(yourWordsOf(await storeItem(store.dir, 'B1')).map(one => one.answer), ['Make them round.'])
    assert.equal((await storeItem(store.dir, 'B1')).sections.get('History').filter(one => one.includes('person: answered the refine questions')).length, 1)
    // Nothing asked and nothing said is still refused.
    assert.equal((await editStep({ action: 'refine-answer', step: 'B1', answers: [], feedback: '', request: '' }, options)).status, 400)
  } finally {
    await remove(store.dir)
  }
})

test('a picture named by its file name alone is the one picture of that name in the shown folders: none or two of them is no picture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'question-pictures-'))
  try {
    for (const path of ['pictures/lamps/glow.png', 'pictures/walls/stone.png', 'pictures/walls/old/stone.png', 'pictures/walls/wide.PNG', 'elsewhere/hidden.png']) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), 'x')
    }
    const found = await findPicture(root, ['pictures'], 'glow.png')
    assert.deepEqual([found?.type, found?.size], ['image/png', 1], 'one file of that name')
    assert.equal(await findPicture(root, ['pictures'], 'stone.png'), null, 'two of that name say nothing')
    assert.equal((await findPicture(root, ['pictures'], 'wide.png'))?.type, 'image/png', 'the case of the name does not matter')
    assert.equal(await findPicture(root, ['pictures'], 'hidden.png'), null, 'only the shown folders are looked in')
    assert.equal(await findPicture(root, ['pictures'], 'missing.png'), null)
    assert.equal(await findPicture(root, ['pictures'], '../elsewhere/hidden.png'), null)
    assert.equal(await findPicture(root, ['pictures'], 'glow.txt'), null)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('the chats are told: every option its picture, written as the board reads it, and "no picture: <why>" when the options look alike', async () => {
  const roles = join(dirname(fileURLToPath(import.meta.url)), '..', 'roles')
  const read = async name => readFile(join(roles, name), 'utf8')
  const partner = await read('partner.md')
  for (const text of ['A: <words> (picture: <path>) B: <words> (picture: <path>) Advised: A', 'every option its picture', 'no picture:\n<why>']) assert.ok(partner.includes(text), text)
  // The Questions rule says a letter is advice too, and "Take the advice" takes that option.
  assert.match(partner, /`Advised: yes`, `Advised: no` or\s+`Advised: <letter>`/)
  const protocol = await read('protocol.md')
  assert.ok(protocol.includes('- <question>? A: <words> (picture: <path>) B: <words> (picture: <path>) Advised: A — <why>'))
  assert.ok(protocol.includes('`pictures` holds one per option, in the options\' order'))
  for (const name of ['product-owner.md', 'worker.md', 'main.md']) assert.match(await read(name), /no picture: <why>/, name)
})

// Reactive board, brief P4a: "Send answers" is ONE call; a refine word the board did not queue leaves the answers standing under
// the step, with "Not sent: <why>, HH:MM" and a Retry (from the board's record) that sends the same click id to /api/backlog.
test('a refine answer whose word was not queued stands with its "Not sent" line and a Retry on the same click id', async () => {
  const unsent = { click: 'click-eeee-5555', via: 'refine-send', key: 'B12', route: '/api/backlog', why: 'no chat on the board takes it', at: '09:10' }
  const shown = await openPage({ state: () => ({ ...stateWith(waiting([LANTERN])), clicksUnsent: [unsent] }), hash: 'details=B12', answers: answering(() => reply({})) })
  try {
    assert.match(words(shown.find('#details .click-unsent')), /^Not sent: no chat on the board takes it, 09:10\. Your input stands\. Retry$/)
    await shown.click('#details .click-unsent .click-retry')
    assert.deepEqual(shown.sent('/api/backlog').map(one => one.body), [{ action: 'click-retry', click: 'click-eeee-5555' }])
    assert.deepEqual(shown.sent('/api/say'), [])
  } finally {
    await shown.close()
  }
})
