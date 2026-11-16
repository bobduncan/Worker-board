// T5.2 P4 (the design of 2026-11-16, sections 6 and 7): the project's settings travel with its data in a settings.json (tracked, in its data
// home); config.json keeps only this PC's keys (paths, ports, Codex, the pictures home). The merge order is the defaults, then settings.json,
// then this PC's keys. With no settings.json nothing changes. A made-up project in a temp folder only.

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { BrokenConfig, PC_KEYS, SETTINGS_FILE, loadConfig, mergeSettings, settingFileFor, settingsFileOf } from '../src/config.mjs'

const ENV = { USERPROFILE: 'C:\\Users\\someone', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }

async function world(t, { config, settings = null, data = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'config-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const project = join(dir, 'garden')
  const gameRepo = join(project, 'game')
  const file = join(dir, 'config.json')
  const home = join(dir, 'data-clone')
  await writeFile(file, JSON.stringify({ project, gameRepo, appSessions: join(dir, 'app'), usageHistory: join(dir, 'usage.json'), ...(data ? { data: home } : {}), ...config }))
  if (settings !== null) {
    await mkdir(home, { recursive: true })
    await writeFile(join(home, SETTINGS_FILE), typeof settings === 'string' ? settings : JSON.stringify(settings))
  }
  return { dir, project, gameRepo, file, home, settingsFile: join(home, SETTINGS_FILE) }
}

test('with no settings.json nothing changes: the settings are what config.json alone gives', async t => {
  const one = await world(t, { config: { name: 'Garden', maxWorkers: 3, approveRebuilds: true, providers: { visual: 'codex' } } })
  const config = await loadConfig(one.file, ENV, 'win32')
  assert.deepEqual([config.settingsFile, config.settingsIgnored, config.hasProvidersKey], [null, [], true])
  assert.deepEqual([config.name, config.maxWorkers, config.approveRebuilds, config.gameRepo], ['Garden', 3, true, one.gameRepo])
  const without = await world(t, { config: { name: 'Garden' } })
  assert.equal((await loadConfig(without.file, ENV, 'win32')).hasProvidersKey, false)
})

test('with settings.json: the project\'s keys come from it, this PC\'s from config.json; a project key left in config.json is ignored and named', async t => {
  const one = await world(t, {
    config: { maxWorkers: 9, port: 4400 },
    settings: { name: 'Garden', maxWorkers: 2, approveRebuilds: true, providers: { visual: 'codex' }, gameRepo: 'C:\\elsewhere', port: 1, gamePort: 2 },
  })
  const config = await loadConfig(one.file, ENV, 'win32')
  assert.equal(config.settingsFile, one.settingsFile)
  assert.deepEqual([config.name, config.maxWorkers, config.approveRebuilds], ['Garden', 2, true], 'the project\'s keys from settings.json')
  assert.deepEqual([config.gameRepo, config.port, config.project], [one.gameRepo, 4400, one.project], 'this PC\'s keys from config.json, never from settings.json')
  assert.notEqual(config.gamePort, 2, 'a PC key only in settings.json is not taken either')
  assert.deepEqual(config.settingsIgnored, ['maxWorkers'])
  // hasGame stays true; the providers setup does not start again.
  assert.notEqual(config.gameRepo, '')
  assert.equal(config.hasProvidersKey, true)
})

test('no data set: a .workerboard folder with a settings file inside (the carry tool\'s clone) is never read', async t => {
  const one = await world(t, { config: { name: 'Garden', maxWorkers: 3 }, data: false })
  const before = await loadConfig(one.file, ENV, 'win32')
  for (const folder of [join(one.gameRepo, '.workerboard'), join(one.project, '.workerboard')]) {
    await mkdir(join(folder, 'settings'), { recursive: true })
    for (const name of ['settings.json', SETTINGS_FILE]) await writeFile(join(folder, name), JSON.stringify({ name: 'Clone', maxWorkers: 1 }))
  }
  const after = await loadConfig(one.file, ENV, 'win32')
  const timeless = ({ appSearchedAt, appMoved, ...rest }) => rest
  assert.deepEqual(timeless(after), timeless(before))
  assert.deepEqual([after.name, after.maxWorkers, after.settingsFile], ['Garden', 3, null])
})

test('the settings file sits beside the carry tool\'s settings folder in the data clone, both kept', async t => {
  const one = await world(t, { config: {}, settings: { maxWorkers: 2 } })
  await mkdir(join(one.home, 'settings'), { recursive: true })
  await writeFile(join(one.home, 'settings', 'config.json'), '{}')
  const config = await loadConfig(one.file, ENV, 'win32')
  assert.deepEqual([config.settingsFile, config.maxWorkers], [one.settingsFile, 2])
  assert.notEqual(SETTINGS_FILE, 'settings')
})

test('a broken settings.json is refused, naming that file', async t => {
  const one = await world(t, { config: {}, settings: '{ "maxWorkers": 2, ' })
  await assert.rejects(loadConfig(one.file, ENV, 'win32'), error => error instanceof BrokenConfig && error.message.includes(one.settingsFile))
  const wrong = await world(t, { config: {}, settings: { incidentGoneMinutes: 'many' } })
  await assert.rejects(loadConfig(wrong.file, ENV, 'win32'), error => error instanceof BrokenConfig && error.message.includes(wrong.settingsFile))
})

test('the settings file\'s place and the file each write goes to', () => {
  assert.equal(settingsFileOf({ project: 'P', gameRepo: 'G' }), null, 'no data: no settings file')
  assert.equal(settingsFileOf({ project: 'P', gameRepo: 'G', data: '  ' }), null)
  assert.equal(settingsFileOf({ project: 'P', gameRepo: 'G', data: 'C:\\D' }, 'C:\\B'), join('C:\\D', SETTINGS_FILE))
  assert.equal(settingsFileOf({ data: 'D' }, 'C:\\B'), join('C:\\B', 'D', SETTINGS_FILE), 'a relative data folder from the config file\'s folder')
  const config = { settingsFile: 'S' }
  assert.equal(settingFileFor(config, 'C', 'maxWorkers'), 'S')
  assert.equal(settingFileFor(config, 'C', 'providers'), 'S')
  assert.equal(settingFileFor(config, 'C', 'port'), 'C', 'this PC\'s key')
  assert.equal(settingFileFor({ settingsFile: null }, 'C', 'maxWorkers'), 'C', 'no settings.json: config.json as today')
  assert.ok(['project', 'gameRepo', 'appSessions', 'transcripts', 'port', 'codex', 'picturesHome'].every(key => PC_KEYS.includes(key)))
  assert.deepEqual(mergeSettings({ a: 1, port: 2 }, { a: 3, port: 4 }), { raw: { a: 1, port: 4 }, ignored: ['a'] })
})

test('the server writes the settings panel and the providers to the file settingFileFor names, and checks the providers setup on the merged settings', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.equal(server.match(/const file = settingFileFor\(config, join\(HERE, 'config\.json'\), checked\.key\)/g)?.length, 2)
  assert.match(server, /await startSetup\(setupFile, \{ hasProvidersKey: config\.hasProvidersKey === true \}\)/)
})
