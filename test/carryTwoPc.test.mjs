// T5 B1 (2026-11-16): the two-PC test of the carry commands with real git: temp folders A and B, a local bare remote (the game repo's
// origin), a temp Drive folder whose copies get whole-millisecond times, and side B with core.autocrlf=true in its own global config.
// Save on A, load on B, compare blob ids, change a file on B, save on B, load on A. B2 (the set) and B3 (the pictures) are fakes of
// their contracts here; the board checks are fakes too. Git runs with GIT_CONFIG_NOSYSTEM and a temp global config, HOME and
// USERPROFILE in the temp folder; nothing reaches a real remote, the live store or the real Drive.

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir, utimes, copyFile, access } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, dirname, basename } from 'node:path'

import { blobOf, gitRunner, line, lines } from '../src/carry/git.mjs'
import { save, DATA_BRANCH, PRACTICE_BRANCH } from '../src/carry/save.mjs'
import { load } from '../src/carry/load.mjs'
import { recordFileFor, readRecord } from '../src/carry/record.mjs'
import * as realSet from '../src/carry/set.mjs'
import * as realPictures from '../src/carry/pictures.mjs'
import { cp } from 'node:fs/promises'

const fs = { readFile, writeFile, mkdir, rm, stat, readdir, utimes, copyFile, access }
const slashes = path => String(path).replace(/\\/g, '/')
const KEY = 'k'.repeat(64)
const LONG = { timeout: 240_000 }

/** One PC: a home for git's global config, the clones and folders; `autocrlf` for its global config. */
async function pc(root, name, { autocrlf = false } = {}) {
  const home = join(root, name, 'home')
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'gitconfig'), `[user]\n\tname = Tester ${name}\n\temail = ${name}@example.test\n[core]\n\tautocrlf = ${autocrlf}\n[init]\n\tdefaultBranch = main\n`)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), HOME: home, USERPROFILE: home }
  const git = gitRunner({ env })
  const ok = async (cwd, args) => { const done = await git(cwd, args); assert.equal(done.code, 0, `git ${args.join(' ')} in ${cwd}: ${done.err}`); return done }
  const project = join(root, name, 'project')
  const gameRepo = join(project, 'game')
  const boardDir = join(project, 'board')
  const memoryDir = join(home, '.claude', 'projects', 'the-project', 'memory')
  const userSettingsFile = join(home, '.claude', 'settings.json')
  for (const dir of [project, memoryDir, join(home, '.claude')]) await mkdir(dir, { recursive: true })
  return { name, home, env, git, ok, project, gameRepo, boardDir, memoryDir, userSettingsFile }
}

/** The game repo's origin: a bare repository with main. */
async function makeRemote(root, git) {
  const remote = join(root, 'remote.git')
  const seed = join(root, 'seed')
  await mkdir(seed, { recursive: true })
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']]) assert.equal((await git(seed, args)).code, 0)
  await writeFile(join(seed, 'README.md'), 'the game\n')
  await mkdir(join(seed, 'docs'))
  await writeFile(join(seed, 'docs', 'game-plan.md'), 'plan v1\n')
  for (const args of [['add', '-A'], ['commit', '-q', '-m', 'first'], ['init', '-q', '--bare', remote], ['remote', 'add', 'origin', remote], ['push', '-q', 'origin', 'main']]) {
    const done = await git(seed, args)
    assert.equal(done.code, 0, `${args.join(' ')}: ${done.err}`)
  }
  return remote
}

/** Side A's world: the game clone with a step branch in a worktree, the store, the board repo, memory, pictures. */
async function fillA(a, remote) {
  await a.ok(a.project, ['clone', '-q', remote, a.gameRepo])
  // The step branch b1149 (B1149 given back, unowned, 2 commits not on origin/main, local only) in its worktree.
  const wt = join(a.project, 'game-b1149')
  await a.ok(a.gameRepo, ['worktree', 'add', '-q', '-b', 'b1149', wt])
  await writeFile(join(wt, 'knight.txt'), 'sheet 1\n')
  await a.ok(wt, ['add', '-A'])
  await a.ok(wt, ['commit', '-q', '-m', 'B1149 sheet'])
  await writeFile(join(wt, 'knight.txt'), 'sheet 2\n')
  await a.ok(wt, ['commit', '-q', '-am', 'B1149 sheet 2'])
  // A merged branch (no commit beyond origin/main) for a step in review: only a warning.
  await a.ok(a.gameRepo, ['branch', 'b20'])
  // The board repo: main and a fix branch (a board step's).
  await mkdir(join(a.boardDir, 'data'), { recursive: true })
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']]) await a.ok(a.boardDir, args)
  await writeFile(join(a.boardDir, 'server.mjs'), '// the board\n')
  // As the real board repo: its data and the PC's config.json are not tracked.
  await writeFile(join(a.boardDir, '.gitignore'), 'data/\nconfig.json\nnode_modules/\n')
  await writeFile(join(a.boardDir, 'config.json'), JSON.stringify({ project: a.project, gameRepo: a.gameRepo, port: 4399 }))
  await a.ok(a.boardDir, ['add', '-A'])
  await a.ok(a.boardDir, ['commit', '-q', '-m', 'board'])
  await a.ok(a.boardDir, ['branch', 'fixb'])
  // The board repo's own origin (public, code only): the board step's branch goes there.
  const boardRemote = join(dirname(a.project), 'board.git')
  await a.ok(a.project, ['init', '-q', '--bare', boardRemote])
  await a.ok(a.boardDir, ['remote', 'add', 'origin', boardRemote])
  await a.ok(a.boardDir, ['push', '-q', 'origin', 'main'])
  await writeFile(join(a.boardDir, 'data', 'finished.json'), '{"B1":1}\n')
  await writeFile(join(a.boardDir, 'data', 'outbox.jsonl'), [
    JSON.stringify({ id: 'w1', at: 1, to: 'Worker 4', step: 'B40', text: 'look at Q5 before you go on', state: 'waiting' }),
    JSON.stringify({ id: 'w2', at: 2, to: 'Main', step: null, text: 'resume', state: 'waiting', command: 'resume' }),
  ].join('\n') + '\n')
  // The store.
  const work = join(a.project, '.claude', 'work')
  await mkdir(work, { recursive: true })
  const item = (id, lines) => writeFile(join(work, `${id}.md`), `Id: ${id}\nKind: step\n${lines}\n\n## History\n- 2026-11-16 10:00 Worker 2: queued → taken\n`)
  await item('B1149', 'Title: Redraw the Red Mage\nState: ready\nOwner: -\nSince: 2026-11-16 10:52\nBranch: b1149\nCheckpoint: e14ee5f6 · atlas committed · 2026-11-16 10:10')
  await item('B20', 'Title: In review\nState: review\nOwner: Worker 3\nSince: 2026-11-16 09:00\nBranch: b20')
  await item('B30', 'Title: No branch\nState: taken\nOwner: Worker 5\nSince: 2026-11-16 11:00\nBranch: none')
  await item('B40', 'Title: A board fix\nState: in progress\nOwner: Worker 4\nSince: 2026-11-16 11:30\nBranch: fixb\nPriority: fix')
  await writeFile(join(work, 'pause.json'), JSON.stringify({ state: 'pausing', since: 1794820000000, by: 'you' }))
  await mkdir(join(a.project, '.claude', 'goals'), { recursive: true })
  await writeFile(join(a.project, '.claude', 'goals', 'focus.json'), JSON.stringify({ focus: 'G95' }))
  await utimes(join(a.project, '.claude', 'goals', 'focus.json'), new Date(1700000000000), new Date(1700000000000))
  // Memory, user settings, pictures, the keep set.
  await writeFile(join(a.memoryDir, 'notes.md'), '# notes\nkeep this\n')
  await writeFile(a.userSettingsFile, JSON.stringify({ permissions: { allow: ['Bash(git status)', 'Bash(npm test)'] }, other: 1 }))
  await mkdir(join(a.project, 'pictures'), { recursive: true })
  await writeFile(join(a.project, 'pictures', 'knight.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]))
  await utimes(join(a.project, 'pictures', 'knight.png'), new Date(1700000001234.5), new Date(1700000001234.5))
  const keepSet = join(a.project, 'keep-set.json')
  await writeFile(keepSet, JSON.stringify({ made: 1700000000000, items: [{ path: 'pictures/knight.png' }] }))
  return { wt, keepSet }
}

/** B2's contract, faked: the project's .claude files, the board's data/finished.json and the memory files travel. */
const setFake = {
  async carrySet({ project, boardDir, memoryDir, fs }) {
    const files = []
    const walk = async (dir, to, kind) => {
      for (const name of await fs.readdir(dir).catch(() => [])) {
        const path = join(dir, name)
        const info = await fs.stat(path)
        if (info.isDirectory()) await walk(path, `${to}/${name}`, kind)
        else files.push({ from: path, to: `${to}/${name}`, kind, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
    await walk(join(project, '.claude'), 'home/.claude', 'store')
    const finished = join(boardDir, 'data', 'finished.json')
    const info = await fs.stat(finished).catch(() => null)
    if (info) files.push({ from: finished, to: 'board/data/finished.json', kind: 'board', size: info.size, mtimeMs: info.mtimeMs })
    await walk(memoryDir, 'memory', 'memory')
    return { files, skipped: [{ path: '.claude/board.json', why: 'the bridge key never travels' }] }
  },
  targetOf(to, { project, boardDir, memoryDir }) {
    if (to.startsWith('home/')) return join(project, ...to.slice('home/'.length).split('/'))
    if (to.startsWith('board/')) return join(boardDir, ...to.slice('board/'.length).split('/'))
    if (to.startsWith('memory/')) return join(memoryDir, ...to.slice('memory/'.length).split('/'))
    return null
  },
  carriedSettings: (config, { project }) => ({ port: config.port ?? 4310, projectName: basename(project) }),
  settingsFromCarry: (carried, { project, boardDir, current }) => ({ ...(current ?? {}), project, gameRepo: join(project, 'game'), port: carried.port, carried: true }),
  carriedUserSettings: user => ({ allow: user?.permissions?.allow ?? [] }),
  mergeUserSettings: (theirs, carried) => {
    const have = new Set(theirs?.permissions?.allow ?? [])
    const added = (carried.allow ?? []).filter(one => !have.has(one))
    return { merged: { ...theirs, permissions: { ...(theirs?.permissions ?? {}), allow: [...have, ...added] } }, added }
  },
}

/** B3's contract, faked: the keep set's files to and from the Drive folder, whole-millisecond times, never deleting. */
const picturesFake = {
  // As B3: the node:fs module comes in (fs.promises for the reads).
  async pictureList({ keepSetFile, project, fs }) {
    const set = keepSetFile ? JSON.parse(await fs.promises.readFile(keepSetFile, 'utf8')) : { items: [] }
    const out = []
    for (const path of (set.items ?? []).map(one => one.path)) {
      const info = await fs.promises.stat(join(project, ...path.split('/'))).catch(() => null)
      if (info) out.push({ path, size: info.size, mtimeMs: info.mtimeMs })
    }
    return out
  },
  async toDrive({ list, project, folder, dryRun, fs }) {
    const record = []
    let copied = 0
    for (const one of list) {
      const target = join(folder, ...one.path.split('/'))
      const ms = Math.floor(one.mtimeMs)
      if (!dryRun) {
        await fs.promises.mkdir(dirname(target), { recursive: true })
        await fs.promises.writeFile(target, await fs.promises.readFile(join(project, ...one.path.split('/'))))
        await fs.promises.utimes(target, new Date(ms), new Date(ms))
      }
      copied += 1
      record.push({ path: one.path, size: one.size, mtimeMs: ms })
    }
    return { copied, same: 0, missing: [], bytes: list.reduce((sum, one) => sum + one.size, 0), free: 1e12, record }
  },
  async fromDrive({ record, project, folder, dryRun, fs }) {
    let copied = 0
    const kept = 0
    const missing = []
    const copiedPaths = []
    for (const one of record) {
      const source = join(folder, ...one.path.split('/'))
      const target = join(project, ...one.path.split('/'))
      const bytes = await fs.promises.readFile(source).catch(() => null)
      if (bytes === null) { missing.push(one.path); continue }
      if (!dryRun) {
        await fs.promises.mkdir(dirname(target), { recursive: true })
        await fs.promises.writeFile(target, bytes)
        await fs.promises.utimes(target, new Date(one.mtimeMs), new Date(one.mtimeMs))
        copiedPaths.push(target)
      }
      copied += 1
    }
    return { copied, kept, missing, copiedPaths }
  },
}

/** The roots and deps of one side, with the board checks as the test sets them (`state`). */
function sideOf(side, { remote, dataDir, picturesFolder, keepSetFile = null, state }) {
  const config = JSON.parse(readFileSync(join(side.boardDir, 'config.json'), 'utf8'))
  const roots = { boardDir: side.boardDir, project: side.project, config: { ...config, work: '.claude/work', pictureRoots: ['pictures'], gamePlan: 'game/docs/game-plan.md', productPlan: 'docs/none.md' }, gameRepo: side.gameRepo, workDir: join(side.project, '.claude', 'work'), dataDir, isExplicitData: false, remote, picturesFolder, keepSetFile, memoryDir: side.memoryDir, userSettingsFile: side.userSettingsFile }
  const logs = []
  const journal = []
  const deps = {
    git: side.git, set: setFake, pictures: picturesFake, fs, recordFile: recordFileFor({ boardDir: side.boardDir, dataDir, isExplicit: false }),
    boardAnswers: async () => state.boards ?? [], keepers: async () => state.keepers ?? [], lockAgeMs: async () => state.lockAgeMs ?? null,
    secrets: async () => [{ kind: 'bridge key', value: KEY }], driveFree: async () => state.free ?? 1e12, lacks: async () => ['Codex (no login in its home)'],
  }
  const options = { log: text => logs.push(text), journal: path => journal.push(path), now: state.now ?? Date.now() }
  return { roots, deps, options, logs, journal }
}

test('two PCs: save on A (the data branch, the step branch, the pictures, the record), load on B (same blobs, times, pause carried), change on B, save on B, load on A; the guards and backups along the way', LONG, async t => {
  const root = await mkdtemp(join(tmpdir(), 'carry-two-pc-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const a = await pc(root, 'A')
  const b = await pc(root, 'B', { autocrlf: true })
  const remote = await makeRemote(root, a.git)
  const { wt, keepSet } = await fillA(a, remote)
  const drive = join(root, 'drive', 'board-pictures')
  await mkdir(drive, { recursive: true })
  const state = { now: 1794830000000 }
  const dataA = join(a.gameRepo, '.workerboard')
  const A = () => sideOf(a, { remote, dataDir: dataA, picturesFolder: drive, keepSetFile: keepSet, state })

  // A dry run writes and pushes nothing.
  let s = A()
  let done = await save(s.roots, { ...s.options, dryRun: true }, s.deps)
  assert.equal(done.ok, true, JSON.stringify(done.refusals))
  assert.equal(existsSync(join(dataA, 'saved.json')), false, 'a dry run writes no saved.json')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, 'b1149'])), '', 'a dry run pushes no branch')
  assert.ok(s.logs.some(one => /^Would push b1149 \(game\): 2 commit\(s\) not on origin\/main, not on origin, step B1149$/.test(one)), s.logs.join('\n'))

  // The board answers: refused, naming the way out. A dirty step worktree: refused, naming the chat; --anyway lets it through.
  state.boards = [{ port: 4399, project: a.project }]
  s = A()
  done = await save(s.roots, s.options, s.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['board-runs']])
  state.boards = []
  await writeFile(join(a.project, '.claude', 'work', 'B1149.md'), (await readFile(join(a.project, '.claude', 'work', 'B1149.md'), 'utf8')).replace('State: ready\nOwner: -', 'State: in progress\nOwner: Worker 2'))
  await writeFile(join(wt, 'knight.txt'), 'uncommitted\n')
  s = A()
  done = await save(s.roots, s.options, s.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code), done.refusals[0]?.who], [false, ['dirty-step'], 'Worker 2'])
  s = A()
  done = await save(s.roots, { ...s.options, anyway: ['B1149'], dryRun: true }, s.deps)
  assert.equal(done.ok, true, JSON.stringify(done.refusals))
  await a.ok(wt, ['checkout', '--', 'knight.txt'])
  await writeFile(join(a.project, '.claude', 'work', 'B1149.md'), (await readFile(join(a.project, '.claude', 'work', 'B1149.md'), 'utf8')).replace('State: in progress\nOwner: Worker 2', 'State: ready\nOwner: -'))

  // A planted bridge key refuses, and the value is never printed.
  await writeFile(join(a.project, '.claude', 'goals', 'leak.json'), JSON.stringify({ key: KEY }))
  s = A()
  done = await save(s.roots, s.options, s.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['secret']])
  assert.equal(s.logs.join('\n').includes(KEY), false)
  await rm(join(a.project, '.claude', 'goals', 'leak.json'))

  // The real save on A.
  s = A()
  done = await save(s.roots, s.options, s.deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${s.logs.join('\n')}`)
  assert.ok(done.commit, 'the data branch has a commit')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, DATA_BRANCH])).length > 0, true, 'the data branch is on the remote')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, 'b1149'])).slice(0, 40), line(await a.git(wt, ['rev-parse', 'HEAD'])), 'the given-back step\'s branch is pushed at its commit')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, 'b20'])), '', 'the review step\'s merged branch has nothing to push')
  assert.equal(line(await a.git(a.gameRepo, ['log', '-1', '--format=%s', DATA_BRANCH]).catch(() => ({ out: '' }))), '', 'no data branch in the game checkout itself')
  const savedA = JSON.parse(await readFile(join(dataA, 'saved.json'), 'utf8'))
  assert.deepEqual([savedA.kind, savedA.branch, savedA.boardSteps.map(one => one.id), savedA.branchesPushed.map(one => one.branch), savedA.heldWords], ['final', DATA_BRANCH, ['B40'], ['b1149', 'fixb'], 1])
  assert.equal(line(await a.git(a.boardDir, ['ls-remote', '--heads', 'origin', 'fixb'])).slice(0, 40), line(await a.git(a.boardDir, ['rev-parse', 'fixb'])), 'the board step\'s branch went to the board origin')
  assert.equal(line(await a.git(dataA, ['log', '-1', '--format=%s'])), 'Board data: save', 'the fixed message, no id in it')
  assert.deepEqual(JSON.parse(await readFile(join(dataA, 'held-words.json'), 'utf8')).map(one => [one.chat, one.step]), [['Worker 4', 'B40']])
  assert.equal(await readFile(join(dataA, '.gitattributes'), 'utf8'), '* -text\n')
  const times = JSON.parse(await readFile(join(dataA, 'times.json'), 'utf8')).files
  assert.ok(times.some(one => one.path === 'home/.claude/goals/focus.json' && one.mtimeMs === 1700000000000) && times.some(one => one.path === 'project/game/docs/game-plan.md'), JSON.stringify(times))
  assert.deepEqual(JSON.parse(await readFile(join(dataA, 'pictures.json'), 'utf8')), [{ path: 'pictures/knight.png', size: 7, mtimeMs: 1700000001234 }])
  assert.equal((await stat(join(drive, 'pictures', 'knight.png'))).mtimeMs, 1700000001234, 'the Drive copy has a whole-millisecond time')
  assert.ok(s.logs.some(one => /B20 is in review/.test(one)), 'a review step warns')
  assert.ok(s.logs.some(one => /^Warning: B30 \(Worker 5\) has no checkpoint since the pause began/.test(one)) && !s.logs.some(one => /push.*B30|B30.*push/.test(one)), 'a held step with Branch none warns about its checkpoint and is pushed nowhere')
  assert.ok(s.logs.some(one => /^Held word for Worker 4 \(B40\), retype it there: look at Q5/.test(one)))
  assert.ok(s.logs.some(one => /^Board step B40 \(in progress, fixb\): Priority: fix; it cannot land on the other PC$/.test(one)))
  const recordA = await readRecord(s.deps.recordFile, fs)
  assert.deepEqual([recordA.last.kind, recordA.last.command, recordA.last.branch, recordA.picturesHome, recordA.keepSet], ['final', 'save', DATA_BRANCH, drive, keepSet])
  assert.equal(existsSync(join(a.project, '.claude', 'work', 'B20.md')), true, 'nothing outside the data folder was deleted')
  assert.ok(s.journal.every(path => path.startsWith(dataA) || path.startsWith(drive) || path === s.deps.recordFile), `the journal names only the data folder, the Drive and the record: ${s.journal.filter(path => !(path.startsWith(dataA) || path.startsWith(drive) || path === s.deps.recordFile)).join(', ')}`)

  // Origin's step branch moved on (another PC pushed): the next save refuses the push.
  const other = join(root, 'other')
  await a.ok(root, ['clone', '-q', '--branch', 'b1149', remote, other])
  await writeFile(join(other, 'knight.txt'), 'sheet 3 from elsewhere\n')
  await a.ok(other, ['commit', '-q', '-am', 'elsewhere'])
  await a.ok(other, ['push', '-q', 'origin', 'b1149'])
  await a.ok(a.gameRepo, ['fetch', '-q', 'origin'])
  await writeFile(join(wt, 'knight.txt'), 'sheet 3 here\n')
  await a.ok(wt, ['commit', '-q', '-am', 'B1149 here'])
  s = A()
  done = await save(s.roots, s.options, s.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['not-ff']])
  await a.ok(wt, ['reset', '-q', '--hard', 'origin/b1149'])

  // Side B: a fresh game clone (autocrlf on), an empty project, a board repo with only a config: the load.
  await b.ok(b.project, ['clone', '-q', remote, b.gameRepo])
  await mkdir(join(b.boardDir, 'data'), { recursive: true })
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']]) await b.ok(b.boardDir, args)
  await writeFile(join(b.boardDir, '.gitignore'), 'data/\nconfig.json\nnode_modules/\n')
  await writeFile(join(b.boardDir, 'config.json'), JSON.stringify({ project: b.project, gameRepo: b.gameRepo, port: 4398 }))
  await b.ok(b.boardDir, ['add', '-A'])
  await b.ok(b.boardDir, ['commit', '-q', '-m', 'board B'])
  await writeFile(b.userSettingsFile, JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }))
  const dataB = join(b.gameRepo, '.workerboard')
  const stateB = { now: 1794831000000 }
  const B = () => sideOf(b, { remote, dataDir: dataB, picturesFolder: drive, state: stateB })
  // The target's board answers: refused.
  stateB.boards = [{ port: 4398, project: b.project }]
  let l = B()
  done = await load(l.roots, l.options, l.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['board-runs']])
  stateB.boards = []
  l = B()
  done = await load(l.roots, { ...l.options, userSettings: true }, l.deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${l.logs.join('\n')}`)
  for (const rel of ['.claude/work/B1149.md', '.claude/work/pause.json', '.claude/goals/focus.json']) {
    assert.equal(blobOf(await readFile(join(b.project, ...rel.split('/')))), blobOf(await readFile(join(a.project, ...rel.split('/')))), `${rel} travelled byte for byte (no CRLF: the data clone says * -text)`)
  }
  assert.equal(JSON.parse(await readFile(join(b.project, '.claude', 'work', 'pause.json'), 'utf8')).state, 'pausing', 'pause.json travels as pausing')
  assert.equal(await readFile(join(b.memoryDir, 'notes.md'), 'utf8'), '# notes\nkeep this\n')
  assert.equal(await readFile(join(b.boardDir, 'data', 'finished.json'), 'utf8'), '{"B1":1}\n')
  assert.equal((await stat(join(b.project, '.claude', 'goals', 'focus.json'))).mtimeMs, 1700000000000, 'the time is restored where the blob matches')
  assert.equal((await stat(join(b.project, 'pictures', 'knight.png'))).mtimeMs, 1700000001234, 'the picture came back from the Drive with its time')
  assert.equal(JSON.parse(await readFile(join(b.boardDir, 'config.json'), 'utf8')).carried, true, 'config.json written from the carried settings')
  assert.deepEqual(JSON.parse(await readFile(b.userSettingsFile, 'utf8')).permissions.allow, ['Bash(git status)', 'Bash(npm test)'])
  assert.ok(l.logs.some(one => /^Loaded \d\d:\d\d: \d+ items \(\d+ written, 0 backed up\), focus G95, 1 pictures/.test(one)), l.logs.join('\n'))
  assert.ok(l.logs.some(one => /^Board step B40 \(in progress\): Priority: fix; still held for the board PC$/.test(one)) && l.logs.some(one => /^Held word for Worker 4 \(B40\), retype it: look at Q5/.test(one)) && l.logs.some(one => /^This PC lacks: Codex/.test(one)))
  assert.deepEqual([done.replaced, done.stamp], [[], null], 'nothing was replaced: no backup of files (the user settings alone were backed up before their merge)')
  assert.equal((await readdir(join(b.boardDir, 'data', 'carry-backup'))).length, 1, 'one stamp folder: the user settings\' backup')

  // B changes a file and saves (its pause travelled as pausing, so the save goes); A loads it.
  await writeFile(join(b.project, '.claude', 'goals', 'focus.json'), JSON.stringify({ focus: 'G96' }))
  await writeFile(join(b.boardDir, 'data', 'outbox.jsonl'), '')
  stateB.now = 1794832000000
  l = B()
  done = await save(l.roots, l.options, l.deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${l.logs.join('\n')}`)
  assert.deepEqual(done.written, ['home/.claude/goals/focus.json'], 'only the changed file is written anew')
  state.now = 1794833000000
  s = A()
  done = await load(s.roots, s.options, s.deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${s.logs.join('\n')}`)
  assert.equal(JSON.parse(await readFile(join(a.project, '.claude', 'goals', 'focus.json'), 'utf8')).focus, 'G96')
  assert.deepEqual(done.replaced, ['home/.claude/goals/focus.json'])
  assert.ok(done.stamp !== null && existsSync(join(a.boardDir, 'data', 'carry-backup', done.stamp, 'home', '.claude', 'goals', 'focus.json')), 'the replaced file is backed up outside the game repo')
  assert.equal(existsSync(join(a.gameRepo, 'carry-backup')), false)

  // A changes locally without saving: the next load refuses; --park backs up and goes on; --undo puts it back.
  await writeFile(join(a.project, '.claude', 'goals', 'focus.json'), JSON.stringify({ focus: 'G97-local' }))
  s = A()
  done = await load(s.roots, s.options, s.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['changed-here']])
  s = A()
  done = await load(s.roots, { ...s.options, park: true }, s.deps)
  assert.equal(done.ok, true)
  assert.equal(JSON.parse(await readFile(join(a.project, '.claude', 'goals', 'focus.json'), 'utf8')).focus, 'G96')
  const parkStamp = done.stamp
  s = A()
  done = await load(s.roots, { ...s.options, undo: parkStamp }, s.deps)
  assert.deepEqual([done.ok, done.restored], [true, 2], 'the parked file and the board\'s config.json (backed up with every load) are put back')
  assert.equal(JSON.parse(await readFile(join(a.project, '.claude', 'goals', 'focus.json'), 'utf8')).focus, 'G97-local')
  await writeFile(join(a.project, '.claude', 'goals', 'focus.json'), JSON.stringify({ focus: 'G96' }))

  // A practice save pushes no step branch and goes to the practice branch; a final save after a practice LOAD is refused.
  await writeFile(join(wt, 'knight.txt'), 'sheet 4\n')
  await a.ok(wt, ['commit', '-q', '-am', 'B1149 sheet 4'])
  const practiceData = join(root, 'A', 'practice-data')
  s = sideOf(a, { remote, dataDir: practiceData, picturesFolder: drive, keepSetFile: keepSet, state })
  done = await save(s.roots, { ...s.options, practice: true }, s.deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${s.logs.join('\n')}`)
  assert.deepEqual(done.branchesPushed, [], 'a practice save pushes no step branch')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, 'b1149'])).slice(0, 40), line(await a.git(a.gameRepo, ['rev-parse', 'origin/b1149'])), 'origin\'s b1149 did not move')
  assert.equal(line(await a.git(practiceData, ['rev-parse', '--abbrev-ref', 'HEAD'])), PRACTICE_BRANCH)
  const practiceB = join(root, 'B', 'practice-data')
  l = sideOf(b, { remote, dataDir: practiceB, picturesFolder: drive, state: stateB })
  done = await load(l.roots, { ...l.options, practice: true }, l.deps)
  assert.equal(done.ok, true, JSON.stringify(done.refusals))
  assert.equal(JSON.parse(await readFile(join(b.project, '.claude', 'work', 'pause.json'), 'utf8')).by, 'carry load --practice', 'a practice load starts paused')
  l = sideOf(b, { remote, dataDir: practiceB, picturesFolder: drive, state: stateB })
  done = await save(l.roots, l.options, l.deps)
  assert.deepEqual([done.ok, done.refusals.map(one => one.code)], [false, ['practice-loaded']])
  // A fresh landing lock refuses both.
  state.lockAgeMs = 60_000
  s = A()
  assert.deepEqual((await save(s.roots, s.options, s.deps)).refusals.map(one => one.code), ['landing'])
  assert.deepEqual((await load(s.roots, s.options, s.deps)).refusals.map(one => one.code), ['landing'])
  state.lockAgeMs = null
  // The data folder stays out of the game checkout's view only once part A's ignore line is there: here, status names it.
  assert.ok(lines(await a.git(a.gameRepo, ['status', '--porcelain'])).some(one => /\.workerboard/.test(one)), 'without part A the game checkout sees the folder (part A ignores it)')
  assert.ok(relative(a.gameRepo, dataA).startsWith('.workerboard'))
})

test('the real case (chat 2\'s fixture, B2\'s set and B3\'s pictures for real): B1149\'s local-only branch is pushed, the review step only warns, Branch: none is skipped, the board step is listed, pause.json travels as pausing, the held word is kept, the key never travels', LONG, async t => {
  const root = await mkdtemp(join(tmpdir(), 'carry-real-'))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const a = await pc(root, 'R')
  const remote = await makeRemote(root, a.git)
  const fixture = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'carry-real')
  // The fixture's project, board data and memory on this PC, with the game clone where its config says.
  await cp(join(fixture, 'project'), a.project, { recursive: true })
  await mkdir(join(a.boardDir, 'data'), { recursive: true })
  await cp(join(fixture, 'board', 'data'), join(a.boardDir, 'data'), { recursive: true })
  await cp(join(fixture, 'memory'), a.memoryDir, { recursive: true })
  await a.ok(a.project, ['clone', '-q', remote, a.gameRepo])
  const drive = join(root, 'drive')
  await mkdir(join(drive, 'pictures'), { recursive: true })
  const configText = (await readFile(join(fixture, 'config.json'), 'utf8')).replaceAll('{project}', slashes(a.project)).replaceAll('{drive}', slashes(drive))
  await writeFile(join(a.boardDir, 'config.json'), configText)
  await writeFile(a.userSettingsFile, (await readFile(join(fixture, 'user-settings.json'), 'utf8')).replaceAll('{project}', slashes(a.project)))
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t']]) await a.ok(a.boardDir, args)
  await writeFile(join(a.boardDir, '.gitignore'), 'data/\nconfig.json\n')
  await writeFile(join(a.boardDir, 'server.mjs'), '// board\n')
  await a.ok(a.boardDir, ['add', '-A'])
  await a.ok(a.boardDir, ['commit', '-q', '-m', 'board'])
  // B1149's branch: local only, two commits, in its worktree (the step is given back: refined, no owner).
  const wt = join(a.project, 'game-b1149')
  await a.ok(a.gameRepo, ['worktree', 'add', '-q', '-b', 'b1149', wt])
  await writeFile(join(wt, 'mage.txt'), 'sheet\n')
  await a.ok(wt, ['add', '-A'])
  await a.ok(wt, ['commit', '-q', '-m', 'B1149 sheet'])
  await writeFile(join(wt, 'mage.txt'), 'sheet 2\n')
  await a.ok(wt, ['commit', '-q', '-am', 'B1149 sheet 2'])
  const config = JSON.parse(configText)
  const roots = { boardDir: a.boardDir, project: a.project, config: { ...config, work: '.claude/work' }, gameRepo: a.gameRepo, workDir: join(a.project, '.claude', 'work'), dataDir: join(a.gameRepo, '.workerboard'), isExplicitData: false, remote, picturesFolder: join(drive, 'pictures'), keepSetFile: null, memoryDir: a.memoryDir, userSettingsFile: a.userSettingsFile }
  const key = JSON.parse(await readFile(join(a.project, '.claude', 'board.json'), 'utf8')).key
  const logs = []
  const deps = {
    git: a.git, set: realSet, pictures: realPictures, fs, recordFile: recordFileFor({ boardDir: a.boardDir, dataDir: roots.dataDir, isExplicit: false }),
    boardAnswers: async () => [], keepers: async () => [], lockAgeMs: async () => null, secrets: async () => [{ kind: 'bridge key', value: key }], driveFree: async () => 1e12, lacks: async () => [],
  }
  const done = await save(roots, { log: text => logs.push(text), now: 1794840000000 }, deps)
  assert.equal(done.ok, true, `${JSON.stringify(done.refusals)}\n${logs.join('\n')}`)
  assert.deepEqual(done.branchesPushed.map(one => one.branch), ['b1149'], 'the given-back step\'s local-only branch is pushed')
  assert.equal(line(await a.git(a.gameRepo, ['ls-remote', '--heads', remote, 'b1149'])).slice(0, 40), line(await a.git(wt, ['rev-parse', 'HEAD'])))
  assert.ok(logs.some(one => /^Warning: B1153 is in review/.test(one)), 'the review step whose branch is gone warns')
  assert.equal(done.refusals.length, 0)
  assert.ok(!logs.some(one => /B1003/.test(one)), 'the done step with Branch: none is nowhere')
  assert.deepEqual(done.boardSteps.map(one => one.id), ['B1240'], 'the board step (Priority: fix, in progress) is listed')
  assert.ok(logs.some(one => /^Board step B1240 \(in progress, b1240-r/.test(one)))
  const data = roots.dataDir
  assert.equal(JSON.parse(await readFile(join(data, 'home', '.claude', 'work', 'pause.json'), 'utf8')).state, 'pausing', 'pause.json travels as pausing')
  assert.deepEqual(JSON.parse(await readFile(join(data, 'held-words.json'), 'utf8')).map(one => [one.chat, one.step]), [['Features', 'B72']], 'the one held line, not the delivered one')
  assert.equal(existsSync(join(data, 'home', '.claude', 'board.json')), false, 'the bridge key file does not travel')
  const tracked = lines(await a.git(data, ['ls-files']))
  for (const path of tracked) assert.equal((await readFile(join(data, ...path.split('/')), 'utf8').catch(() => '')).includes(key), false, `${path} holds no key`)
  assert.ok(tracked.some(path => /^home\/.claude\/work\/B1149\.md$/.test(path)) && tracked.some(path => /^board\/data\/finished\.json$/.test(path)) && tracked.some(path => /^memory\//.test(path)) && tracked.includes('settings/config.json'), tracked.join(' '))
  assert.ok(!tracked.some(path => /names\.json|delivered\.json|\.claim$|\.tmp$|broken-/.test(path)), 'runtime files stay out (B2)')
  assert.ok(logs.some(one => /^Saved /.test(one)), logs.join('\n'))
  assert.equal(logs.join('\n').includes(key), false, 'the key is never printed')
})
