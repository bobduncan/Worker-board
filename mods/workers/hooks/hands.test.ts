import { describe, expect, test } from 'claude-code/testing'

import { ARCHIVE_TOOL, CAN_TOOLS, EFFORT_TOOL, HAND_CALL_MS, HANDS_DONE_PATH, HANDS_PATH, LIST_TOOL, MODEL_TOOL, SEND_TOOL, TASK_RUN_TOOL, TASK_UPDATE_TOOL, UNARCHIVE_TOOL, USAGE_TOOL, NO_ANSWER_WHY, NO_SESSION_WHY, NOT_TRIED_WHY, archivedOf, canFrom, isNoSession, mayClaim, parseJobs, plainResult, raceJob, sendResult, setResult, usageResult } from './hands'

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

  // T14: the start, wake and resume lines only from a chat whose app lets its code send with no question.
  test('send only where the app allows the send-message tool: an ask (the Auto classifier, a dialog) or a deny is no send', () => {
    expect(CAN_TOOLS.send).toEqual([SEND_TOOL])
    expect(canFrom({ [SEND_TOOL]: { decision: 'allow', rule: SEND_TOOL } })).toEqual(['send'])
    // A mode that allows it with no rule (bypass) counts too: the verdict is what counts, not the rule.
    expect(canFrom({ [SEND_TOOL]: { decision: 'allow' } })).toEqual(['send'])
    // Auto mode with no rule: the check answers ask (its decider is the classifier, which denies a send by code).
    expect(canFrom({ [SEND_TOOL]: { decision: 'ask' } })).toEqual([])
    expect(canFrom({ [SEND_TOOL]: { decision: 'deny', reason: 'no' } })).toEqual([])
    expect(canFrom({ [SEND_TOOL]: null })).toEqual([])
    // Beside the others, in the order CAN_TOOLS names them.
    expect(canFrom({ [MODEL_TOOL]: { decision: 'allow' }, [EFFORT_TOOL]: { decision: 'allow' }, [SEND_TOOL]: { decision: 'allow' } })).toEqual(['set', 'send'])
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

  // B769: a worker the person removed.
  test('a remove job names the worker and its app id when it has one; one without a plain name is left out', () => {
    const text = JSON.stringify({ jobs: [{ id: 'm1', to: 'local_w5', chat: 'Worker 5', remove: true }, { id: 'm2', chat: 'Worker 6', remove: true }, { id: 'm3', to: 'cli-x', chat: 'Worker 7', remove: true }, { id: 'm4', remove: true }] })
    expect(parseJobs(text)).toEqual([
      { id: 'm1', to: 'local_w5', chat: 'Worker 5', remove: true },
      { id: 'm2', chat: 'Worker 6', remove: true },
      { id: 'm3', chat: 'Worker 7', remove: true },
    ])
  })

  // B847: an older chat of a worker that a newer run of its routine replaced.
  test('an archive job needs the app id of the chat to close and carries no list change', () => {
    const text = JSON.stringify({ jobs: [{ id: 'archive:local_old', to: 'local_old', chat: 'Worker 1', archive: true }, { id: 'archive:x', to: 'cli-x', chat: 'Worker 1', archive: true }, { id: 'archive:y', chat: 'Worker 1', archive: true }] })
    expect(parseJobs(text)).toEqual([{ id: 'archive:local_old', to: 'local_old', chat: 'Worker 1', archive: true }])
  })

  // B880 (X2): Worker 2's hand held the Product owner's start word for half an hour: its call never answered, then failed when
  // the process lost its session. Now a call that does not answer in time, or finds no session, gives the word back.
  const NO_SESSION = '$.tool.call is not available in this mode: no session is bound in this process (the REPL has not mounted and no headless session is built); catch it and carry on'
  const never = new Promise<never>(() => undefined)

  test('a call that answers in time is its result; one that does not gives the word back, and may still answer late', async () => {
    expect(HAND_CALL_MS).toBe(120_000)
    expect(await raceJob('a', Promise.resolve({ id: 'a', ok: true }), never)).toEqual({ result: { id: 'a', ok: true }, hung: false, noSession: false })
    expect(await raceJob('b', never, Promise.resolve())).toEqual({ result: { id: 'b', ok: false, back: true, doubt: true, why: NO_ANSWER_WHY }, hung: true, noSession: false })
  })

  test('a call that finds no session gives the word back unsent; any other failure is the job\'s own, with its why', async () => {
    expect(isNoSession(new Error(`workers: ${NO_SESSION}`))).toBe(true)
    expect(isNoSession(new Error('Scheduled task "x" not found'))).toBe(false)
    expect(await raceJob('c', Promise.reject(new Error(NO_SESSION)), never)).toEqual({ result: { id: 'c', ok: false, back: true, why: NO_SESSION_WHY }, hung: false, noSession: true })
    expect(await raceJob('d', Promise.reject(new Error('Scheduled task "x" not found')), never)).toEqual({ result: { id: 'd', ok: false, why: 'Scheduled task "x" not found' }, hung: false, noSession: false })
  })

  // B891: the board reads a word given back with "gave no answer" in its why as in doubt (a B880 mod sends no doubt flag); one
  // never called, or with no session, must not read so, or it would wait 5 minutes for nothing.
  test('only a call with no answer gives its word back in doubt: by its flag and by its why', () => {
    expect(/gave no answer/.test(NO_ANSWER_WHY)).toBe(true)
    expect(/gave no answer/.test(NOT_TRIED_WHY)).toBe(false)
    expect(/gave no answer/.test(NO_SESSION_WHY)).toBe(false)
  })

  test('a process claims no job while one of its calls hangs, nor for a while after it found no session', () => {
    expect(mayClaim({ hung: 0, offUntil: -Infinity, now: 5 })).toBe(true)
    expect(mayClaim({ hung: 1, offUntil: -Infinity, now: 5 })).toBe(false)
    expect(mayClaim({ hung: 0, offUntil: 10, now: 5 })).toBe(false)
    expect(mayClaim({ hung: 0, offUntil: 10, now: 10 })).toBe(true)
  })
})
