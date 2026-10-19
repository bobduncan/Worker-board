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
