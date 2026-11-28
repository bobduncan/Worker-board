// The lag recorder's probe (src/lag.mjs): a child of the board that stands in for the person's own program. For each line it reads (a
// number of seconds) it ticks at 60 Hz with 3 ms of work per tick, like a video player or a game loop, and answers one JSON line:
// `{ ticks, p99, lateMax, stallMax }`. It sleeps between asks, so it costs nothing then. It ends with its input (the board's end).

import { createInterface } from 'node:readline'

import { HZ, probeStats, WORK_MS } from './lag.mjs'

const now = () => Number(process.hrtime.bigint()) / 1e6

/** One probe of `seconds`: the lateness of every tick and the longest gap inside its work. */
export async function ticks(seconds, { hz = HZ, workMs = WORK_MS } = {}) {
  const period = 1000 / hz
  const lates = []
  const stalls = []
  const start = now()
  const count = Math.max(1, Math.floor((seconds * 1000) / period))
  for (let i = 1; i <= count; i += 1) {
    const due = start + i * period
    const ahead = due - now()
    if (ahead > 0) await new Promise(resolve => setTimeout(resolve, ahead))
    const began = now()
    lates.push(Math.max(0, began - due))
    let last = began
    let gap = 0
    while (last - began < workMs) {
      const t = now()
      if (t - last > gap) gap = t - last
      last = t
    }
    stalls.push(gap)
  }
  return probeStats(lates, stalls)
}

if (process.argv[1] && /lagProbe\.mjs$/i.test(process.argv[1])) {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', async row => {
    const seconds = Math.min(10, Math.max(0.1, Number(row) || 1))
    process.stdout.write(`${JSON.stringify(await ticks(seconds))}\n`)
  })
  lines.on('close', () => process.exit(0))
}
