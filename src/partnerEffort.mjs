// B352: the partner's high effort mode. The person, 2026-10-18 (I16): "while refining a goal, i want a button to change
// the claude chat working on it, to other model/effort, lets call it high effort mode. so like fable 5.1 max effort.
// otherwise it will use opus extra". The board cannot change a chat itself: the switch on the Focus page types
// `partner effort` into the main chat, which sets the partner's chat with the app's session tools (roles/main.md; B755:
// a running chat's Workers mod sets it by code first, never Fable, src/hands.mjs). That
// it is set the board reads from the partner's own transcript, whose every answer names the model and the effort it ran
// on. Go on the how and a new focus switch it back to the usual partner (the person's yes, 2026-10-18).

/**
 * The modes: the usual partner, high effort for the goal definition and the how of a hard goal (Opus at max since 2026-10-24), and
 * Fable, only for a goal guard's evaluation the person said yes to (the person, 2026-10-24: "you cant run fable without my
 * permission"; src/goalGuard.mjs `fableAskOf`).
 */
import { familyOf, isSetRefused } from './work/effort.mjs'
import { AGAIN_AFTER_MS, TRIES, passesBySelf } from './work/passing.mjs'

/** F5 verifier 4: how long after a failure the outbox's retry still comes (it copies a word AGAIN_AFTER_MS after it failed, at a sweep). */
const RETRY_DUE_MS = AGAIN_AFTER_MS + 2 * 60_000

export const PARTNER_MODES = {
  usual: { model: 'claude-opus-5-5', effort: 'xhigh', label: 'Opus 5.5, extra high' },
  high: { model: 'claude-opus-5-5', effort: 'max', label: 'Opus 5.5, max' },
  fable: { model: 'claude-fable-5-1', effort: 'max', label: 'Fable 5.1, max' },
}

/** The modes the person's switch on the Focus page sets: never Fable. */
export const SWITCH_MODES = ['usual', 'high']

/**
 * The word that asks the main chat to set the partner's chat (`partner`, its app session id `session` when the board
 * knows it) to `mode`, and `why`. One message of the outbox, to the main chat. Mode fable only with `yes`, the board's
 * ask the person answered yes (Q<n>): the word names it, and without it nothing is made (it throws).
 */
export function partnerEffortWords({ to, partner, session, mode, why, yes = null, forModel = false }) {
  if (!Object.hasOwn(PARTNER_MODES, mode ?? '')) throw new Error(`No partner mode "${String(mode).slice(0, 20)}".`)
  if (mode === 'fable' && !/^Q\d+$/.test(String(yes ?? ''))) throw new Error('Fable only with the person\'s yes: name the ask they answered yes.')
  const { model, effort } = PARTNER_MODES[mode]
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  const said = mode === 'fable' ? [`Yes: ${yes}, the person's yes: Fable for this evaluation only`] : []
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'partner-effort', about: partner, mode,
    // B1160 part 2 (round 3, item 2): while the app refuses the board's set calls, a word for Main's model: no hand takes it.
    ...(forModel === true ? { forModel: true } : {}),
    text: ['partner effort', `Chat: ${partner}`, `Mode: ${mode}`, `Model: ${model}`, `Effort: ${effort}`, ...id, ...said, `Why: ${why}`].join('\n'),
  }
}

/**
 * The partner's mode for the page: the mode last asked for it (`sent`, the outbox), what its last answer ran on
 * (`entries`, its parsed transcript; null when it cannot be read), and whether that is the mode asked, answered after
 * the ask. Without a word (none was asked, or the outbox forgot it after two hours) what the partner runs on says the
 * mode, so high effort is still known, and switched back on Go. A word that did not arrive (expired, or the Workers mod
 * could not type it) changed nothing: it is `missed`. `labels` name the modes for the switch.
 */
export function partnerEffort({ sent, partner, entries, now = null }) {
  const words = (sent ?? []).filter(message => message.command === 'partner-effort' && message.about === partner && Object.hasOwn(PARTNER_MODES, message.mode ?? ''))
  // B1160 round 3, items 1 and 3: a word the app refused (closed by the sweep as refused) changed nothing either: the mode is not taken from it.
  // F5 review 9: a failed word whose retry is still to come is not missed: the switch shows it settling.
  // F5 verifier 4: only while a retry really is due: its copy waits, or (no copy yet) the outbox's retry would still make one: a failure
  // time within RETRY_DUE_MS of `now`, tries left, a reason that passes by itself, not final. Without `now` only a waiting copy counts.
  const isRetryComing = message => message.state === 'failed' && (message.retriedAs !== undefined
    ? words.some(one => one.id === message.retriedAs && one.state === 'waiting')
    : message.final !== true && passesBySelf(message.why) && (message.tries ?? 1) < TRIES && Number.isFinite(now) && Number.isFinite(message.failedAt) && now - message.failedAt < RETRY_DUE_MS)
  const isMissed = message => message.state === 'expired' || (message.state === 'failed' && !isRetryComing(message)) || message.refused === true
  const last = words.findLast(message => !isMissed(message))
  const latest = words.at(-1)
  // The app's own lines (an error, a limit) carry no model of Claude's; a helper's lines are not the partner's.
  const answer = (entries ?? []).findLast(entry => entry.type === 'assistant' && !entry.isSidechain && typeof entry.model === 'string' && entry.model.startsWith('claude-'))
  const runsOn = answer === undefined || answer.at === null ? null : { model: answer.model, effort: answer.effort, at: answer.at }
  const runs = mode => runsOn !== null && runsOn.model === PARTNER_MODES[mode].model && runsOn.effort === PARTNER_MODES[mode].effort
  // Fable set by hand (no word) reads as Fable too, so Go switches it back as it does high.
  const mode = last?.mode ?? (runs('fable') ? 'fable' : runs('high') ? 'high' : 'usual')
  const isSet = last === undefined || (runs(mode) && runsOn.at >= last.at)
  return {
    mode,
    asked: last === undefined ? null : { at: last.at, state: last.state, label: PARTNER_MODES[mode].label },
    // Review: a lost word whose mode the partner runs on anyway asks for nothing more.
    missed: latest !== undefined && isMissed(latest) && !runs(latest.mode) ? { at: latest.at, state: latest.state } : null,
    // B1160 (verifier 4, 5, 7): the app refused the board's set call for it (it does not run a plugin's own set call in auto mode):
    // what it runs on, for the switch's plain line; null otherwise.
    // Round 3, item 4: only once no try is left (the sweep's close, or the last try refused): a retry may still carry it.
    refused: latest !== undefined && (latest.refused === true || (isSetRefused(latest) && ((latest.tries ?? 1) >= TRIES || latest.final === true))) && !runs(latest.mode) ? { runs: runsOn === null ? null : [familyOf(runsOn.model), runsOn.effort].filter(Boolean).map((one, index) => (index === 0 ? one[0].toUpperCase() + one.slice(1) : one)).join(' · ') } : null,
    runsOn,
    isSet,
    labels: { usual: PARTNER_MODES.usual.label, high: PARTNER_MODES.high.label, fable: PARTNER_MODES.fable.label },
  }
}

/** Why a move of the Focus page switches the partner back to the usual mode: Go on the how, or a new focus; else null. */
export function effortBack(command, effort) {
  if (effort?.mode !== 'high' && effort?.mode !== 'fable') return null
  if (command === 'how-go') return 'Go on the how: back to the usual partner'
  if (command === 'focus') return 'a new focus: back to the usual partner'
  return null
}

/**
 * 2026-10-24: Fable never stays on. When the board set the partner on Fable (its own word: `effort.asked`) and the
 * evaluations that run (`running`, src/focus.mjs `evaluationsMode`) no longer all had the person's yes, the mode the
 * board's tick sends it back to, `{ mode, why }`: the usual partner when none runs, else Opus at max. Null otherwise;
 * Fable the person set by hand (no word of the board's) is theirs.
 */
export function fableBack(effort, running) {
  if (effort?.mode !== 'fable' || (effort.asked ?? null) === null || running?.mode === 'fable') return null
  return running?.mode === 'high'
    ? { mode: 'high', why: 'the evaluations that run had no yes to Fable from the person: Opus 5.5 at max' }
    : { mode: 'usual', why: 'no evaluation with the person\'s yes to Fable runs: back to the usual partner' }
}
