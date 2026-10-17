// B259: a brainstorm on the board (spec 2026-10-15, section 5). One thread file per brainstorm, in the project's
// folder the setting `brainstorms` names: the Advisor writes its questions and its proposal into it, the board writes
// the person's answers, the state and what was created. Read here into a thread, and written line by line: every line
// the change does not touch stays as it was. Pure: no file is read here.

const refuse = why => ({ ok: false, why })
export const THREAD_STATES = ['running', 'wrapping up', 'done', 'discarded']
const oneLine = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const HEAD_TITLE = /^# Brainstorm:\s*(.*)$/
const HEAD_GOAL = /^Goal:\s*(?:(G\d+)\s+(.*)|new)\s*$/
const HEAD_STARTED = /^Started:\s*(.+?)\s*·\s*State:\s*(running|wrapping up|done|discarded)\s*$/
const QUESTION = /^## Q(\d+) \(([^)]+)\)\s*$/
const PROPOSAL = /^## Proposal \(([^)]+)\)\s*$/
const OPTION = /^- ([A-Z]): (.*?)( \(advised\))?$/
const ANSWER = /^Answer \(([^)]+)\):\s*(.*)$/
const CREATED = /^Created \(([^)]+)\):\s*(.*)$/
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
  return key === null ? null : { at, key: key[1], words: (key[2] ?? '').trim() }
}

/** "under G6" → "G6"; "under top" → null. */
const underOf = part => {
  const found = part.match(/^under (G\d+|top)$/)
  return found === null ? undefined : found[1] === 'top' ? null : found[1]
}

function goalItem(value) {
  const parts = value.split(PART)
  if (parts.length < 3) return null
  const doneWhen = parts.at(-1).match(/^Done when:\s*(.*)$/)
  const under = underOf(parts.at(-2))
  if (doneWhen === null || under === undefined) return null
  return { title: parts.slice(0, -2).join(PART).trim(), under, doneWhen: doneWhen[1].trim() }
}

function stepItem(value) {
  const parts = value.split(PART)
  if (parts.length < 3) return null
  return { title: parts.slice(0, -2).join(PART).trim(), worker: parts.at(-2).trim(), cost: parts.at(-1).trim() }
}

/** `Created (<at>): G10, G11; B61 (or "2 steps asked of the main chat"); left out: <titles, " · " between>`. */
function createdOf(at, value) {
  const [goals = '', steps = '', ...rest] = value.split('; ')
  const left = rest.join('; ').replace(/^left out:\s*/, '').trim()
  const ids = steps.match(/\bB\d+\b/g) ?? []
  const asked = steps.match(/^(\d+) steps? asked/)
  return {
    at,
    goals: goals.match(/\bG\d+\b/g) ?? [],
    steps: ids,
    asked: ids.length > 0 ? ids.length : asked === null ? 0 : Number(asked[1]),
    leftOut: left === '' || left === 'nothing' ? [] : left.split(' · ').map(one => one.trim()).filter(Boolean),
  }
}

/**
 * A thread as the board shows it: its head (title, goal or null for a free one, when it started, its state, the
 * person's opening words, the Advisor's context lines), its questions in order (each with its text, why, options, the
 * advised one marked, its picture and the person's answer or null), the last proposal (a changed proposal stands under
 * a new heading) or null, and the lines the form does not know, each named once with its line ("line 9: ...").
 */
export function parseThread(text) {
  const thread = { title: null, goal: null, started: null, state: 'running', opening: '', context: [], questions: [], proposal: null, problems: [] }
  let section = 'head'
  let question = null
  let proposal = null
  let list = null
  const odd = (index, line) => thread.problems.push(`line ${index + 1}: ${line.slice(0, 80)}`)
  split(text).lines.forEach((raw, index) => {
    const line = raw.trim()
    const asQuestion = line.match(QUESTION)
    const asProposal = line.match(PROPOSAL)
    if (asQuestion !== null) {
      question = { n: Number(asQuestion[1]), at: asQuestion[2], text: '', why: null, options: [], picture: null, answer: null }
      thread.questions.push(question)
      section = 'question'
      return
    }
    if (asProposal !== null) {
      proposal = { at: asProposal[1], decided: [], goals: [], steps: [], note: null, created: null }
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
      if (title !== null && thread.title === null) thread.title = title[1].trim()
      else if (goal !== null) thread.goal = goal[1] === undefined ? null : { id: goal[1], title: goal[2].trim() }
      else if (started !== null) [thread.started, thread.state] = [started[1], started[2]]
      else if (line.startsWith('Opening:')) thread.opening = line.slice('Opening:'.length).trim()
      // What the Advisor writes under the opening: its short context head ("Context:" first), read as it is.
      else thread.context.push(line)
      return
    }
    if (section === 'question') {
      const option = line.match(OPTION)
      const answer = line.match(ANSWER)
      const isNamed = option !== null || answer !== null || line.startsWith('Why:') || line.startsWith('Picture:')
      // Before anything named, a line is the question's (one or two lines).
      if (!isNamed && question.why === null && question.options.length === 0 && question.picture === null && question.answer === null && !/^[A-Z][A-Za-z ]*:\s/.test(line)) {
        question.text = question.text === '' ? line : `${question.text} ${line}`
      } else if (line.startsWith('Why:')) question.why = line.slice(4).trim()
      else if (line.startsWith('Picture:')) question.picture = line.slice(8).trim()
      else if (option !== null) question.options.push({ key: option[1], text: option[2].trim(), isAdvised: option[3] !== undefined })
      else if (answer !== null && answerOf(answer[1], answer[2].trim()) !== null) question.answer = answerOf(answer[1], answer[2].trim())
      else odd(index, line)
      return
    }
    // The proposal.
    const created = line.match(CREATED)
    if (line === 'Decided:') list = 'decided'
    else if (line === 'Goals:') list = 'goals'
    else if (line === 'Steps:') list = 'steps'
    else if (line.startsWith('Note:')) {
      proposal.note = line.slice(5).trim()
      list = null
    } else if (created !== null) proposal.created = createdOf(created[1], created[2])
    else if (list === 'decided' && line.startsWith('- ')) proposal.decided.push(line.slice(2).trim())
    else if ((list === 'goals' || list === 'steps') && GOAL_ITEM.test(line)) {
      const item = (list === 'goals' ? goalItem : stepItem)(line.match(GOAL_ITEM)[1])
      if (item === null) odd(index, line)
      else proposal[list].push(item)
    } else odd(index, line)
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
  const question = thread.questions.find(one => one.n === n)
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
  const section = sections(file.lines).find(one => QUESTION.test(one.line) && Number(one.line.match(QUESTION)[1]) === n)
  const at = lastFilled(file.lines, section) + 1
  file.lines.splice(at, 0, `Answer (${oneLine(answer.at, 40)}): ${value}`)
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
 * What came of the last proposal, under it: `Created (<at>): <goals>; <steps>; left out: <titles>`. The steps are the
 * backlog's ids when known, else how many the main chat was asked for (`asked`). Refused `none` without a proposal,
 * `twice` when one was created already (Review Focus 5).
 */
export function markCreated(text, { at, goals = [], steps = [], asked = 0, leftOut = [] }) {
  const thread = parseThread(text)
  if (thread.proposal === null) return refuse('none')
  if (thread.proposal.created !== null) return refuse('twice')
  const goalPart = goals.length > 0 ? goals.join(', ') : 'no goals'
  const stepPart = steps.length > 0 ? steps.join(', ') : asked > 0 ? `${asked} step${asked === 1 ? '' : 's'} asked of the main chat` : 'no steps'
  const left = leftOut.length > 0 ? leftOut.map(title => oneLine(title, 160)).join(' · ') : 'nothing'
  const file = split(text)
  const last = sections(file.lines).filter(one => PROPOSAL.test(one.line)).at(-1)
  file.lines.splice(lastFilled(file.lines, last) + 1, 0, `Created (${oneLine(at, 40)}): ${goalPart}; ${stepPart}; left out: ${left}`)
  return { ok: true, text: join(file) }
}

/** The head of a new thread, as the Advisor reads it; a free brainstorm is about "new". */
export function newThread({ title, goal, started, opening }) {
  const about = goal === null || goal === undefined ? 'new' : `${goal.id} ${oneLine(goal.title, 160)}`
  return `# Brainstorm: ${oneLine(title, 120)}\nGoal: ${about}\nStarted: ${started} · State: running\nOpening: ${oneLine(opening, 2000)}\n\n`
}

/** "2026-10-15-the-reference-look-on-every-map": the day, then the title's words in small letters, at most 40 characters. */
export function threadSlug(title, date) {
  let words = String(title ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (words.length > 40) words = words.slice(0, 40).replace(/-[^-]*$/, '') || words.slice(0, 40)
  return `${date}-${words === '' ? 'brainstorm' : words}`
}
