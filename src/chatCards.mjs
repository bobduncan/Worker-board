// 2026-10-28: the chats' cards in the project, `<project>\.claude\chats\<session>.json`, read for the one question the
// whoami call asks (bridge.mjs `cardSessionOf`): under which session is this chat's card filed? Read only; nothing is
// written, and no card's words leave this file but its name and `at`.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { cardSessionOf } from './bridge.mjs'

/** A session id as the mod names a card file (`fileName`): letters, digits, "_" and "-". */
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/
/** A card is a few KB; a file past this is no card. */
const MOST_CARD_CHARS = 200_000
/** How many files are open at once. */
const AT_ONCE = 32

async function readCard(path) {
  try {
    const text = await readFile(path, 'utf8')
    return text.length <= MOST_CARD_CHARS ? text : null
  } catch {
    return null
  }
}

/** Every card file of the folder, as `{ session, text }`: not `list.json`, not the `own` folder, not a file that cannot be read. */
export async function readCardRows(dir) {
  let names
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json') && name !== 'list.json' && SAFE_ID.test(name.slice(0, -5)))
  } catch {
    return []
  }
  const rows = []
  for (let from = 0; from < names.length; from += AT_ONCE) {
    const batch = await Promise.all(names.slice(from, from + AT_ONCE).map(async name => ({ session: name.slice(0, -5), text: await readCard(join(dir, name)) })))
    rows.push(...batch.filter(row => row.text !== null))
  }
  return rows
}

/**
 * The session the card of the chat `name` is filed under, when it is not `session` (the one that asks): null when the
 * asking session has a file of its own (its card is where it should be, whatever it says: a chat that left, or one
 * that was cleared away from, is not moved back), or when no card of that name is filed under another session.
 */
export async function cardFiledUnder(dir, { name, session, shown }) {
  if (!SAFE_ID.test(session)) return null
  if (await readCard(join(dir, `${session}.json`)) !== null) return null
  return cardSessionOf(await readCardRows(dir), { name, session, shown })
}
