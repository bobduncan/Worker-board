// Reactive board, brief P4c (the person, 2026-11-11, in chat 1: "1. yes" to giving the last clicks without a wait line the same line): the
// Vision tab's words to the partner (every plan-* word), "No, because..." on the way card (recommend), the free messages (the Advisor talk's
// Send, Talk to Main, a hint's nudge, "Ask for pictures" on an ask) get P3's line where their button was, drawn from the records only.
// Done comes from the place's own record: for a plan word the PARTNER's write of the plan page (the board's own write of a decision never
// counts), for "No, because..." the way card's next recommendation, for the free messages the turn report. The Vision tab's guessed
// working lines (the "is preparing" sentences, the page's memory of "asked", the 30-minute "No answer") are retired.
// Made-up garden chats; the real case replays real records of the board's own outbox (fixtures/p4c), copied into a temp folder.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseConfig } from '../src/config.mjs'
import { planState, withPlanWork } from '../src/plan.mjs'
import { PLAN_DECISIONS, PLAN_MOVES, planDecide } from '../src/planMoves.mjs'
import { partnerPageAt } from '../src/planWrite.mjs'
import { fileStore } from '../src/store.mjs'
import { wordJudge } from '../src/supervisor/index.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { FREE_KINDS, PLAN_COMMANDS, isPersonWord, placeOfWord, waitsOf } from '../src/waitLine.mjs'
import { parseItem } from '../src/work/item.mjs'
import { openPage, reply } from './pageHarness.mjs'
import { MIN, NOW, asSent, build } from './partnerState.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pad = n => String(n).padStart(2, '0')
const hhmm = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const words = node => node.textContent.replace(/\s+/g, ' ').trim()
const at = minutesAgo => NOW - minutesAgo * MIN
const config = { ...parseConfig('{}', {}), project: 'C:\\garden' }
const keep = buildView({ state: { chats: [], chatPrefix: '' }, outbox: [], settings: {}, now: NOW }).keep
const lane = (name, more = {}) => ({ name, isRunning: true, status: 'Free', state: 'free', task: null, report: null, wake: null, ...more })
const said = (state, since, more = {}) => ({ state, since, background: false, run: 1, seq: 1, busyAt: null, ...more })

/** The server's `waits` for a state and an outbox (the judge as the server makes it). */
function waitsFor({ state, outbox, reports = null, now = NOW }) {
  const judge = wordJudge({ state, items: new Map(), outbox, settings: {}, now })
  return waitsOf({ state, outbox, now, keep, judge, reports, items: new Map() })
}

const PLAN_TEXT = '# Garden\n\nPitch: A garden.\n\n## P1 · What it is\n\n- State: decided (you, 2026-10-19)\n\n## P7 · The road\n\n- State: assumed (partner, 2026-10-18)\n- Point: **First** a bench\n'
const planOf = (outbox, pageAt = null, now = NOW, asks = []) => withPlanWork(planState(PLAN_TEXT, asks, 'p.md'), outbox, pageAt, now)
const baseState = (more = {}) => ({ chats: [], supervisorChat: null, advisor: lane('Advisor'), ...more })
const aboutOf = command => (/^plan-(confirm|ask|deeper|settled|change)$/.test(command) ? 'P1' : command === 'plan-tradeoff' ? 'F1' : command === 'plan-not-now' ? 'S1' : command === 'plan-measure' ? 'K1' : 'plan')
const planWord = (command, more = {}) => ({ id: 'w1', to: 'Advisor', ask: null, step: null, text: `plan: ${command}`, command, about: aboutOf(command), at: at(10), state: 'waiting', ...more })
const takenPlan = (command, more = {}) => planWord(command, { state: 'delivered', takenAt: at(9), deliveredAt: at(9) + 1000, ...more })

// ---------------------------------------------------------------------------------------------------------------------
// Vision: the server

test('every Vision word is a person\'s word of the place "plan": Sent, then Picked up, then Done by the partner\'s write of the plan page, never by a guess; Late by P3\'s rule', () => {
  assert.deepEqual(PLAN_COMMANDS, PLAN_MOVES, 'the words src/planMoves.mjs takes are the words that are tracked')
  for (const command of PLAN_COMMANDS) {
    const word = planWord(command)
    assert.equal(isPersonWord(word), true, `${command} is tracked`)
    assert.equal(placeOfWord(word), 'plan', `${command} has its place`)
    // Sent: in the outbox, not picked up.
    const sent = waitsFor({ state: baseState({ plan: planOf([word]) }), outbox: [word] }).w1
    assert.deepEqual([sent.state, sent.place, sent.command, sent.about, sent.lead], ['sent', 'plan', command, aboutOf(command), `Sent ${hhmm(at(10))}`], command)
    // Picked up: the mod's turn report names the word.
    const busy = baseState({ advisor: lane('Advisor', { status: 'Working', state: 'working' }), plan: planOf([takenPlan(command)]) })
    const onIt = waitsFor({ state: busy, outbox: [takenPlan(command)], reports: new Map([['Advisor', said('busy', at(8), { word: 'w1', turn: at(8) })]]) }).w1
    assert.deepEqual([onIt.state, onIt.lead], ['picked-up', 'Advisor is on it'], command)
    // The partner's page written BEFORE the word does not end it; one written after does: Done at that write's time.
    const before = waitsFor({ state: baseState({ plan: planOf([word], at(20)) }), outbox: [word] }).w1
    assert.equal(before.state, 'sent', `${command}: a write older than the word is no answer`)
    const done = waitsFor({ state: baseState({ plan: planOf([word], at(5)) }), outbox: [word] }).w1
    assert.deepEqual([done.state, done.lead, done.rest], ['done', `Done ${hhmm(at(5))}`, command === 'plan-deeper' ? 'deeper questions' : command === 'plan-ask' ? 'the options' : 'your plan is written'], command)
    // Late: its chat does not pick it up for long.
    const late = waitsFor({ state: baseState({ plan: planOf([planWord(command, { at: at(40) })]) }), outbox: [planWord(command, { at: at(40) })] }).w1
    assert.equal(late.state, 'late', command)
  }
})

test('no record, no line: no word in the outbox, no line; a plan word of the board\'s own kind (not a Vision move) gives none; a word with no plan page yet has no Done', () => {
  assert.deepEqual(waitsFor({ state: baseState({ plan: planOf([]) }), outbox: [] }), {})
  assert.deepEqual(Object.keys(waitsFor({ state: baseState(), outbox: [planWord('plan-brand-new')] })), [])
  // No page yet (the empty tab after Start): the start word waits, with no Done to read.
  const start = waitsFor({ state: baseState({ plan: null }), outbox: [planWord('plan-start')] }).w1
  assert.deepEqual([start.state, start.place], ['sent', 'plan'])
})

test('a plan word owes its own result: its turn ended without the page written is "turn ended without it", and Late with the chat at rest; the seven decisions the board wrote itself owe none (the fallback "answered")', () => {
  const report = new Map([['Advisor', said('idle', at(8), { word: 'w1', turn: at(9) })]])
  for (const command of PLAN_COMMANDS) {
    const word = takenPlan(command)
    const line = waitsFor({ state: baseState({ plan: planOf([word]) }), outbox: [word], reports: report }).w1
    if (PLAN_DECISIONS.includes(command)) assert.deepEqual([line.state, line.lead], ['done', `Advisor answered ${hhmm(at(8))}`], `${command}: the board wrote it; the partner went on from it`)
    else assert.deepEqual([line.state, line.isTurnEnded, line.lead], ['late', true, `No answer since ${hhmm(at(8))}`], `${command}: its turn ended and no page was written`)
  }
})

test('plan-deeper and plan-ask are Done by their own record: a deeper question filed after the word, the options asked for; another card\'s does not count', () => {
  const filed = (id, title, at2) => parseItem(`Id: ${id}\nKind: ask\nTitle: ${title}\nState: open\nOwner: P - Partner\nAsks: decide\nFiled: ${at2}\n`)
  const deeper = planWord('plan-deeper')
  const run = (asks, word = deeper) => waitsFor({ state: baseState({ plan: planOf([word], null, NOW, asks) }), outbox: [word] }).w1
  assert.equal(run([filed('Q8', 'P1.1: how big?', at(5))]).state, 'done', 'a deeper question about P1 after the word')
  assert.equal(run([filed('Q8', 'P1.1: how big?', at(20))]).state, 'sent', 'one filed before the word is no answer')
  assert.equal(run([filed('Q8', 'P7.1: how big?', at(5))]).state, 'sent', 'another card\'s question is no answer')
  const ask = planWord('plan-ask', { about: 'P7' })
  assert.equal(run([filed('Q9', 'P7: where?', at(5))], ask).state, 'done', 'Get options: the question of that card')
})

test('a board decision write is no answer; the partner\'s write is: a plan-deeper word, then a decision the board writes (still waiting), then a write of the partner (Done)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p4c-plan-'))
  try {
    const file = join(dir, 'product-plan.md')
    const writes = join(dir, 'plan-writes.json')
    await writeFile(file, PLAN_TEXT.replace('- State: assumed (partner, 2026-10-18)', '- State: assumed (partner, 2026-10-18)'), 'utf8')
    // The page as the partner left it, 20 minutes ago; the word to the partner is typed 10 minutes ago.
    const real = Date.now()
    await utimes(file, new Date(real - 20 * MIN), new Date(real - 20 * MIN))
    const word = planWord('plan-deeper', { at: real - 10 * MIN })
    const line = async () => {
      const pageAt = await partnerPageAt((await stat(file)).mtimeMs, writes, file)
      return waitsFor({ state: baseState({ plan: withPlanWork(planState(await readFile(file, 'utf8'), [], 'p.md'), [word], pageAt, real) }), outbox: [word], now: real }).w1
    }
    assert.equal((await line()).state, 'sent', 'the word waits: the page is older than it')
    // The person's own decision, written by the board now (a Confirm): the page file is newer than the word, yet this is no answer.
    const done = await planDecide({ command: 'plan-confirm', id: 'P7' }, { canWrite: true, partner: { name: 'Advisor' }, job: 'J', file, writesFile: writes, now: real })
    assert.equal(done.ok, true)
    assert.match(await readFile(file, 'utf8'), /- State: decided \(you, /)
    assert.ok((await stat(file)).mtimeMs > word.at, 'the board wrote the page after the word')
    const waiting = await line()
    assert.deepEqual([waiting.state, waiting.lead], ['sent', `Sent ${hhmm(word.at)}`], 'a board decision write: still waiting, not Done')
    // The partner writes the page: Done, at that write's time.
    await writeFile(file, `${await readFile(file, 'utf8')}\n- Point: **Then** a pond\n`, 'utf8')
    const answered = await line()
    assert.deepEqual([answered.state, answered.rest], ['done', 'deeper questions'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('the word keeps the person\'s own words (`said`): a Send again of a late word types them again, whatever the box holds now', async () => {
  const { planWords } = await import('../src/say.mjs')
  const sent = planWords('plan-change', { to: 'Advisor', id: 'P1', words: '  make it   a puzzle ', job: 'J' })
  assert.equal(sent.said, 'make it a puzzle')
  assert.equal(planWords('plan-check', { to: 'Advisor', id: '', job: 'J' }).said, undefined, 'a word with no words of the person\'s keeps none')
  const word = planWord('plan-change', { at: at(40), said: 'make it a puzzle' })
  assert.equal(waitsFor({ state: baseState({ plan: planOf([word]) }), outbox: [word] }).w1.said, 'make it a puzzle')
})

// ---------------------------------------------------------------------------------------------------------------------
// "No, because...": the way card

const recWord = (answer, more = {}) => ({ id: 'w1', to: 'Advisor', ask: null, step: null, text: `advisor recommendation: ${answer}`, command: 'recommend', about: 'R1', answer, at: at(10), state: 'waiting', ...more })

test('"No, because..." (the word to the Advisor) has the line where its button was; Done once the way card reads another recommendation; a yes the board carries out is no wait', () => {
  const no = recWord('no')
  assert.equal(isPersonWord(no), true)
  assert.equal(isPersonWord(recWord('yes')), false, 'a yes is carried out by the board itself: instant, no chat')
  assert.equal(placeOfWord(no), 'recommend')
  const way = id => ({ milestone: { recommendation: id === null ? null : { id, title: 'x' } } })
  const sent = waitsFor({ state: baseState(way('R1')), outbox: [no] }).w1
  assert.deepEqual([sent.state, sent.place, sent.about], ['sent', 'recommend', 'R1'])
  // The same recommendation still stands, or none is read at all: not Done.
  assert.equal(waitsFor({ state: baseState(way(null)), outbox: [no] }).w1.state, 'sent')
  assert.equal(waitsFor({ state: baseState({}), outbox: [no] }).w1.state, 'sent', 'no way card to read: no Done')
  // Another recommendation stands: the Advisor proposed another task.
  const done = waitsFor({ state: baseState(way('R2')), outbox: [no] }).w1
  assert.deepEqual([done.state, done.rest], ['done', 'another task proposed'])
  // With no record the way card shows nothing: no word, no line.
  assert.deepEqual(waitsFor({ state: baseState(way('R1')), outbox: [] }), {})
})

// ---------------------------------------------------------------------------------------------------------------------
// The free messages

const freeWord = (kind, more = {}) => ({ id: 'w1', to: kind === 'main-send' ? 'Main' : 'Advisor', ask: null, step: null, text: 'hello', free: kind, at: at(3), state: 'waiting', ...more })

test('a free message keeps its kind on the word and has the place "free": Sent, Picked up, Done by the turn report (P3\'s general rule); one with no kind has no line', () => {
  assert.deepEqual(FREE_KINDS, ['talk-send', 'main-send', 'nudge', 'ask-pictures'])
  for (const kind of FREE_KINDS) {
    const word = freeWord(kind, kind === 'nudge' ? { freeAbout: 'Q7' } : kind === 'ask-pictures' ? { freeAbout: 'Q70' } : {})
    assert.equal(isPersonWord(word), true, kind)
    assert.equal(placeOfWord(word), 'free', kind)
    const chat = word.to
    const state = baseState({ advisor: lane('Advisor'), productOwner: null, chats: [lane('Main')] })
    const sent = waitsFor({ state, outbox: [word] }).w1
    assert.deepEqual([sent.state, sent.place, sent.command, sent.about], ['sent', 'free', kind, word.freeAbout ?? null], kind)
    const taken = { ...word, state: 'delivered', takenAt: at(2), deliveredAt: at(2) + 1000 }
    const onIt = waitsFor({ state: { ...state, chats: [lane('Main', { status: 'Working', state: 'working' })], advisor: lane('Advisor', { status: 'Working', state: 'working' }) }, outbox: [taken], reports: new Map([[chat, said('busy', at(2), { word: 'w1', turn: at(2) })]]) }).w1
    assert.deepEqual([onIt.state, onIt.lead], ['picked-up', `${chat} is on it`], kind)
    const done = waitsFor({ state, outbox: [taken], reports: new Map([[chat, said('idle', at(1), { word: 'w1', turn: at(2) })]]) }).w1
    assert.deepEqual([done.state, done.lead], ['done', `${chat} answered ${hhmm(at(1))}`], kind)
  }
  // No kind (a plain word, a word of an older board), or a kind that is none: no line, nothing guessed.
  assert.deepEqual(Object.keys(waitsFor({ state: baseState(), outbox: [{ ...freeWord('talk-send'), free: undefined }] })), [])
  assert.deepEqual(Object.keys(waitsFor({ state: baseState(), outbox: [freeWord('made-up-kind')] })), [])
  // A word with a command or an ask keeps its own place: the kind does not take it over.
  assert.equal(placeOfWord({ ...freeWord('talk-send'), command: 'refine' }), 'refine')
})

// ---------------------------------------------------------------------------------------------------------------------
// The real case: real records of the board's own outbox, copied into a temp folder, through the server's wait pass

test('the real case: real Vision words and real Talk to Main words from the board\'s own outbox, copied to a temp folder, read by the store, through the wait pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p4c-real-'))
  try {
    for (const name of ['outbox.jsonl', 'history.jsonl']) await writeFile(join(dir, name), await readFile(join(ROOT, 'fixtures', 'p4c', name)))
    const store = await fileStore(dir, 1_795_000_000_000)
    const real = id => store.outbox().find(word => word.id === id)
    const lineAt = (id, minutesAfter, { pageAt = null, kind = null } = {}) => {
      const word = kind === null ? real(id) : { ...real(id), free: kind }
      const now = word.at + minutesAfter * MIN
      const to = word.to
      const state = baseState({ advisor: lane('Advisor'), chats: [lane('Main')], plan: planOf([word], pageAt, now) })
      return waitsFor({ state, outbox: [word], now })[id]
    }
    // The real Vision words: each is a person's word of the place "plan", about its card, with its Sent line; the plan-change one has its words.
    const realWords = { b602cc74dbe32841: ['plan-change', 'P1'], d73175ec8383bc32: ['plan-ask', 'P5'], '3f564b15d976f737': ['plan-deeper', 'P3'], '5acb752740172e21': ['plan-goals-agree', 'plan'], '46ba71690cc9511c': ['plan-check', 'plan'] }
    for (const [id, [command, about]] of Object.entries(realWords)) {
      const sent = lineAt(id, 1)
      assert.deepEqual([sent.place, sent.command, sent.about], ['plan', command, about], command)
      assert.equal(sent.state === 'sent' || sent.state === 'picked-up' || sent.state === 'late', true, `${command}: ${sent.state}`)
      assert.doesNotMatch(`${sent.lead} ${sent.rest}`, /thinking|preparing/, command)
    }
    // The partner's write of the plan page after the real word: Done, from that write's time (a board decision write never counts).
    const word = real('3f564b15d976f737')
    const done = lineAt('3f564b15d976f737', 30, { pageAt: word.at + 5 * MIN })
    assert.deepEqual([done.state, done.lead], ['done', `Done ${hhmm(word.at + 5 * MIN)}`])
    const notYet = lineAt('3f564b15d976f737', 30, { pageAt: word.at - 5 * MIN })
    assert.notEqual(notYet.state, 'done', 'a page older than the word is no answer')
    // A day on, with no answer recorded: P3's honest end, not a guess.
    const old = lineAt('3f564b15d976f737', 26 * 60)
    assert.deepEqual([old.rest, old.isEnded], ['no answer recorded in 24 h', true])
    // The real Talk to Main words (typed before the board kept their kind): no kind, no line; the same words stamped as the board now stamps them get the line.
    for (const id of ['dfd82b1d67db330c', '7bea850b904f9247']) {
      assert.equal(real(id).free, undefined, 'the real record has no kind')
      assert.equal(lineAt(id, 1), undefined, 'no record of a kind: nothing is shown')
      const stamped = lineAt(id, 1, { kind: 'main-send' })
      assert.deepEqual([stamped.place, stamped.command, stamped.chat], ['free', 'main-send', 'Main'], id)
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ---------------------------------------------------------------------------------------------------------------------
// The page

const lineOf = (state, lead, rest, more = {}) => ({ state, lead, rest, at: at(3), chat: 'Advisor', canSendAgain: false, link: null, place: 'plan', command: 'plan-deeper', about: 'P1', goal: null, ask: null, sentAt: at(3), title: 'plan: P1 deeper', ...more })
const SENT = (more = {}) => lineOf('sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up · next in its queue', more)
const visionState = async (outbox, waits, pageAt = null) => {
  const base = asSent({ ...build([], undefined, ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', '    Done when: you judge a fight fun', ''].join('\n')), goalsEdit: { canWrite: true } })
  return { ...base, plan: planOf(outbox, pageAt, NOW), waits, readAt: NOW }
}
const noGuess = text => assert.doesNotMatch(text, /prepar|is starting your plan|is laying|is weighing|is choosing|is proposing|No answer from .* yet on|asked at/i)

test('Vision page: a Go deeper word shows its line on its card and in the tab\'s list, its button waits; no record shows nothing; no "preparing" text anywhere', async () => {
  const quiet = await openPage({ state: await visionState([], {}), now: NOW })
  try {
    await quiet.click('[data-tab="vision"]')
    assert.equal(quiet.all('#view-vision .wait-line').length, 0, 'no record: no line')
    assert.equal(quiet.all('.vision-working').length, 0)
    noGuess(quiet.text('#view-vision'))
    assert.equal(quiet.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, false)
  } finally { await quiet.close() }
  const word = { id: 'w1', to: 'Advisor', command: 'plan-deeper', about: 'P1', at: at(3), state: 'waiting' }
  const sent = await openPage({ state: await visionState([word], { w1: SENT() }), now: NOW })
  try {
    await sent.click('[data-tab="vision"]')
    // One status per card: the word is about P1, so its line is on P1's card and not again in the tab's list.
    const lines = sent.all('#view-vision .wait-line')
    assert.equal(lines.length, 1)
    assert.equal(sent.all('.vision-working .wait-line').length, 0)
    assert.equal(words(lines[0].querySelector('.wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(lines[0].closest('.vision-foot') !== null, true, 'on the card, where its buttons are')
    assert.equal(sent.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, true, 'the button waits while the line says Sent')
    noGuess(sent.text('#view-vision'))
  } finally { await sent.close() }
  // Picked up, then Done (the page written after it): the card's button is free again, the line says Done.
  const picked = await openPage({ state: await visionState([{ ...word, state: 'delivered' }], { w1: lineOf('picked-up', 'Advisor is on it', `since ${hhmm(at(2))}`) }), now: NOW })
  try {
    await picked.click('[data-tab="vision"]')
    assert.match(words(picked.find('#view-vision .wait-line')), /^Advisor is on it · since /)
    assert.equal(picked.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, true)
  } finally { await picked.close() }
  const done = await openPage({ state: await visionState([word], { w1: lineOf('done', `Done ${hhmm(at(1))}`, 'deeper questions', { at: at(1) }) }, at(1)), now: NOW })
  try {
    await done.click('[data-tab="vision"]')
    assert.match(words(done.find('#view-vision .wait-words')), /^Done \d\d:\d\d · deeper questions$/)
    assert.equal(done.find('[data-vision-act="deeper"][data-vision-id="P1"]').disabled, false)
  } finally { await done.close() }
})

test('Vision page: a Late line offers Send again with the person\'s own words from the record, not the box; the same after a reload', async () => {
  const word = { id: 'w1', to: 'Advisor', command: 'plan-change', about: 'P1', at: at(40), state: 'delivered', said: 'make it a puzzle' }
  const late = lineOf('late', 'No answer since 09:00', 'Advisor still working · ask Advisor in its chat', { command: 'plan-change', at: at(40), sentAt: at(40), said: 'make it a puzzle' })
  for (const round of [1, 2]) {
    const page = await openPage({ state: await visionState([word], { w1: late }), now: NOW, answers: () => reply({ said: 'm2' }) })
    try {
      await page.click('[data-tab="vision"]')
      assert.equal(words(page.find('#view-vision .vision-foot .wait-lead')), 'No answer since 09:00', 'on the card of the word')
      await page.click('[data-vision-act="resend"]')
      assert.deepEqual(page.sent('/api/plan').map(one => one.body), [{ command: 'plan-change', id: 'P1', text: 'make it a puzzle' }], `round ${round}: the kept words, the box was never filled`)
    } finally { await page.close() }
  }
})

test('Vision page: the empty tab after Start shows the line of the start word as its one status; Start again only on Late; nothing guessed', async () => {
  const empty = async (waits, planStart) => ({ ...(await visionState([], waits)), plan: null, planStart })
  const none = await openPage({ state: await empty({}, { at: at(3), state: 'working' }), now: NOW })
  try {
    await none.click('[data-tab="vision"]')
    assert.equal(none.all('.vision-start-wait .wait-line').length, 0, 'no record: no line')
    noGuess(none.text('#view-vision'))
  } finally { await none.close() }
  const sent = await openPage({ state: await empty({ w1: SENT({ command: 'plan-start', about: 'plan', title: 'plan interview' }) }, { at: at(3), state: 'waiting' }), now: NOW })
  try {
    await sent.click('[data-tab="vision"]')
    assert.equal(words(sent.find('.vision-start-wait .wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up · next in its queue`)
    assert.equal(sent.all('[data-vision-act="start-again"]').length, 0)
    noGuess(sent.text('#view-vision'))
  } finally { await sent.close() }
  const late = await openPage({ state: await empty({ w1: lineOf('late', 'Not picked up after 40 min', 'it waits in Advisor\'s queue', { command: 'plan-start', about: 'plan', at: at(40), sentAt: at(40) }) }, { at: at(40), state: 'waiting' }), now: NOW })
  try {
    await late.click('[data-tab="vision"]')
    assert.equal(late.all('[data-vision-act="start-again"]').length, 1, 'Late offers Start again')
  } finally { await late.close() }
})

test('Talk to Main and the Advisor talk: the line of the newest free message under the box; none for no record', async () => {
  const base = asSent({ ...build([], undefined, ['Last id: G6', 'Focus: G6', '', '- [~] G6 The polish', ''].join('\n')), goalsEdit: { canWrite: true } })
  const free = (kind, more = {}) => lineOf('sent', `Sent ${hhmm(at(3))}`, 'waits for Main to pick it up · next in its queue', { place: 'free', command: kind, about: null, title: 'hello', chat: kind === 'main-send' ? 'Main' : 'Advisor', ...more })
  const quiet = await openPage({ state: { ...base, waits: {}, readAt: NOW }, now: NOW })
  try {
    assert.equal(quiet.all('#main-wait .wait-line, #say-wait .wait-line').length, 0, 'no record: nothing')
  } finally { await quiet.close() }
  const page = await openPage({ state: { ...base, readAt: NOW, waits: { a: free('main-send'), b: free('talk-send', { lead: `Sent ${hhmm(at(2))}`, rest: 'waits for Advisor to pick it up', sentAt: at(2) }) } }, now: NOW })
  try {
    assert.match(words(page.find('#main-wait .wait-words')), /^Sent \d\d:\d\d · waits for Main to pick it up/)
    await page.click('[data-tab="advice"]')
    assert.match(words(page.find('#say-wait .wait-words')), /^Sent \d\d:\d\d · waits for Advisor to pick it up$/)
  } finally { await page.close() }
})

test('the way card: the line of "No, because..." stands under "You said no"; none while it is not said', async () => {
  const GOALS = ['- [~] G1 The game', '  From the game plan: the goal', '  - [~] G2 M1 · The loop is fun', '    Done when: two runs played, and fun', '    From the game plan: M1', '    Recommendation (R1): Build the outcome preview first · Three steps stand on it. · About 2 hours. · none', '    - [ ] G4 See the next move', '      Steps: B12', ''].join('\n')
  const base = asSent({ ...build([], undefined, GOALS), goalsEdit: { canWrite: true } })
  const rec = base.milestone?.recommendation
  assert.ok(rec, 'the made-up goals give a recommendation')
  const asked = { ...base, readAt: NOW, milestone: { ...base.milestone, recommendation: { ...rec, answer: { answer: 'no', at: at(3), state: 'delivered' } } }, waits: { w1: lineOf('sent', `Sent ${hhmm(at(3))}`, 'waits for Advisor to pick it up', { place: 'recommend', command: 'recommend', about: rec.id }) } }
  const page = await openPage({ state: asked, now: NOW })
  try {
    await page.click('[data-tab="advice"]')
    assert.match(words(page.find('#advisor-way .way-answered')), /^You said no at /)
    assert.doesNotMatch(words(page.find('#advisor-way .way-answered')), /on its way|next round/)
    assert.equal(words(page.find('#advisor-way .wait-words')), `Sent ${hhmm(at(3))} · waits for Advisor to pick it up`)
  } finally { await page.close() }
  const none = await openPage({ state: { ...asked, waits: {} }, now: NOW })
  try {
    await none.click('[data-tab="advice"]')
    assert.equal(none.all('#advisor-way .wait-line').length, 0, 'no record: no line')
  } finally { await none.close() }
})
