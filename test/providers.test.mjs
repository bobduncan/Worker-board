// T9.3 part 1 (spec 2026-10-25-asset-providers-design.md): the asset providers. Each is a small module with the same face
// { name, mode, kinds, card, check }; `providerFor` and `checkProviders` (src/providers/index.mjs) answer who provides each
// kind and whether that works now; the state carries the answer. Made-up folders and a stand-in for `findCodex`.

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { configProblem, parseConfig } from '../src/config.mjs'
import { ASSET_KINDS, DEFAULT_PROVIDERS, PROVIDERS, checkProviders, providerFor } from '../src/providers/index.mjs'
import { codex as codexModule } from '../src/providers/codex.mjs'
import { ANSWER_MS, elevenlabs as elevenlabsModule } from '../src/providers/elevenlabs.mjs'
import { elevenlabsImages } from '../src/providers/elevenlabs-images.mjs'
import { elevenlabsMusic } from '../src/providers/elevenlabs-music.mjs'
import { manual } from '../src/providers/manual.mjs'
import { personSuno as personSunoModule } from '../src/providers/person-suno.mjs'
import { COUNT_STOP, soundLibrary as soundLibraryModule } from '../src/providers/sound-library.mjs'
import { tempDir } from './tempDir.mjs'
import { buildState } from './withStore.mjs'

const settings = text => parseConfig(text, {})

// Part A: a check answers `{ ok, state, why, detail }`. The older tests below look at `{ ok, why }` through these wrappers;
// the state and the detail have tests of their own at the end of this file.
const brief = ({ ok, why }) => ({ ok, why })
const briefly = module => ({ ...module, check: async tools => brief(await module.check(tools)) })
const codex = briefly(codexModule)
const personSuno = briefly(personSunoModule)
const soundLibrary = briefly(soundLibraryModule)
const elevenlabs = briefly(elevenlabsModule)

test('every provider has the same face: its name, how it provides, the kinds it serves and a check', () => {
  assert.deepEqual(ASSET_KINDS, ['visual', 'music', 'sound effect'])
  assert.deepEqual(Object.keys(PROVIDERS), ['codex', 'person-suno', 'sound-library', 'elevenlabs', 'manual', 'elevenlabs-music', 'elevenlabs-images'])
  assert.deepEqual([codexModule, personSunoModule, soundLibraryModule, elevenlabsModule, manual, elevenlabsMusic, elevenlabsImages].map(one => [one.name, one.mode, one.kinds]), [
    ['codex', 'auto', ['visual']],
    ['person-suno', 'person', ['music']],
    ['sound-library', 'pick', ['sound effect']],
    ['elevenlabs', 'auto', ['sound effect']],
    ['manual', 'person', ['visual', 'music', 'sound effect']],
    ['elevenlabs-music', 'auto', ['music']],
    ['elevenlabs-images', 'auto', ['visual']],
  ])
  const icons = ['openai', 'suno', 'elevenlabs', 'library', 'manual']
  for (const one of Object.values(PROVIDERS)) {
    assert.equal(typeof one.check, 'function')
    // Every provider has a card: a title, a line, facts and one of the known icons.
    assert.deepEqual(Object.keys(one.card), ['title', 'line', 'facts', 'icon'], one.name)
    assert.ok(one.card.title !== '' && one.card.line !== '' && Array.isArray(one.card.facts) && one.card.facts.length > 0, one.name)
    assert.ok(icons.includes(one.card.icon), one.name)
  }
  assert.deepEqual(PROVIDERS.codex.card, { title: 'Codex', line: 'Pictures on your ChatGPT plan', facts: ['Signed in as you', 'One at a time, in a queue'], icon: 'openai' })
  assert.deepEqual(PROVIDERS.manual.card, { title: 'Manual', line: 'You drop your own file, any tool', facts: ['Free', 'The board asks you each time'], icon: 'manual' })
  // None is shown without serving a kind (Claude was, on visual, until 2026-11-02: it draws no pictures).
  assert.deepEqual(Object.values(PROVIDERS).filter(one => 'shownFor' in one).map(one => one.name), [])
  // What each kind is set to by default serves it.
  for (const kind of ASSET_KINDS) assert.ok(PROVIDERS[DEFAULT_PROVIDERS[kind].provider].kinds.includes(kind), kind)
  // Only the sound library has a folder, and it names its own default.
  assert.deepEqual(Object.values(PROVIDERS).map(one => one.folder ?? null), [null, null, 'sound-library', null, null, null, null])
  // Part C: every provider provides (test/assets.test.mjs).
  assert.deepEqual(Object.values(PROVIDERS).filter(one => typeof one.provide !== 'function').map(one => one.name), [])
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
  assert.equal(providerFor(set, 'sound effect').provider, elevenlabsModule)
  const lines = await checkProviders(set, { project: '', findCodex: async () => null, key: KEY, fetch: answering(200, { tier: 'free', character_count: 50, character_limit: 10000 }) })
  assert.deepEqual(lines[2], { kind: 'sound effect', provider: 'elevenlabs', mode: 'auto', ok: true, why: 'works (free plan: for testing only, 9,950 credits left)' })
  // With no key the line says so and the other kinds go on.
  const keyless = await checkProviders(set, { project: '', findCodex: async () => null, key: '' })
  assert.deepEqual(keyless.map(one => [one.provider, one.ok]), [['codex', false], ['person-suno', true], ['elevenlabs', false]])
  assert.equal(keyless[2].why, 'No ElevenLabs key (ELEVENLABS_API_KEY)')
})

test('providerFor: the module set for a kind and its folder; the default where the settings name none; null for what the board does not know', () => {
  const set = settings('{"providers": {"sound effect": {"provider": "sound-library", "folder": "sfx"}}}')
  assert.deepEqual([providerFor(set, 'visual').provider, providerFor(set, 'visual').folder], [codexModule, null])
  assert.deepEqual([providerFor(set, 'music').provider, providerFor(set, 'music').folder], [personSunoModule, null])
  assert.deepEqual([providerFor(set, 'sound effect').provider, providerFor(set, 'sound effect').folder], [soundLibraryModule, 'sfx'])
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

// Part A (spec 2026-11-01): the state and the detail of every check, the new providers, and the shared key code.

test('every check answers a state (works, needs or off) and a short detail for the card', async t => {
  const project = await tempDir(t)
  await mkdir(join(project, 'sound-library'))
  await writeFile(join(project, 'sound-library', 'hit.wav'), 'x')
  assert.deepEqual(await codexModule.check({ findCodex: async () => 'C:\\codex.exe' }), { ok: true, state: 'works', why: 'Codex found', detail: 'Codex found' })
  assert.equal((await codexModule.check({ findCodex: async () => null })).state, 'needs')
  assert.deepEqual(await personSunoModule.check(), { ok: true, state: 'works', why: 'you make it in Suno', detail: 'asks you for a file' })
  assert.deepEqual(await soundLibraryModule.check({ project }), { ok: true, state: 'works', why: 'The sound library folder "sound-library" holds sounds', detail: '1 sound found' })
  assert.deepEqual(await manual.check(), { ok: true, state: 'works', why: 'nothing to check', detail: 'Always works' })
  const ok = await elevenlabsModule.check({ key: KEY, fetch: answering(200, { tier: 'free', character_count: 50, character_limit: 10000 }) })
  assert.deepEqual(ok, { ok: true, state: 'works', why: 'works (free plan: for testing only, 9,950 credits left)', detail: '9,950 credits left' })
  assert.deepEqual(await elevenlabsModule.check({ key: KEY, fetch: answering(200, {}) }), { ok: true, state: 'works', why: 'works', detail: 'Key works' })
  assert.deepEqual(await elevenlabsModule.check({ key: '' }), { ok: false, state: 'needs', why: 'No ElevenLabs key (ELEVENLABS_API_KEY)', detail: 'Paste your key first' })
  assert.equal((await elevenlabsModule.check({ key: KEY, fetch: answering(401, {}) })).state, 'needs')
})

test('sound-library: the detail counts the sound files, and stops counting at 10,000', async t => {
  const project = await tempDir(t)
  await mkdir(join(project, 'lib', 'a', 'b'), { recursive: true })
  for (const file of ['one.wav', 'two.mp3', 'a/three.ogg', 'a/b/four.flac', 'a/notes.txt']) await writeFile(join(project, 'lib', ...file.split('/')), 'x')
  assert.equal((await soundLibraryModule.check({ project, folder: 'lib' })).detail, '4 sounds found')
  await mkdir(join(project, 'big'))
  // In batches: a few thousand files opened at once run Windows out of file handles.
  for (let from = 0; from < COUNT_STOP + 5; from += 200) await Promise.all(Array.from({ length: 200 }, (_, at) => writeFile(join(project, 'big', `s${from + at}.wav`), '')))
  assert.equal((await soundLibraryModule.check({ project, folder: 'big' })).detail, '10,000+ sounds found')
  assert.equal((await soundLibraryModule.check({ project, folder: 'missing' })).state, 'needs')
})

test('the three ElevenLabs providers share one key check: the same answers, the same key variable', async () => {
  for (const one of [elevenlabsModule, elevenlabsMusic, elevenlabsImages]) {
    assert.equal(one.keyVariable, 'ELEVENLABS_API_KEY', one.name)
    assert.deepEqual(await one.check({ key: '' }), { ok: false, state: 'needs', why: 'No ElevenLabs key (ELEVENLABS_API_KEY)', detail: 'Paste your key first' }, one.name)
    assert.deepEqual(await one.check({ key: KEY, fetch: answering(401, { detail: { status: 'invalid_api_key' } }) }), { ok: false, state: 'needs', why: 'ElevenLabs refused the key', detail: 'Key refused' }, one.name)
    assert.deepEqual(await one.check({ key: KEY, fetch: answering(500, {}) }), { ok: false, state: 'needs', why: 'ElevenLabs did not answer', detail: 'No answer' }, one.name)
  }
  const pro = { tier: 'pro', character_count: 100, character_limit: 500000 }
  assert.deepEqual(await elevenlabsMusic.check({ key: KEY, fetch: answering(200, pro) }), { ok: true, state: 'works', why: 'works (499,900 credits left)', detail: '499,900 credits left' })
  assert.equal(elevenlabsMusic.kinds.join(), 'music')
})

test('elevenlabs-images: a plan below Pro (free, starter, creator) needs the Pro plan; pro and above work; an unnamed plan needs too', async () => {
  const needs = { ok: false, state: 'needs', why: 'Needs the Pro plan', detail: 'Needs the Pro plan' }
  for (const tier of ['free', 'starter', 'creator', 'Creator']) assert.deepEqual(await elevenlabsImages.check({ key: KEY, fetch: answering(200, { tier }) }), needs, tier)
  for (const tier of ['pro', 'scale', 'business']) assert.equal((await elevenlabsImages.check({ key: KEY, fetch: answering(200, { tier }) })).ok, true, tier)
  // A plan the answer does not name (a key that may not read it) cannot be told from a free one: Verify does not pass.
  const unknown = { ok: false, state: 'needs', why: 'Plan unknown: Pro needed', detail: 'Plan unknown: Pro needed' }
  assert.deepEqual(await elevenlabsImages.check({ key: KEY, fetch: answering(200, {}) }), unknown)
  assert.deepEqual(await elevenlabsImages.check({ key: KEY, fetch: answering(401, { detail: { status: 'missing_permissions' } }) }), unknown)
})

test('claude is no provider (removed 2026-11-02): the settings refuse it for every kind', () => {
  assert.equal(PROVIDERS.claude, undefined)
  for (const kind of ASSET_KINDS) assert.notEqual(configProblem(`{"providers": {"${kind}": "claude"}}`), null, kind)
  // The default stays: a refused setting reads as the default.
  assert.deepEqual(settings('{"providers": {"visual": "claude"}}').providers.visual, { provider: 'codex' })
})

test('the new providers are settable where they serve: manual for every kind, elevenlabs-music for music, elevenlabs-images for visual', () => {
  for (const kind of ASSET_KINDS) assert.equal(configProblem(`{"providers": {"${kind}": "manual"}}`), null, kind)
  assert.equal(configProblem('{"providers": {"music": "elevenlabs-music"}}'), null)
  assert.equal(configProblem('{"providers": {"visual": "elevenlabs-images"}}'), null)
  assert.notEqual(configProblem('{"providers": {"visual": "elevenlabs-music"}}'), null)
  assert.notEqual(configProblem('{"providers": {"sound effect": "elevenlabs-images"}}'), null)
})
