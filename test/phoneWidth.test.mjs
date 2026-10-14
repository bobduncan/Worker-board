// B206: the board fits a phone's width (piece 1 of PHONE-PLAN.md): nothing cut off or scrolling sideways, a window
// fills the screen. The wide view stays as it was.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const phone = style.slice(style.indexOf('/* B206:'))

test('the tabs have a box of their own that only counts on a narrow screen, where they scroll sideways', () => {
  const nav = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'))
  const list = nav.slice(nav.indexOf('<div class="tab-list">'), nav.indexOf('</div>'))
  for (const tab of ['overview', 'advice', 'coordinate', 'design']) assert.ok(list.includes(`data-tab="${tab}"`), tab)
  assert.match(phone, /^\.tab-list \{ display: contents; \}/m)
  assert.match(phone, /@media \(max-width: 760px\) \{\n\s+\.tabs \{ flex-wrap: wrap;/)
  assert.match(phone, /\.tab-list \{ display: flex; flex: 1 0 100%;[^}]*overflow-x: auto;/)
})

test('the limits box stacks, a worker\'s time has two columns, and a window fills a phone\'s screen', () => {
  assert.match(phone, /\.limit, \.limit\.is-small \{ width: auto; flex: 1 1 130px; min-width: 0; \}/)
  assert.match(phone, /grid-template-areas: "who who menu" "what eta eta" "progress progress progress" "queue queue queue";/)
  assert.match(phone, /@media \(max-width: 600px\) \{[\s\S]*\.details \{ width: 100vw; max-width: 100vw; min-height: 100dvh; max-height: 100dvh; margin: 0;/)
})
