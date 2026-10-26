// The supervisor's sweep (spec 2026-10-24, "The supervisor chat"): the AI part for the gaps the code rules leave. Every
// `supervisorSweepMinutes` (10 to start; 0 for none) while work runs and something odd is new (see `sweepRunner`), and at once
// on "Check now", the board wakes the chat of role supervisor (the list of chats' "supervisor", Sonnet · low): it reads `work health`, files each oddity
// with `work incident`, and ends its turn; its Workers mod then clears it, so the next sweep starts empty. Quiet nights
// (Review Focus 3): no sweep while no chat works and no step is under way, while the person pauses all, at a full limit,
// or while the last sweep still runs. A missing chat (Review Focus 4) is said plainly, and the code rules run anyway.
// What each sweep cost is read from the supervisor chat's transcript of that turn (`tokensOfTurn`).

import { parseTail } from '../transcript.mjs'

const MIN = 60_000
/** The Workers mod that knows `work health` and `work incident`; an older one cannot sweep. */
export const SWEEP_MOD = '0.16.0'
/** A sweep whose chat has no word on its way and no turn running this long after it was asked has ended. */
export const SWEEP_SETTLE_MS = 2 * MIN
/** A sweep's tokens are read this long after its turn ended: the app writes the last answer a moment later. */
export const TOKENS_AFTER_MS = 20_000
/**
 * The review: a sweep open this long has ended, whatever its chat or its word says (a word left "taken" or "waiting"
 * in the outbox must never hold every later sweep).
 */
export const SWEEP_LONGEST_MS = 30 * MIN
/**
 * Cheaper sweeps (the person, 2026-10-26): the note when a sweep by the clock is skipped because nothing odd is new: no
 * odd line and no tripped rule that the last sweep did not see.
 */
export const NOTHING_ODD = 'nothing odd since the last sweep'
/** The safety net when the setting `supervisorSweepAtLeastHours` is not given: hours of work without a sweep. */
export const SWEEP_AT_LEAST_HOURS = 4
/** How many ended sweeps the supervisor keeps, for their tokens. */
const KEPT = 50

/** The facts of a sweep as its file holds them: `{ odd, tripped }` (lists of text), or null for anything else. */
function factsOfFile(value) {
  const list = items => (Array.isArray(items) ? items.filter(one => typeof one === 'string') : null)
  const [odd, tripped] = [list(value?.odd), list(value?.tripped)]
  return odd === null || tripped === null ? null : { odd, tripped }
}

/**
 * What a look at the board holds that the sweep before did not see (`before`, the facts that sweep kept; `now`, the facts
 * now, as the runner's `facts()` gives them): `{ odd, rules }`, the odd lines that were not there, and the rules tripped
 * now that were not tripped then. A rule that stands tripped, as it did at the sweep, is nothing new; so is an odd line
 * that went, and a rule that tripped and was fine again by now (the board's own repairs are such).
 */
export function unseenSince(before, now) {
  const had = new Set(before.odd)
  const stood = new Set(before.tripped)
  return { odd: now.odd.filter(line => !had.has(line)), rules: now.tripped.filter(id => !stood.has(id)) }
}

/** The facts of two looks together: what the sweep saw when it began and what stood when its turn ended (what it filed is seen). */
const bothFacts = (a, b) => ({ odd: [...new Set([...a.odd, ...b.odd])], tripped: [...new Set([...a.tripped, ...b.tripped])] })

const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

/** A version's numbers, "0.16.0" as [0, 16, 0]; null for none. */
const versionOf = text => (typeof text === 'string' && /^\d+(?:\.\d+)*$/.test(text.trim()) ? text.trim().split('.').map(Number) : null)
/** True when version `a` is older than `b`. */
export function isOlder(a, b) {
  const [x, y] = [versionOf(a), versionOf(b)]
  if (x === null || y === null) return false
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}

/**
 * Review Focus 4: why no sweep can run, in one plain line, or null. `chat` is how the board sees the supervisor's chat:
 * `named` (the list of chats' "supervisor", or null), `title` (its title in the app), `card` (the chat the board shows,
 * or null), `withoutMod` (no Workers mod takes the board's words) and `mod` (the version its Workers mod sent with its
 * last call; null for a mod too old to send one, undefined while it has not asked since the board started).
 */
export function whyNoSweep(chat) {
  if (chat === null || chat === undefined || chat.named === null || chat.named === undefined) {
    return 'the list of chats names no supervisor chat ("supervisor" in .claude/chats/list.json)'
  }
  if (chat.card === null || chat.card === undefined) return `no chat "${chat.title ?? chat.named}" is open in the app`
  if (chat.withoutMod === true) return 'no Workers mod takes the board\'s words'
  if (chat.mod === null) return `its Workers mod is older than ${SWEEP_MOD}, which knows work health: start its chat anew`
  if (typeof chat.mod === 'string' && isOlder(chat.mod, SWEEP_MOD)) return `its Workers mod is ${chat.mod}, older than ${SWEEP_MOD}, which knows work health: start its chat anew`
  return null
}

/**
 * What a sweep cost, from the supervisor chat's transcript (`text`, `isCut` as transcript.mjs reads a tail): the tokens of
 * every answer written from `from` on (the turn's start), each message once (the app writes its tokens on each of its
 * lines: the largest counts). `{ total, input, cacheWrite, cacheRead, output }`, or null when no answer is there.
 */
export function tokensOfTurn(text, isCut, from) {
  const byMessage = new Map()
  let others = 0
  for (const entry of parseTail(String(text ?? ''), isCut === true, true)) {
    if (entry.type !== 'assistant' || entry.usage === null || !(entry.at >= from)) continue
    const usage = Object.fromEntries(Object.entries(entry.usage).map(([key, value]) => [key, Number.isFinite(value) ? value : 0]))
    const key = entry.messageId ?? `line ${(others += 1)}`
    const before = byMessage.get(key)
    byMessage.set(key, before === undefined ? usage : Object.fromEntries(Object.keys(usage).map(name => [name, Math.max(before[name] ?? 0, usage[name])])))
  }
  if (byMessage.size === 0) return null
  const sum = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
  for (const usage of byMessage.values()) for (const name of Object.keys(sum)) sum[name] += usage[name] ?? 0
  return { total: sum.input + sum.cacheWrite + sum.cacheRead + sum.output, ...sum }
}

/** A kept sweep as its file holds it; null for anything else. */
function sweepOf(value) {
  if (value === null || typeof value !== 'object' || !Number.isFinite(value.at)) return null
  const number = key => (Number.isFinite(value[key]) ? value[key] : null)
  return {
    at: value.at, asked: value.asked === true, subject: typeof value.subject === 'string' ? value.subject : null, ended: number('ended'),
    how: typeof value.how === 'string' ? value.how : null, found: Number.isInteger(value.found) && value.found >= 0 ? value.found : 0,
    read: value.read === true, tokens: number('tokens'), tokenParts: value.tokenParts !== null && typeof value.tokenParts === 'object' ? value.tokenParts : null,
    tokensRead: value.tokensRead === true, session: typeof value.session === 'string' ? value.session : null, from: number('from') ?? value.at,
    note: typeof value.note === 'string' ? value.note : null,
    // Cheaper sweeps: what the sweep saw (`facts`: its odd lines and the rules tripped), so the next one by the clock waits for something new.
    // A file from before holds a hash: no facts known, so the next one runs.
    facts: factsOfFile(value.facts),
  }
}
const noteOf = value => (value !== null && typeof value === 'object' && Number.isFinite(value.at) && typeof value.why === 'string' ? { at: value.at, why: value.why, asked: value.asked === true } : null)

/**
 * The sweep's runner. `every` how often in milliseconds (0: none, then only "Check now" sweeps); `workRuns()` true while a
 * chat works or a step is under way; `paused()` while the person pauses all (or resumes); `atLimit()` while a limit is
 * full; `limitsOld()` (B640) true while a limit's newest reading is over `oldReadingMinutes` old and near a stop (X47, X55, X56: an old
 * low reading changes no decision), which the sweep's chat looks up with get_usage: the sweep is then not skipped as "nothing odd" (B645: a pause holds the sweep word until the resume, and
 * nothing spends in a pause, so none runs for it then); `chat()` how the board sees the supervisor's chat (`whyNoSweep`); `sweeping()` true while its sweep word is on
 * its way or its chat runs a turn; `wake({ subject })` sends the sweep word: `{ ok, session, note }` or `{ ok: false,
 * why }`; `tokens({ session, from })` what the turn cost (`tokensOfTurn`), or null; `memory` `{ load(), save(value) }` its
 * own file, so a restart neither sweeps again at once nor forgets a sweep that runs; `facts()` (cheaper sweeps) what the
 * board holds that is odd (index.mjs): `{ odd, tripped }`, the odd lines of the health summary without times or minute
 * counts, and the ids of the rules tripped at their last run; or null. A sweep by the clock runs only when something odd
 * is new since the last sweep (`unseenSince`: an odd line it did not have, a rule tripped that was not then; what the sweep
 * itself filed is seen at its turn's end), else it is skipped ("nothing odd since the last sweep"); and
 * whatever the board looks like at least once in `atLeast` milliseconds (the setting `supervisorSweepAtLeastHours`, 4)
 * while work runs. Check now sweeps anyway. A sweep open for SWEEP_LONGEST_MS has ended, whatever `sweeping()` says.
 * Answers `{ tick(now), now({ subject, at }), heard(call), view() }`: `tick` sweeps when one is due; `now` is "Check now":
 * `{ started, why, note }`; `heard` takes the supervisor chat's work calls (health read, incident filed, turn ended);
 * `view()` is `{ last, note, recent }`: the last sweep, why the newest sweep did not run (when that is newer), and the
 * ended sweeps kept.
 */
export function sweepRunner({ every, workRuns, paused, atLimit, limitsOld = async () => false, chat, sweeping, wake, tokens, memory = null, facts = async () => null, atLeast = SWEEP_AT_LEAST_HOURS * 60 * MIN }) {
  let last = null
  let note = null
  let recent = []
  let loaded = memory === null
  const load = async () => {
    if (loaded) return
    loaded = true
    const kept = await memory.load()
    last = sweepOf(kept?.last)
    note = noteOf(kept?.note)
    recent = (Array.isArray(kept?.recent) ? kept.recent : []).map(sweepOf).filter(one => one !== null).slice(-KEPT)
  }
  const save = async () => {
    if (memory !== null) await memory.save({ last, note, recent })
  }
  const isOpen = () => last !== null && last.ended === null
  /** The sweep ended: kept with the recent ones once its tokens are read. */
  const end = (at, how, more = {}) => {
    last = { ...last, ended: at, how, ...more }
  }
  async function settle(now) {
    if (!isOpen() || now - last.at < SWEEP_SETTLE_MS) return false
    // The review: one open too long has ended, whatever its word or its chat says.
    const isLong = now - last.at >= SWEEP_LONGEST_MS
    if (!isLong && (await sweeping())) return false
    // The review: its turn's end may have come while `sweeping()` was asked: a told end stays told.
    if (!isOpen()) return false
    end(now, 'quiet', { note: last.note ?? (isLong ? `it ran over ${SWEEP_LONGEST_MS / MIN} minutes without its turn's end` : 'no turn of its chat ended: its word may not have been taken') })
    return true
  }
  /** Its tokens read, and the sweep kept with the recent ones; `isEarly` reads them before TOKENS_AFTER_MS (a new sweep starts). */
  async function readTokens(now, isEarly = false) {
    if (last === null || last.ended === null || last.tokensRead || (!isEarly && now - last.ended < TOKENS_AFTER_MS)) return false
    const read = last.session === null ? null : await tokens({ session: last.session, from: last.from })
    last = { ...last, tokens: read?.total ?? null, tokenParts: read === null ? null : { input: read.input, cacheWrite: read.cacheWrite, cacheRead: read.cacheRead, output: read.output }, tokensRead: true }
    recent = [...recent, last].slice(-KEPT)
    return true
  }
  /** The board's facts now (`facts()`: `{ odd, tripped }`), or null when they cannot be read (then nothing is skipped). */
  const factsNow = async () => {
    try {
      return factsOfFile(await facts())
    } catch {
      return null
    }
  }
  async function start(now, { asked, subject, seen }) {
    const woke = await wake({ subject })
    if (woke?.ok !== true) {
      note = { at: now, why: `the sweep word could not be sent (${woke?.why ?? 'no answer'})`, asked }
      await save()
      return { started: false, why: note.why, note: null }
    }
    // The review: the sweep before it is kept with its tokens before it gives way (a Check now right after its end).
    await readTokens(now, true)
    last = { at: now, asked, subject, ended: null, how: null, found: 0, read: false, tokens: null, tokenParts: null, tokensRead: false, session: woke.session ?? null, from: now, note: woke.note ?? null, facts: seen ?? null }
    await save()
    return { started: true, why: null, note: last.note }
  }
  return {
    /** The schedule: a sweep when one is due and work runs; the end of one whose chat went quiet; its tokens. */
    async tick(now) {
      await load()
      const changed = (await settle(now)) || (await readTokens(now))
      if (changed) await save()
      if (!(every > 0) || isOpen() || (last !== null && now - last.at < every)) return null
      if (!(await workRuns()) || (await paused()) || (await atLimit())) return null
      const why = whyNoSweep(await chat())
      if (why !== null) {
        // Said once per reason, not every minute.
        if (note?.why !== why) {
          note = { at: now, why, asked: false }
          await save()
        }
        return null
      }
      // A sweep that runs although this board forgot it (another board process asked it) is not asked again.
      if (await sweeping()) return null
      // Cheaper sweeps: a sweep by the clock costs a turn of a chat, so it runs only for something odd that the last one did
      // not see (an odd line, a rule that tripped since), for an old reading near a stop (B640: the lookup is what changes
      // it), and at least once in `atLeast` as a safety net. The minutes and states that change all day are no reason.
      const seen = await factsNow()
      if (seen !== null && last?.facts != null && !(now - last.at >= atLeast) && !(await limitsOld())) {
        const news = unseenSince(last.facts, seen)
        if (news.odd.length === 0 && news.rules.length === 0) {
          if (note?.why !== NOTHING_ODD) {
            note = { at: now, why: NOTHING_ODD, asked: false }
            await save()
          }
          return null
        }
      }
      return start(now, { asked: false, subject: null, seen })
    },
    /** "Check now": a sweep at once, or why none runs (Review Focus 4). */
    async now({ subject = null, at }) {
      await load()
      if (await settle(at)) await save()
      const why = whyNoSweep(await chat())
        ?? ((await paused()) ? 'the person pauses all chats' : null)
        ?? ((await atLimit()) ? 'a limit of the plan is full' : null)
        ?? (isOpen() ? `the sweep asked at ${clockOf(last.at)} still runs` : null)
        ?? ((await sweeping()) ? 'a sweep still runs' : null)
      if (why !== null) {
        note = { at, why, asked: true }
        await save()
        return { started: false, why, note: null }
      }
      return start(at, { asked: true, subject, seen: await factsNow() })
    },
    /**
     * The supervisor chat's work calls while a sweep runs: `{ action, ok, session, since, at }`. A health read and each
     * incident filed count for the sweep; its turn's end ends it (the turn's session and start, for its tokens).
     */
    async heard({ action, ok = true, session = null, since = null, at }) {
      await load()
      if (!isOpen() || ok !== true) return
      if (action === 'health') last = { ...last, read: true }
      else if (action === 'incident') last = { ...last, found: last.found + 1 }
      else if (action === 'turn-ended') {
        const turn = Number(since)
        // What stands now, with what the sweep filed, is seen: the next sweep by the clock waits for something that comes after.
        const after = await factsNow()
        if (after !== null && last.facts != null) last = { ...last, facts: bothFacts(last.facts, after) }
        end(at, 'told', {
          session: typeof session === 'string' && session !== '' ? session : last.session,
          from: Number.isFinite(turn) ? turn : last.from,
          note: last.read ? last.note : `it ended without reading work health (its Workers mod may be older than ${SWEEP_MOD}, or it was asked something else)`,
        })
      } else return
      await save()
    },
    view: () => ({ last, note: note !== null && (last === null || note.at >= last.at) ? note : null, recent }),
  }
}
