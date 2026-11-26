// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the big suite runs every test file of main when the PC is idle, at least
// every 4 hours and once each night; a red run names the go-lives since the last green one, the board files a fix step for it once, and
// its files run in the light check until two green runs in a row. src/bigSuite.mjs, src/bigSuitePass.mjs, tools/big-suite.mjs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  EVERY_MS, IDLE_LABEL, ORDINARY_LABEL, dueNow, fixStepOf, giveBackRunner, goLivesIn, labelFor, nightStart, readJson, recordRun, stateFiles,
  statusLines, touchRunner,
} from '../src/bigSuite.mjs'
import { bigSuitePass } from '../src/bigSuitePass.mjs'
import { STOPPED, playOnce, runner, stalledFiles, verdictOf } from '../tools/big-suite.mjs'
import * as tool from '../tools/one-at-a-time.mjs'

const HOUR = 60 * 60 * 1000
const local = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime()
const iso = ms => new Date(ms).toISOString()

test('S9: a big run is due at the night run (from 01:00, none started since), every 4 hours, or when main moved past the last run', () => {
  const now = local(26, 1, 30)
  assert.equal(nightStart(now), local(26, 1, 0))
  assert.equal(dueNow({ results: { lastStart: iso(local(25, 23)) }, mainHead: 'a', now }), 'the night run')
  const day = local(26, 14)
  assert.equal(dueNow({ results: { lastStart: iso(day - 3 * HOUR), last: { commit: 'a' } }, mainHead: 'a', now: day }), null)
  assert.equal(dueNow({ results: { lastStart: iso(day - 3 * HOUR), last: { commit: 'a' } }, mainHead: 'b', now: day }), 'main moved')
  assert.equal(dueNow({ results: { lastStart: iso(day - 3 * HOUR), last: { commit: 'a' }, lastTry: { commit: 'b' } }, mainHead: 'b', now: day }), null, 'a commit that could not run is not tried at every look')
  assert.equal(dueNow({ results: { lastStart: iso(day - 4 * HOUR), last: { commit: 'a' } }, mainHead: 'a', now: day }), 'every 4 hours')
  assert.equal(dueNow({ results: {}, mainHead: 'a', now: day }), 'no run yet')
})

test('S9: a run waits for an idle PC until 4 hours after the last one, or 05:00 for the night run; past that it is an ordinary run', () => {
  const day = local(26, 14)
  assert.deepEqual(labelFor({ results: { last: { at: iso(day - HOUR) }, lastStart: iso(day - HOUR) }, now: day }), { label: IDLE_LABEL, idleUntil: day + 3 * HOUR })
  assert.equal(labelFor({ results: { last: { at: iso(day - 5 * HOUR) }, lastStart: iso(day - 5 * HOUR) }, now: day }).label, ORDINARY_LABEL)
  assert.equal(labelFor({ results: {}, now: day }).label, ORDINARY_LABEL, 'no run yet: no waiting')
  const night = local(26, 2)
  const atNight = labelFor({ results: { last: { at: iso(night - HOUR) }, lastStart: iso(local(25, 22)) }, now: night })
  assert.deepEqual(atNight, { label: IDLE_LABEL, idleUntil: local(26, 5) })
  assert.equal(labelFor({ results: { last: { at: iso(local(26, 4, 30)) }, lastStart: iso(local(25, 22)) }, now: local(26, 5, 30) }).label, ORDINARY_LABEL)
  assert.equal(EVERY_MS, 4 * HOUR)
})

test('S9: a red run puts its files on probation; two green runs in a row take a file off; a run that could not run keeps the last result', () => {
  const red = recordRun({ lastGreen: 'g1' }, { commit: 'r1', outcome: 'failed', at: iso(1), seconds: 9, failed: ['test/a.test.mjs'] })
  assert.equal(red.last.outcome, 'failed')
  assert.equal(red.redSince, 'r1')
  assert.deepEqual(Object.keys(red.probation), ['test/a.test.mjs'])
  const green1 = recordRun(red, { commit: 'g2', outcome: 'passed', at: iso(2), seconds: 9 })
  assert.equal(green1.probation['test/a.test.mjs'].greens, 1)
  assert.equal(green1.lastGreen, 'g2')
  assert.equal(green1.redSince, null)
  const green2 = recordRun(green1, { commit: 'g3', outcome: 'passed', at: iso(3), seconds: 9 })
  assert.deepEqual(green2.probation, {})
  const notRun = recordRun(green1, { commit: 'x', outcome: 'could not run', at: iso(4), seconds: 1, why: 'stopped' })
  assert.equal(notRun.last.commit, 'g2')
  assert.equal(notRun.lastTry.commit, 'x')
  assert.equal(notRun.lastStart, iso(4))
  assert.match(statusLines(notRun).join('\n'), /could not run main at x \(stopped\)/)
  assert.match(statusLines(red).join('\n'), /^big suite: RED on main at r1 \(last green: g1\): test\/a\.test\.mjs$/m)
  assert.match(statusLines(red).join('\n'), /on probation in the light check: test\/a\.test\.mjs/)
  assert.deepEqual(statusLines(green2), [])
})

test('S9: a red run names the go-lives since the last green run, and its fix step says the files, the go-lives and the log', () => {
  const landings = [
    { result: 'landed', branch: 'b1-old', by: 'Worker 1', after: 'c1' },
    { result: 'refused', branch: 'b2-no', by: 'Worker 2', after: null },
    { result: 'landed', branch: 'b3-new', by: 'Worker 3', after: 'c3' },
    { result: 'landed', branch: 'b4-new', by: 'chat 2', after: 'c4' },
  ]
  const goLives = goLivesIn(landings, new Set(['c3', 'c4', 'cx']))
  assert.deepEqual(goLives.map(one => one.branch), ['b3-new', 'b4-new'])
  const step = fixStepOf({ run: { commit: 'c4abcdef', failed: ['test/a.test.mjs'] }, lastGreen: 'c1abcdef', goLives, log: 'L' })
  assert.equal(step.title, 'Big suite red on main at c4abcde: 1 test file(s) fail')
  assert.match(step.text.join('\n'), /Failing files: test\/a\.test\.mjs\./)
  assert.match(step.text.join('\n'), /Go-lives since the last green run \(c1abcde\): b3-new \(Worker 3, c3\); b4-new \(chat 2, c4\)\./)
  assert.match(step.text.join('\n'), /Log: L$/m)
})

test('S9: a big run\'s verdict: stopped at the hold cap is "could not run", never red; a stall is red with its open files; the failing files named', () => {
  assert.deepEqual(verdictOf('ℹ tests 3\nℹ fail 0\n', 0), { outcome: 'passed', failed: [], why: null })
  assert.equal(verdictOf('anything', STOPPED).outcome, 'could not run')
  assert.equal(verdictOf('one-at-a-time: idle:big-suite ran longer than 120 minutes and was stopped\n', 1).outcome, 'could not run')
  const failed = verdictOf('✖ failing tests:\ntest at test/a.test.mjs:3:1\nℹ tests 3\nℹ fail 1\n', 1)
  assert.deepEqual([failed.outcome, failed.failed], ['failed', ['test/a.test.mjs']])
  const stall = 'stalled: no test output for 15 minutes; files still open: test/b.test.mjs (waits), test/c.test.mjs (x)'
  assert.deepEqual(stalledFiles(stall), ['test/b.test.mjs', 'test/c.test.mjs'])
  assert.deepEqual(verdictOf(`${stall}\n`, 1).failed, ['test/b.test.mjs', 'test/c.test.mjs'])
  assert.equal(verdictOf('could not start\n', 127).outcome, 'could not run')
})

const world = () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'big-suite-'))
  const lock = join(dir, 'heavy.lock')
  return { dir, lock, files: stateFiles(lock) }
}
const fakeSteps = (calls, over = {}) => ({
  mainHead: () => 'c1abcdef0000',
  prepare: (folder, commit) => calls.push(`prepare ${commit}`),
  run: async (folder, label) => { calls.push(`run ${label}`); return { code: 0, output: 'ℹ tests 1\nℹ fail 0\n' } },
  cleanUp: () => calls.push('cleanUp'),
  ...over,
})

test('S9: one big run plays main\'s head, records it, cleans up; a runner whose file another took over keeps its hands off; an idle run past its time is started anew as ordinary', async () => {
  const { dir, files } = world()
  try {
    writeFileSync(files.runner, JSON.stringify({ pid: process.pid, startedAt: iso(Date.now() - 5 * HOUR) }))
    const calls = []
    const run = await playOnce({ files, steps: fakeSteps(calls) })
    assert.equal(run.outcome, 'passed')
    assert.deepEqual(calls, ['prepare c1abcdef0000', `run ${ORDINARY_LABEL}`, 'cleanUp'])
    assert.equal(readJson(files.results).last.commit, 'c1abcdef0000')
    // taken over during the run: no result, no clean-up, the other runner keeps its file
    rmSync(files.results)
    const taken = { pid: process.pid + 1, startedAt: iso(Date.now()) }
    const calls2 = []
    const lost = await playOnce({ files, steps: fakeSteps(calls2, { run: async () => { writeFileSync(files.runner, JSON.stringify(taken)); return { code: 0, output: 'ℹ fail 0\n' } } }) })
    assert.equal(lost, null)
    assert.deepEqual(readJson(files.results), {})
    assert.ok(!calls2.includes('cleanUp'))
    assert.equal(giveBackRunner(files.runner), false)
    assert.deepEqual(readJson(files.runner), taken)
    // an idle run still waiting past its time: started anew as an ordinary run
    writeFileSync(files.runner, JSON.stringify({ pid: process.pid, startedAt: iso(Date.now()) }))
    writeJson(files.results, { last: { at: iso(Date.now() - HOUR), commit: 'c0' }, lastStart: iso(Date.now() - HOUR) })
    const labels = []
    let clock = Date.now()
    const upgraded = await playOnce({
      files, now: () => clock,
      steps: fakeSteps([], {
        run: async (folder, label, { upgrade }) => {
          labels.push(label)
          if (label === IDLE_LABEL) {
            clock += 4 * HOUR
            assert.equal(upgrade(), true)
            return { code: null, output: '', upgraded: true }
          }
          return { code: 0, output: 'ℹ fail 0\n' }
        },
      }),
    })
    assert.deepEqual(labels, [IDLE_LABEL, ORDINARY_LABEL])
    assert.equal(upgraded.label, ORDINARY_LABEL)
    assert.equal(touchRunner(files.runner), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value))
}

test('S9: runner() leaves a runner past 3 hours alone while its big run waits in the idle room', async () => {
  const { dir, lock, files } = world()
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
  const was = os.getPriority(0)
  try {
    const old = { pid: sleeper.pid, startedAt: iso(Date.now() - 4 * HOUR) }
    writeFileSync(files.runner, JSON.stringify(old))
    mkdirSync(tool.idleRoomOf(lock))
    writeFileSync(join(tool.idleRoomOf(lock), `000000000000001-${String(sleeper.pid).padStart(8, '0')}.json`), JSON.stringify({ pid: sleeper.pid, label: IDLE_LABEL, cwd: join(os.tmpdir(), 'board-big-suite-c1abcdef0'), startedAt: iso(Date.now()), idle: true, order: 2, beat: iso(Date.now()) }))
    const calls = []
    assert.equal(await runner('C:/not-a-repo', { ...process.env, HEAVY_RUN_LOCK: lock }, fakeSteps(calls)), null)
    assert.deepEqual(calls, [])
    assert.deepEqual(readJson(files.runner), old)
  } finally {
    try { os.setPriority(0, was) } catch { /* keeps it */ }
    sleeper.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: the board\'s pass files a red run\'s fix step once, as a board fix with its go-lives, and starts a run only when one is due and no runner lives', async () => {
  const { dir, lock, files } = world()
  try {
    const landings = join(dir, 'landings.jsonl')
    writeFileSync(landings, [{ result: 'landed', branch: 'b9-x', by: 'Worker 9', after: 'c2' }].map(one => JSON.stringify(one)).join('\n'))
    const filed = join(dir, 'filed.json')
    writeFileSync(files.results, JSON.stringify(recordRun({ lastGreen: 'c1' }, { commit: 'c2', outcome: 'failed', at: iso(Date.now()), seconds: 9, failed: ['test/a.test.mjs'] })))
    const made = []
    const started = []
    const pass = () => bigSuitePass({
      lock, tool, landings, filed, mainHead: async () => 'c2', commitsBetween: async (from, to) => new Set(from === 'c1' && to === 'c2' ? ['c2'] : []),
      start: () => started.push(1), make: async call => { made.push(call); return { ok: true, result: { id: 'B900' } } },
      read: async () => ({ items: new Map(), activities: [{ name: 'Board' }] }),
    })
    const first = await pass()
    assert.equal(first.filed, 'B900')
    assert.equal(made.length, 1)
    assert.equal(made[0].priority, 'fix')
    assert.equal(made[0].activity, 'Board')
    assert.match(made[0].text.join('\n'), /b9-x \(Worker 9, c2\)/)
    assert.match(made[0].text.join('\n'), /Filed by the board itself/)
    assert.equal(readJson(filed).c2.id, 'B900')
    assert.equal(first.started, null, 'just ran on c2: nothing due')
    await pass()
    assert.equal(made.length, 1, 'filed once')
    // 4 hours later a run is due: started, unless a runner lives
    writeFileSync(files.results, JSON.stringify({ ...readJson(files.results), lastStart: iso(Date.now() - 5 * HOUR) }))
    assert.equal((await pass()).started, 'every 4 hours')
    writeFileSync(files.runner, JSON.stringify({ pid: process.pid, startedAt: iso(Date.now()) }))
    assert.equal((await pass()).started, null)
    assert.equal(started.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: the board starts the big suite only on the PC\'s first board, and land.ps1 says its word at the gate\'s start', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const runsBigSuite = !isDemo && !isShowOnly && historyFrom === undefined\s*&& \(config\.bigSuite \?\? \(firstBoard !== null/)
  assert.match(server, /setInterval\(lookAtBigSuite, BIG_SUITE_LOOK_MS\)/)
  const land = readFileSync(new URL('../tools/land.ps1', import.meta.url), 'utf8')
  assert.match(land, /\$bigTool = Join-Path \$mainDir 'tools\\big-suite\.mjs'/)
  assert.match(land, /Invoke-Native 'node' @\(\$bigTool, '--status', '--quiet'\)/)
})
