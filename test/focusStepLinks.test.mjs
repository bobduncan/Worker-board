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
  constructor(tag) { Object.assign(this, { tag, style: {}, className: '', textContent: '', children: [], dataset: {}, attrs: {}, title: '', type: '', disabled: false }) }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one) }
  setAttribute(name, value) { this.attrs[name] = value }
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
    source('el'), asklinks, source('linkedWords'), source('linkedEl'), source('everyNeed'), source('focusLook'), source('focusStepList'), source('focusRunCard'),
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
const links = card => all(card, node => node.dataset?.askLink !== undefined)

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
