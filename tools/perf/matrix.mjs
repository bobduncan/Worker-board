// S0 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-25): the premise test. Does keeping heavy runs
// off the person's cores (logical processors 0-3, two P-cores) take the stutter away? Each case runs one load (or none), and
// while it runs the lag probe (and, with --video, the video probe) measures; the load's own run time is kept beside it, so the
// cost of a fence in speed shows too. The pins use `start /AFFINITY` for this measurement only.
//
// Every case goes through the heavy-run queue as an ordinary run (label perf-s0-<case>), never beside a landing's gate:
//   node tools/perf/matrix.mjs --all [--cases a,b,c] [--video a,b] [--game <folder>] [--card <folder>] [--board <folder>]
//   node tools/perf/matrix.mjs --table <file.jsonl>   (the table of a matrix's lines)
// One case on its own, already holding the queue (what --all runs for each case):
//   node tools/perf/matrix.mjs --case <id> --out <file.jsonl> ...

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { probe } from './lag-probe.mjs'
import { dataFolder, localDay } from './run-share.mjs'
import { videoProbe } from './video-probe/video-probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const BOARD = resolve(HERE, '..', '..')

/** The masks of this PC (24 logical processors: 0-15 the 8 P-cores with their threads, 16-23 the E-cores). */
export const MASKS = Object.freeze({
  work: 'FFFFF0', // LP4-23: all but the person's two P-cores
  eCores: 'FF0000', // LP16-23
  low: 'C00000', // LP22-23: the board's Low level (cpu.mjs), at Idle
})

/**
 * The cases (the plan's a-g, and chat 1's h): `load` is the folder role and command, `mask` the affinity (none: as today),
 * `low` starts it at Idle (Low's priority).
 */
export const CASES = Object.freeze([
  { id: 'a', what: 'idle', load: null },
  { id: 'b', what: 'game screen check as today (all cores, below normal)', load: { in: 'game', command: 'npm run test:screens' } },
  { id: 'c', what: 'the same pinned to LP4-23', load: { in: 'game', command: 'npm run test:screens' }, mask: MASKS.work },
  { id: 'd', what: 'the same pinned to the E-cores LP16-23', load: { in: 'game', command: 'npm run test:screens' }, mask: MASKS.eCores },
  { id: 'e', what: 'the card screen check (B1517)', load: { in: 'card', command: 'npm run test:screens' } },
  { id: 'f', what: 'a board gate as today', load: { in: 'board', command: 'npm test' } },
  { id: 'g', what: 'a board gate pinned to LP4-23', load: { in: 'board', command: 'npm test' }, mask: MASKS.work },
  // h runs the screen check's own command, not npm run test:screens: the game's queue helper starts its command at below
  // normal (startLow, B1520), which would lift the Idle that Low sets.
  { id: 'h', what: 'Low: the screen check on LP22-23 at Idle', load: { in: 'game', command: 'node tools/visual/getChromium.mjs && npx vitest run -c vitest.screens.config.ts' }, mask: MASKS.low, low: true },
])

export const caseOf = id => CASES.find(one => one.id === id) ?? null

/** How long the load warms up before the probe starts, and the longest the probe runs. */
export const WARM_S = 20
export const PROBE_S = 180

/**
 * The command line that starts a case's load: as given when it has no mask; else `start /B /WAIT /AFFINITY <mask> [/LOW]`, so
 * the load and everything it starts in turn sit on the mask (Windows hands a process's affinity to its children).
 */
export function loadCommand(one) {
  if (one.load === null) return null
  if (!one.mask) return one.load.command
  return `start "" /B /WAIT${one.low ? ' /LOW' : ''} /AFFINITY ${one.mask} cmd /d /s /c "${one.load.command}"`
}

/** The arguments of the queue's helper that runs one case while holding its slot (an ordinary run, never ahead of a gate). */
export function queuedCaseArgs(id, options) {
  const rest = Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== '').flatMap(([key, value]) => [`--${key}`, String(value)])
  return [join(BOARD, 'tools', 'one-at-a-time.mjs'), `perf-s0-${id}`, '--', `node "${join(HERE, 'matrix.mjs')}" --case ${id} ${rest.map(part => (/\s/.test(part) ? `"${part}"` : part)).join(' ')}`]
}

/** The folder a load runs in. */
export function folderOf(one, folders) {
  if (one.load === null) return null
  return folders[one.load.in] ?? null
}

/** Runs one case (the caller holds the queue's slot): the line of its numbers. */
export async function runCase(one, { folders = {}, video = false, probeS = PROBE_S, warmS = WARM_S, env = process.env } = {}) {
  const at = new Date().toISOString()
  const line = { case: one.id, what: one.what, at, mask: one.mask ?? null, low: one.low === true }
  if (one.load === null) {
    const [lag, seen] = await Promise.all([probe({ seconds: probeS, label: one.id }), video ? videoProbe({ seconds: probeS, label: one.id }) : null])
    return { ...line, ...lagOf(lag), ...(seen ? videoOf(seen) : {}) }
  }
  const cwd = folderOf(one, folders)
  if (!cwd || !existsSync(cwd)) return { ...line, why: `no folder for the ${one.load.in} load (--${one.load.in})` }
  const began = Date.now()
  // HEAVY_RUN_HELD: the load's own heavy run is part of this case's slot, as a gate's screen check is part of the gate.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', loadCommand(one)], { cwd, windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HEAVY_RUN_HELD: '1' } })
  let tail = ''
  const keep = data => (tail = `${tail}${data}`.slice(-4000))
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let ended = false
  const exit = new Promise(done => child.on('close', code => { ended = true; done(code) }))
  await Promise.race([exit, new Promise(wait => setTimeout(wait, warmS * 1000))])
  const [lag, seen] = ended ? [null, null] : await Promise.all([probe({ seconds: probeS, label: one.id, stopped: () => ended }), video ? videoProbe({ seconds: probeS, label: one.id }) : null])
  const code = await exit
  return {
    ...line, load: one.load.command, folder: cwd, loadRunS: Math.round((Date.now() - began) / 1000), loadExit: code,
    ...(lag ? lagOf(lag) : { why: `the load ended within its ${warmS} s warm-up` }), ...(seen ? videoOf(seen) : {}),
    ...(code === 0 ? {} : { loadTail: tail.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ') }),
  }
}

const lagOf = lag => ({ probeS: lag.seconds, p50: lag.p50, p99: lag.p99, latePct: lag.latePct, stallP99: lag.stallP99, stallPct: lag.stallPct, lp03Mean: lag.lp03Mean, lp03Max: lag.lp03Max, totalMean: lag.totalMean, msmpengMean: lag.msmpengMean, msmpengMax: lag.msmpengMax })
const videoOf = seen => (seen.why ? { videoWhy: seen.why } : { dropped: seen.dropped, frames: seen.total, droppedPct: seen.droppedPct, gapP99: seen.gapP99, hitches: seen.hitches })

/** The table of a matrix's lines, as Markdown. */
export function tableOf(lines) {
  const cell = value => (value === undefined || value === null ? '' : String(value))
  const rows = [
    '| case | what | p99 late ms | late % | stall p99 ms | stall % | LP0-3 mean / max % | PC % | Defender cores mean / max | dropped frames | load run s | load exit |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const one of lines) {
    rows.push(`| ${one.case} | ${one.what}${one.why ? ` (${one.why})` : ''} | ${cell(one.p99)} | ${cell(one.latePct)} | ${cell(one.stallP99)} | ${cell(one.stallPct)} | ${one.lp03Mean === undefined ? '' : `${one.lp03Mean} / ${one.lp03Max}`} | ${cell(one.totalMean)} | ${one.msmpengMean === undefined ? '' : `${one.msmpengMean} / ${one.msmpengMax}`} | ${one.frames === undefined ? cell(one.videoWhy) : `${one.dropped} of ${one.frames}`} | ${cell(one.loadRunS)} | ${cell(one.loadExit)} |`)
  }
  return `${rows.join('\n')}\n`
}

const readLines = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== '').flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } }) : [])

function argOf(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const folders = { game: argOf(argv, '--game'), card: argOf(argv, '--card'), board: argOf(argv, '--board') }
  const out = argOf(argv, '--out') ?? join(dataFolder(), 'perf', `s0-${localDay(Date.now())}.jsonl`)
  mkdirSync(dirname(out), { recursive: true })
  if (argOf(argv, '--table') !== undefined) {
    const lines = readLines(argOf(argv, '--table'))
    console.log(tableOf(lines))
  } else if (argOf(argv, '--case') !== undefined) {
    const one = caseOf(argOf(argv, '--case'))
    if (one === null) throw new Error(`There is no case ${argOf(argv, '--case')}.`)
    const line = await runCase(one, { folders, video: argv.includes('--video'), probeS: Number(argOf(argv, '--probe') ?? PROBE_S) })
    appendFileSync(out, `${JSON.stringify(line)}\n`)
    console.log(JSON.stringify(line))
  } else if (argv.includes('--all')) {
    const ids = (argOf(argv, '--cases') ?? CASES.map(one => one.id).join(',')).split(',')
    const withVideo = new Set((argOf(argv, '--video') ?? '').split(',').filter(Boolean))
    console.log(`The S0 matrix starts at ${new Date().toLocaleTimeString()}: cases ${ids.join(', ')}; lines go to ${out}.`)
    for (const id of ids) {
      const options = { out, game: folders.game, card: folders.card, board: folders.board, probe: argOf(argv, '--probe') }
      const args = queuedCaseArgs(id, options)
      if (withVideo.has(id)) args[args.length - 1] += ' --video'
      const done = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env: process.env })
      console.log(`case ${id}: ended ${done.status === 0 ? 'well' : `with ${done.status}`} at ${new Date().toLocaleTimeString()}`)
    }
    const table = tableOf(readLines(out))
    writeFileSync(out.replace(/\.jsonl$/, '.md'), table)
    console.log(`The S0 matrix ended at ${new Date().toLocaleTimeString()}.\n${table}`)
  } else {
    console.log('Use --all, --case <id> or --table <file.jsonl>; see the top of this file.')
  }
}
