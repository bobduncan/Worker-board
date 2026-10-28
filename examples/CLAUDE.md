# <name>: how every chat answers the user

Every chat that works in this folder reads this file: the main chat and every worker. It is about how to write to
the user. Each chat's job is in the worker board's job texts, `<board>\roles\` (`main.md`, `worker.md`, and the shared
words in `protocol.md`); this project's own facts are in `.claude\main-briefing.md` and `.claude\worker-briefing.md`.
The worker board reads parts of every answer (the For you block, the first two lines, the closing block): keep their
words as written here.

## 1. Compact

- Lead with the result: what changed and what it means for the user, in a few lines.
- One line for what you checked. No lists of proof, files or commits unless the user asks.
- Do not repeat what an earlier answer or another chat already told the user.

## 2. Everything that is the user's, in one block

Whatever the user has to do, decide or answer goes into one quote block titled "For you", right above the closing
block. Nothing else in the answer uses a quote block, and no question is left in the running text.

    > **For you**
    > 1. **Answer:** <the question, with your advice in a few words>
    > 2. **Do:** <the action, with where to click or what to type>

- One line per item, numbered, so the user can answer "1 yes, 2 no".
- Every item starts with **Answer:** or **Do:**.
- A choice between options stands inside its item ("A ... or B ...; I advise A").
- When the options differ in what the user would see or play, every option gets its picture: one picture with all
  options side by side and labelled, or one link per option. Never a picture of the advised option alone.
- File each question with the work tool (`work ask`): it writes the block for you, and the user can answer it on the
  worker board too. A question only written in the chat is one the board cannot show.
- No block when nothing is the user's.

## 3. A finished task with something left for the user

When a task is finished and something is still the user's, the answer opens with two lines, and every item of the
"For you" block carries a link to what the user needs to check it:

    **Task:** <the task as it was given, in one line, with its step id>
    **What I did:** <one to three lines in plain, non-technical words: what the user gets now, and what is not done>

    > **For you**
    > 1. **Answer:** <the question, with your advice in a few words>
    >    [See the picture: <what it shows>](http://127.0.0.1:<port>/#picture=<picture folder>/<file>.png)
    > 2. **Answer:** <a check in the running work, with your advice>
    >    [Play it: <where, in a few words>](http://127.0.0.1:<port>/#play=<branch>&<settings>)
    > 3. **Do:** <the action, with where to click or what to type>

- "Task:" and "What I did:" are the answer's first two lines. Both are high-level, for someone who forgot the context:
  no file names, functions, commits or test counts there.
- A link opens the worker board. `#picture=<path>` shows that picture in a popup on the board (a file under one of
  the board's picture folders, the setting `pictureRoots`). `#play=<branch>&<settings>` starts the project's game,
  when it has one, with that branch's work in a new tab; `main` is a branch too.
- The board's window for a finished worker shows these parts and links.
- An answer without anything for the user needs none of this.

## 4. The closing block

Every answer to the user ends with a rule and a `diff` block of three lines:

    ---

    ```diff
      Prompt: <the user's request in one line>
      Who:    <the chat that did it>
    + Done:   yes
    ```

`+ Done:   yes` shows green. `- Done:   no, <reason>` and `- Done:   partly, <the missing thing>` show red.

## 5. A worker that pauses for the limit

All chats share one usage limit. A worker that stops because it runs low first brings its work to a safe point
(committed, and pushed where its branch is on the remote), then sends the main chat a note whose first line is
exactly:

    Note from <name of the chat>: paused for the limit until HH:MM

HH:MM is the time it goes on. The worker board reads that first line and shows the worker as "Suspended" until then,
so nothing else goes on that line. The board types the same stop to a working chat when a limit reaches its stop line
(the 5-hour limit at 95% while its reset is far off, the week at 98%): bring your work to a safe point and send that note.
It types it only to a chat that holds a step not yet reported: one that reported its step needs none (B771).

## What this does not change

A note or a question from a worker to the main chat keeps its own form ("Note from <name of the chat>: ...", "Question
from <name of the chat>: ..."), and a step is ended with the work tool (`work report`), never by a message.
