// B1274 (F36b): the board keeps the Workers mod's probe records (0.34.0), observe only, for chat 1's check on a work login.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { PROBE_EVENTS, keptProbes, probeEntry } from '../src/modProbe.mjs'

test('a probe record is kept with its chat, session, mod and the app\'s account; the prompt row\'s rewrite outcome is one of three; anything else is refused', () => {
  const body = { chat: 'Worker 2', session: 's-1', mod: '0.34.0', probe: { event: 'session.append', ran: true, door: 'prompt', rewrite: 'stood' } }
  assert.deepEqual(probeEntry(body, { at: 5, account: 'acc' }), { at: 5, chat: 'Worker 2', session: 's-1', mod: '0.34.0', account: 'acc', event: 'session.append', ran: true, door: 'prompt', rewrite: 'stood' })
  assert.equal(probeEntry({ ...body, probe: { ...body.probe, rewrite: 'slipped past' } }, { at: 5 }).rewrite, null)
  assert.deepEqual(probeEntry({ chat: 'Main', probe: { event: 'turn.start', ran: true } }, { at: 6 }), { at: 6, chat: 'Main', session: null, mod: null, account: null, event: 'turn.start', ran: true })
  assert.equal(probeEntry({ probe: { event: 'classic.Stop' } }, { at: 1 }), null)
  assert.equal(probeEntry({}, { at: 1 }), null)
  assert.deepEqual(PROBE_EVENTS, ['prompt.submit', 'turn.start', 'session.append'])
  assert.deepEqual(keptProbes(Array.from({ length: 100 }, (_, n) => n), 'x').slice(-2), [99, 'x'])
  assert.equal(keptProbes('broken', 'x').length, 1)
})

test('the server takes the probe on its own bridge route and keeps it in data/mod-probe.json, nowhere else', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /'\/api\/bridge\/probe': \{ kind: 'bridge', guard: 'free'/)
  assert.match(server, /pathname === '\/api\/bridge\/probe' \? probe/)
  assert.match(server, /const file = join\(HERE, 'data', 'mod-probe\.json'\)/)
})
