// B360: the recaps on the page. The state carries them (and where they show, the setting botherMe); Needs your
// attention draws each as an Information card with its picture, Overturn and Feedback, or, with "once a day", the daily
// note on the Focus page gathers them. Made-up samples only.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { parseConfig } from '../src/config.mjs'
import { workApi } from '../src/work/api.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 19, 9, 0).getTime()
const PROJECT = 'C:\\garden'
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', ''].join('\n')
const script = readFileSync(new URL('../public/board.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../public/board.css', import.meta.url), 'utf8')

const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN })

/** A store with one recap: G3's re-check passed, filed by the partner. */
async function withRecap() {
  const dir = await mkdtemp(join(tmpdir(), 'recap-page-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - HOUR }), undefined, { now: NOW - HOUR })
  const ctx = {
    dir, now: NOW, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Partner: 'advisor' })[chat] ?? null, freeChats: new Set(), hasGoal: id => id === 'G3',
    goalChecked: async body => ({ ok: true, result: { id: body.id, ticked: true, title: 'A warm garden', attempts: 0 } }),
  }
  const done = await workApi({ chat: 'Partner', action: 'checked', id: 'G3', evidence: 'pictures/g3/evidence.png', points: ['pass: warm light'] }, ctx)
  assert.equal(done.ok, true, done.why)
  const build = async (settings = '{}') => buildState({
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead')], tails: {}, planLineTexts: {}, backlogText: BACKLOG, adviceText: null, folders: null,
    askTexts: [], pictureLists: {}, work: { ok: true, dir, ...(await readStore(dir)) },
  }, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW + HOUR, config: { ...parseConfig(settings, {}), project: PROJECT } })
  return { dir, build }
}

test('the state carries the recaps and where they show; a recap is no line of Information', async () => {
  const { dir, build } = await withRecap()
  try {
    const state = await build()
    assert.equal(state.recapsShow, 'now')
    assert.deepEqual(state.recaps.map(recap => [recap.about, recap.state, recap.evidence, recap.isGoal]), [['G3', 'open', 'pictures/g3/evidence.png', true]])
    assert.deepEqual(state.information.filter(info => info.about === 'G3'), [])
    // "Bother me: once a day" (the settings of B361): the recaps gather in the daily note.
    assert.equal((await build('{"botherMe":"daily"}')).recapsShow, 'daily')
    assert.equal((await build('{"botherMe":"hourly"}')).recapsShow, 'now')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const page = { HOUR, MIN }
/** The page's values come from another realm: compared as plain data. */
const plain = value => JSON.parse(JSON.stringify(value))
vm.runInNewContext(`${script.slice(script.indexOf('// recaps:start'), script.indexOf('// recaps:end'))}
this.quoted = quoted; this.shownRecaps = shownRecaps; this.gatheredRecaps = gatheredRecaps; this.recapStatus = recapStatus; this.recapSend = recapSend`, page)

const OPEN = { id: 'recap:N4', workId: 'N4', about: 'B2', isGoal: false, title: 'B2 Light the lamps is done', line: 'Every path has a lamp.', evidence: 'pictures/b2/evidence.png', state: 'open', at: NOW, approvesAt: NOW + 24 * HOUR, words: '', isClosed: false }
const CLOSED = { ...OPEN, id: 'recap:N5', workId: 'N5', state: 'approved', approvesAt: null, isClosed: true }

test('Needs your attention shows the open recaps, the closed ones with Show closed; once a day, the daily note has them', () => {
  const state = { recaps: [OPEN, CLOSED], recapsShow: 'now' }
  assert.deepEqual(page.shownRecaps(state, false).map(one => one.id), ['recap:N4'])
  assert.deepEqual(page.shownRecaps(state, true).map(one => one.id), ['recap:N4', 'recap:N5'])
  assert.deepEqual(plain(page.gatheredRecaps(state)), [])
  const daily = { ...state, recapsShow: 'daily' }
  assert.deepEqual(plain(page.shownRecaps(daily, true)), [])
  assert.deepEqual(page.gatheredRecaps(daily).map(one => one.id), ['recap:N4'])
})

test('a recap says when it approves itself, or what became of it', () => {
  assert.equal(page.recapStatus(OPEN, NOW + HOUR), 'Approves itself in 23 h, unless you overturn it or give feedback.')
  assert.equal(page.recapStatus(OPEN, NOW + 24 * HOUR - 10 * MIN), 'Approves itself in 10 min, unless you overturn it or give feedback.')
  assert.equal(page.recapStatus(OPEN, NOW + 25 * HOUR), 'Approves itself now, unless you overturn it or give feedback.')
  assert.equal(page.recapStatus(CLOSED, NOW), 'Approved by itself: its 24 hours passed.')
  assert.equal(page.recapStatus({ ...CLOSED, state: 'overturned', words: 'Too dim.' }, NOW), 'Overturned: "Too dim". Your partner makes the fix.')
  assert.equal(page.recapStatus({ ...CLOSED, state: 'overturned', words: 'Dark north.', isGoal: true }, NOW), 'Overturned: "Dark north". The goal is open again; your partner makes its next steps.')
  assert.equal(page.recapStatus({ ...CLOSED, state: 'feedback', words: 'Lovely.' }, NOW), 'Your feedback went to your partner: "Lovely".')
})

test('Overturn and Feedback send the person\'s words to the store, and need them', () => {
  assert.deepEqual(plain(page.recapSend(OPEN, 'overturn', 'The pond lamp is white.')), { ok: true, body: { action: 'overturn', id: 'N4', text: 'The pond lamp is white.' } })
  assert.deepEqual(plain(page.recapSend(OPEN, 'feedback', 'Nice.')), { ok: true, body: { action: 'feedback', id: 'N4', text: 'Nice.' } })
  assert.equal(page.recapSend(OPEN, 'overturn', '').ok, false)
  assert.equal(page.recapSend(OPEN, 'feedback', '').ok, false)
  assert.equal(page.recapSend(OPEN, 'approve', 'x').ok, false)
})

test('the wiring: the cards after the questions, the clicks through the answer forms, the daily note\'s card, the look', () => {
  assert.match(script, /const recaps = shownRecaps\(state, showsClosed\(\)\)\.map\(recap => drawRecap\(recap, state\)\)/)
  assert.match(script, /\.\.\.cards, \.\.\.recaps, drawLegacy\(state\)/)
  assert.match(script, /if \(id\.startsWith\('recap:'\)\) \{\s+const sent = recapSend\(need, verdict, text\)\s+return sent\.ok \? sendWork\(sent\.body, id\) : fail\(id, sent\.why\)/)
  assert.match(script, /takeAnswers\(\$\('advisor-focus'\)\)/)
  assert.match(script, /if \(gatheredRecaps\(state\)\.length > 0\) right\.append\(focusRecapCard\(state\)\)/)
  assert.match(script, /if \(view\.stage !== 'run' && gatheredRecaps\(state\)\.length > 0\) parts\.push\(focusRecapCard\(state\)\)/)
  assert.match(script, /el\('span', 'tag', 'Information'\)/)
  assert.match(css, /\.need\.is-recap \{ border-left-color: var\(--working\); \}/)
})

test('the partner\'s job says what an Overturn and a Feedback on a recap ask of it', () => {
  const job = readFileSync(new URL('../roles/partner.md', import.meta.url), 'utf8')
  const part = job.slice(job.indexOf('## Recaps'), job.indexOf('## Refine a step'))
  assert.match(part, /`Overturn: <words>` about a step: [^\n]*`work new`/)
  assert.match(part, /`Overturn: <words>` about a goal: the board opened the goal again/)
  assert.match(part, /`Feedback: <words>`: their word on that work, no fix asked/)
})
