# The mods: keep, make optional, or drop

B204, 2026-10-14. An analysis, nothing built. The user's question: "can we deepdive first, maybe instead of all the
mods try to remove 1 mod at a time. or for that with mod its better than without. it feels like an extra
dependencies." The starting point is B146's estimate (about 8 to 10 hours to run the board without any mod).

A mod is an add-on for the Claude app that the person installs once. Three are installed here: the Workers mod,
the Backlog mod and the Run mod (start-app). Each one is weighed on its own below.

## What a mod costs to keep

The same for each of them:

- **Installing on a new PC:** the mods come from a private GitHub repository, installed with the app's command-line
  program, which is hard to find on a PC with the app from the Microsoft Store.
- **A new version reaches a chat only when its process starts anew.** After an update every open chat runs the old
  version until the app is quit and opened again.
- **Another project's user needs them too**, so they are part of "the board for any project".

## The Backlog mod

- **What it gives:** a Backlog pane in the app, the commands /backlog and /todo, a tool chats use to tick a step,
  and a note in every chat on how to keep the backlog.
- **Without it:** the board does not use it at all. The board reads and ticks the backlog itself and has its own
  Backlog tab; the chats edit the backlog file directly, as the board's job texts (`roles/main.md`,
  `roles/worker.md`) already tell them. Lost: the pane inside the app and the two commands.
- **Verdict: drop it from the board's setup.** It is already not needed: the README asks only for the Workers mod.
  Whether the person keeps it for the pane is their own taste.
- **Work:** about 15 minutes, documentation only: make sure the job texts carry everything its note said.

## The Run mod (start-app)

- **What it gives:** a Run pane that starts a folder's app from `.claude/launch.json` and the commands /launch,
  /start, /stop-app.
- **Without it:** the board does not use it. The board writes its own entry into `launch.json` for the app's
  preview, and starts games itself (Run game). Lost: the Run pane inside the app.
- **Verdict: drop it from the board's setup; keep it as a personal tool if wanted.** No work on the board.

## The Workers mod (`workers`, called `folder-branches` until 0.26.0)

This one the board leans on. It is several things in one; each is weighed on its own.

| Part | What it gives | Without it | A stand-in, and its cost | Verdict |
|---|---|---|---|---|
| The bridge | What you answer or type on the board (answers, Talk to Main, the restart, worker and queue buttons, the Design tab's step) is typed into the chat as your word, and wakes a chat that waits | Nothing outside the app can type into a chat or wake one | Copy the words and open the chat for you to paste them: a click more per answer, and an idle chat is not woken. About 2 to 3 h | **Keep, with the copy-and-open fallback** when no mod answers |
| The cards | Each chat's topic, steps and times on its lane (until 0.25.0 with reminders when a time is missing; dropped with the classic hooks) | The lanes still show working, waiting or free (from the chats' transcripts), without the topic and the times | The chats write their card file themselves, told so in their job texts; no reminders (the mod's own since 0.25.1). About 1 to 1.5 h | **Make optional:** the board reads both kinds of card |
| Starting the board | The board starts with the first chat of the project | The person starts it by hand | A start script and a line in the README. About 1 h | **Make optional** |
| Whether a chat runs | "Not running" on a lane and in the mod's Workers list (B738: from the board's verdict in the answer to a take), and the main chat starts such a chat | The board cannot tell a closed chat from an idle one | None on every system; drop the mark. About 30 min | **Keep with the mod only** |
| Compacting a large worker, or clearing it (2026-10-23, `afterStep` "clear") | A worker is made smaller after it reports, or cleared with its conversation kept as a log by the board, so it does not re-read a long history; the main chat and the partners are compacted at rest | Chats grow until the app compacts them in the middle of work | None | **Keep with the mod only** |
| The panes (Workers, Git) | The list of chats and the branches inside the app | The board shows both | None needed | **Keep with the mod** |
| Filing a "For you" block (B317, 0.13.7) | At a chat's turn end, the items of the "For you" block its answer ends with go to the board with `turn-ended`; the board files those the chat filed no ask for as asks `Via: chat`, so they get an answer box | The chat's questions stand only in its chat, and the board warns "filed no ask" | The chats file every question with `work ask`, as their job texts say | **Keep with the mod only** |
| The board's hands (B753, B755, B766, B768; T14, 0.26.5) | Every 20 s a chat claims the board's jobs and does them by code, with no model turn; its claim's `can` says which it may take, each only where the app's check (`$.tool.check`) allows its code the tools with no question: `set` (set_session_model and set_session_effort), `restart` (archive, unarchive and list sessions), `spawn` (update and run a stored task), `usage` (get_usage) and, since 0.26.5, `send` (send_message: the start, wake and resume lines; a chat in Auto mode without the allow rule has its sends put to the classifier, which denies them, so it says none; a mod older than 0.26.5 never says it and keeps getting them) | The main chat types every start, wake, resume, model and effort itself | The main chat, a model turn per job | **Keep with the mod only** |
| Pause and resume (Pause 2, 0.13.9) | The work tool's `step` takes a checkpoint (`commit`, `next`). The mod reads the person's pause (`pause-state`, at most once per 20 s at a tool call, and from `turn-ended`'s `pause`): while pausing a chat is told at the first tool call of each turn (the call is refused with the words, since 0.25.1 on every login) to write its checkpoint, stop or wait for its background agents and end its turn, and a free worker pulls nothing; after Resume all the main chat, at its first prompt or the board's `resume`, is told whom to wake by session id; a chat holding a step, at its first turn after the resume or at the first prompt of its process, its checkpoint | The board still says from facts who works and who has no checkpoint; nobody tells a chat to stop or whom to wake | The person types the words into each chat | **Keep with the mod only** |

**Verdict: keep the Workers mod, but make the board work without it.** The bridge has no real stand-in, so with the
mod the board stays better; without it the board still shows everything and asks the person to paste instead of
typing for them.

## The order, one piece at a time

**The user's choice (B205, 2026-10-14):** "make the board work without the workers mod and drop backlog mode from teh
setup. keep the runs mod for now." So pieces 1 and 3 to 6 are done; piece 2 is not, and the Run mod stays in the
setup for now.

Each piece is merged on its own and changes nothing for a PC that has the mods.

1. **The Backlog mod out of the setup** (about 15 minutes): the job texts carry its note; the README says it is
   not needed.
2. **The Run mod out of the setup**: not now; the user keeps it in the setup for now (B205).
3. **Cards without the mod** (about 1 to 1.5 h): the board also reads a card the chat wrote itself; the job texts say
   how. B177's first part. Done (B210).
4. **Starting the board without the mod** (about 1 h): a start script and the README. Done (B211).
5. **Answers without the mod** (about 2 to 3 h): when no mod takes the board's words, the board copies them and
   opens the chat. B177's largest part. Done (B212): the board keeps them as copied and puts them on the clipboard
   with a bar that names the chat to paste them into; no link opens a chat of the app by itself, so the person
   opens it.
6. **"Not running" and compacting stay with the mod** (about 30 min): the board says what it cannot know without it.
   Done (B213): without a mod no chat is called "not running"; one line under the lanes says what is copied, what
   cannot be told and what is not compacted.

**In all:** about 5 to 6 hours of a worker's time, less than B146's 8 to 10, because the mod is kept and the board
only learns to do without it. After step 5 a new project can run the board with no mod at all; installing the
Workers mod then adds the bridge and the compacting (the reminders went with the classic hooks in 0.25.1: the mod registers no classic hook, so the app's guard on a work login has nothing to skip).

## The Workers mod comes with the board (B251, 2026-10-15)

The hard part of keeping the mod was installing it on a new PC: a private repository of mods, and the app's
command-line program, which the app keeps in its own folder and does not put on the PATH. Now:

- **The board carries the mod's source**, in `mods/workers`, as a marketplace of one plugin named
  `worker-board` (`mods/.claude-plugin/marketplace.json`). The mod's own tests (`hooks/*.test.ts`) run in the
  plugin test kit, not in the board's `npm test`. Changes to the mod are made here.
- **`npm run setup`** (`setup.mjs`, `src/setup.mjs`) finds the app's program (the newest under the app's folder, the
  Store app's folder too, else a `claude` on the PATH), asks it which mods are installed, and then:
  - nothing installed: adds the board's `mods` folder as a marketplace and installs the mod for the person (user
    scope), checks that the program lists it as on, and says to quit and reopen the app;
  - a copy that is on, from any marketplace: leaves it as it is ("Nothing to do"), because two copies of one mod
    clash; the board's own copy, older than the board's: updates it;
  - a copy that is off: turns it on; two copies on, or the name `worker-board` taken by another folder: changes
    nothing and says what to do;
  - a copy under the mod's old name `folder-branches` (until 0.26.0): uninstalls it (it is no second copy that
    clashes: it only counts as one to remove) and goes on as above with the name `workers`; the page names the
    installed mod by either name until the reinstall.
  `npm run setup -- --check` only says what it would do.
- **Tried first, and it does not work: a project that brings the mod by itself.** A project's `.claude/settings.json`
  can name a marketplace inside the project (`extraKnownMarketplaces`, a `directory` source) and turn its plugin on
  (`enabledPlugins`). On 2026-10-15 a throwaway project with a copy of the mod and that settings file was opened in
  the desktop app: nothing was asked, the chat had no Workers tool and no `/workers`, and the app did not add the
  marketplace. The project's settings were read (their "off" for the installed copy took effect). The reason, in
  Claude Code's documentation: a plugin a project brings loads only after the trust question for that exact folder,
  and trusting a parent folder is not enough; the desktop app does not ask it. The ways left to trust a folder (the
  command-line program's own question, or a hand edit of a security setting) are no easier than an install.
- The copy-and-paste way for a PC without the mod (B209 to B213) stays.
