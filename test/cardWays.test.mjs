// B533: every card under Needs your attention that waits for someone gives the person the way to do it: an answer
// form, a button that does it, or a link to the place. The person, 2026-10-24: "I want a button to approve/disapprove
// or a link to where I need to do something. This has neither." The page's own code runs here, cut out of board.js
// between its marks. Made-up names only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const script = await readFile(join(PUBLIC, 'board.js'), 'utf8')
const cut = name => script.slice(script.indexOf(`// ${name}:start`), script.indexOf(`// ${name}:end`))
const page = {}
vm.runInNewContext(`${cut('cardways')}\n${cut('focus')}\nObject.assign(this, { cardWays, nudgeWords, focusGuardView, focusRecheckView })`, page)
const ways = (need, canCheck = true) => JSON.parse(JSON.stringify(page.cardWays(need, canCheck)))
const KINDS = Object.keys(vm.runInNewContext(`(${script.slice(script.indexOf('const KINDS = {') + 'const KINDS = '.length, script.indexOf('\n}\n', script.indexOf('const KINDS = {')) + 2)})`))

/** One card of each kind the page knows, as state.mjs makes them. */
const CARDS = {
  input: { id: 'work:Q3', kind: 'input', from: 'Digger', canAnswer: true },
  verify: { id: 'work:Q4', kind: 'verify', from: 'Digger', canAnswer: true },
  intervene: { id: 'quiet:Digger', kind: 'intervene', from: 'Digger', canAnswer: false, isMain: false },
  do: { id: 'work:Q5', kind: 'do', from: 'Digger', canAnswer: true },
  unfiled: { id: 'unfiled:Digger:1', kind: 'unfiled', from: 'Digger', canAnswer: false, talk: 'window', title: 'Digger wrote questions in its chat but filed no ask' },
  idle: { id: 'idle:Digger:1', kind: 'idle', from: 'Digger', canAnswer: false, talk: 'window', title: 'Digger holds B12 and B14 but is not working and asked you nothing: it may wait for you' },
  'old-mod': { id: 'old-mod', kind: 'old-mod', from: null, canAnswer: false },
}
/** A way the person can act on: a form, a button, or a link. */
const ACTS = new Set(['form', 'talk', 'nudge', 'check', 'pause'])

test('every kind of card under Needs your attention carries an answer form, a button or a link', () => {
  assert.deepEqual(KINDS.sort(), Object.keys(CARDS).sort())
  for (const kind of KINDS) {
    const found = ways(CARDS[kind])
    assert.ok(found.some(way => ACTS.has(way.way)), `${kind}: ${JSON.stringify(found)}`)
  }
})

test('a hint carries the way to the chat and a button that asks the chat to act, in the person\'s words', () => {
  const unfiled = ways(CARDS.unfiled)
  assert.deepEqual(unfiled.map(way => way.way), ['talk', 'nudge'])
  assert.deepEqual([unfiled[0].to, unfiled[0].label], ['unfiled:Digger:1', 'Open Digger\'s answer'])
  assert.deepEqual([unfiled[1].to, unfiled[1].label], ['Digger', 'Ask it to file them as asks'])
  assert.match(unfiled[1].text, /file each with work ask/)
  // The main chat's and the Advisor's lead to their talk.
  assert.deepEqual(ways({ ...CARDS.unfiled, from: 'Lead', talk: 'main' })[0], { way: 'talk', to: 'main', label: 'Open Talk to Lead' })
  assert.deepEqual(ways({ ...CARDS.unfiled, from: 'Partner', talk: 'advisor' })[0], { way: 'talk', to: 'advisor', label: 'Open Partner\'s chat' })
  // The idle hint names the steps the chat holds, as its title says.
  const idle = ways(CARDS.idle)
  assert.deepEqual(idle.map(way => way.way), ['talk', 'nudge'])
  assert.equal(idle[1].label, 'Ask it to go on or report')
  assert.match(idle[1].text, /^Your turn has ended while you hold B12 and B14, with nothing running and no ask open: go on with it, file what you need from me with work ask, or report it\.$/)
  assert.match(page.nudgeWords({ kind: 'idle', title: 'X holds B7 but is not working' }).text, /hold B7,/)
})

test('a quiet worker gets Check now; a quiet main chat and a question of the app\'s form are the app\'s', () => {
  assert.deepEqual(ways(CARDS.intervene), [{ way: 'check', chat: 'Digger' }])
  assert.deepEqual(ways({ ...CARDS.intervene, isMain: true }), [{ way: 'app' }])
  assert.deepEqual(ways(CARDS.intervene, false), [{ way: 'app' }])
  assert.deepEqual(ways({ id: 'chat:Digger:1', kind: 'input', from: 'Digger', canAnswer: false }), [{ way: 'app' }])
})

test('the cards draw their ways: the hint\'s buttons, Check now, and the nudge goes to the chat as the person\'s line', () => {
  assert.match(script, /if \(need\.kind === 'unfiled' \|\| need\.kind === 'idle'\) return \[\.\.\.parts, \.\.\.wayButtons\(need\)\]/)
  assert.match(script, /const check = String\(need\.id\)\.startsWith\('quiet:'\) \? wayButtons\(need\) : \[\]/)
  assert.match(script, /await send\(\{ to: way\.to, text: way\.text \}, `nudge:\$\{id\}`\)/)
  assert.match(script, /send\(\{ to: board\.workers\.main, command: 'sync', chat: check\.dataset\.cardSync \}, `sync:\$\{check\.dataset\.cardSync\}`\)/)
  // Once it went, the button says when, and is not pressed twice.
  assert.match(script, /at === null \? way\.label : `Asked at \$\{clock\(at\)\}`/)
})

test('a hint\'s window shows the card\'s own words and buttons, not the main chat\'s empty "It waits for you"', () => {
  assert.match(script, /if \(waiting\?\.isHint === true\) left\.append\(section\('What the board found', \[\.\.\.words, \.\.\.wayButtons\(need, true\)\]\)\)/)
  assert.match(script, /if \(material === '' && form\.length === 0 && !waiting\.isHint\) main\.push/)
  // In its own window a worker's hint leads nowhere else: only the main chat's and the Advisor's talk.
  assert.match(script, /if \(way\.way === 'talk' && !\(inWindow && way\.to === need\.id\)\)/)
  vm.runInNewContext(`const MIN = 60000\n${cut('times')}\n${cut('waiting')}\nObject.assign(this, { waitingOf })`, page)
  const hint = page.waitingOf({ ...CARDS.unfiled, text: 'Its last answer ends with a "For you" block.', answer: null, task: null, waits: { at: 1, words: '', questions: [], plan: null, handover: null }, isMain: true }, 2)
  assert.deepEqual([hint.isHint, hint.where, hint.summary], [true, 'hint', ''])
})

test('the Focus run\'s cards that wait for the person open their question', () => {
  const rebuild = page.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'rebuild', ask: 'Q9' } })
  assert.deepEqual(JSON.parse(JSON.stringify(rebuild.needs)), { label: 'Answer Q9', ask: 'Q9' })
  assert.equal(page.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'asking', ask: 'Q7' } }).needs.ask, 'Q7')
  assert.equal(page.focusGuardView({ id: 'G2', guard: { attempts: 3, of: 3, state: 'evaluating', ask: null } }).needs, undefined)
  const waits = page.focusRecheckView({ id: 'G2', recheckAsked: null, lastRecheck: { verdict: 'waits for you', at: '1', summary: 'Two points', gap: null } })
  assert.equal(waits.needs.label, 'Open your partner\'s questions')
  assert.match(script, /card\.append\(el\('h3', '', guard\.title\), linkedEl\('p', '', guard\.text\), \.\.\.focusNeedsButton\(guard\)\)/)
  assert.match(script, /return ask === undefined \? openWaiting\(null\) : openDetails\(\{ need: ask\.id \}\)/)
})
