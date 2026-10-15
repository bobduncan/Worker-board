# The stored task that starts a worker chat

A chat in the desktop app can be started without a click by one run of a scheduled task (tried on 2026-10-14). The
new chat takes the task's title as its own title, opens in the folder of the chat that made the task, and gets the
task's text as its first message. So a project keeps one such task, with no schedule, and its main chat starts a
worker by giving the task the worker's title and running it.

## Making it, once per project

From a chat in the project's folder that runs in Auto mode, in a turn the person typed in the desktop app (only
then is the chat's mode saved with the task; otherwise its runs ask the person before every tool, and the person
can set the mode on the task in the app: Scheduled in the sidebar, the task, its permission mode):

- `create_scheduled_task` (tools `mcp__scheduled-tasks__*`), no schedule, `taskId` "<project folder name>-start-worker",
  `title` the first worker's title (for example "My Project - Worker 2"), `notifyOnCompletion` false, and as `prompt` the
  text below.

## Starting a worker (the main chat)

1. The next free name: the lowest "Worker N" that the list of chats (`mcp__folder-branches__chat`, action "list")
   does not hold.
2. `update_scheduled_task` with the task's id and `title` "<prefix>Worker N" (the prefix from
   `.claude/chats/list.json`), then `run_scheduled_task`: it answers with the new chat's session id.
3. The new chat answers by itself within a minute or two: "Note from <prefix>Worker N: ready for a task (permission
   mode: auto)". Hand it its task by that session id.
4. Several workers: one after another. A run is refused while the last one's first turn still runs, so start the
   next after its ready note.

The first message of a run tells the chat that the person is not present; the task's text says that this holds for
that first message only. The new chat does not join the list by its title by itself, so the text has it join. In that first turn SendMessage
refuses; the older tool `mcp__ccd_session_mgmt__send_message` delivers.

## The task's text

```
You are a new worker chat of the project in this folder, started by the project's main chat through this stored task. This first message only sets you up. After it you are an ordinary worker: your tasks come from the main chat, and the person reads and answers you in this chat or on the worker board, so from your second message on the person may well be present.

Do these steps in order, and nothing else in this first turn (the setup is no task and needs no card):
1. Read .claude/chats/list.json in this folder. "prefix" and "main" name the chats: the main chat's title is the prefix followed by main, for example "My Project - Main".
2. Load the tools mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__list_sessions and mcp__ccd_session_mgmt__send_message with ToolSearch. Call get_session with session_id "self": your title is your full name, and your short name is the title without the prefix (the title "My Project - Worker 2" gives "Worker 2"). Note your permissionMode.
3. Join the list of chats: call mcp__folder-branches__chat with action "join", your short name, role "worker".
4. Read the project's worker briefing, .claude/worker-briefing.md, if it is there, and keep to it from now on.
5. Find the main chat's session id with list_sessions (the session whose title is the main chat's title) and send it, with mcp__ccd_session_mgmt__send_message to that id (SendMessage refuses in this first turn), exactly one line: "Note from <your title>: ready for a task (permission mode: <your permissionMode>)."
Then end your turn and wait. If a step fails, say which and why in that same note instead of guessing.
```
