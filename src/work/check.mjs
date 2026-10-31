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
//
// T8, 2026-10-31 (the person: "rework the final check as one design (what counts as finished per kind of work) instead
// of patching each case"; X106, X113, X114: reports refused again and again, each patched for its case): one table.
// `finishedKind` tells the kind of finished work a report is (`KINDS`, the first row that fits: merged, unmerged, on a
// branch, outside git, no change, unknown) and gathers that kind's evidence as facts; `finishedVerdict` makes the
// outcome from them: each fact passes, warns, goes back to the worker or fails to the person (`ACTIONS`), and the worst
// decides. DESIGN.md, "What counts as finished, per kind of work", holds the table.

import { join } from 'node:path'

import { readBranches } from '../folders.mjs'
import { RESULT_CHARS, partsWarnings } from './recapWords.mjs'
import { BACK, NOT_MERGED } from './resultCheck.mjs'
import { isHeldLine, stepLeftovers } from './worktrees.mjs'

/** A folder's last part, for Windows and other paths alike. */
const nameOf = dir => String(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const linesOf = answer => (typeof answer === 'string' ? answer.split('\n').map(one => one.trim()).filter(one => one !== '') : [])
/** One look at a piece of evidence, made the first time it is asked for and kept (the kinds' rows ask in order). */
const once = make => {
  let kept = null
  return () => (kept ??= make())
}

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

/**
 * T8: the commits a report's `merged` names: the whole field as one hash (4 to 40 hex characters), else each hash in it
 * (7 to 40 hex characters with a digit among them, so a word such as "added" is none): "21f499c 92abe36" for work merged
 * in two repositories. [] for none.
 */
export function commitsOf(merged) {
  const text = String(merged ?? '').trim()
  if (/^[0-9a-f]{4,40}$/i.test(text)) return [text]
  return [...new Set((text.match(/\b[0-9a-f]{7,40}\b/gi) ?? []).filter(one => /\d/.test(one)))]
}

/** The repository of `repos` that holds the commit, or null. */
async function repoHolding(commit, repos, run) {
  for (const repo of repos) if (await run(['-C', repo.dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`]) !== null) return repo
  return null
}

/** The step's own branch: its Branch, unless it is none ('', '-', none) or a repository's base branch; else null. */
const ownBranchOf = (branch, repos) => {
  const own = typeof branch === 'string' ? branch.trim() : ''
  return own === '' || own === '-' || own.toLowerCase() === 'none' || repos.some(repo => repo.base === own) ? null : own
}

/**
 * T8 (B436, B799: a step whose work other steps had built, or a decision had made moot, reported "Nothing new built: ...",
 * "No change made: ..." and was refused as work outside git): the words a report says the step needed no change with, at
 * its start, after its "Change:" or at the start of a line: "No change: <why>" (also "No change made", "Nothing new
 * built", "Nothing was needed", "No new work", "No file made", "Moot").
 */
const NO_CHANGE = /(?:^|Change:\s*|\n\s*)(?:No change|Nothing (?:new )?(?:built|changed|made|to build|to do|was needed|needed)|No (?:new )?work|No files? (?:made|changed)|Moot)\b[^:\n.]*(?::\s*(\S[^\n]*))?/i
/** The fewest characters a reason for no change has. */
const REASON_CHARS = 10

/**
 * T8: whether a report says its step needed no change: `{ reason }`, the words after the claim's colon (null when it
 * names no reason), or null when it says nothing of the kind.
 */
export function noChangeOf(result) {
  const found = NO_CHANGE.exec(String(result ?? ''))
  if (found === null) return null
  const reason = (found[1] ?? '').trim()
  return { reason: reason.length >= REASON_CHARS ? reason : null }
}

/**
 * `{ passed, lines, warnings }` for a reported step `id` (T8: `finishedKind`, then `finishedVerdict`; DESIGN.md "What counts
 * as finished, per kind of work"). A passed check names each part; a failed one its faults (facts only: never the report's
 * wording), its first fault starting with BACK when the worker can fix them all, or `notMerged` and the NOT_MERGED words
 * for work on a branch that is not merged. `warnings` (only when there are some) are what the step passes with: the
 * report's words for the card, a missing mutant, a cut result (`cut`: the characters it had before the board kept its
 * first 2000), an empty folder a program still holds, no change made. `run` runs git with the given arguments and answers
 * its output or null (folders.mjs, `gitRunner`). `exists(path)` answers whether a path is there (null: work outside git is
 * not looked for). No worktree of the step is left (worktrees.mjs `stepLeftovers`): `fs` the file system the project
 * folder is read with (worktrees.mjs `FILES`); null leaves the project folder unread.
 */
export async function reportCheck(args) {
  return finishedVerdict(await finishedKind(args))
}

/** T8: what the board does with one fact of a report's evidence, mildest first; the worst fact of a report decides. */
export const ACTIONS = ['pass', 'warn', 'back', 'fail']
const fact = (is, say) => ({ is, say })

/**
 * T8: the kinds of finished work a report can be, in the order the board tells them apart: the first row whose `fits`
 * holds for the report's evidence (`finishedKind`) is its kind, and its `facts` gather what proves it finished. `says`
 * is the row in plain words (DESIGN.md holds the table with the actions).
 */
export const KINDS = [
  {
    kind: 'merged', says: 'code merged into one or more repositories: each commit `merged` names that a repository holds',
    fits: async e => (await e.commits()).held.length > 0,
    facts: async (e, args) => gitFacts((await e.commits()).held, (await e.commits()).unheld, args),
  },
  {
    kind: 'unmerged', says: "the step's own branch is in a repository, not merged into its base",
    fits: async e => (await e.traced()) !== null && (await e.ownUnmerged()) !== null,
    facts: async e => ({ notMerged: await e.ownUnmerged() }),
  },
  {
    kind: 'branch', says: "no commit named: the step's branch is, or was, in a repository, and merged",
    fits: async e => (await e.traced()) !== null,
    facts: async (e, args) => gitFacts([{ repo: await e.traced(), commit: null }], [], args),
  },
  {
    kind: 'unknown', says: "the step's branch may be in a repository whose git did not answer",
    fits: async e => !(await e.nowhere()),
    facts: unknownFacts,
  },
  {
    kind: 'outside', says: 'work outside git: a file the report names is there, outside every repository',
    fits: async e => ((await e.files())?.found.length ?? 0) > 0,
    facts: outsideFacts,
  },
  {
    kind: 'moot', says: 'no change: the report says nothing was needed, and why; its result check judges it, not git',
    fits: async e => e.noChange !== null,
    facts: mootFacts,
  },
  {
    kind: 'unmerged', says: 'work on another branch, not merged: its commits name the step, or it adds a file the report names',
    fits: async e => (await e.unmerged()) !== null,
    facts: async e => ({ notMerged: await e.unmerged() }),
  },
  {
    kind: 'outside', says: 'work outside git, and no file it names is there',
    fits: async e => (await e.files()) !== null,
    facts: outsideFacts,
  },
  { kind: 'unknown', says: 'none of the above: no repository can be told', fits: async () => true, facts: unknownFacts },
]

/**
 * T8: the kind of finished work a report is, with its evidence: `{ kind, id, head, facts }` (`head` the line that names the
 * kind, null for none; `facts` each `{ is, say }`, `is` one of ACTIONS), or `{ kind: 'unmerged', id, notMerged }`. The
 * evidence is looked at only as far as the rows ask (`once`). `args` as `reportCheck`.
 */
export async function finishedKind(args) {
  const { id, branch, result, merged, repos, run, project = '', touches = [], exists = null } = args
  const own = ownBranchOf(branch, repos)
  // Per repository, whether it has or had the step's own branch: true, false, or null where git did not answer.
  const branchIn = once(async () => {
    const found = []
    for (const repo of own === null ? [] : repos) found.push({ repo, had: await hadBranch(repo.dir, own, run) })
    return found
  })
  const e = {
    commits: once(async () => {
      const held = []
      const unheld = []
      for (const commit of commitsOf(merged)) {
        const repo = await repoHolding(commit, repos, run)
        if (repo === null) unheld.push(commit)
        else held.push({ repo, commit })
      }
      return { held, unheld }
    }),
    traced: once(async () => (await branchIn()).find(one => one.had === true)?.repo ?? null),
    // B580: the branch is in no repository and never was (every repository answered, none has a trace of it), or there is none.
    nowhere: once(async () => (await branchIn()).every(one => one.had === false)),
    ownUnmerged: once(async () => ownUnmerged(own, await e.traced(), run)),
    // B363: work outside git is checked by its files, when the board can look (`exists` and the project's folder).
    files: once(async () => (exists === null || project === '' ? null : filesNamed({ result, touches, project, repoDirs: repos.map(repo => repo.dir), exists }))),
    noChange: noChangeOf(result),
    unmerged: once(() => findUnmerged(args)),
  }
  for (const row of KINDS) if (await row.fits(e)) return { kind: row.kind, id, head: null, facts: [], ...(await row.facts(e, args)) }
  return { kind: 'unknown', id, head: null, facts: [fact('fail', `could not tell which repository ${id}'s work is in`)] }
}

/**
 * T8: the outcome of a report from its kind and facts (`finishedKind`), the one decision: the worst fact decides. pass or
 * warn: `{ passed: true, lines, warnings }` (the head and the pass lines; the warnings when there are some; `isHeld` when a
 * folder a program holds is among them, so the patient check looks again); back: `{ passed: false, lines }`, the first
 * fault starting with BACK (the step is back with its worker, resultCheck.mjs); fail: the faults as they are (the person
 * sees them); unmerged work: `{ passed: false, notMerged, lines: [the NOT_MERGED words] }`.
 */
export function finishedVerdict({ id = '', head = null, facts = [], notMerged = null }) {
  if (notMerged !== null) return { passed: false, notMerged, lines: [notMergedWords(id, notMerged)] }
  const at = Math.max(0, ...facts.map(one => ACTIONS.indexOf(one.is)))
  const says = kinds => facts.filter(one => kinds.includes(one.is)).map(one => one.say)
  const named = list => (head === null ? list : [head, ...list])
  if (at <= ACTIONS.indexOf('warn')) {
    const warnings = says(['warn'])
    return { passed: true, lines: named(says(['pass'])), ...(warnings.length === 0 ? {} : { warnings }), ...(facts.some(one => one.isHeld === true) ? { isHeld: true } : {}) }
  }
  const faults = says(['back', 'fail'])
  return { passed: false, lines: named(at === ACTIONS.indexOf('back') ? [`${BACK}${faults[0]}`, ...faults.slice(1)] : faults) }
}

/** The words that send a step back to its worker when its work is on a branch that is not merged (also the History line's reason). */
export const notMergedWords = (id, { branch, commits, base }) =>
  `${NOT_MERGED}Your work for ${id} is on branch ${branch} (${commits} commit${commits === 1 ? '' : 's'}) but not on ${base}: merge it into ${base}, then report again.`

/** Most unmerged branches of a repository looked through for the work (the rest are old leftovers). */
const BRANCHES_LOOKED_AT = 60

/** The branch `name` of the repository at `dir` with the commits its base lacks: `{ branch, commits, base, repo }`, or null for none. */
async function aheadOf(dir, base, name, run) {
  const count = String(await run(['-C', dir, 'rev-list', '--count', `${base}..${name}`]) ?? '').trim()
  return /^\d+$/.test(count) && Number(count) > 0 ? { branch: name, commits: Number(count), base, repo: nameOf(dir) } : null
}

/** T8: the step's own branch `own` in `repo`, not merged into its base and ahead of it (`aheadOf`), else null. */
async function ownUnmerged(own, repo, run) {
  if (own === null || repo === null) return null
  const unmerged = await run(['-C', repo.dir, 'for-each-ref', '--no-merged', repo.base, '--format=%(refname:short)', 'refs/heads'])
  return linesOf(unmerged).includes(own) ? aheadOf(repo.dir, repo.base, own, run) : null
}

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
    if (own !== '' && own !== '-' && open.includes(own)) {
      const one = await aheadOf(dir, base, own, run)
      if (one !== null) return one
    }
    // The step's own branch is there and merged (only not gone): its work is on the base, no other branch holds it.
    if (own !== '' && linesOf(heads).includes(own) && !open.includes(own)) continue
    let byFile = null
    for (const name of open.filter(one => one !== own).slice(0, BRANCHES_LOOKED_AT)) {
      const log = await run(['-C', dir, 'log', '--no-merges', '--fixed-strings', `--grep=${id}`, '--format=%x1e%B', `${base}..${name}`])
      if (String(log ?? '').split('\x1e').slice(1).some(message => named.test(message))) {
        const one = await aheadOf(dir, base, name, run)
        if (one !== null) return one
      }
      if (byFile === null && files.length > 0 && linesOf(await run(['-C', dir, 'diff', '--name-only', '--diff-filter=A', `${base}...${name}`])).some(path => isFile(plainPath(path).toLowerCase()))) byFile = await aheadOf(dir, base, name, run)
    }
    if (byFile !== null) return byFile
  }
  return null
}

/** 2026-10-25: a result the board cut at its limit passes with a warning that says so, first among the warnings. */
const cutFacts = cut => (cut === null || cut === undefined ? [] : [fact('warn', `the result was ${cut} characters: the board kept the first ${RESULT_CHARS} and cut the rest; put what matters first`)])

/**
 * A result is named (none: back to the worker); B569, 2026-10-25: the recap card's Context and Change are the board's to
 * build, so what is off in them is a warning.
 */
function resultFacts(result) {
  const isNamed = String(result ?? '').trim() !== ''
  const words = isNamed ? partsWarnings(result) : []
  return [isNamed ? fact('pass', 'result named') : fact('back', 'no result named'), ...words.map(one => fact('warn', one)), ...(isNamed && words.length === 0 ? [fact('pass', 'context and change named')] : [])]
}

/**
 * Worktree clean-up: each leftover line of the step's worktrees (worktrees.mjs `stepLeftovers`) as a fact. T8 (X114: B821
 * refused three times for an empty folder a program held): an EMPTY folder a worktree left (a program still holds it, or
 * git did not say whether a repository lists it) only warns: the board keeps trying in the background and its leftover
 * sweep removes it later; git or a folder that did not answer fails; any other leftover (a worktree, a folder with files)
 * goes back to the worker with how to remove it. `gone` adds "worktree gone" when nothing is left.
 */
function leftoverFacts(lines, gone = true) {
  if (lines.length === 0) return gone ? [fact('pass', 'worktree gone')] : []
  return lines.map(line => ({
    ...fact(/^the empty folder /.test(line) ? 'warn' : /^git did not answer\b|\bcould not be read$/.test(line) ? 'fail' : 'back', line),
    ...(isHeldLine(line) ? { isHeld: true } : {}),
  }))
}

/** The fact of a repository's base branch against its remote (one without a remote is let be; B404: git silent never passes). */
async function baseFact({ dir, base }, run) {
  const name = nameOf(dir)
  const [local, remote] = await Promise.all([run(['-C', dir, 'rev-parse', base]), run(['-C', dir, 'rev-parse', `origin/${base}`])])
  // B404: origin/<base> unread is "no remote" only when git names no origin; a failed or timed-out call never passes.
  const origins = local === null || remote !== null ? null : await run(['-C', dir, 'remote'])
  if (local === null) return fact('fail', `git did not answer for ${name}`)
  if (remote === null && origins === null) return fact('fail', `git did not answer for origin/${base} of ${name}`)
  if (remote === null && linesOf(origins).includes('origin')) return fact('fail', `origin/${base} of ${name} could not be read`)
  if (remote === null) return fact('pass', `${base} of ${name} has no remote`)
  // B598: which side is off, and the way out; the repair base-equal checks again by itself once they are equal.
  if (local.trim() !== remote.trim()) return fact('fail', await baseFault({ dir, base, name, run }))
  return fact('pass', `${base} of ${name} equals origin/${base}`)
}

/** The facts of the step's branch `own` in the repository at `dir`: gone from it and from its remote (left: back to the worker). */
async function branchFacts(dir, own, run) {
  const name = nameOf(dir)
  const [branches, remotes] = await Promise.all([readBranches([dir], run), run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes'])])
  if (branches === null) return [fact('fail', `git did not answer: the branches of ${name} are not known`)]
  if (branches.includes(own)) return [fact('back', `the branch ${own} is still there`)]
  const left = linesOf(remotes).find(ref => ref.endsWith(`/${own}`))
  return left === undefined ? [] : [fact('back', `the branch ${own} is still on ${left.split('/')[0]} of ${name}`)]
}

/**
 * The facts of work in git (kinds merged and branch): `held` the repositories with the commits of the step in them
 * (`commit` null for a branch with no commit named), `unheld` the named commits no repository holds. In every repository
 * of the work (T8: several for work merged in several, each checked): its base equals its remote, the step's branch is
 * gone (the review of B363: work merged on a repository's base branch itself has no branch of its own to be gone), no
 * worktree of the step is left; a result is named; B527: a change that touches a test file names the mutant its tests
 * caught (without it the step passes with a warning, and the partner's result check asks for one).
 */
async function gitFacts(held, unheld, { id, branch, result, merged, repos, run, project = '', fs = null, cut = null, inline = false, waits }) {
  const found = []
  for (const { repo, commit } of held) {
    const at = found.find(one => one.repo.dir === repo.dir)
    if (at === undefined) found.push({ repo, commits: commit === null ? [] : [commit] })
    else if (commit !== null) at.commits.push(commit)
  }
  const facts = cutFacts(cut)
  for (const { repo } of found) facts.push(await baseFact(repo, run))
  for (const commit of unheld) facts.push(fact('back', `the commit ${commit} is in no repository the board knows: name in merged only the commits on a base branch`))
  const own = typeof branch === 'string' ? branch.trim() : ''
  const isOnBase = own !== '' && found.some(({ repo }) => repo.base === own)
  if (own !== '' && !isOnBase) for (const { repo } of found) facts.push(...await branchFacts(repo.dir, own, run))
  facts.push(fact('pass', isOnBase ? `worked on ${own} itself` : 'branch gone'))
  // Worktree clean-up: no worktree on the step's branch in any repository of the work, and none (or its folder) named for the step.
  const left = []
  for (const [at, { repo }] of found.entries()) {
    const lines = await stepLeftovers({ id, branch: isOnBase ? null : branch, repo, repos, project, run, fs: at === 0 ? fs : null, inline, ...(waits === undefined ? {} : { waits }) })
    for (const line of lines) if (!left.includes(line)) left.push(line)
  }
  facts.push(...leftoverFacts(left), ...resultFacts(result))
  const tests = []
  for (const { repo, commits } of found) {
    for (const commit of commits.length === 0 ? [merged] : commits) {
      for (const path of (await stepFiles({ id, branch, merged: commit, dir: repo.dir, run })).filter(isTestFile)) if (!tests.includes(path)) tests.push(path)
    }
  }
  if (tests.length > 0) facts.push(hasBite(result) ? fact('pass', 'tests bite named') : fact('warn', noMutantWords(tests)))
  return { head: `work in ${found.map(({ repo }) => nameOf(repo.dir)).join(' and ')}`, facts }
}

/** The facts when no repository can be told (Principle 3: never a silent pass): a failure the person sees. */
async function unknownFacts(e, { id, result, repos, project = '', run, fs = null, inline = false, waits }) {
  const left = await stepLeftovers({ id, branch: null, repo: null, repos, project, run, fs, inline, ...(waits === undefined ? {} : { waits }) })
  return { head: null, facts: [fact('fail', `could not tell which repository ${id}'s work is in`), ...leftoverFacts(left, false), ...resultFacts(result)] }
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

/**
 * B818, T8: the second line of the "no file named" refusal: a step whose work other steps already built is reported as
 * no change, with the steps that built it (kind moot), never asked about.
 */
export const NOTHING_BUILT_LINE = 'nothing built because it already exists? Report it again opening the Change with "No change: <the steps that built it, with their merged commits>"'

/**
 * B363: the files a report of work outside git names, weighed in the project's folder outside every repository
 * (`repoDirs`): `{ planned, said, found, missing, inGit }`, `planned` and `said` each `{ found, missing, inGit }` for the
 * step's Touches and the result. A file in a repository is work in git, reported with its merged commit. 2026-10-25
 * ("check the work, not the wording", and the review of the same day): the result's prose misread words such as
 * "done/level.md" as a file (X57), and Touches is a plan written before the work that the worker cannot edit, so a path
 * of either that is not there only warns once a file is there; one in a repository in Touches alone (a wide plan) warns
 * too. `exists(path)` answers whether a path is there.
 */
async function filesNamed({ result, touches, project, repoDirs, exists }) {
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
  // A repository file the result names is work in git; one only Touches names is a plan, a fact only when nothing else is there.
  return { planned, said, found, missing: once([...planned.missing, ...said.missing]), inGit: once([...said.inGit, ...(found.length === 0 ? planned.inGit : [])]) }
}

/**
 * B363: the facts of work outside git: a file the report names is there (`filesNamed`); none there, a file in a repository
 * named by the result, or no file named at all goes back to the worker; a Touches path or a path in the prose that is not
 * there beside one that is warns. The step's worktrees left, as for any kind.
 */
async function outsideFacts(e, { id, result, repos, project = '', run, fs = null, cut = null, inline = false, waits }) {
  const { planned, said, found, missing, inGit } = await e.files()
  const facts = cutFacts(cut)
  if (found.length === 0 && missing.length > 0) facts.push(fact('back', `not there: ${missing.join(', ')}`))
  if (inGit.length > 0) facts.push(fact('back', `in a repository: ${inGit.join(', ')}; report that work with its merged commit`))
  // B818 (X106): a report that names no file of its own is often a step whose work other steps already built.
  if (found.length === 0 && missing.length === 0 && inGit.length === 0) facts.push(fact('back', 'no file named: name the files it made in the result'), fact('back', NOTHING_BUILT_LINE))
  facts.push(fact('pass', `there: ${found.join(', ')}`))
  facts.push(...leftoverFacts(await stepLeftovers({ id, repos, project, run, fs, inline, ...(waits === undefined ? {} : { waits }) }), false))
  facts.push(...resultFacts(result))
  if (planned.missing.length > 0) facts.push(fact('warn', `Touches names files not there: ${planned.missing.join(', ')}`))
  if (found.length > 0 && planned.inGit.length > 0) facts.push(fact('warn', `Touches names files in a repository: ${planned.inGit.join(', ')}`))
  const saidMissing = said.missing.filter(path => !planned.missing.includes(path))
  if (saidMissing.length > 0) facts.push(fact('warn', `the result names ${saidMissing.join(', ')}, which ${saidMissing.length === 1 ? 'is' : 'are'} not there`))
  return { head: 'work outside git', facts }
}

/** T8: the line a report of no change goes back with when it names no reason. */
export const NO_REASON_LINE = 'no change made, and no reason named: open the Change with "No change: <the steps that built it, or the decision that made it moot>", then report again'
/** T8: the warning a report of no change passes with: the result check judges it (its Quality Assurance task carries it). */
export const noChangeWords = reason => `no change made: the result check judges whether nothing was needed (${reason.length > 200 ? `${reason.slice(0, 200).trim()}…` : reason})`

/**
 * T8 (B436, B799, X106, X113): the facts of a step with no change (kind moot): its reason, which its result check judges,
 * never git or the files it names (a step whose work other steps built names their files, in a repository). No reason
 * goes back to the worker; the step's worktrees left, as for any kind.
 */
async function mootFacts(e, { id, result, repos, project = '', run, fs = null, cut = null, inline = false, waits }) {
  const { reason } = e.noChange
  const facts = cutFacts(cut)
  facts.push(reason === null ? fact('back', NO_REASON_LINE) : fact('pass', 'reason named'))
  if (reason !== null) facts.push(fact('warn', noChangeWords(reason)))
  facts.push(...leftoverFacts(await stepLeftovers({ id, repos, project, run, fs, inline, ...(waits === undefined ? {} : { waits }) })))
  facts.push(...resultFacts(result))
  return { head: 'no change made (moot)', facts }
}

/** How many times, and how far apart (ms), the report check looks again at a folder a program still holds. */
export const HELD_ROUNDS = 6
export const HELD_EVERY_MS = 10_000

/**
 * The report check as the board's background loop runs it (nobody waits on it): the empty folder a worktree left is tried
 * for a few seconds inside the check (`inline`); when a program still holds it (`isHeld`: the check passes with it as a
 * warning, T8), the check looks again after `every` ms, up to `rounds` times, so a folder that frees itself leaves no
 * warning. Only then is it filed. `sleep` is the clock's wait (a test's own). The outcome has no `isHeld`: it is the
 * board's own word between the rounds.
 */
export async function patientReportCheck(args, { rounds = HELD_ROUNDS, every = HELD_EVERY_MS, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let outcome = await reportCheck({ ...args, inline: true })
  for (let round = 0; round < rounds && outcome.isHeld === true; round += 1) {
    await sleep(every)
    outcome = await reportCheck({ ...args, inline: true })
  }
  const { isHeld, ...filed } = outcome
  return filed
}
