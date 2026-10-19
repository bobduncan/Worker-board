// B348: the help tour (G26, the person's brainstorm of 2026-10-18): a ? button top right on every tab opens six cards,
// each with its painting (B347) and one or two plain lines; the tour also opens by itself the first time the board
// opens, and the board remembers that you saw it. Back, Next, dots, and a close or Escape at any time; the last card's
// button says Done. On a phone one card fills the screen.

import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('help')}\nObject.assign(this, { HELP_CARDS, helpMove, helpView, helpOpensAtStart })`, page)
const cards = [...page.HELP_CARDS]

test('the page\'s script as a whole has no syntax error (the tests here run parts of it only)', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'board.js' }))
})

test('six cards, in the order of the brainstorm, each with its painting and one or two plain lines', async () => {
  // B375: the steps as the person named them: install, Initialise, talk with your partner, Go, the workers build, you check.
  assert.deepEqual(cards.map(card => card.title), ['Install the board', 'Press Initialise', 'Talk it through with your partner',
    'Press Go', 'The workers build', 'You check'])
  assert.deepEqual(cards.map(card => card.picture), ['1-install', '2-initialise', '3-talk', '4-go', '5-workers', '6-check'].map(name => `/help/${name}.svg`))
  for (const card of cards) {
    assert.ok((await stat(join(PUBLIC, card.picture))).size > 1000, card.picture)
    assert.ok(card.lines.length >= 1 && card.lines.length <= 2, card.title)
    for (const line of card.lines) assert.ok(line.length > 20 && line.length <= 140, line)
    // The painting has no words: the picture's own words are said for whoever cannot see it.
    assert.ok(card.alt.length > 20, card.title)
  }
  // The words the board uses for its parts, so the tour points at what is there.
  const words = cards.flatMap(card => card.lines).join(' ')
  for (const part of ['Initialise', 'Focus', 'Needs your attention', 'Go']) assert.ok(words.includes(part), part)
})

test('helpMove: Next and Back step one card and stop at the ends; a dot goes to its card', () => {
  assert.equal(page.helpMove(0, 'next', 6), 1)
  assert.equal(page.helpMove(5, 'next', 6), 5)
  assert.equal(page.helpMove(3, 'back', 6), 2)
  assert.equal(page.helpMove(0, 'back', 6), 0)
  assert.equal(page.helpMove(1, 4, 6), 4)
  assert.equal(page.helpMove(1, 9, 6), 5)
  assert.equal(page.helpMove(1, -2, 6), 0)
})

test('helpView: the card\'s number and title, Back only after the first card, Done on the last, a dot per card', () => {
  const first = page.helpView(0, cards)
  assert.equal(first.heading, '1 · Install the board')
  assert.equal(first.picture, '/help/1-install.svg')
  assert.equal(first.hasBack, false)
  assert.equal(first.next, 'Next')
  assert.deepEqual([...first.dots], [true, false, false, false, false, false])
  const fourth = page.helpView(3, cards)
  assert.equal(fourth.heading, '4 · Press Go')
  assert.equal(fourth.hasBack, true)
  assert.deepEqual([...fourth.dots].map(Number), [0, 0, 0, 1, 0, 0])
  const last = page.helpView(5, cards)
  assert.equal(last.next, 'Done')
  assert.equal(last.hasBack, true)
})

test('helpOpensAtStart: the first time only, on a plain open of the board; never over a link from a chat, nor on the demo', () => {
  assert.equal(page.helpOpensAtStart({ seen: false, hash: '', isDemo: false }), true)
  assert.equal(page.helpOpensAtStart({ seen: false, hash: '#', isDemo: false }), true)
  assert.equal(page.helpOpensAtStart({ seen: true, hash: '', isDemo: false }), false)
  for (const hash of ['#picture=art-inbox/a.png', '#play=main&arena', '#details=B4', '#task=Garden', '#advice/goals/G2', '#design']) {
    assert.equal(page.helpOpensAtStart({ seen: false, hash, isDemo: false }), false, hash)
  }
  assert.equal(page.helpOpensAtStart({ seen: false, hash: '', isDemo: true }), false)
})

test('the page\'s wiring: the address is kept before anything rewrites it, the first read looks once, closing keeps it seen', () => {
  // The address the page was opened with, before the tab shown at the start or a link from a chat rewrites it.
  const kept = script.indexOf('const helpStartHash = location.hash')
  assert.ok(kept > 0 && kept < script.indexOf('show(tabOfAddress(location.hash) ?? \'overview\')'))
  // The first state drawn, then the tour looks whether to open.
  assert.match(script, /const state = await answer\.json\(\)\s+draw\(state\)\s+awaySince = null\s+helpAtStart\(state\)/)
  assert.match(script, /\$\('help'\)\.addEventListener\('close', \(\) => \{\s+try \{ localStorage\.setItem\('help-seen', 'yes'\) \}/)
  // Review: the arrow keys are heard wherever the focus is while the tour is open, and are the browser's with Alt.
  assert.match(script, /document\.addEventListener\('keydown', event => \{\s+if \(!\$\('help'\)\.open \|\| event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey\) return/)
})

test('the ? button stands in the bar of tabs, top right, so it is there on every tab; the tour is a dialog of its own', () => {
  const bar = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>', html.indexOf('<nav class="tabs"')))
  assert.match(bar, /<button class="icon-button help-button" id="help-button" type="button"[^>]*aria-label="[^"]+"[^>]*>\?<\/button>\s*$/)
  assert.match(html, /<dialog class="help-tour" id="help" aria-labelledby="help-heading">/)
  for (const id of ['help-picture', 'help-heading', 'help-lines', 'help-dots', 'help-back', 'help-next', 'help-close']) assert.ok(html.includes(`id="${id}"`), id)
})

test('the tour\'s look: a card over the page, the painting at 16:9, and on a phone one card filling the screen', () => {
  assert.match(style, /\.help-tour \{[^}]*width: min\(/)
  assert.match(style, /\.help-picture \{[^}]*aspect-ratio: 16 \/ 9/)
  assert.match(style, /@media \(max-width: 600px\) \{[^}]*\.help-tour \{[^}]*width: 100vw;[^}]*height: 100%/)
  assert.match(style, /\.help-dot\[aria-current="true"\]/)
})

/** The real board's files, served by a board on a free port. */
async function served(t, path) {
  const server = createBoard({ token: 'a'.repeat(64), getState: async () => ({ readAt: 1, chats: [] }), say: async () => ({ ok: false, status: 400, why: 'No.' }) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return new Promise((done, fail) => {
    request({ host: '127.0.0.1', port: server.address().port, path }, res => {
      const parts = []
      res.on('data', part => parts.push(part))
      res.on('end', () => done({ status: res.statusCode, type: res.headers['content-type'], size: Buffer.concat(parts).length }))
    }).on('error', fail).end()
  })
}

test('the six pictures are served from the board itself, as SVG; nothing else from their folder', async t => {
  for (const card of cards) {
    const answer = await served(t, card.picture)
    assert.equal(answer.status, 200, card.picture)
    assert.equal(answer.type, 'image/svg+xml')
    assert.ok(answer.size > 1000)
  }
  for (const path of ['/help/7-more.svg', '/help/', '/help/1-set-up.webp', '/help/1-install.png', '/help/..%2Fboard.js', '/public/help/1-install.svg']) {
    assert.equal((await served(t, path)).status, 404, path)
  }
})
