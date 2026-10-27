import assert from 'node:assert/strict'
import test from 'node:test'

import { cached, parseWorktrees, readFolders } from '../src/folders.mjs'

const LIST = `worktree D:/Work/game/lava
HEAD c18808df0996cbeb51a0d7fbca46bda884c51ef7
branch refs/heads/main

worktree D:/Work/game/lava-beast
HEAD 8e02ecccdbe4ddb2444e6ecf7a46635d7d732ef0
branch refs/heads/feature/shadow-beast

worktree D:/Work/game/lava-probe
HEAD 713092dae97504dab3e83a6a02b12fafee6c7c71
detached
`

test('parseWorktrees reads three folders from the porcelain text', () => {
  assert.deepEqual(parseWorktrees(LIST.replace(/\n/g, '\r\n')), [
    { path: 'D:/Work/game/lava', head: 'c18808df0996cbeb51a0d7fbca46bda884c51ef7', branch: 'main' },
    { path: 'D:/Work/game/lava-beast', head: '8e02ecccdbe4ddb2444e6ecf7a46635d7d732ef0', branch: 'feature/shadow-beast' },
    { path: 'D:/Work/game/lava-probe', head: '713092dae97504dab3e83a6a02b12fafee6c7c71', branch: null },
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
    '-C D:/Work/game/lava worktree list --porcelain': LIST,
    '-C D:/Work/game/lava status --porcelain': '',
    '-C D:/Work/game/lava log -1 --format=%ct %h %s': '1791790000 b0c4559 Merge the camera that fits the map\n',
    '-C D:/Work/game/lava-beast status --porcelain': ' M src/a.ts\n?? notes.txt\n',
    '-C D:/Work/game/lava rev-list --count main..feature/shadow-beast': '5\n',
    '-C D:/Work/game/lava-beast log -1 --format=%ct %h %s': '1791795000 1a2b3c4\n',
  })
  assert.deepEqual(await readFolders('D:/Work/game/lava', run), [
    { path: 'D:/Work/game/lava', name: 'lava', branch: 'main', ahead: 0, uncommitted: 0, lastCommitAt: 1791790000000, lastCommit: { hash: 'b0c4559', subject: 'Merge the camera that fits the map' } },
    { path: 'D:/Work/game/lava-beast', name: 'beast', branch: 'feature/shadow-beast', ahead: 5, uncommitted: 2, lastCommitAt: 1791795000000, lastCommit: { hash: '1a2b3c4', subject: '' } },
    { path: 'D:/Work/game/lava-probe', name: 'probe', branch: null, ahead: null, uncommitted: null, lastCommitAt: null, lastCommit: null },
  ])
})

test('readFolders answers null when git does not answer at all', async () => {
  assert.equal(await readFolders('D:/Work/game/lava', fakeGit({}).run), null)
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
  gates.shift()()
  assert.equal(await before, 1)
  await new Promise(done => setImmediate(done))
  gates.shift()()
  assert.equal(await after, 2)
  assert.equal(await read(), 2)
})

test('B736: resets while a read is under way never start a second read beside it: one waits for it, shared by every caller', async () => {
  let count = 0
  let running = 0
  let most = 0
  const gates = []
  const read = cached(() => new Promise(resolve => {
    count += 1
    running += 1
    most = Math.max(most, running)
    const mine = count
    gates.push(() => { running -= 1; resolve(mine) })
  }), 60_000, () => 0)
  const first = read()
  const waiting = []
  for (let i = 0; i < 5; i += 1) {
    read.reset()
    waiting.push(read())
  }
  assert.equal(count, 1)
  gates.shift()()
  assert.equal(await first, 1)
  await new Promise(done => setImmediate(done))
  assert.equal(count, 2)
  gates.shift()()
  assert.deepEqual(await Promise.all(waiting), [2, 2, 2, 2, 2])
  assert.equal(most, 1)
})

test('B736: last gives the newest answer without waiting for a read, also one asked for before a reset', async () => {
  let count = 0
  const gates = []
  const read = cached(() => new Promise(resolve => { count += 1; const mine = count; gates.push(() => resolve(mine)) }), 60_000, () => 0)
  assert.equal(read.last(), undefined)
  const first = read()
  read.reset()
  gates.shift()()
  await first
  assert.equal(read.last(), 1)
  const second = read()
  assert.equal(read.last(), 1)
  await new Promise(done => setImmediate(done))
  gates.shift()()
  await second
  assert.equal(read.last(), 2)
})

test('cached shares one read between callers that ask at the same moment', async () => {
  let count = 0
  const read = cached(async () => { count += 1; return count }, 60_000, () => 0)
  assert.deepEqual(await Promise.all([read(), read()]), [1, 1])
})
