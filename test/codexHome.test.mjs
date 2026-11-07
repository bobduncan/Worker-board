// Every Codex picture job runs with a clean CODEX_HOME of the board's own: no hooks, notify, plugins, MCP servers or
// marketplaces of the person's setup (they flash windows and steal focus). The tests use stand-ins and temp folders.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CLEAN_HOME, makePicture, prepareCodexHome, userCodexHome } from '../src/codex.mjs'

const FAKE = [process.execPath, join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-codex.mjs')]
const USER_CONFIG = `model = "gpt-x"
model_reasoning_effort = "high"
notify = ["codex-computer-use.exe", "turn-ended"]

[hooks]
x = 1

[plugins."computer-use@bundled"]
enabled = true

[mcp_servers.node_repl]
command = "node"

[marketplaces.my-mods]
source = "x"

[windows]
sandbox = "elevated"
`

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'board-codexhome-test-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const user = join(root, 'user')
  await mkdir(user)
  await writeFile(join(user, 'config.toml'), USER_CONFIG)
  await writeFile(join(user, 'auth.json'), '{"fake":"token"}')
  await writeFile(join(user, 'cap_sid'), 'S-1-fake')
  await writeFile(join(user, 'hooks.json'), '{"hooks":{}}')
  return { root, user, clean: join(root, 'data', 'codex-home') }
}

const snapshot = async dir => {
  const out = {}
  for (const name of await readdir(dir)) {
    const info = await stat(join(dir, name))
    out[name] = [info.size, info.mtimeMs, await readFile(join(dir, name), 'utf8')]
  }
  return out
}

test('the spawn gets CODEX_HOME = the clean folder, not the person\'s', async t => {
  const { root, user, clean } = await setup(t)
  const log = join(root, 'log.json')
  process.env.FAKE_CODEX_LOG = log
  t.after(() => { delete process.env.FAKE_CODEX_LOG })
  const made = await makePicture({ command: FAKE, prompt: 'x', images: [], to: join(root, 'v1.png'), seconds: 20, codexHome: clean, userHome: user })
  assert.equal(made.ok, true)
  const seen = JSON.parse(await readFile(log, 'utf8'))
  assert.equal(seen.codexHome, clean)
  assert.notEqual(seen.codexHome, user)
})

test('the clean config.toml holds the model and effort only', async t => {
  const { user, clean } = await setup(t)
  await prepareCodexHome({ home: clean, userHome: user })
  const text = await readFile(join(clean, 'config.toml'), 'utf8')
  const sandbox = process.platform === 'win32' ? '\n[windows]\nsandbox = "elevated"\n' : ''
  assert.equal(text, 'model = "gpt-x"\nmodel_reasoning_effort = "high"\n' + sandbox)
  for (const word of ['notify', 'hook', 'plugins', 'mcp_servers', 'marketplaces', 'computer']) assert.ok(!text.includes(word), word)
  assert.equal(await readFile(join(clean, 'cap_sid'), 'utf8'), 'S-1-fake')
})

test('auth.json is copied when missing or older, and the source is never written', async t => {
  const { user, clean } = await setup(t)
  const before = await snapshot(user)
  await prepareCodexHome({ home: clean, userHome: user })
  assert.equal(await readFile(join(clean, 'auth.json'), 'utf8'), '{"fake":"token"}')
  // An older copy is replaced, a newer one is kept.
  await writeFile(join(clean, 'auth.json'), 'old')
  await utimes(join(clean, 'auth.json'), new Date(2000, 1, 1), new Date(2000, 1, 1))
  await prepareCodexHome({ home: clean, userHome: user })
  assert.equal(await readFile(join(clean, 'auth.json'), 'utf8'), '{"fake":"token"}')
  await writeFile(join(clean, 'auth.json'), 'newer')
  await utimes(join(clean, 'auth.json'), new Date(2100, 1, 1), new Date(2100, 1, 1))
  await prepareCodexHome({ home: clean, userHome: user })
  assert.equal(await readFile(join(clean, 'auth.json'), 'utf8'), 'newer')
  // The person's folder: same files, sizes, times and words.
  assert.deepEqual(await snapshot(user), before)
})

test('the person\'s home is CODEX_HOME of the environment, else ~/.codex; the default clean home is under data/', () => {
  assert.equal(userCodexHome({ CODEX_HOME: "D:/x" }), "D:/x")
  assert.ok(userCodexHome({}).split('\\').join('/').endsWith('/.codex'))
  assert.ok(CLEAN_HOME.split('\\').join('/').endsWith('/data/codex-home'))
})
