// B579: the Backlog tab's Completed by day. Which steps a day holds (by the local time of their move to done), when its
// recap is written again, what the call is told and must answer, and the recap without a call (grouped by goal).
// Made-up steps in the shape of the work store.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { RECAP_ARGS, callClaude, dayRecaps } from '../../src/dayRecap.mjs'
import { parseItem } from '../../src/work/item.mjs'
import {
  MOST_POINTS, NEWER_POINT, RECAP_EVERY_MS, dayAfter, dayOf, doneSteps, fallbackRecap, lastDays, readRecap, recapDue, recapPrompt, recapText,
  shownRecap, stepsOfDay,
} from '../../src/work/doneDays.mjs'

const MIN = 60_000
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime()

function step(id, { state = 'done', moves = [], goal = 'G15', owner = 'Game - Worker 1', title = `Step ${id}`, summary = `What ${id} gives.` } = {}) {
  return parseItem([
    `Id: ${id}`, 'Kind: step', `Title: ${title}`, `State: ${state}`, `Owner: ${owner}`, ...(goal === null ? [] : [`Goal: ${goal}`]), 'Since: 2026-10-20 10:00', '',
    '## Context', '  The person: "secret words of a chat" in src/file.mjs', '',
    '## History', '- 2026-10-20 10:00 Main: made', ...moves, '',
    '## Summary', summary, '',
    '## Touches', 'src/hidden.mjs', '',
  ].join('\n'))
}
const done = (date, time, who = 'server') => `- 2026-10-${date} ${time} ${who}: review → done`

test('a step counts on the local day of its last move to done: across midnight the two steps fall on two days', () => {
  const items = [
    step('B1', { moves: [done(23, '23:59')] }),
    step('B2', { moves: [done(24, '00:01')] }),
    step('B3', { moves: [done(22, '09:00'), '- 2026-10-23 08:00 Main: done → queued', done(24, '12:30')] }),
  ]
  const steps = doneSteps(items, { prefix: 'Game - ' })
  assert.deepEqual(stepsOfDay(steps, '2026-10-23').map(one => one.id), ['B1'])
  assert.deepEqual(stepsOfDay(steps, '2026-10-24').map(one => one.id), ['B3', 'B2'])
  assert.equal(steps.find(one => one.id === 'B3').at, at(24, 12, 30))
  assert.equal(steps[0].by, 'Worker 1')
})

test('a dropped step, a step not done now, and a done step without a dated move are left out', () => {
  const items = [
    step('B4', { state: 'dropped', moves: [done(24, '10:00'), '- 2026-10-24 11:00 Main: done → dropped'] }),
    step('B5', { state: 'queued', moves: [done(24, '10:00'), '- 2026-10-24 11:00 Main: done → queued'] }),
    step('B6', { moves: [] }),
    step('B7', { moves: [done(24, '10:00')] }),
  ]
  assert.deepEqual(doneSteps(items).map(one => one.id), ['B7'])
})

test('Browse days: the seven days up to today with their counts, across a month end', () => {
  const steps = doneSteps([step('B1', { moves: [done(31, '10:00')] })].map(item => item))
  assert.equal(dayAfter('2026-11-01', -1), '2026-10-31')
  const days = lastDays(steps, '2026-11-02')
  assert.equal(days.length, 7)
  assert.deepEqual(days.slice(0, 3), [{ day: '2026-11-02', count: 0 }, { day: '2026-11-01', count: 0 }, { day: '2026-10-31', count: 1 }])
})

const STEPS = doneSteps([
  step('B1', { moves: [done(24, '09:00')] }), step('B2', { moves: [done(24, '10:00')] }),
  step('B3', { moves: [done(24, '11:00')], goal: 'G7' }), step('B4', { moves: [done(24, '12:00')], goal: null }),
])

test('the stale rule: missing or not generated is due; a fresh one is not; a newer step makes it due, today at most every 30 minutes', () => {
  const now = at(24, 13, 0)
  const ctx = { day: '2026-10-24', today: '2026-10-24', now }
  const fresh = { isGenerated: true, ids: STEPS.map(one => one.id), newest: at(24, 12, 0), triedAt: at(24, 12, 50) }
  assert.equal(recapDue(null, STEPS, ctx), true)
  assert.equal(recapDue(fresh, STEPS, ctx), false)
  assert.equal(recapDue(fresh, STEPS, { ...ctx, today: '2026-10-25' }), false, 'a past day with its recap is never written again')
  assert.equal(recapDue(fresh, [], ctx), false, 'a day without steps has no recap')
  const older = { ...fresh, ids: ['B1', 'B2', 'B3'], newest: at(24, 11, 0) }
  assert.equal(recapDue(older, STEPS, ctx), false, 'today: tried 10 minutes ago')
  assert.equal(recapDue({ ...older, triedAt: now - RECAP_EVERY_MS }, STEPS, ctx), true, 'today: tried 30 minutes ago')
  assert.equal(recapDue(older, STEPS, { ...ctx, today: '2026-10-25' }), true, 'a past day is written at its open')
  assert.equal(recapDue({ ...fresh, isGenerated: false }, STEPS, { ...ctx, today: '2026-10-25' }), true, 'the fallback is written properly at the next open')
})

test('the prompt holds only the day\'s ids, titles and summaries: nothing of the Context, the History or the files', () => {
  const prompt = recapPrompt(STEPS)
  for (const one of STEPS) {
    assert.ok(prompt.includes(one.title))
    assert.ok(prompt.includes(one.summary))
  }
  for (const hidden of ['secret words', 'file.mjs', 'hidden.mjs', 'review → done', 'Worker 1', 'G15']) assert.ok(!prompt.includes(hidden), hidden)
  const listed = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
  assert.deepEqual(listed.map(one => Object.keys(one).sort()), STEPS.map(() => ['id', 'summary', 'title']))
})

test('an answer is read only when every step sits in exactly one of three to six points', () => {
  const good = JSON.stringify({ points: [{ title: 'A', text: 'One.', ids: ['B1', 'B2'] }, { title: 'B', text: 'Two.', ids: ['B3'] }, { title: 'C', text: 'Three.', ids: ['B4'] }] })
  assert.deepEqual(readRecap(`Here it is:\n${good}`, STEPS).map(one => one.ids), [['B1', 'B2'], ['B3'], ['B4']])
  const answer = points => JSON.stringify({ points })
  assert.equal(readRecap(answer([{ title: 'A', ids: ['B1', 'B2'] }, { title: 'B', ids: ['B3'] }, { title: 'C', ids: ['B3'] }]), STEPS), null, 'B3 twice, B4 nowhere')
  assert.equal(readRecap(answer([{ title: 'A', ids: ['B1', 'B2'] }, { title: 'B', ids: ['B3'] }, { title: 'C', ids: ['B3', 'B4'] }]), STEPS), null, 'B3 in two points')
  assert.equal(readRecap(answer([{ title: 'A', ids: ['B1', 'B2'] }, { title: 'B', ids: ['B3'] }, { title: 'C', ids: ['B9'] }]), STEPS), null, 'B9 is not the day\'s')
  assert.equal(readRecap(answer([{ title: 'A', ids: ['B1', 'B2', 'B3', 'B4'] }]), STEPS), null, 'one point for four steps')
  assert.equal(readRecap('no JSON at all', STEPS), null)
  const many = Array.from({ length: 8 }, (_, n) => `B${n + 1}`)
  const eight = many.map((id, n) => ({ id, title: `T${n}`, summary: '', at: n }))
  assert.equal(readRecap(answer(many.map(id => ({ title: id, ids: [id] }))), eight), null, `more than ${MOST_POINTS} points`)
})

test('without a call the points are the goals, most steps first, at most six, every step once', () => {
  const titles = new Map([['G15', 'Board easier day to day'], ['G7', 'Levels']])
  const points = fallbackRecap(STEPS, titles)
  assert.deepEqual(points.map(one => [one.title, one.ids]), [['Board easier day to day', ['B2', 'B1']], ['Levels', ['B3']], ['Other work', ['B4']]])
  const goals = new Map(Array.from({ length: 9 }, (_, n) => [`G${n + 1}`, `Goal ${n + 1}`]))
  const nine = Array.from({ length: 9 }, (_, n) => ({ id: `B${n + 1}`, title: `T${n}`, summary: '', goal: `G${n + 1}`, at: n }))
  const capped = fallbackRecap(nine, goals)
  assert.equal(capped.length, MOST_POINTS)
  assert.equal(capped.at(-1).title, 'Other work')
  assert.deepEqual(capped.flatMap(one => one.ids).sort(), nine.map(one => one.id).sort())
})

test('a kept recap shows the steps finished since it was written in one more point', () => {
  const kept = { points: [{ title: 'A', text: '', ids: ['B1', 'B2', 'B3'] }], isGenerated: true, at: 1 }
  const shown = shownRecap(kept, STEPS)
  assert.deepEqual(shown.points.map(one => [one.title, one.ids]), [['A', ['B1', 'B2', 'B3']], [NEWER_POINT, ['B4']]])
  assert.equal(shownRecap(kept, []), null)
  assert.match(recapText('2026-10-24', shown.points), /^Recap of 2026-10-24\n- A \(B1, B2, B3\)/)
})

function keeper({ answer = { ok: true, text: JSON.stringify({ points: [{ title: 'A', text: 'x', ids: ['B1', 'B2'] }, { title: 'B', text: 'y', ids: ['B3'] }, { title: 'C', text: 'z', ids: ['B4'] }] }) }, command = ['claude'] } = {}) {
  let now = at(24, 13, 0)
  const calls = []
  const written = []
  const recaps = dayRecaps({
    file: 'recaps.json', findCommand: async () => command, clock: () => now,
    call: async ({ prompt }) => { calls.push(prompt); return answer },
    read: async () => ({ value: null }), write: async (file, text) => { written.push(JSON.parse(text)) },
  })
  return { recaps, calls, written, later: ms => { now += ms } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const FACTS = { today: '2026-10-24', goalTitles: new Map([['G15', 'Board easier day to day']]) }

test('a due recap is written by one call and kept for its day; the next open makes no call', async () => {
  const { recaps, calls, written } = keeper()
  const first = await recaps.view('2026-10-24', STEPS, FACTS)
  assert.equal(first.isWriting, true)
  assert.equal(first.recap.isGenerated, false, 'grouped by goal while it is written')
  await settle()
  assert.equal(calls.length, 1)
  assert.equal(written.at(-1)['2026-10-24'].isGenerated, true)
  const second = await recaps.view('2026-10-24', STEPS, FACTS)
  assert.equal(calls.length, 1)
  assert.deepEqual(second.recap.points.map(one => one.title), ['A', 'B', 'C'])
  assert.equal(second.recap.isGenerated, true)
})

test('no call while paused or near a limit; a failed call or no command line falls back to the goals, marked not generated', async () => {
  const held = keeper()
  const paused = await held.recaps.view('2026-10-24', STEPS, { ...FACTS, whyNot: 'All chats are paused.' })
  await settle()
  assert.equal(held.calls.length, 0)
  assert.equal(paused.recap.isGenerated, false)
  assert.equal(paused.recap.why, 'All chats are paused.')
  assert.equal(paused.recap.points[0].title, 'Board easier day to day')

  const failing = keeper({ answer: { ok: false, why: 'The Claude command line is not signed in.' } })
  await failing.recaps.view('2026-10-24', STEPS, FACTS)
  await settle()
  const after = await failing.recaps.view('2026-10-24', STEPS, FACTS)
  assert.equal(after.recap.isGenerated, false)
  assert.equal(after.recap.why, 'The Claude command line is not signed in.')
  assert.equal(failing.calls.length, 1, 'today: not tried again within 30 minutes')
  failing.later(RECAP_EVERY_MS)
  await failing.recaps.view('2026-10-24', STEPS, FACTS)
  await settle()
  assert.equal(failing.calls.length, 2, 'tried again after 30 minutes')

  const none = keeper({ command: null })
  await none.recaps.view('2026-10-24', STEPS, FACTS)
  await settle()
  assert.equal(none.calls.length, 0)
  assert.match((await none.recaps.view('2026-10-24', STEPS, FACTS)).recap.why, /No Claude command line/)
})

const standIn = script => [process.execPath, '-e', script, '--']

test('the call: Sonnet, no tools, no settings; the prompt on its input; a chat\'s variables are not passed on', async () => {
  const echo = standIn('let t="";process.stdin.on("data",c=>t+=c).on("end",()=>console.log(JSON.stringify({args:process.argv.slice(1),prompt:t,env:Object.keys(process.env).filter(k=>/^CLAUDE_CODE/.test(k))})))')
  const made = await callClaude({ command: echo, prompt: 'the words', env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'x', CLAUDECODE: '1' } })
  assert.equal(made.ok, true)
  const seen = JSON.parse(made.text)
  assert.deepEqual(seen.args, RECAP_ARGS)
  assert.equal(seen.prompt, 'the words')
  assert.deepEqual(seen.env, [])
  for (const flag of ['-p', '--model', 'sonnet', '--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence']) assert.ok(RECAP_ARGS.includes(flag), flag)
  const signedOut = await callClaude({ command: standIn('console.log("Not logged in · Please run /login");process.exit(1)'), prompt: '' })
  assert.deepEqual(signedOut, { ok: false, why: 'The Claude command line is not signed in.' })
  const late = await callClaude({ command: standIn('setTimeout(()=>{},10000)'), prompt: '', seconds: 1 })
  assert.match(late.why, /longer than 1 seconds/)
})

test('the page names a day beside today and finds a completed item by id or words', async () => {
  const script = await readFile(new URL('../../public/board.js', import.meta.url), 'utf8')
  const context = {}
  vm.runInNewContext(`${script.slice(script.indexOf('// doneday:start'), script.indexOf('// doneday:end'))}\nObject.assign(this, { dayName, dayDate, dayStep, dayFinds })`, context)
  assert.equal(context.dayName('2026-10-24', '2026-10-24'), 'Today')
  assert.equal(context.dayName('2026-10-31', '2026-11-01'), 'Yesterday')
  assert.equal(context.dayName('2026-10-22', '2026-10-24'), 'Thu')
  assert.equal(context.dayDate('2026-10-24'), 'October 24, 2026')
  assert.equal(context.dayStep('2026-10-31', 1), '2026-11-01')
  assert.equal(context.dayFinds({ id: 'B574', title: 'Fix of X25' }, '57'), true)
  assert.equal(context.dayFinds({ id: 'B574', title: 'Fix of X25' }, 'x25'), true)
  assert.equal(context.dayFinds({ id: 'B574', title: 'Fix of X25' }, 'level'), false)
  assert.equal(dayOf(at(24, 23, 59)), '2026-10-24')
})
