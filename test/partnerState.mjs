// The made-up garden project the Partner answers tests build their state from (B415: shared by the state tests and the
// page tests, which hand the page the state the board would send). Made-up names only.
import { answer, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { PAGE } from './pageHarness.mjs'
import { buildState } from './withStore.mjs'

/** The page's own minute: the fixtures are built in the time the page reads them in. */
export const MIN = PAGE.MIN
export const NOW = Date.UTC(2026, 9, 19, 10, 0)
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
export const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: 'C:\\garden', isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
export const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
export const sinceOf = at => {
  const date = new Date(at)
  const two = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
export const ask = (id, route, at) => parseItem(`Id: ${id}\nKind: ask\nTitle: Number or bar?\nState: open\nOwner: Digger\nSince: ${sinceOf(at)}\nFiled: ${at}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A number | B bar\nAdvice: A\n${route === null ? '' : `Route: ${route}\n`}`)

export function build(items, partnerAnswers, goalsText = undefined, more = {}) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  if (partnerAnswers !== undefined) work.partnerAnswers = partnerAnswers
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail([typed(NOW - 20 * MIN, 'hi'), answer(NOW - 12 * MIN, 'ok')]) },
    planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {}, work, ...(goalsText === undefined ? {} : { goalsText }), ...more,
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], board: null, seen: null, now: NOW, config })
}

export const DAY = 24 * 60 * MIN
export const parsed = text => parseItem(text.replace(/^ +/gm, ''))
export const answered = (id, note, line, at) => parsed(`Id: ${id}\nKind: ask\nTitle: Icons?\nState: answered\nOwner: Digger\nSince: ${sinceOf(at)}\nFiled: ${at - MIN}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A icons | B words\nAdvice: A\nRoute: partner\nAnswered by: partner\nDaily note: ${note}\n\n## Answer\nA\n\n## Why\nyour advice\n\n## Note line\n${line}\n`)
export const L1 = 'Q5 (Digger, B12): Icons? → A (your advice)'
export const L2 = 'Q6 (Digger, B12): Icons? → A (your advice)'
export const L3 = 'Q8 (Digger, B12): Icons? → A (your advice)'
export const L4 = 'Q7 (Digger, B12): Icons? → A (your advice)'
export const note = (id, at, decided, undone = []) => parsed([`Id: ${id}`, 'Kind: note', 'From: Advisor', 'To: you', 'Of: G6', 'State: unread', `Since: ${sinceOf(at)}`, 'Text: the note', '',
  '## Decided for you', ...decided.map(one => `- ${one}`), '', '## Needs you', '', ...(undone.length === 0 ? [] : ['## Undo asked', ...undone.map(one => `- ${one} (2026-10-19 09:30)`), '']), '## History', `- ${sinceOf(at)} Advisor: noted (the daily note)`, ''].join('\n'))
export const GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')


/** The goal map with the focus in its run (vibe and how agreed), where the Focus page draws today's note and the switch. */
// Goal definition (2026-10-31): the goal's lines are named `Goal definition…` now (they were `Vibe…`); the fixture is written as the board writes it.
export const RUN_GOALS = ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', '    Goal definition: every fight reads at a glance',
  '    Goal definition agreed: 2026-10-18 10:00', '    Part: Show damage · about 1 h · steps B1', '    How agreed: 2026-10-18 11:00', ''].join('\n')

/** The board's state as JSON, as the page reads it. */
export const asSent = state => JSON.parse(JSON.stringify(state))
