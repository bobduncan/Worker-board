# <name>: how every chat answers the user

Every chat that works in this folder reads this file: the main chat and every worker. It is about how to write to
the user. Each chat's job is in the worker board's job texts, `<board>\roles\` (`main.md`, `worker.md`, and the shared
words in `protocol.md`); this project's own facts are in `.claude\main-briefing.md` and `.claude\worker-briefing.md`.

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
- A choice between options stands inside its item ("A ... or B ...; I advise A"). When the options differ in what
  the user would see, every option gets its picture.
- File each question with the work tool (`work ask`): it answers the block for you, and the user can answer it on
  the worker board too.
- No block when nothing is the user's.

## 3. A finished task with something left for the user

The answer opens with two lines, in plain words for someone who forgot the context:

    **Task:** <the task as it was given, in one line, with its step id>
    **What I did:** <one to three lines: what the user gets now, and what is not done>

Then the "For you" block, each item with a link to what the user needs to check it, such as
`[See the picture: <what it shows>](http://127.0.0.1:<port>/#picture=<folder>/<file>.png)`, which opens the picture on
the worker board.

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

All chats share one usage limit. A worker that stops because it runs low first brings its work to a safe point, then
sends the main chat a note whose first line is exactly:

    Note from <name of the chat>: paused for the limit until HH:MM

HH:MM is the time it goes on. The worker board reads that first line and shows the worker as "Suspended" until then.
