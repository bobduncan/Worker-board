// S4 of the PC plan (.claude/plans/pc-lag-test-speed-plan.md, chat 1, 2026-11-26): the PC's core map. Which logical
// processors are the person's (the first two performance cores, both threads: the person's choice of 2026-11-25), which
// are the work's (all the others) and which are Low's (the last two efficiency-core threads, as today). Read once at the
// board's start with one PowerShell call (GetSystemCpuSetInformation: EfficiencyClass and CoreIndex per logical processor),
// kept in data/cpu-topology.json. A PC this cannot read (not Windows, more than 64 logical processors, a failed call) has
// no map: every reader then keeps today's behaviour.
//
// The mode file (%TEMP%/one-heavy-run.lock.mode.json, beside the heavy-run queue's lock) says the level and the masks
// to the queue's launchers (S5). Only the person's board writes it.

import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeAtomic } from './write.mjs'

/** The person's choices (2026-11-25): two performance cores kept free in Full; Low on two efficiency-core threads. */
export const PERSON_CORES = 2
export const LOW_THREADS = 2

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

/** The script's output as `[{ group, logical, core, efficiency }]`, or null when it is none. */
export function parseTopology(text) {
  const rows = String(text ?? '').trim().split(';').filter(Boolean).map(part => part.split(',').map(Number))
  if (rows.length === 0 || rows.some(row => row.length !== 4 || row.some(n => !Number.isInteger(n) || n < 0))) return null
  return rows.map(([group, logical, core, efficiency]) => ({ group, logical, core, efficiency }))
}

const hex = mask => `0x${mask.toString(16).toUpperCase().padStart(6, '0')}`
const maskOfList = list => list.reduce((mask, one) => mask | (1n << BigInt(one.logical)), 0n)

/**
 * The masks of a topology, or null when it has none: one processor group, at most 64 logical processors, and room for
 * work beside the person's cores. `person`: every thread of the first `personCores` performance cores; `work`: the
 * rest; `low`: the last `lowThreads` efficiency-core threads, or the last logical processors on a PC without them (today's rule).
 * Masks are BigInts; `hexOf` writes them.
 */
export function masksOf(topology, { personCores = PERSON_CORES, lowThreads = LOW_THREADS } = {}) {
  if (!Array.isArray(topology) || topology.length === 0 || topology.length > 64) return null
  if (topology.some(one => one.group !== 0 || one.logical >= 64)) return null
  const sorted = [...topology].sort((a, b) => a.logical - b.logical)
  const best = Math.max(...sorted.map(one => one.efficiency))
  const performance = sorted.filter(one => one.efficiency === best)
  const efficiency = sorted.filter(one => one.efficiency !== best)
  const cores = [...new Set(performance.map(one => one.core))]
  if (cores.length <= personCores && efficiency.length === 0) return null
  const kept = new Set(cores.slice(0, personCores))
  const personList = performance.filter(one => kept.has(one.core))
  const workList = sorted.filter(one => !kept.has(one.core) || one.efficiency !== best)
  if (workList.length === 0) return null
  const lowList = (efficiency.length > 0 ? efficiency : workList).slice(-lowThreads)
  return {
    person: maskOfList(personList),
    work: maskOfList(workList),
    low: maskOfList(lowList),
    threads: { person: personList.length, work: workList.length, low: lowList.length, all: sorted.length },
  }
}

/** The masks as hex strings (`0xFFFFF0`), for the mode file and the panel. */
export function hexOf(masks) {
  return masks === null ? null : { person: hex(masks.person), work: hex(masks.work), low: hex(masks.low) }
}

/**
 * The topology: the cached one in `file` when it names `logical` processors, else read anew (`read()`: the script's
 * output) and cached. Null on a PC that is not Windows or when the read fails; a failure throws for the caller's loop.
 */
export async function topologyOf({ file, logical, platform = process.platform, read, write = writeAtomic }) {
  if (platform !== 'win32') return null
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'))
    if (Array.isArray(cached?.topology) && cached.topology.length === logical) return cached.topology
  } catch {
    // Not cached yet, or broken: read anew.
  }
  const topology = parseTopology(await read())
  if (topology === null) throw new Error('the CPU sets came back empty')
  await write(file, `${JSON.stringify({ at: Date.now(), topology })}\n`)
  return topology
}

/** Where the mode file is: beside the heavy-run queue's lock (HEAVY_RUN_LOCK, else the temp folder's one-heavy-run.lock). */
export function modeFileOf(env = process.env) {
  return `${env.HEAVY_RUN_LOCK || join(tmpdir(), 'one-heavy-run.lock')}.mode.json`
}

/** The mode file's content: the level, the masks in hex, their thread counts, since when and by whom. */
export function modeOf({ level, masks, since, who }) {
  return { level, masks: hexOf(masks), threads: { work: masks.threads.work, low: masks.threads.low }, since, who }
}

/** Writes the mode file, or removes it when there are no masks (the readers then keep today's behaviour). */
export async function writeMode(file, { level, masks, since, who }, { write = writeAtomic } = {}) {
  if (masks === null) {
    await rm(file, { force: true })
    return null
  }
  const mode = modeOf({ level, masks, since, who })
  await write(file, `${JSON.stringify(mode)}\n`)
  return mode
}
