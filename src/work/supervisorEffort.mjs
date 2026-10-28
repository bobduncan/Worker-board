// T7.5 (the person, 2026-10-28: "do B": the Supervisor's own model and effort set by code, and "A": Sonnet, low, what it
// runs on now: it was set once by hand and nothing kept it there). The Supervisor is the chat that sweeps (the list's
// "supervisor"); it is no worker, so the plan of a worker's model and effort (src/work/effort.mjs `effortPlan`) skips it.
// Its setting is the board's own, `supervisorModel` and `supervisorEffort` in the settings (Sonnet and low unless set),
// and the board holds the chat at it the way it holds a worker at its step's: one `worker-effort` word, which a running
// chat's Workers mod sets by code first (src/hands.mjs, B755) and the main chat only when none did. A chat cannot set
// its own model or effort (the app refuses that), so a word about the caller goes back by itself (handJobs). The chat
// never sets its own setting and never asks for one: roles/supervisor.md. Pure: it reads what it is given.

import { AGAIN_MS, EFFORTS, EFFORT_WORDS, MODELS, MODEL_WORDS, familyOf, lastWord, sameTarget } from './effort.mjs'

/** The Supervisor's model family when the settings name none (`supervisorModel`). */
export const SUPERVISOR_MODEL = 'sonnet'
/** The Supervisor's effort when the settings name none (`supervisorEffort`). */
export const SUPERVISOR_EFFORT = 'low'

/**
 * The Supervisor's setting out of the settings (config.json): `{ model, effort }`, `model` a family of `MODELS` (never
 * Fable: it is not one of them) and `effort` a level of the app's; anything else is the default, Sonnet and low.
 */
export function supervisorSetting(config = {}) {
  return {
    model: MODELS.includes(config?.supervisorModel) ? config.supervisorModel : SUPERVISOR_MODEL,
    effort: EFFORTS.includes(config?.supervisorEffort) ? config.supervisorEffort : SUPERVISOR_EFFORT,
  }
}

/** The app's model id of the setting's family, from the settings' `models`; null when they name none (the effort alone). Never Fable. */
const idOf = (setting, models) => {
  const id = MODELS.includes(setting?.model) && models !== null && typeof models === 'object' ? models[setting.model] : null
  return typeof id === 'string' && id !== '' && !/fable/i.test(id) ? id : null
}

/** Whether the chat's file (`lane.model`, `lane.effort`) shows the setting; the model only where `compareModel` (an id exists for it). */
const runsAt = (lane, setting, compareModel) => lane.effort === setting.effort && (!compareModel || familyOf(lane.model) === setting.model)

/**
 * The word that asks the main chat (`main`) to set the Supervisor's chat (`lane`: its card, `name`, `appSession`, and
 * `model` and `effort` as the app's file of the chat says them, or null) to the `setting` (`supervisorSetting`), or null
 * when none is due. `models` are the app's ids of the families (`runSettings(config).models`), `sent` the outbox, `now`,
 * `prefix` the chats' titles' start. One entry shaped as `effortPlan`'s words, the input of `effortWords`, so the
 * delivery sends it with the same half-hour dedupe.
 *
 * A word only when the chat is there and a main chat is (as for a worker: no main chat, no word); the app's file names
 * its effort (else the board could not see it set); the chat does not run at the setting (another effort, or, where the
 * settings name a model id, another family: a file that names no model counts as not set); and the newest word for the
 * chat is not one for the same target of the last half hour (`AGAIN_MS`), also when it went untaken. A word for a new
 * target goes at once.
 */
export function supervisorEffortWord({ lane, setting, models = {}, sent = [], now, main = null, prefix = '' }) {
  if (lane === null || lane === undefined || main === null || main === undefined) return null
  if (typeof lane.effort !== 'string' || lane.effort === '') return null
  const id = idOf(setting, models)
  if (runsAt(lane, setting, id !== null)) return null
  const last = lastWord(sent, lane.name, prefix)
  if (last !== undefined && sameTarget(last, setting.effort, id) && now - last.at < AGAIN_MS) return null
  return {
    to: main, chat: lane.name, session: lane.appSession ?? null, level: setting.effort, model: id, usual: setting.effort, usualModel: id, step: null,
    why: `the Supervisor's setting on the board: ${MODEL_WORDS[setting.model]}, ${EFFORT_WORDS[setting.effort]}`,
  }
}

/**
 * The Supervisor's setting as the page and the health summary say it: `{ model, effort, isSet }`, the setting's family
 * and level, and whether the chat's file shows them. Where `models` is given and names no id for the family, the board
 * sets the effort alone, so `isSet` reads the effort alone too; without `models` the model counts.
 */
export function supervisorRun({ lane, setting, models }) {
  const compareModel = models === undefined ? true : idOf(setting, models) !== null
  return { model: setting.model, effort: setting.effort, isSet: lane !== null && lane !== undefined && runsAt(lane, setting, compareModel) }
}
