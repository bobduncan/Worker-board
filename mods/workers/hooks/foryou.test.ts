import { describe, expect, test } from 'claude-code/testing'

import { TAIL_CHARS, blockAsksLine, forYouTail, isForYouCut, leftOutLine } from './foryou'

describe('B317, B417: the "For you" block at the end of an answer: the mod reads none of it, it sends the tail', () => {
  test('an answer that names a block goes from its title on, in whatever form it is written; one that names none sends nothing', () => {
    const block = 'Done.\n\n> **For you**\n> 1. **Answer**: sheet A or B?\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```'
    expect(forYouTail(block)).toBe(block.slice(block.indexOf('> **For you**')))
    expect(forYouTail(block.replace('**For you**', 'Needs your attention'))).toContain('Needs your attention')
    expect(forYouTail('All done.\n\n---\n\n```diff\n  Prompt: x\n+ Done:   yes\n```')).toBe('')
    expect(forYouTail('')).toBe('')
    expect(forYouTail(null)).toBe('')
    expect(forYouTail({ text: 'For you' })).toBe('')
    // Words that only mention it are no title.
    expect(forYouTail('See the For you block of the board.')).toBe('')
  })

  test('a long answer sends its block from the title on, so the title is never cut off; the last title only', () => {
    const long = `${'word '.repeat(5000)}\n\n> **For you**\n> 1. **Answer:** Pond next? I advise yes.`
    expect(forYouTail(long)).toBe('> **For you**\n> 1. **Answer:** Pond next? I advise yes.')
    expect(isForYouCut(long)).toBe(false)
    expect(forYouTail('> **For you**\n> 1. **Answer:** Old?\n\nDone.\n\n> **For you**\n> 1. **Answer:** New?')).toBe('> **For you**\n> 1. **Answer:** New?')
  })

  test('a block too long to send whole is cut and said so: the chat asked, so it is never cleared', () => {
    const items = Array.from({ length: 9 }, (_one, i) => `> ${i + 1}. Look at the sheet ${i + 1}: ${'word '.repeat(190)}`).join('\n')
    const long = `In.\n\n> **For you**\n${items}\n\n---\n\n\`\`\`diff\n  Prompt: x\n+ Done:   yes\n\`\`\``
    expect(forYouTail(long).length).toBe(TAIL_CHARS)
    expect(forYouTail(long).startsWith('> **For you**')).toBe(true)
    expect(isForYouCut(long)).toBe(true)
    expect(isForYouCut('no block')).toBe(false)
    expect(JSON.stringify({ forYouText: forYouTail(long) }).length).toBeLessThan(16 * 1024)
  })

  test('the line beside the next prompt names the asks filed from the block, so the chat can close one answered in the chat', () => {
    expect(blockAsksLine(['Q7', 'x', 8, 'Q9'])).toBe('Filed on the worker board from your last "For you" block: Q7, Q9. The person answers there; if they answer one here in the chat instead, close it with work answered-in-chat <id> and their words.')
    expect(blockAsksLine([])).toBe(null)
    // B480: the items the board left out as asked already are named, so a new question that only looked alike is filed.
    expect(leftOutLine(['"Keep the golem?" asks what Q7 asks', 3, ''])).toBe('Not filed on the worker board from your last "For you" block, as asked already: "Keep the golem?" asks what Q7 asks. If one of them is a new question after all, file it with work ask.')
    expect(leftOutLine([])).toBe(null)
  })
})
