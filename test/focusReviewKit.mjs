// Focus 3, the review's findings: the store and the chats the tests of each finding share. Made-up names only.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseBacklog, refinedOf } from '../src/backlog.mjs'
import { stepLine, stepNotes } from '../src/work/adapter.mjs'
import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'

export const NOW = new Date(2026, 9, 18, 9, 0).getTime()
const BACKLOG = ['# Backlog', '', '## Fights', '- [ ] B1 Show the damage (for Features; about 1 h)', '- [ ] B7 An unrefined step', ''].join('\n')
export const ROLES = { Main: 'main', Features: 'worker', Partner: 'advisor' }
const GOALS = new Set(['G6'])

/** A store of the backlog above in a folder of its own, and the chats that work on it. */
export async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), 'focus-review-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: 'Game - ', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(), hasGoal: id => GOALS.has(id) }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return { dir, ctx, partner: as('Partner'), main: as('Main'), features: as('Features'), person: body => workApi(body, { ...ctx, as: 'person' }) }
}
export const item = async (dir, id) => (await readStore(dir)).items.get(id)
export const state = async (dir, id) => valueOf(await item(dir, id), 'State')
/** The questions of a step's refine block, with their answers, as the backlog reads them. */
export const questionsOf = async (dir, id) => {
  const step = await item(dir, id)
  return refinedOf(parseBacklog(`## Board work\n${stepLine(step)}\n${stepNotes(step).join('\n')}\n`).activities[0].steps[0].notes).questions
}
