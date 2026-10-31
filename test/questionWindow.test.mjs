// The task window's question (the person, 2026-10-31, on the window of B893: "i have no clue what this is about the UI sucks.
// too cluttered"; on the agreed mock: "yes this mockup is much better" and "i always want pictures in the main focus its the
// easiest for me to decide"): while a question waits for the person it stands first, large, with every option a card with its
// pictures large, and everything else folded under one "Details". The parser reads the question's words into one shape; the
// page is read and clicked through the DOM harness (B415). Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('calm')}\n${cut('question')}\nObject.assign(this, { parseQuestionText, refineQuestionOf, askQuestionOf, questionLacking, questionTitle, questionPicked, questionPicturesRequest })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

// The shape of B893's question (its real text, rebuilt with made-up words): its options in one sentence, "Picture: <words>"
// that names no file, "Advised: A" with no reason, a time in each option, and a file in the first option's brackets.
const LANTERN = 'Should the lantern\'s glow be judged against the sketch? A: keep the lamp\'s glow; the judges\' panel gets the sketch (sketch-glow.png) as the glow\'s target, so the glow is judged against what you agreed, about 1 h. B: try a calmer, dimmer glow, kept only if both panels gain 10 points and you approve it beside the sketch, about 2 h. Picture: the sketch\'s blue glow beside the game. Advised: A'

test('the real shape of B893 (options in one sentence, a picture wish, Advised: A): the question, no why, two options with their times, the one picture of A, the wish kept', () => {
  const shape = plain(page.parseQuestionText(LANTERN))
  assert.equal(shape.question, 'Should the lantern\'s glow be judged against the sketch?')
  assert.equal(shape.why, '', 'the options are not the why')
  assert.deepEqual(shape.options.map(one => [one.letter, one.time, one.pictures.map(picture => picture.path), one.isAdvised]), [['A', 'about 1 h', ['sketch-glow.png'], true], ['B', 'about 2 h', [], false]])
  assert.equal(shape.options[0].words, 'keep the lamp\'s glow; the judges\' panel gets the sketch as the glow\'s target, so the glow is judged against what you agreed', 'the time and the file in brackets are taken out of the words')
  assert.equal(shape.options[1].words, 'try a calmer, dimmer glow, kept only if both panels gain 10 points and you approve it beside the sketch')
  assert.equal(shape.options[0].answer, `A: ${shape.options[0].words}`)
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

test('an ask with options and one picture per option: the pictures belong to the options in order, the advised option by its letter', () => {
  const need = { id: 'work:Q70', question: 'Which hedge?', text: 'The garden is bare on the road side. The yew is slow.', options: [{ label: 'A yew', picture: null, isRecommended: false }, { label: 'B box, about 2 h', picture: null, isRecommended: true }], advice: 'B', pictures: ['pics/hedge/yew.png', 'pics/hedge/box.png'], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.equal(shape.id, 'work:Q70')
  assert.equal(shape.question, 'Which hedge?')
  assert.equal(shape.why, 'The garden is bare on the road side. The yew is slow.')
  assert.deepEqual(shape.options.map(one => [one.letter, one.words, one.time, one.pictures.map(picture => picture.path), one.answer, one.isAdvised]), [
    ['A', 'yew', '', ['pics/hedge/yew.png'], 'A: yew', false],
    ['B', 'box', 'about 2 h', ['pics/hedge/box.png'], 'B: box', true],
  ])
  assert.deepEqual([shape.pictures, shape.advice], [[], 'B'])
})

test('an ask with fewer pictures than options: the pictures show above the options, every option still has none of its own', () => {
  const need = { id: 'work:Q71', question: 'Which hedge?', text: '', options: [{ label: 'A yew', picture: null }, { label: 'B box', picture: null }, { label: 'C holly', picture: null }], advice: 'A', pictures: ['pics/hedge/now.png'], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.deepEqual(shape.pictures.map(one => one.path), ['pics/hedge/now.png'])
  assert.deepEqual(shape.options.map(one => one.pictures.length), [0, 0, 0])
  assert.deepEqual(page.questionLacking(shape).map(one => one.letter), ['A', 'B', 'C'])
  // An option's own picture (the asks' JSON form) is its own, and the other pictures stay above.
  const own = plain(page.askQuestionOf({ ...need, options: [{ label: 'A yew', picture: 'pics/hedge/yew.png' }, { label: 'B box', picture: null }] }))
  assert.deepEqual(own.options.map(one => one.pictures.map(picture => picture.path)), [['pics/hedge/yew.png'], []])
  assert.deepEqual(own.pictures.map(one => one.path), ['pics/hedge/now.png'])
})

test('an ask with no options of its own is a Yes/No question (a look: Approve and Reject); its pictures stand above and it asks for none', () => {
  const look = plain(page.askQuestionOf({ id: 'work:Q72', question: 'Is the flame tall enough?', text: '', options: [], advice: 'yes', pictures: ['pics/lamp/a.png', 'pics/lamp/b.png'], kind: 'verify', asks: 'look' }))
  assert.deepEqual(look.options.map(one => [one.words, one.answer]), [['Yes', 'approve'], ['No', 'reject']])
  assert.deepEqual(look.pictures.map(one => one.path), ['pics/lamp/a.png', 'pics/lamp/b.png'])
  assert.deepEqual([look.isYesNo, look.advice, plain(page.questionLacking(look))], [true, 'approve', []])
})

test('an option\'s title is its short head before ";" or ":", the rest its text; the answer an option writes is its letter and words', () => {
  assert.deepEqual(plain(page.questionTitle('keep the bar\'s lava; the judges get the picture')), { title: 'keep the bar\'s lava', rest: 'the judges get the picture' })
  assert.deepEqual(plain(page.questionTitle('Yes')), { title: 'Yes', rest: '' })
  const shape = page.parseQuestionText(LANTERN)
  assert.equal(page.questionPicked(shape, `A: ${shape.options[0].words}`), 0)
  assert.equal(page.questionPicked(shape, 'something else'), -1)
})

test('the words that ask for pictures name the question and each option without one', () => {
  const shape = page.parseQuestionText(LANTERN)
  const words = page.questionPicturesRequest(shape, 'Question 1')
  assert.match(words, /^Question 1, "Should the lantern's glow be judged against the sketch\?": give every option its picture/)
  assert.match(words, /No picture yet for B \(try a calmer, dimmer glow, kept only if both…\)\.$/)
  assert.doesNotMatch(words, /\bA \(/, 'A has its picture')
})

// ---- the window ----
import { parseItem } from '../src/work/item.mjs'
import { yourWordsOf } from '../src/work/yourWords.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, ask, asSent, build, sinceOf } from './partnerState.mjs'
import { fresh, item as storeItem, remove } from './qaKit.mjs'

const WITH_PICTURE = LANTERN.replace('(sketch-glow.png)', '(picture: pics/glow/sketch.png)')
/** A step B12 that waits for its refine answers: the given questions, one line each. */
const waiting = (questions, more = []) => parseItem([
  'Id: B12', 'Kind: step', 'Title: Painted maps: lava layer matches the painting\'s calm glow', 'State: new', `Since: ${sinceOf(NOW - 30 * MIN)}`, 'Refined: open', '',
  '## Summary', 'Context: From the last round.', 'Problem: The judges mark the glow down as brighter than the sketch.', 'Solution: Judge it against the sketch.', '',
  '## Refined', '  Refined (round 1, by Oracle, 2026-10-19 09:30):', '  Summary: The glow is judged against the sketch.', '  Part of: G6 · The polish', '  Size: about 1 hour',
  '  Questions:', ...questions.map(one => `  - ${one}`), ...more, '',
  '## History', `- ${sinceOf(NOW - 30 * MIN)} Oracle: refined, round 1`, '',
].join('\n'))
const stateWith = (...items) => asSent({ ...build(items), goalsEdit: { canWrite: true } })
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const open = (items, extra = {}) => openPage({ state: stateWith(...items), hash: 'details=B12', ...extra })

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

test('Choose marks the pick ("Chosen", pressed) and a second click takes it back; Send writes "<letter>: <words>" as the refine answer, with the Advisor asked once more', async () => {
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
    const [written] = shown.sent('/api/backlog').map(one => one.body)
    assert.equal(written.action, 'refine-answer')
    assert.equal(written.step, 'B12')
    assert.equal(written.feedback, '')
    assert.deepEqual(written.answers, [
      { index: 0, answer: 'B: try a calmer, dimmer glow, kept only if both panels gain 10 points and you approve it beside the sketch' },
      { index: 1, answer: 'yes' },
    ])
    assert.deepEqual(shown.sent('/api/say').map(one => one.body), [{ to: 'Advisor', command: 'refine', step: 'B12' }])
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

test('"Ask for pictures" names the question and each option without one: a refine question goes to the Advisor as feedback and a new round, an ask to its chat as words', async () => {
  const shown = await open([waiting([LANTERN])])
  try {
    await shown.click('.q-ask-pictures')
    const [feedback] = shown.sent('/api/backlog').map(one => one.body)
    assert.deepEqual([feedback.action, feedback.step, feedback.answers], ['refine-answer', 'B12', []])
    assert.match(feedback.feedback, /^Question 1, "Should the lantern's glow be judged against the sketch\?": give every option its picture/)
    assert.match(feedback.feedback, /No picture yet for B \(try a calmer, dimmer glow/)
    assert.doesNotMatch(feedback.feedback, /\bA \(/)
    assert.deepEqual(shown.sent('/api/say').map(one => one.body), [{ to: 'Advisor', command: 'refine', step: 'B12' }])
    assert.match(words(shown.find('.q-ask-pictures')), /^Asked at \d\d:\d\d$/)
    assert.equal(shown.find('.q-ask-pictures').disabled, true)
  } finally {
    await shown.close()
  }
  const asked = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    assert.equal(asked.all('#details .q-nopic').length, 2, 'the ask has two options and no picture')
    await asked.click('.q-ask-pictures')
    assert.deepEqual(asked.sent('/api/backlog'), [], 'an ask has no refine feedback')
    const [said] = asked.sent('/api/say').map(one => one.body)
    assert.equal(said.to, 'Digger')
    assert.match(said.text, /^Your ask Q70, "Number or bar\?": give every option its picture.*No picture yet for A \(number\), B \(bar\)\.$/)
  } finally {
    await asked.close()
  }
})

test('an ask of the store beside the window: Choose writes "<letter>: <words>" through the ask\'s own answer, the words of the field go as they are', async () => {
  const shown = await open([waiting([]), ask('Q70', null, NOW - 10 * MIN)])
  try {
    assert.equal(words(shown.find('#details .details-chips .chip.is-ask')), '1 question for you')
    assert.equal(shown.find('.q-card.is-advised .q-letter').textContent, 'A')
    await shown.click('[data-q-choose="1"]')
    await shown.click('.q-send')
    assert.deepEqual(shown.sent('/api/work', 'answer').map(one => one.body), [{ action: 'answer', id: 'Q70', verdict: null, text: 'B: bar' }])
  } finally {
    await shown.close()
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

test('the person\'s answer keeps its question: "<letter>: <words>" lands on the step\'s Your words with the question it answered', async () => {
  const store = await fresh()
  try {
    const question = 'Which holder? A: brass (picture: pics/lamp/brass.png) about 1 h B: iron (picture: pics/lamp/iron.png) about 2 h Advised: A — it lasts'
    const refined = await store.partner({ action: 'refine', id: 'B1', summary: 'Trim every wick to one length.', questions: [question] })
    assert.equal(refined.ok, true, refined.why)
    const answered = await store.person({ action: 'refine-answer', id: 'B1', answers: [{ index: 0, answer: 'A: brass' }], feedback: '' })
    assert.equal(answered.ok, true, answered.why)
    const [point] = yourWordsOf(await storeItem(store.dir, 'B1'))
    assert.deepEqual([point.question, point.answer], [question, 'A: brass'])
  } finally {
    await remove(store.dir)
  }
})

test('with no question open the window is as it was: the three lines first, the folds closed, no question block and no count of questions', async () => {
  const answered = await open([waiting([`${LANTERN} Answer: A: keep the lamp's glow`])])
  try {
    assert.equal(answered.all('#details .q-block').length, 0)
    assert.equal(answered.all('#details .details-chips .chip.is-ask').length, 0)
    assert.deepEqual(answered.all('#details .task-calm > .task-story').length, 1, 'the three lines stand first, not under Details')
    assert.equal(answered.all('#details details[data-fold="details"]').length, 0)
    // The answered question stays in the refine part, with the person's answer.
    assert.match(words(answered.find('#details .refine-questions')), /Your answer: A: keep the lamp's glow/)
  } finally {
    await answered.close()
  }
})

test('an ask whose text says "no picture: <why>" shows no placeholder, and the words are no part of its why', () => {
  const need = { id: 'work:Q73', question: 'Which name?', text: 'Both names are fine. no picture: names have no look.', options: [{ label: 'A Ivy', picture: null }, { label: 'B Fern', picture: null }], advice: 'A', pictures: [], kind: 'input', asks: 'decide' }
  const shape = plain(page.askQuestionOf(need))
  assert.deepEqual([shape.noPicture, shape.noPictureWhy, shape.why], [true, 'names have no look', 'Both names are fine.'])
  assert.deepEqual(plain(page.questionLacking(shape)), [])
})

test('the chats are told: every option its picture, written as the board reads it, and "no picture: <why>" when the options look alike', async () => {
  const roles = join(dirname(fileURLToPath(import.meta.url)), '..', 'roles')
  const read = async name => readFile(join(roles, name), 'utf8')
  const partner = await read('partner.md')
  for (const words of ['A: <words> (picture: <path>) B: <words> (picture: <path>) Advised: A', 'every option its picture', 'no picture:\n<why>']) assert.ok(partner.includes(words), words)
  const protocol = await read('protocol.md')
  assert.ok(protocol.includes('- <question>? A: <words> (picture: <path>) B: <words> (picture: <path>) Advised: A — <why>'))
  assert.ok(protocol.includes('`pictures` holds one per option, in the options\' order'))
  for (const name of ['product-owner.md', 'worker.md', 'main.md']) assert.match(await read(name), /no picture: <why>/, name)
})
