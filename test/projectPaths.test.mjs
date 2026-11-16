// T5.2 P2 (2026-11-16): the path table (src/projectPaths.mjs). First, with the two new settings empty, every answer is exactly today's
// path, so the live board changes nothing when this lands (the test that must pass before P3). Then the fixture
// (test/fixtures/projectPaths/config.json: `data` set, `chatHome` different from `project`): every picture and asset path lands under
// `<data>/pictures`, the store's and the goal map's under `<data>` with their stored names, the docs under `<data>/docs`, and every
// chat-keyed path under the chat home. PURE: no file is read but the fixture.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { configProblem, parseConfig, transcriptsOf, workFolder } from '../src/config.mjs'
import { assetsOf, assetsPrefixOf, chatFile, chatHomeOf, chatsFolderOf, dataOf, picturesOf, resolveStored, routineFolderOf, wordsPath } from '../src/projectPaths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV = { USERPROFILE: 'C:\\Users\\tester' }
const PROJECT = 'D:/wrap/game'
const BOARD = 'D:/wrap/worker-board'
/** Stored paths of every kind the table knows, as the store, the goal map, the plans and the records write them. */
const STORED = ['pictures/G64/demo/demo.json', 'pictures/B12/evidence.png', '.claude/assets/A3/request.json', '.claude/work/B1.md', '.claude/work', '.claude/goals.md',
  '.claude/goals.history/2026-11-01.md', '.claude/brainstorms/t1.md', '.claude/goal-asks/A1.md', '.claude/design.json', '.claude/plans/p.md', '.claude/specs/s.md',
  '.claude/handover/chat-1.md', '.claude/backlog.md', 'logs/scratch/x.txt', 'game/docs/a.md', 'worker-board/roles/worker.md', 'README.md', 'docs/game-plan.md']

test('with chatHome and data empty every path is exactly today\'s: the project folder, `.claude/assets` beside the store, `join(project, path)` for every stored path', () => {
  const config = parseConfig(JSON.stringify({ project: PROJECT }), ENV)
  assert.deepEqual([config.chatHome, config.data], ['', ''], 'the defaults are empty')
  assert.equal(chatHomeOf(config), PROJECT)
  assert.equal(dataOf(config), null)
  assert.equal(picturesOf(config), PROJECT)
  assert.equal(assetsOf(config), join(PROJECT, '.claude', 'assets'))
  assert.equal(assetsPrefixOf(config), '.claude/assets/')
  assert.equal(chatFile(config, 'board.json'), join(PROJECT, '.claude', 'board.json'))
  assert.equal(chatFile(config, 'launch.json'), join(PROJECT, '.claude', 'launch.json'))
  assert.equal(chatsFolderOf(config), join(PROJECT, '.claude', 'chats'))
  assert.equal(chatFile(config, 'chats', 'list.json'), join(PROJECT, '.claude', 'chats', 'list.json'))
  assert.equal(routineFolderOf(config), 'game')
  assert.equal(config.transcripts, transcriptsOf(PROJECT, ENV), 'the transcripts are derived from the project, as before')
  for (const stored of STORED) assert.equal(resolveStored(config, stored, { boardDir: BOARD }), join(PROJECT, ...stored.split('/')), stored)
  assert.equal(resolveStored(config, 'D:/elsewhere/x.png'), 'D:/elsewhere/x.png', 'an absolute path is itself')
  assert.equal(resolveStored(config, ''), '')
  assert.equal(wordsPath(config, join(PROJECT, '.claude', 'work', 'B1.md')), '.claude/work/B1.md')
  assert.equal(wordsPath(config, join(workFolder(config), 'B2.md')), '.claude/work/B2.md')
  assert.equal(wordsPath(config, 'D:/elsewhere/x.md'), 'D:/elsewhere/x.md', 'outside the chat home: whole')
  // No project at all: nothing to make a path from.
  const none = parseConfig('{}', ENV)
  assert.deepEqual([chatHomeOf(none), dataOf(none), chatFile(none, 'board.json'), routineFolderOf(none)], ['', null, '', ''])
})

test('the fixture (data set, chatHome different from project): pictures and assets under <data>/pictures, the store and the goal map under <data>, docs under <data>/docs, every chat-keyed path under the chat home', () => {
  const config = parseConfig(readFileSync(join(HERE, 'fixtures', 'projectPaths', 'config.json'), 'utf8'), ENV)
  const data = 'D:/wrap/game/.workerboard'
  assert.deepEqual([chatHomeOf(config), dataOf(config)], ['D:/wrap', data])
  assert.equal(picturesOf(config), join(data, 'pictures'))
  assert.equal(assetsOf(config), join(data, 'pictures', 'assets'))
  const want = {
    'pictures/G64/demo/demo.json': join(data, 'pictures', 'pictures', 'G64', 'demo', 'demo.json'),
    'pictures/B12/evidence.png': join(data, 'pictures', 'pictures', 'B12', 'evidence.png'),
    '.claude/assets/A3/request.json': join(data, 'pictures', 'assets', 'A3', 'request.json'),
    '.claude/work/B1.md': join(data, '.claude', 'work', 'B1.md'),
    '.claude/work': join(data, '.claude', 'work'),
    '.claude/goals.md': join(data, '.claude', 'goals.md'),
    '.claude/goals.history/2026-11-01.md': join(data, '.claude', 'goals.history', '2026-11-01.md'),
    '.claude/brainstorms/t1.md': join(data, '.claude', 'brainstorms', 't1.md'),
    '.claude/goal-asks/A1.md': join(data, '.claude', 'goal-asks', 'A1.md'),
    '.claude/design.json': join(data, '.claude', 'design.json'),
    '.claude/plans/p.md': join(data, 'docs', 'plans', 'p.md'),
    '.claude/specs/s.md': join(data, 'docs', 'specs', 's.md'),
    '.claude/handover/chat-1.md': join(data, 'docs', 'handover', 'chat-1.md'),
    'logs/scratch/x.txt': join('D:/wrap', 'logs', 'scratch', 'x.txt'),
    'game/docs/a.md': join(PROJECT, 'docs', 'a.md'),
    'worker-board/roles/worker.md': join(BOARD, 'roles', 'worker.md'),
    'README.md': join(PROJECT, 'README.md'),
    'docs/game-plan.md': join(PROJECT, 'docs', 'game-plan.md'),
    '.claude/backlog.md': join(PROJECT, '.claude', 'backlog.md'),
  }
  assert.deepEqual(Object.keys(want).sort(), [...STORED].sort(), 'every stored kind of the first test is placed here')
  for (const [stored, path] of Object.entries(want)) assert.equal(resolveStored(config, stored, { boardDir: BOARD }), path, stored)
  assert.equal(resolveStored(config, 'worker-board/roles/worker.md'), join(PROJECT, 'worker-board', 'roles', 'worker.md'), 'without the board folder its name is no prefix')
  // Chat-keyed: the chat home, never the project.
  assert.equal(chatFile(config, 'board.json'), join('D:/wrap', '.claude', 'board.json'))
  assert.equal(chatFile(config, 'launch.json'), join('D:/wrap', '.claude', 'launch.json'))
  assert.equal(chatsFolderOf(config), join('D:/wrap', '.claude', 'chats'))
  assert.equal(chatFile(config, 'chat-logs'), join('D:/wrap', '.claude', 'chat-logs'))
  assert.equal(routineFolderOf(config), 'wrap', 'the routines keep the chats\' folder name')
  assert.equal(config.transcripts, transcriptsOf('D:/wrap', ENV), 'the transcripts are the chats\' folder\'s')
  assert.equal(wordsPath(config, join(data, '.claude', 'work', 'B1.md')), 'game/.workerboard/.claude/work/B1.md', 'words to a chat: relative to the chat home')
  assert.equal(wordsPath(config, join(PROJECT, 'docs', 'a.md')), 'game/docs/a.md')
  assert.equal(wordsPath(config, 'E:/other/x.md'), 'E:/other/x.md')
})

test('the settings: chatHome and data are text with %ENV% filled; anything else is refused; a set transcripts setting still wins', () => {
  const env = { ...ENV, WRAP: 'D:\\wrap' }
  const config = parseConfig(JSON.stringify({ project: '%WRAP%\\game', chatHome: '%WRAP%', data: '%WRAP%\\game\\.workerboard' }), env)
  assert.deepEqual([config.project, config.chatHome, config.data], ['D:\\wrap\\game', 'D:\\wrap', 'D:\\wrap\\game\\.workerboard'])
  assert.equal(config.transcripts, transcriptsOf('D:\\wrap', env))
  assert.equal(parseConfig(JSON.stringify({ project: PROJECT, chatHome: 'D:/wrap', transcripts: 'E:/t' }), ENV).transcripts, 'E:/t')
  assert.match(configProblem(JSON.stringify({ chatHome: 5 })), /"chatHome" must be text/)
  assert.match(configProblem(JSON.stringify({ data: [] })), /"data" must be text/)
  assert.equal(configProblem(JSON.stringify({ chatHome: '', data: '' })), null)
})
