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
import { SYNC_OPEN_MS, SYNC_SHOWN_MS, lastSyncAnswer as lastAnswerOf, syncChecks as checksOf, syncHead } from '../src/sync.mjs'
import { messageText } from '../src/bridge.mjs'

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 19, h, m).getTime()
const NOW = at(22, 50)

const lanes = [
  { name: 'Lead', isMain: true, isLeftover: false, state: 'working', task: null, queue: [] },
  // Shown free, with a step that waits on one that is finished.
  { name: 'Worker 1', isMain: false, isLeftover: false, isRunning: true, state: 'free', task: null, storeSteps: [], flags: [], queue: [{ id: 'B12', title: 'The quokkaberry', why: { reason: 'after', words: 'B11 (done)' } }] },
  // Paused for the limit, and the limit is back.
  { name: 'Worker 2', isMain: false, isLeftover: false, isRunning: false, state: 'suspended', suspended: { until: at(21, 40), isBack: true, by: 'note' }, task: { stepId: 'B20', text: 'The zebracorn "sings"', step: 2, steps: 5 }, storeSteps: [{ id: 'B20', title: 'The zebracorn sings', state: 'in progress' }], eta: { leftMs: 40 * MIN, isOver: false }, queue: [] },
  // Waiting for the person, while its ask went to the partner.
  { name: 'Worker 3', isMain: false, isLeftover: false, isRunning: true, state: 'waiting', task: { stepId: 'B30', text: 'The moonpie map' }, storeSteps: [{ id: 'B30', title: 'The moonpie map', state: 'waiting on you' }], flags: [{ kind: 'waits', text: 'Waits for you, but Q9 went to the partner' }], waitsForPartner: ['Q9'], queue: [{ id: 'B31', title: 'Next', why: { reason: 'you', worker: 'Worker 3' } }] },
  { name: 'Old', isMain: false, isLeftover: true, state: 'free', task: null, queue: [] },
]
const board = (sync = {}) => ({
  restart: { main: 'Lead' }, chats: lanes, changeAsks: { stop: {}, sync },
  forYou: [{ id: 'work:Q7', workId: 'Q7', from: 'Worker 3', canAnswer: true }, { id: 'work:Q6', workId: 'Q6', from: 'Worker 3', canAnswer: false, isForm: true },{ id: 'work:Q8', workId: 'Q8', from: 'Worker 1', canAnswer: false }],
  withPartner: [{ id: 'Q9', from: 'Worker 3' }],
  readyList: { ready: [{ id: 'B40', rank: 2, keptFor: null, keptUntil: null, pinned: null }, { id: 'B41', rank: 2, keptFor: 'Worker 3', keptUntil: null, pinned: 'Worker 3' }], held: [] },
  workFlags: ['B12 waits for B11, which is finished'],
  pause: { state: 'running', since: at(20, 0) },
  limits: { fiveHour: { used: 42, level: 'ok' }, week: { used: 61.4, level: 'ok' } },
})
const say = (body, state = board()) => checkSay({ to: 'Lead', ...body }, state, 2000)
// The main chat of these samples is Lead (B439: only its notes to the person answer a check).
const syncChecks = (sent, notes, abouts, now) => checksOf(sent, notes, abouts, now, 'Lead')
const lastSyncAnswer = (notes, about) => lastAnswerOf(notes, about, 'Lead')
const lines = message => message.text.split('\n')

test('a worker: the typed word is "check sync <name>" with what the board shows for that chat', () => {
  const one = say({ command: 'sync', chat: 'Worker 1' })
  assert.equal(one.ok, true)
  assert.deepEqual([one.message.command, one.message.about, one.message.to], ['sync', 'Worker 1', 'Lead'])
  assert.deepEqual(lines(one.message), [
    'check sync Worker 1',
    'State: free',
    'Running: yes',
    'Steps in the store: none',
    'Card: empty',
    'Queue: B12 (after B11 (done))',
    'Open asks: none',
    'Flags: none',
    'Pause: none',
    'Limits: 5-hour 42%, week 61%',
    'Why: the person pressed "Check now" on the worker board',
  ])

  const two = lines(say({ command: 'sync', chat: 'Worker 2' }).message)
  assert.ok(two.includes('Running: no'))
  assert.ok(two.includes('Steps in the store: B20 The zebracorn sings (in progress)'))
  assert.ok(two.includes('Card: B20 "The zebracorn sings", step 2 of 5, about 40 min left'), two.join('\n'))
  assert.ok(two.some(line => /^Pause: suspended for the limit until 21:40, the limit is back$/.test(line)), two.join('\n'))
  assert.ok(two.some(line => line.startsWith('State: suspended for the limit until 21:40')))

  const three = lines(say({ command: 'sync', chat: 'Worker 3' }).message)
  assert.ok(three.some(line => line.startsWith('State: waiting for you')))
  assert.ok(three.includes('Open asks: Q7 for you, Q6 in its chat, Q9 with the partner'), three.join('\n'))
  assert.ok(three.includes('Steps in the store: B30 The moonpie map (waiting on you)'))
  assert.ok(three.includes('Flags: Waits for you, but Q9 went to the partner'))
  assert.ok(three.includes('Queue: B31 (its worker waits for you)'))
})

test('the whole board: "check sync board" with a line per worker, the ready list, the flags, the pause and the limits', () => {
  const all = say({ command: 'sync', chat: 'board' })
  assert.equal(all.ok, true)
  assert.equal(all.message.about, 'board')
  const text = lines(all.message)
  assert.equal(text[0], 'check sync board')
  assert.ok(text.includes('Worker 1: free; store none; queue B12 (after B11 (done)); asks none'), text.join('\n'))
  assert.ok(text.some(line => line.startsWith('Worker 3: waiting for you') && line.includes('; store B30 (waiting on you); ')
    && line.endsWith('; asks Q7 for you, Q6 in its chat, Q9 with the partner; flags Waits for you, but Q9 went to the partner')), text.join('\n'))
  assert.ok(!text.some(line => line.startsWith('Lead:') || line.startsWith('Old:')), 'neither the main chat nor a leftover')
  assert.ok(text.includes('Ready for a worker: B40, B41 (pinned to Worker 3)'), text.join('\n'))
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

let notes = 0
const note = (text, since, extra = {}) => ({ id: `N${++notes}`, from: 'Lead', to: 'you', text, since, isRead: false, ...extra })
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

test('the review: an answer older than the ask never answers it, even in the same minute; a copied word is open too', () => {
  const old = note('Sync check of Worker 1: an earlier check, all fine.', at(22, 10))
  assert.equal(lastSyncAnswer([old, note('Sync check of Worker 2: other', at(22, 11))], 'Worker 1'), Number(old.id.slice(1)))
  assert.equal(lastSyncAnswer([], 'board'), 0)
  // Asked again at 22:10:40: the board kept the newest answer there was (`seen`), so the old one does not close it.
  const again = ask('Worker 1', 'delivered', at(22, 10) + 40_000, { deliveredAt: at(22, 10) + 41_000, seen: lastSyncAnswer([old], 'Worker 1') })
  const open = syncChecks([again], [old], ['Worker 1'], at(22, 12))['Worker 1']
  assert.deepEqual([open.isOpen, open.answer], [true, null])
  const fresh = note('Sync check of Worker 1: B12 unblocked.', at(22, 10))
  assert.equal(syncChecks([again], [old, fresh], ['Worker 1'], at(22, 12))['Worker 1'].answer.text, 'B12 unblocked.')
  // The word was only copied (no Workers mod took it): open while the person pastes it, as one that arrived.
  const copied = syncChecks([ask('Worker 1', 'copied', at(22, 0))], [], ['Worker 1'], at(22, 5))['Worker 1']
  assert.deepEqual([copied.state, copied.isOpen], ['copied', true])
})

test('B439: only the main chat\'s note to the person answers; the same head from a worker, or to the main chat, does not', () => {
  const sent = [ask('Worker 1', 'delivered', at(22, 40), { deliveredAt: at(22, 41) })]
  // The result check's probe: a worker's note to the main chat that starts with the head.
  const workerToMain = note('Sync check of Worker 1: a worker\'s own report', at(22, 44), { from: 'Worker 1', to: 'main' })
  const workerToYou = note('Sync check of Worker 1: a worker\'s note to the person', at(22, 45), { from: 'Worker 2' })
  const mainToMain = note('Sync check of Worker 1: the main chat to itself', at(22, 46), { to: 'main' })
  const others = [workerToMain, workerToYou, mainToMain]
  const open = syncChecks(sent, others, ['Worker 1'], NOW)['Worker 1']
  assert.deepEqual([open.isOpen, open.answer], [true, null])
  assert.equal(lastSyncAnswer(others, 'Worker 1'), 0)
  const answer = note('Sync check of Worker 1: all in sync.', at(22, 47))
  assert.equal(syncChecks(sent, [...others, answer], ['Worker 1'], NOW)['Worker 1'].answer.text, 'all in sync.')
  assert.equal(lastSyncAnswer([...others, answer], 'Worker 1'), Number(answer.id.slice(1)))
  // No main chat known: nothing answers.
  assert.equal(checksOf(sent, [answer], ['Worker 1'], NOW, null)['Worker 1'].answer, null)
  // The typed word keeps the newest of the main chat's answers only.
  assert.equal(say({ command: 'sync', chat: 'Worker 1' }, { ...board(), information: [...others, answer] }).message.seen, Number(answer.id.slice(1)))
  assert.equal(say({ command: 'sync', chat: 'Worker 1' }, { ...board(), information: others }).message.seen, 0)
})

test('the review: a lane carries the steps the store holds for it, whatever its card says', async () => {
  const { buildState } = await import('./withStore.mjs')
  const { parseConfig } = await import('../src/config.mjs')
  const PROJECT = 'C:\\game'
  const app = name => JSON.stringify({ title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN })
  const backlogText = ['## Meadows', '- [ ] B12 Fence the meadow (for Units; about 1 h) (branch feature/fence)', '  The herd walks off.', ''].join('\n')
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [app('Main'), app('Units')], tails: {}, planLineTexts: {}, backlogText, goalsText: null, adviceText: null, folders: null, askTexts: [], pictureLists: {} }
  const state = buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: PROJECT } })
  const units = state.chats.find(chat => chat.name === 'Units')
  assert.deepEqual(units.storeSteps.map(one => [one.id, one.title]), [['B12', 'Fence the meadow']])
  assert.match(units.storeSteps[0].state, /^(?:taken|in progress|waiting on you|review)$/)
  const words = checkSay({ to: 'Main', command: 'sync', chat: 'Units' }, state, 2000)
  assert.equal(words.ok, true)
  assert.ok(words.message.text.includes(`Steps in the store: B12 Fence the meadow (${units.storeSteps[0].state})`), words.message.text)
  assert.deepEqual(state.changeAsks.sync, {})
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const protocol = await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')
const main = await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')
const state = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')

test('the page: "Check now" (was "Out of sync?") in each worker\'s menu and in the Workers panel\'s head; the answer in the row', () => {
  assert.match(script, /const sync = syncPart\(lane, state\)\n\s+if \(sync !== null\) tools\.push\(sync\)/)
  assert.match(script, /send\(\{ to: main, command: 'sync', chat \}, `sync:\$\{chat\}`\)/)
  assert.match(script, /const syncLine = syncLineOf\(state\.changeAsks\?\.sync\?\.\[lane\.name\] \?\? null, main\)/)
  assert.match(script, /return checkNowButton\('board', state, /)
  // The supervisor: while its section shows, the head's button stands in the section instead.
  assert.match(script, /fill\(\$\('workers-add'\), \[lines, isSupervisorShown\(state\.supervisor \?\? null\) \? null : boardSyncButton\(state\), button\]\)/)
})

// The line under a worker's row (and under the panel's head), cut out of the page and run on its own.
const cut = (name) => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('times')}\n${cut('syncline')}\nthis.syncLineOf = syncLineOf`, page)

test('the line in the row: on its way, with the main chat, its answer, did not arrive, no answer in time', () => {
  const sentAt = at(22, 40)
  assert.equal(page.syncLineOf(null, 'Lead'), null)
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'waiting', isOpen: true, answer: null }, 'Lead') }, { tone: 'asked', text: 'Check now, 22:40: on its way to Lead.' })
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: true, answer: null }, 'Lead') }, { tone: 'asked', text: 'Check now, 22:40: Lead checks it and answers here.' })
  assert.deepEqual({ ...page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: false, answer: { at: at(22, 45), text: 'B12 waited on finished B11; unblocked it.' } }, 'Lead') },
    { tone: 'answer', text: 'Sync check, 22:45: B12 waited on finished B11; unblocked it.' })
  assert.equal(page.syncLineOf({ at: sentAt, state: 'expired', isOpen: false, answer: null }, 'Lead').tone, 'problem')
  assert.equal(page.syncLineOf({ at: sentAt, state: 'delivered', isOpen: false, answer: null }, 'Lead').text, 'Check now, 22:40: no answer from Lead yet; you can ask again.')
})

test('the main chat\'s role and the protocol name the word and the answer\'s form; the word is the board\'s, not feedback', () => {
  assert.ok(protocol.includes('`check sync <name>`'), 'protocol: the word')
  assert.ok(protocol.includes('`Sync check of <name>: ...`'), 'protocol: the answer')
  const role = main.replace(/\s+/g, ' ')
  for (const word of ['## Check sync', '`check sync <name>`', '`check sync board`', 'Sync check of <name>:', 'work unblock', 'work requeue', 'work withdraw', 'work new']) assert.ok(role.includes(word), `main: ${word}`)
  assert.match(state, /const BOARD_WORDS = \/\^\(\?:[^\n]*\|check sync\)/)
})

test('B465: the main chat gets the board\'s own list\'s answer with the check, at most twelve findings', () => {
  const syncList = {
    at: at(22, 49), asked: true, fine: 6,
    rows: [{ status: 'Fixed', text: 'B12 waited on B11, which is in review: unblocked' }, { status: 'For Main', text: 'B40 is blocked by B99, which the store does not hold' }],
  }
  const words = lines(say({ command: 'sync', chat: 'board' }, { ...board(), syncList }).message)
  assert.ok(words.includes('Board\'s own check (22:49): Fixed: B12 waited on B11, which is in review: unblocked · For Main: B40 is blocked by B99, which the store does not hold; 6 checks fine'), words.join('\n'))
  const many = { ...syncList, rows: Array.from({ length: 14 }, (_, i) => ({ status: 'Woke', text: `B${i} waited` })) }
  assert.match(lines(say({ command: 'sync', chat: 'Worker 1' }, { ...board(), syncList: many }).message).find(line => line.startsWith('Board\'s own check')), /· and 2 more; 6 checks fine$/)
  // Without the list's answer (the board's own list did not run), no line.
  assert.ok(!lines(say({ command: 'sync', chat: 'board' }).message).some(line => line.startsWith('Board\'s own check')))
})

// The supervisor (2026-10-24): the list's answer stands in the supervisor's section as its last check.
const supervisorPage = async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const page = { clock: ms => new Date(ms).toTimeString().slice(0, 5) }
  vm.runInNewContext(`${script.slice(script.indexOf('// supervisor:start'), script.indexOf('// supervisor:end'))}\nthis.supervisorOf = supervisorOf`, page)
  return run => (run === null ? null : { note: page.supervisorOf({ run, checkedAt: run.at, rules: [], incidents: [], lastSweep: null }).note, rows: page.supervisorOf({ run, rules: [], incidents: [] }).check.rows })
}

test('B465: the page shows the board\'s own check as in the agreed picture: a row per finding with its status, then the checks that found nothing', async () => {
  const script = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'board.js'), 'utf8')
  const page = { syncListOf: await supervisorPage() }
  const shown = page.syncListOf({
    at: at(0, 42), asked: true, fine: 2,
    rows: [{ status: 'Fixed', text: 'B46 was queued for Ghost, no longer in the list: queued for Worker 1' }, { status: 'Woke', text: 'Worker 2: its queued B55 waited 12 min while it was free' }, { status: 'Sent', text: 'B17: the person\'s yes to dropping it (Q158): to Main as a note' }, { status: 'For Main', text: 'Second is not running: 2 refines and checks wait: its work went to Partner' }],
  })
  assert.match(shown.note, /^Checked itself at 00:42\. /)
  // The page's arrays are of another realm (vm): compared as JSON.
  assert.equal(JSON.stringify(shown.rows.map(row => [row.status, row.tone])), JSON.stringify([['Fixed', 'done'], ['Woke', 'done'], ['Sent', 'done'], ['For Main', 'main'], ['Fine', 'fine']]))
  assert.equal(shown.rows.at(-1).text, '2 other checks: nothing stuck')
  assert.equal(page.syncListOf({ at: at(0, 42), asked: true, fine: 8, rows: [] }).rows[0].text, '8 checks: nothing stuck')
  assert.equal(page.syncListOf(null), null)
  // The page has its place under the Workers panel's head, and draws it every refresh.
  const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'), 'utf8')
  assert.match(html, /<\/header>\n\s*<section class="supervisor" id="supervisor" aria-label="The supervisor: the board's own check of itself" hidden><\/section>/)
  assert.match(script, /drawLanes\(state\)\n\s*drawSupervisor\(state\)/)
})

test('worktree clean-up: Cleaned and Left on the page, Left in a quiet tone; the main chat is not told what is only Left', async () => {
  const page = { syncListOf: await supervisorPage() }
  const rows = [{ status: 'Cleaned', text: '/projects/game-b5: a worktree of game on b5-lamps' }, { status: 'Left', text: '/projects/game-b410 (a worktree of game on b410-hero): held by B410' }]
  const shown = page.syncListOf({ at: at(0, 42), asked: true, fine: 8, rows })
  assert.equal(JSON.stringify(shown.rows.map(row => [row.status, row.tone])), JSON.stringify([['Cleaned', 'done'], ['Left', 'fine'], ['Fine', 'fine']]))
  assert.equal(shown.rows.at(-1).text, '8 other checks: nothing stuck')
  // Only Left: every check is fine, so no "other".
  assert.equal(page.syncListOf({ at: at(0, 42), asked: true, fine: 9, rows: rows.slice(1) }).rows.at(-1).text, '9 checks: nothing stuck')
  const words = lines(say({ command: 'sync', chat: 'board' }, { ...board(), syncList: { at: at(22, 49), asked: true, fine: 8, rows } }).message)
  assert.ok(words.includes('Board\'s own check (22:49): Cleaned: /projects/game-b5: a worktree of game on b5-lamps; 8 checks fine'), words.join('\n'))
})
