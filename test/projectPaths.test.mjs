// T5.2 P2 (2026-11-16): the path table (src/projectPaths.mjs). First, with the two new settings empty, every answer is exactly today's
// path, so the live board changes nothing when this lands (the test that must pass before P3). Then the fixture
// (test/fixtures/projectPaths/board-config.json: `data` set, `chatHome` different from `project`): every picture and asset path lands under
// `<data>/pictures`, the store's and the goal map's under `<data>` with their stored names, the docs under `<data>/docs`, and every
// chat-keyed path under the chat home. PURE: no file is read but the fixture.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { configProblem, parseConfig, projectFile, transcriptsOf, workFolder } from '../src/config.mjs'
import { assetsOf, assetsPrefixOf, backlogViewOf, chatFile, chatHomeOf, chatsFolderOf, dataOf, localFile, pictureHomeOf, picturesOf, resolveStored, routineFolderOf, wordsPath } from '../src/projectPaths.mjs'
import { findPicture, pictureProblem } from '../src/pictures.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV = { USERPROFILE: 'C:\\Users\\tester' }
const PROJECT = 'D:/wrap/game'
const BOARD = 'D:/wrap/worker-board'
/** Stored paths of every kind the table knows, as the store, the goal map, the plans and the records write them. */
const STORED = ['pictures/G64/demo/demo.json', 'pictures/B12/evidence.png', '.claude/assets/A3/request.json', '.claude/work/B1.md', '.claude/work', '.claude/goals.md',
  '.claude/goals.history/2026-11-01.md', '.claude/brainstorms/t1.md', '.claude/goal-asks/A1.md', '.claude/design.json', '.claude/plans/p.md', '.claude/specs/s.md',
  '.claude/handover/chat-1.md', '.claude/backlog.md', 'logs/scratch/x.txt', '.claude/chat-logs/Main/2026-11-01 B1.txt', '.claude/chats/list.json', 'game/docs/a.md',
  'worker-board/roles/worker.md', 'README.md', 'docs/game-plan.md']

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
  assert.equal(backlogViewOf(config), join(PROJECT, '.claude', 'backlog.md'), 'A1: the view is in the project today')
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
  const config = parseConfig(readFileSync(join(HERE, 'fixtures', 'projectPaths', 'board-config.json'), 'utf8'), ENV)
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
    '.claude/chat-logs/Main/2026-11-01 B1.txt': join('D:/wrap', '.claude', 'chat-logs', 'Main', '2026-11-01 B1.txt'),
    '.claude/chats/list.json': join('D:/wrap', '.claude', 'chats', 'list.json'),
    'game/docs/a.md': join(PROJECT, 'docs', 'a.md'),
    'worker-board/roles/worker.md': join(BOARD, 'roles', 'worker.md'),
    'README.md': join(PROJECT, 'README.md'),
    'docs/game-plan.md': join(PROJECT, 'docs', 'game-plan.md'),
    // A1 (chat 1's review, finding 10): the generated view is a runtime file under <data>/local, never in the game checkout.
    '.claude/backlog.md': join(data, 'local', 'backlog.md'),
  }
  assert.equal(backlogViewOf(config), join(data, 'local', 'backlog.md'))
  assert.deepEqual(Object.keys(want).sort(), [...STORED].sort(), 'every stored kind of the first test is placed here')
  for (const [stored, path] of Object.entries(want)) assert.equal(resolveStored(config, stored, { boardDir: BOARD }), path, stored)
  assert.equal(resolveStored(config, 'worker-board/roles/worker.md'), join(PROJECT, 'worker-board', 'roles', 'worker.md'), 'without the board folder its name is no prefix')
  // A folder named alone (the picture readers list a root; the asset and doc folders): placed like what lies under it.
  assert.equal(resolveStored(config, 'pictures'), join(data, 'pictures', 'pictures'))
  assert.equal(resolveStored(config, '.claude/assets'), join(data, 'pictures', 'assets'))
  assert.equal(resolveStored(config, '.claude/plans'), join(data, 'docs', 'plans'))
  assert.equal(resolveStored(config, 'logs'), join('D:/wrap', 'logs'))
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

test('P3: the store, the goal map, the backlog view and the runtime files: today\'s places with data empty; under <data> (local/ for the runtime files) with it set', () => {
  const today = parseConfig(JSON.stringify({ project: PROJECT }), ENV)
  assert.equal(workFolder(today), join(PROJECT, '.claude', 'work'))
  assert.equal(projectFile(today, 'goals'), join(PROJECT, '.claude', 'goals.md'))
  assert.equal(projectFile(today, 'brainstorms'), join(PROJECT, '.claude', 'brainstorms'))
  assert.equal(projectFile(today, 'designKinds'), join(PROJECT, '.claude', 'design.json'))
  assert.equal(projectFile(today, 'backlog'), join(PROJECT, '.claude', 'backlog.md'))
  assert.equal(localFile(today, 'sync-loop.json'), join(PROJECT, '.claude', 'sync-loop.json'))
  assert.equal(pictureHomeOf(today).abs('pictures/x.png'), join(PROJECT, 'pictures', 'x.png'))
  assert.equal(pictureHomeOf(today).root, PROJECT)
  const moved = parseConfig(readFileSync(join(HERE, 'fixtures', 'projectPaths', 'board-config.json'), 'utf8'), ENV)
  const data = 'D:/wrap/game/.workerboard'
  assert.equal(workFolder(moved), join(data, '.claude', 'work'), 'the store keeps its stored name under the data home')
  assert.equal(projectFile(moved, 'goals'), join(data, '.claude', 'goals.md'))
  assert.equal(projectFile(moved, 'goalsHistory'), join(data, '.claude', 'goals.history'))
  assert.equal(projectFile(moved, 'designKinds'), join(data, '.claude', 'design.json'))
  assert.equal(projectFile(moved, 'backlog'), join(data, 'local', 'backlog.md'), 'the generated view is a runtime file')
  assert.equal(localFile(moved, 'limit-readings.json'), join(data, 'local', 'limit-readings.json'))
  assert.equal(workFolder({ ...moved, work: 'E:/own/work' }), 'E:/own/work', 'a whole path of its own stays')
  assert.equal(pictureHomeOf(moved).abs('pictures/x.png'), join(data, 'pictures', 'pictures', 'x.png'))
  assert.equal(pictureHomeOf(moved, { boardDir: BOARD }).abs('worker-board/roles/worker.md'), join(BOARD, 'roles', 'worker.md'))
})

test('P3: the picture readers take the home ({ root, abs }): a picture under <data>/pictures is found and is no problem; given the project folder alone (today\'s call) it is not there', () => {
  const root = mkdtempSync(join(tmpdir(), 'picture-home-'))
  try {
    const project = join(root, 'game')
    const data = join(project, '.workerboard')
    mkdirSync(join(data, 'pictures', 'pictures', 'B12'), { recursive: true })
    mkdirSync(join(project, 'pictures'), { recursive: true })
    writeFileSync(join(data, 'pictures', 'pictures', 'B12', 'look.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))
    const config = parseConfig(JSON.stringify({ project, data, pictureRoots: ['pictures'] }), ENV)
    return (async () => {
      const found = await findPicture(pictureHomeOf(config), ['pictures'], 'pictures/B12/look.png')
      assert.ok(found !== null && found.file.toLowerCase() === join(data, 'pictures', 'pictures', 'B12', 'look.png').toLowerCase(), JSON.stringify(found))
      assert.equal(await pictureProblem(pictureHomeOf(config), ['pictures'], 'pictures/B12/look.png'), null)
      assert.equal(await findPicture(project, ['pictures'], 'pictures/B12/look.png'), null, 'under the project folder itself there is no such picture')
      assert.equal(await pictureProblem(project, ['pictures'], 'pictures/B12/look.png'), 'missing')
    })().finally(() => rmSync(root, { recursive: true, force: true }))
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
})

test('T5.2 A1/A3/A4 (the switch-on round): the chat home alone set puts the chat logs and the chat list there; every reader and writer of the backlog view, the take and next answers\' store path, and the plan\'s links go through the table', () => {
  // A4: `chatHome` set, `data` empty: the chat-log keeper writes under the chat home, so a stored chat-log path is read there.
  const homeOnly = parseConfig(JSON.stringify({ project: PROJECT, chatHome: 'D:/wrap' }), ENV)
  assert.equal(resolveStored(homeOnly, '.claude/chat-logs/Main/x.txt'), join('D:/wrap', '.claude', 'chat-logs', 'Main', 'x.txt'))
  assert.equal(resolveStored(homeOnly, 'logs/x.txt'), join('D:/wrap', 'logs', 'x.txt'))
  assert.equal(resolveStored(homeOnly, '.claude/work/B1.md'), join(PROJECT, '.claude', 'work', 'B1.md'), 'the store stays in the project with data empty')
  assert.equal(backlogViewOf(homeOnly), join(PROJECT, '.claude', 'backlog.md'))
  // A whole-path backlog setting is itself.
  assert.equal(backlogViewOf({ ...homeOnly, backlog: 'E:/own/backlog.md' }), 'E:/own/backlog.md')
  // The wiring: no caller resolves the view as a stored path any more; workCtx hands the work API the store's path as the chat reaches it.
  const code = Object.fromEntries(['server.mjs', 'src/state.mjs', 'src/rounds.mjs', 'src/gameFile.mjs'].map(file => [file, readFileSync(join(HERE, '..', file), 'utf8')]))
  for (const file of Object.keys(code)) assert.doesNotMatch(code[file], /resolveStored\(config, config\.backlog\)/, `${file}: the view is no stored path`)
  assert.equal((code['server.mjs'].match(/backlogViewOf\(config\)/g) ?? []).length, 2, 'server: the view file and the backlog file')
  assert.equal((code['src/state.mjs'].match(/backlogViewOf\(config\)/g) ?? []).length, 1, 'state: the backlog line')
  assert.equal((code['src/rounds.mjs'].match(/backlogViewOf\(config\)/g) ?? []).length, 1, 'rounds: the partner\'s briefing')
  assert.match(code['server.mjs'], /const workCtx = async[^]*?return \{\n(?:\s*\/\/[^\n]*\n)*\s*workPrefix: `\$\{wordsPath\(config, workFolder\(config\)\)\}\/`,/, 'A3: workCtx carries workPrefix')
  assert.match(code['src/gameFile.mjs'], /export async function findGameFile\(config, path, alt\)[^]*?resolveStored\(config, where\)/, 'A4: the links go through the table')
})
