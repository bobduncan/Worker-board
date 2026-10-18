// B313: the store follows a chat's rename by itself. The board knows each chat by its session id (the key of its card,
// `.claude/chats/<session>.json`) and the name the list gives it. At every refresh it holds those against names.json,
// the last name it saw per session; a session under another name than before is the same chat renamed, and every open
// item naming the old name moves to the new one, once (the work API's `rename`, as the board, "(same chat)"). A first
// sight of a session only records its name. A name two chats had, or a new name another chat has too, is not moved:
// the rename stands under `held`, said on top until the main chat moves it with `work rename`.

import { plainName } from './names.mjs'
import { readNamesFile, writeNames } from './store.mjs'
import { stamp } from './migrate.mjs'

/**
 * One refresh. `chats` are the board's chats (`{ session, name }`, leftovers too: an older chat of the same name holds
 * it as well); `apply(body)` is the work API as the board. `{ moved: [{ from, to, ids }], held: [{ from, to, why }] }`:
 * what moved now, and the renames held now (each once).
 */
export async function followRenames({ dir, chats, apply, now = Date.now(), prefix = '', fs }) {
  const { record, text } = await readNamesFile(dir, fs)
  const current = new Map()
  for (const chat of chats ?? []) {
    if (typeof chat?.session === 'string' && chat.session !== '' && typeof chat.name === 'string' && chat.name.trim() !== '' && !current.has(chat.session)) current.set(chat.session, chat.name.trim())
  }
  const sessions = { ...record.sessions }
  const renames = []
  for (const [session, name] of current) {
    const before = sessions[session]
    if (before !== undefined && plainName(before, prefix) !== plainName(name, prefix)) renames.push({ session, from: before, to: name })
    else sessions[session] = name
  }
  const holders = name => [...current.values()].filter(one => plainName(one, prefix) === plainName(name, prefix)).length
  const moved = []
  const held = []
  for (const one of renames) {
    const fromTwice = holders(one.from) > 0 || renames.filter(other => plainName(other.from, prefix) === plainName(one.from, prefix)).length > 1
    const why = fromTwice ? `two chats had the name ${one.from}` : holders(one.to) > 1 ? `two chats have the name ${one.to} now` : null
    if (why !== null) {
      held.push({ from: one.from, to: one.to, why })
      sessions[one.session] = one.to
      continue
    }
    const done = await apply({ action: 'rename', from: one.from, to: one.to, same: true })
    // Not carried out (the store could not be written): the next refresh tries again.
    if (!done?.ok || (done.result.failed ?? []).length > 0) continue
    moved.push({ from: one.from, to: one.to, ids: done.result.moved ?? [] })
    sessions[one.session] = one.to
  }
  const next = { sessions, held: [...record.held, ...held.map(one => ({ ...one, prefix, at: stamp(now) }))] }
  if (JSON.stringify(next) !== JSON.stringify(record) || text === null) await writeNames(dir, next, fs, { expected: text })
  return { moved, held }
}
