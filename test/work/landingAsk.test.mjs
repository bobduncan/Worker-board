// No landing asks (chat 1's brief, the person's "Yes, build it", 2026-11-09): B1079 went live at 11:14 without chat 1's go or the
// person's yes, because Worker 5 asked Q701 "Put B1079's fix live on the board now?", Autopilot took its advice and the worker
// landed on that; B1071 ran the same way (Q686 to Q690). The matcher (src/work/landingAsk.mjs), the work API's refusal and
// Autopilot's route, each against the words of the real asks. The asks' words are the live ones; the steps and chats are made up.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { workApi } from '../../src/work/api.mjs'
import { autopilotRoute } from '../../src/work/autopilot.mjs'
import { parseItem, valueOf } from '../../src/work/item.mjs'
import { LANDING_ASK_WHY, LANDING_ROUTE_WHY, landingAskOf, landingAskOfItem } from '../../src/work/landingAsk.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore } from '../../src/work/store.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 11, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** The real asks that asked to land, by id: their title, text (after the title) and options as filed. */
const REFUSED = {
  Q701: { title: 'Put B1079\'s fix live on the board now?', text: 'The report check sends a step back only for a leftover remote branch with unmerged work; a merged leftover becomes a warning. The report check will not pass until it is merged. The full gate had 1 failure (oneLoopProcess), which passes alone.', options: ['A Yes, land it', 'B Not yet'], advice: 'A', kind: 'decide' },
  Q686: { title: 'Land the fix for stop words to Main?', text: 'Your Stop of a worker by code worked, but its word to Main stayed waiting and raised X2 again: the board only closed such a word in a hand\'s call, and that close never touched a waiting word. Now the board closes it itself once the worker was told and stopped, keeps it long enough for Main otherwise, and the alarm names one finding per stop. Tested against the real 22:28 case and reviewed; it lands through land.ps1 on chat 1\'s go, both boards restart by themselves.', options: ['A Land it now, on chat 1\'s go', 'B Wait'], advice: 'A', kind: 'decide' },
  Q687: { title: 'May B1071 land once its turn comes?', text: 'I advise yes. Chat 1 needs your own word for it, not Autopilot\'s.', options: [], advice: 'yes', kind: 'decide' },
  Q689: { title: 'Do you want B1071 (the stop-word settle fix) to go live when chat 1 lands it?', text: 'I advise yes.', options: [], advice: 'yes', kind: 'decide' },
  Q655: { title: 'Land B1021 now (merge main, push, both boards), or wait for chat 1\'s go and B1008?', text: 'I advise waiting: the step says it lands on chat 1\'s go, after B1008, since both touch `watch.mjs`.', options: [], advice: 'waiting: the step says it lands on chat 1\'s go', kind: 'decide' },
  Q639: { title: 'Put B978\'s fix live on both boards now? I advise yes.', text: '', options: [], advice: 'yes', kind: 'decide' },
  Q644: { title: 'Land B1008 now, or after B986?', text: 'B1008 is built and green (4155 tests) on branch b1008. The step says it lands on chat 1\'s go, one at a time, after B986 (both change watch.mjs); B986 is not on main yet. Tell me when chat 1 gives the go and B986 is in, and I merge main, gate, land and report.', options: [], advice: '', kind: 'do' },
  Q637: { title: 'Give B986 the go to land after Workers 0.31.0', text: 'B986 (a held step always finds its way back; wakes go to the right chat) is built, reviewed once by chat 3 and changed as it asked; tests green. Its refine says it lands only on chat 1\'s go, after Workers 0.31.0 is on main, and after chat 3\'s second read (asked at 16:3x). Answer "go B986" in Worker 2\'s chat once both hold; until then the step waits here.', options: [], advice: '', kind: 'do' },
  Q690: { title: 'Please give your own yes for B1071 to go live (Autopilot\'s yes on Q689 does not count for chat 1).', text: 'I advise yes.', options: [], advice: 'yes', kind: 'decide' },
}
/** The real asks of the same days that asked something else. */
const KEPT = {
  Q698: { title: 'Is this where you get on and off the stairs?', text: 'Context: the side-stairs map laid out as cells first, on plain markers, no painting yet (your pick A: high ground behind each flight). Problem: none known: every grey square is one step on its own cell, its arrow the way it climbs; on only at the foot, off only at the top, never from the sides; a wide flight is one stair; flights 1 to 4 long, 1 to 3 wide, both ways, plus a front flight 2 wide. Approve: this layout and where you get on and off; the painting follows it in the next step. Send back: say which flight or cell reads wrong, and the layout is redone before any painting.', options: ['Yes: paint it this way', 'Not right yet'], advice: 'Yes: paint it this way', kind: 'look' },
  Q664: { title: 'Which painting goes in: A (worn dark rim, tan steps, no glow), B (bright lit lip, glowing walls, dark steps) or C (chipped rim, wide glow, tan-brown steps)?', text: 'I advise B.', options: ['A (worn dark rim, tan steps, no glow)', 'B (bright lit lip, glowing walls, dark steps)', 'C (chipped rim, wide glow, tan-brown steps)'], advice: 'B', kind: 'decide', via: 'chat' },
  Q685: { title: 'Drop B1070 (the stair-directions fix, replaced by the one-way stairs rethink of G60 you picked on Q684)?', text: 'I advise yes.', options: [], advice: 'yes', kind: 'decide', via: 'chat' },
  Q661: { title: 'Paint whole maps for side flights too, or bridges only?', text: 'The step says painting both test maps whole was never tried. For side flights it was, four times: B924 ramp 69, B942 stacked steps 70, B968 55, B989 two cells with the half step (Q633 B) 48-55 (A89, guide drawn per flight, A47 as look). Same setup as now, so it likely ends near 50-70, not 75; a 2-3 long flight reads as parallel planks. Bridges were painted whole only as pieces and sheets (best 62-74), and the Shrine\'s whole painting reached 72, so a whole bridge map is a real new try. A) bridges only on the sizes map (about 6 Codex runs); the side map keeps the best flights (72) and the guide names the rule: long climbs are front flights. B) both maps as written (about 12 runs), expecting flights under 75. C) stop, report no change.', options: ['A Bridges only; flights keep best 72, long climbs go front', 'B Both maps as written', 'C Stop and report no change'], advice: 'A', kind: 'decide' },
  Q653: { title: 'Are the bridges good enough at 50–55, or should I try the deck\'s light and the posts\' feet next?', text: 'I advise one more try.', options: [], advice: 'one more try', kind: 'look', via: 'chat' },
  Q646: { title: 'Switch the map-edge wall off on the Shrine only?', text: 'The Shrine\'s four walkways end in a stone cap at the map\'s border: it is the game\'s own low edge wall, drawn wherever ground reaches the border so a push into the edge is clear to see. Your design has the walkways run on past the edge. A: off on the Shrine only (a push there still hurts, no wall shows). B: keep the wall; the caps stay and that gap stays open. I advise A.', options: ['A Off on the Shrine only', 'B Keep the wall'], advice: 'A', kind: 'decide' },
  // Made up, for the words of the game and a plain statement of the rule: a flight's landing, a unit that lands on a tile, the goals' merge.
  made1: { title: 'Which colour for the Buy button: A red or B gold?', text: 'The step lands on chat 1\'s go once you pick.', options: ['A red', 'B gold'], advice: 'A', kind: 'decide' },
  made2: { title: 'Is the landing between the two flights one step high, or two?', text: 'The unit lands on the lava tile after the push and takes the burn there.', options: [], advice: 'one', kind: 'look' },
  made3: { title: 'Merge G23 into G41, or keep the two goals apart?', text: 'I advise the merge: both are about the land tiles of the side map.', options: [], advice: 'merge', kind: 'decide' },
  // The live Q612 (a verdict whose words state where the step lands) and a focus switch timed by a landing: neither asks to land.
  made4: { title: 'Accept B944 as it is (branch unmerged, lands inside Workers mod 0.30.0)?', text: 'I advise yes; the board development chat asks for it.', options: [], advice: 'yes', kind: 'decide', via: 'chat' },
  made5: { title: 'Switch the focus to G29 once B900 lands?', text: 'G60 has its recap; G29 is next on the map.', options: [], advice: 'yes', kind: 'decide', via: 'chat' },
  // An update of a mod is the person's own hands (the live probe of 2026-10-31), no landing.
  made6: { title: 'Update the Workers mod to 0.26.10 so this goes live?', text: 'The mod carries the fix.', options: [], advice: 'yes', kind: 'decide', via: 'chat' },
}
const wordsOf = one => [one.title, one.text, one.options.join(' | ')].join(' ')

function text(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return `${lines.join('\n')}\n`
}
/** A filed ask with the real one's words, under a made-up step, as Autopilot met it (Via chat for the "For you" ones, Advice as filed). */
const filed = (id, one, fields = {}) => parseItem(text(
  { Id: id, Kind: 'ask', Title: one.title, State: 'open', Owner: 'Worker 5', Since: at(5), Filed: String(NOW - 5 * MIN), Asks: one.kind, Blocking: 'no', Of: 'B40', ...(one.options.length === 0 ? {} : { Options: one.options.join(' | ') }), ...(one.advice === '' ? {} : { Advice: one.advice }), ...fields },
  { Text: [one.title, ...(one.text === '' ? [] : [one.text])], History: [`- ${at(5)} Worker 5: asked (${one.kind})`] }))

test('the matcher: the words of the real asks that asked to land are a landing ask; the others, the words of the game and a plain statement of the rule are not', () => {
  for (const [id, one] of Object.entries(REFUSED)) assert.notEqual(landingAskOf(wordsOf(one)), null, `${id}: ${one.title}`)
  for (const [id, one] of Object.entries(KEPT)) assert.equal(landingAskOf(wordsOf(one)), null, `${id}: ${one.title}`)
  // The sentence that asked is named, so the refusal can quote it.
  assert.equal(landingAskOf(wordsOf(REFUSED.Q701)), 'Put B1079\'s fix live on the board now?')
  assert.equal(landingAskOf(wordsOf(REFUSED.Q637)), 'Give B986 the go to land after Workers 0.31.0 B986 (a held step always finds its way back; wakes go to the right chat) is built, reviewed once by chat 3 and changed as it asked; tests green.')
  // A filed ask is read by its Title, Text and Options.
  assert.notEqual(landingAskOfItem(filed('Q1', REFUSED.Q686)), null)
  assert.equal(landingAskOfItem(filed('Q2', KEPT.Q646)), null)
  // The ask's options alone can ask it (the question's own words say less).
  assert.notEqual(landingAskOf('Which way for B40? | A land the fix on main now | B keep it on its branch'), null)
  assert.equal(landingAskOf(''), null)
  assert.equal(landingAskOf(null), null)
})

const ROLES = { Main: 'main', 'Worker 5': 'worker', Advisor: 'advisor' }
const roleOf = name => ROLES[name] ?? null
async function storeWith() {
  const dir = await mkdtemp(join(tmpdir(), 'landing-ask-'))
  await writeFile(join(dir, 'B40.md'), text({ Id: 'B40', Kind: 'step', Title: 'Warn on a merged leftover branch', State: 'in progress', Owner: 'Worker 5', Activity: 'Garden', Since: at(90) }, { History: [`- ${at(90)} Main: made`] }))
  await writeFile(join(dir, 'activities.json'), `${JSON.stringify({ preamble: [], activities: [{ name: 'Garden', steps: ['B40'] }] }, null, 1)}\n`)
  return dir
}
const ctx = (dir, more = {}) => ({ dir, now: NOW, prefix: '', roleOf, chats: Object.keys(ROLES), focusGoal: 'G60', pictureProblem: async () => null, autopilot: true, ...more })
const asksIn = async dir => [...(await readStore(dir)).items.values()].filter(one => valueOf(one, 'Kind') === 'ask').map(one => valueOf(one, 'Id'))

test('the work API refuses a landing ask (409, the words that send the chat to chat 1) from a worker, the main chat and the partner, whatever its kind, via or options; the other asks are filed', async t => {
  const dir = await storeWith()
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const asked = (who, one, more = {}) => workApi({ action: 'ask', chat: who, of: 'B40', kind: one.kind, title: one.title, text: one.text === '' ? [] : [one.text], options: one.options, advice: one.advice, ...(one.via === undefined ? {} : { via: one.via }), ...more }, ctx(dir))
  for (const [id, one] of Object.entries(REFUSED)) {
    const made = await asked('Worker 5', one)
    assert.equal(made.ok, false, `${id} was filed: ${one.title}`)
    assert.equal(made.status, 409, id)
    assert.ok(made.why.startsWith(LANDING_ASK_WHY), `${id}: ${made.why}`)
    assert.match(made.why, /\(refused: ".+"\)$/, id)
  }
  // From the "For you" block (via chat), the app's form, the main chat under no step, and the partner.
  assert.equal((await asked('Worker 5', REFUSED.Q687, { via: 'chat' })).status, 409)
  assert.equal((await asked('Worker 5', REFUSED.Q639, { via: 'form' })).status, 409)
  assert.equal((await workApi({ action: 'ask', chat: 'Main', kind: 'decide', title: REFUSED.Q689.title, text: [REFUSED.Q689.text], advice: 'yes', via: 'chat' }, ctx(dir))).status, 409)
  assert.equal((await workApi({ action: 'ask', chat: 'Advisor', of: 'B40', kind: 'decide', title: REFUSED.Q655.title, text: [REFUSED.Q655.text] }, ctx(dir))).status, 409)
  // The options alone asking it is refused too.
  assert.equal((await asked('Worker 5', { title: 'Which way for the leftover-branch warning?', text: 'Both are built.', options: ['A land the fix on main now', 'B keep it on its branch'], advice: 'A', kind: 'decide' })).status, 409)
  assert.deepEqual(await asksIn(dir), [])
  // The other asks are filed as before (one at a time: the step holds one open question).
  let n = 0
  for (const [id, one] of Object.entries(KEPT)) {
    const made = await asked('Worker 5', one)
    assert.equal(made.ok, true, `${id}: ${made.why}`)
    n += 1
    await workApi({ action: 'withdraw', chat: 'Worker 5', id: made.result.id, why: 'the test moves on' }, ctx(dir))
  }
  assert.equal((await asksIn(dir)).length, n)
})

test('Autopilot never answers a landing ask that was filed anyway: the route is the person\'s, whatever the advice, on the first pass and when the board judges it again', () => {
  const route = (item, more = {}) => autopilotRoute(item, { roleOf, items: new Map([['B40', parseItem(text({ Id: 'B40', Kind: 'step', Title: 'Warn on a merged leftover branch', State: 'in progress', Owner: 'Worker 5', Goal: 'G61' }))]]), focusGoal: 'G60', prefix: '', ...more })
  for (const [id, one] of Object.entries(REFUSED)) {
    const item = filed(id, one, id === 'Q689' || id === 'Q690' ? { Owner: 'Main', Of: null } : {})
    assert.deepEqual(route(item), { to: 'person', why: LANDING_ROUTE_WHY }, id)
    // Filed from a "For you" block, with its advice: still never the advice.
    assert.equal(route(filed(id, one, { Via: 'chat' })).to, 'person', `${id} via chat`)
    // The board judging it anew (the switch-on's sweep, every pass under v2): the same.
    assert.equal(route(filed(id, one, { Route: 'person' }), { again: true }).to, 'person', `${id} again`)
  }
  // The other asks go their old ways: the advice is taken (a decide with advice under a step of another goal), or the partner decides.
  const ways = Object.fromEntries(Object.entries(KEPT).map(([id, one]) => [id, route(filed(id, one)).to]))
  // Q685 asks to drop a step: since drop-asks-to-person (2026-11-11) the person's, never Autopilot's.
  assert.deepEqual(ways, { Q698: 'advice', Q664: 'advice', Q685: 'person', Q661: 'advice', Q653: 'advice', Q646: 'advice', made1: 'advice', made2: 'advice', made3: 'advice', made4: 'partner', made5: 'person', made6: 'person' })
  for (const id of Object.keys(KEPT)) assert.notEqual(route(filed(id, KEPT[id])).why, LANDING_ROUTE_WHY, id)
})
