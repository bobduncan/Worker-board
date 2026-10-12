import assert from 'node:assert/strict'
import test from 'node:test'

import { boardChats, parseAppChat, parseList } from '../src/appChats.mjs'

const PROJECT = 'C:\\Web\\game-project'
const RULES = { project: PROJECT, prefix: 'Game - ', main: 'Main' }

const chat = (title, extra = {}) => ({
  title,
  sessionId: `local_${title}`,
  cliSessionId: `cli-${title}`,
  cwd: PROJECT,
  isArchived: false,
  createdAt: 1000,
  lastActivityAt: 5000,
  completedTurns: 3,
  summary: null,
  ...extra,
})

test('parseAppChat keeps the fields the board uses', () => {
  const parsed = parseAppChat(JSON.stringify({
    title: 'Game - Units',
    sessionId: 'local_1',
    cliSessionId: 'abc',
    cwd: PROJECT,
    isArchived: false,
    createdAt: 10,
    lastActivityAt: 20,
    completedTurns: 139,
    lastAssistantUuid: 'u-9',
    postTurnSummary: { status_category: 'blocked', status_detail: 'waits for a pick', needs_action: 'Pick A or B', summarizes_uuid: 'u-9' },
    model: 'ignored',
  }))
  assert.deepEqual(parsed, {
    title: 'Game - Units',
    sessionId: 'local_1',
    cliSessionId: 'abc',
    cwd: PROJECT,
    isArchived: false,
    createdAt: 10,
    lastActivityAt: 20,
    completedTurns: 139,
    summary: { category: 'blocked', detail: 'waits for a pick', needsAction: 'Pick A or B', isCurrent: true },
  })
})

test('parseAppChat marks a summary of an older turn as not current', () => {
  const parsed = parseAppChat(JSON.stringify({
    title: 'Game - Units', cliSessionId: 'abc', cwd: PROJECT, lastAssistantUuid: 'u-12',
    postTurnSummary: { status_category: 'blocked', summarizes_uuid: 'u-9' },
  }))
  assert.equal(parsed.summary.isCurrent, false)
})

test('parseAppChat answers null for text that is not a chat', () => {
  assert.equal(parseAppChat('{ broken'), null)
  assert.equal(parseAppChat('[]'), null)
  assert.equal(parseAppChat(JSON.stringify({ cwd: PROJECT })), null)
})

test('parseAppChat has no summary when the app wrote none', () => {
  assert.equal(parseAppChat(JSON.stringify({ title: 'Game - Main', cliSessionId: 'abc' })).summary, null)
})

test('parseList reads the prefix and the main chat, and has defaults', () => {
  assert.deepEqual(parseList('{"prefix":"Team - ","main":"Lead"}'), { prefix: 'Team - ', main: 'Lead' })
  assert.deepEqual(parseList('nope'), { prefix: 'Game - ', main: 'Main' })
})

test('boardChats keeps the open chats of the project with the prefix, the main chat first', () => {
  const chats = boardChats([
    chat('Game - Units', { createdAt: 200 }),
    chat('Game - Main', { createdAt: 300 }),
    chat('Game - Features', { createdAt: 100 }),
    chat('Game - Old', { isArchived: true }),
    chat('Game - Elsewhere', { cwd: 'C:\\Web' }),
    chat('Notes'),
  ], RULES)
  assert.deepEqual(chats.map(c => c.name), ['Main', 'Features', 'Units'])
  assert.deepEqual(chats.map(c => c.isMain), [true, false, false])
})

test('boardChats counts a folder inside the project, whatever the case and the slashes', () => {
  const chats = boardChats([
    chat('Game - Units', { cwd: 'c:/web/GAME-PROJECT/lava-tactics' }),
    chat('Game - Near', { cwd: 'C:\\Web\\game-project-other' }),
  ], RULES)
  assert.deepEqual(chats.map(c => c.name), ['Units'])
})

test('boardChats shows a fork of the main chat greyed at the end, never as the main chat', () => {
  const chats = boardChats([chat('Game - Main (fork)', { createdAt: 1 }), chat('Game - Main'), chat('Game - Units')], RULES)
  assert.deepEqual(chats.map(c => [c.name, c.isMain, c.isLeftover]), [
    ['Main', true, false],
    ['Units', false, false],
    ['Main (fork)', false, true],
  ])
})

test('boardChats keeps the newest of two files for one transcript, and of two chats with one name', () => {
  const chats = boardChats([
    chat('Game - Sprites', { cliSessionId: 'same', lastActivityAt: 10 }),
    chat('Game - Units', { cliSessionId: 'same', lastActivityAt: 90 }),
    chat('Game - Main', { cliSessionId: 'old-main', lastActivityAt: 10 }),
    chat('Game - Main', { cliSessionId: 'new-main', lastActivityAt: 90 }),
  ], RULES)
  assert.deepEqual(chats.map(c => [c.name, c.cliSessionId, c.isLeftover]), [
    ['Main', 'new-main', false],
    ['Units', 'same', false],
    ['Main', 'old-main', true],
  ])
})
