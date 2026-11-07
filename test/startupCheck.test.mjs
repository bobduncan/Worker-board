// The start-up check (2026-11-05, chat 3's brief and chat 1's plan): one moment where the board re-reads reality. Stage 1,
// tasks 1-4: where a chat's file is (task 1), the picture (task 2), the verdict (task 3) and its writes (task 4). The real
// case of the evening is the fixture: fixtures/wake-account (the two Worker 2 files, the Worker 1 files, the wake record) and
// fixtures/startup-check (trimmed copies of the snapshot, made-up paths).

import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { listedWhere, readAccountFolders, readAppChats } from '../src/appChats.mjs'
import { recordFindings } from '../src/supervisor/incidents.mjs'
import { apply, asksOf, judge, liftBan, pictureOf } from '../src/startupCheck.mjs'
import { createChecker } from '../src/startupCheckRun.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { claim, failedAtOf, nextPath, ranSince, wakesOfFile } from '../src/wake.mjs'
import { workApi } from '../src/work/api.mjs'
import { bansOf } from '../src/work/handover.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { writeAtomic } from '../src/write.mjs'

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
/** The report with the new run at 21:20:41 (Main's): the moment the app was back, as the board heard it. */
const RUN_2120 = 1793910041218
const sourcesOf = async ({ elsewhere = false, down = ['Worker 1', 'Worker 2', 'Worker 5'], now = AT_2125, trigger = 'start', triggerAt = null } = {}) => ({
  now,
  trigger,
  triggerAt,
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

test('task 3: the 21:20 picture (a new run heard at 21:20:41) wakes Workers 1, 2 and 5 again once, clears their notices and closes X154-X156, X158 and X160; the Supervisor (failed again at 21:23) is not woken and X157 stays', async () => {
  const verdict = await judged({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'], trigger: 'app-restart', triggerAt: RUN_2120 })
  const kinds = kind => verdict.fixed.filter(one => one.kind === kind).map(one => one.chat).sort()
  assert.deepEqual(kinds('wake-again'), ['Worker 1', 'Worker 2', 'Worker 5'])
  assert.deepEqual(kinds('notice-cleared'), ['Worker 1', 'Worker 2', 'Worker 5'])
  assert.deepEqual(verdict.actions.closeIncidents.map(one => one.id).sort(), ['X154', 'X155', 'X156', 'X158', 'X160'])
  assert.ok(verdict.actions.closeIncidents.every(one => one.why === 'gone after the check at 21:25'))
  assert.deepEqual(verdict.actions.reopen.map(one => one.chat).sort(), ['Worker 1', 'Worker 2', 'Worker 5'])
  assert.equal(verdict.actions.noteRun, RUN_2120, 'the runs of 22:30 in the snapshot are later than this picture\'s now: not proof of 21:25')
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
  const folders = sources.folders.map(one => ({ ...one, ids: one.ids.filter(id => id !== W2_REAL_APP), chats: new Map([...one.chats].filter(([id]) => id !== W2_REAL_APP)) }))
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

// ---- Task 4: the writes ----

test('task 4: apply on the 21:20 verdict: the wakes are open again (one message each, once), the bans are lifted, the six incidents are gone, check.json is written', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startup-apply-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const NOW = AT_2125
  // The incidents in a real store (made-up ids X1-X6 for the six of the evening, same keys and subjects).
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const board = body => workApi(body, { dir, now: NOW, prefix: '', as: 'server', roleOf: () => null })
  const evening = await json('incidents.json')
  await recordFindings(evening.map(one => ({ rule: one.source, key: one.key, subject: one.subject, text: one.title })), { work: board })
  const sources = await sourcesOf({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'], trigger: 'app-restart', triggerAt: RUN_2120 })
  sources.incidents = evening.map((one, index) => ({ ...one, id: `X${index + 1}` }))
  const verdict = judge(pictureOf(sources))
  const envelopes = structuredClone(sources.envelopes)
  const written = []
  const writers = {
    wakes: sources.wakes,
    saveWakes: async () => written.push('wakes'),
    liftBan: async drop => liftBan(envelopes[drop.chat], drop.envelope, NOW),
    closeIncidents: async list => (await board({ action: 'incident-gone', gone: list.map(one => ({ id: one.id, why: one.why })) })).result.gone,
    writeCheck: async result => writeAtomic(join(dir, 'check.json'), `${JSON.stringify(result)}\n`),
  }
  const result = await apply(verdict, writers, NOW)
  // The wake record: a message is claimed to each of the three, once; the Supervisor stays failed.
  {
    const spell = sources.wakes.wakes.get('Supervisor').at(-1).spell
    assert.notEqual(nextPath(sources.wakes, { chat: 'Supervisor', spell, senderClaims: true, paths: ['message', 'launch'] }), 'message')
  }
  for (const chat of ['Worker 1', 'Worker 2', 'Worker 5']) {
    const spell = sources.wakes.wakes.get(chat).at(-1).spell
    const ask = () => nextPath(sources.wakes, { chat, spell, senderClaims: true, paths: ['message', 'launch'] })
    assert.equal(ask(), 'message', chat)
    assert.ok(claim(sources.wakes, { chat, spell, path: 'message', by: 'Main', jobId: `wake:${spell}:${chat}`, now: NOW + 1000, paths: ['message'] }), chat)
    assert.notEqual(ask(), 'message', `${chat}: once`)
  }
  assert.equal(sources.wakes.heardRunAt, verdict.actions.noteRun)
  assert.deepEqual([...bansOf(envelopes['Worker 3'], NOW)], [], 'the ban of Worker 3 is lifted')
  assert.equal(envelopes['Worker 3'][0].outcome.liftedBy, 'check')
  assert.deepEqual([...bansOf(envelopes['Worker 4'], NOW).keys()], ['claude-opus-5-5'], 'a ban of another model stays')
  const store = await readStore(dir)
  for (const n of [1, 2, 3, 5, 6]) {
    const item = store.items.get(`X${n}`)
    assert.equal(item.head.get('State'), 'gone', `X${n}`)
    assert.match((item.sections.get('History') ?? []).join('\n'), /gone after the check at 21:25/)
  }
  assert.equal(store.items.get('X4').head.get('State'), 'open', 'X157: the Supervisor was not woken, its incident stands')
  const saved = JSON.parse(await readFile(join(dir, 'check.json'), 'utf8'))
  assert.deepEqual(saved, result)
  assert.deepEqual([saved.line, saved.running, saved.total, saved.reachable], ['All 7 chats reachable · checked 21:25', false, 7, 7])
  assert.equal(saved.fixed.filter(one => one.kind === 'wake-again').length, 3)
  assert.equal(saved.fixed.filter(one => one.kind === 'incident-gone').length, 5)
  assert.equal(saved.trigger, 'app-restart', 'the result names the trigger the picture had')
  assert.equal(saved.fixed.filter(one => one.kind === 'ban-dropped').length, 1)
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.tmp')), [], 'written atomically')
  // Once: a second check on the same record re-opens nothing and closes nothing.
  // Fed the store's incidents as they are after the close, the second check closes nothing and re-opens nothing.
  const after = [...(await readStore(dir)).items.values()].filter(item => item.head.get('Kind') === 'incident').map(item => ({ id: item.head.get('Id'), key: item.head.get('Key'), source: item.head.get('Source'), subject: item.head.get('Subject'), state: item.head.get('State'), since: item.head.get('Since') }))
  assert.equal(after.length, 6)
  const again = judge(pictureOf({ ...sources, incidents: after }))
  assert.deepEqual(again.actions.reopen, [])
  assert.deepEqual(again.actions.closeIncidents.map(one => one.id), [], 'nothing left to close that the first check could close')
})

test('task 4: a writer that fails is said in `failed` and leaves the other fixes done; a fix with no writer is not claimed as fixed', async () => {
  const sources = await sourcesOf({ elsewhere: false, down: ['Worker 1'] })
  const verdict = judge(pictureOf(sources))
  const result = await apply(verdict, { wakes: sources.wakes, liftBan: async () => { throw new Error('outbox busy') } }, AT_2125)
  assert.deepEqual(result.failed, ['ban-dropped: outbox busy'])
  assert.equal(result.fixed.some(one => one.kind === 'wake-again'), true)
  assert.equal(result.fixed.some(one => one.kind === 'ban-dropped'), false)
  assert.equal(result.fixed.some(one => one.kind === 'incident-gone'), false, 'no writer, no claim')
})

// ---- Review 1 (Opus, 2026-11-05): the nine fixes ----

test('review 1 (1): an incident that rests on a re-open stays open when the wake write fails; the others close; `failed` says so', async () => {
  const sources = await sourcesOf({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'], trigger: 'app-restart', triggerAt: RUN_2120 })
  const verdict = judge(pictureOf(sources))
  const closed = []
  const result = await apply(verdict, { wakes: { get wakes() { throw new Error('wakes.json busy') } }, closeIncidents: async list => { closed.push(...list.map(one => one.id)); return list.map(one => one.id) } }, AT_2125)
  assert.deepEqual(closed.sort(), ['X158', 'X160'], 'only the ones that do not rest on the wake: the board-wide one and Main\'s (it runs)')
  assert.ok(result.failed.some(one => /^wake-again: wakes.json busy/.test(one)))
  assert.equal(result.fixed.some(one => one.kind === 'wake-again' || one.kind === 'notice-cleared'), false)
  assert.deepEqual(result.fixed.filter(one => one.kind === 'incident-gone').map(one => one.what.split(' ')[0]).sort(), ['X158', 'X160'])
})

test('review 1 (3): a read that took too long leaves elsewhere, restart and nowhere empty and reachable null, never "nowhere" for every chat', async () => {
  const verdict = judge(pictureOf({ ...(await sourcesOf()), folders: [], tooSlow: true }))
  assert.deepEqual([verdict.elsewhere, verdict.restartNeeded, verdict.nowhere], [[], [], []])
  assert.equal(verdict.reachable, null)
  assert.equal(verdict.tooSlow, true)
  assert.deepEqual(verdict.actions.reopen, [], 'a chat whose listing is not known is not woken')
  assert.doesNotMatch(verdict.line, /no chat in the app/)
})

test('review 1 (4): a listed file that could not be read whole is unknown, not "no chat"; a running lane is never elsewhere or nowhere', async () => {
  const sources = await sourcesOf({ elsewhere: false, down: [] })
  const half = sources.folders.map(one => ({ ...one, chats: new Map([...one.chats].filter(([id]) => id !== 'local_0981b01c-5087-464a-beca-85d4f50734d2')) }))
  const verdict = judge(pictureOf({ ...sources, folders: half }))
  assert.equal(pictureOf({ ...sources, folders: half }).lanes.find(lane => lane.name === 'Worker 3').listedWhere, 'unknown')
  assert.deepEqual(verdict.nowhere, [])
  assert.equal(verdict.line, 'All 7 chats reachable · checked 21:25')
  // Not listed at all, but it runs (its mod just called): the app has the chat, whatever the folders say.
  const gone = sources.folders.map(one => ({ ...one, ids: one.ids.filter(id => id !== 'local_0981b01c-5087-464a-beca-85d4f50734d2'), chats: new Map([...one.chats].filter(([id]) => id !== 'local_0981b01c-5087-464a-beca-85d4f50734d2')) }))
  const running = judge(pictureOf({ ...sources, folders: gone }))
  assert.deepEqual(running.nowhere, [])
  assert.equal(running.reachable, 7)
  // The same lane NOT running is "no chat".
  const down = judge(pictureOf({ ...(await sourcesOf({ elsewhere: false, down: ['Worker 3'] })), folders: gone }))
  assert.deepEqual(down.nowhere, ['Worker 3'])
})

test('review 1 (5): a board start or the button counts as a trigger: a reimport and an app restart with no lane run yet still wake the chats; a trigger before the failure does not', async () => {
  const afterFailure = new Date(2026, 10, 5, 21, 0).getTime()
  const beforeFailure = new Date(2026, 10, 5, 20, 0).getTime()
  const base = { elsewhere: false, old: true, down: ['Worker 1', 'Worker 2', 'Worker 5'] }
  const start = judge(pictureOf(withOldRuns(await sourcesOf({ ...base, trigger: 'start', triggerAt: afterFailure }))))
  assert.deepEqual(start.actions.reopen.map(one => one.chat).sort(), ['Worker 1', 'Worker 2', 'Worker 5'])
  assert.equal(start.actions.noteRun, afterFailure)
  assert.deepEqual(start.restartNeeded, [])
  const early = judge(pictureOf(withOldRuns(await sourcesOf({ ...base, trigger: 'button', triggerAt: beforeFailure }))))
  assert.deepEqual(early.actions.reopen, [])
  assert.deepEqual(early.restartNeeded, ['Worker 1', 'Worker 5'])
  // apply notes the trigger's moment (G1's heardRunAt) and names the trigger in the result.
  const sources = withOldRuns(await sourcesOf({ ...base, trigger: 'button', triggerAt: afterFailure }))
  const result = await apply(judge(pictureOf(sources)), { wakes: sources.wakes }, AT_2125)
  assert.equal(sources.wakes.heardRunAt, afterFailure)
  assert.equal(result.trigger, 'button')
  // Once per spell: the same trigger again re-opens nothing.
  assert.deepEqual(judge(pictureOf(sources)).actions.reopen, [])
})

test('review 1 (6): notice-cleared is recorded only when the notice really went (noticeOf before and after differ)', async () => {
  const sources = await sourcesOf({ down: ['Worker 1'], trigger: 'app-restart', triggerAt: RUN_2120 })
  const verdict = judge(pictureOf(sources))
  // Worker 1's record is emptied between the look and the write: nothing to re-open, no notice to clear.
  const result = await apply(verdict, { wakes: wakesOfFile({ wakes: {} }) }, AT_2125)
  assert.equal(result.fixed.some(one => one.kind === 'notice-cleared'), false)
  const real = await apply(verdict, { wakes: sources.wakes }, AT_2125)
  assert.deepEqual(real.fixed.filter(one => one.kind === 'notice-cleared').map(one => one.chat), ['Worker 1'])
})

// ---- Task 5: the runner (src/startupCheckRun.mjs) ----

/** A runner on the evening's sources: the folders and the rest as ports; `calls` counts the reads. */
async function checkerOn(options = {}) {
  const sources = await sourcesOf({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5'], ...options.sources })
  const { folders, ...rest } = sources
  const calls = { sources: 0, folders: 0, changes: [], logs: [], after: 0 }
  const checker = createChecker({
    clock: () => options.now ?? AT_2125,
    readSources: async () => { calls.sources += 1; if (options.fail) throw new Error(options.fail); return rest },
    readFolders: options.readFolders ?? (async () => { calls.folders += 1; return folders }),
    writers: { wakes: rest.wakes, closeIncidents: async list => list.map(one => one.id), writeCheck: async () => {} },
    afterApply: async () => { calls.after += 1 },
    onChange: () => calls.changes.push(checker.view()?.running === true),
    log: text => calls.logs.push(text),
    boundMs: options.boundMs ?? 30_000,
    debounceMs: 10_000,
    ...(options.setTimer === undefined ? {} : { setTimer: options.setTimer, clearTimer: options.clearTimer }),
  })
  return { checker, calls, rest }
}

test('task 5: a check shows "running" at once, then its result; a second call while one runs answers the running record and reads nothing again', async () => {
  const { checker, calls } = await checkerOn()
  assert.equal(checker.view(), null, 'nothing before the first check')
  const first = checker.start('start')
  assert.equal(first.started, true)
  assert.deepEqual([first.view.running, first.view.trigger], [true, 'start'], 'the loader state is there before any await')
  const second = checker.start('button')
  assert.equal(second.started, false)
  assert.equal(second.view.running, true)
  assert.equal(second.view.trigger, 'start', 'the running one is the one answered')
  const result = await first.done
  assert.equal(calls.sources, 1, 'one run')
  assert.equal(result.running, false)
  assert.equal(result.trigger, 'start')
  assert.match(result.line, /chats reachable/)
  assert.equal(checker.view().running, false)
  assert.deepEqual(calls.changes, [true, false], 'the state is read anew when it starts and when it ends')
  assert.equal(calls.after, 1, 'the wake pass follows the writes once')
  assert.equal(checker.start('button').started, true, 'a new one after it ended')
})

test('task 5: the 30 s bound: a folder read that does not answer is said in the line, not waited for', { timeout: 5000 }, async () => {
  const { checker } = await checkerOn({ boundMs: 50, readFolders: () => new Promise(() => {}) })
  const result = await checker.start('start').done
  assert.equal(result.tooSlow, true)
  assert.match(result.line, /could not be read in 30 s/)
  assert.deepEqual([result.elsewhere, result.nowhere], [[], []])
  assert.equal(result.reachable, null)
})

test('task 5: a failing read is a line "The check failed", never a throw, and the next check runs', async () => {
  const { checker, calls } = await checkerOn({ fail: 'disk gone' })
  const result = await checker.start('button').done
  assert.deepEqual([result.running, result.tone, result.line], [false, 'attention', 'The check failed: disk gone'])
  assert.deepEqual(calls.logs, ['Check: disk gone'])
  assert.equal(checker.start('button').started, true)
})

test('task 5: new runs within the debounce make ONE app-restart check; none while one waits; none when a check finished after the report', async () => {
  const timers = []
  const options = { setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer }, clearTimer: timer => { if (timer !== null) timer.cleared = true } }
  const { checker, calls } = await checkerOn(options)
  assert.equal(checker.newRun(AT_2125 - 1000), true)
  assert.equal(checker.newRun(AT_2125 - 900), false, 'a check is already waiting')
  assert.equal(checker.newRun(AT_2125 - 800), false)
  assert.equal(timers.filter(timer => timer.ms === 10_000).length, 1)
  timers.find(timer => timer.ms === 10_000).fn()
  await new Promise(done => setImmediate(done))
  await new Promise(done => setImmediate(done))
  assert.equal(calls.sources, 1)
  assert.equal(checker.view().trigger, 'app-restart')
  // A report older than the finished check starts nothing.
  assert.equal(checker.newRun(AT_2125 - 5000), false)
  assert.equal(checker.newRun(AT_2125 + 5000), true, 'a report after it does')
})

test('task 5: a second check right after the first changes nothing (the fixes are idempotent) and one full check is quick', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startup-idem-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const NOW = AT_2125
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: NOW }), undefined, { now: NOW })
  const board = body => workApi(body, { dir, now: NOW, prefix: '', as: 'server', roleOf: () => null })
  const evening = await json('incidents.json')
  await recordFindings(evening.map(one => ({ rule: one.source, key: one.key, subject: one.subject, text: one.title })), { work: board })
  const sources = await sourcesOf({ elsewhere: false, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'] })
  const { folders, ...rest } = sources
  const envelopes = structuredClone(sources.envelopes)
  const incidentsNow = async () => [...(await readStore(dir)).items.values()].filter(item => item.head.get('Kind') === 'incident').map(item => ({ id: item.head.get('Id'), key: item.head.get('Key'), source: item.head.get('Source'), subject: item.head.get('Subject'), state: item.head.get('State'), since: item.head.get('Since') }))
  const checker = createChecker({
    clock: () => NOW,
    readSources: async () => ({ ...rest, envelopes, incidents: await incidentsNow() }),
    readFolders: async () => folders,
    writers: { wakes: sources.wakes, liftBan: async drop => liftBan(envelopes[drop.chat], drop.envelope, NOW), closeIncidents: async list => (await board({ action: 'incident-gone', gone: list.map(one => ({ id: one.id, why: one.why })) })).result.gone, writeCheck: async () => {} },
  })
  const begun = performance.now()
  const first = await checker.start('app-restart').done
  const took = performance.now() - begun
  assert.ok(first.fixed.length >= 5, 'the first one fixes things')
  const second = await checker.start('button').done
  assert.deepEqual(second.fixed, [], 'the second changes nothing')
  assert.ok(took < 1000, `one full check took ${Math.round(took)} ms`)
  console.log(`start-up check: one full check on the real-case fixtures took ${Math.round(took)} ms, ${first.fixed.length} fixes`)
})

test('task 6: the board-wide incident (X158) is not closed while chats stay failed for good that the check did not re-open (no close and re-file loop)', async () => {
  // Old runs, no trigger moment: nothing is re-opened; Main runs, Workers 1, 2, 5 and the Supervisor stay failed.
  const verdict = await judged({ elsewhere: false, old: true, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'] })
  assert.equal(verdict.actions.closeIncidents.some(one => one.id === 'X158'), false)
  // Once the check re-opened some (a trigger after the failures), it goes.
  const after = await judged({ elsewhere: false, old: true, down: ['Worker 1', 'Worker 2', 'Worker 5', 'Supervisor'], trigger: 'start', triggerAt: AT_2125 })
  assert.equal(after.actions.closeIncidents.some(one => one.id === 'X158'), true)
})

// ---- MUST 1 (the person's screenshot, 2026-11-05 23:23): a chat that reports again clears its stale "could not wake" ----

/** 22:00 on the evening; the Supervisor's session started again at 21:57:10 (after its last failed attempt, 21:23:13). */
const AT_2200 = new Date(2026, 10, 5, 22, 0).getTime()
const SUPERVISOR_RUN = new Date(2026, 10, 5, 21, 57, 10).getTime()
const SUPERVISOR_REPORT = { state: 'ended', since: 1793862907525, background: false, run: SUPERVISOR_RUN, seq: 129, at: SUPERVISOR_RUN + 20_000, app: 'local_43a11efb-3de3-4577-802d-e91718ec94a1' }
/** The evening's sources with the Supervisor not running but reporting again (`report` replaces its kept report). */
const supervisorSources = async (report = SUPERVISOR_REPORT) => {
  const sources = await sourcesOf({ elsewhere: false, down: ['Supervisor'], now: AT_2200 })
  return { ...sources, reports: { ...sources.reports, Supervisor: report } }
}

test('MUST 1: the live Supervisor wake record (failed 20:31, 20:34, 21:20; last verdict 21:23:13) is stale once it reports again, and only then', async () => {
  const record = wakesOfFile(await json('wakes.json'))
  const spell = record.wakes.get('Supervisor').at(-1).spell
  assert.equal(failedAtOf(record, 'Supervisor', spell), 1793910193309, '21:23:13, the newest verdict')
  assert.equal(ranSince(record, 'Supervisor', spell, SUPERVISOR_REPORT, AT_2200), true, 'a session that started at 21:57 after the failure')
  assert.equal(ranSince(record, 'Supervisor', spell, { state: 'busy', at: AT_2200 - 60_000, run: 1793831678075 }, AT_2200), true, 'a report that is not an ended one, heard after the failure')
  // Not before the failure: the report of the morning of 11-05, and an ended report heard after it with the old run (a heartbeat).
  assert.equal(ranSince(record, 'Supervisor', spell, { state: 'ended', at: 1793862907959, run: 1793831678075 }, AT_2200), false)
  assert.equal(ranSince(record, 'Supervisor', spell, { state: 'ended', at: AT_2200 - 1000, run: 1793831678075 }, AT_2200), false)
  // A run later than now is no proof; no report is none; a chat without a failed attempt has nothing stale.
  assert.equal(ranSince(record, 'Supervisor', spell, { state: 'busy', at: AT_2200 + 5000, run: AT_2200 + 5000 }, AT_2200), false)
  assert.equal(ranSince(record, 'Supervisor', spell, null, AT_2200), false)
  assert.equal(ranSince(record, 'Worker 3', record.wakes.get('Worker 3').at(-1).spell, SUPERVISOR_REPORT, AT_2200), false)
})

test('MUST 1: the check clears the Supervisor wake notice, closes X157 and X158 ("gone after the check at 22:00"), wakes nobody, and a second check files nothing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'startup-stale-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: AT_2200 }), undefined, { now: AT_2200 })
  const board = body => workApi(body, { dir, now: AT_2200, prefix: '', as: 'server', roleOf: () => null })
  const evening = await json('incidents.json')
  await recordFindings(evening.map(one => ({ rule: one.source, key: one.key, subject: one.subject, text: one.title })), { work: board })
  const sources = await supervisorSources()
  sources.incidents = evening.map((one, index) => ({ ...one, id: `X${index + 1}` }))
  const verdict = judge(pictureOf(sources))
  assert.deepEqual(verdict.fixed.filter(one => one.kind === 'notice-cleared').map(one => one.chat), ['Supervisor'])
  assert.deepEqual(verdict.actions.reopen, [], 'the Supervisor is not woken again: it reports')
  // X157 is the 4th of the evening's incidents (made-up id X4), X158 the 5th (X5).
  assert.deepEqual(verdict.actions.closeIncidents.map(one => one.id).filter(id => ['X4', 'X5'].includes(id)).sort(), ['X4', 'X5'])
  const result = await apply(verdict, {
    wakes: sources.wakes,
    closeIncidents: async list => (await board({ action: 'incident-gone', gone: list.map(one => ({ id: one.id, why: one.why })) })).result.gone,
  }, AT_2200)
  assert.equal(result.fixed.some(one => one.kind === 'notice-cleared' && one.chat === 'Supervisor'), true, 'the clear is in `fixed`')
  const store = await readStore(dir)
  for (const id of ['X4', 'X5']) {
    assert.equal(store.items.get(id).head.get('State'), 'gone', id)
    assert.match((store.items.get(id).sections.get('History') ?? []).join('\n'), /gone after the check at 22:00/)
  }
  // The wake record is untouched by the clear (the state no longer names the chat; the record keeps what happened).
  assert.equal(sources.wakes.wakes.get('Supervisor').at(-1).reopenedAt, undefined)
  // A second check, fed the store as it is now: nothing left to close.
  const after = [...(await readStore(dir)).items.values()].filter(item => item.head.get('Kind') === 'incident').map(item => ({ id: item.head.get('Id'), key: item.head.get('Key'), source: item.head.get('Source'), subject: item.head.get('Subject'), state: item.head.get('State'), since: item.head.get('Since') }))
  const again = judge(pictureOf({ ...sources, incidents: after }))
  assert.deepEqual(again.actions.closeIncidents.map(one => one.id).filter(id => ['X4', 'X5'].includes(id)), [])
})

test('MUST 1: without a report after the failure the Supervisor stays failed: no notice cleared, X157 and X158 stay', async () => {
  const sources = withOldRuns(await supervisorSources({ ...SUPERVISOR_REPORT, run: 1793831678075, at: 1793862907959 }))
  sources.reports.Supervisor = { ...SUPERVISOR_REPORT, run: 1793831678075, at: 1793862907959 }
  const verdict = judge(pictureOf(sources))
  assert.deepEqual(verdict.fixed.filter(one => one.kind === 'notice-cleared'), [])
  assert.equal(verdict.actions.closeIncidents.some(one => ['X157', 'X158', 'X4', 'X5'].includes(one.id)), false)
})

test('MUST 1: no close and re-file loop for X158: the rule files nothing while the Supervisor wake is not a final failure any more', () => {
  const NOW = new Date(2026, 10, 5, 22, 0).getTime()
  const wake = { state: 'failed', final: false, need: false, spell: 0, attempts: [{ path: 'message', at: NOW - 3_000_000, by: 'Main', verdict: 'failed', verdictAt: NOW - 2_800_000, why: 'x', sentAt: NOW - 2_990_000 }] }
  const view = buildView({
    state: { chats: [{ name: 'Supervisor', isLeftover: false, isMain: false, isRunning: false, state: 'off', wake }], chatPrefix: '', check: null, wakes: { '*': { state: 'failed', attempts: [{ path: 'launch', verdict: 'failed', verdictAt: NOW - 2_000_000 }] } }, wakeBoardSince: null }, now: NOW,
  })
  const rule = id => WATCH_RULES.find(one => one.id === id)
  assert.deepEqual(rule('nobody-answers-wakes').check(view, {}), [])
  assert.deepEqual(rule('wake-failed').check(view, {}), [])
})

// ---- MUST 2 (the person's screenshot): `ask-withdrawn`, an open ask for the person whose step is over is closed ----

/** A store dir holding the real Q666 and B1051 (trimmed, fixtures/startup-check) beside made-up asks that must stay. */
async function storeWithAsks(t) {
  const dir = await mkdtemp(join(tmpdir(), 'startup-asks-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('# Backlog\n\n## Work\n- [ ] B12 A fix (for Digger; about 1 h)\n', { now: AT_2200 }), undefined, { now: AT_2200 })
  const put = (name, text) => writeFile(join(dir, `${name}.md`), text)
  await put('Q666', await readFile(join(SNAP, 'Q666.md'), 'utf8'))
  await put('B1051', await readFile(join(SNAP, 'B1051.md'), 'utf8'))
  const step = (id, state) => `Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nOwner: Worker 3\nSince: 2026-11-05 22:04\n`
  const ask = (id, extra) => `Id: ${id}\nKind: ask\nTitle: ${extra.title ?? `Question about ${extra.of}`}\nState: ${extra.state ?? 'open'}\nOwner: Main\nSince: 2026-11-05 21:41\nAsks: do\nBlocking: no\n${extra.of === undefined ? '' : `Of: ${extra.of}\n`}${extra.route === null ? '' : `Route: ${extra.route ?? 'person'}\n`}\n## Text\nA question.\n`
  await put('B1060', step('B1060', 'in progress'))
  await put('B1061', step('B1061', 'dropped'))
  await put('Q700', ask('Q700', { of: 'B1051', route: 'person' }))
  await put('Q701', ask('Q701', { of: 'B1060', route: 'person' }))
  await put('Q702', ask('Q702', { of: 'B1051', route: 'main' }))
  await put('Q703', ask('Q703', { of: 'B1061', route: 'person' }))
  await put('Q704', ask('Q704', { of: 'B1051', route: 'person', state: 'answered' }))
  await put('Q705', ask('Q705', { of: 'G15', route: 'person', title: 'Which goal is next? (not B1051)' }))
  return dir
}

test('MUST 2: asksOf reads the open asks routed to the person with their step (Q666 has no Of: the first B<n> of its title) and the step\'s state', async t => {
  const dir = await storeWithAsks(t)
  const asks = asksOf((await readStore(dir)).items)
  assert.deepEqual(asks.find(one => one.id === 'Q666'), { id: 'Q666', owner: 'Main', step: 'B1051', stepState: 'done' })
  assert.deepEqual(asks.map(one => [one.id, one.step, one.stepState]).sort(), [['Q666', 'B1051', 'done'], ['Q700', 'B1051', 'done'], ['Q701', 'B1060', 'in progress'], ['Q703', 'B1061', 'dropped']])
  // Not read: another route (Q702), not open (Q704), an Of that is a goal (Q705: no step).
  assert.equal(asks.some(one => ['Q702', 'Q704'].includes(one.id)), false)
  assert.equal(asks.some(one => one.id === 'Q705'), false, 'an Of that is a goal names no step (the title B1051 is not used when Of is set)')
})

test('MUST 2: the check withdraws Q666 ("its step B1051 is done"), also an ask of a dropped step; asks whose step still runs, other routes and answered ones stay; a second check withdraws nothing', async t => {
  const dir = await storeWithAsks(t)
  const board = body => workApi(body, { dir, now: AT_2200, prefix: '', as: 'server', roleOf: () => null })
  const sources = { ...(await sourcesOf({ elsewhere: false, down: [], now: AT_2200 })), asks: asksOf((await readStore(dir)).items) }
  const verdict = judge(pictureOf(sources))
  assert.deepEqual(verdict.actions.withdrawAsks.map(one => one.id).sort(), ['Q666', 'Q700', 'Q703'])
  assert.deepEqual(verdict.fixed.filter(one => one.kind === 'ask-withdrawn').map(one => one.what).sort(), ['Q666 withdrawn: its step B1051 is done', 'Q700 withdrawn: its step B1051 is done', 'Q703 withdrawn: its step B1061 is dropped'])
  const result = await apply(verdict, { withdrawAsks: async list => (await board({ action: 'asks-withdrawn', withdraw: list.map(one => ({ id: one.id })) })).result.withdrawn }, AT_2200)
  assert.deepEqual(result.fixed.filter(one => one.kind === 'ask-withdrawn').map(one => one.what.split(' ')[0]).sort(), ['Q666', 'Q700', 'Q703'], 'in `fixed`')
  const store = await readStore(dir)
  assert.equal(store.items.get('Q666').head.get('State'), 'withdrawn')
  assert.match((store.items.get('Q666').sections.get('History') ?? []).join('\n'), /withdrawn: its step B1051 is done/)
  assert.equal(store.items.get('Q703').head.get('State'), 'withdrawn')
  for (const id of ['Q701', 'Q702', 'Q704', 'Q705']) assert.notEqual(store.items.get(id).head.get('State'), 'withdrawn', id)
  assert.equal(store.items.get('Q701').head.get('State'), 'open')
  // Once: the next check reads the store as it is now.
  const again = judge(pictureOf({ ...sources, asks: asksOf(store.items) }))
  assert.deepEqual(again.actions.withdrawAsks, [])
  assert.deepEqual(again.fixed.filter(one => one.kind === 'ask-withdrawn'), [])
})

test('MUST 2: the result counts it: `fixed` and the runner\'s log line ("fixed N") include the withdrawn ask; a failing writer is in `failed`, not claimed', async t => {
  const dir = await storeWithAsks(t)
  const board = body => workApi(body, { dir, now: AT_2200, prefix: '', as: 'server', roleOf: () => null })
  const sources = { ...(await sourcesOf({ elsewhere: false, down: [], now: AT_2200 })), asks: asksOf((await readStore(dir)).items) }
  const { folders, ...rest } = sources
  const logs = []
  const checker = createChecker({
    clock: () => AT_2200, readSources: async () => rest, readFolders: async () => folders, log: text => logs.push(text),
    writers: { withdrawAsks: async list => (await board({ action: 'asks-withdrawn', withdraw: list.map(one => ({ id: one.id })) })).result.withdrawn },
  })
  const result = await checker.start('button').done
  assert.equal(result.fixed.filter(one => one.kind === 'ask-withdrawn').length, 3)
  assert.match(logs[0], /fixed 3\.$/, 'the ban of Worker 3 has no writer here: only the three asks are claimed')
  const failing = await apply(judge(pictureOf(sources)), { withdrawAsks: async () => { throw new Error('store busy') } }, AT_2200)
  assert.deepEqual(failing.failed, ['ask-withdrawn: store busy'])
  assert.equal(failing.fixed.some(one => one.kind === 'ask-withdrawn'), false)
})

test('MUST 2: the work API\'s `asks-withdrawn` is the board\'s alone and checks each ask itself: no chat may call it, a step still running or another route is left alone', async t => {
  const dir = await storeWithAsks(t)
  const as = role => body => workApi(body, { dir, now: AT_2200, prefix: '', as: role, roleOf: () => null, who: 'Main' })
  for (const role of ['main', 'worker', 'person']) {
    const refused = await as(role)({ action: 'asks-withdrawn', withdraw: [{ id: 'Q666' }] })
    assert.equal(refused.ok, false, role)
  }
  const server = await as('server')({ action: 'asks-withdrawn', withdraw: [{ id: 'Q701' }, { id: 'Q702' }, { id: 'Q705' }, { id: 'Q404' }, { id: 'B1051' }, { id: 'Q666' }] })
  assert.equal(server.ok, true)
  assert.deepEqual(server.result.withdrawn, ['Q666'], 'only the ask whose step is over, routed to the person')
  const store = await readStore(dir)
  assert.equal(store.items.get('Q666').head.get('State'), 'withdrawn')
  assert.equal(store.items.get('Q701').head.get('State'), 'open')
  assert.equal(store.items.get('B1051').head.get('State'), 'done', 'the step is not touched')
})
