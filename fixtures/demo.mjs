// Made-up samples of every source, for `node server.mjs --demo` and for the tests: a small team building a game
// that does not exist. Every time is counted back from `now`, so the demo always looks like a morning at work.
// Each sample is text in the shape of the real file and goes through the same readers as the real data.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readFolders } from '../src/folders.mjs'
import { listPictures } from '../src/pictures.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { answer, assistant, fromChat, modCompaction, step, tool, toolResult, typed, usageResult, user } from './lines.mjs'

const MIN = 60_000
const pad = value => String(value).padStart(2, '0')
/** B155: a moment as the backlog's lines write it, this machine's date and clock. */
const dayOf = at => `${new Date(at).getFullYear()}-${pad(new Date(at).getMonth() + 1)}-${pad(new Date(at).getDate())}`
const clockOf2 = at => `${pad(new Date(at).getHours())}:${pad(new Date(at).getMinutes())}`

/** B155: steps finished this morning, one of each kind of time: approved by the person, reported, only the day. */
const FINISHED = now => `
## Done this morning
- [x] B05 Footstep sounds (for Features; about 30 min)
  Approved by you on the worker board on ${dayOf(now - 20 * MIN)} at ${clockOf2(now - 20 * MIN)}.
- [x] B06 Tidy the docs (for Cleanup; about 20 min)
- [x] B07 Fog in the forest (for Levels / Environment)
  (Done on ${dayOf(now)} by Game - Levels / Environment: merged.)
`
// A real folder, so the demo's pictures are served the way the real ones are.
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), 'demo-project')
const REPO = 'C:/Demo/game-builder/game'
// B193: the demo project's picture folder; the demo board shows it in place of the settings' own.
export const ROOTS = ['art-inbox']

const CHATS = [
  { name: 'Main', id: 'demo-main' },
  { name: 'Units', id: 'demo-units', summary: ['blocked', 'two pathfinding approaches compared', 'Choose an approach for enemy pathfinding: option A (NavMesh) or option B (custom grid).'] },
  { name: 'Features', id: 'demo-features' },
  // B148: done, and its card still names its task: the app's summary says nothing, its last answer says it all.
  { name: 'Cleanup', id: 'demo-cleanup' },
  { name: 'Levels / Environment', id: 'demo-levels' },
  { name: 'Advisor', id: 'demo-advisor', summary: ['completed', 'advice written', ''] },
  // B262: its turn ended in a tool's answer, without a closing message, and the app has no summary of it.
  { name: 'Audio', id: 'demo-audio' },
]

const BACKLOG = `# Backlog

## Movement #focus
- [x] Player input
- [ ] Integrate player movement (for Main) (branch feature/player-movement)
- [ ] B03 Verify: the jump feels right (picture in art-inbox/jump) @you
- [ ] B04 Do: quit and reopen the app once @you

## Enemies #focus
- [ ] Enemy pathfinding (for Units) (branch feature/enemy-ai)
- [ ] Add save / load system (for Features) (branch feature/save-load)
- [ ] Build first level (for Levels / Environment) (branch feature/forest)

## Next to hand out (Game - Main)
- [x] Add save / load system (for Features)
- [ ] B11 Animation blending (for Main; branch feature/animation-blending; about 40 min)
  Blend between the walk, run and jump animations, so a change of speed does not snap.
  Requirements:
  - No visible pop when the speed changes
  - Works for the player and for enemies
  - The jump keeps its own timing
  Context: the jump arc is in art-inbox/jump. Keep the blend under a tenth of a second.
  Refined (2026-10-14 18:40; ready):
  Summary: A change of speed flows from walk to run to jump, with no visible snap.
  Picture: art-inbox/jump/jump-arc.png (the jump's arc, which keeps its own timing)
  Part of: G2 M1 · A first playable build
  Size: about 40 min
  What we build:
  - Walk, run and jump blend into each other in under a tenth of a second.
  - The same blend for the player and for enemies.
  - The jump keeps its own timing; only its start and its landing blend.
  - Not in it: blending of attacks; they come with the attack patterns.
- [ ] Review the merge order (for Main; about 15 min)
- [ ] Plan the next milestone (for Main; about 30 min)
- [ ] Enemy abilities (for Units; after the pathfinding choice; about 30 min)
- [ ] Enemy attack patterns (for Units; about 1 h)
- [ ] Main menu (for Features; after save / load merges; about 1 h)
- [ ] B12 Settings screen (for Features; about 45 min)
  Refined (round 2, by Advisor, 2026-10-14 18:52):
  Summary: One screen to turn the music down and change the keys, from the menu and from the pause screen.
  Picture: art-inbox/settings/settings-screen.png (the screen with its tabs; Save keeps what you set)
  Part of: G2 M1 · A first playable build
  Size: about 45 min
  Questions:
  - Can the keys be changed, not only shown? Advised: yes, players asked for it Answer: yes
  - Saved once for the computer, not per player? Advised: yes, one player per computer so far
  - A display tab now, though it has nothing to set yet? Advised: no, it waits for the window sizes
- [ ] Controller support (for Features; about 2 h)
- [ ] Remove unused assets (for Cleanup; about 20 min)
- [ ] Lava biome (for Levels / Environment; about 1 h 30 min)
- [ ] Level streaming (for Levels / Environment; about 2 h)
- [ ] Decide the name of the game (for Writing; about 20 min)

## Advisor suggestions
- [ ] B30 Decide: Make a unit template before the second unit (Advisor) @you
  Why: the archer and the knight are built in two different ways.
  Cost: about 1 h
  Unblocks: every next unit, built the same way.
`

const ASKS = now => [
  {
    id: 'units-pathfinding', from: 'Units', kind: 'input', at: now - 72 * MIN,
    title: 'Choose pathfinding approach',
    text: 'Units has compared two approaches for enemy pathfinding. Which direction should we take?',
    options: [
      { label: 'Option A: NavMesh', picture: 'art-inbox/pathfinding/option-a-navmesh.png', isRecommended: true },
      { label: 'Option B: Custom grid', picture: 'art-inbox/pathfinding/option-b-grid.png' },
    ],
  },
  {
    id: 'main-player-movement', from: 'Main', kind: 'verify', at: now - 28 * MIN,
    title: 'Test player movement',
    text: 'The movement system is implemented and tests are passing. Please verify the behaviour.',
    run: { branch: 'main' },
    checks: ['Movement in all 4 directions', 'Collision with walls and obstacles', 'Smooth animation blending', 'No jitter on slopes'],
  },
  { id: 'old-question', from: 'Features', kind: 'input', title: 'An answered question', state: 'answered' },
]

const ADVICE = `# Advice

1. Decide on Units' pathfinding approach to unblock progress.
2. Main is running tests, likely done soon.
3. Consider starting the next task for Cleanup.

## Why

- **Units** waits for you since this morning; nothing else on enemies can start before the choice.
- Cleanup is free, and \`Clean up temporary files\` is queued for it.
`

const FOLDERS = [
  { name: 'game', branch: 'main', ahead: 0, changed: 0, minutesAgo: 12 },
  { name: 'game-units', branch: 'feature/enemy-ai', ahead: 5, changed: 2, minutesAgo: 43 },
  { name: 'game-features', branch: 'feature/save-load', ahead: 3, changed: 7, minutesAgo: 60 },
  { name: 'game-cleanup', branch: 'chore/tidy-docs', ahead: 0, changed: 0, minutesAgo: 120 },
  { name: 'game-levels', branch: 'feature/forest', ahead: 4, changed: 1, minutesAgo: 28 },
]

function gitAnswers(now) {
  const answers = {}
  const blocks = []
  for (const folder of FOLDERS) {
    const path = folder.name === 'game' ? REPO : `${REPO}-${folder.name.slice('game-'.length)}`
    blocks.push(`worktree ${path}\nHEAD ${'0'.repeat(40)}\nbranch refs/heads/${folder.branch}\n`)
    answers[`-C ${path} status --porcelain`] = ' M src/file.ts\n'.repeat(folder.changed)
    answers[`-C ${path} log -1 --format=%ct %h %s`] = `${Math.round((now - folder.minutesAgo * MIN) / 1000)} 4f2a91c Merge player movement\n`
    answers[`-C ${REPO} rev-list --count main..${folder.branch}`] = `${folder.ahead}\n`
  }
  answers[`-C ${REPO} worktree list --porcelain`] = blocks.join('\n')
  return answers
}

function appChat({ name, id, summary }, index, now) {
  return JSON.stringify({
    title: `Game - ${name}`,
    sessionId: `local_${id}`,
    cliSessionId: id,
    cwd: PROJECT,
    isArchived: false,
    createdAt: now - (500 - index) * MIN,
    lastActivityAt: now - MIN,
    completedTurns: 40 + index,
    lastAssistantUuid: 'a-1',
    ...(summary === undefined ? {} : { postTurnSummary: { status_category: summary[0], status_detail: summary[1], needs_action: summary[2], summarizes_uuid: 'a-1' } }),
  })
}

const plan = (now, task, minutesAgo) =>
  JSON.stringify({ name: 'demo', role: 'worker', state: 'working', task, at: now - minutesAgo * MIN })

/** B113: when the demo's 5-hour limit resets, to the minute, and that moment as this machine's clock shows it. */
const resetOf = now => Math.round((now + 52 * MIN) / MIN) * MIN
const clockOf = at => `${String(new Date(at).getHours()).padStart(2, '0')}:${String(new Date(at).getMinutes()).padStart(2, '0')}`
// What the board typed into a chat for the person (the Workers mod types it as their own words).
const viaBoard = (at, text) => user(at, text, { origin: { kind: 'plugin', name: 'folder-branches', asUser: true } })

function transcripts(now) {
  const ago = minutes => now - minutes * MIN
  const tail = (lines, quietMinutes) => ({ text: lines.join('\n'), isCut: false, modifiedAt: ago(quietMinutes) })
  return {
    'demo-main': tail([
      // B155: the report that tells when B06 was finished.
      fromChat(ago(100), 'Game - Cleanup', 'Report from Game - Cleanup: B06, the docs are tidy.'),
      // The main chat looked the limits up an hour ago: that is where the board has the reset times from.
      usageResult(ago(60), { fiveHour: { used: 61, resetsAt: resetOf(now) }, week: { used: 62, resetsAt: Math.round((now + 70 * 60 * MIN) / (60 * MIN)) * 60 * MIN } }),
      typed(ago(12), "Let's focus on player movement today. Please run the tests once it's integrated."),
      step(ago(12), 'Read the movement code'),
      toolResult(ago(11.5)),
      answer(ago(11), "Got it. I've integrated the movement code and am now running the tests."),
      fromChat(ago(8), 'Game - Units', 'Report: investigating pathfinding options.\n\nTwo approaches look workable: a NavMesh, or a custom grid. I asked in my chat which one to take.'),
      answer(ago(7.5), 'Noted. Units waits for your choice between the two pathfinding approaches.'),
      fromChat(ago(4), 'Game - Features', 'Save system is implemented. Running local tests.'),
      // B161: an answer in every chat's form, with what is the person's and the closing block.
      answer(ago(3.5), 'Features has the save system in and is testing it.\n\n> **For you**\n> 1. **Answer:** Shall Features start the main menu after the save system? I advise yes.\n\n---\n\n```diff\n  Prompt: how far is the save system\n  Who:    Game - Main\n+ Done:   yes\n```'),
      // B167: a picture pasted in Talk to Main, named to the main chat by its full path.
      viaBoard(ago(2), `The Continue button is cut off on the menu, see the picture.\nPicture: ${join(PROJECT, 'art-inbox', 'talk', '2026-10-14-1144.png')}\n(typed on the worker board, ${clockOf(ago(2))})`),
      answer(ago(1.5), 'I see it: the border of Continue is cut on the right. Handed to Game - Features as a small fix.'),
      typed(ago(0.5), 'Great! Next we can look at animation blending.'),
      step(ago(0.3), 'Run the tests'),
    ], 0.3),
    'demo-units': tail([
      fromChat(ago(150), 'Game - Main', 'Task from Game - Main: choose the enemy approach. Time box: about an hour.'),
      step(ago(149), 'Read the enemy code'),
      toolResult(ago(148)),
      // B299: it asks with the app's own question form: answered in its chat only.
      assistant(ago(103), 'tool_use', [tool('AskUserQuestion', { questions: [{ question: 'Two approaches are worked out. Which one do you want?', options: [{ label: 'NavMesh' }, { label: 'Custom grid' }] }] })]),
    ], 103),
    'demo-features': tail([
      fromChat(ago(55), 'Game - Main', 'Task from Game - Main: add a save / load system.'),
      step(ago(54), 'Read the game state'),
      toolResult(ago(53)),
      step(ago(12), 'Implement code', 'Edit'),
      toolResult(ago(11)),
      // It stopped at a safe point for the limit, and said so in the fixed first line the board reads.
      assistant(ago(9), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: `Note from Game - Features: paused for the limit until ${clockOf(resetOf(now))}.` })]),
      toolResult(ago(9)),
      answer(ago(8), 'The work is committed. I go on after the reset.'),
    ], 8),
    'demo-cleanup': tail([
      fromChat(ago(130), 'Game - Main', 'Task from Game - Main: tidy the docs.'),
      step(ago(129), 'List the docs'),
      toolResult(ago(128)),
      assistant(ago(106), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'The docs are tidy.' })]),
      toolResult(ago(106)),
      answer(ago(105), 'The docs are tidy and the report is with Game - Main.\n\n---\n\n```diff\n  Prompt: tidy the docs\n  Who:    Game - Cleanup\n+ Done:   yes\n```'),
      // B247: the Workers mod compacted it after its report; it stays free.
      ...modCompaction(ago(100)),
    ], 100),
    'demo-levels': tail([
      fromChat(ago(40), 'Game - Main', 'Task from Game - Main: build the first level, a forest.'),
      step(ago(39), 'Look at the reference picture'),
      toolResult(ago(38)),
      step(ago(2), 'Create terrain meshes'),
    ], 2),
    'demo-advisor': tail([
      typed(ago(46), 'What should happen next?'),
      step(ago(45), 'Read the backlog'),
      toolResult(ago(45)),
      answer(ago(44), 'Decide on the pathfinding approach first: **Units** waits for it, and nothing else on enemies can start. After that, hand Cleanup its queued task: it is free.'),
      typed(ago(20), 'Can Features start the main menu while the save system is still in review?'),
      // B301: its answer asks the person something but it filed no ask: a warning under Needs your attention leads to its chat.
      answer(ago(19), [
        'Yes, if it does not touch the save files: the main menu only reads whether a save exists.',
        '',
        '> **For you**',
        '> 1. **Answer:** Let Features start the main menu now, before the save system is merged? I advise yes: the menu only reads whether a save exists, so nothing waits on the review.',
        '',
        '---',
        '',
        '```diff',
        '  Prompt: can the main menu start while the save system is in review',
        '  Who:    Game - Advisor',
        '- Done:   partly, waiting for your answer',
        '```',
      ].join('\n')),
    ], 19),
    'demo-audio': tail([
      fromChat(ago(70), 'Game - Main', 'Task from Game - Main: add the menu sounds.'),
      step(ago(69), 'List the sound files'),
      toolResult(ago(68)),
      // B262: it reported with a tool and wrote no closing message. Nothing came after for longer than the quiet
      // limit: its turn has ended, and the task with it.
      assistant(ago(26), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'Report from Game - Audio: the menu sounds are in.' })]),
      toolResult(ago(26)),
    ], 26),
  }
}

function history(now) {
  const line = (minutesAgo, chat, state, task = null, extra = {}) => ({
    at: now - minutesAgo * MIN, chat, state, task, step: null, steps: null, leftMs: null, startedAt: null,
    source: task === null ? null : 'plan', ...extra,
  })
  const movement = 'Integrate player movement'
  const lines = [
    line(262, 'Main', 'working', 'Plan the day'),
    line(205, 'Main', 'free'),
    line(196, 'Main', 'working', 'Review the merges'),
    line(158, 'Main', 'free'),
    line(150, 'Main', 'working', 'Hand out the morning tasks'),
    line(112, 'Main', 'free'),
    line(110, 'Main', 'working', movement, { step: 1, steps: 5, leftMs: 90 * MIN }),
    line(80, 'Main', 'working', movement, { step: 2, steps: 5, leftMs: 70 * MIN }),
    line(50, 'Main', 'working', movement, { step: 3, steps: 5, leftMs: 45 * MIN }),
    line(13, 'Main', 'free', movement, { step: 3, steps: 5, leftMs: 45 * MIN }),
    line(12, 'Main', 'working', movement, { step: 4, steps: 5, leftMs: 15 * MIN }),

    line(262, 'Units', 'free'),
    line(225, 'Units', 'working', 'Enemy sketches'),
    line(180, 'Units', 'waiting', 'Enemy sketches'),
    line(152, 'Units', 'free'),
    line(150, 'Units', 'working', 'Choose enemy approach', { step: 1, steps: 4, leftMs: 60 * MIN }),
    line(124, 'Units', 'waiting', 'Choose enemy approach', { step: 1, steps: 4, leftMs: 50 * MIN }),
    line(118, 'Units', 'working', 'Choose enemy approach', { step: 2, steps: 4, leftMs: 45 * MIN }),
    line(103, 'Units', 'waiting', 'Choose enemy approach', { step: 2, steps: 4, leftMs: 30 * MIN }),

    line(262, 'Features', 'working', 'Inventory screen'),
    line(98, 'Features', 'free'),
    line(92, 'Features', 'working', 'Inventory screen'),
    line(57, 'Features', 'free'),
    line(55, 'Features', 'working', 'Add save / load system', { step: 1, steps: 5, leftMs: 80 * MIN }),
    line(30, 'Features', 'working', 'Add save / load system', { step: 2, steps: 5, leftMs: 60 * MIN }),
    line(14, 'Features', 'working', 'Add save / load system', { step: 3, steps: 5, leftMs: 35 * MIN }),
    line(8, 'Features', 'suspended', 'Add save / load system', { step: 3, steps: 5, leftMs: 35 * MIN }),

    line(262, 'Cleanup', 'free'),
    line(255, 'Cleanup', 'working', 'Remove old assets'),
    line(205, 'Cleanup', 'free'),
    line(130, 'Cleanup', 'working', 'Tidy the docs'),
    line(105, 'Cleanup', 'free'),

    line(262, 'Levels / Environment', 'working', 'Level tools'),
    line(200, 'Levels / Environment', 'free'),
    line(192, 'Levels / Environment', 'working', 'Level tools'),
    line(112, 'Levels / Environment', 'working', 'Lighting pass'),
    line(86, 'Levels / Environment', 'free'),
    line(40, 'Levels / Environment', 'working', 'Build first level (forest)', { step: 1, steps: 6, leftMs: 150 * MIN }),
    line(22, 'Levels / Environment', 'working', 'Build first level (forest)', { step: 2, steps: 6, leftMs: 120 * MIN }),

    // B262: its turn ended 26 minutes ago without a closing message; the board saw it once the quiet limit passed.
    line(262, 'Audio', 'free'),
    line(70, 'Audio', 'working'),
    line(16, 'Audio', 'free'),
  ]
  return lines.sort((a, b) => a.at - b.at)
}

/** B255: the demo's goal map, in the form of goals.md, its steps on the demo's backlog. */
/** B259: the demo's brainstorms: one waiting on a question, one with a proposal to tick, one done the day before. */
const THREADS = now => {
  const day = dayOf(now)
  const before = dayOf(now - 24 * 60 * MIN)
  return [
    { path: `.claude/brainstorms/${day}-how-the-enemies-chase.md`, at: now - 5 * MIN, text: `# Brainstorm: How the enemies chase
Goal: G5 Enemies that chase
Started: ${day} 09:30 · State: running
Opening: The enemies should feel clever, not unfair. How do they find the player?
Context: G5 has no steps yet; its Missing line asks for the enemies' pathfinding. M1 wants moving to feel good first.

## Q1 (09:32)
Which enemies chase first?
Why: it decides which enemy the first step builds.
- A: the wolves, the forest's main enemy (advised)
- B: the bats, which fly over everything
Answer (09:35): A

## Q2 (09:37)
How far does an enemy see you?
Why: it decides how often a chase starts.
- A: five tiles (advised)
- B: the whole screen
Answer (09:40): A — but less in the fog

## Q3 (09:42)
How should a wolf find its way to you?
Why: it decides the pathfinding step and what it costs.
- A: a navigation mesh: smooth paths round the trees (advised)
- B: a grid, tile by tile: simpler, a little stiff
- C: straight at you, no pathfinding: wolves get stuck on trees
Picture: art-inbox/pathfinding/option-a-navmesh.png
` },
    { path: `.claude/brainstorms/${day}-the-forest-level-s-map.md`, at: now - 40 * MIN, text: `# Brainstorm: The forest level's map
Goal: G8 The forest level
Started: ${day} 08:10 · State: running
Opening: I want the forest level to have one moment players remember.

## Q1 (08:12)
What should the moment be?
Why: it decides what the map is built around.
- A: a clearing where the fog lifts (advised)
- B: a chase across a bridge
Answer (08:14): A

## Q2 (08:16)
When does the player reach it?
Why: it decides where the clearing stands on the map.
- A: halfway (advised)
- B: at the very end
Answer (08:19): B — the clearing at dusk, as the reward

## Proposal (08:30)
Decided:
- one clearing at the end is the moment: the fog lifts there at dusk
- the map first, the light after
Goals:
- [ ] The forest map, drawn — under G8 — Done when: a friend walks from the start to the clearing without a guide
- [ ] The clearing at dusk — under G8 — Done when: the fog lifts as you enter it
Steps:
- [ ] Draw the forest level's map — Levels — about 2 h
- [ ] The fog that lifts in the clearing — Main decides — about 1 h
- [ ] A test walk with a friend — Advisor — about 30 min
Note: one moment to remember is enough for the first level; the light makes it, so it comes after the map.
` },
    { path: `.claude/brainstorms/${before}-footsteps-that-sound-right.md`, at: now - 20 * 60 * MIN, text: `# Brainstorm: Footsteps that sound right
Goal: G3 Footsteps and fog
Started: ${before} 16:00 · State: done
Opening: The footsteps sound the same on every ground.

## Q1 (16:02)
Which grounds get their own sound?
Why: it decides how many sounds are made.
- A: grass, stone and wood (advised)
- B: every ground of the game
Answer (16:05): A

## Proposal (16:12)
Decided:
- three grounds, three sounds
Goals:
Steps:
- [ ] Record grass, stone and wood steps — Main decides — about 1 h
- [ ] Play the step sound by the ground — Units — about 30 min
Note: three sounds cover nine of ten steps a player takes.
Created (16:20): no goals; 2 steps asked of the main chat; left out: nothing
` },
  ]
}

const GOALS = now => `# Goals

Rules: a goal is one line "- [ ] G<n> <title>"; two spaces of indentation per level is "part of".

- [~] G1 The forest game
  Done when: a friend plays the first level from start to end
  From the game plan: the goal
  - [~] G2 M1 · Moving feels good
    Done when: running and jumping feel right on the first level
    From the game plan: M1
    Recommendation (R1): Tune the jump before the enemies · the jump is the first thing a player feels · about 1 h · B03
    - [x] G3 Footsteps and fog
      Steps: B05, B07
    - [~] G4 The jump
      Steps: B03, B11
      Missing: a test level with gaps of every width
      Ask (A2, ${dayOf(now)} 08:40): how does our jump compare with the arc in the picture?
      Answer (${dayOf(now)} 09:05, Advisor): It rises as in the picture but falls too slowly: the picture falls twice as fast as it rises. Fix the fall first, about 30 min; the height is right (art-inbox/jump/jump-arc.png).
      More: .claude/goal-asks/${dayOf(now)}-jump-compared.md
    - [ ] G5 Enemies that chase
      Missing: the enemies' pathfinding as a step
      Brainstorm: .claude/brainstorms/${dayOf(now)}-how-the-enemies-chase.md (running)
  - [ ] G6 M2 · A level to finish
    From the game plan: M2
    - [ ] G7 The menus
      Steps: B12
      Ask (A1, ${dayOf(now)} 09:10): which menu does a player open first?
    - [ ] G8 The forest level
      Missing: the level's map
      Brainstorm: .claude/brainstorms/${dayOf(now)}-the-forest-level-s-map.md (running)
  - [ ] G9 M3+ · More levels
    From the game plan: M3+
- [~] G10 The team's tools
  Enables: G1
  Why: less time lost on the work around the game
  - [x] G11 Tidy docs
    Steps: B06
  - [ ] G12 A unit template
    Also part of: G6
    Steps: B30
`

/** B301: the demo's work store, in memory: its backlog as items, B06 closed through the work API at the time of its report. */
function demoWork(now) {
  const work = storeFromText(BACKLOG + FINISHED(now), { now })
  const stamp = at => `${dayOf(at)} ${clockOf2(at)}`
  work.items.get('B06')?.sections.set('History', [`- ${stamp(now - 101 * MIN)} Cleanup: in progress → review`, `- ${stamp(now - 100 * MIN)} server: review → done`])
  return work
}

/** The demo's sources as they stand at `now`, in the shape `readSources` gives for the real files. */
/** When the demo's requests were filed: fixed at the first look, as a real request is filed once. */
let filedFrom = null

export async function demoSources(now) {
  filedFrom ??= now
  const answers = gitAnswers(now)
  return {
    project: PROJECT,
    listText: '{ "prefix": "Game - ", "main": "Main" }',
    appChatTexts: [
      ...CHATS.map((chat, index) => appChat(chat, index, now)),
      appChat({ name: 'Old experiments', id: 'demo-old' }, 9, now).replace('"isArchived":false', '"isArchived":true'),
      JSON.stringify({ title: 'Game - Somewhere else', cliSessionId: 'demo-else', cwd: 'C:\\Demo', isArchived: false }),
    ],
    planLineTexts: {
      'demo-main': plan(now, { text: 'Integrate player movement', step: 4, steps: 5, left: 25 * MIN, isReported: false }, 3),
      // B248: an older Workers mod could not compact Units: the app has to start anew.
      // B299: its card says it asks with the app's question form; the mod renews it while it waits.
      'demo-units': JSON.stringify({ ...JSON.parse(plan(now, { text: 'Choose enemy approach', step: 2, steps: 4, left: 30 * MIN, isReported: false }, 103)), compactNote: { at: now - 110 * MIN, why: 'a-mod: $.session.compact: not available in a headless session yet' }, state: 'asking', at: now - 0.2 * MIN }),
      'demo-features': plan(now, { text: 'Add save / load system', step: 3, steps: 5, left: 114 * MIN, isReported: false }, 9),
      // B235: the Workers mod compacted Cleanup after its report; B247: the size after is not known yet (0).
      'demo-cleanup': JSON.stringify({ ...JSON.parse(plan(now, { text: 'Tidy the docs', step: 2, steps: 2, left: 0, isReported: false }, 105)), compacted: { at: now - 100 * MIN, before: 612000, after: 0 } }),
      // ... and why it did not compact Levels / Environment: nothing wrong.
      'demo-levels': JSON.stringify({ ...JSON.parse(plan(now, { text: 'Build first level (forest)', step: 2, steps: 6, left: 40 * MIN, isReported: false }, 6)), compactNote: { at: now - 30 * MIN, why: 'it is small enough' } }),
    },
    tails: transcripts(now),
    // B301: the demo's work store, made in memory from its backlog (it has no project folder).
    work: demoWork(now),
    goalsText: GOALS(now),
    // B259: the demo's brainstorms, newest first.
    threadTexts: THREADS(now),
    // B113: the app's usage file, three minutes old.
    usageText: `{"version":2,"samples":[{"t":${now - 3 * MIN},"org":"demo","u":{"fh":86,"sd":64}}]}`,
    adviceText: ADVICE,
    folders: await readFolders(REPO, async args => answers[args.join(' ')] ?? null),
    askTexts: ASKS(filedFrom).map(ask => JSON.stringify(ask)),
    pictureLists: { 'art-inbox/jump': await listPictures(PROJECT, ROOTS, 'art-inbox/jump') },
    historyLines: history(now),
  }
}

/** The demo's ideas for the Design tab: one being looked at, one agreed, one that failed. Made-up, as all of it. */
export function demoIdeas(now) {
  const version = (n, minutesAgo, picture, more = {}) => ({ n, at: now - minutesAgo * MIN, change: null, from: null, state: 'done', picture, why: null, seconds: 52, ...more })
  const idea = (id, name, kind, text, minutesAgo, versions, more = {}) => ({
    id, name, kind, text, createdAt: now - minutesAgo * MIN, folder: `art-inbox/ideas/${name}`, references: [], versions, agreed: null, sent: null, droppedAt: null, ...more,
  })
  return [
    idea('i-jump', 'jump-arc', 'screen', 'A jump that follows an arc, with the landing tile lit up before you let go', 40, [
      version(1, 38, 'art-inbox/jump/jump-arc.png'),
      version(2, 12, 'art-inbox/jump/jump-arc.png', { change: 'Make the landing tile brighter', from: 1 }),
    ]),
    idea('i-path', 'enemy-paths', 'level', 'Show the path each enemy will walk next turn as a thin line on the tiles', 95, [
      version(1, 93, 'art-inbox/pathfinding/option-a-navmesh.png'),
    ], { agreed: 1 }),
    idea('i-grid', 'grid-overlay', 'board', 'A grid overlay toggle for the map', 150, [
      version(1, 149, null, { state: 'failed', why: 'Codex took longer than 240 seconds and was stopped.', seconds: 240 }),
    ]),
  ]
}
