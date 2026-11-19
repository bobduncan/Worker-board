// B1274 (F36b, Workers mod 0.34.0): the probe, observe only (chat 1's conditions, 2026-11-19). On a work login the company guard
// (sec-default) skips some of a person's mod hooks; which ones can only be seen there. Once per process the mod records, per event,
// that its hook ran (prompt.submit, turn.start, session.append for the person's prompt row) and whether one rewrite of that row stood
// (a short comment added beside the prompt, read back from the row as stored). It never retries, never changes the rewrite to get
// past the guard, and touches no guard setting. The board keeps the records in data/mod-probe.json. PURE helpers here.

/** Where the mod sends its probe records: the board keeps them (data/mod-probe.json), observe only. */
export const PROBE_PATH = '/api/bridge/probe'
/** The one mark the probe adds beside the first prompt of a process: a comment, so the model reads it as nothing to act on. */
export const PROBE_MARK = '<!-- worker board probe: may a mod add words beside a prompt here? -->'

type Block = { type: string; text?: string; [key: string]: unknown }

/** The row's content with the mark added: a text as text plus the mark, blocks with one text block more. Anything else as it is. */
export function withProbeMark(content: unknown): unknown {
  if (typeof content === 'string') return `${content}\n\n${PROBE_MARK}`
  if (Array.isArray(content)) return [...(content as Block[]), { type: 'text', text: PROBE_MARK }]
  return content
}

/** Whether the row as stored holds the mark (the rewrite stood). */
export function hasProbeMark(content: unknown): boolean {
  if (typeof content === 'string') return content.includes(PROBE_MARK)
  if (Array.isArray(content)) return (content as Block[]).some(block => typeof block?.text === 'string' && block.text.includes(PROBE_MARK))
  return false
}

/** A probe record as the board takes it: the event, that its hook ran, and for session.append the door and the rewrite's outcome. */
export type ProbeRecord = { event: 'prompt.submit' | 'turn.start' | 'session.append'; ran: true; door?: string; rewrite?: 'stood' | 'undone' | 'refused' }
