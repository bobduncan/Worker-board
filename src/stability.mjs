// Stability numbers (2026-11-05, plan .claude/plans/2026-11-05-stability-numbers-plan.md, task 2): the per-minute record of
// idle-with-work, data/ready-minutes.jsonl. One line a minute while the board owns the loops: `{ at, free: [{ chat, could }] }`,
// each `could` the ready steps a free worker lane could take at that moment. It READS the board's state and writes one file;
// it changes nothing in how steps are handed out.

import { readFile } from 'node:fs/promises'

import { modelOf } from './work/effort.mjs'
import { match } from './work/handOut.mjs'
import { BAN_WHY_MARK } from './work/handover.mjs'
import { absentAs, appendLines, writeUnflushed } from './write.mjs'

/** The minute lines are kept this long; older ones go at the first write of a day. */
export const MINUTES_KEEP_MS = 31 * 24 * 60 * 60_000

const isWorkerLane = lane => lane?.isMain !== true && lane?.isLeftover !== true

/** Whether the lane's hand-over says a ban stands for steps of `family` ("free; gets no sonnet steps: its set failed at ..."). */
const isBanned = (lane, family) => {
  const why = lane.handover?.why
  return typeof why === 'string' && why.includes(BAN_WHY_MARK) && why.includes(`gets no ${family} steps`)
}

/**
 * The minute's line: for each worker lane that is free in the hand-over's own words (so not paused, not held by a limit), the
 * ready steps it could take: the ready entries `match` gives to that lane (a kept step only to its worker, a Quality
 * Assurance step never to a builder of the step, Touches that overlap a step under way skipped), less the steps whose model
 * family the lane is banned from. Lanes with nothing to take are left out: an empty minute is `{ at, free: [] }`. PURE.
 */
export function minuteOf(state, items, prefix = '', at = Date.now()) {
  const ready = state?.readyList?.ready ?? []
  const free = []
  for (const lane of state?.chats ?? []) {
    if (!isWorkerLane(lane) || lane.handover?.state !== 'free') continue
    const open = ready.filter(one => items.has(one.id) && !isBanned(lane, modelOf(items.get(one.id)).family))
    // match() hands out one step per idle lane, so the question is asked for each entry alone: could it go to this lane?
    const could = open.filter(one => match({ ready: [one], idle: [lane], items, prefix }).length > 0).map(one => one.id)
    if (could.length > 0) free.push({ chat: lane.name, could })
  }
  return { at, free }
}

/** The day of `ms` on this machine's clock: `2026-11-05`. */
const dayOf = ms => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** `text` less the lines older than the keep time (a line that is not JSON is dropped too). */
export function prunedMinutes(text, now) {
  const kept = text.split('\n').filter(line => {
    try {
      return JSON.parse(line).at >= now - MINUTES_KEEP_MS
    } catch {
      return false
    }
  })
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`
}

/**
 * The writer: `keep(state, items, prefix)` appends the minute's line to `file`. At the first write of a day (and of a board's
 * run) it first drops the lines older than 31 days. A file that cannot be written is said on the console; the loop goes on.
 */
export function minuteKeeper({ file, clock = Date.now }) {
  let prunedOn = null
  return async function keep(state, items, prefix = '') {
    const at = clock()
    try {
      if (prunedOn !== dayOf(at)) {
        const text = await readFile(file, 'utf8').catch(absentAs(''))
        const pruned = prunedMinutes(text, at)
        if (pruned !== text) await writeUnflushed(file, pruned)
        prunedOn = dayOf(at)
      }
      await appendLines(file, `${JSON.stringify(minuteOf(state, items, prefix, at))}\n`)
    } catch (error) {
      console.error(`The ready-minutes record could not be written (${error?.code ?? error?.message ?? 'unknown'}).`)
    }
  }
}
