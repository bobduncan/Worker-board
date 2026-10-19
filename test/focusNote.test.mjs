// Focus 3 (spec 2026-10-18, sections 3 to 6, the run): the partner's daily note on the focus (a work-store note
// `Of: G<n>` with "Decided for you" and "Needs you"), Undo of a decided line (typed once, Review Focus 4), the
// partner's open asks of the focus as "Needs you", and "Is the vibe there?" once every part is done. Made-up names only.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { messageText } from '../src/bridge.mjs'
import { parseConfig } from '../src/config.mjs'
import { FOCUS_MOVES, focusMove } from '../src/focus.mjs'
import { parseGoals } from '../src/goals.mjs'
import { roundText } from '../src/rounds.mjs'
import { focusWords, wakeFor } from '../src/say.mjs'
import { focusState } from '../src/state.mjs'
import { workApi } from '../src/work/api.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
const made = {}
vm.runInNewContext(`${script.slice(script.indexOf('// focus:start'), script.indexOf('// focus:end'))}
Object.assign(this, { focusView })`, made)
const focusView = (...args) => JSON.parse(JSON.stringify(made.focusView(...args)))
const CAN = { canWrite: true, whyNot: null }

// ---- the store: the note, the asks of a goal, Undo ----

const NOW = new Date(2026, 9, 18, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Fights', '- [ ] B1 Show the damage (for Features; about 1 h)', ''].join('\n')
const ROLES = { Main: 'main', Features: 'worker', Partner: 'advisor' }

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'focus-note-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Game - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(), hasGoal: id => id === 'G6' }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, partner: as('Partner'), main: as('Main'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
const item = async (dir, id) => (await readStore(dir)).items.get(id)

test('the partner asks of the focus goal itself: Of the goal; answered on the board, it wakes the partner', async () => {
  const { dir, partner, person } = await fresh()
  try {
    const asked = await partner({ action: 'ask', of: 'G6', kind: 'decide', text: 'Should the run map show the next fight\'s enemies?', options: ['A icons only', 'B icons and count'], advice: 'A', pictures: ['art/run-map/a-or-b.png'] })
    assert.equal(asked.ok, true, asked.why)
    const q1 = await item(dir, 'Q1')
    assert.deepEqual(['Of', 'Owner', 'Asks', 'Pictures'].map(key => valueOf(q1, key)), ['G6', 'Partner', 'decide', 'art/run-map/a-or-b.png'])
    assert.match(asked.result.text, /\(Q1, decide on G6\)/)
    const answered = await person({ action: 'answer', id: 'Q1', text: 'A icons only' })
    assert.equal(answered.ok, true, answered.why)
    assert.equal(answered.result.wake.to, 'Partner')
    // Withdrawn too, with no step to follow.
    await partner({ action: 'ask', of: 'G6', kind: 'look', text: 'Is the map readable?' })
    assert.equal((await partner({ action: 'withdraw', id: 'Q2', why: 'settled' })).ok, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the partner asks under a step of the focus that a worker holds, as the main chat may (spec section 5)', async () => {
  const { dir, partner } = await fresh()
  try {
    const asked = await partner({ action: 'ask', of: 'B1', kind: 'decide', text: 'A number or a bar?' })
    assert.equal(asked.ok, true, asked.why)
    const q1 = await item(dir, 'Q1')
    assert.deepEqual(['Of', 'Owner'].map(key => valueOf(q1, key)), ['B1', 'Partner'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the partner\'s daily note: a note to you Of the goal, with "Decided for you" and "Needs you"; only the partner writes one', async () => {
  const { dir, partner, main } = await fresh()
  try {
    await partner({ action: 'ask', of: 'G6', kind: 'decide', text: 'Icons only?' })
    const wrote = await partner({ action: 'note', to: 'you', of: 'G6', decided: ['Damage numbers in yellow, pushes in white', ' Death puff lasts half a second '], needs: ['Q1'] })
    assert.equal(wrote.ok, true, wrote.why)
    const note = await item(dir, 'N1')
    assert.deepEqual(['Kind', 'From', 'To', 'Of', 'State'].map(key => valueOf(note, key)), ['note', 'Partner', 'you', 'G6', 'unread'])
    assert.equal(valueOf(note, 'Text'), 'Today\'s note on G6: 2 decided for you, 1 needs you')
    assert.deepEqual(note.sections.get('Decided for you'), ['- Damage numbers in yellow, pushes in white', '- Death puff lasts half a second'])
    assert.deepEqual(note.sections.get('Needs you'), ['- Q1'])
    assert.equal((await main({ action: 'note', to: 'you', of: 'G6', decided: ['x'] })).status, 403)
    assert.equal((await partner({ action: 'note', to: 'main', of: 'G6', decided: ['x'] })).status, 400)
    assert.equal((await partner({ action: 'note', to: 'you', of: 'G6', needs: ['Q9'] })).status, 409)
    assert.equal((await partner({ action: 'note', to: 'you', of: 'G6' })).status, 400)
    // A note about a step stays as it was.
    assert.equal((await main({ action: 'note', to: 'you', of: 'B1', text: 'B1 is merged.' })).ok, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Undo marks the decided line "undo asked" once: a second Undo changes nothing (Review Focus 4)', async () => {
  const { dir, partner, person } = await fresh()
  try {
    await partner({ action: 'note', to: 'you', of: 'G6', decided: ['Death puff lasts half a second', 'Kept the old map icons for now'] })
    const first = await person({ action: 'undo', id: 'N1', line: 'Kept the old map icons for now' })
    assert.equal(first.ok, true, first.why)
    assert.deepEqual(first.result.undo, { of: 'G6', from: 'Partner', line: 'Kept the old map icons for now' })
    assert.deepEqual((await item(dir, 'N1')).sections.get('Undo asked'), ['- Kept the old map icons for now (2026-10-18 09:01)'])
    const twice = await Promise.all([person({ action: 'undo', id: 'N1', line: 'Kept the old map icons for now' }), person({ action: 'undo', id: 'N1', line: 'Kept the old map icons for now' })])
    assert.deepEqual(twice.map(one => [one.ok, one.result.changed, one.result.undo]), [[true, false, undefined], [true, false, undefined]])
    assert.equal((await person({ action: 'undo', id: 'N1', line: 'Something it never decided' })).status, 409)
    assert.equal((await partner({ action: 'undo', id: 'N1', line: 'Death puff lasts half a second' })).status, 403)
    await partner({ action: 'note', to: 'main', text: 'Plain words.' })
    assert.equal((await person({ action: 'undo', id: 'N2', line: 'Plain words.' })).status, 409)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---- the state and the page: the newest note, Needs you, the vibe-there question ----

const GOALS = [
  'Last id: G6',
  'Focus: G6',
  '',
  '- [~] G6 The polish you need to judge fun',
  '    Done when: you judge a fight fun in one playthrough',
  '    Vibe: every fight reads at a glance',
  '    Vibe: hits feel heavy',
  '    Vibe agreed: 2026-10-18 10:00',
  '    Part: Show damage before you click · about 1 h · steps B1',
  '    Part: Heavier hits · 2 h · steps B2',
  '    How agreed: 2026-10-18 11:00',
  '- [ ] G7 Lanterns',
  '',
].join('\n')
const parse = text => parseItem(text.replace(/^ +/gm, ''))
const stepItem = (id, state) => parse(`Id: ${id}\nKind: step\nTitle: Step ${id}\nState: ${state}\nSince: 2026-10-18 09:00\n`)
const noteItem = (id, since, { of = 'G6', from = 'Game - Partner', decided = [], needs = [], undone = [] } = {}) => parse([
  `Id: ${id}`, 'Kind: note', `From: ${from}`, 'To: you', `Of: ${of}`, 'State: unread', `Since: ${since}`, 'Text: the note', '',
  '## Decided for you', ...decided.map(one => `- ${one}`), '', '## Needs you', ...needs.map(one => `- ${one}`), '',
  ...(undone.length === 0 ? [] : ['## Undo asked', ...undone.map(one => `- ${one} (2026-10-18 09:30)`), '']),
].join('\n'))
const askItem = (id, of, { owner = 'Game - Partner', state = 'open', options = null, advice = null, pictures = null } = {}) => parse([
  `Id: ${id}`, 'Kind: ask', `Title: Question ${id}?`, `State: ${state}`, `Owner: ${owner}`, 'Since: 2026-10-18 09:00',
  ...(pictures === null ? [] : [`Pictures: ${pictures}`]), 'Asks: decide', `Of: ${of}`, ...(options === null ? [] : [`Options: ${options}`]), ...(advice === null ? [] : [`Advice: ${advice}`]), '',
  '## Text', `Question ${id}?`, '',
].join('\n'))
const stateOf = items => focusState(parseGoals(GOALS), items, [], 'Game - ', 'Partner')

test('the newest note of the focus from the partner, its decided lines with what was undone, and the asks named', () => {
  const items = [
    stepItem('B1', 'done'), stepItem('B2', 'in progress'),
    noteItem('N1', '2026-10-17 09:00', { decided: ['Old line'] }),
    noteItem('N4', '2026-10-18 09:00', { decided: ['Damage numbers in yellow', 'Kept the old map icons for now'], needs: ['Q3'], undone: ['Kept the old map icons for now'] }),
    noteItem('N5', '2026-10-18 10:00', { of: 'G7', decided: ['Elsewhere'] }),
    noteItem('N6', '2026-10-18 11:00', { from: 'Game - Main', decided: ['Not the partner\'s'] }),
  ]
  const state = stateOf(items)
  assert.deepEqual(state.note, { id: 'N4', since: '2026-10-18 09:00', decided: [{ text: 'Damage numbers in yellow', undoAsked: false }, { text: 'Kept the old map icons for now', undoAsked: true }], needs: ['Q3'] })
  assert.equal(stateOf([stepItem('B1', 'done')]).note, null)
})

test('"Needs you" is the partner\'s open asks of the focus or its steps, those the note names first, with their options and pictures', () => {
  const items = [
    stepItem('B1', 'done'), stepItem('B2', 'in progress'),
    noteItem('N4', '2026-10-18 09:00', { needs: ['Q5'] }),
    askItem('Q2', 'G6', { options: 'A icons only | B icons and count', advice: 'A', pictures: 'art/a.png, art/b.png' }),
    askItem('Q3', 'B2'),
    askItem('Q4', 'G6', { state: 'answered' }),
    askItem('Q5', 'B1'),
    askItem('Q6', 'G7'),
    askItem('Q7', 'G6', { owner: 'Game - Features' }),
  ]
  const needs = stateOf(items).needs
  assert.deepEqual(needs.map(one => one.id), ['Q5', 'Q2', 'Q3'])
  assert.deepEqual(needs[1], { id: 'Q2', title: 'Question Q2?', asks: 'decide', options: [{ label: 'A icons only', isAdvised: true }, { label: 'B icons and count', isAdvised: false }], pictures: ['art/a.png', 'art/b.png'] })
})

test('the run\'s note card: each decided line with Undo or "undo asked"; at most three asks, then "and n more"; without a note a line', () => {
  const asks = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map(id => askItem(id, 'G6'))
  const state = stateOf([stepItem('B1', 'done'), stepItem('B2', 'in progress'), ...asks,
    noteItem('N4', '2026-10-18 09:00', { decided: ['Damage numbers in yellow', 'Kept the old map icons for now'], undone: ['Kept the old map icons for now'] })])
  const view = focusView(state, null, CAN)
  assert.equal(view.note.title, 'Today\'s note from your partner')
  assert.deepEqual(view.note.decided, [
    { text: 'Damage numbers in yellow', note: 'N4', undo: { label: 'Undo', isEnabled: true, title: 'Ask your partner to undo this' } },
    { text: 'Kept the old map icons for now', note: 'N4', undo: { label: 'undo asked', isEnabled: false, title: 'You asked your partner to undo this' } },
  ])
  assert.deepEqual(view.note.needs.map(one => one.id), ['Q1', 'Q2', 'Q3'])
  assert.equal(view.note.more, 'and 2 more')
  assert.equal(view.note.empty, null)
  // Read-only: Undo off, with why.
  assert.deepEqual(focusView(state, null).note.decided[0].undo, { label: 'Undo', isEnabled: false, title: 'This board only shows.' })
  const none = focusView(stateOf([stepItem('B1', 'done'), stepItem('B2', 'in progress')]), null, CAN)
  assert.deepEqual([none.note.decided, none.note.needs, none.note.more], [[], [], null])
  assert.equal(none.note.empty, 'No note yet: your partner writes one each morning, with what it decided for you and what needs you.')
  assert.equal(none.vibeThere, null)
})

test('every part done: the question "Is the vibe there?" with the vibe, Yes and No', () => {
  const view = focusView(stateOf([stepItem('B1', 'done'), stepItem('B2', 'done')]), null, CAN)
  assert.deepEqual(view.vibeThere, {
    question: 'Is the vibe there?',
    vibe: ['every fight reads at a glance', 'hits feel heavy'],
    doneWhenLine: 'Done when: you judge a fight fun in one playthrough',
    buttons: [
      { label: 'Yes', act: 'vibe-there-yes', isEnabled: true, title: 'Your partner re-checks it against its Done when and its vibe; it gets its tick once that passed' },
      { label: 'No', act: 'vibe-there-no', isEnabled: true, title: 'Say what is missing: your partner changes the how' },
    ],
    doneWhen: null,
  })
})

test('the page sends Undo, the asks\' answers and the vibe-there moves; the server types Undo to the partner', () => {
  assert.match(script, /command: 'note-undo', id: focus\.id, note: /)
  assert.match(script, /action: 'answer', id: /)
  assert.match(script, /command: 'vibe-there-yes', id: focus\.id/)
  assert.match(script, /command: 'vibe-there-no', id: focus\.id, text: /)
  assert.match(server, /body\?\.command === 'note-undo'/)
  assert.match(server, /focusWords\('undo'/)
  assert.match(server, /allDone: /)
  assert.match(server, /roundText\(next\.round, \{ board: HERE, config, focus: state\.focus/)
})

// ---- the moves: "Is the vibe there?" Yes and No ----

function fakeFs(files) {
  return {
    files,
    readFile: async path => {
      if (!(path in files)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return Buffer.from(files[path], 'latin1')
    },
    writeFile: async (path, bytes, options) => {
      if (options?.flag === 'wx' && path in files) throw Object.assign(new Error('there'), { code: 'EEXIST' })
      files[path] = Buffer.from(bytes).toString('latin1')
    },
    rename: async (from, to) => {
      files[to] = files[from]
      delete files[from]
    },
    rm: async path => { delete files[path] },
    mkdir: async () => {},
    access: async path => { if (!(path in files)) throw new Error('gone') },
    readdir: async dir => Object.keys(files).filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => path.slice(dir.length + 1)),
  }
}
const MAP = 'C:/p/goals.md'
const latin = text => Buffer.from(text, 'utf8').toString('latin1')
const utf8 = text => Buffer.from(text, 'latin1').toString('utf8')
const ctx = (fs, extra = {}) => ({
  canWrite: true, goalsFile: MAP, historyDir: 'C:/p/history', brainstormDir: 'C:/p/talks', brainstormFolder: 'talks', now: NOW, fs,
  partner: { name: 'Partner', isRunning: true }, job: 'C:/board/roles/partner.md', allDone: true, ...extra,
})
const mapOf = fs => parseGoals(utf8(fs.files[MAP]))

test('the moves it knows hold the vibe-there answers (Focus 4: the talk bar after them)', () => {
  assert.deepEqual(FOCUS_MOVES.slice(5, 8), ['vibe-there-yes', 'vibe-there-no', 'talk'])
})

test('Yes asks the partner for the goal\'s re-check, once; B358: the tick comes once the re-check passed', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  const notYet = await focusMove({ command: 'vibe-there-yes', id: 'G6' }, ctx(fs, { allDone: false }))
  assert.deepEqual([notYet.status, notYet.why], [409, 'Not every part is done yet.'])
  const both = await Promise.all([focusMove({ command: 'vibe-there-yes', id: 'G6' }, ctx(fs)), focusMove({ command: 'vibe-there-yes', id: 'G6' }, ctx(fs))])
  assert.ok(both.every(one => one.ok), JSON.stringify(both))
  const words = both.map(one => one.words).filter(one => one !== null)
  assert.equal(words.length, 1)
  assert.equal(words[0].command, 'goal-recheck')
  assert.match(words[0].text, /^goal re-check: G6 The polish you need to judge fun\nDone when: you judge a fight fun in one playthrough\nVibe: every fight reads at a glance · hits feel heavy\nYour job: .+, "The goal re-check"$/)
  const map = mapOf(fs)
  assert.deepEqual([map.focus, map.byId.get('G6').state, map.byId.get('G6').recheckAsked], ['G6', 'now', '2026-10-18 09:00'])
})

test('No with the person\'s words takes "How agreed" away and types vibe there: no with the words', async () => {
  const fs = fakeFs({ [MAP]: latin(GOALS) })
  assert.equal((await focusMove({ command: 'vibe-there-no', id: 'G6', text: ' ' }, ctx(fs))).status, 400)
  const no = await focusMove({ command: 'vibe-there-no', id: 'G6', text: '  hits still   feel light ' }, ctx(fs))
  assert.equal(no.ok, true, no.why)
  assert.equal(no.words.text, 'vibe there: no\nGoal: G6 The polish you need to judge fun\nThread: none\nWords: hits still feel light')
  const node = mapOf(fs).byId.get('G6')
  assert.deepEqual([node.howAgreed, node.vibeAgreed, node.parts.length, mapOf(fs).focus], [null, '2026-10-18 10:00', 2, 'G6'])
  const again = await focusMove({ command: 'vibe-there-no', id: 'G6', text: 'again' }, ctx(fs))
  assert.deepEqual([again.status, again.why], [409, 'The how is open again already.'])
})

// ---- the words, the morning round, the partner's job ----

test('the words to the partner: undo: <line>, vibe there: yes|no; each the person\'s word, waking a partner not running', () => {
  const undo = focusWords('undo', { to: 'Partner', goal: { id: 'G6', title: 'The polish' }, words: ' Kept the old   map icons ', note: 'N4' })
  assert.deepEqual(undo, { to: 'Partner', ask: null, step: null, title: null, version: null, verdict: null, command: 'undo', about: 'G6', text: 'undo: Kept the old map icons\nGoal: G6 The polish\nNote: N4' })
  assert.match(messageText({ ...undo, at: NOW }, () => '09:01'), /^undo: Kept the old map icons\nGoal: G6 The polish\nNote: N4\n\(typed on the worker board, 09:01\)$/)
  const state = { restart: { main: 'Main' }, chats: [{ name: 'Main', isRunning: true }], advisor: { name: 'Partner', isRunning: false, appSession: 'local_abc' } }
  for (const command of ['undo', 'vibe-there-yes', 'vibe-there-no']) assert.equal(wakeFor({ id: 'm', at: NOW, ...undo, command }, state, [], NOW, 4000)?.command, 'start', command)
})

test('the morning round asks the partner for the note of the focus; without a focus, to have the person pick one', () => {
  const config = { ...parseConfig('{}', {}), project: 'C:\\game' }
  const focus = { id: 'G6', title: 'The polish', stage: 'run' }
  const morning = roundText('morning', { board: 'C:\\board', config, focus })
  assert.match(morning, /\nYour focus: G6 The polish \(the run\)\. Write today's note on it: work note, to you, of G6, with decided and needs \(your job, "The daily note"\)\.\n/)
  assert.match(roundText('morning', { board: 'C:\\board', config, focus: null }), /\nNo focus: have the user pick one on the board's Focus page \(your job, "The daily note"\)\.\n/)
  assert.match(roundText('morning', { board: 'C:\\board', config, focus: { ...focus, stage: 'done' } }), /\nNo focus: /)
  assert.doesNotMatch(roundText('weekly', { board: 'C:\\board', config, focus }), /Your focus:|No focus:/)
  assert.match(morning, /not the user's word\.$/)
})

test('the partner\'s job: the daily note, what it decides without the user, Undo and the vibe-there words', async () => {
  const partner = (await readFile(join(ROOT, 'roles', 'partner.md'), 'utf8')).replace(/\s+/g, ' ')
  const protocol = (await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')).replace(/\s+/g, ' ')
  assert.match(partner, /## The daily note/)
  assert.match(partner, /`work note` with `to` you, `of` G<n>, `decided`/)
  assert.match(partner, /`work ask` with `of` G<n>/)
  for (const words of ['small visual details', 'numbers', 'wording', 'the order of the parts', 'a rule of the game', 'a new screen', 'more than about an hour']) assert.ok(partner.includes(words), words)
  assert.match(partner, /`undo: <line>`/)
  assert.match(partner, /`vibe there: yes`/)
  assert.match(partner, /`vibe there: no` with `Words: \.\.\.`/)
  for (const words of ['`undo: <line>`', '`vibe there: yes`', '`vibe there: no`', '`## Decided for you`', '`## Needs you`', '`## Undo asked`']) assert.ok(protocol.includes(words), words)
})
