// Signals change 7 (B914, 2026-11-02): the made-up garden and the real cases the held-row tests share (test/heldRow.test.mjs,
// test/heldRow.page.test.mjs). B855 on 2 Nov: taken 11:10 for 90 min (refine size about 2 h), a checkpoint and its card's
// "step 4/4, 40 min left" at 11:14, interrupted 11:14-11:16, its head Since rewritten to 11:52 by a later move.

import { answer, step as toolStep, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem, valueOf } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'

export const MIN = 60_000
/** A time on 2 Nov 2026, the local clock (as the store's stamps are). */
export const at = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()
const two = n => String(n).padStart(2, '0')
export const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` }
export const stampSec = ms => `${stamp(ms)}:${two(new Date(ms).getSeconds())}`

/** A step of the store as its file reads, with `head` lines, `history` lines (`[when, who, words]`) and a refine `size`. */
export function stepItem(id, { title = `Title of ${id}`, state = 'in progress', owner = 'Worker 1', since = at(11, 52), size = null, history = [], head = [] } = {}) {
  return parseItem([
    `Id: ${id}`, 'Kind: step', `Title: ${title}`, `State: ${state}`, ...(owner === null ? [] : [`Owner: ${owner}`]), `Since: ${stamp(since)}`, ...head, '',
    ...(size === null ? [] : ['## Refined', '  Refined (round 1, by Advisor; ready):', `  Size: ${size}`, '']),
    '## History', ...history.map(([when, who, words]) => `- ${stamp(when)} ${who}: ${words}`), '',
  ].join('\n'))
}
export const itemsOf = (...items) => new Map(items.map(one => [valueOf(one, 'Id'), one]))

/** B855 as the store held it on 2 Nov, for `owner`: taken 11:10, a checkpoint 11:14, its head Since rewritten to 11:52. */
export const b855 = (more = {}, owner = 'Worker 1') => stepItem('B855', {
  title: 'A walkable tile always shows its whole move/target square', size: 'about 2 h', since: at(11, 52), owner,
  head: [`Checkpoint: 1a2b3c4 · committed on b855-whole-move-squares; gate running · ${stampSec(at(11, 14))}`, 'Taken for: 90 min',
    `Plan: step 4/4 | parts Read; Build; Test; Report | until ${stampSec(at(11, 54))} | at ${stampSec(at(11, 14))}`],
  history: [[at(11, 10), 'server', `queued → taken (for ${owner})`], [at(11, 10), owner, 'taken → in progress'], [at(11, 14), owner, 'step 4/4, about 40 min left'],
    [at(11, 30), 'server', 'in progress → waiting on you'], [at(11, 52), 'server', 'waiting on you → in progress']],
  ...more,
})
/** B855 held by Digger, the garden's worker. */
export const b855d = (more = {}) => b855(more, 'Digger')

const appChat = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\garden', isArchived: false, createdAt: name.length, lastActivityAt: at(11, 0), lastAssistantUuid: 'u-1' })
/** The card a chat typed: its task's words, the step of how many, the time it said was left (ms) and when. */
export const cardOf = (text, { step = null, steps = null, names = null, left = null, at: when = at(11, 14), name = 'Digger' } = {}) => JSON.stringify({ name, role: 'worker', state: 'working', at: when, task: { text, step, steps, names, left } })
/** An answer that closes its turn finished (B148). */
const DONE_YES = ['Sown.', '', '---', '', '```diff', '  Prompt: sow', '  Who:    Digger', '+ Done:   yes', '```'].join('\n')

/**
 * The garden at `now`: Lead (main), Digger (the worker) and the Advisor. Digger's turn runs (a tool call a minute ago) unless
 * `isFree`; `card` is its card, `leadCard` the main chat's (its turn then runs too), `items` the store's steps, `lines` the
 * history, `planSeen` the board's memory of plan words from an earlier read.
 */
export function stateAt(now, { items = [], card = null, leadCard = null, lines = [], isFree = false, planSeen = null, goals = null, outbox = [] } = {}) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: at(9, 0) })
  for (const one of items) work.items.set(valueOf(one, 'Id'), one)
  const tailOf = entries => ({ text: entries.join('\n'), isCut: false, modifiedAt: now - MIN })
  const running = [typed(now - 9 * MIN, 'go on'), toolStep(now - MIN, 'Running the tests')]
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [appChat('Lead'), appChat('Digger'), appChat('Advisor')],
    tails: {
      'cli-Lead': tailOf(leadCard === null ? [answer(now - 30 * MIN, 'ok')] : running),
      'cli-Digger': tailOf(isFree ? [typed(now - 40 * MIN, 'go'), answer(now - 20 * MIN, DONE_YES)] : running),
      'cli-Advisor': tailOf([answer(now - 12 * MIN, 'ok')]),
    },
    planLineTexts: { ...(card === null ? {} : { 'cli-Digger': card }), ...(leadCard === null ? {} : { 'cli-Lead': leadCard }) },
    adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, ...(goals === null ? {} : { goalsText: goals }),
  }
  return buildState(raw, { lines, outbox, runs: [], board: null, seen: null, now, planSeen, config: { ...parseConfig('{}', {}), project: 'C:\\garden' } })
}
export const digger = state => state.chats.find(lane => lane.name === 'Digger')

/** Digger's history: working from 11:10, interrupted 11:14-11:16 (B855's case), working since. */
export const B855_LINES = [
  { at: at(11, 10), chat: 'Digger', state: 'working', task: null, source: 'step' },
  { at: at(11, 14), chat: 'Digger', state: 'interrupted', task: null, source: 'step' },
  { at: at(11, 16), chat: 'Digger', state: 'working', task: null, source: 'step' },
]
/** Digger's card at 11:14, naming another task: "QA of B813", step 4 of 4, 40 min left. */
export const B855_CARD = cardOf('QA of B813: check the strip', { step: 4, steps: 4, names: ['Read', 'Build', 'Test', 'Report'], left: 40 * MIN })
