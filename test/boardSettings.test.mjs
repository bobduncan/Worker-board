// B361: the board's settings "Bother me" and "Approve rebuilds by itself", changed from its ⚙ panel in its own settings
// file. Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { checkSetting, panelSettings, settingChanged } from '../src/boardSettings.mjs'
import { parseConfig } from '../src/config.mjs'

const FILE = ['{', '    "name": "Garden",', '    "project": "D:\\\\Work\\\\garden",', '    "botherMe": "now"', '}', ''].join('\r\n')

test('a setting changes in the file, every other setting, the indent and the line ends kept', () => {
  const changed = settingChanged(FILE, 'botherMe', 'daily')
  assert.equal(changed.ok, true)
  assert.equal(changed.text, FILE.replace('"now"', '"daily"'))
  const rebuilds = settingChanged(changed.text, 'approveRebuilds', true)
  assert.equal(rebuilds.ok, true)
  const read = parseConfig(rebuilds.text, {})
  assert.equal(read.botherMe, 'daily')
  assert.equal(read.approveRebuilds, true)
  assert.equal(read.name, 'Garden')
  assert.match(rebuilds.text, /\r\n {4}"approveRebuilds": true\r\n\}\r\n$/)
  // A file of plain line ends and two spaces, with a byte-order mark, keeps its form.
  const plain = settingChanged('\uFEFF{\n  "name": "Garden"\n}\n', 'approveRebuilds', false)
  assert.equal(plain.text, '{\n  "name": "Garden",\n  "approveRebuilds": false\n}\n')
})

test('only the two settings, each with its own values; a broken file is left alone', () => {
  assert.equal(checkSetting({ key: 'botherMe', value: 'hourly' }).ok, false)
  assert.equal(checkSetting({ key: 'approveRebuilds', value: 'true' }).ok, false)
  assert.equal(checkSetting({ key: 'project', value: 'D:\\Work' }).status, 400)
  assert.equal(checkSetting({ key: 'toString', value: 'now' }).ok, false)
  assert.deepEqual(checkSetting({ key: 'approveRebuilds', value: true }), { ok: true, key: 'approveRebuilds', value: true })
  assert.equal(settingChanged('{ "name": ', 'botherMe', 'daily').status, 409)
  assert.equal(settingChanged('[1, 2]', 'botherMe', 'daily').status, 409)
})

test('the panel shows the settings as the board reads them, and whether this board may change them', () => {
  assert.deepEqual(panelSettings(parseConfig('{}', {})), { botherMe: 'now', approveRebuilds: false, canSet: true, whyNot: null })
  assert.deepEqual(panelSettings(parseConfig('{"botherMe":"daily","approveRebuilds":true}', {}), { canSet: false, whyNot: 'This board only shows.' }), { botherMe: 'daily', approveRebuilds: true, canSet: false, whyNot: 'This board only shows.' })
})
