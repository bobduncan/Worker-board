// Asset providers, part A (spec 2026-11-01-asset-providers-screens-design.md): choosing a provider. `providerCards`,
// `verifyOne` and `mayUse` (src/providers/choose.mjs), the `providers` setting that `use` writes into config.json
// (src/boardSettings.mjs), the key's checks and the route /api/providers. Stand-in tools, fetch and key: no network, no
// registry, no real folders of the project. Made-up key.

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import test from 'node:test'

import { POST_ROUTES, createBoard } from '../server.mjs'
import { checkSetting, settingChanged } from '../src/boardSettings.mjs'
import { parseConfig, readProviders } from '../src/config.mjs'
import { VERIFY_FRESH_MS, checkKey, mayUse, providerCards, verifyOne } from '../src/providers/choose.mjs'
import { KEY_MAX, KEY_VARIABLE, keyChecked, saveKey } from '../src/providers/elevenlabs-key.mjs'
import { ASSET_KINDS } from '../src/providers/index.mjs'
import { tempDir } from './tempDir.mjs'

const KEY = 'sk_test_SECRET_0123456789'
const NOW = Date.UTC(2026, 10, 1, 12, 0)
const MIN = 60_000
const settings = text => parseConfig(text, {})
const answering = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })
/** A kept check, as the board keeps it. */
const kept = (state, ago = 0, more = {}) => ({ state, ok: state === 'works', why: state === 'works' ? 'fine' : 'not yet', detail: 'd', at: NOW - ago, ...more })
const keep = (...rows) => new Map(rows.map(([kind, name, record]) => [checkKey(kind, name), record]))

test('providerCards: every kind in order, with the providers that serve or are shown on it, the one in use first', () => {
  const cards = providerCards(settings('{}'), new Map())
  assert.deepEqual(cards.map(one => [one.kind, one.inUse]), [['visual', 'codex'], ['music', 'person-suno'], ['sound effect', 'sound-library']])
  assert.deepEqual(cards[0].cards.map(one => one.name), ['codex', 'manual', 'elevenlabs-images', 'claude'])
  assert.deepEqual(cards[1].cards.map(one => one.name), ['person-suno', 'manual', 'elevenlabs-music'])
  assert.deepEqual(cards[2].cards.map(one => one.name), ['sound-library', 'elevenlabs', 'manual'])
  // A card carries the provider's mode and card text; nothing was checked yet.
  assert.deepEqual(cards[1].cards[0], { name: 'person-suno', mode: 'person', card: { title: 'Suno, by hand', line: 'You make it in Suno; the board asks you', facts: ['No automatic link exists', 'Your Suno plan'], icon: 'suno' }, selectable: true, last: null })
})

test('providerCards: the provider in use moves to the front; Claude is shown on visual only, not selectable', () => {
  const cards = providerCards(settings('{"providers": {"sound effect": "elevenlabs", "visual": "elevenlabs-images"}}'), new Map())
  assert.deepEqual(cards[2].cards.map(one => one.name), ['elevenlabs', 'sound-library', 'manual'])
  assert.deepEqual(cards[0].cards.map(one => one.name), ['elevenlabs-images', 'codex', 'manual', 'claude'])
  const claude = cards[0].cards.at(-1)
  assert.equal(claude.selectable, false)
  assert.equal(cards[1].cards.some(one => one.name === 'claude') || cards[2].cards.some(one => one.name === 'claude'), false)
  assert.deepEqual(cards.flatMap(one => one.cards).filter(one => one.name !== 'claude').map(one => one.selectable), Array(9).fill(true))
  // Without settings the defaults are in use.
  assert.deepEqual(providerCards(undefined, undefined).map(one => one.inUse), ['codex', 'person-suno', 'sound-library'])
})

test('providerCards: `last` is the kept check of that kind and provider, with its time', () => {
  const checks = keep(['visual', 'manual', kept('works', 5 * MIN, { detail: 'Always works' })], ['music', 'manual', kept('needs')])
  const cards = providerCards(settings('{}'), checks)
  assert.deepEqual(cards[0].cards.find(one => one.name === 'manual').last, { state: 'works', ok: true, why: 'fine', detail: 'Always works', at: NOW - 5 * MIN })
  assert.equal(cards[1].cards.find(one => one.name === 'manual').last.state, 'needs')
  assert.equal(cards[2].cards.find(one => one.name === 'manual').last, null, 'a check is kept per kind')
  assert.deepEqual(Object.keys(cards[1].cards[1].last), ['state', 'ok', 'why', 'detail', 'at'])
})

test('verifyOne: runs that provider\'s check with the tools and answers the record to keep, with the time', async () => {
  const seen = []
  const record = await verifyOne(settings('{}'), 'visual', 'codex', { now: NOW, codexPath: 'D:\\codex.exe', findCodex: async ask => { seen.push(ask); return 'C:\\codex.exe' } })
  assert.deepEqual(record, { ok: true, state: 'works', why: 'Codex found', detail: 'Codex found', at: NOW })
  assert.deepEqual(seen, [{ given: 'D:\\codex.exe' }])
  assert.deepEqual(await verifyOne(settings('{}'), 'music', 'manual', { now: NOW }), { ok: true, state: 'works', why: 'nothing to check', detail: 'Always works', at: NOW })
  // Claude can be verified where it is shown: it says it is off. A name or kind the board does not show is off too.
  assert.equal((await verifyOne(settings('{}'), 'visual', 'claude', { now: NOW })).state, 'off')
  assert.equal((await verifyOne(settings('{}'), 'music', 'claude', { now: NOW })).state, 'off')
  assert.equal((await verifyOne(settings('{}'), 'visual', 'midjourney', { now: NOW })).state, 'off')
  assert.equal((await verifyOne(settings('{}'), 'image', 'codex', { now: NOW })).state, 'off')
  assert.equal((await verifyOne(settings('{}'), 'visual', 'constructor', { now: NOW })).ok, false)
  // Without `now` it stamps the clock.
  assert.ok(Math.abs((await verifyOne(settings('{}'), 'music', 'manual')).at - Date.now()) < 5000)
})

test('verifyOne: the sound library is looked for in the settings\' folder when it is the one in use, else in its default', async t => {
  const project = await tempDir(t)
  await mkdir(join(project, 'sfx'))
  await writeFile(join(project, 'sfx', 'a.wav'), 'x')
  await mkdir(join(project, 'sound-library'))
  const inUse = settings('{"providers": {"sound effect": {"provider": "sound-library", "folder": "sfx"}}}')
  assert.equal((await verifyOne(inUse, 'sound effect', 'sound-library', { project, now: NOW })).state, 'works')
  // Another provider in use for the kind: the library's own default folder, which holds no sound here.
  const other = settings('{"providers": {"sound effect": "elevenlabs"}}')
  const record = await verifyOne(other, 'sound effect', 'sound-library', { project, now: NOW })
  assert.deepEqual([record.state, record.detail], ['needs', 'No sounds found'])
})

test('verifyOne: the ElevenLabs providers use the key given; the key is in no record', async () => {
  const pro = { tier: 'pro', character_count: 0, character_limit: 100000 }
  const music = await verifyOne(settings('{}'), 'music', 'elevenlabs-music', { now: NOW, key: KEY, fetch: answering(200, pro) })
  assert.deepEqual([music.state, music.detail], ['works', '100,000 credits left'])
  const images = await verifyOne(settings('{}'), 'visual', 'elevenlabs-images', { now: NOW, key: KEY, fetch: answering(200, { tier: 'creator' }) })
  assert.deepEqual([images.state, images.why], ['needs', 'Needs the Pro plan'])
  const none = await verifyOne(settings('{}'), 'sound effect', 'elevenlabs', { now: NOW, key: '' })
  assert.deepEqual([none.state, none.why, none.detail], ['needs', 'No ElevenLabs key (ELEVENLABS_API_KEY)', 'Paste your key first'])
  for (const record of [music, images, none]) assert.equal(JSON.stringify(record).includes('SECRET'), false)
})

test('mayUse: only a provider that serves the kind, whose kept check is "works" and at most 10 minutes old', () => {
  assert.equal(VERIFY_FRESH_MS, 10 * MIN)
  const checks = keep(['music', 'manual', kept('works', 2 * MIN)], ['visual', 'manual', kept('works', 10 * MIN)], ['sound effect', 'manual', kept('works', 10 * MIN + 1)],
    ['music', 'elevenlabs-music', kept('needs', MIN)], ['visual', 'claude', kept('off', MIN)], ['visual', 'codex', kept('works', MIN)])
  assert.deepEqual(mayUse(checks, 'music', 'manual', NOW), { ok: true, why: '' })
  assert.deepEqual(mayUse(checks, 'visual', 'manual', NOW), { ok: true, why: '' }, 'exactly 10 minutes is still fresh')
  const stale = mayUse(checks, 'sound effect', 'manual', NOW)
  assert.equal(stale.ok, false)
  assert.match(stale.why, /more than 10 minutes old/)
  // Needs: the check's own reason is the answer.
  assert.deepEqual(mayUse(checks, 'music', 'elevenlabs-music', NOW), { ok: false, why: 'not yet' })
  // Not verified yet; a check kept for another kind does not count.
  assert.match(mayUse(checks, 'sound effect', 'elevenlabs', NOW).why, /Verify ElevenLabs first/)
  assert.match(mayUse(checks, 'music', 'codex', NOW).why, /does not serve music/)
  // Claude serves no kind, even with a "works" kept for it.
  assert.equal(mayUse(keep(['visual', 'claude', kept('works')]), 'visual', 'claude', NOW).ok, false)
  assert.equal(mayUse(checks, 'visual', 'claude', NOW).ok, false)
  // Names and kinds the board does not know.
  assert.equal(mayUse(checks, 'visual', 'midjourney', NOW).ok, false)
  assert.equal(mayUse(checks, 'visual', 'constructor', NOW).ok, false)
  assert.equal(mayUse(checks, 'image', 'codex', NOW).ok, false)
  assert.equal(mayUse(new Map(), 'visual', 'codex', NOW).ok, false)
})

test('the `providers` setting: one kind switched, written into config.json with every other setting and the folder kept', () => {
  assert.deepEqual(checkSetting({ key: 'providers', value: { kind: 'music', provider: 'manual' } }), { ok: true, key: 'providers', value: { kind: 'music', provider: 'manual' } })
  for (const value of [undefined, null, 'manual', { kind: 'image', provider: 'manual' }, { kind: 'music', provider: 'nope' }, { kind: 'music', provider: 'codex' }, { kind: 'visual', provider: 'claude' }, { kind: 'music', provider: 'constructor' }]) {
    const checked = checkSetting({ key: 'providers', value })
    assert.deepEqual([checked.ok, checked.status], [false, 400], JSON.stringify(value))
  }
  const file = '{\n  "name": "Garden",\n  "providers": {\n    "sound effect": {\n      "provider": "sound-library",\n      "folder": "sfx"\n    }\n  }\n}\n'
  const music = settingChanged(file, 'providers', { kind: 'music', provider: 'elevenlabs-music' })
  assert.equal(music.ok, true)
  assert.deepEqual(JSON.parse(music.text), { name: 'Garden', providers: { 'sound effect': { provider: 'sound-library', folder: 'sfx' }, music: 'elevenlabs-music' } })
  // Switching away from the library drops its folder; switching back starts at its default; the same provider again keeps it.
  const away = settingChanged(file, 'providers', { kind: 'sound effect', provider: 'elevenlabs' })
  assert.equal(JSON.parse(away.text).providers['sound effect'], 'elevenlabs')
  assert.equal(JSON.parse(settingChanged(away.text, 'providers', { kind: 'sound effect', provider: 'sound-library' }).text).providers['sound effect'], 'sound-library')
  assert.deepEqual(JSON.parse(settingChanged(file, 'providers', { kind: 'sound effect', provider: 'sound-library' }).text).providers['sound effect'], { provider: 'sound-library', folder: 'sfx' })
  // A file with no providers gets them; the board reads the result as the switch.
  const fresh = settingChanged('{}', 'providers', { kind: 'visual', provider: 'elevenlabs-images' })
  assert.equal(readProviders(JSON.parse(fresh.text).providers).providers.visual.provider, 'elevenlabs-images')
  assert.equal(settingChanged('{"providers": []}', 'providers', { kind: 'music', provider: 'manual' }).status, 409)
  assert.equal(settingChanged('{"providers": 5}', 'providers', { kind: 'music', provider: 'manual' }).status, 409)
  assert.equal(settingChanged('{', 'providers', { kind: 'music', provider: 'manual' }).status, 409)
})

test('the key: not empty, at most 200 characters, no white space; saved to the Windows user variable by `reg add` without a shell', async () => {
  assert.deepEqual(keyChecked('  abc123  '), { ok: true, key: 'abc123' })
  for (const bad of ['', '   ', 'a b', 'a\tb', 'a\nb', 'x'.repeat(KEY_MAX + 1), undefined, null, 7, {}]) assert.equal(keyChecked(bad).ok, false, String(bad).slice(0, 10))
  assert.equal(keyChecked('x'.repeat(KEY_MAX)).ok, true)
  assert.equal(JSON.stringify(keyChecked(`a b${KEY}`)).includes('SECRET'), false, 'a refusal never repeats the key')
  const before = process.env[KEY_VARIABLE]
  try {
    const calls = []
    const run = (file, args, options, done) => { calls.push({ file, args, options }); done(null) }
    assert.deepEqual(await saveKey(KEY, { run, platform: 'win32' }), { ok: true })
    assert.deepEqual(calls[0].args, ['add', 'HKCU\\Environment', '/v', 'ELEVENLABS_API_KEY', '/t', 'REG_SZ', '/d', KEY, '/f'])
    assert.equal(calls[0].file, 'reg')
    assert.equal(calls[0].options.windowsHide, true)
    assert.equal(calls[0].options.shell, undefined)
    assert.equal(process.env[KEY_VARIABLE], KEY)
    // reg failing: the answer says so in general words, without the key, and this process is left as it was.
    process.env[KEY_VARIABLE] = 'old'
    const failed = await saveKey(KEY, { run: (file, args, options, done) => done(new Error(`reg add ${KEY} failed`)), platform: 'win32' })
    assert.deepEqual([failed.ok, JSON.stringify(failed).includes('SECRET')], [false, false])
    assert.equal(process.env[KEY_VARIABLE], 'old')
    // Elsewhere than Windows there is no registry: this process only.
    assert.deepEqual(await saveKey('other', { run, platform: 'linux' }), { ok: true })
    assert.equal(calls.length, 1)
  } finally {
    if (before === undefined) delete process.env[KEY_VARIABLE]
    else process.env[KEY_VARIABLE] = before
  }
})

const TOKEN = 'a'.repeat(64)
/** One request to the board on `port`, as its own page would send it: its status and text. */
function send(port, method, path, body, headers = {}) {
  const self = `127.0.0.1:${port}`
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: self, 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json', ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

test('/api/providers: GET answers the cards to the board\'s own page only; POST is a locked json write handed to `providers`', async t => {
  assert.deepEqual(POST_ROUTES['/api/providers'], { kind: 'json', guard: 'lock' })
  const calls = []
  const cards = providerCards(settings('{}'), new Map())
  const server = createBoard({
    token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }),
    providerList: async () => cards,
    providers: async body => {
      calls.push(body)
      return body.action === 'use' ? { ok: false, status: 409, why: 'Verify Codex first.' } : { ok: true, result: { state: 'works', ok: true, why: 'fine', detail: '', at: NOW } }
    },
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const { port } = server.address()
  const read = await send(port, 'GET', '/api/providers')
  assert.equal(read.status, 200)
  assert.deepEqual(JSON.parse(read.text), JSON.parse(JSON.stringify(cards)))
  assert.deepEqual(JSON.parse(read.text).map(one => one.kind), ASSET_KINDS)
  assert.equal((await send(port, 'GET', '/api/providers', undefined, { 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  // POST: the page's token and origin are needed; the handler's answer or refusal goes through.
  assert.equal((await send(port, 'POST', '/api/providers', { action: 'verify' }, { 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await send(port, 'POST', '/api/providers', { action: 'verify' }, { Origin: 'http://evil.example' })).status, 403)
  assert.equal(calls.length, 0)
  const verify = await send(port, 'POST', '/api/providers', { action: 'verify', kind: 'visual', provider: 'codex' })
  assert.deepEqual([verify.status, JSON.parse(verify.text).state], [200, 'works'])
  const use = await send(port, 'POST', '/api/providers', { action: 'use', kind: 'visual', provider: 'codex' })
  assert.deepEqual([use.status, use.text.includes('Verify Codex first.')], [409, true])
  assert.deepEqual(calls.map(one => one.action), ['verify', 'use'])
})

test('/api/providers: a board with no handler says "Not here."; a board that does not run the loops refuses the write', async t => {
  const server = createBoard({ token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }), mayWrite: async () => 'Another board process runs the loops.' })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const { port } = server.address()
  assert.deepEqual(JSON.parse((await send(port, 'GET', '/api/providers')).text), [])
  const write = await send(port, 'POST', '/api/providers', { action: 'use', kind: 'music', provider: 'manual' })
  assert.equal(write.status, 409)
  assert.match(write.text, /Another board process runs the loops/)
  const bare = createBoard({ token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }) })
  await new Promise(done => bare.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => bare.close(done)))
  assert.equal((await send(bare.address().port, 'POST', '/api/providers', { action: 'verify' })).status, 404)
})
