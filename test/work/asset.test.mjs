// Part C of the asset providers (spec 2026-11-01-asset-providers-screens-design.md, part 4): the work tool's `asset`. Every
// role asks the board for an asset; the board keeps the request (src/assets.mjs) and routes it to the provider in use for
// the kind: auto waits in the queue with its place in line, person becomes the person's ask (in the board's name), pick
// answers the library folder and takes the chat's pick. Made-up samples and stand-in providers only.

import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { assetFolder, readAsset } from '../../src/assets.mjs'
import { PROVIDERS } from '../../src/providers/index.mjs'
import { workApi } from '../../src/work/api.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'
import { tempDir } from '../tempDir.mjs'

const NOW = new Date(2026, 10, 2, 10, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge', ''].join('\n')
const ROLES = { Lead: 'main', Digger: 'worker', Sage: 'advisor', Watch: 'supervisor', Po: 'owner' }

async function garden(t, setting = { visual: 'codex', music: 'person-suno', 'sound effect': 'sound-library' }) {
  const project = await tempDir(t)
  const dir = join(project, '.claude', 'work')
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60_000 }), undefined, { now: NOW - 60_000 })
  const assetsDir = join(project, '.claude', 'assets')
  await mkdir(join(project, 'sounds', 'doors'), { recursive: true })
  await writeFile(join(project, 'sounds', 'doors', 'creak.wav'), 'wav')
  await writeFile(join(project, 'sounds', 'notes.txt'), 'x')
  await mkdir(join(project, 'art'))
  await writeFile(join(project, 'art', 'look.png'), 'png')
  const assets = {
    dir: assetsDir, project,
    providerOf: kind => ({ provider: PROVIDERS[setting[kind]], folder: setting[kind] === 'sound-library' ? 'sounds' : null }),
    tools: () => ({ project }),
  }
  const ctx = { dir, now: NOW, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(), assets }
  const as = chat => body => workApi({ chat, action: 'asset', ...body }, ctx)
  return { project, dir, assetsDir, as, ctx }
}

test('asset: every role asks; the person on the page does not; an auto request answers its place in line at once', async t => {
  const { as, ctx, assetsDir, project } = await garden(t)
  const first = await as('Digger')({ kind: 'visual', text: 'a stone stair, side view', of: 'B1', pictures: ['art/look.png'] })
  assert.equal(first.ok, true, first.why)
  assert.deepEqual({ ...first.result, text: undefined }, { id: 'A1', place: 1, provider: 'codex', mode: 'auto', folder: assetFolder(assetsDir, 'A1'), text: undefined, changed: false })
  assert.match(first.result.text, /^A1: Codex makes it, place 1 in line\. You get "asset A1 ready: <folder>"/)
  const kept = await readAsset(assetsDir, 'A1')
  assert.deepEqual([kept.who, kept.of, kept.kind, kept.provider, kept.mode, kept.state, kept.pictures], ['Digger', 'B1', 'visual', 'codex', 'auto', 'waiting', [join(project, 'art', 'look.png')]])
  for (const [n, chat] of ['Lead', 'Sage', 'Watch', 'Po'].entries()) {
    const done = await as(chat)({ kind: 'visual', text: `picture ${n}` })
    assert.equal(done.ok, true, `${chat}: ${done.why}`)
    assert.equal(done.result.place, n + 2)
  }
  // The board itself asks too; the page does not, and a chat outside the list is no chat.
  assert.equal((await workApi({ action: 'asset', kind: 'visual', text: 'x' }, { ...ctx, as: 'server' })).ok, true)
  assert.equal((await workApi({ action: 'asset', kind: 'visual', text: 'x' }, { ...ctx, as: 'person' })).status, 403)
  assert.equal((await as('Stranger')({ kind: 'visual', text: 'x' })).status, 403)
  // Nothing on the backlog: the store holds no new item.
  assert.equal([...(await readStore(ctx.dir)).items.keys()].filter(id => !id.startsWith('B')).length, 0)
})

test('asset: what is refused: an unknown kind, no words, a step that is none, a missing picture, a follow-up of another kind', async t => {
  const { as } = await garden(t)
  const digger = as('Digger')
  assert.equal((await digger({ kind: 'painting', text: 'x' })).why, '"kind" is visual, music, sound effect.')
  assert.equal((await digger({ kind: 'music', text: '  ' })).why, 'Say in "text" what it should sound like.')
  assert.equal((await digger({ kind: 'visual', text: 'x', of: 'G4' })).why, '"of" is your step (B12): G4 is none.')
  assert.match((await digger({ kind: 'visual', text: 'x', pictures: ['art/none.png'] })).why, /^There is no picture at art\/none\.png/)
  assert.equal((await digger({ kind: 'visual', text: 'x', follows: 'A9' })).why, 'There is no asset request A9 to follow.')
  assert.equal((await digger({ kind: 'visual', text: 'a hedge' })).ok, true)
  assert.equal((await digger({ kind: 'music', text: 'calm', follows: 'A1' })).why, 'A1 is visual, not music: a follow-up is the same kind.')
  const next = await digger({ kind: 'visual', text: 'greener', follows: 'A1' })
  assert.equal(next.ok, true)
  assert.equal((await readAsset(next.result.folder.replace(/[\\/]A2$/, ''), 'A2')).follows, 'A1')
})

test('asset: a person provider becomes the person\'s ask of kind provide, in the board\'s name, with the folder to drop the file in', async t => {
  const { as, dir, assetsDir } = await garden(t)
  const done = await as('Digger')({ kind: 'music', text: 'a calm lava cave tune', of: 'B1' })
  assert.equal(done.ok, true, done.why)
  assert.deepEqual([done.result.id, done.result.mode, done.result.place, done.result.ask, done.result.changed], ['A1', 'person', null, 'Q1', true])
  assert.match(done.result.text, /Do not ask the person for it yourself/)
  const ask = (await readStore(dir)).items.get('Q1')
  assert.deepEqual([valueOf(ask, 'Asks'), valueOf(ask, 'Owner'), valueOf(ask, 'State')], ['provide', 'server', 'open'])
  assert.deepEqual(ask.sections.get('Text'), [
    `Make it in Suno and drop the file in ${assetFolder(assetsDir, 'A1')}`,
    'What it should sound like: a calm lava cave tune',
    'Asked by Digger for B1 as asset A1: the board hands the file on once it is in the folder.',
  ])
  assert.equal((await readAsset(assetsDir, 'A1')).ask, 'Q1')
})

test('asset: the library answers its folder at once; only the asking chat picks, once, a sound inside it, copied into the request', async t => {
  const { as, project, assetsDir } = await garden(t)
  const done = await as('Digger')({ kind: 'sound effect', text: 'a door creaks' })
  assert.equal(done.ok, true, done.why)
  assert.deepEqual([done.result.id, done.result.mode, done.result.pick], ['A1', 'pick', join(project, 'sounds')])
  assert.equal((await as('Lead')({ id: 'A1', picked: 'doors/creak.wav' })).why, 'A1 is Digger\'s: only the chat that asked picks.')
  assert.match((await as('Digger')({ id: 'A1', picked: '../art/look.png' })).why, /is not in the library/)
  assert.match((await as('Digger')({ id: 'A1', picked: 'notes.txt' })).why, /is no sound file/)
  assert.equal((await as('Digger')({ id: 'A1', picked: 'doors/none.wav' })).status, 404)
  assert.equal((await as('Digger')({ id: 'A7', picked: 'doors/creak.wav' })).status, 404)
  const picked = await as('Digger')({ id: 'A1', picked: 'doors/creak.wav' })
  assert.equal(picked.ok, true, picked.why)
  assert.equal(picked.result.text, `asset A1 ready: ${assetFolder(assetsDir, 'A1')}`)
  assert.deepEqual((await readdir(assetFolder(assetsDir, 'A1'))).sort(), ['creak.wav', 'request.json'])
  const kept = await readAsset(assetsDir, 'A1')
  assert.deepEqual([kept.state, kept.files], ['ready', ['creak.wav']])
  assert.equal((await as('Digger')({ id: 'A1', picked: join(project, 'sounds', 'doors', 'creak.wav') })).why, 'A1 is ready already.')
  // A request its provider makes takes no pick.
  await as('Digger')({ kind: 'visual', text: 'x' })
  assert.equal((await as('Digger')({ id: 'A2', picked: 'doors/creak.wav' })).why, 'A2 is no library request: its provider makes it.')
})

test('asset: a provider that cannot be asked fails the request at once, with why; a board without requests says so', async t => {
  const { as, assetsDir, ctx } = await garden(t, { visual: 'elevenlabs-images', music: 'person-suno', 'sound effect': 'sound-library' })
  // ElevenLabs Images is auto: it waits in line; the queue fails it with "not wired yet".
  assert.equal((await as('Digger')({ kind: 'visual', text: 'x' })).result.mode, 'auto')
  const noLibrary = await workApi({ chat: 'Digger', action: 'asset', kind: 'sound effect', text: 'x' }, { ...ctx, assets: { ...ctx.assets, providerOf: () => ({ provider: PROVIDERS['sound-library'], folder: '../outside' }) } })
  assert.equal(noLibrary.why, 'A2 failed: The sound library folder "../outside" is not inside the project')
  assert.equal((await readAsset(assetsDir, 'A2')).state, 'failed')
  assert.equal((await workApi({ chat: 'Digger', action: 'asset', kind: 'visual', text: 'x' }, { ...ctx, assets: undefined })).status, 409)
  assert.equal((await workApi({ chat: 'Digger', action: 'asset', kind: 'visual', text: 'x' }, { ...ctx, assets: { ...ctx.assets, providerOf: () => null } })).status, 409)
})
