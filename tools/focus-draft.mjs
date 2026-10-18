// Focus 2 (roles/partner.md, "The focus"): the partner keeps its draft of the focus goal's vibe and how on the board,
// which writes it into goals.md by id (POST /api/goals, `vibe-draft` and `how-draft`, with the key the board wrote
// into the project's .claude/board.json). Run in the project's folder, or name it with --project.
//
//   node <board>/tools/focus-draft.mjs vibe G6 --line "<a short line>" [--line ...] [--picture <path in the project>]
//   node <board>/tools/focus-draft.mjs how G6 --part "<title> · <size>[ · steps B1, B2]" [--part ...]
//        [--partner "<what you decide yourself>"] [--you "<what you bring to the person>"]
//
// Each call sends the whole vibe, or the whole how: it takes the place of the lines the goal had. Once the how is
// agreed, send it again unchanged with each part's steps added.

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FLAGS = { vibe: { '--line': 'lines', '--picture': 'picture' }, how: { '--part': 'parts', '--partner': 'partnerDecides', '--you': 'youDecide' } }
const no = text => ({ ok: false, text })
const USE = 'Use: focus-draft.mjs vibe G<n> --line "..." [--picture <path>]  or  focus-draft.mjs how G<n> --part "<title> · <size>" [--partner "..."] [--you "..."]'

/** "<title> · <size> · steps B1, B2", the size and the steps each left out at will (as goals.md reads a Part line). */
function partOf(value) {
  const [title = '', ...rest] = value.split(' · ').map(part => part.trim())
  const steps = rest.find(part => /^steps\b/i.test(part))
  const size = rest.find(part => !/^steps\b/i.test(part) && part !== '') ?? ''
  return { title, size, steps: steps === undefined ? [] : steps.replace(/^steps\s*/i, '').split(/[,\s]+/).filter(one => /^B\d+$/.test(one)) }
}

/** The tool's words as the draft the board takes: `{ ok: true, body }`, or `{ ok: false, text }` saying what is wrong. */
export function draftBody(args) {
  const [kind, id, ...rest] = args
  if (!(kind in FLAGS) || !/^G\d+$/.test(id ?? '')) return no(USE)
  const body = kind === 'vibe' ? { command: 'vibe-draft', id, lines: [], picture: null } : { command: 'how-draft', id, parts: [], partnerDecides: [], youDecide: [] }
  for (let at = 0; at < rest.length; at += 2) {
    const field = FLAGS[kind][rest[at]]
    const value = rest[at + 1]
    if (field === undefined || typeof value !== 'string') return no(`${rest[at]} is not known here, or has no value. ${USE}`)
    if (field === 'picture') body.picture = value
    else if (field === 'parts') body.parts.push(partOf(value))
    else body[field].push(value)
  }
  return { ok: true, body }
}

/** Sends the draft to the board of the project in `project`: `{ ok, text }`, one line for the partner. */
export async function sendDraft(args, project) {
  const made = draftBody(args)
  if (!made.ok) return made
  let board
  try {
    board = JSON.parse(await readFile(join(project, '.claude', 'board.json'), 'utf8'))
  } catch {
    return no(`No worker board runs for this project (${join(project, '.claude', 'board.json')} is not there): nothing was kept.`)
  }
  try {
    const answer = await fetch(new URL('/api/goals', board.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Key': String(board.key) }, body: JSON.stringify(made.body) })
    if (!answer.ok) return no(`The board refused it (${answer.status}): ${(await answer.text()).trim()}`)
    return { ok: true, text: `The board keeps the ${made.body.command === 'vibe-draft' ? 'vibe' : 'how'} of ${made.body.id}.` }
  } catch {
    return no('The worker board did not answer: nothing was kept. Try again in a moment.')
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--project')
  const project = at >= 0 ? args[at + 1] ?? '.' : process.cwd()
  if (at >= 0) args.splice(at, 2)
  const done = await sendDraft(args, project)
  console.log(done.text)
  process.exit(done.ok ? 0 : 1)
}
