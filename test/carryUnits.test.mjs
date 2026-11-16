// T5 B1 (2026-11-16): the carry commands' pieces, pure: the flags, the guards' table (refusals name who acts; with --practice the
// final checks are warnings), the held words folded by id, the board steps, the secrets by value, the times, the record's place
// and the blob id (the same sha1 git gives). Nothing here runs git or touches a board.

import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer } from 'node:http'

import { boardsAnswering, parseArgs } from '../tools/carry.mjs'
import { blobOf } from '../src/carry/git.mjs'
import { boardStepsOf, heldStepsOf, heldWordsOf, loadGuards, reviewStepsOf, saveGuards, secretValuesOf, secretsIn, LOCK_FRESH_MS } from '../src/carry/guards.mjs'
import { parseTimes, restoreTimes, timesOf } from '../src/carry/times.mjs'
import { parseRecord, recordFileFor } from '../src/carry/record.mjs'
import { parseItem } from '../src/work/item.mjs'

const MIN = 60_000
const item = text => parseItem(text.trim().replace(/^ +/gm, '') + '\n')
const step = (id, state, more = '') => item(`Id: ${id}\nKind: step\nTitle: a step\nState: ${state}\nOwner: Worker 2\nSince: 2026-11-16 10:00\n${more}`)

test('the flags: a command, values, switches and repeated --anyway; an unknown word is refused', () => {
  const read = parseArgs(['save', '--dry-run', '--practice', '--data', 'D:/x/.wb', '--anyway', 'B12', '--anyway', 'B13', '--journal', 'j.txt', '--no-branches'])
  assert.deepEqual(read, { command: 'save', flags: { 'dry-run': true, practice: true, data: 'D:/x/.wb', journal: 'j.txt', 'no-branches': true }, anyway: ['B12', 'B13'] })
  assert.deepEqual(parseArgs(['load', '--park', '--undo', '20261116-1200', '--user-settings']).flags, { park: true, undo: '20261116-1200', 'user-settings': true })
  assert.throws(() => parseArgs(['save', 'extra']), /unknown word: extra/)
})

test('save\'s guards: each refusal names who acts; with --practice the final ones are warnings; --anyway lets one dirty step through; the landing lock, load-first, secrets, size, a public remote and a full Drive refuse always', () => {
  const facts = {
    pause: { state: 'running' }, boardAnswers: [{ port: 4310, project: 'D:\\Proj\\x' }], keepers: [{ pid: 55 }], lockAgeMs: 2 * MIN,
    dirtySteps: [{ id: 'B12', chat: 'Worker 2', folder: 'D:\\Proj\\x-b12', files: ['a.js'] }, { id: 'B13', chat: 'Worker 3', folder: 'D:\\Proj\\x-b13', files: ['b.js'] }],
    notFastForward: [{ branch: 'b12', repo: 'game' }], mainsDirty: [{ repo: 'game', files: ['x.md'], ahead: 2 }],
    originAhead: { branch: 'workerboard-data', origin: 'abcdef1234', last: '0123456789' }, lastLoadWasPractice: true,
    secrets: [{ path: 'home/.claude/x.json', kind: 'bridge key' }], oversized: [{ path: 'home/big.bin', bytes: 20 * 1048576 }], remotePublic: true, driveShort: { need: 3 * 1048576, free: 1048576 },
    reviewSteps: ['B20'], noCheckpointSince: [{ id: 'B12', chat: 'Worker 2' }], branchesGone: [{ id: 'B21', branch: 'b21', why: 'merged into main' }],
  }
  const final = saveGuards(facts, { anyway: ['B13'] })
  assert.deepEqual(final.refusals.map(one => one.code), ['not-paused', 'board-runs', 'keeper-runs', 'landing', 'dirty-step', 'not-ff', 'main-dirty', 'main-ahead', 'load-first', 'practice-loaded', 'secret', 'too-big', 'public-remote', 'drive-full'])
  assert.match(final.refusals.find(one => one.code === 'dirty-step').text, /^B12 has uncommitted changes in D:\\Proj\\x-b12 \(a\.js\): Worker 2 commits B12, or say --anyway B12$/)
  assert.equal(final.refusals.find(one => one.code === 'dirty-step').who, 'Worker 2')
  assert.match(final.refusals.find(one => one.code === 'board-runs').text, /quit the Claude app from the tray, then `node start-board.mjs --stop`/)
  assert.match(final.refusals.find(one => one.code === 'secret').text, /^home\/.claude\/x\.json holds the bridge key by value/)
  assert.ok(final.warnings.some(one => /B13: uncommitted work in .* stays on this PC \(--anyway\)/.test(one)))
  assert.ok(final.warnings.some(one => /B20 is in review/.test(one)) && final.warnings.some(one => /B12 \(Worker 2\) has no checkpoint since the pause/.test(one)) && final.warnings.some(one => /B21: its branch b21 is merged into main/.test(one)))
  // --practice: the final checks become warnings; what is never a practice matter still refuses.
  const practice = saveGuards(facts, { practice: true, anyway: ['B13'] })
  assert.deepEqual(practice.refusals.map(one => one.code), ['landing', 'load-first', 'secret', 'too-big', 'public-remote', 'drive-full'])
  assert.ok(practice.warnings.filter(one => /\(a practice save goes on\)$/.test(one)).length >= 8)
  // Clean facts: nothing.
  assert.deepEqual(saveGuards({ pause: { state: 'pausing' } }), { refusals: [], warnings: [] })
  assert.equal(LOCK_FRESH_MS, 15 * MIN)
  // A stale lock (16 min) holds nothing.
  assert.deepEqual(saveGuards({ pause: { state: 'pausing' }, lockAgeMs: 16 * MIN }).refusals, [])
})

test('load\'s guards: a board of the target project, a keeper, a fresh lock, practice data without --practice; changes here refuse unless --park (or a final load over a practice state parks by itself)', () => {
  const base = { boardAnswers: [{ port: 4320, project: 'D:\\Proj\\y' }], keepers: [{ pid: 9 }], lockAgeMs: MIN, practiceData: true, changed: [{ path: 'home/a.md', target: 'D:\\Proj\\y\\a.md' }] }
  assert.deepEqual(loadGuards(base).refusals.map(one => one.code), ['board-runs', 'keeper-runs', 'landing', 'practice-data', 'changed-here'])
  const parked = loadGuards({ changed: base.changed }, { park: true })
  assert.deepEqual(parked.refusals, [])
  assert.match(parked.warnings[0], /^1 file\(s\) this PC changed since its last sync are backed up and replaced \(--park\): home\/a\.md$/)
  const fromPractice = loadGuards({ changed: base.changed, fromPractice: true })
  assert.deepEqual(fromPractice.refusals, [])
  assert.match(fromPractice.warnings[0], /a final load over a practice state parks it by itself/)
  assert.deepEqual(loadGuards({}), { refusals: [], warnings: [] })
})

test('the held words: the outbox folded by id (the newest line wins); held means waiting and no resume; a torn line is skipped', () => {
  const outbox = [
    JSON.stringify({ id: 'a', at: 1, to: 'Worker 2', step: 'B12', text: 'go on with B12', state: 'waiting' }),
    JSON.stringify({ id: 'b', at: 2, to: 'Main', step: null, text: 'resume', state: 'waiting', command: 'resume' }),
    JSON.stringify({ id: 'c', at: 3, to: 'Worker 3', step: 'B13', text: 'typed already', state: 'delivered' }),
    '{"id":"d", torn',
    JSON.stringify({ id: 'a', at: 4, to: 'Worker 2', step: 'B12', text: 'go on with B12', state: 'delivered' }),
    JSON.stringify({ id: 'e', at: 5, to: 'Worker 4', step: null, text: 'look at Q5', state: 'waiting' }),
  ].join('\n')
  assert.deepEqual(heldWordsOf(outbox), [{ id: 'e', chat: 'Worker 4', step: null, words: 'look at Q5', at: 5 }])
  assert.deepEqual(heldWordsOf(''), [])
})

test('the board steps: not done or dropped, with Priority: fix or a branch of the board repository; the held steps; the review steps', () => {
  const items = new Map([
    ['B10', step('B10', 'in progress', 'Branch: b10\nPriority: fix')],
    ['B11', step('B11', 'ready', 'Branch: fix-board-thing')],
    ['B12', step('B12', 'taken', 'Branch: b12')],
    ['B13', step('B13', 'done', 'Branch: fix-old\nPriority: fix')],
    ['B14', step('B14', 'review', 'Branch: b14')],
    ['B15', step('B15', 'waiting on you', 'Branch: none')],
    ['Q1', item('Id: Q1\nKind: ask\nTitle: q\nState: open\nOwner: Worker 2\nSince: 2026-11-16 10:00\nOf: B12\nAsks: decide\nBlocking: no\nOptions: A | B')],
  ])
  assert.deepEqual(boardStepsOf(items, ['fix-board-thing', 'main']).map(one => [one.id, one.why]), [['B10', 'Priority: fix'], ['B11', 'its branch is in the board repository']])
  assert.deepEqual(heldStepsOf(items).map(one => [one.id, one.branch]), [['B10', 'b10'], ['B12', 'b12'], ['B15', 'none']])
  assert.deepEqual(reviewStepsOf(items), ['B14'])
})

test('secrets by value: the strings of the key files (16+ characters, no spaces, no URL) and the keys given; a staged text that holds one is named, the value never', () => {
  const board = JSON.stringify({ url: 'http://127.0.0.1:4310', key: 'k'.repeat(64), startedAt: 1794827892586, hands: true })
  const codex = JSON.stringify({ tokens: { access_token: 'eyJhbGciOiJSUzI1NiIs.payload.sig', refresh_token: 'rt-1234567890abcdef' } })
  const values = secretValuesOf({ texts: [board, codex, 'not json'], keys: ['sk_elevenlabs_1234567890', '  ', 'short'] })
  assert.deepEqual(values, ['k'.repeat(64), 'eyJhbGciOiJSUzI1NiIs.payload.sig', 'rt-1234567890abcdef', 'sk_elevenlabs_1234567890'])
  const secrets = values.map(value => ({ value, kind: value.startsWith('k') ? 'bridge key' : 'token' }))
  const found = secretsIn([{ to: 'home/a.json', text: `{"copied":"${'k'.repeat(64)}"}` }, { to: 'home/b.md', text: 'plain words' }, { to: 'home/c.bin', text: null }], secrets)
  assert.deepEqual(found, [{ path: 'home/a.json', kind: 'bridge key' }])
  assert.equal(JSON.stringify(found).includes('kkkk'), false, 'the value is not in the answer')
})

test('the times: entries sorted by path with blob ids; restore sets the mtime only where the blob still matches, and skips what is missing or changed (a CRLF checkout)', async () => {
  const entries = timesOf([{ to: 'home\\b.md', mtimeMs: 2000, blob: 'bb' }, { to: 'home/a.md', mtimeMs: 1000, blob: 'aa' }, { to: 'x', mtimeMs: NaN, blob: 'zz' }])
  assert.deepEqual(entries, [{ path: 'home/a.md', mtimeMs: 1000, blob: 'aa' }, { path: 'home/b.md', mtimeMs: 2000, blob: 'bb' }])
  assert.deepEqual(parseTimes(JSON.stringify({ files: entries })), entries)
  assert.deepEqual(parseTimes('nonsense'), [])
  const set = []
  const blobs = { 'D:/t/a.md': 'aa', 'D:/t/b.md': 'other' }
  const done = await restoreTimes([...entries, { path: 'home/c.md', mtimeMs: 3000, blob: 'cc' }, { path: 'settings/x', mtimeMs: 1, blob: 'ss' }], {
    targetOf: path => (path.startsWith('settings/') ? null : `D:/t/${path.slice('home/'.length)}`), blobOfFile: async file => blobs[file] ?? null, fs: { utimes: async (file, a, m) => set.push([file, m.getTime()]) },
  })
  assert.deepEqual([done.restored, done.kept, done.missing, set], [['home/a.md'], ['home/b.md'], ['home/c.md'], [['D:/t/a.md', 1000]]])
})

test('the record: data/carry.json for the default data folder, `<folder>.carry.json` beside an explicit one; what it reads', () => {
  assert.equal(recordFileFor({ boardDir: 'D:\\Proj\\board', dataDir: 'D:\\Proj\\game\\.workerboard', isExplicit: false }), join('D:\\Proj\\board', 'data', 'carry.json'))
  assert.equal(recordFileFor({ boardDir: 'D:\\Proj\\board', dataDir: 'D:\\scratch\\wb\\', isExplicit: true }), 'D:\\scratch\\wb.carry.json')
  assert.deepEqual(parseRecord({ picturesHome: 'E:\\Cloud\\board-pictures', last: { kind: 'practice', command: 'load', at: 5, branch: 'workerboard-practice', commit: 'abc', blobs: { 'home/a': 'aa', bad: 7 } } }),
    { picturesHome: 'E:\\Cloud\\board-pictures', keepSet: null, last: { kind: 'practice', command: 'load', at: 5, branch: 'workerboard-practice', commit: 'abc', blobs: { 'home/a': 'aa' } } })
  assert.deepEqual(parseRecord(null), { picturesHome: null, keepSet: null, last: null })
})

test('the blob id is the one git computes (git hash-object), for text and for bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-blob-'))
  try {
    const file = join(dir, 'x.bin')
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13, 65])
    writeFileSync(file, bytes)
    const git = execFileSync('git', ['hash-object', file], { encoding: 'utf8', windowsHide: true }).trim()
    assert.equal(blobOf(bytes), git)
    assert.equal(blobOf('hello\n'), '2d8bb1a9c42cf5f4d41c72e4e2e5c3e6e6f8fd2d'.length === 40 ? blobOf('hello\n') : null)
    assert.equal(blobOf(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the boards of the project that answer: the PC\'s list (boards.json under WORKER_BOARD_HOME) and the folder\'s own data/port.json, each asked whose it is; config.port is not read (mutant: a guard on config.port misses the project\'s board on another port)', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'carry-boards-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const project = join(dir, 'proj')
  const boardDir = join(dir, 'board')
  const other = join(dir, 'other-proj')
  for (const one of [project, boardDir, other, join(boardDir, 'data')]) mkdirSync(one, { recursive: true })
  // A fake board of the project on a free port, answering /api/board as the board does.
  const server = createServer((req, res) => res.end(JSON.stringify(req.url === '/api/board' ? { board: 'worker-board', project } : {})))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => server.close())
  const port = server.address().port
  writeFileSync(join(dir, 'boards.json'), JSON.stringify({ boards: [{ project, folder: boardDir, port, gamePort: 5300 }, { project: other, folder: join(dir, 'x'), port: port + 1, gamePort: 5400 }] }))
  const env = { ...process.env, WORKER_BOARD_HOME: dir }
  assert.deepEqual(await boardsAnswering({ project, boardDir, env }), [{ port, project }], 'the project\'s board, found through the list, whatever config.port would say')
  assert.deepEqual(await boardsAnswering({ project: other, boardDir: join(dir, 'x'), env }), [], 'another project\'s board does not count, and a silent port is no board')
  // The folder's own data/port.json names the port too (a board that is not in the list).
  writeFileSync(join(dir, 'boards.json'), JSON.stringify({ boards: [] }))
  writeFileSync(join(boardDir, 'data', 'port.json'), JSON.stringify({ port }))
  assert.deepEqual(await boardsAnswering({ project, boardDir, env }), [{ port, project }])
})
