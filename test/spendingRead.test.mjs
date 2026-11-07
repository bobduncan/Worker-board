// tools/spending-read.mjs through its CLI, on a small fixture ledger in a temp folder (B1049).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { routingSummary } from '../src/work/routing/metrics.mjs'

const tool = fileURLToPath(new URL('../tools/spending-read.mjs', import.meta.url))
const now = Date.now(), dayMs = 86400000
const at = ago => now - ago * dayMs
const ev = (id, chat, ago, model, phase, input, output) => ({ messageId: id, chat, sourceAt: at(ago), actualModel: model, phase, taskId: null, input, cacheWrite: 1000, cacheRead: 5000, output })
const events = [
  ev('a', 'Alpha', 0.1, 'claude-sonnet-5-5', 'implement', 1000, 500),
  ev('b', 'Alpha', 1.1, 'claude-opus-5-5', 'coordinate', 2000, 800),
  ev('c', 'Beta', 1.2, 'claude-sonnet-5-5', 'implement', 3000, 100),
  ev('d', 'Beta', 20, 'claude-sonnet-5-5', 'implement', 4000, 100),
]
const dir = mkdtempSync(join(tmpdir(), 'spend-read-'))
const file = join(dir, 'spending.json')
writeFileSync(file, JSON.stringify({ version: 1, events }))
test.after(() => { unlinkSync(file); rmdirSync(dir) })
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' })
const expected = routingSummary({ events, outcomes: [], now, days: 7 })
const usd = n => `\\$${n.toFixed(2)}`

test('by chat: groups and total match routingSummary', () => {
  const r = run(file, '--json')
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(out.groups.map(g => [g.key, g.messages, g.low, g.high]), expected.chats.map(g => [g.key, g.messages, g.low, g.high]))
  assert.equal(out.messages, 3)
  assert.deepEqual(out.knownCost, expected.knownCost)
  const text = run(file).stdout
  assert.match(text, new RegExp(`TOTAL  messages 3  cost ${usd(expected.knownCost.low)}-${usd(expected.knownCost.high)}`))
  assert.match(text, /^Alpha {2}messages 2 {2}cost \$\d+\.\d\d-\$\d+\.\d\d/m)
  assert.match(text, /^Beta {2}messages 1/m)
})

test('by day, model and phase group by their key', () => {
  const days = JSON.parse(run(file, '--by', 'day', '--json').stdout).groups
  assert.deepEqual(days.map(g => g.key), expected.daily.map(g => g.key))
  assert.equal(days.reduce((n, g) => n + g.messages, 0), 3)
  const models = JSON.parse(run(file, '--by', 'model', '--json').stdout).groups
  assert.deepEqual(models.map(g => g.key).sort(), ['claude-opus-5-5', 'claude-sonnet-5-5'])
  const phases = JSON.parse(run(file, '--by', 'phase', '--json').stdout).groups
  assert.deepEqual(phases.map(g => g.key).sort(), ['coordinate', 'implement'])
})

test('--days widens the period; --day picks one day', () => {
  assert.equal(JSON.parse(run(file, '--days', '30', '--json').stdout).messages, 4)
  const day = new Date(at(20)).toISOString().slice(0, 10)
  const one = JSON.parse(run(file, '--day', day, '--json').stdout)
  assert.equal(one.messages, 1)
  assert.deepEqual(one.groups.map(g => g.key), ['Beta'])
})

test('a missing file gives one clear line and exit 1', () => {
  const r = run(join(dir, 'nope.json'))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /^Cannot read the spending ledger .*nope\.json: ENOENT\r?\n$/)
  assert.equal(r.stdout, '')
})

test('the file is not held after the run', () => {
  assert.equal(run(file).status, 0)
  renameSync(file, file + '.moved')
  renameSync(file + '.moved', file)
})
