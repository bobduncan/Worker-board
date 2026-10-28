// B767 (the person, 2026-10-28: "is this clear for new users of the worker board for new pc's?"): the setup check, which
// of the main chat's routine jobs run by code on this PC, what is missing, and Allow. Made-up names and folders only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CLAIM_MS, CODE_JOBS, allowCodeJobs, allowedIn, codeJobsView, readCodeJobs, taskWords, withAllowRules } from '../src/codeJobs.mjs'

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
  const view = codeJobsView({ claims: claims(['Worker 1', ['set', 'restart', 'spawn']]), allowed: new Set(ALL), tasks: ['my-project-start-worker'], now: NOW })
  assert.deepEqual(view.rows.map(row => [row.key, row.byCode]), [['wake', true], ['set', true], ['restart', true], ['spawn', true]])
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
  assert.equal(view.needsTask, true)
  const failed = byKey(codeJobsView({ claims: claims(['Main', ['spawn']]), allowed: new Set(ALL), tasks: ['x'], spawnFail: { at: NOW, why: 'refused' }, now: NOW }))
  assert.deepEqual([failed.spawn.byCode, failed.spawn.why], [false, 'the last try failed: refused'])
})

test('the line that makes the stored task names the plain id, the first worker\'s title and the task text', () => {
  const line = taskWords({ folder: 'My project', prefix: 'Studio · ', board: 'D:\\boards\\worker-board' })
  assert.match(line, /taskId "my-project-start-worker"/)
  assert.match(line, /title "Studio · Worker 1"/)
  assert.match(line, /mods.folder-branches.start-worker-task\.md/)
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
  const done = await allowCodeJobs({ project: 'P', tools: ['A', 'B'], fs })
  assert.deepEqual(done, { ok: true, added: ['A', 'B'] })
  assert.deepEqual(JSON.parse(files.get('P/.claude/settings.local.json')), { permissions: { allow: ['A', 'B'] } })
})

test('the server keeps each chat\'s claim, shows the check in the state and allows only what is missing; the page draws it', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /codeClaims\.set\(checked\.chat, \{ can: \[\.\.\.can\]\.slice\(0, 10\), at: clock\(\) \}\)/)
  assert.match(server, /codeJobs: await codeJobsNow\(state\.chatPrefix \?\? ''\)/)
  assert.match(server, /'\/api\/code-jobs': \{ kind: 'json', guard: 'lock' \}/)
  assert.match(server, /allowCodeJobs\(\{ project: resolve\(HERE, config\.project\), tools: view\?\.missing \?\? \[\] \}\)/)
  const page = await readFile(new URL('../public/board.js', import.meta.url), 'utf8')
  assert.match(page, /allow\.hidden = jobs\.canAllow !== true \|\| \(jobs\.missing \?\? \[\]\)\.length === 0/)
  assert.match(page, /\$\{advisor === null \? 4 : 5\}\. \$\{task\.replace/)
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8')
  assert.match(html, /id="code-jobs-allow"/)
  assert.match(html, /id="code-jobs-note"/)
})
