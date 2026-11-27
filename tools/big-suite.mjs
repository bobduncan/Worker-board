// S9: the big suite. Every test file of main, in a worktree of its own in the temporary folder, through the PC's one-at-a-time queue:
// as `idle:big-suite` (it waits for an idle PC, S3), or as an ordinary `yield:big-suite` run when it is overdue (src/bigSuite.mjs labelFor;
// an idle run still waiting at that moment is stopped and started anew as an ordinary one). Both give way to a gate (P4) and start
// over after it. How it works: src/bigSuite.mjs.
//
//   node tools/big-suite.mjs --run <main checkout>   (the board starts it when it is due, server.mjs)
//   node tools/big-suite.mjs --status                 (a gate's start: a red run, the files on probation)
//
// Its worktree gets the main checkout's node_modules as a junction, as land.ps1's gate does, and loses it first, with rmdir (never a
// recursive delete through it); then `git worktree remove` without force, and only while the main checkout's node_modules still
// holds its marker package.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  IDLE_LABEL, ORDINARY_LABEL, RERUN_LABEL, RUN_FOLDER, bigRunQueued, giveBackRunner, labelFor, readJson, recordRun, stateFiles, statusLines, takeRunner, touchRunner, writeJson,
} from '../src/bigSuite.mjs'
import { asRepoPath } from '../src/lightCheck.mjs'
import { failingFiles, gatePassed } from '../src/landing.mjs'
import * as tool from './one-at-a-time.mjs'

/** The exit code one-at-a-time gives a run it stopped at its hold cap (S3): such a run could not run, it is no red of main. */
export const STOPPED = 124
const NODE_MODULES_MARKER = 'happy-dom'
const UPGRADE_LOOK_MS = 60 * 1000
/** Core review: at most this many failing files run again alone (a broken shared module fails dozens; the rest stay red). */
export const RERUNS_MAX = 10
/** Core review: the log beside the lock goes to `.old` past this size, so it never grows for good. */
const LOG_MAX_BYTES = 5 * 1024 * 1024

/** The log goes to `<log>.old` once it is past LOG_MAX_BYTES. */
export function rotateLog(log, maxBytes = LOG_MAX_BYTES) {
  try {
    if (statSync(log).size > maxBytes) renameSync(log, `${log}.old`)
  } catch {
    // no log yet, or held: it grows a little more
  }
}
/** one-at-a-time's line when a run takes its slot (F14): until then an idle run only waits, and may be started anew as ordinary. */
export const RUNS_NOW = /one-at-a-time: .+ runs now/
/** P4: one-at-a-time's line when a run gave way to a gate (its gaveWayLine): the run waits again, and its command starts over. */
export const GAVE_WAY = /one-at-a-time: .+ gives way to a gate[^\n]*\n/g
export { RERUN_LABEL }

export const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

/**
 * A test file as the light check names it (core review: node prints `test at test\a.test.mjs` on Windows, and a `location:` line may give
 * the whole path in the run's worktree): "/" between folders, from the repository's root. PURE.
 */
export function repoTestPath(file, folder = null) {
  const path = asRepoPath(file)
  const root = folder === null ? null : `${asRepoPath(folder).replace(/\/+$/, '')}/`
  if (root !== null && path.toLowerCase().startsWith(root.toLowerCase())) return path.slice(root.length)
  if (/^(?:[a-z]:)?\//i.test(path)) {
    const at = path.lastIndexOf('/test/')
    if (at >= 0) return path.slice(at + 1)
  }
  return path
}

/** The files a stalled run left open, from test.mjs's stall line ("files still open: a (…), b (…)"). PURE. */
export function stalledFiles(output, folder = null) {
  const line = /^stalled: .*files still open: (.+)$/m.exec(output)?.[1] ?? ''
  return line.split(/,\s*/).map(part => repoTestPath(part.replace(/\s*\(.*$/, '').trim(), folder)).filter(part => part.startsWith('test/'))
}

/**
 * The verdict of a big run from its whole output and exit code: `{ outcome, failed, why }`, the files as repository paths. Stopped at
 * the queue's hold cap (124, or one-at-a-time's line): could not run, never red. A stall is red with the files left open. PURE.
 */
export function verdictOf(output, code, folder = null) {
  if (code === STOPPED || /^one-at-a-time: .+ ran longer than \d+ minutes and was stopped\s*$/m.test(output)) {
    return { outcome: 'could not run', failed: [], why: 'stopped at the test queue\'s hold cap (code 124)' }
  }
  const passed = gatePassed(output, 'board', code)
  if (passed.ok) return { outcome: 'passed', failed: [], why: null }
  if (passed.stalled) return { outcome: 'failed', failed: stalledFiles(output, folder), why: passed.why, stalled: true }
  if (/no summary line/.test(passed.why) && code !== 0 && !/^ℹ tests \d+/m.test(output)) return { outcome: 'could not run', failed: [], why: passed.why }
  // Only test files (verifier: a `location:` line in a helper module is no file to run again alone).
  const failed = [...new Set(failingFiles(output).map(file => repoTestPath(file, folder)))].filter(file => file.startsWith('test/'))
  return { outcome: 'failed', failed, why: passed.why }
}

/**
 * Whether a run's ticket waits in the idle room (`room`): only then is an idle run that is overdue stopped and started again as an
 * ordinary one (it has not taken a slot). A room that cannot be read counts as waiting (verifier: else an overdue run waited for good).
 */
export function waitsInRoom(room, label, folder) {
  try {
    return readdirSync(room).some(name => {
      const ticket = readJson(path.join(room, name), null)
      return ticket?.label === label && path.resolve(String(ticket.cwd ?? '')).toLowerCase() === path.resolve(folder).toLowerCase()
    })
  } catch {
    return true
  }
}

/** What the runner does outside its own bookkeeping: the seam the tests give their own. */
export function bigSuiteSteps(repo, env = process.env) {
  const lock = tool.lockPath(env)
  const files = stateFiles(lock)
  return {
    mainHead: () => {
      const out = git(['rev-parse', 'refs/heads/main'], repo)
      return out.status === 0 ? out.stdout.trim() : null
    },
    prepare(folder, commit) {
      if (existsSync(folder)) this.cleanUp(folder)
      git(['worktree', 'prune'], repo)
      const add = git(['worktree', 'add', '--detach', folder, commit], repo)
      if (add.status !== 0) throw new Error(`git worktree add failed: ${(add.stderr || add.stdout).trim().split('\n')[0]}`)
      const link = spawnSync('cmd.exe', ['/c', 'mklink', '/J', path.join(folder, 'node_modules'), path.join(repo, 'node_modules')], { encoding: 'utf8', windowsHide: true })
      if (link.status !== 0) throw new Error(`mklink failed: ${(link.stderr || link.stdout).trim()}`)
    },
    /**
     * Runs the suite in `folder` with `label` (`only` the test files, none for every file); resolves to `{ code, output, ranAt }`, `ranAt`
     * when it took its slot. `upgrade()` true stops an idle run that still waits in the idle room (and only then: core review).
     */
    run(folder, label, { upgrade, only = [] }) {
      return new Promise((resolve) => {
        rotateLog(files.log)
        appendFileSync(files.log, `\n===== big suite ${label} in ${folder} at ${new Date().toISOString()} =====\n`)
        const child = spawn(process.execPath, [path.join(folder, 'tools', 'one-at-a-time.mjs'), label, '--', 'node', 'tools/test.mjs', ...only], { cwd: folder, env, windowsHide: true })
        let output = ''
        let ranAt = null
        const take = (chunk) => {
          const text = String(chunk)
          output += text
          // P4: a run that gave way to a gate starts over: what it said before (the half of a stopped suite) is no part of its verdict,
          // and it holds no slot until its next "runs now" (so an idle one may be started anew as ordinary again).
          const gave = [...output.matchAll(GAVE_WAY)].at(-1)
          if (gave !== undefined) {
            output = output.slice(gave.index + gave[0].length)
            ranAt = null
          }
          // On the whole output, not the chunk: the line may come in two pieces (verifier).
          if (ranAt === null && RUNS_NOW.test(output)) ranAt = Date.now()
          appendFileSync(files.log, text)
        }
        child.stdout.on('data', take)
        child.stderr.on('data', take)
        // Its ticket in the idle room: the run has not taken a slot yet (its "runs now" line may be on its way: never kill on that alone).
        const look = setInterval(() => {
          if (ranAt === null && upgrade() && waitsInRoom(tool.idleRoomOf(lock), label, folder)) {
            clearInterval(look)
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
            resolve({ code: null, output, upgraded: true, ranAt })
          }
        }, UPGRADE_LOOK_MS)
        look.unref()
        child.on('error', () => {
          clearInterval(look)
          resolve({ code: 127, output, ranAt })
        })
        child.on('close', (code) => {
          clearInterval(look)
          resolve({ code: code ?? 1, output, ranAt })
        })
      })
    },
    cleanUp(folder) {
      const junction = path.join(folder, 'node_modules')
      if (existsSync(junction)) {
        spawnSync('cmd.exe', ['/c', 'rmdir', junction], { windowsHide: true })
        if (existsSync(junction)) throw new Error(`the junction ${junction} could not be removed: remove it with cmd /c rmdir, never a recursive delete`)
      }
      if (!existsSync(path.join(repo, 'node_modules', NODE_MODULES_MARKER))) throw new Error(`the main checkout's node_modules lost ${NODE_MODULES_MARKER}: the worktree ${folder} was left`)
      const removed = git(['worktree', 'remove', folder], repo)
      if (removed.status !== 0) {
        // Verifier: a folder git does not know as a worktree (its entry pruned, a half-made one) would fail every run of its commit.
        // Its junction is gone (checked above), so nothing outside it is reached: it goes as a plain folder.
        const known = git(['worktree', 'list', '--porcelain'], repo).stdout ?? ''
        const ours = known.split('\n').some(line => line.startsWith('worktree ') && path.resolve(line.slice(9)).toLowerCase() === path.resolve(folder).toLowerCase())
        if (ours || existsSync(junction)) throw new Error(`git worktree remove failed: ${(removed.stderr || removed.stdout).trim().split('\n')[0]}`)
        rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
      git(['worktree', 'prune'], repo)
    },
    /** Core review: the folders of big runs a killed runner left (a sleep, a reboot), each cleaned as a run's own: the junction first. */
    sweep(root = os.tmpdir()) {
      let names = []
      try {
        names = readdirSync(root).filter(name => name.startsWith(RUN_FOLDER))
      } catch {
        // no temporary folder to read
      }
      for (const name of names) {
        try {
          this.cleanUp(path.join(root, name))
        } catch (error) {
          appendFileSync(files.log, `big suite: could not sweep ${name}: ${error.message}\n`)
        }
      }
    },
  }
}

/**
 * One big run of main's head: the runner file renewed before each phase (a runner that lost it stops at once; it removes the folder it
 * made unless the new runner plays the same commit), the run in its worktree, each failing file run again alone once (core review: as
 * land.ps1 does; one that passes alone is flaky, not red), the verdict recorded, the folder removed. Resolves to what it recorded, or
 * null when nothing ran (no main, another runner).
 */
export async function playOnce({ files, steps, now = Date.now }) {
  const commit = steps.mainHead()
  if (!commit) return null
  if (!touchRunner(files.runner)) return null
  const folder = path.join(os.tmpdir(), `${RUN_FOLDER}${commit.slice(0, 9)}`)
  const lost = () => {
    if (steps.mainHead() !== commit) {
      try {
        steps.cleanUp(folder)
      } catch (error) {
        appendFileSync(files.log, `big suite: could not remove ${folder}: ${error.message}\n`)
      }
    }
    return null
  }
  const started = now()
  let began = started
  let verdict = { outcome: 'could not run', failed: [], why: null }
  let { label, idleUntil } = labelFor({ results: readJson(files.results), now: started })
  try {
    steps.prepare(folder, commit)
    if (!touchRunner(files.runner)) return lost()
    let ran = await steps.run(folder, label, { upgrade: () => label === IDLE_LABEL && now() >= idleUntil })
    if (ran.upgraded) {
      label = ORDINARY_LABEL
      if (!touchRunner(files.runner)) return lost()
      ran = await steps.run(folder, label, { upgrade: () => false })
    }
    // Core review: a run counts from when it took its slot (an idle run that waited from 23:00 and ran at 01:10 is the night run).
    if (Number.isFinite(ran.ranAt)) began = ran.ranAt
    verdict = verdictOf(ran.output, ran.code, folder)
    if (verdict.outcome === 'failed' && !verdict.stalled && verdict.failed.length > 0) {
      const again = []
      const flaky = []
      for (const [index, file] of verdict.failed.entries()) {
        if (index >= RERUNS_MAX) {
          again.push(file)
          continue
        }
        if (!touchRunner(files.runner)) return lost()
        const alone = await steps.run(folder, RERUN_LABEL, { upgrade: () => false, only: [file] })
        const aloneVerdict = verdictOf(alone.output, alone.code, folder)
        // Verifier: a rerun that could not run (the cap, a spawn that failed) proves nothing either way: the big run could not run.
        if (aloneVerdict.outcome === 'could not run') throw new Error(`the rerun alone of ${file} could not run (${aloneVerdict.why})`)
        if (aloneVerdict.outcome === 'passed') flaky.push(file)
        else again.push(file)
      }
      verdict = again.length > 0
        ? { ...verdict, failed: again, flaky }
        : { outcome: 'passed', failed: [], flaky, why: `${flaky.length} file(s) failed in the full run and passed alone` }
    }
  } catch (error) {
    verdict = { outcome: 'could not run', failed: [], why: error.message }
  }
  if (!touchRunner(files.runner)) return lost()
  const { stalled: _stalled, ...kept } = verdict
  const run = { commit, ...kept, label, at: new Date(began).toISOString(), seconds: Math.round((now() - began) / 1000) }
  writeJson(files.results, recordRun(readJson(files.results), run))
  // The result is in: the folder is this runner's (its fresh file keeps any other out, and nobody plays a commit just run).
  try {
    steps.cleanUp(folder)
  } catch (error) {
    appendFileSync(files.log, `big suite: could not remove ${folder}: ${error.message}\n`)
  }
  return run
}

/** The runner: takes the runner file (S3's rules), plays one run, gives the file back while it is its own. */
export async function runner(repo, env = process.env, steps = bigSuiteSteps(repo, env)) {
  const lock = tool.lockPath(env)
  const files = stateFiles(lock)
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    // not allowed here: normal priority
  }
  // Core review: never beside a big run of the queue, also one whose runner died (its one-at-a-time child may still run).
  if (bigRunQueued(lock, tool)) return null
  // (With no big run queued, a live runner's file is alive only by its age.)
  if (!takeRunner(files.runner, Date.now())) return null
  try {
    // Core review: what a killed runner left goes first (only this runner lives now).
    steps.sweep?.()
    return await playOnce({ files, steps })
  } finally {
    giveBackRunner(files.runner)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const files = stateFiles(tool.lockPath())
  if (argv.includes('--status')) {
    const results = readJson(files.results)
    const lines = statusLines(results, Date.now())
    for (const line of lines) console.log(line)
    if (lines.length === 0 && !argv.includes('--quiet')) console.log(results.last ? `big suite: ${results.last.outcome} on main at ${String(results.last.commit).slice(0, 7)} (${results.last.at})` : 'big suite: no run yet')
  } else if (argv.includes('--run')) {
    const repo = argv[argv.indexOf('--run') + 1]
    runner(repo).then((run) => {
      console.log(run ? `big suite: ${String(run.commit).slice(0, 7)} ${run.outcome}${run.why ? ` (${run.why})` : ''}` : 'big suite: nothing ran (another runner, or no main)')
    }, (error) => {
      console.log(`big suite: ${error.stack ?? error}`)
      process.exitCode = 1
    })
  } else {
    console.log('Usage: node tools/big-suite.mjs --run <main checkout> | --status [--quiet]')
    process.exitCode = 2
  }
}
