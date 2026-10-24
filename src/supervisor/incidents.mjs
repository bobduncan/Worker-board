// The supervisor's incidents (spec 2026-10-24, "Incidents"): each finding of a watch rule (and each rule that failed) is
// filed in the work store as an incident, `X<n>`, through the work API as the board (`incident`, src/work/api.mjs). The
// store keeps it by the finding's key: a new key opens one, the same key again only counts it (its count and last-seen
// time grow; Review Focus 2: a lasting problem is one incident, never a new line every 3 minutes), and the key of one
// that was fixed makes it "came back". Only what opened or came back goes on to the person and the partner.

import { sinceMs } from '../work/item.mjs'

const DAY = 24 * 60 * 60_000

/**
 * Files `findings` (`{ rule, key, subject, text, evidence }`), one record per key in a run, through `work` (the work API
 * as the board: `body → { ok, result | why }`). Answers `{ opened, returned, counted, failed }`: the incidents' ids by
 * what became of them, and `{ key, why }` for each finding that could not be filed (tried again at the next run, as it
 * is seen again). It never throws.
 */
export async function recordFindings(findings, { work }) {
  const opened = []
  const returned = []
  const counted = []
  const failed = []
  const keys = new Set()
  for (const one of findings) {
    if (typeof one?.key !== 'string' || one.key === '' || keys.has(one.key)) continue
    keys.add(one.key)
    let done
    try {
      done = await work({ action: 'incident', key: one.key, title: one.text, subject: one.subject ?? '', evidence: one.evidence ?? '', source: one.rule })
    } catch (error) {
      done = { ok: false, why: error instanceof Error ? error.message : String(error) }
    }
    if (done?.ok !== true || typeof done.result?.id !== 'string') {
      failed.push({ key: one.key, why: done?.why ?? 'no answer' })
      continue
    }
    const id = done.result.id
    if (done.result.opened === true) opened.push(id)
    else if (done.result.returned === true) returned.push(id)
    else counted.push(id)
  }
  return { opened, returned, counted, failed }
}

/**
 * The incidents as the section shows them, from the store's items: every one not fixed, and those fixed in the last
 * day, the newest seen first: `{ id, title, state, fix, source, subject, count, firstSeen, lastSeen, evidence, ruleWanted }`.
 */
export function incidentsOf(items, now) {
  const value = (item, key) => {
    const one = item.head.get(key)
    return one === undefined || one === '' || one === '-' ? null : one
  }
  return [...(items?.values() ?? [])]
    .filter(item => value(item, 'Kind') === 'incident')
    .map(item => ({
      id: value(item, 'Id'), title: value(item, 'Title'), state: value(item, 'State'), fix: value(item, 'Fix'), source: value(item, 'Source'),
      subject: value(item, 'Subject'), count: Number(value(item, 'Count')) || 0, firstSeen: sinceMs(value(item, 'First seen')),
      lastSeen: sinceMs(value(item, 'Last seen')), evidence: value(item, 'Evidence'), ruleWanted: value(item, 'Rule wanted'),
    }))
    .filter(one => one.state !== 'fixed' || !(now - one.lastSeen >= DAY))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || String(b.id).localeCompare(String(a.id), 'en', { numeric: true }))
}
