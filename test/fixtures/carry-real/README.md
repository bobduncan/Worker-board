# carry-real: a trimmed copy of a real project, for the save/load tests

Each file stands for a real case of a live project's store, trimmed to the lines the tests need. Paths are neutral:
`{project}` and `{drive}` in `config.json` and `user-settings.json` are filled in by the test with its own temp folders.
The 64-hex key in `project/.claude/board.json` is fake. Nothing here is read by the board itself.

## Layout
- `project/` the project folder; `board/` the board folder (only `data/`); `memory/` Claude's memory folder;
  `config.json` the board's settings; `user-settings.json` the user's Claude settings.

## What travels (in)
- `project/.claude/work/B1149.md`: a step given back by the board (State refined, no Owner), with its checkpoint, "Branch: b1149" (local only).
- `B1153.md`: a step in review whose branch is gone from the remote.
- `B1003.md`: a done step with `Branch: none` (built by a checker).
- `B1240.md`: a board step in progress, `Priority: fix`, waiting on chat 1.
- `Q811.md`: a look ask with `Route: recap`. `pause.json`: state `pausing` (the other board starts paused).
- `goals.md` (G64 done with its demo, G95 in progress), one brainstorm thread, one goal ask, `design.json`, `goals.history/`.
- `assets/A271/request.json` and `1.prompt.txt` (the prompt file is named `1.prompt.txt`, never a bare `prompt.txt`).
- `chats/list.json`; `plans/`, `specs/`, `handover/`, `hooks/` whole; `.claude` top-level files (briefings, `settings.local.json`, `start.json`, `worker-board-check.md`).
- `CLAUDE.md`, `AGENTS.md`, `demo-board.md` (the project's top-level files); `.codex/`.
- `pictures/G64/demo/` and `pictures/G60/recap/`: demo, feedback and list .json (`recap/list.before-row1-*.json` stays out).
- `board/data/{finished,recaps,rounds,refine-gate,task-times,ideas}.json` (`recaps.json` holds a day's rows; `plan-writes.json` is absent on purpose).
- `memory/` two notes. `config.json` (with appSessions, usageHistory, transcripts and picturesHome set), `user-settings.json` (permissions, autoMode, hooks, enabledPlugins, marketplaces).

## What stays out (runtime, per PC, or leftovers of writes)
- Store: `names.json`, `delivered.json`, `view.json`, `B1149.md.claim`, `B1240.md.9876.tmp`, `B1153.md.broken-*`, `B1153.md.bak-*`.
- `.claude`: `board.json` (the bridge key), the launch file and its before-copy, `sync*.json`, `supervisor*.json`, `limit-readings.json`,
  `board-errors.log`, `backlog*.md`, `scheduled_tasks.lock`, `scratch-*`, `settings.local.json.before-board-rules`, `chats/<id>.json` cards.
- `assets/A1/swing.wav` and `assets/A271/1.png` (only `request.json` and `*.prompt.txt` travel; `A1/request.json` travels too).
- `board/data`: `history.jsonl`, `outbox.jsonl` (one held line, one delivered), `alive`, `started`, `stop`, `spending`, `wakes`, `board.log`, `carry.json`.
- `pictures/G95/B1149/` (`demo.png`, `notes.json`): pictures are another part's.
