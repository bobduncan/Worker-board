// B507: an ask that names a place on the board links to it. The person, 2026-10-24, on a do-item that said "Open the
// Focus tab, then Goals, and look at G33" without a link: "this has no link so it's not user friendly". The server
// (src/places.mjs, for the work tool's For you block) and the page (public/board.js, for the popup) keep the same word
// rules; both are held to the same samples here. Made-up goals, steps and asks.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { placesIn } from '../src/places.mjs'
import { forYouBlock } from '../src/work/api.mjs'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const context = {}
/** The source of the function `name` in the page, up to its closing brace at the start of a line. */
const functionSource = name => {
  const from = script.indexOf(`function ${name}(`)
  return script.slice(from, script.indexOf('\n}\n', from) + 3)
}
vm.runInNewContext([
  script.slice(script.indexOf('// asklinks:start'), script.indexOf('// asklinks:end')),
  `const ADVISOR_PANES = ${/const ADVISOR_PANES = (\[.*\])/.exec(script)[1]}`,
  functionSource('goalFocusOf'),
  functionSource('advicePaneOf'),
  functionSource('tabOfAddress'),
  'this.askLinkPieces = askLinkPieces; this.tabOfAddress = tabOfAddress; this.advicePaneOf = advicePaneOf; this.goalFocusOf = goalFocusOf',
].join('\n'), context)
const plain = value => JSON.parse(JSON.stringify(value))

const goals = ['G33', 'G7']
const known = { isGoal: id => goals.includes(id), isStep: id => ['B12'].includes(id), isAsk: id => ['Q7'].includes(id) }
const pieces = text => plain(context.askLinkPieces(text, known))
const addressesOnPage = text => pieces(text).filter(one => one.place !== undefined || one.ask !== undefined || one.step !== undefined).map(one => one.place ?? `#details=${one.ask ?? one.step}`)
const addressesOnServer = text => placesIn(text, known).map(one => one.hash)

const TITLE = 'Open the Focus tab, then Goals, and look at G33: is it right?'

test('a goal the map holds is a link to it on Goals; an unknown goal stays words', () => {
  assert.deepEqual(pieces('Look at G33 and G999.'), ['Look at ', { place: '#advice/goals/G33', words: 'G33', label: 'Open G33 on Goals' }, ' and G999.'])
  assert.deepEqual(plain(placesIn('Look at G33 and G999.', known)), [{ words: 'G33', label: 'Open G33 on Goals', hash: '#advice/goals/G33' }])
})

test('a tab named with the word tab is a link, and the part named after it is the place', () => {
  assert.deepEqual(pieces('Open the Backlog tab now'), ['Open the ', { place: '#backlog', words: 'Backlog tab', label: 'Open the Backlog tab' }, ' now'])
  assert.deepEqual(pieces(TITLE), [
    'Open the ',
    { place: '#advice/goals', words: 'Focus tab, then Goals', label: 'Open the Focus tab, then Goals' },
    ', and look at ',
    { place: '#advice/goals/G33', words: 'G33', label: 'Open G33 on Goals' },
    ': is it right?',
  ])
  assert.deepEqual(addressesOnPage('Open the Focus tab.'), ['#advice/focus'])
  assert.deepEqual(addressesOnPage('the Focus tab then Brainstorm'), ['#advice/brainstorm'])
  // A word that only holds a tab's name is no place.
  assert.deepEqual(pieces('the Focus page and Refocus tab'), ['the Focus page and Refocus tab'])
})

test('the page and the server find the same places in the same words', () => {
  for (const text of [TITLE, 'Check B12, then Q7, then B99', 'the Vision tab, G7, and the Design tab', 'G33 and G33 again', 'nothing here', 'http://x/#advice/goals/G33 and docs/G7.md']) {
    assert.deepEqual([...new Set(addressesOnPage(text))], addressesOnServer(text), text)
  }
})

test('the server finds each place once, in the order of the words', () => {
  assert.deepEqual(addressesOnServer(TITLE), ['#advice/goals', '#advice/goals/G33'])
  assert.deepEqual(addressesOnServer('B12 first, then the Backlog tab, then B12'), ['#details=B12', '#backlog'])
  assert.deepEqual(addressesOnServer('Q7 and B12'), ['#details=Q7', '#details=B12'])
})

test('the addresses open the tab, the Focus part or the goal they name; Back reads them the same', () => {
  assert.equal(context.tabOfAddress('#advice/focus'), 'advice')
  assert.equal(context.tabOfAddress('#advice/brainstorm'), 'advice')
  assert.equal(context.tabOfAddress('#advice/goals/G33'), 'advice')
  assert.equal(context.tabOfAddress('#advice/nonsense/x'), null)
  assert.equal(context.advicePaneOf('#advice/brainstorm'), 'brainstorm')
  assert.equal(context.advicePaneOf('#advice/focus'), 'focus')
  assert.equal(context.advicePaneOf('#advice/goals'), undefined)
  assert.equal(context.advicePaneOf('#advice/nonsense'), undefined)
  assert.equal(context.goalFocusOf('#advice/goals/G33'), 'G33')
  assert.equal(context.tabOfAddress('#vision'), 'vision')
  assert.equal(context.tabOfAddress('#backlog'), 'coordinate')
})

test('the For you block adds one link per place the title names, under the picture and play links', () => {
  const URL = 'http://127.0.0.1:4310'
  const places = placesIn(TITLE, known)
  assert.equal(
    forYouBlock({ id: 'Q9', of: 'B12', kind: 'look', title: TITLE, pictures: ['art-inbox/g/side.png'], places }, URL),
    [
      '> **For you**',
      `> 1. **Answer:** ${TITLE} (Q9, look on B12)`,
      '>    [See the picture: side](http://127.0.0.1:4310/#picture=art-inbox/g/side.png)',
      '>    [Open the Focus tab, then Goals](http://127.0.0.1:4310/#advice/goals)',
      '>    [Open G33 on Goals](http://127.0.0.1:4310/#advice/goals/G33)',
    ].join('\n'),
  )
  // Without the board's address: the words, no link; with no place: as before.
  assert.match(forYouBlock({ id: 'Q9', kind: 'do', title: TITLE, places }), /\n>    Open G33 on Goals$/)
  assert.equal(forYouBlock({ id: 'Q5', kind: 'do', title: 'Restart the app' }, URL), '> **For you**\n> 1. **Do:** Restart the app (Q5, do)')
})
