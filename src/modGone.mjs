// F9, chat 1's fix item 7 (2026-11-13, .claude/plans/2026-11-13-workers-mod-unload-cause.md): the CLI inside a chat can unload the
// Workers mod mid-session (its hooks watchdog blames the mod under load). The chat's process lives on, but it sends no more reports,
// answers no wake and files no ask; only a restart of the chat (archive + unarchive) loads the mod again. Its transcript says so:
// an attachment `deferred_tools_delta` retracting the mod's tools (`mcp__workers__*`, cause `not_configured`), then an attachment
// `mcp_instructions_delta` with `removedNames: ["workers"]`. A later delta that adds or restores the tools is a restore. PURE.

/** A tool of the Workers mod, also by its old name. */
const MOD_TOOL = /^mcp__(?:workers|folder-branches)__/
/** The mod's server name in the app's instructions delta, also by its old name. */
const MOD_NAMES = ['workers', 'folder-branches']
/** No report for this long, after the unload, before the board says the link is gone (the chat may still be mid-call). */
export const MOD_GONE_AFTER_MS = 2 * 60_000

/**
 * The time the Workers mod was unloaded from a chat and not loaded again since, from its transcript's lines (`lines`: the lines of
 * the two delta kinds, in the file's order, as `readDeep` keeps them; other lines are skipped), or null. Both deltas must be there:
 * the tools retracted with cause not_configured, then the server's instructions removed.
 */
export function modUnloadedAt(lines) {
  let retracted = null
  let gone = null
  for (const line of String(lines ?? '').split('\n')) {
    if (!line.includes('"attachment"')) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const delta = entry?.type === 'attachment' ? entry.attachment : null
    const at = Date.parse(entry?.timestamp ?? '')
    if (delta?.type === 'deferred_tools_delta') {
      const back = [...(delta.restoredNames ?? []), ...(delta.addedNames ?? []), ...(delta.readdedNames ?? [])].some(name => MOD_TOOL.test(String(name)))
      if (back) { retracted = null; gone = null }
      if ((delta.retractedTools ?? []).some(one => MOD_TOOL.test(String(one?.name)) && one?.cause === 'not_configured')) retracted = Number.isFinite(at) ? at : null
    } else if (delta?.type === 'mcp_instructions_delta') {
      if ((delta.addedNames ?? []).some(name => MOD_NAMES.includes(name))) { retracted = null; gone = null }
      if ((delta.removedNames ?? []).some(name => MOD_NAMES.includes(name)) && retracted !== null) gone = retracted
    }
  }
  return gone
}

/**
 * Whether the board's link to a chat is gone (`{ at }`, the unload's time), or null: its mod was unloaded (`unloadedAt`), its last
 * report is no newer than the unload and over MOD_GONE_AFTER_MS old (or it never reported), its session did not end (an ended
 * report is a closed chat), and the app has not started again since the unload (a new app run starts every chat's mod anew).
 */
export function modGoneOf({ unloadedAt, report = null, appStartedAt = null, now }) {
  if (!Number.isFinite(unloadedAt)) return null
  if (Number.isFinite(appStartedAt) && appStartedAt > unloadedAt) return null
  if (report?.state === 'ended') return null
  // A report kept from before the board's start reads as heard at that start (state.mjs); its own time is `heardAt`.
  const reportAt = Number.isFinite(report?.heardAt) ? report.heardAt : Number.isFinite(report?.at) ? report.at : null
  if (reportAt !== null && reportAt > unloadedAt) return null
  if (now - (reportAt ?? unloadedAt) <= MOD_GONE_AFTER_MS || now - unloadedAt <= MOD_GONE_AFTER_MS) return null
  return { at: unloadedAt }
}

/** The way out, beside its Link gone pill (the pill names the cause; its "No ask filed" card says it in a sentence of its own). */
export const MOD_GONE_WHY = 'restart this chat: archive it, then unarchive it'
