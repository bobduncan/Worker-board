// "Your words" (the person, 2026-10-30: "ensure my answer/rejection/note has context of what i answered it to. so a simple
// 'yes' is not meaningless because it needs context"): a point stands on its own with the question, its options and what
// was shown; the points number on, read back, and find the person's earlier answer to a question. Made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseItem, serializeItem } from '../../src/work/item.mjs'
import { YOUR_WORDS, answeredBefore, askPoint, isPersonsWords, isPopupAsk, withYourWords, wordsPoint, yourWordsLine, yourWordsOf } from '../../src/work/yourWords.mjs'

const STEP = parseItem('Id: B12\nKind: step\nTitle: Plant the hedge\nState: review\nOwner: Studio · Worker 1\nSince: 2026-10-30 21:00\n\n## Summary\nA hedge round the garden.\n\n## History\n- 2026-10-30 21:00 Studio · Worker 1: in progress → review\n')
const QUESTION = 'Do you accept the round hedge for now and leave the gate as a later step?'

test('a point stands on its own: when, how, who asked what, the options, the advice, what was shown, and the person\'s words', () => {
  const point = wordsPoint({
    n: 3, at: '2026-10-30 21:22', how: 'answer to Q20', ask: { by: 'Worker 1', question: QUESTION, advice: 'yes' },
    options: ['yes', 'no'], shown: ['art-inbox/b12/evidence.png', 'play b12-hedge&screen=garden'], answer: 'Rejected. It feels a bit square.\nMake it round.',
  })
  assert.equal(point, [
    `3. 2026-10-30 21:22 · answer to Q20 (Worker 1 asked: "${QUESTION}"; options: yes / no; advised: yes; shown: art-inbox/b12/evidence.png, play b12-hedge&screen=garden)`,
    '   You: Rejected. It feels a bit square. / Make it round.',
  ].join('\n'))
  // A note asks nothing: no question part. Quotes in a question never break the point.
  assert.equal(wordsPoint({ n: 1, at: '2026-10-30 21:40', how: 'note (on the board)', answer: 'Keep the gate.' }), '1. 2026-10-30 21:40 · note (on the board)\n   You: Keep the gate.')
  assert.match(wordsPoint({ n: 2, at: '2026-10-30 21:41', how: 'answer to Q3', ask: { question: 'Is "round" right?' }, answer: 'yes' }), /\(asked: "Is 'round' right\?"\)/)
  // Feedback without a question says what it was about.
  assert.match(wordsPoint({ n: 4, at: '2026-10-30 21:42', how: 'feedback on the refine', about: 'A hedge round the garden.', answer: 'Lower.' }), /^4\. 2026-10-30 21:42 · feedback on the refine \(about: "A hedge round the garden\."\)$/m)
})

test('an ask\'s answer as a point: its title, who asked, its options, advice, pictures and play', () => {
  const ask = parseItem('Id: Q20\nKind: ask\nTitle: Round or square?\nState: open\nOwner: Studio · Worker 1\nSince: 2026-10-30 21:13\nPictures: art-inbox/b12/a.png, art-inbox/b12/b.png\nAsks: look\nOf: B12\nOptions: A round | B square\nAdvice: A\n\n## Text\nRound or square?\n\n## Play\nb12-hedge&screen=garden\n')
  const fields = askPoint(ask, { at: '2026-10-30 21:22', how: 'answer to Q20', by: 'Worker 1', answer: 'yes' })
  assert.deepEqual(fields.ask, { by: 'Worker 1', question: 'Round or square?', advice: 'A' })
  assert.deepEqual(fields.options, ['A round', 'B square'])
  assert.deepEqual(fields.shown, ['art-inbox/b12/a.png', 'art-inbox/b12/b.png', 'play b12-hedge&screen=garden'])
  // A bare "yes" keeps what it said yes to.
  const point = wordsPoint({ ...fields, n: 1 })
  assert.match(point, /Worker 1 asked: "Round or square\?"; options: A round \/ B square; advised: A; shown: art-inbox\/b12\/a\.png/)
  assert.match(point, /\n {3}You: yes$/)
})

test('points number on, stand before History, and read back with their ask, question and answer', () => {
  let item = withYourWords(STEP, { at: '2026-10-30 21:22', how: 'answer to Q20', ask: { by: 'Worker 1', question: QUESTION }, options: ['yes', 'no'], answer: 'Rejected. It feels square.' })
  item = withYourWords(item, { at: '2026-10-30 21:40', how: 'note (in Main\'s chat)', answer: 'And keep the gate.' })
  assert.deepEqual([...item.sections.keys()], ['Summary', YOUR_WORDS, 'History'])
  const read = yourWordsOf(parseItem(serializeItem(item)))
  assert.deepEqual(read.map(one => [one.n, one.at, one.how, one.ask, one.by, one.question, one.answer]), [
    [1, '2026-10-30 21:22', 'answer to Q20', 'Q20', 'Worker 1', QUESTION, 'Rejected. It feels square.'],
    [2, '2026-10-30 21:40', 'note (in Main\'s chat)', null, null, null, 'And keep the gate.'],
  ])
  assert.deepEqual(read[0].options, ['yes', 'no'])
  // The advice, what was shown and what feedback was about read back too.
  const full = withYourWords(STEP, { at: '2026-10-30 21:22', how: 'answer to Q20', ask: { by: 'Worker 1', question: 'Round (or square)?', advice: 'A' }, shown: ['art-inbox/b12/a.png'], answer: 'A' })
  const about = withYourWords(full, { at: '2026-10-30 21:30', how: 'feedback on the refine of round 2', about: 'A hedge round the garden.', answer: 'Lower.' })
  assert.deepEqual(yourWordsOf(about).map(one => [one.how, one.question, one.advice, one.shown, one.about]), [
    ['answer to Q20', 'Round (or square)?', 'A', ['art-inbox/b12/a.png'], null],
    ['feedback on the refine of round 2', null, null, [], 'A hedge round the garden.'],
  ])
  // The numbering goes on from the highest, also after a hand edit; the step itself is not changed.
  const more = withYourWords(item, { at: '2026-10-30 21:50', how: 'note (on the board)', answer: 'Thanks.' })
  assert.deepEqual(yourWordsOf(more).map(one => one.n), [1, 2, 3])
  assert.equal(STEP.sections.has(YOUR_WORDS), false)
  assert.equal(yourWordsLine(more), 'The person\'s words on B12: 3 points, see its "Your words".')
  assert.equal(yourWordsLine(STEP), '')
  assert.deepEqual(yourWordsOf(STEP), [])
})

test('the person\'s earlier answer is found for the same question, or one alike; not for a different one', () => {
  const item = withYourWords(withYourWords(STEP, { at: '2026-10-30 21:22', how: 'answer to Q20', ask: { by: 'Worker 1', question: QUESTION }, answer: 'Rejected. Make it round.' }),
    { at: '2026-10-30 21:40', how: 'note (on the board)', answer: 'Do you accept the round hedge for now?' })
  // The same words, with context after them.
  assert.equal(answeredBefore(item, `${QUESTION} The gate follows in its own step.`)?.ask, 'Q20')
  // In other words, near enough to be the same question.
  assert.equal(answeredBefore(item, 'Accept the round hedge for now, leaving the gate for a later step?')?.answer, 'Rejected. Make it round.')
  // Another question; a note is never a question answered.
  assert.equal(answeredBefore(item, 'Which colour should the gate be painted?'), null)
  assert.equal(answeredBefore(item, ''), null)
  assert.equal(answeredBefore(STEP, QUESTION), null)
})

test('the Workers mod\'s own closes are never the person\'s words', () => {
  for (const words of ['', '  ', 'answered in the chat', 'Answered in the chat.', 'answered in the chat: the call went on', 'the call went on', 'the question form was closed without an answer', 'A popup in its chat may wait for you: it has tried to run a command for over a minute.']) {
    assert.equal(isPersonsWords(words), false, words)
  }
  for (const words of ['yes', 'Rejected. Make it round.', ['B, thick', 'and lower']]) assert.equal(isPersonsWords(words), true, String(words))
  assert.equal(isPopupAsk(parseItem('Id: Q4\nKind: ask\nTitle: A popup in its chat may wait for you: it has tried to change a file for over a minute.\nState: open\nSince: 2026-10-30 21:00\n')), true)
  assert.equal(isPopupAsk(parseItem('Id: Q5\nKind: ask\nTitle: Round or square?\nState: open\nSince: 2026-10-30 21:00\n')), false)
})
