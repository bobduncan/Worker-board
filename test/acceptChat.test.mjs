// B1272 (F35): the live case. The person accepted B1205 in the main chat, "Q817 A (accept B1205 at 58 of 75)", and the main chat closed the
// board's Accept card Q817 with those words (answered-in-chat, 20:30). The board ignored it: answered-in-chat never ran a card's plan, and
// "Q817 A" did not read as A, so B1205 sat in review, its card read as sent back ("sent back by you in Q817: the partner makes its next
// try") and G95's recap could not open. Now an Accept card answered in a chat does what its board answer does, a leading ask id or item
// number is read past, and the card answered before this fix is applied once. Trimmed from the live records; made-up chats and paths only.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CHAT_ACCEPT_APPLIED, workApi } from '../src/work/api.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { acceptReading, acceptStandOf, answerReading, reviewWaitOf } from '../src/work/resultCheck.mjs'
import { readStore, share } from '../src/work/store.mjs'

share.ms = 0

const MIN = 60_000
const NOW = new Date(2026, 10, 19, 20, 30).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}

/** B1205 as it stood: in review at 58 of 75, its fix B1226 dropped, its card Q817 held for G95's recap. */
const B1205 = (fields = {}, history = []) => text({ Id: 'B1205', Kind: 'step', Title: 'An own move per ability: the Archer\'s shot', State: 'review', Owner: 'Builder', Activity: 'Art', Goal: 'G95', Since: at(6000), Branch: 'b1205', ...fields }, {
  Context: ['  The shot.', '  Reported by Builder on 2026-11-15 at 20:00: Context: The shot was one frame. Change: The shot is redrawn key pose first. Details: merged abc1234.', '  Recap verdict: waits (Q817)'],
  'What we build': ['- the shot redrawn key pose first'],
  Checked: ['Evidence: art/B1205/evidence.png', 'Score: 58 of 75', '- pass: the shot redrawn key pose first', '- fail: judged at play size, target 75'],
  History: [`- ${at(6000)} Builder: in progress → review`, `- ${at(5990)} server: check passed: work in art; result named`, `- ${at(5900)} Checker: result check failed: 1 of 2 points pass, score 58 of 75; fix B1226 for Builder`, `- ${at(5800)} server: asked you to accept it or send it back: Q817`, `- ${at(5800)} server: autopilot: Q817 waits for the goal's recap`, ...history],
})
const B1226 = () => text({ Id: 'B1226', Kind: 'step', Title: 'Fix: judged at play size', State: 'dropped', Owner: 'Builder', Activity: 'Art', Goal: 'G95', Since: at(5850), 'Fix of': 'B1205' }, {
  Context: ['  Fix of B1205: the result check failed on one point.', '  Dropped by Lead on 2026-11-15 at 23:21: the person kept the shot'],
  History: [`- ${at(5900)} Checker: made by the result check of B1205`, `- ${at(5850)} Lead: in progress → dropped`],
})
const CARD = { Id: 'Q817', Kind: 'ask', Title: 'Accept B1205 at 58 of 75, or send it back?', Activity: 'Art', Filed: String(NOW - 5800 * MIN), Pictures: 'art/B1205/evidence.png', Asks: 'decide', Blocking: 'no', Of: 'B1205', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept', Route: 'recap' }
/** Q817 open, as the main chat found it. */
const Q817 = () => text({ ...CARD, State: 'open', Since: at(5800) }, { Text: ['B1205 stays in review.'], History: [`- ${at(5800)} server: asked (decide)`, `- ${at(5800)} server: autopilot: routed to recap`] })
/** Q817 as the store holds it now: closed in the main chat before this fix, its step untouched. */
const Q817_ANSWERED = (answer = 'Q817 A (accept B1205 at 58 of 75)', how = 'Lead: answered in its chat by the person') => text({ ...CARD, State: 'answered', Since: at(0) }, {
  Text: ['B1205 stays in review.'], History: [`- ${at(5800)} server: asked (decide)`, `- ${at(5800)} server: autopilot: routed to recap`, `- ${at(0)} ${how}: ${answer}`], Answer: [answer],
})

async function storeWith(files) {
  const dir = await mkdtemp(join(tmpdir(), 'accept-chat-'))
  for (const [id, body] of Object.entries(files)) await writeFile(join(dir, `${id}.md`), body)
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Art', steps: Object.keys(files).filter(id => id.startsWith('B')) }] }, null, 1)}\n`)
  return dir
}
const ROLES = { Lead: 'main', Partner: 'advisor', Builder: 'worker', Checker: 'worker' }
const ctx = (dir, now, as) => ({ dir, now, prefix: '', roleOf: chat => ROLES[chat] ?? null, chats: Object.keys(ROLES), focusGoal: 'G95', autopilot: true, pictureProblem: async () => null, recaps: [], as })
const lead = (dir, body, now = NOW + MIN) => workApi({ ...body, chat: 'Lead' }, ctx(dir, now, undefined))
const server = (dir, now = NOW + 2 * MIN) => workApi({ action: 'accept-cards' }, ctx(dir, now, 'server'))
const read = async dir => (await readStore(dir)).items
const history = item => (item.sections.get('History') ?? []).join('\n')
const context = item => (item.sections.get('Context') ?? []).join('\n')

test('how a chat answer reads: past a leading ask id or item number; other words read as before', () => {
  for (const words of ['Q817 A (accept B1205 at 58 of 75)', 'Q817: A', 'q817 Accept', '1 A', '1. A', '2) Accept: done as it is', 'A']) assert.equal(acceptReading(words), 'accept', words)
  for (const words of ['Q817 B', 'Q817: B the cape swings wider', '1 B', 'Q817', 'the edge still reads flat', '12 frames short']) assert.equal(acceptReading(words), 'back', words)
  assert.equal(answerReading('1. yes'), 'yes')
  assert.equal(answerReading('Q12 approved'), 'yes')
  assert.equal(answerReading('Q12: no, redo it'), 'no')
  assert.equal(answerReading('3 more frames'), null)
  assert.equal(answerReading('1'), null)
})

test('Q817 A answered in the main chat: B1205 is done as the person accepted it, with its Recap verdict, and its card reads accept', async () => {
  const dir = await storeWith({ B1205: B1205(), B1226: B1226(), Q817: Q817() })
  try {
    const done = await lead(dir, { action: 'answered-in-chat', id: 'Q817', text: 'Q817 A (accept B1205 at 58 of 75)' })
    assert.equal(done.ok, true, done.why)
    assert.equal(done.result.accepted, 'B1205')
    const items = await read(dir)
    const step = items.get('B1205')
    assert.equal(step.head.get('State'), 'done')
    assert.match(history(step), /person: accepted by you in Q817 at 58 of 75: Q817 A/)
    assert.match(context(step), /Recap verdict: approved \(Q817\)/)
    assert.doesNotMatch(context(step), /Recap verdict: sent back/)
    assert.equal(acceptStandOf('B1205', items).state, 'accept')
    assert.equal(items.get('Q817').head.get('State'), 'answered')
    // Nothing is left for the sweep: it applies nothing again and files no card.
    const swept = await server(dir)
    assert.deepEqual([swept.result.applied, swept.result.filed], [[], []])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a Send back answered in the chat needs the person\'s note, as on the board, and makes the open fix', async () => {
  const dir = await storeWith({ B1205: B1205(), B1226: B1226(), Q817: Q817() })
  try {
    const bare = await lead(dir, { action: 'answered-in-chat', id: 'Q817', text: 'Q817 B' })
    assert.deepEqual([bare.ok, bare.status], [false, 400])
    assert.equal((await read(dir)).get('Q817').head.get('State'), 'open')
    const sent = await lead(dir, { action: 'answered-in-chat', id: 'Q817', text: 'Q817 B: the cape swings wider on the release' })
    assert.equal(sent.ok, true, sent.why)
    const items = await read(dir)
    const fix = items.get(sent.result.fix)
    assert.deepEqual([fix.head.get('Fix of'), fix.head.get('State'), fix.head.get('Refined'), fix.head.get('Title')], ['B1205', 'new', 'open', 'Fix: the cape swings wider on the release'])
    assert.equal(items.get('B1205').head.get('State'), 'review')
    assert.match(context(items.get('B1205')), /Recap verdict: sent back \(Q817\)/)
    assert.equal(reviewWaitOf(items.get('B1205'), items, null, NOW + 2 * MIN).kind, 'fix')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the card answered in the chat before this fix is applied once: B1205 done, its Recap verdict, one line on each', async () => {
  const dir = await storeWith({ B1205: B1205({}, [`- ${at(0)} Lead: Q817 answered`]), B1226: B1226(), Q817: Q817_ANSWERED() })
  try {
    // As it stood: the card read as sent back.
    const before = await read(dir)
    assert.equal(acceptStandOf('B1205', before).state, 'accept')
    const swept = await server(dir)
    assert.equal(swept.ok, true, swept.why)
    assert.deepEqual([swept.result.applied, swept.result.filed], [['B1205'], []])
    const items = await read(dir)
    const step = items.get('B1205')
    assert.equal(step.head.get('State'), 'done')
    assert.match(history(step), /person: accepted by you in Q817 at 58 of 75: Q817 A \(accept B1205 at 58 of 75\)/)
    assert.match(context(step), /Recap verdict: approved \(Q817\)/)
    const mark = `${CHAT_ACCEPT_APPLIED} ${at(0)} (B1272)`
    assert.equal(history(step).split(mark).length - 1, 1)
    assert.equal(history(items.get('Q817')).split(mark).length - 1, 1)
    assert.doesNotMatch(history(step), /sent back by you in Q817/)
    // A second run changes nothing.
    const again = await server(dir, NOW + 10 * MIN)
    assert.deepEqual([again.result.applied, again.result.changed], [[], false])
    const after = await read(dir)
    assert.equal(history(after.get('B1205')), history(step))
    assert.equal(history(after.get('Q817')), history(items.get('Q817')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the repair leaves alone a card that reads back, one answered on the board, and a step done or already accepted', async () => {
  const cases = {
    'reads back': { B1205: B1205(), Q817: Q817_ANSWERED('Q817 B: the cape swings wider') },
    'answered on the board': { B1205: B1205(), Q817: Q817_ANSWERED('A Accept: done as it is', 'person: answered') },
    'step done': { B1205: B1205({ State: 'done' }), Q817: Q817_ANSWERED() },
    'accepted already': { B1205: B1205({}, [`- ${at(0)} person: accepted by you in Q817 at 58 of 75: A`]), Q817: Q817_ANSWERED() },
  }
  for (const [name, files] of Object.entries(cases)) {
    const dir = await storeWith({ ...files, B1226: B1226() })
    try {
      const before = await read(dir)
      const swept = await server(dir)
      assert.deepEqual(swept.result.applied, [], name)
      const items = await read(dir)
      assert.equal(items.get('B1205').head.get('State'), before.get('B1205').head.get('State'), name)
      assert.doesNotMatch(history(items.get('B1205')), new RegExp(CHAT_ACCEPT_APPLIED), name)
      assert.doesNotMatch(history(items.get('Q817')), new RegExp(CHAT_ACCEPT_APPLIED), name)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
})
