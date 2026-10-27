// T9.1.1: a kit for the tests of the Quality Assurance tasks (spec 2026-10-27). A store with a main chat, three workers (the
// builder, the checker and a spare) and the partner; a step reported with its board check passed, so it waits for its
// result check; and the way a worker takes the QA task and files the check. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workApi } from '../src/work/api.mjs'
import { valueOf } from '../src/work/item.mjs'
import { migrateBacklog } from '../src/work/migrate.mjs'
import { openQaTaskOf } from '../src/work/qaTask.mjs'
import { readStore, writeStore } from '../src/work/store.mjs'
import { queueFor } from './queueFor.mjs'

export const NOW = new Date(2026, 9, 27, 9, 0).getTime()
export const ROLES = { Keeper: 'main', Lamplighter: 'worker', Checker: 'worker', Spare: 'worker', Partner: 'advisor' }
const BACKLOG = ['# Backlog', '', '## Lamps', '- [ ] B1 Trim the wicks (for Lamplighter; about 1 h)', ''].join('\n')

/** A step made from an agreed how: two agreed points, so it needs its result check. */
export const LAMP = { action: 'new', title: 'Light the garden lamps', activity: 'Lamps', goal: 'G3', text: 'Warm light on every path.', summary: 'Every path has a warm lamp.', size: '1 h', what: ['a lamp at every bench', 'warm yellow light, never white', 'Not in it: new paths'] }

/** A store folder and the calls of each chat (and the board's own) on it. `more` joins the ctx of every call. */
export async function fresh(more = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'work-qa-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW }), undefined, { now: NOW })
  const ctx = { dir, now: NOW + 60_000, prefix: '', roleOf: chat => ROLES[chat] ?? null, freeChats: new Set(['Lamplighter', 'Checker', 'Spare']), ...more }
  const as = chat => body => workApi({ chat, ...body }, ctx)
  return {
    dir, ctx, as, lamplighter: as('Lamplighter'), checker: as('Checker'), spare: as('Spare'), keeper: as('Keeper'), partner: as('Partner'),
    server: body => workApi(body, { ...ctx, as: 'server' }), person: body => workApi(body, { ...ctx, as: 'person' }),
    /** The same folder with another clock, as calls of the chat `chat` (or the board's own for 'server'). */
    later: (ms, chat = 'server') => body => workApi(chat === 'server' ? body : { chat, ...body }, { ...ctx, now: NOW + ms, ...(chat === 'server' ? { as: 'server' } : {}) }),
  }
}
export const item = async (dir, id) => (await readStore(dir)).items.get(id)
export const items = async dir => (await readStore(dir)).items
export const remove = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** A step made by the partner, given to the builder, taken, reported, and its board check run: passed, or failed. */
export async function reported(store, { gitPassed = true, lamp = LAMP, builder = 'lamplighter', owner = 'Lamplighter', warnings = [] } = {}) {
  const made = await store.partner(lamp)
  assert.equal(made.ok, true, made.why)
  const id = made.result.id
  assert.equal((await queueFor(store.dir, id, owner, { now: NOW + 60_000 })).ok, true)
  assert.equal((await store[builder]({ action: 'take', id, branch: 'b-lamps' })).ok, true)
  assert.equal((await store[builder]({ action: 'report', id, result: 'Every path has a warm lamp.', merged: 'c0ffee1' })).ok, true)
  const git = await store.server({ action: 'check', id, passed: gitPassed, lines: gitPassed ? ['work in garden', 'branch gone', 'result named'] : ['the branch b-lamps is still there'], ...(warnings.length === 0 ? {} : { warnings }) })
  return { id, git }
}

/** The open QA task of a step, from the files; null for none. */
export const openQa = async (dir, id) => openQaTaskOf(await items(dir), id)

/** The step waits for its check and has a QA task (the board's own check made it, or the board's maker now); its id. */
export async function qaOf(store, id) {
  const made = await store.server({ action: 'qa-task', id })
  assert.equal(made.ok, true, made.why)
  return made.result.id
}

/** Gives the QA task to the worker the way the board's hand-out does, and the worker takes it (no branch). */
export async function takeQa(store, qa, worker = 'Checker', chat = 'checker') {
  assert.equal((await queueFor(store.dir, qa, worker, { now: NOW + 60_000 })).ok, true)
  const taken = await store[chat]({ action: 'take', id: qa })
  assert.equal(taken.ok, true, taken.why)
  return taken
}

/** A worker that did not build the step takes its QA task and files `body` as the check of it. */
export async function fileCheck(store, id, body, { worker = 'Checker', chat = 'checker' } = {}) {
  const qa = await qaOf(store, id)
  if (valueOf(await item(store.dir, qa), 'State') === 'refined') await takeQa(store, qa, worker, chat)
  return store[chat]({ action: 'checked', id, ...body })
}

/**
 * The result check of the step `id` filed the way the board has it now, for a test with its own set-up: the board makes the
 * step's QA task when none is open (`server`, the board's own call), gives it to `worker` (a worker of the test's chats that did
 * not build the step), who takes it and files `body`. `ports`: `as(chat)` the calls of a chat, `server(body)` the board's own,
 * `dir`, and `now` (the clock of the test's calls). Answers `checked`'s answer, or the first refusal on the way.
 */
export async function checkedBy(ports, id, body, worker = 'Checker') {
  const { as, server, dir, now = NOW + 60_000 } = ports
  const made = await server({ action: 'qa-task', id })
  if (!made.ok) return made
  const qa = made.result.id
  if (valueOf(await item(dir, qa), 'State') === 'refined') {
    await queueFor(dir, qa, worker, { now })
    const taken = await as(worker)({ action: 'take', id: qa })
    if (!taken.ok) return taken
  }
  return as(worker)({ action: 'checked', id, ...body })
}
