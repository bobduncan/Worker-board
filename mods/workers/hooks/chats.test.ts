import { describe, expect, test } from 'claude-code/testing'

import type { BoardReading, BoardStatus, ChatFile, ChatTask } from '../types'
import {
  LEFT_MAX_SIZE, LEFT_TEXT, STALE_MS, afterTurn, asksPerson, atTurnStart, chatLine, chatNote, compactKeep, compactWhy, chatText, chatsSummary, fileName, foldersAbove, hasLeft,
  isAgentId, nameFromTitle, orderChats, parseChat, parseList, sessionOf, status, timeText, uniqueByName, withDone, withPlan,
  withSend, withState, withStep, workCard, instructionsLine, isFiled, openFrom, personsWords, recordedLine,
  clearWhy, clearedStart, movedText, roleFrom, unfiledAsk, isOlderMod, modNote,
  STATUS_FRESH_MS, boardReading, heldText, isOwnerChat, lineOf, roleOrOwner, statusLabel, statusMark,
} from './chats'

const MIN = 60000
const NOW = 1_000_000_000

const task = (text: string, step = 0, steps = 0, minutes: number | null = null): ChatTask => (
  { text, step, steps, left: minutes === null ? null : minutes * MIN, isReported: false }
)

/** A chat whose file was written a moment ago. */
const chat = (name: string, state: ChatFile['state'], of: ChatTask | null = null, role: ChatFile['role'] = 'worker'): ChatFile => (
  { name, role, state, task: of, at: NOW - 1000 }
)

describe('what a chat is shown as', () => {
  test('the four lines the person asked for', () => {
    const all = [
      chat('Main', 'waiting', null, 'main'),
      chat('Units', 'working', task('Skeleton Archer', 3, 5, 40)),
      chat('Features', 'waiting', task('Logging', 1, 4, 30)),
      chat('Levels', 'working'),
      chat('Cleanup', 'waiting'),
    ]
    const line = (name: string): string => chatLine(all.find(c => c.name === name) as ChatFile, all, NOW)
    expect(line('Main')).toBe('◆ Main  waiting for 3 workers')
    expect(line('Units')).toBe('● Units  Skeleton Archer · 3 of 5 · ~40 min')
    expect(line('Features')).toBe('◐ Features  your turn · Logging · 1 of 4')
    expect(line('Cleanup')).toBe('○ Cleanup  free')
    // A turn that runs before its chat recorded a task.
    expect(line('Levels')).toBe('● Levels  working')
    expect(chatsSummary(all.map((c, i) => ({ ...c, id: String(i) })), NOW).split('\n')[0]).toBe('◆ Main  waiting for 3 workers')
    expect(chatsSummary([], NOW)).toBe('No chat is in the list yet.')
  })

  test('a task without a plan shows its name alone, and a question to the person is their turn', () => {
    const named = chat('Units', 'working', task('Skeleton Archer'))
    expect(chatLine(named, [named], NOW)).toBe('● Units  Skeleton Archer')
    const asking = chat('Units', 'asking', task('Skeleton Archer', 2, 5, 20))
    expect(chatLine(asking, [asking], NOW)).toBe('◐ Units  your turn · Skeleton Archer · 2 of 5')
    expect(status(asking, [asking], NOW).isYours).toBe(true)
    const main = chat('Main', 'working', null, 'main')
    expect(chatLine(main, [main], NOW)).toBe('◆ Main  working')
    expect(chatLine({ ...main, state: 'asking' }, [main], NOW)).toBe('◐ Main  your turn')
    expect(chatLine({ ...main, state: 'waiting' }, [main], NOW)).toBe('◆ Main  free')
    const one = [chat('Main', 'waiting', null, 'main'), chat('Units', 'working')]
    expect(chatLine(one[0] as ChatFile, one, NOW)).toBe('◆ Main  waiting for 1 worker')
  })

  test('B738: a chat the board shows as not running reads "Not running", one that waits for the person does not', () => {
    const free = chat('Units', 'waiting')
    const main = chat('Main', 'waiting', null, 'main')
    const busy = chat('Cleanup', 'working')
    const all = [main, free, busy]
    // The board's verdict, whatever its why (ended, app restarted, silent): the same word as the page.
    expect(chatLine(free, all, NOW, ['Units'])).toBe('○ Units  Not running')
    expect(chatLine(main, all, NOW, ['Main'])).toBe('○ Main  Not running')
    expect(chatsSummary(all.map((c, i) => ({ ...c, id: String(i) })), NOW, ['Units']).split('\n')).toContain('○ Units  Not running')
    // Unknown (the board did not name it, or did not answer): as the files say.
    expect(chatLine(free, all, NOW, [])).toBe('○ Units  free')
    expect(chatLine(free, all, NOW)).toBe('○ Units  free')
    expect(chatLine(main, all, NOW, ['Units'])).toBe('◆ Main  waiting for 1 worker')
    // A worker with its task open still waits for the person; a turn that runs is running, whatever the board's last answer.
    const waits = { ...chat('Units', 'waiting', task('Skeleton Archer', 2, 5, 20)), at: NOW - STALE_MS - 1 }
    expect(chatLine(waits, [waits], NOW, ['Units'])).toBe('◐ Units  your turn · Skeleton Archer · 2 of 5')
    expect(chatLine(busy, all, NOW, ['Cleanup'])).toBe('● Cleanup  working')
  })

  test('a turn that stopped writing is taken as ended', () => {
    const gone = { ...chat('Units', 'working', task('Skeleton Archer', 3, 5, 40)), at: NOW - STALE_MS - 1 }
    expect(chatLine(gone, [gone], NOW)).toBe('◐ Units  your turn · Skeleton Archer · 3 of 5')
    expect(chatLine({ ...gone, task: null }, [gone], NOW)).toBe('○ Units  free')
  })

  test('the expected time is rough, and counts down while the chat works', () => {
    expect(timeText(40 * MIN)).toBe('~40 min')
    expect(timeText(42 * MIN)).toBe('~40 min')
    expect(timeText(7.2 * MIN)).toBe('~8 min')
    expect(timeText(0.5 * MIN)).toBe('<1 min')
    expect(timeText(0)).toBe('over time')
    expect(timeText(95 * MIN)).toBe('~1.5 h')
    expect(timeText(180 * MIN)).toBe('~3 h')
    // Between two writes of its file a working chat's time goes on.
    const working = { ...chat('Units', 'working', task('Archer', 1, 2, 10)), at: NOW - 30000 }
    expect(chatLine(working, [working], NOW)).toBe('● Units  Archer · 1 of 2 · ~10 min')
    expect(chatLine(working, [working], NOW + 60000)).toBe('● Units  Archer · 1 of 2 · ~9 min')
  })
})

describe('B570: the Workers mod each chat runs', () => {
  test('a card keeps its version; the list says it, and that an older one is restarted after its step or when asked', () => {
    const lead = { ...chat('Main', 'waiting', null, 'main'), mod: '0.17.0' }
    const busy = { ...chat('Units', 'working', task('Archer', 1, 3, 20)), mod: '0.16.1' }
    const idle = { ...chat('Levels', 'waiting'), mod: '0.16.1' }
    const unsaid = chat('Cleanup', 'waiting')
    const all = [lead, busy, idle, unsaid]
    expect(parseChat(chatText(busy))?.mod).toBe('0.16.1')
    expect(parseChat(JSON.stringify({ ...idle, mod: 'new!' }))?.mod).toBeUndefined()
    expect(modNote(lead, all, NOW)).toBe('mod 0.17.0')
    expect(modNote(busy, all, NOW)).toBe('mod 0.16.1 · restarts after its step')
    expect(modNote(idle, all, NOW)).toBe('mod 0.16.1 · restarts when the board asks')
    expect(modNote(unsaid, all, NOW)).toBeNull()
    // All on one version: nothing to say.
    expect(modNote(lead, [lead, { ...idle, mod: '0.17.0' }, unsaid], NOW)).toBeNull()
    expect(chatLine(busy, all, NOW)).toBe('● Units  Archer · 1 of 3 · ~20 min  (mod 0.16.1 · restarts after its step)')
    expect(chatLine(lead, all, NOW)).toBe('◆ Main  waiting for 1 worker')
    // Compared as numbers, not as text.
    expect(isOlderMod('0.9.9', '0.10.0')).toBe(true)
    expect(isOlderMod('0.10', '0.10.0')).toBe(false)
  })
})

describe('what a chat writes into its file', () => {
  test('working time is taken off the expected time; waiting and asking time is not', () => {
    const start = { ...chat('Units', 'working', task('Archer', 1, 3, 10)), at: NOW }
    const later = withState(start, 'working', NOW + 2 * MIN - 1)
    expect(later.task?.left).toBe(8 * MIN + 1)
    expect(later.at).toBe(NOW + 2 * MIN - 1)
    // A turn that stopped writing long ago (the app was closed) costs two minutes at most.
    expect(withState(start, 'waiting', NOW + 600 * MIN).task?.left).toBe(10 * MIN - STALE_MS)
    const asking = withState(start, 'asking', NOW)
    expect(withState(asking, 'working', NOW + 30 * MIN).task?.left).toBe(10 * MIN)
    const idle = withState(start, 'waiting', NOW)
    expect(withState(idle, 'working', NOW + 30 * MIN).task?.left).toBe(10 * MIN)
    // It never goes below nothing, and a task without a time stays without one.
    expect(withState({ ...start, task: task('Archer', 1, 3, 1) }, 'working', NOW + 90000).task?.left).toBe(0)
    expect(withState({ ...start, task: task('Archer') }, 'working', NOW + 90000).task?.left).toBeNull()
  })

  test('a plan: first the name, then the steps and the time; a new name is a new task', () => {
    const free = chat('Units', 'working')
    const named = withPlan(free, { text: '  Skeleton Archer ' })
    expect(named.chat?.task).toEqual(task('Skeleton Archer'))
    const planned = withPlan(named.chat as ChatFile, { steps: 5, minutes: 40 })
    expect(planned.chat?.task).toEqual(task('Skeleton Archer', 1, 5, 40))
    // The plan changes while it is on step 3: the step stays, the rest follows.
    const onThree = { ...(planned.chat as ChatFile), task: task('Skeleton Archer', 3, 5, 12) }
    expect(withPlan(onThree, { steps: 6 }).chat?.task).toEqual(task('Skeleton Archer', 3, 6, 12))
    expect(withPlan(onThree, { steps: 2, minutes: 5 }).chat?.task).toEqual(task('Skeleton Archer', 2, 2, 5))
    expect(withPlan(onThree, { text: 'Shadow Beast', steps: 4 }).chat?.task).toEqual(task('Shadow Beast', 1, 4))
    // All in one call works too.
    expect(withPlan(free, { text: 'Logging', steps: 4, minutes: 30 }).chat?.task).toEqual(task('Logging', 1, 4, 30))
    expect(withPlan(free, { steps: 4 }).error).toContain('"text"')
    expect(withPlan(free, { text: 'x', steps: 0 }).error).toContain('"steps"')
    expect(withPlan(free, { text: 'x', minutes: -3 }).error).toContain('"minutes"')
  })

  test('a step: the next one, or the one named, never past the last', () => {
    const planned = chat('Units', 'working', task('Skeleton Archer', 1, 3, 30))
    const second = withStep(planned, {})
    expect(second.chat?.task).toEqual(task('Skeleton Archer', 2, 3, 30))
    const third = withStep(second.chat as ChatFile, { minutes: 8 })
    expect(third.chat?.task).toEqual(task('Skeleton Archer', 3, 3, 8))
    expect(withStep(third.chat as ChatFile, {}).chat?.task?.step).toBe(3)
    expect(withStep(planned, { step: 3 }).chat?.task?.step).toBe(3)
    expect(withStep(planned, { step: 9 }).chat?.task?.step).toBe(3)
    expect(withStep(chat('Units', 'working', task('Skeleton Archer')), {}).error).toContain('"plan"')
    expect(withStep(chat('Units', 'working'), {}).error).toContain('"plan"')
  })

  test('the task clears by itself when the turn that reported it ends', () => {
    const planned = chat('Units', 'working', task('Skeleton Archer', 3, 3, 5))
    const reported = withSend(planned)
    expect(reported.task?.isReported).toBe(true)
    expect(afterTurn(reported, 'answer').task).toBeNull()
    // Interrupted, the report may not have been the end of it.
    expect(afterTurn(reported, 'aborted').task?.text).toBe('Skeleton Archer')
    // Tidying its line after the report (the last step, a closing estimate) does not take the report back.
    expect(afterTurn(withStep(reported, {}).chat as ChatFile, 'answer').task).toBeNull()
    expect(afterTurn(withPlan(reported, { minutes: 10 }).chat as ChatFile, 'answer').task).toBeNull()
    // A new task recorded in the same turn is not the one that was reported.
    expect(afterTurn(withPlan(reported, { text: 'Shadow Beast' }).chat as ChatFile, 'answer').task?.text).toBe('Shadow Beast')
    expect(afterTurn(planned, 'answer').task?.text).toBe('Skeleton Archer')
    expect(withSend(chat('Main', 'working', null, 'main')).task).toBeNull()
    expect(withDone(planned).task).toBeNull()
  })

  test('a file is read back as it was written, and anything else is no chat', () => {
    const planned = chat('Units', 'working', task('Skeleton Archer', 3, 5, 40))
    expect(parseChat(chatText(planned))).toEqual(planned)
    expect(parseChat(chatText(chat('Main', 'waiting', null, 'main')))?.role).toBe('main')
    // A task line of the first draft was plain text.
    expect(parseChat('{"name":"Units","role":"worker","state":"waiting","task":"Wizard","at":5}')?.task).toEqual(task('Wizard'))
    expect(parseChat('{"name":"Units","task":{"text":"Wizard","step":7,"steps":3,"left":-5}}')?.task).toEqual(
      { text: 'Wizard', step: 3, steps: 3, left: 0, isReported: false },
    )
    for (const text of ['', 'not json', '[]', '{"name":""}', '{"prefix":"Game - ","main":"Main"}']) expect(parseChat(text)).toBeNull()
    expect(fileName('eebcda86-77c4')).toBe('eebcda86-77c4.json')
    expect(sessionOf('eebcda86-77c4.json')).toBe('eebcda86-77c4')
    expect(sessionOf('list.json')).toBeNull()
    expect(sessionOf('notes.txt')).toBeNull()
  })
})

describe('which chats are in the list', () => {
  test('a chat joins by its title when the project says which titles are its chats', () => {
    const list = parseList('{ "prefix": "Game - ", "main": "Main" }')
    expect(list).toEqual({ prefix: 'Game - ', main: 'Main', compactAbove: 250000, afterStep: 'compact', compactAtRest: true })
    if (list === null) return
    expect(nameFromTitle('Game - Units', list)).toEqual({ name: 'Units', role: 'worker' })
    expect(nameFromTitle('Game - Levels / Environment', list)).toEqual({ name: 'Levels / Environment', role: 'worker' })
    expect(nameFromTitle('game - main', list)).toEqual({ name: 'main', role: 'main' })
    expect(nameFromTitle('Web folder organization', list)).toBeNull()
    expect(nameFromTitle('Game - ', list)).toBeNull()
    expect(parseList('{ "prefix": "Game - " }')).toEqual({ prefix: 'Game - ', main: 'Main', compactAbove: 250000, afterStep: 'compact', compactAtRest: true })
    for (const text of ['', '{}', '{ "prefix": "" }', 'nope']) expect(parseList(text)).toBeNull()
  })

  test('a name is one chat\'s: of several files under it, the one written last', () => {
    const old = { ...chat('Units', 'waiting', task('Wizard', 2, 3, 5)), at: 10 }
    const now = { ...chat('units', 'working'), at: 20 }
    const other = chat('Features', 'waiting')
    expect(uniqueByName([old, other, now])).toEqual([other, now])
    expect(uniqueByName([now, old])).toEqual([now])
    expect(uniqueByName([])).toEqual([])
    // The file of a chat that left is told by its size, and read as no chat.
    expect(hasLeft(LEFT_TEXT)).toBe(true)
    expect(LEFT_TEXT.length).toBeLessThanOrEqual(LEFT_MAX_SIZE)
    expect(chatText(chat('A', 'waiting')).length).toBeGreaterThan(LEFT_MAX_SIZE)
    expect(parseChat(LEFT_TEXT)).toBeNull()
    for (const text of ['', '{}', 'nope', chatText(old)]) expect(hasLeft(text)).toBe(false)
  })

  test('an agent a chat started itself is told from another chat by its id', () => {
    for (const id of ['a99695cdbace47f46', 'ab231a91dca4ce74d', 'a1b2c3d4e-77c4']) expect(isAgentId(id)).toBe(true)
    for (const name of ['Game - Main', 'local_84e3310d-5c34-43b7-a5f4-d59006c1d556', 'archer', 'a team', '']) expect(isAgentId(name)).toBe(false)
  })

  test('the main chat comes first, then the workers by name', () => {
    const rows = [chat('Units', 'waiting'), chat('cleanup', 'waiting'), chat('Main', 'waiting', null, 'main'), chat('Features', 'waiting')]
    expect(orderChats(rows).map(r => r.name)).toEqual(['Main', 'cleanup', 'Features', 'Units'])
  })

  test('the list is looked for in the folder of the session and each folder above it', () => {
    expect(foldersAbove('D:\\Work\\project\\game')).toEqual(['D:\\Work\\project\\game', 'D:\\Work\\project', 'D:\\Work', 'D:'])
    expect(foldersAbove('/home/me/app/')).toEqual(['/home/me/app', '/home/me', '/home', ''])
    expect(foldersAbove('\\\\server\\share\\app')).toEqual(['\\\\server\\share\\app'])
  })

  test('a plan names its steps: their count is the number of steps, and the names are kept short', () => {
    const named = withPlan(chat('Units', 'working'), { text: 'Skeleton Archer', names: [' Cut the sheet ', 'Wire the walk', 'Check in game'], minutes: 40 }).chat
    expect(named?.task).toEqual({ text: 'Skeleton Archer', step: 1, steps: 3, left: 40 * MIN, isReported: false, names: ['Cut the sheet', 'Wire the walk', 'Check in game'] })
    // Read back from its file as it was written.
    expect(parseChat(chatText(named as ChatFile))?.task).toEqual(named?.task)
    // The next step keeps the names; a new count without names drops them, and so does a new task.
    const stepped = withStep(named as ChatFile, { minutes: 25 }).chat
    expect(stepped?.task?.names).toEqual(['Cut the sheet', 'Wire the walk', 'Check in game'])
    expect(stepped?.task?.step).toBe(2)
    expect(withPlan(stepped as ChatFile, { steps: 5 }).chat?.task?.names).toBeUndefined()
    // The same count again, with a new time, keeps them.
    expect(withPlan(stepped as ChatFile, { steps: 3, minutes: 12 }).chat?.task?.names).toEqual(['Cut the sheet', 'Wire the walk', 'Check in game'])
    expect(withPlan(stepped as ChatFile, { text: 'Red Mage' }).chat?.task?.names).toBeUndefined()
    // Names that are no names are refused, with the reason.
    expect(withPlan(chat('Units', 'working'), { text: 'X', names: [] }).error).toContain('"names"')
    expect(withPlan(chat('Units', 'working'), { text: 'X', names: ['ok', ''] }).error).toContain('"names"')
    expect(withPlan(chat('Units', 'working'), { text: 'X', names: Array.from({ length: 21 }, (_v, i) => `step ${i}`) }).error).toContain('"names"')
    // A long name is cut, not refused.
    expect(withPlan(chat('Units', 'working'), { text: 'X', names: ['y'.repeat(200)] }).chat?.task?.names?.[0]?.length).toBe(80)
  })

  test('the main chat\'s card shows while it works; idle, the line says who it waits for', () => {
    const main = chat('Main', 'working', task('Hand out the knight', 2, 3, 10), 'main')
    expect(chatLine(main, [main], NOW)).toBe('◆ Main  Hand out the knight · 2 of 3 · ~10 min')
    expect(chatLine({ ...main, state: 'waiting' }, [main], NOW)).toBe('◆ Main  free')
  })

  test('a report clears the card whatever step it stands on; a note or a question leaves it', () => {
    // A worker that did all its steps without moving the card on, and then reported: it is done.
    expect(afterTurn(withSend(chat('Units', 'working', task('Skeleton Archer', 1, 3, 20))), 'answer').task).toBeNull()
    // A note or a question in the middle of the task: the card stays. It asked another chat, so it is not the
    // person it waits for; when its next turn starts, that is over.
    const middle = chat('Units', 'working', task('Skeleton Archer', 2, 5, 20))
    const after = afterTurn(middle, 'answer', { asked: true })
    expect(after.task).toEqual({ ...task('Skeleton Archer', 2, 5, 20), asked: true })
    expect(afterTurn(middle, 'answer').task).toEqual(task('Skeleton Archer', 2, 5, 20))
    expect(afterTurn(middle, 'aborted', { asked: true }).task).toEqual(task('Skeleton Archer', 2, 5, 20))
    expect(chatLine({ ...after, state: 'waiting' }, [after], NOW)).toBe('◌ Units  waits for another chat · Skeleton Archer · 2 of 5')
    expect(withState({ ...after, state: 'waiting' }, 'working', NOW).task).toEqual(task('Skeleton Archer', 2, 5, 20))
  })

  test('a report from a turn that was cut short does not count for the next turn', () => {
    const reported = withSend(chat('Units', 'working', task('Skeleton Archer', 2, 5, 20)))
    // Interrupted after the report: the card stays, as before.
    const cut = afterTurn(reported, 'aborted')
    expect(cut.task?.isReported).toBe(true)
    // The next turn starts unreported, so a turn that only asks somebody something does not clear the card.
    const next = atTurnStart(cut)
    expect(next?.task?.isReported).toBe(false)
    expect(afterTurn(next as ChatFile, 'answer', { asked: true }).task?.text).toBe('Skeleton Archer')
    // Nothing to change for a card that was not reported, or for no card.
    expect(atTurnStart(chat('Units', 'waiting', task('Archer', 1, 3, 10)))).toBeNull()
    expect(atTurnStart(chat('Units', 'waiting'))).toBeNull()
  })

  test('the step a chat is on has a time of its own, beside the time for the whole task', () => {
    const planned = withPlan(chat('Units', 'waiting'), { text: 'Skeleton Archer', names: ['Cut', 'Wire', 'Check'], minutes: 40, stepMinutes: 12 }).chat as ChatFile
    expect(planned.task).toEqual({ ...task('Skeleton Archer', 1, 3, 40), names: ['Cut', 'Wire', 'Check'], stepLeft: 12 * MIN })
    expect(parseChat(chatText(planned))?.task).toEqual(planned.task)
    // It counts down with the work, as the whole time does, and never under nothing.
    const worked = withState({ ...planned, state: 'working', at: NOW - 5 * MIN }, 'working', NOW)
    expect([worked.task?.left, worked.task?.stepLeft]).toEqual([38 * MIN, 10 * MIN])
    // The next step has its own time, or none until one is given; the whole time stays as it is.
    expect(withStep(planned, { stepMinutes: 20 }).chat?.task).toEqual({ ...task('Skeleton Archer', 2, 3, 40), names: ['Cut', 'Wire', 'Check'], stepLeft: 20 * MIN })
    expect(withStep(planned, {}).chat?.task?.stepLeft).toBeUndefined()
    // Given again for the step it is on, without moving on.
    expect(withPlan(planned, { stepMinutes: 3 }).chat?.task).toEqual({ ...task('Skeleton Archer', 1, 3, 40), names: ['Cut', 'Wire', 'Check'], stepLeft: 3 * MIN })
    expect(withPlan(planned, { stepMinutes: 0 }).error).toContain('"stepMinutes"')
    expect(withStep(planned, { stepMinutes: 5000 }).error).toContain('"stepMinutes"')
  })

  test('B301: what the compaction after a report keeps names the steps of the store, not a hand-over', () => {
    const keep = compactKeep('Game - Units', 'Game - Main')
    expect(keep).toContain('every step the store holds for it that it has not reported yet')
    expect(keep).not.toContain('hand-over')
  })

  test('a chat in the list is told how to keep its line', () => {
    const worker = chatNote(chat('Units', 'working'), 'mcp__workers__chat')
    for (const part of ['"Units"', 'mcp__workers__chat', '"plan"', '"step"', 'worker']) expect(worker).toContain(part)
    const main = chatNote(chat('Main', 'working', null, 'main'), 'mcp__workers__chat')
    expect(main).toContain('You are the main chat')
    // Every chat keeps a card, the main chat too, and is told to send it along with a call it makes anyway.
    for (const note of [worker, main]) {
      for (const part of ['"plan"', '"names"', '"minutes"', '"stepMinutes"', '"step"', 'at the start of every request', 'never as a step of their own', 'survives a compaction']) expect(note).toContain(part)
    }
    // B301: a step ends with the work tool's report, never with a message. 2026-10-28: the board hands every step out
    // itself (its redesign's Part 2); the work tool has no queue, so the main chat is not told to queue.
    expect(worker).toContain('clears by itself when you report your step with mcp__workers__work action "report"')
    expect(worker).toContain('no message to another chat clears it or ends a step')
    expect(worker).not.toContain('Report from')
    expect(main).toContain('The board hands every step to a free worker itself')
    expect(main).not.toContain('action "queue"')
    expect(main).toContain('no message carries a task')
    expect(main).not.toContain('Task from')
    // B297: one line names the work tool, and that the flow file says who moves an item.
    for (const note of [worker, main]) for (const part of ['mcp__workers__work', '"next"', 'flow file']) expect(note).toContain(part)
    // The note is part of the system prompt: it reads the same whatever the chat is doing.
    expect(chatNote(chat('Units', 'waiting', task('Archer', 2, 3, 10)), 'mcp__workers__chat')).toBe(worker)
  })
})

describe('a large chat is compacted after it reported its task', () => {

  test('it is compacted only when it is large, at rest, and no more of the same work follows', () => {
    const at = { tokens: 400_000, above: 250_000, moreFollows: false }
    expect(compactWhy(chat('Units', 'waiting'), at)).toBeNull()
    expect(compactWhy(chat('Units', 'waiting'), { ...at, tokens: 200_000 })).toContain('small')
    expect(compactWhy(chat('Units', 'waiting'), { ...at, above: 0 })).toContain('off')
    expect(compactWhy(chat('Units', 'waiting'), { ...at, moreFollows: true })).toContain('follows')
    expect(compactWhy(chat('Units', 'waiting'), { ...at, tokens: null })).toContain('size')
    // Its last task is not reported: it is in the middle of something. (B227: a question to the person does not count.)
    expect(compactWhy(chat('Units', 'waiting', task('Archer', 2, 3, 10)), at)).toContain('task')
    // Clear after each step: the main chat and the partners are compacted at rest above the threshold, whatever their card
    // says of a task; never below it, nor when the list switches it off.
    expect(compactWhy(chat('Main', 'waiting', task('Hand out the week', 1, 3, 10), 'main'), { ...at, moreFollows: true })).toBeNull()
    expect(compactWhy(chat('Main', 'waiting', null, 'main'), { ...at, tokens: 140_000, above: 150_000 })).toContain('small')
    expect(compactWhy(chat('Main', 'waiting', null, 'main'), { ...at, above: 0 })).toContain('off')
    expect(compactWhy(chat('Advisor', 'waiting', task('B480 passed', 1, 2, 10)), { ...at, role: 'advisor' })).toBeNull()
    expect(compactWhy(chat('Advisor 2', 'waiting', task('Refine B9', 1, 2, 10)), { ...at, role: 'helper' })).toBeNull()
    // The Product owner is compacted at rest as the advisor is: above the threshold, never held back by a task or more work.
    expect(compactWhy(chat('PO', 'waiting', task('Brainstorm G7', 1, 2, 10)), { ...at, role: 'owner' })).toBeNull()
    expect(compactWhy(chat('PO', 'waiting'), { ...at, role: 'owner', moreFollows: true })).toBeNull()
    expect(compactWhy(chat('PO', 'waiting'), { ...at, role: 'owner', tokens: 200_000 })).toBe('it is small enough')
    expect(compactWhy(chat('PO', 'waiting'), { ...at, role: 'owner', above: 0 })).toBe('switched off in the list of chats')
    // A worker the list says to leave alone after its step.
    expect(compactWhy(chat('Units', 'waiting'), { ...at, afterStep: 'off' })).toContain('off')
  })

  test('the list says what becomes of a worker after its step: clear, compact (the default) or off', () => {
    expect(parseList('{"prefix":"Game - ","main":"Main","afterStep":"clear"}')?.afterStep).toBe('clear')
    expect(parseList('{"prefix":"Game - ","main":"Main","afterStep":"off"}')?.afterStep).toBe('off')
    for (const value of ['"compact"', '"Clear"', '1', 'null']) expect(parseList(`{"prefix":"Game - ","main":"Main","afterStep":${value}}`)?.afterStep).toBe('compact')
    // Review 10: the main chat's and the partners' compaction at rest has its own off switch; on unless it says false.
    expect(parseList('{"prefix":"Game - ","main":"Main","compactAtRest":false}')?.compactAtRest).toBe(false)
    for (const value of ['true', '0', '"no"', 'null']) expect(parseList(`{"prefix":"Game - ","main":"Main","compactAtRest":${value}}`)?.compactAtRest).toBe(true)
  })

  test('the main chat and the partners are told to keep what their roles need, a worker what its next step needs', () => {
    const worker = compactKeep('Game - Units', 'Game - Main')
    expect(worker).toBe(compactKeep('Game - Units', 'Game - Main', 'worker'))
    const main = compactKeep('Game - Main', 'Game - Main', 'main')
    expect(main).toContain('the main chat of a project')
    expect(main).toContain('every worker by name')
    expect(main).toContain('"1 yes, 2 no"')
    const partner = compactKeep('Game - Advisor', 'Game - Main', 'advisor')
    expect(partner).toContain('the focus goal')
    expect(partner).toContain('roles/partner.md')
    const helper = compactKeep('Game - Advisor 2', 'Game - Main', 'helper')
    expect(helper).toContain('only on the tasks the Advisor sends it')
    for (const text of [main, partner, helper]) expect(text).not.toContain('Its step is reported')
  })

  test('the Product owner is told to keep its talks, the focus goal and the open questions', () => {
    const owner = compactKeep('PO', 'Main', 'owner')
    for (const part of ['"PO"', 'Product owner', 'roles/product-owner.md', 'every talk still running', 'word for word', '"Main" is the main chat', 'the focus goal']) expect(owner).toContain(part)
    for (const part of ['Its step is reported', 'every step the store holds', 'one line for each task it finished', 'every worker by name', 'roles/partner.md']) expect(owner).not.toContain(part)
    expect(owner).not.toBe(compactKeep('PO', 'Main', 'advisor'))
  })
})

describe('clear after each step', () => {
  const facts = { role: 'worker' as const, isReported: true, isPaused: false, isUnfiled: false, busy: null }

  test('a worker is cleared after its reported step; anything else keeps the conversation and says why', () => {
    expect(clearWhy(facts)).toBeNull()
    expect(clearWhy({ ...facts, role: null })).toContain('did not say this chat is a worker')
    expect(clearWhy({ ...facts, role: 'main' })).toBe('the main chat is never cleared')
    expect(clearWhy({ ...facts, role: 'advisor' })).toBe('the partner is never cleared')
    expect(clearWhy({ ...facts, role: 'owner' })).toBe('the Product owner is never cleared')
    expect(clearWhy({ ...facts, role: 'helper' })).toBe('the partner\'s helper is never cleared')
    expect(clearWhy({ ...facts, isReported: false })).toContain('not reported')
    expect(clearWhy({ ...facts, isPaused: true })).toContain('pauses')
    expect(clearWhy({ ...facts, isUnfiled: true })).toContain('did not file')
    expect(clearWhy({ ...facts, busy: 'a subagent it started still runs (1)' })).toBe('a subagent it started still runs (1)')
  })

  test('a question to the person stops a clear only when the board did not file it as an ask', () => {
    const asks = 'The knight is in.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.'
    expect(unfiledAsk('The knight is in.', null, 0)).toBe(false)
    expect(unfiledAsk(asks, { asked: ['Q4'] }, 1)).toBe(false)
    expect(unfiledAsk(asks, { left: ['asked already'] }, 1)).toBe(false)
    expect(unfiledAsk(asks, null, 1)).toBe(true)
    expect(unfiledAsk(asks, { unfiled: 1 }, 1)).toBe(true)
    // A quoted question the mod could not read as the block at the end of the answer.
    expect(unfiledAsk(`${asks}\n\nAnd more words after it.`, { asked: [] }, 0)).toBe(true)
  })

  test('the board\'s word on the role: only the six roles count', () => {
    expect(roleFrom({ role: 'worker' })).toBe('worker')
    expect(roleFrom({ role: 'helper' })).toBe('helper')
    expect(roleFrom({ role: 'supervisor' })).toBe('supervisor')
    expect(roleFrom({ role: 'owner' })).toBe('owner')
    for (const value of [null, {}, { role: 'person' }, 'worker']) expect(roleFrom(value)).toBeNull()
  })

  test('the supervisor: the list of chats names its chat; a worker\'s clear is not for it', () => {
    expect(parseList('{ "prefix": "Game - ", "main": "Main", "supervisor": " Watcher " }')?.supervisor).toBe('Watcher')
    expect(parseList('{ "prefix": "Game - ", "main": "Main", "supervisor": "" }')?.supervisor).toBeUndefined()
    expect(clearWhy({ ...facts, role: 'supervisor' })).toBe('the supervisor\'s chat is cleared after every turn of its own, without a log')
  })

  test('a card keeps the clear, the reason it did not run and its mark; the old session\'s file names the new one and no chat', () => {
    const cleared = { ...chat('Units', 'waiting'), cleared: { at: NOW, step: 'B482', log: '.claude/chat-logs/Units/2026-10-23 1405 B482.txt' }, clearNote: { at: NOW - 5, why: 'the person pauses the chats' }, clearing: { at: NOW - 9, step: 'B481', log: null } }
    expect(parseChat(chatText(cleared))).toEqual(cleared)
    expect(parseChat(JSON.stringify({ ...chat('Units', 'waiting'), cleared: { at: 'x' }, clearing: { at: NOW, step: 'not an id', log: 3 } }))).toEqual({ ...chat('Units', 'waiting'), clearing: { at: NOW, step: null, log: null } })
    const moved = movedText('s2', NOW)
    expect(JSON.parse(moved)).toEqual({ movedTo: 's2', at: NOW })
    expect(parseChat(moved)).toBeNull()
    expect(hasLeft(moved)).toBe(false)
  })

  test('the conversation after a clear starts with who it is, its rules, its old log, its open instructions and work next', () => {
    const open = openFrom({ open: [{ id: 'I17', turns: 2, text: 'Make the strip   blue' }, { id: 'I18', turns: 0 }] }) ?? []
    expect(open).toEqual([{ id: 'I17', turns: 2, text: 'Make the strip   blue' }, { id: 'I18', turns: 0 }])
    const text = clearedStart({ name: 'Units', title: 'Game - Units', role: 'worker', main: 'Game - Main', step: 'B482', log: 'D:/p/.claude/chat-logs/Units/2026-10-23 1405 B482.txt', open }, 'mcp__workers__chat')
    expect(text).toContain('This chat is "Game - Units", a worker in the person\'s list of chats, listed as "Units"; "Game - Main" is the main chat.')
    expect(text).toContain('cleared by the Workers mod after your step B482 was reported')
    expect(text).toContain('kept word for word in D:/p/.claude/chat-logs/Units/2026-10-23 1405 B482.txt')
    expect(text).toContain('CLAUDE.md and .claude/worker-briefing.md')
    expect(text).toContain('run mcp__workers__work with action "next" now')
    expect(text).toContain('I17 (missed 2 turns): "Make the strip blue"; I18.')
    // A /clear the person ran: no step, no log; nothing open, no line about it.
    const plain = clearedStart({ name: 'Units', title: 'Game - Units', role: 'worker', main: 'Game - Main', step: null, log: null, open: [] }, 'mcp__workers__chat')
    expect(plain).not.toContain('kept word for word')
    expect(plain).not.toContain('instructions')
    expect(plain).toContain('Your earlier conversation was cleared, so this conversation starts empty.')
  })

  test('an answer leaves a question with the person when its quote block holds an item "Answer:"', () => {
    expect(asksPerson('The knight is in.\n\n> **For you**\n> 1. **Answer:** sheet A or B? I advise A.\n> 2. **Do:** look at it in the game.')).toBe(true)
    expect(asksPerson('The knight is in.\n\n> **For you**\n> 1. **Do:** look at it in the game.')).toBe(false)
    expect(asksPerson('Answer: it is merged. Nothing is open.')).toBe(false)
    expect(asksPerson('')).toBe(false)
  })

  test('the list of chats holds the size from which a chat is compacted; 0 switches it off', () => {
    expect(parseList('{"prefix":"Game - ","main":"Main"}')?.compactAbove).toBe(250_000)
    expect(parseList('{"prefix":"Game - ","main":"Main","compactAbove":400000}')?.compactAbove).toBe(400_000)
    expect(parseList('{"prefix":"Game - ","main":"Main","compactAbove":0}')?.compactAbove).toBe(0)
    expect(parseList('{"prefix":"Game - ","main":"Main","compactAbove":"lots"}')?.compactAbove).toBe(250_000)
  })

  test('a chat\'s file keeps when it was last compacted, and from what size to what', () => {
    const kept = { ...chat('Units', 'waiting'), compacted: { at: NOW, before: 812_000, after: 96_000 } }
    expect(parseChat(chatText(kept))).toEqual(kept)
    expect(parseChat(chatText(chat('Units', 'waiting')))?.compacted).toBeUndefined()
    // B227: why it was not compacted, kept the same way.
    const noted = { ...chat('Units', 'waiting'), compactNote: { at: NOW, why: 'its size is not known' } }
    expect(parseChat(chatText(noted))?.compactNote).toEqual({ at: NOW, why: 'its size is not known' })
    expect(parseChat(JSON.stringify({ ...chat('Units', 'waiting'), compactNote: { at: 'x', why: 1 } }))?.compactNote).toBeUndefined()
  })
})

describe('B297: the work tool keeps the card', () => {
  test('take sets the topic of the card from the title of the step; step moves it as chat "step" does', () => {
    const units = chat('Units', 'working')
    const taken = workCard(units, 'take', { id: 'B12', title: 'Give the golem its art in two poses and a sheet' })
    expect(taken.chat?.task?.text).toBe('B12 Give the golem its art')
    const planned = workCard(taken.chat as ChatFile, 'step', { id: 'B12', names: ['Read', 'Draw', 'Test'], minutes: 40, stepMinutes: 10 })
    expect([planned.chat?.task?.step, planned.chat?.task?.steps, planned.chat?.task?.text]).toEqual([1, 3, 'B12 Give the golem its art'])
    const stepped = workCard(planned.chat as ChatFile, 'step', { id: 'B12', step: 3 })
    expect(stepped.chat?.task?.step).toBe(3)
    // A step without a plan on the card asks for one, as chat "step" does.
    expect(workCard(units, 'step', { id: 'B12', step: 2 }).error).toContain('No plan is recorded')
    // Without a task on the card, a plan names the step by its id.
    expect(workCard(units, 'step', { id: 'B12', steps: 4 }).chat?.task?.text).toBe('B12')
    expect(workCard(units, 'next', {}).chat).toBeUndefined()
  })
})

describe('B298: the instructions of the person, as the chat is told of them', () => {
  test('only what the person typed in the own box of the chat is filed, never a slash command or what the board typed', () => {
    expect(isFiled('Make it blue', { kind: 'composer' })).toBe(true)
    expect(isFiled('/compact', { kind: 'composer' })).toBe(false)
    expect(isFiled('  ', { kind: 'composer' })).toBe(false)
    for (const kind of ['plugin', 'peer', 'task-notification', undefined]) expect(isFiled('Make it blue', { kind })).toBe(false)
    for (const kind of ['bridge', 'sdk']) expect(isFiled('Make it blue', { kind })).toBe(true)
    expect(isFiled('Queue the menu [I18]', { kind: 'composer' })).toBe(false)
    expect(isFiled('x\n(typed on the worker board, 11:05)', { kind: 'composer' })).toBe(false)
  })

  test('B1: the app\'s own notes are no words of the person\'s: alone they file nothing, beside the person\'s words they are cut out', () => {
    const reminder = '<system-reminder>\nThe session "Team - Units" you started (local_x) finished a turn.\n</system-reminder>'
    const event = '<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>'
    const peer = '<cross-session-message from="local_y" name="Team - Main">\nNote from Team - Main: run work next.\n</cross-session-message>'
    for (const only of [reminder, event, peer, `${reminder}\n${reminder}\n${event}`, `${reminder}\n${peer}`]) {
      expect(isFiled(only, { kind: 'sdk' })).toBe(false)
      expect(personsWords(only)).toBe('')
    }
    const mixed = `${reminder}\nMake the strip blue\n${peer}\nand queue the menu`
    expect(isFiled(mixed, { kind: 'sdk' })).toBe(true)
    expect(personsWords(mixed)).toBe('Make the strip blue\n\nand queue the menu')
    expect(isFiled(`${reminder}\n/compact`, { kind: 'composer' })).toBe(false)
    expect(isFiled(`${reminder}\nx\n(typed on the worker board, 11:05)`, { kind: 'composer' })).toBe(false)
    // An unclosed tag, or one the person writes about, is their words.
    expect(personsWords('What does <system-reminder> mean?')).toBe('What does <system-reminder> mean?')
  })

  test('the lines: new ones, turns, and several at once', () => {
    expect(instructionsLine([])).toBeNull()
    expect(instructionsLine([{ id: 'I17', turns: 0 }, { id: 'I15', turns: 1 }])).toStartWith('Open instructions: I17 (new), I15 (1 turn).')
    expect(recordedLine([], [])).toBeNull()
    expect(recordedLine(['I3', 'I4', 'I5'], [{ id: 'I3', turns: 0 }])).toBe('Recorded as I3, I4 and I5; close each with work close <id> --as "what came of it" once it is done.')
    expect(recordedLine([], [{ id: 'I1', turns: 1 }, { id: 'I2', turns: 0 }])).toBe('Still open from earlier turns: I1 (missed 1 turn).')
    expect(openFrom({ open: [{ id: 'I1', turns: 2 }, { id: 3 }, 'x', { id: 'I2' }] })).toEqual([{ id: 'I1', turns: 2 }, { id: 'I2', turns: 0 }])
    expect(openFrom({ text: 'no list' })).toBeNull()
  })
})

describe('2c (0.28.0): the pane shows the board\'s status', () => {
  const entry = (name: string, statusName: string, more: Partial<BoardStatus> = {}): BoardStatus => (
    { name, status: statusName, why: null, tone: 'quiet', since: null, reportAt: NOW - 2000, ...more }
  )
  const all = [chat('Main', 'waiting', null, 'main'), chat('Units', 'working', task('Skeleton Archer', 3, 5, 40)), chat('Props', 'waiting', task('Props', 1, 2, 10)), chat('Cleanup', 'waiting')]
  const rows = all.map((c, i) => ({ ...c, id: String(i) }))
  const board = (statuses: BoardStatus[], reading: BoardReading = 'board'): { statuses: BoardStatus[]; reading: BoardReading } => ({ statuses, reading })
  const line = (name: string, facts: { statuses: BoardStatus[]; reading: BoardReading }) => lineOf(all.find(c => c.name === name) as ChatFile, all, NOW, [], facts)

  test('the line follows the board\'s status: its mark, the status, then today\'s task text', () => {
    const facts = board([entry('Units', 'Working'), entry('Props', 'Waiting for you', { tone: 'attention' }), entry('Cleanup', 'Free'), entry('Main', 'Free')])
    expect(line('Units', facts)).toEqual({ mark: '●', text: 'Working  Skeleton Archer · 3 of 5 · ~40 min', isYours: false, isBold: false, notReached: false })
    expect(line('Props', facts)).toEqual({ mark: '◐', text: 'Waiting for you  Props · 1 of 2', isYours: true, isBold: true, notReached: false })
    expect(line('Cleanup', facts)).toEqual({ mark: '○', text: 'Free', isYours: false, isBold: false, notReached: false })
    expect(line('Main', facts)).toEqual({ mark: '◆', text: 'Free  waiting for 2 workers', isYours: false, isBold: false, notReached: false })
  })

  test('the board\'s status wins over the pane\'s own reading: a chat the card calls free reads the board\'s Not running, bold', () => {
    // Its own reading says "free"; the board says Not running (attention): bold, never dim, the board's words.
    const facts = board([entry('Cleanup', 'Not running', { tone: 'attention', why: 'its chat is closed' })])
    expect(line('Cleanup', facts)).toEqual({ mark: '○', text: 'Not running · its chat is closed', isYours: false, isBold: true, notReached: false })
    // A chat the card says is running reads what the board says of it (Stopped), not "working".
    expect(line('Units', board([entry('Units', 'Stopped', { why: 'cut off by a restart' })])).text).toStartWith('Stopped · cut off by a restart')
  })

  test('the tone maps to bold: attention bold, quiet plain, whatever the status', () => {
    for (const [tone, bold] of [['attention', true], ['quiet', false]] as const) expect(line('Units', board([entry('Units', 'Held', { tone })])).isBold).toBe(bold)
  })

  test('the mark by status', () => {
    const marks: Array<[string, ChatFile['role'], string, boolean]> = [
      ['Working', 'worker', '●', false], ['Working', 'main', '◆', false], ['Waiting for you', 'worker', '◐', true],
      ['Checking', 'worker', '◌', false], ['Handing', 'worker', '◌', false], ['Offered', 'worker', '◌', false], ['Held', 'worker', '◌', false],
      ['Did not answer', 'worker', '◌', false], ['Paused', 'worker', '◌', false], ['Restarting', 'worker', '◌', false], ['Stopped', 'worker', '◌', false],
      ['Free', 'worker', '○', false], ['Free', 'main', '◆', false], ['Asleep', 'worker', '○', false], ['Asleep', 'main', '◆', false],
      ['Not running', 'worker', '○', false], ['Not running', 'main', '○', false], ['Unknown', 'worker', '○', false], ['Unknown', 'main', '○', false],
    ]
    for (const [name, role, mark, isYours] of marks) expect([name, role, statusMark(name, role)]).toEqual([name, role, { mark, isYours }])
  })

  test('the status words as the board\'s page says them: why, an age over 10 s, Unknown and Asleep', () => {
    expect(statusLabel(entry('A', 'Working', { reportAt: NOW - 9000 }), NOW)).toBe('Working')
    expect(statusLabel(entry('A', 'Working', { reportAt: NOW - 25_000 }), NOW)).toBe('Working · 25 s ago')
    expect(statusLabel(entry('A', 'Working', { reportAt: NOW - 25_000, why: 'waits for the partner' }), NOW)).toBe('Working · waits for the partner · 25 s ago')
    expect(statusLabel(entry('A', 'Free', { reportAt: NOW - 3 * MIN }), NOW)).toBe('Free · 3 min ago')
    expect(statusLabel(entry('A', 'Free', { reportAt: null }), NOW)).toBe('Free')
    expect(statusLabel(entry('A', 'Unknown', { reportAt: NOW - 40_000 }), NOW)).toBe('Unknown · no report for 40 s')
    expect(statusLabel(entry('A', 'Unknown', { reportAt: null }), NOW)).toBe('Unknown · no report yet')
    expect(statusLabel(entry('A', 'Asleep', { since: new Date(2026, 10, 1, 9, 5).getTime() }), NOW)).toBe('Asleep · since 09:05')
    expect(statusLabel(entry('A', 'Asleep', { why: 'ignored', reportAt: NOW - 90_000 }), NOW)).toBe('Asleep')
  })

  test('a chat the board names no status for keeps today\'s line; the board\'s names match in any case', () => {
    expect(line('Units', board([entry('Props', 'Free')])).text).toBe('Skeleton Archer · 3 of 5 · ~40 min')
    expect(line('Units', board([entry('units', 'Working')])).text).toStartWith('Working')
  })

  test('falls back to the pane\'s own reading when the reading is not "board"; only "unreached" marks the line', () => {
    const stale = [entry('Units', 'Not running', { tone: 'attention' })]
    expect(line('Units', board(stale, 'plain'))).toEqual({ mark: '●', text: 'Skeleton Archer · 3 of 5 · ~40 min', isYours: false, isBold: false, notReached: false })
    expect(line('Units', board(stale, 'unreached')).notReached).toBe(true)
    expect(line('Units', board(stale, 'unreached')).text).toBe('Skeleton Archer · 3 of 5 · ~40 min')
    expect(lineOf(all[1] as ChatFile, all, NOW, [], {})).toEqual({ mark: '●', text: 'Skeleton Archer · 3 of 5 · ~40 min', isYours: false, isBold: false, notReached: false })
    expect(chatLine(all[1] as ChatFile, all, NOW, [], board(stale, 'unreached'))).toBe('● Units  Skeleton Archer · 3 of 5 · ~40 min  (board not reached)')
    expect(chatLine(all[1] as ChatFile, all, NOW, [], board(stale, 'plain'))).toBe('● Units  Skeleton Archer · 3 of 5 · ~40 min')
    // Today's dim test is gone: the old reading of a free chat is unchanged.
    expect(chatLine(all[3] as ChatFile, all, NOW)).toBe('○ Cleanup  free')
  })

  test('the chat tool\'s list shows the board\'s status, so the models and the pane agree', () => {
    const statuses = [entry('Units', 'Working'), entry('Props', 'Held', { tone: 'attention', why: 'its clear did not run' }), entry('Cleanup', 'Free'), entry('Main', 'Free')]
    expect(chatsSummary(rows, NOW, [], board(statuses)).split('\n')).toEqual([
      '◆ Main  Free  waiting for 2 workers',
      '○ Cleanup  Free',
      '◌ Props  Held · its clear did not run  Props · 1 of 2',
      '● Units  Working  Skeleton Archer · 3 of 5 · ~40 min',
    ])
  })

  test('7c (0.30.0): fresh statuses that carry the held step draw it, with the row\'s time, in place of the card\'s task', () => {
    const held = { id: 'B855', title: 'The walk', time: '1 h 56 of its 2 h' }
    const facts = board([entry('Units', 'Working', { held }), entry('Props', 'Held', { held: { ...held, id: 'B12', title: 'Props', time: null } }), entry('Cleanup', 'Free', { held: null }), entry('Main', 'Free', { held: null })])
    // Mutant "the card's task while fresh statuses carry held": Units would read "Skeleton Archer · 3 of 5 · ~40 min".
    expect(line('Units', facts).text).toBe('Working  B855 The walk · 1 h 56 of its 2 h')
    expect(line('Props', facts).text).toBe('Held  B12 Props')
    // A chat that holds none by the board's records keeps the card's words (the main chat's wait for its workers).
    expect(line('Main', facts).text).toBe('Free  waiting for 2 workers')
    expect(line('Cleanup', facts).text).toBe('Free')
    // Statuses that are not fresh: the card's task, as before, whatever the old entry held.
    expect(line('Units', board([entry('Units', 'Working', { held })], 'unreached')).text).toBe('Skeleton Archer · 3 of 5 · ~40 min')
    expect(chatsSummary(rows, NOW, [], facts).split('\n')).toContain('● Units  Working  B855 The walk · 1 h 56 of its 2 h')
    expect(heldText({ id: 'B9', title: '', time: 'No time' })).toBe('B9 · No time')
  })

  test('when the pane reads the board: fresh statuses, a fresh process, an older board, a chat outside the list, a clear that runs', () => {
    const base = { now: 1_000_000, bootAt: 1_000_000 - 10 * MIN, statusesAt: null as number | null, answeredAt: null as number | null, isMember: true, isBoardKnown: true }
    // Fresh statuses are the board's.
    expect(boardReading({ ...base, statusesAt: base.now - 5000 })).toBe('board')
    expect(boardReading({ ...base, statusesAt: base.now - STATUS_FRESH_MS })).toBe('board')
    // No statuses for over 120 s, and no board answer either: the pane's own reading, marked.
    expect(boardReading({ ...base, statusesAt: base.now - STATUS_FRESH_MS - 1 })).toBe('unreached')
    expect(boardReading({ ...base })).toBe('unreached')
    // A fresh process is not marked: the 120 s count from its start when none ever arrived.
    expect(boardReading({ ...base, bootAt: base.now - 60_000 })).toBe('plain')
    expect(boardReading({ ...base, bootAt: base.now - STATUS_FRESH_MS - 1 })).toBe('unreached')
    // An older board answers without statuses: today's line, no mark.
    expect(boardReading({ ...base, answeredAt: base.now - 5000 })).toBe('plain')
    expect(boardReading({ ...base, answeredAt: base.now - STATUS_FRESH_MS - 1 })).toBe('unreached')
    // A chat outside the list never takes, and a project with no board has none: no mark.
    expect(boardReading({ ...base, isMember: false })).toBe('plain')
    expect(boardReading({ ...base, isBoardKnown: false })).toBe('plain')
    // While a clear runs no take is made: the statuses stand 120 s, so a clear of a minute or two shows no mark.
    expect(boardReading({ ...base, statusesAt: base.now - 100_000 })).toBe('board')
  })
})

describe('0.28.0: the Product owner is never a worker', () => {
  test('parseList reads the list\'s "owner"; a blank one is none', () => {
    expect(parseList('{ "prefix": "Game - ", "main": "Main", "owner": " Product owner " }')?.owner).toBe('Product owner')
    expect(parseList('{ "prefix": "Game - ", "main": "Main", "owner": "" }')?.owner).toBeUndefined()
    expect(parseList('{ "prefix": "Game - ", "main": "Main", "owner": 3 }')?.owner).toBeUndefined()
  })

  test('the owner is the chat the list names or the board named before; never the main chat; the board\'s own word wins', () => {
    const list = parseList('{ "prefix": "Game - ", "main": "Main", "owner": "Product owner" }')
    const owner = { name: 'product OWNER', role: 'worker' as const }
    expect(isOwnerChat(list, owner)).toBe(true)
    expect(isOwnerChat(list, { name: 'Units', role: 'worker' })).toBe(false)
    expect(isOwnerChat(list, { name: 'Product owner', role: 'main' })).toBe(false)
    expect(isOwnerChat(null, { name: 'Units', role: 'worker' }, 'owner')).toBe(true)
    expect(isOwnerChat(null, { name: 'Units', role: 'worker' }, 'worker')).toBe(false)
    // No role in the board's answer (an older board): the owner stays the owner; any other chat stays role-less as before.
    expect(roleOrOwner({}, list, owner)).toBe('owner')
    expect(roleOrOwner({ pause: null }, list, { name: 'Units', role: 'worker' })).toBeNull()
    expect(roleOrOwner({ role: 'worker' }, list, owner)).toBe('worker')
    expect(roleOrOwner({ role: 'supervisor' }, list, owner)).toBe('supervisor')
  })
})
