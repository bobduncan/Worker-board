import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAsk, picturePath } from '../src/asks.mjs'

const ask = extra => JSON.stringify({ id: 'units-pathfinding', from: 'Units', kind: 'input', title: 'Choose pathfinding approach', text: 'Which direction?', at: 5, ...extra })

test('parseAsk reads a question with options and pictures', () => {
  const parsed = parseAsk(ask({
    options: [
      { label: 'Option A: NavMesh', picture: 'art-inbox/pathfinding/a.png', isRecommended: true },
      { label: 'Option B: Custom grid', picture: 'art-inbox\\pathfinding\\b.png' },
    ],
    pictures: ['art-inbox/pathfinding/overview.webp'],
  }))
  assert.deepEqual(parsed, {
    id: 'units-pathfinding', from: 'Units', kind: 'input', title: 'Choose pathfinding approach', text: 'Which direction?', at: 5,
    options: [
      { label: 'Option A: NavMesh', picture: 'art-inbox/pathfinding/a.png', isRecommended: true },
      { label: 'Option B: Custom grid', picture: 'art-inbox/pathfinding/b.png', isRecommended: false },
    ],
    pictures: ['art-inbox/pathfinding/overview.webp'],
    run: null, checks: [], tried: [],
  })
})

test('parseAsk reads a request to verify, with what to check and where it runs', () => {
  const parsed = parseAsk(ask({
    kind: 'verify',
    run: { url: 'http://localhost:5174/?level=bridge', branch: 'feature/player-input', entry: 'features-dev' },
    checks: ['Movement in all 4 directions', 'No jitter on slopes', 7],
  }))
  assert.deepEqual(parsed.run, { url: 'http://localhost:5174/?level=bridge', branch: 'feature/player-input', entry: 'features-dev' })
  assert.deepEqual(parsed.checks, ['Movement in all 4 directions', 'No jitter on slopes'])
})

test('parseAsk reads a call for help, with what was tried', () => {
  const parsed = parseAsk(ask({ kind: 'intervene', tried: ['Restarted the dev server', 'Cleared the cache'] }))
  assert.equal(parsed.kind, 'intervene')
  assert.deepEqual(parsed.tried, ['Restarted the dev server', 'Cleared the cache'])
})

test('parseAsk leaves out an ask that is closed, broken, or of a kind the board does not know', () => {
  assert.equal(parseAsk(ask({ state: 'answered' })), null)
  assert.equal(parseAsk(ask({ state: 'withdrawn' })), null)
  assert.equal(parseAsk(ask({ kind: 'chat' })), null)
  assert.equal(parseAsk(ask({ title: '' })), null)
  assert.equal(parseAsk(ask({ from: 5 })), null)
  assert.equal(parseAsk(ask({ id: '../x' })), null)
  assert.equal(parseAsk('{ broken'), null)
  assert.equal(parseAsk('[]'), null)
  assert.notEqual(parseAsk(ask({ state: 'open' })), null)
})

test('parseAsk links only to a page on this machine', () => {
  const urlOf = url => parseAsk(ask({ kind: 'verify', run: { url } })).run
  assert.equal(urlOf('http://localhost:5174/').url, 'http://localhost:5174/')
  assert.equal(urlOf('http://127.0.0.1:5173/soundboard.html').url, 'http://127.0.0.1:5173/soundboard.html')
  for (const url of ['https://example.com/', 'http://localhost.example.com/', 'http://localhost@example.com/', 'javascript:alert(1)', 'file:///C:/x', '//example.com', 5]) {
    assert.equal(urlOf(url).url, null, String(url))
  }
})

test('parseAsk drops pictures that are not a plain path into a folder, and cuts what is too long', () => {
  const parsed = parseAsk(ask({
    title: 'T'.repeat(500),
    text: 'x'.repeat(9000),
    pictures: ['art-inbox/a.png', '../secret.png', 'C:\\Windows\\x.png', '/etc/x.png', 'art-inbox/../../x.png', 'art-inbox/notes.txt', 'https://example.com/a.png', 7],
    options: Array.from({ length: 20 }, (_, index) => ({ label: `Option ${index}` })),
  }))
  assert.deepEqual(parsed.pictures, ['art-inbox/a.png'])
  assert.equal(parsed.title.length, 160)
  assert.equal(parsed.text.length, 4000)
  assert.equal(parsed.options.length, 6)
})

test('picturePath: a relative path to a picture, with forward slashes, or null', () => {
  assert.equal(picturePath('art-inbox\\red-mage\\walk.PNG'), 'art-inbox/red-mage/walk.PNG')
  assert.equal(picturePath('art-inbox/a b/c.webp'), 'art-inbox/a b/c.webp')
  for (const bad of ['', 'a.png/..', './a.png', 'art-inbox//a.png', 'art-inbox/a.svg', 'art-inbox/a.png\0', 'art-inbox/con:a.png', null]) {
    assert.equal(picturePath(bad), null, String(bad))
  }
})
