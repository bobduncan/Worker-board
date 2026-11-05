// 2026-11-05 (the person's decision): the board's default flow (src/work/flow.mjs DEFAULT_FLOW) gains moves over time, and a project
// that has its own `<work>/flow.json` keeps the old ones, so a new board feature silently does nothing there. Setup adds the
// missing moves, on the person's y: it shows exactly what it adds, never changes, removes or reorders a move or state that is
// there (the flow file stays the person's to experiment with), and copies the old file to flow.json.bak-<time> first.

import { copyFile, readFile, writeFile } from 'node:fs/promises'

import { DEFAULT_FLOW, parseFlow } from './work/flow.mjs'

const FILES = { readFile, writeFile, copyFile }
const byList = by => (Array.isArray(by) ? by : [by])
const plural = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`

/** Two moves are the same when from, to, when, then, sets and the set of `by` agree (undefined = absent; the order of `by` does not matter). */
const sameMove = (a, b) => a.from === b.from && a.to === b.to && a.when === b.when && a.then === b.then
  && JSON.stringify(a.sets) === JSON.stringify(b.sets)
  && JSON.stringify([...new Set(byList(a.by))].sort()) === JSON.stringify([...new Set(byList(b.by))].sort())

/** The moves of `base` that `flow` has no equal of: `[{ kind, move }]`, in base order. A kind the flow lacks misses all its moves. */
export function missingMoves(flow, base = DEFAULT_FLOW) {
  const missing = []
  for (const [kind, part] of Object.entries(base)) {
    const have = Array.isArray(flow?.[kind]?.moves) ? flow[kind].moves : []
    for (const move of part.moves) if (!have.some(one => one !== null && typeof one === 'object' && sameMove(one, move))) missing.push({ kind, move })
  }
  return missing
}

/** `list` with `item` put after the nearest earlier entry of `order` (before `item`'s own place in it) that `list` holds, else first. */
function insertAfterEarlier(list, item, order, same) {
  const at = order.findIndex(one => same(one, item))
  for (let index = at - 1; index >= 0; index -= 1) {
    const found = list.findIndex(one => same(one, order[index]))
    if (found >= 0) {
      list.splice(found + 1, 0, item)
      return
    }
  }
  list.unshift(item)
}

/**
 * The text of a flow.json with the moves of `base` it lacks added: `{ ok, why?, text, added, states, changed }`. Each lands right after
 * the nearest earlier base move the file has (first when none); a state such a move needs is added the same way; a kind the file lacks
 * is added whole. Nothing there is changed, removed or reordered. A text that `parseFlow` finds fault with is left alone (`ok` false).
 */
export function withBoardMoves(text, base = DEFAULT_FLOW) {
  const read = parseFlow(text)
  if (read.problem !== null) return { ok: false, why: read.problem }
  const bom = /^﻿/.test(text) ? '﻿' : ''
  const crlf = text.includes('\r\n')
  const obj = JSON.parse(text.replace(/^﻿/, ''))
  const added = []
  const states = []
  for (const [kind, part] of Object.entries(base)) {
    if (obj[kind] === undefined) {
      obj[kind] = JSON.parse(JSON.stringify(part))
      for (const move of part.moves) added.push({ kind, move })
      continue
    }
    const moves = obj[kind].moves
    const same = (a, b) => a !== null && typeof a === 'object' && sameMove(a, b)
    for (const move of part.moves) {
      if (moves.some(one => same(one, move))) continue
      const copy = JSON.parse(JSON.stringify(move))
      insertAfterEarlier(moves, copy, part.moves, same)
      added.push({ kind, move })
      for (const state of [move.from, move.to]) {
        if (state === '*' || obj[kind].states.includes(state)) continue
        insertAfterEarlier(obj[kind].states, state, part.states, (a, b) => a === b)
        states.push({ kind, state })
      }
    }
  }
  if (added.length === 0) return { ok: true, text, added, states, changed: false }
  let out = `${JSON.stringify(obj, null, 2)}\n`
  if (crlf) out = out.replace(/\n/g, '\r\n')
  out = bom + out
  const check = parseFlow(out)
  if (check.problem !== null) return { ok: false, why: check.problem }
  return { ok: true, text: out, added, states, changed: true }
}

const ROLE_WORDS = { person: 'you', server: 'the board' }
const kindWords = kind => (kind === 'step' ? 'a step' : `a ${kind}`)

/** One plain line for the person: `a step: done → review, by you`. */
export function moveWords(kind, move) {
  const by = byList(move.by).map(one => ROLE_WORDS[one] ?? one).join(' or ')
  return `${kindWords(kind)}: ${move.from === '*' ? 'any state' : move.from} → ${move.to}, by ${by}${move.when === undefined ? '' : `, when "${move.when}"`}${move.then === undefined ? '' : `, then "${move.then}"`}`
}

const pad = number => String(number).padStart(2, '0')
const stamp = at => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`

/**
 * Adds the missing moves to the flow file: `{ ok, why?, none?, added, states, backup, file }`. No file: the board uses its own default
 * flow, nothing to do (`none`). Nothing missing: nothing written, no backup. Else the old bytes are copied to `flow.json.bak-<time>` first.
 */
export async function addBoardMoves({ file, base = DEFAULT_FLOW, now = new Date(), fs = FILES }) {
  const raw = await fs.readFile(file).catch(error => (error?.code === 'ENOENT' ? null : undefined))
  if (raw === undefined) return { ok: false, why: 'the flow file cannot be read', added: [], states: [], backup: null, file }
  if (raw === null) return { ok: true, none: true, added: [], states: [], backup: null, file }
  const next = withBoardMoves(raw.toString('utf8'), base)
  if (!next.ok) return { ok: false, why: next.why, added: [], states: [], backup: null, file }
  if (!next.changed) return { ok: true, added: [], states: [], backup: null, file }
  const backup = `${file}.bak-${stamp(now)}`
  await fs.writeFile(backup, raw)
  await fs.writeFile(file, next.text, 'utf8')
  return { ok: true, added: next.added, states: next.states, backup, file }
}

/** What setup would add, as lines to show; reads the file, writes nothing. */
export async function describeFlow({ file, base = DEFAULT_FLOW, fs = FILES }) {
  const lines = [`Your project's flow, ${file}:`]
  const raw = await fs.readFile(file).catch(error => (error?.code === 'ENOENT' ? null : undefined))
  if (raw === null) return [...lines, '  none: the board uses its own default flow']
  const next = raw === undefined ? { ok: false, why: 'the file cannot be read' } : withBoardMoves(raw.toString('utf8'), base)
  if (!next.ok) return [...lines, `  could not be read: ${next.why}, nothing would be added`]
  if (!next.changed) return [...lines, '  nothing to add (it has every move the board needs)']
  lines.push(`  ${plural(next.added.length, 'move')} would be added:`)
  for (const { kind, move } of next.added) lines.push(`    - ${moveWords(kind, move)}`)
  for (const { kind, state } of next.states) lines.push(`    - the state "${state}" of ${kindWords(kind)}`)
  lines.push('  the old file is copied to flow.json.bak-<time> first')
  return lines
}

/**
 * The flow part of setup, on the person's word: `answer`, `flag` (the value of --flow, undefined when not given) and `isTty`. Without
 * a keyboard only the flag allows it. `check`: says what would be added (`lines`) and writes nothing.
 */
export async function setupFlow({ answer, flag, isTty, check = false, file, base = DEFAULT_FLOW, now = new Date(), fs = FILES }) {
  if (check) return { wrote: false, check: true, lines: await describeFlow({ file, base, fs }) }
  const wanted = /^y/i.test(String(answer ?? '').trim()) && (isTty === true || flag !== undefined)
  if (!wanted) return { wrote: false }
  return { wrote: true, ...(await addBoardMoves({ file, base, now, fs })) }
}
