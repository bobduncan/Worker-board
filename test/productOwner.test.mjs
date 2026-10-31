// The Product owner (the person, 2026-10-31: "these brainstorms are ones the user is waiting for, so they are more important
// then refineing backlog items, so i dont want a bottleneck that we are waiting for something", then "B": a chat of its own;
// roles/product-owner.md). The list of chats may name one chat "owner": every talk word goes to it (the brainstorm, "Change this
// goal", the Focus page's talk), it is woken at once and first, nothing else is sent to it, its card shows under the Advisor's,
// the board holds it at Opus · medium, and the setup check names its own routine. While no owner is listed, every talk stays
// with the Advisor as before. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer } from '../fixtures/lines.mjs'
import { parseList } from '../src/appChats.mjs'
import { laneRole, shownChats } from '../src/bridge.mjs'
import { brainstormsState, fixesToTell } from '../src/brainstorm.mjs'
import { codeJobsView, missingRoutines, taskWords } from '../src/codeJobs.mjs'
import { parseConfig } from '../src/config.mjs'
import { focusMove } from '../src/focus.mjs'
import { handJobs, workerNames } from '../src/hands.mjs'
import { chatsByRole } from '../src/oldMods.mjs'
import { asleepWithWork, chatToOpen, handWorkWaits } from '../src/opener.mjs'
import { checkSay, wakeFor, wakerFor } from '../src/say.mjs'
import { OWNER_SETTING, TALK_COMMANDS, isTalkWord, ownerStartWords, ownerTaskIds, talkPartnerOf } from '../src/talkPartner.mjs'
import { workApi } from '../src/work/api.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const MIN = 60_000
const PROJECT = 'D:\\work\\studio'
const PREFIX = 'Studio · '
const OWNER = 'Product owner'
const PATH = '.claude/brainstorms/2026-10-31-lanterns.md'
const HEAD = '# Brainstorm: Lanterns\nGoal: new\nStarted: 2026-10-31 11:00 · State: running\nOpening: Where should the lanterns go?\n\n'
const LONG_Q = '## Q1 (11:01)\nWhere in the whole garden should the very first of all the new lanterns stand when the evening comes?\n- A: Gate (advised)\n- B: Pond\n'

const app = (name, more = {}) => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name.replace(/\W/g, '')}`, cliSessionId: `cli-${name.replace(/\W/g, '')}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1', ...more })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW - 10 * MIN })
const config = (more = {}) => ({ ...parseConfig('{}', {}), project: PROJECT, ...more })

/** The made-up studio's state: a main chat, a worker, the Advisor, and with `owner` the Product owner listed and open. */
function studio({ owner = true, ownerApp = {}, outbox = [], threads = [[PATH, HEAD]], settings = {} } = {}) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  const list = { prefix: PREFIX, main: 'Lead', ...(owner ? { owner: OWNER } : {}) }
  const raw = {
    listText: JSON.stringify(list),
    appChatTexts: [app('Lead'), app('Digger'), app('Advisor'), ...(owner ? [app(OWNER, ownerApp)] : [])],
    tails: Object.fromEntries(['Lead', 'Digger', 'Advisor', 'Productowner'].map(name => [`cli-${name}`, tail([answer(NOW - 30 * MIN, 'ok')])])),
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    threadTexts: threads.map(([path, text], at) => ({ path, text, at: NOW - (at + 1) * MIN })),
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config: config(settings) })
}

// ---------------------------------------------------------------------------------------------------------------------
// The role in the list of chats, and its lane

test('the list of chats may name an owner; without one nothing changes and every talk goes to the Advisor', () => {
  assert.equal(parseList(JSON.stringify({ prefix: PREFIX, main: 'Lead', owner: ` ${OWNER} ` })).owner, OWNER)
  assert.equal('owner' in parseList(JSON.stringify({ prefix: PREFIX, main: 'Lead' })), false)
  const state = studio({ owner: false })
  assert.equal(state.productOwner, null)
  assert.equal(state.ownerName, null)
  assert.deepEqual([state.talkPartner.name, state.talkPartner.role, state.talkPartner.label], ['Advisor', 'advisor', 'partner'])
  // Every talk word goes to the Advisor, also one the page names the Advisor in.
  const said = checkSay({ to: 'Advisor', command: 'brainstorm', thread: PATH }, state, 4000)
  assert.equal(said.ok, true)
  assert.equal(said.message.to, 'Advisor')
  // The board's fix of a question's title goes to the Advisor, with its own job's words.
  const threads = brainstormsState([{ path: PATH, text: `${HEAD}${LONG_Q}`, at: NOW }], '.claude/brainstorms').threads
  const fixes = fixesToTell(threads, [], talkPartnerOf(state))
  assert.equal(fixes[0].to, 'Advisor')
  assert.match(fixes[0].text, /roles\/partner\.md, "A brainstorm"/)
})

test('an owner listed: its own lane under the Advisor, no worker and no queue; its role on the board', () => {
  const state = studio()
  assert.equal(state.productOwner.name, OWNER)
  assert.equal(state.ownerName, OWNER)
  assert.ok(!state.chats.some(lane => lane.name === OWNER), 'no lane among the workers')
  assert.equal(state.workers.count, 1, 'Digger is the one worker')
  assert.deepEqual([state.talkPartner.name, state.talkPartner.role, state.talkPartner.label], [OWNER, 'owner', 'Product owner'])
  assert.equal(laneRole(state, OWNER), 'owner')
  assert.ok(shownChats(state).some(one => one.name === OWNER), 'it takes its own words')
  assert.ok(!workerNames(state).has(OWNER))
  assert.deepEqual(chatsByRole(state).find(one => one.name === OWNER)?.role, 'owner')
  assert.ok(state.spendingSubjects.some(one => one.name === OWNER && one.role === 'owner'))
})

test('an owner listed but no chat of it open: the talks stay with the Advisor, and a hand runs its own routine', () => {
  const state = studio({ owner: false })
  const listed = { ...state, ownerName: OWNER }
  assert.equal(talkPartnerOf(listed).name, 'Advisor')
  const word = ownerStartWords({ state: listed, outbox: [], now: NOW, folder: PROJECT })
  assert.deepEqual([word.to, word.command, word.routine.title, word.routine.tasks], ['Lead', 'spawn', `${PREFIX}${OWNER}`, ['studio-product-owner', 'studio-product-owner-2']])
  // Once in half an hour; none while the person pauses; none once its chat is there.
  assert.equal(ownerStartWords({ state: listed, outbox: [{ ...word, at: NOW - 10 * MIN }], now: NOW, folder: PROJECT }), null)
  assert.notEqual(ownerStartWords({ state: listed, outbox: [{ ...word, at: NOW - 31 * MIN }], now: NOW, folder: PROJECT }), null)
  assert.equal(ownerStartWords({ state: listed, outbox: [], now: NOW, folder: PROJECT, isPaused: true }), null)
  assert.equal(ownerStartWords({ state: { ...studio(), ownerName: OWNER }, outbox: [], now: NOW, folder: PROJECT }), null)
  // The hand runs that routine, not the next worker's: the Workers mod's spawn job as it is.
  const { jobs } = handJobs({ caller: 'Lead', taken: [{ id: 's1', ...word }], lanes: [], now: NOW, spawn: { title: `${PREFIX}Worker 2`, tasks: ['studio-worker-2'] } })
  assert.deepEqual(jobs, [{ id: 's1', chat: `${PREFIX}${OWNER}`, spawn: { title: `${PREFIX}${OWNER}`, tasks: ['studio-product-owner', 'studio-product-owner-2'] } }])
})

// ---------------------------------------------------------------------------------------------------------------------
// Routing

test('with an owner, every talk word goes to it; refines, the goal map\'s asks and re-checks stay with the Advisor', () => {
  const state = studio()
  for (const to of ['Advisor', OWNER]) {
    const said = checkSay({ to, command: 'brainstorm', thread: PATH }, state, 4000)
    assert.equal(said.ok, true, to)
    assert.equal(said.message.to, OWNER, `a brainstorm named to ${to} goes to the owner`)
  }
  const refine = checkSay({ to: 'Advisor', command: 'refine', step: 'B12' }, state, 4000)
  assert.equal(refine.ok, true)
  assert.equal(refine.message.to, 'Advisor')
  // Nothing else is sent to the owner: no refine, no ask of the goal map, no re-check, no start word for another chat.
  for (const body of [{ command: 'refine', step: 'B12' }, { command: 'recheck' }, { command: 'goal-ask', goal: 'G1', ask: 'A1' }, { command: 'start', chat: 'Digger' }]) {
    const done = checkSay({ to: OWNER, ...body }, state, 4000)
    assert.equal(done.ok, false, body.command)
    assert.match(done.why, /talks only/)
  }
  // The board's fix of a question's title goes to the owner, with its own job's part.
  const threads = brainstormsState([{ path: PATH, text: `${HEAD}${LONG_Q}`, at: NOW }], '.claude/brainstorms').threads
  const fix = fixesToTell(threads, [], talkPartnerOf(state))[0]
  assert.equal(fix.to, OWNER)
  assert.match(fix.text, /roles\/product-owner\.md, "How a talk goes"/)
})

test('the talk words are the brainstorm\'s and the Focus page\'s talk; Go, the re-check, the demo and an Undo are not', () => {
  for (const command of ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-change', 'brainstorm-understood', 'brainstorm-not-quite', 'brainstorm-fix', 'brainstorm-stranded', 'focus', 'talk', 'vibe-not-yet', 'vibe-agreed', 'how-not-yet', 'done-when']) assert.ok(isTalkWord(command), command)
  for (const command of ['how-go', 'vibe-there-yes', 'vibe-there-no', 'goal-recheck', 'goal-demo', 'undo', 'refine', 'incident', 'round', 'recommend', 'evaluate', 'goal-ask']) assert.ok(!isTalkWord(command), command)
  assert.equal(TALK_COMMANDS.length, 14)
})

/** A fake file system of the goal map and the talks' folder, as the focus tests keep one. */
function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => { files[to] = files[from]; delete files[from] },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const MAP = 'D:/work/studio/goals.md'
const GOALS = ['# Goals', 'Last id: G4', '', '- [ ] G2 Benches that feel like home', '  Done when: five visitors sit down unasked', '- [ ] G3 Lanterns along the paths', ''].join('\n')

test('the Focus page: the goal picked, the talk bar and a Done when asked go to the owner with its job; else to the Advisor', async () => {
  const fs = fakeFs({ [MAP]: GOALS })
  const ctx = {
    canWrite: true, goalsFile: MAP, historyDir: 'D:/work/studio/history', brainstormDir: 'D:/work/studio/talks', brainstormFolder: 'talks', now: NOW, fs,
    partner: { name: 'Advisor', isRunning: true }, job: 'D:/work/board/roles/partner.md',
    talkPartner: { name: OWNER, role: 'owner' }, talkJob: 'D:/work/board/roles/product-owner.md',
  }
  const pick = await focusMove({ command: 'focus', id: 'G2' }, ctx)
  assert.equal(pick.ok, true)
  assert.equal(pick.words.to, OWNER)
  assert.match(pick.words.text, /Your job: D:\/work\/board\/roles\/product-owner\.md, "The focus"/)
  const said = await focusMove({ command: 'talk', id: 'G2', text: 'The benches face the pond.' }, ctx)
  assert.equal(said.words.to, OWNER)
  const doneWhen = await focusMove({ command: 'done-when', id: 'G3' }, ctx)
  assert.equal(doneWhen.words.to, OWNER)
  assert.match(doneWhen.words.text, /product-owner\.md, "Done when"/)
  // Without an owner the same words go to the Advisor, with its job.
  const before = await focusMove({ command: 'done-when', id: 'G3' }, { ...ctx, talkPartner: null })
  assert.equal(before.words.to, 'Advisor')
  assert.match(before.words.text, /roles\/partner\.md, "Done when"/)
})

// ---------------------------------------------------------------------------------------------------------------------
// Never wait

const lanes = () => ({
  restart: { main: 'Lead' },
  chats: [{ name: 'Lead', isMain: true, isRunning: true, state: 'free', appSession: 'local_Lead', session: '11111111-1111-1111-1111-111111111111' }, { name: 'Digger', isRunning: true, state: 'working', appSession: 'local_Digger' }],
  advisor: { name: 'Advisor', isRunning: true, state: 'working', appSession: 'local_Advisor', session: '22222222-2222-2222-2222-222222222222' },
  productOwner: { name: OWNER, isRunning: false, state: 'off', appSession: 'local_Productowner', session: '33333333-3333-3333-3333-333333333333' },
})

test('a talk word to an owner that does not run wakes it at once: the start word goes to a chat that runs', () => {
  const state = lanes()
  const word = { id: 'w1', at: NOW, to: OWNER, command: 'brainstorm-answer', about: PATH, text: 'brainstorm answer', state: 'waiting' }
  const start = wakeFor(word, state, [word], NOW, 4000)
  assert.deepEqual([start.to, start.command, start.about], ['Lead', 'start', OWNER])
  // The owner never carries a start word for another chat, also while it runs and every other chat is off.
  const quiet = { ...state, chats: state.chats.map(one => ({ ...one, isRunning: false })), advisor: { ...state.advisor, isRunning: false }, productOwner: { ...state.productOwner, isRunning: true, state: 'free' } }
  assert.equal(wakerFor(quiet, 'Digger', [], NOW), null)
})

test('the hands carry the owner\'s start, wake and resume before any other job', () => {
  const state = lanes()
  const taken = [
    { id: 'a', command: 'start', about: 'Digger', at: NOW - 2 * MIN },
    { id: 'b', command: 'start', about: OWNER, at: NOW - MIN },
  ]
  const all = [...state.chats, state.advisor, state.productOwner]
  const { jobs } = handJobs({ caller: 'Advisor', taken, lanes: all, now: NOW, first: OWNER })
  assert.deepEqual(jobs.map(one => one.chat), [OWNER, 'Digger'])
  // Without an owner the order stays as taken.
  assert.deepEqual(handJobs({ caller: 'Advisor', taken, lanes: all, now: NOW }).jobs.map(one => one.chat), ['Digger', OWNER])
})

test('no chat runs: a talk word for the owner opens the owner\'s own chat first; asleep, it is opened before any worker', () => {
  const state = lanes()
  const waiting = [{ id: 'w1', at: NOW, to: OWNER, command: 'brainstorm', state: 'waiting' }]
  assert.equal(handWorkWaits(state, waiting), true, 'a talk word waits for the owner, which does not run')
  assert.equal(handWorkWaits(state, []), false)
  assert.deepEqual(chatToOpen(state, waiting), { chat: OWNER, session: '33333333-3333-3333-3333-333333333333' })
  assert.equal(chatToOpen(state, []).chat, 'Lead', 'with nothing for it, the main chat as before')
  const asleep = { ...state, chats: [...state.chats, { name: 'Worker 2', asleep: true, session: '44444444-4444-4444-4444-444444444444', queue: [{ id: 'B12' }] }], productOwner: { ...state.productOwner, asleep: true, asleepSince: NOW - 9 * MIN } }
  assert.deepEqual(asleepWithWork(asleep, waiting).map(one => one.chat), [OWNER, 'Worker 2'])
  assert.deepEqual(asleepWithWork(asleep, []).map(one => one.chat), ['Worker 2'])
})

test('the owner gets nothing else: no step of the store, no refine, no check, no incident; its drafts and asks as the partner\'s', async () => {
  const ctx = { dir: 'D:/work/studio/.claude/work', roleOf: name => (name === OWNER ? 'owner' : null), goalDraft: async () => ({ ok: true }) }
  for (const action of ['take', 'refine', 'refined', 'checked', 'incident', 'report', 'new', 'partner-answer']) {
    const done = await workApi({ action, chat: OWNER, id: 'B12' }, ctx)
    assert.equal(done.ok, false, action)
    assert.equal(done.status, 403, action)
  }
  const drafted = await workApi({ action: 'vibe-draft', chat: OWNER, goal: 'G2', lines: ['Benches that feel like home'] }, ctx)
  assert.equal(drafted.ok, true)
  // Its card shows only what it is given; the state's own words to other chats never name it.
  const state = studio()
  assert.ok(!(state.reconciled?.deliveries ?? []).some(one => one.chat === OWNER))
})

test('the owner\'s talk words waiting show in its queue, by their thread', () => {
  const word = { id: 'w1', at: NOW - 3 * MIN, to: OWNER, command: 'brainstorm-answer', about: PATH, text: 'brainstorm answer\nThread: x\nQ1: A', state: 'waiting' }
  const state = studio({ outbox: [word] })
  assert.equal(state.productOwner.next.length, 1)
  assert.deepEqual([state.productOwner.next[0].kind, state.productOwner.next[0].thread, state.productOwner.next[0].stand.kind], ['brainstorm-answer', PATH, 'queued'])
  assert.equal(state.talkPartner.next[0].thread, PATH)
})

// ---------------------------------------------------------------------------------------------------------------------
// The model hold

test('the board holds the owner at Opus, medium, by the same word as the Supervisor\'s', () => {
  const models = { sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-5-5' }
  assert.deepEqual({ ...OWNER_SETTING }, { model: 'opus', effort: 'medium' })
  const off = studio({ ownerApp: { effort: 'high', model: 'claude-sonnet-4-6' }, settings: { models } })
  const word = off.reconciled.efforts.find(one => one.chat === OWNER)
  assert.deepEqual([word.to, word.level, word.model], ['Lead', 'medium', 'claude-opus-5-5'])
  assert.match(word.why, /Product owner's setting on the board: Opus, medium/)
  assert.deepEqual(off.productOwner.setting, { model: 'opus', effort: 'medium', isSet: false })
  // At its setting: no word.
  const held = studio({ ownerApp: { effort: 'medium', model: 'claude-opus-5-5' }, settings: { models } })
  assert.equal(held.reconciled.efforts.some(one => one.chat === OWNER), false)
  assert.equal(held.productOwner.setting.isSet, true)
})

// ---------------------------------------------------------------------------------------------------------------------
// The setup check

test('the setup check names the owner\'s routine once the list names an owner, and the line makes it', () => {
  const folder = 'studio'
  assert.deepEqual(ownerTaskIds(PROJECT), ['studio-product-owner', 'studio-product-owner-2'])
  const workers = [1, 2].map(n => `studio-worker-${n}`)
  assert.deepEqual(missingRoutines({ tasks: workers, folder, maxWorkers: 2 }), [])
  assert.deepEqual(missingRoutines({ tasks: workers, folder, maxWorkers: 2, owner: true }), ['owner'])
  assert.deepEqual(missingRoutines({ tasks: [...workers, 'studio-product-owner'], folder, maxWorkers: 2, owner: true }), [])
  // The owner's routine alone is no worker's: the workers' routines are still all missing.
  assert.deepEqual(missingRoutines({ tasks: ['studio-product-owner'], folder, maxWorkers: 2, owner: true }), [1, 2])
  const claims = new Map([['Lead', { can: ['spawn', 'send'], at: NOW, mod: '0.26.9' }]])
  const allowed = new Set(['mcp__scheduled-tasks__update_scheduled_task', 'mcp__scheduled-tasks__run_scheduled_task'])
  const view = codeJobsView({ claims, allowed, tasks: workers, folder, maxWorkers: 2, now: NOW, owner: true })
  assert.equal(view.rows.find(one => one.key === 'spawn').why, 'needs routines for the Product owner')
  assert.deepEqual([view.needsTask, view.missingRoutines], [true, ['owner']])
  const line = taskWords({ folder, prefix: PREFIX, board: 'D:\\work\\board', slots: view.missingRoutines, owner: OWNER })
  assert.match(line, /taskId "studio-product-owner", title "Studio · Product owner"/)
  assert.match(line, /start-product-owner-task\.md, with <the worker board's folder> in it written as D:\\work\\board/)
  assert.match(line, / Then say in one line that it is made\.$/)
  const both = taskWords({ folder, prefix: PREFIX, board: 'D:\\work\\board', slots: [2, 'owner'], owner: OWNER })
  assert.match(both, /taskId "studio-worker-2", title "Studio · Worker 2"/)
  assert.match(both, /taskId "studio-product-owner"/)
  assert.match(both, / Then say in one line that they are made\.$/)
  assert.equal(codeJobsView({ claims, allowed, tasks: [1, 2, 3].map(n => `studio-worker-${n}`), folder, maxWorkers: 3, now: NOW }).rows.find(one => one.key === 'spawn').why, null, 'no owner listed: as before')
})

test('the owner\'s routine text sits beside the start-worker task\'s and names its job', async () => {
  const text = await readFile(join(ROOT, 'mods', 'workers', 'start-product-owner-task.md'), 'utf8')
  const task = text.slice(text.indexOf('## The task\'s text'))
  assert.match(task, /You are the Product owner chat/)
  assert.match(task, /<the worker board's folder>\/roles\/product-owner\.md, and its part "How a talk goes"/)
  assert.match(task, /never set your own model or effort/)
})

// ---------------------------------------------------------------------------------------------------------------------
// The roles

test('the talks moved to product-owner.md "How a talk goes"; partner.md keeps one line; the README and the protocol name the talk partner', async () => {
  const plain = async name => (await readFile(join(ROOT, 'roles', name), 'utf8')).replace(/\s+/g, ' ')
  const [owner, partner, readme, protocol] = await Promise.all(['product-owner.md', 'partner.md', 'README.md', 'protocol.md'].map(plain))
  assert.match(owner, /## How a talk goes/)
  for (const kept of ['### The focus', '### A brainstorm', '**A change of a goal**', '## Understood (HH:MM)', '## Proposal (HH:MM)', '**The talk bar**', '**Done when.**']) assert.ok(owner.includes(kept), kept)
  assert.match(partner, /## A brainstorm While no Product owner is listed, you do the talks as product-owner\.md "How a talk goes" says\. ##/)
  assert.ok(!partner.includes('**A change of a goal**'), 'moved, not copied')
  assert.ok(!partner.includes('**The talk bar**'), 'moved, not copied')
  assert.match(owner, /as "How a talk goes" below describes/)
  assert.match(readme, /the board types every talk word to the talk partner/)
  assert.match(protocol, /`brainstorm understood` \/ `Thread: <path>` \(to the talk partner\)/)
})

// ---------------------------------------------------------------------------------------------------------------------
// The brainstorm screen's status words

const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// brainstorm:start'), script.indexOf('// brainstorm:end'))}
Object.assign(this, { brainstormCardView, brainstormListView, brainstormPartnerView, brainstormStatusOf, talkPartnerIn })`, made)
const page = Object.fromEntries(Object.entries(made).map(([name, fn]) => [name, (...args) => JSON.parse(JSON.stringify(fn(...args) ?? null))]))
const thread = (text, at = NOW - MIN) => brainstormsState([{ path: PATH, text, at }], '.claude/brainstorms').threads[0]
const Q1 = '## Q1 (11:01)\nWhere first?\nContext: Most visitors come in by the gate.\n- A: By the gate (advised)\n- B: By the pond\n'

test('the screen\'s status words read the talk partner and say "your Product owner" or "your partner" after its role', () => {
  const answered = thread(`${HEAD}${Q1}Answer (11:58): A\n`, NOW - 2 * MIN)
  const owner = { name: OWNER, role: 'owner', isRunning: true, state: 'free', on: null, next: [] }
  const advisor = { name: 'Advisor', role: 'advisor', isRunning: true, state: 'free', on: null, next: [] }
  assert.equal(page.brainstormStatusOf(answered, owner, NOW).word, 'your Product owner is thinking')
  assert.equal(page.brainstormStatusOf(answered, advisor, NOW).word, 'your partner is thinking')
  assert.equal(page.brainstormPartnerView(answered, owner, NOW).headline, 'Your Product owner is writing the next question')
  assert.equal(page.brainstormStatusOf(answered, { ...owner, next: [{ kind: 'brainstorm-answer', thread: PATH, stand: { kind: 'queued', since: NOW } }, { kind: 'brainstorm', thread: 'x', stand: { kind: 'queued', since: NOW } }] }, NOW).word, 'waiting for your Product owner')
  // The page reads the state's talkPartner; an older server without it gives the Advisor.
  assert.equal(page.talkPartnerIn({ talkPartner: owner, advisor }).name, OWNER)
  assert.deepEqual([page.talkPartnerIn({ advisor }).name, page.talkPartnerIn({ advisor }).role], ['Advisor', 'advisor'])
  // The owner busy with another talk is busy with that one; with this one it thinks.
  const busy = page.brainstormPartnerView(answered, { ...owner, state: 'working', on: { kind: 'brainstorm', title: 'Benches', thread: 'other.md', since: NOW - 4 * MIN }, next: [{ kind: 'brainstorm-answer', thread: PATH, stand: { kind: 'queued', since: NOW } }] }, NOW)
  assert.equal(busy.kind, 'waiting')
  assert.match(busy.headline, /^Your Product owner is busy with the talk "Benches"/)
  assert.equal(page.brainstormPartnerView(answered, { ...owner, state: 'working', on: { kind: 'brainstorm-answer', title: 'Lanterns', thread: PATH, since: NOW - MIN } }, NOW).kind, 'thinking')
})
