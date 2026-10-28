import { describe, expect, test } from 'claude-code/testing'

import { ARCHIVE_TOOL, EFFORT_TOOL, HANDS_DONE_PATH, HANDS_PATH, LIST_TOOL, MODEL_TOOL, SEND_TOOL, TASK_RUN_TOOL, TASK_UPDATE_TOOL, UNARCHIVE_TOOL, USAGE_TOOL, archivedOf, canFrom, parseJobs, plainResult, sendResult, setResult, usageResult } from './hands'

// B753: the board's hands in code: the jobs the board hands this chat, and what the app's tool answered for each.
describe('the board\'s hands', () => {
  test('the paths and the app\'s tool', () => {
    expect([HANDS_PATH, HANDS_DONE_PATH, SEND_TOOL]).toEqual(['/api/bridge/hands', '/api/bridge/hands-done', 'mcp__ccd_session_mgmt__send_message'])
  })

  test('a job needs an id, an app id (local_...) and a line; anything else is left out', () => {
    const text = JSON.stringify({ jobs: [
      { id: 'a', to: 'local_w1', chat: 'Worker 1', text: 'The worker board holds words for you; they come in now.' },
      { id: 'b', to: 'cli-session-id', chat: 'Worker 2', text: 'x' },
      { id: 'c', to: 'local_w3', text: '' },
      { to: 'local_w4', text: 'x' },
      'nonsense',
    ] })
    expect(parseJobs(text)).toEqual([{ id: 'a', to: 'local_w1', chat: 'Worker 1', text: 'The worker board holds words for you; they come in now.' }])
    expect(parseJobs(null)).toEqual([])
    expect(parseJobs('not json')).toEqual([])
  })

  test('the tool\'s answer: delivered or queued is sent; anything else is not, with its words', () => {
    expect(sendResult('a', { text: 'Message delivered to session local_w1 ("Worker 1"); its turn has started on it. (delivery: delivered; message_id: m1)' })).toEqual({ id: 'a', ok: true })
    expect(sendResult('b', { text: 'Message queued for session local_w1. (delivery: queued; message_id: m2)' })).toEqual({ id: 'b', ok: true })
    const lost = sendResult('c', { text: 'Message not delivered: session local_x not found. (delivery: undelivered; message_id: m3)', isError: true })
    expect(lost.ok).toBe(false)
    expect(lost.why).toContain('not found')
    expect(sendResult('d', null).ok).toBe(false)
  })

  // B755: a chat's model and effort set by code, with the app's two set tools.
  test('a set job needs an app id and values code may set: an effort the app names, a model id of the app\'s or none, never Fable', () => {
    const text = JSON.stringify({ jobs: [
      { id: 'a', to: 'local_w1', chat: 'Worker 1', set: { model: 'claude-opus-5-5', effort: 'high' } },
      { id: 'b', to: 'local_w2', chat: 'Worker 2', set: { model: null, effort: 'medium' } },
      { id: 'c', to: 'local_w3', set: { model: 'claude-fable-5-1', effort: 'max' } },
      { id: 'd', to: 'local_w4', set: { model: 'gpt-5', effort: 'high' } },
      { id: 'e', to: 'local_w5', set: { model: null, effort: 'ultra' } },
      { id: 'f', to: 'local_w6', set: 'max' },
    ] })
    expect(parseJobs(text)).toEqual([
      { id: 'a', to: 'local_w1', chat: 'Worker 1', set: { model: 'claude-opus-5-5', effort: 'high' } },
      { id: 'b', to: 'local_w2', chat: 'Worker 2', set: { model: null, effort: 'medium' } },
    ])
    expect([MODEL_TOOL, EFFORT_TOOL]).toEqual(['mcp__ccd_session_mgmt__set_session_model', 'mcp__ccd_session_mgmt__set_session_effort'])
  })

  test('a set tool\'s answer: set when it answered with no error or refusal; a deny or a refusal\'s words is not', () => {
    const done = { ref: 'r', result: [{ type: 'text', text: 'x' }], text: 'Session local_w1 ("Worker 1") will run at high effort from its next turn on.' }
    expect(setResult('a', done)).toEqual({ id: 'a', ok: true })
    expect(setResult('b', { deny: 'The server-side auto mode classifier gave no verdict' })).toEqual({ id: 'b', ok: false, why: 'The server-side auto mode classifier gave no verdict' })
    expect(setResult('c', { ...done, isError: true }).ok).toBe(false)
    expect(setResult('d', { ...done, text: 'gpt-5 is not one of the models the picker offers: claude-opus-5-5, claude-sonnet-5-5' }).ok).toBe(false)
    expect(setResult('e', null).ok).toBe(false)
  })

  test('code may do a job only where the app allows each of its tools with no question', () => {
    const allow = { decision: 'allow' }
    expect(canFrom({ [MODEL_TOOL]: allow, [EFFORT_TOOL]: allow })).toEqual(['set'])
    expect(canFrom({ [MODEL_TOOL]: allow, [EFFORT_TOOL]: { decision: 'ask' } })).toEqual([])
    expect(canFrom({ [ARCHIVE_TOOL]: allow, [UNARCHIVE_TOOL]: allow, [LIST_TOOL]: allow, [TASK_UPDATE_TOOL]: allow, [TASK_RUN_TOOL]: allow })).toEqual(['restart', 'spawn'])
    expect(canFrom({ [ARCHIVE_TOOL]: allow, [UNARCHIVE_TOOL]: allow, [LIST_TOOL]: null })).toEqual([])
    expect(canFrom({})).toEqual([])
  })

  // B766: a worker's restart for a new mod, and a new worker, by code.
  test('a restart job keeps only app ids to reopen; a new worker needs a plain title and the stored task ids', () => {
    const text = JSON.stringify({ jobs: [
      { id: 'a', to: 'local_w1', chat: 'Worker 1', restart: { keep: ['local_main', 'cli-x', 7, 'local_w1'] } },
      { id: 'b', chat: 'Studio · Worker 6', spawn: { title: 'Studio · Worker 6', tasks: ['my-project-start-worker-2', 'Bad Id', 'my-project-start-worker'] } },
      { id: 'c', spawn: { title: 'rm -rf /; echo', tasks: ['x'] } },
      { id: 'd', spawn: { title: 'Studio · Worker 7', tasks: [] } },
      { id: 'e', to: 'cli-w2', restart: { keep: [] } },
    ] })
    expect(parseJobs(text)).toEqual([
      { id: 'a', to: 'local_w1', chat: 'Worker 1', restart: { keep: ['local_main', 'local_w1'] } },
      { id: 'b', chat: 'Studio · Worker 6', spawn: { title: 'Studio · Worker 6', tasks: ['my-project-start-worker-2', 'my-project-start-worker'] } },
    ])
  })

  test('a tool plain answer: done unless it refused or said it failed; the archived ids out of the app list', () => {
    expect(plainResult('a', { ref: 'r', result: {}, text: 'Session archived.' })).toEqual({ id: 'a', ok: true })
    expect(plainResult('b', { deny: 'no verdict' })).toEqual({ id: 'b', ok: false, why: 'no verdict' })
    const missing = plainResult('c', { ref: 'r', result: {}, text: 'Session local_x not found.', isError: true })
    expect([missing.ok, missing.why]).toEqual([false, 'Session local_x not found.'])
    expect(plainResult('d', null).ok).toBe(false)
    const listed = { result: [], text: JSON.stringify([{ sessionId: 'local_w1', isArchived: true }, { sessionId: 'local_w2', isArchived: false }, { isArchived: true }]) }
    expect([...archivedOf(listed)]).toEqual(['local_w1'])
    expect([...archivedOf({ text: 'not json' })]).toEqual([])
  })

  // B768: a lookup of the plan's limits by code.
  test('a lookup job has a usage id and no target; its result keeps the plan and leaves this chat out', () => {
    expect(parseJobs(JSON.stringify({ jobs: [{ id: 'usage:7', chat: 'Worker 1', usage: true }, { id: 'usage:x', usage: true }] }))).toEqual([{ id: 'usage:7', chat: 'Worker 1', usage: true }])
    const answer = { result: {}, text: JSON.stringify({ plan: { windows: [{ label: '5-hour limit', percentUsed: 60 }] }, context: { tokensUsed: 9 } }) }
    expect(usageResult('usage:7', answer)).toEqual({ id: 'usage:7', ok: true, text: JSON.stringify({ plan: { windows: [{ label: '5-hour limit', percentUsed: 60 }] } }) })
    expect(usageResult('usage:7', { deny: 'no' }).ok).toBe(false)
    expect(usageResult('usage:7', { result: {}, text: 'plain words' }).ok).toBe(false)
    expect(canFrom({ [USAGE_TOOL]: { decision: 'allow' } })).toEqual(['usage'])
  })
})
