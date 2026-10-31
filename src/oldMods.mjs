// B541, the fix of incidents X4-X6 (2026-10-24): chats on an older Workers mod than the one installed. A new mod reaches
// a chat only when its process starts anew. B570: the board has each idle chat restarted between its steps
// (work/modRollout.mjs), so the person is shown only the chats it could not restart: on an older mod and idle for
// longer than OVERDUE_MS. For those the way is the same for all of them: pause all, restart the Claude app, resume all.
// The supervisor's rule old-mod (supervisor/rules/watch.mjs) files one incident for all of them, and Needs your
// attention shows one card with that Do (server.mjs, the page's drawNeed); both read who runs an older mod from here. PURE.

/** The first Workers mod that says its version with every call (its header): a chat that says none runs an older one. */
export const FIRST_SAYING = '0.16.0'

/** B570: a chat on an older mod still idle this long after the board's first word to restart it: the person is shown it. */
export const OVERDUE_MS = 30 * 60_000

/** A version's numbers, "0.15.2" as [0, 15, 2]; null for none. */
export const versionOf = text => (typeof text === 'string' && /^\d+(?:\.\d+)*$/.test(text.trim()) ? text.trim().split('.').map(Number) : null)
export const isOlder = (a, b) => {
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
  for (const { name, role = 'worker', idleSince = null } of chats) {
    if (typeof name !== 'string' || seen.has(name) || !Object.hasOwn(said, name)) continue
    seen.add(name)
    const version = said[name]
    const isUnsaid = version === null
    if (isUnsaid ? isOlder(installed, versionOf(FIRST_SAYING)) : versionOf(version) === null || !isOlder(versionOf(version), installed)) continue
    const runs = isUnsaid ? `older than ${FIRST_SAYING}` : version
    found.push({ name, role, runs, cost: costOf(role, isUnsaid, runs), idleSince })
  }
  return found
}

/**
 * The chats of the board's state by their roles, as `oldModChats` takes them: the main chat and the workers (the lanes,
 * not those left behind), the partner, its helper and the supervisor's chat. B570: each with its `state`, whether its
 * process runs, its app session, and since when it is idle (`idleSince`: its turn ended, it is free and runs; else null).
 */
export function chatsByRole(state) {
  const one = (chat, role) => {
    if (typeof chat?.name !== 'string') return []
    const isRunning = chat.isRunning ?? null
    const since = chat.idle?.since
    const idleSince = chat.state === 'free' && isRunning !== false && Number.isFinite(since) ? since : null
    return [{ name: chat.name, role, state: chat.state ?? null, isRunning, session: chat.appSession ?? chat.session ?? null, idleSince }]
  }
  return [
    ...(state?.chats ?? []).filter(chat => chat?.isLeftover !== true).flatMap(chat => one(chat, chat.isMain === true ? 'main' : 'worker')),
    ...one(state?.advisor, 'partner'),
    ...one(state?.advisorHelper, 'helper'),
    ...one(state?.supervisorChat, 'supervisor'),
    // The Product owner (2026-10-31): restarted for a new mod by the main chat, as the partner and the supervisor.
    ...one(state?.productOwner, 'owner'),
  ]
}

/** "A", "A and B", "A, B and C". */
const listed = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/**
 * B570: the chats on an older mod that the board did not get restarted: idle, and the board's first word to restart it
 * for the installed version (`sent`, the outbox: command mod-restart) went longer than OVERDUE_MS ago, and the chat was
 * idle since before that word. A busy chat is restarted after its step, and one the board has not asked for yet waits
 * for its word: no case.
 */
export function overdueChats(mods, chats, now = Date.now(), sent = []) {
  return oldModChats(mods, chats).filter(one => {
    if (!Number.isFinite(one.idleSince)) return false
    const first = sent.find(message => message.command === 'mod-restart' && message.about === one.name && message.version === mods.installed && Number.isFinite(message.at))
    return first !== undefined && now - first.at > OVERDUE_MS && one.idleSince <= first.at
  })
}

/**
 * The card under Needs your attention while chats run an older mod that the board could not get restarted (kind
 * `old-mod`, B570: idle over OVERDUE_MS), or null: it clears by itself once they all run the installed one. Its id is keyed by the installed version (the
 * incident's key), so one install is one card however the chats on it change. `chats` lists each with what it runs and
 * what that costs; `steps` the one way to bring them up to date, done by the person (the board restarts nothing).
 */
export function oldModNeed(mods, chats, now = Date.now(), sent = []) {
  const old = overdueChats(mods, chats, now, sent)
  if (old.length === 0) return null
  const names = old.map(one => one.name)
  return {
    id: `old-mod:${mods.installed}`, from: 'the board', kind: 'old-mod',
    title: `${old.length === 1 ? `${names[0]} runs` : `${old.length} chats run`} an older Workers mod: restart the app to update`,
    text: `${listed(names)} ${old.length === 1 ? 'runs' : 'run'} an older Workers mod than ${mods.installed}, the one installed, and the board could not get ${old.length === 1 ? 'it' : 'them'} restarted while idle. A chat takes a new mod only when it starts anew.`,
    chats: old,
    steps: ['Press Pause all and wait until every chat has stopped', 'Quit the Claude app and start it again', 'Press Resume all'],
    at: now, options: [], pictures: [], run: null, game: null, checks: [], tried: [], version: null, canAnswer: false, task: null, waits: null,
    isMain: false, isAdvisor: false, talk: null,
  }
}

/**
 * The incident's words of the same chats (the rule old-mod): its key by the installed version, each chat named. B570:
 * only the chats idle on an older mod for longer than OVERDUE_MS: the board's restart did not reach them.
 */
export function oldModFinding(mods, chats, now = Date.now(), sent = []) {
  const old = overdueChats(mods, chats, now, sent)
  if (old.length === 0) return null
  const names = old.map(one => one.name)
  return {
    rule: 'old-mod', key: `old-mod ${mods.installed}`, subject: 'board',
    text: `${listed(names)} ${old.length === 1 ? 'runs' : 'run'} an older Workers mod, idle over ${OVERDUE_MS / 60_000} min after the board asked to restart it; ${mods.installed} is installed`,
    evidence: `installed ${mods.installed}; ${old.map(one => `${one.name} ${one.runs} (${one.cost})`).join('; ')}`,
  }
}
