// Focus 2 (spec 2026-10-18, sections 3, 5 and 6): the vibe and how moves on the Focus page, and the partner's drafts.
// Every move goes through POST /api/goals: the person's moves (`FOCUS_MOVES`) from the page, the partner's drafts
// (`FOCUS_DRAFTS`) from the page or with the board's key. Each writes goals.md by id (read anew right before, as every
// change of the map) and answers the words the board then types to the partner, marked as the person's: null when the
// move changed nothing (a second click), so a word goes once (Review Focus 3). The moves run one at a time.
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { editThread, parseThread } from './brainstorm.mjs'
import { focusStage, nextGoalId, parseGoals } from './goals.mjs'
import { addGoal, agreeHow, agreeVibe, changeGoalsFile, raiseLastLine, setFocus, setHow, setVibe } from './goalsWrite.mjs'
import { focusWords } from './say.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, access, readdir }

/** The person's moves: pick a focus, agree the vibe or not yet, go with the how or not yet. */
export const FOCUS_MOVES = ['focus', 'vibe-agree', 'vibe-not-yet', 'how-go', 'how-not-yet']
/** The partner's drafts beside the talk: the vibe's lines and picture, the how's parts. */
export const FOCUS_DRAFTS = ['vibe-draft', 'how-draft']

const refuse = (status, why) => ({ ok: false, status, why })
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const isId = value => typeof value === 'string' && /^G\d+$/.test(value)
const isLines = value => Array.isArray(value) && value.every(one => typeof one === 'string')
const pad = value => String(value).padStart(2, '0')
const minuteOf = ms => {
  const at = new Date(ms)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
const STAGE_WORDS = { vibe: 'the vibe', how: 'the how', run: 'the run', done: 'done' }

const WHY = {
  gone: [404, 'That goal is no longer in the map.'],
  twice: [409, 'Two goals have that id: change the file by hand.'],
  form: [400, 'Not a change the board knows.'],
  encoding: [409, 'The map is not UTF-8 text: change it by hand first.'],
  tabs: [409, 'The map has lines indented with tabs: make them two spaces per level by hand first.'],
  write: [500, 'The goal map could not be written.'],
}
const failed = why => refuse(...(WHY[why] ?? WHY.write))

/** The goal map as it is now, UTF-8, or null when it is not there. */
const readMap = (fs, file) => fs.readFile(file).then(bytes => bytes.toString('utf8'), () => null)

/** The running (or wrapping up) thread about a goal in the brainstorms' folder, by its path as the setting names it. */
async function runningThread(goal, { brainstormDir, brainstormFolder, fs }) {
  const base = String(brainstormDir).replace(/[\\/]+$/, '')
  const names = (await fs.readdir(base).catch(() => [])).filter(name => /^[a-z0-9][a-z0-9-]*\.md$/.test(name)).sort().reverse()
  for (const name of names) {
    const thread = parseThread(await fs.readFile(`${base}/${name}`).then(bytes => bytes.toString('utf8'), () => ''))
    if (thread.goal?.id === goal && (thread.state === 'running' || thread.state === 'wrapping up')) return `${brainstormFolder}/${name}`
  }
  return null
}

/** The talk about the goal: its running thread, else the one its Brainstorm line names, else none. */
async function talkOf(node, ctx) {
  return (await runningThread(node.id, ctx)) ?? node.brainstorm?.path ?? 'none'
}

/**
 * One move or draft (`body.command`, `body.id` the goal, `body.text` the person's words or a new goal's line, the
 * drafts' `lines`, `picture`, `parts`, `partnerDecides`, `youDecide`). `ctx`: `canWrite` (the board writes the map),
 * the files (`goalsFile`, `historyDir`, `brainstormDir`, `brainstormFolder`), `now`, `partner` (the state's advisor:
 * the partner's chat, or null), `job` (the partner's job file, named in the focus word), `fs`. Answers
 * `{ ok: true, result, words }`, the words the board types to the partner or null, or `{ ok: false, status, why }`.
 */
let turn = Promise.resolve()
export function focusMove(body, ctx) {
  const run = turn.then(() => move(body, { fs: files, ...ctx }))
  turn = run.catch(() => {})
  return run
}

async function move(body, ctx) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return failed('form')
  const command = body.command
  if (!FOCUS_MOVES.includes(command) && !FOCUS_DRAFTS.includes(command)) return refuse(400, 'Not a move the board knows.')
  if (ctx.canWrite !== true) return refuse(403, 'This board only shows: work on the focus on the board that delivers.')
  const isMove = FOCUS_MOVES.includes(command)
  if (isMove && (ctx.partner ?? null) === null) return refuse(409, 'No partner chat is on the board: the setting advisor names none.')
  const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs }
  const text = await readMap(ctx.fs, ctx.goalsFile)
  if (text === null) return refuse(404, 'There is no goal map to write into.')
  if (command === 'focus') return pick(body, text, ctx, goalsAt)
  if (!isId(body.id)) return refuse(400, 'Name the goal by its id (G12).')
  const node = parseGoals(text).byId.get(body.id)
  if (FOCUS_DRAFTS.includes(command)) return draft(body, node, ctx, goalsAt, parseGoals(text).focus)
  if (node === undefined) return refuse(409, 'That goal is not in the map.')
  if (parseGoals(text).focus !== body.id) return refuse(409, 'That goal is not your focus any more.')
  const say = async (kind, words = null) => focusWords(kind, { to: ctx.partner.name, goal: node, thread: await talkOf(node, ctx), words })
  const stage = focusStage(node)
  const words = oneLine(body.text, 1000)
  if (command === 'vibe-not-yet' || command === 'how-not-yet') {
    const wanted = command === 'vibe-not-yet' ? 'vibe' : 'how'
    if (stage !== wanted) return refuse(409, wanted === 'vibe' ? 'The vibe is agreed already.' : 'The how is not on the table now.')
    if (words === '') return refuse(400, 'Say what is missing, in your words.')
    return { ok: true, result: {}, words: await say(command, words) }
  }
  if (command === 'vibe-agree') {
    if (node.vibeAgreed !== null) return { ok: true, result: { unchanged: true }, words: null }
    if (node.vibe.length === 0 && node.vibePicture === null) return refuse(409, 'Your partner has not written the vibe yet.')
    return agree(node, ctx, goalsAt, 'vibeAgreed', agreeVibe, () => say('vibe-agreed'))
  }
  // how-go
  if (node.vibeAgreed === null) return refuse(409, 'Agree the vibe first.')
  if (node.howAgreed !== null) return { ok: true, result: { unchanged: true }, words: null }
  if (node.parts.length === 0) return refuse(409, 'Your partner has not proposed the how yet.')
  return agree(node, ctx, goalsAt, 'howAgreed', agreeHow, () => say('how-go'))
}

/** An agreed line, once: the word only when this move wrote it (two clicks: one line, one word). */
async function agree(node, ctx, goalsAt, field, write, say) {
  let wrote = false
  const done = await changeGoalsFile(text => {
    const now = parseGoals(text).byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    wrote = now[field] === null
    return write(text, node.id, minuteOf(ctx.now))
  }, goalsAt)
  if (!done.ok) return failed(done.why)
  return wrote ? { ok: true, result: {}, words: await say() } : { ok: true, result: { unchanged: true }, words: null }
}

/**
 * Pick a focus: a goal of the map (`id`), or something new (`text`: a new goal at the top, its words the opening). The
 * map's `Focus:` line names it; its talk is its running thread, else a new one, linked under it. A pick that changes
 * nothing (the same goal, its thread running) types no word.
 */
async function pick(body, before, ctx, goalsAt) {
  const isNew = body.id === undefined || body.id === null
  const line = oneLine(body.text, 120)
  if (isNew && line === '') return refuse(400, 'Write what you want to work on.')
  if (!isNew && !isId(body.id)) return refuse(400, 'Name the goal by its id (G12).')
  if (!isNew) {
    const node = parseGoals(before).byId.get(body.id)
    if (node === undefined) return refuse(409, 'That goal is not in the map.')
    if (node.state === 'done') return refuse(409, 'That goal is done: pick an open one.')
  }
  let id = isNew ? null : body.id
  let moved = false
  const written = await changeGoalsFile(text => {
    let out = text
    if (isNew) {
      id = nextGoalId(parseGoals(out))
      const added = addGoal(out, { parent: null, after: null, title: line, id })
      if (!added.ok) return added
      out = raiseLastLine(added.text, id)
    }
    moved = parseGoals(out).focus !== id
    return setFocus(out, id)
  }, goalsAt)
  if (!written.ok) return failed(written.why)
  const node = parseGoals(await readMap(ctx.fs, ctx.goalsFile)).byId.get(id)
  if (node === undefined) return failed('gone')
  let thread = await runningThread(id, ctx)
  let isNewThread = false
  if (thread === null) {
    const started = await editThread({ command: 'start', title: node.title, goal: id, opening: isNew ? oneLine(body.text, 2000) : 'I pick this goal as my focus.' }, {
      canWrite: true, dir: ctx.brainstormDir, folder: ctx.brainstormFolder, goalsFile: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs,
    })
    if (started.ok) {
      thread = started.result.path
      isNewThread = true
    } else thread = await runningThread(id, ctx)
    if (thread === null) return refuse(started.status ?? 500, started.why ?? 'The talk could not be started.')
  }
  const result = { id, thread }
  if (!moved && !isNewThread) return { ok: true, result: { ...result, unchanged: true }, words: null }
  const stage = focusStage(parseGoals(await readMap(ctx.fs, ctx.goalsFile)).byId.get(id) ?? node)
  return { ok: true, result, words: focusWords('focus', { to: ctx.partner.name, goal: node, thread, stage: STAGE_WORDS[stage], job: ctx.job }) }
}

/** "<title> · <size> · steps B1, B2", the size and the steps each left out at will. */
function partOf(value) {
  const [title = '', ...rest] = value.split(' · ').map(part => part.trim())
  const steps = rest.find(part => /^steps\b/i.test(part))
  const size = rest.find(part => !/^steps\b/i.test(part) && part !== '') ?? ''
  return { title, size, steps: steps === undefined ? [] : steps.replace(/^steps\s*/i, '').split(/[,\s]+/).filter(one => /^B\d+$/.test(one)) }
}

/** What the person agreed of a how: its parts (title, size) and what is decided by whom; the steps come after. */
const agreedOf = node => JSON.stringify([node.parts.map(part => [part.title, part.size]), node.partnerDecides, node.youDecide])

/**
 * The partner's drafts. `vibe-draft`: `lines` (three to five short lines) and `picture` (a path, or none), in place of
 * the goal's vibe, until the vibe is agreed. `how-draft`: `parts` ({ title, size, steps }), `partnerDecides`,
 * `youDecide`, in place of the goal's how, once its vibe is agreed; once the how is agreed only the parts' steps may
 * change. Only the focus goal is drafted.
 */
async function draft(body, node, ctx, goalsAt, focus) {
  // The review of Focus 2: a draft is the focus goal's, and a how comes once its vibe is agreed.
  const notFocus = () => refuse(409, 'That goal is not the focus: draft only the focus goal.')
  if (body.command === 'vibe-draft') {
    if (!isLines(body.lines) || (body.picture !== undefined && body.picture !== null && typeof body.picture !== 'string')) return refuse(400, 'A vibe is lines of words, and a picture\'s path or none.')
    if (node === undefined) return failed('gone')
    if (node.id !== focus) return notFocus()
    if (node.vibeAgreed !== null) return refuse(409, 'The vibe is agreed: talk about the how now.')
    let late = false
    const done = await changeGoalsFile(text => {
      const now = parseGoals(text).byId.get(node.id)
      if (now === undefined) return { ok: false, why: 'gone' }
      late = now.vibeAgreed !== null
      return late ? { ok: false, why: 'late' } : setVibe(text, node.id, body.lines, body.picture ?? null)
    }, goalsAt)
    if (late) return refuse(409, 'The vibe is agreed: talk about the how now.')
    return done.ok ? { ok: true, result: {}, words: null } : failed(done.why)
  }
  // A part as an object, or in the work tool's words: "<title> · <size> · steps B1, B2", as goals.md reads a Part line.
  const parts = Array.isArray(body.parts) ? body.parts.map(part => (typeof part === 'string' ? partOf(part) : part)) : body.parts
  const how = { parts, partnerDecides: body.partnerDecides ?? [], youDecide: body.youDecide ?? [] }
  if (!Array.isArray(how.parts) || !how.parts.every(part => part !== null && typeof part === 'object') || !isLines(how.partnerDecides) || !isLines(how.youDecide)) {
    return refuse(400, 'A how is its parts ({ title, size, steps }) and the lines of who decides what.')
  }
  if (node === undefined) return failed('gone')
  if (node.id !== focus) return notFocus()
  if (node.vibeAgreed === null) return refuse(409, 'The vibe is not agreed yet: draft the how once the person agreed it.')
  let changed = false
  const done = await changeGoalsFile(text => {
    const now = parseGoals(text).byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    const next = setHow(text, node.id, how)
    if (!next.ok || now.howAgreed === null) return next
    changed = agreedOf(parseGoals(next.text).byId.get(node.id)) !== agreedOf(now)
    return changed ? { ok: false, why: 'agreed' } : next
  }, goalsAt)
  if (changed) return refuse(409, 'The how is agreed: add the steps to its parts, change nothing else.')
  return done.ok ? { ok: true, result: {}, words: null } : failed(done.why)
}
