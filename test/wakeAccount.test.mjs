// 2026-11-05 (G+H, the lead's order): a failed wake is tried again when the chat is listed again, and an account switch is
// said plainly. The real case of the evening is the fixture (fixtures/wake-account, trimmed copies, no secrets): at ~20:25
// the person switched Claude accounts; the app keeps one chat list per account, the board read only the newer folder, and
// "Worker 1" and "Worker 5" were stale copies there. At 20:33:30 Main's hand sent a message and the app answered "session
// local_e92c96e7... not found"; at ~21:20 the app was back (the Advisor's report carried the new run 1793910017329) and
// nothing tried the two chats again. Worker 2's launch at 20:30 made a stub chat (local_8f2378dd) that took the real
// chat's place, and its clear chain was longer than the eight cards the board followed.

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { boardChats, parseAppChat, readAppChats } from '../src/appChats.mjs'
import { OTHER_ACCOUNT_WHY, RESTART_WHY, keptFor, ownChatOf, wakeIdsOf } from '../src/ownChat.mjs'
import { followMoves } from '../src/sources.mjs'
import {
  claim, emptyWakes, failedToSend, noteRun, nextPath, noticeOf, pathsOf, reopenSpells, statusOf, textOfWakes, wakeOf, wakesOfFile,
} from '../src/wake.mjs'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'wake-account')
const readFixture = async name => readFile(join(FIXTURES, name), 'utf8')
const timeOf = ms => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`

const W1_SPELL = 1793862907591
const W5_SPELL = 1793862908033
const W2_SPELL = 1793862907836
/** The Advisor's report at 21:20:17: a new run, so the app was back. */
const RUN_BACK = 1793910017329
const VERDICT_2033 = 1793907210941
const LIVE = '50354b4d-4eb9-4f38-8f6a-0123456789ab'
const FILE = '83f91f67-b4f9-4746-a01b-0d6a506dae7f'
const NOT_FOUND = 'Message not delivered: session local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8 not found.'

const realWakes = async () => wakesOfFile(JSON.parse(await readFixture('wakes.json')))
const lanes = (extra = {}) => [
  { chat: 'Worker 1', spell: W1_SPELL, listed: true, paths: ['message', 'launch'], ...extra },
  { chat: 'Worker 5', spell: W5_SPELL, listed: true, paths: ['message', 'launch'], ...extra },
  { chat: 'Worker 2', spell: W2_SPELL, listed: true, paths: ['message', 'launch'], ...extra },
]

test('G1 the real case: Workers 1 and 5 (unlisted at 20:33:30) and Worker 2 (both paths spent) are tried again once the chat is listed and a new run was heard after the verdict; nothing before, nothing twice', async () => {
  const record = await realWakes()
  const ask = chat => nextPath(record, { chat, spell: chat === 'Worker 1' ? W1_SPELL : chat === 'Worker 5' ? W5_SPELL : W2_SPELL, senderClaims: true, paths: ['message', 'launch'] })
  // The board's state at 21:00: no report with a new run since the verdict, so nothing is re-opened and nothing can be claimed.
  assert.deepEqual(reopenSpells(record, lanes(), RUN_BACK - 20 * 60_000), [])
  assert.equal(ask('Worker 1'), null)
  assert.equal(ask('Worker 5'), null)
  assert.equal(ask('Worker 2'), null)
  // 21:20:17: the Advisor's report carries a new run.
  noteRun(record, RUN_BACK)
  const opened = reopenSpells(record, lanes(), RUN_BACK + 500)
  assert.deepEqual(opened.sort(), ['Worker 1', 'Worker 2', 'Worker 5'])
  assert.equal(ask('Worker 1'), 'message')
  assert.equal(ask('Worker 5'), 'message')
  assert.equal(ask('Worker 2'), 'message')
  const first = claim(record, { chat: 'Worker 1', spell: W1_SPELL, path: 'message', by: 'Main', jobId: 'wake:1:Worker 1', now: RUN_BACK + 1000, runBefore: 1793829813678 })
  assert.ok(first, 'the message to Worker 1 is claimed at 21:20')
  assert.ok(claim(record, { chat: 'Worker 5', spell: W5_SPELL, path: 'message', by: 'Main', jobId: 'wake:1:Worker 5', now: RUN_BACK + 1000, runBefore: 1793831789315 }))
  // Once per spell: it fails again (the app still does not know the chat) and nothing re-opens it a second time.
  failedToSend(record, 'Worker 1', 'wake:1:Worker 1', NOT_FOUND, RUN_BACK + 2000)
  noteRun(record, RUN_BACK + 60 * 60_000)
  assert.deepEqual(reopenSpells(record, lanes(), RUN_BACK + 61 * 60_000), [])
  assert.equal(ask('Worker 1'), null, 'nothing a second time')
  // The old attempts stay in the record; the saved file keeps the re-opening and the run.
  const read = wakesOfFile(JSON.parse(textOfWakes(record)))
  assert.equal(read.heardRunAt, RUN_BACK + 60 * 60_000)
  assert.equal(read.wakes.get('Worker 1').at(-1).reopenedAt, RUN_BACK + 500)
  assert.equal(read.wakes.get('Worker 1').at(-1).attempts.length, 2)
})

test('G1: the notice stands until the re-opening and clears by itself afterwards (final turns false)', async () => {
  const record = await realWakes()
  const need = chat => ({ chat, spell: chat === 'Worker 1' ? W1_SPELL : W5_SPELL, paths: ['message', 'launch'], need: true })
  const targets = [need('Worker 1'), need('Worker 5')]
  const before = noticeOf(record, targets, VERDICT_2033 + 60_000, timeOf, { senderClaims: true })
  assert.match(before.text, /could not wake Worker 1/)
  noteRun(record, RUN_BACK)
  reopenSpells(record, lanes(), RUN_BACK + 500)
  assert.equal(noticeOf(record, targets, RUN_BACK + 600, timeOf, { senderClaims: true }), null)
  assert.equal(wakeOf(record, need('Worker 1'), { senderClaims: true }).final, false)
})

test('G1: not re-opened while the chat is not listed, while an attempt is pending, after a "woke", or when a run was heard before the verdict', async () => {
  const record = await realWakes()
  noteRun(record, RUN_BACK)
  assert.deepEqual(reopenSpells(record, lanes({ listed: false }), RUN_BACK + 500), [], 'not listed now')
  const early = await realWakes()
  noteRun(early, 1793907192011 - 1000)
  assert.deepEqual(reopenSpells(early, lanes(), RUN_BACK + 500), [], 'the run was heard before the verdict: the app was not back')
  // A spell whose message is only spent as "no report", with the launch path still open, is not "spent": the launch is the next path anyway.
  const open = emptyWakes()
  claim(open, { chat: 'Worker 9', spell: 5, path: 'message', by: 'Main', jobId: 'j', now: 10 })
  failedToSend(open, 'Worker 9', 'j', 'no report within 2 minutes of the message', 20)
  noteRun(open, 100)
  assert.deepEqual(reopenSpells(open, [{ chat: 'Worker 9', spell: 5, listed: true, paths: ['message', 'launch'] }], 200), [])
  // A pending attempt blocks it.
  const pending = emptyWakes()
  claim(pending, { chat: 'Worker 9', spell: 5, path: 'message', by: 'Main', jobId: 'j', now: 10 })
  noteRun(pending, 100)
  assert.deepEqual(reopenSpells(pending, [{ chat: 'Worker 9', spell: 5, listed: true, paths: ['message'] }], 200), [])
  // A spell of another time than the lane's own newest is not touched.
  const other = await realWakes()
  noteRun(other, RUN_BACK)
  assert.deepEqual(reopenSpells(other, [{ chat: 'Worker 1', spell: 42, listed: true, paths: ['message'] }], RUN_BACK + 500), [])
})

test('G2: the clear chain is followed to its end (12 cards), a loop ends, a missing card ends', async () => {
  const project = await mkdtemp(join(tmpdir(), 'wake-chain-'))
  try {
    const claude = join(project, '.claude')
    await mkdir(join(claude, 'chats'), { recursive: true })
    const id = n => `card-${String(n).padStart(2, '0')}`
    for (let n = 0; n < 12; n += 1) await writeFile(join(claude, 'chats', `${id(n)}.json`), JSON.stringify({ movedTo: id(n + 1) }))
    assert.equal(await followMoves(claude, id(0)), id(12), 'twelve cards behind: the live session')
    assert.equal(await followMoves(claude, id(12)), id(12))
    // A loop: a -> b -> a ends at b (the last one not seen before).
    await writeFile(join(claude, 'chats', 'loop-a.json'), JSON.stringify({ movedTo: 'loop-b' }))
    await writeFile(join(claude, 'chats', 'loop-b.json'), JSON.stringify({ movedTo: 'loop-a' }))
    assert.equal(await followMoves(claude, 'loop-a'), 'loop-b')
    await writeFile(join(claude, 'chats', 'self.json'), JSON.stringify({ movedTo: 'self' }))
    assert.equal(await followMoves(claude, 'self'), 'self')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

test('G2: a wake launches only the CLI id an app file holds (the file\'s raw cliSessionId), never the end of the chain', () => {
  const app = (extra = {}) => ({ sessionId: 'local_f86ba0e4-f337-456d-84be-52cd655253e1', cliSessionId: LIVE, rawCliSessionId: FILE, isArchived: false, ...extra })
  const lane = { session: LIVE, appSession: 'local_f86ba0e4-f337-456d-84be-52cd655253e1' }
  const own = ownChatOf({ lane, kept: null, apps: [app()] })
  assert.equal(own.launch, FILE)
  assert.equal(wakeIdsOf({ ...lane, own }).session, FILE, 'the launch goes by the id the file holds')
  assert.equal(wakeIdsOf({ ...lane, own }).appSession, lane.appSession, 'the message still goes by the app id')
  // A file that already holds the live id changes nothing (no extra key).
  assert.equal('launch' in ownChatOf({ lane, kept: null, apps: [app({ rawCliSessionId: LIVE })] }), false)
  assert.deepEqual(pathsOf({ ...lane, own }, true), ['message', 'launch'])
})

/** The folders of the evening, built from the fixtures: the new account's list (stale Worker 1, real Worker 2, the stub) and the old account's (the real Worker 1). */
async function accounts({ reimported = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'wake-accounts-'))
  const fresh = join(dir, '7b36a87b-new', 'org-1')
  const old = join(dir, '26b81206-old', 'org-1')
  await mkdir(fresh, { recursive: true })
  await mkdir(old, { recursive: true })
  await cp(join(FIXTURES, 'w1-stale.json'), join(fresh, 'local_a9540fd7-6516-4271-89cd-ff99e681faff.json'))
  await cp(join(FIXTURES, 'w2-real.json'), join(fresh, 'local_f86ba0e4-f337-456d-84be-52cd655253e1.json'))
  await cp(join(FIXTURES, 'w2-stub.json'), join(fresh, 'local_8f2378dd-982c-4323-95d8-fdc0f40775ff.json'))
  await cp(join(FIXTURES, 'w1-real.json'), join(old, 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8.json'))
  if (reimported) await cp(join(FIXTURES, 'w1-real.json'), join(fresh, 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8.json'))
  return dir
}
const RULES = { project: 'C:\\Web\\lava-tactics-project', prefix: 'Lava Tactics - ', main: 'Main' }
const W1_KEPT = { session: '2f42220a-da5a-4eea-bc93-1311083885f5', app: 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8', at: 1793831918930 }

test('H1 the 20:25 case: the folder the board does not read holds the real Worker 1; its lane and notice say "your other Claude account: run /reimport-chats, then restart the app"', async () => {
  const dir = await accounts()
  try {
    const files = new Set()
    const elsewhere = new Map()
    const texts = await readAppChats(dir, files, elsewhere)
    assert.equal(elsewhere.get('local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8'), '26b81206-old', 'collected with the account folder\'s name')
    assert.equal(files.has('local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8'), false)
    const apps = texts.map(parseAppChat).filter(chat => chat !== null)
    const shown = boardChats(apps, RULES).find(chat => chat.name === 'Worker 1')
    assert.equal(shown.appSessionId, 'local_a9540fd7-6516-4271-89cd-ff99e681faff', 'the stale copy is what the board shows')
    const lane = { session: shown.cliSessionId, appSession: shown.appSessionId }
    const kept = keptFor({ name: 'Worker 1', kept: W1_KEPT, chat: shown, chats: [] })
    assert.notEqual(kept, null)
    const own = ownChatOf({ lane, kept, apps, appFiles: files, elsewhere })
    assert.equal(own.isListed, false)
    assert.equal(own.elsewhere, '26b81206-old')
    const ids = wakeIdsOf({ ...lane, own })
    assert.equal(ids.why, OTHER_ACCOUNT_WHY)
    assert.equal(OTHER_ACCOUNT_WHY, 'your chats are in your other Claude account: run /reimport-chats, then restart the app')
    // The lane's and the notice's words.
    const record = emptyWakes()
    const need = { chat: 'Worker 1', spell: W1_SPELL, paths: pathsOf({ ...lane, own }, true), cannot: ids.why, need: true }
    assert.equal(wakeOf(record, need, { senderClaims: true }).why, OTHER_ACCOUNT_WHY)
    const notice = noticeOf(record, [need], 1793906700000, timeOf, { senderClaims: true })
    assert.match(notice.text, /could not wake Worker 1: your chats are in your other Claude account: run \/reimport-chats, then restart the app; open its chat/)
    // A chat nobody has (not in any folder) keeps the plain "not in the app's list".
    const none = ownChatOf({ lane, kept: { ...W1_KEPT, app: 'local_00000000-0000-0000-0000-000000000000', session: 'nope' }, apps, appFiles: files, elsewhere })
    assert.equal(wakeIdsOf({ ...lane, own: none }).why, 'its chat is not in the app\'s list')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('H1 the 20:33 case: the reimported file is in the folder the board reads but the app answers "not found": lane and notice say "restart the app so it reads the reimported chats"', async () => {
  const dir = await accounts({ reimported: true })
  try {
    const files = new Set()
    const elsewhere = new Map()
    const apps = (await readAppChats(dir, files, elsewhere)).map(parseAppChat).filter(chat => chat !== null)
    assert.equal(files.has('local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8'), true)
    const shown = boardChats(apps, RULES).find(chat => chat.name === 'Worker 1')
    assert.equal(shown.appSessionId, 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8', 'the real chat is the newest of its title')
    const lane = { session: shown.cliSessionId, appSession: shown.appSessionId }
    const own = ownChatOf({ lane, kept: W1_KEPT, apps, appFiles: files, elsewhere })
    assert.equal(own.isListed, true)
    assert.equal(wakeIdsOf({ ...lane, own }).why, null)
    // The 20:33:30 attempt: the app's answer.
    const record = emptyWakes()
    claim(record, { chat: 'Worker 1', spell: W1_SPELL, path: 'message', by: 'Main', jobId: 'wake:1:Worker 1', now: 1793907210875 })
    failedToSend(record, 'Worker 1', 'wake:1:Worker 1', NOT_FOUND, VERDICT_2033)
    const status = statusOf(record, 'Worker 1', W1_SPELL)
    assert.equal(status.why, RESTART_WHY)
    assert.equal(RESTART_WHY, 'restart the app so it reads the reimported chats')
    const need = { chat: 'Worker 1', spell: W1_SPELL, paths: ['message'], need: true }
    const notice = noticeOf(record, [need], VERDICT_2033 + 1000, timeOf, { senderClaims: true })
    assert.match(notice.text, /could not wake Worker 1: .*restart the app so it reads the reimported chats; open its chat/)
    assert.doesNotMatch(notice.text, /other Claude account/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('H2 the 20:30 case: the launch stub (local_8f2378dd) is a leftover, the real chat is "Worker 2", a message goes to it, and the kept report stays', async () => {
  const stub = parseAppChat(await readFixture('w2-stub.json'))
  const real = parseAppChat(await readFixture('w2-real.json'))
  assert.equal(stub.isStub, true)
  assert.equal(real.isStub, false)
  const found = boardChats([stub, real], RULES)
  const worker2 = found.filter(chat => chat.name === 'Worker 2')
  assert.equal(worker2.find(chat => !chat.isLeftover).appSessionId, 'local_f86ba0e4-f337-456d-84be-52cd655253e1')
  assert.equal(worker2.find(chat => chat.appSessionId === 'local_8f2378dd-982c-4323-95d8-fdc0f40775ff').isLeftover, true)
  // Also when the stub is the only newer file by creation: the order of the files changes nothing.
  assert.equal(boardChats([real, stub], RULES).find(chat => chat.name === 'Worker 2' && !chat.isLeftover).appSessionId, real.sessionId)
  // The stub the newest file of the title (it takes the name first when it is not a leftover).
  const newer = boardChats([{ ...stub, lastActivityAt: real.lastActivityAt + 1000 }, real], RULES)
  assert.equal(newer.find(chat => chat.name === 'Worker 2' && !chat.isLeftover).appSessionId, real.sessionId)
  const kept = { session: '50354b4d-4eb9-4f38-8f6a-live', app: 'local_f86ba0e4-f337-456d-84be-52cd655253e1', at: 1793830724955 }
  const shown = found.find(chat => chat.name === 'Worker 2' && !chat.isLeftover)
  assert.equal(keptFor({ name: 'Worker 2', kept, chat: shown, chats: found }), kept, 'the report stays')
  // keptFor never lets a stub\'s createdAt (20:30:15, later than the report) drop the kept report.
  const asShown = found.find(chat => chat.appSessionId === 'local_8f2378dd-982c-4323-95d8-fdc0f40775ff')
  assert.equal(keptFor({ name: 'Worker 2', kept, chat: asShown, chats: [] }), kept)
  // A chat that really is newer than the report still drops it (the rule of B986 stands).
  assert.equal(keptFor({ name: 'Worker 2', kept, chat: { ...shown, createdAt: kept.at + 1 }, chats: [] }), null)
  const own = ownChatOf({ lane: { session: shown.cliSessionId, appSession: shown.appSessionId }, kept, apps: [stub, real] })
  assert.equal(own.appSession, 'local_f86ba0e4-f337-456d-84be-52cd655253e1', 'a message goes to the real chat')
  assert.equal(own.isListed, true)
})

test('H2: an adopted transcript that already has turns or an answer is a real chat, not a stub', () => {
  const base = { title: 'Lava Tactics - Worker 3', sessionId: 'local_x', cliSessionId: 'cli-x', cwd: RULES.project }
  assert.equal(parseAppChat(JSON.stringify({ ...base, fromCliTranscript: true })).isStub, true)
  assert.equal(parseAppChat(JSON.stringify({ ...base, adoptedFromOtherSurface: true })).isStub, true)
  assert.equal(parseAppChat(JSON.stringify({ ...base, fromCliTranscript: true, completedTurns: 4 })).isStub, false)
  assert.equal(parseAppChat(JSON.stringify({ ...base, fromCliTranscript: true, lastAssistantUuid: 'u' })).isStub, false)
  assert.equal(parseAppChat(JSON.stringify(base)).isStub, false, 'an ordinary new chat without turns is no stub')
})
