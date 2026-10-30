// B767 (the person, 2026-10-28: "is this clear for new users of the worker board for new pc's?"): the setup check, which
// of the main chat's routine jobs run by code on this PC, what is missing, and Allow. Made-up names and folders only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CLAIM_MS, CODE_JOBS, SEND_SOON, SEND_WHY, allowCodeJobs, allowedIn, codeJobsView, missingRoutines, readCodeJobs, taskWords, withAllowRules } from '../src/codeJobs.mjs'

const MIN = 60_000
const NOW = 100 * MIN
const ALL = CODE_JOBS.flatMap(job => job.tools)
const claims = (...list) => new Map(list.map(([name, can, ago = 0]) => [name, { can, at: NOW - ago }]))
const byKey = view => Object.fromEntries(view.rows.map(row => [row.key, row]))

test('the allow rules of the settings files, as one set; a broken file gives none', () => {
  const allowed = allowedIn([JSON.stringify({ permissions: { allow: ['A', 'B'] } }), 'not json', JSON.stringify({ permissions: { allow: ['C', 7] } }), ''])
  assert.deepEqual([...allowed], ['A', 'B', 'C'])
})

test('Allow adds only the missing rules and keeps the rest of the file; a broken file is left alone', () => {
  const kept = JSON.stringify({ permissions: { allow: ['A'], deny: ['D'] }, hooks: { x: 1 } })
  const added = withAllowRules(kept, ['A', 'B'])
  assert.deepEqual(added.added, ['B'])
  assert.deepEqual(JSON.parse(added.text), { permissions: { allow: ['A', 'B'], deny: ['D'] }, hooks: { x: 1 } })
  assert.deepEqual(JSON.parse(withAllowRules('', ['A']).text), { permissions: { allow: ['A'] } })
  assert.deepEqual(withAllowRules(kept, ['A']).added, [])
  assert.equal(withAllowRules('{ broken', ['A']).ok, false)
  assert.equal(withAllowRules('[1]', ['A']).ok, false)
})

test('a job runs by code when a chat that claimed lately may do it; else the main chat does it, with the reason', () => {
  const view = codeJobsView({ claims: claims(['Worker 1', ['set', 'restart', 'spawn', 'usage']]), allowed: new Set(ALL), tasks: ['my-project-start-worker'], now: NOW })
  assert.deepEqual(view.rows.map(row => [row.key, row.byCode]), [['wake', true], ['set', true], ['restart', true], ['spawn', true], ['usage', true]])
  assert.deepEqual(view.missing, [])
  assert.deepEqual(view.checked, { chat: 'Worker 1', at: NOW })
  // No chat claimed lately: nothing runs by code, whatever the files allow.
  const none = byKey(codeJobsView({ claims: claims(['Worker 1', ['set'], CLAIM_MS]), allowed: new Set(ALL), tasks: ['x'], now: NOW }))
  assert.deepEqual([none.wake.why, none.set.why], ['no chat with the Workers mod runs now', 'no chat with the Workers mod runs now'])
})

test('what is missing: the rules not allowed yet, the stored task, an older mod, a failed new worker', () => {
  const view = codeJobsView({ claims: claims(['Main', []]), allowed: new Set(CODE_JOBS[1].tools), tasks: [], now: NOW })
  const rows = byKey(view)
  assert.equal(rows.wake.byCode, true)
  assert.equal(rows.set.why, 'the running chats have an older Workers mod; their next restart brings the new one')
  assert.equal(rows.restart.why, 'not allowed yet')
  assert.equal(rows.spawn.why, 'no stored start-worker task on this PC')
  assert.deepEqual(view.missing, [...CODE_JOBS[2].tools, ...CODE_JOBS[3].tools])
  // B768: reading the limits is one of the jobs, allowed by the app's usage tool.
  // The app allows its usage tool itself: no rule is missing, only a chat on the newer mod.
  assert.equal(rows.usage.why, 'the running chats have an older Workers mod; their next restart brings the new one')
  assert.equal(view.needsTask, true)
  // T12: with nothing stored, a routine is missing for every worker slot (5 unless the limit says more).
  assert.deepEqual(view.missingRoutines, [1, 2, 3, 4, 5])
  const failed = byKey(codeJobsView({ claims: claims(['Main', ['spawn']]), allowed: new Set(ALL), tasks: ['x'], spawnFail: { at: NOW, why: 'refused' }, now: NOW }))
  assert.deepEqual([failed.spawn.byCode, failed.spawn.why], [false, 'the last try failed: refused'])
})

// T14 (the person, 2026-10-30: "B", fix A for X1 / X103): the app puts an Auto-mode chat's send by code to its classifier.
test('T14: waking, starting and resuming is by itself only while a chat that may send runs; else it needs the rule', () => {
  const SEND = 'mcp__ccd_session_mgmt__send_message'
  assert.deepEqual(CODE_JOBS[0].tools, [SEND])
  const view = (list, allowed = new Set()) => codeJobsView({ claims: new Map(list.map(([name, can, mod]) => [name, { can, mod, at: NOW }])), allowed, tasks: ['x'], now: NOW })
  // Only workers in Auto mode on the new mod run: the rule is what is missing, and Allow adds it.
  const auto = view([['Worker 1', ['spawn'], '0.26.5'], ['Worker 2', [], '0.26.5']])
  assert.deepEqual([byKey(auto).wake.byCode, byKey(auto).wake.why], [false, SEND_WHY])
  assert.match(SEND_WHY, /^chats in Auto mode may not send messages until the project allows mcp__ccd_session_mgmt__send_message$/)
  assert.ok(auto.missing.includes(SEND))
  // The rule is there, the chats have not asked the app again yet.
  const soon = view([['Worker 1', [], '0.26.5']], new Set([SEND]))
  assert.deepEqual([byKey(soon).wake.byCode, byKey(soon).wake.why, soon.missing.includes(SEND)], [false, SEND_SOON, false])
  // A chat that may send runs (its mod says so, or is older than the first that says it): by itself, nothing missing for it.
  for (const runs of [[['Lead', ['send'], '0.26.5']], [['Worker 1', [], '0.26.4']], [['Worker 1', [], null]]]) {
    const one = view([['Worker 2', [], '0.26.5'], ...runs])
    assert.deepEqual([byKey(one).wake.byCode, byKey(one).wake.why, one.missing.includes(SEND)], [true, null, false], JSON.stringify(runs))
  }
  // No chat runs: as before.
  assert.equal(byKey(view([])).wake.why, 'no chat with the Workers mod runs now')
})

test('T14: the page says the wake row needs your OK, with the reason in its tooltip, and counts it in the note', async () => {
  const { openPage } = await import('./pageHarness.mjs')
  const { asSent, build, ask, MIN: PAGE_MIN, NOW: PAGE_NOW } = await import('./partnerState.mjs')
  const rows = [{ key: 'wake', title: 'Wake, start and resume chats', byCode: false, why: SEND_WHY }]
  const jobs = { rows, missing: ['mcp__ccd_session_mgmt__send_message'], needsTask: false, missingRoutines: [], checked: null, canAllow: true, taskLine: null }
  const page = await openPage({ state: { ...asSent(build([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)])), codeJobs: jobs } })
  try {
    const line = page.find('#code-job-list li')
    assert.equal(line.querySelector('.code-job-state').textContent, 'needs your OK')
    assert.equal(line.title, `The main chat does this for now: ${SEND_WHY}.`)
    assert.match(page.text('#code-jobs-note-text'), /once you allow it: wake, start and resume chats\.$/)
    assert.equal(page.find('#code-jobs-allow').hidden, false)
  } finally { await page.close() }
  const soon = await openPage({ state: { ...asSent(build([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)])), codeJobs: { ...jobs, missing: [], rows: [{ ...rows[0], why: SEND_SOON }] } } })
  try {
    assert.equal(soon.text('#code-job-list .code-job-state'), 'within 10 min')
  } finally { await soon.close() }
})

// T12 (the person, 2026-10-28: every worker its own routine, "<project> - Worker N"): which worker slots have a routine.
const PROJECT = 'my-project'
const ROUTINES = (...slots) => slots.map(n => `${PROJECT}-worker-${n}`)
const SHARED = [`${PROJECT}-start-worker-2`, `${PROJECT}-start-worker`]
const spawnRow = tasks => byKey(codeJobsView({ claims: claims(['Worker 1', ['spawn']]), allowed: new Set(ALL), tasks, folder: PROJECT, maxWorkers: 5, now: NOW })).spawn

test('T12: a routine for every worker up to the limit starts workers by itself; the second login\'s "-2" ids count too', () => {
  assert.deepEqual(spawnRow(ROUTINES(1, 2, 3, 4, 5)), { key: 'spawn', title: 'Start a new worker', byCode: true, why: null })
  assert.equal(spawnRow(ROUTINES(1, 2, 3, 4, 5).map(id => `${id}-2`)).byCode, true)
  assert.equal(spawnRow([...ROUTINES(1, 2, 3), 'my-project-worker-4-2', 'my-project-worker-5']).byCode, true)
  assert.deepEqual(missingRoutines({ tasks: ROUTINES(1, 2, 3, 4, 5), folder: PROJECT, maxWorkers: 5 }), [])
  // A routine beyond the limit is no one's: a lower limit needs fewer.
  assert.deepEqual(missingRoutines({ tasks: ROUTINES(1, 2, 3), folder: PROJECT, maxWorkers: 3 }), [])
  assert.deepEqual(missingRoutines({ tasks: ROUTINES(1, 2, 3), folder: PROJECT, maxWorkers: 6 }), [4, 5, 6])
})

test('T12: routines for some workers only: the row says which are missing, whatever the shared task covers', () => {
  const few = spawnRow(ROUTINES(1, 2, 3))
  assert.deepEqual([few.byCode, few.why], [false, 'needs routines for Worker 4, 5'])
  // The shared task still starts a worker, but it does not make the routines of Workers 4 and 5.
  const withShared = spawnRow([...ROUTINES(1, 2, 3), ...SHARED])
  assert.deepEqual([withShared.byCode, withShared.why], [false, 'needs routines for Worker 4, 5'])
  // A gap in the middle, and the one that is missing alone.
  assert.equal(spawnRow([...ROUTINES(1, 3, 4, 5)]).why, 'needs routines for Worker 2')
  assert.equal(spawnRow(ROUTINES(2, 4)).why, 'needs routines for Worker 1, 3, 5')
  // It is the setup, not a tool to allow: nothing is added to Allow, and the line to paste is offered.
  const view = codeJobsView({ claims: claims(['Worker 1', ['spawn']]), allowed: new Set(), tasks: ROUTINES(1, 2, 3), folder: PROJECT, maxWorkers: 5, now: NOW })
  assert.deepEqual([view.needsTask, view.missingRoutines], [true, [4, 5]])
  assert.deepEqual(view.missing, [...CODE_JOBS[1].tools, ...CODE_JOBS[2].tools])
  // The reasons that come first stay first: a failed try, a tool not allowed yet.
  const failed = byKey(codeJobsView({ claims: claims(['Worker 1', ['spawn']]), allowed: new Set(ALL), tasks: ROUTINES(1, 2, 3), folder: PROJECT, maxWorkers: 5, spawnFail: { at: NOW, why: 'refused' }, now: NOW })).spawn
  assert.equal(failed.why, 'the last try failed: refused')
  const notAllowed = byKey(codeJobsView({ claims: claims(['Worker 1', ['set']]), allowed: new Set(), tasks: ROUTINES(1, 2, 3), folder: PROJECT, maxWorkers: 5, now: NOW })).spawn
  assert.equal(notAllowed.why, 'not allowed yet')
})

test('T12: the shared task alone still starts workers by itself (the fallback); nothing stored needs all the routines', () => {
  assert.deepEqual(spawnRow(SHARED), { key: 'spawn', title: 'Start a new worker', byCode: true, why: null })
  assert.deepEqual(spawnRow([SHARED[1]]).why, null)
  assert.deepEqual(missingRoutines({ tasks: SHARED, folder: PROJECT, maxWorkers: 5 }), [])
  const shared = codeJobsView({ claims: claims(['Worker 1', ['spawn']]), allowed: new Set(ALL), tasks: SHARED, folder: PROJECT, maxWorkers: 5, now: NOW })
  assert.deepEqual([shared.needsTask, shared.missingRoutines], [false, []])
  const none = spawnRow([])
  assert.deepEqual([none.byCode, none.why], [false, 'no stored start-worker task on this PC'])
  assert.deepEqual(missingRoutines({ tasks: [], folder: PROJECT, maxWorkers: 7 }), [1, 2, 3, 4, 5, 6, 7])
  // No limit given or one that is no whole number: 5, as the board's setting.
  assert.deepEqual(missingRoutines({ tasks: [], folder: PROJECT }), [1, 2, 3, 4, 5])
  assert.deepEqual(missingRoutines({ tasks: [], folder: PROJECT, maxWorkers: 2.5 }), [1, 2, 3, 4, 5])
})

test('T12: the line that makes the routines names each missing worker\'s id, title and description, and the task text', () => {
  const line = taskWords({ folder: 'My project', prefix: 'Studio · ', board: 'D:\\boards\\worker-board', slots: [4, 5] })
  assert.match(line, /taskId "my-project-worker-4", title "Studio · Worker 4", description "Starts Studio · Worker 4 of the worker board"/)
  assert.match(line, /taskId "my-project-worker-5", title "Studio · Worker 5", description "Starts Studio · Worker 5 of the worker board"/)
  assert.doesNotMatch(line, /worker-[123]"|Worker [123]"/)
  assert.match(line, /no schedule, notifyOnCompletion false \(when the app says a taskId is taken, use the one it names\)/)
  assert.match(line, /mods.workers.start-worker-task\.md/)
  // The page cuts this closing sentence off where the line goes into the main chat's first words.
  assert.match(line, / Then say in one line that they are made\.$/)
  // Without slots, the first worker's.
  assert.match(taskWords({ folder: 'My project', prefix: 'Studio · ', board: 'D:\\boards\\worker-board' }), /taskId "my-project-worker-1", title "Studio · Worker 1"/)
})

test('reading this PC and Allow work through the file system they are given', async () => {
  const files = new Map([['H/.claude/settings.json', JSON.stringify({ permissions: { allow: [CODE_JOBS[1].tools[0]] } })]])
  const norm = path => path.replace(/\\/g, '/')
  const fs = {
    readFile: async path => { if (!files.has(norm(path))) throw Object.assign(new Error('none'), { code: 'ENOENT' }); return files.get(norm(path)) },
    writeFile: async (path, text) => { files.set(norm(path), text) },
    mkdir: async () => {},
    stat: async path => { if (!files.has(norm(path))) throw new Error('none'); return { isFile: () => true } },
  }
  files.set('H/.claude/scheduled-tasks/my-project-start-worker-2/SKILL.md', 'x')
  const read = await readCodeJobs({ project: 'P', folder: 'my-project', home: 'H', fs })
  assert.deepEqual([[...read.allowed], read.tasks], [[CODE_JOBS[1].tools[0]], ['my-project-start-worker-2']])
  // T12: and each worker's own routine, one per slot up to the limit (5 unless given): a routine beyond it is not looked for.
  for (const id of ['my-project-worker-1', 'my-project-worker-3-2', 'my-project-worker-5', 'my-project-worker-6']) files.set(`H/.claude/scheduled-tasks/${id}/SKILL.md`, 'x')
  const own = await readCodeJobs({ project: 'P', folder: 'my-project', home: 'H', fs })
  assert.deepEqual(own.tasks, ['my-project-start-worker-2', 'my-project-worker-1', 'my-project-worker-3-2', 'my-project-worker-5'])
  const more = await readCodeJobs({ project: 'P', folder: 'my-project', maxWorkers: 6, home: 'H', fs })
  assert.deepEqual(more.tasks.slice(-2), ['my-project-worker-5', 'my-project-worker-6'])
  const fewer = await readCodeJobs({ project: 'P', folder: 'my-project', maxWorkers: 2, home: 'H', fs })
  assert.deepEqual(fewer.tasks, ['my-project-start-worker-2', 'my-project-worker-1'])
  const done = await allowCodeJobs({ project: 'P', tools: ['A', 'B'], fs })
  assert.deepEqual(done, { ok: true, added: ['A', 'B'] })
  assert.deepEqual(JSON.parse(files.get('P/.claude/settings.local.json')), { permissions: { allow: ['A', 'B'] } })
})

test('the server keeps each chat\'s claim, shows the check in the state and allows only what is missing; the page draws it', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  // T14: with the mod's version, for whether the claim may send.
  assert.match(server, /const claim = \{ can: \[\.\.\.can\]\.slice\(0, 10\), at: clock\(\), mod: typeof body\?\.mod === 'string' \? body\.mod : null \}\n\s+codeClaims\.set\(checked\.chat, claim\)/)
  assert.match(server, /codeJobs: await codeJobsNow\(state\.chatPrefix \?\? ''\)/)
  // T12: one routine per worker slot up to the limit: read for it, shown by it, and the pasted line makes the missing ones.
  assert.match(server, /readCodeJobs\(\{ project: resolve\(HERE, config\.project\), folder, maxWorkers: config\.maxWorkers \}\)/)
  assert.match(server, /codeJobsView\(\{ claims: codeClaims, \.\.\.codeRead\.read, folder, maxWorkers: config\.maxWorkers, spawnFail, now: clock\(\) \}\)/)
  assert.match(server, /taskWords\(\{ folder, prefix, board: HERE, slots: view\.missingRoutines \}\)/)
  assert.match(server, /'\/api\/code-jobs': \{ kind: 'json', guard: 'lock' \}/)
  assert.match(server, /allowCodeJobs\(\{ project: resolve\(HERE, config\.project\), tools: view\?\.missing \?\? \[\] \}\)/)
  const page = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  assert.match(page, /allow\.hidden = jobs\.canAllow !== true \|\| \(jobs\.missing \?\? \[\]\)\.length === 0/)
  assert.match(page, /\$\{advisor === null \? 4 : 5\}\. \$\{task\.replace/)
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  assert.match(html, /id="code-jobs-allow"/)
  assert.match(html, /id="code-jobs-note"/)
})

test('T12: the page names the workers that have no routine yet, and the button keeps the line that makes them', async () => {
  const { openPage } = await import('./pageHarness.mjs')
  const { asSent, build, ask, MIN: PAGE_MIN, NOW: PAGE_NOW } = await import('./partnerState.mjs')
  const rows = [
    { key: 'wake', title: 'Wake, start and resume chats', byCode: true, why: null },
    { key: 'spawn', title: 'Start a new worker', byCode: false, why: 'needs routines for Worker 4, 5' },
  ]
  const jobs = { rows, missing: [], needsTask: true, missingRoutines: [4, 5], checked: null, canAllow: true, taskLine: 'Make the routines.' }
  const page = await openPage({ state: { ...asSent(build([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)])), codeJobs: jobs } })
  try {
    const lines = page.all('#code-job-list li').map(line => [line.querySelector('.code-job-title').textContent, line.querySelector('.code-job-state').textContent, line.title])
    assert.deepEqual(lines, [
      ['Wake, start and resume chats', 'by itself', 'The board does this by itself.'],
      ['Start a new worker', 'needs routines for Worker 4, 5', 'The board starts a worker by itself when that worker has a routine of its own: needs routines for Worker 4, 5.'],
    ])
    assert.equal(page.find('#code-jobs-task').hidden, false)
    assert.match(page.text('#code-jobs-task'), /makes the routines$/)
    // With no routine stored at all the row says so in a word.
    const none = await openPage({ state: { ...asSent(build([ask('Q2', 'person', PAGE_NOW - 40 * PAGE_MIN)])), codeJobs: { ...jobs, rows: [{ ...rows[1], why: 'no stored start-worker task on this PC' }] } } })
    try {
      assert.equal(none.text('#code-job-list .code-job-state'), 'needs its routines')
    } finally { await none.close() }
  } finally { await page.close() }
})
