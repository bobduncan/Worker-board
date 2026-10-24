// B468: every step gets an effort level at its refine, and the worker that takes it runs at that level. The person,
// 2026-10-21 (I52): "in order to save tokens, i need a task, before it's picked up to evaluate what effort level it
// needs. the worker will adjust to this new effort level". The partner gives the level with a one-line reason at the
// refine (roles/partner.md); a step without one counts as medium. A chat cannot set its own effort (the app refuses
// that), so the board asks the main chat, which sets the worker's chat with the app's set_session_effort
// (roles/main.md), as for the partner's high effort mode (src/partnerEffort.mjs). The app keeps each chat's effort in
// its own file of the chat, so the board sees when it is set. The app applies a new effort from the chat's next turn
// on, so the step's line to the worker waits until it is set, a few minutes at most.
//
// Model per step (the token-saving plan, step 2; the person, 2026-10-23: "workers Sonnet by default, Opus only for
// steps the Advisor marks hard (architecture, the board's core, unclear bugs)"). A step names its model family at the
// refine too, `Model: sonnet|opus` with a one-line reason; a step without one counts as sonnet. The app's model ids come
// from the settings (`models`), never from the code: for a family without an id the board sets the effort only, as
// B468 did. The main chat sets both in one word ("set model and effort") with set_session_model and
// set_session_effort, and the step's line waits until both are read back: from the app's file of the chat, or the
// model from the chat's answer after the word (its transcript names the model of each answer, as for the partner,
// B352). Between steps a worker runs at its usual setting from the settings (`usualModel`, `usualEffort`: Sonnet,
// medium), never at what it ran at before.

import { blockersOpen } from './guards.mjs'
import { fixFirst, valueOf } from './item.mjs'

/** The levels, lowest first, as the app names them. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** A step refined without an effort counts as this one. */
export const DEFAULT_EFFORT = 'medium'
/** A worker's usual level between steps when the settings name none (`usualEffort`). */
export const USUAL_EFFORT = 'medium'
/** The model families a step may name, cheapest first; the app's id of each comes from the settings (`models`). */
export const MODELS = ['sonnet', 'opus']
/** A step refined without a model counts as this one. */
export const DEFAULT_MODEL = 'sonnet'
/** A worker's usual model family between steps when the settings name none (`usualModel`). */
export const USUAL_MODEL = 'sonnet'
/** How long a step's line to its worker waits for the worker's model and effort to be set. */
export const HOLD_MS = 3 * 60_000
/** A word to the main chat for the same setting of the same chat goes once in this time, also when it went untaken. */
export const AGAIN_MS = 30 * 60_000
/** The words the page says a level with. */
export const EFFORT_WORDS = { low: 'low', medium: 'medium', high: 'high', xhigh: 'extra high', max: 'max' }
/** The words the page says a model family with. */
export const MODEL_WORDS = { sonnet: 'Sonnet', opus: 'Opus' }

const REASON_MAX = 200
const LEVEL = /^\s*(low|medium|high|xhigh|x-high|extra[\s-]high|max)(?![\w-])/i
const FAMILY = /^\s*(sonnet|opus)(?![\w-])/i
const HOLDS = ['taken', 'in progress', 'waiting on you']
const LOST = ['expired', 'failed', 'dropped']

const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const levelOf = word => (/^(?:x-?high|extra[\s-]high)$/i.test(word) ? 'xhigh' : word.toLowerCase())
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
/** The reason after a level or family: "medium: why", "medium · why", "medium (why)". */
const reasonOf = (words, from) => words.slice(from).replace(/^[\s:·,;—–-]+/, '').replace(/^\((.*)\)\.?$/, '$1').trim()

/** Whether two of the app's model ids are the same model ("claude-x" and "claude-x[1m]" are). */
export const sameModel = (a, b) => typeof a === 'string' && typeof b === 'string' && a !== ''
  && a.replace(/\[[^\]]*\]$/, '').toLowerCase() === b.replace(/\[[^\]]*\]$/, '').toLowerCase()

/**
 * The effort given at a refine, "medium: a board fix in one hook, with tests" (also "medium · ...", "medium (...)"):
 * `{ ok: true, level, why, line }`, `line` as the store keeps it ("medium · a board fix ..."); a refusal `{ ok: false,
 * why }` without a level of the app's or without a reason; null when none was given.
 */
export function parseEffort(given) {
  if (given === undefined || given === null) return null
  const words = String(given).replace(/\s+/g, ' ').trim()
  if (words === '') return null
  const found = words.match(LEVEL)
  if (found === null) return { ok: false, why: `An effort starts with its level, ${EFFORTS.join(', ')}, then its reason in one line ("medium: a board fix in one hook, with tests").` }
  const level = levelOf(found[1])
  const why = reasonOf(words, found[0].length)
  if (why === '') return { ok: false, why: `Give the effort's reason after its level, in one line ("${level}: a board fix in one hook, with tests").` }
  if (why.length > REASON_MAX) return { ok: false, why: `Keep the effort's reason to one short line: at most ${REASON_MAX} characters, this one has ${why.length}.` }
  return { ok: true, level, why, line: `${level} · ${why}` }
}

/**
 * Model per step: the model given at a refine, "opus: a guard of the work store" (also "opus · ...", "opus (...)"):
 * `{ ok: true, family, why, line }`, `line` as the store keeps it ("opus · a guard ..."); a refusal `{ ok: false, why }`
 * without a family (sonnet or opus) or without a reason; null when none was given.
 */
export function parseModel(given) {
  if (given === undefined || given === null) return null
  const words = String(given).replace(/\s+/g, ' ').trim()
  if (words === '') return null
  const found = words.match(FAMILY)
  if (found === null) return { ok: false, why: `A model starts with its family, ${MODELS.join(' or ')}, then its reason in one line ("sonnet: a board fix in one hook, with tests").` }
  const family = found[1].toLowerCase()
  const why = reasonOf(words, found[0].length)
  if (why === '') return { ok: false, why: `Give the model's reason after its family, in one line ("${family}: a board fix in one hook, with tests").` }
  if (why.length > REASON_MAX) return { ok: false, why: `Keep the model's reason to one short line: at most ${REASON_MAX} characters, this one has ${why.length}.` }
  return { ok: true, family, why, line: `${family} · ${why}` }
}

/** A step's line of `name`: its own section's, else its refine block's "<name>: ..." line, or null. */
function lineOf(item, name) {
  const own = (item?.sections?.get(name) ?? []).map(one => one.trim()).find(Boolean)
  if (own !== undefined) return own
  const head = new RegExp(`^${name}:\\s*`)
  const inBlock = (item?.sections?.get('Refined') ?? []).map(one => one.trim()).find(one => head.test(one) && one.replace(head, '') !== '')
  return inBlock === undefined ? null : inBlock.replace(head, '')
}

/**
 * B544, the fix of X9: what a chat's card says of the effort its chat runs at, as the app's file of the chat says it:
 * `appEffort` where the card has that field (the partner's, whose `effort` is its high effort mode, B352), else
 * `effort`; an object is read for its `level`, as effortOf gives one (an object without one is said as it is). Null
 * when the card says nothing.
 */
export function effortSaid(chat) {
  if (chat === null || typeof chat !== 'object') return null
  const said = Object.hasOwn(chat, 'appEffort') ? chat.appEffort : chat.effort
  return said !== null && typeof said === 'object' && typeof said.level === 'string' ? said.level : said ?? null
}

/** B544: the level a chat runs at (one of EFFORTS), or null when its card says none or one the board does not know. */
export function chatEffort(chat) {
  const said = effortSaid(chat)
  return typeof said === 'string' && EFFORTS.includes(said) ? said : null
}

/**
 * A step's effort: `{ level, why, isSet }`, from its Effort section, else its refine block's Effort line; a step without
 * one (or with one the board cannot read) counts as medium, `isSet` false.
 */
export function effortOf(item) {
  const read = parseEffort(lineOf(item, 'Effort'))
  return read?.ok === true ? { level: read.level, why: read.why, isSet: true } : { level: DEFAULT_EFFORT, why: null, isSet: false }
}

/**
 * Model per step: a step's model family, `{ family, why, isSet }`, from its Model section, else its refine block's Model
 * line; a step without one (or with one the board cannot read) counts as sonnet, `isSet` false.
 */
export function modelOf(item) {
  const read = parseModel(lineOf(item, 'Model'))
  return read?.ok === true ? { family: read.family, why: read.why, isSet: true } : { family: DEFAULT_MODEL, why: null, isSet: false }
}

/**
 * The call with `key` taken out of a line of `what` or of `questions` (a list, or lines in one text) that `pattern`
 * matches, for a chat whose work tool has no such field yet; the call as it is when it has the field or no such line.
 */
function withLine(body, key, pattern) {
  if (body[key] !== undefined) return body
  for (const list of ['what', 'questions']) {
    const all = Array.isArray(body[list]) ? body[list] : typeof body[list] === 'string' ? body[list].split('\n') : null
    if (all === null) continue
    const at = all.findIndex(one => pattern.test(String(one ?? '').trim()))
    if (at < 0) continue
    return { ...body, [key]: String(all[at]).trim().replace(/^(?:[-*]\s+)?[A-Za-z]+:\s*/, ''), [list]: all.filter((one, index) => index !== at) }
  }
  return body
}

/**
 * The effort out of a call: its `effort`, else (a chat whose work tool has no field effort yet) a line of `what` or of
 * `questions` (a list, or lines in one text) that starts with "Effort:", taken out of that list. The call as it is when
 * it gives none.
 */
export const withEffort = body => withLine(body, 'effort', /^(?:[-*]\s+)?Effort:\s*\S/i)

/**
 * Model per step: the model out of a call, as `withEffort`: its `model`, else a line of `what` or of `questions` that
 * starts with "Model:" and a family ("Model: opus: a guard"), taken out of that list. A line "Model: ..." that names no
 * family is what we build, and stays.
 */
export const withModel = body => withLine(body, 'model', /^(?:[-*]\s+)?Model:\s*(?:sonnet|opus)(?![\w-])/i)

/** The newest word that set `chat`'s model and effort, or undefined. */
export const lastWord = (sent, chat, prefix = '') => sent.findLast(message => message.command === 'worker-effort' && plain(message.about, prefix) === plain(chat, prefix))

/** Whether a word asked for `level` and the model id `model` (null: no model, the effort alone). */
export const sameTarget = (word, level, model) => word.effort === level && (word.model ?? null) === (model ?? null)

/** Model per step: a model id the settings may name, plainly: "claude-..." ("claude-opus-5-5", "claude-opus-5-5[1m]"). */
export const MODEL_ID = /^claude-[\w.:-]{1,73}(?:\[[\w.-]{1,20}\])?$/

/**
 * Model per step: the settings' `models` as the board uses them: both families with an id of the app's ("claude-..."),
 * `{ sonnet, opus }`, or `{}` (the board sets the effort alone, as B468 did) with `problem`, one line that says why,
 * when the settings name them otherwise. None given is no problem.
 */
export function modelIds(given) {
  if (given === undefined || given === null) return { models: {}, problem: null }
  const isObject = typeof given === 'object' && !Array.isArray(given)
  const ids = isObject ? MODELS.map(family => (typeof given[family] === 'string' ? given[family].trim() : '')) : []
  // 2026-10-24: no chat runs Fable without the person's yes ("maximum run opus"): the settings never name it.
  if (ids.some(id => /fable/i.test(id))) return { models: {}, problem: 'the settings\' "models" never name a Fable model (the person, 2026-10-24: "maximum run opus"): the board sets the workers\' effort only until they name Sonnet and Opus' }
  if (isObject && ids.every(id => MODEL_ID.test(id)) && Object.keys(given).every(key => MODELS.includes(key))) return { models: Object.fromEntries(MODELS.map((family, at) => [family, ids[at]])), problem: null }
  return { models: {}, problem: `the settings' "models" must name both ${MODELS.map(one => `"${one}"`).join(' and ')}, each with the app's model id ("claude-..."): the board sets the workers' effort only until it does` }
}

/**
 * Model per step: the settings' part for the workers' model and effort (config.json `models`, `usualModel`,
 * `usualEffort`): `{ models, usual: { model, effort } }`, `models` both families' ids or none (`modelIds`), the usual
 * setting Sonnet and medium unless the settings say another.
 */
export function runSettings(config = {}) {
  const { models } = modelIds(config.models)
  const model = MODELS.includes(config.usualModel) ? config.usualModel : USUAL_MODEL
  const effort = EFFORTS.includes(config.usualEffort) ? config.usualEffort : USUAL_EFFORT
  return { models, usual: { model, effort } }
}

/**
 * The word that asks the main chat (`to`) to set `chat` (its app session `session` when the board knows it) to the
 * model id `model` and the effort `level`, for `step` (null: back to its usual setting, `usual` and `usualModel`), and
 * `why`. Without a model id (the settings name none for the family) it is B468's word, the effort alone. One message
 * of the outbox.
 */
export function effortWords({ to, chat, session, level, model = null, usual, usualModel = null, step, why }) {
  const id = typeof session === 'string' && /^[\w-]{1,80}$/.test(session) ? [`Session: ${session}`] : []
  const forStep = step === null ? [] : [`Step: ${step}`]
  const text = model === null
    ? ['set effort', `Chat: ${chat}`, `Effort: ${level}`, ...id, ...forStep, `Why: ${why}`]
    : ['set model and effort', `Chat: ${chat}`, ...id, ...forStep, `Model: ${model}`, `Effort: ${level}`, `Why: ${why}`]
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'worker-effort', about: chat, effort: level, model, usual, usualModel, forStep: step,
    text: text.join('\n'),
  }
}

const clockOf = ms => { const at = new Date(ms); return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` }

/**
 * What each worker should run at, and the words to the main chat that set it. `items` the store's items, `lanes` the
 * board's chats (`name`, `isMain`, `isLeftover`, `appSession`, `effort` and `model`: what the app's file of the chat
 * says, or null, and `lastAnswer`: the model of its last answer and when, `{ model, at }`, or null), `deliveries` the
 * reconciler's lines to free workers, `sent` the outbox, `main` the main chat's name (null: none on the board, so no
 * word), `skip` the names that are no workers (the partner and its helper), `models` the app's id of each model family
 * and `usual` the usual setting between steps (`runSettings`).
 *
 * A worker runs at the model and effort of the step it holds, else of the step it gets next (so a report followed by
 * the next step asks once), else at its usual setting once a word of the board changed it. The usual setting is the
 * settings' (Sonnet, medium), never what the chat ran at before. A word goes when the chat does not run at its setting
 * and the newest word for the chat is not one for that setting of the last half hour.
 *
 * What the chat runs on is read from the app's file of the chat, which the app writes on every change of the model
 * (its `commitSessionModel` saves the session); the chat's last answer counts only where the file names no model, and
 * only when it came after the newest word that set another model. A word for another setting still on its way (the
 * newest word that is not lost, of the last half hour, whose setting the file does not show yet) will change the chat
 * after any reading now: while it is, the step is not set.
 *
 * The line of its next step to a worker waits (`held`, also its own pull; `holds` says why). An opus step waits until
 * the chat runs on Opus, however long: no release after a few minutes, nor for a lost word, a missing main chat or a
 * file that names no effort; its word goes only once a word for another model on its way has been applied (so the
 * reading that releases it comes after both), and again each half hour. Any other step waits as B468 does: while its
 * setting is not read back and its word went less than HOLD_MS ago (it costs tokens at worst). A chat whose effort the
 * app's file does not say gets no word for such a step: the board could not see it set. A family without a model id
 * is not set: the word sets the effort alone.
 *
 * `{ words: [{ to, chat, session, level, model, usual, usualModel, step, why }], held: Set<step id>, holds: Map<step
 * id, why>, runs: Map<chat, run> }`, `run` for the page: `{ level, model, usual, usualModel, step, why, modelWhy,
 * isSet, asked: { at, state } | null, waitsFor: { model, since, text } | null }` (`model` and `usualModel` families,
 * null when the settings name no model ids).
 */
export function effortPlan({ items, lanes = [], deliveries = [], sent = [], now, main = null, prefix = '', skip = [], models = {}, usual = {} }) {
  const words = []
  const held = new Set()
  const holds = new Map()
  const runs = new Map()
  const settings = runSettings({ models, usualModel: usual.model, usualEffort: usual.effort })
  const hasModels = Object.keys(settings.models).length > 0
  const idOf = family => settings.models[family] ?? null
  const usualEffort = settings.usual.effort
  const usualFamily = settings.usual.model
  const usualId = idOf(usualFamily)
  const steps = [...(items?.values() ?? [])].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step')
  const owned = (item, name) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
  const others = new Set(skip.filter(Boolean).map(name => plain(name, prefix)))
  for (const lane of lanes) {
    if (lane.isMain || lane.isLeftover || others.has(plain(lane.name, prefix))) continue
    const holding = steps.find(item => owned(item, lane.name) && HOLDS.includes(valueOf(item, 'State')))
    const delivery = deliveries.find(one => one.chat === lane.name)
    // The step it gets next, in the order its own pull takes them (fix first, then by id).
    const next = holding ?? (delivery === undefined ? undefined : items.get(delivery.id))
      ?? steps.filter(item => owned(item, lane.name) && valueOf(item, 'State') === 'queued' && blockersOpen(item, { store: { items } }).length === 0)
        .sort((a, b) => fixFirst(a, b) || byId(valueOf(a, 'Id'), valueOf(b, 'Id')))[0]
    const mine = sent.filter(message => message.command === 'worker-effort' && plain(message.about, prefix) === plain(lane.name, prefix))
    const last = mine.at(-1)
    const live = mine.filter(message => !LOST.includes(message.state))
    const current = typeof lane.effort === 'string' && EFFORTS.includes(lane.effort) ? lane.effort : null
    // The newest word on its way that the app's file does not show yet: it changes the chat after any reading now.
    const lastLive = live.at(-1)
    const shows = word => word.effort === current && ((word.model ?? null) === null || sameModel(lane.model, word.model))
    const onItsWay = lastLive !== undefined && now - lastLive.at < AGAIN_MS && !shows(lastLive) ? lastLive : null
    // The model it runs on: the app's file of the chat says it; only where the file names none, its last answer, when
    // that came after the newest word (not lost) that set another model.
    const runsOn = want => {
      if (want === null) return true
      if (typeof lane.model === 'string' && lane.model !== '') return sameModel(lane.model, want)
      const since = live.findLast(word => (word.model ?? null) !== null && !sameModel(word.model, want))?.at ?? -Infinity
      return sameModel(lane.lastAnswer?.model, want) && Number.isFinite(lane.lastAnswer?.at) && lane.lastAnswer.at > since
    }
    const step = next === undefined ? null : valueOf(next, 'Id')
    const effort = next === undefined ? null : effortOf(next)
    const model = next === undefined ? null : modelOf(next)
    const level = effort?.level ?? usualEffort
    const family = model?.family ?? usualFamily
    const id = idOf(family)
    // A word on its way for this very setting is no word against it.
    const against = onItsWay !== null && !sameTarget(onItsWay, level, id) ? onItsWay : null
    // Back to the usual setting only after a word of the board changed it, and only when it does not run at it: a
    // setting the person chose by hand after a word back arrived is left alone (a word back that was lost goes again).
    // A word of before the settings' usual one (another level, or no model) was no word back.
    if (effort === null) {
      const isUsual = against === null && current === usualEffort && runsOn(usualId)
      const wasBack = last !== undefined && sameTarget(last, usualEffort, usualId)
      if (last === undefined || current === null || isUsual || (wasBack && !LOST.includes(last.state))) continue
    }
    const asked = last !== undefined && sameTarget(last, level, id) && now - last.at < AGAIN_MS ? last : null
    const isModelSet = against === null && runsOn(id)
    const isSet = isModelSet && current === level
    // Model per step: an opus step is not given to a chat that does not run on Opus, however long that takes.
    const isStrict = step !== null && hasModels && family === 'opus'
    const who = holding === undefined ? `${lane.name}'s next step` : `${lane.name}'s step`
    const why = step === null ? `${lane.name} holds no step now: back to its usual ${id === null ? 'level' : 'setting'}`
      : id === null ? `${step} is ${who}; ${effort.isSet ? `its refine says ${level} (${effort.why})` : `its refine gives no effort, so ${level}`}`
        : `${step} is ${who}; model ${family} (${model.isSet ? model.why : 'its refine gives none'}), effort ${level} (${effort.isSet ? effort.why : 'its refine gives none'})`
    // An opus step's word waits while a word for another model is on its way, so the reading that sets it free comes
    // after both (the main chat sets them in their order).
    const isAgainstModel = against !== null && (against.model ?? null) !== null && !sameModel(against.model, id)
    const canAsk = main !== null && !isSet && asked === null && (isStrict ? !isAgainstModel : current !== null)
    // Only the step whose line waits: one it holds already is set as soon as can be, its line gone.
    let waitsFor = null
    if (isStrict && !isModelSet && holding === undefined) {
      const since = mine.find(word => word.forStep === step && sameTarget(word, level, id))?.at ?? null
      const reason = main === null ? 'there is no main chat (or no Workers mod) to set it'
        : isAgainstModel ? `the word to set it to ${MODEL_WORDS[MODELS.find(one => sameModel(idOf(one), against.model))] ?? against.model} first is not applied yet`
          : since === null ? 'the main chat is asked to set it'
            : 'the main chat was asked, and the app does not say Opus yet'
      waitsFor = { model: 'opus', since, text: `${step} waits for Opus${since === null ? '' : ` since ${clockOf(since)}`}: ${reason}; it goes once ${lane.name} runs on Opus.` }
    }
    runs.set(lane.name, {
      level, model: hasModels ? family : null, usual: usualEffort, usualModel: hasModels ? usualFamily : null, step, why: effort?.why ?? null, modelWhy: model?.why ?? null, isSet,
      asked: asked === null ? null : { at: asked.at, state: asked.state }, waitsFor,
    })
    if (canAsk) words.push({ to: main, chat: lane.name, session: lane.appSession ?? null, level, model: id, usual: usualEffort, usualModel: usualId, step, why })
    if (holding !== undefined || step === null || isSet) continue
    if (waitsFor !== null) {
      held.add(step)
      holds.set(step, waitsFor.text)
      continue
    }
    if (main === null || current === null) continue
    // B468: a word that went less than HOLD_MS ago and is not lost holds the line; none sent yet holds it until it goes.
    const willGo = canAsk || asked === null
    if (willGo || (now - asked.at < HOLD_MS && !LOST.includes(asked.state))) {
      held.add(step)
      holds.set(step, `${step} waits until ${lane.name} runs at ${hasModels ? `${MODEL_WORDS[family]} · ` : ''}${level} (${HOLD_MS / 60_000} minutes at most after the word to the main chat).`)
    }
  }
  return { words, held, holds, runs }
}
