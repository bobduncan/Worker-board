// B421: the one table of the work store's actions: what each is (a read, a change), who may do it (the person on the page, the
// server, a chat by its role) and which of them the Workers mod's work tool offers, with which fields. api.mjs derives its checks
// from it (it used to hold the sets itself), and test/work/actionsTable.test.mjs makes the Workers mod's copies (hooks/board.ts
// WORK_ACTIONS and WORK_FIELDS, the tool's schema in hooks/register.tsx) equal to it. A new action or field is added HERE first.

import { ROUTING_ACTIONS, ROUTING_READS } from './routing/api.mjs'

/** What only reads (B412: its answer is not kept by request), and what changes the store. */
export const READS = new Set(['next', 'list', 'pause-state', 'health', ...ROUTING_READS])
export const CHANGES = new Set(['incident', 'incident-fix', 'incident-told', 'incidents-fixed', 'incidents-rekey', 'incident-gone', 'asks-withdrawn', 'notes-came-down', 'take', 'step', 'ask', 'withdraw', 'answered-in-chat', 'read', 'note', 'report', 'block', 'unblock', 'new', 'queue', 'pin', 'add-to-queue', 'remove-from-queue', 'close', 'drop', 'refine', 'refined', 'answer', 'tick', 'delete', 'refine-answer', 'refine-accept', 'check', 'checked', 'instruction', 'turn-ended', 'pull', 'advance', 'requeue', 'unqueue', 'recheck', 'undo', 'touches', 'rename', 'pause-all', 'resume-all', 'resumed', 'end-resume', 'overturn', 'seen', 'approve-recaps', 'partner-answer', 'escalate', 'partner-answers', 'obsolete-check', 'obsolete', 'obsolete-close', 'recheck-stuck', 'recheck-base', 'retire-queue', 'qa-task', 'qa-end', 'words', 'rethink-hold', 'rethink-free', 'accept-cards', 'popup-asks', 'landed-waits', 'autopilot', 'autopilot-undo', 'recap-answered', 'holds-ended', 'asset'])
/**
 * Focus 2: the partner's drafts of the focus goal's goal definition and how. They change the goal map, not the store: the
 * board's `goalDraft` (src/focus.mjs) writes them; only the chat the list names the partner (role advisor) sends them.
 * Goal definition (2026-10-31): the draft of the goal definition is `definition-draft`; `vibe-draft`, its old name, does
 * the same (the board keeps the old word as the name of the internal command).
 */
export const GOAL_MAP = new Set(['definition-draft', 'vibe-draft', 'how-draft'])
/** B298: what never shows on the backlog view: it is not written anew for these. */
export const OFF_VIEW = new Set(['incident', 'incident-fix', 'incident-told', 'incidents-fixed', 'incidents-rekey', 'incident-gone', 'notes-came-down', 'instruction', 'turn-ended', 'close', 'read', 'pull', 'undo', 'pause-all', 'resume-all', 'resumed', 'end-resume', 'overturn', 'seen', 'approve-recaps', 'partner-answers', 'obsolete-check', 'obsolete', 'recheck-stuck', 'recheck-base'])
/** What only the person does, on the board's page; and what only the server does. */
// The Backlog tab's blocks (2026-10-25): the person's "Add to queue" and "Remove" are the page's alone, never a chat's.
export const PERSON = new Set(['answer', 'read', 'tick', 'delete', 'refine-answer', 'refine-accept', 'recheck', 'undo', 'pause-all', 'resume-all', 'end-resume', 'overturn', 'seen', 'partner-answers', 'obsolete-check', 'obsolete-close', 'autopilot-undo', 'add-to-queue', 'remove-from-queue'])
export const SERVER = new Set(['incidents-fixed', 'incidents-rekey', 'incident-gone', 'asks-withdrawn', 'notes-came-down', 'incident-told', 'check', 'advance', 'resumed', 'approve-recaps', 'recheck-stuck', 'recheck-base', 'route-confirm', 'quality-job-result', 'retire-queue', 'qa-task', 'qa-end', 'accept-cards', 'popup-asks', 'landed-waits', 'autopilot', 'recap-answered', 'holds-ended'])
/** Who may do what the flow does not decide (the default flow's table, spec section 5). */
export const ROLES = {
  // refine-stop-tone: the partner, a hold in words on a step nobody holds yet (and its clear), nothing else (blockOn).
  block: ['main', 'worker', 'advisor', 'person'],
  // B465: the board's sync check unblocks a step whose blocker is in review.
  unblock: ['main', 'worker', 'advisor', 'person', 'server'],
  // Signals change 6 (B915, Addendum 7): the Supervisor files the fix step of an incident it judged a fault (no `what`: the
  // Advisor refines it as any new step).
  new: ['main', 'worker', 'advisor', 'person', 'supervisor'],
  refine: ['advisor', 'main'],
  // B356: the result check, by a helper the partner runs. T9.1.1: a step's by the worker that holds its Quality Assurance task
  // (the gate in `checked`); a goal's re-check is the partner's; the board files its own (the person's answers, `server`).
  checked: ['advisor', 'worker', 'server'],
  'definition-draft': ['advisor'],
  'vibe-draft': ['advisor'],
  'how-draft': ['advisor'],
  // Redesign Part 2 (2026-10-25): the person pins a task to a worker; the board unpins one whose chat is gone.
  pin: ['person', 'server'],
  rename: ['main', 'person', 'server'],
  // B49: a step's Touches line, corrected by the main chat alone.
  touches: ['main'],
  // Partner answers (2026-10-19): the partner answers an ask routed to it, or hands it to the person; so does the board
  // when the partner did not answer in time. Autopilot (2026-10-31): and the main chat, an ask routed to it (Route: main).
  'partner-answer': ['advisor', 'main'],
  escalate: ['advisor', 'main', 'server'],
  // The supervisor (spec 2026-10-24): an incident is filed by the board's watch rules or the supervisor chat's sweep. Signals
  // change 6 (B915, Addendum 7): the Supervisor, not the partner, judges it and names the step that fixes it.
  incident: ['server', 'supervisor'],
  'incident-fix': ['supervisor'],
  // The supervisor's Task 5: the board's health summary, for the supervisor chat's sweep (src/supervisor/health.mjs).
  health: ['supervisor'],
  // B775: the check's verdicts are the partner's alone; the person starts the check and closes what they tick.
  obsolete: ['advisor'],
  // Your words (2026-10-30): the person's note on a step, from its window; the main chat's, for words the person said in its chat.
  // Rule 15: and `side`, any other chat the person talks in (it says where and when they said it).
  words: ['person', 'main', 'side'],
  // Stop and rethink (docs/stop-and-rethink.md): the page's goals command holds a topic's steps as the person; the board frees them when the evaluation ends.
  'rethink-hold': ['person', 'server'],
  'rethink-free': ['person', 'server'],
  // Part C of the asset providers (spec 2026-11-01, part 4): every role asks the board for an asset; nobody makes one itself.
  asset: ['main', 'worker', 'advisor', 'owner', 'supervisor', 'server'],
}
for (const action of ROUTING_ACTIONS) CHANGES.add(action)

/** The actions the Workers mod's work tool offers its chat, in the order its description and schema give them. */
export const TOOL_ACTIONS = [
  'next', 'take', 'step', 'ask', 'withdraw', 'answered-in-chat', 'note', 'report', 'block', 'unblock', 'new', 'close',
  'drop', 'refine', 'refined', 'checked', 'definition-draft', 'vibe-draft', 'how-draft', 'list', 'touches', 'rename',
  'partner-answer', 'escalate', 'health', 'incident', 'incident-fix', 'obsolete', 'words', 'asset',
]

/** The fields a call of the work tool may carry to the board (the tool's schema has one property for each). */
export const TOOL_FIELDS = [
  'action', 'id', 'branch', 'step', 'steps', 'names', 'name', 'minutes', 'stepMinutes', 'of', 'kind', 'blocking', 'text',
  'options', 'pictures', 'play', 'to', 'result', 'merged', 'on', 'title', 'activity', 'goal', 'as', 'why', 'summary',
  'picture', 'size', 'questions', 'what', 'advice', 'lines', 'parts', 'partnerDecides', 'youDecide', 'decided', 'needs',
  'from', 'priority', 'where', 'commit', 'next', 'standard', 'evidence', 'points', 'score', 'effort', 'model', 'subject',
  'rule', 'key', 'fix', 'follows', 'picked',
]

/** Fields of the table that the tool's schema does not offer: the board still reads them (step: `name` names the plan's step when `names` is not given). */
export const UNOFFERED_FIELDS = ['name']

/** What the mod itself adds to a call, never the chat's: the board takes these and no others besides TOOL_FIELDS. */
export const MOD_FIELDS = ['chat', 'session', 'request', 'mod', 'via']

/** The calls the mod makes on its own (never the chat's), each with the fields it carries: nothing else goes through with them. */
export const OWN_FIELDS = {
  'turn-ended': ['since', 'pull', 'forYou', 'word'],
  instruction: ['text'],
  'save-log': ['stepId'],
  'pause-state': [],
  pull: [],
}

/**
 * B421: the fields of a call over the bridge that the table does not know: for an action of the tool, the fields of the table; for a
 * call of the mod's own, its fields (OWN_FIELDS); for any other action none (a chat's call outside the tool's actions carries nothing
 * but the mod's own fields, so a forged turn-ended's text never reaches its handler). A field the table lacks comes from a mod of
 * another version (a chat keeps its mod until its process restarts): the board leaves it out and says so once. PURE.
 */
export function unknownFields(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return []
  const own = Object.hasOwn(OWN_FIELDS, body.action) ? OWN_FIELDS[body.action] : []
  const allowed = TOOL_ACTIONS.includes(body.action) ? TOOL_FIELDS : ['action', ...own]
  return Object.keys(body).filter(key => !allowed.includes(key) && !MOD_FIELDS.includes(key))
}
