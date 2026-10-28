# The stored routines that start a worker chat

A chat in the desktop app can be started without a click by one run of a scheduled task (tried on 2026-10-14; the
app's Routines page lists them as routines). The new chat takes the routine's title as its own title, opens in the
folder of the chat that made the routine, and gets the routine's text as its first message. So a project keeps one
such routine per worker, each with no schedule, and the board starts a worker by running that worker's own routine.
(T12, 2026-10-28: the person wanted one card per worker on the Routines page, "My Project - Worker 3", and not one
shared routine renamed for every start. The shared task of B766 stays as the fallback, below.)

## Making them, once per project and login

From a chat in the project's folder that runs in Auto mode, in a turn the person typed in the desktop app (only
then is the chat's mode saved with the routine; otherwise its runs ask the person before every tool, and the person
can set the mode on the routine in the app: Scheduled in the sidebar, the routine, its permission mode). One routine
for each worker N, from 1 up to the worker limit (the board's "Workers at most", `maxWorkers`, 5 unless set; raise the
limit and the missing ones are made the same way):

- `create_scheduled_task` (tools `mcp__scheduled-tasks__*`), no schedule, `taskId` "<project folder name>-worker-N",
  `title` "<prefix>Worker N" (the prefix from `.claude/chats/list.json`, for example "My Project - Worker 3"),
  `description` "Starts <prefix>Worker N of the worker board", `notifyOnCompletion` false, and as `prompt` the text
  below (the same text in every routine: the chat reads its own title).
- The board's settings panel ("What the board does by itself on this PC") shows whether every slot has one: "by itself",
  or "needs routines for Worker 4, 5". "Copy the line that makes the routines" gives the line to paste into any chat of
  the project, in a turn you type; it makes exactly the ones that are missing.
- The app keeps the routines per login, but their folders in `~/.claude/scheduled-tasks` on the computer: a second
  login finds the id taken and makes it "<project folder name>-worker-N-2". The board tries the plain id first, then "-2".

**The shared task (B766, the fallback).** A PC may still have one task for all workers, taskId "<project folder name>-start-worker"
(a second login: "-start-worker-2", tried first), which the board renames to the new worker's title and runs for every
start. The board uses it only for a worker that has no routine of its own; a PC with this task and no routines goes on
as before. It is made like a routine above, with the title of the first worker.

## Starting a worker (the board, B766, T12)

The board's `spawn workers` word is a hand job: the Workers mod of a running board chat runs the routine of the new
worker, one worker per claim, by code. The new worker is "<prefix>Worker N" for the lowest N no chat of the board has,
and its routine `<folder>-worker-N` is tried first (then its "-2"; renaming it to its own title changes nothing), the
shared task only after them. The board runs a worker's own routine only when that worker has no chat. The new chat
joins the list by itself and reports idle, and the board hands it a task. This needs the app to allow the chat's code
`mcp__scheduled-tasks__update_scheduled_task` and `mcp__scheduled-tasks__run_scheduled_task` with no question (allow
rules in the project's `.claude/settings.local.json`; the mod checks them with `$.tool.check`). Without them the word
goes to the main chat, which does the same by hand:

1. The next free name: the lowest "Worker N" that the list of chats (`mcp__workers__chat`, action "list")
   does not hold.
2. `run_scheduled_task` with the id of that worker's routine (`<folder>-worker-N`): it answers with the new chat's
   session id. Only when the project has no routine for that N, `update_scheduled_task` with the shared task's id and
   `title` "<prefix>Worker N" first, then `run_scheduled_task` on the shared task.
3. Several workers: one after another. A run is refused while the last one's first turn still runs, so start the
   next once the new worker shows on the board.

The first message of a run tells the chat that the person is not present; the task's text says that this holds for
that first message only. The new chat does not join the list by its title by itself, so the text has it join.

## The task's text

```
You are a new worker chat of the project in this folder, started by the project's worker board through this stored task. This first message only sets you up. After it you are an ordinary worker: the worker board hands you your tasks, and the person reads and answers you in this chat or on the worker board, so from your second message on the person may well be present.

Do these steps in order, and nothing else in this first turn (the setup is no task and needs no card):
1. Read .claude/chats/list.json in this folder. "prefix" names the chats: a chat's title is the prefix followed by its short name, for example "My Project - Worker 2".
2. Load the tool mcp__ccd_session_mgmt__get_session with ToolSearch. Call it with session_id "self": your title is your full name, and your short name is the title without the prefix (the title "My Project - Worker 2" gives "Worker 2").
3. Join the list of chats: call mcp__workers__chat with action "join", your short name, role "worker".
4. Read the project's worker briefing, .claude/worker-briefing.md, if it is there, and keep to it from now on.
Then end your turn: the worker board sees you idle and hands you your first task. If a step fails, say which and why in a note with mcp__workers__work (action "note", to "main") instead of guessing, then end your turn.
```
