// The start-up check, task 5: the runner. `createChecker` ties the three parts of src/startupCheck.mjs (picture, verdict, apply)
// to the board: one check at a time, a loader state at once, a 30 s bound on the slow read (the app's chat folders), errors
// that never reach the board, and the debounce of the app-restart trigger. Every reader and writer comes in as a port, so a
// test runs it without a board; server.mjs gives it the real ones (the lanes of the state, the wake record, the outbox, the
// work API's incident-gone, data/check.json).

import { apply, judge, pictureOf } from './startupCheck.mjs'

/** The slow read (the app's chat folders) is given this long; what did not answer by then is said so. */
export const CHECK_BOUND_MS = 30_000
/** Many chats report a new run within seconds of an app start: one check for them all. */
export const APP_RESTART_DEBOUNCE_MS = 10_000

/**
 * Ports: `clock()`, `readSources({ trigger, triggerAt })` (everything but the folders: lanes, reports, wakes, pause, ready,
 * envelopes, incidents; fast), `readFolders()` (the account folders; the slow one), `writers` (startupCheck.mjs `apply`),
 * `afterApply(result)` (the wake pass, so a re-opened wake goes in the same minute), `onChange()` (the state is read anew),
 * `log(text)`, and for tests `boundMs`, `debounceMs`, `setTimer`, `clearTimer`.
 */
export function createChecker({ clock, readSources, readFolders, writers, afterApply = async () => {}, onChange = () => {}, log = () => {}, boundMs = CHECK_BOUND_MS, debounceMs = APP_RESTART_DEBOUNCE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let last = null
  let running = null
  let timer = null

  /** The check as the state shows it (`state.check`), or null before the first. */
  const view = () => {
    if (running === null) return last
    return { ...(last ?? { total: null, reachable: null, line: null, tone: 'quiet', fixed: [], elsewhere: [], restartNeeded: [], nowhere: [], tooSlow: false }), at: running.at, trigger: running.trigger, running: true }
  }

  async function check(trigger, triggerAt) {
    const sources = await readSources({ trigger, triggerAt })
    let tooSlow = false
    let late = null
    const folders = await Promise.race([
      Promise.resolve(readFolders()).catch(() => null),
      new Promise(done => { late = setTimer(() => done(null), boundMs); late?.unref?.() }),
    ])
    clearTimer(late)
    if (folders === null) tooSlow = true
    const now = clock()
    const verdict = judge(pictureOf({ ...sources, now, trigger, triggerAt, tooSlow, folders: folders ?? [] }))
    const result = await apply(verdict, writers, now)
    await afterApply(result)
    return result
  }

  /**
   * Starts a check unless one runs: `{ started, view, done }`. The state shows `running` at once (`onChange`), the result when it
   * ends. A second call while one runs answers the running record. A failure is a line, never a throw.
   */
  function start(trigger) {
    if (running !== null) return { started: false, view: view(), done: running.done }
    const at = clock()
    running = { at, trigger }
    running.done = (async () => {
      try {
        last = await check(trigger, at)
        log(`Check (${trigger}): ${last.line}${last.fixed.length > 0 ? ` · fixed ${last.fixed.length}` : ''}.`)
      } catch (error) {
        const why = error?.message ?? String(error)
        log(`Check: ${why}`)
        last = { at: clock(), trigger, running: false, total: last?.total ?? null, reachable: null, line: `The check failed: ${why}`, tone: 'attention', fixed: [], elsewhere: [], restartNeeded: [], nowhere: [], tooSlow: false, failed: [why] }
      } finally {
        running = null
        onChange()
      }
      return last
    })()
    onChange()
    return { started: true, view: view(), done: running.done }
  }

  /**
   * A chat's report carried a run id it did not have: some session started (the app, or one chat). One check follows after the
   * debounce, for all that report within it; none when a check finished after this report, or one runs or waits.
   */
  function newRun(reportAt) {
    if (running !== null || timer !== null || (last !== null && Number.isFinite(reportAt) && last.at >= reportAt)) return false
    timer = setTimer(() => {
      timer = null
      start('app-restart')
    }, debounceMs)
    timer?.unref?.()
    return true
  }

  return { view, start, newRun, stop: () => { if (timer !== null) clearTimer(timer); timer = null } }
}
