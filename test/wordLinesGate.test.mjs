// Reactive board, brief P4b, the gate (plan of 2026-11-09, P4: "a test lists the page's word commands and fails on any without a line").
// Round 2 (the review of 2026-11-10): the gate reads the page's one-click routes too (`clickCall('/api/…', { command|action: … })`), the
// words without a command (`send({ to, text })`), and derives the word each page command queues from the SERVER's own source (src/clicks.mjs
// `brainstormClickOf` called for real, src/focus.mjs read function by function, src/say.mjs's FOCUS_COMMANDS), never by a hand-written map.
// Reactive board, brief P4c: the NOT YET list is empty: the Vision plan-* words, "No, because…" (recommend), the free messages and the nudge all have a line.
// Every command either has a line (the server tracks the word, `isPersonWord`, a place by `placeOfWord`, and a card draws that place) or sits
// in an explicit allow-list with its why. A new command or word added to the page without either fails here, naming it.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { brainstormClickOf } from '../src/clicks.mjs'
import { FOCUS_MOVES } from '../src/focus.mjs'
import { PLAN_MOVES } from '../src/planMoves.mjs'
import { FOCUS_COMMANDS } from '../src/say.mjs'
import { FREE_KINDS, isPersonWord, placeOfWord } from '../src/waitLine.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [script, focusSrc, serverSrc, saySrc] = await Promise.all(['public/board.js', 'src/focus.mjs', 'server.mjs', 'src/say.mjs'].map(file => readFile(join(ROOT, file), 'utf8')))

// ---------------------------------------------------------------------------------------------------------------------
// What the server queues for a page command, read from the server

/** The words a function of src/focus.mjs types: `focusWords('x'`, `say('x'`, `say(command` (the move's own word), and the functions it calls. */
function wordsOfFn(name, move, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const start = focusSrc.search(new RegExp(`(?:async )?function ${name}\\(`))
  if (start === -1) return []
  const body = focusSrc.slice(start, focusSrc.indexOf('\n}\n', start))
  const words = [...body.matchAll(/(?:focusWords|say)\('([a-z-]+)'/g)].map(one => one[1])
  if (/say\(command\b/.test(body)) words.push(move)
  for (const call of body.matchAll(/\b(askRecheck|agree|vibeThere|askDoneWhen|askDemo|talkBar|pick|goalDone)\(/g)) words.push(...wordsOfFn(call[1], move, seen))
  return words
}
const MOVE_FUNCTION = { focus: 'pick', talk: 'talkBar', 'done-when': 'askDoneWhen', 'goal-demo': 'askDemo', 'goal-done': 'goalDone', 'vibe-there-yes': 'askRecheck' }
/** The words one move of the Focus page queues (`focusMove`), from src/focus.mjs: its own function, or its branch in `move()`. */
function wordsOfMove(move) {
  if (MOVE_FUNCTION[move] !== undefined) return [...new Set(wordsOfFn(MOVE_FUNCTION[move], move))]
  // vibe-there-no: the move's word is its own command (`vibeThere` types it by `say(command…`, the Yes asks the re-check).
  if (move === 'vibe-there-no') return FOCUS_COMMANDS.includes('vibe-there-no') && /command === 'vibe-there-yes' \|\| command === 'vibe-there-no'/.test(focusSrc) ? ['vibe-there-no'] : []
  const marker = move === 'how-go' ? '// how-go' : `command === '${move}'`
  const at = focusSrc.indexOf(marker)
  if (at === -1) return []
  const branch = focusSrc.slice(at, at + 700)
  // The Not yet moves type their own command (`say(command, words)`).
  if (/say\(command/.test(branch.slice(0, 500))) return [move]
  return [...branch.matchAll(/(?:focusWords|say)\('([a-z-]+)'/g)].map(one => one[1]).slice(0, 1)
}
/** The words of a brainstorm click: `brainstormClickOf` called for real. */
function wordsOfBrainstorm(body) {
  const click = brainstormClickOf({ path: 'p.md', n: 1, ...body })
  return click === null ? [] : [click.word({ path: 'p.md' }, 'Advisor').command]
}
/** The page's one-click and focus commands → the words the server queues for them. */
const SERVER_WORDS = {
  answer: wordsOfBrainstorm({ command: 'answer' }), skip: wordsOfBrainstorm({ command: 'skip' }), back: wordsOfBrainstorm({ command: 'back' }), wrap: wordsOfBrainstorm({ command: 'wrap' }),
  understood: [...wordsOfBrainstorm({ command: 'understood', yes: true }), ...wordsOfBrainstorm({ command: 'understood', yes: false })],
  start: [...wordsOfBrainstorm({ command: 'start' }), ...wordsOfBrainstorm({ command: 'start', kind: 'change' })], change: wordsOfBrainstorm({ command: 'change' }),
  again: ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-understood', 'brainstorm-not-quite'].flatMap(command => wordsOfBrainstorm({ command: 'again', word: { command } })),
  'vibe-agree': wordsOfMove('vibe-agree'), 'vibe-not-yet': wordsOfMove('vibe-not-yet'), 'how-not-yet': wordsOfMove('how-not-yet'), 'how-go': wordsOfMove('how-go'),
  'vibe-there-yes': wordsOfMove('vibe-there-yes'), 'vibe-there-no': wordsOfMove('vibe-there-no'), talk: wordsOfMove('talk'), 'done-when': wordsOfMove('done-when'),
  'goal-demo': wordsOfMove('goal-demo'), focus: wordsOfMove('focus'), state: wordsOfMove('goal-done'),
  'note-undo': FOCUS_COMMANDS.filter(word => word === 'undo'),
}
// Words whose command is the word itself: the page's name must be in the server's own source (a rename there fails here).
const named = (pattern, word) => (pattern.test(`${serverSrc}\n${saySrc}`) ? [word] : [])
for (const command of PLAN_MOVES) SERVER_WORDS[command] = [command]
SERVER_WORDS.recommend = named(/command: 'recommend'/, 'recommend')
SERVER_WORDS.refine = named(/command: 'refine'/, 'refine')
SERVER_WORDS['refine-send'] = SERVER_WORDS.refine
SERVER_WORDS.stop = named(/'stop'/, 'stop')
SERVER_WORDS.remove = named(/'remove'/, 'remove')
SERVER_WORDS.recheck = named(/command: 'recheck'/, 'recheck')
SERVER_WORDS.ask = named(/command: 'goal-ask'/, 'goal-ask')
// The brainstorm words a page body names (`word: { command: 'brainstorm-wrap' }`, the "type it again" bodies) are the ones `brainstormClickOf` types again.
for (const word of ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-understood', 'brainstorm-not-quite']) SERVER_WORDS[word] = SERVER_WORDS.again.includes(word) ? [word] : []

/** Commands with no word to a chat, or none tracked: no line on purpose, each with its why (P4c: no "NOT YET" entry is left). */
const ALLOW = {
  // Instant, by the board's code: nothing waits for a chat.
  add: 'goal map edit: the board writes goals.md at once', rename: 'goal map edit: written at once', line: 'goal map edit: written at once', note: 'goal map edit: written at once',
  group: 'goal map edit: written at once', link: 'goal map edit: written at once', unlink: 'goal map edit: written at once', move: 'goal map edit: written at once',
  read: 'marks an answer read in the goal map: written at once', 'missing-add': 'goal map edit: written at once', 'missing-dismiss': 'goal map edit: written at once',
  undo: 'the goal map\'s snapshot Undo: the board restores the file at once (the partner\'s Undo is `note-undo`, which has its line)',
  'part-drop': 'the board writes the part as dropped at once', 'part-undrop': 'the board takes the drop back at once',
  discard: 'the board marks the thread discarded at once', close: 'the board closes the thread at once', create: 'the board makes the goals and steps of a proposal at once',
  'click-retry': 'the retry of a not-sent click: the same click, queued again; its word then has its own line',
  'goal-step': 'the board makes the proposal\'s step itself (B754): no chat is asked',
  'ask-step': 'the board writes the step choice of an ask at once',
  'send:sync': 'the board\'s own check, answered at once (with a Supervisor it runs the rules itself); no word waits for a chat',
  // Not a word: it asks the board to do something to a chat; the result is the line's own "Send again" or the lane's status.
  'wake-again': 'asks the board to wake a chat once more: its result is the line\'s own Send again',
  'send:start': 'a chat started by the main chat: the lane\'s own status (the start/wake code is chat 1\'s)', 'send:restart': 'the restart banner\'s own status (chat 1\'s code)',
  'send:spawn': 'a new worker made by the main chat: the Workers lane\'s own status', 'dismiss copied': 'the board drops a copied-word note at once',
  'partner-effort': 'the effort switch: its own line (chat 1\'s code)', rethink: 'the Stop-and-rethink card has its own status card',
}
/**
 * The words typed with no command at all (`send({ to, text }, <label>, <via>)`), by the label of their click: each keeps its kind on the word (the
 * server's FREE_OF_VIA maps the click's `via` to a kind of src/waitLine.mjs FREE_KINDS), so it has a place ('free') and a line where its button was.
 */
const NO_COMMAND_LABELS = { null: 'talk-send', "'main-talk'": 'main-talk-send', '`nudge:${id}`': 'nudge', key: 'ask-pictures' }
const NO_COMMAND = Object.fromEntries(Object.values(NO_COMMAND_LABELS).map(via => [via, 'has its line (P4c)']))

/** The kind of free word each page click keeps on its word, from the server's own table (server.mjs `FREE_OF_VIA`). */
const FREE_OF_VIA = Object.fromEntries([...(/const FREE_OF_VIA = \{([^}]*)\}/.exec(serverSrc)?.[1] ?? '').matchAll(/'?([a-z-]+)'?: '([a-z-]+)'/g)].map(one => [one[1], one[2]]))

/** Where the page draws the line of a place (a test of the page's own source: the card that draws it names it). */
/** A place drawn where every one of its patterns is found (in any order). */
const all = (...patterns) => ({ test: text => patterns.every(one => one.test(text)) })
const DRAWN = {
  refine: /placeWaitOf\(state, 'refine'/,
  go: /placeWaitOf\(state\.waitPart, 'go'/,
  plan: all(/placeWaitIds\(state, 'plan'\)/, /placeWaitOf\(state, 'plan', \{ command: 'plan-start' \}\)/),
  recommend: /placeWaitOf\(state, 'recommend', \{ about: rec\.id \}\)/,
  free: all(/const freeWaitOf = /, /freeLine\(state, 'talk-send'\)/, /freeLine\(state, 'main-send'\)/, /freeWaitOf\(board, 'nudge'/, /freeWaitOf\(state, 'ask-pictures'/),
  'goal-ask': /placeWaitOf\(board, 'goal-ask'/,
  worker: /placeWaitIds\(state, 'worker'/,
  talk: /function threadWaitView[\s\S]*function focusTalkLine|placeWaitOf\(state, 'talk', \{ command: 'recheck' \}\)/,
  change: /function threadWaitView[\s\S]*placeWaitOf\(state\.waitPart, 'change'/,
}

/** The page's command keys: every `command: '…'` and `action: '…'` of a one-click route, and the two the Not yet button picks by a condition. */
function commandsOf(text) {
  const found = new Set()
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/command: '([a-z][a-z -]*)'/g)) {
      const isLane = /(?<![a-zA-Z])send\(\{/.test(line) && !/sendFocus|sendGoals/.test(line)
      found.add(isLane && Object.hasOwn(ALLOW, `send:${match[1]}`) ? `send:${match[1]}` : match[1])
    }
    for (const match of line.matchAll(/clickCall\('[^']+', \{ (?:command|action): '([a-z][a-z -]*)'/g)) found.add(match[1])
    if (/'vibe-not-yet' : 'how-not-yet'/.test(line)) found.add('vibe-not-yet').add('how-not-yet')
    if (/'plan-feature-add' : 'plan-goals-change'/.test(line)) found.add('plan-feature-add').add('plan-goals-change')
    if (/'brainstorm-understood' : 'brainstorm-not-quite'/.test(line)) found.add('brainstorm-understood').add('brainstorm-not-quite')
  }
  // The restart banner's own command is a variable (`command: button.dataset.restart`): named by its click.
  if (/send\(\{ to: board\.restart\.main, command: button\.dataset\.restart \}/.test(text)) found.add('send:restart')
  return found
}
/** The labels of the words typed with no command and no ask: `send({ to: …, text … }, <label>)`. */
function noCommandLabelsOf(text, vias = new Map()) {
  const labels = []
  for (const start of text.matchAll(/\bsend\(\{ to: /g)) {
    // The object is read by its braces, so a spread such as `...(picture === null ? {} : { picture })` does not end it early.
    let depth = 1
    let at = start.index + start[0].length
    const bodyFrom = at
    while (at < text.length && depth > 0) {
      if (text[at] === '{') depth += 1
      else if (text[at] === '}') depth -= 1
      at += 1
    }
    const body = text.slice(bodyFrom, at - 1)
    const label = /^, ([^,)]+)(?:, ([^,)]+))?/.exec(text.slice(at))
    if (label !== null && !/\bcommand:|\bask:/.test(body) && /\btext\b/.test(body)) {
      labels.push(label[1].trim())
      vias.set(label[1].trim(), (label[2] ?? '').trim().replace(/^'|'$/g, ''))
    }
  }
  return labels
}

/** What is wrong with a page text: each command with no line and not in the allow-list, and each tracked command no card draws. */
function problemsOf(text) {
  const problems = []
  const lineCommands = (/const FOCUS_LINE_COMMANDS = \{([^}]*)\}/.exec(text)?.[1] ?? '')
  for (const command of [...commandsOf(text)].sort()) {
    if (Object.hasOwn(ALLOW, command)) continue
    const words = SERVER_WORDS[command] ?? []
    if (words.length === 0) { problems.push(`${command}: no line (not tracked, not drawn) and not in the allow-list`); continue }
    for (const word of words) {
      const sample = { id: 'w', to: 'Advisor', command: word, about: 'G6', answer: 'no', at: 1, state: 'waiting' }
      if (!isPersonWord(sample)) { problems.push(`${command}: its word "${word}" is not tracked by the wait line (src/waitLine.mjs isPersonWord)`); continue }
      const place = placeOfWord(sample)
      if (place === null) { problems.push(`${command}: its word "${word}" has no place`); continue }
      if (place === 'focus' ? !lineCommands.includes(`'${word}'`) : !(DRAWN[place] ?? /^$/).test(text) && !['answer', 'recap', 'obsolete', 'sweep', 'overturn'].includes(place)) problems.push(`${command}: no card draws the line of its word "${word}" (place ${place})`)
    }
  }
  const vias = new Map()
  for (const label of noCommandLabelsOf(text, vias)) {
    const known = NO_COMMAND_LABELS[label]
    if (known === undefined || !Object.hasOwn(NO_COMMAND, known)) { problems.push(`send(… ${label}): a word with no command has no line and is not in the no-command list`); continue }
    // The click's `via` is the kind the server keeps on the word; its place is 'free', drawn where the button was.
    const kind = FREE_OF_VIA[vias.get(label)]
    if (vias.get(label) !== known || kind === undefined) { problems.push(`send(… ${label}): its click has no kind of free word (the server's FREE_OF_VIA)`); continue }
    const sample = { id: 'w', to: 'Advisor', free: kind, at: 1, state: 'waiting' }
    if (!isPersonWord(sample) || placeOfWord(sample) !== 'free') problems.push(`send(… ${label}): its free word "${kind}" is not tracked by the wait line`)
    else if (!DRAWN.free.test(text)) problems.push(`send(… ${label}): no card draws the line of its free word "${kind}"`)
  }
  return problems
}

test('every command and word the page can send has a line, or sits in the allow-list with its why', () => {
  assert.deepEqual(problemsOf(script), [])
  for (const [command, why] of Object.entries({ ...ALLOW, ...NO_COMMAND })) assert.match(why, /\S+ \S+ \S+/, `${command}: the allow-list names why`)
  // A command in the allow-list is not also a tracked word (one place for each); `start` (the thread's, tracked) is not masked by the lane's.
  assert.deepEqual(Object.keys(ALLOW).filter(command => (SERVER_WORDS[command] ?? []).length > 0), [])
  // P4c: the NOT YET list is empty, and every Vision word the server takes is sent by the page.
  assert.deepEqual(Object.entries({ ...ALLOW, ...NO_COMMAND }).filter(([, why]) => /NOT YET/.test(why)), [])
  for (const command of PLAN_MOVES) assert.ok(commandsOf(script).has(command), `${command}: a Vision word of src/planMoves.mjs the page never sends`)
  assert.deepEqual(Object.values(FREE_OF_VIA).sort(), [...FREE_KINDS].sort(), 'every kind of free word has its click')
  assert.ok(commandsOf(script).has('start') && commandsOf(script).has('send:start'), 'the thread start and the lane start are two keys')
  assert.ok(commandsOf(script).has('refine-send'), 'the one-click action routes are read')
  assert.deepEqual(SERVER_WORDS.start, ['brainstorm', 'brainstorm'], 'the thread start and the change-goal start type the brainstorm word')
})

test('the server\'s own sources give the words: every Focus word of src/say.mjs is tracked, every move of src/focus.mjs names a tracked word', () => {
  for (const word of FOCUS_COMMANDS) assert.equal(isPersonWord({ to: 'Advisor', at: 1, command: word }), true, `${word} (src/say.mjs FOCUS_COMMANDS) is tracked`)
  for (const move of FOCUS_MOVES) assert.notDeepEqual(wordsOfMove(move), [], `${move}: the word it queues is found in src/focus.mjs`)
  assert.deepEqual(wordsOfMove('goal-done'), ['goal-recheck'])
  assert.deepEqual(SERVER_WORDS['vibe-there-yes'], ['goal-recheck'], 'Yes asks the partner for the re-check (src/focus.mjs askRecheck)')
  assert.deepEqual(SERVER_WORDS['vibe-agree'], ['vibe-agreed'])
  assert.deepEqual(SERVER_WORDS.answer, ['brainstorm-answer'])
  assert.deepEqual(SERVER_WORDS.again, ['brainstorm', 'brainstorm-answer', 'brainstorm-wrap', 'brainstorm-understood', 'brainstorm-not-quite'])
})

test('the gate bites: a new command or a new word with no command, added to the page without a line, fails and names itself', () => {
  assert.deepEqual(problemsOf(`${script}\nawait sendFocus({ command: 'brand-new-word', id: focus.id }, '')`), ['brand-new-word: no line (not tracked, not drawn) and not in the allow-list'])
  assert.deepEqual(problemsOf(`${script}\nsend({ to: main, command: 'new-thing' }, 'x')`), ['new-thing: no line (not tracked, not drawn) and not in the allow-list'])
  assert.deepEqual(problemsOf(`${script}\nawait clickCall('/api/backlog', { action: 'new-click', step }, key)`), ['new-click: no line (not tracked, not drawn) and not in the allow-list'])
  // A new send with a spread in its object (the shape of Talk to Main and the Advisor talk Send) is read too.
  assert.deepEqual(problemsOf(`${script}\nawait send({ to: main, text, ...(picture === null ? {} : { picture }) }, 'spread-label', 'x')`), ["send(… 'spread-label'): a word with no command has no line and is not in the no-command list"])
  assert.deepEqual(noCommandLabelsOf(script).sort(), ["'main-talk'", '`nudge:${id}`', 'key', 'null'].sort(), 'the four real ones, the two with spreads among them')
  assert.deepEqual(problemsOf(`${script}\nawait send({ to: main, text: 'hello' }, 'brand-new-label')`), ["send(… 'brand-new-label'): a word with no command has no line and is not in the no-command list"])
  // P4c: a NOT YET entry put back fails; a Vision word nothing draws, or a free word with no kind, fails and names itself.
  assert.deepEqual(problemsOf(`${script}\nawait toPartner({ command: 'plan-brand-new' }, '')`), ['plan-brand-new: no line (not tracked, not drawn) and not in the allow-list'])
  const noKind = script.replace("'main-talk', 'main-talk-send')", "'main-talk', 'unknown-via')")
  assert.notEqual(noKind, script)
  assert.deepEqual(problemsOf(noKind), ["send(… 'main-talk'): its click has no kind of free word (the server's FREE_OF_VIA)"])
  const noPlanLine = script.replace("placeWaitOf(state, 'plan', { command: 'plan-start' })", 'x')
  assert.notEqual(noPlanLine, script)
  assert.ok(problemsOf(noPlanLine).some(one => /no card draws the line of its word "plan-/.test(one)), problemsOf(noPlanLine).join(' | '))
  const undrawn = script.replace(/const FOCUS_LINE_COMMANDS = \{[^}]*\}/, one => one.replaceAll("'done-when'", "'gone'"))
  assert.notEqual(undrawn, script)
  assert.ok(problemsOf(undrawn).some(one => /^done-when: no card draws the line/.test(one)), problemsOf(undrawn).join(' | '))
  // The Focus commands stay listed: a word dropped from the server's tracking fails the real page.
  for (const command of ['focus', 'done-when', 'goal-demo', 'vibe-agree', 'vibe-there-yes', 'vibe-there-no', 'note-undo', 'state']) assert.ok(commandsOf(script).has(command), command)
})
