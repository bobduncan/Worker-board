// B297: the board's own check after a chat reports a step (flow.json's `then` of the move to review: "check: base
// equals remote, branch gone, result named"). It asks git, never a chat; its outcome goes into the step's History
// through the API's `check`, and with the default flow a passed check closes the step.
//
// B304: the check is of the repository the step's work is in, not of every repository the board knows: the one that
// holds the reported merged commit, else the one that has (or had, by its reflog or its remote) the step's branch.
// When none can be told, the check fails and says so; it never passes in silence. A repository is named by its
// folder's last part.

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

/** The repository of `repos` the step's work is in, or null when it cannot be told. */
export async function repoOfStep({ branch, merged, repos, run }) {
  const commit = String(merged ?? '').trim()
  if (/^[0-9a-f]{4,40}$/i.test(commit)) {
    for (const repo of repos) if (await run(['-C', repo.dir, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`]) !== null) return repo
  }
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
export async function reportCheck({ id, branch, result, merged, repos, run }) {
  const faults = []
  const passed = []
  const repo = await repoOfStep({ branch, merged, repos, run })
  if (repo === null) faults.push(`could not tell which repository ${id}'s work is in`)
  else {
    const name = nameOf(repo.dir)
    const { dir, base } = repo
    const [local, remote] = await Promise.all([run(['-C', dir, 'rev-parse', base]), run(['-C', dir, 'rev-parse', `origin/${base}`])])
    if (local === null) faults.push(`git did not answer for ${name}`)
    else if (remote === null) passed.push(`${base} of ${name} has no remote`)
    else if (local.trim() !== remote.trim()) faults.push(`${base} of ${name} is not the same as origin/${base}`)
    else passed.push(`${base} of ${name} equals origin/${base}`)
    if (typeof branch === 'string' && branch.trim() !== '') {
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
  return failed.length === 0 ? { passed: true, lines: [...passed, 'branch gone', 'result named'] } : { passed: false, lines: faults }
}
