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

test('the command prints the counts and refuses a folder that is not empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-command-'))
  try {
    const first = command('--backlog', FIXTURE, '--work', dir)
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.match(first.stdout, /^Steps: 19 on the backlog, 19 in the store$/m)
    assert.match(first.stdout, /^Open: 14 · done: 5 · for you \(open\): 4$/m)
    assert.match(first.stdout, /^Parity with the backlog: yes/m)
    assert.match(first.stdout, /^ {2}B11 \| queued \| Support \| - \| today's board work$/m)
    assert.ok((await readdir(dir)).includes('B10.md'))
    const second = command('--backlog', FIXTURE, '--work', dir)
    assert.equal(second.status, 1)
    assert.match(second.stdout, /is not empty: the migration writes only into an empty folder/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the dry run writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'work-command-'))
  try {
    await writeFile(join(dir, 'keep.txt'), 'here before')
    const dry = command('--backlog', FIXTURE, '--work', dir, '--dry-run')
    assert.equal(dry.status, 0, dry.stdout + dry.stderr)
    assert.match(dry.stdout, /^Dry run: would write 19 item files/m)
    assert.deepEqual(await readdir(dir), ['keep.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('--cutover is not in this version', () => {
  const cut = command('--backlog', FIXTURE, '--work', tmpdir(), '--cutover')
  assert.equal(cut.status, 2)
  assert.match(cut.stdout, /not in this version/)
})
