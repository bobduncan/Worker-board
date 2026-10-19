import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOL = join(HERE, '..', '..', 'tools', 'migrate-backlog.mjs')
const FIXTURE = join(HERE, 'fixtures', 'backlog-small.md')
const command = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })

test('without a mode the command prints the counts and what a store would hold, and writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-command-'))
  try {
    const first = command('--backlog', FIXTURE, '--work', dir)
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.match(first.stdout, /^Steps: 19 on the backlog, 19 in the store$/m)
    assert.match(first.stdout, /^Open: 14 · done: 5 · for you \(open\): 4$/m)
    assert.match(first.stdout, /^Parity with the backlog: yes/m)
    assert.match(first.stdout, /^ {2}B11 \| queued \| Support \| - \| today's board work$/m)
    assert.match(first.stdout, /^Nothing written: --make-store makes the store in .* \(19 item files\)\.$/m)
    assert.deepEqual(await readdir(dir), [])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('--make-store and --init refuse a folder that is not empty and write nothing into it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-command-'))
  try {
    await writeFile(join(dir, 'keep.txt'), 'here before')
    const make = command('--backlog', FIXTURE, '--work', dir, '--make-store')
    assert.equal(make.status, 1)
    assert.match(make.stdout, /is not empty: the store is made only in an empty folder/)
    const init = command('--work', dir, '--init')
    assert.equal(init.status, 1)
    assert.deepEqual(await readdir(dir), ['keep.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('without a backlog or a folder the command says how to call it', () => {
  for (const args of [[], ['--make-store'], ['--work']]) {
    const said = command(...args)
    assert.equal(said.status, 2)
    assert.match(said.stdout, /^Usage: /m)
  }
})
