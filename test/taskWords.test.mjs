// Redesign Part 2, its words (spec 2026-10-24, "Words"): a task is a backlog item a worker picks up and does; a step is a
// part of a task, as in its progress "1/5 Read step and code". The board's code keeps calling a task a "step"; what the
// person sees says "task" (the person: "low prio but sure. lets be consistent."). A guard on the page's words: the text
// of index.html and every string literal the page's script draws with `el(` hold no "step" or "steps" but in the
// progress sense (the allowlist below). The words typed into chats (roles/protocol.md) and the code's names stay.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { forYouBlock } from '../src/work/api.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8')

/** The string literals in the arguments of every `el(` call of the page's script, with their line. */
function elLiterals(source) {
  const found = []
  let at = 0
  while ((at = source.indexOf('el(', at)) >= 0) {
    if (/[\w$.]/.test(source[at - 1] ?? '')) {
      at += 3
      continue
    }
    let depth = 0
    let quote = null
    let start = -1
    let i = at + 2
    for (; i < source.length; i += 1) {
      const c = source[i]
      if (quote !== null) {
        if (c === '\\') i += 1
        else if (c === quote) {
          found.push({ line: source.slice(0, at).split('\n').length, text: source.slice(start, i + 1) })
          quote = null
        }
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c
        start = i
      } else if (c === '(') depth += 1
      else if (c === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    at = i
  }
  return found
}

/** A literal as the person reads it: a template's `${...}` parts (code) left out. */
function shown(text) {
  let out = ''
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '$' && text[i + 1] === '{') {
      depth += 1
      i += 1
    } else if (depth > 0 && text[i] === '{') depth += 1
    else if (depth > 0 && text[i] === '}') depth -= 1
    else if (depth === 0) out += text[i]
  }
  return out
}
/** "step" or "steps" as a word: not a part of a class name or a name ("step-row", "goal-steps", "stepId"). */
const STEP_WORD = /(?<![\w-])steps?(?![\w-])/i
/**
 * The progress sense of "step": a part of something, as in a task's plan ("no steps given", "no steps and no time"),
 * the Vision tab's own steps ("on step 4", "in the steps' order") and the way to a milestone ("Click a step").
 */
const ALLOWED = [
  /^'no steps given'$/,
  /no topic, no steps and no time/,
  /\bon step \d\b/,
  /in the steps\\' order/,
  /the steps show them once it writes the page/,
  /Click a step to see its items/,
  /Nothing is listed for this step yet/,
]
const isAllowed = text => ALLOWED.some(pattern => pattern.test(text))

test('the page draws no "step" for a task: every string literal it draws with el( says task, but the progress sense', () => {
  const offenders = elLiterals(script).filter(one => STEP_WORD.test(shown(one.text)) && !isAllowed(one.text))
  assert.deepEqual(offenders.map(one => `${one.line}: ${one.text}`), [])
})

test('the page\'s HTML says task, never step, in what the person reads', () => {
  const words = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ')
  const lines = words.split('\n').map(line => line.trim()).filter(line => /\bsteps?\b/i.test(line))
  assert.deepEqual(lines, [])
})

test('the For you block of an ask under a task says "task B12"', () => {
  const block = forYouBlock({ id: 'Q3', of: 'B12', kind: 'decide', title: 'Thin or thick?' })
  assert.match(block, /task B12/)
  assert.doesNotMatch(block, /step B12/)
})
