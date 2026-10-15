// B195: the way to the next milestone on the Advisor tab. The Advisor writes a map (JSON) in the game's repository;
// the board counts each step against the backlog and shows a recommendation the person answers yes or no. The
// person, 2026-10-14: "the main tab only shows some visual simplistic flow of where we roughly are till the next
// milestone, looking an the backlog whats already there or whats missing". Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, typed } from '../fixtures/lines.mjs'
import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseBacklog } from '../src/backlog.mjs'
import { milestoneWay, parseMilestoneMap } from '../src/milestone.mjs'
import { checkSay } from '../src/say.mjs'
import { buildState } from '../src/state.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 14, 16, 0)
const PROJECT = 'C:\\game'

const BACKLOG = [
  '## Work',
  '- [x] B01 Play a whole level',
  '- [x] B02 Win a fight',
  '- [ ] B03 See what each enemy plans next',
  '- [ ] B04 Pick from more rewards',
  '- [ ] B05 Play two runs and judge them',
  '',
].join('\n')

const MAP = {
  updated: '2026-10-14',
  milestone: { name: 'M1', title: 'The loop is fun', doneWhen: 'two runs played, and fun', check: 'Play two runs: fun?', backlog: ['B05'], missing: [] },
  steps: [
    { title: 'Play a whole run', backlog: ['B01', 'B02'], missing: [] },
    { title: "See every enemy's next move", backlog: ['B03', 'B99'], missing: ['The outcome preview'] },
    { title: 'Pick from twelve rewards', backlog: ['B04'], missing: [] },
    { title: 'Try undo', backlog: [], missing: ['Undo a turn', 'Undo an action'] },
  ],
  recommendation: { id: 'r1', title: 'Build the outcome preview first', why: 'Three steps stand on it.', cost: 'About 2 hours.' },
}

// The map and the counts

test('a map is read with its parts; anything that is no map is null', () => {
  const map = parseMilestoneMap(JSON.stringify(MAP))
  assert.equal(map.milestone.title, 'The loop is fun')
  assert.equal(map.steps.length, 4)
  assert.deepEqual(map.recommendation, { id: 'r1', title: 'Build the outcome preview first', why: 'Three steps stand on it.', step: null, cost: 'About 2 hours.' })
  for (const raw of ['', 'not json', '[]', 'null', JSON.stringify({ ...MAP, steps: [] }), JSON.stringify({ ...MAP, milestone: {} })]) assert.equal(parseMilestoneMap(raw), null, raw)
  // Ids are ids, lines are one line, a recommendation without an id is known by its title.
  const odd = parseMilestoneMap(JSON.stringify({ ...MAP, steps: [{ title: 'A\n step', backlog: ['B7', 'x', 12], missing: ['two\nlines', ''] }], recommendation: { title: 'Do it', step: 'B7' } }))
  assert.deepEqual(odd.steps, [{ title: 'A step', backlog: ['B7'], missing: ['two lines'] }])
  assert.deepEqual([odd.recommendation.id, odd.recommendation.step], ['Do it', 'B7'])
  // At most eight steps.
  assert.equal(parseMilestoneMap(JSON.stringify({ ...MAP, steps: Array.from({ length: 12 }, (_, n) => ({ title: `Step ${n}` })) })).steps.length, 8)
})

test('each step is counted against the backlog as it stands, the milestone\'s own check last', () => {
  const way = milestoneWay(parseMilestoneMap(JSON.stringify(MAP)), parseBacklog(BACKLOG))
  assert.deepEqual(way.nodes.map(node => [node.title, node.done, node.open, node.missing.length, node.left, node.state, node.isGoal]), [
    ['Play a whole run', 2, 0, 0, 0, 'done', false],
    // An id that is not on the backlog counts as missing.
    ["See every enemy's next move", 0, 1, 2, 3, 'none', false],
    ['Pick from twelve rewards', 0, 1, 0, 1, 'none', false],
    ['Try undo', 0, 0, 2, 2, 'none', false],
    ['Play two runs: fun?', 0, 1, 0, 1, 'none', true],
  ])
  assert.deepEqual(way.nodes[1].missing, ['The outcome preview', 'B99, not on the backlog'])
  assert.deepEqual(way.totals, { done: 2, open: 3, missing: 4, left: 7 })
  // A step with nothing listed is not done; an id counts once, in the first step that names it.
  const odd = milestoneWay(parseMilestoneMap(JSON.stringify({ ...MAP, steps: [{ title: 'Empty' }, { title: 'Twice', backlog: ['B01', 'B01', 'B03'] }, { title: 'Again', backlog: ['B03', 'B99', 'B99'] }] })), parseBacklog(BACKLOG))
  assert.deepEqual(odd.nodes.map(node => [node.title, node.done, node.open, node.missing, node.state]), [
    ['Empty', 0, 0, [], 'none'],
    ['Twice', 1, 1, [], 'part'],
    ['Again', 0, 0, ['B99, not on the backlog'], 'none'],
    ['Play two runs: fun?', 0, 1, [], 'none'],
  ])
  assert.deepEqual(odd.totals, { done: 1, open: 2, missing: 1, left: 3 })
  // A step ticked since the map was written counts as done at once.
  const later = milestoneWay(parseMilestoneMap(JSON.stringify(MAP)), parseBacklog(BACKLOG.replace('- [ ] B04', '- [x] B04')))
  assert.deepEqual([later.nodes[2].state, later.totals.left], ['done', 6])
})

// The board's state and the answer

const config = { ...parseConfig('{}', {}), project: PROJECT }
const LIST = '{"prefix":"Studio · ","main":"Lead"}'
const CHATS = ['Lead', 'Worker 1', 'Advisor']
const app = name => JSON.stringify({
  title: `Studio · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false,
  createdAt: NOW - 2 * HOUR, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1',
})
const rested = { text: [typed(NOW - 30 * MIN, 'Zebracorn'), answer(NOW - 29 * MIN, 'Done.')].join('\n'), isCut: false, modifiedAt: NOW }

function build({ outbox = [], map = MAP } = {}) {
  const raw = {
    listText: LIST, appChatTexts: CHATS.map(app), tails: Object.fromEntries(CHATS.map(name => [`cli-${name}`, rested])),
    planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {},
    milestoneText: map === null ? null : JSON.stringify(map),
  }
  const seen = { shown: Object.fromEntries(CHATS.map(name => [name, NOW - 5000])), other: {} }
  return buildState(raw, { lines: [], outbox, runs: [], board: { startedAt: NOW - 10 * MIN, offSince: null }, seen, now: NOW, config })
}
const said = (answerWord, more = {}) => ({ id: 'm1', at: NOW - MIN, to: answerWord === 'yes' ? 'Lead' : 'Advisor', ask: null, step: null, title: null, verdict: null, command: 'recommend', about: 'r1', answer: answerWord, text: '', state: 'delivered', deliveredAt: NOW - MIN + 5000, ...more })

test('the state holds the way, its map\'s path, and the answer to its recommendation once given', () => {
  const state = build()
  assert.equal(state.milestoneMap, 'docs/advisor/milestone-map.json')
  assert.equal(state.milestone.totals.left, 7)
  assert.equal(state.milestone.recommendation.answer, null)
  assert.deepEqual(build({ outbox: [said('yes')] }).milestone.recommendation.answer, { answer: 'yes', at: NOW - MIN, state: 'delivered' })
  // An answer that did not arrive does not count; one to an earlier recommendation neither.
  assert.equal(build({ outbox: [said('yes', { state: 'expired' })] }).milestone.recommendation.answer, null)
  assert.equal(build({ outbox: [said('yes', { about: 'r0' })] }).milestone.recommendation.answer, null)
  assert.equal(build({ map: null }).milestone, null)
})

test('yes goes to the main chat and no, with a reason, to the Advisor, in the board\'s own words', () => {
  const state = build()
  const yes = checkSay({ to: 'Lead', command: 'recommend', about: 'r1', answer: 'yes' }, state, 2000)
  assert.equal(yes.message.text, 'advisor recommendation: yes\nRecommended: Build the outcome preview first\nWhy: Three steps stand on it.')
  assert.deepEqual([yes.message.to, yes.message.command, yes.message.about, yes.message.answer], ['Lead', 'recommend', 'r1', 'yes'])
  assert.equal(messageText({ ...yes.message, at: NOW }, () => '16:00').split('\n').at(-1), '(typed on the worker board, 16:00)')
  const no = checkSay({ to: 'Advisor', command: 'recommend', about: 'r1', answer: 'no', reason: ' Not now,\nlater. ' }, state, 2000)
  assert.equal(no.message.text, 'advisor recommendation: no\nRecommended: Build the outcome preview first\nReason: Not now, later.')
  // A recommendation that names its backlog step says so.
  const named = checkSay({ to: 'Lead', command: 'recommend', about: 'r1', answer: 'yes' }, build({ map: { ...MAP, recommendation: { ...MAP.recommendation, step: 'B03', why: '' } } }), 2000)
  assert.equal(named.message.text, 'advisor recommendation: yes\nRecommended: Build the outcome preview first\nStep: B03')
})

test('an answer goes to the right chat, about the recommendation that stands, once', () => {
  const state = build()
  const status = body => checkSay({ command: 'recommend', about: 'r1', ...body }, state, 2000).status
  assert.equal(status({ to: 'Advisor', answer: 'yes' }), 400)
  assert.equal(status({ to: 'Lead', answer: 'no', reason: 'x' }), 400)
  assert.equal(status({ to: 'Advisor', answer: 'no' }), 400)
  assert.equal(status({ to: 'Advisor', answer: 'no', reason: 'x'.repeat(1001) }), 400)
  assert.equal(status({ to: 'Lead', answer: 'maybe' }), 400)
  assert.equal(status({ to: 'Lead', answer: 'yes', about: 'r0' }), 409)
  assert.equal(status({ to: 'Lead', answer: 'yes', text: 'and more' }), 400)
  assert.equal(checkSay({ to: 'Lead', command: 'recommend', about: 'r1', answer: 'yes' }, build({ outbox: [said('no')] }), 2000).status, 409)
  assert.equal(checkSay({ to: 'Lead', command: 'recommend', about: 'r1', answer: 'yes' }, build({ map: null }), 2000).status, 409)
})

test('an answer stays known long after it arrived, so the recommendation is never answered twice', async () => {
  const { outboxNow } = await import('../src/store.mjs')
  const keep = { messageMs: 10 * MIN, answerMs: 24 * HOUR }
  const old = said('yes', { at: NOW - 30 * HOUR, deliveredAt: NOW - 30 * HOUR })
  assert.equal(outboxNow([old], NOW, keep).length, 1)
  assert.equal(checkSay({ to: 'Advisor', command: 'recommend', about: 'r1', answer: 'no', reason: 'x' }, build({ outbox: [old] }), 2000).status, 409)
})

test('a "no" for an Advisor whose chat is not running wakes it through the main chat', async () => {
  const { wakeFor } = await import('../src/say.mjs')
  const state = build()
  const asleep = { ...state, chats: state.chats.map(chat => (chat.name === 'Advisor' ? { ...chat, isRunning: false } : chat)), advisor: state.advisor === null ? null : { ...state.advisor, isRunning: false, appSession: 'local_Advisor' } }
  const { message } = checkSay({ to: 'Advisor', command: 'recommend', about: 'r1', answer: 'no', reason: 'x' }, state, 2000)
  const wake = wakeFor(message, asleep, [], NOW, 2000)
  assert.equal(wake?.command, 'start')
  assert.equal(wake?.about, 'Advisor')
})

// The page

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const html = await readFile(join(PUBLIC, 'index.html'), 'utf8')

test('the page: the Advisor tab in four parts under their buttons, the way first; no tab of its own for the chat', () => {
  assert.match(html, /data-tab="advice"><span class="tab-long">Advisor<\/span><span class="tab-short">Advisor<\/span><\/button>/)
  assert.deepEqual([...html.matchAll(/data-advisor-pane="(\w+)"/g)].map(found => found[1]), ['way', 'goals', 'plan', 'suggestions', 'chat'])
  assert.equal((html.match(/class="tab[^"]*" type="button" data-tab=/g) ?? []).length, 4)
  assert.match(script, /const pane = ADVISOR_PANES\.includes\(name\) \? name : 'way'/)
  // The answers: yes to the main chat, no with its reason to the Advisor; the way is drawn anew while one is sent.
  assert.match(script, /send\(\{ to: board\.workers\.main, command: 'recommend', about: rec\.id, answer: 'yes' \}, 'recommend'\)/)
  assert.match(script, /send\(\{ to: board\.advisor\.name, command: 'recommend', about: rec\.id, answer: 'no', reason: wayReason\.trim\(\) \}, 'recommend'\)/)
  assert.match(script, /once\('way', \[state\.milestone \?\? null, state\.milestoneMap \?\? null, state\.workers\?\.main \?\? null, state\.advisor\?\.name \?\? null, sending\.has\('recommend'\), problems\.get\('recommend'\) \?\? null\], \(\) => drawWay\(state\)\)/)
})
