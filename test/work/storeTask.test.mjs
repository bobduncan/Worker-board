// B300, B301: a lane's task comes from the store, never from the main chat's "Task from" line (spec 2026-10-17, section
// 6 hook 4). Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, fromChat, step, typed } from '../../fixtures/lines.mjs'
import { parseConfig } from '../../src/config.mjs'
import { buildState } from '../withStore.mjs'
import { workApi } from '../../src/work/api.mjs'
import { migrateBacklog } from '../../src/work/migrate.mjs'
import { readStore, writeStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 17, 11, 5).getTime()
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const BACKLOG = ['# Backlog', '', '## Garden', '- [ ] B1 Plant the hedge (for Digger; about 1 h)', '- [ ] B2 Mow the lawn (for Digger; after B1)', ''].join('\n')
const HAND = 'Task from Garden · Lead: backlog step B2, mow the lawn. About 45 minutes.'

const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - MIN, lastAssistantUuid: 'u-1' })
/** Digger's transcript: the main chat's hand-over, then a turn that runs, or one that ended. */
const tail = isRunning => ({
  text: [fromChat(NOW - 10 * MIN, 'Garden · Lead', HAND), typed(NOW - 9 * MIN, 'go on'), isRunning ? step(NOW - MIN, 'Mowing') : answer(NOW - MIN, 'Mowed half.')].join('\n'),
  isCut: false, modifiedAt: NOW - MIN,
})

async function garden() {
  const dir = await mkdtemp(join(tmpdir(), 'work-task-'))
  await writeStore(dir, migrateBacklog(BACKLOG, { now: NOW - 60 * MIN }), undefined, { now: NOW - 60 * MIN })
  await workApi({ chat: 'Digger', action: 'take', id: 'B1' }, { dir, now: NOW - 30 * MIN, prefix: 'Garden · ', roleOf: chat => ({ Lead: 'main', Digger: 'worker' })[chat] ?? null, freeChats: new Set(['Digger']) })
  const build = async isRunning => {
    const work = { ok: true, dir, ...(await readStore(dir)) }
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger')], tails: { 'cli-Digger': tail(isRunning) }, planLineTexts: {},
      backlogText: BACKLOG, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
    }
    return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config }).chats.find(one => one.name === 'Digger')
  }
  return { dir, build }
}

test('a working lane\'s task is the step the store holds for it, not the step a "Task from" line names', async () => {
  const store = await garden()
  try {
    const now = await store.build(true)
    assert.deepEqual([now.state, now.task.stepId, now.task.text, now.task.handMinutes], ['working', 'B1', 'B1 Plant the hedge', undefined])
    // The step is the task as it was given, not the hand-over.
    assert.deepEqual([now.givenTask.by, now.givenTask.step.id], ['step', 'B1'])
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('between two turns a "Task from" line holds the chat no more; the step it holds in progress does', async () => {
  const store = await garden()
  try {
    const now = await store.build(false)
    assert.deepEqual([now.state, now.between, now.task.stepId], ['working', 'Its turn has ended; its step B1 is in progress.', 'B1'])
  } finally {
    await rm(store.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
