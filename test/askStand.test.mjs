// The person, 2026-10-26: "in the future i want to see where the questions are. e.g. is the advisor currently working on
// them or not. is it in its queue?" Each question the partner answers first (Route: partner) gets a stand, from facts the
// board has: "in the Advisor's queue" (no word for it was taken yet), "the Advisor is on it" (its word was taken, or its
// task names the ask), and when the 30-minute rule hands it to the person. The server builds the stand (state's
// `withPartner[].stand`); the page only words it: in "With your partner", on the Advisor's line and in the ask's window.
// Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { PARTNER_ANSWER_MS, isPartnerAskWord, partnerAskStand } from '../src/work/partnerAnswers.mjs'
import { storeFromText } from '../src/work/read.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const css = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const MIN = 60_000

// ---- the server: the stand of one ask ----

const FILED = Date.UTC(2026, 9, 26, 13, 0)
const word = (extra = {}) => ({ id: 'w1', at: FILED + MIN, to: 'Advisor', command: 'work', kind: 'partner-ask', about: 'Q1', text: 'work: Q1 is yours to answer for the person; run work next', state: 'waiting', ...extra })

test('a word for the partner about an ask: the partner-ask kind, or the board\'s sync check for it', () => {
  assert.equal(isPartnerAskWord(word()), true)
  assert.equal(isPartnerAskWord(word({ kind: 'sync', syncKey: 'partner-ask Q1 2' })), true)
  assert.equal(isPartnerAskWord(word({ kind: 'note' })), false)
  assert.equal(isPartnerAskWord(word({ kind: undefined })), false)
})

test('queued: no word for the ask was taken yet; the time is when the ask was filed', () => {
  const at = outbox => partnerAskStand({ id: 'Q1', filed: FILED, outbox })
  // No record at all: routed and open, so it stands in the Advisor's queue, never "on it".
  assert.deepEqual(at([]), { kind: 'queued', since: FILED, toYouAt: FILED + PARTNER_ANSWER_MS })
  // A word that waits (the Advisor was busy, or the line is held) is still the queue.
  assert.equal(at([word()]).kind, 'queued')
  // Words that never reached the chat are no start: failed, closed, expired, copied for pasting.
  for (const state of ['failed', 'dropped', 'expired', 'copied', 'stopped']) assert.equal(at([word({ state })]).kind, 'queued', state)
  // Another ask's word, a word of another kind, and a taken word of another ask count for nothing here.
  assert.equal(at([word({ about: 'Q2', state: 'taken', takenAt: FILED + 2 * MIN })]).kind, 'queued')
  assert.equal(at([word({ kind: 'note', state: 'taken', takenAt: FILED + 2 * MIN })]).kind, 'queued')
})

test('working: its word was taken by the Advisor (taken or typed) and the ask is still open; since is when it took it', () => {
  const at = outbox => partnerAskStand({ id: 'Q1', filed: FILED, outbox })
  assert.deepEqual(at([word({ state: 'taken', takenAt: FILED + 3 * MIN })]), { kind: 'working', since: FILED + 3 * MIN, toYouAt: FILED + PARTNER_ANSWER_MS })
  assert.deepEqual(at([word({ state: 'delivered', takenAt: FILED + 3 * MIN, deliveredAt: FILED + 4 * MIN })]).since, FILED + 3 * MIN)
  // The board's sync check for the ask is a word for it too.
  assert.equal(at([word({ kind: 'sync', syncKey: 'partner-ask Q1 1', state: 'delivered', takenAt: FILED + 5 * MIN })]).kind, 'working')
  // The first word taken and a later one that waits: it has the ask since the first.
  assert.deepEqual(at([word({ state: 'delivered', takenAt: FILED + 3 * MIN }), word({ id: 'w2', at: FILED + 12 * MIN })]), { kind: 'working', since: FILED + 3 * MIN, toYouAt: FILED + PARTNER_ANSWER_MS })
})

test('working: the Advisor\'s own task names the ask, by its whole id only', () => {
  const on = text => partnerAskStand({ id: 'Q42', filed: FILED, outbox: [], task: { text, stepId: null, startedAt: FILED + 6 * MIN } })
  assert.deepEqual(on('Answer Q42 for the person'), { kind: 'working', since: FILED + 6 * MIN, toYouAt: FILED + PARTNER_ANSWER_MS })
  assert.equal(on('Answer Q423 and Q4').kind, 'queued', 'Q423 and Q4 are other asks')
  assert.equal(on('Plan the pond').kind, 'queued')
  assert.equal(partnerAskStand({ id: 'Q42', filed: FILED, outbox: [], task: { text: 'Plan', stepId: 'Q42' } }).kind, 'working')
  assert.equal(partnerAskStand({ id: 'Q42', filed: FILED, outbox: [], task: { text: 'Plan', step: 2, names: ['Read', 'Reply to Q42'] } }).kind, 'working')
  assert.equal(partnerAskStand({ id: 'Q42', filed: FILED, outbox: [], task: { text: 'Plan', step: 1, names: ['Read', 'Reply to Q42'] } }).kind, 'queued', 'only its current step counts')
  // The task's start is unknown: it is on it, since unknown.
  assert.deepEqual(partnerAskStand({ id: 'Q42', filed: FILED, outbox: [], task: { text: 'Answer Q42' } }), { kind: 'working', since: null, toYouAt: FILED + PARTNER_ANSWER_MS })
})

test('when it comes to the person: 30 minutes after the ask was filed; unknown when the filing is unknown', () => {
  assert.equal(partnerAskStand({ id: 'Q1', filed: FILED, outbox: [] }).toYouAt, FILED + 30 * MIN)
  assert.equal(PARTNER_ANSWER_MS, 30 * MIN)
  assert.deepEqual(partnerAskStand({ id: 'Q1', filed: Number.NaN, outbox: [] }), { kind: 'queued', since: null, toYouAt: null })
})

// ---- the state ----

const NOW = Date.UTC(2026, 9, 26, 13, 20)
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const app = name => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 5 * MIN, lastAssistantUuid: 'u-1' })
const tail = lines => ({ text: lines.join('\n'), isCut: false, modifiedAt: NOW })
const planLine = task => JSON.stringify({ name: 'x', role: 'worker', state: 'working', task: { isReported: false, ...task }, at: NOW - 10 * MIN })
const pad = value => String(value).padStart(2, '0')
const sinceOf = at => {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const routed = (id, filed, more = '') => parseItem(`Id: ${id}\nKind: ask\nTitle: Number or bar?\nState: open\nOwner: Digger\nSince: ${sinceOf(filed)}\nFiled: ${filed}\nAsks: decide\nBlocking: no\nOf: B12\nOptions: A number | B bar\nAdvice: A\nRoute: partner\n${more}`)

function build({ items, advisor = [typed(NOW - 12 * MIN, 'Plan the pond'), answer(NOW - 11 * MIN, 'ok')], plan = null, outbox = [] }) {
  const work = storeFromText('## Garden\n- [ ] B12 Plant the hedge\n', { now: NOW - 60 * MIN })
  for (const one of items) work.items.set(one.head.get('Id'), one)
  const raw = {
    listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: [app('Lead'), app('Digger'), app('Advisor')],
    tails: { 'cli-Lead': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Digger': tail([answer(NOW - 30 * MIN, 'ok')]), 'cli-Advisor': tail(advisor) },
    planLineTexts: plan === null ? {} : { 'cli-Advisor': planLine(plan) },
    adviceText: null, folders: null, askTexts: [], pictureLists: {}, work,
  }
  return buildState(raw, { lines: [], outbox, runs: [], board: null, seen: null, now: NOW, config })
}
const sent = (id, extra) => ({ id, at: NOW - 15 * MIN, to: 'Advisor', ask: null, step: null, title: null, version: null, verdict: null, command: 'work', kind: 'partner-ask', about: 'Q1', text: 'work: Q1 is yours to answer for the person; run work next', state: 'waiting', ...extra })

test('the state: an ask nobody has taken stands in the queue; its word waiting is still the queue', () => {
  const filed = NOW - 15 * MIN
  const none = build({ items: [routed('Q1', filed)] })
  assert.deepEqual(none.withPartner.map(one => [one.id, one.stand]), [['Q1', { kind: 'queued', since: filed, toYouAt: filed + 30 * MIN }]])
  const waiting = build({ items: [routed('Q1', filed)], outbox: [sent('w1', {})] })
  assert.equal(waiting.withPartner[0].stand.kind, 'queued')
})

test('the state: its word taken by the Advisor and the ask still open: the Advisor is on it, since it took it', () => {
  const filed = NOW - 15 * MIN
  const taken = build({ items: [routed('Q1', filed)], outbox: [sent('w1', { state: 'taken', takenAt: NOW - 14 * MIN })] })
  assert.deepEqual(taken.withPartner[0].stand, { kind: 'working', since: NOW - 14 * MIN, toYouAt: filed + 30 * MIN })
  const typedIn = build({ items: [routed('Q1', filed)], outbox: [sent('w1', { state: 'delivered', takenAt: NOW - 14 * MIN, deliveredAt: NOW - 13 * MIN })] })
  assert.equal(typedIn.withPartner[0].stand.kind, 'working')
  // Two asks: each has its own stand.
  const two = build({ items: [routed('Q1', filed), routed('Q2', NOW - 5 * MIN)], outbox: [sent('w1', { state: 'delivered', takenAt: NOW - 14 * MIN })] })
  assert.deepEqual(two.withPartner.map(one => [one.id, one.stand.kind]), [['Q1', 'working'], ['Q2', 'queued']])
})

test('the state: the Advisor at work on a task that names the ask is on it; an idle Advisor is not, whatever its card says', () => {
  const filed = NOW - 15 * MIN
  const plan = { text: 'Answer Q1 for the person', step: 1, steps: 2, names: ['Read Q1', 'Reply'], left: 20 * MIN, stepLeft: 5 * MIN }
  const working = build({ items: [routed('Q1', filed)], advisor: [typed(NOW - 12 * MIN, 'Answer Q1'), step(NOW - MIN, 'Read')], plan })
  assert.equal(working.advisor.state, 'working')
  assert.equal(working.withPartner[0].stand.kind, 'working')
  const idle = build({ items: [routed('Q1', filed)], advisor: [typed(NOW - 12 * MIN, 'Answer Q1'), answer(NOW - 11 * MIN, 'ok')], plan: { ...plan, isReported: true } })
  assert.notEqual(idle.advisor.state, 'working')
  assert.equal(idle.withPartner[0].stand.kind, 'queued')
})

test('the state: it comes to the person when the 30-minute rule hands it over, the same minute the board does it', () => {
  const filed = NOW - 29 * MIN
  const before = build({ items: [routed('Q1', filed)] })
  assert.equal(before.withPartner[0].stand.toYouAt, NOW + MIN)
  assert.deepEqual(before.reconciled.escalations, [])
  // A minute on the rule hands it over; the stand named exactly that time.
  const at = build({ items: [routed('Q1', NOW - 30 * MIN)] })
  assert.deepEqual(at.reconciled.escalations.map(one => one.id), ['Q1'])
  assert.equal(at.withPartner[0].stand.toYouAt, NOW)
})

test('the state: an answered ask, or one handed to the person, leaves the list and has no stand', () => {
  const answered = parseItem(`Id: Q2\nKind: ask\nTitle: Icons?\nState: answered\nOwner: Digger\nSince: ${sinceOf(NOW - 5 * MIN)}\nFiled: ${NOW - 9 * MIN}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: partner\nAnswered by: partner\n\n## Answer\nA\n`)
  const handed = parseItem(`Id: Q3\nKind: ask\nTitle: Money?\nState: open\nOwner: Digger\nSince: ${sinceOf(NOW - 5 * MIN)}\nFiled: ${NOW - 9 * MIN}\nAsks: decide\nBlocking: no\nOf: B12\nRoute: person\n`)
  assert.deepEqual(build({ items: [answered, handed, routed('Q1', NOW - 15 * MIN)] }).withPartner.map(one => one.id), ['Q1'])
})

test('the state: what the ask\'s window shows comes with the entry: context, options, advice, its step', () => {
  const entry = build({ items: [routed('Q1', NOW - 15 * MIN, '\n## Text\nNumber or bar? The damage shows over the unit.\n')] }).withPartner[0]
  assert.equal(entry.id, 'Q1')
  assert.equal(entry.from, 'Digger')
  assert.equal(entry.of, 'B12')
  assert.equal(entry.ofTitle, 'Plant the hedge')
  assert.deepEqual(entry.options, [{ label: 'A number', isRecommended: true }, { label: 'B bar', isRecommended: false }])
  assert.equal(entry.advice, 'A')
  assert.equal(typeof entry.text, 'string')
})

// ---- the page ----

/** The source of a top-level function, or of a one-line const, by its name. */
function source(name) {
  const start = script.search(new RegExp(`^(async )?function ${name}[(]|^const ${name} = `, 'm'))
  assert.ok(start >= 0, `${name} is not in board.js`)
  const lines = script.slice(start).split('\n')
  if (lines[0].startsWith('const') && !lines[0].trimEnd().endsWith('{')) return lines[0]
  const end = lines.findIndex((line, index) => index > 0 && line.startsWith('}'))
  return lines.slice(0, end + 1).join('\n')
}
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))

class Node {
  constructor(tag) {
    Object.assign(this, { tag, style: {}, className: '', textContent: '', children: [], dataset: {}, attrs: {}, title: '', type: '', href: '', open: false, parent: null })
    this.classList = { remove: () => {}, add: () => {} }
  }
  append(...items) {
    for (const one of items) {
      const node = typeof one === 'string' ? { tag: '#text', textContent: one, children: [] } : one
      node.parent = this
      this.children.push(node)
    }
  }
  replaceChildren(...items) {
    this.children = []
    this.append(...items)
  }
  setAttribute(name, value) { this.attrs[name] = value }
  querySelector() { return null }
  addEventListener() {}
}
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap(one => all(one, test))]
const words = node => (node.textContent ?? '') + (node.children ?? []).map(words).join('')
const plain = value => JSON.parse(JSON.stringify(value))

const at = (hour, minute) => new Date(2026, 9, 26, hour, minute).getTime()

const page = {
  document: { createElement: tag => new Node(tag), activeElement: null },
  MIN,
  withPartnerUi: { isOpen: true },
}
vm.runInNewContext([
  'const MIN = 60000', cut('times'), cut('askstand'), cut('partner-answers'), cut('advisorlane'),
  source('el'), source('fill'), source('detailsHead'), source('section'), source('keepUnfolded'), source('drawWithPartner'),
  'const KINDS = { input: { sign: "?", tag: "Input needed" } }',
  'let detailsOf = null\nlet detailsShown = null',
  'Object.assign(this, { standWords, withPartnerView, drawWithPartner, advisorQueued, drawWaitingAsks, partnerAskWindowOf, drawPartnerAskWindow })',
].join('\n'), page)

const queued = { kind: 'queued', since: at(14, 2), toYouAt: at(14, 32) }
const working = { kind: 'working', since: at(14, 5), toYouAt: at(14, 32) }

test('the words: where the question stands, then when it comes to you', () => {
  assert.equal(page.standWords(queued), 'in the Advisor\'s queue since 14:02 · comes to you at 14:32')
  assert.equal(page.standWords(working), 'the Advisor is on it since 14:05 · comes to you at 14:32')
  // What the board does not know is left out, never made up.
  assert.equal(page.standWords({ kind: 'working', since: null, toYouAt: at(14, 32) }), 'the Advisor is on it · comes to you at 14:32')
  assert.equal(page.standWords({ kind: 'queued', since: at(14, 2), toYouAt: null }), 'in the Advisor\'s queue since 14:02')
  assert.equal(page.standWords(null), null)
  assert.equal(page.standWords(undefined), null)
  assert.equal(page.standWords({ kind: 'mystery', since: null, toYouAt: null }), null)
})

const asks = [
  { id: 'Q1', from: 'Digger', title: 'Number or bar?', of: 'B12', at: at(14, 2), stand: queued },
  { id: 'Q2', from: 'Lead', title: 'Icons?', of: null, at: at(14, 0), stand: working },
]

test('With your partner: each row carries its stand in words, after the row', () => {
  const view = plain(page.withPartnerView(asks))
  assert.deepEqual(view.rows.map(row => [row.id, row.text, row.stand]), [
    ['Q1', 'Q1 · Digger: Number or bar?', 'in the Advisor\'s queue since 14:02 · comes to you at 14:32'],
    ['Q2', 'Q2 · Lead: Icons?', 'the Advisor is on it since 14:05 · comes to you at 14:32'],
  ])
  // An older server without a stand: the row as it was, no stand invented.
  assert.equal(plain(page.withPartnerView([{ id: 'Q1', from: 'Digger', title: 'Number or bar?' }])).rows[0].stand, null)
  const part = page.drawWithPartner({ withPartner: asks, ui: { withPartnerOpen: true } })
  const items = all(part, node => node.tag === 'li')
  assert.equal(items.length, 2)
  assert.equal(words(items[0]), 'Q1 · Digger: Number or bar?in the Advisor\'s queue since 14:02 · comes to you at 14:32')
  assert.equal(words(items[1]), 'Q2 · Lead: Icons?the Advisor is on it since 14:05 · comes to you at 14:32')
  // The stand is its own quiet line, the link stays the link.
  const stand = all(items[0], node => node.className.includes('with-partner-stand'))
  assert.equal(stand.length, 1)
  assert.equal(all(items[0], node => node.tag === 'a').length, 1)
  assert.match(all(items[0], node => node.tag === 'a')[0].href, /^#details=Q1$/)
  // Folded: only the count.
  assert.equal(all(page.drawWithPartner({ withPartner: asks, ui: { withPartnerOpen: false } }), node => node.tag === 'li').length, 0)
})

test('the Advisor\'s line: "Waiting for it", each question a link, with its stand in words', () => {
  const view = page.advisorQueued({ refines: 0, rounds: 0, words: 0 }, asks)
  assert.deepEqual(plain(view.asks).map(one => [one.id, one.href, one.stand]), [
    ['Q1', '#details=Q1', 'in the Advisor\'s queue since 14:02 · comes to you at 14:32'],
    ['Q2', '#details=Q2', 'the Advisor is on it since 14:05 · comes to you at 14:32'],
  ])
  const line = page.drawWaitingAsks(view.asks)
  assert.match(words(line), /^Waiting for it: /)
  const rows = all(line, node => node.className.includes('advisor-lane-ask-row'))
  assert.deepEqual(rows.map(words), [
    'Q1 · Digger: Number or bar?in the Advisor\'s queue since 14:02 · comes to you at 14:32',
    'Q2 · Lead: Icons?the Advisor is on it since 14:05 · comes to you at 14:32',
  ])
  assert.equal(all(line, node => node.tag === 'a').length, 2)
  // Without a stand the row is the link alone.
  const bare = page.advisorQueued(undefined, [{ id: 'Q9', from: 'Digger', title: 'Icons?' }])
  assert.equal(plain(bare.asks)[0].stand, null)
  assert.equal(words(page.drawWaitingAsks(bare.asks)), 'Waiting for it: Q9 · Digger: Icons?')
  // The lane draws it where it drew the line before.
  const lane = source('drawAdvisorLane')
  assert.match(lane, /drawWaitingAsks\(queued\.asks\)/)
})

test('the ask\'s window: its question, options, advice and step, and where it stands', () => {
  const ask = {
    ...asks[0], ofTitle: 'Plant the hedge', text: 'The damage shows over the unit.', advice: 'A',
    options: [{ label: 'A number', isRecommended: true }, { label: 'B bar', isRecommended: false }],
  }
  const view = plain(page.partnerAskWindowOf(ask))
  assert.equal(view.code, 'Q1')
  assert.equal(view.title, 'Number or bar?')
  assert.deepEqual(view.chips, [{ text: 'With your partner', tone: 'kind' }, { text: 'From: Digger', tone: 'to' }])
  assert.equal(view.stand, 'in the Advisor\'s queue since 14:02 · comes to you at 14:32')
  const box = new Node('dialog')
  page.drawPartnerAskWindow(box, ask, { readAt: at(14, 10) })
  const text = words(box)
  for (const part of ['Q1', 'Number or bar?', 'With your partner', 'From: Digger', 'in the Advisor\'s queue since 14:02 · comes to you at 14:32', 'The damage shows over the unit.', 'A number', 'B bar', 'Plant the hedge']) {
    assert.ok(text.includes(part), part)
  }
  assert.ok(text.includes('A number (recommended)'), 'the advised option is marked')
  // The Advisor is on it: the window says that.
  const on = new Node('dialog')
  page.drawPartnerAskWindow(on, { ...ask, stand: working }, { readAt: at(14, 10) })
  assert.ok(words(on).includes('the Advisor is on it since 14:05 · comes to you at 14:32'))
  // No stand from the server: no line about it, nothing made up.
  const bare = new Node('dialog')
  page.drawPartnerAskWindow(bare, { ...ask, stand: undefined }, { readAt: at(14, 10) })
  assert.ok(!words(bare).includes('Advisor'))
})

test('the link opens the window: #details=Q1 and an ask-link find a question that is with the partner', () => {
  const open = source('openStepWindow')
  assert.match(open, /state\.withPartner/)
  assert.match(open, /openDetails\(\{ partnerAsk: code \}\)/)
  const subject = source('subjectOf')
  assert.match(subject, /detailsOf\.partnerAsk/)
  assert.match(subject, /state\.withPartner/)
  const drawn = source('drawDetails')
  assert.match(drawn, /subject\.partnerAsk !== undefined/)
  assert.match(drawn, /drawPartnerAskWindow\(box, subject\.partnerAsk, state\)/)
  // The ask-link buttons find it too.
  assert.match(script, /board\.withPartner \?\? \[\]\)\.some\(one => one\.id === id\)/)
})

test('quiet colours: the stand lines are muted, none in amber, gold, orange or red', () => {
  const rules = css.split('}').filter(rule => /with-partner-stand|advisor-lane-ask-row|partner-ask-stand/.test(rule))
  assert.ok(rules.length >= 2, 'the stand lines have their rules')
  for (const rule of rules) assert.doesNotMatch(rule, /amber|gold|orange|red|#f[0-9a-f]{2}[0-9a-f]{0,3}\b|--warn|--bad|--attention/i)
})
