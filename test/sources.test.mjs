import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, fromChat, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { readHead } from '../src/files.mjs'
import { findPicture, listPictures, mentionedPaths } from '../src/pictures.mjs'
import { oneAtATime, readSources } from '../src/sources.mjs'
import { buildState } from '../src/state.mjs'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const NOW = Date.UTC(2026, 9, 12, 8, 24)
const MIN = 60_000

/** A made-up project on disk, inside the board's own git-ignored data folder, removed after the test. */
async function project(t) {
  await mkdir(DATA, { recursive: true })
  const root = await mkdtemp(join(DATA, 'test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  const chat = (name, cliSessionId) => JSON.stringify({
    title: `Game - ${name}`, sessionId: `local_${name}`, cliSessionId, cwd: join(root, 'project'), isArchived: false,
    createdAt: name.length, lastActivityAt: NOW,
  })
  await put('project/.claude/chats/list.json', '{"prefix":"Game - ","main":"Main"}')
  await put('project/.claude/chats/units-id.json', JSON.stringify({ name: 'Units', task: { text: 'Archer', step: 1, steps: 3, left: 20 * MIN }, at: NOW }))
  await put('project/.claude/backlog.md', '## Art #focus\n- [ ] Say whether the archer is right (pictures in art-inbox/archer) @you\n')
  await put('project/.claude/asks/units-sheet.json', JSON.stringify({ id: 'units-sheet', from: 'Units', kind: 'verify', title: 'Check the sheet', pictures: ['art-inbox/archer/sheet.png'], at: NOW - 5 * MIN }))
  await put('project/.claude/asks/notes.txt', 'not an ask')
  await put('project/art-inbox/archer/sheet.png', 'made-up picture')
  await put('project/art-inbox/archer/readme.md', 'not a picture')
  await put('project/secret/plan.png', 'SECRET picture outside the shown folders')
  await put('app/a/b/local_main.json', chat('Main', 'main-id'))
  await put('app/a/b/local_units.json', chat('Units', 'units-id'))
  await put('app/a/c/local_evil.json', chat('Evil', '..\\outside'))
  await put('app/a/c/local_slash.json', chat('Slash', '../outside'))
  await put('app/a/c/local_broken.json', '{ half a file')
  await put('app/a/c/notes.json', chat('Notes', 'notes-id'))
  await put('transcripts/main-id.jsonl', [typed(NOW - 9 * MIN, 'Status?'), answer(NOW - 8 * MIN, 'All fine.')].join('\n'))
  await put('transcripts/units-id.jsonl', [fromChat(NOW - 30 * MIN, 'Game - Main', 'Task from Game - Main: build the archer.'), step(NOW - MIN, 'Draw the sheet')].join('\n'))
  await put('outside.jsonl', typed(NOW, 'SECRET words outside the transcripts folder'))
  const config = { ...parseConfig('{}', {}), project: join(root, 'project'), appSessions: join(root, 'app'), transcripts: join(root, 'transcripts') }
  return { root, config, put }
}

test('readSources reads a project\'s files into the shape buildState takes, and prints nothing', async t => {
  const { config } = await project(t)
  const printed = []
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  for (const name of Object.keys(real)) console[name] = (...parts) => printed.push(parts.join(' '))
  let raw
  try {
    raw = await readSources(config, async () => [{ path: 'C:/game', name: 'game', branch: 'main', ahead: 0, uncommitted: 0, lastCommitAt: NOW }], NOW)
  } finally {
    Object.assign(console, real)
  }
  assert.deepEqual(printed, [])
  assert.deepEqual(Object.keys(raw.tails).sort(), ['main-id', 'units-id'])
  assert.equal(raw.adviceText, null)
  assert.equal(raw.folders.length, 1)
  assert.equal(typeof raw.tails['units-id'].earlier, 'string')

  const state = buildState(raw, { now: NOW, config })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state]), [['Main', 'free'], ['Evil', 'unknown'], ['Slash', 'unknown'], ['Units', 'working']])
  const units = state.chats.find(chat => chat.name === 'Units')
  assert.deepEqual([units.task.text, units.task.step, units.task.startedAt, units.doingNow], ['Archer', 1, NOW - 30 * MIN, 'Draw the sheet'])
  assert.deepEqual(raw.pictureLists, { 'art-inbox/archer': ['art-inbox/archer/sheet.png'] })
  assert.deepEqual(state.forYou.map(need => [need.id, need.from, need.pictures]), [['units-sheet', 'Units', ['art-inbox/archer/sheet.png']]])
  assert.deepEqual(state.backlogForYou.map(step => [step.title, step.activity, step.pictures]), [['Say whether the archer is right (pictures in art-inbox/archer)', 'Art', ['art-inbox/archer/sheet.png']]])
})

test('readSources never follows a transcript name out of the transcripts folder', async t => {
  const { config } = await project(t)
  const raw = await readSources(config, async () => null, NOW)
  assert.ok(!JSON.stringify(raw.tails).includes('SECRET'))
  assert.ok(!JSON.stringify(raw.planLineTexts).includes('SECRET'))
  assert.ok(Object.keys(raw.tails).every(id => /^[a-z-]+$/.test(id)))
})

test('readSources gives empty sources for folders that do not exist, and survives a folders reader that fails', async () => {
  const config = { ...parseConfig('{}', {}), project: join(DATA, 'no-such-project'), appSessions: join(DATA, 'no-such-app'), transcripts: join(DATA, 'none') }
  const raw = await readSources(config, async () => { throw new Error('git is not installed') }, NOW)
  assert.deepEqual(raw, { listText: null, appChatTexts: [], planLineTexts: {}, tails: {}, backlogText: null, adviceText: null, folders: null, askTexts: [], pictureLists: {}, restartNote: null, adviceAt: null })
})

test('a picture is found only inside a folder the board may show, also when a path tries to leave it', async t => {
  const { config } = await project(t)
  const find = path => findPicture(config.project, ['art-inbox'], path)
  assert.deepEqual([(await find('art-inbox/archer/sheet.png')).type, (await find('art-inbox\\archer\\sheet.png')).size], ['image/png', 15])
  for (const path of ['secret/plan.png', 'art-inbox/../secret/plan.png', 'art-inbox/archer/readme.md', 'art-inbox/archer/missing.png', 'art-inbox/archer', '.claude/backlog.md', '']) {
    assert.equal(await find(path), null, path)
  }
  assert.deepEqual(await listPictures(config.project, ['art-inbox'], 'art-inbox/archer/'), ['art-inbox/archer/sheet.png'])
  assert.deepEqual(await listPictures(config.project, ['art-inbox'], 'art-inbox/archer/sheet.png'), ['art-inbox/archer/sheet.png'])
  for (const path of ['secret', 'art-inbox/..', 'art-inbox/nothing', '..']) assert.deepEqual(await listPictures(config.project, ['art-inbox'], path), [], path)
  assert.deepEqual(mentionedPaths('Look (pictures in art-inbox/red-mage; art-inbox/red-mage/walk.png). Not smart-inbox/x or art-inbox.', ['art-inbox']), ['art-inbox/red-mage', 'art-inbox/red-mage/walk.png'])
})

test('readHead reads at most what it is asked for, and says whether that was the whole file', async t => {
  const { root, put } = await project(t)
  await put('big.txt', 'x'.repeat(5000))
  assert.deepEqual(await readHead(join(root, 'big.txt'), 100), { text: 'x'.repeat(100), isWhole: false })
  assert.equal((await readHead(join(root, 'big.txt'), 5000)).isWhole, true)
  assert.equal(await readHead(join(root, 'missing.txt'), 100), null)
})

test('oneAtATime keeps an answer for a while and shares one read between callers', async () => {
  let reads = 0
  const read = oneAtATime(async file => { reads += 1; return `${file} ${reads}` }, 5 * MIN)
  assert.deepEqual(await Promise.all([read('a', 0), read('a', 0)]), ['a 1', 'a 1'])
  assert.equal(await read('a', 4 * MIN), 'a 1')
  assert.equal(await read('a', 6 * MIN), 'a 2')
  assert.equal(await read('b', 6 * MIN), 'b 3')
})

test('oneAtATime never runs two reads together, and goes on after one that failed', async () => {
  let running = 0
  let most = 0
  const read = oneAtATime(async file => {
    running += 1
    most = Math.max(most, running)
    await new Promise(resolve => setTimeout(resolve, 5))
    running -= 1
    if (file === 'bad') throw new Error('cannot read')
    return file
  }, 5 * MIN)
  const answers = await Promise.allSettled([read('a', 0), read('bad', 0), read('c', 0)])
  assert.deepEqual(answers.map(answer => answer.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.equal(most, 1)
})
