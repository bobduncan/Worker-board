// B297: the board's own check after a chat reports a step (flow.json's `then` of the move to review: "check: base
// equals remote, branch gone, result named"). It asks git, never a chat; its outcome goes into the step's History
// through the API's `check`, and with the default flow a passed check closes the step.
//
// B304: the check is of the repository the step's work is in, not of every repository the board knows: the one that
// holds the reported merged commit, else the one that has (or had, by its reflog or its remote) the step's branch.
// When none can be told, the check fails and says so; it never passes in silence. A repository is named by its
// folder's last part.

import { join } from 'node:path'

import { readBranches } from '../folders.mjs'

/** A folder's last part, for Windows and other paths alike. */
const nameOf = dir => String(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop()
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const linesOf = answer => (typeof answer === 'string' ? answer.split('\n').map(one => one.trim()).filter(one => one !== '') : [])

/** Whether the repository has, or had, the branch: as a branch, on a remote, or in a reflog line that names it. */
async function hadBranch(dir, branch, run) {
  const [local, remote, log] = await Promise.all([
    run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    run(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    run(['-C', dir, 'log', '-g', '--all', '--format=%gs']),
  ])
  const named = new RegExp(`(?:^|[\\s'"/])${escape(branch)}(?:$|[\\s:'"])`)
  return linesOf(local).includes(branch) || linesOf(remote).some(ref => ref.endsWith(`/${branch}`)) || linesOf(log).some(one => named.test(one))
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
 * `{ passed, lines }` for a reported step `id`: the repository its work is in (`repoOfStep`) has its base branch where
 * its remote has it (one without a remote is let be), the step's branch is gone from it and from its remote, and the
 * report names a result. A passed check names each part; a failed one the repository and its faults. `run` runs git
 * with the given arguments and answers its output or null (folders.mjs, `gitRunner`).
 */
export async function reportCheck({ id, branch, result, merged, repos, run, project = '', touches = [], exists = null }) {
  // B363: work outside git (no branch of its own, no merged commit a repository holds): its files are checked instead.
  const own = typeof branch === 'string' ? branch.trim() : ''
  const isOwnBranch = own !== '' && own !== '-' && own.toLowerCase() !== 'none' && !repos.some(repo => repo.base === own)
  if (!isOwnBranch && exists !== null && project !== '' && await repoOfCommit(merged, repos, run) === null) {
    return outsideCheck({ result, touches, project, repoDirs: repos.map(repo => repo.dir), exists })
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
    if (local === null) faults.push(`git did not answer for ${name}`)
    else if (remote === null) passed.push(`${base} of ${name} has no remote`)
    else if (local.trim() !== remote.trim()) faults.push(`${base} of ${name} is not the same as origin/${base}`)
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
  if (String(result ?? '').trim() === '') faults.push('no result named')
  const failed = faults.filter(line => !line.startsWith('work in '))
  return failed.length === 0 ? { passed: true, lines: [...passed, isOnBase ? `worked on ${branch.trim()} itself` : 'branch gone', 'result named'] } : { passed: false, lines: faults }
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
 * B363: the check of a step whose work is outside git: the files its report's result names (else, when none of those
 * is a file for certain or there, those its Touches name) are there in the project's folder, outside every repository
 * (`repoDirs`): a file in a repository is work in git, reported with its merged commit. `exists(path)` answers whether
 * a path is there.
 */
async function outsideCheck({ result, touches, project, repoDirs, exists }) {
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
  let seen = await weigh(pathsIn(result, project))
  if (seen.found.length + seen.missing.length + seen.inGit.length === 0) seen = await weigh(pathsIn((Array.isArray(touches) ? touches : [touches]).join('\n'), project))
  const { found, missing, inGit } = seen
  const lines = ['work outside git']
  if (missing.length > 0) lines.push(`not there: ${missing.join(', ')}`)
  if (inGit.length > 0) lines.push(`in a repository: ${inGit.join(', ')}; report that work with its merged commit`)
  if (missing.length + inGit.length === 0 && found.length === 0) lines.push('no file named: name the files it made in the result')
  if (String(result ?? '').trim() === '') lines.push('no result named')
  return lines.length === 1 ? { passed: true, lines: [...lines, `there: ${found.join(', ')}`, 'result named'] } : { passed: false, lines }
}
