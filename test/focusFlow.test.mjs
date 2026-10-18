// Focus 2 (spec 2026-10-18, sections 3, 5 and 6): the vibe and how moves. Picking a focus, agreeing a vibe and a how
// (POST /api/goals), each written into goals.md by id with the words the board types to the partner, and the partner's
// drafts. The handler runs on a fake file system; made-up names only.
import assert from 'node:assert/strict'
import test from 'node:test'

import { messageText } from '../src/bridge.mjs'
import { parseThread } from '../src/brainstorm.mjs'
import { FOCUS_DRAFTS, FOCUS_MOVES, focusMove } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { wakeFor } from '../src/say.mjs'
import { workApi } from '../src/work/api.mjs'

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
    rename: async (from, to) => {
      files[to] = files[from]
      delete files[from]
    },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')

const MAP = 'C:/p/goals.md'
const DIR = 'C:/p/talks'
const GOALS = [
  '# Goals',
  'Last id: G4',
  '',
  '- [~] G1 A garden people visit',
  '  - [ ] G2 Benches that feel like home',
  '    Steps: B16',
  '  - [x] G3 The gate',
  '- [ ] G4 Lanterns',
  '',
].join('\n')
const NOW = new Date(2026, 9, 18, 14, 5).getTime()
const PARTNER = { name: 'Partner', isRunning: true }
const ctx = (fs, extra = {}) => ({
  canWrite: true, goalsFile: MAP, historyDir: 'C:/p/history', brainstormDir: DIR, brainstormFolder: 'talks', now: NOW, fs,
  partner: PARTNER, job: 'C:/board/roles/partner.md', ...extra,
})
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))
const threadsOf = fs => Object.keys(fs.files).filter(path => path.startsWith(`${DIR}/`)).map(path => ({ path, thread: parseThread(utf8(fs.files[path])) }))
/** A map whose focus G2 is in the vibe stage, with a draft written by the partner. */
async function inVibe() {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  await focusMove({ command: 'vibe-draft', id: 'G2', lines: ['you sit down without thinking', 'warm wood, never metal'], picture: 'pictures/bench.png' }, ctx(fs))
  return fs
}

test('the moves and the drafts it knows', () => {
  assert.deepEqual(FOCUS_MOVES, ['focus', 'vibe-agree', 'vibe-not-yet', 'how-go', 'how-not-yet', 'vibe-there-yes', 'vibe-there-no', 'talk'])
  assert.deepEqual(FOCUS_DRAFTS, ['vibe-draft', 'how-draft'])
})

test('picking a focus writes Focus:, starts the goal\'s thread and links it, and types focus: to the partner once', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const picked = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.equal(picked.ok, true)
  assert.equal(mapOf(fs).focus, 'G2')
  assert.match(utf8(fs.files[MAP]), /^# Goals\nLast id: G4\nFocus: G2\n/)
  const threads = threadsOf(fs)
  assert.equal(threads.length, 1)
  assert.deepEqual(threads[0].thread.goal, { id: 'G2', title: 'Benches that feel like home' })
  assert.equal(threads[0].thread.state, 'running')
  assert.equal(picked.result.thread, 'talks/2026-10-18-benches-that-feel-like-home.md')
  assert.deepEqual(mapOf(fs).byId.get('G2').brainstorm, { path: picked.result.thread, state: 'running' })
  assert.deepEqual(picked.words, {
    to: 'Partner', ask: null, step: null, title: null, version: null, verdict: null, command: 'focus', about: 'G2',
    text: `focus: G2 Benches that feel like home\nThread: ${picked.result.thread}\nStage: the vibe\nYour job: C:/board/roles/partner.md, "The focus"`,
  })
  // The same pick again (a double click): nothing new, no second word.
  const again = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.deepEqual([again.ok, again.words, again.result.unchanged], [true, null, true])
  assert.equal(threadsOf(fs).length, 1)
})

test('a goal with a running thread reuses it; another focus replaces the line; a done or unknown goal is refused', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS), [`${DIR}/2026-10-17-lanterns.md`]: latin('# Brainstorm: Lanterns\nGoal: G4 Lanterns\nStarted: 2026-10-17 10:00 · State: running\nOpening: Where?\n\n## Q1 (10:01)\nHow bright?\n') })
  await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  const lanterns = await focusMove({ command: 'focus', id: 'G4' }, ctx(fs))
  assert.equal(lanterns.result.thread, 'talks/2026-10-17-lanterns.md')
  assert.equal(threadsOf(fs).length, 2)
  assert.equal(mapOf(fs).focus, 'G4')
  assert.equal(utf8(fs.files[MAP]).match(/^Focus:/gm).length, 1)
  assert.match(lanterns.words.text, /^focus: G4 Lanterns\nThread: talks\/2026-10-17-lanterns\.md\nStage: the vibe\n/)
  assert.equal((await focusMove({ command: 'focus', id: 'G3' }, ctx(fs))).status, 409)
  assert.equal((await focusMove({ command: 'focus', id: 'G9' }, ctx(fs))).status, 409)
  assert.equal((await focusMove({ command: 'focus' }, ctx(fs))).status, 400)
})

test('something new: the person\'s line becomes a goal at the top, the focus, and the thread\'s opening', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const made = await focusMove({ command: 'focus', text: '  A pond with fish   people feed ' }, ctx(fs))
  assert.equal(made.ok, true)
  assert.equal(made.result.id, 'G5')
  const map = mapOf(fs)
  assert.deepEqual([map.focus, map.byId.get('G5').title, map.byId.get('G5').depth, map.lastGoal], ['G5', 'A pond with fish people feed', 0, 5])
  assert.equal(threadsOf(fs)[0].thread.opening, 'A pond with fish people feed')
  assert.match(made.words.text, /^focus: G5 A pond with fish people feed\n/)
  assert.equal((await focusMove({ command: 'focus', text: '   ' }, ctx(fs))).status, 400)
})

test('a move needs a partner on the board and a board that writes; a goal map not there is refused', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  assert.equal((await focusMove({ command: 'focus', id: 'G2' }, ctx(fs, { partner: null }))).status, 409)
  assert.equal((await focusMove({ command: 'focus', id: 'G2' }, ctx(fs, { canWrite: false }))).status, 403)
  assert.equal((await focusMove({ command: 'fly', id: 'G2' }, ctx(fs))).status, 400)
  assert.equal((await focusMove({ command: 'focus', id: 'G2' }, ctx(fakeFs({})))).status, 404)
  assert.equal(mapOf(fs).focus, null)
})

test('the partner\'s drafts: the vibe\'s lines and picture, the how\'s parts; an agreed vibe is not drafted again', async () => {
  const fs = await inVibe()
  const node = mapOf(fs).byId.get('G2')
  assert.deepEqual([node.vibe, node.vibePicture], [['you sit down without thinking', 'warm wood, never metal'], 'pictures/bench.png'])
  assert.equal((await focusMove({ command: 'vibe-draft', id: 'G2', lines: 'one line' }, ctx(fs))).status, 400)
  assert.equal((await focusMove({ command: 'vibe-draft', id: 'G9', lines: ['x'] }, ctx(fs))).status, 404)
  await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  const late = await focusMove({ command: 'vibe-draft', id: 'G2', lines: ['something else'] }, ctx(fs))
  assert.deepEqual([late.status, late.why], [409, 'The vibe is agreed: talk about the how now.'])
  const how = { parts: [{ title: 'Draw the bench', size: 'about 1 h' }, { title: 'Place them', size: '30 min' }], partnerDecides: ['the wood\'s colour'], youDecide: ['how many benches'] }
  const drafted = await focusMove({ command: 'how-draft', id: 'G2', ...how }, ctx(fs))
  assert.deepEqual([drafted.ok, drafted.words], [true, null])
  assert.deepEqual(mapOf(fs).byId.get('G2').parts, [{ title: 'Draw the bench', size: 'about 1 h', steps: [] }, { title: 'Place them', size: '30 min', steps: [] }])
  assert.equal((await focusMove({ command: 'how-draft', id: 'G2', parts: 'x' }, ctx(fs))).status, 400)
})

test('"This is the vibe" writes Vibe agreed once and types vibe: agreed once, also for two clicks at the same time (Review Focus 3)', async () => {
  const fs = await inVibe()
  const both = await Promise.all([focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs)), focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))])
  assert.ok(both.every(one => one.ok))
  const words = both.map(one => one.words).filter(one => one !== null)
  assert.equal(words.length, 1)
  assert.equal(utf8(fs.files[MAP]).match(/Vibe agreed:/g).length, 1)
  assert.equal(mapOf(fs).byId.get('G2').vibeAgreed, '2026-10-18 14:05')
  const thread = mapOf(fs).byId.get('G2').brainstorm.path
  assert.deepEqual(words[0], { to: 'Partner', ask: null, step: null, title: null, version: null, verdict: null, command: 'vibe-agreed', about: 'G2', text: `vibe: agreed\nGoal: G2 Benches that feel like home\nThread: ${thread}` })
  // A third click later: nothing more.
  assert.equal((await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))).words, null)
})

test('a vibe is agreed only on the focus, with words drafted; "Not yet" types the person\'s words and writes nothing', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  const bare = await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  assert.deepEqual([bare.status, bare.why], [409, 'Your partner has not written the vibe yet.'])
  await focusMove({ command: 'vibe-draft', id: 'G2', lines: ['warm wood'] }, ctx(fs))
  assert.equal((await focusMove({ command: 'vibe-agree', id: 'G4' }, ctx(fs))).status, 409)
  const before = fs.files[MAP]
  const notYet = await focusMove({ command: 'vibe-not-yet', id: 'G2', text: '  it should   feel older ' }, ctx(fs))
  assert.equal(notYet.ok, true)
  assert.equal(fs.files[MAP], before)
  assert.equal(notYet.words.command, 'vibe-not-yet')
  assert.equal(notYet.words.text, `vibe: not yet\nGoal: G2 Benches that feel like home\nThread: ${mapOf(fs).byId.get('G2').brainstorm.path}\nWords: it should feel older`)
  assert.equal((await focusMove({ command: 'vibe-not-yet', id: 'G2', text: ' ' }, ctx(fs))).status, 400)
  assert.equal((await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))).status, 409)
})

test('"Go" writes How agreed and types how: go; "Not yet" on the how types the person\'s words', async () => {
  const fs = await inVibe()
  await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  const empty = await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))
  assert.deepEqual([empty.status, empty.why], [409, 'Your partner has not proposed the how yet.'])
  await focusMove({ command: 'how-draft', id: 'G2', parts: [{ title: 'Draw the bench', size: 'about 1 h' }] }, ctx(fs))
  const notYet = await focusMove({ command: 'how-not-yet', id: 'G2', text: 'smaller parts' }, ctx(fs))
  assert.match(notYet.words.text, /^how: not yet\nGoal: G2 Benches that feel like home\nThread: .+\nWords: smaller parts$/)
  const go = await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))
  assert.deepEqual([go.words.command, go.words.text], ['how-go', `how: go\nGoal: G2 Benches that feel like home\nThread: ${mapOf(fs).byId.get('G2').brainstorm.path}`])
  assert.equal(mapOf(fs).byId.get('G2').howAgreed, '2026-10-18 14:05')
  assert.equal((await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))).words, null)
  assert.equal((await focusMove({ command: 'how-not-yet', id: 'G2', text: 'x' }, ctx(fs))).status, 409)
})

test('after Go the partner adds its steps to the parts; the agreed parts themselves stay as agreed', async () => {
  const fs = await inVibe()
  await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  await focusMove({ command: 'how-draft', id: 'G2', parts: [{ title: 'Draw the bench', size: 'about 1 h' }], youDecide: ['how many'] }, ctx(fs))
  await focusMove({ command: 'how-go', id: 'G2' }, ctx(fs))
  const linked = await focusMove({ command: 'how-draft', id: 'G2', parts: [{ title: 'Draw the bench', size: 'about 1 h', steps: ['B20', 'B21'] }], youDecide: ['how many'] }, ctx(fs))
  assert.equal(linked.ok, true)
  assert.deepEqual(mapOf(fs).byId.get('G2').parts, [{ title: 'Draw the bench', size: 'about 1 h', steps: ['B20', 'B21'] }])
  assert.match(utf8(fs.files[MAP]), /Part: Draw the bench · about 1 h · steps B20, B21\n {4}You decide: how many\n {4}How agreed: 2026-10-18 14:05/)
  const changed = await focusMove({ command: 'how-draft', id: 'G2', parts: [{ title: 'Draw two benches', size: 'about 1 h' }] }, ctx(fs))
  assert.deepEqual([changed.status, changed.why], [409, 'The how is agreed: add the steps to its parts, change nothing else.'])
})

test('the words are the person\'s, marked so in the chat, and a partner not running is woken through the main chat (Review Focus 5)', async () => {
  const fs = await inVibe()
  const agreed = await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  const message = { id: 'm1', at: NOW, ...agreed.words, state: 'waiting' }
  assert.match(messageText(message, () => '14:05'), /^vibe: agreed\nGoal: G2 .+\nThread: .+\n\(typed on the worker board, 14:05\)$/)
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isRunning: true }], advisor: { name: 'Partner', isRunning: false, appSession: 'local_abc' } }
  for (const command of ['focus', 'vibe-agreed', 'vibe-not-yet', 'how-go', 'how-not-yet']) {
    const wake = wakeFor({ ...message, command }, state, [], NOW, 4000)
    assert.equal(wake?.command, 'start', command)
    assert.equal(wake.about, 'Partner')
  }
})


test('the partner keeps its drafts through the work tool (vibe-draft, how-draft), as the chat the list names its partner only', async () => {
  const drafted = []
  const ctx = {
    dir: 'C:/nowhere',
    roleOf: chat => ({ Advisor: 'advisor', Units: 'worker', Main: 'main' })[chat] ?? null,
    goalDraft: async body => {
      drafted.push(body)
      return body.id === 'G9' ? { ok: false, status: 409, why: 'The vibe is agreed: talk about the how now.' } : { ok: true, result: {} }
    },
  }
  const vibe = await workApi({ action: 'vibe-draft', chat: 'Advisor', goal: 'G6', lines: ['warm wood'], picture: 'pictures/bench.png' }, ctx)
  assert.deepEqual(vibe, { ok: true, result: { text: 'The board keeps the vibe of G6: the Focus page shows it.', changed: false } })
  assert.deepEqual(drafted[0], { command: 'vibe-draft', id: 'G6', lines: ['warm wood'], picture: 'pictures/bench.png' })
  const how = await workApi({ action: 'how-draft', chat: 'Advisor', goal: 'G6', parts: ['Draw the bench · about 1 h · steps B20'], partnerDecides: ['the colour'], youDecide: ['how many'] }, ctx)
  assert.equal(how.result.text, 'The board keeps the how of G6: the Focus page shows it.')
  assert.deepEqual(drafted[1], { command: 'how-draft', id: 'G6', parts: ['Draw the bench · about 1 h · steps B20'], partnerDecides: ['the colour'], youDecide: ['how many'] })
  const late = await workApi({ action: 'vibe-draft', chat: 'Advisor', goal: 'G9', lines: ['x'] }, ctx)
  assert.deepEqual([late.status, late.why], [409, 'The vibe is agreed: talk about the how now.'])
  for (const chat of ['Units', 'Main']) assert.equal((await workApi({ action: 'vibe-draft', chat, goal: 'G6', lines: ['x'] }, ctx)).status, 403, chat)
  assert.equal((await workApi({ action: 'how-draft', goal: 'G6', parts: [] }, { ...ctx, as: 'person' })).status, 403)
  assert.equal((await workApi({ action: 'vibe-draft', chat: 'Advisor', lines: ['x'] }, ctx)).status, 400)
  assert.equal((await workApi({ action: 'vibe-draft', chat: 'Advisor', goal: 'G6', lines: ['x'] }, { ...ctx, goalDraft: undefined })).status, 409)
  assert.equal(drafted.length, 3)
})

test('a how drafted in the tool\'s words: each part "<title> · <size> · steps B<n>" as goals.md reads a Part line', async () => {
  const fs = await inVibe()
  await focusMove({ command: 'vibe-agree', id: 'G2' }, ctx(fs))
  await focusMove({ command: 'how-draft', id: 'G2', parts: ['Draw the bench · about 1 h · steps B20, B21', 'Place them'] }, ctx(fs))
  assert.deepEqual(mapOf(fs).byId.get('G2').parts, [{ title: 'Draw the bench', size: 'about 1 h', steps: ['B20', 'B21'] }, { title: 'Place them', size: null, steps: [] }])
})

test('the review\'s findings: a draft is for the focus goal only, and a how only once the vibe is agreed', async () => {
  const fs = await inVibe()
  const other = await focusMove({ command: 'vibe-draft', id: 'G4', lines: ['bright'] }, ctx(fs))
  assert.deepEqual([other.status, other.why], [409, 'That goal is not the focus: draft only the focus goal.'])
  assert.deepEqual(mapOf(fs).byId.get('G4').vibe, [])
  const early = await focusMove({ command: 'how-draft', id: 'G2', parts: [{ title: 'Draw the bench' }] }, ctx(fs))
  assert.deepEqual([early.status, early.why], [409, 'The vibe is not agreed yet: draft the how once the person agreed it.'])
  assert.deepEqual(mapOf(fs).byId.get('G2').parts, [])
})

test('the review\'s findings: "Start the talk" (focus again) on a talk that is over starts or reopens it; one with a proposal is named', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const first = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  const file = `${DIR}/${first.result.thread.split('/').pop()}`
  // Wrapped up on the Brainstorm part: reopened, and the partner told.
  fs.files[file] = fs.files[file].replace('State: running', 'State: wrapping up')
  const reopened = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.equal(reopened.result.thread, first.result.thread)
  assert.equal(parseThread(utf8(fs.files[file])).state, 'running')
  assert.match(reopened.words.text, /^focus: G2 /)
  // Done (or discarded): a new talk.
  fs.files[file] = fs.files[file].replace('State: running', 'State: done')
  const fresh = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.notEqual(fresh.result.thread, first.result.thread)
  assert.match(fresh.words.text, /^focus: G2 /)
  assert.deepEqual(mapOf(fs).byId.get('G2').brainstorm, { path: fresh.result.thread, state: 'running' })
  // A proposal waits in it: created or discarded on the Brainstorm part first.
  const other = `${DIR}/${fresh.result.thread.split('/').pop()}`
  fs.files[other] += latin('## Proposal (14:10)\nDecided:\n- benches\n')
  const held = await focusMove({ command: 'focus', id: 'G2' }, ctx(fs))
  assert.deepEqual([held.status, held.why], [409, 'The talk about this goal holds a proposal: create or discard it on the Brainstorm part first.'])
})
