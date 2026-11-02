// Asset providers, part D (spec 2026-11-01-asset-providers-screens-design.md, "New board · Setup"): the first-run setup of a
// new board. The server's state (src/providers/setup.mjs, the route /api/setup), a new project's settings, and the page's
// steps (cut out of public/board.js between its marks and run here). Made-up samples only.

import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { POST_ROUTES, createBoard } from '../server.mjs'
import { parseConfig } from '../src/config.mjs'
import { projectFiles } from '../src/newProject.mjs'
import { VERIFY_FRESH_MS, checkKey } from '../src/providers/choose.mjs'
import { ASSET_KINDS } from '../src/providers/index.mjs'
import { readSetup, setupAction, startSetup } from '../src/providers/setup.mjs'
import { tempDir } from './tempDir.mjs'

const NOW = Date.UTC(2026, 10, 2, 12, 0)
const config = parseConfig('{}', {})
const works = (at = NOW) => ({ state: 'works', ok: true, why: '', detail: 'fine', at })
/** The checks of the default provider of every kind, passed at `at`. */
const allWork = (at = NOW) => new Map(ASSET_KINDS.map(kind => [checkKey(kind, config.providers[kind].provider), works(at)]))

test('a board is new only when setup.json is absent and its settings never named providers', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'data', 'setup.json')
  // An existing board (providers set): no setup.json is made and the state reads as finished.
  assert.equal(await startSetup(file, { hasProvidersKey: true }), false)
  assert.deepEqual(await readSetup(file), { done: ASSET_KINDS, finished: true })
  // A new board: the empty state is written once, then read as not finished; asking again changes nothing.
  assert.equal(await startSetup(file, { hasProvidersKey: false }), true)
  assert.deepEqual(await readSetup(file), { done: [], finished: false })
  await writeFile(file, JSON.stringify({ done: ['visual'], finished: false }))
  assert.equal(await startSetup(file, { hasProvidersKey: false }), false)
  assert.deepEqual(await readSetup(file), { done: ['visual'], finished: false })
})

test('a kind is done only when its provider in use verified lately; finish needs every kind', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'data', 'setup.json')
  await startSetup(file, { hasProvidersKey: false })
  const none = await setupAction(file, { action: 'done', kind: 'visual' }, { config, checks: new Map(), now: NOW })
  assert.deepEqual([none.ok, none.status], [false, 409])
  const old = await setupAction(file, { action: 'done', kind: 'visual' }, { config, checks: allWork(NOW - VERIFY_FRESH_MS - 1), now: NOW })
  assert.deepEqual([old.ok, old.status], [false, 409])
  const needs = new Map([[checkKey('visual', 'codex'), { ...works(), state: 'needs', ok: false, why: 'Not signed in' }]])
  assert.match((await setupAction(file, { action: 'done', kind: 'visual' }, { config, checks: needs, now: NOW })).why, /Not signed in/)
  assert.equal((await setupAction(file, { action: 'done', kind: 'nothing' }, { config, checks: allWork(), now: NOW })).status, 400)
  assert.deepEqual((await readSetup(file)).done, [])
  const checks = allWork()
  const first = await setupAction(file, { action: 'done', kind: 'music' }, { config, checks, now: NOW })
  assert.deepEqual(first.result, { done: ['music'], finished: false })
  assert.equal((await setupAction(file, { action: 'finish' }, { config, checks, now: NOW })).status, 409)
  for (const kind of ['visual', 'sound effect']) assert.equal((await setupAction(file, { action: 'done', kind }, { config, checks, now: NOW })).ok, true)
  assert.deepEqual((await readSetup(file)).done, ASSET_KINDS)
  const finish = await setupAction(file, { action: 'finish' }, { config, checks, now: NOW })
  assert.deepEqual(finish.result, { done: ASSET_KINDS, finished: true })
  assert.deepEqual(await readSetup(file), { done: ASSET_KINDS, finished: true })
  assert.equal((await setupAction(file, { action: 'done', kind: 'visual' }, { config, checks, now: NOW })).status, 409)
})

test('the provider in use counts, not the default: a switched kind needs its own verify', async t => {
  const dir = await tempDir(t)
  const file = join(dir, 'setup.json')
  await startSetup(file, { hasProvidersKey: false })
  const manual = parseConfig('{"providers": {"music": "manual"}}', {})
  const checks = new Map([[checkKey('music', 'person-suno'), works()]])
  assert.equal((await setupAction(file, { action: 'done', kind: 'music' }, { config: manual, checks, now: NOW })).ok, false)
  checks.set(checkKey('music', 'manual'), works())
  assert.equal((await setupAction(file, { action: 'done', kind: 'music' }, { config: manual, checks, now: NOW })).ok, true)
})

test('a new project\'s settings name no providers, so its board starts the setup', () => {
  const example = JSON.stringify({ name: 'x', providers: { visual: 'codex' }, port: 4310, gamePort: 4400 })
  const made = projectFiles({ name: 'Garden', prefix: 'Garden - ', project: 'C:\\Work\\Garden', board: 'C:\\Work\\Garden\\worker-board', examples: { config: example, flow: '{}', claude: '', mainBriefing: '', workerBriefing: '' } })
  assert.equal(Object.hasOwn(made.config, 'providers'), false)
})

const TOKEN = 'a'.repeat(64)
function send(port, method, path, body) {
  const self = `127.0.0.1:${port}`
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: self, 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json' } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

test('/api/setup: a locked json write; GET reads the state, a board with no handler says it is finished', async t => {
  assert.deepEqual(POST_ROUTES['/api/setup'], { kind: 'json', guard: 'lock' })
  const calls = []
  const server = createBoard({
    token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }),
    setupRead: async () => ({ done: ['visual'], finished: false }),
    setup: async body => { calls.push(body); return body.action === 'finish' ? { ok: false, status: 409, why: 'Finish every step first.' } : { ok: true, result: { done: ['visual'], finished: false } } },
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const { port } = server.address()
  assert.deepEqual(JSON.parse((await send(port, 'GET', '/api/setup')).text), { done: ['visual'], finished: false })
  assert.equal((await send(port, 'POST', '/api/setup', { action: 'done', kind: 'visual' })).status, 200)
  const refused = await send(port, 'POST', '/api/setup', { action: 'finish' })
  assert.deepEqual([refused.status, refused.text.includes('Finish every step first.')], [409, true])
  assert.equal(calls.length, 2)
  const bare = createBoard({ token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }) })
  await new Promise(done => bare.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => bare.close(done)))
  assert.equal(JSON.parse((await send(bare.address().port, 'GET', '/api/setup')).text).finished, true)
  assert.equal((await send(bare.address().port, 'POST', '/api/setup', { action: 'finish' })).status, 404)
})

// The page's steps.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const markup = await readFile(join(PUBLIC, 'index.html'), 'utf8')
const cut = ['providerCards', 'providerSetup'].map(mark => script.slice(script.indexOf(`// ${mark}:start`), script.indexOf(`// ${mark}:end`))).join('\n')
const page = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { providerSetupSteps })`, page)
const plain = value => JSON.parse(JSON.stringify(value))
const card = (name, extra = {}) => ({ name, mode: 'auto', selectable: true, last: null, card: { title: name.toUpperCase(), line: '', facts: [], icon: 'manual' }, ...extra })
const check = (state, at = NOW, detail = '347 sounds found') => ({ state, ok: state === 'works', why: '', detail, at })
const kinds = (visual, sound) => [
  { kind: 'visual', inUse: 'codex', cards: [card('codex', { last: visual }), card('manual')] },
  { kind: 'music', inUse: 'person-suno', cards: [card('person-suno', { last: check('works') })] },
  { kind: 'sound effect', inUse: 'sound-library', cards: [card('sound-library', { last: sound })] },
]
const steps = (list, setup, at = null, now = NOW) => plain(page.providerSetupSteps(list, setup, at, now))

test('the page shows the setup only for a board whose setup is not finished', () => {
  const list = kinds(check('works'), check('works'))
  assert.equal(steps(list, { done: [], finished: false }).visible, true)
  for (const setup of [{ done: ASSET_KINDS, finished: true }, null, undefined]) assert.equal(steps(list, setup).visible, false)
  assert.equal(steps(null, { done: [], finished: false }).visible, false)
})

test('steps: Art, Music, Sound effects; a closed page resumes at the first kind not done', () => {
  const list = kinds(check('works'), check('works'))
  const first = steps(list, { done: [], finished: false })
  assert.deepEqual(first.steps.map(one => [one.title, one.state]), [['Art and visuals', 'now'], ['Music', 'later'], ['Sound effects', 'later']])
  assert.deepEqual([first.index, first.label, first.nextLabel], [0, 'Step 1 of 3', 'Next'])
  const resumed = steps(list, { done: ['visual'], finished: false })
  assert.deepEqual([resumed.index, resumed.kind, resumed.steps.map(one => one.state)], [1, 'music', ['done', 'now', 'later']])
  const last = steps(list, { done: ['visual', 'music'], finished: false })
  assert.deepEqual([last.index, last.nextLabel, last.isLast], [2, 'Finish', true])
  assert.equal(steps(list, { done: ['visual'], finished: false }, 2).index, 2)
})

test('Next stays off until the provider in use verified and works; an old pass or a needs does not unlock it', () => {
  const setup = { done: [], finished: false }
  assert.equal(steps(kinds(null, null), setup).nextEnabled, false)
  assert.match(steps(kinds(null, null), setup).hint, /unlocks once the picked provider verifies/)
  assert.equal(steps(kinds(check('needs'), null), setup).nextEnabled, false)
  assert.equal(steps(kinds(check('off'), null), setup).nextEnabled, false)
  assert.equal(steps(kinds(check('works', NOW - VERIFY_FRESH_MS - 1), null), setup).nextEnabled, false)
  assert.equal(steps(kinds(check('works', NOW - VERIFY_FRESH_MS), null), setup).nextEnabled, true)
  // A pass on a card that is not the one in use does not count.
  const other = kinds(null, null)
  other[0].cards[1].last = check('works')
  assert.equal(steps(other, setup).nextEnabled, false)
})

test('the sample line: only for sound effects with the free library, once it works', () => {
  const setup = { done: ['visual', 'music'], finished: false }
  assert.match(steps(kinds(null, check('works')), setup).sample, /Free library: 347 sounds found/)
  assert.equal(steps(kinds(null, check('needs')), setup).sample, '')
  assert.equal(steps(kinds(check('works'), null), { done: [], finished: false }).sample, '')
})

test('the page holds the setup\'s place and calls it', () => {
  assert.match(markup, /id="provider-setup"/)
  assert.match(script, /providerSetupStart\(\)/)
})
