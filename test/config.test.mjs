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
