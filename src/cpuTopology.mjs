// S4 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-26): the PC's core map. Which logical
// processors are the person's (the first two performance cores, both threads: the person's choice of 2026-11-25), which
// are the work's (all the others) and which are Low's (what the board's Low uses: the last two). Read once per PC with one
// PowerShell call (GetSystemCpuSetInformation: EfficiencyClass and CoreIndex per logical processor) and kept in
// data/cpu-topology.json, also when there is none to read. A PC with no map (not Windows, more than 64 logical
// processors, a failed read) has no mode file: every reader then keeps today's behaviour.
//
// The mode file (%TEMP%/one-heavy-run.lock.mode.json, beside the heavy-run queue's lock) says the level and the masks
// to the queue's launchers (S5), with its owner (pid, port, project) and a beat. Only the person's board writes it
// (`heavyModeWriter: true` in its config); a reader takes a file whose owner is gone or whose beat is old for none.

import { readFileSync, rmSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { affinityMask, lowCores } from './cpu.mjs'
import { writeAtomic } from './write.mjs'

/** The person's choice (2026-11-25): two performance cores kept free in Full. Low's cores are the limiter's own (cpu.mjs). */
export const PERSON_CORES = 2

/** The PowerShell that reads the CPU sets: `group,logical,core,efficiencyClass;` per logical processor. */
export const TOPOLOGY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices; using System.Text;',
  'public static class BoardCpuSets {',
  '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetSystemCpuSetInformation(IntPtr info, uint length, out uint returned, IntPtr process, uint flags);',
  '  public static string Read() {',
  '    uint n; GetSystemCpuSetInformation(IntPtr.Zero, 0, out n, IntPtr.Zero, 0);',
  '    if (n == 0) return "";',
  '    IntPtr b = Marshal.AllocHGlobal((int)n);',
  '    try {',
  '      if (!GetSystemCpuSetInformation(b, n, out n, IntPtr.Zero, 0)) return "";',
  '      StringBuilder sb = new StringBuilder(); int off = 0;',
  '      while (off < n) { int size = Marshal.ReadInt32(b, off); if (size <= 0) break;',
  "        sb.Append(Marshal.ReadInt16(b, off + 12)).Append(',').Append(Marshal.ReadByte(b, off + 14)).Append(',').Append(Marshal.ReadByte(b, off + 15)).Append(',').Append(Marshal.ReadByte(b, off + 18)).Append(';');",
  '        off += size; }',
  '      return sb.ToString();',
  '    } finally { Marshal.FreeHGlobal(b); }',
  '  }',
  '}',
  "'@",
  '[Console]::Out.WriteLine([BoardCpuSets]::Read())',
].join('\n')

/** The rows of a topology, checked: `[{ group, logical, core, efficiency }]` of non-negative integers, or null. */
export function validTopology(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const good = rows.every(one => one !== null && typeof one === 'object' && ['group', 'logical', 'core', 'efficiency'].every(key => Number.isInteger(one[key]) && one[key] >= 0))
  return good ? rows.map(({ group, logical, core, efficiency }) => ({ group, logical, core, efficiency })) : null
}

/** The script's output as `[{ group, logical, core, efficiency }]`, or null when it is none. */
export function parseTopology(text) {
  const rows = String(text ?? '').trim().split(';').filter(Boolean).map(part => part.split(',').map(Number))
  if (rows.some(row => row.length !== 4)) return null
  return validTopology(rows.map(([group, logical, core, efficiency]) => ({ group, logical, core, efficiency })))
}

const hex = mask => `0x${mask.toString(16).toUpperCase().padStart(6, '0')}`
const maskOfList = list => list.reduce((mask, one) => mask | (1n << BigInt(one.logical)), 0n)

/**
 * The masks of a topology, or null when it has none: one processor group, at most 64 logical processors, and room for
 * work beside the person's cores. `person`: every thread of the first `personCores` performance cores (one on a PC with
 * two or fewer, so the work is never left the efficiency cores alone); `work`: the rest; `low`: what the board's Low
 * uses, taken from the limiter itself (cpu.mjs `affinityMask` and `lowCores`: one rule, one place). Masks are BigInts;
 * `hexOf` writes them.
 */
export function masksOf(topology, { personCores = PERSON_CORES } = {}) {
  const rows = validTopology(topology)
  if (rows === null || rows.length > 64 || rows.some(one => one.group !== 0 || one.logical >= 64)) return null
  const sorted = [...rows].sort((a, b) => a.logical - b.logical)
  const best = Math.max(...sorted.map(one => one.efficiency))
  const performance = sorted.filter(one => one.efficiency === best)
  const cores = [...new Set(performance.map(one => one.core))]
  const kept = new Set(cores.slice(0, cores.length <= 2 ? 1 : personCores))
  const personList = performance.filter(one => kept.has(one.core))
  const workList = sorted.filter(one => !personList.includes(one))
  if (workList.length === 0) return null
  return {
    person: maskOfList(personList),
    work: maskOfList(workList),
    low: BigInt.asUintN(64, BigInt(affinityMask(sorted.length, 'low'))),
    threads: { person: personList.length, work: workList.length, low: lowCores(sorted.length), all: sorted.length },
  }
}

/** The masks as hex strings (`0xFFFFF0`), for the mode file and the panel. */
export function hexOf(masks) {
  return masks === null ? null : { person: hex(masks.person), work: hex(masks.work), low: hex(masks.low) }
}

/**
 * The topology, kept in `file` per count of logical processors: `{ topology }`, or `{ none: why }` when this PC has no map.
 * A PC that is not Windows has none and reads nothing. A read that fails, or a map the cache cannot hold, is kept as none
 * too, so the next start does not read again (chat 1's review: a failed read is information, not a failing loop).
 */
export async function topologyOf({ file, logical, platform = process.platform, read, write = writeAtomic }) {
  if (platform !== 'win32') return { none: 'not Windows' }
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'))
    if (cached?.logical === logical) {
      if (typeof cached.none === 'string') return { none: cached.none }
      const topology = validTopology(cached.topology)
      if (topology !== null && topology.length === logical) return { topology }
    }
  } catch {
    // Not cached yet, or broken: read anew.
  }
  let found
  try {
    const topology = parseTopology(await read())
    found = topology === null ? { none: 'the CPU sets came back empty' } : { topology }
  } catch (error) {
    found = { none: `the CPU sets could not be read (${error instanceof Error ? error.message : 'unknown'})` }
  }
  await write(file, `${JSON.stringify({ at: Date.now(), logical, ...found })}\n`)
  return found
}

/**
 * Chat 1's review: the mode file is the person's board's alone, by an opt-in in its config (`heavyModeWriter: true`, which
 * setup gives the PC's first board): never a trial copy, the Test board, a test board started by a test file, the demo,
 * a board that shows another's history, or a board in a gate's run.
 */
export function writesModeOf({ platform = process.platform, config, isDemo, isShowOnly, historyFrom, env = process.env }) {
  return platform === 'win32' && config?.heavyModeWriter === true && !isDemo && !isShowOnly && historyFrom === undefined && typeof config?.project === 'string' && config.project !== '' && env.HEAVY_RUN_HELD !== '1'
}

/** Where the mode file is: beside the heavy-run queue's lock (HEAVY_RUN_LOCK, else the temp folder's one-heavy-run.lock). */
export function modeFileOf(env = process.env) {
  return `${env.HEAVY_RUN_LOCK || join(tmpdir(), 'one-heavy-run.lock')}.mode.json`
}

/** How old the mode file's beat may be before a reader takes it for no file (the queue's helper, S5). */
export const MODE_BEAT_STALE_MS = 2 * 60 * 1000

/** The mode file's content: the level, the masks in hex, their thread counts, since when and by whom, its owner and its beat. */
export function modeOf({ level, masks, since, who, owner, beat }) {
  return { level, masks: hexOf(masks), threads: { work: masks.threads.work, low: masks.threads.low }, since, who, ...owner, beat }
}

/**
 * The writer of the mode file, owned by one board (`owner`: `{ pid, port, project }`). `level()` records the level at once
 * (the CPU loop never waits on it), `masks()` gives the core map when it is read (null: no map, no file), `beat()` writes the
 * beat on every CPU pass and tries again a write that failed. One write at a time, always of the latest state, so a level
 * set while the start's write runs is never overwritten by it. `stop()` removes the file on a clean stop, when it is still
 * this board's. `run` records a write's failure (the server's loops.run); the writer itself never throws.
 */
export function modeWriter({ file, owner, now = Date.now, write = writeAtomic, remove = path => rm(path, { force: true }), run = fn => fn() }) {
  let state = null
  let masks
  let chain = Promise.resolve()
  let written = null
  const flush = () => {
    chain = chain.then(() => run(async () => {
      if (masks === undefined || state === null) return
      if (masks === null) {
        await remove(file)
        written = null
        return
      }
      const mode = modeOf({ ...state, masks, owner, beat: now() })
      await write(file, `${JSON.stringify(mode)}\n`)
      written = mode
    })).catch(() => {})
    return chain
  }
  return {
    level({ level, since, who }) {
      state = { level, since, who }
      return flush()
    },
    masks(found) {
      masks = found
      return flush()
    },
    beat: () => flush(),
    written: () => written,
    stop() {
      try {
        if (JSON.parse(readFileSync(file, 'utf8'))?.pid === owner.pid) rmSync(file, { force: true })
      } catch {
        // Gone, or not ours: nothing to remove.
      }
    },
  }
}

/**
 * Setup's part (chat 1's review): the PC's first board (the first of boards.json) gets `heavyModeWriter: true` in its
 * config.json, once; a config that says it already, either way, is left as it is, and so is every other board. `text` is
 * config.json's text; answers `{ line, text }`, `text` null when nothing changes.
 */
export function heavyModeSetup({ here, boards, text }) {
  const plain = path => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && plain(a) === plain(b)
  let raw
  try {
    raw = JSON.parse(String(text).replace(/^\uFEFF/, ''))
  } catch {
    return { line: 'Heavy-run mode file: config.json cannot be read, so it is left as it is.', text: null }
  }
  if (typeof raw?.heavyModeWriter === 'boolean') return { line: `Heavy-run mode file: ${raw.heavyModeWriter ? 'this board writes it' : 'this board does not write it'} (config.json says so).`, text: null }
  if (!same(boards?.[0]?.folder, here)) return { line: 'Heavy-run mode file: written by the PC\'s first board, not this one.', text: null }
  return { line: 'Heavy-run mode file: this board, the PC\'s first, writes it (heavyModeWriter: true in config.json).', text: `${JSON.stringify({ ...raw, heavyModeWriter: true }, null, 2)}\n`.replace(/\n/g, String(text).includes('\r\n') ? '\r\n' : '\n') }
}
