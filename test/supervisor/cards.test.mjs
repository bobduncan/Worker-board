// The supervisor's incident cards (2026-10-24, the person's choice of layout B): one card per fix step, each with the live
// state of that step in a small chip, and one card "No fix step yet" for the incidents nobody has taken up. Grouping by
// the incident's Fix (and, only when no Fix counts, by a step titled "Fix of X<n>"), each state word from the step's
// record and its worker's lane, the three states of the card without a fix step, the order. Made-up samples only,
// shaped like the day the layout was drawn on.

import assert from 'node:assert/strict'
import test from 'node:test'

import { incidentCards, incidentsNamedBy, noFixState, stepState } from '../../src/supervisor/cards.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const at = (h, m) => new Date(2026, 9, 24, h, m).getTime()

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}, history = []) => item(
  { Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(at(18, 0)), ...more },
  history.length === 0 ? {} : { History: history.map(([time, who, what]) => `- ${stamp(time)} ${who}: ${what}`) },
)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, state = 'free', more = {}) => ({ name, isMain: false, isLeftover: false, state, ...more })
const incident = (id, more = {}) => ({
  id, title: `Incident ${id}`, state: 'with the advisor', fix: null, source: 'sweep', subject: 'board', count: 1,
  firstSeen: at(18, 20), lastSeen: at(18, 20), since: at(18, 30), evidence: null, ruleWanted: null, ...more,
})
const plain = value => JSON.parse(JSON.stringify(value))
/** A card without its time, for comparing the rest. */
const shown = cards => cards.map(({ at: _at, ...card }) => card)

test('grouped by the incident\'s Fix: one card per fix step, with the incidents it covers in order of their ids', () => {
  const cards = incidentCards({
    incidents: [incident('X3', { state: 'fix', fix: 'B532' }), incident('X1', { state: 'fix', fix: 'B532' }), incident('X7', { state: 'fix', fix: 'B542' }), incident('X2', { state: 'fix', fix: 'B532' })],
    items: items(step('B532', 'in progress', { Owner: 'Worker 5', Title: 'Outbox: messages that never arrive' }), step('B542', 'refined', { Title: 'A block clears when its blocker is done' })),
    lanes: [lane('Worker 5', 'working')],
  })
  assert.deepEqual(shown(cards).map(card => [card.key, card.step, card.title, card.incidents.map(one => one.id)]), [
    ['B532', 'B532', 'Outbox: messages that never arrive', ['X1', 'X2', 'X3']],
    ['B542', 'B542', 'A block clears when its blocker is done', ['X7']],
  ])
  assert.ok(cards.every(card => card.incidents.every(one => one.word === null)), 'only the card without a fix step says each incident\'s own state')
})

test('a step titled "Fix of X<n>" is read as that incident\'s fix, but only as a fallback when no Fix counts', () => {
  const all = items(
    step('B541', 'refined', { Title: 'Fix of X4: chats on an older Workers mod get one clear way to restart' }),
    step('B545', 'refined', { Title: 'Fix of X4: another try' }),
    step('B600', 'refined', { Title: 'Fix of X5: one more' }),
  )
  // X4 has no Fix: the newest try. X5 has a Fix, which wins over the title of B600.
  const cards = incidentCards({
    incidents: [incident('X4'), incident('X5', { state: 'fix', fix: 'B541' })], items: all,
  })
  assert.deepEqual(shown(cards).map(card => [card.step, card.incidents.map(one => one.id)]).sort(), [['B541', ['X5']], ['B545', ['X4']]])
  // A dropped step is no fix; a done one is the old try of an incident that is open again; neither is read.
  const old = incidentCards({
    incidents: [incident('X4', { state: 'came back', fix: 'B541' })],
    items: items(step('B541', 'done', { Title: 'Fix of X4: first' }), step('B545', 'dropped', { Title: 'Fix of X4: second' })),
  })
  assert.deepEqual(shown(old).map(card => [card.key, card.incidents.map(one => one.id)]), [['nofix', ['X4']]])
  // A list and a range in the title name each incident.
  assert.deepEqual(incidentsNamedBy('Fix of X4, X5 and X9: all of them'), ['X4', 'X5', 'X9'])
  assert.deepEqual(incidentsNamedBy('Fix of X4-X6: chats'), ['X4', 'X5', 'X6'])
  assert.deepEqual(incidentsNamedBy('Fix of X4–X6: chats'), ['X4', 'X5', 'X6'])
  assert.deepEqual(incidentsNamedBy('Fix of X7: a block clears'), ['X7'])
  assert.deepEqual(incidentsNamedBy('Fix of X1-X99999'), ['X1'], 'a stray range cannot fill the section')
  assert.deepEqual([incidentsNamedBy('Make a fix of X4'), incidentsNamedBy(''), incidentsNamedBy(null)], [[], [], []])
  const listed = incidentCards({ incidents: [incident('X4'), incident('X5'), incident('X6')], items: items(step('B541', 'refined', { Title: 'Fix of X4-X6: one clear way' })) })
  assert.deepEqual(shown(listed).map(card => [card.step, card.incidents.map(one => one.id)]), [['B541', ['X4', 'X5', 'X6']]])
})

test('an incident that came back, or is open again, is not under the Fix that did not hold', () => {
  const cards = incidentCards({
    incidents: [incident('X1', { state: 'came back', fix: 'B532' }), incident('X2', { state: 'open', fix: 'B533' }), incident('X3', { state: 'fixed', fix: 'B532' })],
    items: items(step('B532', 'done'), step('B533', 'dropped')),
  })
  assert.deepEqual(shown(cards).map(card => [card.key, card.state.text, card.incidents.map(one => one.id)]), [
    ['B532', 'done · fixed', ['X3']],
    ['nofix', 'came back', ['X1', 'X2']],
  ])
})

test('each state word comes from the step\'s record and its worker\'s lane', () => {
  const of = (state, more, lanes = [], list = []) => plain(stepState(step('B9', state, more), { lanes, steps: items(...list) }))
  assert.deepEqual(of('new'), { text: 'new · waits for the Advisor', tone: 'wait' })
  assert.deepEqual(of('refined'), { text: 'refined · on the list', tone: 'wait' })
  assert.deepEqual(of('queued', { Owner: 'Worker 2' }), { text: 'queued for Worker 2', tone: 'wait' })
  assert.deepEqual(of('queued'), { text: 'queued', tone: 'wait' })
  // Only what is still open is waited for.
  const blockers = [step('B529', 'in progress'), step('B530', 'review'), step('B531', 'done'), step('B532', 'queued')]
  assert.equal(of('queued', { Owner: 'Worker 2', 'Blocked by': 'B529' }, [], blockers).text, 'queued for Worker 2 · after B529')
  assert.equal(of('queued', { Owner: 'Worker 2', 'Blocked by': 'B531' }, [], blockers).text, 'queued for Worker 2')
  assert.equal(of('queued', { Owner: 'Worker 2', 'Blocked by': 'B529, B530, B532' }, [], blockers).text, 'queued for Worker 2 · after B529, B530 +1')
  assert.deepEqual(of('in progress', { Owner: 'Worker 5' }, [lane('Worker 5', 'working')]), { text: 'Worker 5 · building', tone: 'busy' })
  assert.deepEqual(of('taken', { Owner: 'Worker 5' }, [lane('Worker 5', 'working')]), { text: 'Worker 5 · starting', tone: 'busy' })
  // The lane says whether the worker is at work: building only while it is.
  const idle = state => of('in progress', { Owner: 'Worker 5' }, [lane('Worker 5', state)])
  assert.deepEqual([idle('free'), idle('suspended'), idle('off'), idle('waiting'), idle('interrupted'), idle('unknown')].map(one => [one.text, one.tone]), [
    ['Worker 5 · idle', 'idle'], ['Worker 5 · paused for the limit', 'idle'], ['Worker 5 · chat is off', 'idle'],
    ['Worker 5 · waits for you', 'idle'], ['Worker 5 · interrupted', 'idle'], ['Worker 5 · state unknown', 'idle'],
  ])
  assert.equal(of('in progress', { Owner: 'Worker 5' }, []).text, 'Worker 5 · has it', 'no lane of that name')
  assert.equal(of('in progress', { Owner: 'Worker 5' }, [lane('Worker 5', 'working', { isLeftover: true })]).text, 'Worker 5 · has it', 'a leftover is no lane')
  // The owner may be only the lane that holds the step.
  assert.equal(of('in progress', {}, [lane('Worker 3', 'working', { task: { stepId: 'B9' } })]).text, 'Worker 3 · building')
  assert.deepEqual(of('waiting on you', { Owner: 'Worker 5' }), { text: 'Worker 5 · waits for you', tone: 'idle' })
  assert.deepEqual(of('review'), { text: 'in review', tone: 'review' })
  assert.deepEqual(of('done'), { text: 'done · fixed', tone: 'done' })
  assert.deepEqual(of('dropped'), { text: 'dropped', tone: 'dropped' })
  // A Fix that names a step the store does not have (or could not be read).
  const gone = incidentCards({ incidents: [incident('X1', { state: 'fix', fix: 'B999' })], items: items(step('B1', 'done')) })
  assert.deepEqual([gone[0].title, gone[0].state.text], [null, 'step not in the store'])
  const unread = incidentCards({ incidents: [incident('X1', { state: 'fix', fix: 'B999' })], items: null })
  assert.deepEqual([unread[0].title, unread[0].state.text], [null, 'step not read yet'])
})

test('the card without a fix step says what is happening: sending to the Advisor, with the Advisor, or came back', () => {
  const of = (state, word, hasPartner) => plain(noFixState({ state }, word, hasPartner))
  // Its word waits, or was just taken: sending. Delivered, or taken long ago, or the store's own state: with the Advisor.
  assert.deepEqual(of('open', 'on its way'), { text: 'sending to the Advisor…', tone: 'sending' })
  assert.deepEqual(of('open', undefined), { text: 'sending to the Advisor…', tone: 'sending' }, 'its word is made at the next check')
  assert.deepEqual(of('open', 'lost'), { text: 'sending to the Advisor…', tone: 'sending' }, 'sent again')
  assert.deepEqual(of('open', 'arrived'), { text: 'with the Advisor', tone: 'advisor' })
  assert.deepEqual(of('with the advisor', undefined), { text: 'with the Advisor', tone: 'advisor' })
  assert.deepEqual(of('came back', undefined), { text: 'came back', tone: 'back' })
  assert.deepEqual(of('came back', 'lost'), { text: 'came back', tone: 'back' })
  assert.deepEqual(of('came back', 'on its way'), { text: 'came back · sending…', tone: 'back' })
  assert.deepEqual(of('came back', 'arrived'), { text: 'with the Advisor', tone: 'advisor' })
  assert.deepEqual(of('open', undefined, false), { text: 'no Advisor on the board', tone: 'wait' })
  // On the card: its chip shows the state that needs the most attention; each incident keeps its own.
  const words = new Map([['X8', 'arrived'], ['X10', 'on its way']])
  const cards = incidentCards({ incidents: [incident('X8', { state: 'open' }), incident('X9', { state: 'with the advisor' }), incident('X10', { state: 'open' })], words })
  assert.equal(cards.length, 1)
  assert.deepEqual([cards[0].key, cards[0].step, cards[0].title, cards[0].state], ['nofix', null, 'No fix step yet', { text: 'sending to the Advisor…', tone: 'sending' }])
  assert.deepEqual(plain(cards[0].incidents), [{ id: 'X8', word: 'with the Advisor' }, { id: 'X9', word: 'with the Advisor' }, { id: 'X10', word: 'sending to the Advisor…' }])
  const back = incidentCards({ incidents: [incident('X1', { state: 'came back' }), incident('X2', { state: 'open' })], words: new Map([['X2', 'on its way']]) })
  assert.equal(back[0].state.text, 'came back', 'a returning incident is said first')
  const quiet = incidentCards({ incidents: [incident('X8'), incident('X9')] })
  assert.equal(quiet[0].state.text, 'with the Advisor')
})

test('newest activity first, the card without a fix step last; a count that grows moves nothing', () => {
  const list = [
    incident('X1', { state: 'fix', fix: 'B532', since: at(18, 31), lastSeen: at(18, 34), count: 18 }),
    incident('X4', { state: 'fix', fix: 'B541', since: at(18, 31) }),
    incident('X7', { state: 'fix', fix: 'B542', since: at(18, 31) }),
    incident('X8', { state: 'fix', fix: 'B543', since: at(18, 31) }),
    incident('X10', { state: 'open', since: at(18, 40) }),
  ]
  const all = items(
    step('B532', 'in progress', { Owner: 'Worker 5' }, [[at(15, 52), 'Worker 5', 'taken']]),
    step('B541', 'refined', {}, [[at(18, 29), 'Advisor', 'made']]),
    step('B542', 'refined', {}, [[at(18, 29), 'Advisor', 'made']]),
    step('B543', 'review', {}, [[at(18, 45), 'Worker 1', 'in progress → review']]),
  )
  const order = incidentsList => incidentCards({ incidents: incidentsList, items: all, lanes: [lane('Worker 5', 'working')] }).map(card => card.key)
  // B543 moved last (18:45); B541 and B542 tie (18:31, by their incidents' states) and stand by id; B532 (18:31) too.
  assert.deepEqual(order(list), ['B543', 'B532', 'B541', 'B542', 'nofix'])
  // The same, seen again and again: nothing moves.
  assert.deepEqual(order(list.map(one => ({ ...one, count: one.count + 40, lastSeen: at(19, 0) }))), ['B543', 'B532', 'B541', 'B542', 'nofix'])
  // A worker's checkpoint is activity: the step moves up.
  all.get('B532').sections.set('History', [`- ${stamp(at(18, 50))} Worker 5: checkpoint abc1234`])
  assert.deepEqual(order(list), ['B532', 'B543', 'B541', 'B542', 'nofix'])
  assert.equal(incidentCards({ incidents: list, items: all }).find(card => card.key === 'B532').at, at(18, 50))
  assert.deepEqual(incidentCards({ incidents: [], items: all }), [])
})

test('the day the layout was drawn on: nine incidents become five fix cards and one without a fix step', () => {
  const list = [
    ...['X1', 'X2', 'X3'].map(id => incident(id, { state: 'fix', fix: 'B532', count: 18, source: 'undelivered' })),
    ...['X4', 'X5', 'X6'].map(id => incident(id, { state: 'open', source: 'old-mod' })),
    incident('X7'), incident('X8', { state: 'open' }), incident('X9', { state: 'open' }), incident('X10', { state: 'open', since: at(18, 37) }),
  ]
  const all = items(
    step('B532', 'in progress', { Owner: 'Worker 5', Title: 'Outbox: messages that never arrive' }, [[at(16, 12), 'Worker 5', 'checkpoint']]),
    step('B541', 'refined', { Title: 'Fix of X4: one clear way to update an old mod' }, [[at(18, 29), 'Advisor', 'made']]),
    step('B542', 'refined', { Title: 'Fix of X7: a block clears when its blocker is done' }, [[at(18, 29), 'Advisor', 'made']]),
    step('B543', 'refined', { Title: 'Fix of X8: a step in review says what it waits for' }, [[at(18, 29), 'Advisor', 'made']]),
    step('B544', 'refined', { Title: 'Fix of X9: effort shows as its level' }, [[at(18, 29), 'Advisor', 'made']]),
  )
  const cards = incidentCards({ incidents: list, items: all, lanes: [lane('Worker 5', 'working')], words: new Map([['X10', 'on its way']]) })
  // Only X4 is named by its title: until the Advisor links the others, X5 and X6 have no fix step.
  assert.deepEqual(shown(cards).map(card => [card.key, card.state.text, card.incidents.map(one => one.id)]), [
    ['B532', 'Worker 5 · building', ['X1', 'X2', 'X3']],
    ['B541', 'refined · on the list', ['X4']],
    ['B542', 'refined · on the list', ['X7']],
    ['B543', 'refined · on the list', ['X8']],
    ['B544', 'refined · on the list', ['X9']],
    ['nofix', 'sending to the Advisor…', ['X5', 'X6', 'X10']],
  ])
  // The Advisor links them: X4-X6 together, and the card without a fix step has only the new one.
  const linked = list.map(one => (['X4', 'X5', 'X6'].includes(one.id) ? { ...one, state: 'fix', fix: 'B541' } : one))
  const after = incidentCards({ incidents: linked, items: all, lanes: [lane('Worker 5', 'working')], words: new Map([['X10', 'on its way']]) })
  assert.deepEqual(after.find(card => card.key === 'B541').incidents.map(one => one.id), ['X4', 'X5', 'X6'])
  assert.deepEqual(after.find(card => card.key === 'nofix').incidents.map(one => one.id), ['X10'])
})
