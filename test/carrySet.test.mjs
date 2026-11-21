// T5 B2: what travels, on the real-case fixture (test/fixtures/carry-real). Reads only; nothing is written.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { carriedSettings, carriedUserSettings, carrySet, mergeUserSettings, projectSettingsFileOf, settingsFromCarry, targetOf } from '../src/carry/set.mjs'
import { PC_KEYS } from '../src/config.mjs'

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
  for (const out of ['board.json', 'launch.json', 'launch.json.before-start-board', 'sync.json', 'sync-loop.json', 'supervisor.json', 'supervisor-sweep.json', 'limit-readings.json', 'backlog.md', 'backlog.before-store.md', 'board-errors.log', 'scheduled_tasks.lock', 'scratch-b1125.py', 'scratch-b1125-charge.txt', 'settings.local.json.before-board-rules', 'chats/00000000-0000-4000-8000-00000000b0b0.json']) {
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
    'home/pictures/G60/recap/demo.json',
    'home/pictures/G60/recap/feedback.json',
    'home/pictures/G60/recap/list.json',
  ].sort())
  assert.ok(!(await run()).files.some(file => file.to.includes('.before-')), 'a before-copy stays out')
  assert.ok(!(await run()).files.some(file => file.to.endsWith('notes.json')), 'another json in a picture folder stays out')
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

test('settings round-trip: no PC key travels (appSessions, usageHistory, transcripts, picturesHome, the ports among them); project and gameRepo travel relative to the board folder', () => {
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
  assert.equal('port' in bare, false, 'T5.2 A8: a PC key never travels; a PC without one of its own runs on the default')
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

test('T5.2 A8: every PC key (config.mjs PC_KEYS) but project and gameRepo stays here, checked against the list itself, so a new PC key cannot slip through; the other PC keeps its own', () => {
  const config = { ...fixtureConfig(), ...Object.fromEntries(PC_KEYS.map(key => [key, `mine-${key}`])), project, gameRepo: join(project, 'game') }
  const carried = carriedSettings(config, { project, boardDir })
  for (const key of PC_KEYS) assert.equal(key in carried, ['project', 'gameRepo'].includes(key), key)
  assert.equal(carried.name, config.name, 'a project key travels')
  const theirs = Object.fromEntries(PC_KEYS.filter(key => !['project', 'gameRepo'].includes(key)).map(key => [key, `theirs-${key}`]))
  const back = settingsFromCarry(JSON.parse(JSON.stringify(carried)), { project, boardDir, current: theirs })
  for (const key of Object.keys(theirs)) assert.equal(back[key], theirs[key], key)
  assert.equal(back.project, project)
  assert.ok(PC_KEYS.includes('chatHome') && PC_KEYS.includes('data') && PC_KEYS.includes('appAccount'), 'the keys the review named are PC keys')
  // The project's settings file: named by loadConfig once `data` is set; none today.
  assert.equal(projectSettingsFileOf({ settingsFile: 'D:/x/.workerboard/board-settings.json' }), 'D:/x/.workerboard/board-settings.json')
  assert.equal(projectSettingsFileOf(fixtureConfig()), null)
  assert.equal(projectSettingsFileOf(null), null)
})

test('T5.2 A8: with the chat home and the data home set, the home files come from the chat home (`home/`), the store, the goal map and the records from the data home (`data/`), the assets and the picture roots where the table puts them; targetOf gives each its place back; a path in neither home is skipped', async () => {
  const root = mkdtempSync(join(tmpdir(), 'carry-homes-'))
  try {
    const wrap = join(root, 'wrap')
    const game = join(wrap, 'game')
    const data = join(game, '.workerboard')
    const put = (file, text = 'x') => { mkdirSync(join(root, ...file.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(root, ...file.split('/')), text) }
    put('wrap/CLAUDE.md'); put('wrap/.claude/hooks/h.ps1'); put('wrap/.claude/chats/list.json', '{}'); put('wrap/.claude/board.json', '{"key":"k"}'); put('wrap/.codex/AGENTS.md')
    put('wrap/game/README.md'); put('wrap/game/.claude/work/B9.md', 'Id: B9')
    put('wrap/game/.workerboard/.claude/work/B1.md', 'Id: B1'); put('wrap/game/.workerboard/.claude/work/names.json', '{}'); put('wrap/game/.workerboard/.claude/goals.md', '# G')
    put('wrap/game/.workerboard/.claude/brainstorms/t.md'); put('wrap/game/.workerboard/pictures/assets/A1/request.json', '{}'); put('wrap/game/.workerboard/pictures/assets/A1/1.png')
    put('wrap/game/.workerboard/pictures/pictures/G1/demo/demo.json', '{}'); put('wrap/game/.workerboard/pictures/pictures/G1/demo/a.png')
    put('elsewhere/goals.md')
    const config = { project: game, gameRepo: game, chatHome: wrap, data, work: '.claude/work', goals: '.claude/goals.md', goalsHistory: '.claude/goals.history', brainstorms: '.claude/brainstorms', goalAsks: '.claude/goal-asks', designKinds: '.claude/design.json', pictureRoots: ['pictures'] }
    const got = await carrySet({ config, boardDir: join(root, 'board'), memoryDir: join(root, 'memory'), fs: nodeFs })
    assert.deepEqual(got.files.map(one => `${one.kind} ${one.to}`).sort(), [
      'goals data/.claude/brainstorms/t.md', 'goals data/.claude/goals.md',
      'home home/.claude/chats/list.json', 'home home/.claude/hooks/h.ps1', 'home home/.codex/AGENTS.md', 'home home/CLAUDE.md',
      'record data/pictures/assets/A1/request.json', 'record data/pictures/pictures/G1/demo/demo.json',
      'store data/.claude/work/B1.md',
    ], 'the old store in the project and the bridge key stay out; names.json and the pictures too')
    const homes = { project: game, boardDir: join(root, 'board'), memoryDir: join(root, 'memory'), chatHome: wrap, dataHome: data }
    for (const one of got.files) assert.equal(slash(targetOf(one.to, homes)), one.from, one.to)
    assert.equal(targetOf('data/.claude/work/B1.md', { ...homes, dataHome: null }), null, 'no data home: data/ is not placed')
    assert.equal(slash(targetOf('home/CLAUDE.md', { project: game, boardDir: 'b', memoryDir: 'm' })), slash(join(game, 'CLAUDE.md')), 'today: home/ is the project')
    // A whole path in neither home is skipped with its why.
    const away = await carrySet({ config: { ...config, goals: join(root, 'elsewhere', 'goals.md') }, boardDir: join(root, 'board'), memoryDir: join(root, 'memory'), fs: nodeFs })
    assert.deepEqual(away.skipped.map(one => one.why), ['config goals lies outside the chat home and the data home'])
    // The chat home set alone (data empty): the store stays in the project, carried under home/ relative to the chat home.
    const homeOnly = await carrySet({ config: { ...config, data: '' }, boardDir: join(root, 'board'), memoryDir: join(root, 'memory'), fs: nodeFs })
    assert.ok(homeOnly.files.some(one => one.to === 'home/game/.claude/work/B9.md'), homeOnly.files.map(one => one.to).join('\n'))
    assert.ok(homeOnly.files.every(one => !one.to.startsWith('data/')))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
