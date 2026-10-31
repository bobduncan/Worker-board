// B667 (B664's result check, principle 2 "assume every chat can fail": an open fix the partner never refines had no
// follow-up; its refine word went once, no rule, no "!", probed at +3 h and +2 d). Now the board types the refine word
// again after an hour up to its cap, the rule open-fix names the fix once its time and the last word's are past, and the
// health summary marks it as the rule does. Made-up words.
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { BOARD_TRIES, FIX_RETRY_MS, refineWhenDue } from '../../src/refineGate.mjs'
import { refinedKey } from '../../src/backlog.mjs'
import { ANOTHER_WAY, reviewWaitOf } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 7, 38).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 2 of 4 points pass; fix ${fix} for Painter`
const reviewed = (id, minutes, fix, head = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Painter', Since: stamp(ago(minutes)), ...head },
  { 'What we build': ['- round islands on whole cells'], History: [passed(minutes), failed(minutes - 5, fix)] },
)
/** The open fix the board made of a chain's third try, `minutes` ago, with the History lines `history`. */
const openFix = (minutes, history = []) => item(
  { Id: 'B659', Kind: 'step', Title: 'Fix: the outline still steps', State: 'new', Since: stamp(ago(minutes)), 'Fix of': 'B654', Refined: 'open' },
  { 'What we build': [`- ${ANOTHER_WAY} (tried: B618, B636, B654)`], History: [`- ${stamp(ago(minutes))} Checker: made by the result check of B654`, ...history] },
)
const chain = (minutes, history) => items(reviewed('B636', 200, 'B654'), reviewed('B654', minutes + 30, 'B659', { 'Fix of': 'B636' }), openFix(minutes, history))
const word = (minutes, state = 'delivered') => ({ id: `r${minutes}`, to: 'Partner', command: 'refine', about: 'B659', at: ago(minutes), state, board: true })

const LANES = [{ name: 'Lead', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [] }, { name: 'Painter', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] }]
const view = (store, more = {}) => buildView({
  state: { chats: LANES, advisor: { name: 'Partner' }, backlog: more.backlog, today: [], limits: {}, pause: more.pause ?? null, chatPrefix: '', readyList: { ready: [], held: [] } },
  items: store, outbox: more.outbox ?? [], settings: {}, seen: null, now: NOW,
})
const check = board => WATCH_RULES.find(one => one.id === 'open-fix').check(board, { seen: new Map(), observed: [] })
const marked = (board, id) => healthSummary(board, NOW).split('\n').some(one => one.startsWith(`- ! ${id} `))

test('a step in review behind a fix with no refine round waits for that fix, not refined yet', () => {
  const wait = reviewWaitOf(chain(30).get('B654'), chain(30))
  assert.equal(wait.kind, 'fix')
  assert.equal(wait.end, 'B659')
  assert.equal(wait.unrefined.since, new Date(stamp(ago(30)).replace(' ', 'T')).getTime())
  assert.equal(wait.text, 'waits for its fix B659, not refined yet')
  // Further up the chain, the last fix is named.
  assert.equal(reviewWaitOf(chain(30).get('B636'), chain(30)).text, 'waits for its fix B654, whose fix B659 is not refined yet')
  // A round written (its questions are the person's): no longer waiting for the partner.
  const round = chain(30, [`- ${stamp(ago(10))} Partner: refined, round 1`])
  assert.equal(reviewWaitOf(round.get('B654'), round).unrefined, null)
})

test('open-fix: past an hour with no refine word answered for 30 min, a case for the rule and a "!" in health', () => {
  for (const [minutes, outbox, odd] of [
    [30, [], false], // made 30 min ago: not yet
    [70, [], true], // 70 min, no word at all
    [70, [word(70), word(10)], false], // the board's retry 10 min ago had no time yet
    [70, [word(70), word(40)], true], // the retry unanswered for 40 min
    [180, [word(180), word(120), word(60)], true], // +3 h: the board's three words, all unanswered
  ]) {
    const board = view(chain(minutes), { outbox })
    const found = check(board)
    assert.equal(found.length, odd ? 1 : 0, `${minutes} min, ${outbox.length} words`)
    assert.equal(marked(board, 'B636'), odd, `health, ${minutes} min, ${outbox.length} words`)
  }
  const [stopped] = check(view(chain(180), { outbox: [word(180), word(120), word(60)] }))
  assert.equal(stopped.key, 'open-fix B659')
  assert.equal(stopped.subject, 'B659')
  assert.equal(stopped.text, 'B659 waits 3 h for the partner\'s refine, and B636 in review behind it: the board stopped asking after 3 refine words')
  assert.match(stopped.evidence, /^the chain B636 → B654 → B659; B659 made \d\d:\d\d, no refine round since; refine words 04:38 delivered, 05:38 delivered, 06:38 delivered; refine gate free$/)
  // +2 d: still a case, one per fix (B636 and B654 in review behind it).
  assert.equal(check(view(chain(2 * 24 * 60), { outbox: [word(2880)] })).length, 1)
})

test('open-fix: no case once the partner wrote a round, while the person pauses, or for a fix that is refined', () => {
  assert.deepEqual(check(view(chain(180, [`- ${stamp(ago(100))} Partner: refined, round 1`]))), [])
  assert.deepEqual(check(view(chain(180), { pause: { state: 'pausing', since: ago(5) } })), [])
  const refined = chain(180)
  refined.get('B659').head.set('State', 'refined')
  assert.deepEqual(check(view(refined)), [])
})

test('the board types an open fix\'s refine word again after an hour, up to its cap', () => {
  const refined = { ready: false, questions: [], accepted: null, asks: [] }
  const open = { id: 'B659', text: 'Fix: the outline still steps', status: 'open', refined, item: { fixOf: 'B654', what: [`${ANOTHER_WAY} (tried: B618)`], history: [] } }
  const sent = minutes => ({ ...word(minutes), before: refinedKey(refined) })
  const due = outbox => refineWhenDue({ advisor: { name: 'Partner' }, backlog: [{ name: 'Maps', steps: [open] }] }, outbox, { since: 9999, queuedBefore: [], waiting: [] }, NOW).refine
  assert.equal(FIX_RETRY_MS, 60 * MIN)
  assert.equal(due([sent(30)]), null)
  assert.equal(due([sent(70)])?.about, 'B659')
  assert.equal(due([sent(70)]).board, true)
  // BOARD_TRIES words arrived with no round: the board stops on it (the rule names it).
  assert.equal(due(Array.from({ length: BOARD_TRIES }, (_, at) => sent(70 + at * 60))), null)
})

// B868 (X115): the evidence names the refine ask that holds the gate, so the next sighting shows its cause.
test('open-fix: the evidence names the refine ask that holds the refine gate, or says it is free', () => {
  const held = [{ name: 'Maps', steps: [
    { id: 'B854', status: 'open', refineAsk: { isOpen: true, state: 'taken', round: 2, at: ago(150) } },
    { id: 'B855', status: 'open', refineAsk: { isOpen: false, state: 'delivered', round: 1, at: ago(170) } },
  ] }]
  const [found] = check(view(chain(180), { outbox: [word(180)], backlog: held }))
  assert.match(found.evidence, /; refine gate held by B854 round 2 \(taken since \d\d:\d\d\)$/)
  const [free] = check(view(chain(180), { outbox: [word(180)], backlog: [] }))
  assert.match(free.evidence, /; refine gate free$/)
})
