import { describe, expect, test } from 'claude-code/testing'

import { STUCK_SHOWN_MS, isShownForTime, plainAction, popupText, shortDetail } from './popup'

// A popup that may wait for the person shows on the worker board (the person, 2026-10-28: "worker 1 had a popup in
// claude code but it was not visible until looked, it was not visible in the worker board"); in short, plain words
// (2026-10-30: "Yes, shorten it"); never for the permission check's asks, which auto mode settles itself (2026-10-30: "i
// got a popup for all workers. i checked each but they didnt need an approve").
describe('a popup that may wait for the person', () => {
  test('a call shows after a minute', () => {
    expect(STUCK_SHOWN_MS).toBe(60_000)
  })

  test('the question form, a shell, a subagent or a wait never shows for its time', () => {
    for (const tool of ['AskUserQuestion', 'Bash', 'PowerShell', 'Agent', 'Monitor', 'Workflow', 'mcp__ccd_session_mgmt__send_message']) expect(isShownForTime(tool)).toBe(false)
    for (const tool of ['mcp__Claude_Browser__preview_start', 'Read', 'WebFetch']) expect(isShownForTime(tool)).toBe(true)
  })

  test('what a call does, in plain words', () => {
    expect(plainAction('Bash')).toBe('run a command')
    expect(plainAction('Edit')).toBe('change a file')
    expect(plainAction('mcp__Claude_Browser__preview_start')).toBe('start a preview in its browser')
    expect(plainAction('mcp__some_server__do_thing')).toBe('use some server (do thing)')
    expect(plainAction('Frobnicate')).toBe('use Frobnicate')
  })

  test('the detail in a few words: a command up to its first join or redirect, a file\'s name, a name or address', () => {
    expect(shortDetail({ command: 'git worktree add ../w4-x -b x main 2>&1 | tail -2; cd ../w4-x && npm test' })).toBe('git worktree add ../w4-x')
    expect(shortDetail({ command: 'npm   test\n  -- --quiet' })).toBe('npm test')
    expect(shortDetail({ file_path: 'C:\\Web\\project\\src\\game.ts' })).toBe('game.ts')
    expect(shortDetail({ name: 'map-dev' })).toBe('map-dev')
    expect(shortDetail({ command: `echo ${'a'.repeat(80)}` }).length).toBe(40)
    expect(shortDetail({ level: 2 })).toBe('')
    expect(shortDetail(undefined)).toBe('')
  })

  test('the card\'s words: short, its first sentence the title', () => {
    expect(popupText('mcp__Claude_Browser__preview_start', { name: 'map-dev' }))
      .toBe('A popup in its chat may wait for you: it has tried to start a preview in its browser (map-dev) for over a minute. Open its chat and look.')
    expect(popupText('Read', {})).toBe('A popup in its chat may wait for you: it has tried to read a file for over a minute. Open its chat and look.')
  })
})
