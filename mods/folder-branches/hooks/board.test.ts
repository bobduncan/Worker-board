import { describe, expect, test } from 'claude-code/testing'

import { MOST_CHARS, WORK_ACTIONS, WORK_FIELDS, boardStarts, parseBoard, parseTaken } from './board'

const KEY = 'ab'.repeat(32)

describe('the boards the mod keeps running', () => {
  const launch = JSON.stringify({ configurations: [
    { name: 'worker-board', runtimeExecutable: 'node', runtimeArgs: ['C:/p/worker-board/server.mjs'], port: 4310, url: 'http://127.0.0.1:4310' },
    { name: 'game', runtimeExecutable: 'node', runtimeArgs: ['vite.js'], port: 5173 },
    { name: 'no-port', runtimeExecutable: 'node', runtimeArgs: [] },
    { name: 'no-command', port: 4400 },
  ] })

  test('only the launch entries the list names under "boards" are started, each where its port says', () => {
    expect(boardStarts('{"prefix":"Game - ","main":"Main","boards":["worker-board","no-port","no-command","missing"]}', launch)).toEqual([
      { name: 'worker-board', argv: ['node', 'C:/p/worker-board/server.mjs'], url: 'http://127.0.0.1:4310/' },
    ])
    expect(boardStarts('{"prefix":"Game - ","main":"Main"}', launch)).toEqual([])
    expect(boardStarts('{"boards":"worker-board"}', launch)).toEqual([])
    expect(boardStarts('{"boards":["worker-board"]}', 'not json')).toEqual([])
  })
})

describe('the worker board, as the mod reads it', () => {
  test('the board is asked only on this machine, and only with a key', () => {
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: KEY, startedAt: 5 }))).toEqual({ url: 'http://127.0.0.1:4310', key: KEY })
    expect(parseBoard(JSON.stringify({ url: 'http://example.com:4310', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310/elsewhere', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'https://127.0.0.1:4310', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310@evil.example', key: KEY }))).toBeNull()
    expect(parseBoard(JSON.stringify({ url: 'http://127.0.0.1:4310', key: 'short' }))).toBeNull()
    expect(parseBoard('not json')).toBeNull()
    expect(parseBoard('[]')).toBeNull()
  })

  test('what the board hands out is typed only when it is text of a sane length', () => {
    const answer = JSON.stringify({ messages: [
      { id: 'm1', text: ' Sheet B ' },
      { id: 'm2', text: 'x'.repeat(MOST_CHARS + 1) },
      { id: 'm3', text: '' },
      { id: '', text: 'no id' },
      { id: 'm4', text: 7 },
      'stray',
    ] })
    // What cannot be typed is named, so the board can say it did not arrive.
    expect(parseTaken(answer)).toEqual({ messages: [{ id: 'm1', text: 'Sheet B' }], refused: ['m2', 'm3', 'm4'] })
    expect(parseTaken('{"messages":"x"}')).toEqual({ messages: [], refused: [] })
    expect(parseTaken('')).toEqual({ messages: [], refused: [] })
  })
})

describe('Focus 2: the partner keeps its drafts of the focus with the work tool', () => {
  test('vibe-draft and how-draft are actions of the tool, with the fields they need', () => {
    expect(WORK_ACTIONS.includes('vibe-draft')).toBe(true)
    expect(WORK_ACTIONS.includes('how-draft')).toBe(true)
    for (const field of ['goal', 'lines', 'picture', 'parts', 'partnerDecides', 'youDecide']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('Focus 3: the daily note of the partner on the focus', () => {
  test('a note carries what it decided and the asks that need the person', () => {
    for (const field of ['decided', 'needs']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})

describe('Fix first: a step marked as a board fix with the work tool', () => {
  test('priority is a field of the tool, sent to the board', () => {
    expect(WORK_FIELDS.includes('priority')).toBe(true)
  })
})

describe("B313: the main chat moves a renamed chat's work with the work tool", () => {
  test('rename is an action of the tool, with from and to', () => {
    expect(WORK_ACTIONS.includes('rename')).toBe(true)
    for (const field of ['from', 'to']) expect(WORK_FIELDS.includes(field)).toBe(true)
  })
})
