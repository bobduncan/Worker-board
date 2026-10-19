// B438: "Out of sync?" (the person, 2026-10-19, I43: "I want an help/alert button, where i believe the board and the
// worker is out of sync, i press the new button and somebody goes to investigate it and fix it."). A button in each
// worker's menu, and one in the Workers panel's head, types `check sync <name>` (or `check sync board`) into the main
// chat with what the board shows; the main chat checks and fixes, and answers with a note to the person that starts
// `Sync check of <name>:`, which the board shows in that worker's row. The examples are the three cases of that day:
// a worker shown free with a step blocked by a finished one, a worker paused for the limit and never woken, and a step
// shown "waiting for you" whose ask went to the partner. Made-up samples only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { checkSay } from '../src/say.mjs'
import { SYNC_OPEN_MS, SYNC_SHOWN_MS, syncChecks, syncHead } from '../src/sync.mjs'
import { messageText } from '../src/bridge.mjs'

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 19, h, m).getTime()
const NOW = at(22, 50)

const lanes = [
  { name: 'Lead', isMain: true, isLeftover: false, state: 'working', task: null, queue: [] },
  // Shown free, with a step that waits on one that is finished.
  { name: 'Worker 1', isMain: false, isLeftover: false, isRunning: true, state: 'free', task: null, givenTask: null, queue: [{ id: 'B12', title: 'The quokkaberry', why: { reason: 'after', words: 'B11 (done)' } }] },
  // Paused for the limit, and the limit is back.
  { name: 'Worker 2', isMain: false, isLeftover: false, isRunning: false, state: 'suspended', suspended: { until: at(21, 40), isBack: true, by: 'note' }, task: { stepId: 'B20', text: 'The zebracorn "sings"', step: 2, steps: 5 }, givenTask: { by: 'step', step: { id: 'B20', title: 'The zebracorn sings' } }, eta: { leftMs: 40 * MIN, isOver: false }, queue: [] },
  // Waiting for the person, while its ask went to the partner.
  { name: 'Worker 3', isMain: false, isLeftover: false, isRunning: true, state: 'waiting', task: { stepId: 'B30', text: 'The moonpie map' }, givenTask: { by: 'step', step: { id: 'B30', title: 'The moonpie map' } }, waitsForPartner: ['Q9'], queue: [{ id: 'B31', title: 'Next', why: { reason: 'you', worker: 'Worker 3' } }] },
  { name: 'Old', isMain: false, isLeftover: true, state: 'free', task: null, queue: [] },
]
const board = (sync = {}) => ({
  restart: { main: 'Lead' }, chats: lanes, changeAsks: { stop: {}, sync },
  forYou: [{ id: 'work:Q7', workId: 'Q7', from: 'Worker 3', canAnswer: true }, { id: 'work:Q8', workId: 'Q8', from: 'Worker 1', canAnswer: false }],
  withPartner: [{ id: 'Q9', from: 'Worker 3' }],
  unassigned: [{ id: 'B40', title: 'Nobody has it', why: { reason: 'nobody' } }],
  workFlags: ['B12 waits for B11, which is finished'],
  pause: { state: 'running', since: at(20, 0) },
  limits: { fiveHour: { used: 42, level: 'ok' }, week: { used: 61.4, level: 'ok' } },
})
const say = (body, state = board()) => checkSay({ to: 'Lead', ...body }, state, 2000)
const lines = message => message.text.split('\n')

test('a worker: the typed word is "check sync <name>" with what the board shows for that chat', () => {
  const one = say({ command: 'sync', chat: 'Worker 1' })
  assert.equal(one.ok, true)
  assert.deepEqual([one.message.command, one.message.about, one.message.to], ['sync', 'Worker 1', 'Lead'])
  assert.deepEqual(lines(one.message), [
    'check sync Worker 1',
    'State: free',
    'Running: yes',
    'Step in the store: none',
    'Card: empty',
    'Queue: B12 (after B11 (done))',
    'Open asks: none',
    'Pause: none',
    'Limits: 5-hour 42%, week 61%',
    'Why: the person pressed "Out of sync?" on the worker board',
  ])

  const two = lines(say({ command: 'sync', chat: 'Worker 2' }).message)
  assert.ok(two.includes('Running: no'))
  assert.ok(two.includes('Step in the store: B20 The zebracorn sings'))
  assert.ok(two.includes('Card: "The zebracorn sings", step 2 of 5, about 40 min left'), two.join('\n'))
  assert.ok(two.some(line => /^Pause: suspended for the limit until 21:40, the limit is back$/.test(line)), two.join('\n'))
  assert.ok(two.some(line => line.startsWith('State: suspended for the limit until 21:40')))

  const three = lines(say({ command: 'sync', chat: 'Worker 3' }).message)
  assert.ok(three.some(line => line.startsWith('State: waiting for you')))
  assert.ok(three.includes('Open asks: Q7 for you, Q9 with the partner'), three.join('\n'))
  assert.ok(three.includes('Queue: B31 (its worker waits for you)'))
})

test('the whole board: "check sync board" with a line per worker, the steps nobody has, the flags, the pause and the limits', () => {
  const all = say({ command: 'sync', chat: 'board' })
  assert.equal(all.ok, true)
  assert.equal(all.message.about, 'board')
  const text = lines(all.message)
  assert.equal(text[0], 'check sync board')
  assert.ok(text.includes('Worker 1: free; queue B12 (after B11 (done)); asks none'), text.join('\n'))
  assert.ok(text.some(line => line.startsWith('Worker 3: waiting for you') && line.endsWith('; asks Q7 for you, Q9 with the partner')), text.join('\n'))
  assert.ok(!text.some(line => line.startsWith('Lead:') || line.startsWith('Old:')), 'neither the main chat nor a leftover')
  assert.ok(text.includes('Not handed out: B40 (no worker)'))
  assert.ok(text.includes('Board flags: B12 waits for B11, which is finished'))
  assert.ok(text.includes('Pause: none'))
  assert.ok(text.includes('Limits: 5-hour 42%, week 61%'))
  const pausing = lines(say({ command: 'sync', chat: 'board' }, { ...board(), pause: { state: 'pausing', since: at(22, 0) }, limits: { fiveHour: null, week: { used: 100, level: 'full' } } }).message)
  assert.ok(pausing.includes('Pause: the board pauses all chats (since 22:00)'), pausing.join('\n'))
  assert.ok(pausing.includes('Limits: 5-hour unknown, week 100% (full)'))
})

test('what the board refuses: no such worker, the main chat, a leftover, one open check at a time, words with it, another chat', () => {
  assert.equal(say({ command: 'sync', chat: 'Nobody' }).status, 409)
  assert.equal(say({ command: 'sync', chat: 'Lead' }).status, 409, 'the main chat checks the board, not itself')
  assert.equal(say({ command: 'sync', chat: 'Old' }).status, 409)
  assert.equal(say({ command: 'sync', chat: 'Worker 1' }, board({ 'Worker 1': { isOpen: true } })).status, 409)
  assert.equal(say({ command: 'sync', chat: 'board' }, board({ board: { isOpen: true } })).status, 409)
  assert.equal(say({ command: 'sync', chat: 'Worker 2' }, board({ 'Worker 1': { isOpen: true } })).ok, true, 'another worker may be checked meanwhile')
  assert.equal(say({ command: 'sync', chat: 'Worker 1', text: 'more' }).status, 400)
  assert.equal(checkSay({ to: 'Worker 1', command: 'sync', chat: 'Worker 2' }, board(), 2000).status, 400)
})

test('typed as the person\'s word, marked as coming from the board', () => {
  const message = say({ command: 'sync', chat: 'Worker 1' }).message
  const typed = messageText({ ...message, at: NOW }, () => '22:50')
  assert.ok(typed.startsWith('check sync Worker 1\n'))
  assert.ok(typed.endsWith('\n(typed on the worker board, 22:50)'))
})

const note = (text, since, extra = {}) => ({ id: 'N1', from: 'Lead', to: 'you', text, since, isRead: false, ...extra })
const ask = (about, state, sentAt, extra = {}) => ({ command: 'sync', about, state, at: sentAt, ...extra })

test('the main chat\'s answer: a note to the person that starts "Sync check of <name>:", after the ask', () => {
  assert.equal(syncHead('Worker 1'), 'Sync check of Worker 1:')
  assert.equal(syncHead('board'), 'Sync check of the board:')
  const sent = [ask('Worker 1', 'delivered', at(22, 40), { deliveredAt: at(22, 41) }), ask('board', 'waiting', at(22, 49))]
  const notes = [
    note('Sync check of Worker 1: B12 waited on finished B11; unblocked it, Worker 1 took it.', at(22, 45)),
    note('Sync check of Worker 1: an older answer', at(22, 30)),
    note('Sync check of Worker 2: not asked', at(22, 45)),
  ]
  const checks = syncChecks(sent, notes, ['Worker 1', 'Worker 2', 'board'], NOW)
  assert.deepEqual(checks['Worker 1'], { at: at(22, 40), state: 'delivered', isOpen: false, answer: { at: at(22, 45), text: 'B12 waited on finished B11; unblocked it, Worker 1 took it.' } })
  assert.equal(checks['Worker 2'], undefined, 'no ask: nothing to show')
  assert.deepEqual(checks.board, { at: at(22, 49), state: 'waiting', isOpen: true, answer: null })
})

test('open while on its way and after it arrived until the answer, at most half an hour; shown an hour, then left out', () => {
  const sentAt = at(21, 0)
  const delivered = ask('Worker 1', 'delivered', sentAt, { deliveredAt: sentAt })
  assert.equal(syncChecks([delivered], [], ['Worker 1'], sentAt + SYNC_OPEN_MS - MIN)['Worker 1'].isOpen, true)
  const late = syncChecks([delivered], [], ['Worker 1'], sentAt + SYNC_OPEN_MS + MIN)['Worker 1']
  assert.deepEqual([late.isOpen, late.answer], [false, null], 'no answer in time: it may be asked again')
  assert.equal(syncChecks([delivered], [], ['Worker 1'], sentAt + SYNC_SHOWN_MS + MIN)['Worker 1'], undefined)
  const answered = [note('Sync check of Worker 1: all in sync.', sentAt + 10 * MIN)]
  assert.equal(syncChecks([delivered], answered, ['Worker 1'], sentAt + 10 * MIN + SYNC_SHOWN_MS - MIN)['Worker 1'].answer.text, 'all in sync.')
  assert.equal(syncChecks([delivered], answered, ['Worker 1'], sentAt + 10 * MIN + SYNC_SHOWN_MS + MIN)['Worker 1'], undefined)
  // An answer written in the minute of the ask counts (the store keeps minutes).
  const same = [note('Sync check of Worker 1: same minute.', Math.floor(sentAt / MIN) * MIN)]
  assert.equal(syncChecks([ask('Worker 1', 'delivered', sentAt + 20_000)], same, ['Worker 1'], sentAt + MIN)['Worker 1'].answer.text, 'same minute.')
  // A word that did not reach the main chat stays shown as such, closed.
  const failed = syncChecks([ask('Worker 1', 'expired', sentAt)], [], ['Worker 1'], sentAt + 5 * MIN)['Worker 1']
  assert.deepEqual([failed.state, failed.isOpen], ['expired', false])
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const protocol = await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')
const main = await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')
const state = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')

test('the page: "Out of sync?" in each worker\'s menu and in the Workers panel\'s head; the answer in the row', () => {
  assert.match(script, /const sync = syncPart\(lane, state\)\n\s+if \(sync !== null\) tools\.push\(sync\)/)
  assert.match(script, /send\(\{ to: main, command: 'sync', chat \}, `sync:\$\{chat\}`\)/)
  assert.match(script, /const syncLine = syncLineOf\(state\.changeAsks\?\.sync\?\.\[lane\.name\] \?\? null, main\)/)
  assert.match(script, /return syncButton\('board', state, /)
  assert.match(script, /fill\(\$\('workers-add'\), \[lines, boardSyncButton\(state\), button\]\)/)
})

// The line under a worker's row (and under the panel's head), cut out of the page and run on its own.
const cut = (name) => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('times')}\n${cut('syncline')}\nthis.syncLineOf = syncLineOf`, page)

test('the line in the row: on its way, with the main chat, its answer, did not arrive, no answer in time', () => {
  const sentAt = at(22, 40)
  assert.equal(page.syncLineOf(null, 'Lead'), null)
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'waiting', isOpen: true, answer: null }, 'Lead') }, { tone: 'asked', text: 'Out of sync? asked at 22:40: on its way to Lead.' })
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: true, answer: null }, 'Lead') }, { tone: 'asked', text: 'Out of sync? asked at 22:40: Lead checks it and answers here.' })
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: false, answer: { at: at(22, 45), text: 'B12 waited on finished B11; unblocked it.' } }, 'Lead') },
    { tone: 'answer', text: 'Sync check, 22:45: B12 waited on finished B11; unblocked it.' })
  assert.equal(page.syncLineOf({ at: sentAt, state: 'expired', isOpen: false, answer: null }, 'Lead').tone, 'problem')
  assert.equal(page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: false, answer: null }, 'Lead').text, 'Out of sync? asked at 22:40: no answer from Lead yet; you can ask again.')
})

test('the main chat\'s role and the protocol name the word and the answer\'s form; the word is the board\'s, not feedback', () => {
  assert.ok(protocol.includes('`check sync <name>`'), 'protocol: the word')
  assert.ok(protocol.includes('`Sync check of <name>: ...`'), 'protocol: the answer')
  const role = main.replace(/\s+/g, ' ')
  for (const word of ['## Check sync', '`check sync <name>`', '`check sync board`', 'Sync check of <name>:', 'work unblock', 'work requeue', 'work withdraw', 'work new']) assert.ok(role.includes(word), `main: ${word}`)
  assert.match(state, /const BOARD_WORDS = \/\^\(\?:[^\n]*\|check sync\)/)
})
