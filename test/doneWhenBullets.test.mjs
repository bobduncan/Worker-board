// The person, 2026-10-31, on a change brainstorm's goal draft: "this needs to show 'done when' using bullet points". The
// page's reset takes every list's markers away; the draft's Done-when list gets its numbers back.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the goal draft shows its Done-when bullets with their numbers', async () => {
  const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
  const rule = selector => css.match(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  assert.match(rule('.brainstorm-done-when'), /list-style: decimal/)
  assert.match(rule('.brainstorm-done-when li'), /display: list-item/)
  assert.match(rule('.brainstorm-done-when li'), /list-style: decimal/)
})
