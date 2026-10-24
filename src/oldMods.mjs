// B541, the fix of incidents X4-X6 (2026-10-24): chats on an older Workers mod than the one installed. A new mod reaches
// a chat only when its process starts anew, so the one way to bring them up to date is the same for all of them: pause
// all, restart the Claude app, resume all. The supervisor's rule old-mod (supervisor/rules/watch.mjs) files one incident
// for all of them, and Needs your attention shows one card with that Do (server.mjs, the page's drawNeed); both read
// who runs an older mod from here. PURE.

/** The first Workers mod that says its version with every call (its header): a chat that says none runs an older one. */
export const FIRST_SAYING = '0.16.0'

/** A version's numbers, "0.15.2" as [0, 15, 2]; null for none. */
const versionOf = text => (typeof text === 'string' && /^\d+(?:\.\d+)*$/.test(text.trim()) ? text.trim().split('.').map(Number) : null)
const isOlder = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0)
  return false
}

/** What a chat misses on an older mod, by its role on the board (the work calls 0.16.0 brought in, DESIGN.md). */
function costOf(role, isUnsaid, runs) {
  if (!isUnsaid) return `it misses what came after ${runs}`
  if (role === 'partner') return 'it cannot name the fix of an incident'
  if (role === 'supervisor') return 'it cannot run a sweep'
  return 'it says no version and misses the newer work calls'
}

/**
 * The chats on an older Workers mod than the one installed, in the order of `chats` (the main chat, the workers, the
 * partner, its helper, the supervisor's chat): `[{ name, role, runs, cost }]`. `mods` is `{ installed, chats }` (the
 * version each chat's mod said lately, by the chat's name; null for one that asked without saying it). A chat whose
 * version is not known (its mod did not ask lately) is no case; one that asked without saying its version (null) runs
 * one older than FIRST_SAYING, a case once that one or a newer one is installed. Empty while nothing is installed.
 */
export function oldModChats(mods, chats = []) {
  const installed = versionOf(mods?.installed)
  const said = mods?.chats ?? {}
  if (installed === null) return []
  const found = []
  const seen = new Set()
  for (const { name, role = 'worker' } of chats) {
    if (typeof name !== 'string' || seen.has(name) || !Object.hasOwn(said, name)) continue
    seen.add(name)
    const version = said[name]
    const isUnsaid = version === null
    if (isUnsaid ? isOlder(installed, versionOf(FIRST_SAYING)) : versionOf(version) === null || !isOlder(versionOf(version), installed)) continue
    const runs = isUnsaid ? `older than ${FIRST_SAYING}` : version
    found.push({ name, role, runs, cost: costOf(role, isUnsaid, runs) })
  }
  return found
}

/**
 * The chats of the board's state by their roles, as `oldModChats` takes them: the main chat and the workers (the lanes,
 * not those left behind), the partner, its helper and the supervisor's chat.
 */
export function chatsByRole(state) {
  const one = (chat, role) => (typeof chat?.name === 'string' ? [{ name: chat.name, role }] : [])
  return [
    ...(state?.chats ?? []).filter(chat => chat?.isLeftover !== true).flatMap(chat => one(chat, chat.isMain === true ? 'main' : 'worker')),
    ...one(state?.advisor, 'partner'),
    ...one(state?.advisorHelper, 'helper'),
    ...one(state?.supervisorChat, 'supervisor'),
  ]
}

/** "A", "A and B", "A, B and C". */
const listed = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/**
 * The card under Needs your attention while chats run an older mod (kind `old-mod`), or null when every chat that asked
 * lately runs the installed one: it clears by itself once they all do. Its id is keyed by the installed version (the
 * incident's key), so one install is one card however the chats on it change. `chats` lists each with what it runs and
 * what that costs; `steps` the one way to bring them up to date, done by the person (the board restarts nothing).
 */
export function oldModNeed(mods, chats, now = Date.now()) {
  const old = oldModChats(mods, chats)
  if (old.length === 0) return null
  const names = old.map(one => one.name)
  return {
    id: `old-mod:${mods.installed}`, from: 'the board', kind: 'old-mod',
    title: `${old.length === 1 ? `${names[0]} runs` : `${old.length} chats run`} an older Workers mod: restart the app to update`,
    text: `${listed(names)} ${old.length === 1 ? 'runs' : 'run'} an older Workers mod than ${mods.installed}, the one installed. A chat takes a new mod only when it starts anew.`,
    chats: old,
    steps: ['Press Pause all and wait until every chat has stopped', 'Quit the Claude app and start it again', 'Press Resume all'],
    at: now, options: [], pictures: [], run: null, game: null, checks: [], tried: [], version: null, canAnswer: false, task: null, waits: null,
    isMain: false, isAdvisor: false, talk: null,
  }
}

/** The incident's words of the same chats (the rule old-mod): its key by the installed version, each chat named. */
export function oldModFinding(mods, chats) {
  const old = oldModChats(mods, chats)
  if (old.length === 0) return null
  const names = old.map(one => one.name)
  return {
    rule: 'old-mod', key: `old-mod ${mods.installed}`, subject: 'board',
    text: `${listed(names)} ${old.length === 1 ? 'runs' : 'run'} an older Workers mod; ${mods.installed} is installed`,
    evidence: `installed ${mods.installed}; ${old.map(one => `${one.name} ${one.runs} (${one.cost})`).join('; ')}`,
  }
}
