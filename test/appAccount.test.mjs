// B1273 (F36a, 2026-11-19, the person: "I want to be able to switch accounts often"): the board knows which Claude account the
// app is on (its config.json's `lastKnownAccountUuid`), holds by itself while it is not the board's account (no hand-out, no
// wake, no incident, no ask; one calm line), and finds its chats again when the person switches back: the real chat is kept
// over a launch stub, nothing is archived, a chat only the other account lists is copied into the board's.
//
// The real cases: 11-05 (the person switched accounts ~20:25; every worker "Not running", wakes failed "not in the app's list";
// the board's failed wake made the launch stub local_8f2378dd for Worker 2's transcript, newer than its real chat local_f86ba0e4,
// and reimport-chats --titles then archived the real one) and 11-19 (the app was on the other account until ~19:11: the other
// account's folder was written at 19:11:57, the app's config.json at 19:12:04; the Advisor had to ask the person).

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ACCOUNT_ID, AWAY_LINE, RETURN_SETTLE_MS, accountPicture, accountWatch, appAccountOf, appConfigFileOf, boardAccountOf, toImport } from '../src/appAccount.mjs'
import { boardChats, listedWhere, parseAppChat, readAccountFolders, readAppChats } from '../src/appChats.mjs'
import { awayOver, isHolding, withAway } from '../src/work/pause.mjs'
import { wakeNeeds } from '../src/wake.mjs'
import { judge, pictureOf } from '../src/startupCheck.mjs'
import { configProblem, parseConfig } from '../src/config.mjs'

const BOARD = '26b81206-0000-4000-8000-0000000000a1'
const OTHER = '7b36a87b-0000-4000-8000-0000000000b2'
const ORG = 'b9a34978-0000-4000-8000-0000000000c3'
const OTHER_ORG = 'ecf3becd-0000-4000-8000-0000000000d4'
const HOME = 'D:\\Work\\the-project'
const PREFIX = 'Game - '
const at = (d, h, m, s = 0) => new Date(2026, 10, d, h, m, s).getTime()
/** An app chat file as the app writes it. */
const chatFile = ({ title, cli, activity, turns = 10, stub = false, archived = false, cwd = HOME, created = activity - 3_600_000, extra = {} }) => JSON.stringify({
  sessionId: `local_${cli.slice(0, 8)}`, cliSessionId: cli, title, cwd, createdAt: created, lastActivityAt: activity, completedTurns: turns,
  isArchived: archived, ...(stub ? { fromCliTranscript: true, completedTurns: 0 } : { lastAssistantUuid: `a-${cli.slice(0, 4)}` }), ...extra,
})

async function appTree(root, files) {
  const dir = join(root, 'claude-code-sessions')
  for (const [account, org, id, text] of files) {
    await mkdir(join(dir, account, org), { recursive: true })
    await writeFile(join(dir, account, org, `${id}.json`), text)
  }
  return dir
}

test('the signal: the app\'s config.json names the account it is signed in with (lastKnownAccountUuid); nothing else is read as one', () => {
  assert.equal(appAccountOf(JSON.stringify({ locale: 'en', lastKnownAccountUuid: BOARD })), BOARD)
  assert.equal(appAccountOf(JSON.stringify({ lastKnownAccountUuid: BOARD.toUpperCase() })), BOARD, 'any case, one id')
  for (const text of [null, '', 'not json', '{}', JSON.stringify({ lastKnownAccountUuid: 'someone' }), JSON.stringify({ lastKnownAccountUuid: 5 })]) assert.equal(appAccountOf(text), null, String(text))
  assert.equal(appConfigFileOf('C:\\Users\\x\\AppData\\Local\\Claude-Data\\claude_a\\claude-code-sessions'), join('C:\\Users\\x\\AppData\\Local\\Claude-Data\\claude_a', 'config.json'))
  assert.equal(appConfigFileOf('D:/elsewhere/sessions'), null, 'a folder of another name: no guess at a config')
  assert.ok(ACCOUNT_ID.test(OTHER))
  // The setting that names the board's account when the person moves the board for good.
  assert.equal(parseConfig(JSON.stringify({ appAccount: BOARD.toUpperCase() }), {}).appAccount, BOARD)
  assert.equal(parseConfig('{}', {}).appAccount, '')
  assert.match(configProblem(JSON.stringify({ appAccount: 'mine' })), /"appAccount" must be the id of a Claude account folder/)
  assert.equal(configProblem(JSON.stringify({ appAccount: '' })), null)
})

test('the board\'s account: the setting, else the record, else the account whose folder holds the main chat\'s real file with the newest activity (a stub, an archived copy or another folder\'s chat never)', () => {
  const folder = (account, chats) => ({ account, org: ORG, ids: chats.map((_, n) => `local_${n}`), chats: new Map(chats.map((chat, n) => [`local_${n}`, parseAppChat(chatFile(chat))])) })
  const folders = [
    // 11-05: the other account held the workers' copies of 11-04 morning; the board's account the real, newer Main.
    folder(OTHER, [{ title: 'Game - Main', cli: 'aaaa1111-0000-4000-8000-000000000001', activity: at(4, 9, 0) }, { title: 'Game - Main', cli: 'aaaa1111-0000-4000-8000-000000000009', activity: at(5, 21, 0), stub: true }]),
    folder(BOARD, [{ title: 'Game - Main', cli: 'aaaa1111-0000-4000-8000-000000000001', activity: at(5, 20, 20) }, { title: 'Game - Worker 1', cli: 'bbbb', activity: at(5, 20, 24) }]),
    folder(OTHER_ORG.slice(0, 8) + BOARD.slice(8), [{ title: 'Game - Main', cli: 'cccc', activity: at(6, 9, 0), cwd: 'D:\\another-project' }]),
  ]
  assert.deepEqual(boardAccountOf({ folders, chatHome: HOME, prefix: PREFIX, main: 'Main' }), { account: BOARD, by: 'main chat' })
  assert.deepEqual(boardAccountOf({ recorded: OTHER, folders, chatHome: HOME, prefix: PREFIX, main: 'Main' }), { account: OTHER, by: 'record' })
  assert.deepEqual(boardAccountOf({ setting: BOARD.toUpperCase(), recorded: OTHER }), { account: BOARD, by: 'setting' })
  assert.deepEqual(boardAccountOf({ folders, chatHome: HOME, prefix: null, main: 'Main' }), { account: null, by: null }, 'no list: not told')
  assert.deepEqual(boardAccountOf({ folders: [folders[0]].map(one => ({ ...one, chats: new Map([...one.chats].map(([id, chat]) => [id, { ...chat, isArchived: true }])) })), chatHome: HOME, prefix: PREFIX, main: 'Main' }), { account: null, by: null }, 'only archived copies: not told')
})

test('the picture: away while the app is on another account, `since` kept; back on the board\'s account it holds RETURN_SETTLE_MS more; an unknown account holds nothing', () => {
  const t0 = at(19, 18, 40)
  let picture = accountPicture({ app: OTHER, board: BOARD, now: t0 })
  assert.deepEqual([picture.away, picture.since], [true, t0])
  picture = accountPicture({ app: OTHER, board: BOARD, before: picture, now: t0 + 60_000 })
  assert.equal(picture.since, t0, 'the away keeps when it began')
  const back = at(19, 19, 12, 4)
  picture = accountPicture({ app: BOARD, board: BOARD, before: picture, now: back })
  assert.deepEqual([picture.away, picture.backAt], [true, back], 'just back: the app reads its list first')
  picture = accountPicture({ app: BOARD, board: BOARD, before: picture, now: back + RETURN_SETTLE_MS - 1 })
  assert.equal(picture.away, true)
  picture = accountPicture({ app: BOARD, board: BOARD, before: picture, now: back + RETURN_SETTLE_MS })
  assert.deepEqual([picture.away, picture.since, picture.backAt], [false, null, null])
  assert.equal(accountPicture({ app: null, board: BOARD, now: t0 }).away, false, 'no config.json: the board goes on as before')
  assert.equal(accountPicture({ app: OTHER, board: null, now: t0 }).away, false, 'no board account known: nothing held')
  assert.equal(RETURN_SETTLE_MS, 60_000)
})

test('the hold: an away pause holds as a pause does (isHolding, the wake loop) and is no pause of the person\'s; the person\'s own pause wins', () => {
  const away = { away: true, since: at(19, 18, 0) }
  assert.deepEqual(awayOver({ state: 'running', since: 1 }, away), { state: 'away', since: away.since, by: 'the Claude app\'s account', under: { state: 'running', since: 1 }, ask: null })
  assert.deepEqual(awayOver({ state: 'pausing', since: 5 }, away), { state: 'pausing', since: 5 }, 'the person\'s pause stays theirs')
  assert.equal(awayOver({ state: 'running', since: 1 }, { away: false }).state, 'running')
  assert.equal(isHolding(awayOver(null, away)), true)
  assert.equal(withAway({ ok: true, items: new Map(), pause: null }, away).pause.state, 'away')
  assert.equal(withAway({ ok: false, why: 'x' }, away).pause, undefined, 'a store that could not be read stays as it is')
  // 11-05: Worker 2 cut off by the switch and asleep: without the hold the board wakes it (the wake that failed for good and made
  // the stub); with the hold, no wake goes out.
  const lane = { name: 'Game - Worker 2', isRunning: false, asleep: true, state: 'interrupted', asleepSince: at(5, 20, 26), appSession: 'local_f86ba0e4-0000-4000-8000-000000000002', session: 'f86ba0e4-0000-4000-8000-000000000002' }
  const state = pause => ({ chatPrefix: PREFIX, chats: [lane], pause })
  assert.equal(wakeNeeds(state(null), []).length, 1, 'the case wakes it when nothing holds')
  assert.deepEqual(wakeNeeds(state(awayOver(null, away)), []), [], 'away: no wake while the app is on the other account')
})

test('11-05, the real shape: the board\'s launch made a stub of its own transcript, newer than the real chat: the real chat is the lane, the stub a leftover', () => {
  const real = parseAppChat(chatFile({ title: 'Game - Worker 2', cli: 'f86ba0e4-0000-4000-8000-0000000000aa', activity: at(5, 20, 10), turns: 147, extra: { scheduledTaskId: 'worker-2-2' } }))
  const stub = parseAppChat(chatFile({ title: 'Game - Worker 2', cli: '8f2378dd-0000-4000-8000-0000000000bb', activity: at(5, 20, 30), stub: true }))
  const main = parseAppChat(chatFile({ title: 'Game - Main', cli: 'aaaa1111-0000-4000-8000-000000000001', activity: at(5, 20, 20) }))
  for (const order of [[stub, real, main], [real, stub, main]]) {
    const lanes = boardChats(order, { project: HOME, prefix: PREFIX, main: 'Main' })
    const own = lanes.find(one => one.name === 'Worker 2' && !one.isLeftover)
    assert.deepEqual([own?.isStub, own?.completedTurns], [false, 147], 'the real chat, 147 turns')
    assert.ok(lanes.some(one => one.isStub && one.isLeftover), 'the stub stays a leftover')
  }
})

test('a launch stub of the SAME transcript, newer than the real chat, never hides it either (the newest file per transcript is no stub over a real one)', () => {
  const cli = 'f86ba0e4-0000-4000-8000-000000000002'
  const real = parseAppChat(chatFile({ title: 'Game - Worker 2', cli, activity: at(5, 20, 10), turns: 147, extra: { scheduledTaskId: 'worker-2-2' } }))
  const stub = parseAppChat(chatFile({ title: 'Game - Worker 2', cli, activity: at(5, 20, 30), stub: true }))
  assert.equal(stub.isStub, true)
  const main = parseAppChat(chatFile({ title: 'Game - Main', cli: 'aaaa1111-0000-4000-8000-000000000001', activity: at(5, 20, 20) }))
  for (const order of [[stub, real, main], [real, stub, main]]) {
    const lanes = boardChats(order, { project: HOME, prefix: PREFIX, main: 'Main' })
    const worker = lanes.filter(one => one.name === 'Worker 2')
    assert.deepEqual(worker.map(one => [one.isStub, one.isLeftover, one.completedTurns]), [[false, false, 147]], 'the real chat, 147 turns')
  }
})

test('11-19: the app on the other account, whose folder is the newest: the board still reads its own account\'s chats ("here"), and the start-up check says only the one calm line', async t => {
  const root = await mkdtemp(join(tmpdir(), 'app-account-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const dir = await appTree(root, [
    [BOARD, ORG, 'local_080d897d', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(19, 18, 0) })],
    [BOARD, ORG, 'local_f86ba0e4', chatFile({ title: 'Game - Worker 2', cli: 'f86ba0e4-0000-4000-8000-000000000002', activity: at(19, 17, 50) })],
    // The other account: its copy of Main from long ago, and the person's own chat there at 19:11 (the newest folder).
    [OTHER, OTHER_ORG, 'local_080d897d', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(4, 9, 0) })],
    [OTHER, OTHER_ORG, 'local_767b11ad', chatFile({ title: 'Something else', cli: '767b11ad-0000-4000-8000-000000000003', activity: at(19, 19, 11), cwd: 'D:\\elsewhere' })],
  ])
  const read = (await readAppChats(dir, null, null, { account: BOARD })).map(text => JSON.parse(text).title).sort()
  assert.deepEqual(read, ['Game - Main', 'Game - Worker 2'], 'the board\'s account, not the newest folder')
  assert.deepEqual((await readAppChats(dir)).map(text => JSON.parse(text).title), ['Game - Main', 'Something else'], 'without an account: the newest folder, as before')
  const folders = await readAccountFolders(dir)
  assert.equal(listedWhere('local_f86ba0e4', folders, { account: BOARD }), 'here')
  assert.equal(listedWhere('local_f86ba0e4', folders), 'elsewhere', 'by the newest folder it read as another account\'s chat')
  const account = { app: OTHER, board: BOARD, away: true, since: at(19, 18, 40) }
  const verdict = judge(pictureOf({ now: at(19, 18, 41), folders, lanes: [{ name: 'Worker 2', appSession: 'local_f86ba0e4', isRunning: false }], pause: awayOver(null, account), account }))
  assert.deepEqual([verdict.line, verdict.tone, verdict.elsewhere, verdict.actions.reopen], [AWAY_LINE, 'quiet', [], []])
  assert.equal(AWAY_LINE, 'The Claude app is on another account: the board\'s chats wait; switch back and they go on.')
})

test('while away: a board chat only the app\'s account lists is copied into the board\'s account (new files only); one the board\'s account has, a stub, an archived chat, another prefix or project never', async t => {
  const root = await mkdtemp(join(tmpdir(), 'app-account-import-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const newWorker = chatFile({ title: 'Game - Worker 6', cli: '66666666-0000-4000-8000-000000000006', activity: at(19, 19, 0) })
  const dir = await appTree(root, [
    [BOARD, ORG, 'local_080d897d', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(19, 18, 0) })],
    [BOARD, OTHER_ORG, 'local_ffffffff', chatFile({ title: 'x', cli: 'ffffffff-0000-4000-8000-00000000000f', activity: 1, cwd: 'D:\\x' })].slice(0, 4),
    [OTHER, OTHER_ORG, 'local_66666666', newWorker],
    [OTHER, OTHER_ORG, 'local_080d897d', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(4, 9, 0) })],
    [OTHER, OTHER_ORG, 'local_77777777', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(10, 9, 0) })],
    [OTHER, OTHER_ORG, 'local_88888888', chatFile({ title: 'Game - Worker 2', cli: 'f86ba0e4-0000-4000-8000-000000000002', activity: at(19, 19, 5), stub: true })],
    [OTHER, OTHER_ORG, 'local_99999999', chatFile({ title: 'Game - Worker 3', cli: '99999999-0000-4000-8000-000000000009', activity: at(19, 19, 5), archived: true })],
    [OTHER, OTHER_ORG, 'local_aaaaaaaa', chatFile({ title: 'Mine - Notes', cli: 'aaaaaaaa-0000-4000-8000-00000000000a', activity: at(19, 19, 5) })],
    [OTHER, OTHER_ORG, 'local_bbbbbbbb', chatFile({ title: 'Game - Main', cli: 'bbbbbbbb-0000-4000-8000-00000000000b', activity: at(19, 19, 5), cwd: 'D:\\another' })],
  ])
  const folders = await readAccountFolders(dir)
  const plan = toImport({ folders, dir, app: OTHER, board: BOARD, chatHome: HOME, prefix: PREFIX })
  assert.deepEqual(plan.map(one => [one.id, one.toDir]), [['local_66666666', join(dir, BOARD, ORG)]], 'only the new worker, into the folder of the board\'s chats')
  assert.deepEqual(toImport({ folders, dir, app: BOARD, board: BOARD, chatHome: HOME, prefix: PREFIX }), [], 'on the board\'s account: nothing to copy')

  // The watch end to end: the app's config.json says the other account; the record is made from the main chat; the copy is one
  // new file, never one written over.
  const appDir = root
  await writeFile(join(appDir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: OTHER, locale: 'en' }))
  await writeFile(join(dir, BOARD, ORG, 'local_66666666.json.keep'), 'x')
  let now = at(19, 18, 40)
  const logs = []
  const record = join(root, 'board', 'data', 'app-account.json')
  const watch = accountWatch({ appSessions: () => dir, record, chatHome: HOME, folders: () => readAccountFolders(dir), list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now, log: line => logs.push(line) })
  const picture = await watch.read()
  assert.deepEqual([picture.app, picture.board, picture.away], [OTHER, BOARD, true])
  assert.equal(JSON.parse(await readFile(record, 'utf8')).account, BOARD, 'the board\'s account is recorded')
  const copied = await watch.importMissing()
  assert.deepEqual(copied.map(one => one.id), ['local_66666666'])
  assert.equal(await readFile(join(dir, BOARD, ORG, 'local_66666666.json'), 'utf8'), newWorker, 'the file as the app wrote it')
  await writeFile(join(dir, BOARD, ORG, 'local_66666666.json'), 'the board account\'s own')
  now += 61_000
  assert.deepEqual(await watch.importMissing(), [], 'once there, it is the board account\'s: never written over')
  // A listing read before that file was there (a race with the app): the copy is still never written over (flag 'wx').
  const stale = accountWatch({ appSessions: () => dir, record, chatHome: HOME, folders: async () => folders, list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now })
  assert.equal((await stale.read()).away, true)
  assert.deepEqual(await stale.importMissing(), [], 'the file there wins')
  // The review: a file the app is writing just now (not whole JSON) is not copied.
  await writeFile(join(dir, OTHER, OTHER_ORG, 'local_cccccccc.json'), '{"title":"Game - Worker 7","cliSessionId":"cc')
  const torn = accountWatch({ appSessions: () => dir, record, chatHome: HOME, clock: () => now, list: async () => ({ prefix: PREFIX, main: 'Main' }),
    folders: async () => [...folders.filter(one => one.account !== OTHER), ...folders.filter(one => one.account === OTHER).map(one => ({ ...one, ids: [...one.ids, 'local_cccccccc'], chats: new Map([...one.chats, ['local_cccccccc', parseAppChat(chatFile({ title: 'Game - Worker 7', cli: 'cccccccc-0000-4000-8000-00000000000c', activity: at(19, 19, 8) }))]]) }))] })
  assert.equal((await torn.read()).away, true)
  assert.deepEqual((await torn.importMissing()).map(one => one.id), [], 'a torn file is read again at the next pass')
  assert.equal(existsSync(join(dir, BOARD, ORG, 'local_cccccccc.json')), false)
  assert.equal(await readFile(join(dir, BOARD, ORG, 'local_66666666.json'), 'utf8'), 'the board account\'s own')
  assert.ok(!(await readdir(join(dir, OTHER, OTHER_ORG))).some(name => !name.endsWith('.json')), 'the other account\'s folder is only read')
  assert.ok(logs.some(line => /^The Claude app is on another account \(7b36a87b\)/.test(line)), logs.join('\n'))
  // Back: the record holds (no new read of the folders); away for the settle time, then not.
  await writeFile(join(appDir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: BOARD }))
  now += 10_000
  assert.equal((await watch.read()).away, true)
  now += RETURN_SETTLE_MS
  assert.equal((await watch.read()).away, false)
  assert.deepEqual(await watch.importMissing(), [], 'not away: nothing copied')
  assert.ok(existsSync(record))
  // The review: a read that finds no account while away (a file cut short) keeps the hold: no lift at once.
  await writeFile(join(appDir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: OTHER }))
  now += 10_000
  assert.equal((await watch.read()).away, true)
  await writeFile(join(appDir, 'config.json'), '{"lastKnownAccou')
  now += 10_000
  assert.deepEqual([(await watch.read()).away, watch.now().app], [true, OTHER], 'a blank read keeps the last account known')
  // The away line's button: the app's account becomes the board's, recorded as the person's; the hold ends at once.
  await writeFile(join(appDir, 'config.json'), JSON.stringify({ lastKnownAccountUuid: OTHER }))
  const taken = await watch.take()
  assert.deepEqual([taken.ok, taken.result.account, watch.now().away, watch.now().board], [true, OTHER, false, OTHER])
  assert.deepEqual([JSON.parse(await readFile(record, 'utf8')).account, JSON.parse(await readFile(record, 'utf8')).by], [OTHER, 'person'])
  now += 10_000
  assert.equal((await watch.read()).away, false, 'the board runs on this account from now on')
  const fresh = accountWatch({ appSessions: () => dir, record, chatHome: HOME, folders: () => readAccountFolders(dir), list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now })
  assert.deepEqual([(await fresh.read()).board, fresh.now().away], [OTHER, false], 'a restart reads the person\'s choice from the record')
  await writeFile(join(appDir, 'config.json'), 'gone')
  const none = accountWatch({ appSessions: () => dir, record, chatHome: HOME, folders: () => readAccountFolders(dir), list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now })
  assert.equal((await none.take()).ok, false, 'no account readable: nothing taken')
})

test('B1283 (F37): one ask per switch away, filed once the away lasted the settle; a restart files no second; B keeps the hold with no re-ask; coming home closes an open one; A moves the board', async t => {
  const root = await mkdtemp(join(tmpdir(), 'app-account-ask-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const dir = await appTree(root, [[BOARD, ORG, 'local_080d897d', chatFile({ title: 'Game - Main', cli: '080d897d-0000-4000-8000-000000000001', activity: at(20, 0, 0) })]])
  const config = join(root, 'config.json')
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: OTHER }))
  const record = join(root, 'board', 'data', 'app-account.json')
  // A fake of the board's asks: filed, read back, closed.
  const asks = new Map()
  let filed = 0
  const adapter = {
    file: async body => { filed += 1; const id = `Q${900 + filed}`; asks.set(id, { ...body, state: 'open', answer: [] }); return id },
    close: async (id, why) => { const one = asks.get(id); one.state = 'withdrawn'; one.why = why },
    stateOf: async id => (asks.has(id) ? { state: asks.get(id).state, answer: asks.get(id).answer } : null),
  }
  let now = at(20, 0, 30)
  const logs = []
  const make = () => accountWatch({ appSessions: () => dir, record, chatHome: HOME, ask: adapter, folders: () => readAccountFolders(dir), list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now, log: line => logs.push(line) })
  let watch = make()
  // Away begins: nothing filed inside the settle (a quick flip back files nothing).
  assert.deepEqual([(await watch.read()).away, (await watch.read()).ask, filed], [true, null, 0])
  now += RETURN_SETTLE_MS - 6_000
  assert.deepEqual([(await watch.read()).ask, filed], [null, 0])
  now += 6_000
  const first = await watch.read()
  assert.deepEqual([first.away, first.ask, filed], [true, 'Q901', 1], 'filed once the away lasted the settle')
  assert.equal(asks.get('Q901').title, `The Claude app is on account ${OTHER.slice(0, 8)}: run the board there?`)
  assert.deepEqual(asks.get('Q901').options, ['A Run the board on this account', 'B Keep waiting until I switch back'])
  assert.ok(asks.get('Q901').text.join(' ').includes(BOARD.slice(0, 8)), 'the text names the board\'s account by its id')
  for (let n = 0; n < 5; n++) { now += 10_000; await watch.read() }
  assert.equal(filed, 1, 'no second ask on later reads')
  assert.equal(JSON.parse(await readFile(record, 'utf8')).ask.id, 'Q901', 'the ask is in the record')
  // A restart while away: the record's open ask stands; no second one.
  watch = make()
  now += 70_000
  assert.deepEqual([(await watch.read()).ask, filed], ['Q901', 1], 'a restart files no second ask')
  // B: the hold stays, the ask is done with, and no new one comes while the app stays on that account.
  asks.get('Q901').state = 'answered'
  asks.get('Q901').answer = ['B Keep waiting until I switch back']
  now += 10_000
  let seen = await watch.read()
  assert.deepEqual([seen.away, seen.ask, seen.board], [true, null, BOARD], 'B: still away, the ask closed out')
  for (let n = 0; n < 12; n++) { now += 60_000; await watch.read() }
  assert.equal(filed, 1, 'B: no re-ask while the app stays on that account')
  assert.equal(JSON.parse(await readFile(record, 'utf8')).declined, OTHER)
  // Home again: the hold lifts after the settle, the B is forgotten.
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: BOARD }))
  now += 6_000
  await watch.read()
  now += RETURN_SETTLE_MS + 6_000
  seen = await watch.read()
  assert.deepEqual([seen.away, seen.ask, JSON.parse(await readFile(record, 'utf8')).declined], [false, null, undefined])
  // Away again (a new switch): asked again after the settle; A moves the board to that account, the hold ends at once.
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: OTHER }))
  now += 6_000
  await watch.read()
  now += RETURN_SETTLE_MS
  assert.deepEqual([(await watch.read()).ask, filed], ['Q902', 2], 'a new switch away: one new ask')
  asks.get('Q902').state = 'answered'
  asks.get('Q902').answer = ['A Run the board on this account']
  now += 6_000
  seen = await watch.read()
  assert.deepEqual([seen.away, seen.board, seen.ask], [false, OTHER, null], 'A: the board runs on this account')
  assert.deepEqual([JSON.parse(await readFile(record, 'utf8')).account, JSON.parse(await readFile(record, 'utf8')).by], [OTHER, 'person'])
  // Away from the new home, asked, and the app comes back: the open ask closes by itself with its one line.
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: BOARD }))
  now += 10_000
  await watch.read()
  now += RETURN_SETTLE_MS
  assert.deepEqual([(await watch.read()).ask, filed], ['Q903', 3])
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: OTHER }))
  now += 10_000
  await watch.read()
  now += RETURN_SETTLE_MS + 6_000
  seen = await watch.read()
  assert.deepEqual([seen.away, seen.ask, asks.get('Q903').state, asks.get('Q903').why], [false, null, 'withdrawn', `the Claude app came back to ${OTHER.slice(0, 8)}; nothing to decide`])
  assert.equal(filed, 3)
  // Without an ask adapter (a copy that only shows): nothing is filed.
  await writeFile(config, JSON.stringify({ lastKnownAccountUuid: BOARD }))
  const quiet = accountWatch({ appSessions: () => dir, record, chatHome: HOME, folders: () => readAccountFolders(dir), list: async () => ({ prefix: PREFIX, main: 'Main' }), clock: () => now })
  now += 10_000; await quiet.read(); now += RETURN_SETTLE_MS
  assert.deepEqual([(await quiet.read()).away, (await quiet.read()).ask ?? null, filed], [true, null, 3])
})

test('the away line links to its ask, and the pause record carries it; the page has no account button and the server no take-account action', async () => {
  const page = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  const state = await readFile(new URL('../src/state.mjs', import.meta.url), 'utf8')
  assert.equal(awayOver(null, { away: true, since: 5, ask: 'Q901' }).ask, 'Q901')
  assert.equal(awayOver(null, { away: true, since: 5 }).ask, null)
  assert.match(state, /line: AWAY_LINE, ask: pauseRecord\.ask \?\? null/)
  assert.match(page, /link: \{ label: `Decide \(\$\{pause\.ask\}\)`, href: `#details=\$\{pause\.ask\}` \}/)
  assert.doesNotMatch(page, /take-account|Run the board on this account/)
  assert.doesNotMatch(server, /take-account/)
  assert.match(server, /ask: isShowOnly \? null : \{[^]*?action: 'ask', kind: 'decide', title, text: text\.join\('\\n'\), options, advice \}, 'server'/)
  assert.match(server, /action: 'withdraw', id, why \}, 'server'\)/)
})
