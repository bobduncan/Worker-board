# The stored routine that starts the Product owner's chat

The Product owner (2026-10-31, `roles/product-owner.md`) is the chat the list of chats names `"owner"`: it takes the
person's talks (the brainstorm, "Change this goal", the Focus page's talk) and nothing else, so the person never waits
behind a refine or an incident. Like a worker it has a stored routine of its own (T12), so the board can start its chat
without a click: the Workers mod of any running board chat runs it by code, when the list names an owner and no chat of
it is on the board. Its text is beside the workers' (`start-worker-task.md`), made the same way.

## Making it, once per project and login

From a chat in the project's folder that runs in Auto mode, in a turn the person typed in the desktop app (only then is
the chat's mode saved with the routine):

- `create_scheduled_task` (tools `mcp__scheduled-tasks__*`), no schedule, `taskId` "<project folder name>-product-owner",
  `title` "<prefix>Product owner" (the prefix from `.claude/chats/list.json`, and the name the list gives the owner),
  `description` "Starts <prefix>Product owner of the worker board", `notifyOnCompletion` false, and as `prompt` the text
  below, with `<the worker board's folder>` written as the board's own folder.
- The board's settings panel ("What the board does by itself on this PC") names it among the routines still to make once
  the list names an owner, and "Copy the line that makes the routines" gives the line to paste, with the board's folder in
  it. A second login finds the id taken and makes it "<project folder name>-product-owner-2"; the board tries both.

The list's `"owner"` entry is what makes the chat the Product owner: until the list names one, the board gives every talk
to the partner (the Advisor), as before.

## The task's text

```
You are the Product owner chat of the project in this folder, started by the project's worker board through this stored routine. This first message only sets you up. After it the worker board types the person's talks into this chat (a brainstorm, "Change this goal", the Focus page's talk), and the person reads and answers you on the worker board, so from your second message on the person may well be present.

Do these steps in order, and nothing else in this first turn:
1. Read .claude/chats/list.json in this folder. "prefix" names the chats: a chat's title is the prefix followed by its short name. "owner" is the short name of the Product owner.
2. Load the tool mcp__ccd_session_mgmt__get_session with ToolSearch. Call it with session_id "self": your title is your full name, and your short name is the title without the prefix.
3. Join the list of chats: call mcp__workers__chat with action "join", your short name, role "worker" (the Workers mod knows main and worker only; the board reads you as the Product owner because the list names you "owner").
4. Read your job whole: <the worker board's folder>/roles/product-owner.md, and its part "How a talk goes". Keep to it from now on: you take the person's talks and nothing else, and you never set your own model or effort (the board holds them).
Then end your turn: the worker board types each talk into this chat as it comes. If a step fails, say which and why in a note with mcp__workers__work (action "note", to "main") instead of guessing, then end your turn.
```
