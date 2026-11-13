// B813 (the fix of X2, back after B532): a word the chat took and could not type failed for a reason that passes by
// itself, or for one that never does. The outbox of 2026-10-24 to 2026-10-31, by why: passes by itself: the auto mode
// classifier gave no verdict (8), a hook dropped it because the prompt left the queue (2), a scheduled run is already
// running (1), a chat still working is not archived (1), the app has not reported its model list yet (1, X2's word of
// 23:13); never passes: a scheduled task that is not found (6), a tool that needs a person's approval (2). (A stopped
// chat's word, 3, is the outbox's own case: stopped.mjs.) A word that failed for a reason that passes is tried again
// (store.mjs retryFailed, and for a worker's effort its plan, effort.mjs), one that never does is named at once.

/** The reasons that never pass by themselves: trying again gives the same answer. */
const NEVER_PASSES = /\bnot found\b|needs a person's approval|\bnot allowed\b|\bpermission denied\b/i

/** Whether a failure's why passes by itself; a failure without a why (an older mod) is given the benefit of the doubt. */
export const passesBySelf = why => !NEVER_PASSES.test(String(why ?? ''))

/** How many tries in all a word that failed for a passing reason gets, and how long after its failure the next goes. */
export const TRIES = 3
export const AGAIN_AFTER_MS = 60_000
