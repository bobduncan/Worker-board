// T8, 2026-10-31 (the person: "rework the final check as one design (what counts as finished per kind of work) instead
// of patching each case"): the report check tells the kind of finished work from its evidence (check.mjs `finishedKind`,
// the rows of `KINDS`) and makes one decision from its facts (`finishedVerdict`): pass, warn, back to the worker, or fail
// to the person. One test per kind; the three live cases (B436, B799, B821) with the reports of their real History; and
// the plumbing of "back". Made-up folders and repositories; git is a stand-in that answers from a table.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { workApi } from '../../src/work/api.mjs'
import { ACTIONS, KINDS, NO_REASON_LINE, commitsOf, finishedKind, finishedVerdict, noChangeOf, reportCheck } from '../../src/work/check.mjs'
import { parseItem, serializeItem } from '../../src/work/item.mjs'
import { migrateBacklog, stamp } from '../../src/work/migrate.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { BACK, backWordsOf, reportCheckFailedOf, reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { writeStore } from '../../src/work/store.mjs'
import { buildState } from '../withStore.mjs'

const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const heads = 'for-each-ref --format=%(refname:short) refs/heads'
const remotes = 'for-each-ref --format=%(refname:short) refs/remotes'
const reflog = 'log -g --all --format=%gs'
const has = commit => `rev-parse --verify --quiet ${commit}^{commit}`
const worktrees = 'worktree list --porcelain'
const unmergedList = 'for-each-ref --no-merged main --format=%(refname:short) refs/heads'
const PROJECT = '/projects'
const GAME = '/projects/garden'
const BOARD = '/projects/tools/board'
const repos = [{ dir: GAME, base: 'main' }, { dir: BOARD, base: 'main' }]
const SAID = 'Context: The garden lamps stayed dark at night. Change: Every lamp along the paths glows after sunset. Details: x'
/** A repository where its remote has it, with no branch but main, its own worktree only. */
const plainRepo = (dir, extra = {}) => ({
  [`${dir} ${heads}`]: 'main\n', [`${dir} ${remotes}`]: 'origin/main\n', [`${dir} ${reflog}`]: 'commit: earlier work\n',
  [`${dir} rev-parse main`]: 'aaa\n', [`${dir} rev-parse origin/main`]: 'aaa\n', [`${dir} ${worktrees}`]: `worktree ${dir}\nHEAD aaa\nbranch refs/heads/main\n`,
  [`${dir} ${unmergedList}`]: '', ...extra,
})
const world = { ...plainRepo(GAME, { [`${GAME} ${has('a1b2c3d')}`]: 'a1b2c3d\n' }), ...plainRepo(BOARD, { [`${BOARD} ${has('c0ffee1')}`]: 'c0ffee1\n' }) }
const files = paths => async path => paths.includes(path.replace(/\\/g, '/'))
const report = (extra = {}) => ({ id: 'B5', branch: 'b5-lamps', result: SAID, merged: '', repos, run: git(world), project: PROJECT, exists: files([]), ...extra })

/** A made-up file system: the folders of `tree`; `rmdir` answers `busy` (an error code) or removes. */
const folders = (tree, busy = null) => {
  const key = path => path.replace(/\\/g, '/')
  const dirent = name => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
  const missing = () => Object.assign(new Error('not there'), { code: 'ENOENT' })
  return {
    entries: async path => {
      if (tree[key(path)] === undefined) throw missing()
      return tree[key(path)].map(dirent)
    },
    lstat: async path => {
      if (tree[key(path)] === undefined) throw missing()
      return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, mtimeMs: 0 }
    },
    removed: [],
    rmdir: async function (path) {
      if (busy !== null) throw Object.assign(new Error(busy), { code: busy })
      this.removed.push(key(path))
    },
  }
}

test('the table: every kind has its row, in the order the board tells them apart; the actions run from mild to worst', () => {
  assert.deepEqual([...new Set(KINDS.map(row => row.kind))], ['merged', 'unmerged', 'branch', 'unknown', 'outside', 'moot'])
  assert.equal(KINDS.at(-1).kind, 'unknown')
  assert.deepEqual(ACTIONS, ['pass', 'warn', 'back', 'fail'])
  // The decision is the worst fact's: a pass and a warn pass; a back sends it back marked; a fail goes as it is.
  const facts = (...is) => is.map((one, at) => ({ is: one, say: `fact ${at}` }))
  assert.deepEqual(finishedVerdict({ head: 'work in x', facts: facts('pass', 'warn') }), { passed: true, lines: ['work in x', 'fact 0'], warnings: ['fact 1'] })
  assert.deepEqual(finishedVerdict({ head: 'work in x', facts: facts('pass', 'back', 'back') }), { passed: false, lines: ['work in x', `${BACK}fact 1`, 'fact 2'] })
  assert.deepEqual(finishedVerdict({ head: null, facts: facts('back', 'fail') }), { passed: false, lines: ['fact 0', 'fact 1'] })
})

test('kind merged: a commit a repository holds; the check is of that repository', async () => {
  const found = await finishedKind(report({ merged: 'c0ffee1' }))
  assert.equal(found.kind, 'merged')
  assert.deepEqual(await reportCheck(report({ merged: 'c0ffee1' })), { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'] })
})

test('kind merged in two repositories: each commit\'s repository is checked, and a fault in the second is not missed', async () => {
  assert.deepEqual(commitsOf('a1b2c3d c0ffee1'), ['a1b2c3d', 'c0ffee1'])
  assert.deepEqual(commitsOf('a1b2c3d (garden), c0ffee1 (board), added'), ['a1b2c3d', 'c0ffee1'])
  assert.deepEqual(commitsOf('deadbee'), ['deadbee'])
  assert.deepEqual(commitsOf('none'), [])
  const both = await reportCheck(report({ merged: 'a1b2c3d c0ffee1' }))
  assert.deepEqual(both, { passed: true, lines: ['work in garden and board', 'main of garden equals origin/main', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'] })
  // The board's main is behind its remote, the game's is fine: the check fails on the board (a mutant checking the first repository only passes).
  const behind = { ...world, [`${BOARD} rev-parse origin/main`]: 'zzz\n' }
  const late = await reportCheck(report({ merged: 'a1b2c3d c0ffee1', run: git(behind) }))
  assert.equal(late.passed, false)
  assert.deepEqual(late.lines, ['work in garden and board', 'main of board is not the same as origin/main'])
  // The step's branch is still in the second repository: back to the worker.
  const left = { ...world, [`${BOARD} ${heads}`]: 'main\nb5-lamps\n' }
  assert.deepEqual((await reportCheck(report({ merged: 'a1b2c3d c0ffee1', run: git(left) }))).lines, ['work in garden and board', `${BACK}the branch b5-lamps is still there`])
  // A named commit no repository holds beside one that is held: back, naming it.
  assert.deepEqual((await reportCheck(report({ merged: 'a1b2c3d 9e9e9e9' }))).lines, ['work in garden', `${BACK}the commit 9e9e9e9 is in no repository the board knows: name in merged only the commits on a base branch`])
})

test('kind branch: no commit named, the step\'s branch was in a repository (its reflog) and is gone', async () => {
  const traced = { ...world, [`${BOARD} ${reflog}`]: 'merge b5-lamps: Fast-forward\n' }
  assert.equal((await finishedKind(report({ run: git(traced) }))).kind, 'branch')
  assert.equal((await reportCheck(report({ run: git(traced) }))).passed, true)
})

test('kind unmerged: the step\'s own branch is not merged, or another branch holds commits that name the step', async () => {
  const own = { ...world, [`${BOARD} ${heads}`]: 'main\nb5-lamps\n', [`${BOARD} ${unmergedList}`]: 'b5-lamps\n', [`${BOARD} rev-list --count main..b5-lamps`]: '2\n' }
  const done = await reportCheck(report({ run: git(own) }))
  assert.deepEqual(done, { passed: false, notMerged: { branch: 'b5-lamps', commits: 2, base: 'main', repo: 'board' }, lines: ['not merged: Your work for B5 is on branch b5-lamps (2 commits) but not on main: merge it into main, then report again.'] })
  const other = {
    ...world, [`${GAME} ${heads}`]: 'main\nb4-paths\n', [`${GAME} ${unmergedList}`]: 'b4-paths\n',
    [`${GAME} log --no-merges --fixed-strings --grep=B5 --format=%x1e%B main..b4-paths`]: '\x1eB5: the lamps\n', [`${GAME} rev-list --count main..b4-paths`]: '1\n',
  }
  assert.equal((await finishedKind(report({ branch: 'none', run: git(other) }))).kind, 'unmerged')
})

test('kind outside: a file the report names is there outside every repository; none there goes back to the worker', async () => {
  const there = report({ branch: 'none', merged: 'none', result: `${SAID} The page pictures/b5/page.html.`, exists: files(['/projects/pictures/b5/page.html']) })
  assert.equal((await finishedKind(there)).kind, 'outside')
  assert.deepEqual(await reportCheck(there), { passed: true, lines: ['work outside git', 'there: pictures/b5/page.html', 'result named', 'context and change named'] })
  assert.deepEqual((await reportCheck({ ...there, exists: files([]) })).lines, ['work outside git', `${BACK}not there: pictures/b5/page.html`])
})

test('kind moot: "No change: <why>" passes with a warning for the result check; without a reason it goes back', async () => {
  for (const words of ['No change: B12 built it.', 'Context: x. Change: Nothing new was needed: B12 built it.', 'Nothing new built: B12 built it.', 'No change made: the person dropped it.', 'No file made or changed (none in git): it is moot.', 'No new work: B12 has it.', 'Moot: the person dropped the page.']) {
    assert.notEqual(noChangeOf(words)?.reason ?? null, null, words)
  }
  assert.deepEqual(noChangeOf('No change.'), { reason: null })
  assert.equal(noChangeOf('Context: No change was visible. Change: The lamps glow.'), null)
  assert.equal(noChangeOf(SAID), null)
  const moot = report({ branch: 'none', merged: 'none', result: 'Context: The lamps were asked for. Change: No change: B12 and B13 built the lamps (merged 1a2b3c4).' })
  assert.equal((await finishedKind(moot)).kind, 'moot')
  const done = await reportCheck(moot)
  assert.equal(done.passed, true)
  // The Change names steps and a commit, so the card's words warn too (no 'context and change named').
  assert.deepEqual(done.lines, ['no change made (moot)', 'reason named', 'worktree gone', 'result named'])
  assert.match(done.warnings[0], /^no change made: the result check judges whether nothing was needed \(B12 and B13 built the lamps/)
  const bare = await reportCheck({ ...moot, result: 'Context: The lamps were asked for. Change: No change.' })
  assert.deepEqual(bare, { passed: false, lines: ['no change made (moot)', `${BACK}${NO_REASON_LINE}`] })
  // A commit a repository holds is merged work, whatever the words.
  assert.equal((await finishedKind({ ...moot, merged: 'c0ffee1' })).kind, 'merged')
})

test('kind unknown: no repository can be told: a failure for the person, not "back"', async () => {
  const done = await reportCheck({ id: 'B9', branch: 'b9-x', result: SAID, merged: 'deadbee', repos, run: git(world) })
  assert.deepEqual(done, { passed: false, lines: ['could not tell which repository B9\'s work is in'] })
  // The game's reflog unread: its branch may be there.
  assert.equal((await finishedKind(report({ branch: 'b9-x', run: git({ ...world, [`${GAME} ${reflog}`]: undefined }) }))).kind, 'unknown')
})

test('an empty folder a program holds warns and never fails the step; a folder with a worktree in it goes back', async () => {
  const held = folders({ '/projects': ['garden', 'tools', 'garden-b5'], '/projects/garden-b5': [] }, 'EBUSY')
  const done = await reportCheck(report({ merged: 'c0ffee1', fs: held, waits: [0], holders: async () => null }))
  assert.equal(done.passed, true)
  assert.equal(done.isHeld, true)
  assert.match(done.warnings.join(' '), /the empty folder \/projects\/garden-b5 of a worktree is still there and could not be removed \(EBUSY\): a program still uses it/)
  assert.equal(done.lines.includes('worktree gone'), false)
  const listed = { ...world, [`${BOARD} ${worktrees}`]: `${world[`${BOARD} ${worktrees}`]}\nworktree /projects/board-b5\nHEAD ccc\nbranch refs/heads/b5-lamps\n` }
  const back = await reportCheck(report({ merged: 'c0ffee1', run: git(listed) }))
  assert.equal(back.passed, false)
  assert.match(back.lines[1], /^back: the worktree \/projects\/board-b5 is still on b5-lamps/)
})

// The three live cases of 2026-10-30 and 31, with the reports of their History (shape only: made-up folders).
const GAME_REPO = '/projects/lava-tactics'
const BOARD_REPO = '/projects/worker-board'
const liveRepos = [{ dir: GAME_REPO, base: 'main' }, { dir: BOARD_REPO, base: 'main' }]
const live = { ...plainRepo(GAME_REPO), ...plainRepo(BOARD_REPO) }

test('B436 (X106): a step whose work B625, B628 and B629 had built, branch never made, nothing merged: kind moot, each report passes', async () => {
  const reports = [
    'Nothing new built: the third height already exists in the game (B625 rules, B628 painted drawing, B629 tile drawing, 2026-10-25), so this step is covered.',
    'No file made: the third height was already built by B625, B628 and B629 (2026-10-25), so nothing was changed. It lives in src/core/grid.ts, src/core/combat.ts, src/core/ruleNumbers.ts, src/core/types.ts, tests/core/thirdHeight.test.ts, src/content/arenas/dev/g60-heights.json, docs/third-height.md, docs/game-design.md and docs/process/playbooks/level.md.',
    'No new work: the third height already exists on main (B625 rules, B628 painted drawing, B629 tile drawing, 2026-10-25), so nothing was changed. Files that already hold it: lava-tactics/src/core/grid.ts, lava-tactics/src/core/combat.ts, lava-tactics/src/core/ruleNumbers.ts, lava-tactics/src/core/types.ts, lava-tactics/tests/core/thirdHeight.test.ts, lava-tactics/src/content/arenas/dev/g60-heights.json, lava-tactics/docs/third-height.md, lava-tactics/docs/game-design.md, lava-tactics/docs/process/playbooks/level.md',
  ]
  // Before: "no file named", then "not there: src/core/grid.ts, ...", then "in a repository: lava-tactics/src/core/grid.ts, ...".
  const there = files(['/projects/lava-tactics/src/core/grid.ts', '/projects/lava-tactics/src/core/combat.ts'])
  for (const result of reports) {
    const args = { id: 'B436', branch: 'b436-third-height', result, merged: '', repos: liveRepos, run: git(live), project: PROJECT, touches: ['src/core/types.ts', 'docs/game-design.md'], exists: there }
    assert.equal((await finishedKind(args)).kind, 'moot', result)
    const done = await reportCheck(args)
    assert.equal(done.passed, true, `${result}\n${JSON.stringify(done)}`)
    assert.match(done.warnings[0], /^no change made: the result check judges whether nothing was needed/)
  }
})

test('B799 (X113): a fix made moot by the person\'s decision, branch never made: kind moot, each report passes', async () => {
  const reports = [
    'No change made: the three missing details belong to a tick-and-Close-button design the person dropped on 2026-10-31.',
    'No file made or changed (none in git): the step is moot, since src/work/obsolete.mjs, public/board.js and test/obsoletePage.test.mjs on main already follow the person\'s 2026-10-31 decision (no ticks, no Close button).',
  ]
  // Before: "no file named", then "not there: src/work/obsolete.mjs, public/board.js, test/obsoletePage.test.mjs" (the board's files, read in the project folder).
  for (const result of reports) {
    const args = { id: 'B799', branch: 'b799-page-list-mockup', result, merged: '', repos: liveRepos, run: git(live), project: PROJECT, exists: files([]) }
    assert.equal((await finishedKind(args)).kind, 'moot', result)
    assert.equal((await reportCheck(args)).passed, true, result)
  }
})

test('B821 (X114): work merged in the game, an empty worktree folder a program held: it passes with a warning from the first report', async () => {
  const merged = {
    ...live, [`${GAME_REPO} ${has('21f499c')}`]: '21f499c\n', [`${GAME_REPO} ${reflog}`]: 'merge b821-lava-pool-round: Fast-forward\ncheckout: moving from b821-lava-pool-round to main\n',
    [`${GAME_REPO} diff-tree --no-commit-id --name-only -r 21f499c`]: 'tests/content/ring.test.ts\nsrc/content/ring.ts\n',
  }
  const reports = [
    ['Context: the Ring\'s pool and ring read as a stepped stadium and a boxy octagon, not the concept\'s smooth ovals (B689 check failed). Change: the pool and ring are now true ovals in the game (pool six rows tall, outline cut inside the edge cells, edge chipped with a hot rim); cells stay all stone or all lava. Details: Gate green, merged 21f499c, pushed, user\'s folder updated.', '21f499c'],
    ['Context: The lava pool and the ground around it read as stepped instead of round in the game. Change: The pool and its ground now read as round; the earlier report only failed because an empty leftover folder (w5-b821) of the removed worktree was still there. Details: worktree and branch are gone, main equals origin/main, the folder is empty.', 'none'],
    ['Context: The Ring\'s lava pool and the ground around it read as stepped blocks instead of round. Change: The pool and its shore are now true ovals (six-row pool, smooth edges), painted anew; the work is on main of lava-tactics and the branch is gone. Details: merged 21f499c; the empty worktree folder /projects/w5-b821 is locked by a program (EBUSY), nothing is in it; the board retries removal.', '21f499c'],
  ]
  // Before: "the empty folder .../w5-b821 of a worktree is still there and could not be removed (EBUSY): a program still uses it ..." three times.
  for (const [result, hash] of reports) {
    const held = folders({ '/projects': ['lava-tactics', 'worker-board', 'w5-b821'], '/projects/w5-b821': [] }, 'EBUSY')
    const args = { id: 'B821', branch: 'b821-lava-pool-round', result, merged: hash, repos: liveRepos, run: git(merged), project: PROJECT, exists: files([]), fs: held, waits: [0], holders: async () => [{ pid: 4242, name: 'bash.exe', parent: 'claude.exe', command: 'sleep 1500' }] }
    assert.equal((await finishedKind(args)).kind, hash === 'none' ? 'branch' : 'merged')
    const done = await reportCheck(args)
    assert.equal(done.passed, true, JSON.stringify(done))
    assert.equal(done.lines[0], 'work in lava-tactics')
    assert.ok(done.warnings.some(one => /w5-b821 of a worktree is still there and could not be removed \(EBUSY\): a program still uses it/.test(one)))
    // B844: the warning names the program that holds it (here a chat's background wait), so the worker can stop it.
    assert.ok(done.warnings.some(one => /a program still uses it \(bash\.exe 4242 from claude\.exe: sleep 1500\): stop it/.test(one)), JSON.stringify(done.warnings))
  }
})

// "Back": the History, the step's wait line, the lane's flag and `work next`.
const MIN = 60_000
const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const line = (minutes, who, what) => `- ${stamp(ago(minutes))} ${who}: ${what}`
const BACK_LINE = `check failed: work in board; ${BACK}the branch b5-lamps is still there; the worktree /projects/board-b5 is still on b5-lamps`
const stepItem = history => parseItem(`Id: B5\nKind: step\nTitle: Lamps glow\nState: review\nOwner: Digger\nSince: ${stamp(ago(60))}\n\n## History\n${history.join('\n')}\n`)
const backItem = (...after) => stepItem([line(40, 'Digger', 'in progress → review'), line(40, 'server', 'check pending'), line(39, 'server', BACK_LINE), ...after])

test('back: the History line keeps "check failed"; its words go back to the worker, and the wait line says "back with"', () => {
  assert.deepEqual(backWordsOf(BACK_LINE.replace(/^check failed: /, '')), { notMerged: false, words: 'the branch b5-lamps is still there; the worktree /projects/board-b5 is still on b5-lamps' })
  assert.equal(backWordsOf('work in board; the branch b5-lamps is still there'), null)
  const refused = reportCheckFailedOf(backItem())
  assert.equal(refused.notMerged, null)
  assert.equal(refused.back, 'the branch b5-lamps is still there; the worktree /projects/board-b5 is still on b5-lamps')
  assert.equal(refused.why, 'the branch b5-lamps is still there')
  assert.equal(reviewWaitOf(backItem(), new Map()).text, 'back with Digger: the branch b5-lamps is still there')
})

const app = name => JSON.stringify({ title: `Team - ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\game', isArchived: false, createdAt: name.length, lastActivityAt: ago(2), lastAssistantUuid: 'u-1' })
const idle = { state: 'idle', since: ago(20), busyAt: ago(28), background: false, at: ago(0.1), session: 'cli-Digger', mod: '0.26.9' }
function build(item) {
  const work = storeFromText('## Board\n', { now: ago(120) })
  work.items.set('B5', item)
  const raw = {
    listText: '{"prefix":"Team - ","main":"Lead"}', appChatTexts: ['Lead', 'Digger'].map(app),
    tails: { 'cli-Lead': { text: '', isCut: false, modifiedAt: ago(1) }, 'cli-Digger': { text: '', isCut: false, modifiedAt: ago(20) } },
    planLineTexts: {}, work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(180),
  }
  return buildState(raw, {
    lines: [], outbox: [], runs: [], now: NOW, config: { ...parseConfig('{}', {}), project: 'C:\\game' }, seen: { shown: { Lead: NOW - 5_000 }, other: {} },
    board: { startedAt: ago(60), offSince: null }, reports: new Map([['Digger', idle]]),
  })
}

test('back: the lane shows a quiet "back with Digger" with no Check again, and the worker is told the words', async () => {
  const state = build(backItem())
  const digger = state.chats.find(chat => chat.name === 'Digger')
  assert.deepEqual(digger.flags.map(({ kind, button }) => [kind, button]), [['back', null]])
  assert.match(digger.flags[0].text, /^B5: back with Digger: the branch b5-lamps is still there/)
  const says = state.reconciled.says.filter(flag => flag.id === 'B5').map(flag => flag.say)
  assert.match(says[0], /^work: the board's check sent B5 back to you: the branch b5-lamps is still there; the worktree/)
  const page = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  assert.match(page, /flag\.kind === 'not merged' \|\| flag\.kind === 'back' \? 'quiet'/)
})

test('back: work next gives the worker the words and no new step before the report passes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'finished-back-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog('## Art\n', { now: ago(120) }), undefined, { now: ago(120) })
  await writeFile(join(dir, 'B5.md'), serializeItem(backItem()))
  const next = await workApi({ action: 'next', chat: 'Digger' }, { dir, now: NOW, prefix: 'Team - ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, as: 'Digger' })
  assert.match(next.result.text, /The board's check sent your report B5 back to you: the branch b5-lamps is still there; the worktree \/projects\/board-b5 is still on b5-lamps\. Do that and report B5 again first; the board gives you no new step/)
})
