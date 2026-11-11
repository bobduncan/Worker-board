// Part C of the asset providers (spec 2026-11-01-asset-providers-screens-design.md, part 4; spec 2026-10-25, part 2): the
// asset requests the board keeps (src/assets.mjs), its queue (src/assetQueue.mjs) and each provider's `provide`. Made-up
// folders and stand-ins for makePicture, findCodex, fetch and the key: nothing here reaches Codex or ElevenLabs.

import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { STOPPED_WHY, assetQueue, providerAskTitle } from '../src/assetQueue.mjs'
import { assetFolder, assetsFolderOf, changeAsset, droppedFiles, listAssets, newAsset, readAsset } from '../src/assets.mjs'
import { codex } from '../src/providers/codex.mjs'
import { elevenlabs } from '../src/providers/elevenlabs.mjs'
import { elevenlabsImages } from '../src/providers/elevenlabs-images.mjs'
import { elevenlabsMusic } from '../src/providers/elevenlabs-music.mjs'
import { manual } from '../src/providers/manual.mjs'
import { personSuno } from '../src/providers/person-suno.mjs'
import { soundLibrary } from '../src/providers/sound-library.mjs'
import { tempDir } from './tempDir.mjs'

const NOW = new Date(2026, 10, 2, 10, 0).getTime()
const KEY = 'sk_test_made_up_key_123'

/** A stand-in for fetch: answers `status` with `bytes` (or a JSON body), and keeps every call. */
function fakeFetch({ status = 200, bytes = Buffer.from('ID3 made-up mp3'), json = null } = {}) {
  const calls = []
  const fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      status, ok: status >= 200 && status < 300,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      json: async () => json,
    }
  }
  return { fetch, calls }
}

test('assets: the folder sits beside the work store; ids count up; a change is written whole and stamps its times', async t => {
  assert.equal(assetsFolderOf(join('C:', 'garden', '.claude', 'work')), join('C:', 'garden', '.claude', 'assets'))
  const dir = join(await tempDir(t), 'assets')
  const [one, two] = await Promise.all([
    newAsset(dir, { who: 'Digger', of: 'B1', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a hedge' }, NOW),
    newAsset(dir, { who: 'Sage', kind: 'music', provider: 'person-suno', mode: 'person', text: 'a calm tune' }, NOW + 1),
  ])
  // Two at once never get the same id.
  assert.deepEqual([one.id, two.id], ['A1', 'A2'])
  assert.deepEqual(one, {
    id: 'A1', who: 'Digger', of: 'B1', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a hedge', pictures: [], follows: null,
    state: 'waiting', why: '', files: [], ask: null, pick: null, times: { asked: NOW, started: null, ended: null },
  })
  assert.deepEqual(await readAsset(dir, 'A1'), one)
  assert.equal(await readAsset(dir, 'A9'), null)
  assert.equal(await readAsset(dir, '../A1'), null)
  const running = await changeAsset(dir, 'A1', { state: 'running' }, NOW + 5)
  assert.equal(running.times.started, NOW + 5)
  const ready = await changeAsset(dir, 'A1', record => ({ state: 'ready', files: [...record.files, '1.png'] }), NOW + 9)
  assert.deepEqual([ready.state, ready.files, ready.times], ['ready', ['1.png'], { asked: NOW, started: NOW + 5, ended: NOW + 9 }])
  assert.equal(await changeAsset(dir, 'A1', () => null), null)
  assert.equal(await changeAsset(dir, 'A7', { state: 'failed' }), null)
  assert.deepEqual((await listAssets(dir)).map(record => record.id), ['A1', 'A2'])
  // A file being written or the request itself is no dropped file.
  await writeFile(join(assetFolder(dir, 'A2'), 'tune.mp3.part'), 'x')
  assert.deepEqual(await droppedFiles(dir, 'A2'), [])
  await writeFile(join(assetFolder(dir, 'A2'), 'tune.mp3'), 'x')
  assert.deepEqual(await droppedFiles(dir, 'A2'), ['tune.mp3'])
  // No folder yet: no requests.
  assert.deepEqual(await listAssets(join(dir, 'none')), [])
})

/** A made-up auto provider: its check answers `works()`, its provide waits for `release` and writes `1.png`. */
function standIn(name, { works = () => true, why = 'not signed in', fail = null } = {}) {
  const made = []
  let open = []
  const provider = {
    name, mode: 'auto', kinds: ['visual'], card: { title: name.toUpperCase() },
    check: () => (works() ? { ok: true, state: 'works', why: 'ok' } : { ok: false, state: 'needs', why }),
    provide: request => new Promise(resolve => {
      made.push(request)
      open.push(async () => {
        if (fail !== null) return resolve({ failed: fail })
        await writeFile(join(request.folder, '1.png'), 'png')
        resolve({ files: ['1.png'] })
      })
    }),
  }
  const release = async () => {
    const now = open
    open = []
    for (const one of now) await one()
  }
  return { provider, made, release }
}

async function queueOf(t, providers, more = {}) {
  const dir = join(await tempDir(t), 'assets')
  const told = []
  const asks = []
  const closed = []
  const open = new Set()
  const queue = assetQueue({
    dir, providers, now: () => NOW,
    fileAsk: async ({ provider, title, kind, why }) => {
      const id = `Q${asks.length + 1}`
      asks.push({ id, provider, words: providerAskTitle(title, kind, why) })
      open.add(id)
      return id
    },
    closeAsk: async (id, why) => { closed.push([id, why]); open.delete(id) },
    askOpen: async id => open.has(id),
    tell: async record => told.push(`${record.who}: asset ${record.id} ${record.state}${record.why === '' ? '' : `: ${record.why}`}`),
    ...more,
  })
  const ask = fields => newAsset(dir, { who: 'Digger', kind: 'visual', provider: 'codex', mode: 'auto', text: 'a hedge', ...fields }, NOW)
  return { dir, queue, told, asks, closed, open, ask }
}

test('the queue: one request at a time per provider, oldest first; another provider runs beside it; the chat is told', async t => {
  const codexLike = standIn('codex')
  const other = standIn('elevenlabs-images')
  const { dir, queue, told, ask } = await queueOf(t, { codex: codexLike.provider, 'elevenlabs-images': other.provider })
  await ask({ text: 'first' })
  await ask({ text: 'second' })
  await ask({ provider: 'elevenlabs-images', text: 'beside' })
  await queue.pass()
  // Only the oldest of each provider runs.
  assert.deepEqual(codexLike.made.map(one => one.text), ['first'])
  assert.deepEqual(other.made.map(one => one.text), ['beside'])
  assert.deepEqual(queue.busy().sort(), ['codex', 'elevenlabs-images'])
  assert.deepEqual((await listAssets(dir)).map(one => one.state), ['running', 'waiting', 'running'])
  // A second look while it runs starts nothing more.
  await queue.pass()
  assert.equal(codexLike.made.length, 1)
  await codexLike.release()
  await other.release()
  await queue.idle()
  assert.deepEqual(told, ['Digger: asset A1 ready', 'Digger: asset A3 ready'])
  await queue.pass()
  assert.deepEqual(codexLike.made.map(one => one.text), ['first', 'second'])
  // The request as the provider got it: its own folder, whole paths.
  assert.deepEqual(codexLike.made[1], { id: 'A2', kind: 'visual', text: 'second', pictures: [], folder: assetFolder(dir, 'A2'), edits: false })
  await codexLike.release()
  await queue.idle()
  assert.deepEqual((await readAsset(dir, 'A2')).files, ['1.png'])
  assert.equal(told.length, 3)
})

test('the queue: a follow-up of a picture starts from the last picture of the request it follows', async t => {
  const codexLike = standIn('codex')
  const { dir, queue, ask } = await queueOf(t, { codex: codexLike.provider })
  await ask({ text: 'a hedge' })
  await queue.pass()
  await codexLike.release()
  await queue.idle()
  await ask({ text: 'greener', follows: 'A1', pictures: ['C:\\ref.png'] })
  await queue.pass()
  assert.deepEqual(codexLike.made[1].pictures, [join(assetFolder(dir, 'A1'), '1.png'), 'C:\\ref.png'])
  assert.equal(codexLike.made[1].edits, true)
})

test('the queue: a provider whose check fails leaves its requests waiting, with one ask for the person, taken back once it works', async t => {
  let works = false
  const codexLike = standIn('codex', { works: () => works, why: 'Codex not found' })
  const { dir, queue, asks, closed, open, ask, told } = await queueOf(t, { codex: codexLike.provider })
  await ask({ text: 'one' })
  await ask({ text: 'two' })
  await queue.pass()
  await queue.pass()
  assert.deepEqual(asks, [{ id: 'Q1', provider: 'codex', words: 'CODEX does not work for visual: Codex not found' }])
  assert.deepEqual(codexLike.made, [])
  assert.deepEqual((await listAssets(dir)).map(one => one.state), ['waiting', 'waiting'])
  // Kept beside the requests: a board started anew asks no second time.
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(dir, 'provider-asks.json'), 'utf8'))), ['codex'])
  // Closed by the person while it still fails: not asked again (said once).
  open.delete('Q1')
  await queue.pass()
  assert.equal(asks.length, 1)
  open.add('Q1')
  works = true
  await queue.pass()
  assert.deepEqual(closed, [['Q1', 'CODEX works again']])
  assert.deepEqual(codexLike.made.map(one => one.text), ['one'])
  await codexLike.release()
  await queue.idle()
  assert.deepEqual(told, ['Digger: asset A1 ready'])
  // A later failure may ask anew.
  works = false
  await queue.pass()
  assert.deepEqual(asks.map(one => one.id), ['Q1', 'Q2'])
})

test('the queue: a failed provide and a provide that throws fail the request, with why; a stop cuts off what ran', async t => {
  const failing = standIn('codex', { fail: 'Codex made no picture.' })
  const { dir, queue, told, ask } = await queueOf(t, { codex: failing.provider, thrower: { name: 'thrower', mode: 'auto', card: { title: 'Thrower' }, check: () => ({ ok: true }), provide: () => { throw new Error('boom') } } })
  await ask({ text: 'one' })
  await ask({ text: 'two', provider: 'thrower' })
  await ask({ text: 'three', provider: 'gone' })
  await queue.pass()
  await failing.release()
  await queue.idle()
  assert.deepEqual([...told].sort(), ['Digger: asset A2 failed: Thrower could not make it', 'Digger: asset A1 failed: Codex made no picture.', 'Digger: asset A3 failed: The board has no provider gone that makes visual'].sort())
  // The asset-stop rerun (2026-11-11, A245): a request cut by the board's stop goes back to waiting and runs again by itself; its chat
  // hears of it only when it is ready, or failed past the cap (test/assetStopRerun.test.mjs).
  await ask({ text: 'four' })
  await changeAsset(dir, 'A4', { state: 'running' })
  await queue.recover()
  const back = await readAsset(dir, 'A4')
  assert.deepEqual([back.state, back.why, back.limit.why, back.limit.tries], ['waiting', '', STOPPED_WHY, 1])
  assert.ok(!told.some(one => one.includes('A4')), 'nobody is told of a job that runs again')
})

test('the queue: a person request is ready once a file lands; its ask is taken back; an ask closed without a file fails it', async t => {
  const { dir, queue, told, closed, open, ask } = await queueOf(t, {})
  await ask({ kind: 'music', provider: 'person-suno', mode: 'person', text: 'calm' })
  await changeAsset(dir, 'A1', { ask: 'Q5' })
  open.add('Q5')
  await queue.pass()
  assert.deepEqual(told, [])
  await writeFile(join(assetFolder(dir, 'A1'), 'calm.wav'), 'wav')
  await queue.pass()
  assert.deepEqual(told, ['Digger: asset A1 ready'])
  assert.deepEqual((await readAsset(dir, 'A1')).files, ['calm.wav'])
  assert.deepEqual(closed, [['Q5', 'the file arrived in A1']])
  await ask({ kind: 'music', provider: 'manual', mode: 'person', text: 'loud' })
  await changeAsset(dir, 'A2', { ask: 'Q6' })
  await queue.pass()
  assert.equal(told.at(-1), 'Digger: asset A2 failed: Q6 was closed without a file in the folder')
})

test('codex provide: one picture through makePicture, with only the request\'s words and pictures, kept as 1.png', async t => {
  const folder = await tempDir(t)
  const calls = []
  const make = async options => {
    calls.push(options)
    await writeFile(options.to, 'png')
    return { ok: true, seconds: 3 }
  }
  const done = await codex.provide({ id: 'A1', kind: 'visual', text: 'a stone stair', pictures: ['C:\\look.png'], folder }, { makePicture: make, findCodex: async () => 'C:\\codex.exe', seconds: 60 })
  assert.deepEqual(done, { files: ['1.png'] })
  assert.deepEqual([calls[0].command, calls[0].images, calls[0].to, calls[0].seconds], [['C:\\codex.exe'], ['C:\\look.png'], join(folder, '1.png'), 60])
  assert.match(calls[0].prompt, /The idea: a stone stair/)
  assert.match(calls[0].prompt, /attached picture is a reference for the look only/)
  // A follow-up: the first picture is the one to change.
  const again = await codex.provide({ id: 'A2', kind: 'visual', text: 'greener', pictures: ['C:\\1.png'], folder, edits: true }, { makePicture: make, findCodex: async () => 'C:\\codex.exe' })
  assert.deepEqual(again, { files: ['2.png'] })
  assert.match(calls[1].prompt, /The first attached picture is the last version\. .*change this: greener/)
  assert.equal(calls[1].seconds, 240)
  // Not found, made nothing, or a stand-in that throws: failed with why, never a throw.
  assert.deepEqual(await codex.provide({ text: 'x', folder }, { makePicture: make, findCodex: async () => null }), { failed: 'Codex not found' })
  assert.deepEqual(await codex.provide({ text: 'x', folder }, { makePicture: async () => ({ ok: false, why: 'Codex took longer than 60 seconds and was stopped.' }), findCodex: async () => 'C:\\codex.exe' }), { failed: 'Codex took longer than 60 seconds and was stopped.' })
  assert.deepEqual(await codex.provide({ text: 'x', folder }, { makePicture: async () => { throw new Error('x') }, findCodex: async () => 'C:\\codex.exe' }), { failed: 'Codex could not be asked for the picture' })
})

test('elevenlabs provide: POST sound-generation with the key in one header; the mp3 kept; the key in no answer', async t => {
  const folder = await tempDir(t)
  const { fetch, calls } = fakeFetch()
  assert.deepEqual(await elevenlabs.provide({ id: 'A1', kind: 'sound effect', text: 'a door creaks', folder }, { key: KEY, fetch }), { files: ['1.mp3'] })
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['xi-api-key'], KEY)
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: 'a door creaks' })
  assert.equal(String(await readFile(join(folder, '1.mp3'))), 'ID3 made-up mp3')
  // Refused, a reason that would repeat the key, no key, an empty file, no answer: failed with why, without the key.
  const answers = [
    await elevenlabs.provide({ text: 'x', folder }, { key: KEY, fetch: fakeFetch({ status: 401 }).fetch }),
    await elevenlabs.provide({ text: 'x', folder }, { key: KEY, fetch: fakeFetch({ status: 422, json: { detail: { message: `bad text for ${KEY}` } } }).fetch }),
    await elevenlabs.provide({ text: 'x', folder }, { key: '', fetch }),
    await elevenlabs.provide({ text: 'x', folder }, { key: KEY, fetch: fakeFetch({ bytes: Buffer.alloc(0) }).fetch }),
    await elevenlabs.provide({ text: 'x', folder }, { key: KEY, fetch: async () => { throw new Error(`fetch failed ${KEY}`) } }),
    await elevenlabs.provide({ text: 'x', folder }, { key: KEY, fetch: () => new Promise(() => {}), makeMs: 20 }),
  ]
  assert.deepEqual(answers, [
    { failed: 'ElevenLabs refused the key' },
    { failed: 'ElevenLabs made nothing (422): bad text for' },
    { failed: 'No ElevenLabs key (ELEVENLABS_API_KEY)' },
    { failed: 'ElevenLabs sent an empty file' },
    { failed: 'ElevenLabs did not answer' },
    { failed: 'ElevenLabs took longer than 0 seconds' },
  ])
  for (const answer of answers) assert.ok(!JSON.stringify(answer).includes(KEY))
  assert.deepEqual(await readdir(folder), ['1.mp3'])
})

test('elevenlabs-music provide: Eleven Music compose with the prompt; elevenlabs-images is not wired yet', async t => {
  const folder = await tempDir(t)
  const { fetch, calls } = fakeFetch()
  assert.deepEqual(await elevenlabsMusic.provide({ id: 'A1', kind: 'music', text: 'calm lava cave', folder }, { key: KEY, fetch }), { files: ['1.mp3'] })
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128')
  assert.deepEqual(JSON.parse(calls[0].options.body), { prompt: 'calm lava cave' })
  assert.deepEqual(elevenlabsImages.provide({ text: 'x', folder }), { failed: 'ElevenLabs Images is not wired yet' })
})

test('person-suno, manual and sound-library provide: an ask for the person, or the library folder to pick from', async t => {
  const project = await tempDir(t)
  const folder = join(project, '.claude', 'assets', 'A3')
  assert.deepEqual(personSuno.provide({ id: 'A3', kind: 'music', text: ' calm tune ', folder }), {
    ask: { kind: 'provide', text: [`Make it in Suno and drop the file in ${folder}`, 'What it should sound like: calm tune'] },
  })
  assert.deepEqual(manual.provide({ id: 'A3', kind: 'visual', text: 'a rock', folder }), {
    ask: { kind: 'provide', text: [`Make it with any tool and drop the file in ${folder}`, 'What it should show: a rock'] },
  })
  await mkdir(join(project, 'sounds'))
  assert.deepEqual(soundLibrary.provide({ id: 'A4' }, { project, folder: 'sounds' }), { pick: join(project, 'sounds') })
  assert.deepEqual(soundLibrary.provide({ id: 'A4' }, { project }), { pick: join(project, 'sound-library') })
  assert.deepEqual(soundLibrary.provide({ id: 'A4' }, { project, folder: '../out' }), { failed: 'The sound library folder "../out" is not inside the project' })
  assert.deepEqual(soundLibrary.provide({ id: 'A4' }, {}), { failed: 'The sound library folder "sound-library" is not inside the project' })
})
