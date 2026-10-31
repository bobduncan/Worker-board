// Light state (2026-10-31, the person: "my board stopped working why"): /api/state was 7.6 MB on every refresh, six of it
// the finished steps' windows, and at Low CPU mode the page stayed blank. A finished step (done or dropped) goes to the page
// as a light row: what its lists read, without its item, notes, refine or flow. Its window reads the full row from
// GET /api/step. Open steps go as they are, and so does a finished step an open ask names (its card's three lines).
import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'

import { createBoard } from '../server.mjs'
import { parseConfig } from '../src/config.mjs'
import { LIGHT_FIELDS, fullStepOf, lightRow, lightState } from '../src/state.mjs'
import { parseItem } from '../src/work/item.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { buildState } from './withStore.mjs'

const NOW = Date.UTC(2026, 9, 31, 12, 0)
const config = { ...parseConfig('{}', {}), project: 'D:\\work\\orchard', pictureRoots: [] }

const item = lines => parseItem(`${lines.join('\n')}\n`)
const PEAR = item([
  'Id: B11', 'Kind: step', 'Title: Plant the pear trees', 'State: done', 'Owner: Studio · Worker 1', 'Activity: Orchard', 'Goal: G4',
  'Since: 2026-10-30 10:00', 'Branch: b11-pears', 'Refined: ready', '',
  '## Context', '  The orchard has no pears yet.', '',
  '## Summary', 'Plant four pear trees   along the south wall, so the orchard bears pears next year.', '',
  '## What we build', '- four pear trees on the south wall', '- a stake for each', '',
  '## Refined', '  Summary: Context: The orchard has no pears. Problem: Nobody planted them. Solution: Plant four.', '',
  '## History', '- 2026-10-30 09:00 Studio · Worker 1: queued → taken', '- 2026-10-30 10:00 server: review → done', '',
])
const PRUNE = item([
  'Id: B12', 'Kind: step', 'Title: Prune the apple trees', 'State: refined', 'Activity: Orchard', 'Goal: G4', 'Since: 2026-10-30 11:00', 'Refined: ready', '',
  '## Summary', 'Cut the apple trees back before winter.', '', '## What we build', '- every apple tree pruned', '', '## History', '- 2026-10-30 11:00 Studio · Partner: made', '',
])
const POND = item([
  'Id: B13', 'Kind: step', 'Title: Dig the old pond', 'State: dropped', 'Owner: Studio · Worker 2', 'Activity: Orchard', 'Goal: G5', 'Since: 2026-10-29 08:00', '',
  '## What we build', '- a pond where the old one stood', '', '## History', '- 2026-10-29 08:00 person: dropped: no room', '',
])
const FENCE = item([
  'Id: B14', 'Kind: step', 'Title: Mend the fence', 'State: done', 'Owner: Studio · Worker 2', 'Activity: Orchard', 'Goal: G5', 'Since: 2026-10-30 12:00', '',
  '## Summary', 'Context: The fence leans. Problem: Deer get in. Solution: New posts.', '', '## What we build', '- three new posts', '', '## History', '- 2026-10-30 12:00 server: review → done', '',
])
const ASK = item([
  'Id: Q20', 'Kind: ask', 'Title: Which wood for the posts?', 'State: open', 'Owner: Studio · Worker 2', 'Of: B14', 'Since: 2026-10-30 12:05', 'Asks: decide', 'Blocking: no', '',
  '## Text', 'Which wood for the posts?', '', '## History', '- 2026-10-30 12:05 Studio · Worker 2: asked', '',
])

/** A made-up store: the Orchard's four steps (B11 done, B12 refined, B13 dropped, B14 done) and, when asked, an open ask of B14. */
function work({ withAsk = true, pear = PEAR } = {}) {
  const store = storeFromText('## Orchard\n- [x] B11 Plant the pear trees\n- [ ] B12 Prune the apple trees\n- [x] B13 Dig the old pond\n- [x] B14 Mend the fence\n', { now: NOW - 3_600_000 })
  for (const one of [pear, PRUNE, POND, FENCE, ...(withAsk ? [ASK] : [])]) store.items.set(one.head.get('Id'), one)
  return store
}
const built = options => buildState({ work: work(options) }, { now: NOW, config })
const rows = state => state.backlog.flatMap(activity => activity.steps)
const rowOf = (state, id) => rows(state).find(one => one.id === id)

test('a done step goes light: no item, notes, refine or flow; it keeps what the lists read, and its goal, state, owner and line', () => {
  const full = built()
  const light = lightState(full)
  const pear = rowOf(light, 'B11')
  for (const field of ['item', 'notes', 'refined', 'flow', 'text', 'pictures']) assert.equal(Object.hasOwn(pear, field), false, `no ${field}`)
  assert.equal(pear.light, true)
  assert.match(pear.rev, /^[0-9a-f]{16}$/)
  const whole = rowOf(full, 'B11')
  for (const field of LIGHT_FIELDS) assert.deepEqual(pear[field], whole[field], `${field} as the full row has it`)
  assert.equal(pear.id, 'B11')
  assert.equal(pear.key, 'B11')
  assert.equal(pear.title, 'Plant the pear trees')
  assert.equal(pear.status, 'done')
  assert.equal(pear.goal, 'G4')
  assert.equal(pear.state, 'done')
  assert.equal(pear.worker, 'Studio · Worker 1')
  assert.equal(Object.hasOwn(pear, 'owner'), false, 'its owner is its worker: said once')
  assert.equal(pear.line, 'Plant four pear trees along the south wall, so the orchard bears pears next year.', 'the goal part\'s line: its Summary, one line')
  assert.equal(pear.doneAt, whole.doneAt)
  // What the lists read of open steps only, and what says nothing, is left out.
  for (const field of ['minutes', 'after', 'asks', 'needId', 'refineState', 'refineStop', 'refineAsk', 'reviewWait', 'reviewStand', 'isFix']) assert.equal(Object.hasOwn(pear, field), false, `no ${field}`)
  // An owner other than its worker, a fix's chip and a refine word still open are kept.
  const other = lightRow({ ...whole, worker: 'Worker 1', isFix: true, refineAsk: { isOpen: true, state: 'delivered', round: 1 } })
  assert.equal(other.owner, 'Studio · Worker 1')
  assert.equal(other.isFix, true)
  assert.deepEqual(other.refineAsk, { isOpen: true, state: 'delivered', round: 1 })
  // A dropped one is light too, and says it was dropped (the goal part leaves it out).
  const pond = rowOf(light, 'B13')
  assert.equal(pond.light, true)
  assert.equal(pond.state, 'dropped')
  assert.equal(pond.line, 'a pond where the old one stood', 'no Summary: its first point to build')
})

test('an open step goes as it is, and so does a done step an open ask names (the ask\'s card draws its three lines from it)', () => {
  const full = built()
  const light = lightState(full)
  assert.deepEqual(rowOf(light, 'B12'), rowOf(full, 'B12'))
  assert.equal(Object.hasOwn(rowOf(light, 'B12'), 'light'), false)
  assert.deepEqual(rowOf(light, 'B14'), rowOf(full, 'B14'))
  assert.ok(rowOf(light, 'B14').item !== null, 'B14 keeps its item while Q20 is open')
  // Without the ask it goes light like any finished step.
  assert.equal(rowOf(lightState(built({ withAsk: false })), 'B14').light, true)
  // The rest of the state is the same.
  assert.deepEqual({ ...light, backlog: null }, { ...full, backlog: null })
})

test('the light state is much smaller than the full one', () => {
  const full = built()
  const size = value => JSON.stringify(value).length
  const finished = state => rows(state).filter(one => one.id === 'B11' || one.id === 'B13')
  assert.ok(size(finished(lightState(full))) * 2 < size(finished(full)), `${size(finished(lightState(full)))} light against ${size(finished(full))} full`)
})

test('fullStepOf gives a step\'s full row by its key, as the state had it; null for a key it does not hold', () => {
  const full = built()
  assert.deepEqual(fullStepOf(full, 'B11'), rowOf(full, 'B11'))
  assert.ok(fullStepOf(full, 'B11').item.what.length === 2)
  assert.equal(fullStepOf(full, 'B99'), null)
  assert.equal(fullStepOf(full, ''), null)
  assert.equal(fullStepOf({}, 'B11'), null)
  // A light state's backlog holds no full row of a finished step: the server reads the full state.
  assert.equal(fullStepOf(lightState(full), 'B11').item, undefined)
})

test('a light row\'s rev stays while its step stays, also a while later, and moves when the step changes', () => {
  const first = rowOf(lightState(built()), 'B11').rev
  assert.equal(rowOf(lightState(buildState({ work: work() }, { now: NOW + 600_000, config })), 'B11').rev, first, 'ten minutes later')
  const noted = item([...PEAR.head].map(([key, value]) => `${key}: ${value}`).concat(['', '## Summary', 'Plant five pear trees.', '', '## History', '- 2026-10-31 11:00 person: note', '']))
  assert.notEqual(rowOf(lightState(built({ pear: noted })), 'B11').rev, first)
  assert.deepEqual(lightRow({ key: 'B1', id: 'B1', title: 'x', status: 'done', item: null, flow: null }).goal, null, 'a row without an item')
})

test('a state without a backlog is given back as it is', () => {
  assert.deepEqual(lightState({ readAt: 1, chats: [] }), { readAt: 1, chats: [] })
  assert.equal(lightState(null), null)
})

const TOKEN = 'a'.repeat(64)

/** A board on a free port that serves the made-up state as the real one does: light in /api/state, a full row in /api/step. */
async function board(t) {
  const full = built()
  const server = createBoard({ token: TOKEN, getState: async () => lightState(full), say: async () => ({ ok: false, status: 400, why: 'No.' }), step: async key => fullStepOf(full, key) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const ask = (path, headers = { 'X-Board-Token': TOKEN }) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, method: 'GET', path, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', fail)
    req.end()
  })
  return { full, ask }
}

test('GET /api/step gives a finished step\'s full row, the same the state gave before it went light', async t => {
  const { full, ask } = await board(t)
  const state = JSON.parse((await ask('/api/state')).text)
  assert.equal(rowOf(state, 'B11').light, true, 'the state sends it light')
  const answer = await ask('/api/step?id=B11')
  assert.equal(answer.status, 200)
  const row = JSON.parse(answer.text)
  assert.deepEqual(row, JSON.parse(JSON.stringify(rowOf(full, 'B11'))))
  assert.deepEqual(row.item.what, ['four pear trees on the south wall', 'a stake for each'], 'with its item for the window')
  assert.ok(Array.isArray(row.item.refinedLines) && Array.isArray(row.item.context), 'and what stepStory reads')
})

test('GET /api/step refuses without the page\'s token, says 404 for a step it does not hold and 400 for no id', async t => {
  const { ask } = await board(t)
  assert.equal((await ask('/api/step?id=B11', {})).status, 403)
  assert.equal((await ask('/api/step?id=B11', { 'X-Board-Token': 'b'.repeat(64) })).status, 403)
  const unknown = await ask('/api/step?id=B99')
  assert.equal(unknown.status, 404)
  assert.match(unknown.text, /No step B99/)
  assert.equal((await ask('/api/step')).status, 400)
  assert.equal((await ask('/api/step?id=..%2Fconfig.json')).status, 400)
})
