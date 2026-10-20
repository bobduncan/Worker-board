// B297: the board's own check after a step is reported (spec 2026-10-17, section 4: "check: base equals remote,
// branch gone, result named"). B304: it checks the repository the step's work is in, found by the merged commit, else
// by the branch; one it cannot tell fails. Made-up repositories: git is a stand-in.

import assert from 'node:assert/strict'
import test from 'node:test'

import { reportCheck } from '../../src/work/check.mjs'

/** A git that answers from a table of "<repo> <args>" lines; null where it has none. */
const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const heads = 'for-each-ref --format=%(refname:short) refs/heads'
const remotes = 'for-each-ref --format=%(refname:short) refs/remotes'
const reflog = 'log -g --all --format=%gs'
const has = commit => `rev-parse --verify --quiet ${commit}^{commit}`
const repos = [{ dir: '/projects/garden', base: 'main' }, { dir: '/projects/tools/board', base: 'main' }]
/** The garden (the game) is two commits ahead of its remote; the board is where its remote has it. */
const world = {
  [`/projects/garden ${heads}`]: 'main\nb7-paths\n',
  [`/projects/garden ${remotes}`]: 'origin/main\n',
  [`/projects/garden ${reflog}`]: 'commit: two more\ncheckout: moving from b7-paths to main\n',
  '/projects/garden rev-parse main': 'aaa\n',
  '/projects/garden rev-parse origin/main': 'zzz\n',
  [`/projects/tools/board ${heads}`]: 'main\n',
  [`/projects/tools/board ${remotes}`]: 'origin/main\n',
  [`/projects/tools/board ${reflog}`]: 'merge b5-lamps: Fast-forward\ncheckout: moving from b5-lamps to main\n',
  [`/projects/tools/board ${has('c0ffee1')}`]: 'c0ffee1c0ffee1\n',
  '/projects/tools/board rev-parse main': 'bbb\n',
  '/projects/tools/board rev-parse origin/main': 'bbb\n',
}

test('a merged commit in the board\'s repository: that one is checked, and the game ahead of its remote is no matter', async () => {
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'The lamps glow.', merged: 'c0ffee1', repos, run: git(world) })
  assert.deepEqual(done, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'result named'] })
})

test('without a merged commit the branch tells: by its reflog, its remote, or the branch itself', async () => {
  // Only the board's reflog names b5-lamps.
  assert.equal((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: '', repos, run: git(world) })).passed, true)
  // Still on the board's remote: found there, and the check says the branch is still there.
  const onRemote = { ...world, [`/projects/tools/board ${reflog}`]: '', [`/projects/tools/board ${remotes}`]: 'origin/main\norigin/b5-lamps\n' }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', repos, run: git(onRemote) })).lines, ['work in board', 'the branch b5-lamps is still on origin of board'])
  // A branch of the game that is still there: the game is checked, and both of its faults are named.
  const game = await reportCheck({ id: 'B7', branch: 'b7-paths', result: 'x', repos, run: git(world) })
  assert.deepEqual(game, { passed: false, lines: ['work in garden', 'main of garden is not the same as origin/main', 'the branch b7-paths is still there'] })
})

test('no merged commit and no branch anywhere: the check fails, saying it could not tell', async () => {
  const nowhere = await reportCheck({ id: 'B301', branch: 'b301-gone', result: 'x', merged: 'deadbee', repos, run: git(world) })
  assert.deepEqual(nowhere, { passed: false, lines: ['could not tell which repository B301\'s work is in'] })
  assert.deepEqual((await reportCheck({ id: 'B9', branch: null, result: '', repos, run: git(world) })).lines, ['could not tell which repository B9\'s work is in', 'no result named'])
  assert.deepEqual((await reportCheck({ id: 'B9', branch: 'b9-x', result: 'x', repos: [], run: git(world) })).passed, false)
})

test('git that does not answer is named, never a pass; a repository without a remote is let be; a failed check names only its faults', async () => {
  const silent = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos, run: async () => null })
  assert.deepEqual(silent, { passed: false, lines: ['could not tell which repository B5\'s work is in'] })
  const noRemote = { ...world, '/projects/tools/board rev-parse origin/main': undefined, [`/projects/tools/board ${remotes}`]: '', '/projects/tools/board remote': '' }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos, run: git(noRemote) })).lines, ['work in board', 'main of board has no remote', 'branch gone', 'result named'])
  // B404: origin/main unread while git names an origin, or git not answering at all, is a fault, never "no remote".
  const unread = { ...world, '/projects/tools/board rev-parse origin/main': undefined, '/projects/tools/board remote': 'origin\n' }
  const failed = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos, run: git(unread) })
  assert.equal(failed.passed, false)
  assert.ok(failed.lines.includes('origin/main of board could not be read'))
  const timedOut = { ...world, '/projects/tools/board rev-parse origin/main': undefined }
  const silentRemote = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos, run: git(timedOut) })
  assert.equal(silentRemote.passed, false)
  assert.ok(silentRemote.lines.includes('git did not answer for origin/main of board'))
  const noBase = { ...world, '/projects/tools/board rev-parse main': undefined }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos, run: git(noBase) })).lines, ['work in board', 'git did not answer for board'])
})

test('a Windows folder is named by its last part', async () => {
  const win = Object.fromEntries(Object.entries(world).map(([key, value]) => [key.replace('/projects/tools/board', 'C:\\work\\board-copy'), value]))
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'x', merged: 'c0ffee1', repos: [repos[0], { dir: 'C:\\work\\board-copy', base: 'main' }], run: git(win) })
  assert.equal(done.lines[0], 'work in board-copy')
})

// B363: a step whose work is outside git (pictures or pages in the project's folder): taken with branch none, on no
// branch of its own (none, or a repository's base branch), with no merged commit a repository holds. Its check is that
// the files its report names are there, in the project or a repository; a step on a branch of its own keeps the above.
const PROJECT = '/projects'
const files = paths => async path => paths.includes(path.replace(/\\/g, '/'))
const outside = (extra = {}) => ({ id: 'B9', result: 'The gap page (art-inbox/gap-9/gap.html, 0-summary.png) and the pictures in art-inbox/gap-9/.', merged: 'none', repos, run: git(world), project: PROJECT, exists: files(['/projects/art-inbox/gap-9/gap.html', '/projects/art-inbox/gap-9']), ...extra })

test('B363: work outside git, taken with branch none or on the base branch: the files its report names are there', async () => {
  const none = await reportCheck(outside({ branch: 'none' }))
  assert.deepEqual(none, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9/gap.html, art-inbox/gap-9', 'result named'] })
  // Taken on the base branch (main) with no merged commit, as B353 was: the same check, not "the branch main is still there".
  assert.deepEqual(await reportCheck(outside({ branch: 'main' })), none)
  // No branch at all and no commit: outside git too.
  assert.deepEqual(await reportCheck(outside({ branch: null, merged: '' })), none)
})

test('B363: a named file that is not there fails, by its path; with no path named the step\'s Touches name them; none at all fails', async () => {
  const missing = await reportCheck(outside({ branch: 'none', exists: files(['/projects/art-inbox/gap-9']) }))
  assert.deepEqual(missing, { passed: false, lines: ['work outside git', 'not there: art-inbox/gap-9/gap.html'] })
  const touches = await reportCheck(outside({ branch: 'none', result: 'The five pictures and the page.', touches: ['art-inbox/gap-9/ (the five pictures and the page), nothing in the game'] }))
  assert.deepEqual(touches, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9', 'result named'] })
  const nothing = await reportCheck(outside({ branch: 'none', result: 'The five pictures and the page.' }))
  assert.deepEqual(nothing, { passed: false, lines: ['work outside git', 'no file named: name the files it made in the result'] })
  // A link to the board names its picture; "and/or", "B1/B2/B3", a date or a site are no path, and none is missing.
  const words = await reportCheck(outside({ branch: 'none', result: 'See http://127.0.0.1:4310/#picture=art-inbox/gap-9/gap.html, and/or B1/B2/B3 of 2026/10/18 (www.example.com/a/b.png).' }))
  assert.deepEqual(words, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9/gap.html', 'result named'] })
  // The review: words that are no path for certain in the result still let the Touches name the files.
  const onlyWords = await reportCheck(outside({ branch: 'none', result: 'Done, and/or as agreed.', touches: ['art-inbox/gap-9/'] }))
  assert.deepEqual(onlyWords.lines, ['work outside git', 'there: art-inbox/gap-9', 'result named'])
  // A path written with "\", or as the project's whole path, is read as its path in the project.
  const written = await reportCheck(outside({ branch: 'none', result: 'The page art-inbox\\gap-9\\gap.html, and /projects/art-inbox/gap-9/ too.' }))
  assert.deepEqual(written.lines, ['work outside git', 'there: art-inbox/gap-9/gap.html, art-inbox/gap-9', 'result named'])
})

test('B363, the review: a file in a repository is work in git, no proof of work outside it', async () => {
  const inRepo = await reportCheck(outside({ branch: 'main', merged: '', result: 'Changed tools/board/src/check.mjs (not committed).', exists: files(['/projects/tools/board/src/check.mjs']) }))
  assert.deepEqual(inRepo, { passed: false, lines: ['work outside git', 'in a repository: tools/board/src/check.mjs; report that work with its merged commit'] })
})

test('B363: a step on the base branch whose merged commit a repository holds, or on a branch of its own, keeps the check of its repository', async () => {
  // The review: merged on the base branch itself, it has no branch of its own to be gone.
  const merged = await reportCheck(outside({ branch: 'main', merged: 'c0ffee1' }))
  assert.deepEqual(merged, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'worked on main itself', 'result named'] })
  const own = await reportCheck(outside({ branch: 'b5-lamps', merged: '' }))
  assert.deepEqual(own.lines, ['work in board', 'main of board equals origin/main', 'branch gone', 'result named'])
})
