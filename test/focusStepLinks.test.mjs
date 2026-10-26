// B696: every step id on the Focus page opens that step. In a part's opened list the id of a step, and each id in the
// line under it (its fix, "Waits for"), is a link that opens the step window (the board's ask-link, as the other
// pages use); a click on it must not fold or open the part; an id the board does not know stays plain words. The
// page's own code draws the run card in vm with a stand-in document. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(here, '..', 'public', 'board.js'), 'utf8')
const css = await readFile(join(here, '..', 'public', 'board.css'), 'utf8')

/** The source of a top-level function, or of a one-line const, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^(async )?function ${name}[(]|^const ${name} = `, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  if (lines[0].startsWith('const') && !lines[0].trimEnd().endsWith('{')) return lines[0]
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('}'))
  return lines.slice(0, end + 1).join('\n')
}

class Node {
  constructor(tag) { Object.assign(this, { tag, style: {}, className: '', textContent: '', children: [], dataset: {}, attrs: {}, title: '', type: '', disabled: false, parent: null }) }
  append(...items) {
    for (const one of items) {
      const node = typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one
      node.parent = this
      this.children.push(node)
    }
  }
  setAttribute(name, value) { this.attrs[name] = value }
  getAttribute(name) { return this.attrs[name] ?? null }
  /** The few selectors the page's click handlers use: [data-x], .class[data-x]. */
  closest(selector) {
    const [, cls, attr] = selector.match(/^(?:[.]([\w-]+))?\[data-([\w-]+)\]$/)
    const key = attr.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
    for (let node = this; node !== null && node !== undefined; node = node.parent) {
      if (node.dataset?.[key] !== undefined && (cls === undefined || (node.className ?? '').split(' ').includes(cls))) return node
    }
    return null
  }
}
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]
const words = node => (node.textContent ?? '') + (node.children ?? []).map(words).join('')

const asklinks = script.slice(script.indexOf('// asklinks:start'), script.indexOf('// asklinks:end'))
const step = (id, title, more = {}) => ({ id, title, tone: 'now', state: 'Being checked', line: '', isFailed: false, picture: null, fixPicture: null, ...more })

/** The page's run card for one part with `steps`, drawn into the stand-in; the board knows B670, B683, B671. */
function drawn(steps, part = {}) {
  const context = {
    document: { createElement: tag => new Node(tag) },
    board: { backlog: [{ steps: ['B670', 'B683', 'B671'].map(key => ({ key })) }], forYou: [], backlogForYou: [], backlogClosed: [] },
    focusUi: { dropping: null },
  }
  vm.runInNewContext([
    source('el'), asklinks, source('linkedWords'), source('linkedEl'), source('everyNeed'), source('focusLook'), source('focusStepTitle'), source('focusStepList'), source('focusRunCard'),
    'Object.assign(this, { focusRunCard })',
  ].join('\n'), context)
  const card = context.focusRunCard({
    run: {
      title: 'The how', page: null, stepsOf: 'G2',
      parts: [{ title: 'Cliffs', chip: 'In progress', tone: 'now', percent: 50, blocks: steps.map(one => one.tone), count: '0 of 3 steps finished', toggle: 'Hide the 3 steps', isOpen: true, standards: [], steps, ...part }],
    },
  })
  return card
}
const titleLinks = card => all(card, node => node.dataset?.askLink !== undefined)
// the id links: the step's title words open the step too (B702), apart from the ids
const links = card => titleLinks(card).filter(node => !(node.className ?? '').includes('focus-step-title'))

test('the id of a step in an opened part is a link that opens that step', () => {
  const card = drawn([step('B670', 'Moving lava'), step('B683', 'Fix the cut')])
  assert.deepEqual(links(card).map(node => node.dataset.askLink), ['B670', 'B683'])
  const [first] = links(card)
  assert.equal(first.tag, 'button', 'a button is reached with Tab and opened with Enter')
  assert.equal(first.type, 'button')
  assert.equal(first.textContent, 'B670')
  assert.match(first.className, /ask-link/)
  assert.equal(first.title, 'Open the step B670')
})

test('every step id in the line under a step is a link: its fix and "Waits for"', () => {
  const card = drawn([
    step('B670', 'Moving lava', { line: 'Check failed: 4 of 7, its fix B683 waits · Waits for B671 (Cut the layout) · Worker 3', isFailed: true }),
    step('B683', 'Fix the cut'), step('B671', 'Cut the layout'),
  ])
  const ofRow = all(card, node => (node.className ?? '').startsWith('focus-step ')).map(row => links(row).map(node => node.dataset.askLink))
  assert.deepEqual(ofRow, [['B670', 'B683', 'B671'], ['B683'], ['B671']])
  const line = all(card, node => node.tag === 'small' && node.className === 'is-fail')[0]
  assert.match(words(line), /its fix B683 waits · Waits for B671 \(Cut the layout\) · Worker 3/, 'the words stay as they were')
})

test('an id the board does not know stays words, and the evidence links stay', () => {
  const card = drawn([step('B670', 'Moving lava', { line: 'Waits for B999 (Gone)', picture: { path: 'art-inbox/B670/check.png', caption: 'B670: passed' } })])
  assert.deepEqual(links(card).map(node => node.dataset.askLink), ['B670'])
  assert.match(words(card), /Waits for B999 \(Gone\)/)
  assert.equal(all(card, node => node.dataset?.zoom === 'art-inbox/B670/check.png').length, 1)
})

test('a link is never inside the part\'s toggle, so its click does not fold or open the part', () => {
  const card = drawn([step('B670', 'Moving lava')])
  const toggles = all(card, node => node.className === 'focus-toggle')
  assert.equal(toggles.length, 1)
  assert.equal(links(toggles[0]).length, 0)
  // the link's click is taken before any other handler and goes to the step window only
  assert.match(script, /const link = event\.target\.closest\('\[data-ask-link\]'\)[\s\S]{0,200}event\.stopPropagation\(\)[\s\S]{0,300}openDetails\(need !== undefined \? \{ need: need\.id \} : \{ step: id \}\)/)
})

test('the other step ids of the Focus page link the same way, through the one helper', () => {
  // the daily note's lines and asks, the re-check and the guard cards
  assert.match(script, /row\.append\(linkedEl\('span', '', one\.text\), undo\)/)
  assert.match(script, /box\.append\(linkedEl\('b', '', ask\.title\)\)/)
  assert.match(script, /linkedEl\('p', '', recheck\.text\)/)
  // a part's line "A board fix goes first: B12" and the goal demo card's words
  const card = drawn([step('B670', 'Moving lava')], { fixFirst: 'A board fix goes first: B683' })
  assert.deepEqual(all(card, node => node.className === 'focus-fix').flatMap(node => links(node).map(one => one.dataset.askLink)), ['B683'])
  // one helper makes the links: the Focus page builds no second copy of the pattern
  const focus = script.slice(script.indexOf('function focusStepList('), script.indexOf('function focusPickCard('))
  assert.ok(!focus.includes('ASK_ID'), 'a second copy of the id pattern')
  assert.ok(!focus.includes('#details='), 'a second way to open a step')
})

test('the links read on the muted lines and look like the board\'s other id links', () => {
  const rule = name => css.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
  assert.match(rule('.focus-step-id .ask-link'), /font-family: ui-monospace/)
  assert.match(rule('.focus-step-id .ask-link'), /font-weight: 700/)
  assert.match(rule('.focus-step-what small .ask-link'), /color: #8fb4ff/)
})


test('the title of a step opens that step, and the ids inside a title open theirs', () => {
  const card = drawn([step('B670', 'Remake of B683 with more lava'), step('B683', 'Fix the cut')])
  const [what] = all(card, node => node.className === 'focus-step-what')
  assert.deepEqual(titleLinks(what).map(node => [node.dataset.askLink, node.textContent]), [['B670', 'Remake of '], ['B683', 'B683'], ['B670', ' with more lava']])
  assert.equal(words(what), 'Remake of B683 with more lava', 'the words stay as they were')
  assert.ok(titleLinks(what).every(node => node.tag === 'button' && node.type === 'button'), 'reached with Tab, opened with Enter')
  assert.deepEqual(titleLinks(what).map(node => node.title), ['Open the step B670', 'Open the step B683', 'Open the step B670'])
  assert.ok(all(what, node => node.dataset?.askLink !== undefined && node.children.some(child => child.dataset?.askLink !== undefined)).length === 0, 'no link inside a link')
})

test('the title of a step the board does not know stays words', () => {
  const card = drawn([step('B999', 'Gone step')])
  const [what] = all(card, node => node.className === 'focus-step-what')
  assert.equal(titleLinks(what).length, 0)
  assert.equal(words(what), 'Gone step')
})

/** Clicks `target` as the page does: the document's capturing handler first, then the Focus page's own handlers unless stopped. */
function clicked(card, target, { opened = [] } = {}) {
  const listeners = []
  const focusUi = { partsOpen: { Cliffs: true } }
  const context = {
    document: { addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }) },
    board: { backlog: [{ steps: [{ key: 'B670' }, { key: 'B683' }] }], forYou: [], backlogForYou: [], backlogClosed: [] },
    $: () => ({ addEventListener: (type, handler) => listeners.push({ type, handler, capture: false, onFocus: true }) }),
    focusUi, redrawFocus: () => {}, everyNeed: () => [], openDetails: arg => opened.push(arg), goToPlace: () => {}, openGameFile: () => {},
  }
  const start = script.lastIndexOf('document.addEventListener', script.indexOf('// B426: a page link'))
  const toggle = script.indexOf("// B684: a part's toggle opens or closes its steps")
  const listener = script.slice(start, script.indexOf('}, true)', start) + 8)
  const folding = script.slice(toggle, script.indexOf('})', script.indexOf('redrawFocus()', toggle)) + 2)
  vm.runInNewContext([listener, folding].join('\n'), context)
  let stopped = false
  const event = { target, stopPropagation: () => { stopped = true } }
  for (const one of listeners.filter(one => one.capture)) one.handler(event)
  if (!stopped) for (const one of listeners.filter(one => one.onFocus)) one.handler(event)
  return JSON.parse(JSON.stringify({ opened, partsOpen: focusUi.partsOpen }))
}

test('a click on a title, an id or a line link opens the step and leaves the part open; a click on the toggle folds it', () => {
  const card = drawn([step('B670', 'Remake of B683', { line: 'Waits for B683' }), step('B683', 'Fix the cut')])
  const toggle = all(card, node => node.className === 'focus-toggle')[0]
  toggle.dataset.focusPart = 'Cliffs'
  toggle.attrs['aria-expanded'] = 'true'
  // a worst case: the whole part's row folds it, so a link inside only stays out of it by stopping its own click
  toggle.parent.dataset.focusPart = 'Cliffs'
  toggle.parent.attrs['aria-expanded'] = 'true'
  const [row] = all(card, node => (node.className ?? '').startsWith('focus-step '))
  for (const link of titleLinks(row)) {
    const result = clicked(card, link)
    assert.deepEqual(result.opened, [{ step: link.dataset.askLink }])
    assert.deepEqual(result.partsOpen, { Cliffs: true }, `the part stays open after ${link.textContent}`)
  }
  const folded = clicked(card, toggle)
  assert.deepEqual(folded.opened, [])
  assert.deepEqual(folded.partsOpen, { Cliffs: false })
})
