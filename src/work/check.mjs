// B297: the board's own check after a chat reports a step (flow.json's `then` of the move to review: "check: base
// equals remote, branch gone, result named"). It asks git, never a chat; its outcome goes into the step's History
// through the API's `check`, and with the default flow a passed check closes the step.

import { basename } from 'node:path'

import { readBranches } from '../folders.mjs'

/**
 * `{ passed, lines }` for a reported step: each repository's base branch is where its remote has it (a repository
 * without a remote is let be), the step's branch is in none of them any more, and the report names a result. `run`
 * runs git with the given arguments and answers its output or null (folders.mjs, `gitRunner`).
 */
export async function reportCheck({ branch, result, repos, run }) {
  const failed = []
  for (const { dir, base } of repos) {
    const [local, remote] = await Promise.all([run(['-C', dir, 'rev-parse', base]), run(['-C', dir, 'rev-parse', `origin/${base}`])])
    if (local === null) failed.push(`git did not answer for ${basename(dir)}`)
    else if (remote !== null && local.trim() !== remote.trim()) failed.push(`${base} of ${basename(dir)} is not the same as origin/${base}`)
  }
  if (branch !== null && branch !== undefined) {
    const branches = repos.length === 0 ? [] : await readBranches(repos.map(repo => repo.dir), run)
    if (branches === null) failed.push('git did not answer: the branches are not known')
    else if (branches.includes(branch)) failed.push(`the branch ${branch} is still there`)
  }
  if (String(result ?? '').trim() === '') failed.push('no result named')
  return failed.length === 0 ? { passed: true, lines: ['base equals remote', 'branch gone', 'result named'] } : { passed: false, lines: failed }
}
