// T5.2 P4 (the design of 2026-11-16, section 7): setup's question where a project's pictures go, and the split: the choice (`pictures`)
// is the project's, this PC's path to it (`picturesHome`) stays in config.json. Made-up folders only.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig, configProblem, PC_KEYS } from '../src/config.mjs'
import { DEFAULT_PICTURES_FOLDER, homeFor, isPictures, picturesAnswer, picturesAsked, picturesChoices, picturesFlag, withSetting } from '../src/picturesSetup.mjs'

const CLOUDS = [{ kind: 'Google Drive', path: 'G:\\My Drive' }, { kind: 'OneDrive', path: 'C:\\Users\\someone\\OneDrive' }]

test('the choices: each cloud folder found, then somewhere else, then this PC only, numbered from 1', () => {
  assert.deepEqual(picturesChoices(CLOUDS).map(one => [one.key, one.where]), [['1', 'Google Drive'], ['2', 'OneDrive'], ['3', 'elsewhere'], ['4', 'this PC']])
  assert.deepEqual(picturesChoices([]).map(one => one.where), ['elsewhere', 'this PC'], 'no cloud folder: only the two')
  assert.deepEqual(picturesChoices([{ kind: 'Box', path: 'B:\\' }, { kind: 'Dropbox', path: '' }]).map(one => one.where), ['elsewhere', 'this PC'])
})

test('the answers: a cloud folder with its folder name, somewhere else with a whole folder, this PC only', () => {
  const choices = picturesChoices(CLOUDS)
  assert.deepEqual(picturesAnswer(choices, {}), { ok: true, pictures: { where: 'Google Drive', folder: DEFAULT_PICTURES_FOLDER }, picturesHome: join('G:\\My Drive', DEFAULT_PICTURES_FOLDER) })
  assert.deepEqual(picturesAnswer(choices, { typed: '2', folder: 'Garden' }), { ok: true, pictures: { where: 'OneDrive', folder: 'Garden' }, picturesHome: join('C:\\Users\\someone\\OneDrive', 'Garden') })
  assert.deepEqual(picturesAnswer(choices, { typed: '3', path: 'E:\\Art\\Garden' }), { ok: true, pictures: { where: 'elsewhere', folder: 'Garden' }, picturesHome: 'E:\\Art\\Garden' })
  assert.deepEqual(picturesAnswer(choices, { typed: '4' }), { ok: true, pictures: { where: 'this PC' }, picturesHome: '' })
  assert.equal(picturesAnswer(choices, { typed: '9' }).ok, false)
  assert.equal(picturesAnswer(choices, { typed: '3', path: 'Art' }).ok, false, 'somewhere else needs a whole folder')
  assert.equal(picturesAnswer(choices, { typed: '1', folder: 'a\\b' }).ok, false, 'a folder name, no path')
  assert.deepEqual(picturesFlag('none'), { ok: true, pictures: { where: 'this PC' }, picturesHome: '' })
  assert.deepEqual(picturesFlag('E:\\Art\\Garden').picturesHome, 'E:\\Art\\Garden')
})

test('setup asks only with a keyboard, without --check, a flag or a pictures setting', () => {
  const base = { pictures: null, flag: undefined, isTty: true, isCheck: false }
  assert.equal(picturesAsked(base), true)
  assert.equal(picturesAsked({ ...base, isTty: false }), false)
  assert.equal(picturesAsked({ ...base, isCheck: true }), false)
  assert.equal(picturesAsked({ ...base, flag: 'none' }), false)
  assert.equal(picturesAsked({ ...base, pictures: { where: 'this PC' } }), false)
})

test('the second PC: its own path to the project\'s cloud folder, found without asking', () => {
  assert.equal(homeFor({ where: 'OneDrive', folder: 'Garden' }, CLOUDS), join('C:\\Users\\someone\\OneDrive', 'Garden'))
  assert.equal(homeFor({ where: 'Dropbox', folder: 'Garden' }, CLOUDS), null, 'no Dropbox here')
  assert.equal(homeFor({ where: 'elsewhere', folder: 'Garden' }, CLOUDS), null)
  assert.equal(homeFor({ where: 'this PC' }, CLOUDS), null)
})

test('the split: pictures is the project\'s key, picturesHome this PC\'s; both read and checked', () => {
  assert.equal(PC_KEYS.includes('picturesHome'), true)
  assert.equal(PC_KEYS.includes('pictures'), false)
  const config = parseConfig(JSON.stringify({ pictures: { where: 'Google Drive', folder: 'Worker board' }, picturesHome: ' G:\\My Drive\\Worker board ' }), {})
  assert.deepEqual([config.pictures, config.picturesHome], [{ where: 'Google Drive', folder: 'Worker board' }, 'G:\\My Drive\\Worker board'])
  assert.deepEqual([parseConfig('{}', {}).pictures, parseConfig('{}', {}).picturesHome], [null, ''])
  assert.match(configProblem(JSON.stringify({ pictures: { where: 'Box', folder: 'x' } })), /"pictures" must be/)
  assert.match(configProblem(JSON.stringify({ picturesHome: 3 })), /"picturesHome" must be/)
  assert.equal(configProblem(JSON.stringify({ pictures: { where: 'this PC' } })), null)
  assert.equal(isPictures({ where: 'this PC', folder: 'x' }), false)
})

test('a setting written keeps the file\'s indent, line ends and other keys', () => {
  assert.equal(withSetting('{\r\n    "name": "Garden"\r\n}\r\n', 'picturesHome', 'G:\\x'), '{\r\n    "name": "Garden",\r\n    "picturesHome": "G:\\\\x"\r\n}\r\n')
  assert.equal(withSetting('{}', 'pictures', { where: 'this PC' }), '{\n  "pictures": {\n    "where": "this PC"\n  }\n}\n')
  assert.equal(withSetting(null, 'pictures', { where: 'this PC' }), null, 'no file: never made')
  assert.equal(withSetting('[1]', 'a', 1), null)
  assert.equal(withSetting('{ broken', 'a', 1), null)
})

