# Briefing for the main chat: this project's own facts

Copy this file to `<project>\.claude\main-briefing.md` and fill it in. The main chat follows the board's general
job, `<board>\roles\main.md`, and keeps to the words in `<board>\roles\protocol.md`; this file holds only what is
this project's own. `<project>` is the project's folder, `<board>` the worker board's folder, `<prefix>` the
"prefix" of `<project>\.claude\chats\list.json` (for example "My Project - ") and `<repository>` the folder of the
project's code.

## This project

- The chats: "<prefix>Main" and its workers "<prefix>Worker N"; the Advisor, when there is one.
- The code: `<repository>`, base branch `<base branch>`. Its working agreement: its `CLAUDE.md`, when it has one.
- How to answer the user: `<project>\CLAUDE.md` (a new project gets it from `<board>\examples\CLAUDE.md`: the For you
  block, the first two lines of a finished task, the closing block and the limit pause the board reads).
- The worker board: `<board>`; the user's board runs on port <port>.
- The most workers at once: <four>.

## Starting a worker

- <the project's start-worker routines (one per worker, `<folder>-worker-N`) or its shared start-worker task, and where its steps are, or "a chip">

## Standing permissions

- <what the user has said yes to once for good, with the date and their words>

## Who owns what

- <the mods or tools the chats rely on, and which chat looks after them>
