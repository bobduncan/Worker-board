// T5.2 P4: setup's pictures part on a made-up board folder: it never makes config.json (the first start copies examples/config.json,
// B127), writes the choice into the project's settings and this PC's path into config.json, and writes nothing under --check.

import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { picturesPart } from '../src/picturesPart.mjs'

const ENV = { USERPROFILE: 'C:\\Users\\someone', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }
const CLOUDS = [{ kind: 'Google Drive', path: 'G:\\My Drive' }]

async function board(t, config) {
  const dir = await mkdtemp(join(tmpdir(), 'pictures-part-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const project = join(dir, 'garden')
  if (config !== null) await writeFile(join(dir, 'config.json'), JSON.stringify({ project, gameRepo: project, appSessions: join(dir, 'app'), usageHistory: join(dir, 'usage.json'), ...config }, null, 2))
  return { dir, file: join(dir, 'config.json') }
}
const answers = list => { const asked = []; return { asked, ask: async question => { asked.push(question); return list.shift() ?? '' } } }

test('a keyboard setup in a new board folder never makes config.json and asks nothing', async t => {
  const one = await board(t, null)
  const keys = answers(['4'])
  const out = await picturesPart({ boardDir: one.dir, flag: undefined, isTty: true, isCheck: false, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.deepEqual([out.ok, keys.asked.length], [true, 0])
  assert.match(out.lines.join('\n'), /waits for the board's first start/)
  await assert.rejects(access(one.file), 'no config.json made')
  const flagged = await picturesPart({ boardDir: one.dir, flag: 'none', isTty: false, isCheck: false, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.equal(flagged.ok, true)
  await assert.rejects(access(one.file), 'not with a flag either')
})

test('the answer: the choice and this PC\'s path into config.json (no settings file), its other keys kept', async t => {
  const one = await board(t, { name: 'Garden' })
  const keys = answers(['1', ''])
  const out = await picturesPart({ boardDir: one.dir, flag: undefined, isTty: true, isCheck: false, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.equal(out.ok, true, out.lines.join('\n'))
  const saved = JSON.parse(await readFile(one.file, 'utf8'))
  assert.deepEqual([saved.name, saved.pictures, saved.picturesHome], ['Garden', { where: 'Google Drive', folder: 'Worker board' }, join('G:\\My Drive', 'Worker board')])
  assert.equal(keys.asked.length, 2)
})

test('with a project settings file: the choice goes there, this PC\'s path into config.json', async t => {
  const one = await board(t, { data: 'data-clone' })
  await mkdir(join(one.dir, 'data-clone'))
  const settings = join(one.dir, 'data-clone', 'board-settings.json')
  await writeFile(settings, '{\n  "name": "Garden"\n}\n')
  const out = await picturesPart({ boardDir: one.dir, flag: 'none', isTty: false, isCheck: false, ask: async () => '', clouds: CLOUDS, env: ENV })
  assert.equal(out.ok, true, out.lines.join('\n'))
  assert.deepEqual(JSON.parse(await readFile(settings, 'utf8')), { name: 'Garden', pictures: { where: 'this PC' } })
  const saved = JSON.parse(await readFile(one.file, 'utf8'))
  assert.deepEqual([saved.pictures, saved.picturesHome], [undefined, ''])
})

test('--check and no keyboard write nothing; a project that names its pictures is not asked again', async t => {
  const one = await board(t, { name: 'Garden' })
  const before = await readFile(one.file, 'utf8')
  const keys = answers(['4'])
  const checked = await picturesPart({ boardDir: one.dir, flag: 'none', isTty: true, isCheck: true, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.match(checked.lines.join('\n'), /Nothing is written/)
  const noKeys = await picturesPart({ boardDir: one.dir, flag: undefined, isTty: false, isCheck: false, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.match(noKeys.lines.join('\n'), /--pictures <folder> or --pictures none/)
  assert.equal(await readFile(one.file, 'utf8'), before)
  const named = await board(t, { pictures: { where: 'Google Drive', folder: 'Garden' } })
  const second = await picturesPart({ boardDir: named.dir, flag: undefined, isTty: true, isCheck: false, ask: keys.ask, clouds: CLOUDS, env: ENV })
  assert.equal(keys.asked.length, 0)
  assert.equal(JSON.parse(await readFile(named.file, 'utf8')).picturesHome, join('G:\\My Drive', 'Garden'), 'the second PC finds its own path')
  assert.equal(second.ok, true)
})

test('setup runs the pictures part and nothing else of it', async () => {
  const setup = await readFile(new URL('../setup.mjs', import.meta.url), 'utf8')
  assert.match(setup, /await picturesPart\(\{ boardDir: here, flag: given\('pictures'\), isTty: Boolean\(process\.stdin\.isTTY\), isCheck,/)
  assert.doesNotMatch(setup, /withSetting|writeAtomic/)
})
