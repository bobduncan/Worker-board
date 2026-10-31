// B484: a refused ask names who answered the question (the partner or the person), and a "left out" entry of a block
// that was cut at 100 characters ends without a space before its closing quote. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { writeStore } from '../src/work/store.mjs'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const NOW = Date.UTC(2026, 9, 24, 12, 0)
const MIN = 60_000
const BACKLOG = ['# Backlog', '', '## Art', '- [ ] B13 Draw the knight (for Units; about 1 h)', ''].join('\n')
const two = n => String(n).padStart(2, '0')
const stampOf = at => {
  const date = new Date(at)
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
const roles = { Main: 'main', Units: 'worker', Advisor: 'advisor' }

async function project(t) {
  await mkdir(DATA, { recursive: true })
  const dir = await mkdtemp(join(DATA, 'test-answered-who-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const call = (body, now = NOW) => workApi(body, { dir, now, prefix: 'Game - ', roleOf: name => roles[name] ?? null })
  return { dir, call }
}

const SHEET = { n: 1, kind: 'decide', options: [], advice: '', pictures: [], play: '', ref: null }

for (const [by, said] of [['partner', 'the partner answered it'], [null, 'the person answered it']]) {
  test(`a repeated ask within 2 minutes names who answered: ${by ?? 'the person'}`, async t => {
    const { dir, call } = await project(t)
    const taken = await call({ action: 'take', minutes: 30, chat: 'Units', id: 'B13', branch: 'b13-knight' })
    assert.equal(taken.ok, true, taken.why)
    const first = await call({ action: 'ask', chat: 'Units', of: 'B13', kind: 'decide', title: 'Sheet A or sheet B?', text: 'Which sheet do we keep for the knight?' })
    assert.equal(first.ok, true, first.why)
    const id = /Q\d+/.exec(JSON.stringify(first))[0]
    const file = join(dir, `${id}.md`)
    const text = await readFile(file, 'utf8')
    await writeFile(file, `${text.replace(/State: open/, `State: answered${by === null ? '' : `\nAnswered by: ${by}`}`).replace(/## History\r?\n/, `## History\n- ${stampOf(NOW)} Advisor: answered Sheet A\n`)}\n## Answer\nSheet A\n`)
    const again = await call({ action: 'ask', chat: 'Units', of: 'B13', kind: 'decide', title: 'Sheet A or sheet B?', text: 'Which sheet do we keep for the knight?' }, NOW + MIN)
    assert.equal(again.ok, false)
    assert.match(JSON.stringify(again), new RegExp(said))
  })
}

test('a left-out entry cut at 100 characters ends without a space before the closing quote', async t => {
  const { call } = await project(t)
  const words = 'Do we keep the long sheet of the knight with the red cape and the golden belt or the short one'
  const title = `${words} flat or tall so that the player sees first in the shop window?`
  const one = { ...SHEET, text: [title] }
  const filed = await call({ action: 'turn-ended', chat: 'Units', since: NOW, forYou: [one] }, NOW + MIN)
  assert.equal(filed.ok, true, filed.why)
  const reworded = { ...SHEET, n: 2, text: [title.replace('the shop window?', 'a store window of the town, please?')] }
  const left = await call({ action: 'turn-ended', chat: 'Units', since: NOW + 2 * MIN, forYou: [reworded] }, NOW + 3 * MIN)
  assert.equal(left.ok, true, left.why)
  assert.equal(title.slice(0, 100).endsWith(' '), true)
  assert.equal(left.result.left?.length, 1)
  assert.match(left.result.left[0], /^"[^"]*\S" /)
})
