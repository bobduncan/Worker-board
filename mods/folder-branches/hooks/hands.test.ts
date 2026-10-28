import { describe, expect, test } from 'claude-code/testing'

import { HANDS_DONE_PATH, HANDS_PATH, SEND_TOOL, parseJobs, sendResult } from './hands'

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
})
