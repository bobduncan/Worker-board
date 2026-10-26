// B208: the board on a phone is made for thumbs (piece 3 of PHONE-PLAN.md): every button and field at least 44 px
// high, an answer box that grows as one types, a picture the full width of the screen that can be pinched; a tap on
// the picture keeps it open, a tap beside it closes it. The wide view is as it was.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const phone = style.slice(style.indexOf('/* B208:'))

test('on a phone: 44 px buttons and fields, an answer box that grows, a picture the full width to pinch', () => {
  assert.match(phone, /@media \(max-width: 600px\) \{\n\s+button, select, summary, input\[type="text"\], input\[type="search"\] \{ min-height: 44px; \}/)
  assert.match(phone, /\.icon-button \{ width: 44px; height: 44px;/)
  assert.match(phone, /textarea \{ field-sizing: content; min-height: 88px; max-height: 40vh; \}/)
  assert.match(phone, /\.lightbox img \{ width: 100vw;[^}]*touch-action: pan-x pan-y pinch-zoom; \}/)
})

test('the page grows an answer box where the browser cannot, and a tap on a picture on a phone keeps it open', () => {
  assert.match(script, /const PHONE = matchMedia\('\(max-width: 600px\)'\)/)
  assert.match(script, /if \(PHONE\.matches\) \{\n\s+if \(event\.target === image\) return\n\s+return \$\('lightbox'\)\.close\(\)/)
  assert.match(script, /if \(!CSS\.supports\('field-sizing', 'content'\)\) \{\n\s+document\.addEventListener\('input', event => \{/)
})
