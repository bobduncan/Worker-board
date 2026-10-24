// B579: the recaps of the Backlog tab's Completed by day (src/work/doneDays.mjs decides; this file calls and keeps).
// A recap is written by one short headless call of the Claude command line: Sonnet, no tools, no settings, plugins or
// MCP servers, in a folder of its own under the system's temporary folder, so no chat is woken and no hook runs. It is
// told only the day's titles and summaries. One call at a time, with a time limit; what it wrote is kept per day in the
// board's data folder. Without a call (no command line, it failed, the board is paused, the limits are near) the day
// shows its steps grouped by goal, marked not generated, and the next open tries again.

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fallbackRecap, readRecap, recapDue, recapPrompt, shownRecap } from './work/doneDays.mjs'
import { readKept, writeAtomic } from './write.mjs'

/** How long one call may take. */
export const RECAP_SECONDS = 120
/** The days kept in the file, newest first. */
const KEPT_DAYS = 60

/** The arguments of the call: print and end, Sonnet, no tools, nothing of the person's settings, nothing kept. */
export const RECAP_ARGS = ['-p', '--model', 'sonnet', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'text']

/**
 * One call: `{ ok: true, text }` or `{ ok: false, why }`; it never throws. `command` is the program (for the tests a
 * stand-in, with its own first arguments).
 */
export async function callClaude({ command, prompt, seconds = RECAP_SECONDS, env = process.env }) {
  let dir = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'worker-board-recap-'))
    // The chat's own variables would make the call a part of that chat's session.
    const own = Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:CLAUDE_?CODE|CLAUDECODE|CLAUDE_AGENT_SDK)/i.test(name)))
    return await new Promise(resolve => {
      const child = spawn(command[0], [...command.slice(1), ...RECAP_ARGS], { cwd: dir, env: own, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      let out = ''
      let said = ''
      const late = setTimeout(() => child.kill(), seconds * 1000)
      child.stdout.on('data', chunk => {
        out = (out + chunk).slice(-20_000)
      })
      child.stderr.on('data', chunk => {
        said = (said + chunk).slice(-2000)
      })
      child.once('error', () => {
        clearTimeout(late)
        resolve({ ok: false, why: 'The Claude command line could not be started.' })
      })
      child.once('exit', (code, signal) => {
        clearTimeout(late)
        const words = `${out}\n${said}`
        if (/not logged in|please run \/login/i.test(words)) return resolve({ ok: false, why: 'The Claude command line is not signed in.' })
        if (signal !== null) return resolve({ ok: false, why: `The call took longer than ${seconds} seconds and was stopped.` })
        if (code !== 0) return resolve({ ok: false, why: `The call ended with code ${code}.` })
        resolve({ ok: true, text: out })
      })
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    })
  } catch (error) {
    return { ok: false, why: `The call could not be made: ${error?.code ?? error?.message}` }
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The keeper of the recaps. `file` is where they are kept; `findCommand()` answers the command line's program (an array)
 * or null; `call` makes one call (callClaude); `clock` the time. `view(day, steps, facts)` answers what the page shows for
 * a day and starts a call when one is due and allowed: `facts` holds `today`, `goalTitles`, and `whyNot`, why no call may
 * be made now (paused, limits near, a board that only shows), or null.
 */
export function dayRecaps({ file, findCommand, call = callClaude, clock = Date.now, write = writeAtomic, read = readKept }) {
  let days = null
  let writing = null
  let lastWhy = null

  const load = async () => {
    if (days !== null) return days
    const kept = (await read(file, clock())).value
    days = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
    return days
  }
  const keep = async (day, record) => {
    days[day] = record
    const newest = Object.keys(days).sort().reverse().slice(0, KEPT_DAYS)
    days = Object.fromEntries(newest.map(one => [one, days[one]]))
    await write(file, `${JSON.stringify(days, null, 2)}\n`).catch(() => {})
  }

  const write1 = async (day, steps, goalTitles) => {
    const triedAt = clock()
    const command = await findCommand()
    const made = command === null ? { ok: false, why: 'No Claude command line was found on this computer.' } : await call({ command, prompt: recapPrompt(steps) })
    const points = made.ok ? readRecap(made.text, steps) : null
    lastWhy = made.ok ? (points === null ? 'The call did not answer a recap the board could read.' : null) : made.why
    const record = points === null
      ? { points: fallbackRecap(steps, goalTitles), isGenerated: false, why: lastWhy }
      : { points, isGenerated: true, why: null }
    await keep(day, { ...record, ids: steps.map(step => step.id), newest: Math.max(...steps.map(step => step.at)), at: clock(), triedAt })
  }

  return {
    async view(day, steps, { today, goalTitles = new Map(), whyNot = null }) {
      await load()
      const kept = days[day] ?? null
      const isDue = recapDue(kept, steps, { day, today, now: clock() })
      if (isDue && whyNot === null && writing === null) {
        writing = { day, at: clock() }
        write1(day, steps, goalTitles).finally(() => {
          writing = null
        })
      } else if (isDue && whyNot !== null && kept !== null && !kept.isGenerated) {
        // Not tried now: the reason it is not generated is today's.
        kept.why = whyNot
      }
      const shown = shownRecap(kept, steps, goalTitles)
      if (shown !== null && !shown.isGenerated && shown.why === null) shown.why = whyNot ?? (writing !== null ? null : lastWhy)
      return { recap: shown, isWriting: writing !== null && writing.day === day }
    },
  }
}
