// B292: a step's title on the board never carries the note in brackets at the end of its line, whatever the note
// starts with; its parts (who it is for, after what, how long) are still read. And a lane shows the step its worker
// is on now. The person, 2026-10-17, of Support's lane showing B29's whole line: "tasks still dont have a compact
// name. i dont understand why this is happening." Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step as toolStep, toolResult, typed } from '../fixtures/lines.mjs'
import { parseBacklog } from '../src/backlog.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { lineFields } from '../src/work/line.mjs'
import { storeFromText } from '../src/work/read.mjs'

const NAMES = { prefix: 'Game - ', names: ['Units', 'Support', 'Features', 'Board'] }
const one = line => parseBacklog(`## A\n${line}\n`, NAMES).activities[0].steps[0]
const parts = step => ({ title: step.title, worker: step.worker, after: step.after, minutes: step.minutes, branch: step.ownBranch })

test('every form of closing note leaves the title, and its parts are still read', () => {
  assert.deepEqual(parts(one('- [ ] B12 The zebracorn walks (for Units; after B11; about 1 h)')),
    { title: 'The zebracorn walks', worker: 'Units', after: 'B11', minutes: 60, branch: null })
  assert.deepEqual(parts(one('- [ ] B07 See what each zebracorn plans next (later; not handed out)')),
    { title: 'See what each zebracorn plans next', worker: null, after: null, minutes: null, branch: null })
  assert.deepEqual(parts(one('- [ ] B29 See tall walls of stone (not handed out; after today; about 8 to 10 h in two merges, with B30) (branch feature/stone)')),
    { title: 'See tall walls of stone', worker: null, after: 'today', minutes: null, branch: 'feature/stone' })
  assert.deepEqual(parts(one('- [ ] B30 Lay the flagstones (now; for Support; about 20 min)')),
    { title: 'Lay the flagstones', worker: 'Support', after: null, minutes: 20, branch: null })
  // A chat's name, a picture's place, an address: notes too. The chat named in one is still the step's.
  assert.deepEqual(parts(one('- [ ] B31 Verify: the quokka looks right (pictures in art-inbox/quokka; Game - Features) @you')),
    { title: 'the quokka looks right', worker: 'Features', after: null, minutes: null, branch: null })
  assert.equal(one('- [ ] B32 Decide: show damage before the click (Advisor) @you').title, 'show damage before the click')
  assert.equal(one('- [ ] B33 Check the board (on http://127.0.0.1:4310/; Game - Board) @you').title, 'Check the board')
  // The last note names who it is for, and its parts come first: a note a migrated title kept only adds the rest.
  assert.deepEqual(parts(one('- [ ] B37 See walls (after the merge; about 2 h; not handed out) (for Units; after B9; about 40 min)')),
    { title: 'See walls', worker: 'Units', after: 'B9', minutes: 40, branch: null })
  assert.deepEqual(parts(one('- [ ] B38 See walls (after today; about 2 h) (for Units)')),
    { title: 'See walls', worker: 'Units', after: 'today', minutes: 120, branch: null })
  // A "for" in an earlier note names nobody: the step is not queued for a made-up chat.
  const zebra = one('- [ ] B39 Show the zebra (for instance the big one) (pictures in art-inbox/x)')
  assert.deepEqual([zebra.title, zebra.isFor, zebra.worker], ['Show the zebra', false, null])
  // Two notes in a row: both leave, and the parts of both are read.
  assert.deepEqual(parts(one('- [ ] B34 Check the shop (pictures in art-inbox/shop) (for Board; about 1 h)')),
    { title: 'Check the shop', worker: 'Board', after: null, minutes: 60, branch: null })
  // A condition with brackets of its own stays whole.
  assert.equal(one('- [ ] B35 Main menu (for Units; after the archer (branch x) merges; about 40 min)').after, 'the archer (branch x) merges')
  // A title that is nothing but brackets keeps them: there is no other title.
  assert.equal(one('- [ ] B36 (a step without words)').title, '(a step without words)')
  // The step's words stay whole: what reads its notes ("not handed out") still finds them.
  assert.equal(one('- [ ] B07 See it (later; not handed out)').text, 'See it (later; not handed out)')
})

test('the work store keeps the titles it holds: a migrated title with its note still matches its line', () => {
  // The store migrated these titles with their notes; the line it writes back must still say the same step, so the
  // board's view never marks them as changed. Only the board's own reading shortens them.
  assert.equal(lineFields('B29 See tall walls (not handed out; after today) (branch feature/stone)').title, 'See tall walls (not handed out; after today)')
  assert.equal(lineFields('B12 The zebracorn walks (for Units; about 1 h)').title, 'The zebracorn walks')
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('stepline')}\n${cut('lanetime')}\n${cut('lanewindow')}\nObject.assign(this, { laneTaskOf, withoutNote })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('a lane names its card\'s task without the note a step\'s title brought along', () => {
  assert.equal(page.withoutNote('See tall walls (not handed out; after today; about 8 h)'), 'See tall walls')
  assert.equal(page.withoutNote('Check the shop (pictures in art-inbox/shop) (for Board)'), 'Check the shop')
  assert.equal(page.withoutNote('(only brackets)'), '(only brackets)')
  const lane = { name: 'Support', task: { text: 'B29 See tall walls (not handed out; after today; about 8 h)', stepId: 'B29' }, givenTask: null }
  assert.deepEqual(plain(page.laneTaskOf(lane)), { code: 'B29', text: 'See tall walls' })
})

// The lane: the step its worker is on now

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 17, 12, 0)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = (name, more = {}) => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more,
})
const card = text => JSON.stringify({ name: 'Support', role: 'worker', state: 'working', task: { text, step: 1, steps: 2, left: 20 * MIN, isReported: false, names: ['Read', 'Build'], stepLeft: 8 * MIN, since: NOW - 30 * MIN }, at: NOW - 2 * MIN })
const STORE = '## A\n- [ ] B29 See tall walls (for Support; not handed out) (branch feature/stone)\n- [ ] B85 Refine before the queue (for Support) (branch feature/refine)\n'

function support({ plan, tail, summary = null, since = null, store = STORE }) {
  const work = storeFromText(store, { now: NOW - 60 * MIN })
  if (since !== null && work.items.has('B85')) work.items.get('B85').head.set('Since', since)
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}',
    appChatTexts: [app('Main'), app('Support', summary === null ? {} : { postTurnSummary: { status_category: summary, status_detail: 'x', summarizes_uuid: 'u-1' } })],
    tails: { 'cli-Support': { text: tail.join('\n'), isCut: false, modifiedAt: NOW - MIN } },
    planLineTexts: { 'cli-Support': plan },
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config }).chats.find(chat => chat.name === 'Support')
}
const running = [typed(NOW - 30 * MIN, 'Go on.'), toolStep(NOW - 2 * MIN, 'Build'), toolResult(NOW - MIN)]

test('of two steps its worker holds, the lane shows the one its card names, else the newest', () => {
  assert.equal(support({ plan: card('B85 Refine before the queue'), tail: running }).task.stepId, 'B85')
  assert.equal(support({ plan: card('B29 See tall walls'), tail: running }).task.stepId, 'B29')
  // The first it names: "B85 ... after B29" is on B85.
  assert.equal(support({ plan: card('B85 Refine, after B29'), tail: running }).task.stepId, 'B85')
  // The store's title of the step reaches the page without its note.
  assert.equal(support({ plan: card('B29 See tall walls'), tail: running }).task.title, 'See tall walls')
  // A card that names none: the step it took last.
  assert.equal(support({ plan: card('Refining'), tail: running, since: '2026-10-17 23:50' }).task.stepId, 'B85')
})

test('a worker whose answer closed "Done: partly" is not free, whatever the app calls its turn', () => {
  // A task typed in its chat, with no step in the store: only its card can hold the lane.
  const none = '## A\n'
  const partly = answer(NOW - 3 * MIN, 'Built; the review runs.\n\n---\n\n```diff\n  Prompt: B85\n  Who:    Game - Support\n- Done:   partly, waits for its review\n```')
  const lane = support({ plan: card('Make the quokka glow'), tail: [typed(NOW - 30 * MIN, 'Go on.'), toolStep(NOW - 10 * MIN, 'Build'), toolResult(NOW - 9 * MIN), partly], summary: 'completed', store: none })
  assert.equal(lane.state, 'working')
  assert.equal(lane.lastTask, null)
  // "Done: yes" frees it, as before (B148).
  const yes = answer(NOW - 3 * MIN, 'Merged.\n\n---\n\n```diff\n  Prompt: B85\n  Who:    Game - Support\n+ Done:   yes\n```')
  assert.notEqual(support({ plan: card('Make the quokka glow'), tail: [typed(NOW - 30 * MIN, 'Go on.'), yes], summary: 'completed', store: none }).state, 'working')
})
