// B688/B692: "Drop this part" on the Focus page. A click must show the reason box at once (the page's view of the Focus
// tab holds what the click changed, or its redraw is skipped), and Undo takes back the drop of the part it stands under,
// in any order (B692: that part's own line is removed, not the goal map's snapshot). The page's own code draws the
// run card in vm with a stand-in document, and the test looks for the reason box itself. Made-up names only.
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../src/goals.mjs'
import { editGoals } from '../src/goalsWrite.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const script = await readFile(join(here, '..', 'public', 'board.js'), 'utf8')

/** The source of a top-level function, or of a one-line const, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^(async )?function ${name}[(]|^const ${name} = `, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  const head = lines[0]
  if (head.startsWith('const') && !head.trimEnd().endsWith('{')) return head
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('}'))
  return lines.slice(0, end + 1).join('\n')
}

/** A small stand-in for the page's document: enough for the Focus card's parts. */
class Node {
  constructor(tag) { Object.assign(this, { tag, style: {}, className: '', textContent: '', children: [], dataset: {}, attrs: {}, disabled: false, title: '', type: '', value: '', id: '', rows: 0, placeholder: '', maxLength: 0 }) }
  append(...items) { for (const one of items) this.children.push(typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one) }
  setAttribute(name, value) { this.attrs[name] = value }
}
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]

/** The page's Focus moves and its run card, drawn for real into the stand-in; every send is recorded. */
function focusPage() {
  const seen = { sent: [], drawn: [] }
  const part = (title, tone, more = {}) => ({ title, chip: tone, tone, percent: 0, blocks: [], count: null, toggle: null, standards: [], ...more })
  const context = {
    document: { createElement: tag => new Node(tag) }, drawn: {}, seen, chosen: [], problems: [], sending: [], openForms: [], starting: [],
    board: { focus: { id: 'G2' } }, $: () => ({ focus() {} }),
    switchEffort() {},
    focusPageView: () => ({
      ui: context.focusPageUi(),
      run: {
        title: 'The how', page: null, stepsOf: 'G2',
        parts: [
          part('Cliffs and edges', 'stopped', { drop: { label: 'Drop this part', act: 'part-drop', isEnabled: true, title: '' } }),
          part('The loop', 'dropped', { undo: { label: 'Undo', act: 'part-undo', isEnabled: true, title: '' } }),
        ],
      },
    }),
    drawFocus: view => seen.drawn.push(context.focusRunCard(view)),
    sendFocus: async body => { seen.sent.push(body); return {} },
  }
  vm.runInNewContext([
    source('el'), source('once'), source('focusUi'), source('FOCUS_BOXES'), source('focusPageUi'), source('focusOnce'), source('redrawFocus'),
    source('focusButton'), source('focusSay'), source('focusRunCard'), source('focusAct'),
    'Object.assign(this, { focusUi, focusAct, redrawFocus, focusPageUi, focusRunCard })',
  ].join('\n'), context)
  return context
}

test('a click on "Drop this part" draws the reason box under that part at once, and a second click takes it away', async () => {
  const page = focusPage()
  page.redrawFocus()
  const boxes = () => all(page.seen.drawn.at(-1), node => node.id === 'focus-drop-words')
  assert.equal(page.seen.drawn.length, 1)
  assert.equal(boxes().length, 0)
  await page.focusAct('part-drop', 'Cliffs and edges')
  assert.equal(page.seen.drawn.length, 2, 'the click did not redraw the Focus page')
  assert.equal(boxes().length, 1, 'no reason box is drawn after the click')
  const rows = all(page.seen.drawn.at(-1), node => node.className.startsWith('focus-part ') && all(node, one => one.id === 'focus-drop-words').length > 0)
  assert.equal(rows.length, 1)
  assert.match(all(rows[0], node => node.tag === 'b')[0].textContent, /Cliffs and edges/, 'the box stands under the part clicked')
  await page.focusAct('part-drop', 'Cliffs and edges')
  assert.equal(page.seen.drawn.length, 3)
  assert.equal(boxes().length, 0, 'the second click leaves the box drawn')
})

test('Drop it sends the part and the reason; Undo under a part sends part-undrop with that part\'s title', async () => {
  const page = focusPage()
  page.redrawFocus()
  const undo = all(page.seen.drawn.at(-1), node => node.dataset.focusAct === 'part-undo')
  assert.equal(undo.length, 1)
  assert.equal(undo[0].dataset.focusGoal, 'The loop', 'the Undo button knows its part')
  await page.focusAct('part-undo', 'The loop')
  assert.deepEqual(JSON.parse(JSON.stringify(page.seen.sent)), [{ command: 'part-undrop', id: 'G2', part: 'The loop' }])
  page.focusUi.dropping = 'Cliffs and edges'
  page.focusUi.words.drop = 'wrong way'
  await page.focusAct('part-drop-send')
  assert.deepEqual(JSON.parse(JSON.stringify(page.seen.sent.at(-1))), { command: 'part-drop', id: 'G2', part: 'Cliffs and edges', text: 'wrong way' })
})

const GOALS = ['Last id: G2', 'Focus: G2', '', '- [~] G2 Round shapes', '    Done when: the cliffs read round', '    Part: Cliffs and edges · about 2 h · steps B1', '    Part: The loop · 30 min · steps B4', ''].join('\n')

/** A goal map in a temp folder; `at` is what editGoals takes. */
async function withMap(run) {
  const dir = await mkdtemp(join(tmpdir(), 'b692-'))
  try {
    const file = join(dir, 'goals.md')
    await writeFile(file, GOALS)
    const at = { canWrite: true, file, historyDir: join(dir, 'history'), now: new Date(2026, 9, 26, 14, 0).getTime() }
    const dropped = async () => parseGoals(await readFile(file, 'utf8')).byId.get('G2').partsDropped.map(one => one.title)
    await run({ at, file, dropped })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
const drop = (at, part) => editGoals({ command: 'part-drop', id: 'G2', part, text: 'wrong way' }, at)
const undrop = (at, part) => editGoals({ command: 'part-undrop', id: 'G2', part }, at)

test('the board takes back the drop of the part named, in any order, though another part was dropped after it', async () => {
  await withMap(async ({ at, dropped }) => {
    assert.equal((await drop(at, 'Cliffs and edges')).ok, true)
    assert.equal((await drop(at, 'The loop')).ok, true)
    assert.equal((await undrop(at, 'Cliffs and edges')).ok, true)
    assert.deepEqual(await dropped(), ['The loop'], 'the other part stays dropped')
    assert.equal((await undrop(at, 'The loop')).ok, true)
    assert.deepEqual(await dropped(), [])
    assert.equal((await drop(at, 'Cliffs and edges')).ok, true)
    assert.equal((await drop(at, 'The loop')).ok, true)
    assert.equal((await undrop(at, 'The loop')).ok, true)
    assert.deepEqual(await dropped(), ['Cliffs and edges'], 'the part named goes, not the first drop line')
  })
})

test('Undo of a drop works with no undo memory (a restarted board), and a part that is not dropped is refused', async () => {
  await withMap(async ({ at, file, dropped }) => {
    await writeFile(file, GOALS.replace('    Part: The loop', '    Part dropped: Cliffs and edges · 2026-10-26 13:00 · wrong way\n    Part: The loop'))
    assert.deepEqual(await dropped(), ['Cliffs and edges'])
    assert.equal((await undrop(at, 'Cliffs and edges')).ok, true)
    assert.deepEqual(await dropped(), [])
    const again = await undrop(at, 'Cliffs and edges')
    assert.equal(again.ok, false)
    assert.equal(again.status, 409)
    assert.equal((await undrop(at, 'The loop')).ok, false)
  })
})
