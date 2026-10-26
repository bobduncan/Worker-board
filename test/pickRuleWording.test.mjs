// B698 (2026-10-26): the rule on which steps wait for the person's pick stands once, in the comment above `readyList`
// (src/work/handOut.mjs). Every sentence in the role pages and the docs that speaks of it must point there instead of
// telling its own version. Reads the files; a sentence only about the "Add to queue" button does not count.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const files = [...readdirSync(new URL('roles/', root)).filter(name => name.endsWith('.md')).map(name => `roles/${name}`), 'DESIGN.md', 'BOARD.md']

// A block is a paragraph or list item; its sentences end at ". " or "; ".
export function sentencesOf(text) {
  const blocks = text.split(/\r?\n\s*\r?\n|\r?\n(?=\s*(?:[-*|]|\d+\.)\s)/)
  return blocks.flatMap(block => block.replace(/\s*\r?\n\s*/g, ' ').split(/(?<=[.;])\s+(?=[A-Z(`"])/))
}

// Speaks of who waits for the person's pick, or goes out by itself.
const SPEAKS = /(outside|beyond) the focus|(step|task) of another goal|unrelated goal|waits? (until|for) the (user|person)(’|')s (pick|"?add to queue|pin)|(user|person) adds? it to the queue|\bpins? it\b|focus goal's tasks and pinned/i

export const offenders = text => sentencesOf(text).filter(one => SPEAKS.test(one) && !one.includes('readyList'))

test('every sentence on who waits for the pick points to the readyList comment', () => {
  for (const file of files) {
    const found = offenders(readFileSync(new URL(file, root), 'utf8'))
    assert.deepEqual(found, [], `${file}: ${found.join(' | ')}`)
  }
})

test('the guard bites: the old partner sentence trips it, an Add to queue button sentence does not', () => {
  const old = 'The board gives them to the workers (a step of another goal waits until the user adds it to the queue on the Backlog tab).'
  assert.equal(offenders(old).length, 1)
  assert.equal(offenders('Refined (each with **Add to queue**, or why it waits).').length, 0)
})
