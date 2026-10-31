// B259: a brainstorm on the board (spec 2026-10-15, section 5). One thread file per brainstorm, in the project's
// folder the setting `brainstorms` names: the Advisor writes its questions and its proposal into it, the board writes
// the person's answers, the state and what was created. Read here into a thread, and written line by line: every line
// the change does not touch stays as it was. Only `editThread` (the page's POST /api/brainstorm) touches files.
import { access, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { nextGoalId, parseGoals } from './goals.mjs'
import { askTitleOf, titleProblem } from './work/askWords.mjs'
import { askFiledMs, valueOf } from './work/item.mjs'
import { addBrainstormNote, addGoal, addYourWords, changeGoalsFile, raiseLastLine, rewrite, setGoalChange, setGoalLine, withChangeRules } from './goalsWrite.mjs'

const files = { readFile, writeFile, rename, rm, mkdir, access, readdir, open }
const refuse = why => ({ ok: false, why })
export const THREAD_STATES = ['running', 'wrapping up', 'done', 'discarded']
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const HEAD_TITLE = /^# Brainstorm:\s*(.*)$/
const HEAD_GOAL = /^Goal:\s*(?:(G\d+)\s+(.*)|new)\s*$/
const HEAD_STARTED = /^Started:\s*(.+?)\s*·\s*State:\s*(running|wrapping up|done|discarded)\s*$/
// "Change this goal" (2026-10-31): the kind of a thread that changes its goal (`Kind: change`), the partner's
// "what I understand you want" and the person's yes or "not quite" under it.
const HEAD_KIND = /^Kind:\s*([a-z][a-z-]*)\s*$/
const QUESTION = /^## Q(\d+) \(([^)]+)\)\s*$/
const PROPOSAL = /^## Proposal \(([^)]+)\)\s*$/
const UNDERSTOOD = /^## Understood \(([^)]+)\)\s*$/
const NOT_QUITE = /^not quite — (.+)$/
const BULLET_ITEM = /^- (\d+)\. (.+)$/
const COVERED_ITEM = /^- (\d+):\s*(.*)$/
const DROP_ITEM = /^(B\d+)(?: — (.*))?$/
const FOR_PART = /^for (\d+(?:\s*,\s*\d+)*)$/
const OPTION = /^- ([A-Z]): (.*?)( \(advised\))?$/
const ANSWER = /^Answer \(([^)]+)\):\s*(.*)$/
const CREATED = /^Created \(([^)]+)\):\s*(.*)$/
/** 2026-10-31: the person's "Close it" on an old talk: done with no proposal, the board's line at its end. */
const CLOSED = /^Closed \(([^)]+)\):\s*(.*)$/
const GOAL_ITEM = /^- \[[ xX]\] (.+)$/
// The parts of a goal's or a step's line in a proposal, from its end: its title may hold the separator itself.
const PART = ' — '

/** The file's lines without their ends, the end it uses, and whether it ends with one. */
function split(text) {
  const body = String(text ?? '')
  const newline = body.includes('\r\n') ? '\r\n' : '\n'
  if (body === '') return { lines: [], newline, trailing: true }
  const lines = body.split(/\r?\n/)
  const trailing = lines.at(-1) === ''
  if (trailing) lines.pop()
  return { lines, newline, trailing }
}
const join = ({ lines, newline, trailing }) => lines.join(newline) + (trailing && lines.length > 0 ? newline : '')

/** An answer line's value: a key with the person's words, skipped, or back to an earlier question. */
function answerOf(at, value) {
  if (value === 'skipped') return { at, skipped: true }
  const back = value.match(/^back to Q(\d+)$/)
  if (back !== null) return { at, back: Number(back[1]) }
  const key = value.match(/^([A-Z]|Other)(?: — (.*))?$/)
  if (key !== null) return { at, key: key[1], words: (key[2] ?? '').trim() }
  // 2026-10-31: the old hand-written form, when a chat wrote the person's answer for them: `C, through Main: "<words>"`.
  const told = value.match(/^([A-Z]|Other),\s*through\s+[^:]{1,60}:\s*(.*)$/)
  return told === null ? null : { at, key: told[1], words: told[2].trim().replace(/^"([\s\S]*)"$/, '$1').trim() }
}

/** "under G6" → "G6" (words after the id, "under G6 (benches)", are the Advisor's own); "under top" → null. */
const underOf = part => {
  const found = part.trim().match(/^under (G\d+|top)\b/)
  return found === null ? undefined : found[1] === 'top' ? null : found[1]
}

/** "<title> — under G6 — Done when: <…>": the first part that starts "Done when:" ends the title, and may hold the separator itself. */
function goalItem(value) {
  const parts = value.split(PART)
  const at = parts.findIndex((part, index) => index >= 2 && /^Done when:/.test(part.trim()))
  if (at < 0) return null
  const under = underOf(parts[at - 1])
  if (under === undefined) return null
  return { title: parts.slice(0, at - 1).join(PART).trim(), under, doneWhen: parts.slice(at).join(PART).trim().replace(/^Done when:\s*/, '') }
}

/**
 * "<title> — <worker> — about <time>", and in a change's proposal " — for 3" (or "for 3, 5"): the bullets of the goal's
 * Done when the step is for, kept as `for` only when it has one.
 */
function stepItem(value) {
  const parts = value.split(PART)
  const bullets = parts.length >= 4 ? parts.at(-1).trim().match(FOR_PART) : null
  if (bullets !== null) parts.pop()
  if (parts.length < 3) return null
  const step = { title: parts.slice(0, -2).join(PART).trim(), worker: parts.at(-2).trim(), cost: parts.at(-1).trim() }
  return bullets === null ? step : { ...step, for: bullets[1].split(/\s*,\s*/).map(Number) }
}

/** "Change this goal": a bullet of the new Done when, "<text> — Picture: <path>" (the picture only where it is about looks). */
function bulletItem(n, value) {
  const parts = value.split(PART)
  const picture = parts.length >= 2 && /^Picture:/.test(parts.at(-1).trim()) ? parts.pop().trim().replace(/^Picture:\s*/, '') : null
  return { n: Number(n), text: parts.join(PART).trim(), picture: picture === '' ? null : picture }
}

/**
 * `Created (<at>): G10, G11; tasks B61, B62; left out: <titles, " · " between>`, and for a change "; dropped: B757, B758"
 * before "left out:" (the steps it dropped, kept as `dropped` only then). 2026-10-31: the board makes the tasks itself and
 * names them ("tasks B869, B870"); the old wording, "2 steps asked of the main chat" (or the ids alone), and "dropped" at
 * the end of the line are still read in old threads.
 */
function createdOf(at, line) {
  const drops = line.match(/; dropped: (B\d+(?:, B\d+)*)$/)
  const value = drops === null ? line : line.slice(0, drops.index)
  const [goals = '', steps = '', ...rest] = value.split('; ')
  let dropped = drops === null ? null : drops[1].split(', ')
  const before = dropped === null ? rest[0]?.match(/^dropped: (B\d+(?:, B\d+)*)$/) ?? null : null
  if (before !== null) {
    dropped = before[1].split(', ')
    rest.shift()
  }
  const left = rest.join('; ').replace(/^left out:\s*/, '').trim()
  const ids = steps.match(/\bB\d+\b/g) ?? []
  const asked = steps.match(/^(\d+) steps? asked/)
  return {
    at,
    goals: goals.match(/\bG\d+\b/g) ?? [],
    steps: ids,
    asked: ids.length > 0 ? ids.length : asked === null ? 0 : Number(asked[1]),
    leftOut: left === '' || left === 'nothing' ? [] : left.split(' · ').map(one => one.trim()).filter(Boolean),
    ...(dropped === null ? {} : { dropped }),
  }
}

/**
 * A title as the Created line keeps it among what was left out: one line, its own " · " (the separator there) as " - ".
 * Whether an item was left out is asked with this on both sides.
 */
export const leftOutKey = title => oneLine(title, 2000).replace(/ · /g, ' - ')

/**
 * A thread as the board shows it: its head (title, goal or null for a free one, when it started, its state, the
 * person's opening words, the Advisor's context lines), its questions in order (each with its text, why, options, the
 * advised one marked, its picture and the person's answer or null), the last proposal (a changed proposal stands under
 * a new heading) or null, and the lines the form does not know, each named once with its line ("line 9: ...").
 */
export function parseThread(text) {
  const thread = { title: null, goal: null, kind: null, started: null, state: 'running', opening: '', context: [], questions: [], understood: null, proposal: null, closed: null, problems: [], oddLines: [] }
  let section = 'head'
  let question = null
  let proposal = null
  let understood = null
  let list = null
  // The head's own lines count once: a "Goal:" in the Advisor's context under them is context.
  const seen = new Set()
  // 2026-10-31: an odd line is kept whole beside its short problem text: the board tells the partner which line to write anew.
  const odd = (index, line) => {
    thread.problems.push(`line ${index + 1}: ${line.slice(0, 80)}`)
    thread.oddLines.push({ line: index + 1, text: line.slice(0, 300) })
  }
  split(text).lines.forEach((raw, index) => {
    const line = raw.trim()
    const asQuestion = line.match(QUESTION)
    const asProposal = line.match(PROPOSAL)
    const asUnderstood = line.match(UNDERSTOOD)
    // 2026-10-31: the board's line under a talk the person closed ("Close it"), wherever it stands.
    const asClosed = line.match(CLOSED)
    if (asClosed !== null) {
      thread.closed = { at: asClosed[1], by: asClosed[2].trim() }
      return
    }
    // "Change this goal": the partner says back what it understood; the last one counts, and `after` is how many
    // questions stand before it (a question after it is the one asked now).
    if (asUnderstood !== null) {
      understood = { at: asUnderstood[1], text: '', answer: null, after: thread.questions.length }
      thread.understood = understood
      section = 'understood'
      return
    }
    if (asQuestion !== null) {
      question = { n: Number(asQuestion[1]), at: asQuestion[2], text: '', context: null, why: null, options: [], picture: null, answer: null, line: index + 1 }
      thread.questions.push(question)
      section = 'question'
      return
    }
    if (asProposal !== null) {
      proposal = { at: asProposal[1], decided: [], goals: [], steps: [], note: null, created: null, objective: null, doneWhen: [], notInIt: null, covered: [], drops: [] }
      thread.proposal = proposal
      section = 'proposal'
      list = null
      return
    }
    if (line === '') return
    if (section === 'head') {
      const title = line.match(HEAD_TITLE)
      const goal = line.match(HEAD_GOAL)
      const started = line.match(HEAD_STARTED)
      const once = name => !seen.has(name) && seen.add(name)
      if (title !== null && once('title')) thread.title = title[1].trim()
      else if (goal !== null && once('goal')) thread.goal = goal[1] === undefined ? null : { id: goal[1], title: goal[2].trim() }
      else if (started !== null && once('started')) [thread.started, thread.state] = [started[1], started[2]]
      else if (line.startsWith('Opening:') && once('opening')) thread.opening = line.slice('Opening:'.length).trim()
      else if (HEAD_KIND.test(line) && once('kind')) thread.kind = line.match(HEAD_KIND)[1]
      // What the Advisor writes under the opening: its short context head ("Context:" first), read as it is.
      else thread.context.push(line)
      return
    }
    if (section === 'question') {
      const option = line.match(OPTION)
      const answer = line.match(ANSWER)
      const isNamed = option !== null || answer !== null || line.startsWith('Why:') || line.startsWith('Picture:') || line.startsWith('Context:')
      const isFirst = question.context === null && question.why === null && question.options.length === 0 && question.picture === null && question.answer === null
      // Before anything named, a line is the question's (one or two lines), also one like "Lanterns: where?".
      if (!isNamed && isFirst) {
        question.text = question.text === '' ? line : `${question.text} ${line}`
      } else if (line.startsWith('Context:')) question.context = line.slice(8).trim()
      // B475: the context runs on over plain lines until anything named.
      else if (!isNamed && question.context !== null && question.why === null && question.options.length === 0 && question.picture === null && question.answer === null) {
        question.context = `${question.context} ${line}`
      } else if (line.startsWith('Why:')) question.why = line.slice(4).trim()
      else if (line.startsWith('Picture:')) question.picture = line.slice(8).trim()
      else if (option !== null) question.options.push({ key: option[1], text: option[2].trim(), isAdvised: option[3] !== undefined })
      else if (answer !== null && answerOf(answer[1], answer[2].trim()) !== null) question.answer = answerOf(answer[1], answer[2].trim())
      else odd(index, line)
      return
    }
    if (section === 'understood') {
      // One to three plain sentences, then the person's answer under it: yes, or not quite with their words.
      const answer = line.match(ANSWER)
      const value = answer === null ? null : answer[2].trim()
      if (answer !== null && value === 'yes') understood.answer = { at: answer[1], yes: true }
      else if (answer !== null && NOT_QUITE.test(value)) understood.answer = { at: answer[1], yes: false, words: value.match(NOT_QUITE)[1].trim() }
      else if (answer === null && understood.answer === null) understood.text = understood.text === '' ? line : `${understood.text} ${line}`
      else odd(index, line)
      return
    }
    // The proposal.
    const created = line.match(CREATED)
    if (line === 'Decided:') list = 'decided'
    else if (line === 'Goals:') list = 'goals'
    else if (line === 'Steps:') list = 'steps'
    // "Change this goal": the goal's draft (Objective, Done when, Not in it) and the re-plan (Covered, Drop).
    else if (line === 'Done when:') list = 'doneWhen'
    else if (line === 'Covered:') list = 'covered'
    else if (line === 'Drop:') list = 'drops'
    else if (line.startsWith('Objective:')) {
      proposal.objective = line.slice('Objective:'.length).trim()
      list = null
    } else if (line.startsWith('Not in it:')) {
      proposal.notInIt = line.slice('Not in it:'.length).trim()
      list = null
    } else if (line.startsWith('Note:')) {
      proposal.note = line.slice(5).trim()
      list = null
    } else if (created !== null) proposal.created = createdOf(created[1], created[2])
    else if (list === 'decided' && line.startsWith('- ')) proposal.decided.push(line.slice(2).trim())
    else if (list === 'doneWhen' && BULLET_ITEM.test(line)) proposal.doneWhen.push(bulletItem(...line.match(BULLET_ITEM).slice(1)))
    else if (list === 'covered' && COVERED_ITEM.test(line)) {
      const [, n, ids] = line.match(COVERED_ITEM)
      proposal.covered.push({ n: Number(n), steps: ids.match(/\bB\d+\b/g) ?? [] })
    } else if (list === 'drops' && GOAL_ITEM.test(line) && DROP_ITEM.test(line.match(GOAL_ITEM)[1].trim())) {
      const [, id, why = ''] = line.match(GOAL_ITEM)[1].trim().match(DROP_ITEM)
      proposal.drops.push({ id, why: why.trim() })
    }
    else if ((list === 'goals' || list === 'steps') && GOAL_ITEM.test(line)) {
      const item = (list === 'goals' ? goalItem : stepItem)(line.match(GOAL_ITEM)[1])
      if (item === null) odd(index, line)
      else proposal[list].push(item)
    } else odd(index, line)
  })
  // B475: each question as its title and its context, as an ask shows them (B452).
  // A question from before it, with no "Context:" line, gives its first question (or sentence) as the title.
  thread.questions = thread.questions.map(({ line, ...question }) => {
    // `line` is the question's heading (1-based): its title is the next line.
    const named = problem => { thread.problems.push(`line ${line + 1}: Q${question.n}${problem}`); return problem }
    if (question.context === null) {
      const { title, context } = askTitleOf([question.text])
      // B491: a question from before it is checked too: the title its first question (or sentence) gives may be long
      const why = question.text === '' ? null : titleProblem(title)
      return { ...question, title, context: context.join(' '), problem: why === null ? null : named(`'s title is too long. ${why.replace('in "text"', 'in its "Context:" line')}`) }
    }
    const why = titleProblem(question.text)
    if (question.text === '') return { ...question, title: question.text, problem: named(' has no title: its first line is the question itself, then "Context:".') }
    return { ...question, title: question.text, problem: why === null ? null : named(`'s title is too long. ${why.replace('in "text"', 'in its "Context:" line')}`) }
  })
  return thread
}

/** The lines of each section: its heading's index and where it ends (the next heading, or the end). */
function sections(lines) {
  const heads = lines.flatMap((line, index) => (/^## /.test(line.trim()) ? [index] : []))
  return heads.map((start, place) => ({ start, end: heads[place + 1] ?? lines.length, line: lines[start].trim() }))
}

/** Where a section's last line that is not blank stands. */
function lastFilled(lines, section) {
  let at = section.end - 1
  while (at > section.start && lines[at].trim() === '') at -= 1
  return at
}

/**
 * The person's answer under question `n`: `{ at, key, words }` (a key of its options, or "Other" with words of their
 * own), `{ at, skipped: true }` or `{ at, back: m }` (an earlier question, to be asked again). Only under the last
 * question, while it has no answer and no proposal stands: refused `answered` when it has one, `none` otherwise, and
 * `form` for a key it has not or words that are empty. A blank line follows it, for the Advisor's next question.
 */
export function answerQuestion(text, n, answer) {
  const thread = parseThread(text)
  // A question asked again under its number: the last of that number is the one asked now.
  const question = thread.questions.findLast(one => one.n === n)
  if (question === undefined) return refuse('none')
  if (question.answer !== null) return refuse('answered')
  if (question !== thread.questions.at(-1) || thread.proposal !== null) return refuse('none')
  let value
  if (answer?.skipped === true) value = 'skipped'
  else if (Number.isInteger(answer?.back)) {
    if (answer.back < 1 || answer.back >= n || !thread.questions.some(one => one.n === answer.back)) return refuse('form')
    value = `back to Q${answer.back}`
  } else {
    const words = oneLine(answer?.words, 1000)
    const isKey = answer?.key === 'Other' ? words !== '' : question.options.some(option => option.key === answer?.key)
    if (!isKey) return refuse('form')
    value = words === '' ? answer.key : `${answer.key} — ${words}`
  }
  const file = split(text)
  const section = sections(file.lines).findLast(one => QUESTION.test(one.line) && Number(one.line.match(QUESTION)[1]) === n)
  const at = lastFilled(file.lines, section) + 1
  file.lines.splice(at, 0, `Answer (${oneLine(answer.at, 40)}): ${value}`)
  if (at + 1 >= file.lines.length || file.lines[at + 1].trim() !== '') file.lines.splice(at + 1, 0, '')
  return { ok: true, text: join(file) }
}

/**
 * "Change this goal": whether the partner's "what I understand you want" is the open one: there is one, no question
 * stands after it and no proposal yet.
 */
export const isUnderstoodOpen = thread => (thread?.understood ?? null) !== null && thread.understood.after === (Array.isArray(thread.questions) ? thread.questions.length : thread.questions) && (thread.proposal ?? null) === null

/**
 * "Change this goal": the person's answer to the partner's "what I understand you want", under its last `## Understood`
 * section: `Answer (<at>): yes`, or `Answer (<at>): not quite — <their words>` (`answer`: `{ at, yes: true }` or
 * `{ at, words }`). Only while it is the open one (isUnderstoodOpen) and has no answer: refused `answered` when it has
 * one, `none` without one open, `form` for empty words. A blank line follows it, for the partner's next part.
 */
export function answerUnderstood(text, answer) {
  const thread = parseThread(text)
  if (thread.understood === null) return refuse('none')
  if (thread.understood.answer !== null) return refuse('answered')
  if (!isUnderstoodOpen(thread)) return refuse('none')
  const words = oneLine(answer?.words, 1000)
  if (answer?.yes !== true && words === '') return refuse('form')
  const file = split(text)
  const section = sections(file.lines).findLast(one => UNDERSTOOD.test(one.line))
  const at = lastFilled(file.lines, section) + 1
  file.lines.splice(at, 0, `Answer (${oneLine(answer.at, 40)}): ${answer?.yes === true ? 'yes' : `not quite — ${words}`}`)
  if (at + 1 >= file.lines.length || file.lines[at + 1].trim() !== '') file.lines.splice(at + 1, 0, '')
  return { ok: true, text: join(file) }
}

/** The state in the head's "Started: … · State: …" line: running, wrapping up, done or discarded. */
export function setThreadState(text, state) {
  if (!THREAD_STATES.includes(state)) return refuse('form')
  const file = split(text)
  const at = file.lines.findIndex(line => HEAD_STARTED.test(line.trim()))
  if (at < 0) return refuse('form')
  file.lines[at] = file.lines[at].replace(/State:\s*(running|wrapping up|done|discarded)\s*$/, `State: ${state}`)
  return { ok: true, text: join(file) }
}

/**
 * What came of the last proposal, under it: `Created (<at>): <goals>; tasks <ids>; left out: <titles>`. 2026-10-31: the board
 * makes the tasks itself, so the line names the ids it made ("tasks B869, B870"), "no tasks" when it made none; only a
 * board that made none (`asked`: how many the main chat was asked for) says "2 steps asked of the main chat", as before.
 * Refused `none` without a proposal, `twice` when one was created already (Review Focus 5). "Change this goal": the steps
 * it dropped stand before "left out:", "; dropped: B757" (only when it dropped any).
 */
export function markCreated(text, { at, goals = [], steps = [], asked = 0, leftOut = [], dropped = [] }) {
  const thread = parseThread(text)
  if (thread.proposal === null) return refuse('none')
  if (thread.proposal.created !== null) return refuse('twice')
  const goalPart = goals.length > 0 ? goals.join(', ') : 'no goals'
  const stepPart = steps.length > 0 ? `tasks ${steps.join(', ')}` : asked > 0 ? `${asked} step${asked === 1 ? '' : 's'} asked of the main chat` : 'no tasks'
  const left = leftOut.length > 0 ? leftOut.map(leftOutKey).join(' · ') : 'nothing'
  const file = split(text)
  const last = sections(file.lines).filter(one => PROPOSAL.test(one.line)).at(-1)
  const drops = dropped.filter(one => /^B\d+$/.test(one))
  file.lines.splice(lastFilled(file.lines, last) + 1, 0, `Created (${oneLine(at, 40)}): ${goalPart}; ${stepPart}; ${drops.length === 0 ? '' : `dropped: ${drops.join(', ')}; `}left out: ${left}`)
  return { ok: true, text: join(file) }
}

/** The head of a new thread, as the Advisor reads it; a free brainstorm is about "new". */
export function newThread({ title, goal, started, opening, kind = null }) {
  const about = goal === null || goal === undefined ? 'new' : `${goal.id} ${oneLine(goal.title, 160)}`
  // "Change this goal" (2026-10-31): `Kind: change` under its goal.
  return `# Brainstorm: ${oneLine(title, 120)}\nGoal: ${about}\n${kind === null ? '' : `Kind: ${kind}\n`}Started: ${started} · State: running\nOpening: ${oneLine(opening, 2000)}\n\n`
}

/** "2026-10-15-the-reference-look-on-every-map": the day, then the title's words in small letters, at most 40 characters. */
export function threadSlug(title, date) {
  let words = String(title ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (words.length > 40) words = words.slice(0, 40).replace(/-[^-]*$/, '') || words.slice(0, 40)
  return `${date}-${words === '' ? 'brainstorm' : words}`
}

/**
 * The threads as the state gives them to the page, in the order read (newest first): what each stands at (its head,
 * how many questions, the last one and the ones before it, its last proposal), its length (a Create names the length
 * it read, so a thread that changed since is not created) and the lines the form does not know.
 */
export function brainstormsState(texts, folder) {
  return {
    folder,
    threads: (texts ?? []).map(({ path, text, at }) => {
      const thread = parseThread(text)
      return {
        path,
        at: at ?? null,
        length: String(text ?? '').length,
        title: thread.title ?? path.split('/').pop(),
        goal: thread.goal,
        // "Change this goal": the kind ('change', or null for a brainstorm as before) and the partner's "what I understand
        // you want" (`isOpen`: the one the person answers now).
        kind: thread.kind,
        understood: thread.understood === null ? null : { ...thread.understood, isOpen: isUnderstoodOpen(thread) },
        started: thread.started,
        state: thread.state,
        opening: thread.opening,
        questions: thread.questions.length,
        latest: thread.questions.at(-1) ?? null,
        latestMs: questionTimes(thread.started, thread.questions).at(-1) ?? Number.NaN,
        earlier: thread.questions.slice(0, -1),
        proposal: thread.proposal,
        // 2026-10-31: the person closed it ("Close it": `{ at, by }`), or null.
        closed: thread.closed,
        problems: thread.problems,
        // 2026-10-31: the lines of the thread the board cannot read, whole, for the partner's fix word.
        oddLines: thread.oddLines,
      }
    }),
  }
}

/**
 * 2026-10-31 (the person: "per topic also reevaluate when the last interaction was because i feel a lot of older topics might
 * still be open otherwise"): the person's "Close it" on a talk that still runs: done with no proposal, and the board's line
 * `Closed (<at>): by the person` at its end. Refused `ended` for one that is over.
 * 2026-10-31: `by` is the board's own words when it closes one, "by the board, replaced by the change of G60".
 */
export function closeThread(text, at, by = 'by the person') {
  const thread = parseThread(text)
  if (thread.state === 'done' || thread.state === 'discarded') return refuse('ended')
  const state = setThreadState(text, 'done')
  if (!state.ok) return state
  const file = split(state.text)
  let end = file.lines.length
  while (end > 0 && file.lines[end - 1].trim() === '') end -= 1
  file.lines.splice(end, 0, '', `Closed (${oneLine(at, 40)}): ${oneLine(by, 200)}`)
  return { ok: true, text: join(file) }
}

/**
 * What a brainstorm waits for from the person, for Needs your attention: a proposal to tick and create, or else the
 * Advisor's question with no answer yet. A brainstorm that is done or discarded waits for nothing.
 */
export function brainstormNeeds(threads) {
  return (threads ?? []).filter(thread => thread.state === 'running' || thread.state === 'wrapping up').flatMap(thread => {
    if (thread.proposal !== null) return thread.proposal.created === null ? [{ kind: 'brainstorm', what: 'proposal', path: thread.path, title: thread.title, text: 'Its proposal waits for you to tick and create it.' }] : []
    // "Change this goal": the partner says back what it understood: it waits for the person's yes or "not quite".
    if (thread.understood?.isOpen === true && thread.understood.answer === null) return [{ kind: 'brainstorm', what: 'understood', path: thread.path, title: thread.title, text: `Your partner says what it understood: ${thread.understood.text}` }]
    // While it wraps up, the Advisor writes the proposal: the question left open waits for nobody.
    if (thread.state === 'running' && thread.latest !== null && thread.latest.answer === null) return [{ kind: 'brainstorm', what: 'question', path: thread.path, title: thread.title, text: thread.latest.title ?? thread.latest.text }]
    return []
  })
}

const pad = value => String(value).padStart(2, '0')
const dayOf = ms => `${new Date(ms).getFullYear()}-${pad(new Date(ms).getMonth() + 1)}-${pad(new Date(ms).getDate())}`
const timeOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

const WHY = {
  form: [400, 'Not a change the board knows.'],
  words: [400, 'Give the brainstorm a title and your opening words.'],
  path: [400, 'That is no brainstorm of this board.'],
  gone: [404, 'That brainstorm is not there any more.'],
  none: [409, 'That question is not the open one any more.'],
  answered: [409, 'That question has its answer already.'],
  ended: [409, 'That brainstorm is over: done or discarded.'],
  running: [409, 'A brainstorm on this goal runs already: answer it there.'],
  // "Change this goal" (2026-10-31).
  changing: [409, 'A change of this goal runs already: answer it there.'],
  understood: [409, 'Say yes to what your partner understood first: nothing about the goal changes before that.'],
  draft: [409, 'The proposal has no goal draft yet (an Objective and its Done when bullets): ask your partner with Change….'],
  goal: [409, 'That goal is not in the map.'],
  changed: [409, 'The brainstorm changed since you read it: look at it again.'],
  proposal: [409, 'That brainstorm has no proposal yet.'],
  twice: [409, 'That proposal was created already.'],
  pick: [409, 'Tick only what the proposal holds.'],
  map: [409, 'There is no goal map to write the goals into.'],
  encoding: [409, 'A file is not UTF-8 text: change it by hand first.'],
  tabs: [409, 'The goal map has lines indented with tabs: make them two spaces per level by hand first.'],
  write: [500, 'The brainstorm could not be written.'],
}
const failed = key => ({ ok: false, status: (WHY[key] ?? WHY.write)[0], why: (WHY[key] ?? WHY.write)[1] })

const readUtf8 = (fs, file) => fs.readFile(file).then(bytes => bytes.toString('utf8'), () => null)

/** A change on the thread's UTF-8 text, written as `rewrite` writes: read anew right before, beside, then in place. */
const rewriteThread = (file, change, fs) => rewrite(file, latin => {
  const text = Buffer.from(latin, 'latin1').toString('utf8')
  if (Buffer.from(text, 'utf8').toString('latin1') !== latin) return refuse('encoding')
  const done = change(text)
  return done.ok ? { ok: true, text: Buffer.from(done.text, 'utf8').toString('latin1') } : done
}, fs)

/** The file name a page's path names, inside the brainstorms' folder only; null for anything else. */
function nameOf(path, folder) {
  if (typeof path !== 'string' || !path.startsWith(`${folder}/`)) return null
  const name = path.slice(folder.length + 1)
  return /^[a-z0-9][a-z0-9-]*\.md$/.test(name) ? name : null
}

/** A Create under way, by its file: a second one at the same time is refused (Review Focus 5). */
const creating = new Set()
/** A start under way, by its goal: a second one at the same time is refused, as one after it would be. */
const starting = new Set()

/** "Change this goal": whether a thread is a change of its goal. */
export const isChange = thread => thread?.kind === 'change'
/** A thread that is not over: running, or wrapping up. */
const isLive = thread => thread.state === 'running' || thread.state === 'wrapping up'

/**
 * One change to a brainstorm from the page (POST /api/brainstorm), on the board that delivers only (`canWrite`):
 * `start { title, goal, opening }` makes the thread (`<folder>/<date>-<title>.md`; a second running one on the same
 * goal is refused) and links it under its goal; `answer { path, n, key, words }`, `skip { path, n }`,
 * `back { path, n, to }` write the person's answer under the open question; `wrap { path }` marks it "wrapping up",
 * `discard { path }` "discarded"; `create { path, goals, steps, seen }` writes the ticked goals (indexes into the
 * proposal) and the note into the goal map, marks the thread created and done, and answers the goals made and the
 * ticked steps, which the page then asks of the main chat. `seen` is the thread's length as the page read it: a thread
 * that changed since is not created. `dir` is the folder on disk, `folder` the setting as the paths name it.
 * "Change this goal" (2026-10-31): `start { kind: 'change', goal, title, opening }` makes a change thread (`Kind:
 * change`; one change at a time on a goal, beside the goal's other talk) and keeps the opening as a point of the goal's
 * `Your words`; `understood { path, yes: true }` or `understood { path, words }` writes the person's answer to the
 * partner's "what I understand you want"; `create` of a change writes the goal's draft (Objective, Done when <n> with the
 * steps that cover each, Not in it) under its goal, only after that yes, and drops the ticked drops (`drops`, indexes
 * into the proposal's Drop list) through `drop(id, why)`, the work store's drop as the person.
 * 2026-10-31: `step({ thread, index, goal })` makes a ticked task of the proposal (the board writes it itself, as the person)
 * and answers `{ ok: true, result: { id } }`: `create` makes the ticked ones before it marks the thread created, so the
 * Created line names their ids; a change also closes the goal's other running talk (not a change): done, with the board's
 * Closed line, and its goal line reads (done). Without `step` no task is made here (the page asks for them, as before).
 */
export async function editThread(body, { canWrite, dir, folder, goalsFile, historyDir, now, fs = files, drop = null, step = null }) {
  if (canWrite !== true) return { ok: false, status: 403, why: 'This board only shows: brainstorm on the board that delivers.' }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return failed('form')
  const base = String(dir).replace(/[\\/]+$/, '')
  const goalsAt = { file: goalsFile, historyDir, now, fs }
  if (body.command === 'start') return startThread(body, { base, folder, goalsAt, now, fs })
  if (!['answer', 'skip', 'back', 'wrap', 'discard', 'close', 'create', 'understood'].includes(body.command)) return failed('form')
  const name = nameOf(body.path, folder)
  if (name === null) return failed('path')
  const file = `${base}/${name}`
  if (body.command === 'create') {
    if (creating.has(file)) return failed('twice')
    creating.add(file)
    try {
      return await createFrom(body, { file, base, folder, goalsAt, now, fs, drop, step })
    } finally {
      creating.delete(file)
    }
  }
  const before = await readUtf8(fs, file)
  if (before === null) return failed('gone')
  const thread = parseThread(before)
  if (thread.state === 'done' || thread.state === 'discarded') return failed('ended')
  let done
  if (body.command === 'wrap') done = await rewriteThread(file, text => setThreadState(text, 'wrapping up'), fs)
  else if (body.command === 'discard') {
    done = await rewriteThread(file, text => setThreadState(text, 'discarded'), fs)
    if (done.ok && thread.goal !== null && !isChange(thread)) await linkUnder(thread.goal.id, body.path, 'discarded', goalsAt)
  } else if (body.command === 'close') {
    // 2026-10-31: the person's "Close it" on an old talk: done, no proposal, the board's Closed line.
    done = await rewriteThread(file, text => closeThread(text, timeOf(now)), fs)
    if (done.ok && thread.goal !== null && !isChange(thread)) await linkUnder(thread.goal.id, body.path, 'done', goalsAt)
  } else if (body.command === 'understood') {
    if (body.yes !== true && typeof body.words !== 'string') return failed('form')
    const answer = body.yes === true ? { at: timeOf(now), yes: true } : { at: timeOf(now), words: body.words }
    done = await rewriteThread(file, text => answerUnderstood(text, answer), fs)
  } else {
    if (!Number.isInteger(body.n)) return failed('form')
    const at = timeOf(now)
    const answer = body.command === 'skip' ? { at, skipped: true } : body.command === 'back' ? { at, back: body.to } : { at, key: body.key, words: body.words ?? '' }
    done = await rewriteThread(file, text => answerQuestion(text, body.n, answer), fs)
  }
  return done.ok ? { ok: true, result: {} } : failed(done.why)
}

/**
 * `Brainstorm: <path> (<state>)` under the goal, unless the line there names another brainstorm that still runs; a map
 * that cannot take it is left as it is.
 */
async function linkUnder(goal, path, state, goalsAt) {
  await changeGoalsFile(text => {
    const node = parseGoals(text).byId.get(goal)
    if (node === undefined || (node.brainstorm !== null && node.brainstorm.path !== path && node.brainstorm.state === 'running')) return { ok: true, text }
    return setGoalLine(text, goal, 'Brainstorm', `${path} (${state})`)
  }, goalsAt).catch(() => null)
}

async function startThread(body, { base, folder, goalsAt, now, fs }) {
  const title = oneLine(body.title, 120)
  const opening = oneLine(body.opening, 2000)
  if (title === '' || opening === '') return failed('words')
  const goalId = body.goal ?? null
  if (goalId !== null && !(typeof goalId === 'string' && /^G\d+$/.test(goalId))) return failed('form')
  // "Change this goal": a change is always of a goal.
  const kind = body.kind === 'change' ? 'change' : null
  if (body.kind !== undefined && body.kind !== null && kind === null) return failed('form')
  if (kind !== null && goalId === null) return failed('form')
  const key = `${goalId}:${kind}`
  if (goalId !== null && starting.has(key)) return failed(kind === null ? 'running' : 'changing')
  if (goalId !== null) starting.add(key)
  try {
    return await makeThread({ title, opening, goalId, kind, base, folder, goalsAt, now, fs })
  } finally {
    starting.delete(key)
  }
}

async function makeThread({ title, opening, goalId, kind = null, base, folder, goalsAt, now, fs }) {
  const names = (await fs.readdir(base).catch(() => [])).filter(name => /\.md$/.test(name))
  let goal = null
  if (goalId !== null) {
    const node = parseGoals((await readUtf8(fs, goalsAt.file)) ?? '').byId.get(goalId)
    if (node === undefined) return failed('goal')
    goal = { id: node.id, title: node.title }
    // One brainstorm at a time on a goal: a running one is answered where it is. "Change this goal": a change runs
    // beside the goal's other talk (the focus's), one change at a time.
    for (const name of names) {
      const other = parseThread((await readUtf8(fs, `${base}/${name}`)) ?? '')
      if (other.goal?.id === goalId && isLive(other) && isChange(other) === (kind === 'change')) return failed(kind === 'change' ? 'changing' : 'running')
    }
  }
  await fs.mkdir(base, { recursive: true }).catch(() => {})
  const slug = threadSlug(title, dayOf(now))
  const text = Buffer.from(newThread({ title, goal, started: `${dayOf(now)} ${timeOf(now)}`, opening, kind }), 'utf8')
  for (let count = 1; count <= 99; count += 1) {
    const name = `${slug}${count === 1 ? '' : `-${count}`}.md`
    try {
      await fs.writeFile(`${base}/${name}`, text, { flag: 'wx' })
    } catch (error) {
      if (error?.code === 'EEXIST') continue
      return failed('write')
    }
    const path = `${folder}/${name}`
    // "Change this goal": a change is found by its kind and goal; the goal's Brainstorm line stays the goal's talk. The
    // person's words are kept on the goal, a point of its "Your words", and the map's rules name the line.
    if (goal !== null && kind === null) await linkUnder(goal.id, path, 'running', goalsAt)
    if (kind === 'change') {
      await changeGoalsFile(map => {
        const kept = addYourWords(map, goal.id, `${dayOf(now)} ${timeOf(now)}`, opening)
        return kept.ok ? { ok: true, text: withChangeRules(kept.text) } : kept
      }, goalsAt).catch(() => null)
    }
    return { ok: true, result: { path } }
  }
  return failed('write')
}

async function createFrom(body, { file, base = null, folder = null, goalsAt, now, fs, drop = null, step = null }) {
  const before = await readUtf8(fs, file)
  if (before === null) return failed('gone')
  if (Number.isInteger(body.seen) && body.seen !== before.length) return failed('changed')
  const thread = parseThread(before)
  if (thread.state === 'done' || thread.state === 'discarded') return failed(thread.proposal?.created ? 'twice' : 'ended')
  const proposal = thread.proposal
  if (proposal === null) return failed('proposal')
  if (proposal.created !== null) return failed('twice')
  // "Change this goal": nothing about the goal changes before the person's yes to what the partner understood, and a
  // change's proposal holds the goal's draft.
  const isChanging = isChange(thread)
  if (isChanging && thread.understood?.answer?.yes !== true) return failed('understood')
  if (isChanging && (thread.goal === null || !proposal.objective || proposal.doneWhen.length === 0)) return failed('draft')
  const pick = (list, indexes) => (Array.isArray(indexes) && indexes.every(at => Number.isInteger(at) && at >= 0 && at < list.length) ? list.filter((one, at) => indexes.includes(at)) : null)
  const goals = pick(proposal.goals, body.goals ?? [])
  const steps = pick(proposal.steps, body.steps ?? [])
  const drops = isChanging ? pick(proposal.drops, body.drops ?? []) : []
  if (goals === null || steps === null || drops === null) return failed('pick')
  const leftOut = [...proposal.goals.filter(one => !goals.includes(one)), ...proposal.steps.filter(one => !steps.includes(one))].map(one => one.title)
  // The goals, the note and the link to the thread, in one change of the map; read anew on each try.
  let made = []
  let home = null
  if (goals.length > 0 || thread.goal !== null) {
    const written = await changeGoalsFile(text => {
      made = []
      let out = text
      const about = thread.goal !== null && parseGoals(text).byId.has(thread.goal.id) ? thread.goal.id : null
      for (const goal of goals) {
        const map = parseGoals(out)
        const id = nextGoalId(map)
        const parent = goal.under === null ? null : map.byId.has(goal.under) ? goal.under : about
        const added = addGoal(out, { parent, title: goal.title, id })
        if (!added.ok) return added
        out = raiseLastLine(added.text, id)
        if (goal.doneWhen !== '') out = setGoalLine(out, id, 'Done when', oneLine(goal.doneWhen, 300)).text
        made.push({ id, title: oneLine(goal.title, 120) })
      }
      home = about ?? made[0]?.id ?? null
      if (home !== null && proposal.note) {
        const noted = addBrainstormNote(out, home, dayOf(now), proposal.note)
        if (noted.ok) out = noted.text
      }
      // "Change this goal": the goal's new Objective, its Done when bullets with the steps that cover each, and what is
      // not in it, under the goal; its old one-line Done when stays.
      if (isChanging) {
        if (about === null) return { ok: false, why: 'goal' }
        const covered = n => proposal.covered.filter(one => one.n === n).flatMap(one => one.steps)
        const changed = setGoalChange(out, about, { objective: proposal.objective, bullets: proposal.doneWhen.map(one => ({ n: one.n, text: one.text, steps: covered(one.n) })), notInIt: proposal.notInIt })
        if (!changed.ok) return changed
        out = withChangeRules(changed.text)
      }
      // A change runs beside the goal's own talk: the goal's Brainstorm line stays the talk's.
      if (home !== null && !isChanging) out = setGoalLine(out, home, 'Brainstorm', `${body.path} (done)`).text
      return { ok: true, text: out }
    }, goalsAt)
    // No map, and nothing for it: the thread alone is marked.
    if (!written.ok && !(written.why === 'gone' && goals.length === 0 && !isChanging)) return failed(written.why === 'gone' ? 'map' : written.why)
  }
  // "Change this goal": the ticked drops, each dropped in the work store as the person, with its why.
  const dropped = []
  const notDropped = []
  for (const one of drops) {
    const why = one.why || `no longer needed for ${thread.goal.id} after its change`
    const done = drop === null ? { ok: false, why: 'This board cannot drop a step.' } : await Promise.resolve().then(() => drop(one.id, why)).catch(error => ({ ok: false, why: error.message }))
    if (done?.ok === true) dropped.push(one.id)
    else notDropped.push({ id: one.id, why: done?.why ?? 'not dropped' })
  }
  // 2026-10-31: the ticked tasks, made by the board itself (the `step` it was given), one after the other in the proposal's
  // order and before the Created line, so the line names their ids. One it could not make has no id and is left to the page
  // (it asks again, and offers "Make the tasks again" when that fails too).
  const goalOfSteps = made[0]?.id ?? thread.goal?.id ?? null
  const taskIds = new Map()
  if (step !== null) {
    for (const one of steps) {
      const index = proposal.steps.indexOf(one)
      const done = await Promise.resolve().then(() => step({ thread: { ...thread, path: body.path }, index, goal: goalOfSteps })).catch(error => ({ ok: false, why: error.message }))
      if (done?.ok === true && /^B\d+$/.test(String(done.result?.id ?? ''))) taskIds.set(one, done.result.id)
    }
  }
  const marked = await rewriteThread(file, text => {
    const created = markCreated(text, { at: timeOf(now), goals: made.map(one => one.id), steps: [...taskIds.values()], asked: step === null ? steps.length : 0, leftOut, dropped })
    return created.ok ? setThreadState(created.text, 'done') : created
  }, fs)
  if (!marked.ok) return failed(marked.why)
  // 2026-10-31: a change replaces the goal's other running talk: it is closed, by the board, as the person's "Close it" does.
  const replaced = isChanging && base !== null && folder !== null ? await closeReplacedTalks({ thread, file, base, folder, goalsAt, now, fs }) : []
  const serves = made[0]?.id ?? home
  const result = {
    goals: made,
    steps: steps.map(one => ({ title: one.title, worker: one.worker, cost: one.cost, goal: serves, ...(one.for === undefined ? {} : { for: one.for }), ...(taskIds.has(one) ? { id: taskIds.get(one), index: proposal.steps.indexOf(one) } : {}) })),
  }
  return { ok: true, result: isChanging ? { ...result, dropped, notDropped, replaced } : result }
}

/**
 * 2026-10-31: a change of a goal replaces its other running talk (not a change; running, or wrapping up): each is closed as done,
 * `Closed (<at>): by the board, replaced by the change of G<n>` under it, and its goal line reads (done). The paths closed
 * (a talk that cannot be closed now is left as it is).
 */
async function closeReplacedTalks({ thread, file, base, folder, goalsAt, now, fs }) {
  const goal = thread.goal?.id ?? null
  if (goal === null) return []
  const closed = []
  const names = (await fs.readdir(base).catch(() => [])).filter(name => /\.md$/.test(name))
  for (const name of names) {
    const other = `${base}/${name}`
    if (other === file) continue
    const read = parseThread((await readUtf8(fs, other)) ?? '')
    if (read.goal?.id !== goal || !isLive(read) || isChange(read)) continue
    const done = await rewriteThread(other, text => closeThread(text, timeOf(now), `by the board, replaced by the change of ${goal}`), fs).catch(() => ({ ok: false }))
    if (!done.ok) continue
    // The goal's line reads (done) when it names this talk, or none; a line that names another talk is left alone.
    await changeGoalsFile(text => {
      const node = parseGoals(text).byId.get(goal)
      if (node === undefined || (node.brainstorm !== null && node.brainstorm.path !== `${folder}/${name}`)) return { ok: true, text }
      return setGoalLine(text, goal, 'Brainstorm', `${folder}/${name} (done)`)
    }, goalsAt).catch(() => null)
    closed.push(`${folder}/${name}`)
  }
  return closed
}

/**
 * B491: the questions the Advisor must write again: the open question of a running talk whose title is too long or
 * missing, as the work tool refuses such an ask's title (B452). `{ path, n, title, problem }`, each once per thread; an
 * answered or earlier question, or a talk that is over, asks for nothing. The board types each to the Advisor at once.
 */
export function titleFixes(threads) {
  return (threads ?? []).filter(isTold).flatMap(thread => {
    const latest = thread.latest
    if (latest === null || latest.answer !== null || (latest.problem ?? null) === null) return []
    return [{ path: thread.path, n: latest.n, title: latest.title ?? latest.text, problem: latest.problem }]
  })
}

/**
 * 2026-10-31: a thread the board sends fix words about, and the page counts "lines for your partner to fix" of: it runs (or
 * wraps up), its proposal is not created and the person did not close it. A done, created, closed or discarded thread asks
 * for nothing.
 */
export const isTold = thread => (thread.state === 'running' || thread.state === 'wrapping up') && (thread.proposal?.created ?? null) === null && (thread.closed ?? null) === null

/**
 * 2026-10-31 (the person: "the thread has a line the board cannot read ... this isnt clear to me"): the lines of a talk that
 * runs which the form does not know, each once per talk (the same line twice is one). `{ path, line, odd }`: the line's number
 * and its words. The board tells the partner to write each anew; the person is never shown one.
 */
export function lineFixes(threads) {
  return (threads ?? []).filter(isTold).flatMap(thread => {
    const seen = new Set()
    return (thread.oddLines ?? []).filter(one => !seen.has(one.text) && seen.add(one.text)).map(one => ({ path: thread.path, line: one.line, odd: one.text }))
  })
}

/** The line of a fix word that names a line of the thread: `A line of the thread is not in the form: <the line>`. */
const LINE_FIX = /^A line of the thread is not in the form: /

/**
 * B491: the board's word to the partner that its open brainstorm question has a title the board refuses (over 12 words,
 * or none; B452 refuses the same of an ask): rewrite it in the thread at once, as the form says. Typed on the board's own
 * clock, not as the person's word.
 */
export function brainstormFixWords({ to, path, n, title, problem, line, odd, role = null }) {
  const plain = value => String(value ?? '').replace(/\s+/g, ' ').trim()
  const shown = plain(title).slice(0, 200)
  // The problem begins with the thread's own words ("'s title is too long. ..." or "has no title: ..."): keep the reason only.
  const reason = plain(problem).replace(/^'s title is /, '').replace(/^has no title/, 'it has no title')
  // The Product owner (2026-10-31) keeps the form in its own job text.
  const form = role === 'owner' ? 'roles/product-owner.md, "How a talk goes"' : 'roles/partner.md, "A brainstorm"'
  // 2026-10-31: a line the form does not know (`line`, `odd`): the partner writes that line in the form, with the same meaning.
  if (line !== undefined) {
    return {
      to, ask: null, step: null, title: null, version: null, verdict: null, command: 'brainstorm-fix', about: path,
      text: [`brainstorm fix`, `Thread: ${path}`, `A line of the thread is not in the form: ${plain(odd).slice(0, 300)}`, `Where: line ${line}`,
        `Your job: write that line anew in the form (${form}), with the same meaning, and change nothing else in the thread.`].join('\n'),
    }
  }
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'brainstorm-fix', about: path,
    text: [`brainstorm fix`, `Thread: ${path}`, `Q${n}'s title is refused: ${reason}`, `Now: ${shown === '' ? '(none)' : shown}`,
      `Your job: rewrite Q${n} in the thread now: its first line the question itself in at most 12 words ending in "?", then a "Context:" line of two to four plain sentences (${form}).`].join('\n'),
  }
}

/**
 * B491, B496: the words still to type to the partner: one for each open question the board refuses (`titleFixes`) whose
 * exact wording was not sent before (`outbox` is everything sent), so a question left as it was is told once, and one
 * rewritten and still too long is told again. Nothing without a partner (`advisor` null). The Product owner (2026-10-31):
 * `advisor` is the talk partner (src/talkPartner.mjs), the owner when the list names one (`role` 'owner').
 */
export function fixesToTell(threads, outbox, advisor) {
  if ((advisor ?? null) === null) return []
  // 2026-10-31: a title is told again when its wording changes (the whole word); a line of the thread once, by its words (not
  // its number: a line that moved is the same line).
  const same = (sent, words) => {
    if (sent.command !== 'brainstorm-fix' || sent.about !== words.about) return false
    const mine = words.text.split('\n')[2] ?? ''
    return LINE_FIX.test(mine) ? (sent.text ?? '').split('\n')[2] === mine : sent.text === words.text
  }
  return [...titleFixes(threads), ...lineFixes(threads)].map(fix => brainstormFixWords({ to: advisor.name, role: advisor.role ?? null, ...fix }))
    .filter(words => !(outbox ?? []).some(one => same(one, words)))
}

/**
 * B733: when a thread's question was written, to the millisecond-less minute: its HH:MM on the day the talk started, a
 * day on for every time that stands earlier than the one before (the talk went past midnight). NaN when the head's
 * start is not a date. Questions are in the order written.
 */
export function questionTimes(started, questions) {
  const day = String(started ?? '').match(/^(\d{4})-(\d\d)-(\d\d)/)
  let offset = 0
  let before = -1
  return questions.map(one => {
    const clock = String(one.at ?? '').match(/(\d{1,2}):(\d\d)/)
    if (day === null || clock === null) return Number.NaN
    const minutes = Number(clock[1]) * 60 + Number(clock[2])
    if (minutes < before) offset += 1
    before = minutes
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + offset, Number(clock[1]), Number(clock[2])).getTime()
  })
}

/**
 * B733: the asks of the board's own store that make a stranded question needless to tell: `{ goal, at }` for each open or
 * answered ask of a goal (`Of: G<n>`), `at` its `Filed` time. A withdrawn ask is none: the question was never asked.
 */
export function askFacts(items) {
  return [...(items?.values?.() ?? [])].filter(item => valueOf(item, 'Kind') === 'ask' && ['open', 'answered'].includes(valueOf(item, 'State')) && valueOf(item, 'Of') !== null)
    .map(item => ({ goal: valueOf(item, 'Of'), at: askFiledMs(item) }))
}

/**
 * B716: the open question of a talk that cannot reach the person: its proposal was created (the board shows no question
 * of such a talk under Needs your attention, `brainstormNeeds`, and refuses an answer to it, `answerQuestion`), or it is
 * done or discarded. `{ path, n, goal }`, the talk's last question only, and only while it has no answer: an earlier one
 * stands behind it. A running talk with no created proposal, or a proposal still to tick, reaches the person.
 * B721: none for a talk of a goal that is done or no longer in the map (`goals`: the map's nodes, `{ id, state }`; null
 * when the map is not known).
 * B733: nor for a question the board's own asks show was asked already (`asks`, `askFacts`): an open or answered ask of
 * the talk's goal filed at or after the question was written. The question's words decide nothing: one that names an
 * ask that does not exist, or one of another goal, is told as before.
 */
export function strandedQuestions(threads, goals = null, asks = []) {
  const byId = goals === null ? null : new Map(goals.map(one => [one.id, one]))
  return (threads ?? []).flatMap(thread => {
    const cannotReach = thread.state === 'done' || thread.state === 'discarded' || (thread.proposal?.created ?? null) !== null
    if (!cannotReach || thread.latest === null || thread.latest.answer !== null) return []
    // 2026-10-31: a talk the person closed asks nothing more of them.
    if ((thread.closed ?? null) !== null) return []
    if (thread.goal !== null && asks.some(one => one.goal === thread.goal.id && one.at >= (thread.latestMs ?? Number.NaN))) return []
    if (byId !== null && thread.goal !== null) {
      const goal = byId.get(thread.goal.id)
      if (goal === undefined || goal.state === 'done') return []
    }
    return [{ path: thread.path, n: thread.latest.n, goal: thread.goal?.id ?? null }]
  })
}

/**
 * B716: the board's word to the partner that a question of its talk cannot reach the person: ask it with `work ask`,
 * the talk stays the record (roles/partner.md, "The fundamental evaluation"). Its text holds the thread, the question and
 * the goal only, so the same question is the same word.
 */
export function brainstormStrandedWords({ to, path, n, goal }) {
  const kind = `${goal === null || goal === undefined ? '' : `of ${goal}, `}kind decide, its options, your advice`
  return {
    to, ask: null, step: null, title: null, version: null, verdict: null, command: 'brainstorm-stranded', about: path,
    text: [`brainstorm stranded`, `Thread: ${path}`, `Q${n} in ${path} cannot reach the person: ask it with work ask`,
      `Your job: ask Q${n} now with work ask (${kind}), and go on from its answer; write nothing else into the talk.`].join('\n'),
  }
}

/** B716: the words still to type to the partner: one for each stranded question not told before (`outbox` is everything sent), so a question is told once. Nothing without a partner (`advisor` null). */
export function strandedToTell(threads, outbox, advisor, goals = null, asks = []) {
  if ((advisor ?? null) === null) return []
  return strandedQuestions(threads, goals, asks).map(one => brainstormStrandedWords({ to: advisor.name, ...one }))
    .filter(words => !(outbox ?? []).some(sent => sent.command === 'brainstorm-stranded' && sent.about === words.about && sent.text === words.text))
}
