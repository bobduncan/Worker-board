// B233, B301: the person's answers to a step's refine questions, their feedback and their "accepted", written into the
// step's refine block. The work API (api.mjs, refine-answer and refine-accept) runs these on the step's lines as the
// store holds them and reads the result back into the item: the board writes no refine block into the backlog file.

import { refinedSpan } from '../backlog.mjs'

const STEP = /^- \[( |x|X)\]\s+(B\d+)\b/

/** A text in its lines, each with its own line end: put together again they are the same text. */
const linesOf = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
const endOf = line => (line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '')

/**
 * B233: the step `id`'s refine block in the backlog's lines: where its head stands and the lines of its parts, as
 * indexes of `lines`; or why not: `gone`, `twice`, or `none` (the step has no refine block yet).
 */
function refineBlock(lines, id) {
  const found = lines.map((line, index) => ({ index, step: line.match(STEP) })).filter(one => one.step !== null && one.step[2] === id)
  if (found.length === 0) return { ok: false, why: 'gone' }
  if (found.length > 1) return { ok: false, why: 'twice' }
  let last = found[0].index
  while (last + 1 < lines.length && /^[ \t]+\S/.test(lines[last + 1])) last += 1
  const under = lines.slice(found[0].index + 1, last + 1).map(line => line.replace(/\r?\n$/, ''))
  const span = refinedSpan(under)
  if (span === null) return { ok: false, why: 'none' }
  const first = found[0].index + 1
  const block = { head: first + span[0], end: first + span[1], questions: [], feedback: null, isDone: found[0].step[1] !== ' ' }
  let part = null
  for (let index = block.head + 1; index < block.end; index += 1) {
    const line = lines[index].trim()
    // B293: the parts of the newer form too, so a point under "What we build:" is never taken for a question.
    const named = line.match(/^(Problem|Goal|Questions|Feedback|Summary|Picture|Part of|Size|What we build|Not in it):/)
    if (named !== null) {
      part = named[1]
      if (part === 'Feedback') block.feedback = index
      continue
    }
    // Counted as `refinedOf` counts them: every line under "Questions:", with its point or without; "None: ..." is no
    // question.
    if (part === 'Questions' && line !== '' && !/^(?:[-*]\s+)?None\b/i.test(line)) block.questions.push(index)
    if (part === 'Feedback') block.feedback = index
  }
  return { ok: true, block }
}

/**
 * B233: the backlog's text with the person's answers to a step's refine questions and their feedback written into
 * its refine block. `answers` are `{ index, answer }` (the question's place in the block, from 0); an answer that is
 * there already is replaced. The feedback becomes the point "Round <the block's round>: ..." under "Feedback:", which is added
 * at the block's end when it is not there. Every other character stays as it is.
 */
export function answerRefine(text, id, answers, feedback) {
  const lines = linesOf(text)
  const found = refineBlock(lines, id)
  if (!found.ok) return found
  const { block } = found
  const round = Number(lines[block.head].match(/\bround\s+(\d+)/i)?.[1] ?? 1)
  const out = [...lines]
  const indent = lines[block.head].match(/^[ \t]*/)[0]
  for (const { index, answer } of answers) {
    const at = block.questions[index]
    if (at === undefined) return { ok: false, why: 'question' }
    const end = endOf(lines[at])
    const question = lines[at].slice(0, lines[at].length - end.length).replace(/\s+Answer:\s.*$/, '').replace(/\s+$/, '')
    out[at] = `${question} Answer: ${answer}${end}`
  }
  if (feedback !== '') {
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const add = block.feedback === null ? [`${indent}Feedback:`, `${indent}- Round ${round}: ${feedback}`] : [`${indent}- Round ${round}: ${feedback}`]
    const after = block.feedback ?? block.end - 1
    // A file whose last line has no line end keeps none.
    if (endOf(out[after]) === '') out[after] = `${out[after]}${newline}${add.join(newline)}`
    else out.splice(after + 1, 0, ...add.map(line => `${line}${endOf(out[after])}`))
  }
  return { ok: true, text: out.join('') }
}

/** B233: the backlog's text with the step's refine block marked accepted ("accepted <when>" in its head's brackets). */
export function acceptRefine(text, id, when) {
  const lines = linesOf(text)
  const found = refineBlock(lines, id)
  if (!found.ok) return found
  const at = found.block.head
  const end = endOf(lines[at])
  const head = lines[at].slice(0, lines[at].length - end.length)
  const bracket = head.match(REFINED_HEAD_RAW)
  const inside = bracket[2] === undefined ? '' : bracket[2].replace(/;\s*accepted\b[^;]*/i, '').trim()
  const out = [...lines]
  out[at] = `${bracket[1]}Refined (${inside === '' ? '' : `${inside}; `}accepted ${when}):${end}`
  return { ok: true, text: out.join('') }
}
const REFINED_HEAD_RAW = /^([ \t]*)Refined\s*(?:\(([^)]*)\))?\s*:\s*$/

