// B1139 (X93, 2026-11-24): where a chat's work call waits. The day record (src/workCalls.mjs) times a call from when its handler
// begins, hearing.mjs from the chat's send (the request id's time): on 2026-11-23 the record's slowest was 6.9 s while X93 saw
// 19 s, and the stall log had no stall then, so the wait between the send and the handler was unmeasured. This trace cuts every
// work call into its parts, one line per arrival in a small local file (`data/call-trace.jsonl`, the newest day):
//   sent      the request id's time: the chat's first send of this call (a repeat of the id keeps it)
//   arrived   the board's HTTP handler began on it (the event loop took the request)
//   marks     ms after `arrived` at each named point: lock (the loop lock's check), body (read), known (a repeat looked up),
//             begin (the handler's clock starts here: callStall), fresh (checkFresh), ctx (the call's context), action (the
//             store's answer), decide and handout (turn-ended's hand-over), answered (the answer sent)
//   with the action, the chat, the status, whether it was a repeat, the rebuilds that started during it, the calls in flight at
//   its arrival, and from its send to its answer the jobs that ran and two probes: the event loop's delay and the file system's (a tiny `stat` timed
//   every PROBE_MS, which waits in libuv's threadpool behind every other file read: a full threadpool keeps a call waiting while
//   the loop itself runs free, which the stall log cannot see), and the PC's CPU share.
// Measure only: it changes no order and no answer. PURE but for the clock, the probes and the file, which are handed in.

/** How long the file keeps a line. */
export const TRACE_KEEP_MS = 24 * 60 * 60_000
/** How often the probes look (the loop's delay, the file system's, the CPU). */
export const PROBE_MS = 500
/** How many probe readings are kept in memory (about 10 minutes at PROBE_MS). */
export const MOST_PROBES = 1200
/** How long after a line it is appended (many calls in a second are one write). */
export const APPEND_MS = 2000
/** After this many appended lines the file is cut to the newest TRACE_KEEP_MS. */
export const TRIM_EVERY = 4000

const finite = value => Number.isFinite(value)

/** The time a Workers mod sent a work call, from its request id (`<session>-<ms>-<count>`), or null (hearing.mjs's rule). */
export function sentOf(request) {
  const found = /-(\d{12,14})-\d+$/.exec(typeof request === 'string' ? request : '')
  return found === null ? null : Number(found[1])
}

/**
 * The largest reading of `probes` (`[{ at, ms }]`, `at` the probe's end) that overlaps `from`..`to`, with a probe still running at
 * `to` (`pending`: its start) counted as its age then. Null for none.
 */
export function probeMax(probes, from, to, pending = null) {
  let most = null
  for (const one of probes) {
    if (!finite(one?.at) || !finite(one?.ms)) continue
    if (one.at < from || one.at - one.ms > to) continue
    if (most === null || one.ms > most) most = one.ms
  }
  if (finite(pending) && pending <= to) {
    const age = to - pending
    if (most === null || age > most) most = age
  }
  return most === null ? null : Math.round(most)
}

/** The PC's busy share (0-100) between two `os.cpus()` readings, or null. */
export function cpuShare(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length || before.length === 0) return null
  let busy = 0
  let all = 0
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i]?.times
    const b = after[i]?.times
    if (a === undefined || b === undefined) return null
    const total = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + (b.idle - a.idle)
    busy += total - (b.idle - a.idle)
    all += total
  }
  return all <= 0 ? null : Math.round((busy / all) * 100)
}

/**
 * The tracer. `open({ request, arrived })` answers one call's trace (or null when tracing is off): `mark(name)` notes a point,
 * `set(fields)` adds the action, chat, status, repeat, rebuilds, `end()` writes its line once. `probe()` is the probes' timer
 * body (`start()` runs it every PROBE_MS). `lines()` the lines kept in memory (the tests'), `flush()` appends now.
 * Ports: `now`, `statProbe()` (a promise: one tiny file-system call), `cpus()` (os.cpus), `boardCpu()` (process.cpuUsage, µs),
 * `jobsDuring(from, to)` (the stall log's jobs that ran then), `append(text)`, `read()` and `rewrite(text)` (the file).
 */
export function callTracer({
  now = Date.now, statProbe = null, cpus = null, boardCpu = null, jobsDuring = () => [], append = null, read = null, rewrite = null,
  keepMs = TRACE_KEEP_MS, appendMs = APPEND_MS, trimEvery = TRIM_EVERY, mostProbes = MOST_PROBES,
} = {}) {
  const loop = []
  const files = []
  const cpu = []
  let fsPending = null
  let lastTick = null
  let lastCpus = null
  let inFlight = 0
  let waiting = []
  let timer = null
  let appended = 0
  let writing = Promise.resolve()
  const kept = []
  /** Per request id: how many arrivals were seen (a repeat of the mod is the second). */
  const arrivals = new Map()

  const push = (list, one) => {
    list.push(one)
    if (list.length > mostProbes) list.splice(0, list.length - mostProbes)
  }

  function probe() {
    const at = now()
    if (lastTick !== null) push(loop, { at, ms: Math.max(0, at - lastTick - PROBE_MS) })
    lastTick = at
    if (typeof cpus === 'function') {
      try {
        const reading = cpus()
        const share = cpuShare(lastCpus, reading)
        if (share !== null) push(cpu, { at, ms: share })
        lastCpus = reading
      } catch {
        // no reading this time
      }
    }
    if (typeof statProbe === 'function' && fsPending === null) {
      const begun = now()
      fsPending = begun
      let asked
      try {
        asked = Promise.resolve(statProbe())
      } catch {
        asked = Promise.resolve()
      }
      asked.catch(() => null).finally(() => {
        push(files, { at: now(), ms: now() - begun })
        fsPending = null
      })
    }
  }

  const write = () => {
    if (append === null || waiting.length === 0) return writing
    const text = waiting.join('')
    waiting = []
    writing = writing.then(async () => {
      try {
        await append(text)
        appended += text.split('\n').length - 1
        if (appended >= trimEvery && read !== null && rewrite !== null) {
          appended = 0
          await trim()
        }
      } catch {
        // the trace is no reason to fail anything
      }
    })
    return writing
  }
  const writeSoon = () => {
    if (append === null || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void write()
    }, appendMs)
    timer.unref?.()
  }
  async function trim() {
    if (read === null || rewrite === null) return
    let text = ''
    try {
      text = await read()
    } catch {
      return
    }
    const from = now() - keepMs
    const fresh = String(text).split('\n').filter(line => {
      if (line.trim() === '') return false
      try {
        return JSON.parse(line).arrived >= from
      } catch {
        return false
      }
    })
    try {
      await rewrite(fresh.length === 0 ? '' : `${fresh.join('\n')}\n`)
    } catch {
      // cut at the next trim; the trace is no reason to fail anything
    }
  }

  function open({ request = null, arrived = now() } = {}) {
    inFlight += 1
    const id = typeof request === 'string' ? request.slice(0, 100) : null
    const attempt = id === null ? 1 : (arrivals.get(id) ?? 0) + 1
    if (id !== null) {
      arrivals.set(id, attempt)
      if (arrivals.size > 2000) arrivals.delete(arrivals.keys().next().value)
    }
    const marks = {}
    const fields = {}
    const cpuBefore = typeof boardCpu === 'function' ? boardCpu() : null
    const flight = inFlight
    let isEnded = false
    return {
      mark(name) {
        if (!isEnded && marks[name] === undefined) marks[name] = now() - arrived
      },
      set(more) {
        if (!isEnded && more !== null && typeof more === 'object') Object.assign(fields, more)
      },
      end() {
        if (isEnded) return null
        isEnded = true
        inFlight -= 1
        const at = now()
        marks.answered ??= at - arrived
        const sent = sentOf(id)
        // The probes and the jobs from the chat's send on (a block that held the call before the board took it counts too).
        const from = sent !== null && sent <= arrived ? sent : arrived
        const used = typeof boardCpu === 'function' && cpuBefore !== null ? boardCpu() : null
        const line = {
          request: id, attempt, sent, arrived, ...fields, marks,
          total: sent === null ? null : at - sent, beforeBoard: sent === null ? null : arrived - sent,
          inFlight: flight,
          loopMax: probeMax(loop, from, at), fsMax: probeMax(files, from, at, fsPending), cpuMax: probeMax(cpu, from, at),
          boardCpuMs: used === null ? null : Math.round(((used.user - cpuBefore.user) + (used.system - cpuBefore.system)) / 1000),
          jobs: (() => {
            try {
              return jobsDuring(from, at)
            } catch {
              return []
            }
          })(),
        }
        kept.push(line)
        if (kept.length > 500) kept.shift()
        waiting.push(`${JSON.stringify(line)}\n`)
        writeSoon()
        return line
      },
    }
  }

  return {
    open,
    probe,
    trim,
    /** Starts the probes' timer; answers its stop. */
    start({ setTimer = setInterval, clearTimer = clearInterval } = {}) {
      const handle = setTimer(probe, PROBE_MS)
      handle?.unref?.()
      return () => clearTimer(handle)
    },
    lines: () => kept.map(one => ({ ...one })),
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return write()
    },
  }
}
