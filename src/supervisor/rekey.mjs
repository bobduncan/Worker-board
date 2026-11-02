// Signals change 4's follow-up (2026-11-02, the lead's note after the landing): change 4 changed the key of the rule
// handover-unanswered (one per envelope → one per worker and spell) without a migration, so the open X119-X122 were
// re-filed as X124-X127 (the same four misses of 10:31-12:44) and the old ones kept counting. From now on every change of a
// rule's key form carries an entry here: the board's loop re-keys an open incident under the old form to the new one
// where it matches, else closes it as superseded, with one History line that says so. PURE: `rekeyPlan` answers what to
// do; the supervisor's loop carries it out through the work API (`incidents-rekey`, the board's own action).

const MIN = 60_000
/** The states in which an incident still stands (not fixed, not closed): only those are re-keyed or superseded. */
export const STANDING = ['open', 'came back', 'with the advisor', 'with the supervisor', 'fix']

/**
 * The key migrations, oldest first: `{ rule, change, old (a RegExp over the whole key), newKey(match, ctx) → the new key or
 * null (null: superseded, nothing to re-key to) }`. `ctx` is `{ outbox, spellsOf(chat) → the wake record's spells of that
 * chat, oldest first }`.
 */
export const KEY_MIGRATIONS = Object.freeze([
  {
    rule: 'handover-unanswered',
    change: 'change 4 (B908): one incident per worker and spell, not per envelope',
    old: /^handover-unanswered ([0-9a-f]{16})$/,
    newKey: (match, { outbox, spellsOf }) => {
      const envelope = (outbox ?? []).find(one => one?.id === match[1] && one.command === 'handover')
      if (envelope === undefined || typeof envelope.to !== 'string' || !Number.isFinite(envelope.at)) return null
      // As the rule keys it (watch.mjs handoverUnanswered): the newest spell that began before the envelope, else its minute.
      const slept = spellsOf(envelope.to).filter(spell => Number.isFinite(spell) && spell <= envelope.at).at(-1)
      return `handover-unanswered ${envelope.to} ${slept ?? Math.floor(envelope.at / MIN) * MIN}`
    },
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
  const ctx = { outbox, spellsOf: chat => (Array.isArray(wakes?.[chat]?.spells) ? wakes[chat].spells : []) }
  for (const item of standing) {
    const key = value(item, 'Key')
    const id = value(item, 'Id')
    if (key === null || id === null) continue
    for (const migration of migrations) {
      const match = migration.old.exec(key)
      if (match === null) continue
      const next = migration.newKey(match, ctx)
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
