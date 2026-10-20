// B360: the recaps on the page. The state carries them (and where they show, the setting botherMe); Needs your
// attention draws each as an Information card with its picture, Overturn and OK, seen (B390), or, with "once a day", the
// daily note on the Focus page gathers them. Made-up samples only.

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
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
  assert.equal(page.recapStatus(OPEN, NOW + HOUR), 'Approves itself in 23 h, unless you overturn it or mark it seen.')
  assert.equal(page.recapStatus(OPEN, NOW + 24 * HOUR - 10 * MIN), 'Approves itself in 10 min, unless you overturn it or mark it seen.')
  assert.equal(page.recapStatus(OPEN, NOW + 25 * HOUR), 'Approves itself now, unless you overturn it or mark it seen.')
  assert.equal(page.recapStatus(CLOSED, NOW), 'Approved by itself: its 24 hours passed.')
  // B390: OK, seen.
  assert.equal(page.recapStatus({ ...CLOSED, state: 'seen' }, NOW), 'Seen by you: approved.')
  assert.equal(page.recapStatus({ ...CLOSED, state: 'overturned', words: 'Too dim.' }, NOW), 'Overturned: "Too dim". Your partner makes the fix.')
  assert.equal(page.recapStatus({ ...CLOSED, state: 'overturned', words: 'Dark north.', isGoal: true }, NOW), 'Overturned: "Dark north". The goal is open again; your partner makes its next steps.')
  // A recap answered with Feedback before B390 still says so.
  assert.equal(page.recapStatus({ ...CLOSED, state: 'feedback', words: 'Lovely.' }, NOW), 'Your feedback went to your partner: "Lovely".')
})

test('B390: Overturn sends the person\'s words and needs them; OK, seen sends none; Feedback is gone', () => {
  assert.deepEqual(plain(page.recapSend(OPEN, 'overturn', 'The pond lamp is white.')), { ok: true, body: { action: 'overturn', id: 'N4', text: 'The pond lamp is white.' } })
  assert.deepEqual(plain(page.recapSend(OPEN, 'overturn', '')), { ok: false, why: 'Say what is wrong: your partner makes the fix from your words.' })
  assert.deepEqual(plain(page.recapSend(OPEN, 'seen', '')), { ok: true, body: { action: 'seen', id: 'N4' } })
  assert.deepEqual(plain(page.recapSend(OPEN, 'seen', 'words typed before')), { ok: true, body: { action: 'seen', id: 'N4' } })
  assert.equal(page.recapSend(OPEN, 'feedback', 'Nice.').ok, false)
  assert.equal(page.recapSend(OPEN, 'approve', 'x').ok, false)
})

/** A stand-in for the page's elements: enough of a node for drawRecap to build its card. */
function node(tag, className = '', text = null) {
  return {
    tag, className, textContent: text, dataset: {}, children: [], attributes: {},
    append(...more) { this.children.push(...more) },
    setAttribute(name, value) { this.attributes[name] = value },
  }
}
const nodesOf = card => [card, ...card.children.flatMap(nodesOf)]
const card = vm.createContext({ HOUR, MIN, drafts: new Map(), sending: new Set(), problems: new Map(), openForms: new Set(), el: node, since: () => node('time'), picture: () => node('figure') })
vm.runInContext(`${script.slice(script.indexOf('// recaps:start'), script.indexOf('// recaps:end'))}
${script.slice(script.indexOf('// recapCard:start'), script.indexOf('// recapCard:end'))}
this.drawRecap = drawRecap`, card)
/** What a recap card offers: its box (the placeholder) and its buttons, each with what its click does. */
function offers(recap) {
  const nodes = nodesOf(card.drawRecap(recap, { readAt: NOW + HOUR, maxMessageChars: 4000 }))
  const box = nodes.find(one => one.tag === 'textarea') ?? null
  const buttons = nodes.filter(one => one.tag === 'button').map(one => [one.textContent, one.className, { ...one.dataset }])
  return plain({ box: box === null ? null : box.placeholder, buttons })
}

test('B390: at rest a recap card has two buttons and no box: Overturn (red) opens the box, OK, seen (blue) sends', () => {
  card.openForms.clear()
  assert.deepEqual(offers(OPEN), {
    box: null,
    buttons: [['↺  Overturn', 'button is-reject', { open: 'recap:N4' }], ['✓  OK, seen', 'button is-seen', { send: 'seen' }]],
  })
})

test('B390: after Overturn the box opens for the words, with Overturn with these words and Cancel', () => {
  card.openForms.clear()
  card.openForms.add('recap:N4')
  assert.deepEqual(offers(OPEN), {
    box: 'What is wrong: your partner makes a fix step from your words…',
    buttons: [['↺  Overturn with these words', 'button is-reject', { send: 'overturn' }], ['Cancel', 'button is-quiet', { cancel: 'recap:N4' }]],
  })
  // A goal's recap: its words open the goal again.
  assert.equal(offers({ ...OPEN, about: 'G3', isGoal: true }).box, 'What is missing: the goal opens again, and your partner makes its next steps from your words…')
  // A closed recap has no buttons, open or not.
  assert.deepEqual(offers({ ...CLOSED, id: 'recap:N4' }), { box: null, buttons: [] })
  card.openForms.clear()
})

test('the wiring: the cards after the questions, the clicks through the answer forms, the daily note\'s card, the look', () => {
  assert.match(script, /const recaps = shownRecaps\(state, showsClosed\(\)\)\.map\(recap => drawRecap\(recap, state\)\)/)
  assert.match(script, /\.\.\.cards, \.\.\.recaps\]\)/)
  assert.match(script, /if \(id\.startsWith\('recap:'\)\) \{\s+const sent = recapSend\(need, verdict, text\)\s+return sent\.ok \? sendWork\(sent\.body, id\) : fail\(id, sent\.why\)/)
  // B390: Overturn opens the box through the answer forms' [data-open]; Cancel closes it and drops the words.
  assert.match(script, /if \(event\.target\.closest\('\[data-cancel\]'\) !== null\) \{\s+openForms\.delete\(id\)\s+drafts\.delete\(id\)\s+problems\.delete\(id\)\s+redrawNeeds\(\)\s+redrawFocus\(\)\s+return\s+\}/)
  // B390: on the Focus page too, the box opens and closes at once.
  // B408: through the Focus page's view, which holds what is sent, refused and open on its cards.
  assert.match(script, /const focusPageUi = \(\) => \(\{[^\n]*problems: \[\.\.\.problems\], sending: \[\.\.\.sending\], openForms: \[\.\.\.openForms\]/)
  assert.match(css, /\.button\.is-seen \{ background: var\(--free\); \}/)
  assert.match(script, /takeAnswers\(\$\('advisor-focus'\)\)/)
  // B361: the recaps and the asks that can wait, gathered under the note.
  assert.match(script, /const gatheredCards = state => \[gatheredRecaps\(state\)\.length > 0 \? focusRecapCard\(state\) : null, gatheredAsks\(state\)\.length > 0 \? focusAsksCard\(state\) : null\]/)
  assert.match(script, /const gathered = gatheredCards\(state\)\s+right\.append\(\.\.\.gathered\)\s+recapsDrawn = gathered\.length > 0/)
  // The review: drawn under the page too while the focus is being changed (no run drawn).
  assert.match(script, /if \(!recapsDrawn\) parts\.push\(\.\.\.gatheredCards\(state\)\)/)
  // The review: a recap's problem, its sending and its box's caret show on the Focus page at once.
  assert.match(script, /function fail\(id, why\) \{\s+problems\.set\(id, why\)\s+redrawNeeds\(\)\s+\/\/[^\n]*\n\s+redrawFocus\(\)/)
  assert.match(script, /const recapTyping = focusedNeed\(box\)\s+fill\(box, parts\)\s+refocus\(box, recapTyping\)/)
  assert.match(script, /el\('span', 'tag', 'Information'\)/)
  assert.match(css, /\.need\.is-recap \{ border-left-color: var\(--working\); \}/)
})

test('the partner\'s job says what an Overturn on a recap asks of it, and that OK, seen asks nothing (B390)', () => {
  const job = readFileSync(new URL('../roles/partner.md', import.meta.url), 'utf8')
  const part = job.slice(job.indexOf('## Recaps'), job.indexOf('## Refine a step'))
  assert.match(part, /`Overturn: <words>` about a step: [^\n]*`work new`/)
  assert.match(part, /`Overturn: <words>` about a goal: the board opened the goal again/)
  assert.match(part, /\*\*OK, seen\*\*[^.]*approves the recap at once[^.]*nothing into your chat/)
  assert.doesNotMatch(part, /Feedback/)
})
