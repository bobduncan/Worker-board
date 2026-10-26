// Focus 2 (spec 2026-10-18, sections 3, 5 and 6): the vibe and how moves on the Focus page, and the partner's drafts.
// Every move goes through POST /api/goals: the person's moves (`FOCUS_MOVES`) from the page, the partner's drafts
// (`FOCUS_DRAFTS`) from the page or with the board's key. Each writes goals.md by id (read anew right before, as every
// change of the map) and answers the words the board then types to the partner, marked as the person's: null when the
// move changed nothing (a second click), so a word goes once (Review Focus 3). The moves run one at a time.
import { access, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { editThread, parseThread, setThreadState } from './brainstorm.mjs'
import { focusStage, hasDemo, hasDoneWhen, nextGoalId, parseGoals } from './goals.mjs'
import { askingOf, evaluateWords, evaluationPartOf, evaluationsDue, fableAskOf, goalAttempts, guardStep, openFableAsk, partnerModeFor } from './goalGuard.mjs'
import { addGoal, addGoalLine, addGoalNote, agreeHow, agreeVibe, changeGoalsFile, raiseLastLine, reopenHow, rewrite, setFocus, setGoalLine, setGoalState, setHow, setVibe } from './goalsWrite.mjs'
import { focusWords } from './say.mjs'
import { absentAs, again } from './write.mjs'
import { sinceMs } from './work/item.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, access, readdir, open }

/**
 * The person's moves: pick a focus, agree the vibe or not yet, go with the how or not yet; Focus 4: the run's talk bar;
 * B354: ask the partner for a goal's Done when; B358: tick a goal on the Goals part (its re-check first).
 */
export const FOCUS_MOVES = ['focus', 'vibe-agree', 'vibe-not-yet', 'how-go', 'how-not-yet', 'vibe-there-yes', 'vibe-there-no', 'talk', 'done-when', 'goal-demo', 'goal-done']
/** The partner's drafts beside the talk: the vibe's lines and picture, the how's parts. */
export const FOCUS_DRAFTS = ['vibe-draft', 'how-draft']

/**
 * Focus 3: whether every part of the focus goal's how is done, for "Is the vibe there?" on that goal (`id`). No focus,
 * or a word that names no goal, is not (2026-10-24: on a board with no focus yet a Vision word without an id read the
 * progress of no focus and failed: "Cannot read properties of null (reading 'progress')").
 */
export function focusAllDone(focus, id) {
  if ((focus ?? null) === null || typeof id !== 'string' || focus.id !== id) return false
  const total = focus.progress?.total ?? 0
  return total > 0 && focus.progress.done === total
}

/**
 * B680: why the person may not drop a part now, or null: the page drops a Stopped part of the focus goal (`focus`, the state's)
 * with a reason (`body.id` the goal, `body.part` the part's title, `body.text` why).
 */
export function partDropRefusal(focus, body) {
  if ((focus ?? null) === null || focus.id !== body?.id) return 'That goal is not your focus any more.'
  const part = focus.parts.find(one => one.title === body.part)
  if (part === undefined) return 'That is not a part of this goal.'
  if (part.state !== 'stopped') return 'Only a Stopped part can be dropped: this one has work again, or was dropped already.'
  if (String(body.text ?? '').trim() === '') return 'Say why you drop it, in one line.'
  return null
}

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
// B467: `fallback` only for a file that is not there; one Windows holds is tried again, and one that stays held or
// cannot be read is an error, never "no goal map" or "no thread".
const readText = (fs, file, fallback) => again(() => fs.readFile(file)).then(bytes => bytes.toString('utf8'), absentAs(fallback))
const readMap = (fs, file) => readText(fs, file, null)

/**
 * The threads about a goal that are not over (running, or wrapping up), newest first: `{ path, file, thread }`, the path
 * as the setting names it.
 */
async function liveThreads(goal, { brainstormDir, brainstormFolder, fs }) {
  const base = String(brainstormDir).replace(/[\\/]+$/, '')
  const names = (await fs.readdir(base).catch(absentAs([]))).filter(name => /^[a-z0-9][a-z0-9-]*\.md$/.test(name)).sort().reverse()
  const found = []
  for (const name of names) {
    const thread = parseThread(await readText(fs, `${base}/${name}`, ''))
    if (thread.goal?.id === goal && (thread.state === 'running' || thread.state === 'wrapping up')) found.push({ path: `${brainstormFolder}/${name}`, file: `${base}/${name}`, thread })
  }
  return found
}

/** The talk about a goal the page answers in: a running thread with no proposal, by its path; null when none is. */
async function runningThread(goal, ctx) {
  return (await liveThreads(goal, ctx)).find(one => one.thread.state === 'running' && one.thread.proposal === null)?.path ?? null
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
  if (command === 'done-when') return askDoneWhen(parseGoals(text).byId.get(body.id), ctx)
  // B677: the person's button "Ask your partner again" for the goal demo.
  if (command === 'goal-demo') return askDemo(parseGoals(text), body.id, ctx, goalsAt)
  // B358: the person's tick on the Goals part, routed here by the board while a partner is on it.
  if (command === 'goal-done') return goalDone(parseGoals(text).byId.get(body.id), ctx, goalsAt, body.overturn === true)
  const node = parseGoals(text).byId.get(body.id)
  if (FOCUS_DRAFTS.includes(command)) return draft(body, node, ctx, goalsAt, parseGoals(text).focus)
  if (node === undefined) return refuse(409, 'That goal is not in the map.')
  // Focus 3: a second Yes to "Is the vibe there?" finds the goal ticked and the focus gone: nothing more.
  if (command === 'vibe-there-yes' && node.state === 'done') return { ok: true, result: { unchanged: true }, words: null }
  if (parseGoals(text).focus !== body.id) return refuse(409, 'That goal is not your focus any more.')
  const say = async (kind, words = null) => focusWords(kind, { to: ctx.partner.name, goal: node, thread: await talkOf(node, ctx), words })
  const stage = focusStage(node)
  const words = oneLine(body.text, 1000)
  if (command === 'talk') return talkBar(node, words, ctx, goalsAt)
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
  if (command === 'vibe-there-yes' || command === 'vibe-there-no') return vibeThere(command, node, words, ctx, goalsAt, say)
  // how-go
  if (node.vibeAgreed === null) return refuse(409, 'Agree the vibe first.')
  if (node.howAgreed !== null) return { ok: true, result: { unchanged: true }, words: null }
  if (node.parts.length === 0) return refuse(409, 'Your partner has not proposed the how yet.')
  return agree(node, ctx, goalsAt, 'howAgreed', agreeHow, () => say('how-go'))
}

/** An agreed line, once: the word only when this move wrote it (two clicks: one line, one word). */
async function agree(node, ctx, goalsAt, field, write, say) {
  let wrote = false
  let withdraw = null
  const done = await changeGoalsFile(text => {
    const now = parseGoals(text).byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    wrote = now[field] === null
    const written = write(text, node.id, minuteOf(ctx.now))
    // B359: Go starts the count of failed checks anew; an evaluation left from before the how was reopened ends with it,
    // and so does the board's ask before one (2026-10-24): the board withdraws it (`withdraw`), a late answer starts nothing.
    if (!written.ok || field !== 'howAgreed' || !wrote) return written
    withdraw = askingOf(now)
    return endTrip(written.text, node.id)
  }, goalsAt)
  if (!done.ok) return failed(done.why)
  return wrote ? { ok: true, result: withdrawn(withdraw), words: await say() } : { ok: true, result: { unchanged: true }, words: null }
}

/** 2026-10-24: the board's open ask a move ended the trip of, for the server to withdraw (outside the map's turn). */
const withdrawn = (id, result = {}) => (id === null ? result : { ...result, withdraw: id })

/**
 * The talk about the goal `id` (`node`) the page writes in: the thread that runs; else one wrapped up (no proposal)
 * reopened; else a new one with `opening`, linked under the goal. A talk that holds a proposal is the Brainstorm
 * part's to create or discard first. Answers `{ ok: true, thread, isNewThread, isStarted }` (`isStarted`: made now,
 * its opening the words given) or a refusal.
 */
async function talkFor(id, node, opening, ctx, goalsAt) {
  let thread = await runningThread(id, ctx)
  let isNewThread = false
  let isStarted = false
  // The review of Focus 2: a talk wrapped up on the Brainstorm part (no proposal yet) is reopened; one that holds a
  // proposal is the Brainstorm part's to create or discard first; one that is over gives way to a new one.
  const live = thread === null ? await liveThreads(id, ctx) : []
  if (live.some(one => one.thread.proposal !== null)) return refuse(409, 'The talk about this goal holds a proposal: create or discard it on the Brainstorm part first.')
  if (live.length > 0) {
    const reopened = await rewrite(live[0].file, latin => {
      const text = Buffer.from(latin, 'latin1').toString('utf8')
      const done = setThreadState(text, 'running')
      return done.ok ? { ok: true, text: Buffer.from(done.text, 'utf8').toString('latin1') } : done
    }, ctx.fs)
    if (!reopened.ok) return failed(reopened.why)
    thread = live[0].path
    isNewThread = true
  }
  if (thread === null) {
    const started = await editThread({ command: 'start', title: node.title, goal: id, opening }, {
      canWrite: true, dir: ctx.brainstormDir, folder: ctx.brainstormFolder, goalsFile: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs,
    })
    if (started.ok) {
      thread = started.result.path
      isNewThread = true
      isStarted = true
    } else thread = await runningThread(id, ctx)
    if (thread === null) return refuse(started.status ?? 500, started.why ?? 'The talk could not be started.')
  }
  // The goal's Brainstorm line names the talk the page answers in, also when the line named one that is over.
  if (isNewThread && node.brainstorm?.path !== thread) {
    // B467: not written is no reason to fail the move: the talk runs, and runningThread finds it by its goal.
    await changeGoalsFile(text => (parseGoals(text).byId.has(id) ? setGoalLine(text, id, 'Brainstorm', `${thread} (running)`) : { ok: true, text }), goalsAt)
      .catch(error => console.error(`The Brainstorm line of ${id} could not be written: ${error.message}`))
  }
  return { ok: true, thread, isNewThread, isStarted }
}

/**
 * Focus 4 (spec 2026-10-18, sections 4 and 6): the run's talk bar. The person's words (`words`) go into the goal's talk
 * (talkFor) as the Brainstorm part sends them: in a talk started for them, as its opening (`brainstorm`); with the
 * partner's question open, as its answer, written under it (`brainstorm answer`); while the partner has the turn, as
 * `talk: <words>` with the goal and the thread. Each typed as the person's word.
 */
async function talkBar(node, words, ctx, goalsAt) {
  if (words === '') return refuse(400, 'Write what you want to tell your partner.')
  const talk = await talkFor(node.id, node, words, ctx, goalsAt)
  if (!talk.ok) return talk
  const result = { id: node.id, thread: talk.thread }
  const about = `${node.id} ${oneLine(node.title, 200)}`
  const word = (command, text) => ({ to: ctx.partner.name, ask: null, step: null, title: null, version: null, verdict: null, command, about: talk.thread, text })
  if (talk.isStarted) return { ok: true, result, words: word('brainstorm', `brainstorm\nThread: ${talk.thread}\nGoal: ${about}\nOpening: ${words}`) }
  const base = String(ctx.brainstormDir).replace(/[\\/]+$/, '')
  const file = `${base}/${talk.thread.split('/').pop()}`
  const thread = parseThread(await readText(ctx.fs, file, ''))
  const latest = thread.questions.at(-1)
  if (latest !== undefined && latest.answer === null) {
    const answered = await editThread({ command: 'answer', path: talk.thread, n: latest.n, key: 'Other', words }, {
      canWrite: true, dir: ctx.brainstormDir, folder: ctx.brainstormFolder, goalsFile: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs,
    })
    if (!answered.ok) return answered
    return { ok: true, result, words: word('brainstorm-answer', `brainstorm answer\nThread: ${talk.thread}\nQ${latest.n}: Other — ${words}`) }
  }
  return { ok: true, result, words: { ...focusWords('talk', { to: ctx.partner.name, goal: node, thread: talk.thread, words }) } }
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
    // The review of B354: the focus picked again ("Start the talk") changes no focus, also for one picked before the rule.
    if (!hasDoneWhen(node) && parseGoals(before).focus !== body.id) return refuse(409, NO_DONE_WHEN(node.id))
  }
  let id = isNew ? null : body.id
  let moved = false
  const written = await changeGoalsFile(text => {
    let out = text
    if (isNew) {
      id = nextGoalId(parseGoals(out))
      const added = addGoal(out, { parent: null, after: null, title: line, id })
      if (!added.ok) return added
      // B354: a new goal has no Done when yet: it waits in the map, not as the focus, while the partner writes one. The
      // review: the person's words longer than its title stay under it (a note's first 300 characters; the partner's
      // word carries them whole), for the talk once it is picked.
      const words = oneLine(body.text, 2000)
      const noted = words === line ? added : addGoalNote(added.text, id, `In your words: ${words}`)
      return noted.ok ? { ok: true, text: raiseLastLine(noted.text, id) } : noted
    }
    const now = parseGoals(out).byId.get(id)
    if (now === undefined) return { ok: false, why: 'gone' }
    if (!hasDoneWhen(now) && parseGoals(out).focus !== id) return { ok: false, why: 'doneWhen' }
    moved = parseGoals(out).focus !== id
    return setFocus(out, id)
  }, goalsAt)
  if (!written.ok) return written.why === 'doneWhen' ? refuse(409, NO_DONE_WHEN(id)) : failed(written.why)
  const node = parseGoals(await readMap(ctx.fs, ctx.goalsFile)).byId.get(id)
  if (node === undefined) return failed('gone')
  if (isNew) return { ok: true, result: { id, isFocus: false }, words: focusWords('done-when', { to: ctx.partner.name, goal: node, words: oneLine(body.text, 2000), job: ctx.job }) }
  const talk = await talkFor(id, node, isNew ? oneLine(body.text, 2000) : 'I pick this goal as my focus.', ctx, goalsAt)
  if (!talk.ok) return talk
  const { thread, isNewThread } = talk
  const result = { id, thread }
  if (!moved && !isNewThread) return { ok: true, result: { ...result, unchanged: true }, words: null }
  // B467, the review: the map and the thread are written by now. A map that cannot be read again here still lets the
  // word go out, with the stage of the goal as read before: a click again would find nothing changed and send none.
  const after = await readMap(ctx.fs, ctx.goalsFile).catch(error => (console.error(`The goal map could not be read again after ${id} became the focus: ${error.message}`), null))
  const stage = focusStage((after === null ? undefined : parseGoals(after).byId.get(id)) ?? node)
  return { ok: true, result, words: focusWords('focus', { to: ctx.partner.name, goal: node, thread, stage: STAGE_WORDS[stage], job: ctx.job }) }
}

/** B354: why a goal without a Done when is not picked. */
const NO_DONE_WHEN = id => `${id} has no Done when yet: a goal becomes your focus once it says how you check it is done. Ask your partner to write it, or write it on the Goals part.`

/**
 * B354: the person's button for a goal without a Done when: the partner is asked to write one (`done when:`); the map
 * is not changed. A goal that has one, is done or is not in the map is refused.
 */
function askDoneWhen(node, ctx) {
  if (node === undefined) return refuse(409, 'That goal is not in the map.')
  if (node.state === 'done') return refuse(409, `${node.id} is done already.`)
  if (hasDoneWhen(node)) return refuse(409, `${node.id} has a Done when already: change it on the Goals part.`)
  return { ok: true, result: { id: node.id }, words: focusWords('done-when', { to: ctx.partner.name, goal: node, job: ctx.job }) }
}

/** B677: the goal demo is asked of the partner again this often while it is not there, at most DEMO_WORDS times in all. */
export const DEMO_AGAIN_MS = 60 * 60_000
export const DEMO_WORDS = 3

/** B677: `Demo asked: <date time> · <n>` as { at, n } (n: the words sent so far, 1 without it), or null. */
export function demoAskOf(value) {
  const found = String(value ?? '').trim().match(/^(\d{4}-\d\d-\d\d \d\d:\d\d)(?:\s*·\s*(\d+))?$/)
  return found === null ? null : { at: found[1], n: Number(found[2] ?? 1) }
}

/** B677: the goal's demo is due as a word to the partner: the focus run is done, no Demo line, and no word yet, or the last is DEMO_AGAIN_MS old with fewer than DEMO_WORDS sent. Answers the number of the word, or 0. */
export function demoDue(node, now) {
  if (node === undefined || node.state === 'done' || hasDemo(node)) return 0
  const asked = demoAskOf(node.demoAsked)
  if (asked === null) return 1
  const since = sinceMs(asked.at)
  return asked.n < DEMO_WORDS && Number.isFinite(since) && now - since >= DEMO_AGAIN_MS ? asked.n + 1 : 0
}

/**
 * B677: every part of the focus goal is done and it has no Demo line: the board types `goal demo: G<n> <title>` into the
 * partner's chat once, again every DEMO_AGAIN_MS while it is not answered, DEMO_WORDS times at most (`Demo asked` under
 * the goal keeps the time and the count). `ctx.focus` is the state's focus. Answers { ok, words: [] or [the word] }.
 */
export async function demoAgain(ctx) {
  if (ctx.canWrite !== true || (ctx.partner ?? null) === null || !focusAllDone(ctx.focus ?? null, ctx.focus?.id)) return []
  return underMapTurn(async () => {
    const at = ctx.fs ?? files
    const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: at }
    const text = await readMap(at, ctx.goalsFile)
    if (text === null) return []
    const map = parseGoals(text)
    const node = map.byId.get(ctx.focus.id)
    if (map.focus !== ctx.focus.id || node === undefined || focusStage(node) !== 'run') return []
    const n = demoDue(node, ctx.now)
    if (n === 0) return []
    const done = await changeGoalsFile(now => setGoalLine(now, node.id, 'Demo asked', `${minuteOf(ctx.now)} · ${n}`), goalsAt)
    if (!done.ok) return []
    return [focusWords('goal-demo', { to: ctx.partner.name, goal: node, words: n === 1 ? null : n, job: ctx.job })]
  })
}

/**
 * B677: the person's "Ask your partner again": the count starts anew (`Demo asked: <now> · 1`) and the word goes at
 * once. Refused for a goal that is not the focus, not all done, ticked or with its demo.
 */
async function askDemo(map, id, ctx, goalsAt) {
  const node = map.byId.get(id)
  if (node === undefined) return refuse(409, 'That goal is not in the map.')
  if (node.state === 'done') return refuse(409, `${id} is done already.`)
  if (hasDemo(node)) return refuse(409, `${id} has its goal demo already.`)
  if (map.focus !== id || ctx.allDone !== true) return refuse(409, 'The goal demo is made once every part of the focus is done.')
  const was = demoAskOf(node.demoAsked)
  const done = await changeGoalsFile(now => setGoalLine(now, id, 'Demo asked', `${minuteOf(ctx.now)} · 1`), goalsAt)
  if (!done.ok) return failed(done.why)
  return { ok: true, result: { id, demo: 'asked' }, words: focusWords('goal-demo', { to: ctx.partner.name, goal: node, words: was === null ? null : 'by you', job: ctx.job }) }
}

/**
 * Focus 3 (spec 2026-10-18, section 3): the person's answer to "Is the vibe there?", once every part is done
 * (`ctx.allDone`, from the store). B358: Yes asks the partner for the goal's re-check (askRecheck); its pass ticks the
 * goal and clears `Focus:`. No (with the person's words) takes `How agreed` away, so the partner proposes the how anew,
 * and types `vibe there: no`.
 */
async function vibeThere(command, node, words, ctx, goalsAt, say) {
  if (focusStage(node) !== 'run') return refuse(409, command === 'vibe-there-no' && node.vibeAgreed !== null ? 'The how is open again already.' : 'The how is not agreed: there is nothing to look at yet.')
  if (ctx.allDone !== true) return refuse(409, 'Not every part is done yet.')
  // B354: a goal is ticked against its Done when; a focus picked before that rule may have none.
  if (command === 'vibe-there-yes' && !hasDoneWhen(node)) return refuse(409, `${node.id} gets its tick only with a Done when that says how you check it: ask your partner to write it, or write it on the Goals part.`)
  // B677: before the person answers, they see the goal demo: Yes waits for it.
  if (command === 'vibe-there-yes' && !hasDemo(node)) return refuse(409, `${node.id} has no goal demo yet: your partner makes it first, and you see it before you answer.`)
  if (command === 'vibe-there-no' && words === '') return refuse(400, 'Say what is missing, in your words.')
  // B358: Yes asks the partner for the goal's re-check first; the goal gets its tick once that passed.
  if (command === 'vibe-there-yes') return askRecheck(node, ctx, goalsAt)
  let wrote = false
  const done = await changeGoalsFile(text => {
    const map = parseGoals(text)
    const now = map.byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    wrote = map.focus === node.id && focusStage(now) === 'run'
    if (!wrote) return { ok: false, why: 'late' }
    // The second review: No takes an open re-check back too, so a later pass cannot tick it against the person's word.
    const reopened = reopenHow(text, node.id)
    return reopened.ok ? setGoalLine(reopened.text, node.id, 'Recheck asked', '') : reopened
  }, goalsAt)
  if (!wrote) return { ok: true, result: { unchanged: true }, words: null }
  if (!done.ok) return failed(done.why)
  return { ok: true, result: {}, words: await say(command, words) }
}

/** B358: whether a goal's re-check was asked and has no outcome yet. */
const isRecheckOpen = node => node.recheckAsked !== null && node.recheckAsked !== undefined

/**
 * B358: the person's tick of a goal on the Goals part (the board routes it here when a partner is on it). A goal with
 * a Done when gets its re-check first (askRecheck); after a failed re-check the person's tick stands, written under the
 * goal as an overturn. Refused without a Done when (B354).
 */
async function goalDone(node, ctx, goalsAt, isOverturn = false) {
  if (node === undefined) return refuse(409, 'That goal is not in the map.')
  if (node.state === 'done') return { ok: true, result: { unchanged: true }, words: null }
  if (!hasDoneWhen(node)) return refuse(409, `${node.id} gets its tick only with a Done when that says how you check it: write it with "Done when…", or ask your partner to.`)
  // The review: the person's tick without the re-check only on their second click (`overturn`), written under the goal.
  if (isOverturn) return overturnTick(node, ctx, goalsAt)
  // The review: a tick while the re-check is open asks the partner again, so a re-check that never came is not stuck.
  return askRecheck(node, ctx, goalsAt, isRecheckOpen(node))
}

/** B358: the person's tick without a passed re-check: ticked, the overturn written under the goal, the focus cleared. */
async function overturnTick(node, ctx, goalsAt) {
  let late = false
  let why = 'without its re-check'
  let withdraw = null
  const done = await changeGoalsFile(text => {
    const map = parseGoals(text)
    const now = map.byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    late = now.state === 'done'
    if (late) return { ok: false, why: 'late' }
    why = isRecheckOpen(now) ? 'before its re-check came' : now.rechecks.at(-1)?.verdict === 'failed' ? 'after the re-check failed' : 'without its re-check'
    // 2026-10-24: a ticked goal ends the guard's trip: its evaluation, and the board's ask before one (withdrawn).
    withdraw = askingOf(now)
    const state = setGoalState(text, node.id, 'done')
    const ticked = state.ok ? endTrip(state.text, node.id) : state
    const cleared = ticked.ok ? setGoalLine(ticked.text, node.id, 'Recheck asked', '') : ticked
    if (!cleared.ok) return cleared
    const noted = addGoalLine(cleared.text, node.id, `Overturned (${minuteOf(ctx.now)}): ticked by you ${why}`)
    return noted.ok && map.focus === node.id ? setFocus(noted.text, null) : noted
  }, goalsAt)
  if (late) return { ok: true, result: { unchanged: true }, words: null }
  return done.ok ? { ok: true, result: withdrawn(withdraw, { id: node.id, overturned: true }), words: null } : failed(done.why)
}

/**
 * B358: the partner is asked to re-check the goal against its Done when and its vibe before its tick: `Recheck
 * asked: <date time>` under it (once), and the word `goal re-check:` to the partner.
 */
async function askRecheck(node, ctx, goalsAt, isAgain = false) {
  let wrote = false
  const at = minuteOf(ctx.now)
  const done = await changeGoalsFile(text => {
    const now = parseGoals(text).byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    // Once a minute at most: a double click types one word.
    wrote = now.state !== 'done' && (isAgain ? now.recheckAsked !== at : !isRecheckOpen(now))
    return wrote ? setGoalLine(text, node.id, 'Recheck asked', at) : { ok: false, why: 'late' }
  }, goalsAt)
  const asked = isAgain ? 'asked again' : 'asked'
  if (!wrote) return { ok: true, result: { id: node.id, recheck: asked, unchanged: true }, words: null }
  if (!done.ok) return failed(done.why)
  return { ok: true, result: { id: node.id, recheck: asked }, words: focusWords('goal-recheck', { to: ctx.partner.name, goal: node, job: ctx.job }) }
}

/**
 * B358: the outcome of the partner's re-check of a goal (`checked` of a goal in the work tool): `{ id, verdict
 * ('passed', 'failed' or 'waits for you'), line (the outcome's words), by }`. Writes "Rechecked (<date time>, <by>):
 * <line>" under the goal and takes "Recheck asked" away; passed, the goal is ticked and, the focus, the focus is
 * cleared. Answers `{ ok, result: { id, title, ticked, attempts } }` (attempts: its failed re-checks).
 */
export function goalChecked(body, ctx) {
  const run = turn.then(() => recheckDone(body, { fs: files, ...ctx }))
  turn = run.catch(() => {})
  return run
}

/**
 * B360: the person overturned the recap of a ticked goal (`{ id, words }`): the goal is open again, with "Overturned
 * (<date time>): reopened by you from its recap: <words>" under it. A goal that is not done (any more) stays as it is.
 * Answers `{ ok, result: { id, reopened } }`.
 */
export function goalReopened(body, ctx) {
  const run = turn.then(() => reopenGoal(body, { fs: files, ...ctx }))
  turn = run.catch(() => {})
  return run
}

async function reopenGoal({ id, words }, ctx) {
  if (ctx.canWrite !== true) return refuse(403, 'This board only shows: work on the goals on the board that delivers.')
  if (!isId(id)) return refuse(400, 'Name the goal by its id (G12).')
  const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs }
  let late = false
  const done = await changeGoalsFile(text => {
    const now = parseGoals(text).byId.get(id)
    if (now === undefined) return { ok: false, why: 'gone' }
    late = now.state !== 'done'
    if (late) return { ok: false, why: 'late' }
    const opened = setGoalState(text, id, 'open')
    return opened.ok ? addGoalLine(opened.text, id, `Overturned (${minuteOf(ctx.now)}): reopened by you from its recap: ${oneLine(words, 300)}`) : opened
  }, goalsAt)
  if (late) return { ok: true, result: { id, reopened: false } }
  return done.ok ? { ok: true, result: { id, reopened: true } } : failed(done.why)
}

/**
 * B359: the goal guard for goal `id` when its failed attempts (since Go, else since its first refined step) reached the
 * third (src/goalGuard.mjs `guardStep`). 2026-10-24: first it asks the person, once per trip: the board's ask (Fable or
 * Opus, `fableAskOf`) filed with `ctx.fileAsk(body)` (the work API as the board), and "Fable asked: Q<n>" under the goal;
 * while it stands open nothing more happens. On its answer: "Evaluation asked: <date time>" under the goal, and the word
 * `evaluate G<n>` to the partner (`ctx.partner`), with what failed and whether a rebuild needs the person's yes
 * (`ctx.approveRebuilds`). `ctx.items` are the store's (or a function that reads them, read fresh at each step).
 * Answers `{ ok, result: { id, fired, asked?, mode?, ask? }, words }`: `asked` the ask just filed; once fired, `mode` the
 * partner's for this evaluation ('fable' only for the person's yes, else 'high') and `ask` its ask; words is null when
 * the guard did not fire. Without `ctx.fileAsk` it starts nothing.
 * The review of 2026-10-24: the ask is never filed while the map's turn is held (the work API's own turn waits on the
 * map's for a draft or a goal's re-check: both held at once was a deadlock). The guard runs one at a time in a turn of
 * its own: the map's step under the map's turn, the ask through the work API outside it, then its line under the map's
 * turn again. An ask filed for a trip that ended meanwhile is withdrawn (`ctx.withdrawAsk(id, why)`).
 */
let guardTurn = Promise.resolve()
export function guardGoal(id, ctx) {
  const run = guardTurn.then(() => runGuard(id, { fs: files, ...ctx }))
  guardTurn = run.catch(() => {})
  return run
}

/** One change of the goal map under the map's turn, as every move of the Focus page. */
function underMapTurn(work) {
  const run = turn.then(work)
  turn = run.catch(() => {})
  return run
}

async function runGuard(id, ctx) {
  const calm = { ok: true, result: { id, fired: false }, words: null }
  if (ctx.canWrite !== true || (ctx.partner ?? null) === null || !isId(id)) return calm
  const itemsNow = async () => (typeof ctx.items === 'function' ? ctx.items() : ctx.items)
  const first = await underMapTurn(async () => fireGuard(id, { ...ctx, items: await itemsNow() }))
  if (first.ok !== true || first.ask === undefined) return first
  // Never an evaluation without the person's answer: a board that cannot ask starts nothing.
  if (typeof ctx.fileAsk !== 'function') return calm
  // An open ask of the board's for this goal (its line lost) is used again, read fresh: the person is never asked twice.
  let asked = openFableAsk(id, await itemsNow())?.head.get('Id') ?? null
  const isNew = asked === null
  if (isNew) {
    const filed = await ctx.fileAsk(first.ask)
    if (filed?.ok !== true) return refuse(filed?.status ?? 500, `The ask for ${id}'s evaluation could not be filed: ${filed?.why ?? 'no answer'}`)
    asked = filed.result.id
  }
  const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs }
  const done = await underMapTurn(() => changeGoalsFile(now => {
    const goal = parseGoals(now).byId.get(id)
    // Read again: the goal may have been ticked, or its trip ended or begun meanwhile.
    if (goal === undefined || goal.state === 'done' || (goal.fableAsked ?? null) !== null || (goal.evaluationAsked ?? null) !== null) return { ok: false, why: 'calm' }
    const lined = setGoalLine(now, id, 'Fable asked', asked)
    // B669: the part that tripped the guard, kept until the evaluation ends (none: the goal as a whole).
    return lined.ok && first.part ? setGoalLine(lined.text, id, 'Evaluation part', first.part) : lined
  }, goalsAt))
  if (!done.ok && done.why === 'calm' && isNew) await ctx.withdrawAsk?.(asked, `${id} changed while the board asked: the ask is no longer needed`)
  if (!done.ok) return done.why === 'calm' ? calm : failed(done.why)
  return { ok: true, result: { id, fired: false, asked }, words: null }
}

/**
 * B382: the goals whose fundamental evaluation runs now ("Evaluation asked" under an open goal), the focus or not: while
 * one runs, the partner stays on high effort.
 */
export async function evaluationsRunning(ctx) {
  // B467: no map is none running; a map it cannot read is not, and goes to the caller (which then keeps the effort).
  const text = await readMap(ctx.fs ?? files, ctx.goalsFile)
  if (text === null) return []
  return parseGoals(text).nodes.filter(node => node.state !== 'done' && (node.evaluationAsked ?? null) !== null).map(node => node.id)
}

/**
 * 2026-10-24: the goals whose board ask (Fable or Opus) stands under them with no evaluation running yet: the board's tick
 * runs the guard for each, so an answer it missed (the board restarted) still starts the evaluation.
 */
export async function guardsAsking(ctx) {
  const text = await readMap(ctx.fs ?? files, ctx.goalsFile)
  if (text === null) return []
  return parseGoals(text).nodes.filter(node => node.state !== 'done' && (node.fableAsked ?? null) !== null && (node.evaluationAsked ?? null) === null).map(node => node.id)
}

/**
 * 2026-10-24: the partner's mode while evaluations run, `{ mode, yes }` (goalGuard.mjs `partnerModeFor`): 'usual' when
 * none runs, 'fable' only when every one that runs had the person's yes (`yes` its ask), else 'high'. `ctx.items()` reads
 * the store's items. A map it cannot read goes to the caller (B467).
 */
export async function evaluationsMode(ctx) {
  const text = await readMap(ctx.fs ?? files, ctx.goalsFile)
  if (text === null) return partnerModeFor([], [])
  const nodes = parseGoals(text).nodes
  return partnerModeFor(nodes, nodes.some(node => node.state !== 'done' && (node.evaluationAsked ?? null) !== null) ? await ctx.items() : [])
}

/** The end of a guard's trip: "Evaluation asked" and the board's "Fable asked" taken from under the goal. */
function endTrip(text, id) {
  const cleared = setGoalLine(text, id, 'Evaluation asked', '')
  const asked = cleared.ok ? setGoalLine(cleared.text, id, 'Fable asked', '') : cleared
  return asked.ok ? setGoalLine(asked.text, id, 'Evaluation part', '') : asked
}

/**
 * The guard's step under the map's turn: calm or waiting, the ask to file (`ask`, the body; filed by `runGuard` outside
 * the turn), or the evaluation started ("Evaluation asked" written; a deleted ask's line taken away, on Opus).
 */
async function fireGuard(id, ctx) {
  const calm = { ok: true, result: { id, fired: false }, words: null }
  const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs }
  const text = await readMap(ctx.fs, ctx.goalsFile)
  if (text === null) return calm
  const node0 = parseGoals(text).byId.get(id)
  const first = guardStep(node0, ctx.items)
  if (first === null || first.do === 'wait') return calm
  if (first.do === 'ask') {
    const attempts = goalAttempts(node0, ctx.items)
    return { ...calm, ask: fableAskOf({ goal: node0, attempts }), part: attempts.tripped?.key === 'goal' ? null : attempts.tripped?.title ?? null }
  }
  let node = null
  let step = null
  const done = await changeGoalsFile(now => {
    const goal = parseGoals(now).byId.get(id)
    // B382: any goal with an agreed how, the focus or not: its evaluation ends with a marked how-draft of that goal.
    step = guardStep(goal, ctx.items)
    if (step?.do !== 'start') return { ok: false, why: 'calm' }
    node = goal
    const asked = setGoalLine(now, id, 'Evaluation asked', minuteOf(ctx.now))
    // An ask the store no longer holds: the evaluation runs on Opus, and the line that named it goes.
    return asked.ok && step.gone ? setGoalLine(asked.text, id, 'Fable asked', '') : asked
  }, goalsAt)
  if (!done.ok) return done.why === 'calm' ? calm : failed(done.why)
  const attempts = goalAttempts(node, ctx.items)
  const words = evaluateWords({ to: ctx.partner.name, goal: node, attempts, part: evaluationPartOf(node, attempts), approveRebuilds: ctx.approveRebuilds === true, job: ctx.job, maxChars: ctx.maxChars })
  return { ok: true, result: { id, fired: true, mode: step.mode, ask: step.ask }, words }
}

/**
 * B528: the words that go to the partner again, one per goal whose evaluation runs and was last asked of it
 * `EVALUATE_AGAIN_MS` ago (goalGuard.mjs `evaluationsDue`; `ctx.outbox` the outbox's messages), with "again" in them.
 * `ctx.items()` reads the store's items, only when a word is due. None without a partner, or on a board that only shows.
 */
export async function evaluationsAgain(ctx) {
  if (ctx.canWrite !== true || (ctx.partner ?? null) === null) return []
  const text = await readMap(ctx.fs ?? files, ctx.goalsFile)
  if (text === null) return []
  const due = evaluationsDue(parseGoals(text).nodes, ctx.outbox, ctx.now)
  if (due.length === 0) return []
  const items = await ctx.items()
  return due.map(node => evaluateWords({
    to: ctx.partner.name, goal: node, attempts: goalAttempts(node, items), part: evaluationPartOf(node, goalAttempts(node, items)), approveRebuilds: ctx.approveRebuilds === true, job: ctx.job,
    maxChars: ctx.maxChars, again: node.evaluationAsked,
  }))
}

async function recheckDone(body, ctx) {
  if (ctx.canWrite !== true) return refuse(403, 'This board only shows: re-check the goal on the board that delivers.')
  if (!isId(body?.id)) return refuse(400, 'Name the goal by its id (G12).')
  const goalsAt = { file: ctx.goalsFile, historyDir: ctx.historyDir, now: ctx.now, fs: ctx.fs }
  let title = ''
  // B569: the goal's why and Done when, for its recap's Context and Change.
  let words = { why: null, doneWhen: null }
  let attempts = 0
  let withdraw = null
  const done = await changeGoalsFile(text => {
    const map = parseGoals(text)
    const now = map.byId.get(body.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    if (now.state === 'done') return { ok: false, why: 'ticked' }
    // The review: only a re-check that is asked (the person may have taken it back) is filed.
    if (!isRecheckOpen(now)) return { ok: false, why: 'notAsked' }
    title = now.title
    words = { why: now.why, doneWhen: now.doneWhen }
    attempts = now.rechecks.filter(one => one.verdict === 'failed').length + (body.verdict === 'failed' ? 1 : 0)
    const lined = addGoalLine(text, body.id, `Rechecked (${minuteOf(ctx.now)}, ${oneLine(body.by, 60).replace(/[(),]/g, ' ').trim()}): ${oneLine(body.line, 1100)}`)
    if (!lined.ok) return lined
    // Waiting for the person, the re-check stays asked: the partner files it again once they judged.
    if (body.verdict === 'waits for you') return lined
    const cleared = setGoalLine(lined.text, body.id, 'Recheck asked', '')
    if (!cleared.ok || body.verdict !== 'passed') return cleared
    // 2026-10-24: a ticked goal ends the guard's trip: its evaluation, and the board's ask before one (withdrawn).
    withdraw = askingOf(now)
    const state = setGoalState(cleared.text, body.id, 'done')
    const ticked = state.ok ? endTrip(state.text, body.id) : state
    return ticked.ok && map.focus === body.id ? setFocus(ticked.text, null) : ticked
  }, goalsAt)
  if (!done.ok && done.why === 'ticked') return refuse(409, `${body.id} is ticked already.`)
  if (!done.ok && done.why === 'notAsked') return refuse(409, `${body.id} has no re-check asked: the person took it back, or it was filed already.`)
  if (!done.ok) return failed(done.why)
  return { ok: true, result: withdrawn(withdraw, { id: body.id, title, ...words, ticked: body.verdict === 'passed', attempts }) }
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
 * change. Only the focus goal is drafted; B382: a goal with an agreed how may be drafted when it is not the focus
 * (its parts' steps, and the end of the goal guard's evaluation), since its steps run on after the focus moved.
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
  // B359: a line "Evaluation: <its outcome>" marks the draft as the goal guard's evaluation ending; it is not kept as a line.
  const decides = Array.isArray(body.partnerDecides) ? body.partnerDecides : body.partnerDecides ?? []
  const marked = Array.isArray(decides) ? decides.find(one => typeof one === 'string' && /^\s*Evaluation:/i.test(one)) : undefined
  const outcome = marked === undefined ? null : marked.replace(/^\s*Evaluation:\s*/i, '').replace(/\s+/g, ' ').trim() || 'ended'
  const how = { parts, partnerDecides: Array.isArray(decides) ? decides.filter(one => one !== marked) : decides, youDecide: body.youDecide ?? [] }
  if (!Array.isArray(how.parts) || !how.parts.every(part => part !== null && typeof part === 'object') || !isLines(how.partnerDecides) || !isLines(how.youDecide)) {
    return refuse(400, 'A how is its parts ({ title, size, steps }) and the lines of who decides what.')
  }
  if (node === undefined) return failed('gone')
  // B450: a goal whose evaluation runs may be drafted by its outcome, the focus or not, with a how agreed or not.
  const isEvaluating = outcome !== null && (node.evaluationAsked ?? null) !== null
  if (node.id !== focus && node.howAgreed === null && !isEvaluating) return notFocus()
  if (node.vibeAgreed === null && !isEvaluating) return refuse(409, 'The vibe is not agreed yet: draft the how once the person agreed it.')
  let changed = false
  let evaluated = false
  const done = await changeGoalsFile(text => {
    const map = parseGoals(text)
    const now = map.byId.get(node.id)
    if (now === undefined) return { ok: false, why: 'gone' }
    // B382: read again under the turn: a goal that is not the focus is drafted only while its how is agreed.
    const runs = outcome !== null && (now.evaluationAsked ?? null) !== null
    if (map.focus !== node.id && now.howAgreed === null && !runs) return { ok: false, why: 'notFocus' }
    const next = setHow(text, node.id, how)
    if (!next.ok) return next
    // B450: a goal without an agreed how ends its evaluation with the marked draft too; the draft waits for the person's Go.
    if (now.howAgreed === null) {
      if (!runs) return next
      evaluated = true
      const at = minuteOf(ctx.now)
      const cleared = endTrip(next.text, node.id)
      return cleared.ok ? addGoalLine(cleared.text, node.id, `Evaluated (${at}): a how drafted for your Go (${how.parts.length} ${how.parts.length === 1 ? 'part' : 'parts'}) · ${outcome}`) : cleared
    }
    // B359: while the goal guard's evaluation runs, the draft is its outcome: the how it names (corrected, rebuilt, or
    // the same one: keep going) is agreed at once, so the count of failed checks starts anew, and the evaluation ends.
    // Only a draft that says it is the outcome (a "partner decides" line "Evaluation: ...") ends it: a routine draft
    // (a re-check's follow-up steps added to a part) keeps the usual rule, and the evaluation runs on.
    if ((now.evaluationAsked ?? null) !== null && outcome !== null) {
      evaluated = true
      const isSame = agreedOf(parseGoals(next.text).byId.get(node.id)) === agreedOf(now)
      const at = minuteOf(ctx.now)
      const agreed = setGoalLine(next.text, node.id, 'How agreed', at)
      const cleared = agreed.ok ? endTrip(agreed.text, node.id) : agreed
      return cleared.ok ? addGoalLine(cleared.text, node.id, `Evaluated (${at}): ${isSame ? 'the how stays' : `a new how (${how.parts.length} ${how.parts.length === 1 ? 'part' : 'parts'})`} · ${outcome}`) : cleared
    }
    changed = agreedOf(parseGoals(next.text).byId.get(node.id)) !== agreedOf(now)
    return changed ? { ok: false, why: 'agreed' } : next
  }, goalsAt)
  if (changed) return refuse(409, 'The how is agreed: add the steps to its parts, change nothing else.')
  if (!done.ok && done.why === 'notFocus') return notFocus()
  return done.ok ? { ok: true, result: evaluated ? { evaluated: true } : {}, words: null } : failed(done.why)
}

/**
 * Focus 3 (spec 2026-10-18, sections 5 and 6; the review): the person's Undo of a line the partner decided for them
 * (`note` the daily note, `line` its words). `work(body)` runs the store's person-only `undo`, `type(undo)` types
 * `undo: <line>` to the partner and answers `{ ok, result }`. The store is asked first whether the line may be undone
 * (`check`); the word is typed; only then the line is marked "undo asked". A word that cannot be typed leaves the line
 * unmarked, so the person can try again; one Undo runs at a time, so a line is typed once (Review Focus 4).
 * Partner answers (2026-10-19): `note` may be an ask the partner answered (its card's Undo), and a line that lists such
 * an answer is taken back in the store instead; `tell(wake)` tells the asking chat to wait for the person.
 */
let undoTurn = Promise.resolve()
export function undoLine(body, ports) {
  const run = undoTurn.then(() => undoOnce(body, ports))
  undoTurn = run.catch(() => {})
  return run
}

async function undoOnce({ note, line }, { work, type, tell = async () => null }) {
  const checked = await work({ action: 'undo', id: note, line, check: true })
  if (!checked.ok) return checked
  if (checked.result.asked === true) return { ok: true, result: { id: checked.result.id, unchanged: true } }
  // Partner answers (2026-10-19): a partner's answer of an ask is taken back in the store (the ask opens again for the
  // person); nothing is typed to the partner, and the asking chat is told once to wait (`tell`).
  if (typeof checked.result.undo?.ask === 'string') {
    const taken = await work({ action: 'undo', id: note, line })
    if (!taken.ok) return taken
    if (taken.result.changed === false) return { ok: true, result: { id: checked.result.id, unchanged: true } }
    // B467: the answer is taken back by now; a chat not told is said on the console, never a reason to fail the Undo.
    if (taken.result.wake) await Promise.resolve().then(() => tell(taken.result.wake)).catch(error => console.error(`The asking chat could not be told of the Undo: ${error.message}`))
    return { ok: true, result: { id: taken.result.id, ask: checked.result.undo.ask } }
  }
  let typed = null
  try {
    typed = await type(checked.result.undo)
  } catch {
    typed = null
  }
  if (typed?.ok !== true) return typed?.ok === false ? typed : refuse(500, 'The word to your partner could not be kept: nothing is marked, try Undo again.')
  const marked = await work({ action: 'undo', id: note, line })
  if (!marked.ok) return marked
  return { ok: true, result: { ...typed.result, id: checked.result.id } }
}
