// Autopilot (the person, 2026-10-31: "i kind of want to have an option to autoapprove and only get bothered by real issues
// and the product owner"; on the plan: "yes to the plan go build"): where each open ask goes (src/work/autopilot.mjs
// `autopilotRoute`), for every row of the plan, with made-up twins of the eleven asks that were open when it was asked for,
// and whether an ask stands in Needs your attention (`standsForPerson`). Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { PERSONS_HANDS, REFINE_BACK_WORDS, SENT_BACK, adviceAnswerOf, adviceOf, autopilotRoute, belowTarget, handsOf, isChore, isExplicitPerson, isGoalLevel, letteredOptions, recapVerdictWords, recapWaitIds, refineAdviceOf, routedWords, standsForPerson, waitsForRecap } from '../src/work/autopilot.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 31, 16, 0).getTime()
const at = minutes => stamp(NOW - minutes * MIN)

/** An item from its head fields, its sections (`Text`, `History`, ...) after. */
function item(head, sections = {}) {
  const lines = Object.entries(head).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => `${key}: ${value}`)
  for (const [name, body] of Object.entries(sections)) lines.push('', `## ${name}`, ...body)
  return parseItem(`${lines.join('\n')}\n`)
}
const ask = (id, fields, text = null, more = {}) => item({ Id: id, Kind: 'ask', Title: fields.Title, State: 'open', Since: at(fields.age ?? 60), Filed: String(NOW - (fields.age ?? 60) * MIN), Blocking: 'no', ...fields, age: undefined },
  { Text: [text ?? fields.Title], ...more, History: [`- ${at(fields.age ?? 60)} ${fields.Owner ?? 'server'}: asked`] })

// The made-up project: Lead the main chat, Partner the partner, Keeper the Product owner, Painter and Checker workers.
const ROLES = { Lead: 'main', Partner: 'advisor', Keeper: 'owner', Painter: 'worker', Checker: 'worker' }
const B21 = item({ Id: 'B21', Kind: 'step', Title: 'Round the pool', State: 'review', Owner: 'Painter', Goal: 'G29' }, { Standard: ['pool look · pictures/pool.png · target 75'], Checked: ['Evidence: pictures/B21/evidence.png', 'Score: 64 of 75', '- fail: judged beside the painting'] })
const B22 = item({ Id: 'B22', Kind: 'step', Title: 'Quality Assurance: B21 Round the pool', State: 'done', Owner: 'Checker', Goal: 'G29', Checks: 'B21' })
const B23 = item({ Id: 'B23', Kind: 'step', Title: 'Wall stripes', State: 'review', Owner: 'Painter', Goal: 'G7' }, { Checked: ['Score: 60 of 75'] })
const B24 = item({ Id: 'B24', Kind: 'step', Title: 'Moat walls', State: 'review', Owner: 'Painter', Goal: 'G29' }, { Checked: ['Score: 80 of 75'] })
const ITEMS = new Map([['B21', B21], ['B22', B22], ['B23', B23], ['B24', B24]])
const ctx = { roleOf: name => ROLES[name] ?? null, items: ITEMS, focusGoal: 'G29', prefix: '' }
const routeOf = one => autopilotRoute(one, ctx).to

/// Twins of the eleven open asks (their shapes, made-up words).
const RECAP_DO = ask('Q1', { Title: 'Open the recap and try it: [Open the recap](http://127.0.0.1:4999/#demo=pictures/g29/recap/demo.json).', Owner: 'Painter', Asks: 'do', Via: 'chat', Pictures: 'pictures/B60/live.jpg' },
  'Open the recap and try it: [Open the recap](http://127.0.0.1:4999/#demo=pictures/g29/recap/demo.json). It runs on the trial board, which has the change.')
const RESTART = ask('Q2', { Title: 'Restart the main board (port 4999) so it shows the new popup?', Owner: 'Painter', Asks: 'decide', Advice: 'yes', Via: 'chat' },
  'Restart the main board (port 4999) so it shows the new popup? I advise yes, after you\'ve tried it on the trial board.')
const MARK_DONE = ask('Q3', { Title: 'Mark B44 done on the board: [open B44](http://127.0.0.1:4999/#details=B44).', Owner: 'Lead', Asks: 'do', Advice: 'yes', Via: 'chat' },
  'Mark B44 done on the board: [open B44](http://127.0.0.1:4999/#details=B44). I advise yes, the partner accepted it at 74.')
const REFINE_Q = ask('Q4', { Title: 'Paint the raised maps whole, or one more tile round?', Owner: 'Partner', Asks: 'decide', Of: 'B30', Via: 'refine' },
  'Paint the raised maps whole, or one more tile round? A: the painter paints the raised maps whole with the guide, about 3 h a map. B: one more tile round on the top edge, about 2 h; closer, not the painting. Picture: left the game today, right the painting. Advised: A')
const PARTNER_PICK = ask('Q5', { Title: 'for B33, which do you want?', Owner: 'Partner', Asks: 'decide', Advice: 'A', Via: 'chat' },
  'for B33, which do you want? A: keep the lava as your map rules describe it, and show the judges your lava picture (about 1 h). B: try a calmer, darker lava, kept only if the scores rise by 10 (about 2 h). I advise A. [Open B33](http://127.0.0.1:4999/#details=B33)')
const REBUILD = ask('Q6', { Title: 'Rebuild G15: how to stop a hung message going out twice?', Owner: 'Partner', Asks: 'decide', Of: 'G15', Options: 'A Hold it until the board sees it went | B Ask the app whether it went | C Stop here', Advice: 'A' })
const ACCEPT = ask('Q7', { Title: 'Accept B21 at 64 of 75, or send it back?', Asks: 'decide', Of: 'B21', Options: 'A Accept: done as it is | B Send back: the partner makes another try from your note', Via: 'accept' },
  'B21 stays in review: its fix was dropped, and only you close a result below its bar.')
// Its words name "the goal recap" (the live one's did): under a step that is no goal question.
const CHECKER_LOOK = ask('Q8', { Title: 'Approve the pool\'s look as it is, at 64 of 75?', Owner: 'Checker', Asks: 'look', Of: 'B21', Options: 'A yes: approve it as it is | B no: send it back for a rounder outline', Advice: 'A', Pictures: 'pictures/B21/check.png' },
  'Approve the pool\'s look as it is, at 64 of 75? You chose to judge it in the goal recap instead of another painting round.')
const BUILDER_LOOK = ask('Q9', { Title: 'B37 asks for the edge shape the partner said no to for now.', Owner: 'Painter', Asks: 'look', Of: 'B21', Advice: 'dropping B37 and accepting B21 at 74', Via: 'chat' })
const LOOSE_LOOK = ask('Q10', { Title: 'Is 68 beside the other map\'s 64 good enough, or should the 75 target be reset?', Owner: 'Painter', Asks: 'look', Advice: 'accepting it and keeping 75', Via: 'chat', Pictures: 'pictures/B24/evidence.png' })
const PLAY_LOOK = ask('Q11', { Title: 'Does the repainted keep look right in play? I advise yes.', Owner: 'Painter', Asks: 'look', Advice: 'yes', Via: 'chat' })

test('the eleven asks of the day, by the rulings of 2026-10-31: chores to the main chat, looks below target to the recap, the rest the person\'s', () => {
  assert.equal(routeOf(RECAP_DO), 'person', 'the goal\'s recap (its demo) is the person\'s')
  assert.equal(routeOf(RESTART), 'main', 'a restart of a board asked as a yes/no question is a chore')
  assert.equal(routeOf(MARK_DONE), 'person', 'marking a step done is never the main chat\'s')
  assert.equal(routeOf(REFINE_Q), 'advice', 'the Advisor\'s refine question with its advice, under its step')
  assert.equal(routeOf(PARTNER_PICK), 'person', 'the partner\'s ask under no step')
  assert.equal(routeOf(REBUILD), 'person', 'a rebuild of a goal is goal level')
  assert.equal(routeOf(ACCEPT), 'recap', 'an accept or send back below its target waits for the recap')
  assert.equal(routeOf(CHECKER_LOOK), 'recap', 'a look the step\'s checker asks waits for the recap')
  assert.equal(routeOf(BUILDER_LOOK), 'recap', 'a look of a step below its target waits for the recap')
  assert.equal(routeOf(LOOSE_LOOK), 'person', 'a look below its target under no step')
  assert.equal(routeOf(PLAY_LOOK), 'partner')
})

test('the recap: only for a step of the focus goal whose demo is still to come or whose recap names it already', () => {
  // The goal's demo is made (its Demo line) and no recap names B21: nothing would close it, so it is the person's.
  assert.equal(autopilotRoute(ACCEPT, { ...ctx, focusHasDemo: true }).to, 'person')
  assert.equal(autopilotRoute(ACCEPT, { ...ctx, focusHasDemo: true, recapSteps: [{ step: 'B21', goal: 'G29' }] }).to, 'recap')
  assert.equal(autopilotRoute(CHECKER_LOOK, { ...ctx, focusHasDemo: true, recapSteps: [{ step: 'B99', goal: 'G29' }] }).to, 'person')
  assert.equal(autopilotRoute(ACCEPT, { ...ctx, focusGoal: null }).to, 'person')
})

test('every row of the plan: partner, advice, recap, main and person', () => {
  const worker = (id, fields, text) => ask(id, { Owner: 'Painter', Asks: 'decide', ...fields }, text)
  // partner: a decide or look with options or advice from a worker or the main chat; a decide without either.
  assert.equal(routeOf(worker('Q20', { Title: 'Icons or words on the bar?', Options: 'A icons | B words', Advice: 'A' })), 'partner')
  assert.equal(routeOf(worker('Q21', { Title: 'Which bar colour?', Owner: 'Lead', Advice: 'blue' })), 'partner')
  assert.equal(routeOf(worker('Q22', { Title: 'How tall should the bar be?' })), 'partner', 'the partner decides a decide without options')
  // advice: the partner's or the Product owner's own ask with advice, under a step; under no step, or without advice, the person's.
  assert.equal(routeOf(ask('Q23', { Title: 'Shorter names in the shop?', Owner: 'Keeper', Asks: 'decide', Of: 'B21', Advice: 'yes' })), 'advice')
  assert.equal(routeOf(ask('Q23', { Title: 'Shorter names in the shop?', Owner: 'Keeper', Asks: 'decide', Advice: 'yes' })), 'person')
  assert.equal(routeOf(ask('Q24', { Title: 'Shorter names in the shop?', Owner: 'Partner', Asks: 'decide', Of: 'B21' })), 'person')
  // A refine question without advice goes back to the Advisor.
  assert.equal(routeOf(ask('Q25', { Title: 'Two rows or three?', Owner: 'Partner', Asks: 'decide', Of: 'B30', Via: 'refine' })), 'partner')
  // recap: only for a step of the focus goal; another goal's (or none) is the person's.
  assert.equal(routeOf(ask('Q26', { Title: 'Accept B23 at 60 of 75, or send it back?', Asks: 'decide', Of: 'B23', Via: 'accept', Options: 'A Accept | B Send back' })), 'person')
  // A look of a step at or above its target is no recap wait.
  assert.equal(routeOf(ask('Q27', { Title: 'Does the moat look right?', Owner: 'Painter', Asks: 'look', Of: 'B24', Advice: 'yes' })), 'partner')
  // main: a do a chat can carry out, from a worker, the partner or the main chat; never the Product owner's.
  assert.equal(routeOf(ask('Q28', { Title: 'Merge B21 into main', Owner: 'Painter', Asks: 'do' })), 'main')
  assert.equal(routeOf(ask('Q29', { Title: 'Run the map export', Owner: 'Partner', Asks: 'do' })), 'main')
  assert.equal(routeOf(ask('Q30', { Title: 'Press Go under the plan', Owner: 'Keeper', Asks: 'do' })), 'person')
  // Never the main chat's: marking a step done, accepting it, sending it back.
  assert.equal(routeOf(ask('Q55', { Title: 'Tick B24 as done', Owner: 'Lead', Asks: 'do' })), 'person')
  assert.equal(routeOf(ask('Q56', { Title: 'Accept B24 as it is', Owner: 'Painter', Asks: 'do' })), 'person')
  assert.equal(routeOf(ask('Q57', { Title: 'Send B24 back for a rounder edge', Owner: 'Partner', Asks: 'do' })), 'person')
  // person: goal level, what no chat can do, the app's form, a provide, a look with nothing to go by, the board's own card.
  assert.equal(routeOf(ask('Q31', { Title: 'Which part first?', Owner: 'Partner', Asks: 'decide', Of: 'G29', Advice: 'A', Options: 'A walls | B pool' })), 'person')
  assert.equal(routeOf(ask('Q32', { Title: 'Is this the goal definition you want?', Owner: 'Keeper', Asks: 'decide', Advice: 'yes' })), 'person')
  assert.equal(routeOf(ask('Q33', { Title: 'G29 failed 3 times: evaluate the strategy?', Asks: 'decide', Options: 'A yes | B no' })), 'person')
  assert.equal(routeOf(worker('Q34', { Title: 'Sign in to the shop account?', Advice: 'yes', Options: 'A yes | B later' })), 'person')
  assert.equal(routeOf(worker('Q35', { Title: 'Restart the Claude app to load the new tool?', Advice: 'yes' })), 'person', 'an app restart no chat can do')
  assert.equal(routeOf(worker('Q36', { Title: 'Which colour?', Via: 'form', Options: 'A red | B blue', Advice: 'A' })), 'person')
  assert.equal(routeOf(worker('Q37', { Title: 'The sound file for the shop', Asks: 'provide' })), 'person')
  assert.equal(routeOf(worker('Q38', { Title: 'Does it feel right?', Asks: 'look' })), 'person')
  assert.equal(routeOf(ask('Q39', { Title: 'A card of the board', Asks: 'decide' })), 'person')
})

test('the review\'s cases (2026-10-31): a goal, the focus, an approach, a setting or a licence is the person\'s, also from the partner with advice', () => {
  const partner = (id, title, more = {}) => ask(id, { Title: title, Owner: 'Partner', Asks: 'decide', Advice: 'A', Of: 'B21', ...more })
  assert.equal(routeOf(partner('Q70', 'Make G42 the next focus?', { Advice: 'yes', Of: undefined })), 'person')
  assert.equal(routeOf(partner('Q71', 'Is the maps goal\'s approach right after 18 failed checks?')), 'person')
  assert.equal(routeOf(partner('Q72', 'Apply the new goal map?', { Advice: 'yes' })), 'person')
  assert.equal(routeOf(partner('Q73', 'Which board setting for the first rebuilds?', { Options: 'A off | B on' })), 'person')
  assert.equal(routeOf(partner('Q74', 'Publish the repository under the MIT license?', { Advice: 'yes' })), 'person')
  assert.equal(routeOf(partner('Q76', 'Add "ground that changes" to your map bar?', { Advice: 'yes' })), 'person', 'the person\'s standard')
  // The same partner with advice on a plain detail of a step: decided for the person.
  assert.equal(routeOf(partner('Q75', 'Two rows or three on the shop card?', { Options: 'A two | B three' })), 'advice')
})

test('what only the person\'s hands can do never goes to the main chat (twins of Q104, Q559, Q345, Q113, Q539)', () => {
  const lead = (id, title, more = {}) => ask(id, { Title: title, Owner: 'Lead', Asks: 'do', Via: 'chat', ...more })
  const cases = [
    [lead('Q104', 'Quit and reopen the Claude app. When it\'s back, press "Resume all" on the board.'), 'the Claude app'],
    [ask('Q559', { Title: 'Quit the Claude app fully, including from the system tray, then open it again.', Owner: 'Painter', Asks: 'do', Via: 'chat' }), 'the Claude app'],
    [lead('Q345', 'Open the "Orchard · Painter" chat and click Allow on the pending directory prompt.'), 'a click'],
    [lead('Q113', 'Click the "Orchard · Pruner" chip in this chat to start the new worker.'), 'a click'],
    [lead('Q539', 'Click the chip "Start fresh Orchard · Painter" and the chip "Start fresh Orchard · Pruner" in this chat.', { Advice: 'starting both' }), 'a click'],
  ]
  for (const [one, hands] of cases) {
    assert.equal(handsOf(one), hands, one.head.get('Id'))
    assert.deepEqual(autopilotRoute(one, ctx), { to: 'person', why: `only the person's hands: ${hands}` }, one.head.get('Id'))
  }
  // One list: a board button only the person presses, sign-in, an account, money, an install, a mod's change, a permission,
  // a password, the week's limit (the live store's closed asks of the week showed the board's buttons, a reinstall and a mod).
  assert.deepEqual(PERSONS_HANDS.map(([name]) => name), ['the Claude app', 'a click', 'a click', 'a button of the board', 'a sign-in', 'an account', 'money', 'an install', 'a change of a mod', 'a permission', 'a password', 'the week\'s limit', 'a permanent delete'])
  for (const [title, hands] of [['Log in to the seed shop', 'a sign-in'], ['Pay the hosting bill', 'money'], ['Install the image tool on this PC', 'an install'], ['Reinstall the packages in your game folder?', 'an install'],
    ['Grant the folder permission', 'a permission'], ['Raise the weekly limit', 'the week\'s limit'], ['In Painter\'s chat, press "Turn them on" for the test mod', 'a click'],
    ['B80 waits until you add it to the queue on the Backlog tab.', 'a button of the board'], ['Pin B59 to Painter on the worker board', 'a button of the board'], ['Update the Workers mod to 0.30 so this goes live?', 'a change of a mod']]) {
    assert.equal(routeOf(lead('Q99', title)), 'person', title)
    assert.equal(handsOf(lead('Q99', title)), hands, title)
  }
  // A do only the person's eyes, ears or words carry out (live Q387, Q388, Q414, Q529, Q566): never the main chat's.
  for (const title of ['Look at the picture.', 'Play the painted map.', 'Pick the geyser sound by ear on the sound board', 'Check the result if you like.', 'If you want it the other way, tell me in the chat itself.']) {
    assert.deepEqual(autopilotRoute(lead('Q97', title), ctx), { to: 'person', why: 'the person\'s own eyes, ears or words' }, title)
  }
  // A restart of a board, a merge, a folder deleted, a line run in a terminal: a chat can do them.
  assert.equal(handsOf(RESTART), null)
  // (A folder deleted was here: the coordinator's ruling of 2026-10-31 makes every permanent delete the person's, below.)
  for (const title of ['Restart both boards to load the change.', 'Run this line in a terminal:', 'Archive the two old chats in the sidebar.']) assert.equal(routeOf(lead('Q96', title)), 'main', title)
  // The ruling: anything that deletes for good is the person's, never the main chat's (twins of Q418, Q419, Q541, Q563, and a
  // branch); archiving stays with the main chat.
  const deletes = [
    ask('Q418', { Title: 'Delete the empty folder `D:\\garden\\board-b677`.', Owner: 'Painter', Asks: 'do', Via: 'chat' }),
    ask('Q419', { Title: 'Delete the stray empty folder `D:\\c`.', Owner: 'Painter', Asks: 'do', Via: 'chat' }),
    lead('Q541', 'Archive or delete the Painter and Pruner chats in the sidebar.'),
    ask('Q563', { Title: 'delete the entry named `b44-probe` from `D:\\garden\\.claude\\launch.json`.', Owner: 'Painter', Asks: 'do', Of: 'B21', Via: 'chat' }),
    ask('Q412', { Title: 'Keep branch `b51-trace-lift` for later use, or delete it?', Owner: 'Painter', Asks: 'decide', Options: 'A keep | B delete', Advice: 'B', Via: 'chat' }),
  ]
  for (const one of deletes) assert.deepEqual(autopilotRoute(one, ctx), { to: 'person', why: 'only the person\'s hands: a permanent delete' }, one.head.get('Id'))
  assert.equal(routeOf(lead('Q95', 'Archive the Painter and Pruner chats in the sidebar.')), 'main')
  assert.equal(handsOf(ask('Q98', { Title: 'Merge B21 into main', Owner: 'Painter', Asks: 'do' })), null)
})

test('the step\'s recap line: an open ask routed to the recap that it names makes the step wait for the recap only', () => {
  const asked = (id, state = 'open', route = 'recap') => item({ Id: id, Kind: 'ask', Title: 'x', State: state, Route: route, Of: 'B21' })
  const marked = (state, ids) => item({ Id: 'B21', Kind: 'step', Title: 'Round the pool', State: state, Goal: 'G29' }, { Context: ids.map(id => `  ${recapVerdictWords('waits', id)}`) })
  const items = new Map([['Q80', asked('Q80')], ['Q81', asked('Q81', 'answered')], ['Q82', asked('Q82', 'open', 'person')]])
  assert.equal(recapVerdictWords('waits', 'Q80'), 'Recap verdict: waits (Q80)')
  assert.deepEqual(recapWaitIds(marked('review', ['Q80', 'Q81', 'Q82']), items), ['Q80'])
  assert.equal(waitsForRecap(marked('review', ['Q80']), items), true)
  assert.equal(waitsForRecap(marked('review', ['Q81']), items), false, 'its ask was answered')
  assert.equal(waitsForRecap(marked('in progress', ['Q80']), items), false, 'only a step in review')
})
test('an explicit Route: person stays the person\'s; a bare default one does not count as somebody\'s word', () => {
  const handed = ask('Q40', { Title: 'Icons or words?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', Route: 'person' }, null, { Route: ['Your partner hands this to you: it is a new look'] })
  assert.equal(isExplicitPerson(handed), true)
  assert.equal(routeOf(handed), 'person')
  const bare = ask('Q41', { Title: 'Icons or words?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', Route: 'person' })
  assert.equal(isExplicitPerson(bare), false)
  assert.equal(routeOf(bare), 'partner')
  // The board's own route to the person is somebody's word too.
  const routed = item({ Id: 'Q42', Kind: 'ask', Title: 'x', State: 'open', Route: 'person' }, { History: [`- ${at(5)} server: ${routedWords('person')}`] })
  assert.equal(isExplicitPerson(routed), true)
})

test('the advice and the answer the board writes for it: the pick as the person would make it', () => {
  assert.equal(adviceOf(PARTNER_PICK), 'A')
  assert.equal(adviceAnswerOf(PARTNER_PICK), 'A: keep the lava as your map rules describe it, and show the judges your lava picture (about 1 h).')
  assert.equal(adviceAnswerOf(REBUILD), 'A: Hold it until the board sees it went')
  assert.equal(adviceAnswerOf(RESTART), 'yes')
  assert.equal(adviceOf(ask('Q43', { Title: 'Two or three? I advise B', Asks: 'decide' }, 'Two or three? A: two rows B: three rows. I advise B.')), 'B')
  assert.equal(adviceAnswerOf(ask('Q44', { Title: 'Keep it?', Asks: 'decide', Advice: 'keep it as it is' })), 'keep it as it is')
  assert.equal(adviceOf(ask('Q45', { Title: 'Keep it?', Asks: 'decide' })), null)
  assert.deepEqual(letteredOptions('Which? A: keep it, or B: drop it').map(one => one.words), ['keep it', 'drop it'])
  // A refine question's advice, as "Take the advice" writes it.
  const question = 'Paint the raised maps whole, or one more tile round? A: the painter paints them whole, about 3 h a map. B: one more tile round, about 2 h. Picture: the game beside the painting. Advised: A — the painting is the target'
  assert.deepEqual(refineAdviceOf(question), { advice: 'A', answer: 'A: the painter paints them whole, about 3 h a map.' })
  assert.deepEqual(refineAdviceOf('Drop the old bar? Advised: yes, it is unused'), { advice: 'yes', answer: 'yes' })
  assert.deepEqual(refineAdviceOf('Two rows or three?'), { advice: null, answer: null })
  assert.deepEqual(refineAdviceOf('Two rows? Advised: yes Answer: no'), { advice: 'yes', answer: 'yes' })
})

test('the recognisers: goal level, a chore, a step below its target', () => {
  assert.equal(isGoalLevel(RECAP_DO), true)
  assert.equal(isGoalLevel(REBUILD), true)
  assert.equal(isGoalLevel(PARTNER_PICK, 'advisor'), false)
  assert.equal(isGoalLevel(ask('Q46', { Title: 'Add a work block for the shop?', Asks: 'decide' }), 'worker'), false, 'a worker\'s words about blocks are no goal question')
  assert.equal(isChore(RESTART), true)
  assert.equal(isChore(ask('Q47', { Title: 'Restart the round, A or B?', Asks: 'decide', Options: 'A now | B later', Advice: 'A' })), false)
  assert.equal(belowTarget(B21), true)
  assert.equal(belowTarget(B24), false)
  assert.equal(belowTarget(undefined), false)
})

test('Needs your attention: a routed ask stands nowhere (a recap wait again once Autopilot is off); while on, neither one the board routes away at its next refresh', () => {
  const sp = (one, more = {}) => standsForPerson(one, { ...ctx, autopilot: true, now: NOW, ...more })
  for (const route of ['partner', 'advice', 'recap', 'main']) {
    assert.equal(standsForPerson(ask('Q50', { Title: 'x', Owner: 'Painter', Asks: 'decide', Route: route }), { now: NOW, autopilot: true }), false, route)
  }
  // The coordinator's ruling (2026-10-31): with Autopilot off, an ask that waits for the recap stands for the person again.
  assert.equal(standsForPerson(ask('Q50', { Title: 'x', Owner: 'Painter', Asks: 'look', Route: 'recap' }), { now: NOW, autopilot: false }), true)
  for (const route of ['partner', 'advice', 'main']) assert.equal(standsForPerson(ask('Q50', { Title: 'x', Owner: 'Painter', Asks: 'decide', Route: route }), { now: NOW, autopilot: false }), false, route)
  // Off: an unrouted ask stands as before.
  assert.equal(standsForPerson(LOOSE_LOOK, { ...ctx, autopilot: false, now: NOW }), true)
  // On: a new one the board routes to the partner stands nowhere; one routed to the person stands.
  const fresh = ask('Q51', { Title: 'Icons or words?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', age: 1 })
  assert.equal(sp(fresh), false)
  assert.equal(sp(ask('Q52', { Title: 'Rebuild G29: which way?', Owner: 'Partner', Asks: 'decide', Of: 'G29', age: 1 })), true)
  // One the board could not route in ten minutes stands, so nothing is lost.
  assert.equal(sp(ask('Q53', { Title: 'Icons or words?', Owner: 'Painter', Asks: 'decide', Options: 'A icons | B words', Advice: 'A', age: 11 })), true)
  assert.equal(sp(ask('Q54', { Title: 'x', Owner: 'Painter', Asks: 'decide', Route: 'person' })), true)
})

test('Needs your attention: refine questions under Autopilot, with advice, sent back once, and a drop', () => {
  const step = sent => item({ Id: 'B30', Kind: 'step', Title: 'Raised maps', State: 'new' }, { History: sent === null ? ['- 2026-10-31 10:00 Partner: refined, round 1'] : ['- 2026-10-31 10:00 Partner: refined, round 1', `- ${at(sent)} server: ${SENT_BACK}: ${REFINE_BACK_WORDS}`] })
  const question = (id, words, age) => ask(id, { Title: words.split('?')[0], Owner: 'Partner', Asks: 'decide', Of: 'B30', Via: 'refine', age }, words)
  const sp = (one, stepItem) => standsForPerson(one, { ...ctx, items: new Map([...ITEMS, ['B30', stepItem]]), autopilot: true, now: NOW })
  // With advice: the board answers it at its next refresh.
  assert.equal(sp(question('Q60', 'Two rows? Advised: yes', 1), step(null)), false)
  assert.equal(sp(question('Q61', 'Two rows? Advised: yes', 11), step(null)), true, 'not answered in ten minutes: it stands')
  // Without advice: sent back for it, its next round comes; sent back for an earlier one, it is the person's.
  assert.equal(sp(question('Q62', 'Two rows or three?', 5), step(4)), false)
  assert.equal(sp(question('Q63', 'Two rows or three?', 5), step(40)), true)
  assert.equal(sp(question('Q64', 'Two rows or three?', 40), step(35)), true, 'the round did not come in 30 minutes')
  // A question that drops the step is the person's.
  assert.equal(sp(question('Q65', 'Drop B30? Advised: yes', 1), step(null)), true)
})
