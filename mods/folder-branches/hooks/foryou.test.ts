import { describe, expect, test } from 'claude-code/testing'

import { ITEMS_CHARS, blockAsksLine, forYouItems } from './foryou'

const CLOSING = ['', '---', '', '```diff', '  Prompt: the strip', '  Who:    Game - Units', '- Done:   partly, waiting for your answer', '```']
const answer = (...block: string[]): string => ['The strip is drawn.', '', ...block, ...CLOSING].join('\n')

describe('B317: the "For you" block at the end of an answer, as asks to file', () => {
  test('a look with two pictures and a play link: kind look, the advice, the paths, the play settings', () => {
    const items = forYouItems(answer(
      '> **For you**',
      '> 1. **Answer:** Is the strip readable now? I advise yes.',
      '>    [See the picture: thin](http://127.0.0.1:4310/#picture=art-inbox/strip/thin.png)',
      '>    [See the picture: thick](http://127.0.0.1:4310/#picture=art-inbox/strip/thick.png)',
      '>    [Play it: the shop](http://127.0.0.1:4310/#play=b1-strip&screen=shop)',
    ))
    expect(items).toEqual([{
      n: 1, kind: 'look', text: ['Is the strip readable now? I advise yes.'], options: [], advice: 'yes',
      pictures: ['art-inbox/strip/thin.png', 'art-inbox/strip/thick.png'], play: 'b1-strip&screen=shop', ref: null,
    }])
  })

  test('a decide with its advice stopped at the comma; a do; numbered as written', () => {
    const items = forYouItems(answer(
      '> **For you**',
      '> 1. **Answer:** Keep the golem as it is? I advise yes, as you chose at 13:41. Say "full art" and I make it a step.',
      '> 2. **Do:** Restart the app from its icon.',
    ))
    expect(items.map(one => [one.n, one.kind, one.advice, one.options])).toEqual([[1, 'decide', 'yes', []], [2, 'do', '', []]])
    expect(items[1].text).toEqual(['Restart the app from its icon.'])
  })

  test('options: lettered with words, letters only, lines under the item; an answer with a picture and options stays a decide', () => {
    const [words] = forYouItems(answer('> **For you**', '> 1. **Answer:** Which strip: A thin, B thick or C none? I advise B.'))
    expect([words.options, words.advice]).toEqual([['A thin', 'B thick', 'C none'], 'B'])
    const [semi] = forYouItems(answer('> **For you**', '> 1. **Answer:** A keep the old menu or B the new one; I advise A'))
    expect([semi.options, semi.advice]).toEqual([['A keep the old menu', 'B the new one'], 'A'])
    const [letters] = forYouItems(answer('> **For you**', '> 1. **Answer:** A, B or C? I advise C.', '>    [See the picture: all three](http://127.0.0.1:4310/#picture=art-inbox/strip/abc.png)'))
    expect([letters.kind, letters.options, letters.pictures]).toEqual(['decide', ['A', 'B', 'C'], ['art-inbox/strip/abc.png']])
    const [lines] = forYouItems(answer('> **For you**', '> 1. **Answer:** Which colour?', '>    - **A:** red', '>    - **B:** blue', '>    I advise B.'))
    expect([lines.options, lines.advice, lines.text]).toEqual([['A red', 'B blue'], 'B', ['Which colour?', 'I advise B.']])
  })

  test('no clear options: none; an article "A" is no option', () => {
    expect(forYouItems(answer('> **For you**', '> 1. **Answer:** Box or yew for the bow?'))[0].options).toEqual([])
    expect(forYouItems(answer('> **For you**', '> 1. **Answer:** A new menu, or the old one?'))[0].options).toEqual([])
  })

  test('an item the work tool wrote carries its ask id; a title written a little off still counts', () => {
    const items = forYouItems(answer('> **For you:**', '> 1. **Answer:** Thin or thick? A thin or B thick; I advise B (Q4, decide, blocks B1)', '> 2. Answer: pond next?'))
    expect(items.map(one => [one.ref, one.kind, one.options])).toEqual([['Q4', 'decide', ['A thin', 'B thick']], [null, 'decide', []]])
  })

  test('nothing when the block is not the last part, is quoted earlier, or there is none', () => {
    expect(forYouItems('All done.\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```')).toEqual([])
    expect(forYouItems(['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'You answered A.'].join('\n'))).toEqual([])
    expect(forYouItems('')).toEqual([])
    // Its own block after a quoted one: only its own.
    const both = ['Digger asked:', '', '> **For you**', '> 1. **Answer:** Bed A or B?', '', 'Planted A.', '', '> **For you**', '> 1. **Answer:** Pond next? I advise yes.'].join('\n')
    expect(forYouItems(both).map(one => one.text[0])).toEqual(['Pond next? I advise yes.'])
  })

  test('a link that leaves the board or climbs out of its folder is not taken; nine items at most', () => {
    const [item] = forYouItems(answer('> **For you**', '> 1. **Answer:** Fine?', '>    [See the picture: x](https://example.com/#picture=a/b.png)', '>    [See the picture: y](http://127.0.0.1:4310/#picture=a/../../b.png)'))
    expect([item.kind, item.pictures]).toEqual(['decide', []])
    const many = Array.from({ length: 12 }, (_, i) => `> ${i + 1}. **Do:** step ${i + 1}`)
    expect(forYouItems(answer('> **For you**', ...many)).length).toBe(9)
    // No more than fit the board's call at the turn's end.
    const long = Array.from({ length: 9 }, (_, i) => `> ${i + 1}. **Answer:** ${'word '.repeat(190)}?
>    ${'more '.repeat(190)}`)
    const kept = forYouItems(answer('> **For you**', ...long))
    expect([kept.length > 0, kept.length < 9, JSON.stringify(kept).length <= ITEMS_CHARS]).toEqual([true, true, true])
  })

  test('the line beside the next prompt names the asks filed from the block, so the chat can close one answered in the chat', () => {
    expect(blockAsksLine(['Q7', 'x', 8, 'Q9'])).toBe('Filed on the worker board from your last "For you" block: Q7, Q9. The person answers there; if they answer one here in the chat instead, close it with work answered-in-chat <id> and their words.')
    expect(blockAsksLine([])).toBe(null)
  })
})
