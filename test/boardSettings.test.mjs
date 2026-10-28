// B361: the board's settings "Bother me" and "Approve rebuilds by itself", changed from its ⚙ panel in its own settings
// file. Made-up samples only.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import test from 'node:test'
import vm from 'node:vm'

import { createBoard } from '../server.mjs'
import { checkSetting, panelSettings, settingChanged } from '../src/boardSettings.mjs'
import { parseConfig } from '../src/config.mjs'
import { openPage, reply, TOKEN } from './pageHarness.mjs'
import { asSent, build, ask, NOW, MIN } from './partnerState.mjs'

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
  assert.deepEqual(panelSettings(parseConfig('{}', {})), { botherMe: 'now', approveRebuilds: false, maxWorkers: 5, canSet: true, whyNot: null })
  assert.deepEqual(panelSettings(parseConfig('{"botherMe":"daily","approveRebuilds":true,"maxWorkers":7}', {}), { canSet: false, whyNot: 'This board only shows.' }), { botherMe: 'daily', approveRebuilds: true, maxWorkers: 7, canSet: false, whyNot: 'This board only shows.' })
})

test('B-max: "Workers at most" is the config\'s number, else 5, whatever the config object holds', () => {
  assert.equal(panelSettings({}).maxWorkers, 5)
  assert.equal(panelSettings(parseConfig('{}', {})).maxWorkers, 5)
  assert.equal(panelSettings(parseConfig('{"maxWorkers":7}', {})).maxWorkers, 7)
  assert.equal(panelSettings({ maxWorkers: 2.5 }).maxWorkers, 5)
  assert.equal(panelSettings({ maxWorkers: '7' }).maxWorkers, 5)
})

test('B-max (the person, 2026-10-28: "make the worker limit configurable in the settings default is 5."): maxWorkers takes a whole number from 1 to 10', () => {
  for (const value of [1, 5, 10]) assert.deepEqual(checkSetting({ key: 'maxWorkers', value }), { ok: true, key: 'maxWorkers', value })
  for (const value of [0, 11, -1, 2.5, '5', null, undefined, true, NaN, [5]]) {
    const refusal = checkSetting({ key: 'maxWorkers', value })
    assert.equal(refusal.ok, false, String(value))
    assert.equal(refusal.status, 400)
    assert.match(refusal.why, /^maxWorkers takes a whole number from 1 to 10\.$/)
  }
  // The refusal for an unknown key names the keys the panel has, this one too.
  assert.match(checkSetting({ key: 'project', value: 1 }).why, /"maxWorkers"/)
})

test('B-max: maxWorkers is written as a number; every other setting, the indent and the line ends stay', () => {
  const changed = settingChanged(FILE, 'maxWorkers', 7)
  assert.equal(changed.ok, true)
  assert.equal(changed.text, FILE.replace('    "botherMe": "now"\r\n', '    "botherMe": "now",\r\n    "maxWorkers": 7\r\n'))
  assert.deepEqual(JSON.parse(changed.text), { name: 'Garden', project: 'D:\\Work\\garden', botherMe: 'now', maxWorkers: 7 })
  // A setting already there changes in place; a value that is no worker count leaves the file alone.
  const again = settingChanged(changed.text, 'maxWorkers', 10)
  assert.equal(again.text, changed.text.replace('"maxWorkers": 7', '"maxWorkers": 10'))
  assert.equal(parseConfig(again.text, {}).maxWorkers, 10)
  assert.equal(settingChanged(FILE, 'maxWorkers', 11).ok, false)
  assert.equal(settingChanged(FILE, 'maxWorkers', '7').status, 400)
  assert.equal(settingChanged('{\n  "name": "Garden"\n}\n', 'maxWorkers', 3).text, '{\n  "name": "Garden",\n  "maxWorkers": 3\n}\n')
})

/** The board's state with the settings panel's answer by hand (the server adds `boardSettings`, the state builder does not). */
const panelState = (maxWorkers, more = {}) => ({ ...asSent(build([ask('Q2', 'person', NOW - 40 * MIN)])), boardSettings: { botherMe: 'now', approveRebuilds: false, maxWorkers, canSet: true, whyNot: null, ...more } })
const LESS = '[data-setting="maxWorkers"][data-step="-1"]'
const MORE = '[data-setting="maxWorkers"][data-step="1"]'

test('B-max: the panel draws "Workers at most" with its number, "−" off at 1 and "+" off at 10', async () => {
  for (const [workers, lessOff, moreOff] of [[1, true, false], [5, false, false], [10, false, true], [12, false, true]]) {
    const page = await openPage({ state: panelState(workers) })
    try {
      assert.equal(page.find('#max-workers').hidden, false)
      assert.equal(page.text('#max-workers-value'), String(workers))
      assert.deepEqual([page.find(LESS).disabled, page.find(MORE).disabled], [lessOff, moreOff], `at ${workers}`)
      assert.match(page.text('#max-workers'), /Workers at most[^]*The board starts a new worker when tasks wait and none is free, up to this\. Workers already running stay\./)
    } finally { await page.close() }
  }
})

test('B-max: a click on "+" sends the next number, "−" the one below it, and the number follows the board\'s answer', async () => {
  let current = 5
  const page = await openPage({ state: () => panelState(current), answers: request => { current = request.body.value; return reply(panelState(current).boardSettings) } })
  try {
    await page.click(MORE)
    assert.deepEqual(page.sent('/api/settings').map(one => one.body), [{ key: 'maxWorkers', value: 6 }])
    assert.equal(page.text('#max-workers-value'), '6')
    await page.click(LESS)
    await page.click(LESS)
    assert.deepEqual(page.sent('/api/settings').map(one => one.body.value), [6, 5, 4])
    assert.equal(page.text('#max-workers-value'), '4')
    assert.equal(page.sent('/api/settings')[0].headers['X-Board-Token'], TOKEN)
  } finally { await page.close() }
})

test('B-max: a refused change leaves the number as it was and says why; a board that may not change settings sends nothing', async () => {
  const refused = await openPage({ state: panelState(5), answers: () => reply('maxWorkers takes a whole number from 1 to 10.', 400) })
  try {
    await refused.click(MORE)
    assert.equal(refused.sent('/api/settings').length, 1)
    assert.equal(refused.text('#max-workers-value'), '5')
    assert.match(refused.text('#settings-note'), /^Setting not changed: maxWorkers takes a whole number from 1 to 10\.$/)
  } finally { await refused.close() }
  const shown = await openPage({ state: panelState(5, { canSet: false, whyNot: 'This board only shows.' }) })
  try {
    assert.deepEqual([shown.find(LESS).disabled, shown.find(MORE).disabled], [true, true])
    await shown.click(MORE)
    assert.equal(shown.sent('/api/settings').length, 0)
    assert.equal(shown.find('#max-workers').title, 'This board only shows.')
  } finally { await shown.close() }
})

test('B-max: the other two settings still send their words and flags, and the panel hides "Workers at most" for a board that sends none', async () => {
  const page = await openPage({ state: panelState(5), answers: request => reply({ ...panelState(5).boardSettings, [request.body.key]: request.body.value }) })
  try {
    await page.click('[data-setting="botherMe"][data-value="daily"]')
    await page.click('[data-setting="approveRebuilds"][data-value="true"]')
    assert.deepEqual(page.sent('/api/settings').map(one => one.body), [{ key: 'botherMe', value: 'daily' }, { key: 'approveRebuilds', value: true }])
  } finally { await page.close() }
  const old = await openPage({ state: { ...panelState(5), boardSettings: { botherMe: 'now', approveRebuilds: false, canSet: true, whyNot: null } } })
  try {
    assert.equal(old.find('#max-workers').hidden, true)
    assert.equal(old.find('#bother-me').hidden, false)
  } finally { await old.close() }
})

test('the settings are changed only from the board\'s own page', async t => {
  const TOKEN = 'a'.repeat(64)
  const calls = []
  const server = createBoard({
    token: TOKEN, getState: async () => ({}), say: async () => ({ ok: false, status: 400, why: 'x' }),
    settings: async body => {
      calls.push(body)
      return { ok: true, result: { botherMe: body.value, approveRebuilds: false, canSet: true, whyNot: null } }
    },
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const self = `127.0.0.1:${server.address().port}`
  const ask = headers => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/settings', headers: { Host: self, ...headers } }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode, text }))
    })
    req.on('error', fail)
    req.end('{"key":"botherMe","value":"daily"}')
  })
  const good = { 'X-Board-Token': TOKEN, Origin: `http://${self}`, 'Content-Type': 'application/json' }
  assert.equal((await ask({ ...good, 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  assert.equal((await ask({ ...good, Origin: 'http://evil.example' })).status, 403)
  assert.equal(calls.length, 0)
  const answer = await ask(good)
  assert.deepEqual([answer.status, JSON.parse(answer.text).botherMe], [200, 'daily'])
})

test('once a day, the daily note gathers the asks that hold up no chat; a blocking one stays in Needs your attention', () => {
  const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
  // The panel: Bother me (at once, once a day, and that blocking asks always come at once) and Approve rebuilds.
  assert.match(html, /id="bother-me"[^]*?data-value="now"[^]*?data-value="daily"[^]*?always reach you at once[^]*?id="approve-rebuilds"[^]*?data-value="false"[^]*?data-value="true"/)
  const page = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// recaps:start'), script.indexOf('// recaps:end'))}\nthis.gatheredAsks = gatheredAsks`, page)
  const ask = { id: 'work:Q7', workId: 'Q7', blocking: false, isRefine: false, isForm: false, isClosed: false, answer: null }
  const forYou = [
    ask,
    { ...ask, id: 'work:Q8', workId: 'Q8', blocking: true },
    { ...ask, id: 'work:Q9', workId: 'Q9', isRefine: true },
    { ...ask, id: 'work:Q10', workId: 'Q10', isForm: true },
    { ...ask, id: 'work:Q11', workId: 'Q11', isClosed: true },
    { id: 'ask:3', workId: undefined, blocking: false },
  ]
  assert.deepEqual([...page.gatheredAsks({ forYou, recapsShow: 'now' }).map(one => one.id)], [])
  assert.deepEqual([...page.gatheredAsks({ forYou, recapsShow: 'daily' }).map(one => one.id)], ['work:Q7'])
  // The review: an option chosen on a gathered ask lights up on the Focus page at once, and the note's "Needs you"
  // leaves out an ask whose whole card stands under it.
  assert.match(script, /chosen\.set\(id, choice\.dataset\.choose\)\s+drawn\.needs = null\s+redrawNeeds\(\)\s+redrawFocus\(\)/)
  assert.match(script, /const needs = view\.note\.needs\.filter\(ask => !gathered\.has\(ask\.id\)\)/)
})
