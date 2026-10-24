import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// The page shows words from chats, the backlog and the advice file. They must reach it as text only. This is a
// guard on the source, not a proof: it fails when someone reaches for a way to turn a string into HTML or code.
test('the page\'s script has no way to turn text into HTML or code', async () => {
  const script = (await Promise.all(['board.js', 'spending.js'].map(file => readFile(join(PUBLIC, file), 'utf8')))).join('\n')
  for (const risky of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setAttribute(\'style\'', 'srcdoc', 'javascript:']) {
    assert.ok(!script.includes(risky), `board.js uses ${risky}`)
  }
})

test('the page loads only its own script and style sheet, and has no inline code', async () => {
  const page = await readFile(join(PUBLIC, 'index.html'), 'utf8')
  assert.deepEqual([...page.matchAll(/<script\b[^>]*>/g)].map(tag => tag[0]), ['<script src="/spending.js" defer>', '<script src="/board.js" defer>'])
  assert.deepEqual([...page.matchAll(/<link\b[^>]*>/g)].map(tag => tag[0]), ['<link rel="stylesheet" href="/board.css">'])
  assert.ok(!/<style\b|\sstyle=|\son[a-z]+=/i.test(page))
  assert.ok(!/https?:\/\//.test(page))
})
