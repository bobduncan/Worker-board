import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { answer, fromChat, step, typed, usageResult } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { readHead } from '../src/files.mjs'
import { findPicture, listPictures, mentionedPaths } from '../src/pictures.mjs'
import { oneAtATime, readSources, readThreads } from '../src/sources.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { storeKeeper } from '../src/work/read.mjs'
import { writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

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
  // B210: a chat without the Workers mod writes its own card under its name; the mod's card goes first.
  await put('project/.claude/chats/own/main.json', JSON.stringify({ name: 'Main', task: { text: 'Plan the week', minutes: 15 } }))
  await put('project/.claude/chats/own/units.json', JSON.stringify({ name: 'Units', task: { text: 'Not this one' } }))
  // B301: the work comes from the work store; the backlog file beside it is only its view and is not read.
  await put('project/.claude/backlog.md', '## Art #focus\n- [ ] Read nothing from here (pictures in secret) @you\n')
  await writeStore(join(root, 'project', '.claude', 'work'), migrateBacklog('## Art #focus\n- [ ] Say whether the archer is right (pictures in art-inbox/archer) @you\n', { now: NOW }), undefined, { now: NOW })
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
  const config = { ...parseConfig('{}', {}), project: join(root, 'project'), appSessions: join(root, 'app'), transcripts: join(root, 'transcripts'), pictureRoots: ['art-inbox'] }
  return { root, config, put }
}

test('readSources reads a project\'s files into the shape buildState takes, and prints nothing', async t => {
  const { config } = await project(t)
  const printed = []
  const real = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  for (const name of Object.keys(real)) console[name] = (...parts) => printed.push(parts.join(' '))
  let raw
  try {
    raw = await readSources(config, async () => [{ path: 'C:/game', name: 'game', branch: 'main', ahead: 0, uncommitted: 0, lastCommitAt: NOW }], NOW, undefined, storeKeeper({ dir: join(config.project, '.claude', 'work') }))
  } finally {
    Object.assign(console, real)
  }
  assert.deepEqual(printed, [])
  assert.deepEqual(Object.keys(raw.tails).sort(), ['main-id', 'units-id'])
  assert.equal(raw.adviceText, null)
  assert.equal(raw.folders.length, 1)
  assert.equal(typeof raw.tails['units-id'].earlier, 'string')

  const state = buildState(raw, { now: NOW, config })
  assert.deepEqual(state.chats.map(chat => [chat.name, chat.state]), [['Main', 'working'], // B210: its own card names a task, as the mod's card would
     ['Evil', 'unknown'], ['Slash', 'unknown'], ['Units', 'working']])
  const units = state.chats.find(chat => chat.name === 'Units')
  assert.deepEqual([units.task.text, units.task.step, units.task.startedAt, units.doingNow], ['Archer', 1, NOW - 30 * MIN, 'Draw the sheet'])
  // B210: the main chat has no card of the mod: its own card is read, its time counted from the file's time.
  const own = JSON.parse(raw.planLineTexts['main-id'])
  assert.deepEqual([own.task.text, own.task.left, Number.isFinite(own.at), raw.planLineAt['main-id'] === own.at], ['Plan the week', 15 * MIN, true, true])
  assert.equal(JSON.parse(raw.planLineTexts['units-id']).task.text, 'Archer')
  assert.deepEqual(raw.pictureLists, { 'art-inbox/archer': ['art-inbox/archer/sheet.png'] })
  assert.deepEqual(state.forYou.map(need => [need.id, need.from, need.pictures]), [['units-sheet', 'Units', ['art-inbox/archer/sheet.png']]])
  assert.deepEqual(state.backlogForYou.map(step => [step.title, step.activity, step.pictures]), [['Say whether the archer is right', 'Art', ['art-inbox/archer/sheet.png']]])
  assert.equal('backlogText' in raw, false)
})

test('B255: readSources reads the goal map beside the backlog, where the setting goals says', async t => {
  const { config, put } = await project(t)
  assert.equal((await readSources(config, async () => null, NOW)).goalsText, null)
  await put('project/plans/goals.md', '- [ ] G1 A garden\n')
  const raw = await readSources({ ...config, goals: 'plans/goals.md' }, async () => null, NOW)
  assert.equal(raw.goalsText, '- [ ] G1 A garden\n')
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
  assert.deepEqual(raw, { listText: null, appChatTexts: [], planLineTexts: {}, planLineAt: {}, tails: {}, adviceText: null, folders: null, askTexts: [], goalsText: null, threadTexts: [], productPlanText: null, pictureLists: {}, work: undefined, usageText: null, appStartedAt: null, branches: null, adviceAt: null, productPlanAt: null })
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

// B113: the limits

test('readSources reads the app\'s usage file, and what a chat looked up further back than its tail', async t => {
  const { root, config, put } = await project(t)
  const reading = usageResult(NOW - 200 * MIN, { fiveHour: { used: 6, resetsAt: NOW + 60 * MIN } })
  await put('transcripts/main-id.jsonl', [step(NOW - 201 * MIN, 'Look the limits up'), reading, answer(NOW - 199 * MIN, 'Done.')].join('\n'))
  await put('app/plan-usage-history.json', `{"version":2,"samples":[{"t":${NOW - 3 * MIN},"org":"o","u":{"fh":86,"sd":64}}]}`)
  const raw = await readSources({ ...config, usageHistory: join(root, 'app', 'plan-usage-history.json') }, async () => [], NOW)
  assert.ok(raw.usageText.includes('"fh":86'))
  // The look back keeps the reading apart from the lines that can start or end a task.
  assert.equal(raw.tails['main-id'].usage, reading)
  assert.ok(!raw.tails['main-id'].earlier.includes('windows'))
  assert.equal(raw.tails['units-id'].usage, '')
  const { limits } = buildState(raw, { now: NOW, config })
  assert.deepEqual([limits.fiveHour.used, limits.fiveHour.resetsAt, limits.week.used], [86, NOW + 60 * MIN, 64])
  // No such file: nothing is known of the limits, and nothing fails.
  const none = await readSources({ ...config, usageHistory: join(root, 'app', 'none.json') }, async () => [], NOW)
  assert.equal(none.usageText, null)
})

test('B156: a step that names an idea\'s folder shows the pictures made, not the person\'s reference pictures in it', async t => {
  const { config } = await project(t)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  for (const file of ['art-inbox/ideas/shop/v1.png', 'art-inbox/ideas/shop/reference-1.png', 'art-inbox/archer/reference-1.png']) {
    await mkdir(join(config.project, ...dirname(file).split('/')), { recursive: true })
    await writeFile(join(config.project, ...file.split('/')), png)
  }
  assert.deepEqual(await listPictures(config.project, ['art-inbox'], 'art-inbox/ideas/shop'), ['art-inbox/ideas/shop/v1.png'])
  // Outside the ideas folder such a name is a picture like any other.
  assert.ok((await listPictures(config.project, ['art-inbox'], 'art-inbox/archer')).includes('art-inbox/archer/reference-1.png'))
})

test('B259: the brainstorms are read from their folder, newest first, the board\'s own names only', async t => {
  await mkdir(DATA, { recursive: true })
  const root = await mkdtemp(join(DATA, 'test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, '.claude', 'brainstorms')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '2026-10-14-older.md'), '# Brainstorm: Older\n')
  await new Promise(done => setTimeout(done, 30))
  await writeFile(join(folder, '2026-10-15-newer.md'), '# Brainstorm: Newer\n')
  await writeFile(join(folder, 'Notes.txt'), 'not a thread')
  const threads = await readThreads(root, '.claude/brainstorms')
  assert.deepEqual(threads.map(one => [one.path, one.text]), [['.claude/brainstorms/2026-10-15-newer.md', '# Brainstorm: Newer\n'], ['.claude/brainstorms/2026-10-14-older.md', '# Brainstorm: Older\n']])
  assert.deepEqual(await readThreads(root, '.claude/none'), [])
})
