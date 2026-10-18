// B352: the partner's high effort mode. The person, 2026-10-18 (I16): "while refining a goal, i want a button to change
// the claude chat working on it, to other model/effort, lets call it high effort mode. so like fable 5.1 max effort.
// otherwise it will use opus extra". The board cannot change a chat itself: the switch on the Focus page types
// `partner effort` into the main chat, which sets the partner's chat with the app's session tools (roles/main.md). That
// it is set the board reads from the partner's own transcript, whose every answer names the model and the effort it ran
// on. Go on the how and a new focus switch it back to the usual partner (the person's yes, 2026-10-18).

/** The two modes: the usual partner, and high effort for the vibe and the how of a hard goal. */
export const PARTNER_MODES = {
  usual: { model: 'claude-opus-5-5', effort: 'xhigh', label: 'Opus 5.5, extra high' },
  high: { model: 'claude-fable-5-1', effort: 'max', label: 'Fable 5.1, max' },
}

/**
 * The word that asks the main chat to set the partner's chat (`partner`, its app session id `session` when the board
 * knows it) to `mode`, and `why`. One message of the outbox, to the main chat.
 */
export function partnerEffortWords({ to, partner, session, mode, why }) {
  const { model, effort } = PARTNER_MODES[mode]
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'partner-effort', about: partner, mode,
    text: ['partner effort', `Chat: ${partner}`, `Mode: ${mode}`, `Model: ${model}`, `Effort: ${effort}`, ...id, `Why: ${why}`].join('\n'),
  }
}

/**
 * The partner's mode for the page: the mode last asked for it (`sent`, the outbox; the usual one when none was), what
 * its last answer ran on (`entries`, its parsed transcript; null when it cannot be read), and whether that is the mode
 * asked, answered after the ask. `labels` name both modes for the switch.
 */
export function partnerEffort({ sent, partner, entries }) {
  const last = (sent ?? []).findLast(message => message.command === 'partner-effort' && message.about === partner && (message.mode === 'high' || message.mode === 'usual'))
  const mode = last?.mode ?? 'usual'
  // The app's own lines (an error, a limit) carry no model of Claude's.
  const answer = (entries ?? []).findLast(entry => entry.type === 'assistant' && typeof entry.model === 'string' && entry.model.startsWith('claude-'))
  const runsOn = answer === undefined || answer.at === null ? null : { model: answer.model, effort: answer.effort, at: answer.at }
  const wanted = PARTNER_MODES[mode]
  const isSet = last === undefined || (runsOn !== null && runsOn.model === wanted.model && runsOn.effort === wanted.effort && runsOn.at >= last.at)
  return {
    mode,
    asked: last === undefined ? null : { at: last.at, state: last.state, label: wanted.label },
    runsOn,
    isSet,
    labels: { usual: PARTNER_MODES.usual.label, high: PARTNER_MODES.high.label },
  }
}

/** Why a move of the Focus page switches the partner back to the usual mode: Go on the how, or a new focus; else null. */
export function effortBack(command, effort) {
  if (effort?.mode !== 'high') return null
  if (command === 'how-go') return 'Go on the how: back to the usual partner'
  if (command === 'focus') return 'a new focus: back to the usual partner'
  return null
}
