import { describe, expect, test } from 'claude-code/testing'

import { EFFORT_TOOL, HANDS_DONE_PATH, HANDS_PATH, MODEL_TOOL, SEND_TOOL, canSetFrom, parseJobs, sendResult, setResult } from './hands'

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

  test('code may set only where the app allows both tools with no question', () => {
    expect(canSetFrom([{ decision: 'allow' }, { decision: 'allow' }])).toBe(true)
    expect(canSetFrom([{ decision: 'allow' }, { decision: 'ask' }])).toBe(false)
    expect(canSetFrom([{ decision: 'allow' }, null])).toBe(false)
    expect(canSetFrom([])).toBe(false)
  })
})
