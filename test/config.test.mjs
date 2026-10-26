import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'

import { readFileSync } from 'node:fs'

import * as configModule from '../src/config.mjs'
import { configProblem, expandEnv, isOwnMap, parseConfig } from '../src/config.mjs'

const env = { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming', UserProfile: 'C:\\Users\\sam' }

test('expandEnv fills %NAME% from the environment, whatever the case of the name', () => {
  assert.equal(expandEnv('%APPDATA%\\Claude', env), 'C:\\Users\\sam\\AppData\\Roaming\\Claude')
  assert.equal(expandEnv('%USERPROFILE%\\.claude', env), 'C:\\Users\\sam\\.claude')
})

test('expandEnv leaves a name the environment does not have as it is', () => {
  assert.equal(expandEnv('%NOPE%\\x', env), '%NOPE%\\x')
})

test('parseConfig expands the paths and fills what is missing with the defaults', () => {
  const config = parseConfig(JSON.stringify({ project: 'C:\\game', appSessions: '%APPDATA%\\Claude\\sessions', port: 4999 }), env)
  assert.equal(config.project, 'C:\\game')
  assert.equal(config.appSessions, 'C:\\Users\\sam\\AppData\\Roaming\\Claude\\sessions')
  assert.equal(config.port, 4999)
  assert.equal(config.refreshSeconds, 30)
  assert.equal(config.quietMinutes, 10)
  assert.equal(config.estimateOldMinutes, 15)
  assert.deepEqual([config.hoursBack, config.hoursAhead], [2, 6])
})

test('parseConfig answers the defaults for text that is not JSON', () => {
  const config = parseConfig('not json', env)
  assert.equal(config.port, 4310)
  assert.equal(config.project, '')
})

test('parseConfig reads the advisor\'s name and the folders whose pictures may be shown', () => {
  const config = parseConfig(JSON.stringify({ advisor: ' Coach ', pictureRoots: ['art-inbox', 'shots', '..', 'a/b', 'C:\\x', 5] }), env)
  assert.equal(config.advisor, 'Coach')
  assert.deepEqual(config.pictureRoots, ['art-inbox', 'shots'])
  assert.deepEqual([parseConfig('{}', env).advisor, parseConfig('{}', env).pictureRoots], ['Advisor', ['pictures']])
})

test('parseConfig refuses a port or a number that makes no sense', () => {
  const config = parseConfig(JSON.stringify({ port: 'abc', refreshSeconds: -5 }), env)
  assert.equal(config.port, 4310)
  assert.equal(config.refreshSeconds, 30)
})

test('the games the board starts take their ports from 5300 and end half a minute after their tab is closed, unless set otherwise', () => {
  const usual = parseConfig('{}', env)
  assert.deepEqual([usual.gamePort, usual.gameIdleSeconds, usual.gameOpenSeconds], [5300, 30, 120])
  const set = parseConfig(JSON.stringify({ gamePort: 6100, gameIdleSeconds: 5 }), env)
  assert.deepEqual([set.gamePort, set.gameIdleSeconds], [6100, 5])
})

test('an answer waits two days for its chat unless set otherwise', () => {
  assert.equal(parseConfig('{}', env).answerKeepHours, 48)
  assert.equal(parseConfig('{"answerKeepHours":2}', env).answerKeepHours, 2)
})

test('an answer is never longer than the mod will type', () => {
  assert.equal(parseConfig('{"maxMessageChars":9000}', env).maxMessageChars, 2500)
})

test('B173: the Advisor\'s settings: paths stay inside their folder, the morning round is a time or nothing', () => {
  const config = parseConfig(JSON.stringify({
    backlog: 'plans/backlog.md', gamePlan: 'docs/plan.md', advisorReadFirst: ['docs/vision.md', '../secret.md', 'C:/x.md', 5],
    advisorSuggestions: ' Advice ', morningRound: '08:30', weeklyRound: false, morningSkipPercent: 150,
  }), {})
  assert.deepEqual([config.backlog, config.gamePlan, config.advisorReadFirst, config.advisorSuggestions, config.morningRound, config.weeklyRound, config.morningSkipPercent],
    ['plans/backlog.md', 'docs/plan.md', ['docs/vision.md'], 'Advice', '08:30', false, 100])
  const kept = parseConfig(JSON.stringify({ backlog: '../backlog.md', gamePlan: '/docs/plan.md', morningRound: '9:00' }), {})
  assert.deepEqual([kept.backlog, kept.gamePlan, kept.morningRound, kept.weeklyRound], ['.claude/backlog.md', 'docs/game-plan.md', '09:00', true])
  assert.equal(parseConfig(JSON.stringify({ morningRound: '' }), {}).morningRound, '')
})

test('B255: the goal map\'s four paths have defaults beside the backlog\'s, and stay inside the project', () => {
  const config = parseConfig('{}', {})
  assert.deepEqual([config.goals, config.brainstorms, config.goalAsks, config.goalsHistory],
    ['.claude/goals.md', '.claude/brainstorms', '.claude/goal-asks', '.claude/goals.history'])
  const set = parseConfig(JSON.stringify({ goals: 'plans/goals.md', brainstorms: '../out', goalAsks: '../x', goalsHistory: 'plans/old' }), {})
  assert.deepEqual([set.goals, set.brainstorms, set.goalAsks, set.goalsHistory], ['plans/goals.md', '.claude/brainstorms', '.claude/goal-asks', 'plans/old'])
})

test('Focus 1: a copy of the board may keep its goal map apart, as its work store: a whole path of its own', async () => {
  const { configProblem, projectFile } = await import('../src/config.mjs')
  const isWindows = process.platform === 'win32'
  const project = isWindows ? 'C:\\game' : '/game'
  const apart = isWindows ? 'D:/scratch/goals.md' : '/scratch/goals.md'
  const config = { ...parseConfig(JSON.stringify({ goals: apart, brainstorms: isWindows ? 'D:/scratch/b' : '/scratch/b' }), {}), project }
  assert.equal(config.goals, apart)
  assert.equal(projectFile(config, 'goals'), apart)
  assert.equal(projectFile(config, 'goalsHistory'), join(project, '.claude', 'goals.history'))
  assert.equal(configProblem(JSON.stringify({ goals: apart })), null)
  assert.equal(configProblem('{"goals": "../goals.md"}'), '"goals" must be a path inside its folder written with /, or a whole path of its own, not "../goals.md"')
  // The game plan and the backlog stay inside.
  assert.match(configProblem(JSON.stringify({ gamePlan: apart })), /^"gamePlan" must be a path inside its folder, written with \//)
})

test('B128: a broken settings file is named in one line: what is wrong and where; unknown settings are left alone', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.equal(configProblem('{\n  "port": 4310\n  "project": "x"\n}'), 'it is not valid JSON at line 3, column 3: Expected \',\' or \'}\' after property value')
  assert.equal(configProblem(''), 'it is not valid JSON: Unexpected end of JSON input')
  assert.equal(configProblem('[]'), 'it must hold one object, { ... }')
  assert.equal(configProblem('{"port": "4310"}'), '"port" must be a number above 0, not "4310"')
  assert.equal(configProblem('{"port": 4310.5}'), '"port" must be a whole number from 1 to 65535, not 4310.5')
  assert.equal(configProblem('{"project": 5}'), '"project" must be text, not 5')
  assert.equal(configProblem('{"pictureRoots": ["../up"]}'), '"pictureRoots" must be a list of one or more plain folder names, not ["../up"]')
  assert.equal(configProblem('{"pictureRoots": []}'), '"pictureRoots" must be a list of one or more plain folder names, not []')
  assert.equal(configProblem('{"backlog": "../backlog.md"}'), '"backlog" must be a path inside its folder, written with /, not "../backlog.md"')
  assert.equal(configProblem('{"morningRound": "9:00"}'), '"morningRound" must be a time like "09:00", or "" for none, not "9:00"')
  assert.equal(configProblem('{"weeklyRound": "yes"}'), '"weeklyRound" must be true or false, not "yes"')
  // A good file, one saved with a byte-order mark, and settings the board does not know pass.
  for (const text of ['{"port": 4310, "project": "C:/p", "morningRound": ""}', '\uFEFF{"port": 4310}', '{"boards": ["x"]}']) assert.equal(configProblem(text), null, text)
  assert.equal(parseConfig('\uFEFF{"port": 4320}', {}).port, 4320)
})

test('B128: loading a broken settings file stops with that line; a missing one keeps the defaults', async t => {
  const { BrokenConfig, loadConfig } = await import('../src/config.mjs')
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const folder = await mkdtemp(join(tmpdir(), 'worker-board-config-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(folder, 'config.json')
  await writeFile(file, '{"port": 4310,}')
  await assert.rejects(loadConfig(file, {}), error => error instanceof BrokenConfig
    && error.message === `The worker board's settings file ${file} is broken: it is not valid JSON at line 1, column 15: Expected double-quoted property name. Fix it and start the board again.`)
  assert.equal((await loadConfig(join(folder, 'none.json'), {})).port, 4310)
})

test('B127: a first start without a settings file makes it from the template, says which paths to fill in, and never writes over one', async t => {
  const { firstStart } = await import('../src/config.mjs')
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const folder = await mkdtemp(join(tmpdir(), 'worker-board-first-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const [file, template] = [join(folder, 'config.json'), join(folder, 'template.json')]
  await writeFile(template, '{ "project": "C:/Work/my-project" }\n')
  const said = await firstStart(file, template)
  assert.match(said, /made its settings file .*config\.json from .*template\.json\. Fill in "project" .*"name" .*"gameRepo" .*finds the app's folders and the chats' transcripts by itself\. Then start the board again\./)
  assert.equal(await readFile(file, 'utf8'), '{ "project": "C:/Work/my-project" }\n')
  await writeFile(file, '{ "port": 4399 }')
  assert.equal(await firstStart(file, template), null)
  assert.equal(await readFile(file, 'utf8'), '{ "port": 4399 }')
})

test('B127: the settings file of one PC is not in the repository; the template is', async () => {
  const { execFileSync } = await import('node:child_process')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const tracked = execFileSync('git', ['ls-files', 'config.json', 'examples/config.json'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.deepEqual(tracked, ['examples/config.json'])
  assert.match(execFileSync('git', ['check-ignore', 'config.json'], { cwd: root, encoding: 'utf8' }), /config\.json/)
})

test('B129: the project\'s name is the setting "name", else the project folder\'s name', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.equal(parseConfig('{"name": " Snow Fort ", "project": "C:/Work/my-project"}', {}).name, 'Snow Fort')
  assert.equal(parseConfig(JSON.stringify({ project: 'C:\\Work\\my-project\\' }), {}).name, 'my-project')
  assert.equal(parseConfig('{"project": "/home/sam/snow-fort"}', {}).name, 'snow-fort')
  assert.equal(parseConfig('{}', {}).name, '')
  assert.equal(configProblem('{"name": 5}'), '"name" must be text, not 5')
})

test('B194: the base branch is the setting baseBranch, "main" when not set; a name git would refuse is named', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.equal(parseConfig('{}', {}).baseBranch, 'main')
  assert.equal(parseConfig('{"baseBranch": " trunk "}', {}).baseBranch, 'trunk')
  assert.equal(parseConfig('{"baseBranch": "release/1.0"}', {}).baseBranch, 'release/1.0')
  assert.equal(configProblem('{"baseBranch": "a..b"}'), '"baseBranch" must be a branch name such as "main", not "a..b"')
  assert.equal(configProblem('{"baseBranch": 5}'), '"baseBranch" must be a branch name such as "main", not 5')
})

test('B194: the base branch is ticked by the board, and git counts the commits ahead of it, whatever its name', async () => {
  const { approvalRoute } = await import('../src/tick.mjs')
  const { readFolders } = await import('../src/folders.mjs')
  assert.equal(approvalRoute('trunk', ['trunk', 'feature/x'], 'trunk'), 'tick')
  assert.equal(approvalRoute('main', ['main'], 'trunk'), 'worker')
  assert.equal(approvalRoute('feature/x', ['trunk', 'feature/x'], 'trunk'), 'worker')
  const asked = []
  const run = async args => {
    asked.push(args.join(' '))
    if (args.includes('worktree')) return 'worktree /r/game\nHEAD a\nbranch refs/heads/trunk\n\nworktree /r/game-units\nHEAD b\nbranch refs/heads/feature/x\n'
    return args.includes('rev-list') ? '3\n' : ''
  }
  await readFolders('/r/game', run, 'trunk')
  assert.ok(asked.includes('-C /r/game rev-list --count trunk..feature/x'), asked.join('\n'))
  assert.ok(!asked.some(line => line.includes('trunk..trunk')))
})

test('B197: the game\'s start command is the setting runGame, none by default; a wrong one is named', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.deepEqual(parseConfig('{}', {}).runGame, [])
  assert.deepEqual(parseConfig('{"runGame": ["{node}", "{board}/run-game.mjs", "--port", "{port}"]}', {}).runGame, ['{node}', '{board}/run-game.mjs', '--port', '{port}'])
  assert.equal(configProblem('{"runGame": "npm run dev"}'), '"runGame" must be a list of words, the program first, not "npm run dev"')
  assert.equal(configProblem('{"runGame": ["node", ""]}'), '"runGame" must be a list of words, the program first, not ["node",""]')
})

test('B133: the Design tab\'s kinds are the project\'s file designKinds, inside the project', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.equal(parseConfig('{}', {}).designKinds, '.claude/design.json')
  assert.equal(parseConfig('{"designKinds": "design/kinds.json"}', {}).designKinds, 'design/kinds.json')
  assert.equal(configProblem('{"designKinds": "../kinds.json"}'), '"designKinds" must be a path inside its folder, written with /, not "../kinds.json"')
})

test('B134: the transcripts folder is worked out from the project when not set; a setting of its own wins', async () => {
  const { transcriptsOf } = await import('../src/config.mjs')
  const { join } = await import('node:path')
  const home = { USERPROFILE: 'C:/Users/sam' }
  assert.equal(transcriptsOf(String.raw`C:\Work\my-project`, home), join('C:/Users/sam', '.claude', 'projects', 'C--Work-my-project'))
  assert.equal(transcriptsOf('/Users/sam/my_game', { HOME: '/Users/sam' }), join('/Users/sam', '.claude', 'projects', '-Users-sam-my-game'))
  assert.equal(transcriptsOf('C:/x', {}), '')
  assert.equal(parseConfig(JSON.stringify({ project: String.raw`C:\Work\my-project` }), home).transcripts, join('C:/Users/sam', '.claude', 'projects', 'C--Work-my-project'))
  assert.equal(parseConfig(JSON.stringify({ project: String.raw`C:\Work\my-project`, transcripts: String.raw`D:\elsewhere` }), home).transcripts, String.raw`D:\elsewhere`)
  assert.equal(parseConfig('{}', home).transcripts, '')
})

test('B296: the work store is .claude/work unless set: a path inside the project, or a whole path of its own', async () => {
  const { configProblem, isOwnWork, workFolder } = await import('../src/config.mjs')
  const isWindows = process.platform === 'win32'
  const project = isWindows ? 'C:\\game' : '/game'
  const config = { ...parseConfig('{}', {}), project }
  assert.equal(config.work, '.claude/work')
  assert.equal(workFolder(config), join(project, '.claude', 'work'))
  assert.equal(isOwnWork(config), false)
  assert.equal(parseConfig(JSON.stringify({ work: 'plans/work' }), {}).work, 'plans/work')
  assert.equal(parseConfig(JSON.stringify({ work: '../out' }), {}).work, '.claude/work')
  const apart = isWindows ? 'D:\\scratch\\work' : '/scratch/work'
  const own = { ...parseConfig(JSON.stringify({ work: apart }), {}), project }
  assert.equal(workFolder(own), apart)
  assert.equal(isOwnWork(own), true)
  assert.equal(isOwnWork({ ...own, work: join(project, '.claude', 'work') }), false)
  assert.equal(configProblem('{"work": 5}'), '"work" must be a path inside the project written with /, or a whole path of its own, not 5')
  assert.equal(configProblem('{"work": "../out"}'), '"work" must be a path inside the project written with /, or a whole path of its own, not "../out"')
})

test('Focus 2, the review\'s findings: a copy of the board writes a goal map of its own (whole paths outside the project), never the project\'s', () => {
  const own = parseConfig(JSON.stringify({ project: 'C:\\garden', goals: 'C:/scratch/goals.md', brainstorms: 'C:/scratch/talks', goalsHistory: 'C:/scratch/history' }), {})
  assert.equal(isOwnMap(own), true)
  assert.equal(isOwnMap(parseConfig(JSON.stringify({ project: 'C:\\garden' }), {})), false)
  // Only part of it its own: the project's brainstorms would be written.
  assert.equal(isOwnMap(parseConfig(JSON.stringify({ project: 'C:\\garden', goals: 'C:/scratch/goals.md' }), {})), false)
  assert.equal(isOwnMap(parseConfig(JSON.stringify({ project: 'C:\\garden', goals: 'C:/garden/.claude/goals.md', brainstorms: 'C:/scratch/talks', goalsHistory: 'C:/scratch/history' }), {})), false)
})

test('Focus 2, the review\'s findings: a copy\'s own map is told by real paths (a junction counts) and is never the live board\'s map', async () => {
  const { mkdir, mkdtemp, rm, symlink, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { ownMapNow } = await import('../src/config.mjs')
  const root = await mkdtemp(join(tmpdir(), 'own-map-'))
  try {
    const project = join(root, 'project')
    const scratch = join(root, 'scratch')
    const live = join(root, 'board')
    await mkdir(join(project, '.claude'), { recursive: true })
    await mkdir(scratch, { recursive: true })
    await mkdir(live, { recursive: true })
    await symlink(join(project, '.claude'), join(root, 'door'), 'junction')
    const copyOf = paths => parseConfig(JSON.stringify({ project, ...paths }), {})
    const own = { goals: join(scratch, 'goals.md'), brainstorms: join(scratch, 'talks'), goalsHistory: join(scratch, 'history') }
    assert.equal(await ownMapNow(copyOf(own), { main: live }), true)
    // Through a junction into the project: the project's own map.
    assert.equal(await ownMapNow(copyOf({ ...own, goals: join(root, 'door', 'goals.md') }), { main: live }), false)
    // The live board (the main checkout's config.json) keeps its map there too: never the copy's.
    await writeFile(join(live, 'config.json'), JSON.stringify({ project, goals: join(scratch, 'goals.md') }))
    assert.equal(await ownMapNow(copyOf(own), { main: live }), false)
    await writeFile(join(live, 'config.json'), JSON.stringify({ project, brainstorms: join(scratch, 'talks') }))
    assert.equal(await ownMapNow(copyOf(own), { main: live }), false)
    await writeFile(join(live, 'config.json'), JSON.stringify({ project }))
    assert.equal(await ownMapNow(copyOf(own), { main: live }), true)
    // Not all three its own: no.
    assert.equal(await ownMapNow(copyOf({ goals: join(scratch, 'goals.md') }), { main: live }), false)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('Redesign Part 1: a chat whose last report is older than unknownAfterSeconds is unknown: 30 unless set, never under 5', () => {
  assert.equal(parseConfig('{}', env).unknownAfterSeconds, 30)
  assert.equal(parseConfig('{"unknownAfterSeconds":60}', env).unknownAfterSeconds, 60)
  // Under the mod's ping of 5 seconds every chat would flicker to unknown: refused, the default stands.
  assert.equal(parseConfig('{"unknownAfterSeconds":2}', env).unknownAfterSeconds, 30)
  assert.equal(parseConfig('{"unknownAfterSeconds":"60"}', env).unknownAfterSeconds, 30)
})

test('the review of chat-reports: a chat whose reports stay silent offAfterMinutes is not running: 5 unless set, at least 1', () => {
  assert.equal(parseConfig('{}', env).offAfterMinutes, 5)
  assert.equal(parseConfig('{"offAfterMinutes":10}', env).offAfterMinutes, 10)
  assert.equal(parseConfig('{"offAfterMinutes":0.5}', env).offAfterMinutes, 5)
})

test('Redesign Part 2: the hand-out settings: two minutes to take, a follow-up a preference only, 20 for a held give, no number of workers unless set', () => {
  const read = parseConfig('{}', env)
  assert.deepEqual([read.takeWithinMinutes, read.followUpMinutes, read.heldGiveMinutes, 'maxWorkers' in read], [2, 0, 20, false])
  assert.equal(parseConfig('{"heldGiveMinutes": 30}', env).heldGiveMinutes, 30)
  assert.equal(parseConfig('{"heldGiveMinutes": 0}', env).heldGiveMinutes, 20)
  assert.equal(parseConfig('{"followUpMinutes": 10}', env).followUpMinutes, 10)
  assert.equal(parseConfig('{"maxWorkers": 6}', env).maxWorkers, 6)
  // Any number of workers, but a whole one of at least 1; a take within 0 minutes would take every task back at once.
  assert.equal('maxWorkers' in parseConfig('{"maxWorkers": 0}', env), false)
  assert.equal('maxWorkers' in parseConfig('{"maxWorkers": 2.5}', env), false)
  assert.equal(parseConfig('{"takeWithinMinutes": 0}', env).takeWithinMinutes, 2)
  assert.equal(parseConfig('{"followUpMinutes": 0}', env).followUpMinutes, 0)
  assert.equal(parseConfig('{"followUpMinutes": -1}', env).followUpMinutes, 0)
})

test('the supervisor section counts a rolling 24 h: an old config.json that still has supervisorCountFrom starts as before, the setting ignored', () => {
  // The setting is gone (2026-10-26): not parsed, not kept, never a problem, whatever it holds; the other settings stand.
  assert.equal('supervisorCountFrom' in parseConfig('{}', env), false)
  for (const old of ['2026-10-25 14:00', ' 2026-10-25 14:00 ', '', '25 Oct 14:00', '2026-02-30 10:00', 1792900000000, null, true, ['x']]) {
    const text = JSON.stringify({ supervisorCountFrom: old, port: 4999 })
    assert.equal('supervisorCountFrom' in parseConfig(text, env), false, String(old))
    assert.equal(parseConfig(text, env).port, 4999, 'the rest of the file is read')
    assert.equal(configProblem(text), null, String(old))
  }
  assert.equal('countFromMs' in configModule, false, 'the time parser went with it')
  // Nor does the example file a new PC starts from carry it.
  assert.doesNotMatch(readFileSync(new URL('../examples/config.json', import.meta.url), 'utf8'), /supervisorCountFrom/)
})

test('T9.3 part 1: providers: each kind of asset has its provider by default; a full or partial object changes only what it names', () => {
  const usual = { visual: { provider: 'codex' }, music: { provider: 'person-suno' }, 'sound effect': { provider: 'sound-library', folder: 'sound-library' } }
  assert.deepEqual(parseConfig('{}', env).providers, usual)
  assert.deepEqual(Object.keys(parseConfig('{}', env).providers), ['visual', 'music', 'sound effect'])
  // A full object, in either form: the provider's name, or { provider, folder? }.
  const full = parseConfig(JSON.stringify({ providers: { visual: 'codex', music: { provider: 'person-suno' }, 'sound effect': { provider: 'sound-library', folder: 'audio/effects' } } }), env)
  assert.deepEqual(full.providers, { visual: { provider: 'codex' }, music: { provider: 'person-suno' }, 'sound effect': { provider: 'sound-library', folder: 'audio/effects' } })
  // A partial one: the kinds it does not name stay as they are.
  assert.deepEqual(parseConfig('{"providers": {"sound effect": "sound-library"}}', env).providers, usual)
  assert.deepEqual(parseConfig('{"providers": {}}', env).providers, usual)
  assert.deepEqual(parseConfig('{"providers": {"sound effect": {"provider": "sound-library"}}}', env).providers['sound effect'], { provider: 'sound-library', folder: 'sound-library' })
  // The folder is written with / and trimmed; a name too.
  assert.deepEqual(parseConfig('{"providers": {"sound effect": {"provider": " sound-library ", "folder": " sounds "}}}', env).providers['sound effect'], { provider: 'sound-library', folder: 'sounds' })
  for (const text of ['{}', '{"providers": {}}', '{"providers": {"visual": "codex", "music": "person-suno", "sound effect": {"provider": "sound-library", "folder": "sound-library"}}}', '{"providers": {"sound effect": {"provider": "sound-library", "folder": "audio/my sounds"}}}']) {
    assert.equal(configProblem(text), null, text)
  }
})

test('T9.3 part 1: a wrong providers setting is refused with one line; parseConfig keeps the kind at its default', () => {
  const refused = {
    '{"providers": []}': '"providers" must be an object from asset kind to provider, such as { "visual": "codex" }, not []',
    '{"providers": "codex"}': '"providers" must be an object from asset kind to provider, such as { "visual": "codex" }, not "codex"',
    // An unknown kind.
    '{"providers": {"image": "codex"}}': '"providers.image" is no asset kind; the kinds are visual, music, sound effect',
    '{"providers": {"sound effects": "sound-library"}}': '"providers.sound effects" is no asset kind; the kinds are visual, music, sound effect',
    // An unknown provider: also one that is only a name of JavaScript's objects.
    '{"providers": {"visual": "midjourney"}}': '"providers.visual" must name a provider the board knows (codex, person-suno, sound-library), not "midjourney"',
    '{"providers": {"visual": "constructor"}}': '"providers.visual" must name a provider the board knows (codex, person-suno, sound-library), not "constructor"',
    '{"providers": {"visual": 5}}': '"providers.visual" must name a provider the board knows (codex, person-suno, sound-library), not 5',
    '{"providers": {"visual": {}}}': '"providers.visual" must name a provider the board knows (codex, person-suno, sound-library), not undefined',
    '{"providers": {"visual": null}}': '"providers.visual" must name a provider the board knows (codex, person-suno, sound-library), not null',
    // A provider set for a kind it cannot serve.
    '{"providers": {"music": "codex"}}': '"providers.music" is set to "codex", which serves visual, not music',
    '{"providers": {"visual": {"provider": "sound-library"}}}': '"providers.visual" is set to "sound-library", which serves sound effect, not visual',
    '{"providers": {"sound effect": "person-suno"}}': '"providers.sound effect" is set to "person-suno", which serves music, not sound effect',
    // The folder: only a provider that has one, and a path inside the project.
    '{"providers": {"visual": {"provider": "codex", "folder": "pictures"}}}': '"providers.visual" sets a folder, but "codex" has none',
    '{"providers": {"sound effect": {"provider": "sound-library", "folder": "../sounds"}}}': '"providers.sound effect.folder" must be a path inside the project, written with /, not "../sounds"',
    '{"providers": {"sound effect": {"provider": "sound-library", "folder": "C:/sounds"}}}': '"providers.sound effect.folder" must be a path inside the project, written with /, not "C:/sounds"',
    '{"providers": {"sound effect": {"provider": "sound-library", "folder": ""}}}': '"providers.sound effect.folder" must be a path inside the project, written with /, not ""',
    '{"providers": {"sound effect": {"provider": "sound-library", "folder": 3}}}': '"providers.sound effect.folder" must be a path inside the project, written with /, not 3',
  }
  for (const [text, line] of Object.entries(refused)) {
    assert.equal(configProblem(text), line, text)
    // The board does not start on it; read leniently, every kind stays as it is by default.
    assert.deepEqual(parseConfig(text, env).providers, parseConfig('{}', env).providers, text)
  }
  // The first wrong thing is the one said; a right kind beside a wrong one still counts for parseConfig.
  assert.equal(configProblem('{"providers": {"music": "codex", "image": "codex"}}'), '"providers.music" is set to "codex", which serves visual, not music')
  assert.deepEqual(parseConfig('{"providers": {"music": "codex", "sound effect": {"provider": "sound-library", "folder": "sfx"}}}', env).providers['sound effect'], { provider: 'sound-library', folder: 'sfx' })
})

test('T9.3 part 1: loading a settings file with a wrong provider stops with that line', async t => {
  const { BrokenConfig, loadConfig } = await import('../src/config.mjs')
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const folder = await mkdtemp(join(tmpdir(), 'worker-board-config-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const file = join(folder, 'config.json')
  await writeFile(file, '{"providers": {"music": "codex"}}')
  await assert.rejects(loadConfig(file, {}), error => error instanceof BrokenConfig
    && error.message === `The worker board's settings file ${file} is broken: "providers.music" is set to "codex", which serves visual, not music. Fix it and start the board again.`)
})
