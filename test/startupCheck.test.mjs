// The start-up check (2026-11-05, chat 3's brief and chat 1's plan): one moment where the board re-reads reality. Stage 1,
// tasks 1-4: where a chat's file is (task 1), the picture (task 2), the verdict (task 3) and its writes (task 4). The real
// case of the evening is the fixture: fixtures/wake-account (the two Worker 2 files, the Worker 1 files, the wake record) and
// fixtures/startup-check (trimmed copies of the snapshot, made-up paths).

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { listedWhere, readAccountFolders, readAppChats } from '../src/appChats.mjs'
import { judge, pictureOf } from '../src/startupCheck.mjs'
import { wakesOfFile } from '../src/wake.mjs'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'wake-account')
const W1_APP = 'local_e92c96e7-9f9c-4b57-8f7d-7bfdfc3afcc8'
const W2_REAL_APP = 'local_f86ba0e4-f337-456d-84be-52cd655253e1'
const W2_STUB_APP = 'local_8f2378dd-982c-4323-95d8-fdc0f40775ff'

/** The two account folders of the evening, from the fixtures; `reimported`: the 20:33 state (the real Worker 1 copied into the folder in use). */
async function accounts({ reimported = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'startup-accounts-'))
  const fresh = join(dir, '7b36a87b-new', 'org-1')
  const old = join(dir, '26b81206-old', 'org-1')
  await mkdir(fresh, { recursive: true })
  await mkdir(old, { recursive: true })
  await cp(join(FIXTURES, 'w1-stale.json'), join(fresh, 'local_a9540fd7-6516-4271-89cd-ff99e681faff.json'))
  await cp(join(FIXTURES, 'w2-real.json'), join(fresh, `${W2_REAL_APP}.json`))
  await cp(join(FIXTURES, 'w2-stub.json'), join(fresh, `${W2_STUB_APP}.json`))
  await cp(join(FIXTURES, 'w1-real.json'), join(old, `${W1_APP}.json`))
  if (reimported) await cp(join(FIXTURES, 'w1-real.json'), join(fresh, `${W1_APP}.json`))
  return dir
}

test('task 1: all account folders are read; the real Worker 1 is elsewhere at 20:25 and here at 20:33; the stub is no chat; f86ba0e4 is Worker 2\'s', async () => {
  const before = await accounts()
  const after = await accounts({ reimported: true })
  try {
    const folders = await readAccountFolders(before)
    assert.deepEqual(folders.map(folder => folder.account).sort(), ['26b81206-old', '7b36a87b-new'])
    assert.equal(listedWhere(W1_APP, folders), 'elsewhere', '20:25: only in the account the board does not read')
    assert.equal(listedWhere(W2_REAL_APP, folders), 'here')
    assert.equal(listedWhere(W2_STUB_APP, folders), 'nowhere', 'a launch stub is never the chat\'s file')
    assert.equal(listedWhere('local_00000000-0000-0000-0000-000000000000', folders), 'nowhere')
    assert.equal(listedWhere(null, folders), 'nowhere')
    assert.equal(listedWhere(W1_APP, await readAccountFolders(after)), 'here', '20:33: the reimport put it in the folder in use')
    // readAppChats keeps its behaviour: only the folder in use is read, the other account's ids come as `elsewhere`.
    const elsewhere = new Map()
    const files = new Set()
    const texts = await readAppChats(before, files, elsewhere)
    assert.equal(texts.length, 3)
    assert.equal(elsewhere.get(W1_APP), '26b81206-old')
    assert.equal(files.has(W1_APP), false)
  } finally {
    await rm(before, { recursive: true, force: true })
    await rm(after, { recursive: true, force: true })
  }
})

// ---- Task 2: the picture, from the trimmed snapshot (fixtures/startup-check) ----

const SNAP = join(import.meta.dirname, '..', 'fixtures', 'startup-check')
const json = async name => JSON.parse(await readFile(join(SNAP, name), 'utf8'))
/** 2026-11-05 21:25 local, after the app was back (the Advisor's run 1793910017329 at 21:20). */
const AT_2125 = new Date(2026, 10, 5, 21, 25).getTime()

/** Folders as `readAccountFolders` gives them, in memory: `chats` app ids with their flags. */
const folder = (account, at, chats) => ({ account, org: 'org-1', at, ids: Object.keys(chats), texts: [], chats: new Map(Object.entries(chats).map(([id, flags]) => [id, { isArchived: false, isStub: false, ...flags }])) })
/** The evening's folders: `elsewhere` the 20:25 state (the real Worker 1 and 5 only in the old account), else the 20:33 state (reimported). */
const eveningFolders = ({ elsewhere }) => {
  const fresh = { [W2_REAL_APP]: {}, [W2_STUB_APP]: { isStub: true }, 'local_84e3310d-5c34-43b7-a5f4-d59006c1d556': {}, 'local_0981b01c-5087-464a-beca-85d4f50734d2': {}, 'local_6a0767ea-0335-43cf-9a6b-988904461d3a': {}, 'local_43a11efb-3de3-4577-802d-e91718ec94a1': {} }
  // The real Workers 1 and 5 keep their old activity (the reimport copies the files as they were): older than the 20:33:30 answer.
  const old = { [W1_APP]: { lastActivityAt: 1793831918930 }, 'local_88208666-fd8c-43e5-8f6a-b0b847115ba7': { lastActivityAt: 1793831905753 } }
  return elsewhere ? [folder('7b36a87b-new', 1793911248109, fresh), folder('26b81206-old', 1793831918930, old)] : [folder('7b36a87b-new', 1793911248109, { ...fresh, ...old }), folder('26b81206-old', 1793831918930, old)]
}
/** The six lanes; the ones named in `down` do not run (the 20:25 picture: Workers 1, 2 and 5). */
const lanesOf = async ({ down = [] } = {}) => (await json('lanes.json')).map(lane => ({ ...lane, isRunning: !down.includes(lane.name) }))
const sourcesOf = async ({ elsewhere = false, down = ['Worker 1', 'Worker 2', 'Worker 5'], now = AT_2125 } = {}) => ({
  now,
  folders: eveningFolders({ elsewhere }),
  lanes: await lanesOf({ down }),
  reports: (await json('reports.json')).reports,
  wakes: wakesOfFile(await json('wakes.json')),
  pause: await json('pause.json'),
  ready: await json('ready.json'),
  envelopes: await json('envelopes.json'),
  incidents: await json('incidents.json'),
})

test('task 2: the picture of the snapshot has the 7 lanes (Main, Workers 1-5, the Supervisor), the wakes, the pause, the 5 ready ids, the bans of Workers 3 and 4 and the 6 incidents', async () => {
  const picture = pictureOf(await sourcesOf({ elsewhere: true }))
  assert.deepEqual(picture.lanes.map(lane => lane.name), ['Main', 'Worker 1', 'Worker 2', 'Worker 3', 'Worker 4', 'Worker 5', 'Supervisor'])
  assert.deepEqual(Object.fromEntries(picture.lanes.map(lane => [lane.name, lane.listedWhere])), { Main: 'here', 'Worker 1': 'elsewhere', 'Worker 2': 'here', 'Worker 3': 'here', 'Worker 4': 'here', 'Worker 5': 'elsewhere', Supervisor: 'here' })
  assert.deepEqual(picture.accounts.map(one => [one.account, one.isSignedIn]), [['7b36a87b-new', true], ['26b81206-old', false]])
  assert.deepEqual(picture.signedIn, ['7b36a87b-new'])
  // The wakes, read through the board's own words: Worker 1 and 5 failed as "not found", Worker 2 spent both paths.
  assert.deepEqual([picture.wakes['Worker 1'].final, picture.wakes['Worker 1'].notFound, picture.wakes['Worker 1'].spell], [true, true, 1793862907591])
  assert.equal(picture.wakes['Worker 5'].notFound, true)
  assert.deepEqual([picture.wakes['Worker 2'].final, picture.wakes['Worker 2'].notFound], [true, false])
  assert.equal(picture.wakes['Worker 3'].final, false)
  assert.equal(picture.pause.state, 'running')
  assert.equal(picture.ready.length, 5)
  assert.deepEqual(Object.fromEntries(Object.entries(picture.bans).filter(([, bans]) => bans.length > 0).map(([name, bans]) => [name, bans.map(ban => ban.model)])), { 'Worker 3': ['claude-sonnet-5-5'], 'Worker 4': ['claude-opus-5-5'] })
  assert.deepEqual(picture.incidents.map(one => one.id), ['X154', 'X155', 'X156', 'X157', 'X158', 'X160'])
  assert.equal(picture.incidents[0].since, new Date(2026, 10, 5, 20, 28).getTime())
  // The newest run among the chats that run: the Advisor is no lane here, so it is Main's or a worker's (21:20 and later).
  assert.ok(picture.newestRun > 1793910017329)
  // An ended incident and one of another rule are not in it.
  const more = pictureOf({ ...(await sourcesOf()), incidents: [...(await json('incidents.json')), { id: 'X1', key: 'wake-failed Worker 3 1', source: 'wake-failed', subject: 'Worker 3', state: 'gone', since: '2026-11-05 10:00' }, { id: 'X2', key: 'board-slow 1', source: 'board-slow', subject: 'board', state: 'open', since: '2026-11-05 10:00' }] })
  assert.equal(more.incidents.length, 6)
})

// ---- Task 3: the verdict ----

/** Before the failures (20:33:30 and earlier): no chat that runs has a run id newer than the wakes' verdicts. */
const OLD_RUN = 1793830000000
const withOldRuns = sources => ({ ...sources, reports: Object.fromEntries(Object.entries(sources.reports).map(([name, report]) => [name, { ...report, run: OLD_RUN }])) })
const judged = async options => judge(pictureOf(options.old ? withOldRuns(await sourcesOf(options)) : await sourcesOf(options)))
const AT_2040 = new Date(2026, 10, 5, 20, 40).getTime()

test('task 3: the 20:25 picture names the account switch in ONE line, with no per-worker "not in the app\'s list" and no wake for the two', async () => {
  const verdict = await judged({ elsewhere: true, old: true, now: AT_2040 })
  assert.deepEqual(verdict.elsewhere, ['Worker 1', 'Worker 5'])
  assert.equal(verdict.line, '5 of 7 chats reachable · checked 20:40 · Worker 1\'s and Worker 5\'s chats are in your other Claude account: run /reimport-chats, then restart the app')
  assert.equal(verdict.tone, 'attention')
  assert.doesNotMatch(verdict.line, /not in the app's list|open its chat|\n/)
  assert.deepEqual([verdict.total, verdict.reachable], [7, 5])
  assert.equal(verdict.fixed.some(one => one.kind === 'wake-again'), false, 'the app is not back: nothing is woken again')
  assert.equal(verdict.actions.closeIncidents.some(one => one.id === 'X154' || one.id === 'X155'), false, 'Workers 1 and 5 do not answer')
})

test('task 3: the 20:33 picture (reimported, the app answered "not found" and has not read the files) says to restart the app, naming the chats', async () => {
  const verdict = await judged({ elsewhere: false, old: true, now: AT_2040 })
  assert.deepEqual(verdict.restartNeeded, ['Worker 1', 'Worker 5'])
  assert.equal(verdict.line, 'All 7 chats reachable · checked 20:40 · restart the app so it reads the reimported chats: Worker 1 and Worker 5')
  assert.equal(verdict.tone, 'attention')
  assert.equal(verdict.fixed.some(one => one.kind === 'wake-again'), false)
})

test('task 3: the 21:20 picture (a new run heard) wakes Workers 1, 2, 5 and the Supervisor again once, clears their notices and closes X154-X158 and X160', async () => {
  const verdict = await judged({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'] })
  const kinds = kind => verdict.fixed.filter(one => one.kind === kind).map(one => one.chat).sort()
  assert.deepEqual(kinds('wake-again'), ['Supervisor', 'Worker 1', 'Worker 2', 'Worker 5'])
  assert.deepEqual(kinds('notice-cleared'), ['Supervisor', 'Worker 1', 'Worker 2', 'Worker 5'])
  assert.deepEqual(verdict.actions.closeIncidents.map(one => one.id).sort(), ['X154', 'X155', 'X156', 'X157', 'X158', 'X160'])
  assert.ok(verdict.actions.closeIncidents.every(one => one.why === 'gone after the check at 21:25'))
  assert.deepEqual(verdict.actions.reopen.map(one => one.chat).sort(), ['Supervisor', 'Worker 1', 'Worker 2', 'Worker 5'])
  assert.deepEqual(verdict.restartNeeded, [], 'a newer run beats the "not found" guess')
  assert.equal(verdict.line, 'All 7 chats reachable · checked 21:25')
  assert.equal(verdict.tone, 'quiet')
  // The stub never counts as Worker 2's chat: Worker 2 is the real file.
  assert.equal(pictureOf(await sourcesOf({ elsewhere: false })).lanes.find(lane => lane.name === 'Worker 2').listedWhere, 'here')
})

test('task 3: a clean picture (everything runs, no failed wake, no ban) is a quiet line and fixes nothing', async () => {
  const verdict = judge(pictureOf({ ...(await sourcesOf({ elsewhere: false, down: [] })), wakes: wakesOfFile({ wakes: {} }), envelopes: {}, incidents: [] }))
  assert.equal(verdict.line, 'All 7 chats reachable · checked 21:25')
  assert.equal(verdict.tone, 'quiet')
  assert.deepEqual(verdict.fixed, [])
})

test('task 3: a ban whose lane runs that model is dropped; a ban of another model stays', async () => {
  const verdict = await judged({ elsewhere: false, down: [] })
  assert.deepEqual(verdict.actions.banDrops, [{ chat: 'Worker 3', model: 'claude-sonnet-5-5', envelope: 'e3' }])
  assert.deepEqual(verdict.fixed.filter(one => one.kind === 'ban-dropped').map(one => one.chat), ['Worker 3'])
})

test('task 3: several causes are still ONE line, in the order account, restart, no chat', async () => {
  const sources = withOldRuns(await sourcesOf({ elsewhere: true }))
  // Worker 2 loses its file too; Worker 1 and 5 stay in the other account; Worker 3 had its file but it was only a stub.
  const folders = sources.folders.map(one => ({ ...one, chats: new Map([...one.chats].filter(([id]) => id !== W2_REAL_APP)) }))
  const verdict = judge(pictureOf({ ...sources, folders }))
  assert.equal(verdict.line.split('\n').length, 1)
  assert.match(verdict.line, /^4 of 7 chats reachable · checked 21:25 · Worker 1's and Worker 5's chats are in your other Claude account: run \/reimport-chats, then restart the app · Worker 2 has no chat in the app: open one from the board$/)
})

test('task 3: no wake-again before a run newer than the failure was heard (the older-than-the-trigger guard)', async () => {
  const verdict = await judged({ elsewhere: false, old: true, down: ['Worker 2'] })
  assert.equal(verdict.fixed.some(one => one.chat === 'Worker 2' && one.kind === 'wake-again'), false)
  assert.deepEqual(verdict.actions.reopen, [])
})

test('task 3: the 30 s bound is said in the line', async () => {
  const verdict = judge(pictureOf({ ...(await sourcesOf()), tooSlow: true }))
  assert.equal(verdict.line, 'Checked 21:25, but the app\'s chat list could not be read in 30 s: checked again at the next start')
  assert.equal(verdict.tone, 'attention')
})
