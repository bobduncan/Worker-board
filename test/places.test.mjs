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
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { placesIn } from '../src/places.mjs'
import { forYouBlock, workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

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
  for (const text of [TITLE, 'Check B12, then Q7, then B99', 'the Vision tab, G7, and the Design tab', 'the Backlog tab, then Brainstorm', 'the Focus table and the Focus tab, then Brainstorm', 'the Focus tab then Goals', 'G33 and G33 again', 'nothing here', 'http://x/#advice/goals/G33 and docs/G7.md']) {
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
      `> 1. **Answer:** ${TITLE} (Q9, look on task B12)`,
      '>    [See the picture: side](http://127.0.0.1:4310/#picture=art-inbox/g/side.png)',
      '>    [Open the Focus tab, then Goals](http://127.0.0.1:4310/#advice/goals)',
      '>    [Open G33 on Goals](http://127.0.0.1:4310/#advice/goals/G33)',
    ].join('\n'),
  )
  // Without the board's address: the words, no link; with no place: as before.
  assert.match(forYouBlock({ id: 'Q9', kind: 'do', title: TITLE, places }), /\n>    Open G33 on Goals$/)
  assert.equal(forYouBlock({ id: 'Q5', kind: 'do', title: 'Restart the app' }, URL), '> **For you**\n> 1. **Do:** Restart the app (Q5, do)')
})

test('a part follows the Focus tab only: after any other tab it is no place, and "table" is no tab', () => {
  for (const text of ['the Backlog tab, then Brainstorm', 'the Vision tab then Goals']) {
    assert.deepEqual(addressesOnPage(text), [text.includes('Backlog') ? '#backlog' : '#vision'], text)
    assert.deepEqual(addressesOnServer(text), addressesOnPage(text), text)
  }
  assert.deepEqual(addressesOnPage('the Focus table'), [])
  assert.deepEqual(addressesOnServer('the Focus table'), [])
  assert.deepEqual(addressesOnServer('the Focus tab, then Brainstorm'), ['#advice/brainstorm'])
})

// The page's own functions, run with stand-ins for the page around them.
const harness = (names, setup = '') => {
  const run = {
    hash: '', opened: [], shown: [], panes: [], redrawn: 0,
    location: { hash: '', pathname: '/' },
  }
  const sandbox = {
    run, location: run.location, detailsOf: null, board: null, goalsFocus: null, goalsOpened: new Set(), goalsLinesOpen: false,
    ADVISOR_PANES: ['focus', 'goals', 'brainstorm'],
    everyNeed: () => [],
    openDetails: option => run.opened.push(plain(option)),
    show: tab => run.shown.push(tab),
    showAdvisorPane: pane => run.panes.push(pane),
    advisorFirstPart: () => 'focus',
    redrawGoals: () => { run.redrawn += 1 },
    zoomGoal: () => {},
    $: () => ({ dataset: { pane: 'focus' } }),
    el: (tag, className = '', text = '') => ({ tag, className, text, dataset: {}, title: '', append() {} }),
  }
  vm.runInNewContext([
    script.slice(script.indexOf('// asklinks:start'), script.indexOf('// asklinks:end')),
    functionSource('goalFocusOf'), functionSource('advicePaneOf'), functionSource('tabOfAddress'),
    ...names.map(functionSource), setup,
    'this.exports = { ' + [...names, 'askLinkPieces'].join(', ') + ' }',
  ].join('\n'), sandbox)
  return { run, sandbox, ...sandbox.exports }
}

test('#details opens a step that sits in no queue as the step it is', () => {
  const page = harness(['openFromAddress', 'openStepWindow'])
  const state = { chats: [{ name: 'Worker 1', queue: [{ id: 'B3' }] }], backlog: [{ steps: [{ key: 'B12' }, { key: 'B3' }] }] }
  page.sandbox.location.hash = '#details=B12'
  page.openFromAddress(state)
  assert.deepEqual(page.run.opened, [{ step: 'B12' }])
  page.sandbox.location.hash = '#details=B3'
  page.openFromAddress(state)
  assert.deepEqual(page.run.opened.at(-1), { lane: 'Worker 1', place: 0, id: 'B3' })
  page.sandbox.location.hash = '#details=B999'
  const before = page.run.opened.length
  page.openFromAddress(state)
  assert.equal(page.run.opened.length, before)
})

test('Back to #advice/brainstorm shows the Focus tab at that part', () => {
  const page = harness(['followAddress'])
  page.followAddress('#advice/brainstorm')
  assert.deepEqual(page.run.shown, ['advice'])
  assert.deepEqual(page.run.panes, ['brainstorm'])
  page.followAddress('#advice/goals/G33')
  assert.equal(page.sandbox.goalsFocus, 'G33')
  assert.equal(page.run.panes.at(-1), 'goals')
  assert.equal(page.run.redrawn, 1)
})

test('a G id in a Needs your attention card is a link: the card view carries the goal-map ids', () => {
  const page = harness(['needsView', 'linkedWords'], 'const cardsView = () => ({}); const stepKeysOf = () => []')
  const view = page.sandbox.exports.needsView({ goals: { nodes: [{ id: 'G33' }, { id: 'G7' }] }, backlog: [] }, {})
  assert.deepEqual(plain(view.goalIds), ['G33', 'G7'])
  const nodes = page.sandbox.exports.linkedWords('Look at G33 and G999.', view)
  const links = nodes.filter(one => typeof one !== 'string')
  assert.deepEqual(plain(links.map(one => one.dataset.place)), ['#advice/goals/G33'])
  assert.deepEqual(plain(nodes.filter(one => typeof one === 'string')), ['Look at ', ' and G999.'])
})

test('the work tool ask links a known goal, leaves an unknown one as words, and does not link its own id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'places-'))
  try {
    const now = new Date(2026, 9, 24, 13, 0).getTime()
    await writeStore(dir, migrateBacklog(['# Backlog', '', '## Shop', '- [ ] B7 Paint the shop (for Features; about 1 h)', ''].join('\n'), { now }), undefined, { now })
    const ctx = {
      dir, now: now + 60_000, prefix: 'Game - ', roleOf: chat => (chat === 'Features' ? 'worker' : null), freeChats: new Set(),
      boardUrl: 'http://127.0.0.1:4310', hasGoal: id => id === 'G33',
    }
    const first = await workApi({ chat: 'Features', action: 'ask', of: 'B7', kind: 'do', title: 'Focus tab, then Goals: G33, G999, B7?' }, ctx)
    assert.equal(first.ok, true, first.why)
    const text = JSON.stringify(first)
    assert.match(text, /#advice\/goals\)/)
    assert.match(text, /#advice\/goals\/G33\)/)
    assert.doesNotMatch(text, /goals\/G999/)
    assert.match(text, /#details=B7\)/)
    // The ask's own id is no place: the second ask (Q2) names Q1 and itself, and links only Q1.
    const second = await workApi({ chat: 'Features', action: 'ask', of: 'B7', kind: 'do', title: 'Check Q1 and Q2' }, ctx)
    assert.equal(second.ok, true, second.why)
    assert.match(JSON.stringify(second), /#details=Q1\)/)
    assert.doesNotMatch(JSON.stringify(second), /#details=Q2\)/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
