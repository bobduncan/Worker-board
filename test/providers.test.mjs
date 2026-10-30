// T9.3 part 1 (spec 2026-10-25-asset-providers-design.md): the asset providers. Each is a small module with the same face
// { name, mode, kinds, check }; `providerFor` and `checkProviders` (src/providers/index.mjs) answer who provides each
// kind and whether that works now; the state carries the answer. Made-up folders and a stand-in for `findCodex`.

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { configProblem, parseConfig } from '../src/config.mjs'
import { ASSET_KINDS, DEFAULT_PROVIDERS, PROVIDERS, checkProviders, providerFor } from '../src/providers/index.mjs'
import { codex } from '../src/providers/codex.mjs'
import { ANSWER_MS, elevenlabs } from '../src/providers/elevenlabs.mjs'
import { personSuno } from '../src/providers/person-suno.mjs'
import { soundLibrary } from '../src/providers/sound-library.mjs'
import { tempDir } from './tempDir.mjs'
import { buildState } from './withStore.mjs'

const settings = text => parseConfig(text, {})

test('every provider has the same face: its name, how it provides, the kinds it serves and a check', () => {
  assert.deepEqual(ASSET_KINDS, ['visual', 'music', 'sound effect'])
  assert.deepEqual(Object.keys(PROVIDERS), ['codex', 'person-suno', 'sound-library', 'elevenlabs'])
  assert.deepEqual([codex, personSuno, soundLibrary, elevenlabs].map(one => [one.name, one.mode, one.kinds]), [
    ['codex', 'auto', ['visual']],
    ['person-suno', 'person', ['music']],
    ['sound-library', 'pick', ['sound effect']],
    ['elevenlabs', 'auto', ['sound effect']],
  ])
  for (const one of Object.values(PROVIDERS)) {
    assert.equal(PROVIDERS[one.name], one)
    assert.equal(typeof one.check, 'function')
  }
  // What each kind is set to by default serves it.
  for (const kind of ASSET_KINDS) assert.ok(PROVIDERS[DEFAULT_PROVIDERS[kind].provider].kinds.includes(kind), kind)
  // Only the sound library has a folder, and it names its own default.
  assert.deepEqual(Object.values(PROVIDERS).map(one => one.folder ?? null), [null, null, 'sound-library', null])
  // Nothing asks a provider for an asset yet: part 2 adds `provide`.
  assert.deepEqual(Object.values(PROVIDERS).filter(one => 'provide' in one), [])
})

test('codex: ok when Codex is found, where the Design tab\'s settings say or where the board looks; "Codex not found" otherwise', async t => {
  const asked = []
  const found = codexPath => codex.check({ codexPath, findCodex: async ask => { asked.push(ask); return 'C:\\codex\\codex.exe' } })
  assert.deepEqual(await found(''), { ok: true, why: 'Codex found' })
  assert.deepEqual(await found('D:\\tools\\codex.exe'), { ok: true, why: 'Codex found' })
  // The same `given` path the Design tab uses for findCodex: '' for none.
  assert.deepEqual(asked, [{ given: '' }, { given: 'D:\\tools\\codex.exe' }])
  assert.deepEqual(await codex.check({ findCodex: async () => null }), { ok: false, why: 'Codex not found' })
  // It never throws, also when the look for Codex does.
  assert.deepEqual(await codex.check({ findCodex: async () => { throw new Error('disk gone') } }), { ok: false, why: 'Codex could not be looked for' })
  // Without a stand-in it is src/codex.mjs findCodex: a path given that is no file is "not found".
  const folder = await tempDir(t)
  assert.deepEqual(await codex.check({ codexPath: join(folder, 'nope.exe') }), { ok: false, why: 'Codex not found' })
  await writeFile(join(folder, 'codex.exe'), 'x')
  assert.deepEqual(await codex.check({ codexPath: join(folder, 'codex.exe') }), { ok: true, why: 'Codex found' })
})

test('person-suno: always ok, the person makes it in Suno', async () => {
  assert.deepEqual(await personSuno.check(), { ok: true, why: 'you make it in Suno' })
  assert.deepEqual(await personSuno.check({ project: '' }), { ok: true, why: 'you make it in Suno' })
})

test('sound-library: ok when its folder holds a sound file; why not when it is empty, missing, holds none, or is no folder', async t => {
  const project = await tempDir(t)
  const make = async (folder, ...files) => {
    await mkdir(join(project, ...folder.split('/')), { recursive: true })
    for (const file of files) {
      await mkdir(join(project, ...folder.split('/'), ...file.split('/').slice(0, -1)), { recursive: true })
      await writeFile(join(project, ...folder.split('/'), ...file.split('/')), 'x')
    }
  }
  await make('sound-library', 'hit.wav')
  await make('empty')
  await make('notes', 'readme.txt', 'cover.png')
  await make('deep', 'a/b/c/boom.OGG')
  await make('toodeep', 'a/b/c/d/e/boom.wav')
  await writeFile(join(project, 'plain'), 'x')
  const check = folder => soundLibrary.check({ project, ...(folder === undefined ? {} : { folder }) })
  const none = folder => ({ ok: false, why: `The sound library folder "${folder}" holds no sound file (.wav, .mp3, .ogg, .flac)` })
  // Its own default folder when the settings name none.
  assert.deepEqual(await check(), { ok: true, why: 'The sound library folder "sound-library" holds sounds' })
  for (const file of ['a.wav', 'a.mp3', 'a.ogg', 'a.flac']) {
    await make('kinds', file)
    assert.equal((await check('kinds')).ok, true, file)
  }
  // A sound in a folder inside the library counts, up to a few folders deep.
  assert.equal((await check('deep')).ok, true)
  assert.deepEqual(await check('toodeep'), none('toodeep'))
  assert.deepEqual(await check('empty'), none('empty'))
  assert.deepEqual(await check('notes'), none('notes'))
  assert.deepEqual(await check('missing/folder'), { ok: false, why: 'The sound library folder "missing/folder" is not there' })
  assert.deepEqual(await check('plain'), { ok: false, why: 'The sound library folder "plain" is not there' })
  // A folder that leads out of the project is not looked in; no project, no folder.
  assert.deepEqual(await check('../elsewhere'), { ok: false, why: 'The sound library folder "../elsewhere" is not inside the project' })
  assert.deepEqual(await soundLibrary.check({ project: '' }), { ok: false, why: 'config.json names no project' })
  assert.deepEqual(await soundLibrary.check(), { ok: false, why: 'config.json names no project' })
})

const KEY = 'sk_test_SECRET_0123456789'
/** A stand-in for `fetch`: answers `status` and `body`; `calls` holds what it was asked. */
const answering = (status, body, calls = []) => async (url, init) => {
  calls.push({ url, init })
  return { status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new SyntaxError('no json'); return body } }
}

test('elevenlabs: no key says so; the key comes from the tools, else the board\'s environment', async () => {
  const none = { ok: false, why: 'No ElevenLabs key (ELEVENLABS_API_KEY)' }
  assert.deepEqual(await elevenlabs.check({ key: '', fetch: async () => { throw new Error('must not ask') } }), none)
  assert.deepEqual(await elevenlabs.check({ key: '   ', fetch: async () => { throw new Error('must not ask') } }), none)
  assert.deepEqual(await elevenlabs.check({ key: () => { throw new Error('gone') } }), none)
  const before = process.env.ELEVENLABS_API_KEY
  try {
    process.env.ELEVENLABS_API_KEY = KEY
    const calls = []
    assert.equal((await elevenlabs.check({ fetch: answering(200, { tier: 'starter' }, calls) })).ok, true)
    assert.equal(calls[0].init.headers['xi-api-key'], KEY)
  } finally {
    if (before === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = before
  }
})

test('elevenlabs: asks only api.elevenlabs.io for the plan (no credits), with the key in one header and no redirect', async () => {
  const calls = []
  await elevenlabs.check({ key: KEY, fetch: answering(200, {}, calls) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/user/subscription')
  assert.deepEqual(calls[0].init.headers, { 'xi-api-key': KEY })
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.method, undefined)
  assert.equal(calls[0].init.body, undefined)
})

test('elevenlabs: works on the free plan with "for testing only" and the credits left; a paid plan names the credits only', async () => {
  const free = await elevenlabs.check({ key: KEY, fetch: answering(200, { tier: 'free', character_count: 50, character_limit: 10000 }) })
  assert.deepEqual(free, { ok: true, why: 'works (free plan: for testing only, 9,950 credits left)' })
  const paid = await elevenlabs.check({ key: KEY, fetch: answering(200, { tier: 'starter', character_count: 100, character_limit: 30000 }) })
  assert.deepEqual(paid, { ok: true, why: 'works (29,900 credits left)' })
  // A free plan whose credits are unreadable still says it is for testing; a reply without a plan is just "works".
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(200, { tier: 'free' }) }), { ok: true, why: 'works (free plan: for testing only)' })
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(200, { tier: 'Free', character_count: 20000, character_limit: 10000 }) }), { ok: true, why: 'works (free plan: for testing only, 0 credits left)' })
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(200, undefined) }), { ok: true, why: 'works' })
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(200, null) }), { ok: true, why: 'works' })
})

test('elevenlabs: a refused key is not "works"; a key that may not read the plan still works; no answer says so', async () => {
  const refused = { ok: false, why: 'ElevenLabs refused the key' }
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(401, { detail: { status: 'invalid_api_key' } }) }), refused)
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(401, undefined) }), refused)
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(403, {}) }), refused)
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(401, { detail: { status: 'missing_permissions' } }) }), { ok: true, why: 'works' })
  const silent = { ok: false, why: 'ElevenLabs did not answer' }
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: answering(500, {}) }), silent)
  assert.deepEqual(await elevenlabs.check({ key: KEY, fetch: async () => { throw new Error(`connect ECONNREFUSED ${KEY}`) } }), silent)
})

test('elevenlabs: waits at most ANSWER_MS, also for a fetch that ignores the signal or an answer that never finishes', async () => {
  assert.equal(ANSWER_MS, 10_000)
  const silent = { ok: false, why: 'ElevenLabs did not answer' }
  const started = Date.now()
  assert.deepEqual(await elevenlabs.check({ key: KEY, answerMs: 30, fetch: () => new Promise(() => {}) }), silent)
  assert.deepEqual(await elevenlabs.check({ key: KEY, answerMs: 30, fetch: async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }) }), silent)
  assert.deepEqual(await elevenlabs.check({ key: KEY, answerMs: 30, fetch: async () => ({ status: 401, ok: false, json: () => new Promise(() => {}) }) }), silent)
  assert.ok(Date.now() - started < 5000)
  // The signal the fetch gets is aborted when the time is up.
  let signal
  await elevenlabs.check({ key: KEY, answerMs: 20, fetch: (url, init) => { signal = init.signal; return new Promise(() => {}) } })
  assert.equal(signal.aborted, true)
})

test('elevenlabs: the key is in no answer, not in the state the board builds, whatever went wrong', async () => {
  const fetches = [
    answering(200, { tier: 'free', character_count: 1, character_limit: 10000 }), answering(401, { detail: { status: 'invalid_api_key', message: KEY } }),
    answering(500, { message: KEY }), async () => { throw new Error(KEY) }, () => new Promise(() => {}),
  ]
  for (const fetch of fetches) {
    const lines = await checkProviders(settings('{"providers": {"sound effect": "elevenlabs"}}'), { project: '', findCodex: async () => null, key: KEY, fetch, answerMs: 20 })
    assert.equal(JSON.stringify(lines).includes(KEY), false)
    assert.equal(JSON.stringify(lines).includes('SECRET'), false)
  }
})

test('elevenlabs: the setting names it for sound effect; visual and music refuse it; the default stays the sound library', async () => {
  assert.deepEqual(settings('{"providers": {"sound effect": "elevenlabs"}}').providers['sound effect'], { provider: 'elevenlabs' })
  assert.equal(configProblem('{"providers": {"sound effect": "elevenlabs"}}'), null)
  assert.equal(configProblem('{"providers": {"visual": "elevenlabs"}}'), '"providers.visual" is set to "elevenlabs", which serves sound effect, not visual')
  assert.equal(configProblem('{"providers": {"music": "elevenlabs"}}'), '"providers.music" is set to "elevenlabs", which serves sound effect, not music')
  assert.equal(configProblem('{"providers": {"sound effect": {"provider": "elevenlabs", "folder": "sfx"}}}'), '"providers.sound effect" sets a folder, but "elevenlabs" has none')
  assert.equal(DEFAULT_PROVIDERS['sound effect'].provider, 'sound-library')
  const set = settings('{"providers": {"sound effect": "elevenlabs"}}')
  assert.equal(providerFor(set, 'sound effect').provider, elevenlabs)
  const lines = await checkProviders(set, { project: '', findCodex: async () => null, key: KEY, fetch: answering(200, { tier: 'free', character_count: 50, character_limit: 10000 }) })
  assert.deepEqual(lines[2], { kind: 'sound effect', provider: 'elevenlabs', mode: 'auto', ok: true, why: 'works (free plan: for testing only, 9,950 credits left)' })
  // With no key the line says so and the other kinds go on.
  const keyless = await checkProviders(set, { project: '', findCodex: async () => null, key: '' })
  assert.deepEqual(keyless.map(one => [one.provider, one.ok]), [['codex', false], ['person-suno', true], ['elevenlabs', false]])
  assert.equal(keyless[2].why, 'No ElevenLabs key (ELEVENLABS_API_KEY)')
})

test('providerFor: the module set for a kind and its folder; the default where the settings name none; null for what the board does not know', () => {
  const set = settings('{"providers": {"sound effect": {"provider": "sound-library", "folder": "sfx"}}}')
  assert.deepEqual([providerFor(set, 'visual').provider, providerFor(set, 'visual').folder], [codex, null])
  assert.deepEqual([providerFor(set, 'music').provider, providerFor(set, 'music').folder], [personSuno, null])
  assert.deepEqual([providerFor(set, 'sound effect').provider, providerFor(set, 'sound effect').folder], [soundLibrary, 'sfx'])
  // No settings, or none for the kind: the defaults.
  for (const nothing of [{}, undefined, null, { providers: {} }]) {
    assert.deepEqual([providerFor(nothing, 'visual').provider.name, providerFor(nothing, 'sound effect').folder], ['codex', 'sound-library'])
  }
  assert.equal(providerFor(set, 'image'), null)
  assert.equal(providerFor(set, '__proto__'), null)
  assert.equal(providerFor({ providers: { visual: { provider: 'midjourney' } } }, 'visual'), null)
  assert.equal(providerFor({ providers: { visual: { provider: 'constructor' } } }, 'visual'), null)
})

test('checkProviders: one line per kind in the order visual, music, sound effect, with the provider\'s name, mode and answer', async t => {
  const project = await tempDir(t)
  await mkdir(join(project, 'sound-library'))
  await writeFile(join(project, 'sound-library', 'hit.wav'), 'x')
  assert.deepEqual(await checkProviders(settings('{}'), { project, findCodex: async () => 'C:\\codex\\codex.exe' }), [
    { kind: 'visual', provider: 'codex', mode: 'auto', ok: true, why: 'Codex found' },
    { kind: 'music', provider: 'person-suno', mode: 'person', ok: true, why: 'you make it in Suno' },
    { kind: 'sound effect', provider: 'sound-library', mode: 'pick', ok: true, why: 'The sound library folder "sound-library" holds sounds' },
  ])
  // What does not work says why, and the others go on; the settings' folder and the Design tab's Codex path are used.
  const seen = []
  const broken = await checkProviders(settings('{"providers": {"sound effect": {"provider": "sound-library", "folder": "sfx"}}}'), { project, codexPath: 'D:\\codex.exe', findCodex: async ask => { seen.push(ask); return null } })
  assert.deepEqual(broken.map(one => [one.kind, one.provider, one.ok, one.why]), [
    ['visual', 'codex', false, 'Codex not found'],
    ['music', 'person-suno', true, 'you make it in Suno'],
    ['sound effect', 'sound-library', false, 'The sound library folder "sfx" is not there'],
  ])
  assert.deepEqual(seen, [{ given: 'D:\\codex.exe' }])
  // Without settings or tools it still answers in the same order.
  const bare = await checkProviders(undefined)
  assert.deepEqual(bare.map(one => one.kind), ASSET_KINDS)
  assert.deepEqual(bare[2], { kind: 'sound effect', provider: 'sound-library', mode: 'pick', ok: false, why: 'config.json names no project' })
})

test('a kind whose setting names no provider the board knows is answered as not working, not thrown', async () => {
  const unknown = await checkProviders({ providers: { visual: { provider: 'midjourney' } } }, { findCodex: async () => null })
  assert.deepEqual(unknown[0], { kind: 'visual', provider: null, mode: null, ok: false, why: 'No provider the board knows is set for visual' })
  assert.deepEqual(unknown.slice(1).map(one => one.provider), ['person-suno', 'sound-library'])
})

test('the state carries providers: what the board last checked, in the page\'s shape; none while nothing was checked', () => {
  const NOW = Date.UTC(2026, 9, 25, 12, 0)
  const raw = { listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: [], tails: {}, planLineTexts: {}, backlogText: '## Board\n', adviceText: null, folders: null, askTexts: [], pictureLists: {} }
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const build = providers => buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, ...(providers === undefined ? {} : { providers }) }).providers
  assert.deepEqual(build(), [])
  const checked = [
    { kind: 'visual', provider: 'codex', mode: 'auto', ok: false, why: 'Codex not found' },
    { kind: 'music', provider: 'person-suno', mode: 'person', ok: true, why: 'you make it in Suno' },
  ]
  assert.deepEqual(build(checked), checked)
  // Only the page's fields go through; anything but a list is none.
  assert.deepEqual(build([{ ...checked[0], secret: 1 }]), [checked[0]])
  assert.deepEqual(build('nonsense'), [])
})
