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
import { HOLD_MINUTES, heldAsksDue, isHeld, isHoldLine } from '../../src/work/askHold.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { workLineWhy } from '../../src/work/workLines.mjs'
import { sideWordsOf } from '../../src/bridge.mjs'
import { isExplicitPerson, standsForPerson } from '../../src/work/autopilot.mjs'
import { heldAsksOf, storeNeeds, storeWaits } from '../../src/work/lists.mjs'
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
// A side chat of the app: the bridge calls the API `as: 'side'` for a session it does not show under a name no shown chat has (bridge.mjs sideWordsOf).
const side = (b, body, now = NOW) => workApi({ ...body, chat: SIDE }, ctx(b, now, 'side'))
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
  const said = await side(b, wordsOn('G60'))
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
    const refused = await side(b, body)
    assert.equal(refused.ok, false, body.action)
    assert.equal(refused.status, 403, body.action)
    assert.match(refused.why, /is no chat of the list/, body.action)
  }
  const nowhere = await side(b, wordsOn('G60', { where: undefined }))
  assert.equal(nowhere.status, 400)
  assert.match(nowhere.why, /say where the person said it: the chat and the time/i)
  assert.equal(field(await items(b), 'Q711', 'Route'), 'partner', 'nothing was held')
  // A goal that is not in the map is refused, and so are no words.
  assert.equal((await side(b, wordsOn('G99'))).status, 409)
  assert.equal((await side(b, wordsOn('G60', { text: [] }))).status, 400)
})

test('held asks stand in no list of the person: not in Needs your attention, not as a wait, not as the partner\'s, not for Autopilot', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
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
  await side(b, wordsOn('G60'))
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
  await side(other, wordsOn('G60'))
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
  await side(b, wordsOn('G60'))
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
  // Running again: both come back to the person, with the quiet line and a History line, and a word each.
  const ended = await run(61)
  assert.equal(ended.ok, true, ended.why)
  assert.deepEqual(ended.result.released, ['Q711', 'Q712'])
  assert.deepEqual(ended.result.wakes.map(one => [one.to, one.id, one.kind]), [['Worker 5', 'Q711', 'words'], ['Advisor', 'Q712', 'words']])
  const back = await items(b)
  // Back to the PERSON, never to the old route (the partner's and main's clocks would fire at once on a stale advice).
  assert.deepEqual([field(back, 'Q711', 'Route'), field(back, 'Q712', 'Route')], ['person', 'person'])
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
const heldPage = {}
vm.runInNewContext(`${script.slice(script.indexOf('// heldlines:start'), script.indexOf('// heldlines:end'))}
Object.assign(this, { heldLinesView, withoutHeldLines })`, heldPage)

test('the step\'s window lists its held asks with their hold line; a goal draws the person\'s words with their chat and time', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
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

// ---------------------------------------------------------------------------------------------------------------------
// Review round 2 (2026-11-10, two core reviews of rule 15): the person must never lose a question; the release; the side chat; the cost.

const onGoal = { Of: 'G60', Route: 'person' }
const more = {
  // The board's own Accept card (no Owner), the app's popup, the partner's refine question, a verdict look, a chat the board does not show.
  Q720: ask('Q720', { Of: 'B1092', Via: 'accept', Route: 'person' }, 40),
  Q721: ask('Q721', { Owner: 'Worker 5', Of: 'B1091', Via: 'form', Route: 'person' }, 40),
  Q722: ask('Q722', { Owner: 'Advisor', Of: 'B1092', Via: 'refine', Route: 'person' }, 40),
  Q723: ask('Q723', { Owner: 'Worker 5', Of: 'B1091', Asks: 'look', Route: 'person' }, 40),
  Q724: ask('Q724', { Owner: 'Ghost chat', ...onGoal }, 40),
}

test('review 1: only an ask owned by a chat the board shows is held: no Owner (the board\'s Accept card), a popup, a refine question, a verdict look and a chat that is not shown stay where they are', async t => {
  const b = await board(more)
  t.after(() => rm(b.dir, { recursive: true, force: true }))
  const said = await side(b, wordsOn('G60'))
  assert.equal(said.ok, true, said.why)
  assert.deepEqual(said.result.held, ['Q711', 'Q712'])
  const all = await items(b)
  assert.deepEqual(['Q720', 'Q721', 'Q722', 'Q723', 'Q724'].map(id => field(all, id, 'Route')), ['person', 'person', 'person', 'person', 'person'])
  // The prefix does not matter: "Garden · Worker 5" is Worker 5 too.
  const prefixed = await board({ Q725: ask('Q725', { Owner: 'Garden · Worker 5', Of: 'B1091', Route: 'person' }, 40) })
  t.after(() => rm(prefixed.dir, { recursive: true, force: true }))
  const named = await workApi({ ...wordsOn('B1091'), chat: SIDE }, { ...ctx(prefixed, NOW, 'side'), prefix: 'Garden · ' })
  assert.deepEqual(named.result.held, ['Q711', 'Q725'])
})

test('review 2: an ask released once is never held again by later words; a re-ask is a new ask that the next words may hold', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
  const ended = await server(b, { action: 'holds-ended', gaps: [] }, NOW + 61 * MIN)
  assert.deepEqual(ended.result.released, ['Q711', 'Q712'])
  // A chat that writes words every hour: the second words hold nothing of what was released (Q714 was filed after the first words and never held).
  const again = await side(b, wordsOn('G60', { text: ['One more thing about the stairs.'] }), NOW + 90 * MIN)
  assert.deepEqual(again.result.held, ['Q714'])
  assert.equal(field(await items(b), 'Q711', 'Route'), 'person')
  // "still stands" is a release too: only Q711 is held by the next words.
  const other = await open(t)
  await side(other, wordsOn('G60'))
  await chat(other, 'Advisor', { action: 'note', to: 'main', of: 'Q712', text: 'still stands: separate' }, NOW + MIN)
  assert.deepEqual((await side(other, wordsOn('G60', { text: ['And again.'] }), NOW + 5 * MIN)).result.held, [])
  assert.equal(field(await items(other), 'Q711', 'Route'), 'asker')
})

test('review 5 and 6: no release while the board resumes either; a release goes to the PERSON, restamped, so no old route\'s clock fires at once; the sweep judges it anew', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
  await writeFile(join(b.dir, 'pause.json'), JSON.stringify({ state: 'resuming', since: NOW + 5 * MIN, by: 'person' }))
  assert.deepEqual((await server(b, { action: 'holds-ended', gaps: [] }, NOW + 120 * MIN)).result.released, [], 'resuming counts no running time')
  await writeFile(join(b.dir, 'pause.json'), JSON.stringify({ state: 'running', since: NOW + 100 * MIN, by: 'person' }))
  assert.deepEqual((await server(b, { action: 'holds-ended', gaps: [] }, NOW + 120 * MIN)).result.released, [], 'the 60 minutes count from the end of the pause')
  const at = NOW + 161 * MIN
  const ended = await server(b, { action: 'holds-ended', gaps: [] }, at)
  assert.deepEqual(ended.result.released, ['Q711', 'Q712'])
  const all = await items(b)
  for (const id of ['Q711', 'Q712']) {
    assert.equal(field(all, id, 'Route'), 'person', id)
    assert.equal(field(all, id, 'Since'), stamp(at), `${id} restamped`)
    assert.equal(field(all, id, 'Filed'), String(at), `${id} restamped`)
  }
  // Nothing escalates at once: not the partner's 30 minutes, not the "old ask" flag of the blocking Q712 (filed 19 minutes before the words).
  const done = reconcile({ store: { items: all, flow: DEFAULT_FLOW, problems: [], pause: null }, flow: DEFAULT_FLOW, lanes: [], now: at + MIN, times: { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }, prefix: '' })
  assert.deepEqual(done.escalations, [])
  assert.deepEqual(done.flags.filter(flag => flag.kind === 'old ask'), [])
  // The hold and release lines are the board's, no hand-over of anyone's: the sweep still judges the ask.
  assert.equal(isExplicitPerson(all.get('Q711')), false)
  assert.equal(isExplicitPerson(all.get('Q712')), false)
  const handed = { head: new Map([['Kind', 'ask'], ['Route', 'person']]), sections: new Map([['Route', ['The partner handed it on']]]) }
  assert.equal(isExplicitPerson(handed), true, 'a real hand-over still counts')
  assert.equal(isHoldLine('held from partner: your words at 16:20 may change this (chat 2)'), true)
  assert.equal(isHoldLine('still stands (16:26): why'), true)
  assert.equal(isHoldLine('The partner handed it on'), false)
  // The refine loop never takes the advice for a held ask (an old store's held refine question).
  const refine = await board({ Q730: ask('Q730', { Owner: 'Advisor', Of: 'B1092', Via: 'refine', Route: 'asker', Advice: 'Yes' }, 40) })
  t.after(() => rm(refine.dir, { recursive: true, force: true }))
  await server(refine, { action: 'autopilot', on: true }, NOW + MIN)
  assert.deepEqual([field(await items(refine), 'Q730', 'Route'), field(await items(refine), 'Q730', 'State')], ['asker', 'open'])
})

test('review 7: the card shows only the newest Route line, not every line joined', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
  await server(b, { action: 'holds-ended', gaps: [] }, NOW + 61 * MIN)
  const work = { ok: true, ...(await readStore(b.dir)) }
  assert.equal(section(work.items, 'Q711', 'Route').length, 2)
  const need = storeNeeds(work, { now: NOW + 62 * MIN, roleOf, names: Object.keys(ROLES) }).find(one => one.workId === 'Q711')
  assert.equal(need.routeNote, 'not re-checked by Worker 5 since your words at 16:20')
})

test('review 8: a re-ask of the same goal ends the chat\'s holds there too, also when the question joins another chat\'s ask', async t => {
  const b = await board({
    B1094: step('B1094', 'in progress', { Owner: 'Worker 5' }),
  })
  t.after(() => rm(b.dir, { recursive: true, force: true }))
  await side(b, wordsOn('G60'))
  // By goal, not by exact step: Q711 is of B1091, the new ask is of B1094 (the same goal).
  const under = await chat(b, 'Worker 5', { action: 'ask', of: 'B1094', kind: 'decide', title: 'Which stairs now?', text: ['Which stairs now?'] }, NOW + 5 * MIN)
  assert.equal(under.ok, true, under.why)
  assert.equal(field(await items(b), 'Q711', 'State'), 'withdrawn')
  assert.match(section(await items(b), 'Q711', 'History').at(-1), /withdrawn: re-asked as Q\d+$/)
  // Joining another chat's open ask under B1095 is a re-ask too: the held Q741 of Worker 5 ends.
  const held = await board({
    B1095: step('B1095', 'in progress', { Owner: 'Worker 5' }),
    // Filed after the person's words (the chat knew them): the words hold nothing of it, and it is the ask the new question joins.
    Q740: ask('Q740', { Owner: 'Worker 6', Of: 'B1095', Route: 'person' }, -10),
    Q741: ask('Q741', { Owner: 'Worker 5', Of: 'B1091', Route: 'person' }, 50),
  })
  t.after(() => rm(held.dir, { recursive: true, force: true }))
  await side(held, wordsOn('G60'))
  const joined = await chat(held, 'Worker 5', { action: 'ask', of: 'B1095', kind: 'decide', title: 'A different stairs question?', text: ['A different stairs question?'] }, NOW + 5 * MIN)
  assert.equal(joined.ok, true, joined.why)
  assert.equal(joined.result.merged, 'Q740', "the question joined the other chat's ask")
  const all = await items(held)
  assert.deepEqual(['Q711', 'Q741'].map(id => field(all, id, 'State')), ['withdrawn', 'withdrawn'])
  assert.match(section(all, 'Q741', 'History').at(-1), /withdrawn: re-asked as Q740$/)
})

test('review 9: sideWordsOf passes only a session the board does not know under a name no shown chat has; the API gives role side only to as: side', async t => {
  const state = { chatPrefix: 'Game - ', chats: [{ name: 'Main', isMain: true, session: 's-main' }, { name: 'Worker 5', session: 's-5' }], advisor: { name: 'Advisor', session: 's-adv' } }
  const refused = { ok: false, status: 409 }
  const words = (chatName, session = 's-side') => [refused, { action: 'words' }, { chat: chatName, session }, state]
  assert.equal(sideWordsOf(...words('2. Worker board goal management')), true)
  // A second "Game - Main" from another session must never pass for Main (exact, prefixed, any case).
  for (const name of ['Main', 'Game - Main', 'game - main', ' MAIN ', 'Worker 5', 'Game - Advisor']) assert.equal(sideWordsOf(...words(name)), false, name)
  // A session the board shows (under another name: renamed) is no side chat; other actions and other refusals are none.
  assert.equal(sideWordsOf(refused, { action: 'words' }, { chat: 'Old name', session: 's-5' }, state), false)
  assert.equal(sideWordsOf(refused, { action: 'note' }, { chat: 'chat 2', session: 's-side' }, state), false)
  assert.equal(sideWordsOf({ ok: false, status: 400 }, { action: 'words' }, { chat: 'chat 2', session: 's-side' }, state), false)
  assert.equal(sideWordsOf({ ok: true, chat: 'Main' }, { action: 'words' }, { chat: 'chat 2', session: 's-side' }, state), false)
  // The API: a side call named like Main is no main chat; a list chat's words call without `as: side` is no side call.
  const b = await open(t)
  const asMain = await workApi({ action: 'note', to: 'main', text: 'hi', chat: 'Main' }, ctx(b, NOW, 'side'))
  assert.equal(asMain.status, 403, 'a side call named Main has no list role')
  const said = await workApi({ ...wordsOn('G60'), chat: 'Main' }, ctx(b, NOW, 'side'))
  assert.equal(said.ok, true, said.why)
  assert.equal((await chat(b, SIDE, wordsOn('G60'))).status, 403, 'a chat that is no list chat is a side chat only when the bridge says so')
  assert.equal((await chat(b, 'Worker 5', wordsOn('G60'))).status, 403, 'a worker does not call words')
  assert.equal((await chat(b, 'Advisor', wordsOn('G60'))).status, 403, 'the partner does not call words')
  // The server: a side call notes no mod and no sign of life for any name, and reaches the API as `side`.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.mjs'), 'utf8')
  assert.match(source, /if \(checked\.isSide !== true\) noteMod\(body, checked\)/)
  assert.match(source, /workAction\(\{ \.\.\.body, chat: checked\.chat \}, checked\.isSide === true \? 'side' : undefined\)/)
})

test('review 10: roles/main.md says who calls words and that Main does not withdraw another chat\'s ask; the other docs say the same', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const main = readFileSync(join(root, 'roles', 'main.md'), 'utf8')
  assert.doesNotMatch(main, /any chat may call `words`/)
  assert.doesNotMatch(main, /You may also lift or withdraw a held ask of another chat/)
  assert.match(main, /`words` is called by the person, by you, and by a side chat of the app/)
  assert.match(main, /You do not withdraw another chat's held ask/)
  for (const file of ['roles/worker.md', 'roles/partner.md']) assert.match(readFileSync(join(root, file), 'utf8'), /You do not call `words`/, file)
  assert.match(readFileSync(join(root, 'DESIGN.md'), 'utf8'), /Workers and the partner get 403 on `words`, and the main chat does not withdraw another chat's ask/)
})

test('review 11 and 12: the board\'s wake sender reads the state once per call and resets once; holds-ended runs only when the state shows a held ask', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.mjs'), 'utf8')
  const start = source.indexOf('const sendWakes = async done =>')
  const body = source.slice(start, source.indexOf('/** What the API goes by', start))
  assert.equal(body.split('await readState()').length - 1, 1, 'one read per call, not per word')
  assert.equal(body.split('readState.reset()').length - 1, 1, 'one reset per call, not per word')
  assert.doesNotMatch(body.slice(body.indexOf('for (const wake')), /await readState\(\)/)
  const pass = source.slice(source.indexOf("loops.run('holds-ended'"), source.indexOf("loops.run('stuck-checks'"))
  assert.match(pass, /if \(!heldIn\(state\)\) return/)
  assert.match(source, /const heldIn = state => \(state\?\.forYou \?\? \[\]\)\.some\(need => need\.kind === 'held'\)/)
})

test('review 13: the person\'s words on a goal add to the unread note about that goal instead of making a second one', async t => {
  const b = await open(t)
  const first = await side(b, wordsOn('G60'))
  const second = await side(b, wordsOn('G60', { text: ['And the stairs are smaller too.'] }), NOW + 10 * MIN)
  assert.equal(second.ok, true, second.why)
  assert.equal(second.result.note, first.result.note, 'one note per goal while it is unread')
  assert.deepEqual((await readdir(b.dir)).filter(name => /^N\d+\.md$/.test(name)), [`${first.result.note}.md`])
  const all = await items(b)
  const words = section(all, first.result.note, 'Text').join(' ')
  assert.match(words, /Every map is painted whole by Codex/)
  assert.match(words, /And the stairs are smaller too/)
  assert.match(field(all, first.result.note, 'Text'), /^For the partner \(Advisor\): the person's words at 16:20/)
  // Read by the main chat (no longer unread): the next words make a new note.
  const file = join(b.dir, `${first.result.note}.md`)
  await writeFile(file, (await readFile(file, 'utf8')).replace('State: unread', 'State: read'))
  const third = await side(b, wordsOn('G60', { text: ['Later still.'] }), NOW + 20 * MIN)
  assert.notEqual(third.result.note, first.result.note)
})

test('review 14: the hold word matters only while its ask is open and held; answered, withdrawn, re-asked or released it is done; the release word holds while the ask is open', () => {
  const askItem = (state, route) => parseItem(`Id: Q711\nKind: ask\nTitle: x\nState: ${state}\nRoute: ${route}\nOwner: Worker 5\n`)
  const holdWord = { command: 'work', kind: 'words', about: 'Q711', to: 'Worker 5', text: 'work: the person\'s words at 16:20 on G60: re-ask or withdraw Q711, or say it still stands' }
  const releaseWord = { ...holdWord, text: 'work: Q711 was held for the person\'s words at 16:20 and nobody re-checked it: it is back with the person; withdraw it or re-ask it if it changed' }
  const why = (word, item) => workLineWhy(word, new Map(item === null ? [] : [['Q711', item]]), {})
  assert.equal(why(holdWord, askItem('open', 'asker')), null)
  assert.equal(why(holdWord, askItem('answered', 'asker')), 'Q711 is answered')
  assert.equal(why(holdWord, askItem('withdrawn', 'asker')), 'Q711 is withdrawn')
  assert.equal(why(holdWord, askItem('open', 'person')), 'Q711 is no longer held')
  assert.equal(why(holdWord, null), 'Q711 is gone')
  assert.equal(why(releaseWord, askItem('open', 'person')), null)
  assert.equal(why(releaseWord, askItem('answered', 'person')), 'Q711 is answered')
})

test('review 3: the held asks, goal-level too, are one quiet line each; the page draws no card and no count for them', async t => {
  const b = await open(t)
  await side(b, wordsOn('G60'))
  const work = { ok: true, ...(await readStore(b.dir)) }
  assert.deepEqual(heldAsksOf(work, { names: Object.keys(ROLES) }).map(one => [one.id, one.chat, one.minute, one.of]), [['Q711', 'Worker 5', '16:20', 'B1091'], ['Q712', 'Advisor', '16:20', 'G60']])
  const needs = [{ id: 'held:Q711', kind: 'held', ask: 'Q711', title: 'Q711 held: Worker 5 re-checks it after your words at 16:20' }, { id: 'work:Q713', kind: 'input', workId: 'Q713', title: 'Which stairs for Q713?' }]
  assert.deepEqual(plain(heldPage.heldLinesView(needs)).map(one => [one.id, one.words, one.href]), [['Q711', 'Q711 held: Worker 5 re-checks it after your words at 16:20', '#details=Q711']])
  assert.deepEqual(plain(heldPage.withoutHeldLines(needs)).map(one => one.id), ['work:Q713'])
  assert.deepEqual(plain(heldPage.heldLinesView([])), [])
})
