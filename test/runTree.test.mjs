// B1575: a test's run that outlives its clock or its test (the landing of the big run of 2093e58, 2026-11-27) must not keep
// the test file open. Each case runs a small node script as its own process (as node --test runs a test file) and times
// how long that process stays open after its run was ended. The run is PowerShell, as land.ps1's is. Mutants (each fails a case here): the late timer ending the
// run's process alone (the old child.kill()) leaves the grandchild alive; the pipes not destroyed keep the script open
// for the grandchild's 60 s (a leftover outside the tree, as a WMI-started board); endRuns doing nothing leaves the running stub and its grandchild.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const skip = process.platform === 'win32' ? false : 'the runs here start PowerShell: Windows only'
const HELPER = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'runTree.mjs')).href
const sleep = ms => new Promise(done => setTimeout(done, ms))

const alive = pid => {
  if (process.platform === 'win32') return spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).stdout.includes(` ${pid} `)
  try { process.kill(pid, 0); return true } catch { return false }
}

/** A folder with the stub (a program that starts a grandchild holding its pipe for 60 s, then waits) and the outer script. */
async function makeCase(t, body, { stubEnds = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'run-tree-'))
  const pidFile = join(dir, 'grandchild.txt')
  t.after(async () => {
    if (existsSync(pidFile)) spawnSync('taskkill', ['/PID', readFileSync(pidFile, 'utf8').trim(), '/T', '/F'], { windowsHide: true })
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  // The grandchild writes its own pid, then holds the pipe it inherited from PowerShell (as git, a gate or a board does when
  // land.ps1 starts it: a child node starts itself lets go of its pipe on Windows, one PowerShell starts does not).
  await writeFile(join(dir, 'grandchild.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetTimeout(() => {}, 60_000)\n`)
  const node = `& '${process.execPath}' '${join(dir, 'grandchild.mjs')}'`
  await writeFile(join(dir, 'stub.ps1'), [
    "Write-Output 'stub runs'",
    // Ending by itself, its grandchild is outside any tree the run could end (as a WMI-started board is).
    stubEnds ? `Start-Process -NoNewWindow -FilePath '${process.execPath}' -ArgumentList '"${join(dir, 'grandchild.mjs')}"'; Start-Sleep -Milliseconds 1500; exit 0` : node,
  ].join('\r\n'))
  await writeFile(join(dir, 'outer.mjs'), [`import { endRuns, runTree } from ${JSON.stringify(HELPER)}`, `const stub = ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ${JSON.stringify(join(dir, 'stub.ps1'))}]]`, body].join('\n'))
  const started = Date.now()
  const outer = spawn(process.execPath, [join(dir, 'outer.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  outer.stdout.on('data', chunk => { out += chunk })
  outer.stderr.on('data', chunk => { out += chunk })
  const ended = await Promise.race([new Promise(done => outer.on('close', () => done(true))), sleep(20_000).then(() => false)])
  if (!ended) spawnSync('taskkill', ['/PID', String(outer.pid), '/T', '/F'], { windowsHide: true })
  return { ended, seconds: (Date.now() - started) / 1000, out: out.replace(/\r/g, '').trim(), grandchild: existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null }
}

test('B1575: a run past its late timer is ended with its whole tree, and the test file ends within 15 s (not at the grandchild\'s 60 s)', { skip }, async t => {
  const run = await makeCase(t, [
    'const ran = await runTree(...stub, {}, { lateMs: 4000 })',
    'console.log(JSON.stringify(ran))',
  ].join('\n'))
  assert.ok(run.ended, `the outer script is still open after 20 s: ${run.out}`)
  assert.ok(run.seconds < 15, `ended after ${run.seconds} s`)
  const ran = JSON.parse(run.out.split('\n').at(-1))
  assert.equal(ran.status, 1, 'taskkill /F ends the stub with 1')
  assert.match(ran.out, /stub runs/, 'what the run wrote before its end is kept')
  await sleep(500)
  assert.equal(alive(run.grandchild), false, 'the grandchild that held the pipe is ended with the tree')
})

test('B1575: a run still running at a test\'s clean-up is ended there with its whole tree (endRuns)', { skip }, async t => {
  const run = await makeCase(t, [
    'const runs = new Set()',
    "const ran = runTree(...stub, {}, { lateMs: 600_000, runs })",
    'await new Promise(done => setTimeout(done, 4000))',
    "console.log('running: ' + runs.size)",
    'endRuns(runs)',
    "const got = await ran",
    "console.log('ended: ' + runs.size + ' ' + got.status)",
  ].join('\n'))
  assert.ok(run.ended, `the outer script is still open after 20 s: ${run.out}`)
  assert.ok(run.seconds < 15, `ended after ${run.seconds} s`)
  assert.match(run.out, /^running: 1$/m)
  assert.match(run.out, /^ended: 0 1$/m)
  await sleep(500)
  assert.equal(alive(run.grandchild), false, 'the grandchild is ended with the tree')
})

test('B1575: a run that ends by itself gives its whole output and status at once', { skip }, async t => {
  const run = await makeCase(t, [
    "const ran = await runTree(process.execPath, ['-e', 'console.log(\"a\"); console.error(\"b\"); process.exit(3)'], {}, { lateMs: 60_000 })",
    'console.log(JSON.stringify(ran))',
  ].join('\n'))
  assert.ok(run.ended && run.seconds < 10, `ended after ${run.seconds} s: ${run.out}`)
  const ran = JSON.parse(run.out.split('\n').at(-1))
  assert.equal(ran.status, 3)
  assert.deepEqual(ran.out.split('\n').sort(), ['a', 'b'])
})

test('B1575: a leftover outside the run\'s tree (its starter ended by itself) that holds the pipe does not keep the test file open', { skip }, async t => {
  const run = await makeCase(t, [
    'const ran = await runTree(...stub, {}, { lateMs: 60_000 })',
    'console.log(JSON.stringify(ran))',
  ].join('\n'), { stubEnds: true })
  assert.ok(run.ended, `the outer script is still open after 20 s: ${run.out}`)
  assert.ok(run.seconds < 15, `ended after ${run.seconds} s`)
  const ran = JSON.parse(run.out.split('\n').at(-1))
  assert.deepEqual([ran.status, ran.out], [0, 'stub runs'])
  assert.equal(alive(run.grandchild), true, 'the leftover is outside the tree: it still runs (the clean-up ends it)')
})
