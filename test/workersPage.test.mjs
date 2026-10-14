// B124: what the page says under the lanes about workers: how to make the main chat, that the board asked it for
// workers and what happens next, and the button for one more. The page's own code is run here, cut out of
// board.js between its marks. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => {
  const [from, to] = [script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`)]
  assert.ok(from >= 0 && to > from, `board.js has no part "${name}"`)
  return script.slice(from, to)
}
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('workers')}\nObject.assign(this, { clock, workersView })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

const MIN = 60_000
const AT = new Date(2026, 9, 14, 9, 12).getTime()
const NOW = AT + 3 * MIN
const base = { main: 'Lead', mainTitle: 'Studio · Lead', project: 'D:\\Work\\new-game', count: 2, ask: null }
const ask = more => ({ at: AT, count: 1, why: 'button', state: 'delivered', arrived: 0, isOpen: true, ...more })
const view = workers => plain(page.workersView(workers, NOW))

test('without a main chat the page says how to make one, with the folder and the name the list of chats gives it', () => {
  assert.deepEqual(view({ ...base, main: null, count: 0 }), {
    kind: 'none',
    title: 'No main chat yet',
    text: 'The board shows the chats of this project: the main chat, which hands out the work, and its workers. It has found no main chat. To begin:',
    steps: [
      ['In the Claude app, start a new chat in the folder ', { code: 'D:\\Work\\new-game' }, '.'],
      ['Name it ', { code: 'Studio · Lead' }, ': the name the list of chats gives the main chat.'],
      ['The board finds it within a minute and asks it for three workers.'],
    ],
    lines: [],
    button: null,
  })
  assert.deepEqual(view({ ...base, main: null, project: '' }).steps[0], ['In the Claude app, start a new chat in the project\'s folder.'])
})

test('the main chat alone: the board says it will ask, that it asked and what happens next, or that the ask was lost', () => {
  const alone = workers => view({ ...base, count: 0, ...workers })
  assert.deepEqual(alone({}), {
    kind: 'alone', title: 'No workers yet', text: null, steps: [],
    lines: [{ tone: '', text: 'The board asks the main chat, Studio · Lead, for three workers as soon as its chat is open.' }],
    button: { label: 'Ask for three workers', isDisabled: false },
  })
  const asked = alone({ ask: ask({ count: 3, why: 'alone' }) })
  assert.deepEqual(asked.lines, [
    { tone: 'asked', text: 'The board asked the main chat, Studio · Lead, for three workers at 09:12.' },
    { tone: 'note', text: 'The main chat starts them. Where it puts a chip into its chat for each worker instead, click each chip: one chip starts one worker. Each worker then shows here as a lane.' },
  ])
  assert.equal(asked.button.isDisabled, true)
  assert.deepEqual(alone({ ask: ask({ count: 3, why: 'alone', state: 'waiting' }) }).lines[1], { tone: 'note', text: 'It waits for the main chat to take it: its chat must be open.' })
  assert.deepEqual(alone({ ask: ask({ count: 3, why: 'alone', state: 'taken' }) }).lines[1], { tone: 'note', text: 'It is handed to the main chat.' })
  const lost = alone({ ask: ask({ count: 3, why: 'alone', state: 'expired', isOpen: false }) })
  assert.deepEqual([lost.lines, lost.button.isDisabled], [[{ tone: 'problem', text: 'The ask of 09:12 did not reach the main chat: open its chat, then ask again.' }], false])
  const none = alone({ ask: ask({ count: 3, why: 'alone', isOpen: false }) })
  assert.deepEqual([none.lines, none.button.isDisabled], [[{ tone: '', text: 'The board asked the main chat, Studio · Lead, for three workers at 09:12; none has come.' }], false])
})

test('with workers there is a button "+ Add worker" in the panel head (B159), and it waits while its ask is open', () => {
  assert.deepEqual(view(base), {
    kind: 'more', title: null, text: null, steps: [],
    lines: [{ tone: '', text: 'Asks the main chat, Studio · Lead, to start one more worker. Any worker takes any task.' }],
    button: { label: '+ Add worker', isDisabled: false },
  })
  const open = view({ ...base, ask: ask() })
  assert.deepEqual([open.lines, open.button.isDisabled], [[
    { tone: 'asked', text: 'You asked the main chat, Studio · Lead, for one more worker at 09:12.' },
    { tone: 'note', text: 'The main chat starts it. Where it puts a chip into its chat instead, click the chip.' },
  ], true])
  // Three asked while there were none, and one of them has come.
  assert.equal(view({ ...base, count: 1, ask: ask({ count: 3, why: 'alone', arrived: 1 }) }).lines[0].text, 'The board asked the main chat, Studio · Lead, for three workers at 09:12: 1 of 3 has come.')
  // All came: the ask is done and the button says what it does again.
  assert.deepEqual(view({ ...base, ask: ask({ arrived: 1, isOpen: false }) }).lines, view(base).lines)
  assert.equal(view({ ...base, ask: ask({ count: 3, arrived: 2, isOpen: false }) }).lines[0].text, 'You asked the main chat, Studio · Lead, for three workers at 09:12; 2 of 3 came.')
  assert.equal(view({ ...base, ask: ask({ state: 'failed', isOpen: false }) }).lines[0].tone, 'problem')
})

test('a board whose server says nothing about workers draws nothing there', () => {
  assert.equal(page.workersView(undefined, NOW), null)
  assert.equal(page.workersView(null, NOW), null)
})

test('the page has the look for the row under the lanes and for the empty board', () => {
  for (const rule of ['.lane-add', '.empty-workers', '.empty-workers code', '.workers-line.is-asked', '.workers-line.is-problem']) assert.ok(style.includes(rule), rule)
})

test('B131, B137: without a list of chats the row says what the board looks for, and gives no main chat\'s name to use', () => {
  const missing = view({ main: null, mainTitle: null, project: 'C:\p', count: 0, ask: null, lookFor: ['No list of chats: the board looks for C:\p\.claude\chats\list.json.'] })
  assert.equal(missing.kind, 'none')
  assert.match(missing.text, /It has not found what it looks for yet:$/)
  assert.deepEqual(missing.steps, [])
  assert.deepEqual(missing.lines, [{ tone: 'problem', text: 'No list of chats: the board looks for C:\p\.claude\chats\list.json.' }])
  // With lanes, a missing backlog is said above the row's own lines.
  const lanes = view({ main: 'Lead', mainTitle: 'Team - Lead', project: 'C:\p', count: 2, ask: null, lookFor: ['No backlog yet: the board reads C:\p\.claude\backlog.md.'] })
  assert.equal(lanes.lines[0].text, 'No backlog yet: the board reads C:\p\.claude\backlog.md.')
})
