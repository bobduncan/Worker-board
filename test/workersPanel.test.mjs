// B159: the Overview's Workers panel after the design agreed on the Design tab (art-inbox/ideas/any-improvement-to-
// this/v2.png): one panel with its name and "+ Add worker" on top, the columns named, slim rows, and each worker's
// icon in the colour of its state.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')

test('the lanes sit in one panel with its name, the add button and the columns named as in the design', () => {
  const panel = html.slice(html.indexOf('id="workers-panel"'), html.indexOf('id="lanes"'))
  assert.match(panel, /<h2 id="workers-title">Workers<\/h2>/)
  assert.match(panel, /id="workers-add"/)
  assert.deepEqual([...panel.matchAll(/<span>([^<]*)<\/span>/g)].map(found => found[1]), ['Worker', 'Current task', 'Progress', 'Est. time', 'Queue', ''])
  // The other parts of the Overview stay where they are.
  assert.ok(html.indexOf('id="workers-panel"') < html.indexOf('id="today"'))
})

test('each worker\'s icon takes the colour of its state, the one its pill names', () => {
  assert.match(script, /el\('span', `worker-icon is-\$\{lane\.isLeftover \? 'leftover' : lane\.state\}`\)/)
  assert.match(script, /sign\.append\(icon\('chat'\)\)/)
  const colours = { working: 'var(--working)', waiting: 'var(--waiting)', free: '#7fb0ff', suspended: 'var(--suspended)', interrupted: 'var(--warn)' }
  for (const [state, colour] of Object.entries(colours)) {
    assert.ok(style.includes(`.worker-icon.is-${state} { color: ${colour}; }`), state)
    assert.match(style, new RegExp(`\\.workers-panel \\.pill\\.is-${state} \\{[^}]*color: ${colour.replace(/[()-]/g, '\\$&')}`), state)
  }
})

test('a row: the worker, its task, its progress, its time, its queue with its length, and "⋯" for the rest', () => {
  assert.match(script, /row\.append\(who, what, progress, drawEta\(lane, state\.readAt\), queue, menu\)/)
  assert.match(script, /`Queue \(\$\{lane\.queue\.length\}\)`, lane\.queue\[0\]\.id/)
  // Remove sits in the part "⋯" unfolds; its warning still shows under the row.
  assert.match(script, /more\.prepend\(bar\)/)
  assert.match(script, /closest\('\.queue-head, \.lane-menu'\)/)
  assert.match(style, /grid-template-areas: "who what progress eta queue menu"/)
})
