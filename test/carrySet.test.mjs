// T5 B2: what travels, on the real-case fixture (test/fixtures/carry-real). Reads only; nothing is written.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { carriedSettings, carriedUserSettings, carrySet, mergeUserSettings, settingsFromCarry, targetOf } from '../src/carry/set.mjs'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'carry-real')
const project = join(FIXTURE, 'project')
const boardDir = join(FIXTURE, 'board')
const memoryDir = join(FIXTURE, 'memory')
const slash = path => path.replace(/\\/g, '/')
const fixtureConfig = () => {
  const config = JSON.parse(readFileSync(join(FIXTURE, 'config.json'), 'utf8'))
  config.project = project
  config.gameRepo = join(project, 'game')
  config.pictureRoots = ['pictures']
  return config
}
const userSettings = () => JSON.parse(readFileSync(join(FIXTURE, 'user-settings.json'), 'utf8'))
const run = (config = fixtureConfig(), extra = {}) => carrySet({ config, project, boardDir, memoryDir, fs: nodeFs, ...extra })
const tos = async (kind, config) => (await run(config)).files.filter(file => file.kind === kind).map(file => file.to).sort()

test('the store: its items, ask and pause.json travel; per-PC files and leftovers of writes stay out', async () => {
  assert.deepEqual(await tos('store'), ['B1003', 'B1149', 'B1153', 'B1240', 'Q811'].map(id => `home/.claude/work/${id}.md`).concat('home/.claude/work/pause.json').sort())
})

test('the goal map travels: goals, design kinds, history, brainstorms and goal asks', async () => {
  assert.deepEqual(await tos('goals'), [
    'home/.claude/design.json',
    'home/.claude/goal-asks/2026-10-18-g12-whats-left.md',
    'home/.claude/brainstorms/2026-11-11-every-unit-one-detailed-consistent-model.md',
    'home/.claude/goals.history/2026-11-11.md',
    'home/.claude/goals.md',
  ].sort())
})

test('board data: only the named files, each when it exists; plan-writes.json absent gives no error and no line', async () => {
  const result = await run()
  assert.deepEqual(result.files.filter(file => file.kind === 'board').map(file => file.to).sort(), ['finished', 'ideas', 'recaps', 'refine-gate', 'rounds', 'task-times'].map(name => `board/data/${name}.json`))
  assert.deepEqual(result.skipped, [])
})

test('home files: top-level files, the .claude files and folders by rule; runtime files and chat cards stay out', async () => {
  const to = await tos('home')
  for (const wanted of ['CLAUDE.md', 'AGENTS.md', 'demo-board.md', '.codex/config.toml', '.claude/main-briefing.md', '.claude/worker-briefing.md', '.claude/settings.local.json', '.claude/start.json', '.claude/worker-board-check.md', '.claude/chats/list.json', '.claude/plans/2026-10-18-demo-plan.md', '.claude/plans/2026-10-18-demo-keep-set.json', '.claude/specs/demo-spec.md', '.claude/handover/chat-1.md', '.claude/hooks/demo-hook.ps1']) {
    assert.ok(to.includes(`home/${wanted}`), `${wanted} travels`)
  }
  const all = (await run()).files.map(file => file.to)
  for (const out of ['board.json', 'launch.json', 'launch.json.before-start-board', 'sync.json', 'sync-loop.json', 'supervisor.json', 'supervisor-sweep.json', 'limit-readings.json', 'backlog.md', 'backlog.before-store.md', 'board-errors.log', 'scheduled_tasks.lock', 'scratch-b1125.py', 'scratch-b1125-charge.txt', 'settings.local.json.before-board-rules', 'chats/00345699-fe77-44a8-b0b0-0eface68a08c.json']) {
    assert.ok(!all.includes(`home/.claude/${out}`), `${out} stays out`)
  }
  assert.ok(!all.some(path => path.includes('bridge') || path.endsWith('carry.json')))
})

test('records: every request.json and every *.prompt.txt (a request with no prompt still travels); pictures and sounds stay out; the demo files travel', async () => {
  assert.deepEqual(await tos('record'), [
    'home/.claude/assets/A1/request.json',
    'home/.claude/assets/A271/1.prompt.txt',
    'home/.claude/assets/A271/request.json',
    'home/pictures/G64/demo/demo.json',
    'home/pictures/G64/demo/feedback.json',
    'home/pictures/G64/demo/list.json',
  ])
})

test('memory: every file of the memory folder', async () => {
  assert.deepEqual(await tos('memory'), ['memory/MEMORY.md', 'memory/demo-note.md'])
})

test('every file has an absolute from, a forward-slash to, its size and time; nothing is listed twice', async () => {
  const { files } = await run()
  assert.equal(new Set(files.map(file => file.to)).size, files.length)
  for (const file of files) {
    assert.ok(/^[A-Za-z]:\/|^\//.test(file.from), file.from)
    assert.ok(!file.to.includes('\\'))
    assert.ok(file.size >= 0 && file.mtimeMs > 0)
    assert.ok(['store', 'goals', 'board', 'home', 'memory', 'record'].includes(file.kind))
  }
})

test('a path outside the project goes to skipped with its why, never carried and never silent', async () => {
  const outside = resolve(FIXTURE, '..', 'outside-the-project')
  const config = { ...fixtureConfig(), goals: join(outside, 'goals.md'), brainstorms: join(outside, 'brainstorms') }
  const result = await run(config)
  assert.ok(result.files.every(file => !file.from.includes('outside-the-project')))
  assert.deepEqual(result.skipped.map(one => one.path).sort(), [slash(join(outside, 'brainstorms')), slash(join(outside, 'goals.md'))].sort())
  assert.ok(result.skipped.every(one => typeof one.why === 'string' && one.why.length > 0))
})

test('a text over 10 MB goes to skipped', async () => {
  const fs = { ...nodeFs, stat: async path => { const info = await nodeFs.stat(path); return path.endsWith('goals.md') ? { isFile: () => true, size: 11 * 1024 * 1024, mtimeMs: 1 } : info } }
  const result = await run(fixtureConfig(), { fs })
  assert.ok(!result.files.some(file => file.to.endsWith('goals.md')))
  assert.deepEqual(result.skipped.map(one => one.why), ['over 10 MB'])
})

test('targetOf gives every carried file its own place back; settings have none; a way out of the folder is refused', async () => {
  const { files } = await run()
  for (const file of files) assert.equal(slash(targetOf(file.to, { project, boardDir, memoryDir })), file.from, file.to)
  assert.equal(targetOf('settings/config.json', { project, boardDir, memoryDir }), null)
  assert.equal(targetOf('settings/user.json', { project, boardDir, memoryDir }), null)
  assert.equal(targetOf('home/../x', { project, boardDir, memoryDir }), null)
})

test('settings round-trip: appSessions, usageHistory, transcripts and picturesHome never travel; project and gameRepo travel relative to the board folder', () => {
  const config = fixtureConfig()
  const carried = carriedSettings(config, { project, boardDir })
  for (const key of ['appSessions', 'usageHistory', 'transcripts', 'picturesHome']) assert.ok(!(key in carried), key)
  assert.equal(carried.project, '../project')
  assert.equal(carried.gameRepo, '../project/game')
  assert.equal(carried.name, config.name)
  const other = join(FIXTURE, 'other-pc', 'board')
  const back = settingsFromCarry(JSON.parse(JSON.stringify(carried)), { project: join(FIXTURE, 'other-pc', 'project'), boardDir: other, current: { port: 4400, gamePort: 4401, appSessions: 'mine' } })
  assert.equal(back.project, resolve(other, '../project'))
  assert.equal(back.gameRepo, resolve(other, '../project/game'))
  assert.equal(back.port, 4400)
  assert.equal(back.gamePort, 4401)
  assert.equal(back.appSessions, 'mine')
  assert.equal(back.name, config.name)
  const bare = settingsFromCarry(carried, { project, boardDir: other, current: {} })
  assert.equal(bare.port, config.port)
  assert.deepEqual(settingsFromCarry(carriedSettings(back, { project: back.project, boardDir: other }), { project: back.project, boardDir: other, current: back }), back)
})

test('user settings: only defaultMode, allow and autoMode travel; never hooks, plugins or marketplaces', () => {
  const carried = carriedUserSettings(userSettings())
  assert.deepEqual(Object.keys(carried).sort(), ['allow', 'autoMode', 'defaultMode'])
  assert.equal(carried.defaultMode, 'auto')
  assert.equal(carried.allow.length, 3)
  assert.deepEqual(Object.keys(carried.autoMode).sort(), ['allow', 'environment'])
  const text = JSON.stringify(carried)
  for (const word of ['hooks', 'enabledPlugins', 'extraKnownMarketplaces', 'keep-awake']) assert.ok(!text.includes(word), word)
})

test('merging user settings keeps everything the other PC has, adds only the lines it lacks (order kept), and sets defaultMode only when it has none', () => {
  const carried = carriedUserSettings(userSettings())
  const theirs = {
    permissions: { allow: ['Bash(own-tool *)', carried.allow[1]], defaultMode: 'default' },
    autoMode: { allow: ['$defaults', 'their own rule'], environment: ['$defaults'] },
    hooks: { Stop: [] },
    theme: 'dark',
  }
  const { merged, added } = mergeUserSettings(theirs, carried)
  assert.deepEqual(merged.permissions.allow, ['Bash(own-tool *)', carried.allow[1], carried.allow[0], carried.allow[2]])
  assert.equal(merged.permissions.defaultMode, 'default')
  assert.deepEqual(merged.autoMode.allow, ['$defaults', 'their own rule', carried.autoMode.allow[1]])
  assert.deepEqual(merged.autoMode.environment, ['$defaults', carried.autoMode.environment[1]])
  assert.deepEqual(merged.hooks, { Stop: [] })
  assert.equal(merged.theme, 'dark')
  assert.deepEqual(added, [`permissions.allow: ${carried.allow[0]}`, `permissions.allow: ${carried.allow[2]}`, `autoMode.allow: ${carried.autoMode.allow[1]}`, `autoMode.environment: ${carried.autoMode.environment[1]}`])
  assert.deepEqual(theirs.permissions.allow.length, 2, 'the input is not changed')
  const again = mergeUserSettings(merged, carried)
  assert.deepEqual(again.added, [])
  assert.deepEqual(again.merged, merged)
  const empty = mergeUserSettings({}, carried)
  assert.equal(empty.merged.permissions.defaultMode, 'auto')
  assert.ok(empty.added.includes('permissions.defaultMode: auto'))
})
