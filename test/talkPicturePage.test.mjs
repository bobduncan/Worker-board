// B167: Ctrl+V in "Talk to Main" takes the picture on the clipboard; words stay words, and anything else gets a short
// line. The page's own code is run here, cut out of board.js between its marks. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`${cut('talkmain')}\nObject.assign(this, { pastedTalk })`, page)

const file = type => ({ kind: 'file', type })
const words = { kind: 'string', type: 'text/plain' }

test('a picture on the clipboard is taken; one of another kind, or a file that is no picture, gets a short line', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(page.pastedTalk([file(type)]).take.type, type)
  // A picture copied in a browser often comes with its address as HTML: the picture is what was meant.
  assert.equal(page.pastedTalk([{ kind: 'string', type: 'text/html' }, file('image/png')]).take.type, 'image/png')
  assert.equal(page.pastedTalk([file('image/gif')]).problem, 'Only a PNG, JPEG or WebP picture can be pasted here.')
  assert.equal(page.pastedTalk([file('application/pdf')]).problem, 'That is no picture: only a picture or words can be pasted here.')
  assert.equal(page.pastedTalk([]).problem, 'The clipboard holds no picture.')
  assert.equal(page.pastedTalk(undefined).problem, 'The clipboard holds no picture.')
})

test('words are pasted as words, also when a document brings a picture of them along', () => {
  assert.deepEqual({ ...page.pastedTalk([words]) }, { ignore: true })
  assert.deepEqual({ ...page.pastedTalk([words, file('image/png')]) }, { ignore: true })
})

test('the talk has a place for the picture above the words, a way to take it away, and shows it in the message', () => {
  assert.match(html, /<form class="say main-say" id="main-say">\s*<div class="main-picture" id="main-picture" hidden><\/div>\s*<textarea id="main-text"/)
  assert.match(html, /Ctrl\+V adds a picture/)
  assert.match(script, /'Take the picture away'/)
  assert.match(script, /fetch\('\/api\/talk\/picture'/)
  assert.match(style, /\.main-picture img \{[^}]*max-height: 96px/)
  assert.match(style, /\.talk-picture img \{/)
})
