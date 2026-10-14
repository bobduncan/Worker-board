// B180: the Backlog tab's head after "For you" became "Needs your attention": the filters, the search and the two
// checkboxes fit one line at the board's usual width, and at a narrow one the search and the checkboxes move to the
// next line as one group, never one checkbox alone.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')

test('the search and both checkboxes are one group at the end of the head; the two checkboxes are one group in it', () => {
  const top = html.slice(html.indexOf('class="coordinate-top"'), html.indexOf('</header>', html.indexOf('class="coordinate-top"')))
  const tools = top.slice(top.indexOf('class="coordinate-tools"'))
  assert.ok(top.indexOf('id="coordinate-filters"') < top.indexOf('class="coordinate-tools"'))
  for (const id of ['coordinate-find', 'coordinate-done', 'coordinate-one']) assert.ok(tools.includes(`id="${id}"`), id)
  const checks = tools.slice(tools.indexOf('class="coordinate-checks"'))
  assert.ok(checks.includes('id="coordinate-done"') && checks.includes('id="coordinate-one"'))
  assert.ok(!top.includes('class="grow"'), 'the group keeps itself at the end')
})

test('the group moves down whole, the checkboxes stay side by side, and a step\'s state stays on one line', () => {
  assert.match(style, /\.coordinate-tools \{ margin-left: auto; display: flex; flex-wrap: wrap;/)
  assert.match(style, /\.coordinate-checks \{ display: flex; align-items: center; gap: 12px; \}/)
  assert.match(style, /\.check \{[^}]*white-space: nowrap/)
  assert.match(style, /#coordinate-find \{ width: 150px;/)
  assert.match(style, /\.step-state \{ justify-self: start; white-space: nowrap;/)
})
