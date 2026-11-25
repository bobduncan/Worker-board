import { describe, expect, test } from 'claude-code/testing'

import { TAIL_CHARS, blockAsksLine, forYouTail, leftOutLine } from './foryou'

describe('B317, B417: the "For you" block at the end of an answer: the mod reads none of it, it sends the tail', () => {
  test('an answer that names a block goes whole as its tail, in whatever form it is written; one that names none sends nothing', () => {
    const block = 'Done.\n\n> **For you**\n> 1. **Answer**: sheet A or B?\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```'
    expect(forYouTail(block)).toBe(block)
    expect(forYouTail(block.replace('**For you**', 'Needs your attention'))).toContain('Needs your attention')
    expect(forYouTail('All done.\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```')).toBe('')
    expect(forYouTail('')).toBe('')
    expect(forYouTail(null)).toBe('')
    expect(forYouTail({ text: 'For you' })).toBe('')
  })

  test('a long answer sends its last characters only: the block stands at the end, and the call takes 16 KB', () => {
    const long = `${'word '.repeat(5000)}\n\n> **For you**\n> 1. **Answer:** Pond next? I advise yes.`
    const tail = forYouTail(long)
    expect(tail.length).toBe(TAIL_CHARS)
    expect(tail.endsWith('> 1. **Answer:** Pond next? I advise yes.')).toBe(true)
    expect(JSON.stringify({ forYouText: tail }).length).toBeLessThan(16 * 1024)
  })

  test('the line beside the next prompt names the asks filed from the block, so the chat can close one answered in the chat', () => {
    expect(blockAsksLine(['Q7', 'x', 8, 'Q9'])).toBe('Filed on the worker board from your last "For you" block: Q7, Q9. The person answers there; if they answer one here in the chat instead, close it with work answered-in-chat <id> and their words.')
    expect(blockAsksLine([])).toBe(null)
    // B480: the items the board left out as asked already are named, so a new question that only looked alike is filed.
    expect(leftOutLine(['"Keep the golem?" asks what Q7 asks', 3, ''])).toBe('Not filed on the worker board from your last "For you" block, as asked already: "Keep the golem?" asks what Q7 asks. If one of them is a new question after all, file it with work ask.')
    expect(leftOutLine([])).toBe(null)
  })
})
