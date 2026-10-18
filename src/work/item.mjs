// B296: one item of the work store, `<work>/<id>.md` (spec 2026-10-17, section 3). The head is the lines up to the
// first blank line, `Key: value`, with keys fixed per kind; the body is markdown under `## ` sections, kept verbatim.
// The person reads the file as it is; the board renders it.

/** The keys a head may hold, per kind, in the order they are written. */
export const HEAD_KEYS = {
  // `Queue note` and `Line` keep what the backlog wrote when its words do not come back from the fields alone (see
  // migrate.mjs); `Asks` on a step keeps a "Decide:" a step without @you may start with. B303: `Queue when refined`
  // keeps a queue asked before the step's refine ("for Board; after B293; about 1.5 h"); the board carries it out.
  step: ['Id', 'Kind', 'Title', 'State', 'Owner', 'Activity', 'Goal', 'Blocked by', 'Waits for', 'Since', 'Estimate', 'Branch', 'Pictures', 'Refined', 'Asks', 'Queue when refined', 'Queue note', 'Line'],
  // B299: `Advice` is the option the asking chat advises; `Via` says how it was asked: form (the app's question form,
  // answered in the chat only) or refine (a question of the Advisor's refine of the step it is Of).
  ask: ['Id', 'Kind', 'Title', 'State', 'Owner', 'Activity', 'Goal', 'Blocked by', 'Waits for', 'Since', 'Estimate', 'Branch', 'Pictures', 'Refined', 'Asks', 'Blocking', 'Of', 'Options', 'Advice', 'Via', 'Queue note', 'Line'],
  // B298: `Via` says where the words were typed (chat: in the chat's own box; board: on the worker board), `Missed` how
  // many of the chat's turns ended while it stood open, `Filed` when it was filed to the millisecond (review: the
  // turn's start is compared with it).
  instruction: ['Id', 'Kind', 'Chat', 'State', 'Since', 'Filed', 'Via', 'Missed', 'Text', 'Closed as'],
  // Focus 3: `Of` names the goal of the partner's daily note (dailyNote.mjs). Focus 4: `Via: report` marks the board's
  // note of a report; `Main read` when the main chat read it with work next (the person's read is its State).
  note: ['Id', 'Kind', 'From', 'To', 'Of', 'Via', 'State', 'Since', 'Main read', 'Text'],
}
const REQUIRED = ['Id', 'Kind', 'State', 'Since']
const KIND_NAME = { step: 'a step', ask: 'an ask', instruction: 'an instruction', note: 'a note' }
export const ASK_KINDS = ['decide', 'look', 'provide', 'do']

const HEAD_LINE = /^([A-Z][A-Za-z ]{1,24}): (.*)$/
const SECTION = /^## (.*)$/

/**
 * One item file's text → `{ head: Map<key, value>, sections: Map<name, lines>, problem }`. A line that is no head line
 * ends the head; when it is not the blank line, `problem` names it (the item is still read as far as it goes). Lines
 * before the first section stand under the section ''. Each section's trailing blank lines are left out.
 */
export function parseItem(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split('\n').map(line => line.replace(/\r$/, ''))
  if (lines.at(-1) === '') lines.pop()
  const head = new Map()
  let problem = null
  let at = 0
  for (; at < lines.length; at += 1) {
    const found = lines[at].match(HEAD_LINE)
    if (found === null) break
    if (head.has(found[1])) {
      problem ??= `line ${at + 1}: ${found[1]} stands twice`
      continue
    }
    head.set(found[1], found[2].trim())
  }
  if (at < lines.length && lines[at] !== '') problem ??= `line ${at + 1} is no head line: "${lines[at].slice(0, 60)}"`
  else at += 1
  const sections = new Map()
  let current = null
  for (; at < lines.length; at += 1) {
    const found = lines[at].match(SECTION)
    if (found !== null) {
      current = found[1].trim()
      if (sections.has(current)) problem ??= `line ${at + 1}: the section ${current} stands twice`
      sections.set(current, sections.get(current) ?? [])
      continue
    }
    if (current === null) {
      current = ''
      sections.set('', [])
    }
    sections.get(current).push(lines[at])
  }
  for (const [name, kept] of sections) {
    while (kept.length > 0 && kept.at(-1).trim() === '') kept.pop()
    if (name === '' && kept.length === 0) sections.delete('')
  }
  return { head, sections, problem }
}

/** An item as its file's text: the head, a blank line, each section with a blank line between, a final newline. */
export function serializeItem({ head, sections = new Map() }) {
  const parts = [[...head].map(([key, value]) => `${key}: ${value}`).join('\n')]
  for (const [name, lines] of sections) {
    const kept = [...lines]
    while (kept.length > 0 && kept.at(-1).trim() === '') kept.pop()
    parts.push(name === '' ? kept.join('\n') : [`## ${name}`, ...kept].join('\n'))
  }
  return `${parts.join('\n\n')}\n`
}

// B298: an instruction's Since carries the second it was filed, so a turn that started a moment later can tell it.
const DATE = /^\d{4}-\d\d-\d\d(?: \d\d:\d\d(?::\d\d)?)?$/
// B296: `L-<8 hex>` is a step the backlog gave no id (migrate.mjs `legacyId`).
const ID = /^(?:[A-Z]\d+|L-[0-9a-f]{8})$/

/** What is wrong with a head for its kind, as one line naming the key, or null when it is fine. */
export function validateHead(head, kind = head.get('Kind')) {
  const keys = HEAD_KEYS[kind]
  if (keys === undefined) return `Kind is not step, ask, instruction or note: ${kind ?? '(none)'}`
  for (const key of REQUIRED) if (!head.has(key) || head.get(key) === '') return `${key} is missing`
  for (const key of head.keys()) if (!keys.includes(key)) return `${key} is no key of ${KIND_NAME[kind]}`
  if (head.get('Kind') !== kind) return `Kind is ${head.get('Kind')}, not ${kind}`
  if (!ID.test(head.get('Id'))) return `Id is no id: ${head.get('Id')}`
  const since = head.get('Since')
  if (since !== '-' && !DATE.test(since)) return `Since is no date: ${since}`
  const asks = head.get('Asks')
  if (asks !== undefined && asks !== '-' && !ASK_KINDS.includes(asks)) return `Asks is not decide, look, provide or do: ${asks}`
  const blocking = head.get('Blocking')
  if (blocking !== undefined && !['yes', 'no', '-'].includes(blocking)) return `Blocking is not yes or no: ${blocking}`
  return null
}

/** A head value, or null for none: a missing key, '' and '-' all mean none. */
export function valueOf(item, key) {
  const value = item.head.get(key)
  return value === undefined || value === '' || value === '-' ? null : value
}

/** B298: a Since as a time; the start of its minute (or second) as written. NaN when it is none. */
export function sinceMs(value) {
  const found = String(value ?? '').match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d)(?::(\d\d))?)?$/)
  if (found === null) return Number.NaN
  const [, y, m, d, h = 0, min = 0, sec = 0] = found
  return new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(sec)).getTime()
}
