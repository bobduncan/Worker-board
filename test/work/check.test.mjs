// B297: the board's own check after a step is reported (spec 2026-10-17, section 4: "check: base equals remote,
// branch gone, result named"). B304: it checks the repository the step's work is in, found by the merged commit, else
// by the branch; one it cannot tell fails. Made-up repositories: git is a stand-in.

import assert from 'node:assert/strict'
import test from 'node:test'

import { isTestFile, reportCheck } from '../../src/work/check.mjs'
import { hasNoMutantWarning } from '../../src/work/resultCheck.mjs'

/** A git that answers from a table of "<repo> <args>" lines; null where it has none. */
/** B569: every report opens with its Context and Change in plain words, then the rest. */
const SAID = 'Context: The garden lamps stayed dark at night. Change: Every lamp along the paths glows after sunset. Details: '
const git = table => async args => table[`${args[1]} ${args.slice(2).join(' ')}`] ?? null
const heads = 'for-each-ref --format=%(refname:short) refs/heads'
const remotes = 'for-each-ref --format=%(refname:short) refs/remotes'
const reflog = 'log -g --all --format=%gs'
const has = commit => `rev-parse --verify --quiet ${commit}^{commit}`
const worktrees = 'worktree list --porcelain'
const repos = [{ dir: '/projects/garden', base: 'main' }, { dir: '/projects/tools/board', base: 'main' }]
/** The garden (the game) is two commits ahead of its remote; the board is where its remote has it. */
const world = {
  [`/projects/garden ${heads}`]: 'main\nb7-paths\n',
  [`/projects/garden ${remotes}`]: 'origin/main\n',
  [`/projects/garden ${reflog}`]: 'commit: two more\ncheckout: moving from b7-paths to main\n',
  '/projects/garden rev-parse main': 'aaa\n',
  '/projects/garden rev-parse origin/main': 'zzz\n',
  [`/projects/garden ${worktrees}`]: 'worktree /projects/garden\nHEAD aaa\nbranch refs/heads/main\n',
  [`/projects/tools/board ${heads}`]: 'main\n',
  [`/projects/tools/board ${remotes}`]: 'origin/main\n',
  [`/projects/tools/board ${reflog}`]: 'merge b5-lamps: Fast-forward\ncheckout: moving from b5-lamps to main\n',
  [`/projects/tools/board ${has('c0ffee1')}`]: 'c0ffee1c0ffee1\n',
  '/projects/tools/board rev-parse main': 'bbb\n',
  '/projects/tools/board rev-parse origin/main': 'bbb\n',
  [`/projects/tools/board ${worktrees}`]: 'worktree /projects/tools/board\nHEAD bbb\nbranch refs/heads/main\n',
}

test('a merged commit in the board\'s repository: that one is checked, and the game ahead of its remote is no matter', async () => {
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'The lamps glow.', merged: 'c0ffee1', repos, run: git(world) })
  assert.deepEqual(done, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'] })
})

test('without a merged commit the branch tells: by its reflog, its remote, or the branch itself', async () => {
  // Only the board's reflog names b5-lamps.
  assert.equal((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: '', repos, run: git(world) })).passed, true)
  // Still on the board's remote: found there, and the check says the branch is still there.
  const onRemote = { ...world, [`/projects/tools/board ${reflog}`]: '', [`/projects/tools/board ${remotes}`]: 'origin/main\norigin/b5-lamps\n' }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', repos, run: git(onRemote) })).lines, ['work in board', 'the branch b5-lamps is still on origin of board'])
  // A branch of the game that is still there: the game is checked, and both of its faults are named.
  const game = await reportCheck({ id: 'B7', branch: 'b7-paths', result: SAID + 'x', repos, run: git(world) })
  assert.deepEqual(game, { passed: false, lines: ['work in garden', 'main of garden is not the same as origin/main', 'the branch b7-paths is still there'] })
})

test('no merged commit and no branch anywhere: the check fails, saying it could not tell', async () => {
  const nowhere = await reportCheck({ id: 'B301', branch: 'b301-gone', result: SAID + 'x', merged: 'deadbee', repos, run: git(world) })
  assert.deepEqual(nowhere, { passed: false, lines: ['could not tell which repository B301\'s work is in'] })
  assert.deepEqual((await reportCheck({ id: 'B9', branch: null, result: '', repos, run: git(world) })).lines, ['could not tell which repository B9\'s work is in', 'no result named'])
  assert.deepEqual((await reportCheck({ id: 'B9', branch: 'b9-x', result: SAID + 'x', repos: [], run: git(world) })).passed, false)
})

test('git that does not answer is named, never a pass; a repository without a remote is let be; a failed check names only its faults', async () => {
  const silent = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: async () => null })
  assert.deepEqual(silent, { passed: false, lines: ['could not tell which repository B5\'s work is in'] })
  const noRemote = { ...world, '/projects/tools/board rev-parse origin/main': undefined, [`/projects/tools/board ${remotes}`]: '', '/projects/tools/board remote': '' }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(noRemote) })).lines, ['work in board', 'main of board has no remote', 'branch gone', 'worktree gone', 'result named', 'context and change named'])
  // B404: origin/main unread while git names an origin, or git not answering at all, is a fault, never "no remote".
  const unread = { ...world, '/projects/tools/board rev-parse origin/main': undefined, '/projects/tools/board remote': 'origin\n' }
  const failed = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(unread) })
  assert.equal(failed.passed, false)
  assert.ok(failed.lines.includes('origin/main of board could not be read'))
  const timedOut = { ...world, '/projects/tools/board rev-parse origin/main': undefined }
  const silentRemote = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(timedOut) })
  assert.equal(silentRemote.passed, false)
  assert.ok(silentRemote.lines.includes('git did not answer for origin/main of board'))
  const noBase = { ...world, '/projects/tools/board rev-parse main': undefined }
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(noBase) })).lines, ['work in board', 'git did not answer for board'])
})

test('a Windows folder is named by its last part', async () => {
  const win = Object.fromEntries(Object.entries(world).map(([key, value]) => [key.replace('/projects/tools/board', 'C:\\work\\board-copy'), value]))
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos: [repos[0], { dir: 'C:\\work\\board-copy', base: 'main' }], run: git(win) })
  assert.equal(done.lines[0], 'work in board-copy')
})

// B363: a step whose work is outside git (pictures or pages in the project's folder): taken with branch none, on no
// branch of its own (none, or a repository's base branch), with no merged commit a repository holds. Its check is that
// the files its report names are there, in the project or a repository; a step on a branch of its own keeps the above.
const PROJECT = '/projects'
const files = paths => async path => paths.includes(path.replace(/\\/g, '/'))
const outside = (extra = {}) => ({ id: 'B9', result: SAID + 'The gap page (art-inbox/gap-9/gap.html, 0-summary.png) and the pictures in art-inbox/gap-9/.', merged: 'none', repos, run: git(world), project: PROJECT, exists: files(['/projects/art-inbox/gap-9/gap.html', '/projects/art-inbox/gap-9']), ...extra })

test('B363: work outside git, taken with branch none or on the base branch: the files its report names are there', async () => {
  const none = await reportCheck(outside({ branch: 'none' }))
  assert.deepEqual(none, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9/gap.html, art-inbox/gap-9', 'result named', 'context and change named'] })
  // Taken on the base branch (main) with no merged commit, as B353 was: the same check, not "the branch main is still there".
  assert.deepEqual(await reportCheck(outside({ branch: 'main' })), none)
  // No branch at all and no commit: outside git too.
  assert.deepEqual(await reportCheck(outside({ branch: null, merged: '' })), none)
})

// 2026-10-25 (the person: "check the work, not the wording"): a path in the result's prose that is not there is only a
// warning when a file is there at all; the independent review (same day) kept the facts: work that sits in a repository,
// and a report that names no file that exists, still refuse. Touches is a plan written before the work: a Touches path
// that is not there warns when the result names a file that is, and refuses only when nothing named is there.
test('B363: a report whose Touches and result name no file that is there fails; a path that is not there beside one that is warns', async () => {
  // The prose names a missing file (X57: "done/level.md" misread) next to a file that is there: the step passes, with a warning.
  const prose = await reportCheck(outside({ branch: 'none', exists: files(['/projects/art-inbox/gap-9']) }))
  assert.deepEqual(prose, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9', 'result named', 'context and change named'], warnings: ['the result names art-inbox/gap-9/gap.html, which is not there'] })
  // Nothing named is there: a fact, and it refuses, with every path that is not there.
  const none = await reportCheck(outside({ branch: 'none', exists: files([]) }))
  assert.deepEqual(none, { passed: false, lines: ['work outside git', 'not there: art-inbox/gap-9/gap.html, art-inbox/gap-9'] })
  const missing = await reportCheck(outside({ branch: 'none', touches: ['art-inbox/gap-9/gap.html'], exists: files([]) }))
  assert.deepEqual(missing, { passed: false, lines: ['work outside git', 'not there: art-inbox/gap-9/gap.html, art-inbox/gap-9'] })
  // No path named anywhere (the prose names none, Touches none): "no file named" refuses, as before.
  const nothing = await reportCheck(outside({ branch: 'none', result: SAID + 'The five pictures and the page.' }))
  assert.deepEqual(nothing, { passed: false, lines: ['work outside git', 'no file named: name the files it made in the result'] })
  // Touches is a plan: a Touches path that is not there warns when the result names a file that is.
  const plan = await reportCheck(outside({ branch: 'none', touches: ['art-inbox/gap-9/gap.html', 'src/other.mjs'], exists: files(['/projects/art-inbox/gap-9']) }))
  assert.deepEqual(plan, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9', 'result named', 'context and change named'], warnings: ['Touches names files not there: art-inbox/gap-9/gap.html, src/other.mjs'] })
  // Touches name files that are there: those count, the result needs to name none.
  const touches = await reportCheck(outside({ branch: 'none', result: SAID + 'The five pictures and the page.', touches: ['art-inbox/gap-9/ (the five pictures and the page), nothing in the game'] }))
  assert.deepEqual(touches, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9', 'result named', 'context and change named'] })
  // A link to the board names its picture; "and/or", "B1/B2/B3", a date or a site are no path, and none is missing.
  const words = await reportCheck(outside({ branch: 'none', result: SAID + 'See http://127.0.0.1:4310/#picture=art-inbox/gap-9/gap.html, and/or B1/B2/B3 of 2026/10/18 (www.example.com/a/b.png).' }))
  assert.deepEqual(words, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9/gap.html', 'result named', 'context and change named'] })
  // The review: words that are no path for certain in the result still let the Touches name the files.
  const onlyWords = await reportCheck(outside({ branch: 'none', result: SAID + 'Done, and/or as agreed.', touches: ['art-inbox/gap-9/'] }))
  assert.deepEqual(onlyWords.lines, ['work outside git', 'there: art-inbox/gap-9', 'result named', 'context and change named'])
  // A path written with "\", or as the project's whole path, is read as its path in the project.
  const written = await reportCheck(outside({ branch: 'none', result: SAID + 'The page art-inbox\\gap-9\\gap.html, and /projects/art-inbox/gap-9/ too.' }))
  assert.deepEqual(written.lines, ['work outside git', 'there: art-inbox/gap-9/gap.html, art-inbox/gap-9', 'result named', 'context and change named'])
})

test('B363, the review: a file in a repository is work in git, no proof of work outside it', async () => {
  const exists = files(['/projects/tools/board/src/check.mjs', '/projects/art-inbox/gap-9'])
  const refused = { passed: false, lines: ['work outside git', 'in a repository: tools/board/src/check.mjs; report that work with its merged commit'] }
  // Named by the result (branch main, no merged commit: an unpushed commit would pass as "outside git" otherwise).
  const inRepo = await reportCheck(outside({ branch: 'main', merged: '', result: SAID + 'Changed tools/board/src/check.mjs (not committed).', exists }))
  assert.deepEqual(inRepo, refused)
  // Or branch none with a merged hash no repository holds.
  assert.deepEqual(await reportCheck(outside({ branch: 'none', merged: 'deadbee', result: SAID + 'Changed tools/board/src/check.mjs (not committed).', exists })), refused)
  // Next to a file outside git that is there, a repository file in the result still refuses.
  const mixed = await reportCheck(outside({ branch: 'none', result: SAID + 'The page art-inbox/gap-9/ and tools/board/src/check.mjs.', exists }))
  assert.deepEqual(mixed, refused)
  // Named only by the step's Touches (a plan), with nothing else there: the same refusal.
  const plan = await reportCheck(outside({ branch: 'main', merged: '', result: SAID + 'Changed it.', touches: ['tools/board/src/check.mjs'], exists }))
  assert.deepEqual(plan, refused)
  // Touches name it but the result names a file outside git that is there: the plan was wide; it warns.
  const wide = await reportCheck(outside({ branch: 'none', touches: ['tools/board/src/check.mjs'], exists: files(['/projects/art-inbox/gap-9', '/projects/art-inbox/gap-9/gap.html']) }))
  assert.equal(wide.passed, true)
  assert.deepEqual(wide.warnings, ['Touches names files in a repository: tools/board/src/check.mjs'])
})

test('B363: a step on the base branch whose merged commit a repository holds, or on a branch of its own, keeps the check of its repository', async () => {
  // The review: merged on the base branch itself, it has no branch of its own to be gone.
  const merged = await reportCheck(outside({ branch: 'main', merged: 'c0ffee1' }))
  assert.deepEqual(merged, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'worked on main itself', 'worktree gone', 'result named', 'context and change named'] })
  const own = await reportCheck(outside({ branch: 'b5-lamps', merged: '' }))
  assert.deepEqual(own.lines, ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'])
})

// B580: B568 named a branch at its take (b568-example-card-picture) that was never made, and made only a picture; its
// check kept failing with "could not tell which repository". A branch no repository has or ever had, with no merged
// commit a repository holds, is work outside git, checked by its files.
test('B580: a branch never made and nothing merged: work outside git, checked by its files', async () => {
  const never = await reportCheck(outside({ branch: 'b9-never-made' }))
  assert.deepEqual(never, { passed: true, lines: ['work outside git', 'there: art-inbox/gap-9/gap.html, art-inbox/gap-9', 'result named', 'context and change named'] })
  assert.deepEqual(await reportCheck(outside({ branch: 'b9-never-made', merged: '' })), never)
  // 2026-10-25: nothing named is there: a fact, and it refuses; a path that is not there beside one that is only warns (above).
  const missing = await reportCheck(outside({ branch: 'b9-never-made', exists: files([]) }))
  assert.deepEqual(missing, { passed: false, lines: ['work outside git', 'not there: art-inbox/gap-9/gap.html, art-inbox/gap-9'] })
})

test('B580: a branch deleted after its merge stays a git step; a git that does not answer never makes one outside git', async () => {
  // Found by its trace (the board's reflog names b5-lamps), with no merged commit named.
  const traced = await reportCheck(outside({ branch: 'b5-lamps', merged: 'none' }))
  assert.deepEqual(traced.lines, ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'])
  // Found by its merged commit, with no trace of the branch left.
  const byCommit = await reportCheck(outside({ branch: 'b6-pruned', merged: 'c0ffee1' }))
  assert.deepEqual(byCommit.lines, ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'])
  // The game's reflog unread: the branch may be there, so the check cannot tell, as before.
  const silent = await reportCheck(outside({ branch: 'b9-never-made', run: git({ ...world, [`/projects/garden ${reflog}`]: undefined }) }))
  assert.deepEqual(silent, { passed: false, lines: ['could not tell which repository B9\'s work is in'] })
})

// Worktree clean-up (the person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the cleanup
// step."): a worktree of the step's repository on its branch, or a worktree or its folder named for the step in the
// project folder, fails the check with how to remove it. test/work/worktrees.test.mjs has the same with real git.

/** A made-up file system: the folders of `tree` ("<path>": [names of folders in it]), all plain folders. */
const folders = tree => {
  const key = path => path.replace(/\\/g, '/')
  const dirent = name => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
  const missing = () => Object.assign(new Error('not there'), { code: 'ENOENT' })
  return {
    entries: async path => {
      const names = tree[key(path)]
      if (names === undefined) throw missing()
      return names.map(dirent)
    },
    lstat: async path => {
      if (tree[key(path)] === undefined) throw missing()
      return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false, mtimeMs: 0 }
    },
    removed: [],
    rmdir: async function (path) { this.removed.push(key(path)) },
  }
}

test('worktree clean-up: a worktree still on the step\'s branch fails the check, with how to remove it', async () => {
  const left = {
    ...world,
    [`/projects/tools/board ${heads}`]: 'main\nb5-lamps\n',
    [`/projects/tools/board ${worktrees}`]: `${world[`/projects/tools/board ${worktrees}`]}\nworktree /projects/board-b5\nHEAD ccc\nbranch refs/heads/b5-lamps\n`,
  }
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(left) })
  assert.deepEqual(done, { passed: false, lines: ['work in board', 'the branch b5-lamps is still there', 'the worktree /projects/board-b5 is still on b5-lamps: git worktree remove /projects/board-b5, then delete the empty folder Windows may leave'] })
  // git that does not answer for the worktrees is a fault, never a pass.
  const silent = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git({ ...world, [`/projects/tools/board ${worktrees}`]: undefined }) })
  assert.deepEqual(silent.lines, ['work in board', 'git did not answer: the worktrees of board are not known'])
})

test('worktree clean-up: an empty folder a worktree of the step left in the project folder is removed by the board and the check passes; other steps are left alone (B717)', async () => {
  const fs = folders({ '/projects': ['garden', 'tools', 'board-b5', 'board-b51', 'notes'], '/projects/board-b5': [], '/projects/board-b51': [], '/projects/notes': [] })
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(world), project: PROJECT, fs })
  assert.equal(done.passed, true)
  assert.deepEqual(fs.removed, ['/projects/board-b5'])
  // Work outside git (B9) that left a worktree's folder is cleaned the same way.
  const left = folders({ '/projects': ['garden', 'tools', 'board-b9'], '/projects/board-b9': [] })
  assert.equal((await reportCheck(outside({ branch: 'none', fs: left }))).passed, true)
  assert.deepEqual(left.removed, ['/projects/board-b9'])
})

// B527: a report of a step whose change touches a test file names the mutant its tests caught.
const grepOf = id => `log --no-merges -n 400 --fixed-strings --grep=${id} --format=%x1e%H%n%B c0ffee1`
const tree = hash => `diff-tree --no-commit-id --name-only -r ${hash}`
const BITE = 'Tests bite: <what was undone in a copy> → <the assertion that failed>'
/** The board's c0ffee1 is the step's last commit (no merge); a commit before it names B5 and changes a test. */
const tested = {
  ...world,
  [`/projects/tools/board ${grepOf('B5')}`]: '\x1eaaa111\nfeat: lamps glow (B5)\n\n\x1ebbb222\nfeat: B51 is another step\n',
  [`/projects/tools/board ${tree('aaa111')}`]: 'src/lamps.mjs\ntest/lamps.test.mjs\n',
  [`/projects/tools/board ${tree('bbb222')}`]: 'test/other.test.mjs\n',
  [`/projects/tools/board ${tree('c0ffee1')}`]: 'docs/lamps.md\n',
}

// 2026-10-25 (the person: "check the work, not the wording"): a report that names no mutant for a change that touches
// tests passes with a warning; the partner's result check asks for the mutant (these tests pinned a refusal).
test('tests bite: a change with a test file and no mutant line passes with a warning; with the line it passes without', async () => {
  const bare = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'The lamps glow.', merged: 'c0ffee1', repos, run: git(tested) })
  assert.deepEqual(bare, {
    passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'],
    warnings: [`the change touches tests (test/lamps.test.mjs) but the result names no mutant: the result check asks for one (next time add "${BITE}")`],
  })
  assert.equal(hasNoMutantWarning(bare.warnings.join('; ')), true)
  const result = SAID + 'The lamps glow.\nTests bite: in a scratch copy, glow() returning early → "a lit lamp glows" failed.'
  const named = await reportCheck({ id: 'B5', branch: 'b5-lamps', result, merged: 'c0ffee1', repos, run: git(tested) })
  assert.deepEqual(named, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named', 'tests bite named'] })
  // "->" counts as the arrow; the words without an arrow, or with nothing on either side of it, do not.
  assert.deepEqual(await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'Tests bite: glow undone -> "glows" failed', merged: 'c0ffee1', repos, run: git(tested) }), named)
  for (const words of ['Tests bite: undoing glow fails "glows"', 'Tests bite: → "glows"', 'Tests bite: glow undone →', 'Tests bite: glow undone\n→ "glows" failed']) {
    const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + words, merged: 'c0ffee1', repos, run: git(tested) })
    assert.equal(done.passed, true, words)
    assert.equal(hasNoMutantWarning(done.warnings.join('; ')), true, words)
  }
  // A fact still refuses, and says only the fact: the missing mutant is not told then (the report is made again anyway).
  const stuck = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'The lamps glow.', merged: 'c0ffee1', repos, run: git({ ...tested, [`/projects/tools/board ${heads}`]: 'main\nb5-lamps\n' }) })
  assert.deepEqual(stuck, { passed: false, lines: ['work in board', 'the branch b5-lamps is still there'] })
})

test('tests bite: a change without a test file reports as before; another step\'s commit (B51) does not count', async () => {
  const noTests = { ...tested, [`/projects/tools/board ${tree('aaa111')}`]: 'src/lamps.mjs\n' }
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'The lamps glow.', merged: 'c0ffee1', repos, run: git(noTests) })
  assert.deepEqual(done, { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'] })
  // The merged commit itself changes a test: counted.
  const lastTests = { ...noTests, [`/projects/tools/board ${tree('c0ffee1')}`]: 'tests/lamps_spec.rb\n' }
  const last = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(lastTests) })
  assert.equal(last.passed, true)
  assert.equal(hasNoMutantWarning(last.warnings.join('; ')), true)
})

test('tests bite: a merge of main into the step\'s branch counts what the branch has over main', async () => {
  const merge = {
    ...world,
    [`/projects/tools/board rev-parse --verify --quiet c0ffee1^2`]: 'ddd444\n',
    [`/projects/tools/board log -1 --format=%s c0ffee1`]: 'Merge main into b5-lamps\n',
    [`/projects/tools/board diff --name-only c0ffee1^2 c0ffee1`]: 'src/lamps.mjs\nsrc/__tests__/lamps.js\n',
  }
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'The lamps glow.', merged: 'c0ffee1', repos, run: git(merge) })
  assert.equal(done.passed, true)
  assert.match(done.warnings.at(-1), /^the change touches tests \(src\/__tests__\/lamps\.js\)/)
  // A merge that is not into the step's branch: what main brought is not the step's.
  const other = { ...merge, [`/projects/tools/board log -1 --format=%s c0ffee1`]: 'Merge b9-paths into main\n' }
  const brought = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run: git(other) })
  assert.equal(brought.passed, true)
  assert.equal(brought.warnings, undefined)
})

// 2026-10-25 (the person: "check the work, not the wording"; X45, X50, X57, X67): the Context and Change used to refuse a
// report (a missing part, over 300 or 500 characters, file names, code words, hashes, ids, placeholders). They are warnings
// now: the report passes, the board builds the card's words itself (recapWords.test.mjs), and a worker is not sent back.
test('B569: a result without its Context or Change, too long, or with files, code words or hashes in them passes with warnings that say which', async () => {
  const check = result => reportCheck({ id: 'B5', branch: 'b5-lamps', result, merged: 'c0ffee1', repos, run: git(world) })
  const warningsOf = async result => {
    const done = await check(result)
    assert.equal(done.passed, true, result)
    return done.warnings ?? []
  }
  const NEXT = 'next time open the result with "Context: <what was wrong, in plain words, at most 300 characters> Change: <what the person gets now, at most 500> Details: <the rest>"'
  assert.deepEqual(await warningsOf('The lamps glow.'), [
    "the result names no Context: the card's Context is made from the step's summary",
    "the result names no Change: the card's Change is made from the report",
    NEXT,
  ])
  // A part that is not named does not claim 'context and change named' in the check's lines.
  assert.equal((await check('The lamps glow.')).lines.includes('context and change named'), false)
  assert.deepEqual(await warningsOf('Context: The lamps were dark. Details: lamps.mjs'), ["the result names no Change: the card's Change is made from the report", NEXT])
  assert.deepEqual(await warningsOf('Change: They glow.'), ["the result names no Context: the card's Context is made from the step's summary", NEXT])
  assert.deepEqual(await warningsOf(`Context: ${'dark '.repeat(61)}Change: They glow.`), ['the Context is 304 characters: the card shortens it to 300', NEXT])
  assert.deepEqual(await warningsOf(`Context: Dark. Change: ${'glow '.repeat(101)}`), ['the Change is 504 characters: the card shortens it to 500', NEXT])
  assert.deepEqual(await warningsOf('Context: The lampPost rule in src/lamps.mjs was wrong. Change: Merged 3f9a1c2: lamps glow. Details: all in src/lamps.mjs'), [
    'the Context holds file names (src/lamps.mjs), code words (lampPost): the card leaves those words out',
    'the Change holds commit hashes (3f9a1c2): the card leaves those words out',
    NEXT,
  ])
  assert.deepEqual(await warningsOf('Context: B531 sat queued. Change: Main hands <n> on. Details: x'), [
    'the Context holds ids (B531): the card leaves those words out',
    'the Change holds placeholders (<n>): the card leaves those words out',
    NEXT,
  ])
  // X57 (B633): words joined by slashes are no file name; a path with a dot, a known folder or a backslash still is (a warning only).
  assert.deepEqual(await warningsOf('Context: A yes/how/cost question was refused. Change: Plain words like yes/how/cost pass. Details: x'), [])
  assert.match((await warningsOf('Context: Dark. Change: It lives in src/content/arenas/dev now. Details: x'))[0], /^the Change holds file names \(src\/content\/arenas\/dev\)/)
  assert.match((await warningsOf('Context: Dark. Change: See verdict.md for it. Details: x'))[0], /file names \(verdict\.md\)/)
  assert.match((await warningsOf('Context: Dark. Change: See a\\b\\c for it. Details: x'))[0], /file names/)
  // What goes after "Details:" (or a Tests bite line) is the check's, whatever it holds.
  assert.deepEqual(await check('Context: The lamps were dark. Change: They glow. Details: lamps.mjs, lightOn(), 3f9a1c2'), { passed: true, lines: ['work in board', 'main of board equals origin/main', 'branch gone', 'worktree gone', 'result named', 'context and change named'] })
  // Work outside git is held to the same words: a warning, the files it names are there.
  const left = await reportCheck(outside({ branch: 'none', result: 'The gap page art-inbox/gap-9/gap.html.' }))
  assert.equal(left.passed, true)
  assert.equal(left.warnings[0], "the result names no Context: the card's Context is made from the step's summary")
})

// "Check the work": a fact still refuses, and its refusal says only the fact, however the report is worded.
test('2026-10-25: a fact refuses whatever the wording; the refusal names no wording problem', async () => {
  const unwritten = 'The lamps glow, see src/lamps.mjs.'
  const stuck = { ...world, [`/projects/tools/board ${heads}`]: 'main\nb5-lamps\n', '/projects/tools/board rev-parse origin/main': 'zzz\n' }
  const done = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: unwritten, merged: 'c0ffee1', repos, run: git(stuck) })
  assert.deepEqual(done, { passed: false, lines: ['work in board', 'main of board is not the same as origin/main', 'the branch b5-lamps is still there'] })
  // No result at all is a fact; the same report with a result passes (with the warnings above).
  assert.deepEqual((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: '  ', merged: 'c0ffee1', repos, run: git(world) })).lines, ['work in board', 'no result named'])
  assert.equal((await reportCheck({ id: 'B5', branch: 'b5-lamps', result: unwritten, merged: 'c0ffee1', repos, run: git(world) })).passed, true)
})

test('2026-10-25: a result the board cut at its limit passes with a warning that says so, first among the warnings', async () => {
  const run = git(world)
  const cut = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: SAID + 'x', merged: 'c0ffee1', repos, run, cut: 3100 })
  assert.deepEqual(cut.warnings, ['the result was 3100 characters: the board kept the first 2000 and cut the rest; put what matters first'])
  assert.equal(cut.passed, true)
  const withWords = await reportCheck({ id: 'B5', branch: 'b5-lamps', result: 'The lamps glow.', merged: 'c0ffee1', repos, run, cut: 2500 })
  assert.match(withWords.warnings[0], /^the result was 2500 characters/)
  assert.match(withWords.warnings[1], /^the result names no Context/)
  assert.equal((await reportCheck({ id: 'B9', branch: 'none', result: SAID + 'x', merged: 'none', repos, run, project: PROJECT, exists: files(['/projects/art-inbox/gap-9']), touches: ['art-inbox/gap-9/'], cut: 2100 })).warnings[0].slice(0, 22), 'the result was 2100 ch')
})

test('tests bite: what counts as a test file', () => {
  for (const path of ['test/a.mjs', 'src/tests/b.ts', 'app/__tests__/c.js', 'spec/d.rb', 'src/e.test.ts', 'src/f.spec.js', 'g_test.go']) assert.equal(isTestFile(path), true, path)
  for (const path of ['src/testing.mjs', 'docs/latest.md', 'contest/a.js', 'src/attest.mjs']) assert.equal(isTestFile(path), false, path)
})

test('tests bite: the worker\'s role and the protocol say how, in a scratch copy and never on the branch', async () => {
  const { readFile } = await import('node:fs/promises')
  const worker = await readFile(new URL('../../roles/worker.md', import.meta.url), 'utf8')
  const protocol = await readFile(new URL('../../roles/protocol.md', import.meta.url), 'utf8')
  assert.match(worker, /Tests bite: <what was undone in a copy> → <the assertion that\s+failed>/)
  assert.match(worker, /scratch copy\s+\(never on your branch\)/)
  assert.match(protocol, /Tests bite: <what was undone in a copy> → <the assertion that failed>/)
})
