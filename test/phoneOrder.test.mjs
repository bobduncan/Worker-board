// B207: on a phone Needs your attention comes first, the timeline and the folders are folded away under a button, and
// the tabs are a bar at the bottom ("Today", "Advisor", "Backlog", without Design). The wide view is as it was.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const phone = style.slice(style.indexOf('/* B207:'))

test('each tab has its short name for the bar beside its usual one; only the short one shows on a phone', () => {
  assert.match(html, /data-tab="overview"><span class="tab-long">Overview<\/span><span class="tab-short">Today<\/span><\/button>/)
  // B195: the tab is called Advisor in both widths; Focus since Focus 1 (spec 2026-10-18).
  assert.match(html, /data-tab="advice"><span class="tab-long">Focus<\/span><span class="tab-short">Focus<\/span><\/button>/)
  assert.match(phone, /^\.tab-short, \.phone-more \{ display: none; \}/m)
  assert.match(phone, /\.tab-long, \.tab-list \.tab\[data-tab="design"\] \{ display: none; \}/)
  assert.match(phone, /\.tab-list \{ position: fixed; left: 0; right: 0; bottom: 0;/)
})

test('Needs your attention first; the timeline and the folders folded away until the button shows them', () => {
  assert.match(phone, /#view-overview:not\(\[hidden\]\) \{ display: flex; flex-direction: column; \}/)
  assert.match(phone, /#view-overview \.inbox \{ order: -1;/)
  assert.match(phone, /#view-overview:not\(\.shows-more\) #today, #view-overview:not\(\.shows-more\) #folders \{ display: none; \}/)
  assert.ok(html.indexOf('id="phone-more"') < html.indexOf('id="today"'))
  assert.match(script, /const shows = \$\('view-overview'\)\.classList\.toggle\('shows-more'\)/)
  assert.match(phone, /\.block-line \.step-state, \.block-line \.block-why \{ grid-column: 2; grid-row: 2;/)
})
