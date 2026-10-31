// B297: the board's own check after a chat reports a step (flow.json's `then` of the move to review: "check: base
// equals remote, branch gone, result named"). It asks git, never a chat; its outcome goes into the step's History
// through the API's `check`, and with the default flow a passed check closes the step.
//
// B304: the check is of the repository the step's work is in, not of every repository the board knows: the one that
// holds the reported merged commit, else the one that has (or had, by its reflog or its remote) the step's branch.
// When none can be told, the check fails and says so; it never passes in silence. A repository is named by its
// folder's last part.
//
// Worktree clean-up (the person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the
// cleanup step."): the check also confirms that no worktree of that repository is on the step's branch and that no
// worktree, or folder of one, named for the step is left in the project folder (worktrees.mjs `stepLeftovers`); a
// leftover fails the check with a line that names its path and how to remove it.
//
// B527: six of the twelve failed result checks of 2026-10-24 were tests that pass without the fix. A step whose change
// touches a test file is therefore reported with the mutant its tests caught ("Tests bite: <what was undone in a copy>
// → <the assertion that failed>").
//
// B569: the result opens with "Context:" and "Change:" in plain words, for the person's recap card (recapWords.mjs).
//
// 2026-10-25 (the person: "check the work, not the wording"; the supervisor's X45, X50, X57, X67: of 37 reports refused
// at least once in two days, 28 were refused for their wording only and 5 for facts only): the check refuses only for
// facts about the work: the base branch against its remote, the branch gone, no worktree left, a repository told, a
// result named, and for work outside git a file that is there (none, or work that sits in a repository, refuses). What
// is wording is a WARNING: the step passes, the warning goes into its History ("check passed with warnings: <the pass
// lines> | warnings: ...") and `work next` shows it while it is the owner's newest report (api.mjs). A report that names no mutant for a change that touches tests, and a Context or Change that is missing,
// too long or not plain, are such warnings: the partner's result check asks for the mutant (roles/partner.md), and the
// board builds the card's words itself (recapWords.mjs `recapParts`). The worker is never sent back for them.

import { join } from 'node:path'

import { readBranches } from '../folders.mjs'
import { RESULT_CHARS, partsWarnings } from './recapWords.mjs'
import { NOT_MERGED } from './resultCheck.mjs'
import { isHeldLine, stepLeftovers } from './worktrees.mjs'

/** A folder's last part, for Windows and other paths alike. */
const nameOf = dir => String(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const linesOf = answer => (typeof answer === 'string' ? answer.split('\n').map(one => one.trim()).filter(one => one !== '') : [])

/**
 * Whether the repository has, or had, the branch: as a branch, on a remote, or in a reflog line that names it. Null
 * when git answered none of the three, so "not there" is never read from a git that did not answer (B580).
 */
async function hadBranch(dir, branch, run) {
  const [local, remote, log] = await Promise.all([
    run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    run(['-C', dir, 'log', '-g', '--all', '--format=%gs']),
  ])
  const named = new RegExp(`(?:^|[\\s'"/])${escape(branch)}(?:$|[\\s:'"])`)
  if (linesOf(local).includes(branch) || linesOf(remote).some(ref => ref.endsWith(`/${branch}`)) || linesOf(log).some(one => named.test(one))) return true
  return local === null || remote === null || log === null ? null : false
}

/** B580: the branch is in no repository and never was (every repository answered, none has a trace of it). */
async function isNowhere(branch, repos, run) {
  for (const repo of repos) if (await hadBranch(repo.dir, branch, run) !== false) return false
  return true
}

/** The repository of `repos` that holds the reported merged commit, or null. */
async function repoOfCommit(merged, repos, run) {
  const commit = String(merged ?? '').trim()
  if (!/^[0-9a-f]{4,40}$/i.test(commit)) return null
  for (const repo of repos) if (await run(['-C', repo.dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`]) !== null) return repo
  return null
}

/** The repository of `repos` the step's work is in, or null when it cannot be told. */
export async function repoOfStep({ branch, merged, repos, run }) {
  const byCommit = await repoOfCommit(merged, repos, run)
  if (byCommit !== null) return byCommit
  if (typeof branch === 'string' && branch.trim() !== '') {
    for (const repo of repos) if (await hadBranch(repo.dir, branch.trim(), run)) return repo
  }
  return null
}

/**
 * `{ passed, lines, warnings }` for a reported step `id`: the repository its work is in (`repoOfStep`) has its base
 * branch where its remote has it (one without a remote is let be), the step's branch is gone from it and from its
 * remote, and the report names a result. A passed check names each part; a failed one the repository and its faults
 * (facts only: never the report's wording). `warnings` (only when there are some) are what the step passes with: the
 * report's words for the card, a missing mutant, a cut result (`cut`: the characters it had before the board kept its
 * first 2000). `run` runs git with the given arguments and answers its output or null (folders.mjs, `gitRunner`). No
 * worktree of the step is left (worktrees.mjs `stepLeftovers`): `fs` the file system the project folder is read with
 * (worktrees.mjs `FILES`); null leaves the project folder unread.
 */
export async function reportCheck(args) {
  const outcome = await factsCheck(args)
  // 2026-10-31 (B799): a check that fails because the work is not on main is, when the work sits on a branch that is
  // not merged, a word back to its worker ("merge it, then report again"), never a failure for the person. A pass, a
  // folder only held by a program and a report with a merged commit a repository holds are left as they are.
  if (outcome.passed || outcome.isHeldOnly === true || await repoOfCommit(args.merged, args.repos, args.run) !== null) return outcome
  const found = await findUnmerged(args)
  return found === null ? outcome : { passed: false, notMerged: found, lines: [notMergedWords(args.id, found)] }
}

/** The words that send a step back to its worker when its work is on a branch that is not merged (also the History line's reason). */
export const notMergedWords = (id, { branch, commits, base }) =>
  `${NOT_MERGED}Your work for ${id} is on branch ${branch} (${commits} commit${commits === 1 ? '' : 's'}) but not on ${base}: merge it into ${base}, then report again.`

/** Most unmerged branches of a repository looked through for the work (the rest are old leftovers). */
const BRANCHES_LOOKED_AT = 60

/**
 * 2026-10-31 (B799: built on b775-mock-details, the step's Branch named b799-page-list-mockup that never existed, the
 * check looked for the files on main and failed for the person): the work of step `id` on a local branch of a repository
 * that is not merged into its base, read only. In order: the step's own Branch; a branch whose own commits name the id as
 * a word; a branch that adds a file the result or Touches names (a path with a file's ending). `{ branch, commits, base,
 * repo }` (`commits`: those the base lacks), else null. A step whose own branch exists and is merged is not searched on.
 */
export async function findUnmerged({ id, branch, result, touches = [], project = '', repos, run }) {
  const own = typeof branch === 'string' ? branch.trim() : ''
  const named = new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`)
  const files = [...pathsIn(result, project), ...pathsIn((Array.isArray(touches) ? touches : [touches]).join('\n'), project)].filter(one => one.isCertain && !one.path.endsWith('/')).map(one => one.path.toLowerCase())
  const isFile = added => files.some(path => added === path || added.endsWith(`/${path}`) || path.endsWith(`/${added}`))
  for (const { dir, base } of repos) {
    const [unmerged, heads] = await Promise.all([
      run(['-C', dir, 'for-each-ref', '--no-merged', base, '--format=%(refname:short)', 'refs/heads']),
      own === '' ? null : run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    ])
    if (unmerged === null) continue
    const open = linesOf(unmerged).filter(name => name !== base)
    const counted = async name => {
      const count = String(await run(['-C', dir, 'rev-list', '--count', `${base}..${name}`]) ?? '').trim()
      return /^\d+$/.test(count) && Number(count) > 0 ? { branch: name, commits: Number(count), base, repo: nameOf(dir) } : null
    }
    if (own !== '' && own !== '-' && open.includes(own)) {
      const one = await counted(own)
      if (one !== null) return one
    }
    // The step's own branch is there and merged (only not gone): its work is on the base, no other branch holds it.
    if (own !== '' && linesOf(heads).includes(own) && !open.includes(own)) continue
    let byFile = null
    for (const name of open.filter(one => one !== own).slice(0, BRANCHES_LOOKED_AT)) {
      const log = await run(['-C', dir, 'log', '--no-merges', '--fixed-strings', `--grep=${id}`, '--format=%x1e%B', `${base}..${name}`])
      if (String(log ?? '').split('\x1e').slice(1).some(message => named.test(message))) {
        const one = await counted(name)
        if (one !== null) return one
      }
      if (byFile === null && files.length > 0 && linesOf(await run(['-C', dir, 'diff', '--name-only', '--diff-filter=A', `${base}...${name}`])).some(path => isFile(plainPath(path).toLowerCase()))) byFile = await counted(name)
    }
    if (byFile !== null) return byFile
  }
  return null
}

/** The report check's facts (see `reportCheck`, which adds the branch that holds unmerged work). */
async function factsCheck({ id, branch, result, merged, repos, run, project = '', touches = [], exists = null, fs = null, cut = null, inline = false, waits, holders }) {
  // 2026-10-25: a result the board cut at its limit passes with a warning that says so.
  const warnings = cut === null ? [] : [`the result was ${cut} characters: the board kept the first ${RESULT_CHARS} and cut the rest; put what matters first`]
  // B363: work outside git (no branch of its own, no merged commit a repository holds): its files are checked instead.
  // B580: so is a step whose branch, named at its take, no repository has or ever had (B568, a picture only).
  const own = typeof branch === 'string' ? branch.trim() : ''
  const isOwnBranch = own !== '' && own !== '-' && own.toLowerCase() !== 'none' && !repos.some(repo => repo.base === own)
  if (exists !== null && project !== '' && await repoOfCommit(merged, repos, run) === null && (!isOwnBranch || await isNowhere(own, repos, run))) {
    const left = await stepLeftovers({ id, repos, project, run, fs, inline, ...(waits === undefined ? {} : { waits }), ...(holders === undefined ? {} : { holders }) })
    return outsideCheck({ result, touches, project, repoDirs: repos.map(repo => repo.dir), exists, left, warnings })
  }
  const faults = []
  const passed = []
  const repo = await repoOfStep({ branch, merged, repos, run })
  // The review of B363: work merged on the repository's base branch itself has no branch of its own to be gone.
  let isOnBase = false
  if (repo === null) faults.push(`could not tell which repository ${id}'s work is in`)
  else {
    const name = nameOf(repo.dir)
    const { dir, base } = repo
    const [local, remote] = await Promise.all([run(['-C', dir, 'rev-parse', base]), run(['-C', dir, 'rev-parse', `origin/${base}`])])
    // B404: origin/<base> unread is "no remote" only when git names no origin; a failed or timed-out call never passes.
    const origins = local === null || remote !== null ? null : await run(['-C', dir, 'remote'])
    if (local === null) faults.push(`git did not answer for ${name}`)
    else if (remote === null && origins === null) faults.push(`git did not answer for origin/${base} of ${name}`)
    else if (remote === null && linesOf(origins).includes('origin')) faults.push(`origin/${base} of ${name} could not be read`)
    else if (remote === null) passed.push(`${base} of ${name} has no remote`)
    else if (local.trim() !== remote.trim()) faults.push(await baseFault({ dir, base, name, run }))
    else passed.push(`${base} of ${name} equals origin/${base}`)
    isOnBase = typeof branch === 'string' && branch.trim() === base
    if (typeof branch === 'string' && branch.trim() !== '' && !isOnBase) {
      const [branches, remotes] = await Promise.all([readBranches([dir], run), run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes'])])
      if (branches === null) faults.push(`git did not answer: the branches of ${name} are not known`)
      else if (branches.includes(branch.trim())) faults.push(`the branch ${branch.trim()} is still there`)
      else {
        const left = linesOf(remotes).find(ref => ref.endsWith(`/${branch.trim()}`))
        if (left !== undefined) faults.push(`the branch ${branch.trim()} is still on ${left.split('/')[0]} of ${name}`)
      }
    }
    passed.unshift(`work in ${name}`)
    faults.unshift(`work in ${name}`)
  }
  // Worktree clean-up: no worktree on the step's branch, and none (or its folder) named for the step, is left.
  faults.push(...await stepLeftovers({ id, branch: repo === null || isOnBase ? null : branch, repo, repos, project, run, fs, inline, ...(waits === undefined ? {} : { waits }), ...(holders === undefined ? {} : { holders }) }))
  if (String(result ?? '').trim() === '') faults.push('no result named')
  // B569, 2026-10-25: the recap card's Context and Change are the board's to build; what is off is a warning.
  const words = partsWarnings(result)
  warnings.push(...words)
  // B527, 2026-10-25: a change that touches a test file names the mutant its tests caught; without it the step passes,
  // and the partner's result check asks for one.
  const tests = repo === null ? [] : (await stepFiles({ id, branch, merged, dir: repo.dir, run })).filter(isTestFile)
  const bites = tests.length > 0 && hasBite(result)
  if (tests.length > 0 && !bites) warnings.push(noMutantWords(tests))
  const failed = faults.filter(line => !line.startsWith('work in '))
  return failed.length === 0
    ? { passed: true, lines: [...passed, isOnBase ? `worked on ${branch.trim()} itself` : 'branch gone', 'worktree gone', 'result named', ...(words.length === 0 ? ['context and change named'] : []), ...(bites ? ['tests bite named'] : [])], ...(warnings.length === 0 ? {} : { warnings }) }
    : { passed: false, lines: faults, ...(failed.every(isHeldLine) ? { isHeldOnly: true } : {}) }
}

/** The warning for a change that touches tests and a result that names no mutant (the result check asks for one). */
export const noMutantWords = tests => `the change touches tests (${tests.slice(0, 3).join(', ')}${tests.length > 3 ? ', ...' : ''}) but the result names no mutant: the result check asks for one (next time add "${BITE_LINE}")`

/** B598: the words a check fails with when a base branch is not where its remote has it; the rest of the line says why. */
export const baseDiffers = (base, name) => `${base} of ${name} is not the same as origin/${base}`

/** B598: a path of `git status --porcelain` ("M  a.mjs", "R  old -> new", a quoted one with spaces). */
const statusPath = line => line.replace(/^\S{1,2}\s+/, '').replace(/^.* -> /, '').replace(/^"(.*)"$/, '$1')

/**
 * B598 (X45: B595's report failed four times on "main of worker-board is not the same as origin/main", while the
 * worker had pushed and another chat's edits held the person's folder back): which side is off, and the way out. The
 * folder behind (fast-forward it), holding commits its remote lacks (push them), both, or behind with uncommitted
 * edits in files the fast-forward would change (named: another chat's work). Each case says the board checks again by
 * itself (the repair rule base-equal). Git that does not count the commits leaves the plain words.
 */
export async function baseFault({ dir, base, name, run }) {
  const plain = baseDiffers(base, name)
  const [aheadOut, behindOut] = await Promise.all([
    run(['-C', dir, 'rev-list', '--count', `origin/${base}..${base}`]), run(['-C', dir, 'rev-list', '--count', `${base}..origin/${base}`]),
  ])
  const ahead = /^\d+$/.test(String(aheadOut ?? '').trim()) ? Number(aheadOut.trim()) : null
  const behind = /^\d+$/.test(String(behindOut ?? '').trim()) ? Number(behindOut.trim()) : null
  if (ahead === null || behind === null || ahead + behind === 0) return plain
  const commits = n => `${n} commit${n === 1 ? '' : 's'}`
  const again = 'the board checks again by itself once they are equal'
  if (ahead > 0 && behind > 0) return `${plain}: it holds ${commits(ahead)} origin/${base} lacks and lacks ${commits(behind)} of it: bring them together and push, ${again}`
  if (ahead > 0) return `${plain}: it holds ${commits(ahead)} origin/${base} lacks: push them (or another chat's merge is under way), ${again}`
  const [status, upstream] = await Promise.all([
    run(['-C', dir, 'status', '--porcelain', '--untracked-files=no']), run(['-C', dir, 'diff', '--name-only', base, `origin/${base}`]),
  ])
  const changed = new Set(linesOf(upstream))
  const blocking = linesOf(status).map(statusPath).filter(path => changed.has(path))
  if (blocking.length > 0) {
    const named = `${blocking.slice(0, 3).join(', ')}${blocking.length > 3 ? ` and ${blocking.length - 3} more` : ''}`
    return `${plain}: it is ${commits(behind)} behind, and uncommitted edits block the fast-forward (${named}): another chat's work, ${again}`
  }
  return `${plain}: it is ${commits(behind)} behind: fast-forward it (git merge --ff-only origin/${base} in ${name}), ${again}`
}

/**
 * B598: for the repair rule base-equal, each repository of `repos` by its name (its folder's last part, as the check
 * names it): `{ name, base, equal }`, `equal` null where git did not answer.
 */
export async function basesNow({ repos, run }) {
  return Promise.all(repos.map(async ({ dir, base }) => {
    const [local, remote] = await Promise.all([run(['-C', dir, 'rev-parse', base]), run(['-C', dir, 'rev-parse', `origin/${base}`])])
    return { name: nameOf(dir), base, equal: local === null || remote === null ? null : local.trim() === remote.trim() }
  }))
}

/** B527: the line a report names its mutant with, as the refusal says it. */
export const BITE_LINE = 'Tests bite: <what was undone in a copy> → <the assertion that failed>'

/** B527: whether a report's words hold a "Tests bite: <what was undone> → <what failed>" line ("->" counts as "→"). */
export const hasBite = result => /Tests bite:[ \t]*\S[^\n]*?(?:→|->)[ \t]*\S/i.test(String(result ?? ''))

/** B527: a test file, by its folder (`test/`, `tests/`, `__tests__/`, `spec/`) or its name (`a.test.mjs`, `a_spec.rb`). */
export const isTestFile = path => /(?:^|\/)(?:tests?|__tests__|specs?)\//i.test(path) || /[._-](?:test|spec)\.[A-Za-z0-9]+$/i.test(path)

/**
 * B527: the files a reported step changed, as far as git tells: those of the commits before `merged` whose message
 * names the step (its id as a word), those its branch has over the other side when `merged` merges into the branch
 * ("Merge main into <branch>"), and those of `merged` itself when it is no merge. None when the commit cannot be read.
 */
export async function stepFiles({ id, branch, merged, dir, run }) {
  const commit = String(merged ?? '').trim()
  if (!/^[0-9a-f]{4,40}$/i.test(commit) || await run(['-C', dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`]) === null) return []
  const files = new Set()
  const add = answer => linesOf(answer).forEach(path => files.add(path))
  const named = new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`)
  const log = await run(['-C', dir, 'log', '--no-merges', '-n', '400', '--fixed-strings', `--grep=${id}`, '--format=%x1e%H%n%B', commit])
  for (const one of String(log ?? '').split('\x1e').slice(1)) {
    const [hash, ...message] = one.split('\n')
    if (named.test(message.join('\n'))) add(await run(['-C', dir, 'diff-tree', '--no-commit-id', '--name-only', '-r', hash.trim()]))
  }
  const other = await run(['-C', dir, 'rev-parse', '--verify', '--quiet', `${commit}^2`])
  const own = typeof branch === 'string' ? branch.trim() : ''
  if (other === null) add(await run(['-C', dir, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit]))
  else if (own !== '' && (await run(['-C', dir, 'log', '-1', '--format=%s', commit]) ?? '').includes(own)) add(await run(['-C', dir, 'diff', '--name-only', `${commit}^2`, commit]))
  return [...files]
}

/** A path written with "/", without its end "/", for comparing (any case, as on Windows). */
const plainPath = path => String(path).replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * B363: the paths a report's words name, in the project: a word with a "/" in it (a "\" read as one; the project's own
 * whole path left off), not inside an address (after "/", ":" or a letter) nor starting at a site ("example.com/a"), its
 * end marks left off. `isCertain`: it reads as a file or folder for certain (a file's ending, or a "/" at its end), so
 * it must be there; another ("and/or", "B1/B2/B3", "a/b") counts only when it is there.
 */
function pathsIn(words, project) {
  const home = plainPath(project)
  let text = String(words ?? '').replace(/\\/g, '/')
  if (home !== '') text = text.replace(new RegExp(`${escape(home)}/`, 'gi'), '')
  const found = []
  for (const [whole] of text.matchAll(/(?<![\w:/.@-])(?:[\w.@-]+\/)+[\w.@-]*/g)) {
    const raw = whole.replace(/[.,;:]+$/, '')
    const path = raw.replace(/\/+$/, '')
    if (path === '' || path.split('/').includes('..') || /^[\w-]+\.[\w.-]+$/.test(path.split('/')[0])) continue
    const isCertain = raw.endsWith('/') || /\.[A-Za-z0-9]{1,6}$/.test(path)
    if (!found.some(one => one.path === path)) found.push({ path, isCertain })
  }
  return found
}

/** B818: the second line of the "no file named" refusal: do not report again, ask to close the step. */
export const NOTHING_BUILT_LINE = 'nothing built because it already exists? Do not report again: ask to close it (work ask, kind decide: "Close B<id> as already done?", naming the steps that built it)'

/**
 * B363: the check of a step whose work is outside git: a file the report names is there in the project's folder,
 * outside every repository (`repoDirs`): a file in a repository is work in git, reported with its merged commit, and
 * refuses; so does a report whose Touches and result together name no file that is there ("not there", or "no file
 * named" when they name none). 2026-10-25 ("check the work, not the wording", and the review of the same day): the
 * result's prose misread words such as "done/level.md" as a file (X57), and Touches is a plan written before the work
 * that the worker cannot edit, so a path of either that is not there only warns once a file is there; one in a
 * repository in Touches alone (a wide plan) warns too. `exists(path)` answers whether a path is there. `left`: the lines
 * of the step's worktrees still left (worktree clean-up), each a fault. `warnings`: those the report check already holds.
 */
async function outsideCheck({ result, touches, project, repoDirs, exists, left = [], warnings = [] }) {
  const repos = repoDirs.map(dir => plainPath(dir).toLowerCase())
  const isInRepo = where => repos.some(dir => where.toLowerCase() === dir || where.toLowerCase().startsWith(`${dir}/`))
  const weigh = async named => {
    const found = []
    const missing = []
    const inGit = []
    for (const one of named) {
      const where = join(project, ...one.path.split('/'))
      if (isInRepo(plainPath(where))) {
        if (one.isCertain) inGit.push(one.path)
      } else if (await exists(where)) found.push(one.path)
      else if (one.isCertain) missing.push(one.path)
    }
    return { found, missing, inGit }
  }
  const planned = await weigh(pathsIn((Array.isArray(touches) ? touches : [touches]).join('\n'), project))
  const said = await weigh(pathsIn(result, project))
  const once = all => [...new Set(all)]
  const found = once([...planned.found, ...said.found])
  const missing = once([...planned.missing, ...said.missing])
  const lines = ['work outside git']
  // A repository file the result names is work in git; one only Touches names is a plan, a fact only when nothing else is there.
  const inGit = once([...said.inGit, ...(found.length === 0 ? planned.inGit : [])])
  if (found.length === 0 && missing.length > 0) lines.push(`not there: ${missing.join(', ')}`)
  if (inGit.length > 0) lines.push(`in a repository: ${inGit.join(', ')}; report that work with its merged commit`)
  if (found.length === 0 && missing.length === 0 && inGit.length === 0) lines.push('no file named: name the files it made in the result')
  // B818 (X106): a report that names no file of its own is often a step whose work other steps already built.
  if (found.length === 0 && missing.length === 0 && inGit.length === 0) lines.push(NOTHING_BUILT_LINE)
  lines.push(...left)
  if (String(result ?? '').trim() === '') lines.push('no result named')
  if (lines.length > 1) return { passed: false, lines, ...(lines.slice(1).every(isHeldLine) ? { isHeldOnly: true } : {}) }
  const words = partsWarnings(result)
  const warned = [...warnings, ...words]
  if (planned.missing.length > 0) warned.push(`Touches names files not there: ${planned.missing.join(', ')}`)
  if (found.length > 0 && planned.inGit.length > 0) warned.push(`Touches names files in a repository: ${planned.inGit.join(', ')}`)
  const saidMissing = said.missing.filter(path => !planned.missing.includes(path))
  if (saidMissing.length > 0) warned.push(`the result names ${saidMissing.join(', ')}, which ${saidMissing.length === 1 ? 'is' : 'are'} not there`)
  return { passed: true, lines: [...lines, `there: ${found.join(', ')}`, 'result named', ...(words.length === 0 ? ['context and change named'] : [])], ...(warned.length === 0 ? {} : { warnings: warned }) }
}

/** How many times, and how far apart (ms), the report check looks again at a folder a program still holds. */
export const HELD_ROUNDS = 6
export const HELD_EVERY_MS = 10_000

/**
 * The report check as the board's background loop runs it (nobody waits on it): the empty folder a worktree left is tried
 * for a few seconds inside the check (`inline`); when a program still holds it, and that is all that fails, the check looks
 * again after `every` ms, up to `rounds` times, and passes by itself once the folder is gone. Only then is it filed, so the
 * worker is not messaged for a folder that frees itself. `sleep` is the clock's wait (a test's own). The outcome has no
 * `isHeldOnly`: it is the board's own word between the rounds.
 */
export async function patientReportCheck(args, { rounds = HELD_ROUNDS, every = HELD_EVERY_MS, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let outcome = await reportCheck({ ...args, inline: true })
  for (let round = 0; round < rounds && outcome.isHeldOnly === true; round += 1) {
    await sleep(every)
    outcome = await reportCheck({ ...args, inline: true })
  }
  const { isHeldOnly, ...filed } = outcome
  return filed
}
