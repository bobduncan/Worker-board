// Reactive board, brief B (the person, 2026-11-09: "it tries to react directly to the CHAT instead of code"): "Make a step
// from this" on an Advisor's answer under a goal files the step by code, as the Brainstorm's Create does (B754): no Talk to
// Main box, no word to any chat. Made-up names in the unit and page tests; the board test runs on a copy of the real store.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { askStepMark, askToStep } from '../src/goalSteps.mjs'
import { parseGoals } from '../src/goals.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { asSent, build, parsed } from './partnerState.mjs'

const GOALS = ['# Goals', 'Last id: G6', 'Last ask: A2', 'Focus: G6', '', '- [~] G6 Benches that match the picture', '  Steps: B12',
  '  Ask (A1, 2026-10-15 18:40): what differs most from the picture?',
  '  Answer (2026-10-15 19:20, Advisor): the shading: three tones there, one here. Fix the bench colours first.',
  '  Ask (A2, 2026-10-15 20:00): and the gate?', ''].join('\n')

/** The ports of the unit test: the map, a record of the steps made, and a finder of a step made before by its mark. */
function ports(text = GOALS) {
  const made = []
  return {
    made,
    readMap: async () => text,
    existing: async (goal, ask) => made.find(one => one.mark === askStepMark(goal, ask))?.id ?? null,
    make: async step => {
      made.push({ ...step, id: `B${100 + made.length}` })
      return { ok: true, result: { step: `B${99 + made.length}` } }
    },
  }
}

test('one click makes one step with the goal, a title from the answer and its words; a second click makes no second', async () => {
  const p = ports()
  const first = await askToStep({ id: 'G6', ask: 'A1' }, p)
  assert.deepEqual(first, { ok: true, result: { step: 'B100', again: false } })
  assert.equal(p.made.length, 1)
  assert.equal(p.made[0].goal, 'G6')
  assert.equal(p.made[0].title, 'The shading: three tones there, one here')
  assert.equal(p.made[0].description, 'the shading: three tones there, one here. Fix the bench colours first.')
  assert.equal(p.made[0].mark, askStepMark('G6', 'A1'))
  const again = await askToStep({ id: 'G6', ask: 'A1' }, p)
  assert.deepEqual(again, { ok: true, result: { step: 'B100', again: true } })
  assert.equal(p.made.length, 1, 'the second click made no second step')
})

test('an unknown goal, an unknown ask, an ask not answered yet and a bad id are refused, and no step is made', async () => {
  const p = ports()
  for (const [body, status] of [[{ id: 'G99', ask: 'A1' }, 404], [{ id: 'G6', ask: 'A9' }, 404], [{ id: 'G6', ask: 'A2' }, 409], [{ id: 'six', ask: 'A1' }, 400], [{ id: 'G6', ask: 'one' }, 400], [{}, 400]]) {
    const done = await askToStep(body, p)
    assert.equal(done.ok, false, JSON.stringify(body))
    assert.equal(done.status, status, JSON.stringify(body))
    assert.ok(done.why.length > 0)
  }
  assert.equal(p.made.length, 0)
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

const stepOf = state => parsed(`Id: B77
Kind: step
Title: The shading
State: ${state}
Activity: Garden
Goal: G6
Since: 2026-10-19 10:00

## Context
  ${askStepMark('G6', 'A1')}
`)
const pageState = () => asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })

test('the page: the click shows "Making…", then "Step B<n> made" with its link, on a fresh state too; a refusal shows its why in place', async () => {
  let release = null
  const answers = request => {
    if (request.url !== '/api/goals') return reply({})
    return new Promise(done => { release = () => done(reply({ step: 'B77', again: false })) })
  }
  // The record: once the board has made the step, the next state names it (as the real state does).
  const withStep = requests => (requests.some(one => one.url === '/api/goals') ? asSent({ ...build([stepOf('new')], undefined, GOALS), goalsEdit: { canWrite: true } }) : pageState())
  const page = await openPage({ state: withStep, answers, hash: 'advice/goals/G6' })
  try {
    const button = () => page.all('.goal-ask-block .goals-tool').find(one => /Make a step|Making/.test(one.textContent))
    assert.equal(button().textContent, 'Make a step from this')
    await page.click('[data-ask-action="step"]')
    // Nothing went to a chat; the one request is the board's own action.
    assert.deepEqual(page.sent('/api/say'), [])
    assert.deepEqual(page.sent('/api/goals').map(one => [one.body.command, one.body.id, one.body.ask]), [['ask-step', 'G6', 'A1']])
    assert.equal(button().textContent, 'Making…')
    assert.equal(button().disabled, true)
    assert.equal(page.find('#main-text').value, '', 'no Talk to Main box was filled')
    release()
    await page.click('#goals-frame')
    const done = page.find('.goal-ask-step')
    assert.equal(done.textContent, 'Step B77 made')
    assert.equal(done.querySelector('a').getAttribute('href'), '#details=B77')
    assert.equal(page.all('[data-ask-action="step"]').length, 0, 'the line stands in the button\'s place')
    assert.deepEqual(page.sent('/api/say'), [])
  } finally {
    await page.close()
  }
  const refusing = await openPage({ state: pageState(), answers: request => (request.url === '/api/goals' ? reply('The work store has no activity to put the step under.', 409) : reply({})), hash: 'advice/goals/G6' })
  try {
    await refusing.click('[data-ask-action="step"]')
    assert.match(refusing.text('.goal-ask-step'), /Not made: The work store has no activity to put the step under\./)
    assert.equal(refusing.all('[data-ask-action="step"]').length, 1, 'and a button to try again')
  } finally {
    await refusing.close()
  }
})

test('the page draws the made line from the records: a fresh state with the step present shows the line and no button; a dropped step shows the button', async () => {
  const stepItem = state => parsed(`Id: B88
Kind: step
Title: The shading
State: ${state}
Activity: Garden
Goal: G6
Since: 2026-10-19 10:00

## Context
  ${askStepMark('G6', 'A1')}
`)
  const stateOf = state => asSent({ ...build([stepItem(state)], undefined, GOALS), goalsEdit: { canWrite: true } })
  const page = await openPage({ state: stateOf('new'), hash: 'advice/goals/G6' })
  try {
    assert.equal(page.text('.goal-ask-step'), 'Step B88 made')
    assert.equal(page.find('.goal-ask-step a').getAttribute('href'), '#details=B88')
    assert.equal(page.all('[data-ask-action="step"]').length, 0)
    assert.deepEqual(page.sent('/api/goals'), [])
  } finally {
    await page.close()
  }
  const dropped = await openPage({ state: stateOf('dropped'), hash: 'advice/goals/G6' })
  try {
    assert.equal(dropped.all('.goal-ask-step').length, 0)
    assert.equal(dropped.all('[data-ask-action="step"]').length, 1)
  } finally {
    await dropped.close()
  }
})

test('the state wins over the page: after the call, a record without the step (dropped meanwhile) brings the button back, no "made" line from page memory', async () => {
  const answers = request => reply(request.url === '/api/goals' ? { step: 'B77', again: false } : {})
  const page = await openPage({ state: pageState(), answers, hash: 'advice/goals/G6' })
  try {
    await page.click('[data-ask-action="step"]')
    assert.deepEqual(page.sent('/api/goals').map(one => one.body.command), ['ask-step'])
    assert.equal(page.all('.goal-ask-step').length, 0, 'the state holds no step: no made line')
    assert.equal(page.all('[data-ask-action="step"]').length, 1)
  } finally {
    await page.close()
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// The real case (G12, A1, kept verbatim in test/fixtures/ask-step): a temp copy, the server's own route

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// A slice of the real goal map (G12 with its answered ask A1) and a minimal work store, committed: the test reads no real store.
const FIXTURE = join(ROOT, 'test', 'fixtures', 'ask-step', '.claude')
const COPIED = ['server.mjs', 'run-game.mjs', 'start-board.mjs', 'package.json', 'src', 'public', 'roles', 'examples', 'fixtures']

const freePort = () => new Promise(done => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => done(port))
  })
})

function run(started, board, env) {
  const child = spawn(process.execPath, [join(board, 'server.mjs')], { cwd: board, env: { ...process.env, CLAUDE_CONFIG_DIR: join(dirname(board), 'claude-config'), ...env, WORKER_BOARD_CHILD: '1' }, windowsHide: true })
  started.push(child)
  return new Promise((done, fail) => {
    let out = ''
    const late = setTimeout(() => fail(new Error(`The board did not start: ${out}`)), 90_000)
    const read = chunk => {
      out += chunk
      if (!/Worker board: http:\/\/127\.0\.0\.1:\d+\//.test(out)) return
      clearTimeout(late)
      done(child)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', code => {
      clearTimeout(late)
      fail(new Error(`The board ended (${code}): ${out}`))
    })
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise(done => child.once('exit', done))
  child.kill('SIGKILL')
  await gone
}

test('on a temp copy of the fixture (the real case G12 / A1): the route makes one step under the real goal, links it, makes no second, refuses the unknown, and no word goes to any chat', { timeout: 300_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'board-askstep-'))
  const started = []
  t.after(async () => {
    await Promise.all(started.map(stop))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const [board, project, app, transcripts] = ['board', 'project', 'app', 'transcripts'].map(name => join(dir, name))
  for (const part of COPIED) await cp(join(ROOT, part), join(board, part), { recursive: true })
  await cp(FIXTURE, join(project, '.claude'), { recursive: true })
  const goalsFile = join(project, '.claude', 'goals.md')
  // The real goal G12 with its real answered ask A1.
  const real = parseGoals(await readFile(goalsFile, 'utf8')).byId.get('G12')
  assert.equal(real.asks[0].id, 'A1')
  assert.ok(real.asks[0].answer !== null, 'the real G12 holds an answered ask')
  const stepsBefore = real.steps.length
  const port = await freePort()
  await mkdir(app, { recursive: true })
  await mkdir(transcripts, { recursive: true })
  await writeFile(join(board, 'config.json'), JSON.stringify({ name: 'askstep', project, port, gamePort: 7342, gameRepo: '', appSessions: app, transcripts, usageHistory: join(app, 'none.json') }))
  await run(started, board, { WORKER_BOARD_HOME: join(dir, 'pc') })
  const base = `http://127.0.0.1:${port}`
  const token = /[0-9a-f]{64}/.exec(await fetch(`${base}/`).then(r => r.text()))?.[0]
  assert.ok(token)
  const post = body => fetch(`${base}/api/goals`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, Origin: base }, body: JSON.stringify(body) })
  const outbox = () => readFile(join(board, 'data', 'outbox.jsonl'), 'utf8').catch(() => '')
  const outboxBefore = await outbox()
  const stepsOf = async () => parseGoals(await readFile(goalsFile, 'utf8')).byId.get('G12').steps

  const first = await post({ command: 'ask-step', id: 'G12', ask: 'A1' })
  assert.equal(first.status, 200, await first.clone().text())
  const { step, again } = await first.json()
  assert.match(step, /^B\d+$/)
  assert.equal(again, false)
  const file = await readFile(join(project, '.claude', 'work', `${step}.md`), 'utf8')
  assert.match(file, /^State: new$/m)
  assert.match(file, /^Goal: G12$/m)
  assert.match(file, /^Title: Nothing is left: all 37 steps are done and so are the eight parts/m)
  assert.ok(file.includes(real.asks[0].answer.text))
  assert.ok(file.includes(askStepMark('G12', 'A1')))
  assert.doesNotMatch(file, /^(Effort|Model)\b/m)
  assert.doesNotMatch(file, /^## (Effort|Model)/m)
  const linked = await stepsOf()
  assert.equal(linked.length, stepsBefore + 1)
  assert.equal(linked.at(-1), step)

  // A second click: the same step, no second one.
  const second = await post({ command: 'ask-step', id: 'G12', ask: 'A1' })
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), { step, again: true })
  assert.equal((await stepsOf()).length, stepsBefore + 1)

  // An unknown goal, an unknown ask: refused with a why, and nothing is linked.
  for (const body of [{ id: 'G9999', ask: 'A1' }, { id: 'G12', ask: 'A999' }]) {
    const refused = await post({ command: 'ask-step', ...body })
    assert.equal(refused.status, 404, JSON.stringify(body))
    assert.ok((await refused.text()).length > 0)
  }
  assert.equal((await stepsOf()).length, stepsBefore + 1)

  // No word to any chat: the outbox is as it was.
  assert.equal(await outbox(), outboxBefore)
})
