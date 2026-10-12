// Made-up samples of every source, for `node server.mjs --demo` and for the tests: a small team building a game
// that does not exist. Every time is counted back from `now`, so the demo always looks like a morning at work.
// Each sample is text in the shape of the real file and goes through the same readers as the real data.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readFolders } from '../src/folders.mjs'
import { listPictures } from '../src/pictures.mjs'
import { answer, assistant, fromChat, step, tool, toolResult, typed } from './lines.mjs'

const MIN = 60_000
// A real folder, so the demo's pictures are served the way the real ones are.
const PROJECT = join(dirname(fileURLToPath(import.meta.url)), 'demo-project')
const REPO = 'C:/Demo/game-builder/game'
const ROOTS = ['art-inbox']

const CHATS = [
  { name: 'Main', id: 'demo-main' },
  { name: 'Units', id: 'demo-units', summary: ['blocked', 'two pathfinding approaches compared', 'Choose an approach for enemy pathfinding: option A (NavMesh) or option B (custom grid).'] },
  { name: 'Features', id: 'demo-features' },
  { name: 'Cleanup', id: 'demo-cleanup', summary: ['completed', 'the docs are tidy', ''] },
  { name: 'Levels / Environment', id: 'demo-levels' },
  { name: 'Advisor', id: 'demo-advisor', summary: ['completed', 'advice written', ''] },
]

const BACKLOG = `# Backlog

## Movement #focus
- [x] Player input
- [ ] Integrate player movement (Game - Main; branch feature/player-movement)
- [ ] B03 Verify: the jump feels right (picture in art-inbox/jump) @you
- [ ] B04 Do: quit and reopen the app once @you

## Enemies #focus
- [ ] Enemy pathfinding (Game - Units; branch feature/enemy-ai)
- [ ] Add save / load system (Game - Features; branch feature/save-load)
- [ ] Build first level (Game - Levels / Environment; branch feature/forest)

## Next to hand out (Game - Main)
- [x] Add save / load system (for Features)
- [ ] B11 Animation blending (for Main; branch feature/animation-blending; about 40 min)
  Blend between the walk, run and jump animations, so a change of speed does not snap.
  Requirements:
  - No visible pop when the speed changes
  - Works for the player and for enemies
  - The jump keeps its own timing
  Context: the jump arc is in art-inbox/jump. Keep the blend under a tenth of a second.
- [ ] Review the merge order (for Main; about 15 min)
- [ ] Plan the next milestone (for Main; about 30 min)
- [ ] Enemy abilities (for Units; after the pathfinding choice; about 30 min)
- [ ] Enemy attack patterns (for Units; about 1 h)
- [ ] Main menu (for Features; after save / load merges; about 1 h)
- [ ] Settings screen (for Features; about 45 min)
- [ ] Controller support (for Features; about 2 h)
- [ ] Remove unused assets (for Cleanup; about 20 min)
- [ ] Lava biome (for Levels / Environment; about 1 h 30 min)
- [ ] Level streaming (for Levels / Environment; about 2 h)
- [ ] Decide the name of the game
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
    run: { url: 'http://localhost:5173/', branch: 'feature/player-movement', entry: 'lava-dev' },
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
    answers[`-C ${path} log -1 --format=%ct`] = `${Math.round((now - folder.minutesAgo * MIN) / 1000)}\n`
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

function transcripts(now) {
  const ago = minutes => now - minutes * MIN
  const tail = (lines, quietMinutes) => ({ text: lines.join('\n'), isCut: false, modifiedAt: ago(quietMinutes) })
  return {
    'demo-main': tail([
      typed(ago(12), "Let's focus on player movement today. Please run the tests once it's integrated."),
      step(ago(12), 'Read the movement code'),
      toolResult(ago(11.5)),
      answer(ago(11), "Got it. I've integrated the movement code and am now running the tests."),
      fromChat(ago(8), 'Game - Units', 'Report: investigating pathfinding options.\n\nTwo approaches look workable: a NavMesh, or a custom grid. I asked in my chat which one to take.'),
      answer(ago(7.5), 'Noted. Units waits for your choice between the two pathfinding approaches.'),
      fromChat(ago(4), 'Game - Features', 'Save system is implemented. Running local tests.'),
      answer(ago(3.5), 'Features has the save system in and is testing it.'),
      typed(ago(0.5), 'Great! Next we can look at animation blending.'),
      step(ago(0.3), 'Run the tests'),
    ], 0.3),
    'demo-units': tail([
      fromChat(ago(150), 'Game - Main', 'Task from Game - Main: choose the enemy approach. Time box: about an hour.'),
      step(ago(149), 'Read the enemy code'),
      toolResult(ago(148)),
      answer(ago(103), 'Two approaches are worked out. Which one do you want: NavMesh or a custom grid?'),
    ], 103),
    'demo-features': tail([
      fromChat(ago(55), 'Game - Main', 'Task from Game - Main: add a save / load system.'),
      step(ago(54), 'Read the game state'),
      toolResult(ago(53)),
      step(ago(1), 'Implement code', 'Edit'),
    ], 1),
    'demo-cleanup': tail([
      fromChat(ago(130), 'Game - Main', 'Task from Game - Main: tidy the docs.'),
      step(ago(129), 'List the docs'),
      toolResult(ago(128)),
      assistant(ago(106), 'tool_use', [tool('SendMessage', { to: 'Game - Main', message: 'The docs are tidy.' })]),
      toolResult(ago(106)),
      answer(ago(105), 'The docs are tidy and the report is with Game - Main.'),
    ], 105),
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
      answer(ago(19), 'Yes, if it does not touch the save files: the main menu only reads whether a save exists. I would let it start once its tests pass.'),
    ], 19),
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
    line(9, 'Features', 'working', 'Add save / load system', { step: 3, steps: 5, leftMs: 35 * MIN }),

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
  ]
  return lines.sort((a, b) => a.at - b.at)
}

/** The demo's sources as they stand at `now`, in the shape `readSources` gives for the real files. */
export async function demoSources(now) {
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
      'demo-units': plan(now, { text: 'Choose enemy approach', step: 2, steps: 4, left: 30 * MIN, isReported: false }, 103),
      'demo-features': plan(now, { text: 'Add save / load system', step: 3, steps: 5, left: 114 * MIN, isReported: false }, 9),
      'demo-cleanup': plan(now, null, 105),
      'demo-levels': plan(now, { text: 'Build first level (forest)', step: 2, steps: 6, left: 40 * MIN, isReported: false }, 6),
    },
    tails: transcripts(now),
    backlogText: BACKLOG,
    adviceText: ADVICE,
    folders: await readFolders(REPO, async args => answers[args.join(' ')] ?? null),
    askTexts: ASKS(now).map(ask => JSON.stringify(ask)),
    pictureLists: { 'art-inbox/jump': await listPictures(PROJECT, ROOTS, 'art-inbox/jump') },
    historyLines: history(now),
  }
}
