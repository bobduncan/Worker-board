import { describe, expect, test } from 'claude-code/testing'
import { clearRun } from './clearrun'

// B944, the real case of 2026-11-02 (X134, X135), in its own shapes. The board's outbox (data/outbox.jsonl):
//   955de88090a1e619 to Worker 3, "Clear after B936", out 21:25:37, failed 21:27:38 "/clear did not run within two minutes"
//   222565056cfa2658 to Worker 4, "Clear after B940", out 21:31:02, failed 21:33:08 "/clear did not run within two minutes"
// The chats' transcripts (4e33f446, 6c9f4a15): the /clear ran 8 to 19 ms after it was queued and the mod answered
//   "Not cleared: this /clear of the Workers mod was let go before it ran." (21:25:26.826, 21:25:38.325, 21:31:03.973);
//   at 21:25:27.956 Worker 3's next turn dropped the clear (fd9624e869214e0b, "a new turn started before the clear ran"):
//   it was still on its way when its /clear was refused. Both chats idle, nothing typed in between.
const W3 = '4e33f446-57d9-4f5d-9964-a9aa7e93fd66'
const W4 = '6c9f4a15-a792-4a69-8b17-5dc04f935adb'
const IDLE = { isInTurn: false }

describe('B944: a /clear of the mod runs the clear on its way, whatever the order of its queue', () => {
  test('the real case, Worker 4 at 21:31: a ticket of an earlier /clear stands before the clear\'s own: it runs, and both are used up', () => {
    // Out of step: ticket 7 (a /clear the module never saw) before ticket 8, the clear decided at the turn's end.
    const decided = { from: W4, ticket: 8, prompts: 3, turn: 5 }
    expect(clearRun([7, 8], decided, { session: W4, ...IDLE, prompts: 3, turn: 5 })).toEqual({ verdict: 'run', left: [] })
  })

  test('the real case, Worker 3 at 21:25: the queue holds no ticket for the /clear the engine runs: it runs all the same', () => {
    const decided = { from: W3, ticket: 12, prompts: 9, turn: 9 }
    expect(clearRun([], decided, { session: W3, ...IDLE, prompts: 9, turn: 9 })).toEqual({ verdict: 'run', left: [] })
  })

  test('without the queue out of step: the clear\'s own /clear runs it, as before', () => {
    const decided = { from: W4, ticket: 3, prompts: 1, turn: 1 }
    expect(clearRun([3], decided, { session: W4, ...IDLE, prompts: 1, turn: 1 })).toEqual({ verdict: 'run', left: [] })
  })

  test('a /clear while a turn runs, or after a prompt or a turn came in, does not run it: dropped, as before', () => {
    const decided = { from: W4, ticket: 3, prompts: 1, turn: 1 }
    expect(clearRun([3], decided, { session: W4, isInTurn: true, prompts: 1, turn: 1 }).verdict).toBe('late')
    expect(clearRun([3], decided, { session: W4, ...IDLE, prompts: 2, turn: 1 }).verdict).toBe('late')
    expect(clearRun([2, 3], decided, { session: W4, ...IDLE, prompts: 1, turn: 2 })).toEqual({ verdict: 'late', left: [] })
  })

  test('a clear decided on another session (the chat was cleared already) never clears the fresh conversation', () => {
    const decided = { from: W3, ticket: 3, prompts: 1, turn: 1 }
    expect(clearRun([3], decided, { session: W4, ...IDLE, prompts: 1, turn: 1 })).toEqual({ verdict: 'moved', left: [] })
  })

  test('no clear on its way: refused, and only the oldest ticket goes; a later ticket than the clear\'s stays', () => {
    expect(clearRun([4, 5], null, { session: W4, ...IDLE, prompts: 1, turn: 1 })).toEqual({ verdict: 'none', left: [5] })
    expect(clearRun([], null, { session: W4, ...IDLE, prompts: 1, turn: 1 })).toEqual({ verdict: 'none', left: [] })
    expect(clearRun([3, 4], { from: W4, ticket: 3, prompts: 1, turn: 1 }, { session: W4, ...IDLE, prompts: 1, turn: 1 })).toEqual({ verdict: 'run', left: [4] })
  })
})
