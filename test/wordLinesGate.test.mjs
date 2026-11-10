// Reactive board, brief P4b, the gate (plan of 2026-11-09, P4: "a test lists the page's word commands and fails on any without a line"):
// every command the page can send (each `command: '...'` of public/board.js, to /api/say, /api/goals, /api/brainstorm and the other
// one-click routes) either has a line, meaning the server tracks the word (src/waitLine.mjs `isPersonWord`, a place by
// `placeOfWord`) AND a card draws that place's line, or sits in the explicit allow-list below with its why. A new command added to the
// page without either fails here, naming the command.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { isPersonWord, placeOfWord } from '../src/waitLine.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = await readFile(join(ROOT, 'public', 'board.js'), 'utf8')

/** The page's command, by the word it queues in the outbox: these have a line (checked below). */
const WORDS = {
  focus: 'focus', 'vibe-agree': 'vibe-agreed', 'vibe-not-yet': 'vibe-not-yet', 'how-not-yet': 'how-not-yet', 'how-go': 'how-go',
  'vibe-there-yes': 'vibe-there-yes', 'vibe-there-no': 'vibe-there-no', talk: 'talk', 'done-when': 'done-when', 'goal-demo': 'goal-demo', 'note-undo': 'undo',
  state: 'goal-recheck', recheck: 'recheck', refine: 'refine', stop: 'stop', remove: 'remove', ask: 'goal-ask',
  brainstorm: 'brainstorm', 'brainstorm-answer': 'brainstorm-answer', 'brainstorm-wrap': 'brainstorm-wrap', 'brainstorm-understood': 'brainstorm-understood', 'brainstorm-not-quite': 'brainstorm-not-quite',
  answer: 'brainstorm-answer', skip: 'brainstorm-answer', back: 'brainstorm-answer', wrap: 'brainstorm-wrap', understood: 'brainstorm-understood', change: 'brainstorm-change', again: 'brainstorm-answer',
}
/** Commands whose word is no word of the person's, or that no chat answers: no line on purpose (or not yet, said so), each with its why. */
const ALLOW = {
  // Instant, by the board's code: nothing waits for a chat.
  add: 'goal map edit: the board writes goals.md at once', rename: 'goal map edit: written at once', line: 'goal map edit: written at once', note: 'goal map edit: written at once',
  group: 'goal map edit: written at once', link: 'goal map edit: written at once', unlink: 'goal map edit: written at once', move: 'goal map edit: written at once',
  read: 'marks an answer read in the goal map: written at once', 'missing-add': 'goal map edit: written at once', 'missing-dismiss': 'goal map edit: written at once',
  undo: 'the goal map\'s snapshot Undo: the board restores the file at once (the partner\'s Undo is `note-undo`, which has its line)',
  'part-drop': 'the board writes the part as dropped at once', 'part-undrop': 'the board takes the drop back at once',
  discard: 'the board marks the thread discarded at once', close: 'the board closes the thread at once', create: 'the board makes the goals and steps of a proposal at once',
  'click-retry': 'the retry of a not-sent click: the same click, queued again; its word then has its own line',
  'goal-step': 'the board ticks or unticks a step of a goal at once',
  'ask-step': 'the board writes the step choice of an ask at once',
  // Not a word: it asks the board to do something to a chat; the result is the line's own "Send again" or the lane's status.
  'wake-again': 'asks the board to wake a chat once more: its result is the line\'s own Send again',
  start: 'a chat started or restarted by the main chat: the lane\'s own status (the start/wake code is chat 1\'s). The thread\'s `brainstorm` start has its line',
  spawn: 'a new worker made by the main chat: the Workers lane\'s own status', 'dismiss copied': 'the board drops a copied-word note at once',
  'partner-effort': 'the effort switch: its own line (chat 1\'s code)', rethink: 'the Stop-and-rethink card has its own status card',
  // Words that wait for a chat and are NOT tracked by the wait line yet: named here so the gap stays visible (not on purpose).
  sync: 'NOT YET: "Out of sync?" has its own answer line (B438), not the wait line',
  recommend: 'NOT YET: the way card\'s answer has its own line',
  'plan-start': 'NOT YET: the Vision page\'s plan words have their own "preparing" panel (a later step)',
  'plan-settled': 'NOT YET: Vision plan word', 'plan-standards-confirm': 'NOT YET: Vision plan word', 'plan-standards': 'NOT YET: Vision plan word', 'plan-measure': 'NOT YET: Vision plan word',
  'plan-standards-change': 'NOT YET: Vision plan word', 'plan-standards-agree': 'NOT YET: Vision plan word', 'plan-confirm': 'NOT YET: Vision plan word', 'plan-deeper': 'NOT YET: Vision plan word',
  'plan-marks': 'NOT YET: Vision plan word', 'plan-goals-confirm': 'NOT YET: Vision plan word', 'plan-focus': 'NOT YET: Vision plan word', 'plan-change': 'NOT YET: Vision plan word',
  'plan-tradeoffs': 'NOT YET: Vision plan word', 'plan-tradeoff': 'NOT YET: Vision plan word', 'plan-check': 'NOT YET: Vision plan word', 'plan-strategy': 'NOT YET: Vision plan word',
  'plan-not-now': 'NOT YET: Vision plan word', 'plan-goals-agree': 'NOT YET: Vision plan word', 'plan-ask': 'NOT YET: Vision plan word',
  'plan-feature-add': 'NOT YET: Vision plan word', 'plan-goals-change': 'NOT YET: Vision plan word',
}

/** Where the page draws the line of a place (a test of the page's own source: the card that draws it names it). */
const DRAWN = {
  refine: /placeWaitOf\(state, 'refine'/,
  go: /placeWaitOf\(state\.waitPart, 'go'/,
  'goal-ask': /placeWaitOf\(board, 'goal-ask'/,
  worker: /placeWaitIds\(state, 'worker'/,
  talk: /function threadWaitView[\s\S]*function focusTalkLine|placeWaitOf\(state, 'talk', \{ command: 'recheck' \}\)/,
  change: /function threadWaitView[\s\S]*placeWaitOf\(state\.waitPart, 'change'/,
}

/** The commands of a page text: every `command: '...'`, and the two the Not yet button picks between by a condition. */
const commandsOf = text => new Set([...text.matchAll(/command: '([a-z][a-z -]*)'/g)].map(one => one[1]).concat(/'vibe-not-yet' : 'how-not-yet'/.test(text) ? ['vibe-not-yet', 'how-not-yet'] : [], /'brainstorm-understood' : 'brainstorm-not-quite'/.test(text) ? ['brainstorm-understood', 'brainstorm-not-quite'] : []))

/** What is wrong with a page text: each command with no line and not in the allow-list, and each tracked command no card draws. */
function problemsOf(text) {
  const problems = []
  const lineCommands = (/const FOCUS_LINE_COMMANDS = \{([^}]*)\}/.exec(text)?.[1] ?? '')
  for (const command of [...commandsOf(text)].sort()) {
    if (Object.hasOwn(WORDS, command)) {
      const word = WORDS[command]
      const sample = { id: 'w', to: 'Advisor', command: word, about: 'G6', at: 1, state: 'waiting' }
      if (!isPersonWord(sample)) { problems.push(`${command}: its word "${word}" is not tracked by the wait line (src/waitLine.mjs isPersonWord)`); continue }
      const place = placeOfWord(sample)
      if (place === null) { problems.push(`${command}: its word "${word}" has no place`); continue }
      if (place === 'focus' ? !lineCommands.includes(`'${word}'`) : !(DRAWN[place] ?? /^$/).test(text) && !['answer', 'recap', 'obsolete', 'sweep', 'overturn'].includes(place)) problems.push(`${command}: no card draws the line of its word "${word}" (place ${place})`)
    } else if (!Object.hasOwn(ALLOW, command)) problems.push(`${command}: no line (not tracked, not drawn) and not in the allow-list`)
  }
  return problems
}

test('every command the page can send has a line, or sits in the allow-list with its why', () => {
  assert.deepEqual(problemsOf(script), [])
  for (const [command, why] of Object.entries(ALLOW)) assert.match(why, /\S+ \S+ \S+/, `${command}: the allow-list names why`)
  // A command in the allow-list is not also a tracked word (one place for each).
  assert.deepEqual(Object.keys(ALLOW).filter(command => Object.hasOwn(WORDS, command)), [])
})

test('the gate bites: a new command added to the page without a line, or a tracked one no card draws, fails and names itself', () => {
  assert.deepEqual(problemsOf(`${script}\nawait sendFocus({ command: 'brand-new-word', id: focus.id }, '')`), ['brand-new-word: no line (not tracked, not drawn) and not in the allow-list'])
  assert.deepEqual(problemsOf(`${script}\nsend({ to: main, command: 'new-thing' }, 'x')`), ['new-thing: no line (not tracked, not drawn) and not in the allow-list'])
  const undrawn = script.replace(/const FOCUS_LINE_COMMANDS = \{[^}]*\}/, one => one.replaceAll("'done-when'", "'gone'"))
  assert.notEqual(undrawn, script)
  assert.ok(problemsOf(undrawn).some(one => /^done-when: no card draws the line/.test(one)), problemsOf(undrawn).join(' | '))
  // The Focus commands stay listed: a word dropped from the server's tracking fails the real page.
  for (const command of ['focus', 'done-when', 'goal-demo', 'vibe-agree', 'vibe-there-yes', 'vibe-there-no', 'note-undo', 'state']) assert.ok(commandsOf(script).has(command), command)
})
