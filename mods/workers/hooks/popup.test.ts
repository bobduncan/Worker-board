import { describe, expect, test } from 'claude-code/testing'

import { POPUP_SHOWN_MS, STUCK_SHOWN_MS, callGist, isShownForTime, isWatched, popupText, toolName } from './popup'

// A popup that waits for the person shows on the worker board (the person, 2026-10-28: "worker 1 had a popup in claude
// code but it was not visible until looked, it was not visible in the worker board").
describe('a popup that waits for the person', () => {
  test('an ask of the permission check shows after 15 s, any other call after a minute', () => {
    expect([POPUP_SHOWN_MS, STUCK_SHOWN_MS]).toEqual([15_000, 60_000])
  })

  test('the question form files itself; a shell, a subagent or a wait shows only for an ask, never for its time', () => {
    expect(isWatched('AskUserQuestion')).toBe(false)
    expect(isWatched('Bash')).toBe(true)
    for (const tool of ['Bash', 'PowerShell', 'Agent', 'Monitor', 'Workflow', 'mcp__ccd_session_mgmt__send_message']) expect(isShownForTime(tool)).toBe(false)
    for (const tool of ['mcp__Claude_Browser__preview_start', 'Read', 'WebFetch']) expect(isShownForTime(tool)).toBe(true)
  })

  test('a tool as the person reads it', () => {
    expect(toolName('mcp__Claude_Browser__preview_start')).toBe('Claude_Browser preview_start')
    expect(toolName('Bash')).toBe('Bash')
  })

  test('what the call does: a command, a path, else its arguments without the reserved keys, cut short', () => {
    expect(callGist({ tool: 'Bash', tool_use_id: 't1', command: 'npm   test\n  -- --quiet' })).toBe('npm test -- --quiet')
    expect(callGist({ tool: 'mcp__Claude_Browser__preview_start', tool_use_id: 't2', name: 'map-dev' })).toBe('map-dev')
    expect(callGist({ tool: 'X', tool_use_id: 't3', agentId: undefined, level: 2, on: true })).toBe('level: 2, on: true')
    expect(callGist({ command: 'a'.repeat(200) }).length).toBe(90)
    expect(callGist(undefined)).toBe('')
  })

  test('the ask\'s words: a popup that waits for an OK, or one that may wait', () => {
    expect(popupText('mcp__Claude_Browser__preview_start', { name: 'map-dev' }, true)).toBe('Its popup waits for your OK to run Claude_Browser preview_start: map-dev. Open its chat and answer the popup.')
    expect(popupText('mcp__Claude_Browser__preview_start', { name: 'map-dev' }, false)).toBe('Its Claude_Browser preview_start: map-dev has run over a minute: a popup in its chat may wait for you. Open its chat and look.')
    expect(popupText('Read', {}, true)).toBe('Its popup waits for your OK to run Read. Open its chat and answer the popup.')
  })
})
