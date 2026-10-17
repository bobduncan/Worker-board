// B149: a worker that finished its task with something left for the person: the parts of its last answer in the
// agreed form (CLAUDE.md part "2b") and the window that shows them. B301: its "For you" items are no questions the
// board answers: what waits for the person is the work store's asks, and a block without one is a warning. Made-up
// samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, fromChat, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { checkGame } from '../src/games.mjs'
import { closingOf, parseHandover, withoutClosing } from '../src/handover.mjs'
import { buildState } from './withStore.mjs'

const CLOSING = '---\n\n```diff\n  Prompt: B150, the walk\n  Who:    Studio · Worker 2\n- Done:   partly, waits for your look\n```'
const ANSWER = [
  '**Task:** B150: give the archer a walk cycle in four directions',
  '**What I did:** drew the walk in 8 frames per direction;',
  'it is on its own branch, not merged.',
  '',
  'More words that only the whole answer shows.',
  '',
  '> **For you**',
  '> 1. **Answer:** Does the walk read well at game size? I advise yes.',
  '>    [See the picture: the walk](http://127.0.0.1:4310/#picture=art-inbox/units/archer/walk.png)',
  '> 2. **Answer:** Does it turn without a jump?',
  '>    I advise yes.',
  '>    [Play it: Crossing](http://127.0.0.1:4310/#play=feature/archer-walk&arena=crossing&enemies=skeletons)',
  '> 3. **Do:** start the app anew once.',
  '',
  CLOSING,
].join('\n')

// The answer's parts

test('the four parts are read from an answer in the agreed form, and the closing block apart', () => {
  const parts = parseHandover(ANSWER)
  assert.equal(parts.task, 'B150: give the archer a walk cycle in four directions')
  assert.equal(parts.did, 'drew the walk in 8 frames per direction;\nit is on its own branch, not merged.')
  assert.deepEqual(parts.items, [
    { n: 1, kind: 'answer', text: 'Does the walk read well at game size? I advise yes.', links: [{ kind: 'picture', label: 'See the picture: the walk', path: 'art-inbox/units/archer/walk.png' }], ask: 'Does the walk read well at game size? I advise yes.', options: [], note: '' },
    { n: 2, kind: 'answer', text: 'Does it turn without a jump? I advise yes.', links: [{ kind: 'play', label: 'Play it: Crossing', branch: 'feature/archer-walk', settings: 'arena=crossing&enemies=skeletons' }], ask: 'Does it turn without a jump?', options: [], note: 'I advise yes.' },
    { n: 3, kind: 'do', text: 'start the app anew once.', links: [], ask: 'start the app anew once.', options: [], note: '' },
  ])
  assert.deepEqual(parts.closing, { prompt: 'B150, the walk', who: 'Studio · Worker 2', done: 'partly, waits for your look', isDone: false })
  assert.ok(parts.rest.endsWith('> 3. **Do:** start the app anew once.'))
})

test('a link that leaves the pictures\' folders, or names more than a plain branch, is no link', () => {
  const items = parseHandover([
    '> **For you**',
    '> 1. **Answer:** Look. [Bad](http://127.0.0.1:4310/#picture=../secret.png) [Odd](#play=main;rm&x=1) [Fine](#play=main&sandbox)',
  ].join('\n')).items
  assert.deepEqual(items[0].links, [{ kind: 'play', label: 'Fine', branch: 'main', settings: 'sandbox' }])
  assert.match(items[0].text, /\[Bad\]/)
})

test('an answer without the form gives nothing; one with only a closing block gives that block', () => {
  assert.equal(parseHandover('Two sheets are drawn. Which one do you want?'), null)
  assert.equal(parseHandover(''), null)
  const only = parseHandover(`It is merged.\n\n${CLOSING.replace('- Done:   partly, waits for your look', '+ Done:   yes')}`)
  assert.deepEqual([only.items, only.task, only.closing.isDone, only.rest], [[], null, true, 'It is merged.'])
  assert.equal(closingOf('no block here'), null)
  assert.equal(withoutClosing(`Words.\n\n${CLOSING}`), 'Words.')
})

// The game a link names

const folders = { chats: [{ folders: [{ branch: 'feature/archer-walk', path: 'C:\\game-archer' }] }], otherFolders: [], mainGame: { branch: 'main', path: 'C:\\game' } }

test('a link starts the game of a branch a working folder holds, main included, and nothing else', () => {
  assert.deepEqual(checkGame({ item: 'branch', branch: 'feature/archer-walk', action: 'start' }, folders), { ok: true, action: 'start', branch: 'feature/archer-walk', path: 'C:\\game-archer' })
  assert.deepEqual(checkGame({ item: 'branch', branch: 'main', action: 'start' }, folders).path, 'C:\\game')
  assert.equal(checkGame({ item: 'branch', branch: 'feature/gone', action: 'start' }, folders).status, 409)
  for (const branch of ['../x', 'a b', '', 7, '-x']) assert.equal(checkGame({ item: 'branch', branch, action: 'start' }, folders).status, 400, String(branch))
})

// What the state hands the window

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 14, 10, 30)
const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
function waitingWorker(lines) {
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: NOW - 3 * 60 * MIN, lastActivityAt: NOW - MIN, lastAssistantUuid: 'u-1', postTurnSummary: { status_category: 'blocked', status_detail: 'walk drawn', needs_action: 'Two questions', summarizes_uuid: 'u-1' } })
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Worker 2')],
    tails: { 'cli-Lead': { text: answer(NOW - 9 * MIN, 'ok'), isCut: false, modifiedAt: NOW }, 'cli-Worker 2': { text: lines.join('\n'), isCut: false, modifiedAt: NOW } },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
  return state.forYou.find(need => need.from === 'Worker 2')
}

test('B301: a finished worker\'s "For you" block without an ask is a warning, its window with the parts, never the main chat\'s hand-over', () => {
  const need = waitingWorker([fromChat(NOW - 90 * MIN, 'Studio · Lead', 'Task from Studio · Lead: B150, the walk. About 1 hour.'), answer(NOW - 4 * MIN, ANSWER)])
  assert.deepEqual([need.kind, need.title, need.canAnswer, need.talk], ['unfiled', 'Worker 2 wrote questions in its chat but filed no ask', false, 'window'])
  assert.equal(need.waits.handover.task, 'B150: give the archer a walk cycle in four directions')
  assert.equal(need.waits.given, null)
})

test('what the person typed to a chat that waits is never shown, also as its task', () => {
  const need = waitingWorker([typed(NOW - 90 * MIN, 'Zebracorn, draw the walk'), answer(NOW - 4 * MIN, ANSWER)])
  assert.equal(need.waits.given, null)
  assert.equal(JSON.stringify(need).includes('Zebracorn'), false)
})

// The window's own small parts, cut out of board.js between its marks

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { waitingOf, hasForm, closingRows })`, page)

test('B301: the window offers no answers to a "For you" block\'s items: no item part, no answer rows', () => {
  const parts = script.slice(script.indexOf('function handoverParts'), script.indexOf('function mainParts'))
  assert.doesNotMatch(parts, /itemsPart|data-item-verdict/)
  assert.doesNotMatch(script, /function itemsPart|function handoverAnswer|itemAnswers/)
})

test('the window has the form when the answer has items or a task or what it did, and shows the closing block as rows', () => {
  const parts = parseHandover(ANSWER)
  assert.equal(page.hasForm(parts), true)
  assert.equal(page.hasForm({ ...parts, items: [], task: null, did: null }), false)
  assert.equal(page.hasForm(null), false)
  assert.deepEqual(JSON.parse(JSON.stringify(page.closingRows(parts.closing))), [['Prompt', 'B150, the walk', ''], ['Who', 'Studio · Worker 2', ''], ['Done', 'partly, waits for your look', 'bad']])
  const view = JSON.parse(JSON.stringify(page.waitingOf({ id: 'chat:W:1', text: 'x', canAnswer: true, answer: null, task: null, waits: { at: 1, words: ANSWER, questions: [], plan: null, handover: parts, given: null } }, NOW)))
  // The closing block is shown apart, not among its words.
  assert.equal(view.words.includes('```diff'), false)
  assert.equal(view.handover.items.length, 3)
})

test('the board\'s links: the game starts in a new tab; the address follows a link once', () => {
  assert.match(script, /body: JSON\.stringify\(\{ item: 'branch', branch, action: 'start' \}\)/)
  assert.match(script, /if \(location\.hash\.startsWith\('#picture='\) \|\| location\.hash\.startsWith\('#play='\)\) \{\n {4}const hash = location\.hash\n {4}history\.replaceState\(null, '', location\.pathname\)/)
})
