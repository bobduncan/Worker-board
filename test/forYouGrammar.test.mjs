// B417 (robustness page, place 6): the one grammar of a chat's "For you" block. Before it, three readers parsed the block
// three ways: an item written `**Answer**:` (colon outside the bold) was a question to `asksAtEnd` and no item to
// `parseHandover`. Made-up samples only. The first group is the mod's old reader's tests (hooks/foryou.test.ts, B317),
// moved here with the reader; the rest pin the one grammar against every reader that uses it.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ITEMS_CHARS, asksAtEnd, blockOf, forYouAsks, inlineOptions, itemHead, optionOf } from '../src/forYouGrammar.mjs'
import { parseHandover } from '../src/handover.mjs'

const CLOSING = ['', '---', '', '```diff', '  Prompt: the strip', '  Who:    Game - Units', '- Done:   partly, waiting for your answer', '```']
const answer = (...block) => ['The strip is drawn.', '', ...block, ...CLOSING].join('\n')
const items = (...block) => forYouAsks(answer(...block)).items

test('a look with two pictures and a play link: kind look, the advice, the paths, the play settings', () => {
  assert.deepEqual(items(
    '> **For you**',
    '> 1. **Answer:** Is the strip readable now? I advise yes.',
    '>    [See the picture: thin](http://127.0.0.1:4310/#picture=art-inbox/strip/thin.png)',
    '>    [See the picture: thick](http://127.0.0.1:4310/#picture=art-inbox/strip/thick.png)',
    '>    [Play it: the shop](http://127.0.0.1:4310/#play=b1-strip&screen=shop)',
  ), [{
    n: 1, kind: 'look', text: ['Is the strip readable now? I advise yes.'], options: [], advice: 'yes',
    pictures: ['art-inbox/strip/thin.png', 'art-inbox/strip/thick.png'], play: 'b1-strip&screen=shop', ref: null,
  }])
})

test('a decide with its advice stopped at the comma; a do; numbered as written', () => {
  const read = items(
    '> **For you**',
    '> 1. **Answer:** Keep the golem as it is? I advise yes, as you chose at 13:41. Say "full art" and I make it a step.',
    '> 2. **Do:** Restart the app from its icon.',
  )
  assert.deepEqual(read.map(one => [one.n, one.kind, one.advice, one.options]), [[1, 'decide', 'yes', []], [2, 'do', '', []]])
  assert.deepEqual(read[1].text, ['Restart the app from its icon.'])
})

test('options: lettered with words, letters only, lines under the item; an answer with a picture and options stays a decide', () => {
  const [words] = items('> **For you**', '> 1. **Answer:** Which strip: A thin, B thick or C none? I advise B.')
  assert.deepEqual([words.options, words.advice], [['A thin', 'B thick', 'C none'], 'B'])
  const [semi] = items('> **For you**', '> 1. **Answer:** A keep the old menu or B the new one; I advise A')
  assert.deepEqual([semi.options, semi.advice], [['A keep the old menu', 'B the new one'], 'A'])
  const [letters] = items('> **For you**', '> 1. **Answer:** A, B or C? I advise C.', '>    [See the picture: all three](http://127.0.0.1:4310/#picture=art-inbox/strip/abc.png)')
  assert.deepEqual([letters.kind, letters.options, letters.pictures], ['decide', ['A', 'B', 'C'], ['art-inbox/strip/abc.png']])
  const [lines] = items('> **For you**', '> 1. **Answer:** Which colour?', '>    - **A:** red', '>    - **B:** blue', '>    I advise B.')
  assert.deepEqual([lines.options, lines.advice, lines.text], [['A red', 'B blue'], 'B', ['Which colour?', 'I advise B.']])
})

test('no clear options: none; an article "A" is no option', () => {
  assert.deepEqual(items('> **For you**', '> 1. **Answer:** Box or yew for the bow?')[0].options, [])
  assert.deepEqual(items('> **For you**', '> 1. **Answer:** A new menu, or the old one?')[0].options, [])
})

test('an item the work tool wrote carries its ask id; a title written a little off still counts', () => {
  const read = items('> **For you:**', '> 1. **Answer:** Thin or thick? A thin or B thick; I advise B (Q4, decide, blocks B1)', '> 2. Answer: pond next?')
  assert.deepEqual(read.map(one => [one.ref, one.kind, one.options]), [['Q4', 'decide', ['A thin', 'B thick']], [null, 'decide', []]])
})

test('nothing when the block is not the last part, is quoted earlier, or there is none', () => {
  assert.deepEqual(forYouAsks('All done.\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```'), { items: [], total: 0 })
  assert.deepEqual(forYouAsks(['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'You answered A.'].join('\n')), { items: [], total: 0 })
  assert.deepEqual(forYouAsks(''), { items: [], total: 0 })
  assert.deepEqual(forYouAsks(null), { items: [], total: 0 })
  // Its own block after a quoted one: only its own.
  const both = ['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'Planted A.', '', '> **For you**', '> 1. **Answer:** Pond next? I advise yes.'].join('\n')
  assert.deepEqual(forYouAsks(both).items.map(one => one.text[0]), ['Pond next? I advise yes.'])
})

test('a link that leaves the board or climbs out of its folder is not taken; nine items at most; what fits the call', () => {
  const [item] = items('> **For you**', '> 1. **Answer:** Fine?', '>    [See the picture: x](https://example.com/#picture=a/b.png)', '>    [See the picture: y](http://127.0.0.1:4310/#picture=a/../../b.png)')
  assert.deepEqual([item.kind, item.pictures], ['decide', []])
  const many = Array.from({ length: 12 }, (_, i) => `> ${i + 1}. **Do:** step ${i + 1}`)
  const nine = forYouAsks(answer('> **For you**', ...many))
  assert.deepEqual([nine.items.length, nine.total], [9, 12])
  // No more than fit the board's call at the turn's end; `total` still says how many the block holds.
  const long = Array.from({ length: 9 }, (_, i) => `> ${i + 1}. **Answer:** ${'word '.repeat(190)}?\n>    ${'more '.repeat(190)}`)
  const kept = forYouAsks(answer('> **For you**', ...long))
  assert.deepEqual([kept.items.length > 0, kept.items.length < 9, JSON.stringify(kept.items).length <= ITEMS_CHARS, kept.total], [true, true, true, 9])
})

test('a look with Context, Problem, Approve and Send back lines keeps them as text lines of the item, never as options', () => {
  const [look] = items(
    '> **For you**',
    '> 1. **Answer:** Keep the Cavern 2 corridor as it is, or reopen it later? I advise keeping it.',
    '>    Context: The new one-way stairs rule (B1072) changed World 1\'s Cavern 2',
    '>    Problem: 3 squares of its west corridor can no longer be reached',
    '>    **Approve:** keep it as it is for now',
    '>    Send back: a later step makes the corridor reachable again',
    '>    [See the picture: Cavern 2](http://127.0.0.1:4310/#picture=art-inbox/b1072/cavern2.png)',
    '>    [Play it: Cavern 2](http://127.0.0.1:4310/#play=main&screen=sandbox)',
  )
  assert.deepEqual(look.options, [])
  assert.equal(look.kind, 'look')
  assert.deepEqual(look.text.slice(1), [
    'Context: The new one-way stairs rule (B1072) changed World 1\'s Cavern 2',
    'Problem: 3 squares of its west corridor can no longer be reached',
    '**Approve:** keep it as it is for now',
    'Send back: a later step makes the corridor reachable again',
  ])
})

// B417: the forms of one item, strict and lenient, read the same by every reader.
const FORMS = [
  '**Answer:** Which strip, A thin or B thick? I advise B.',
  '**Answer**: Which strip, A thin or B thick? I advise B.',
  'Answer: Which strip, A thin or B thick? I advise B.',
  'Which strip, A thin or B thick? I advise B.',
]

for (const form of FORMS) {
  test(`one item, written "${form.slice(0, 14)}": the same question to asksAtEnd, parseHandover and the asks`, () => {
    const text = answer('> **For you**', `> 1. ${form}`)
    assert.equal(asksAtEnd(text), true)
    const [asked] = forYouAsks(text).items
    assert.deepEqual([asked.kind, asked.text[0], asked.advice, asked.options], ['decide', 'Which strip, A thin or B thick? I advise B.', 'B', ['A thin', 'B thick']])
    const [shown] = parseHandover(text).items
    assert.deepEqual([shown.n, shown.kind, shown.ask, shown.options.map(one => one.key)], [1, 'answer', 'Which strip, A thin or B thick? I advise B.', ['A', 'B']])
  })
}

test('the reproduced case: **Answer**: with the colon outside the bold is an item to every reader', () => {
  const text = answer('> **For you**', '> 1. **Answer**: Look at the menu?', '> 2. **Do**: restart it.')
  assert.equal(asksAtEnd(text), true)
  assert.deepEqual(parseHandover(text).items.map(one => [one.n, one.kind, one.ask]), [[1, 'answer', 'Look at the menu?'], [2, 'do', 'restart it.']])
  assert.deepEqual(forYouAsks(text).items.map(one => [one.n, one.kind, one.text[0]]), [[1, 'decide', 'Look at the menu?'], [2, 'do', 'restart it.']])
})

test('the title is read a little off too, by every reader; a block quoted earlier is not the answer\'s own', () => {
  for (const title of ['> **For you**', '> **For you:**', '> For you', '> **Needs your attention**', '> FOR YOU:']) {
    const text = answer(title, '> 1. **Answer:** Pond next?')
    assert.equal(asksAtEnd(text), true, title)
    assert.equal(parseHandover(text).items.length, 1, title)
    assert.equal(forYouAsks(text).items.length, 1, title)
  }
  const quoted = ['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'You answered A.'].join('\n')
  assert.equal(asksAtEnd(quoted), false)
  assert.equal(blockOf(quoted).atEnd, false)
  assert.deepEqual(forYouAsks(quoted).items, [])
})

test('an item\'s parts: its head, a choice under it, and the letters a question names', () => {
  assert.deepEqual(itemHead('2) **Do**: look at it'), { n: 2, word: 'do', words: 'look at it' })
  assert.deepEqual(itemHead('3. Plain words'), { n: 3, word: null, words: 'Plain words' })
  assert.equal(itemHead('Answered already: yes'), null)
  assert.equal(itemHead('3. Answered already: yes').word, null)
  assert.deepEqual(optionOf('- **A:** red'), { key: 'A', text: 'red' })
  assert.deepEqual(optionOf('- (B) blue'), { key: 'B', text: 'blue' })
  assert.deepEqual(optionOf('* C) green'), { key: 'C', text: 'green' })
  assert.equal(optionOf('- Apple pie'), null)
  assert.deepEqual(inlineOptions('A, B or C?'), [{ key: 'A', text: null }, { key: 'B', text: null }, { key: 'C', text: null }])
  assert.deepEqual(inlineOptions('Box or yew?'), [])
})

test('what the window shows: options with their words, the links under an item, the advice as its note', () => {
  const text = answer('> **For you**', '> 1. **Answer**: Which colour?', '>    - **A:** red', '>    - **B:** blue', '>    I advise B.', '>    [See the picture: both](http://127.0.0.1:4310/#picture=art-inbox/c/both.png)')
  const [shown] = parseHandover(text).items
  assert.deepEqual(shown.options, [{ key: 'A', text: 'red' }, { key: 'B', text: 'blue' }])
  assert.equal(shown.note, 'I advise B.')
  assert.deepEqual(shown.links, [{ kind: 'picture', label: 'See the picture: both', path: 'art-inbox/c/both.png' }])
})
