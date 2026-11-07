// Links on the page work. (1) A board address opened on a board tab that is already open acts at once (a hash change),
// also while a step window is open: a new `#details=` takes the window's place. (2) A markdown link `[words](address)` in the
// words of an ask, a card or a note is a real link when its address is on this machine (http or https, 127.0.0.1 or
// localhost, any port); another address stays the words as written. This board's own address with a hash of the board opens
// in place; another local address opens in a new tab. The two real texts of 2026-11-07 are rebuilt below. Made-up names.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseItem } from '../src/work/item.mjs'
import { openPage, reply, settle } from './pageHarness.mjs'
import { NOW, MIN, asSent, build, sinceOf } from './partnerState.mjs'

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const context = {}
vm.runInNewContext(`${script.slice(script.indexOf('// asklinks:start'), script.indexOf('// asklinks:end'))}
this.askLinkPieces = askLinkPieces`, context)
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = NOW - 5 * MIN
const RECAP = '[Open the recap](http://127.0.0.1:4310/#demo=art-inbox/g60/recap/demo.json)'
const OPEN_B1051 = '[Open B1051](http://127.0.0.1:4310/#details=B1051)'
const make = (id, asks, owner, title, text) => parseItem(`Id: ${id}\nKind: ask\nTitle: ${title}\nState: open\nOwner: ${owner}\nSince: ${sinceOf(at)}\nFiled: ${at}\nAsks: ${asks}\nBlocking: no\nOf: B12\nAdvice: yes\n\n## Text\n${text}\n`)
const Q81 = make('Q81', 'look', 'Advisor', 'Does the recap look right?', `Does the recap look right? ${RECAP} Foreign: [x](https://example.com/a) and [y](http://127.0.0.1.evil.com:4310/#details=B12).`)
const Q82 = make('Q82', 'do', 'Main', `Do the next step. ${OPEN_B1051}`, `Do the next step. ${OPEN_B1051}`)
const Q83 = make('Q83', 'look', 'Digger', 'Is the gate wide enough?', 'Is the gate wide enough? Notes at [the other board](http://localhost:4314/#details=B12).')
const state = () => asSent({ ...build([Q81, Q82, Q83]), goalsEdit: { canWrite: true } })
const links = (page, root) => page.all(`${root} .ask-link`).map(one => ({ text: words(one), tag: one.tagName, place: one.dataset.place ?? null, href: one.getAttribute('href'), target: one.target ?? '', rel: one.rel ?? '' }))

test('an open step window, then a new #details= address: the new step opens at once, not at the next redraw', async () => {
  const page = await openPage({ state: state(), hash: 'details=Q81' })
  try {
    assert.match(words(page.find('#details')), /Does the recap look right/)
    page.window.location.hash = '#details=Q83'
    await settle()
    assert.equal(page.find('#details').open, true)
    assert.match(words(page.find('#details')), /Is the gate wide enough/)
    assert.doesNotMatch(words(page.find('#details')), /recap look right/)
    // Back to the first one by a popstate, as the Back button does.
    page.window.history.pushState(null, '', '#details=Q81')
    page.window.dispatchEvent(new page.window.PopStateEvent('popstate'))
    await settle()
    assert.match(words(page.find('#details')), /Does the recap look right/)
  } finally { await page.close() }
})

test('a #details= address typed on a tab with no window open opens at once; a #picture= address opens its picture and is cleaned', async () => {
  const page = await openPage({ state: state() })
  try {
    assert.equal(page.find('#details').open, false)
    page.window.location.hash = '#details=Q82'
    await settle()
    assert.match(words(page.find('#details')), /Do the next step/)
    page.window.location.hash = '#picture=art-inbox/x/side.png'
    await settle()
    assert.equal(page.window.location.hash, '', 'the picture address is followed once')
  } finally { await page.close() }
})

test('the ask popup of 2026-11-07: "Open the recap" is a link to the demo of this board, opened in place; the foreign and look-alike addresses stay text', async () => {
  const page = await openPage({ state: state(), hash: 'details=Q81' })
  try {
    const shown = links(page, '#details')
    assert.deepEqual(shown, [{ text: 'Open the recap', tag: 'BUTTON', place: '#demo=art-inbox/g60/recap/demo.json', href: null, target: '', rel: '' }])
    const text = words(page.find('#details'))
    assert.match(text, /Foreign: \[x\]\(https:\/\/example\.com\/a\) and \[y\]\(http:\/\/127\.0\.0\.1\.evil\.com:4310\/#details=B12\)\./)
    assert.doesNotMatch(text, /\[Open the recap\]/)
  } finally { await page.close() }
})

test('the Main Do card of 2026-11-07: "Open B1051" is a link in the card\'s title and words, and a click opens in place: no new tab, no reload', async () => {
  const page = await openPage({ state: state() })
  try {
    const card = page.find('[data-id="work:Q82"]')
    const shown = [...card.querySelectorAll('.ask-link')].map(one => [words(one), one.tagName, one.dataset.place])
    assert.ok(shown.length >= 1, 'the card has the link')
    assert.deepEqual(shown[0], ['Open B1051', 'BUTTON', '#details=B1051'])
    assert.doesNotMatch(words(card), /\]\(http/)
    // B1051 is no step of this made-up board, so nothing opens; the click still stays on this tab.
    const opened = []
    page.window.open = (...given) => { opened.push(given) }
    await page.click('[data-id="work:Q82"] .ask-link')
    assert.deepEqual(opened, [])
    assert.equal(page.reloads(), 0)
  } finally { await page.close() }
})

test('a click on a link to this board\'s address opens that step in place', async () => {
  const own = make('Q84', 'look', 'Digger', 'Is the hedge done?', 'Is the hedge done? See [the gate ask](http://127.0.0.1:4310/#details=Q83).')
  const page = await openPage({ state: asSent({ ...build([Q83, own]), goalsEdit: { canWrite: true } }), hash: 'details=Q84' })
  try {
    assert.match(words(page.find('#details')), /Is the hedge done/)
    await page.click('#details .ask-link[data-place="#details=Q83"]')
    assert.match(words(page.find('#details')), /Is the gate wide enough/)
    assert.doesNotMatch(words(page.find('#details')), /hedge done/)
    assert.equal(page.reloads(), 0)
  } finally { await page.close() }
})

test('another local address is a real link that opens in a new tab with rel noopener', async () => {
  const page = await openPage({ state: state(), hash: 'details=Q83' })
  try {
    assert.deepEqual(links(page, '#details'), [{ text: 'the other board', tag: 'A', place: null, href: 'http://localhost:4314/#details=B12', target: '_blank', rel: 'noopener' }])
  } finally { await page.close() }
})

test('the word pieces: a local markdown link is one piece, a foreign or look-alike one stays words, ids and pages around it still link', () => {
  const pieces = text => JSON.parse(JSON.stringify(context.askLinkPieces(text, { isAsk: id => id === 'Q7', isStep: () => false })))
  assert.deepEqual(pieces('See [here](http://localhost:9/#vision) and Q7.'), ['See ', { href: 'http://localhost:9/#vision', words: 'here' }, ' and ', { ask: 'Q7' }, '.'])
  assert.deepEqual(pieces('[x](https://example.com/a)'), ['[x](https://example.com/a)'])
  assert.deepEqual(pieces('[x](http://127.0.0.1@evil.com/a) [y](javascript:alert(1)) [z](ftp://127.0.0.1/a)'), ['[x](http://127.0.0.1@evil.com/a) [y](javascript:alert(1)) [z](ftp://127.0.0.1/a)'])
})
