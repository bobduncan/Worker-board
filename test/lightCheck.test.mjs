// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the light check with every go-live (src/lightCheck.mjs, tools/test.mjs
// --gate) leaves the slowest test files out, except a slow file whose area the change touches or that a red big run put on probation.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { globToRegExp, guardsOf, lightFiles, readSlowFiles, slowFilesToRun, testFiles } from '../src/lightCheck.mjs'
import { gateFiles } from '../tools/test.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('S9: a glob matches by folders: ** any folders (also none), * within one folder, ? one character; the case does not count', () => {
  const cases = [
    ['src/carry/**', 'src/carry/git.mjs', true], ['src/carry/**', 'src/carry/a/b.mjs', true], ['src/carry/**', 'src/carryOn.mjs', false],
    ['src/work/holder*.mjs', 'src/work/holderTimers.mjs', true], ['src/work/holder*.mjs', 'src/work/x/holder.mjs', false],
    ['fixtures/demo*', 'fixtures/demo.mjs', true], ['test/**/x.mjs', 'test/x.mjs', true], ['test/**/x.mjs', 'test/a/b/x.mjs', true],
    ['server.mjs', 'server.mjs', true], ['server.mjs', 'src/server.mjs', false], ['src/plan?.mjs', 'src/plan1.mjs', true],
    ['tools/land.ps1', 'Tools/Land.ps1', true], ['src/a.b.mjs', 'src/aXb.mjs', false],
  ]
  for (const [glob, file, want] of cases) assert.equal(globToRegExp(glob).test(file), want, `${glob} on ${file}`)
})

const SPEC = {
  board: ['server.mjs', 'src/state.mjs'],
  files: {
    'test/slowBoard.test.mjs': ['@board', 'src/wake.mjs'],
    'test/slowTool.test.mjs': ['tools/land.ps1', 'src/carry/**'],
  },
}
const ALL = ['test/a.test.mjs', 'test/slowBoard.test.mjs', 'test/slowTool.test.mjs', 'test/z.test.mjs']

test('S9: a slow file runs when the change touches its area (its own file, its globs, the board\'s for @board) or it is on probation; else the big suite keeps it', () => {
  assert.deepEqual(guardsOf(SPEC, 'test/slowBoard.test.mjs'), ['test/slowBoard.test.mjs', 'server.mjs', 'src/state.mjs', 'src/wake.mjs'])
  const none = lightFiles({ all: ALL, spec: SPEC, changed: ['DESIGN.md', 'src/other.mjs'] })
  assert.deepEqual(none.files, ['test/a.test.mjs', 'test/z.test.mjs'])
  assert.deepEqual(none.left, ['test/slowBoard.test.mjs', 'test/slowTool.test.mjs'])
  assert.deepEqual(slowFilesToRun({ spec: SPEC, changed: ['src\\state.mjs'] }), [{ file: 'test/slowBoard.test.mjs', why: 'area: src/state.mjs' }])
  assert.deepEqual(slowFilesToRun({ spec: SPEC, changed: ['src/carry/save.mjs'] }), [{ file: 'test/slowTool.test.mjs', why: 'area: src/carry/save.mjs' }])
  assert.deepEqual(slowFilesToRun({ spec: SPEC, changed: ['test/slowTool.test.mjs'] }), [{ file: 'test/slowTool.test.mjs', why: 'area: test/slowTool.test.mjs' }])
  assert.deepEqual(slowFilesToRun({ spec: SPEC, changed: [], probation: { 'test/slowBoard.test.mjs': { greens: 1 } } }), [{ file: 'test/slowBoard.test.mjs', why: 'probation' }])
  // a change git could not read: every slow file runs
  assert.deepEqual(lightFiles({ all: ALL, spec: SPEC, changed: null }).files, ALL)
})

test('S9: the board\'s own list: every slow file is a test file here, every glob matches a file of the repository, and no file is listed twice', () => {
  const spec = readSlowFiles(ROOT)
  assert.ok(spec !== null, 'test/slow-files.json reads')
  const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.split('\n').filter(Boolean)
  const tests = testFiles(ROOT)
  const unmatched = []
  for (const glob of spec.board) if (!tracked.some(file => globToRegExp(glob).test(file))) unmatched.push(`board: ${glob}`)
  for (const [file, globs] of Object.entries(spec.files)) {
    assert.ok(tests.includes(file), `${file} is a test file`)
    for (const glob of globs) if (glob !== '@board' && !tracked.some(one => globToRegExp(glob).test(one))) unmatched.push(`${file}: ${glob}`)
  }
  assert.deepEqual(unmatched, [], 'a glob that matches nothing guards nothing')
  assert.ok(Object.keys(spec.files).length >= 20, 'the slow files of 11-25 (every file over 60 s)')
})

test('S9: without test/slow-files.json every test file runs, and the log says so', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'light-none-'))
  try {
    mkdirSync(join(root, 'test'))
    writeFileSync(join(root, 'test', 'a.test.mjs'), '')
    const picked = gateFiles({ root, git: () => '' })
    assert.deepEqual(picked.files, ['test/a.test.mjs'])
    assert.match(picked.lines[0], /no test\/slow-files\.json here: every test file runs/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('S9, the real case: node tools/test.mjs --gate in a branch leaves a slow file out, runs it once the branch touches its area, and says why', { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(os.tmpdir(), 'light-real-'))
  try {
    for (const file of ['tools/test.mjs', 'tools/one-at-a-time.mjs', 'tools/openFilesReporter.mjs', 'src/lightCheck.mjs', 'src/bigSuite.mjs']) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      copyFileSync(join(ROOT, file), join(root, file))
    }
    mkdirSync(join(root, 'test'))
    mkdirSync(join(root, 'src', 'carry'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n')
    writeFileSync(join(root, 'test', 'fast.test.mjs'), "import test from 'node:test'\ntest('fast', () => {})\n")
    writeFileSync(join(root, 'test', 'slow.test.mjs'), "import test from 'node:test'\ntest('slow', () => {})\n")
    writeFileSync(join(root, 'test', 'slow-files.json'), JSON.stringify({ board: [], files: { 'test/slow.test.mjs': ['src/carry/**'] } }))
    writeFileSync(join(root, 'src', 'carry', 'git.mjs'), 'export const a = 1\n')
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'main')
    git('checkout', '-q', '-b', 'feature')
    writeFileSync(join(root, 'notes.md'), 'a change outside the area\n')
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'outside')
    const lock = join(root, 'heavy.lock')
    // No NODE_TEST_CONTEXT (node --test would report to this run instead of printing) and no held slot of the run around this one.
    const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_PID: _pid, ...plain } = process.env
    const gate = () => spawnSync(process.execPath, ['tools/test.mjs', '--gate'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...plain, HEAVY_RUN_LOCK: lock } })
    const outside = gate()
    assert.equal(outside.status, 0, outside.stdout + outside.stderr)
    assert.match(outside.stdout, /^light check: 1 of 2 test files; 1 slow file\(s\) left to the big suite$/m)
    assert.match(outside.stdout, /✔ fast/)
    assert.doesNotMatch(outside.stdout, /✔ slow/)
    writeFileSync(join(root, 'src', 'carry', 'git.mjs'), 'export const a = 2\n')
    git('add', '-A')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'inside')
    const inside = gate()
    assert.equal(inside.status, 0, inside.stdout + inside.stderr)
    assert.match(inside.stdout, /^light check: runs test\/slow\.test\.mjs \(area: src\/carry\/git\.mjs\)$/m)
    assert.match(inside.stdout, /✔ slow/)
    // a red big run's probation: back on main's commit, the slow file runs for it
    git('checkout', '-q', 'main')
    writeFileSync(`${lock}.board-big-suite.json`, JSON.stringify({ probation: { 'test/slow.test.mjs': { greens: 0 } } }))
    const held = gate()
    assert.match(held.stdout, /^light check: runs test\/slow\.test\.mjs \(probation\)$/m)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
