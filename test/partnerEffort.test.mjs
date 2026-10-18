// B352: the partner's high effort mode. The person, 2026-10-18 (I16): "while refining a goal, i want a button to change
// the claude chat working on it, to other model/effort, lets call it high effort mode. so like fable 5.1 max effort.
// otherwise it will use opus extra". A switch beside the talk with the partner on the Focus page; the board cannot
// change a chat itself, so it types `partner effort` into the main chat, which sets the partner's chat with the app's
// session tools. The board tells that it is set from the partner's own transcript: each of its answers names the
// model and the effort it ran on. Go on the how, and a new focus, switch it back to the usual partner. Made-up chats.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { PARTNER_MODES, effortBack, partnerEffort, partnerEffortWords } from '../src/partnerEffort.mjs'
import { checkSay } from '../src/say.mjs'
import { outboxNow } from '../src/store.mjs'
import { parseTail } from '../src/transcript.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')
const style = await readFile(join(ROOT, 'public', 'board.css'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('effortswitch')}\nObject.assign(this, { effortView })`, page)

const MIN = 60_000
const at = Date.parse('2026-10-18T19:00:00Z')

test('the two modes: the usual partner on Opus 5.5 at extra high effort, high effort on Fable 5.1 at max', () => {
  assert.deepEqual(PARTNER_MODES.usual, { model: 'claude-opus-5-5', effort: 'xhigh', label: 'Opus 5.5, extra high' })
  assert.deepEqual(PARTNER_MODES.high, { model: 'claude-fable-5-1', effort: 'max', label: 'Fable 5.1, max' })
})

test('partnerEffortWords: the word to the main chat names the partner\'s chat, its session, the mode, model and effort', () => {
  const message = partnerEffortWords({ to: 'Main', partner: 'Advisor', session: 'local_1234abcd', mode: 'high', why: 'switched on the Focus page' })
  assert.equal(message.to, 'Main')
  assert.equal(message.command, 'partner-effort')
  assert.equal(message.about, 'Advisor')
  assert.equal(message.mode, 'high')
  assert.equal(message.text, 'partner effort\nChat: Advisor\nMode: high\nModel: claude-fable-5-1\nEffort: max\nSession: local_1234abcd\nWhy: switched on the Focus page')
  // Without a session id the app knows, the main chat finds the chat by its name.
  const usual = partnerEffortWords({ to: 'Main', partner: 'Advisor', session: null, mode: 'usual', why: 'Go on the how' })
  assert.equal(usual.text, 'partner effort\nChat: Advisor\nMode: usual\nModel: claude-opus-5-5\nEffort: xhigh\nWhy: Go on the how')
  // A session id is only ever an id: anything else is left out.
  assert.ok(!partnerEffortWords({ to: 'Main', partner: 'Advisor', session: 'x\nWhy: other', mode: 'high', why: 'w' }).text.includes('Session:'))
})

const state = {
  restart: { main: 'Main' },
  chats: [{ name: 'Main', isMain: true, isLeftover: false }, { name: 'Units', isLeftover: false }],
  advisor: { name: 'Advisor', appSession: 'local_1234abcd' },
}

test('checkSay: the switch\'s word goes to the main chat only, with a mode the board knows, and nothing else', () => {
  const asked = checkSay({ to: 'Main', command: 'partner-effort', mode: 'high' }, state, 50)
  assert.equal(asked.ok, true)
  assert.equal(asked.message.command, 'partner-effort')
  assert.equal(asked.message.text, partnerEffortWords({ to: 'Main', partner: 'Advisor', session: 'local_1234abcd', mode: 'high', why: 'switched on the Focus page' }).text)
  assert.equal(checkSay({ to: 'Main', command: 'partner-effort', mode: 'usual' }, state, 50).message.mode, 'usual')
  for (const [body, status] of [
    [{ to: 'Main', command: 'partner-effort', mode: 'max' }, 400],
    [{ to: 'Main', command: 'partner-effort' }, 400],
    [{ to: 'Advisor', command: 'partner-effort', mode: 'high' }, 400],
    [{ to: 'Units', command: 'partner-effort', mode: 'high' }, 400],
    [{ to: 'Main', command: 'partner-effort', mode: 'high', text: 'and more' }, 400],
  ]) assert.equal(checkSay(body, state, 50).status, status, JSON.stringify(body))
  // No partner chat on the board: nothing to switch.
  assert.equal(checkSay({ to: 'Main', command: 'partner-effort', mode: 'high' }, { ...state, advisor: null }, 50).status, 409)
})

/** A made-up transcript line of the partner's answer, as the app writes it: the model in the message, the effort beside. */
const answer = (minute, model, effort) => JSON.stringify({ type: 'assistant', timestamp: new Date(at + minute * MIN).toISOString(), effort, message: { role: 'assistant', model, content: [{ type: 'text', text: 'Draft written.' }], stop_reason: 'end_turn' } })
const typed = minute => JSON.stringify({ type: 'user', timestamp: new Date(at + minute * MIN).toISOString(), message: { role: 'user', content: 'Q2: A' } })
const entriesOf = (...lines) => parseTail(lines.join('\n'), false)

test('parseTail keeps the model and the effort an answer ran on', () => {
  const [user, said] = entriesOf(typed(0), answer(1, 'claude-fable-5-1', 'max'))
  assert.deepEqual([user.model, user.effort], [null, null])
  assert.deepEqual([said.model, said.effort], ['claude-fable-5-1', 'max'])
})

test('partnerEffort: the mode last asked, and set once the partner answered on it after the ask', () => {
  const ask = (minute, mode, state = 'delivered') => ({ to: 'Main', command: 'partner-effort', about: 'Advisor', mode, at: at + minute * MIN, state })
  // Never asked: the usual partner, nothing to wait for.
  const none = partnerEffort({ sent: [], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-opus-5-5', 'xhigh')) })
  assert.deepEqual({ mode: none.mode, asked: none.asked, isSet: none.isSet }, { mode: 'usual', asked: null, isSet: true })
  assert.deepEqual(none.runsOn, { model: 'claude-opus-5-5', effort: 'xhigh', at: at + MIN })
  // Asked high at minute 5: the answer before it ran on Opus, so it is not set yet.
  const asked = partnerEffort({ sent: [ask(5, 'high')], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-opus-5-5', 'xhigh')) })
  assert.deepEqual({ mode: asked.mode, isSet: asked.isSet, asked: asked.asked }, { mode: 'high', isSet: false, asked: { at: at + 5 * MIN, state: 'delivered', label: 'Fable 5.1, max' } })
  // Its next answer runs on Fable at max: set.
  const set = partnerEffort({ sent: [ask(5, 'high')], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-opus-5-5', 'xhigh'), typed(6), answer(7, 'claude-fable-5-1', 'max')) })
  assert.equal(set.isSet, true)
  // An answer on another model, or the app's own lines without a model, do not count.
  const other = partnerEffort({ sent: [ask(5, 'high')], partner: 'Advisor', entries: entriesOf(answer(7, 'claude-fable-5-1', 'high'), answer(8, '<synthetic>', null)) })
  assert.deepEqual([other.isSet, other.runsOn.effort], [false, 'high'])
  // The last ask counts, and only the asks for this partner.
  const back = partnerEffort({ sent: [ask(5, 'high'), ask(9, 'usual'), { ...ask(10, 'high'), about: 'Someone else' }], partner: 'Advisor', entries: entriesOf(answer(11, 'claude-opus-5-5', 'xhigh')) })
  assert.deepEqual([back.mode, back.isSet], ['usual', true])
  // A partner whose transcript cannot be read: asked, not known to be set.
  assert.equal(partnerEffort({ sent: [ask(5, 'high')], partner: 'Advisor', entries: null }).runsOn, null)
})

test('partnerEffort, the review: the outbox forgets a word after two hours; what the partner runs on still says the mode', () => {
  const forgot = partnerEffort({ sent: [], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-fable-5-1', 'max')) })
  assert.deepEqual([forgot.mode, forgot.isSet, forgot.asked], ['high', true, null])
  // So Go still switches it back.
  assert.equal(effortBack('how-go', forgot), 'Go on the how: back to the usual partner')
  // Fable at another effort is not high effort mode.
  assert.equal(partnerEffort({ sent: [], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-fable-5-1', 'high')) }).mode, 'usual')
})

test('partnerEffort, the review: a word that did not arrive changed nothing, and says so', () => {
  const ask = (minute, mode, state) => ({ to: 'Main', command: 'partner-effort', about: 'Advisor', mode, at: at + minute * MIN, state })
  for (const state of ['expired', 'failed']) {
    const lost = partnerEffort({ sent: [ask(5, 'high', state)], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-opus-5-5', 'xhigh')) })
    assert.deepEqual([lost.mode, lost.isSet, lost.asked, lost.missed], ['usual', true, null, { at: at + 5 * MIN, state }], state)
  }
  // An earlier word that arrived still counts; a later one that arrived clears the miss.
  const earlier = partnerEffort({ sent: [ask(2, 'high', 'delivered'), ask(5, 'usual', 'expired')], partner: 'Advisor', entries: entriesOf(answer(3, 'claude-fable-5-1', 'max')) })
  assert.deepEqual([earlier.mode, earlier.isSet, earlier.missed.state], ['high', true, 'expired'])
  assert.equal(partnerEffort({ sent: [ask(5, 'high', 'expired'), ask(6, 'high', 'waiting')], partner: 'Advisor', entries: null }).missed, null)
})

test('the second review: the newest word that arrived stays known in the outbox, however long the partner is idle', () => {
  const keep = { messageMs: 10 * MIN, answerMs: 24 * 60 * MIN }
  const word = (id, minute, mode, state) => ({ id, to: 'Main', command: 'partner-effort', about: 'Advisor', mode, at: at + minute * MIN, state })
  const sent = [word('w1', 0, 'high', 'delivered'), word('w2', 10, 'usual', 'delivered'), word('w3', 20, 'high', 'failed')]
  // Three hours on: the "usual" word after Go still stands, so an old answer on Fable cannot turn the switch on again;
  // the failed word is shown for a while, as every word that did not arrive.
  const kept = outboxNow(sent, at + 200 * MIN, keep)
  assert.deepEqual(kept.map(message => message.id), ['w2', 'w3'])
  assert.deepEqual(outboxNow(sent, at + 13 * 60 * MIN, keep).map(message => message.id), ['w2'])
  const after = partnerEffort({ sent: kept, partner: 'Advisor', entries: entriesOf(answer(5, 'claude-fable-5-1', 'max')) })
  assert.deepEqual([after.mode, after.isSet], ['usual', false])
})

test('the second review: a lost word whose mode the partner runs on anyway asks for nothing', () => {
  const lost = { to: 'Main', command: 'partner-effort', about: 'Advisor', mode: 'high', at: at + 5 * MIN, state: 'expired' }
  assert.equal(partnerEffort({ sent: [lost], partner: 'Advisor', entries: entriesOf(answer(6, 'claude-fable-5-1', 'max')) }).missed, null)
})

test('partnerEffort, the review: a helper\'s lines in the partner\'s transcript are not its answers', () => {
  const helper = JSON.stringify({ ...JSON.parse(answer(9, 'claude-opus-5-5', 'xhigh')), isSidechain: true })
  const read = partnerEffort({ sent: [], partner: 'Advisor', entries: entriesOf(answer(1, 'claude-fable-5-1', 'max'), helper) })
  assert.deepEqual(read.runsOn, { model: 'claude-fable-5-1', effort: 'max', at: at + MIN })
})

test('effortBack: Go on the how, and a new focus, switch the partner back to the usual, only when high effort is on', () => {
  const on = { mode: 'high' }
  assert.equal(effortBack('how-go', on), 'Go on the how: back to the usual partner')
  assert.equal(effortBack('focus', on), 'a new focus: back to the usual partner')
  assert.equal(effortBack('how-go', { mode: 'usual' }), null)
  assert.equal(effortBack('how-go', null), null)
  for (const command of ['vibe-agree', 'talk', 'how-not-yet']) assert.equal(effortBack(command, on), null)
})

test('effortView: the switch\'s line and its note, as in the picture', () => {
  const off = page.effortView({ mode: 'usual', isSet: true, asked: null, labels: { usual: 'Opus 5.5, extra high', high: 'Fable 5.1, max' } })
  assert.deepEqual({ ...off }, { isOn: false, line: 'off: Opus 5.5, extra high', isSettling: false, note: 'Flip it for the vibe and the how of a hard goal: your partner switches at its next answer.' })
  const switching = page.effortView({ mode: 'high', isSet: false, asked: { at, state: 'delivered' }, labels: { usual: 'Opus 5.5, extra high', high: 'Fable 5.1, max' } })
  assert.equal(switching.isOn, true)
  assert.equal(switching.line, 'on: Fable 5.1, max')
  assert.equal(switching.isSettling, true)
  assert.equal(switching.note, 'Switching… the main chat sets it; the line turns solid once your partner runs on it.')
  const on = page.effortView({ mode: 'high', isSet: true, asked: { at, state: 'delivered' }, labels: { usual: 'Opus 5.5, extra high', high: 'Fable 5.1, max' } })
  assert.equal(on.note, 'Your partner runs on Fable 5.1, max. Go on the how switches it back.')
  // A word the main chat never took says so; the switch shows what the partner runs on.
  const missed = page.effortView({ mode: 'usual', isSet: true, asked: null, missed: { at, state: 'expired' }, labels: { usual: 'U', high: 'H' } })
  assert.deepEqual([missed.isOn, missed.note], [false, 'The main chat did not take the word: flip the switch again.'])
  // No partner on the board: no switch.
  assert.equal(page.effortView(null), null)
})

test('the switch sits in the talk with the partner, is a switch to the screen reader, and has its look', () => {
  assert.match(script, /card\.append\(effortSwitch\(state, can\)\)/)
  assert.match(script, /setAttribute\('role', 'switch'\)/)
  assert.match(script, /command: 'partner-effort'/)
  assert.match(style, /\.effort-switch \{/)
  assert.match(style, /\.effort-switch\.is-on \{/)
  assert.match(style, /\.effort-switch\.is-settling \{[^}]*border-style: dashed/)
})

test('the wiring: the state names the partner\'s mode; the server switches it back on Go and on another focus', async () => {
  const stateSource = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')
  const server = await readFile(join(ROOT, 'server.mjs'), 'utf8')
  assert.match(stateSource, /effort: partnerEffort\(\{ sent, partner: advisorChat\.name, entries: /)
  // After the move was written (its word to the partner is on its way), and not for the talk about the same goal again.
  const focusNow = server.slice(server.indexOf('const focusNow = async body => {'), server.indexOf('const toPartner = async'))
  // B354: and something new that waits for its Done when (no focus changed).
  assert.match(focusNow, /if \(!done\.ok \|\| done\.words === null\) return[^\n]*\n[\s\S]*const isSameFocus = body\.command === 'focus' && \(body\.id === state\.focus\?\.id \|\| done\.result\?\.isFocus === false\)\n\s*const back = isSameFocus \? null : effortBack\(body\.command, state\.advisor\?\.effort\)/)
  assert.match(focusNow, /partnerEffortWords\(\{ to: main, partner: state\.advisor\.name, session: state\.advisor\.appSession \?\? null, mode: 'usual', why: back \}\)/)
})

test('the word stands in the main chat\'s job and in the protocol, and is the board\'s, not the person\'s', async () => {
  const main = await readFile(join(ROOT, 'roles', 'main.md'), 'utf8')
  const protocol = await readFile(join(ROOT, 'roles', 'protocol.md'), 'utf8')
  const stateSource = await readFile(join(ROOT, 'src', 'state.mjs'), 'utf8')
  assert.match(main, /`partner effort` with "Chat:", "Mode:", "Model:", "Effort:"/)
  assert.match(main, /set_session_model/)
  assert.match(main, /set_session_effort/)
  assert.match(protocol, /\| `partner effort` \/ `Chat:` \/ `Mode:` \/ `Model:` \/ `Effort:`/)
  assert.match(stateSource, /const BOARD_WORDS = [^\n]*\|partner effort\|/)
})
