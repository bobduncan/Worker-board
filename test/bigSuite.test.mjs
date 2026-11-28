// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the big suite runs every test file of main when the PC is idle, at least
// every 4 hours and once each night; a red run names the go-lives since the last green one, the board files a fix step for it once, and
// its files run in the light check until two green runs in a row. src/bigSuite.mjs, src/bigSuitePass.mjs, tools/big-suite.mjs.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EVERY_MS, GO_LIVES_NAMED, IDLE_LABEL, ORDINARY_LABEL, SETTLE_MS, STALE_MS, bigRunQueued, dueNow, fixStepOf, giveBackRunner, goLivesIn, labelFor, nightStart,
  readJson, recordRun, stateFiles, statusLines, touchRunner,
} from '../src/bigSuite.mjs'
import { BIG_SUITE_STALE_MS, NOT_RUN_STEP_AFTER, RETRY_MS, bigSuitePass, owedOf } from '../src/bigSuitePass.mjs'
import { RERUNS_MAX, RERUN_LABEL, RUNS_NOW, STOPPED, bigSuiteSteps, playOnce, repoTestPath, runner, slotRun, stalledFiles, testedCommit, verdictOf, waitsInRoom } from '../tools/big-suite.mjs'
import * as tool from '../tools/one-at-a-time.mjs'

const HOUR = 60 * 60 * 1000
const local = (day, hours, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime()
const iso = ms => new Date(ms).toISOString()
const HELPER = fileURLToPath(new URL('../tools/one-at-a-time.mjs', import.meta.url))

test('S9: a big run is due with no run yet, at the night run (from 01:00, none started since), and an hour after the last start while main moved or the last run was not green', () => {
  const now = local(26, 1, 30)
  assert.equal(nightStart(now), local(26, 1, 0))
  assert.equal(dueNow({ results: { lastStart: iso(local(25, 23)), last: { commit: 'a', outcome: 'passed' } }, mainHead: 'a', now }), 'the night run')
  const day = local(26, 14)
  const green = { commit: 'a', outcome: 'passed' }
  assert.equal(dueNow({ results: { lastStart: iso(day - 30 * 60000), last: green }, mainHead: 'b', now: day }), null, 'main moved half an hour after the last start: not yet (no run after every landing)')
  assert.equal(dueNow({ results: { lastStart: iso(day - HOUR), last: green }, mainHead: 'b', now: day }), 'main moved')
  assert.equal(dueNow({ results: { lastStart: iso(day - 4 * HOUR), last: green }, mainHead: 'b', now: day }), 'every 4 hours')
  assert.equal(dueNow({ results: { lastStart: iso(day - 5 * HOUR), last: green }, mainHead: 'a', now: day }), null, 'nothing new and green: no run')
  assert.equal(dueNow({ results: { lastStart: iso(day - 2 * HOUR), last: { commit: 'a', outcome: 'failed' } }, mainHead: 'a', now: day }), 'main moved', 'a red last run is run again')
  assert.equal(dueNow({ results: {}, mainHead: 'a', now: day }), 'no run yet')
  assert.equal(SETTLE_MS, HOUR)
})

test('S9: a run waits for an idle PC until 4 hours after the last start (the night run until 05:00); past that, and with no run yet, it is ordinary', () => {
  const day = local(26, 14)
  assert.deepEqual(labelFor({ results: { lastStart: iso(day - HOUR) }, now: day }), { label: IDLE_LABEL, idleUntil: day + 3 * HOUR }, 'a daytime run waits for an idle PC (core review)')
  assert.equal(labelFor({ results: { lastStart: iso(day - 5 * HOUR) }, now: day }).label, ORDINARY_LABEL)
  assert.equal(labelFor({ results: {}, now: day }).label, ORDINARY_LABEL, 'no run yet: no waiting')
  const night = local(26, 2)
  assert.deepEqual(labelFor({ results: { lastStart: iso(local(25, 22)) }, now: night }), { label: ORDINARY_LABEL, idleUntil: local(26, 2) }, 'the 4 hours since 22:00 ended at 02:00, before 05:00')
  assert.deepEqual(labelFor({ results: { lastStart: iso(local(26, 0, 30)) }, now: local(26, 1, 30) }), { label: IDLE_LABEL, idleUntil: local(26, 4, 30) })
  assert.deepEqual(labelFor({ results: { lastStart: iso(local(25, 23, 30)) }, now: local(26, 1, 30) }), { label: IDLE_LABEL, idleUntil: local(26, 3, 30) })
  assert.equal(labelFor({ results: { lastStart: iso(local(25, 23)) }, now: local(26, 5, 30) }).label, ORDINARY_LABEL)
  assert.equal(EVERY_MS, 4 * HOUR)
})

test('S9: a red run puts its files on probation and starts every count anew; two green runs in a row take a file off; a run that could not run keeps the last result', () => {
  const red = recordRun({ lastGreen: 'g1' }, { commit: 'r1', outcome: 'failed', at: iso(local(26, 10)), seconds: 9, failed: ['test/a.test.mjs'] })
  assert.equal(red.last.outcome, 'failed')
  assert.equal(red.redSince, 'r1')
  assert.deepEqual(Object.keys(red.probation), ['test/a.test.mjs'])
  const green1 = recordRun(red, { commit: 'g2', outcome: 'passed', at: iso(local(26, 11)), seconds: 9 })
  assert.equal(green1.probation['test/a.test.mjs'].greens, 1)
  assert.equal(green1.lastGreen, 'g2')
  assert.equal(green1.lastGreenAt, iso(local(26, 11)))
  assert.equal(green1.redSince, null)
  // a red run of another file breaks "in a row": the count starts anew
  const red2 = recordRun(green1, { commit: 'r2', outcome: 'failed', at: iso(local(26, 12)), seconds: 9, failed: ['test/b.test.mjs'] })
  assert.deepEqual(Object.fromEntries(Object.entries(red2.probation).map(([file, held]) => [file, held.greens])), { 'test/a.test.mjs': 0, 'test/b.test.mjs': 0 })
  const twice = recordRun(recordRun(red2, { commit: 'g3', outcome: 'passed', at: iso(local(26, 13)) }), { commit: 'g4', outcome: 'passed', at: iso(local(26, 14)) })
  assert.deepEqual(twice.probation, {})
  const notRun = recordRun(green1, { commit: 'x', outcome: 'could not run', at: iso(local(26, 12)), seconds: 1, why: 'stopped' })
  assert.equal(notRun.last.commit, 'g2')
  assert.equal(notRun.lastTry.commit, 'x')
  assert.equal(notRun.lastStart, iso(local(26, 12)))
})

test('S9: a gate hears of a red run, the probation, a run that could not run (also read back from the file) and a big suite with no green run for 8 hours', () => {
  const now = local(26, 15)
  const red = recordRun({ lastGreen: 'g1', lastGreenAt: iso(now - HOUR) }, { commit: 'r1', outcome: 'failed', at: iso(now - 30 * 60000), failed: ['test/a.test.mjs'] })
  assert.match(statusLines(red, now).join('\n'), /^big suite: RED on main at r1 \(last green: g1\): test\/a\.test\.mjs$/m)
  assert.match(statusLines(red, now).join('\n'), /on probation in the light check: test\/a\.test\.mjs/)
  const dir = mkdtempSync(join(os.tmpdir(), 'big-status-'))
  try {
    const file = join(dir, 'results.json')
    writeFileSync(file, JSON.stringify(recordRun({ ...red, lastGreenAt: iso(now - HOUR) }, { commit: 'x', outcome: 'could not run', at: iso(now), why: 'stopped' })))
    assert.match(statusLines(readJson(file), now).join('\n'), /could not run main at x \(stopped\)/, 'read back from the file, not the same object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const green = recordRun({}, { commit: 'g', outcome: 'passed', at: iso(now - HOUR) })
  assert.deepEqual(statusLines(green, now), [])
  assert.match(statusLines(green, now - HOUR + STALE_MS + HOUR).join('\n'), /^big suite: no green run for 9 hours; the light checks leave the slow test files to it$/m)
  assert.match(statusLines({}, now).join('\n'), /^big suite: no run yet; /m)
  assert.equal(STALE_MS, 8 * HOUR)
})

test('S9: a red run names the go-lives since the last green run (at most 20), and its fix step says the files, the flaky ones, the go-lives and the run in the log', () => {
  const landings = [
    { result: 'landed', branch: 'b1-old', by: 'Worker 1', after: 'c1' },
    { result: 'refused', branch: 'b2-no', by: 'Worker 2', after: 'c3' },
    { result: 'landed', branch: 'b3-new', by: 'Worker 3', after: 'c3' },
    { result: 'landed', branch: 'b4-new', by: 'chat 2', after: 'c4' },
  ]
  const goLives = goLivesIn(landings, new Set(['c3', 'c4', 'cx']))
  assert.deepEqual(goLives.map(one => one.branch), ['b3-new', 'b4-new'])
  const step = fixStepOf({ run: { commit: 'c4abcdef', failed: ['test/a.test.mjs'], flaky: ['test/z.test.mjs'], at: 'T' }, lastGreen: 'c1abcdef', goLives, log: 'L' })
  assert.equal(step.title, 'Big suite red on main at c4abcde: 1 test file(s) fail')
  const text = step.text.join('\n')
  assert.match(text, /each failing file failed again when run alone/)
  assert.match(text, /Failing files: test\/a\.test\.mjs\./)
  assert.match(text, /Passed alone \(not counted\): test\/z\.test\.mjs\./)
  assert.match(text, /Go-lives since the last green run \(c1abcde\): b3-new \(Worker 3, c3\); b4-new \(chat 2, c4\)\./)
  assert.match(text, /Log: L, the run of T\.$/m)
  const many = Array.from({ length: 30 }, (_, i) => ({ result: 'landed', branch: `b${i}`, by: 'W', after: `c${i}` }))
  const first = fixStepOf({ run: { commit: 'c9', failed: [], at: 'T' }, lastGreen: null, goLives: many, log: 'L' }).text.join('\n')
  assert.match(first, /Go-lives with no green run before it: b10 \(W, c10\);.* \(and 10 older\)\./)
  assert.equal(GO_LIVES_NAMED, 20)
})

test('S9, core review: a failing file is a repository path whatever node printed: backslashes on Windows, a whole path in the run\'s worktree', () => {
  const folder = 'C:\\Users\\x\\AppData\\Local\\Temp\\board-big-suite-abc'
  assert.equal(repoTestPath('test\\carryTwoPc.test.mjs'), 'test/carryTwoPc.test.mjs')
  assert.equal(repoTestPath(`${folder}\\test\\work\\lists.test.mjs`, folder), 'test/work/lists.test.mjs')
  assert.equal(repoTestPath('C:/Elsewhere/test/a.test.mjs'), 'test/a.test.mjs')
  const output = `✖ failing tests:\ntest at test\\carryTwoPc.test.mjs:219:1\n  location: '${folder}\\test\\work\\lists.test.mjs:3:1'\nℹ tests 3\nℹ fail 2\n`
  assert.deepEqual(verdictOf(output, 1, folder).failed, ['test/carryTwoPc.test.mjs', 'test/work/lists.test.mjs'])
  // and the light check finds it on probation (the real b1277 shape)
  const results = recordRun({}, { commit: 'c', outcome: 'failed', at: iso(1), failed: verdictOf(output, 1, folder).failed })
  assert.ok(results.probation['test/carryTwoPc.test.mjs'] !== undefined)
})

test('S9: a big run\'s verdict: stopped at the hold cap is "could not run", never red; a stall is red with its open files; the failing files named', () => {
  assert.deepEqual(verdictOf('ℹ tests 3\nℹ fail 0\n', 0), { outcome: 'passed', failed: [], why: null })
  assert.equal(verdictOf('anything', STOPPED).outcome, 'could not run')
  assert.equal(verdictOf('one-at-a-time: idle:big-suite ran longer than 120 minutes and was stopped\n', 1).outcome, 'could not run')
  const failed = verdictOf('✖ failing tests:\ntest at test/a.test.mjs:3:1\nℹ tests 3\nℹ fail 1\n', 1)
  assert.deepEqual([failed.outcome, failed.failed], ['failed', ['test/a.test.mjs']])
  const stall = 'stalled: no test output for 15 minutes; files still open: test/b.test.mjs (waits), test\\c.test.mjs (x)'
  assert.deepEqual(stalledFiles(stall), ['test/b.test.mjs', 'test/c.test.mjs'])
  assert.deepEqual(verdictOf(`${stall}\n`, 1).failed, ['test/b.test.mjs', 'test/c.test.mjs'])
  // B1575: the files that failed before the stall are named apart, never the open ones twice.
  const before = verdictOf(`${stall}\nfailed before the stall: test/a.test.mjs, test/b.test.mjs\n`, 1)
  assert.deepEqual([before.failed, before.stalled, before.before], [['test/b.test.mjs', 'test/c.test.mjs', 'test/a.test.mjs'], ['test/b.test.mjs', 'test/c.test.mjs'], ['test/a.test.mjs']])
  assert.equal(verdictOf('could not start\n', 127).outcome, 'could not run')
})

const world = () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'big-suite-'))
  const lock = join(dir, 'heavy.lock')
  return { dir, lock, files: stateFiles(lock) }
}
// B1573: a big run says the commit it tested once it has its slot (the fakes test main's head, c1abcdef0000).
const TESTED = 'big suite: tests main at c1abcdef0000\n'
const GREEN = `${TESTED}ℹ tests 1\nℹ fail 0\n`
const red = (...files) => `${TESTED}✖ failing tests:\n${files.map(file => `test at ${file}:1:1`).join('\n')}\nℹ tests 9\nℹ fail ${files.length}\n`
const fakeSteps = (calls, over = {}) => ({
  mainHead: () => 'c1abcdef0000',
  prepare: (folder, commit) => calls.push(`prepare ${commit}`),
  run: async (folder, label, { only = [] } = {}) => { calls.push(`run ${label}${only.length > 0 ? ` ${only.join(' ')}` : ''}`); return { code: 0, output: GREEN } },
  cleanUp: () => calls.push('cleanUp'),
  ...over,
})
const ours = (files, startedAt = Date.now()) => writeFileSync(files.runner, JSON.stringify({ pid: process.pid, startedAt: iso(startedAt) }))

test('S9: one big run plays main\'s head, records it and cleans up; an idle run still waiting past its time is started anew as ordinary', async () => {
  const { dir, files } = world()
  try {
    ours(files, Date.now() - 5 * HOUR)
    const calls = []
    const run = await playOnce({ files, steps: fakeSteps(calls) })
    assert.equal(run.outcome, 'passed')
    assert.deepEqual(calls, ['prepare c1abcdef0000', `run ${ORDINARY_LABEL}`, 'cleanUp'])
    assert.equal(readJson(files.results).last.commit, 'c1abcdef0000')
    writeFileSync(files.results, JSON.stringify({ last: { at: iso(Date.now() - HOUR), commit: 'c0' }, lastStart: iso(Date.now() - HOUR) }))
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
          return { code: 0, output: GREEN }
        },
      }),
    })
    assert.deepEqual(labels, [IDLE_LABEL, ORDINARY_LABEL])
    assert.equal(upgraded.label, ORDINARY_LABEL)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, core review: each failing file runs again alone once; one that passes alone is flaky (no red), one that fails again is red', async () => {
  const { dir, files } = world()
  try {
    ours(files)
    const calls = []
    const steps = fakeSteps(calls, {
      run: async (folder, label, { only = [] } = {}) => {
        calls.push(`run ${label}${only.length > 0 ? ` ${only.join(' ')}` : ''}`)
        if (only.length === 0) return { code: 1, output: red('test\\flaky.test.mjs', 'test/broken.test.mjs') }
        return only[0] === 'test/flaky.test.mjs' ? { code: 0, output: GREEN } : { code: 1, output: red('test/broken.test.mjs') }
      },
    })
    const run = await playOnce({ files, steps })
    assert.deepEqual(calls, ['prepare c1abcdef0000', `run ${ORDINARY_LABEL}`, `run ${RERUN_LABEL} test/flaky.test.mjs`, `run ${RERUN_LABEL} test/broken.test.mjs`, 'cleanUp'])
    assert.deepEqual([run.outcome, run.failed, run.flaky], ['failed', ['test/broken.test.mjs'], ['test/flaky.test.mjs']])
    assert.deepEqual(Object.keys(readJson(files.results).probation), ['test/broken.test.mjs'])
    // all of them pass alone: green, with the flaky ones said
    const calm = await playOnce({ files, steps: fakeSteps([], { run: async (folder, label, { only = [] } = {}) => (only.length === 0 ? { code: 1, output: red('test/a.test.mjs') } : { code: 0, output: GREEN }) }) })
    assert.deepEqual([calm.outcome, calm.flaky], ['passed', ['test/a.test.mjs']])
    assert.match(calm.why, /1 file\(s\) failed in the full run and passed alone/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// B1575, the real case: the big run of 2093e58 (2026-11-27, 15:42) stalled with landScript.test.mjs open at its top level after the
// carry, F24b and sweep files had failed; it reran nothing, so those were hidden. Mutants: the stall kept out of the rerun (old
// `!verdict.stalled`), the open file rerun too, a stall whose reruns all pass counted green, `stalled` dropped from the record.
test('B1575: a stalled big run reruns alone the files that failed before the stall; the open ones stay red, not rerun, kept apart in the record', async () => {
  const { dir, files } = world()
  try {
    ours(files)
    const stall = (open, before) => `${TESTED}✖ a set of 5,200 files (247769.3128ms)\n\nstalled: no test output for 15 minutes; files still open: ${open}\n${before ? `failed before the stall: ${before}\n` : ''}`
    const calls = []
    const steps = fakeSteps(calls, {
      run: async (folder, label, { only = [] } = {}) => {
        calls.push(`run ${label}${only.length > 0 ? ` ${only.join(' ')}` : ''}`)
        if (only.length === 0) return { code: 1, output: stall('test/landScript.test.mjs (at its top level)', 'test/carryGit.test.mjs, test\\cpuStartIdle.test.mjs, test/landScript.test.mjs') }
        return only[0] === 'test/carryGit.test.mjs' ? { code: 0, output: GREEN } : { code: 1, output: red(only[0]) }
      },
    })
    const run = await playOnce({ files, steps })
    assert.deepEqual(calls, ['prepare c1abcdef0000', `run ${ORDINARY_LABEL}`, `run ${RERUN_LABEL} test/carryGit.test.mjs`, `run ${RERUN_LABEL} test/cpuStartIdle.test.mjs`, 'cleanUp'])
    assert.deepEqual([run.outcome, run.failed, run.flaky, run.stalled], ['failed', ['test/landScript.test.mjs', 'test/cpuStartIdle.test.mjs'], ['test/carryGit.test.mjs'], ['test/landScript.test.mjs']])
    assert.equal(run.before, undefined, 'the rerun list is no part of the record')
    const last = readJson(files.results).last
    assert.deepEqual([last.failed, last.stalled, last.flaky], [run.failed, ['test/landScript.test.mjs'], ['test/carryGit.test.mjs']])
    assert.deepEqual(Object.keys(readJson(files.results).probation).sort(), ['test/cpuStartIdle.test.mjs', 'test/landScript.test.mjs'])
    // Every file rerun passes: a stall is still red, with its open file.
    const still = await playOnce({ files, steps: fakeSteps([], { run: async (folder, label, { only = [] } = {}) => (only.length === 0 ? { code: 1, output: stall('test/landScript.test.mjs (at its top level)', 'test/carryGit.test.mjs') } : { code: 0, output: GREEN }) }) })
    assert.deepEqual([still.outcome, still.failed, still.flaky], ['failed', ['test/landScript.test.mjs'], ['test/carryGit.test.mjs']])
    // A stall that named no open file and whose reruns pass is red too (with no file to put on probation).
    const blind = await playOnce({ files, steps: fakeSteps([], { run: async (folder, label, { only = [] } = {}) => (only.length === 0 ? { code: 1, output: stall('none named', 'test/carryGit.test.mjs') } : { code: 0, output: GREEN }) }) })
    assert.deepEqual([blind.outcome, blind.failed, blind.stalled], ['failed', [], []])
    // A stall with nothing failed before it: no rerun at all.
    const lone = []
    const quiet = await playOnce({ files, steps: fakeSteps(lone, { run: async (folder, label, { only = [] } = {}) => { lone.push(only.join(' ')); return { code: 1, output: stall('test/landScript.test.mjs (at its top level)', null) } } }) })
    assert.deepEqual([quiet.outcome, quiet.failed, lone], ['failed', ['test/landScript.test.mjs'], ['prepare c1abcdef0000', '', 'cleanUp']])
    // Chat 1's review: a rerun that could not run (the hold cap) after a stall stays red; the stall is no "could not run" and its
    // open file goes on probation (mutant: the throw kept for stalls).
    writeFileSync(files.results, JSON.stringify({ last: { commit: 'c0', outcome: 'passed', at: iso(Date.now() - HOUR) }, lastGreen: 'c0' }))
    const capped = await playOnce({ files, steps: fakeSteps([], { run: async (folder, label, { only = [] } = {}) => (only.length === 0 ? { code: 1, output: stall('test/landScript.test.mjs (at its top level)', 'test/carryGit.test.mjs') } : { code: STOPPED, output: '' }) }) })
    assert.deepEqual([capped.outcome, capped.failed], ['failed', ['test/landScript.test.mjs', 'test/carryGit.test.mjs']])
    const after = readJson(files.results)
    assert.deepEqual([after.last.outcome, Object.keys(after.probation).sort()], ['failed', ['test/carryGit.test.mjs', 'test/landScript.test.mjs']])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B1575: the fix step of a stalled run says per file whether it was rerun: left open (not rerun), or failed again alone', () => {
  const both = fixStepOf({ run: { commit: 'c4abcdef', failed: ['test/landScript.test.mjs', 'test/a.test.mjs'], stalled: ['test/landScript.test.mjs'], at: 'T' }, lastGreen: null, goLives: [], log: 'L' }).text
  assert.match(both[0], /failed on main at c4abcde, in a run that stalled: the files it left open were not rerun, the others failed again when run alone\./)
  assert.ok(both.includes('Left open in a stalled run (not rerun): test/landScript.test.mjs.'), both.join('\n'))
  assert.ok(both.includes('Failed again when run alone: test/a.test.mjs.'), both.join('\n'))
  // The board files only the files no open step names (bigSuitePass): the stalled file alone.
  const open = fixStepOf({ run: { commit: 'c4abcdef', failed: ['test/landScript.test.mjs'], stalled: ['test/landScript.test.mjs', 'test/b.test.mjs'], at: 'T' }, lastGreen: null, goLives: [], log: 'L' }).text
  assert.match(open[0], /in a run that stalled: the files it left open were not rerun\./)
  assert.ok(open.includes('Left open in a stalled run (not rerun): test/landScript.test.mjs.'))
  assert.ok(!open.some(line => line.startsWith('Failed again when run alone')))
  // A stall that named no open file says it stalled (chat 1's nit).
  const blind = fixStepOf({ run: { commit: 'c4abcdef', failed: [], stalled: [], why: 'the test run stalled (stalled: no test output for 15 minutes; files still open: none named)', at: 'T' }, lastGreen: null, goLives: [], log: 'L' }).text
  assert.match(blind[0], /in a run that stalled with no open file named \(see the log\)\./)
  // No stall: the line as before.
  const plain = fixStepOf({ run: { commit: 'c4abcdef', failed: ['test/a.test.mjs'], at: 'T' }, lastGreen: null, goLives: [], log: 'L' }).text
  assert.match(plain[0], /failed on main at c4abcde, and each failing file failed again when run alone\./)
  assert.ok(!plain.some(line => /stalled run/.test(line)))
})

test('S9: a runner whose file another took over keeps its hands off: at every phase it stops, records nothing, and removes its folder only when the new runner plays another commit', async () => {
  const { dir, files } = world()
  const taken = { pid: process.pid + 1, startedAt: iso(Date.now()) }
  const take = () => writeFileSync(files.runner, JSON.stringify(taken))
  const cases = [
    ['during prepare', { prepare: (folder, commit, calls) => { calls.push('prepare'); take() } }, ['prepare']],
    ['during the run', { run: async (folder, label, opts, calls) => { calls.push('run'); take(); return { code: 0, output: GREEN } } }, ['prepare', 'run']],
    ['during the rerun alone', {
      run: async (folder, label, { only = [] } = {}, calls) => {
        calls.push(only.length === 0 ? 'run' : 'rerun')
        if (only.length === 0) return { code: 1, output: red('test/a.test.mjs', 'test/b.test.mjs') }
        take()
        return { code: 1, output: red(only[0]) }
      },
    }, ['prepare', 'run', 'rerun']],
  ]
  try {
    for (const [name, over, want] of cases) {
      for (const mainMoved of [false, true]) {
        ours(files)
        rmSync(files.results, { force: true })
        const calls = []
        const steps = fakeSteps(calls, {
          mainHead: (() => { let n = 0; return () => (n++ === 0 || !mainMoved ? 'c1abcdef0000' : 'c2abcdef0000') })(),
          prepare: over.prepare ? (folder, commit) => over.prepare(folder, commit, calls) : () => calls.push('prepare'),
          ...(over.run ? { run: (folder, label, opts) => over.run(folder, label, opts, calls) } : { run: async () => { calls.push('run'); return { code: 0, output: GREEN } } }),
        })
        assert.equal(await playOnce({ files, steps }), null, name)
        assert.deepEqual(calls, mainMoved ? [...want, 'cleanUp'] : want, `${name}, main ${mainMoved ? 'moved' : 'the same'}`)
        assert.deepEqual(readJson(files.results), {}, `${name}: nothing recorded`)
        assert.equal(giveBackRunner(files.runner), false)
        assert.deepEqual(readJson(files.runner), taken)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: runner() sweeps what a killed runner left, and leaves a runner past 3 hours alone while its big run waits in the idle room', async () => {
  const { dir, lock, files } = world()
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
  const was = os.getPriority(0)
  try {
    const old = { pid: sleeper.pid, startedAt: iso(Date.now() - 4 * HOUR) }
    writeFileSync(files.runner, JSON.stringify(old))
    mkdirSync(tool.idleRoomOf(lock))
    const ticket = join(tool.idleRoomOf(lock), `000000000000001-${String(sleeper.pid).padStart(8, '0')}.json`)
    writeFileSync(ticket, JSON.stringify({ pid: sleeper.pid, label: IDLE_LABEL, cwd: join(os.tmpdir(), 'board-big-suite-c1abcdef0'), startedAt: iso(Date.now()), idle: true, order: 2, beat: iso(Date.now()) }))
    const calls = []
    assert.equal(await runner('C:/not-a-repo', { ...process.env, HEAVY_RUN_LOCK: lock }, fakeSteps(calls, { sweep: () => calls.push('sweep') })), null)
    assert.deepEqual(calls, [])
    assert.deepEqual(readJson(files.runner), old)
    // without its run in the queue the old runner is dead: this one sweeps first, then plays
    rmSync(ticket)
    const played = []
    const run = await runner('C:/not-a-repo', { ...process.env, HEAVY_RUN_LOCK: lock }, fakeSteps(played, { sweep: () => played.push('sweep') }))
    assert.equal(run.outcome, 'passed')
    assert.deepEqual(played.slice(0, 2), ['sweep', 'prepare c1abcdef0000'])
    assert.equal(existsSync(files.runner), false, 'its own file given back')
  } finally {
    try { os.setPriority(0, was) } catch { /* keeps it */ }
    sleeper.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: a big run is queued when a live ticket or slot of a big run\'s folder is there: the idle room, the queue and the slots; never another folder\'s or a dead one', async () => {
  const { dir, lock } = world()
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
  try {
    const big = { pid: sleeper.pid, label: IDLE_LABEL, cwd: join(os.tmpdir(), 'board-big-suite-c1'), startedAt: iso(Date.now()) }
    assert.equal(bigRunQueued(lock, tool), false)
    for (const folder of [tool.idleRoomOf(lock), `${lock}.queue`]) {
      mkdirSync(folder, { recursive: true })
      const file = join(folder, '000000000000001-00000001.json')
      writeFileSync(file, JSON.stringify({ ...big, cwd: join(os.tmpdir(), 'elsewhere') }))
      assert.equal(bigRunQueued(lock, tool), false, `another folder's run in ${folder}`)
      writeFileSync(file, JSON.stringify({ ...big, pid: 999999 }))
      assert.equal(bigRunQueued(lock, tool, () => false), false, `a dead run in ${folder}`)
      writeFileSync(file, JSON.stringify(big))
      assert.equal(bigRunQueued(lock, tool), true, `a big run in ${folder}`)
      rmSync(file)
    }
    writeFileSync(lock, JSON.stringify({ ...big, label: ORDINARY_LABEL }))
    assert.equal(bigRunQueued(lock, tool), true, 'a big run holding the slot')
  } finally {
    sleeper.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: the "runs now" line the runner watches for is the one one-at-a-time writes when a run takes its slot', () => {
  const { dir, lock } = world()
  try {
    const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, HEAVY_RUN_PRIORITY: _priority, HEAVY_RUN_MASK: _mask, HEAVY_RUN_CORES: _cores, ...plain } = process.env
    const ran = spawnSync(process.execPath, [HELPER, IDLE_LABEL, '--', 'node', '-e', '0'], { encoding: 'utf8', windowsHide: true, env: { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50' } })
    assert.equal(ran.status, 0, ran.stderr)
    assert.match(ran.stderr, RUNS_NOW)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, the real case (Windows): a big run\'s worktree gets the node_modules junction, and its clean-up removes the junction first, leaves its target whole and removes the worktree', { skip: process.platform !== 'win32' && 'junctions are Windows\'' }, () => {
  const { dir, lock } = world()
  const repo = join(dir, 'repo')
  try {
    mkdirSync(join(repo, 'node_modules', 'happy-dom'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'keep me')
    writeFileSync(join(repo, 'a.txt'), 'a')
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(git('init', '-q', '-b', 'main').status, 0)
    git('add', '-A')
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one').status, 0)
    const steps = bigSuiteSteps(repo, { ...process.env, HEAVY_RUN_LOCK: lock })
    const commit = steps.mainHead()
    const folder = join(dir, 'board-big-suite-run')
    steps.prepare(folder, commit)
    assert.equal(readFileSync(join(folder, 'node_modules', 'happy-dom', 'marker.txt'), 'utf8'), 'keep me', 'the junction reaches the checkout\'s node_modules')
    steps.cleanUp(folder)
    assert.equal(existsSync(folder), false, 'the worktree is gone')
    assert.equal(readFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'utf8'), 'keep me', 'the target of the junction is whole')
    assert.doesNotMatch(git('worktree', 'list').stdout, /board-big-suite-run/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: the board\'s pass files a red streak\'s fix step once, as a board fix with its go-lives; filing and starting are apart; a run starts only when due, main is known and no big run lives', async () => {
  const { dir, lock, files } = world()
  try {
    const landings = join(dir, 'landings.jsonl')
    writeFileSync(landings, [{ result: 'landed', branch: 'b9-x', by: 'Worker 9', after: 'c2' }].map(one => JSON.stringify(one)).join('\n'))
    const filed = join(dir, 'filed.json')
    // a fixed afternoon, so the night run never comes in (core review: a real clock between 01:00 and 06:00 made this red)
    const now = local(26, 14)
    writeFileSync(files.results, JSON.stringify(recordRun({ lastGreen: 'c1' }, { commit: 'c2', outcome: 'failed', at: iso(now - 30 * 60000), seconds: 9, failed: ['test/a.test.mjs'] })))
    const made = []
    const started = []
    let make = async call => { made.push(call); return { ok: true, result: { id: `B90${made.length}` } } }
    let read = async () => ({ items: new Map(), activities: [{ name: 'Board' }] })
    let head = 'c2'
    const pass = (at = now) => bigSuitePass({
      lock, tool, landings, filed, now: at, mainHead: async () => head, commitsBetween: async (from) => new Set(from === 'c1' ? ['c2', 'c3'] : []),
      start: () => started.push(1), make: call => make(call), read: () => read(),
    })
    const first = await pass()
    assert.equal(first.filed, 'B901')
    assert.equal(made[0].priority, 'fix')
    assert.equal(made[0].activity, 'Board')
    assert.match(made[0].text.join('\n'), /b9-x \(Worker 9, c2\)/)
    assert.match(made[0].text.join('\n'), /Filed by the board itself/)
    assert.equal(readJson(filed)['red c2 test/a.test.mjs'].id, 'B901')
    assert.equal(first.started, null, 'ran half an hour ago: nothing due')
    await pass()
    assert.equal(made.length, 1, 'filed once')
    // the same red streak on the next commit, the same file: no second step (core review: one step per red streak)
    writeFileSync(files.results, JSON.stringify(recordRun(readJson(files.results), { commit: 'c3', outcome: 'failed', at: iso(now - 20 * 60000), failed: ['test/a.test.mjs'] })))
    await pass()
    assert.equal(made.length, 1, 'one step per streak')
    // another file fails in the streak: a new step is owed; a store that cannot be read files nothing, and a due run still starts
    writeFileSync(files.results, JSON.stringify(recordRun(readJson(files.results), { commit: 'c3', outcome: 'failed', at: iso(now - 10 * 60000), failed: ['test/a.test.mjs', 'test/b.test.mjs'] })))
    read = async () => { throw new Error('the store is held') }
    const held = await pass(now + 2 * HOUR)
    assert.equal(held.filed, null)
    assert.equal(held.started, 'main moved', 'filing and starting are apart')
    assert.deepEqual(Object.keys(readJson(filed)), ['red c2 test/a.test.mjs'], 'no pending mark left behind')
    read = async () => ({ items: new Map(), activities: [{ name: 'Board' }] })
    // a make that throws takes its mark away, and the next pass files it
    make = async () => { throw new Error('the work API is down') }
    await pass()
    assert.deepEqual(Object.keys(readJson(filed)), ['red c2 test/a.test.mjs'])
    make = async call => { made.push(call); return { ok: true, result: { id: `B90${made.length}` } } }
    assert.equal((await pass()).filed, 'B902')
    // a runner alive or no main known: nothing starts
    writeFileSync(files.runner, JSON.stringify({ pid: process.pid, startedAt: iso(now + 4 * HOUR) }))
    assert.equal((await pass(now + 4 * HOUR)).started, null)
    rmSync(files.runner)
    head = null
    assert.equal((await pass(now + 4 * HOUR)).started, null, 'no main known: no runner that would only stop')
    head = 'c3'
    assert.equal((await pass(now + 4 * HOUR)).started, 'every 4 hours')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, core review: a big suite that could not run three times in a row gets one fix step', async () => {
  const { dir, lock, files } = world()
  try {
    const filed = join(dir, 'filed.json')
    let results = recordRun({}, { commit: 'g', outcome: 'passed', at: iso(local(26, 8)) })
    for (const hour of [9, 10]) results = recordRun(results, { commit: 'x', outcome: 'could not run', at: iso(local(26, hour)), why: 'stopped' })
    writeFileSync(files.results, JSON.stringify(results))
    const made = []
    const pass = (at = local(26, 12)) => bigSuitePass({
      lock, tool, landings: join(dir, 'none.jsonl'), filed, now: at, mainHead: async () => 'x', commitsBetween: async () => new Set(),
      start: () => {}, make: async call => { made.push(call); return { ok: true, result: { id: 'B7' } } }, read: async () => ({ items: new Map(), activities: [{ name: 'Board' }] }),
    })
    await pass()
    assert.equal(made.length, 0, 'two in a row: no step yet')
    writeFileSync(files.results, JSON.stringify(recordRun(results, { commit: 'x', outcome: 'could not run', at: iso(local(26, 11)), why: 'stopped' })))
    await pass()
    await pass()
    // filed once for the streak, also hours later
    await pass(local(26, 16))
    assert.equal(made.length, 1)
    assert.equal(made[0].title, 'Big suite could not run 3 times in a row')
    assert.equal(made[0].priority, 'fix')
    assert.deepEqual(owedOf(readJson(files.results), {}).map(one => one.key), [`not run since ${iso(local(26, 9))}`])
    assert.equal(NOT_RUN_STEP_AFTER, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9: the board starts the big suite only on the PC\'s first board, never a board in the temporary folder, and land.ps1 says its word at the gate\'s start', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const runsBigSuite = !isDemo && !isShowOnly && historyFrom === undefined\s*&& !resolve\(HERE\)\.toLowerCase\(\)\.startsWith\(resolve\(tmpdir\(\)\)\.toLowerCase\(\)\)\s*&& \(config\.bigSuite \?\? \(firstBoard !== null/)
  assert.match(server, /setInterval\(lookAtBigSuite, BIG_SUITE_LOOK_MS\)/)
  const land = readFileSync(new URL('../tools/land.ps1', import.meta.url), 'utf8')
  assert.match(land, /\$bigTool = Join-Path \$mainDir 'tools\\big-suite\.mjs'/)
  assert.match(land, /Invoke-Native \$node @\(\$bigTool, '--status', '--quiet'\)/)
})

// The second core review (2026-11-26).
test('S9, core review, the real case: steps.run starts one-at-a-time with test.mjs and the files asked, writes the log, and says when it took its slot', { timeout: 60_000 }, async () => {
  const { dir, lock, files } = world()
  try {
    const folder = join(dir, 'board-big-suite-real')
    mkdirSync(join(folder, 'tools'), { recursive: true })
    writeFileSync(join(folder, 'tools', 'one-at-a-time.mjs'), readFileSync(HELPER, 'utf8'))
    writeFileSync(join(folder, 'tools', 'test.mjs'), "console.log('files: ' + process.argv.slice(2).join(' '))\nconsole.log('ℹ tests 1')\nconsole.log('ℹ fail 0')\n")
    const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, HEAVY_RUN_PRIORITY: _priority, HEAVY_RUN_MASK: _mask, HEAVY_RUN_CORES: _cores, ...plain } = process.env
    const steps = bigSuiteSteps(dir, { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50' })
    const before = Date.now()
    const ran = await steps.run(folder, RERUN_LABEL, { upgrade: () => false, only: ['test/x.test.mjs'] })
    assert.equal(ran.code, 0, ran.output)
    assert.match(ran.output, /^files: test\/x\.test\.mjs$/m)
    assert.equal(verdictOf(ran.output, ran.code, folder).outcome, 'passed')
    assert.ok(ran.ranAt >= before, 'the moment it took its slot')
    assert.match(readFileSync(files.log, 'utf8'), new RegExp(`===== big suite ${RERUN_LABEL} in .*board-big-suite-real at `))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B1567: steps.run hands the suite no board marks: a board starts it from its own process, and a keeper under test would read WORKER_BOARD_CHILD as its own', { timeout: 60_000 }, async () => {
  const { dir, lock } = world()
  try {
    const folder = join(dir, 'board-big-suite-env')
    mkdirSync(join(folder, 'tools'), { recursive: true })
    writeFileSync(join(folder, 'tools', 'one-at-a-time.mjs'), readFileSync(HELPER, 'utf8'))
    writeFileSync(join(folder, 'tools', 'test.mjs'), "console.log('marks: ' + ['WORKER_BOARD_CHILD', 'WORKER_BOARD_KEY', 'WORKER_BOARD_TOKEN'].map(name => String(process.env[name])).join(' '))\nconsole.log('kept: ' + process.env.B1567_KEPT)\nconsole.log('ℹ fail 0')\n")
    const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, ...plain } = process.env
    const steps = bigSuiteSteps(dir, { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50', WORKER_BOARD_CHILD: '1', WORKER_BOARD_KEY: 'k'.repeat(32), WORKER_BOARD_TOKEN: 'a'.repeat(64), B1567_KEPT: 'yes' })
    const ran = await steps.run(folder, RERUN_LABEL, { upgrade: () => false, only: ['test/x.test.mjs'] })
    assert.equal(ran.code, 0, ran.output)
    assert.match(ran.output, /^marks: undefined undefined undefined$/m)
    assert.match(ran.output, /^kept: yes$/m, 'the rest of the env goes on')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, core review: at most RERUNS_MAX failing files run again alone (the rest stay red), and a run counts from when it took its slot', async () => {
  const { dir, files } = world()
  try {
    ours(files)
    const failing = Array.from({ length: RERUNS_MAX + 2 }, (_, i) => `test/f${i}.test.mjs`)
    const calls = []
    const ranAt = Date.now() - 2 * HOUR
    const run = await playOnce({
      files,
      steps: fakeSteps(calls, {
        run: async (folder, label, { only = [] } = {}) => {
          calls.push(only.length === 0 ? 'run' : 'rerun')
          return only.length === 0 ? { code: 1, output: red(...failing), ranAt } : { code: 0, output: GREEN, ranAt: Date.now() }
        },
      }),
    })
    assert.equal(calls.filter(one => one === 'rerun').length, RERUNS_MAX)
    assert.deepEqual(run.failed, failing.slice(RERUNS_MAX))
    assert.equal(run.flaky.length, RERUNS_MAX)
    assert.equal(run.at, iso(ranAt), 'the run counts from its slot, not from the runner\'s start')
    assert.equal(RERUNS_MAX, 10)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, core review: a rerun alone counts as a queued big run, and no runner starts beside a queued big run, also one whose runner died', async () => {
  const { dir, lock, files } = world()
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true })
  const was = os.getPriority(0)
  try {
    writeFileSync(lock, JSON.stringify({ pid: sleeper.pid, label: RERUN_LABEL, cwd: join(os.tmpdir(), 'board-big-suite-c1'), startedAt: iso(Date.now()) }))
    assert.equal(bigRunQueued(lock, tool), true)
    // no runner file at all (its runner died): this one does not start, and sweeps nothing
    const calls = []
    assert.equal(await runner('C:/not-a-repo', { ...process.env, HEAVY_RUN_LOCK: lock }, fakeSteps(calls, { sweep: () => calls.push('sweep') })), null)
    assert.deepEqual(calls, [])
    assert.equal(existsSync(files.runner), false)
  } finally {
    try { os.setPriority(0, was) } catch { /* keeps it */ }
    sleeper.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})

// The verifier's round (2026-11-26).
test('S9, verifier: a run that took its slot after midnight is that night\'s run; no second night run after it', () => {
  const green = { commit: 'a', outcome: 'passed' }
  assert.equal(dueNow({ results: { lastStart: iso(local(26, 0, 55)), last: green }, mainHead: 'a', now: local(26, 1, 30) }), null)
  assert.equal(dueNow({ results: { lastStart: iso(local(25, 23, 55)), last: green }, mainHead: 'a', now: local(26, 1, 30) }), 'the night run')
  assert.equal(labelFor({ results: { lastStart: iso(local(26, 0, 55)) }, now: local(26, 1, 30) }).idleUntil, local(26, 4, 55), 'no 05:00 limit once the night run ran')
})

test('S9, verifier: a big run\'s ticket with an old beat (a killed run\'s, its pid maybe reused) is no queued run', () => {
  const { dir, lock } = world()
  try {
    mkdirSync(tool.idleRoomOf(lock))
    const ticket = join(tool.idleRoomOf(lock), '000000000000001-00000001.json')
    const big = { pid: process.pid, label: IDLE_LABEL, cwd: join(os.tmpdir(), 'board-big-suite-c1'), startedAt: iso(Date.now()) }
    writeFileSync(ticket, JSON.stringify({ ...big, beat: iso(Date.now() - 6 * 60000) }))
    assert.equal(bigRunQueued(lock, tool), false)
    writeFileSync(ticket, JSON.stringify({ ...big, beat: iso(Date.now()) }))
    assert.equal(bigRunQueued(lock, tool), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier: an overdue idle run is stopped only while its ticket waits in the idle room; a room that cannot be read counts as waiting', () => {
  const { dir } = world()
  try {
    const room = join(dir, 'room')
    const folder = join(dir, 'board-big-suite-x')
    assert.equal(waitsInRoom(room, IDLE_LABEL, folder), true, 'no room to read')
    mkdirSync(room)
    assert.equal(waitsInRoom(room, IDLE_LABEL, folder), false, 'an empty room: it has left it (it took its slot)')
    writeFileSync(join(room, 'a.json'), JSON.stringify({ label: IDLE_LABEL, cwd: join(dir, 'board-big-suite-other') }))
    assert.equal(waitsInRoom(room, IDLE_LABEL, folder), false, 'another folder\'s ticket')
    writeFileSync(join(room, 'b.json'), JSON.stringify({ label: IDLE_LABEL, cwd: folder }))
    assert.equal(waitsInRoom(room, IDLE_LABEL, folder), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier: a rerun alone that could not run makes the big run "could not run", and only test files are run again alone', async () => {
  const { dir, files } = world()
  try {
    ours(files)
    const run = await playOnce({ files, steps: fakeSteps([], { run: async (folder, label, { only = [] } = {}) => (only.length === 0 ? { code: 1, output: red('test/a.test.mjs') } : { code: STOPPED, output: '' }) }) })
    assert.equal(run.outcome, 'could not run')
    assert.match(run.why, /the rerun alone of test\/a\.test\.mjs could not run/)
    const helper = verdictOf("✖ failing tests:\n  location: 'C:/x/src/helper.mjs:3:1'\ntest at test/a.test.mjs:1:1\nℹ tests 2\nℹ fail 2\n", 1)
    assert.deepEqual(helper.failed, ['test/a.test.mjs'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier, the real case (Windows): the sweep removes a killed run\'s worktree junction first and a folder git no longer knows, leaving the junction\'s target whole', { skip: process.platform !== 'win32' && 'junctions are Windows\'' }, () => {
  const { dir, lock } = world()
  const repo = join(dir, 'repo')
  const temp = join(dir, 'temp')
  try {
    mkdirSync(join(repo, 'node_modules', 'happy-dom'), { recursive: true })
    mkdirSync(temp)
    writeFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'keep me')
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    const git = (...args) => spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true })
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    assert.equal(git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'one').status, 0)
    const steps = bigSuiteSteps(repo, { ...process.env, HEAVY_RUN_LOCK: lock })
    const left = join(temp, 'board-big-suite-left')
    steps.prepare(left, steps.mainHead())
    // a folder git no longer knows (its entry pruned), with a junction in it as well
    const stray = join(temp, 'board-big-suite-stray')
    mkdirSync(stray)
    assert.equal(spawnSync('cmd.exe', ['/c', 'mklink', '/J', join(stray, 'node_modules'), join(repo, 'node_modules')], { windowsHide: true }).status, 0)
    writeFileSync(join(stray, 'half.txt'), 'x')
    const other = join(temp, 'not-ours')
    mkdirSync(other)
    steps.sweep(temp)
    assert.equal(existsSync(left), false)
    assert.equal(existsSync(stray), false)
    assert.equal(existsSync(other), true, 'only board-big-suite- folders')
    assert.equal(readFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'utf8'), 'keep me')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier: one step per red streak and file: a shrinking set files nothing, a file an open big-suite step names gets none, a could-not-run streak after a red run is filed', async () => {
  const { dir, lock, files } = world()
  try {
    const filed = join(dir, 'filed.json')
    const now = local(26, 14)
    const made = []
    const openStep = new Map([['B1', { head: new Map([['Title', 'Big suite red on main at c0: 1 test file(s) fail'], ['State', 'in progress']]), sections: new Map([['Text', ['Failing files: test/c.test.mjs.']]]) }]])
    const pass = () => bigSuitePass({
      lock, tool, landings: join(dir, 'none.jsonl'), filed, now, mainHead: async () => null, commitsBetween: async () => new Set(),
      start: () => {}, make: async call => { made.push(call); return { ok: true, result: { id: `B${made.length + 1}` } } },
      read: async () => ({ items: openStep, activities: [{ name: 'Board' }] }),
    })
    let results = recordRun({ lastGreen: 'g' }, { commit: 'r1', outcome: 'failed', at: iso(now - 3 * HOUR), failed: ['test/a.test.mjs', 'test/b.test.mjs', 'test/c.test.mjs'] })
    writeFileSync(files.results, JSON.stringify(results))
    await pass()
    assert.equal(made.length, 1)
    assert.match(made[0].text.join('\n'), /Failing files: test\/a\.test\.mjs, test\/b\.test\.mjs\./, 'c is named by an open step already')
    results = recordRun(results, { commit: 'r2', outcome: 'failed', at: iso(now - 2 * HOUR), failed: ['test/a.test.mjs'] })
    writeFileSync(files.results, JSON.stringify(results))
    await pass()
    assert.equal(made.length, 1, 'b fixed: the set shrank, nothing new')
    for (const hour of [1.5, 1, 0.5]) results = recordRun(results, { commit: 'x', outcome: 'could not run', at: iso(now - hour * HOUR), why: 'stopped' })
    writeFileSync(files.results, JSON.stringify(results))
    await pass()
    assert.equal(made.length, 2)
    assert.equal(made[1].title, 'Big suite could not run 3 times in a row', 'filed after a red run as well')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier: a refused filing is said and tried again only after RETRY_MS; a filing cut off by a stop (its pending mark) waits as long, then is tried again', async () => {
  const { dir, lock, files } = world()
  try {
    const filed = join(dir, 'filed.json')
    const said = []
    let answer = { ok: false, status: 403, why: 'not allowed' }
    const calls = []
    const pass = at => bigSuitePass({
      lock, tool, landings: join(dir, 'none.jsonl'), filed, now: at, mainHead: async () => null, commitsBetween: async () => new Set(),
      start: () => {}, make: async call => { calls.push(call); return answer }, read: async () => ({ items: new Map(), activities: [{ name: 'Board' }] }), say: line => said.push(line),
    })
    const now = local(26, 14)
    writeFileSync(files.results, JSON.stringify(recordRun({}, { commit: 'r1', outcome: 'failed', at: iso(now - HOUR), failed: ['test/a.test.mjs'] })))
    await pass(now)
    assert.equal(calls.length, 1)
    assert.match(said.join('\n'), /refused its fix step .*: not allowed/)
    await pass(now + 10 * 60000)
    assert.equal(calls.length, 1, 'not again within the hour')
    answer = { ok: true, result: { id: 'B5' } }
    assert.equal((await pass(now + RETRY_MS + 1)).filed, 'B5')
    // a pending mark left by a stop: waits RETRY_MS, then filed
    const key = 'red r2 test/b.test.mjs'
    writeFileSync(files.results, JSON.stringify(recordRun({}, { commit: 'r2', outcome: 'failed', at: iso(now), failed: ['test/b.test.mjs'] })))
    writeFileSync(filed, JSON.stringify({ [key]: { pending: true, at: iso(now), streak: 'red r2', files: ['test/b.test.mjs'] } }))
    calls.length = 0
    await pass(now + 30 * 60000)
    assert.equal(calls.length, 0)
    await pass(now + RETRY_MS + 1)
    assert.equal(calls.length, 1)
    assert.equal(readJson(filed)[key].id, 'B5')
    assert.equal(RETRY_MS, HOUR)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S9, verifier: the server\'s pass is one at a time with a hung time above its look', () => {
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const lookAtBigSuite = \(\) => loops\.single\('big-suite'/)
  assert.match(server, /\}, \{ staleMs: BIG_SUITE_STALE_MS \}\)\n\s*setInterval\(lookAtBigSuite, BIG_SUITE_LOOK_MS\)/)
  assert.ok(BIG_SUITE_STALE_MS > 10 * 60000)
})

test('B1573 (X264): a run queued at main A that gets its slot after main moved to B tests, records and reruns B; main unmoved records A; a run naming no commit could not run', async () => {
  const { dir, files } = world()
  const A = 'a1a1a1a1a1a1'
  const B = 'b2b2b2b2b2b2'
  try {
    ours(files)
    const calls = []
    const moved = await playOnce({
      files,
      steps: fakeSteps(calls, {
        mainHead: (() => { let n = 0; return () => (n++ === 0 ? A : B) })(),
        prepare: (folder, commit) => calls.push(`prepare ${commit}`),
        run: async (folder, label, { only = [], slot = false } = {}) => {
          calls.push(`run ${only.length > 0 ? only.join(' ') : label}${slot ? ' in its slot' : ''}`)
          if (only.length > 0) return { code: 1, output: `✖ failing tests:\ntest at ${only[0]}:1:1\nℹ tests 1\nℹ fail 1\n` }
          return { code: 1, output: `big suite: tests main at ${B}\n✖ failing tests:\ntest at test/a.test.mjs:1:1\nℹ tests 9\nℹ fail 1\n` }
        },
      }),
    })
    assert.deepEqual(calls, [`prepare ${A}`, `run ${ORDINARY_LABEL} in its slot`, 'run test/a.test.mjs', 'cleanUp'], 'the folder is made at A; only the big run checks out in its slot, the rerun alone stays on what it tested')
    assert.equal(moved.commit, B)
    const results = readJson(files.results)
    assert.equal(results.last.commit, B, 'the record names the commit tested, not the one queued')
    assert.equal(results.redSince, B)
    assert.equal(results.probation['test/a.test.mjs'].commit, B)
    // a green run of B: lastGreen is B
    const green = await playOnce({ files, steps: fakeSteps([], { mainHead: () => A, run: async () => ({ code: 0, output: `big suite: tests main at ${B}\nℹ tests 1\nℹ fail 0\n` }) }) })
    assert.deepEqual([green.outcome, readJson(files.results).lastGreen], ['passed', B])
    // main unmoved: A, as before
    const same = await playOnce({ files, steps: fakeSteps([], { mainHead: () => A, run: async () => ({ code: 0, output: `big suite: tests main at ${A}\nℹ tests 1\nℹ fail 0\n` }) }) })
    assert.equal(readJson(files.results).last.commit, A)
    assert.equal(same.commit, A)
    // a green summary with no line naming the commit: never a green of the queued commit
    const blind = await playOnce({ files, steps: fakeSteps([], { mainHead: () => B, run: async () => ({ code: 0, output: 'ℹ tests 1\nℹ fail 0\n' }) }) })
    assert.equal(blind.outcome, 'could not run')
    assert.match(blind.why, /named no commit it tested/)
    assert.equal(readJson(files.results).lastGreen, A, 'the last green stays the one before')
    assert.equal(testedCommit('one-at-a-time: x runs now\nbig suite: tests main at 0123456789abcdef0123456789abcdef01234567\n'), '0123456789abcdef0123456789abcdef01234567')
    assert.equal(testedCommit('no line'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('B1573, the real case (Windows): a worktree made at A runs in its slot at main\'s newest B, junction whole, and its clean-up removes the junction first', { skip: process.platform !== 'win32' && 'junctions are Windows\'', timeout: 60_000 }, async () => {
  const { dir, lock } = world()
  const repo = join(dir, 'repo')
  try {
    mkdirSync(join(repo, 'node_modules', 'happy-dom'), { recursive: true })
    mkdirSync(join(repo, 'tools'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'keep me')
    writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
    writeFileSync(join(repo, 'tools', 'one-at-a-time.mjs'), readFileSync(HELPER, 'utf8'))
    const testFile = version => `import { readFileSync } from 'node:fs'\nconsole.log('version ${version}')\nconsole.log('junction: ' + readFileSync('node_modules/happy-dom/marker.txt', 'utf8'))\nconsole.log('ℹ tests 1')\nconsole.log('ℹ fail 0')\n`
    const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true })
    const commit = (version) => {
      writeFileSync(join(repo, 'tools', 'test.mjs'), testFile(version))
      git('add', '-A')
      assert.equal(git('commit', '-q', '-m', version).status, 0)
    }
    assert.equal(git('init', '-q', '-b', 'main').status, 0)
    commit('A')
    const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, HEAVY_RUN_PRIORITY: _priority, HEAVY_RUN_MASK: _mask, HEAVY_RUN_CORES: _cores, ...plain } = process.env
    const steps = bigSuiteSteps(repo, { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50' })
    const A = steps.mainHead()
    const folder = join(dir, 'board-big-suite-slot')
    steps.prepare(folder, A)
    // main moves while the run waits for the PC
    commit('B')
    const B = steps.mainHead()
    assert.notEqual(A, B)
    const ran = await steps.run(folder, ORDINARY_LABEL, { upgrade: () => false, slot: true })
    assert.equal(ran.code, 0, ran.output)
    assert.equal(testedCommit(ran.output), B, ran.output)
    assert.match(ran.output, /^version B$/m, 'the tests of B ran')
    assert.match(ran.output, /^junction: keep me$/m, 'the junction still reaches the checkout\'s node_modules')
    assert.equal(verdictOf(ran.output, ran.code, folder).outcome, 'passed')
    assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: folder, encoding: 'utf8', windowsHide: true }).stdout.trim(), B)
    // a rerun alone keeps B, also when main moved again meanwhile
    commit('C')
    const again = await steps.run(folder, RERUN_LABEL, { upgrade: () => false, only: ['test/x.test.mjs'] })
    assert.match(again.output, /^version B$/m)
    // main unreadable: no line, so the run could not run
    const said = []
    assert.equal(await slotRun(join(dir, 'no-repo'), folder, ['node', '-e', '0'], line => said.push(line)), 127)
    assert.equal(testedCommit(said.join('\n')), null)
    steps.cleanUp(folder)
    assert.equal(existsSync(folder), false, 'the worktree is gone')
    assert.equal(readFileSync(join(repo, 'node_modules', 'happy-dom', 'marker.txt'), 'utf8'), 'keep me', 'the target of the junction is whole')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
