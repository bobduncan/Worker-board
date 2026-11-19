// B1274 (F36b): the board's side of the Workers mod's probe (0.34.0), observe only: which of the mod's hooks ran on the login in use
// (prompt.submit, turn.start, session.append for the person's prompt row) and whether its one rewrite of that row stood. Kept in
// data/mod-probe.json for chat 1's check on a work login. PURE.

/** The events the probe reports. */
export const PROBE_EVENTS = ['prompt.submit', 'turn.start', 'session.append']
/** How a rewrite of the prompt row came out: it stood, the engine put the row back, or the call was refused. */
export const REWRITES = ['stood', 'undone', 'refused']

const text = value => (typeof value === 'string' && value !== '' ? value.slice(0, 200) : null)

/** The record kept for a probe call (`body.probe` as the mod sent it, its chat, session and mod version), or null for none. */
export function probeEntry(body, { at, account = null }) {
  const probe = body?.probe
  if (probe === null || typeof probe !== 'object' || !PROBE_EVENTS.includes(probe.event)) return null
  return {
    at, chat: text(body.chat), session: text(body.session), mod: text(body.mod), account: text(account), event: probe.event, ran: probe.ran === true,
    ...(probe.event === 'session.append' ? { door: text(probe.door), rewrite: REWRITES.includes(probe.rewrite) ? probe.rewrite : null } : {}),
  }
}

/** The kept records with one more: the newest `most`. */
export const keptProbes = (list, entry, most = 100) => [...(Array.isArray(list) ? list : []), entry].slice(-most)
