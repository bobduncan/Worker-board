// B775: the button "Find obsolete items" under Needs your attention. The board gathers each open item's evidence (code),
// the Advisor judges them once (obsolete, unsure or open, one line each: `work obsolete`), and the obsolete ones close at once
// (the person, 2026-10-31); unsure and open ones stay. `obsolete-close` still closes given ids as the person would. The check lives in the store's folder
// (`obsolete-check.json`), so a restart of the board keeps it. PURE (the file and the page's view); the work API writes it.

import { valueOf, sinceMs } from './item.mjs'
import { stamp } from './migrate.mjs'
import { isRoutedToPartner } from './partnerAnswers.mjs'

export const OBSOLETE_FILE = 'obsolete-check.json'
/** A check the Advisor has not answered within this long is late: the page says so, with Try again (and a new check may start). */
export const LATE_MS = 15 * 60_000
export const VERDICTS = ['obsolete', 'unsure', 'open']
const INCIDENT_OPEN = ['open', 'came back', 'with the advisor']
const WHY_CHARS = 240
const EVIDENCE_CHARS = 320
const TITLE_CHARS = 140

const numberOf = id => Number(String(id).replace(/\D/g, '')) || 0
/** Ids in order: by their letter, then their number (Q2 before Q10, the asks before the incidents). */
const byId = (a, b) => String(a.id)[0].localeCompare(String(b.id)[0], 'en') || numberOf(a.id) - numberOf(b.id) || a.id.localeCompare(b.id, 'en')
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * `obsolete-check.json` read: null for none; else `{ state: 'checking' | 'done', at, answeredAt, items, verdicts, last }`.
 * `items` the open items of the check with their evidence (`[{ id, kind, title, of, owner, at, evidence: [line] }]`),
 * `verdicts` per id (`{ verdict, why, evidence }`), `last` what the person's last close did (`{ at, closed }`).
 */
export function parseObsolete(text) {
  if (typeof text !== 'string') return null
  try {
    const raw = JSON.parse(text)
    if (!['checking', 'done'].includes(raw?.state) || !Number.isFinite(raw.at) || !Array.isArray(raw.items)) return null
    const items = raw.items.filter(one => typeof one?.id === 'string').map(one => ({
      id: one.id, kind: typeof one.kind === 'string' ? one.kind : 'ask', title: oneLine(one.title, TITLE_CHARS), of: typeof one.of === 'string' ? one.of : null,
      owner: typeof one.owner === 'string' ? one.owner : null, at: Number.isFinite(one.at) ? one.at : null,
      evidence: Array.isArray(one.evidence) ? one.evidence.filter(line => typeof line === 'string') : [],
    }))
    const verdicts = {}
    for (const [id, one] of Object.entries(raw.verdicts ?? {})) {
      if (VERDICTS.includes(one?.verdict)) verdicts[id] = { verdict: one.verdict, why: oneLine(one.why, WHY_CHARS), evidence: oneLine(one.evidence, EVIDENCE_CHARS) }
    }
    return {
      state: raw.state, at: raw.at, answeredAt: Number.isFinite(raw.answeredAt) ? raw.answeredAt : null, items, verdicts,
      last: Number.isFinite(raw.last?.at) && Number.isFinite(raw.last?.closed) ? { at: raw.last.at, closed: raw.last.closed } : null,
    }
  } catch {
    return null
  }
}

/** Whether a check the Advisor has not answered is late now. */
export const isLate = (record, now) => record?.state === 'checking' && now - record.at >= LATE_MS

/**
 * The open items Needs your attention holds that a check judges, oldest id first: an ask for the person (a refine question,
 * a Do, any other; not one the partner has first) and an incident that is not fixed, closed or being fixed.
 * `{ id, kind: 'refine' | 'do' | 'ask' | 'incident', title, of, owner, at, state }`.
 */
export function openItemsOf(items) {
  const found = []
  for (const item of items?.values() ?? []) {
    const id = valueOf(item, 'Id')
    const kind = valueOf(item, 'Kind')
    const state = valueOf(item, 'State')
    if (kind === 'ask' && state === 'open' && !isRoutedToPartner(item)) {
      const asks = valueOf(item, 'Asks') ?? 'decide'
      found.push({
        id, kind: valueOf(item, 'Via') === 'refine' ? 'refine' : asks === 'do' ? 'do' : 'ask', title: oneLine(valueOf(item, 'Title'), TITLE_CHARS),
        of: valueOf(item, 'Of'), owner: valueOf(item, 'Owner'), at: sinceMs(valueOf(item, 'Since')), state,
      })
    } else if (kind === 'incident' && INCIDENT_OPEN.includes(state)) {
      found.push({ id, kind: 'incident', title: oneLine(valueOf(item, 'Title'), TITLE_CHARS), of: valueOf(item, 'Subject'), owner: null, at: sinceMs(valueOf(item, 'First seen')), state })
    }
  }
  return found.sort(byId)
}

const ID = '(?:[A-Z]\\d+|L-[0-9a-f]{8})'
const POINT = new RegExp(`^\\s*(${VERDICTS.join('|')})\\s*:\\s*(${ID})\\s*(?:·\\s*(.*))?$`)

/**
 * The Advisor's points, "obsolete|unsure|open: <id> · <why> · <evidence>", one per line (`points`, lines or one text): the
 * verdicts per id, or the first line that is none (`bad`). The evidence is what follows the why after a " · ".
 */
export function obsoletePointsOf(points) {
  const lines = (Array.isArray(points) ? points : typeof points === 'string' ? points.split('\n') : []).filter(one => typeof one === 'string' && one.trim() !== '')
  const verdicts = {}
  for (const line of lines) {
    const found = line.match(POINT)
    if (found === null) return { verdicts, bad: oneLine(line, 80) }
    const [why = '', ...evidence] = (found[3] ?? '').split(' · ')
    verdicts[found[2]] = { verdict: found[1], why: oneLine(why, WHY_CHARS), evidence: oneLine(evidence.join(' · '), EVIDENCE_CHARS) }
  }
  return { verdicts, bad: null }
}

const KIND_WORDS = { refine: 'refine question', do: 'Do', ask: 'ask', incident: 'incident' }

/** One item as the Advisor reads it: its line, then its evidence lines. */
export function itemWords(one) {
  const of = one.of === null ? '' : ` of ${one.of}`
  return [`${one.id} (${KIND_WORDS[one.kind] ?? one.kind}${of}): ${one.title}`, ...one.evidence.map(line => `  · ${line}`)].join('\n')
}

/** What `work obsolete` without points answers while a check waits: every item with its evidence, and how to answer. */
export function checkWords(record) {
  return [
    `Obsolete check of ${record.items.length} open item${record.items.length === 1 ? '' : 's'} (asked ${stamp(record.at)}):`,
    ...record.items.map(itemWords),
    'Answer once with work obsolete and points, one line per item: "obsolete|unsure|open: <id> · <why> · <evidence>". Close nothing, change nothing else.',
  ].join('\n')
}

const ORDER = { obsolete: 0, unsure: 1, open: 2 }

/**
 * The check as the page draws it: `{ state: 'none' | 'checking' | 'late' | 'done', at, openCount, rows, last }`. Each row:
 * `{ id, kind, title, of, verdict, why, evidence, ticked }`: obsolete ones come ticked, unsure and open ones do not; an item
 * the Advisor gave no line gets unsure. `openCount` the items open now (the button shows only when there are any).
 */
export function obsoleteView(record, { now, openCount }) {
  if (record === null) return { state: 'none', at: null, openCount, rows: [], last: null }
  const rows = record.items.map(one => {
    const given = record.verdicts[one.id]
    const verdict = record.state === 'checking' ? null : given?.verdict ?? 'unsure'
    return {
      id: one.id, kind: one.kind, title: one.title, of: one.of, verdict,
      why: record.state === 'checking' ? '' : given?.why ?? 'The Advisor gave no line for it.', evidence: given?.evidence ?? '',
      ticked: verdict === 'obsolete',
    }
  }).sort((a, b) => (ORDER[a.verdict] ?? 3) - (ORDER[b.verdict] ?? 3) || byId(a, b))
  return { state: isLate(record, now) ? 'late' : record.state, at: record.at, openCount, rows: record.state === 'checking' ? [] : rows, last: record.last }
}
