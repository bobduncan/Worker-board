// B417 (robustness page, place 6): whether two asks' words are the same question (`sameAsk`). It matched on a shared
// start whatever the lengths: an open "Look at the menu" made a new, longer item that began the same way count as the
// same ask, so the new question was neither filed nor warned about. No test imported this module before. Made-up words.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SAME_LENGTH, askIdsIn, askKey, sameAsk } from '../../src/work/askWords.mjs'

test('askKey: no links, marks of markdown, the work tool\'s note, case or end marks', () => {
  assert.equal(askKey('**Look at the menu?** (Q4, decide, blocks B1)'), 'look at the menu')
  assert.equal(askKey('[Play it: the shop](http://127.0.0.1:4310/#play=main) Is it clear!'), 'play it: the shop is it clear')
  assert.equal(askKey(null), '')
  // The advice after the question is not part of it; advice with no question before it is kept.
  assert.equal(askKey('Is the strip readable now? I advise yes, it reads well.'), 'is the strip readable now')
  assert.equal(askKey('Keep it as it is; my advice is to wait'), 'keep it as it is')
  assert.equal(askKey('Keep it as it is — I would recommend waiting'), 'keep it as it is —')
  assert.equal(askKey('I advise yes'), 'i advise yes')
  // Advice words in the middle of a question's own clause are part of the question: two questions that differ only after
  // them stay two (chat 1's review: both were cut to the same short key and the second was dropped as the same ask).
  const one = askKey('Should the hedge be yew, and I advise against box hedges near the path?')
  const two = askKey('Should the hedge be yew, and I advise against stone walls near the path?')
  assert.notEqual(one, two)
  assert.equal(sameAsk(one, two), false)
  assert.equal(askKey('Do you want me to recommend a colour or I advise nothing at all?').includes('advise'), true)
})

test('sameAsk: equal keys are the same, whatever their length', () => {
  assert.equal(sameAsk('menu?', 'menu?'), true)
  assert.equal(sameAsk('look at the menu', 'look at the menu'), true)
  assert.equal(sameAsk('look at the menu', 'look at the map'), false)
})

test('sameAsk: a start counts only when the lengths are close (a title cut a little, advice added a little)', () => {
  const asked = 'is the strip readable now at play size'
  assert.equal(sameAsk(asked, `${asked} too`), true)
  assert.equal(sameAsk(`${asked} too`, asked), true)
  // The reproduced case: an open "Look at the menu" and a new, longer item that starts the same way.
  const open = 'look at the menu'
  const added = 'look at the menu on a phone and check its spacing'
  assert.equal(sameAsk(open, added), false)
  assert.equal(sameAsk(added, open), false)
  // At the edge: the shorter is 80% of the longer.
  assert.equal(SAME_LENGTH, 0.8)
  const edge = 'a'.repeat(40)
  assert.equal(sameAsk(edge, edge + 'b'.repeat(10)), true)
  assert.equal(sameAsk(edge, edge + 'b'.repeat(11)), false)
})

test('sameAsk: a very short start is never the same (under twelve characters), and a longer one that is no start is not', () => {
  assert.equal(sameAsk('menu', 'menu now'), false)
  assert.equal(sameAsk('a'.repeat(11), 'a'.repeat(12)), false)
  assert.equal(sameAsk('the strip is wide', 'a strip that is wide'), false)
})

test('askIdsIn: the ask ids words name, each as a word of its own', () => {
  assert.deepEqual(askIdsIn('Q4 and (Q17, decide) but not XQ5, Q6x or B-Q7'), ['Q4', 'Q17'])
  assert.deepEqual(askIdsIn(null), [])
})
