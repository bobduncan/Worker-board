import assert from 'node:assert/strict'
import test from 'node:test'

import { cached, parseWorktrees, readFolders } from '../src/folders.mjs'

const LIST = `worktree C:/Web/game/lava
HEAD c18808df0996cbeb51a0d7fbca46bda884c51ef7
branch refs/heads/main

worktree C:/Web/game/lava-beast
HEAD 8e02ecccdbe4ddb2444e6ecf7a46635d7d732ef0
branch refs/heads/feature/shadow-beast

worktree C:/Web/game/lava-probe
HEAD 713092dae97504dab3e83a6a02b12fafee6c7c71
detached
`

test('parseWorktrees reads three folders from the porcelain text', () => {
  assert.deepEqual(parseWorktrees(LIST.replace(/\n/g, '\r\n')), [
    { path: 'C:/Web/game/lava', head: 'c18808df0996cbeb51a0d7fbca46bda884c51ef7', branch: 'main' },
    { path: 'C:/Web/game/lava-beast', head: '8e02ecccdbe4ddb2444e6ecf7a46635d7d732ef0', branch: 'feature/shadow-beast' },
    { path: 'C:/Web/game/lava-probe', head: '713092dae97504dab3e83a6a02b12fafee6c7c71', branch: null },
  ])
  assert.deepEqual(parseWorktrees(''), [])
})

function fakeGit(answers) {
  const calls = []
  const run = async args => {
    calls.push(args.join(' '))
    const answer = answers[args.join(' ')]
    return answer === undefined ? null : answer
  }
  return { run, calls }
}

test('readFolders asks git about each folder and counts what it answers', async () => {
  const { run } = fakeGit({
    '-C C:/Web/game/lava worktree list --porcelain': LIST,
    '-C C:/Web/game/lava status --porcelain': '',
    '-C C:/Web/game/lava log -1 --format=%ct': '1791790000\n',
    '-C C:/Web/game/lava-beast status --porcelain': ' M src/a.ts\n?? notes.txt\n',
    '-C C:/Web/game/lava rev-list --count main..feature/shadow-beast': '5\n',
    '-C C:/Web/game/lava-beast log -1 --format=%ct': '1791795000\n',
  })
  assert.deepEqual(await readFolders('C:/Web/game/lava', run), [
    { path: 'C:/Web/game/lava', name: 'lava', branch: 'main', ahead: 0, uncommitted: 0, lastCommitAt: 1791790000000 },
    { path: 'C:/Web/game/lava-beast', name: 'beast', branch: 'feature/shadow-beast', ahead: 5, uncommitted: 2, lastCommitAt: 1791795000000 },
    { path: 'C:/Web/game/lava-probe', name: 'probe', branch: null, ahead: null, uncommitted: null, lastCommitAt: null },
  ])
})

test('readFolders answers null when git does not answer at all', async () => {
  assert.equal(await readFolders('C:/Web/game/lava', fakeGit({}).run), null)
})

test('cached asks again only after the time is up', async () => {
  let now = 1000
  let count = 0
  const read = cached(async () => { count += 1; return count }, 60_000, () => now)
  assert.equal(await read(), 1)
  now += 59_000
  assert.equal(await read(), 1)
  now += 2_000
  assert.equal(await read(), 2)
})

test('cached reads again after a reset, also when a read was under way', async () => {
  let count = 0
  const gates = []
  const read = cached(() => new Promise(resolve => { count += 1; const mine = count; gates.push(() => resolve(mine)) }), 60_000, () => 0)
  const before = read()
  read.reset()
  const after = read()
  gates.forEach(open => open())
  assert.deepEqual(await Promise.all([before, after]), [1, 2])
  assert.equal(await read(), 2)
})

test('cached shares one read between callers that ask at the same moment', async () => {
  let count = 0
  const read = cached(async () => { count += 1; return count }, 60_000, () => 0)
  assert.deepEqual(await Promise.all([read(), read()]), [1, 1])
})
