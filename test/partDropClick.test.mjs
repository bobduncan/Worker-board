// B688: "Drop this part" on the Focus page. A click must show the reason box at once (the page's view of the Focus tab
// holds what the click changed, or its redraw is skipped), and Undo takes back the drop of the part it stands under, not
// the newest drop of the page. The page's own functions run with a stub for the rest. Made-up names only.
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

/** The page's Focus moves, with a recording of every send and every draw. */
function focusPage() {
  const seen = { sent: [], drawn: [], views: [] }
  const context = {
    GOALS_PAGE: 'q1w2e3', chosen: [], problems: [], sending: [], openForms: [], starting: [], drawn: {},
    board: { focus: { id: 'G2' } }, $: () => ({ focus() {}, value: '' }), seen,
    focusPageView: (state, ui) => ({ ui }), drawFocus: view => seen.views.push(view),
    sendFocus: async body => { seen.sent.push(body); return {} },
    switchEffort() {},
  }
  vm.runInNewContext([
    source('once'), source('focusUi'), source('FOCUS_BOXES'), source('partDropPage'), source('focusPageUi'), source('focusOnce'), source('redrawFocus'), source('focusAct'),
    'Object.assign(this, { focusUi, focusAct, redrawFocus, partDropPage })',
  ].join('\n'), context)
  return context
}

test('a click on "Drop this part" draws the reason box at once, and a second click takes it away', async () => {
  const page = focusPage()
  page.redrawFocus()
  assert.equal(page.seen.views.length, 1)
  await page.focusAct('part-drop', 'Cliffs and edges')
  assert.equal(page.seen.views.length, 2, 'the click did not redraw the Focus page')
  assert.equal(page.seen.views.at(-1).ui.dropping, 'Cliffs and edges')
  await page.focusAct('part-drop', 'Cliffs and edges')
  assert.equal(page.seen.views.length, 3)
  assert.equal(page.seen.views.at(-1).ui.dropping, null)
})

test('Undo under a dropped part takes back that part\'s drop: each part has its own page word', async () => {
  const page = focusPage()
  const [cliffs, loop] = [page.partDropPage('Cliffs and edges'), page.partDropPage('The loop')]
  assert.notEqual(cliffs, loop)
  for (const word of [cliffs, loop]) assert.match(word, /^[0-9a-z]{4,40}$/)
  await page.focusAct('part-undo', 'Cliffs and edges')
  assert.deepEqual(page.seen.sent.map(body => [body.command, body.page]), [['undo', cliffs]])
  page.focusUi.dropping = 'The loop'
  page.focusUi.words.drop = 'wrong way'
  await page.focusAct('part-drop-send')
  assert.deepEqual(JSON.parse(JSON.stringify(page.seen.sent.at(-1))), { command: 'part-drop', id: 'G2', part: 'The loop', text: 'wrong way', page: loop })
})

test('the board takes back the drop of the part whose word comes, though another part was dropped after it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b688-'))
  try {
    const file = join(dir, 'goals.md')
    await writeFile(file, ['Last id: G2', 'Focus: G2', '', '- [~] G2 Round shapes', '    Done when: the cliffs read round', '    Part: Cliffs and edges · about 2 h · steps B1', '    Part: The loop · 30 min · steps B4', ''].join('\n'))
    const at = { canWrite: true, file, historyDir: join(dir, 'history'), now: new Date(2026, 9, 26, 14, 0).getTime() }
    const dropped = async () => parseGoals(await readFile(file, 'utf8')).byId.get('G2').partsDropped.map(one => one.title)
    const page = focusPage()
    const drop = async part => assert.equal((await editGoals({ command: 'part-drop', id: 'G2', part, text: 'wrong way', page: page.partDropPage(part) }, at)).ok, true)
    await drop('Cliffs and edges')
    await drop('The loop')
    assert.equal((await editGoals({ command: 'undo', page: page.partDropPage('Cliffs and edges') }, at)).ok, false, 'the file changed after that drop: nothing is undone silently')
    assert.deepEqual(await dropped(), ['Cliffs and edges', 'The loop'])
    assert.equal((await editGoals({ command: 'undo', page: page.partDropPage('The loop') }, at)).ok, true)
    assert.deepEqual(await dropped(), ['Cliffs and edges'])
    assert.equal((await editGoals({ command: 'undo', page: page.partDropPage('Cliffs and edges') }, at)).ok, true)
    assert.deepEqual(await dropped(), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the page draws Undo with its part\'s title, so the click knows which part', () => {
  assert.match(source('focusRunCard') || '', /undo\.dataset\.focusGoal = part\.title/)
})
