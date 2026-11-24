// B1139 (X93): reads data/call-trace.jsonl (src/callTrace.mjs) and says where the slow work calls waited: one row per call over
// the limit from its send, its parts in seconds, and the parts' share over all of them. Usage:
//   node tools/call-trace-read.mjs [--since HH:MM | --minutes N] [--over 5] [--file <path>] [--json]
// Read-only.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The parts of a call in the order they happen: each is the time from the mark before it to its own. */
export const PARTS = ['lock', 'body', 'known', 'begin', 'fresh', 'ctx', 'action', 'decide', 'handout', 'answered']

/** One line's parts in ms: `{ beforeBoard, lock, body, ... }` (a part without its mark is left out). PURE. */
export function partsOf(line) {
  const out = {}
  if (Number.isFinite(line?.beforeBoard)) out.beforeBoard = line.beforeBoard
  let last = 0
  for (const part of PARTS) {
    const at = line?.marks?.[part]
    if (!Number.isFinite(at)) continue
    out[part] = at - last
    last = at
  }
  return out
}

/** The calls of `lines` (one per request id: its last arrival, which carries the answer the chat got) taking over `overMs` from their send. PURE. */
export function slowCalls(lines, { overMs = 5000, from = -Infinity } = {}) {
  const byRequest = new Map()
  const loose = []
  for (const line of lines) {
    if (!Number.isFinite(line?.arrived) || line.arrived < from) continue
    if (typeof line.request === 'string') byRequest.set(line.request, { ...line, arrivals: (byRequest.get(line.request)?.arrivals ?? 0) + 1 })
    else loose.push({ ...line, arrivals: 1 })
  }
  return [...byRequest.values(), ...loose]
    .filter(line => (Number.isFinite(line.total) ? line.total : line.marks?.answered ?? 0) > overMs)
    .sort((a, b) => a.arrived - b.arrived)
}

/** The share of each part over the calls: `{ part: ms }` summed. PURE. */
export function sharesOf(calls) {
  const sum = {}
  for (const call of calls) for (const [part, ms] of Object.entries(partsOf(call))) sum[part] = (sum[part] ?? 0) + ms
  return sum
}

const s = ms => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '-')
const time = ms => new Date(ms).toLocaleTimeString('en-GB')

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url))
  const arg = name => {
    const at = argv.indexOf(name)
    return at === -1 ? null : argv[at + 1]
  }
  const file = arg('--file') ?? join(here, '..', 'data', 'call-trace.jsonl')
  const overMs = Number(arg('--over') ?? 5) * 1000
  let from = -Infinity
  if (arg('--minutes') !== null) from = Date.now() - Number(arg('--minutes')) * 60_000
  if (arg('--since') !== null) {
    const [h, m] = arg('--since').split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    from = at.getTime()
  }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
  const all = lines.filter(line => line.arrived >= from)
  const calls = slowCalls(lines, { overMs, from })
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ lines: all.length, slow: calls.map(call => ({ ...call, parts: partsOf(call) })), shares: sharesOf(calls) }, null, 1))
    return
  }
  console.log(`${all.length} arrivals, ${calls.length} calls over ${overMs / 1000} s from their send`)
  const head = ['time', 'action', 'chat', 'total', 'tries', 'before', ...PARTS, 'loop', 'fs', 'cpu%', 'inFlight', 'rebuilds', 'jobs']
  console.log(head.join('\t'))
  for (const call of calls) {
    const parts = partsOf(call)
    console.log([time(call.arrived), call.action ?? '?', call.chat ?? '?', s(call.total), call.arrivals, s(parts.beforeBoard), ...PARTS.map(part => s(parts[part])),
      s(call.loopMax), s(call.fsMax), call.cpuMax ?? '-', call.inFlight ?? '-', call.rebuilds ?? '-', (call.jobs ?? []).join('; ')].join('\t'))
  }
  const shares = sharesOf(calls)
  const whole = Object.values(shares).reduce((a, b) => a + b, 0)
  if (whole > 0) console.log(`where the slow calls waited: ${Object.entries(shares).sort((a, b) => b[1] - a[1]).map(([part, ms]) => `${part} ${Math.round((ms / whole) * 100)}%`).join(', ')}`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2))
