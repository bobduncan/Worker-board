import { describe, expect, test } from 'claude-code/testing'

import { PROBE_MARK, PROBE_PATH, hasProbeMark, withProbeMark } from './probe'

// B1274 (0.34.0): the probe's pure helpers: the one mark added beside a prompt row, read back from the row as stored.
describe('the probe, observe only', () => {
  test('it adds its one mark to a text row and to a row of blocks', () => {
    expect(withProbeMark('why are the benches grey?')).toBe(`why are the benches grey?\n\n${PROBE_MARK}`)
    expect(withProbeMark([{ type: 'text', text: 'hi' }])).toEqual([{ type: 'text', text: 'hi' }, { type: 'text', text: PROBE_MARK }])
    expect(withProbeMark(null)).toBe(null)
  })
  test('it reads the mark back only where the rewrite stood', () => {
    expect(hasProbeMark(withProbeMark('x'))).toBe(true)
    expect(hasProbeMark(withProbeMark([{ type: 'text', text: 'x' }]))).toBe(true)
    expect(hasProbeMark('x')).toBe(false)
    expect(hasProbeMark([{ type: 'text', text: 'x' }, { type: 'image' }])).toBe(false)
  })
  test('its route and its mark: a comment, nothing for the model to act on', () => {
    expect(PROBE_PATH).toBe('/api/bridge/probe')
    expect(PROBE_MARK.startsWith('<!-- ') && PROBE_MARK.endsWith(' -->')).toBe(true)
  })
})
