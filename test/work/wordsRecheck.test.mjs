// Rule 15 (the person, 2026-11-09, chat 2: "when we redesign/discuss things, the signals on the board aint updated with the new
// information"): the stairs were settled in chat 2, yet Q711 (Worker 5, of B1091) and Q712 (the Advisor, of G60) stood open with options
// against the decision, and chat 2 is a side chat that the work tool refuses. The person's words from any chat hold the asks they may
// change, until the asking chat re-asks, withdraws or says it still stands; a chat that does nothing for 60 minutes of the board's
// running time loses the hold. Made-up items in a temporary folder; the words are the live ones.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { parseGoals } from '../../src/goals.mjs'
import { keepGoalWords } from '../../src/goalsWrite.mjs'
import { workApi } from '../../src/work/api.mjs'
import { HOLD_MINUTES, heldAsksDue, isHeld } from '../../src/work/askHold.mjs'
import { standsForPerson } from '../../src/work/autopilot.mjs'
import { storeNeeds, storeWaits } from '../../src/work/lists.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { isRoutedToPartner } from '../../src/work/partnerAnswers.mjs'
import { itemOfStep } from '../../src/work/read.mjs'
import { readStore, share } from '../../src/work/store.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 16, 20).getTime()
const SIDE = '2. Worker board goal management'
const DECISION = 'Every map is painted whole by Codex; no more stair rounds.'
const GOALS = ['- [~] G60 Stairs and maps', '- [ ] G61 Other goal', ''].join('\n')

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
const step = (id, state, extra = {}) => text({ Id: id, Kind: 'step', Title: `Title of ${id}`, State: state, Activity: 'Garden', Goal: 'G60', Since: stamp(NOW - 200 * MIN), ...extra }, { History: [`- ${stamp(NOW - 200 * MIN)} Main: made`] })
const ask = (id, fields, minutes) => text(
  { Id: id, Kind: 'ask', Title: `Which stairs for ${id}?`, State: 'open', Since: stamp(NOW - minutes * MIN), Filed: String(NOW - minutes * MIN), Blocking: 'no', Asks: 'decide', ...fields },
  { Text: [`Which stairs for ${id}?`], History: [`- ${stamp(NOW - minutes * MIN)} ${fields.Owner}: asked (decide)`] })

const ROLES = { Main: 'main', 'Worker 5': 'worker', 'Worker 6': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null

async function board(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'words-recheck-'))
  const files = {
    B1091: step('B1091', 'in progress', { Owner: 'Worker 5' }), B1092: step('B1092', 'refined'), B1093: step('B1093', 'queued'), B7: step('B7', 'refined', { Goal: 'G61' }),
    Q711: ask('Q711', { Owner: 'Worker 5', Of: 'B1091', Route: 'partner' }, 71),
    Q712: ask('Q712', { Owner: 'Advisor', Of: 'G60', Route: 'person', Blocking: 'yes' }, 19),
    Q713: ask('Q713', { Owner: 'Worker 5', Of: 'B7', Route: 'person' }, 30),
    // Filed after the person's words: the chat knew them.
    Q714: ask('Q714', { Owner: 'Worker 5', Of: 'B1091', Route: 'person' }, -10),
    ...extra,
  }
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  const goalsFile = join(dir, 'goals.md')
  await writeFile(goalsFile, GOALS)
  return { dir, goalsFile }
}
const ctx = (b, now, as, more = {}) => ({
  dir: b.dir, now, prefix: '', roleOf, chats: Object.keys(ROLES), pictureProblem: async () => null, hasGoal: id => /^G6[01]$/.test(id),
  goalWords: body => keepGoalWords(body, { canWrite: true, file: b.goalsFile, historyDir: join(b.dir, 'goals-history'), now }),
  ...(as === undefined ? {} : { as }), ...more,
})
const chat = (b, who, body, now = NOW, more = {}) => workApi({ ...body, chat: who }, ctx(b, now, undefined, more))
const server = (b, body, now) => workApi(body, ctx(b, now, 'server'))
const items = async b => (await readStore(b.dir)).items
const field = (all, id, key) => all.get(id)?.head.get(key) ?? null
const section = (all, id, name) => all.get(id)?.sections.get(name) ?? []
const wordsOn = (id, more = {}) => ({ action: 'words', id, text: [DECISION], where: 'chat 2', ...more })
const open = async t => {
  const b = await board()
  t.after(() => rm(b.dir, { recursive: true, force: true }))
  return b
}

test('the person\'s words on G60 from a side chat: Q711 and Q712 are held, the others stay, each asking chat is told, the partner gets one note', async t => {
  const b = await open(t)
  const said = await chat(b, SIDE, wordsOn('G60'))
  assert.equal(said.ok, true, said.why)
  assert.deepEqual(said.result.held, ['Q711', 'Q712'])
  const all = await items(b)
  assert.deepEqual(['Q711', 'Q712', 'Q713', 'Q714'].map(id => field(all, id, 'Route')), ['asker', 'asker', 'person', 'person'])
  assert.deepEqual(section(all, 'Q711', 'Route'), ['held from partner: your words at 16:20 may change this (chat 2)'])
  assert.deepEqual(section(all, 'Q712', 'Route'), ['held from person: your words at 16:20 may change this (chat 2)'])
  assert.match(section(all, 'Q711', 'History').at(-1), /held: the person's words at 16:20 on G60 may change this$/)
  assert.equal(section(all, 'Q713', 'History').length, 1)
  // A word to each asking chat, through the normal `wakes` of the result.
  assert.deepEqual(said.result.wakes.map(one => [one.to, one.id, one.kind]), [['Worker 5', 'Q711', 'words'], ['Advisor', 'Q712', 'words']])
  assert.equal(said.result.wakes[0].line, 'the person\'s words at 16:20 on G60: re-ask or withdraw Q711, or say it still stands')
  // One note to the partner: the unstarted steps of the goal, not the one in progress, not another goal's.
  const note = all.get(said.result.note)
  // To the main chat, for the partner: only a note To main (or the person) is read by anyone (lists.mjs notesToMain); Main relays it.
  assert.equal(field(all, said.result.note, 'To'), 'main')
  assert.match((all.get(said.result.note).sections.get('Text') ?? []).join(' '), /^For the partner \(Advisor\): the person's words at 16:20 on G60 \(chat 2\)/)
  assert.equal(field(all, said.result.note, 'From'), 'server')
  const words = note.sections.get('Text').join(' ')
  assert.match(words, /^For the partner \(Advisor\): the person's words at 16:20 on G60 \(chat 2\): "Every map is painted whole by Codex; no more stair rounds\."/)
  assert.match(words, /B1092 \(Title of B1092\), B1093 \(Title of B1093\)/)
  assert.doesNotMatch(words, /B1091|B7\b/)
  // The goal map keeps the words where the goal page reads them.
  const mine = parseGoals(readFileSync(b.goalsFile, 'utf8')).byId.get('G60').yourWords
  assert.deepEqual(mine, [{ at: '2026-11-09 16:20', text: `${DECISION} (in chat 2)` }])
})

test('a side chat may only say the person\'s words: every other action stays "is no chat of the list"; and it says where', async t => {
  const b = await open(t)
  for (const body of [{ action: 'ask', of: 'B1091', kind: 'decide', text: ['Which stairs?'] }, { action: 'take', id: 'B1092' }, { action: 'note', to: 'main', text: 'hi' }, { action: 'withdraw', id: 'Q711' }]) {
    const refused = await chat(b, SIDE, body)
    assert.equal(refused.ok, false, body.action)
    assert.equal(refused.status, 403, body.action)
    assert.match(refused.why, /is no chat of the list/, body.action)
  }
  const nowhere = await chat(b, SIDE, wordsOn('G60', { where: undefined }))
  assert.equal(nowhere.status, 400)
  assert.match(nowhere.why, /say where the person said it: the chat and the time/i)
  assert.equal(field(await items(b), 'Q711', 'Route'), 'partner', 'nothing was held')
  // A goal that is not in the map is refused, and so are no words.
  assert.equal((await chat(b, SIDE, wordsOn('G99'))).status, 409)
  assert.equal((await chat(b, SIDE, wordsOn('G60', { text: [] }))).status, 400)
})

test('held asks stand in no list of the person: not in Needs your attention, not as a wait, not as the partner\'s, not for Autopilot', async t => {
  const b = await open(t)
  await chat(b, SIDE, wordsOn('G60'))
  const work = { ok: true, ...(await readStore(b.dir)) }
  const needs = autopilot => storeNeeds(work, { now: NOW, autopilot, roleOf, names: Object.keys(ROLES) }).map(one => one.workId)
  assert.deepEqual(needs(false), ['Q713', 'Q714'])
  assert.deepEqual(needs(true), ['Q713', 'Q714'])
  assert.equal(isRoutedToPartner(work.items.get('Q711')), false)
  assert.equal(standsForPerson(work.items.get('Q712'), { autopilot: true, now: NOW }), false)
  const waits = storeWaits(work)
  assert.equal(waits.blocking.has('advisor'), false, 'a held blocking ask blocks nobody')
  assert.equal(waits.asking.has('advisor'), false)
  // The board's Autopilot pass never re-routes or answers it.
  const pass = await server(b, { action: 'autopilot', on: true }, NOW + MIN)
  assert.equal(pass.ok, true, pass.why)
  const all = await items(b)
  assert.deepEqual([field(all, 'Q711', 'Route'), field(all, 'Q712', 'Route')], ['asker', 'asker'])
  assert.deepEqual([field(all, 'Q711', 'State'), field(all, 'Q712', 'State')], ['open', 'open'])
  assert.equal(isHeld(all.get('Q711')), true)
})

test('the hold ends three ways: the chat re-asks (the held one is withdrawn "re-asked as Q715", no repeat refusal), or says "still stands", or withdraws', async t => {
  const b = await open(t)
  await chat(b, SIDE, wordsOn('G60'))
  // Worker 5 asks again under B1091, in the held ask's own words: a held ask is no repeat.
  const again = await chat(b, 'Worker 5', { action: 'ask', of: 'B1091', kind: 'decide', title: 'Which stairs for Q711?', text: ['Which stairs for Q711?'] }, NOW + 5 * MIN)
  assert.equal(again.ok, true, again.why)
  assert.equal(again.result.id, 'Q715')
  let all = await items(b)
  assert.equal(field(all, 'Q715', 'State'), 'open')
  assert.notEqual(field(all, 'Q715', 'Route'), 'asker')
  assert.equal(field(all, 'Q711', 'State'), 'withdrawn')
  assert.match(section(all, 'Q711', 'History').at(-1), /withdrawn: re-asked as Q715$/)
  assert.match(section(all, 'Q715', 'History').at(-1), /re-asked: replaces Q711/)
  // The Advisor says Q712 still stands: back to Route person, the lines on it, and the note is filed to main as any note.
  const stands = await chat(b, 'Advisor', { action: 'note', to: 'main', of: 'Q712', text: 'still stands: the look is a separate question' }, NOW + 6 * MIN)
  assert.equal(stands.ok, true, stands.why)
  all = await items(b)
  assert.equal(field(all, 'Q712', 'State'), 'open')
  assert.equal(field(all, 'Q712', 'Route'), 'person')
  assert.equal(section(all, 'Q712', 'Route').at(-1), 'still stands (16:26): the look is a separate question')
  assert.match(section(all, 'Q712', 'History').at(-1), /hold lifted: Advisor says it still stands$/)
  assert.equal(field(all, stands.result.id, 'To'), 'main')
  // Another chat's "still stands" lifts nothing; plain words lift nothing.
  const other = await board()
  t.after(() => rm(other.dir, { recursive: true, force: true }))
  await chat(other, SIDE, wordsOn('G60'))
  await chat(other, 'Worker 6', { action: 'note', to: 'main', of: 'Q711', text: 'still stands: no' }, NOW + MIN)
  await chat(other, 'Worker 5', { action: 'note', to: 'main', of: 'Q711', text: 'I will look at it' }, NOW + MIN)
  assert.equal(field(await items(other), 'Q711', 'Route'), 'asker')
  // Withdrawing a held ask works as for any ask.
  assert.equal((await chat(other, 'Worker 5', { action: 'withdraw', id: 'Q711', why: 'settled in chat 2' }, NOW + 2 * MIN)).ok, true)
  assert.equal(field(await items(other), 'Q711', 'State'), 'withdrawn')
})

test('the board\'s own recap words (recheck: false) hold nothing: the recap closes the asks it answers itself', async t => {
  const b = await open(t)
  const said = await workApi({ action: 'words', id: 'B1091', text: ['Sent back in the recap of G60, round 1: 1. Stairs: "taller, please"'], where: 'in the recap', recheck: false }, ctx(b, NOW, 'person'))
  assert.equal(said.ok, true, said.why)
  assert.deepEqual([said.result.held, said.result.wakes], [[], []])
  assert.equal(field(await items(b), 'Q711', 'Route'), 'partner', 'the recap\'s words held nothing')
})

test('words on a step from the main chat hold only that step\'s asks and note nobody', async t => {
  const b = await open(t)
  const said = await chat(b, 'Main', wordsOn('B1091'))
  assert.equal(said.ok, true, said.why)
  assert.deepEqual(said.result.held, ['Q711'])
  assert.equal(said.result.note, undefined)
  const all = await items(b)
  assert.equal(field(all, 'Q712', 'Route'), 'person', 'an ask of the goal is not an ask of the step')
  assert.equal(field(all, 'B1091', 'State'), 'in progress')
  assert.match(section(all, 'B1091', 'Your words').join(' '), /Every map is painted whole/)
  assert.deepEqual((await readdir(b.dir)).filter(name => /^N\d+\.md$/.test(name)), [])
})

test('a hold nobody answers ends after 60 minutes of the board\'s RUNNING time: the ask goes back, quietly, and its chat is told; never while paused', async t => {
  const b = await open(t)
  await chat(b, SIDE, wordsOn('G60'))
  const run = (minutes, gaps = []) => server(b, { action: 'holds-ended', gaps }, NOW + minutes * MIN)
  // The pure part: the board's running time since the words.
  const all = await items(b)
  const due = at => heldAsksDue({ items: all, now: NOW + at * MIN, runningMs: from => NOW + at * MIN - from })
  assert.deepEqual(due(59), [])
  assert.deepEqual(due(60).map(one => [one.id, one.chat, one.since, one.route]), [['Q711', 'Worker 5', '16:20', 'partner'], ['Q712', 'Advisor', '16:20', 'person']])
  assert.equal(HOLD_MINUTES, 60)
  // 61 minutes by the clock, but the board was off for 30 of them: not yet.
  const off = await run(61, [{ from: NOW + 10 * MIN, to: NOW + 40 * MIN }])
  assert.deepEqual(off.result.released, [])
  // Paused by the person: no hold ends, whatever the time.
  await writeFile(join(b.dir, 'pause.json'), JSON.stringify({ state: 'pausing', since: NOW + 5 * MIN, by: 'person' }))
  assert.deepEqual((await run(120)).result.released, [])
  assert.equal(field(await items(b), 'Q711', 'Route'), 'asker')
  await rm(join(b.dir, 'pause.json'))
  // Running again: both come back to their old routes, with the quiet line and a History line, and a word each.
  const ended = await run(61)
  assert.equal(ended.ok, true, ended.why)
  assert.deepEqual(ended.result.released, ['Q711', 'Q712'])
  assert.deepEqual(ended.result.wakes.map(one => [one.to, one.id, one.kind]), [['Worker 5', 'Q711', 'words'], ['Advisor', 'Q712', 'words']])
  const back = await items(b)
  assert.deepEqual([field(back, 'Q711', 'Route'), field(back, 'Q712', 'Route')], ['partner', 'person'])
  assert.equal(section(back, 'Q711', 'Route').at(-1), 'not re-checked by Worker 5 since your words at 16:20')
  assert.match(section(back, 'Q712', 'History').at(-1), /hold ended: Advisor did not re-check it in 60 minutes/)
  // Only the server runs it.
  assert.equal((await chat(b, 'Main', { action: 'holds-ended', gaps: [] }, NOW + 90 * MIN)).status, 403)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page: a held ask is drawn on no list, but its step's window shows it; a goal shows the person's words with chat and time.

const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'board.js'), 'utf8')
const cut = script.slice(script.indexOf('// heldasks:start'), script.indexOf('// heldasks:end'))
const page = {}
vm.runInNewContext(`${cut}\nObject.assign(this, { heldAskRows, goalWordsRows })`, page)
const plain = value => JSON.parse(JSON.stringify(value))

test('the step\'s window lists its held asks with their hold line; a goal draws the person\'s words with their chat and time', async t => {
  const b = await open(t)
  await chat(b, SIDE, wordsOn('G60'))
  const work = { ok: true, ...(await readStore(b.dir)) }
  const shown = itemOfStep(work, 'B1091')
  assert.deepEqual(shown.heldAsks.map(one => one.id), ['Q711'])
  const rows = plain(page.heldAskRows(shown))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, 'Q711: Which stairs for Q711? · held from partner: your words at 16:20 may change this (chat 2)')
  assert.deepEqual(plain(page.heldAskRows({ heldAsks: [] })), [])
  assert.deepEqual(plain(page.heldAskRows(itemOfStep(work, 'B1092'))), [])
  const goal = parseGoals(readFileSync(b.goalsFile, 'utf8')).byId.get('G60')
  assert.deepEqual(plain(page.goalWordsRows(goal.yourWords)), [`Your words, 16:20 in chat 2: "${DECISION}"`])
  assert.deepEqual(plain(page.goalWordsRows([{ at: '2026-11-09 08:05', text: 'no chat named' }])), ['Your words, 08:05: "no chat named"'])
  assert.deepEqual(plain(page.goalWordsRows([])), [])
  assert.equal((await readFile(b.goalsFile, 'utf8')).includes('Your words: 2026-11-09 16:20 · '), true)
})
