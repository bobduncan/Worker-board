// B947: the removal tool takes a task folder away without following a link in it. Real folders and a real junction in a
// temporary folder; git is a stand-in that, like git, removes the worktree's folder.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { removeTaskFolder } from '../tools/remove-task-folder.mjs'

/** A task folder `<tmp>/game-b1` with a junction `node_modules` to `<tmp>/packages` (three files) and a file of its own. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'b947-tool-'))
  const packages = join(root, 'packages')
  mkdirSync(packages)
  for (const name of ['a.js', 'b.js', 'c.js']) writeFileSync(join(packages, name), name)
  const folder = join(root, 'game-b1')
  mkdirSync(folder)
  writeFileSync(join(folder, 'own.txt'), 'own')
  symlinkSync(packages, join(folder, 'node_modules'), 'junction')
  return { root, packages, folder, repo: join(root, 'game') }
}

/** Git as the tool uses it: records each call; `worktree remove` removes the folder as git does (never --force). */
function fakeGit(seen, folder) {
  return async args => {
    seen.push({ args, junction: existsSync(join(folder, 'node_modules')) })
    if (args.includes('remove')) {
      if (existsSync(join(folder, 'node_modules'))) return { ok: false, why: 'git followed the link' }
      await rm(folder, { recursive: true })
    }
    return { ok: true, why: null }
  }
}

const noHolders = async () => []
const isWorktree = repo => async () => `${repo.replace(/\\/g, '/')}/.git`

test('a task folder with the junction goes away and the junction target keeps its entries', async () => {
  const { root, packages, folder, repo } = fixture()
  try {
    const seen = []
    const { ok, lines } = await removeTaskFolder(folder, { git: fakeGit(seen, folder), read: isWorktree(repo), holders: noHolders })
    assert.equal(ok, true, lines.join(' | '))
    assert.equal(existsSync(folder), false)
    assert.deepEqual(readdirSync(packages).sort(), ['a.js', 'b.js', 'c.js'])
    const removal = seen.find(call => call.args.includes('remove'))
    assert.equal(removal.junction, false, 'the link went before git removed the worktree')
    assert.equal(removal.args.includes('--force'), false)
    assert.ok(seen.some(call => call.args.includes('prune')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a program standing in the folder stops it: nothing is removed, the link stays', async () => {
  const { root, folder, repo } = fixture()
  try {
    const seen = []
    const holders = async () => [{ pid: 4242, name: 'node.exe', parent: 'bash.exe', command: 'vite --port 5393' }]
    const { ok, lines } = await removeTaskFolder(folder, { git: fakeGit(seen, folder), read: isWorktree(repo), holders })
    assert.equal(ok, false)
    assert.match(lines.at(-1), /node\.exe 4242/)
    assert.equal(existsSync(join(folder, 'node_modules')), true)
    assert.equal(seen.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a link below the top level is taken away too', async () => {
  const { root, packages, folder, repo } = fixture()
  try {
    mkdirSync(join(folder, 'deep'))
    symlinkSync(packages, join(folder, 'deep', 'more'), 'junction')
    const { ok, lines } = await removeTaskFolder(folder, { git: fakeGit([], folder), read: isWorktree(repo), holders: noHolders })
    assert.equal(ok, true, lines.join(' | '))
    assert.deepEqual(readdirSync(packages).sort(), ['a.js', 'b.js', 'c.js'])
    assert.equal(existsSync(folder), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a folder that is no worktree loses its links and is left to the caller', async () => {
  const { root, packages, folder } = fixture()
  try {
    const seen = []
    const { ok, lines } = await removeTaskFolder(folder, { git: fakeGit(seen, folder), read: async () => null, holders: noHolders })
    assert.equal(ok, true)
    assert.match(lines.at(-1), /no git worktree/)
    assert.equal(existsSync(join(folder, 'node_modules')), false)
    assert.equal(existsSync(join(folder, 'own.txt')), true)
    assert.deepEqual(readdirSync(packages).sort(), ['a.js', 'b.js', 'c.js'])
    assert.equal(seen.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a folder that is itself a link is never removed by the tool', async () => {
  const { root, packages, folder } = fixture()
  try {
    const { ok, lines } = await removeTaskFolder(join(folder, 'node_modules'), { git: fakeGit([], folder), read: async () => null, holders: noHolders })
    assert.equal(ok, false)
    assert.match(lines.at(-1), /is a link/)
    assert.deepEqual(readdirSync(packages).sort(), ['a.js', 'b.js', 'c.js'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a folder that is gone is no failure', async () => {
  const { ok, lines } = await removeTaskFolder(join(tmpdir(), 'b947-not-there'), { git: async () => ({ ok: true }), read: async () => null, holders: noHolders })
  assert.equal(ok, true)
  assert.match(lines[0], /already gone/)
})

test('the target losing entries while the folder goes is named at once', async () => {
  const { root, packages, folder, repo } = fixture()
  try {
    const git = async args => {
      if (args.includes('remove')) {
        rmSync(join(packages, 'a.js'))
        await rm(folder, { recursive: true })
      }
      return { ok: true, why: null }
    }
    const { ok, lines } = await removeTaskFolder(folder, { git, read: isWorktree(repo), holders: noHolders })
    assert.equal(ok, false)
    assert.match(lines.at(-1), /held 3 entries before and 2 now/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
