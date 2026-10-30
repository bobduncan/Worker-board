// B775: the evidence the obsolete check hands the Advisor: facts only, per open item. Made-up names; git is a stand-in.
import assert from 'node:assert/strict'
import test from 'node:test'

import { obsoleteWords } from '../../src/say.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { obsoleteEvidence, commitsNaming } from '../../src/work/obsoleteEvidence.mjs'
import { openItemsOf } from '../../src/work/obsolete.mjs'

const NOW = new Date(2026, 9, 28, 16, 0).getTime()
const item = text => parseItem(text.replace(/^ +/gm, ''))
const items = new Map([
  ['B1', item('Id: B1\nKind: step\nTitle: Hedge\nState: refined\nSince: 2026-10-28 09:00\n\n## History\n- 2026-10-28 09:05 Advisor: refined is ready\n')],
  ['B3', item('Id: B3\nKind: step\nTitle: Gate\nState: in progress\nOwner: Painter\nSince: 2026-10-28 10:00\n')],
  ['Q1', item('Id: Q1\nKind: ask\nTitle: Number or bar?\nState: open\nOwner: Partner\nSince: 2026-10-28 09:10\nOf: B1\nVia: refine\nAsks: decide\n')],
  ['Q2', item('Id: Q2\nKind: ask\nTitle: Restart the board\nState: open\nOwner: Gone\nSince: 2026-10-28 09:10\nAsks: do\n')],
  ['Q3', item('Id: Q3\nKind: ask\nTitle: Which gate?\nState: open\nOwner: Painter\nSince: 2026-10-28 10:10\nOf: B3\nAsks: decide\nBlocking: yes\n')],
  ['X1', item('Id: X1\nKind: incident\nTitle: Painter unknown\nState: open\nSource: sweep\nSubject: Painter\nKey: k\nSince: 2026-10-28 09:20\nFirst seen: 2026-10-28 09:20\nLast seen: 2026-10-28 09:40\nCount: 3\nEvidence: unknown for 11 min\n')],
])
const git = answers => async args => {
  git.calls.push(args)
  return answers[args[1]] ?? null
}
git.calls = []

test('commits naming a step: only as a word (B1 is not B12), newest first, before or after the item was made, from every repository the board knows', async () => {
  const calls = []
  const run = async args => {
    calls.push(args)
    return args[1] === '/game' ? '1111111\t2026-10-27\t1793000000\tB1 first\n2222222\t2026-10-28\t1793100000\tB12 another step\n' : '3333333\t2026-10-29\t1793200000\tB1: second\n'
  }
  const found = await commitsNaming('B1', 1793100000 * 1000, { repos: [{ dir: '/game', base: 'main' }, { dir: '/board', base: 'main' }], run })
  assert.deepEqual(found, ['3333333 2026-10-29 (after it was made) on main of board: B1: second', '1111111 2026-10-27 (before it was made) on main of game: B1 first'])
  assert.deepEqual(calls[0].slice(0, 4), ['-C', '/game', 'log', 'main'])
  assert.ok(calls[0].includes('--grep=B1') && calls[0].includes('--fixed-strings') && !calls[0].some(one => one.startsWith('--since=')))
  // A repository git cannot read counts for none.
  assert.deepEqual(await commitsNaming('B1', NOW, { repos: [{ dir: '/x', base: 'main' }], run: async () => null }), [])
})

test('each open item gets its facts: asked when and by whom, its step and last History, the commits since, its chat, the board\'s restart', async () => {
  const open = openItemsOf(items)
  assert.deepEqual(open.map(one => one.id), ['Q1', 'Q2', 'Q3', 'X1'])
  const built = Math.floor((NOW - 3_600_000) / 1000)
  const run = async args => (args.includes('--grep=B1') ? `abc1234\t2026-10-28\t${built}\tB1 built the hedge\n` : '')
  const lanes = [{ name: 'Garden · Painter', state: 'working', task: 'Gate', isRunning: true }]
  const evidence = await obsoleteEvidence(open, { items, lanes, prefix: 'Garden · ', repos: [{ dir: '/game', base: 'main' }], run, board: { startedAt: NOW }, mod: '0.26.5' })
  assert.deepEqual(evidence.get('Q1'), [
    'asked 2026-10-28 09:10 by Partner',
    'B1 is refined since 2026-10-28 09:00',
    'B1 last History: 2026-10-28 09:05 Advisor: refined is ready',
    '1 commit naming B1: abc1234 2026-10-28 (after it was made) on main of game: B1 built the hedge',
    'Partner is not in the list of chats',
    'the board restarted 2026-10-28 16:00, after it was made; Workers mod 0.26.5 is installed',
  ])
  assert.equal(evidence.get('Q2').some(line => /Gone is not in the list of chats/.test(line)), true)
  assert.equal(evidence.get('Q2').some(line => /commit/.test(line)), false, 'a Do names no step: no commit lookup')
  // A blocking ask under a step that is at work; its chat is in the list and working.
  assert.equal(evidence.get('Q3').some(line => /blocks its step/.test(line)), true)
  assert.equal(evidence.get('Q3').some(line => line === 'B3 is in progress, Painter\'s since 2026-10-28 10:00'), true)
  assert.equal(evidence.get('Q3').some(line => line === 'no commit names B3'), true)
  assert.equal(evidence.get('Q3').some(line => line === 'Painter is in the list, working: Gate'), true)
  // An incident: what it is, how often seen, what was seen last; its subject chat.
  assert.deepEqual(evidence.get('X1').slice(0, 2), ['incident open: sweep saw it 3 times, first 2026-10-28 09:20, last 2026-10-28 09:40', 'what was seen last: unknown for 11 min'])
  assert.equal(evidence.get('X1').some(line => line === 'Painter is in the list, working: Gate'), true)
  for (const lines of evidence.values()) assert.ok(lines.length <= 8 && lines.every(line => line.length <= 220))
})

test('without a restart after it was made, no line says so; a step that is not in the store says so', async () => {
  const lonely = new Map([['Q9', item('Id: Q9\nKind: ask\nTitle: Gone step?\nState: open\nOwner: Partner\nSince: 2026-10-28 09:10\nOf: B99\nAsks: decide\n')]])
  const evidence = await obsoleteEvidence(openItemsOf(lonely), { items: lonely, board: { startedAt: NOW - 10 * 86_400_000 }, mod: '0.26.5', repos: [], run: async () => null })
  assert.equal(evidence.get('Q9').some(line => line === 'B99 is not in the store'), true)
  assert.equal(evidence.get('Q9').some(line => /restarted/.test(line)), false)
})

test('the board\'s word to the partner: the ids, where to read the evidence, how to answer; long lists are cut', () => {
  const words = obsoleteWords('Advisor', { ids: ['Q1', 'X2'], job: '/board/roles/partner.md' })
  assert.equal(words.command, 'obsolete-check')
  assert.equal(words.to, 'Advisor')
  assert.match(words.text, /^obsolete check: 2 open items under Needs your attention\nItems: Q1, X2\n/)
  assert.match(words.text, /work obsolete \(no points\)/)
  assert.match(words.text, /Your job: \/board\/roles\/partner\.md, "Find obsolete items"$/)
  const many = obsoleteWords('Advisor', { ids: Array.from({ length: 100 }, (_x, n) => `Q${n + 1}`), job: '/board/roles/partner.md' })
  assert.match(many.text, /, and 40 more\n/)
  assert.ok(many.text.length < 1000)
})
