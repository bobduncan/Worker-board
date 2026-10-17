// B169: when the main chat asks the person something, its window shows what they decide on: what they asked it, its
// answer itself, and its questions with the choices it lists; "For you" is called "Needs your attention" everywhere on
// the board. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseHandover } from '../src/handover.mjs'
import { buildState } from '../src/state.mjs'

const NOW = Date.UTC(2026, 9, 14, 12, 0)
const MIN = 60_000
const config = { ...parseConfig('{}', {}), project: 'C:\\game' }

const MAIN_ANSWER = [
  'Noted: the zebracorn sings at dawn.',
  '',
  '**Part 2 of 3: the songs**',
  '- **Morning:** a short song at 09:00.',
  '- **Evening:** a long song once a week.',
  '',
  '> **For you**',
  '> 1. **Answer:** when does it sing?',
  '>    - **A:** counted in songs, after each finished verse.',
  '>    - **B:** on the clock, every morning.',
  '>    - **C:** both, whichever comes first.',
  '>',
  '>    I advise A. A quiet week needs no song.',
  '> 2. **Answer:** is part 2 right? Yes, or say what to change.',
  '> 3. **Answer:** A, B or C for the quokkaberry? I advise B.',
  '',
  '---',
  '',
  '```diff',
  '  Prompt: the zebracorn\'s songs, part 2',
  '  Who:    Studio · Lead',
  '- Done:   partly, at part 2 of 3',
  '```',
].join('\n')

test('the choices an item lists are read with their words, and its advice apart', () => {
  const [first] = parseHandover(MAIN_ANSWER).items
  assert.equal(first.ask, 'when does it sing?')
  assert.deepEqual(first.options, [
    { key: 'A', text: 'counted in songs, after each finished verse.' },
    { key: 'B', text: 'on the clock, every morning.' },
    { key: 'C', text: 'both, whichever comes first.' },
  ])
  assert.equal(first.note, 'I advise A. A quiet week needs no song.')
  // All its words stay on one line, as before, for the windows that show it that way.
  assert.match(first.text, /^when does it sing\? - \*\*A:\*\* counted in songs/)
})

test('a question that names its choices ("A, B or C?") gets those; a yes-or-no question gets none', () => {
  const items = parseHandover(MAIN_ANSWER).items
  assert.deepEqual(items[1].options, [])
  assert.deepEqual(items[2].options, [{ key: 'A', text: null }, { key: 'B', text: null }, { key: 'C', text: null }])
  const named = text => parseHandover(`> **For you**\n> 1. **Answer:** ${text}`).items[0].options.map(option => option.key)
  assert.deepEqual(named('Plan A or B?'), ['A', 'B'])
  assert.deepEqual(named('B or C?'), [], 'choices start at A')
  assert.deepEqual(parseHandover('> **For you**\n> 1. **Do:** pick A or B in the menu.').items[0].options, [], 'a Do is done, not chosen')
})

test('its material is the answer without its "For you" block and without its closing block', () => {
  const parts = parseHandover(MAIN_ANSWER)
  assert.equal(parts.material, 'Noted: the zebracorn sings at dawn.\n\n**Part 2 of 3: the songs**\n- **Morning:** a short song at 09:00.\n- **Evening:** a long song once a week.')
  // Words after the block stay in it; an answer without the block is all material.
  assert.equal(parseHandover('Before.\n\n> **For you**\n> 1. **Answer:** Yes?\n\nAfter.').material, 'Before.\n\n\nAfter.')
  assert.equal(parseHandover(`Only words.\n\n---\n\n\`\`\`diff\n  Prompt: x\n+ Done:   yes\n\`\`\``).material, 'Only words.')
})

test('the block is also read under the board\'s new name for it', () => {
  assert.equal(parseHandover('> **Needs your attention**\n> 1. **Answer:** Snow first? I advise yes.').items[0].ask, 'Snow first? I advise yes.')
})

function waitingMain(lines) {
  const summary = { status_category: 'blocked', status_detail: 'part 2 shown', needs_action: 'One question', summarizes_uuid: 'u-1' }
  const app = name => JSON.stringify({ title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: NOW - 3 * 60 * MIN, lastActivityAt: NOW - MIN, lastAssistantUuid: 'u-1', postTurnSummary: summary })
  const raw = {
    listText: '{"prefix":"Studio · ","main":"Lead"}',
    appChatTexts: [app('Lead'), app('Worker 2')],
    tails: { 'cli-Lead': { text: lines.join('\n'), isCut: false, modifiedAt: NOW }, 'cli-Worker 2': { text: answer(NOW - 9 * MIN, 'ok'), isCut: false, modifiedAt: NOW } },
    planLineTexts: {}, backlogText: '', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

test('the main chat that waits says it needs an answer, not that it finished a task, and says it is the main chat', () => {
  const state = waitingMain([typed(NOW - 6 * MIN, 'go on with the songs'), answer(NOW - 4 * MIN, MAIN_ANSWER)])
  const need = state.forYou.find(one => one.from === 'Lead')
  assert.equal(need.title, 'Lead needs your answer')
  assert.equal(need.isMain, true)
  assert.equal(need.waits.handover.items.length, 3)
  assert.equal(need.waits.handover.closing.prompt, 'the zebracorn\'s songs, part 2')
})

// The window, cut out of board.js between its marks, and its parts

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const style = await readFile(join(PUBLIC, 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { waitingOf, handoverAnswer })`, page)

test('the window knows the main chat, and a chosen letter is typed as the answer', () => {
  const need = { id: 'chat:Lead:1', isMain: true, canAnswer: true, answer: null, text: '', task: null, waits: { at: NOW, words: MAIN_ANSWER, questions: [], plan: null, handover: parseHandover(MAIN_ANSWER), given: null } }
  assert.equal(page.waitingOf(need, NOW).isMain, true)
  assert.equal(page.waitingOf({ ...need, isMain: undefined }, NOW).isMain, false)
  const items = parseHandover(MAIN_ANSWER).items
  assert.equal(page.handoverAnswer(items, new Map([[1, { verdict: 'A', words: '' }], [3, { verdict: 'C', words: 'and soon' }]])), '1. A\n3. C: and soon')
})

test('the main chat\'s window: what you asked and where it stands, its answer open, its questions, the rest folded', () => {
  // B275: the Advisor's window is drawn the same way.
  assert.match(script, /if \(waiting\.isMain \|\| waiting\.isAdvisor\) return mainParts\(waiting, needId\)\n\s+\/\/ B149: a finished worker/)
  const parts = script.slice(script.indexOf('function mainParts'), script.indexOf('function itemsPart'))
  for (const words of ["['You asked',", "['Where it stands',", 'What you decide on', 'drawTalkText(el(\'div\', \'main-material\'), material)', 'itemsPart(handover.items, waiting, needId, true)', "section('Asked before'", 'open.dataset.showSide = \'main\'', '...closingParts(closing)']) {
    assert.ok(parts.includes(words), words)
  }
  // A worker's window keeps its items as they were: Yes or No, or Done, and its words on one line.
  assert.match(script, /if \(handover\.items\.length > 0\) main\.push\(itemsPart\(handover\.items, waiting, needId\)\)/)
  assert.match(script, /const choices = withChoices \? item\.options \?\? \[\] : \[\]/)
  // From the window to the talk with the main chat.
  assert.match(script, /const side = event\.target\.closest\('\[data-show-side\]'\)\n\s+if \(side !== null\) \{\n\s+closeDetails\(\)\n\s+showSide\(side\.dataset\.showSide\)/)
  assert.match(style, /\.main-material \{[^}]*max-height: 42vh[^}]*overflow: auto/)
})

test('"For you" is "Needs your attention" on the board: the tab, its panel, the Backlog filter, a step\'s state and the window', () => {
  assert.match(html, /data-side="needs"[^>]*>Needs your attention <span class="count"/)
  assert.match(html, /<h2 id="inbox-title" class="sr-only">Needs your attention<\/h2>/)
  assert.match(script, /\['you', 'Needs your attention'\]/)
  assert.match(script, /you: 'Needs your attention'/)
  assert.match(script, /return section\('Needs your attention', \[list/)
  assert.ok(!/>For you</.test(html) && !/^(?!\s*\/\/).*'For you'/m.test(script), 'no "For you" left for the person to see')
  // On one line, also when the right side is at its narrowest.
  assert.match(style, /\.side-tab \{ white-space: nowrap; \}/)
  assert.match(style, /@container \(max-width: 370px\) \{\n\s+\.side-tab \{ font-size: 13px;/)
})
