// Signals change 4's follow-up (2026-11-02, the lead's note after the landing): change 4 changed the key of the rule
// handover-unanswered (one per envelope → one per worker and spell) without a migration, so the open X119-X122 were
// re-filed as X124-X127 (the same four misses of 10:31-12:44) and the old ones kept counting. From now on every change of a
// rule's key form carries an entry here: the board's loop re-keys an open incident under the old form to the new one
// where it matches, else closes it as superseded, with one History line that says so. PURE: `rekeyPlan` answers what to
// do; the supervisor's loop carries it out through the work API (`incidents-rekey`, the board's own action).

/** The states in which an incident still stands (not fixed, not closed): only those are re-keyed or superseded. */
export const STANDING = ['open', 'came back', 'with the advisor', 'with the supervisor', 'fix']

/**
 * The key migrations, oldest first: `{ rule, change, old (a RegExp over the whole key), newKey(match, ctx) → the new key or
 * null (null: superseded, nothing to re-key to) }`. `ctx` is `{ outbox, subject (the incident's Subject), spellsOf(chat) →
 * the wake record's spells of that chat, oldest first }`.
 */
export const KEY_MIGRATIONS = Object.freeze([
  // The first form (T8.5): the envelope id alone → the chat and the envelope id (the Subject is the chat).
  {
    rule: 'handover-unanswered',
    change: 'change 4 (B908) and its fix of 2026-11-02: the key is the chat and the envelope id',
    old: /^handover-unanswered ([0-9a-f]{16})$/,
    newKey: (match, { outbox, subject }) => {
      const envelope = (outbox ?? []).find(one => one?.id === match[1] && one.command === 'handover')
      const chat = typeof envelope?.to === 'string' ? envelope.to : subject
      return typeof chat === 'string' && chat !== '' ? `handover-unanswered ${chat} ${match[1]}` : null
    },
  },
  // Change 4's first form (14:2x-14:47 on 2026-11-02): the chat and a spell time, which took a lane or report time and so
  // opened the same misses again at every lane change (X124-X130). No envelope can be told from it: superseded.
  {
    rule: 'handover-unanswered',
    change: 'the fix of 2026-11-02: the key is the chat and the envelope id, never a time',
    // A time in ms is 13 digits for decades; an envelope id is 16 hex characters, so one of digits alone never matches.
    old: /^handover-unanswered (.+) (\d{12,14})$/,
    newKey: () => null,
  },
  // Signals change 6 (B915, the lead's Addendum 2): four keys that changed while their fault stayed (a newer checkpoint line,
  // another why of the hold, a stop's time, the step a worker is on) are the rule and the subject only, so "gone" never reads
  // a new key as a cure. An open incident under the old form is re-keyed to the stable one (X75 'stale-checkpoint B670 none'
  // → 'stale-checkpoint B670'; X110 'effort-mismatch Worker 4 B810' → 'effort-mismatch Worker 4').
  {
    rule: 'stale-checkpoint',
    change: 'change 6 (B915): the key is the rule and the step',
    old: /^stale-checkpoint (B\d+) (.+)$/,
    newKey: match => `stale-checkpoint ${match[1]}`,
  },
  {
    rule: 'review-held',
    change: 'change 6 (B915): the key is the rule and the first step of the chain',
    // The old key named the held fix and its why; the incident's Subject is the chain's first step, the new key's.
    old: /^review-held (B\d+) (.+)$/,
    newKey: (match, { subject }) => (typeof subject === 'string' && /^B\d+$/.test(subject) ? `review-held ${subject}` : null),
  },
  {
    rule: 'undelivered',
    change: 'change 6 (B915): the key is the rule and the chat, also for a stopped chat',
    old: /^undelivered (.+) stopped (\d+)$/,
    newKey: match => `undelivered ${match[1]}`,
  },
  {
    rule: 'effort-mismatch',
    change: 'change 6 (B915): the key is the rule and the chat',
    old: /^effort-mismatch (.+) (B\d+)$/,
    newKey: match => `effort-mismatch ${match[1]}`,
  },
])

const value = (item, key) => {
  const one = item?.head?.get(key)
  return one === undefined || one === '' || one === '-' ? null : one
}

/**
 * What the loop does for the standing incidents under an old key form, `{ moves: [{ id, key, why }], closes: [{ id, why }] }`:
 * re-keyed to the new key when no other standing incident holds it already; else closed as superseded by that one (with its
 * id), or, when the new key cannot be told (its envelope is gone from the outbox), closed as superseded by the key change.
 * Idempotent: an incident already under the new form matches no `old`. `wakes` the state's `wakes` (newestSpells: `{ <chat>:
 * { spells } }`) or null.
 */
export function rekeyPlan({ items, outbox = [], wakes = null, migrations = KEY_MIGRATIONS }) {
  const moves = []
  const closes = []
  const incidents = [...(items?.values() ?? [])].filter(item => value(item, 'Kind') === 'incident')
  const standing = incidents.filter(item => STANDING.includes(value(item, 'State')))
  const byKey = new Map(standing.map(item => [value(item, 'Key'), value(item, 'Id')]))
  const spellsOf = chat => (Array.isArray(wakes?.[chat]?.spells) ? wakes[chat].spells : [])
  for (const item of standing) {
    const key = value(item, 'Key')
    const id = value(item, 'Id')
    if (key === null || id === null) continue
    for (const migration of migrations) {
      const match = migration.old.exec(key)
      if (match === null) continue
      const next = migration.newKey(match, { outbox, subject: value(item, 'Subject'), spellsOf })
      if (next === null) {
        closes.push({ id, why: `superseded: the key form of ${migration.rule} changed (${migration.change}) and its case cannot be told any more` })
      } else if (byKey.has(next) && byKey.get(next) !== id) {
        closes.push({ id, why: `superseded by ${byKey.get(next)}: the key form of ${migration.rule} changed (${migration.change})` })
      } else {
        moves.push({ id, key: next, why: `re-keyed from "${key}": the key form of ${migration.rule} changed (${migration.change})` })
        byKey.set(next, id)
      }
      break
    }
  }
  return { moves, closes }
}
