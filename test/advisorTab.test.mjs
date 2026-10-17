// B173: the Advice & Chat tab shows the Advisor's work: its open suggestions from the backlog's group for them, when
// its rounds come, and the game plan from the game's repository. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { buildState } from './withStore.mjs'

const NOW = new Date(2026, 9, 14, 10, 30).getTime()
const config = { ...parseConfig('{}', {}), project: 'C:\\game', gameRepo: 'C:\\game\\repo' }
const BACKLOG = [
  '## Architecture #focus',
  '- [ ] B10 Build the shop (for Units; about 1 h)',
  '',
  '## Advisor suggestions',
  '- [ ] B20 Decide: Make a unit template before the second unit (Advisor) @you',
  '  Why: the two units so far differ in how they are built.',
  '  Cost: about 1 h',
  '  Unblocks: every next unit.',
  '- [x] B19 Decide: Remove the old sound files (Advisor) @you',
  '',
].join('\n')

const build = (backlogText, adviceText = null) => buildState({
  listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText, adviceText,
  folders: null, askTexts: [], pictureLists: {},
}, { outbox: [], now: NOW, config })

test('the open Advisor suggestions come from their group on the backlog, with their lines; a done one is left out', () => {
  const state = build(BACKLOG, '# Game plan\n\n## 1. The goal\nA tactics game.')
  assert.deepEqual(state.suggestions, [{
    id: 'B20',
    title: 'Make a unit template before the second unit (Advisor)',
    notes: [
      { title: 'Why', lines: ['the two units so far differ in how they are built.'], points: [] },
      { title: 'Cost', lines: ['about 1 h'], points: [] },
      { title: 'Unblocks', lines: ['every next unit.'], points: [] },
    ],
  }])
  assert.match(state.advice, /## 1\. The goal/)
  assert.equal(state.gamePlan, 'docs/game-plan.md')
  // No group yet, and no game plan yet.
  const empty = build('## Architecture\n- [ ] B10 Build the shop (for Units)\n')
  assert.deepEqual([empty.suggestions, empty.advice], [[], null])
})

const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
const [from, to] = [script.indexOf('// advisor:start'), script.indexOf('// advisor:end')]
const page = {}
vm.runInNewContext(`${script.slice(from, to)}\nObject.assign(this, { roundsLine, suggestionView })`, page)
const clockOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

test('the tab says when the rounds come, and a round left out in the last day with why', () => {
  const rounds = { morningRound: '09:00', weeklyRound: true, last: null }
  assert.equal(page.roundsLine(rounds, NOW, clockOf), 'Rounds from the board\'s clock: every day at 09:00, and a deep one right after the weekly limit resets; or ask it in the chat.')
  const skipped = { ...rounds, last: { skipped: { round: 'morning', at: new Date(2026, 9, 14, 9, 0).getTime(), why: 'the 5-hour limit is at 87%' } } }
  assert.match(page.roundsLine(skipped, NOW, clockOf), /The morning round at 09:00 was left out: the 5-hour limit is at 87%\.$/)
  assert.doesNotMatch(page.roundsLine(skipped, NOW + 25 * 60 * 60_000, clockOf), /left out/)
  assert.match(page.roundsLine({ morningRound: '', weeklyRound: false, last: null }, NOW, clockOf), /starts no rounds/)
  assert.equal(page.roundsLine(null, NOW, clockOf), '')
})

test('a suggestion reads as its id and title, then its lines', () => {
  const view = page.suggestionView({ id: 'B20', title: 'Make a unit template', notes: [{ title: 'Why', lines: ['two units differ'], points: [] }, { title: null, lines: ['More.'], points: ['A point'] }] })
  assert.deepEqual(JSON.parse(JSON.stringify(view)), { title: 'B20 Make a unit template', lines: ['Why: two units differ', 'More.', 'A point'] })
})
