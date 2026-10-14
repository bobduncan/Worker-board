import assert from 'node:assert/strict'
import test from 'node:test'

import { expandEnv, parseConfig } from '../src/config.mjs'

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
  assert.deepEqual([parseConfig('{}', env).advisor, parseConfig('{}', env).pictureRoots], ['Advisor', ['art-inbox']])
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

test('B128: a broken settings file is named in one line: what is wrong and where; unknown settings are left alone', async () => {
  const { configProblem } = await import('../src/config.mjs')
  assert.equal(configProblem('{\n  "port": 4310\n  "project": "x"\n}'), 'it is not valid JSON at line 3, column 3: Expected \',\' or \'}\' after property value')
  assert.equal(configProblem(''), 'it is not valid JSON: Unexpected end of JSON input')
  assert.equal(configProblem('[]'), 'it must hold one object, { ... }')
  assert.equal(configProblem('{"port": "4310"}'), '"port" must be a number above 0, not "4310"')
  assert.equal(configProblem('{"port": 4310.5}'), '"port" must be a whole number from 1 to 65535, not 4310.5')
  assert.equal(configProblem('{"project": 5}'), '"project" must be text, not 5')
  assert.equal(configProblem('{"pictureRoots": ["../up"]}'), '"pictureRoots" must be a list of plain folder names, not ["../up"]')
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
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = join(folder, 'config.json')
  await writeFile(file, '{"port": 4310,}')
  await assert.rejects(loadConfig(file, {}), error => error instanceof BrokenConfig
    && error.message === `The worker board's settings file ${file} is broken: it is not valid JSON at line 1, column 15: Expected double-quoted property name. Fix it and start the board again.`)
  assert.equal((await loadConfig(join(folder, 'none.json'), {})).port, 4310)
})
