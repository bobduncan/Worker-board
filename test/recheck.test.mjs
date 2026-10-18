// B288: a button on the Advisor tab's Next milestone part types a round into the Advisor's chat on the person's
// request, marked as their word (not the clock's line), and is off while a round runs. Goal G17. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { isClockLine, recheckText } from '../src/rounds.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 17, 20, 30)
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'

const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

/** The Advisor at work on a turn that began at `at`. */
const working = at => ({ text: [typed(at, 'Go'), step(at + 30_000, 'Read the plan')].join('\n'), isCut: false, modifiedAt: NOW })

function build({ outbox = [], chats = ['Lead', 'Advisor'], advisor = rested } = {}) {
  const raw = {
    listText: LIST,
    appChatTexts: chats.map(app),
    tails: Object.fromEntries(chats.map(name => [`cli-${name}`, name === 'Advisor' ? advisor : rested])),
    planLineTexts: {}, backlogText: '## Work\n- [ ] B10 Build the tower\n', adviceText: null, folders: null, askTexts: [], pictureLists: {},
  }
  const seen = { shown: Object.fromEntries(chats.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}

const BASE = { ask: null, step: null, title: null, version: null, verdict: null, to: 'Advisor' }
const sent = (command, at, state, more = {}) => ({ id: `${command}${at}`, at, ...BASE, command, text: 'words', state, ...more })

test('the words: a round now, on the person\'s request, with the job and the project\'s settings', () => {
  const text = recheckText({ board: 'C:\\board', config })
  assert.equal(text.split('\n')[0], 're-check the goals')
  assert.match(text, /bring the way to the next milestone and the goal map up to date/)
  assert.match(text, /Your job: C:\\board[\\/]roles[\\/]partner\.md/)
  // Never the clock's line: it is the person's word.
  assert.equal(isClockLine(text), false)
  assert.doesNotMatch(text, /board's clock/)
})

test('it goes to the Advisor marked as typed on the board, as the person\'s word', () => {
  const checked = checkSay({ to: 'Advisor', command: 'recheck' }, build(), 2000)
  assert.equal(checked.ok, true)
  assert.equal(checked.message.command, 'recheck')
  assert.match(messageText({ ...checked.message, at: NOW }, () => '20:30'), /\n\(typed on the worker board, 20:30\)$/)
})

test('only to the Advisor, only when there is one, and carrying nothing else', () => {
  assert.equal(checkSay({ to: 'Lead', command: 'recheck' }, build(), 2000).status, 400)
  assert.equal(checkSay({ to: 'Advisor', command: 'recheck' }, build({ chats: ['Lead'] }), 2000).status, 400)
  assert.equal(checkSay({ to: 'Advisor', command: 'recheck', text: 'and more' }, build(), 2000).status, 400)
})

test('off while a round runs: one on its way, or one the Advisor is still working on', () => {
  assert.equal(build().advisor.roundRuns, false)
  for (const message of [sent('round', NOW - MIN, 'waiting'), sent('recheck', NOW - MIN, 'taken')]) {
    const state = build({ outbox: [message] })
    assert.equal(state.advisor.roundRuns, true, message.command)
    assert.deepEqual(checkSay({ to: 'Advisor', command: 'recheck' }, state, 2000), { ok: false, status: 409, why: 'A round runs: wait until the Advisor has finished it.' })
  }
  // Arrived and the Advisor rests: the round is over.
  assert.equal(build({ outbox: [sent('round', NOW - 20 * MIN, 'delivered', { deliveredAt: NOW - 19 * MIN })] }).advisor.roundRuns, false)
})

test('a round runs while the Advisor works on the turn it began, not on a later one, and not for ever', () => {
  const round = sent('recheck', NOW - 20 * MIN, 'delivered', { deliveredAt: NOW - 19 * MIN })
  // The turn began with the round: it runs.
  assert.equal(build({ outbox: [round], advisor: working(NOW - 19 * MIN) }).advisor.roundRuns, true)
  // A turn begun well after it (a refine, the person's words) is another: the button is on again.
  assert.equal(build({ outbox: [round], advisor: working(NOW - 5 * MIN) }).advisor.roundRuns, false)
  // An hour after it arrived, whatever the card says.
  const old = sent('recheck', NOW - 70 * MIN, 'delivered', { deliveredAt: NOW - 61 * MIN })
  assert.equal(build({ outbox: [old], advisor: working(NOW - 61 * MIN) }).advisor.roundRuns, false)
  // Just arrived, before its turn shows: it runs.
  assert.equal(build({ outbox: [sent('recheck', NOW - 2 * MIN, 'delivered', { deliveredAt: NOW - MIN })] }).advisor.roundRuns, true)
  // Taken and never typed: off again after ten minutes.
  assert.equal(build({ outbox: [sent('round', NOW - 30 * MIN, 'taken', { takenAt: NOW - 25 * MIN })] }).advisor.roundRuns, false)
})

test('the page: the button stands in the Next milestone part, sends the word, and is off while a round runs', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const part = script.slice(script.indexOf('function recheckPart('), script.indexOf('// recheck:end'))
  assert.match(part, /button\.dataset\.recheck = 'yes'/)
  assert.match(part, /button\.disabled = runs \|\| sending\.has\('recheck'\)/)
  assert.match(part, /Re-check the goals now/)
  assert.match(script, /send\(\{ to: advisor, command: 'recheck' \}, 'recheck'\)/)
  assert.match(script, /once\('way', \[[^\]]*state\.advisor\?\.roundRuns \?\? null, sending\.has\('recheck'\), problems\.get\('recheck'\) \?\? null\]/)
})
