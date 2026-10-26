# Worker board: design

> **Design principles (2026-10-24).** Every feature and fix follows `PRINCIPLES.md`: code before chat, assume every
> chat can fail, know don't guess, one place per fact, same situation same outcome, done means it works live, cost by
> design, when in doubt hold and say so once, simple over clever.

## Quality and Spending (2026-10-21)

Spending adds local usage estimates, coverage and quality measurements without making model calls. Costs include
failed work, planning and review. API-equivalent prices and account-wide subscription allowance remain separate.
The initial rollout is observe-only: no automatic model changes until native route confirmation, complete tool
coverage and child controls are verified. Contracts, conservative model floors and candidate/validation helpers
are foundations for that later guarded workflow. See `docs/model-routing.md` and `docs/model-routing-pilot.md` for
the implemented boundary and remaining prerequisites. A missing prerequisite never relaxes a quality gate.

> **For any project (B191).** Every change to the worker board works for any project. No game, chat, folder
> or PC names in the code, the page, the job texts (`roles/`) or the examples: names, paths and words come from the
> settings (`config.json`) or the project's own files. `test/anyProject.test.mjs` fails on any tie; its list of
> known ties has been empty since B202 and stays empty.
> The user, 2026-10-14: "first ensure that its clear to all future work that this is the constraint if i develop
> something the worker board."

**How to read this file (B138).** It is the history of the board's decisions, made while it was built for its
first project, a game: the chat titles ("Game - Main", "Game - Board", ...), the folders (the project's own folders,
`art-inbox`) and the game's words in it are that project's. In another project read them as its main chat, its
workers and its own folders. The board as it is now, in general words:

- How to set the board up and its settings: `README.md`.
- The jobs of the chats the board works with, and the words they share with it: `roles/` (`main.md`,
  `worker.md`, `partner.md` (the Advisor's, since Focus 2), `protocol.md`).
- How the board was freed from its first project, and which mods it needs: `ANY-PROJECT-PLAN.md`, `MODS.md`.
- What the board does and how it looks, to build it again: `BOARD.md` (B184).

Approved by the person on 2026-10-12 ("agreed for the worker board design and plan"). Game - Support (named Game - Cleanup until that day) builds it.

## The second design (2026-10-12)

After a first look at the board the person changed its shape: from a dashboard that shows everything to a tool for
three things, awareness, intervention and coordination. The picture is `design/2026-10-12-codex-design-2.webp`,
their notes are `design/2026-10-12-notes-2.md`. Where this section and the older ones below differ, this one wins.
It is built in the branch `redesign/two-tabs` and is merged into main when all of it works, sending included.

**Two tabs.** Overview: one lane per worker (name and state, task with its progress, what it does now, the time it
expects to be done, its own queue), the inbox "For you", and today's timeline, which also shows what is expected
and queued after now. Advisor (Advice & Chat until B195): the advisor's advice and a conversation with the advisor. The shared queue,
the folders table and the main chat's dock are gone; a folder's details are under its worker's lane.

**Any number of workers.** The board names no worker anywhere. Every open chat of the project whose title starts
with the prefix is a lane, the chat named `advisor` in `config.json` is the one talked with, and the main chat is
a lane like the others. Queues, requests, answers and folders are all keyed by the chat's name. Adding a worker
is opening a chat titled "Game - <name>".

**One chat shows once (B314).** Seen live 2026-10-18: the Overview showed two lanes "Worker 1", one of them a grey
leftover in state unknown. Why: the app keeps its list of chats per account it was signed in with
(`claude-code-sessions<account><organisation>`) and shows only the account in use; the older account's folder still
held an open chat of that name, last active four days before, which the board read beside today's and took for an
older chat of the same name. Now only the folder holding the most recently active chat is read (`readAppChats`; two
folders as recent as each other are both read). A fork or an older chat of the same name in the account in use is
still a grey leftover.

**The fixed form for what a chat needs from the person** (an "ask"): one JSON file per ask in
`<project>\.claude\asks\`, written and closed by the chat that asks, read by the board. The fields are in
`src/asks.mjs`. Three kinds:

| Kind | The card shows | The answer |
|---|---|---|
| `input` | the question, options with pictures, pictures | words, required |
| `verify` | what was done, pictures, a button that opens the branch's game, what to check | Approve, with words if wanted, or Reject with the reason |
| `intervene` | what blocks, what was tried | words, required |

A chat that waits without having filed an ask shows as an `input` card with the app's own summary of what it
needs. A turn that runs without a sign of life is raised as an `intervene` card.

The steps in the backlog that end in `@you` are cards too, under the others and folded until opened. The main chat
writes in front of each what it asks of the person, and the board follows that: `Verify:` gets Approve and Reject,
`Decide:` and `Provide:` need words, `Do:` gets a Done button. A step shows the pictures of the folder it points
to. Its answer goes to the worker the step names, else to the main chat, which keeps the backlog.

**Closed is hidden.** What the person answered on the board, and the steps for them that are ticked in the
backlog, are closed and not shown, unless they tick "Show closed" above the inbox. An answered card is closed at once
(B307). An answer that did not arrive in time opens its request again.

**Details on a click.** The head of a card, and a step in a lane's queue, open a window with everything known
about it (`design/2026-10-12-codex-design-3-details.webp`): what it is and whose, a description, the pictures it
points to, where it stands in the queue, its branch and folder, and for a request the answer form of its kind. A
step of the backlog is one line, so what describes it further are the indented lines under it: a line
"Requirements:" (or any other name with a colon) starts a part of that name, a line "- ..." is a point of it,
"Context:" goes to the side, and a folder of pictures named in any of these lines is shown.

**A worker that waits for you opens on a click (B100).** A click on its lane opens the same window for what it
waits for: its task in a few lines, as its own card names it (the topic, the step, since when), then what it wants
from you in its own words: the answer that ended its turn, the questions it asked with the app's question form and
their options, or the plan it asks to have approved. What you or another chat typed to it is never shown. You
answer in the window, with the form and the sending the cards have; a question of the app's own form takes its
answer only in its chat, and the window says so. Once answered, the card stays while the answer is on its way and
for a little after it was typed in, although the chat no longer waits, so you see that it arrived.

**A working worker opens on a click (B151).** The person, 2026-10-14: "I want to be able to click on any worker that
is working and in the popup show what it's original task is". A click on the lane of a worker that works (also one
that is suspended, cut off, or between two turns) opens a window: in its head the task as its card names it; then
the task as it was given: the step the work store holds for it, else what the person typed there, with when
(`taskOrigin` in `src/transcript.mjs`: the newest such words at or before the task's start, kept to 6000 characters;
B301: the main chat's "Task from ..." message is no longer read); the step it is on; and where it stands now, its step line, its time and what it does. This is the
one place the board shows words a person or a chat typed, on the person's own wish; the lane keeps the card's
short task (B82), and the window of a worker that waits stays as B100 has it. The window is built from parts
(`LANE_PARTS` in `public/board.js`, main column and side column), so a later window adds its own. `#task=<worker>`
in the address opens it. The picture: `art-inbox/worker-board/b151/2026-10-14-b151-task-window.png`.

**A finished worker with something for you (B149).** The person, 2026-10-14: "once they are done with their task and
they still have questions for me. i want a properly formatted popup in the worker board ... a brief recap of it's
original task. A brief recap of what it did. A outstanding questions, decisions or actions addressed to me. links to
the information i need to verify my actions", and of the mock-up: "i want an actual clickable link to the image,
preferably as a popup in the board to verify. same with the game not a feature branch but a clickable link", then
"1 yes" and, for the form below, "2 yes". The pictures are in `art-inbox/worker-board/b149`.

- *The form.* A worker that finished and left something for the person opens its last answer with `**Task:**` and
  `**What I did:**`, and every item of its "For you" block (`N. **Answer:**` or `N. **Do:**`) carries the links the
  person needs: `[See the picture: ...](http://127.0.0.1:<port>/#picture=<path in art-inbox>)` and
  `[Play it: ...](http://127.0.0.1:<port>/#play=<branch>&<the game's settings>)`. The text for the chats is
  `art-inbox/worker-board/b149/2026-10-14-b149-answer-form.md`; the main chat puts it into the project's
  CLAUDE.md. `parseHandover` in `src/handover.mjs` reads it, and the closing block apart (`closingOf`); the words
  come from a chat, so a picture's path and a branch are kept to plain characters, and the board decides on its own
  whether it shows a picture.
- *The window* is B100's window, when the answer has the form: "Its task" (its own Task line; what the person typed
  to it is never shown, as B100 has it); "What it did"; "Its whole answer", folded; and its closing block as three
  rows, Done in green or red. B301: its "For you" items are no longer offered as questions with Yes/No/Done answers:
  what waits for the person is the work store's asks (`work ask`, which writes the block for the chat), and an answer
  that ends with a block but filed no ask is a warning under Needs your attention, whose window is this one.
- *The links.* "See the picture" opens it in the board's own popup. "Play it" starts the game from the working
  folder that holds the branch (main included) on a port of its own, in a new tab, with the settings in its address,
  so it opens where the change shows; it ends by itself as "Open the game" does. The same links in a chat open the
  board: `#picture=` shows the popup, `#play=` turns that tab into the game. Only a branch a working folder holds is
  started, and the start goes through the board's own page with its token, like every other. B675: the setting
  `page=<name>` opens `/<name>.html` of that game (`GAME_PAGES` in `src/places.mjs`: the sound board; only a page file
  the folder holds). `work ask` adds that play link itself when an ask names a game page ("the sound board", its address) and
  gives none: the step's branch, else main. A do or look ask with a local address it cannot link gets one line of warning.

**The task windows, compact on top (B157).** The person, 2026-10-14: "this is too much details. I want clear headers
in bold or bigger text. What was the original task. maximum 2 lines ... easily understand for people who forgotten
the context, what the ask was and what the solution is ... a header for further details, preferably collapsible,
collapsed by default", and of the mock-up: "I want the what I did to be non technical and highover. the detail it
correct". Both windows of B151 and B149 open with a part set apart, a header in capitals over each row:

- *The task*, at most two lines: the line "In short: ..." of the words that gave it when they have one, else their
  first line, else the step's title, else the card's topic (`shortTask`). B301: those words are the person's; a hand-over
  message gives no task.
- B281, in the window of a working worker on a backlog step: above those two lines the step itself, "B231 · its
  title", and the two lines say what the step is: the step's own first line that says what it is, not who has it,
  how far it is, the person's answers or a head's part such as "Plan: ..." (`stepTask`, the state's `step.about`).
  B301: the step the work store holds for the worker is the task, also when the person's words came later and the
  worker named its card anew for them (the person, 2026-10-17, of B231's window, which showed their answer as the
  task: "I want the task to be clear, recap the original task briefly and state it's busy with feedback on this
  task"); those words are the feedback.
- B425, the same window of a worker on a step (the person, 2026-10-19, I40: "It's title is too long and i dont see
  what its building. if backlog items were refined I expect to see a picture and the refined story here?"): its head
  holds the step's id and its title cut to its first clause (`shortTitle`: a title over 60 characters up to its first
  ": ", "; ", " - ", ", " or " (" after its first 20 characters, a comma in a list not counting, and at a word with "…"
  over 72), the whole title on hover, and a chip with the step's goal by its name ("G29 Interesting level design");
  the title stands there only. Under *The task*, a step with a refine block shows its refined summary in plain words,
  its picture (a thumbnail that opens in the picture popup; none for "Picture: none (...)") and *What we build*, "Not
  in it" greyed (the state's `step.brief`, read from the work store for the step a worker is on only); a step
  without one, and a block without a summary, shows the first lines of its context, up to the first part it names
  ("Requirements: ..."), never the store's own line ("[store] Goal: ..."). *Details* holds the step with its whole
  title, its context, what it touches, where it stands and the last 12 lines of its history.
- B281, when the person's words opened the worker's turn after it was given its task (typed in its chat, or an
  answer or a line given on the board, without the board's mark), a part of its own under the task:
  *Now on your feedback (HH:MM)*, their words in one line (at most two on screen; the board's own lines, such as a
  picture's place or "Tick this step in the backlog.", left off), set apart by an amber bar on its left. Not when the
  main chat or another chat opened the turn, nor for words the board cannot see opened a turn (a remark in the middle
  of one), nor after the worker finished the task before them (it reported, or said "Done: yes"): those words are
  its new task. A task without a step keeps the words above, with the same part.
- In the window of a working worker, *Its plan*: its steps by name, done ones with ✓ and the current one with ▶, and
  "Step 4 of 5 · 13 min left" (`planOf`). In the window of a finished worker, *What I did*: the plain sentences of its
  "What I did" line (`plainWords`).
- Plain words only: a step or a sentence with code, a file or a path, an address setting, a function or a
  programmer's word is left out of this part (`TECHNICAL`), so it shows less rather than technical words.

Then the finished worker's "For you" items, as B149 has them. Everything else is under one header, *Details*, folded
until the person opens it, and kept open while the window is drawn anew: the task as it was given, the backlog step
and where it stands (working), or the task as it was given, the whole answer and the closing block (finished). The
picture: `art-inbox/worker-board/2026-10-14-b157-compact-window.png`.

**The main chat's window: what you decide on (B169).** The person, 2026-10-14: "This 'for you' tab, doesnt contain
the information i need to approve. i think it works for for workers, but not for the main chat ... also lets rename
'For you' to 'Need your attention'", and of the mock-up "1. yes", "2. yes: A", "3. yes: everywhere". The main chat
asks the person as part of its talk with them, not as a finished task, so its window (`mainParts`) differs from a
worker's:

- *When*: it asked with the app's question form (B301: or it holds an open blocking ask of the work store). The app
  counts the main chat as waiting after every answer; a plain report asks nothing, stands nowhere under Needs your
  attention, and the main chat is free, not "Waiting for you" and not held by its own card (B290, the person,
  2026-10-17: "I dont see a question. or its not clear what you want"). B301: its "For you" block makes it wait no
  more; its questions are asks. A block at the very end of its last answer (`asksAtEnd`) with no ask filed is the
  warning "Main wrote questions in its chat but filed no ask", with a button to Talk to Main.
- *The head* says "Main needs your answer" (also its card), not "Finished: its task".
- *On top*, set apart: "You asked", its closing block's Prompt line, and "Where it stands", its Done line in green or
  red.
- *What you decide on*: its answer itself, open, drawn as in Talk to Main, without its "For you" block and its closing
  block (`material` in `parseHandover`); it scrolls on its own when long.
- B301: no questions with A/B/C buttons any more: the asks are the cards, with their options and advice.
- *Details*, folded: its closing block, and a button to Talk to Main, which holds all its answers.

"For you" is "Needs your attention" everywhere on the board: the right side's tab and its panel, the Backlog tab's
filter, a step's state and the windows. The chats keep writing their block as "> **For you**"; the board reads it
under both names. The tab stays on one line also when the right side is at its narrowest. The picture:
`art-inbox/worker-board/2026-10-14-b169-main-window.png`.

**The Advisor asks you itself (B275).** The person, 2026-10-17: "I want if the advisor needs something from me, it
also shows in this attention tab it can talk to 'me' directly instead or always via the main chat". The Advisor's
question stands under Needs your attention like a worker's, and the answer is typed straight into its chat, never
through the main chat:

- *When* (B301): it files an ask of the work store (`work ask`), which stands under Needs your attention like any
  ask, or it asked with the app's question form (answered in its chat only). A "For you" block in its last answer
  without an ask is the warning "Advisor wrote questions in its chat but filed no ask", with a button that opens its
  chat on the Advisor tab. (`advisorWaiting`, which read the block and passed over the board's own turns, is gone.)
- *Its window* is the main chat's (`mainParts`): what you asked, where it stands, its answer; under Details a button
  opens its chat on the Advisor tab.
- *Once*: its job text says it asks in its own chat and tells the main chat in one line only what it asked; the main
  chat does not ask it again (B261). The Advisor stays off the lanes. The pictures:
  `art-inbox/worker-board/b275/2026-10-17-b275-advisor-under-attention.png` and `...-advisor-window.png`.

**The Advisor on the Overview (B280).** The person, 2026-10-17: "i want to see what you are doing in the worker board
so I dont stop your current task ... show the advisor in the workers tab on the overview but distinct from the
workers". Under the workers stands one card for the Advisor, set apart by a line, its own label ("Advisor · advises on
what to do next; takes no tasks"), a teal accent and a light for its sign:

- *How it stands*: Working, Needs your answer, Idle, Not running, or Cut off and Suspended as a worker's. Since B301 it
  needs your answer when it has an open ask of its own in the work store (a refine question is not one: that is its
  refine state), or when the app says it waits (its question form); the board reads no questions from its words.
- *Its task* as its own card names it, with "Now:", its step as a count ("2 of 3") and its time left; idle, since when.
- *What it refines* (B287), as on the Advisor tab: "Refining B31, round 2", or "Your answers on B31 wait for it".
- *What waits for it*: what was sent to it and is not in its chat yet, counted by kind ("2 waiting for it: 1 refine, 1
  message"; rounds of the clock too), else "Nothing waits for it".
- No queue, no "⋯", no Remove or Stop: it takes no tasks. A click, or Enter, opens its chat on the Advisor tab.

On the Advisor tab, while it works, "Working: <its topic>" stands right above the typing box, with "What you type waits
until it is done". The pictures: `art-inbox/worker-board/b280/` (the card, the tab, a phone).

**The Backlog tab (B155).** The tab that was called Coordinate is called Backlog (`#backlog`; `#coordinate` still
opens it). At its top it lists the last 20 finished steps, newest first: when, the step's id and title, who finished
it, and where the time comes from; a click opens the step's window. The person, 2026-10-14: "i want a chronological
list of backlog items that were recently finish desc, so latest items first. this will allow to to verify what the
last 20 items were that were picked up and are done." The backlog holds no time for a tick, so `src/finished.mjs`
takes the first of: a line under the step that says it was approved, done or closed with a time; the last report to
the main chat that is about the step (the first step its first line names, read from the main chat's transcript);
the moment the board first saw the step ticked, kept in `data/finished.json` from 2026-10-14 on (shown with "≈");
a line with only the day. A step none of these gives a time for is left out. The picture:
`art-inbox/worker-board/b155/2026-10-14-b155-backlog-tab.png`.
**The blocks (2026-10-25).** The person agreed on a mockup (`art-inbox/board-backlog-lists/mock.png`) with one change,
"In progress is higher than queue": under "Recently finished" the open items stand in blocks, each folding with a click
on its head (kept in this browser, `backlog-blocks-folded`): **In progress** (given, taken, in progress, waiting on
you, in review, with the worker; green only while worked on, the colour of waiting only when it waits on the person),
**Queue** (the board's ready list, numbered in the order a free worker takes them, with the chips fix, focus and "added
by you", "any free worker" or "for <worker> only", and "Remove" on the person's own additions and pins), **Refined**
(held for the person's choice, each with "Add to queue"; one held for another reason says why, quietly), **Not refined
yet** (being refined, or waiting for your answer), and with "Show finished" **Finished**. Every row's goal links to it on
the Goals part (`#advice/goals/G<n>`). The filters, the search and "Show finished" stay; a filter or a search leaves out
a block with nothing left. "Add to queue" writes `Queued by: person, <stamp>` (the work API's `add-to-queue`, the
person's only; `remove-from-queue` takes it and a pin off): the ready list hands such a task out after the focus goal's,
in the order added (`handOut.mjs` `readyList`, rank 2). Pinning to one worker stays only in a task's window. Gone with
the blocks: "One list, newest first" (B164, B179), the goal headers (B302) and "Hide in progress and queued" (B250),
described below as they were. Tests: `test/backlogBlocks.test.mjs`, `test/work/handOutList.test.mjs`,
`test/work/handOutApi.test.mjs`.
A checkbox "One list, newest first" beside "Show finished" (B164; the person: "show it 1 long list desc. so last
item on the backlog first") lists every step without the activities, the highest id on top and the steps from
before the ids at the end; the filters, the search and "Show finished" work as in the list by activity, and each
row opens its window as there. The choice is kept in this browser. The picture:
`art-inbox/worker-board/2026-10-14-b164-one-list.png`.
Since B179 the tab opens as one list unless this browser turned the checkbox off, and "Recently finished" folds
away and back with a click on its head (a button that says whether the list is open), also kept in this browser.
The person, 2026-10-14: "Make the backlog 'recently finished' collapsible. Also one list checkbox turned on by
default." The picture: `art-inbox/worker-board/b179/2026-10-14-b179-backlog-folded.jpg`.
**Completed by day (B579).** A toggle at the Backlog tab's top, "Open items | Completed by day" (`#backlog/days`; the
choice is kept in this browser), shows one day of finished steps: a pager (‹ day ›), "N items completed", a recap on
top, the table of the day's steps (id, title, time, worker; a find box; a click opens the step's window) and on the right
the day at a glance, the last 7 days with their counts, how the recap groups the steps, and Copy daily recap. The person,
2026-10-24: "i want to be able to see which changes were done today ... including a generated recap text, highover ...
the goal here is easy overview. so if 1 bullet in a recap might correlate to multiple backlog items". A step counts on
the local day of its last move to done in the work store (`src/work/doneDays.mjs`); dropped steps and steps without such
a line are not there. The recap is 3 to 6 points, each step in exactly one, written by one headless call of the Claude
command line (`src/dayRecap.mjs`: Sonnet, no tools, no settings, plugins or MCP servers, in a temporary folder, told only
the day's titles and summaries), kept per day in `data/recaps.json`. It is written when a day is opened and its recap is
missing, not generated, or older than its newest step; today at most every 30 minutes. Only the board that runs the
loops calls, never while all chats are paused or a usage limit is near; without a call (or while the command line is
not signed in) the points are the day's goals, marked "Not generated" with the reason, and the next open tries again.
Steps finished after a recap stand in one more point, "Finished since this recap". Colours stay quiet: the points and
bars take cool tones, done ticks are green. The picture: `art-inbox/b579/completed-by-day-desktop.png`.
Since B302 the tab without "One list" groups the steps by the goal map, no longer by activity (the person,
2026-10-17: "that these categories are the same as the goals/milstones the advisors knows"; of two pictures they
chose A, nested as on the goal map). Each goal is a header with its G id, its title and how many of the steps shown
under it are open ("· N done" too with "Show finished"), indented under its parent; its own steps first, then its
goals. An id twice in the map counts once, the first, as everywhere on the board; a milestone is a goal taken from a
part of the game plan other than its goal; the keyboard stays on a header when the list is drawn anew. A step stands
under the first goal of the map whose `Steps:` names it; the rest, and the steps without an id, end the list under
"Not under a goal". The roots and the milestones stand open, the other goals folded; a click on a header folds or
unfolds it, kept in this browser. A goal with nothing shown under it is left out, so the filters, the search and
"Show finished" work as before; each row keeps its activity in its hint. Without a goal map the tab groups by
activity as before (`goalRows`, `drawGoalRows`). The picture: `art-inbox/worker-board/b302/2026-10-18-b302-backlog-by-goal.png`.
Since B180 the search and the two checkboxes are one group at the end of the head, after the longer "Needs your
attention" filter: at the board's usual width (1280 px and wider) the head is one line; narrower, the group moves to
the next line whole, the two checkboxes side by side, never one alone. A step's state stays on one line. The picture:
`art-inbox/worker-board/2026-10-14-b180-backlog-head.png`.
B221 (the person: "I want ... that I can delete or close items from the backlog in the backlog tab"): every step
with an id has "Close" and "Delete": in its window's foot, and over its row's right end while the pointer or the
keyboard is on the row (in the window only on a narrow screen). Close is offered while the step is open: the board
ticks it and writes "Closed by you on the worker board on <date at time>" under its lines, with the reason the
person gave, so it stays in the backlog as history. Delete takes the step and the lines under it out of the
backlog. Before either, the page asks once and names the step, and says so first when a worker is on the step or it
is queued for one. The board writes only that step's lines, reads the file right before and puts the new one in its
place in one move (`src/tick.mjs`, as for an approval's tick); only the board that delivers writes, through
`POST /api/backlog`, which takes the board's own page alone (token, origin, JSON).
A step nobody has (open, with an id: not queued, in progress, finished or the person's) has "Add to queue" at the end
of its row and in its window's foot (B181; the person: "I want a button add to queue for the items on the
backlog"). The board only asks: it types "queue step from the backlog" and "Step: <id> <title>" into the main chat,
marked as typed on the worker board, and the main chat picks the worker or what the step waits for and writes its
"(for ...)" note. Until the step is queued it says when it was asked, and the server refuses a second ask while the
first is on its way or arrived less than an hour ago. On a narrow screen the button is in the window only. The
picture: `art-inbox/worker-board/b181/2026-10-14-b181-add-to-queue.jpg`.

**Refine a step (B233).** The person, 2026-10-14: "the goal is to let AI clarify what the orginal problem is that we
try to solve, if any, or what the goal is. Ask any questions needed before we start picking it up. the UI must
facilitate me being able to provide feedback to the AI refining it. this information is stored inside the backlog
item so it's not lost." Of three mock-ups they chose A (`art-inbox/board-refine/refine-options.png`): the window of
a step that is not finished has a "Refine" part under its description and a "Refine" button in its foot. The board
types "refine step", "Step: <id> <title>" and "Round: <n>" into the Advisor's chat (the settings' `advisor`; without
one the button says so), marked as typed on the worker board; a chat that is not running is started by the main chat,
as for the person's other words. The Advisor writes the step's refine block under its lines (roles/partner.md):
"Refined (round <n>, by <name>, <date time>):", then "Problem:", "Goal:", "Questions:" with a point per question.
The window shows the block apart from the step's other lines, with a box per question and one for feedback; "Send
answers · refine again" writes the answers behind their questions (" Answer: ...") and the feedback as "- Round <n>:
..." under "Feedback:", then asks the Advisor for the next round; "Accept as refined" adds "accepted <date time>" to
the block's first line. The board writes only that block, as for Close (`src/tick.mjs`, `POST /api/backlog`, only on
the board that delivers). While a round is asked and not written yet (on its way, or arrived less than half an hour
ago), the window says so and the server refuses a second ask.

**Refine questions in sight (B287).** The person, on goal G17 (2026-10-17): refine questions waiting for them stand
under Needs your attention, one line per step, opening the step's window; the Advisor shows its refine state. Each
refine question is an ask of the work store (B299, `Via: refine`), but it gets no card of its own (`isRefineQuestion`):
the part "Refine questions" lists a line per step with how many wait ("B31 Fence the meadow: 2 questions", the step
waiting longest first, `refineLines`), counted once per step in the badge, and "Answer them →" opens the step's window,
where they are answered with Yes / No (B293). This replaces B275's "a refine keeps its own place". The Advisor's tab
shows beside its state what it refines ("Refining B31, round 2", "B31 to refine, on its way") or the answers that wait
for it to fold them in ("Your answers on B31 wait for it", `advisorRefine`); the Advisor's card on the Overview shows
the same once it is there (B280).

**A refined step is one compact description (B293).** The person approved what "refined" means on 2026-10-17 (the
project's spec of that day): "after the questions are answered i want them processes in the new design and i dont want
to see them anymore. the goal is to have 1 fully comprehensive description that is compact with pictures and summary.
that doesnt read like it was in progress text." The block now holds "Summary:", "Picture:" (a path and in brackets what
it shows, or "none (why)"), "Part of:" (its goal and milestone) and "Size:", and while refining one-line questions
with " Advised: yes|no, <why>" behind them. Once every answer is folded in, the Advisor writes it as "Refined (<date
time>; ready):" with "What we build:" (points; "Not in it: ..." among them) and no questions, feedback or round
(roles/partner.md). The window's head shows the goal, the size and "N questions for you" or a green "Ready" in place of
"Step". While refining, the box shows the summary, the picture as a thumbnail with "Open the picture ↗", and a line
per question: the advice (its reason on hover) and Yes / No; a pick is kept until it is sent, a second click takes it
back. "Send answers" writes the picks and the feedback and asks the next round; "Take the advice" (in place of "Accept
as refined") writes the advice as the answer to every open question the person did not pick, and says which question
has none to take. Once ready, the description stands first in the window, with no box, and the step's own lines follow
as its "Notes"; its foot has "Refine again". A ready block names no round: a refine ask counts as written once the
block changed since the ask (B285, `refineAsk`). Blocks in the older form (Problem, Goal, questions with a field)
still show as before; the server still writes "accepted" for them, though no button asks it any more. The window of a
step in a worker's queue shows the same description to read (its questions are answered from the Backlog tab), and
a finished step keeps its description without questions. A ready step refined again tells the Advisor to check it
against the backlog and the goals, since no new answers stand in it. With the work store, the step's window shows the
store's item (Summary, the picture as the same thumbnail, What we build with "Not in it" greyed) and the refine part
under it holds only the questions; the goal shows once, as the head's chip. A refine question answered under Needs
your attention is written into the block too (`withRefineAnswer`), and the lines the store adds under a step go above
the block, never into it; lines added after a block before this, and a lone bracketed line at its end, end it.

**Refined before a queue (B285).** The person, on goal G17 (2026-10-17): "every item on the backlog automatically Before
it gets put in the queue. if main wants to put it in the queue automatically/directly, refine it first". A step is
refined when the first line of its block says "; ready" (the person approved what "refined" means on 2026-10-17: one
compact description with a summary, a picture, its goal, its size and "What we build", the answers folded in; the
older form, also answered or accepted, is not refined; `src/backlog.mjs`, `isRefined`; the new lines stay inside the
block).
At every look the board that delivers does by itself (`src/refineGate.mjs`), only while no refine is open, the person's
neither: it sends one step to the Advisor in the Refine button's words, first a step the person asked to queue, then
a step the main chat queued before it was refined, then (B312) a step, also an old one, the person answered on after
its block was last written (an ask under it, its refine questions, or accepting the refine, by the step's History),
then a new step (above the highest one on the backlog at its first
look, kept in `data/refine-gate.json`), each until it is ready: once with no block, and once more each time its block
stands answered and not ready (an ask remembers the block it was about, `before`); never the person's steps, finished
ones or steps in progress, and never a block with questions open, which waits for the person's answers. The board's
own asks stop at three per step that arrived and three that did not, with 15 minutes after one that did not; B312:
only the rounds sent since the person last answered on the step count (`refineStop`), so a new answer gets its fold
round. Seen live 2026-10-18: the person answered Q31 under B35 at 13:01, the Advisor's card said "Your answers on B35
wait for it", and nothing was sent, as B35 was an old step not about to be queued. A step the board stopped on has
the refine state `stopped`: the Advisor's card says "Refine of B35 stopped after 3 rounds without new answers" with a
button "Send again" (one round, in the Refine button's words; the person's rounds never count towards the cap), and
the Advisor tab's Refine list has a group for it. "Add to queue" on a step that is not refined is held on the
board ("Refine, then queue") and goes to the main chat by itself once the step is refined; it is dropped when the step
is finished, queued or gone. Without an Advisor nothing is held. A step the main chat queued before it was refined is said to it once it is
(`step refined`, Step, For; the board keeps the steps it saw queued while not refined), so it hands the step out then
(roles/main.md, point 0). Old steps are refined when they
are about to be queued, not all at once; the steps that were queued already at the first look go as before (kept
with `since` as `queuedBefore`), so a board that starts refining does not send the whole queue to the Advisor.
Without a Workers mod nothing of this runs.

**A step's asks are its refine questions (B309).** Seen live on 2026-10-18: the board sent the Advisor a fold round for
a step whose block listed no questions of its own while two asks under it, filed by its worker, were still open. Every
ask under a step (`Of: B<id>`) now counts as one of its refine questions wherever the board decides
(`src/work/stepAsks.mjs`, `refineAsksOf`; folded into the step's `refined` as `asks`, backlog.mjs `withAsks`): one
that is open makes the step wait for the person ("Your answers waiting" on the Advisor tab, no round sent, not refined,
also on a ready block); one answered since the block was last written waits for the next round, as an answered
question in the block does, so the board sends one fold round once the last is answered (its words name the asks);
the refine's own questions (`Via: refine`) count there through the block, which holds their answers.
Which came last is read from the step's History ("Q<n> answered" after "refined, round n" or "refined is ready"), else
from the times, the same minute counting as after. `work refined` is refused while any ask under the step is open,
naming them; a queue asked before the refine waits for them and for that round (`queueAsked`, the guard "a queue was
asked before its refine"), and Main's queue of a refined step with such asks keeps the wish the same way. A step with no
block keeps its first round: an open ask holds back only a fold round.

**Stop, move or take out of the queue (B83).** The person, 2026-10-14, of the two choices: "1. A" (stop lets the worker
reach a safe point: work committed and pushed, nothing new started) and "2. A" (the main chat makes the change). A
worker's "⋯" menu has "■ Stop its task" for a worker on a task; it asks once ("Stop its task? It finishes what runs,
saves and shares its work, and starts nothing new." with "Stop it" and "Keep going"), then types `stop task` (Name,
Task, Why) into the main chat. The window of a step in a queue (the main chat's queue too) has "Move to" with a list
of the other workers and "Take out of the queue"; B301 (the review): they change the work store at once through the
work API as the person (`requeue` with `for`, `unqueue`, Main and the person only; flow.json: queued → refined or
new), and the board delivers the step to its new worker; no words go to the main chat for them. A stop is shown as
asked while it is on its way and for a while after (`changeAsks` in the state); the server reads the worker from its
own state and refuses a stop that was not confirmed. A click on "⋯" no longer
also opens the worker's window. The picture: `art-inbox/worker-board/b83/2026-10-14-b83-stop-move.png`.

**Out of sync? (B438).** The person, 2026-10-19 (I43): "I want an help/alert button, where i believe the board and the
worker is out of sync, i press the new button and somebody goes to investigate it and fix it." That day's cases: a
worker shown free with a step held by a finished one, a worker paused for the limit and never woken, a step shown
"waiting for you" whose ask went to the partner. A worker's "⋯" menu has "Out of sync?", and the Workers panel's head
has one for the whole board beside "+ Add worker" (none for the main chat itself: the board's covers it). It types
`check sync <name>` (or `check sync board`) into the main chat with what the board shows, read by the server from its
own state (`src/say.mjs` `syncWords`): the worker's state, whether its chat runs, the steps the store holds for it
(`storeSteps`, whatever its card says), its card, its queue with why each step waits, its open asks (those of the app's
question form too), the board's flags on its row, a pause and the limits; for the board a line per worker, the steps not
handed out and the board's flags. The main chat compares it with the store, the chat and the limits, fixes what it can
at once (unblock, wake, requeue, withdraw), makes a board fix step of the rest, and answers with a note to the person
that starts `Sync check of <name>:` (roles/main.md, "Check sync"); only the main chat's note to the person counts, not a
worker's note or one to the main chat with the same words (B439). The row (or the panel's head) says the check is on
its way or with the main chat, then shows that answer for an hour (`src/sync.mjs`, `changeAsks.sync`); one open check
at a time each, open until the answer or for half an hour after it arrived (or was copied for the person to paste).
Only an answer newer than the last one when the check was asked counts (`seen`), as the store keeps minutes. The
answer is in the log as any note.

**The Workers panel (B159).** After the picture the person agreed on the Design tab
(`art-inbox/ideas/any-improvement-to-this/v2.png`; their words: "Any improvement to this to make it nicer. dont change
the style too much", "the color of the icon is corresponding with the status in the column after that", and of the
queue "i prefer to retain that information"). The lanes sit in one panel, "Workers", with "+ Add worker" (B124) in
its head and the columns named: Worker, Current task, Progress, Est. time, Queue. A row is slim: a chat icon in the
colour of its state, the name and its state as a tinted label in the same colour; the task with what it does now;
a bar of its steps with the step line (B108) under it; its time; the first queued step with the queue's length,
why it is not started (B113) and "+N"; and "⋯", which unfolds the whole queue, the details and Remove (B143), whose
warning still shows under the row. The other parts of the Overview are as they were. The picture:
`art-inbox/ideas/any-improvement-to-this/2026-10-14-b159-result.png`.

**Talk to Main (B161).** The person, 2026-10-14: "I want a place in the overview to talk to the main chat to assign new
tasks", "include the 'for you' as is", "add tabs there so i can swap between the two" (the picture they agreed:
`art-inbox/ideas/i-want-a-place/v2.png`). The Overview's right side has two tabs: "For you", as it was, with its
count, and "Talk to Main" (the main chat's name from the list of chats), a chat with the main chat: what the person
types is typed into the main chat as the advisor's tab does ("(typed on the worker board, HH:MM)" under it), and the
main chat's answers show with their times. The talk holds what the person typed to the main chat, in its chat or on
the board, and the main chat's answers; the workers' reports and what the board types for itself (its words for the
main chat, an answer to a card) are left out. An answer reads in its parts: its "For you" block as a quote, its
closing block line by line, "+" green and "-" red. The head says whether the main chat's chat runs. The tab that is
open is kept in this browser. Not built: the picture's "Task proposal" card and answer buttons, which the person's
words did not ask for. The picture: `art-inbox/ideas/i-want-a-place/2026-10-14-b161-result.png`.

**The Advisor (B173).** Step 1 of the design the person approved on 2026-10-14
(`.claude/specs/2026-10-14-advisor-design.md` in the project). Their rule: "information needed for how the advisor
behavies is part of the worker board, but informaion i give it and what goes from there needs to be stored in the game
repo itself." So the job description, in general words, is the board's `roles/partner.md`. What one project sets is
in `config.json`: `backlog`, `gamePlan`, `advisorDecisions`, `advisorReadFirst`, `advisorSuggestions`, `morningRound`
("" leaves it out), `weeklyRound` and `morningSkipPercent`. The paths stay inside their folder. The board's clock
(`src/rounds.mjs`, written down in `data/rounds.json`) types `Round from the board's clock: morning` at the morning
time, and `...: weekly` right after the weekly limit resets (as the limits bar reads it), into the Advisor's chat.
Under that line come the job's path and the project's settings, and a line saying it is the clock's, not the user's
word; it carries no "(typed on the worker board)" mark. A round missed while the board was off comes once at its next
start, and a weekly round takes that day's morning round with it. The morning round is left out on the day of a
weekly reset, and while the 5-hour limit is above 80%. The one line saying so stands on the Advice & Chat tab, not in
the Advisor's chat, so it spends no usage. At its very first start the clock only writes down, so a new board starts
no round at once. Only the board that delivers runs the clock, and only while there is an Advisor; a chat that is not
running is started through the main chat. The Advice & Chat tab shows when the rounds come; the open steps of the
backlog's "Advisor suggestions" group with their Why, Cost and Unblocks lines (answered under For you); and the game
plan from the game's repository instead of `.claude/advice.md`. The Advisor's talk leaves the clock's lines out. The
picture: `art-inbox/worker-board/b173/`.

**The way to the next milestone (B195).** The tab is called Advisor and has four parts under their buttons: "Next
milestone" first, then the game plan, the suggestions (with their count) and the chat; the part last opened is kept
in this browser. The person, 2026-10-14: "the main tab only shows some visual simplistic flow of where we roughly are
till the next milestone, looking an the backlog whats already there or whats missing", with "visual diagrams" and
"a recommendation to click yes no"; the chat is one of the parts ("i Do not want a 5th tab"). The Advisor writes the
map in the game's repository (`milestoneMap`, JSON, its form in `roles/partner.md`): the milestone, three to six
steps with the backlog steps that serve each and what is missing from the backlog, and one recommendation.
`src/milestone.mjs` counts each step against the backlog as it stands (done, open; an id not on the backlog counts
as missing), so the numbers stay current between rounds. The page draws the steps as a row of boxes (done, part done,
not started, and the milestone's own check last) with a bar of done, open and missing; a click on a box lists its
items under the row. "Yes, queue it" types "advisor recommendation: yes" with the step into the main chat, which
puts it on the backlog when it is not there and hands it out; "No…" asks why and types "advisor recommendation: no"
with the reason into the Advisor's chat. One answer per recommendation (its id); the box then says what was answered.
The mock-up the person agreed to ("1. yes. 2. yes."): `art-inbox/worker-board/b195/2026-10-14-b195-mockup.png`.
Since B260 (2026-10-15, the Advisor's check of the goal map's design: "piece 6 right after piece 1") the way is read
from the goal map, not from the JSON: the first goal with a `From the game plan: M<n>` line that is not done; every
sub-goal is a box of the row, counted over everything inside it (a sub-goal ticked by hand with nothing listed is
done), the milestone itself the last box (⚑, its Done when with its own Steps and Missing lines), its
`Recommendation (R<n>):` line the recommendation (none without a title). A milestone without sub-goals says its way
is not mapped yet. Which box is the milestone's never depends on a sub-goal's place, so adding one on the board
(B256) cannot turn it into the milestone. The counts are the same as the JSON gave for the same content; the
setting `milestoneMap` and the reading of `docs/advisor/milestone-map.json` are gone (`roles/partner.md` says how the
Advisor keeps the way in `goals.md`). The picture: `art-inbox/board-goals/b260-next-milestone.png`.

**The goal map, the outline (B255).** The person, 2026-10-15: "I dont want to be overwhelmed with too many things at
once. so e.g. 5 milestones is plenty but i dont want to see all steps for all milestones at once, a simple counter is
enough, the ability to click on a node/milestone can zoom in, and quickly zoom out seamlessly helps me maintain
overview and control." Piece 1 of the goal map (the design and plan of 2026-10-15 in the project's `.claude/specs` and
`.claude/plans`). The project's goals are one Markdown file in the backlog's form, `goals.md` (the setting `goals`,
`.claude/goals.md`; `examples/goals.md` shows the form): a goal is `- [ ] G<n> <title>` (`[~]` in progress, `[x]`
done), two spaces per level is "part of", and named lines under a goal (`Done when:`, `Steps: B37, B225`,
`Missing:`, `Also part of: G5`, `Enables: G1`, asks, notes, the game plan's milestone and its recommendation).
`src/goals.mjs` reads it and counts every goal over everything inside it against the backlog as it stands: the
goals inside, the steps (each backlog id once, done or open, an id not on the backlog as unknown) and the Missing
lines; a goal that is also part of another counts under its home only. A file with a mistake (an id twice, three
spaces, a line under no goal) is still drawn, with the mistake named in one line above it. The Advisor tab has a new
second part, **Goals**: one level at a time. At the top the goals stand as rows with their counters ("9 inside · 23
steps · 16 done · 7 missing"); a click on a row zooms into it: the crumb above says where you are ("Goals › Lava
Tactics › M1"), a frame shows the goal with its own lines folded to one ("Done when … · 1 ask pending ▸"), and the
outline keeps the whole tree with the goal's children open and everything else folded and dimmed; ▸ folds one more
level open without zooming. A goal that is also part of another stands under it as a grey ↗ row. ‹, Esc or a crumb
zooms out; the focus is in the address (`#advice/goals/G2`), so a link opens the map at a goal and the browser's
back walks the zoom. Read-only for now: the drawn tree (B257), editing (B256) and the Next milestone part from the
map (B260) come later; the settings `brainstorms`, `goalAsks` and `goalsHistory` are there for them. Pictures on
the real file: `art-inbox/board-goals/b255-top.png` and `b255-in-goal.png`.

**A goal's id everywhere on the map (B284).** Every box of the diagram, every row of the outline, every crumb and the
frame's head name the goal by its id before its title, "G17 The Advisor's work…", the id in a colour of its own
(`goalLabel`, `goalLabelNodes`), so a goal the person or the Advisor names by its id is found at a glance. A
milestone keeps its own mark after the id ("G2 M1 · The loop is fun"); a ↗ reference box or row has the arrow before
it; the top crumb, "Goals", has no id. The goal's title in `goals.md` is unchanged: renaming edits the title alone.

**Steps under no goal (B289).** Under the map, folded, one line "Not under a goal: N steps" (or "Every open step is
under a goal"): the open backlog steps with an id that no goal's `Steps:` line names, in the backlog's order
(`unlinkedSteps` in `src/goals.mjs`, the state's `goals.unlinked`); the Advisor's own suggestions are left out, as
they are not work yet. Opened, each step stands as a row with its id and title, and a click opens the step's window.
An open list stays open while the board redraws. The Advisor links them: roles/partner.md, "Steps under no goal",
has it add every open step to the `Steps:` line of the goal it serves at every round, and flag one that fits no goal
as a suggestion with a proposed goal.

**Editing the goal map (B256).** The person, 2026-10-15: "what is really important for me is the ability to quickly
reorder things and to abstract things away, and change abstraction level." The Goals part changes `goals.md` at once,
one change at a time, by the goal's id (`src/goalsWrite.mjs`): the file is read anew right before, the change made on
it, written beside and put in place (the ticks' `rewrite`), so another writer's lines in between stay; a goal that is
gone in between refuses the change with a line under the crumb, and the map is read anew. The frame of the goal
zoomed into has "+ Sub-goal", "Rename", "Done when…", "Why…", "Note…", "Also part of…" and "Enables…" (a search box
over the titles; a link shows with its × to take it away), and "Dissolve" (its goals lifted into its place) or
"Delete" (only without goals inside), each asking a second click. At the top, "+ Goal". In the outline: a click on a
row's dot steps open → in progress → done (done with open goals inside asks once); drag a row before or after another
(a blue line), into one (a dashed outline; a folded row opens after a second) or onto a crumb (a reference row takes
no drop). On a row's title, as in an outliner: ↑ / ↓ walk the rows; Alt+↑ / Alt+↓ move the goal among its siblings,
Tab or Alt+→ under the one above, Shift+Tab or Alt+← out after its parent; F2 renames; Enter adds the next goal after
it; the row's arrow and dot keep their own keys. Ctrl-click chooses goals, then "Group under a new goal…" puts them
under a new one where the first stood (a chosen goal inside another chosen one stays put). Ctrl+Z (and "↶ Undo")
undoes the last twenty changes made on this page, while the file still reads as the change left it; a change that
changes nothing is no change. A goal of the game plan keeps the plan's title and Done when and stays: no Rename,
Done when…, Dissolve or Delete there. A link line keeps any words of its own; only the lines that name a removed goal
change. A file that is not UTF-8 text, or indented with tabs, is not changed: the line says what to fix by hand.
Before the first change of a day the board copies the file to `goalsHistory` (`.claude/goals.history/<date>.md`).
Only the board that delivers writes; the demo and a show-only copy say "Read only here". An id is never used again
(B257, Game - Main's word for the spec's rule): the file keeps a head line "Last id: G<n>" (and "Last ask: A<n>"), a
new goal takes one more than the highest of it and the file's ids, and every new goal raises it; a file without the
line gets it under its heading at the first new goal. The picture: `art-inbox/board-goals/b256-editing.png`.

**The goal tree and the phone (B257).** The person, 2026-10-15: "like a diagram of nodes what is a part of what",
"I like style 1", and "for phone im okay with a simplified solution like B outline". The Goals part shows the tree
left of the outline, both on the same focus; a divider sets the outline's width (kept in this browser), and the
"Diagram" and "Outline" buttons hide either side (one always shows; kept too). The tree (svg, `goalTreeLayout`):
the goal zoomed into as the frame on top, the goals inside it as boxes of 150 by 92 in centred rows under it, as
many a row as fit, joined by a trunk to the first row, a spine left of the boxes to the rows below, a bus per row and
a drop per box, so no line runs behind a box; a box shows its state by its border (amber in progress, green done),
its title in two lines, its steps done and missing, its state, and "+n" when goals stand inside it; a goal that is
also part of it is a dotted box with ↗ and its home; an "enables" arrow is dashed between two goals in view, or comes
from a small dotted ghost when its source is out of view: the ghosts keep a column of their own at the right edge,
one per goal, at most three, then "+n more enable it". Lines and arrows take no click. At the top
the goals stand as boxes without a frame. A click on a box glides it into the frame (250 ms; none with reduced
motion) and zooms in; a click on the empty ground zooms out; hovering a box lights its row and the other way round.
A box is dragged after 6 px: its middle drops into a box, its quarters at the sides before or after it, the frame
last inside the goal zoomed into, a crumb into that goal; held over a box's middle for a second, the map zooms into
it and the drag goes on there; it lands where it is let go. On a phone (up to 760 px) the outline shows alone,
"Diagram" shows the tree alone, rows are taller, and every row has a "…" menu: Move up, Move down, Move into… (a list
of goals), Also part of…, Mark done, Rename, Dissolve or Delete (the game plan's own goals keep their title and
stay); there is no drag. The "…" is on wide screens too, faint until the row is hovered. Pictures:
`art-inbox/board-goals/b257-top.png`, `b257-in-goal.png`, `b257-in-milestone.png` and `b257-phone.png`.

**Hide done (B316).** The person, 2026-10-18: "i want an option to hide complete goals/milestone in the diagram". A
switch "Hide done" stands in the Goals part's bar after "Diagram" and "Outline", off by default and kept in this
browser (`goals-hide-done`); on a phone it stands behind the bar's "…". On, a goal hides from the diagram and the
outline when it is done and every goal inside it is done too (`goalsHidden`): a done goal with an open goal inside
stays, so nothing open disappears; a milestone is a goal too. The goal zoomed into and the goals on the way down to it
never hide, so a link to a hidden goal still shows it. A reference box or row of a hidden goal, an "enables" arrow to
or from it and its ghost hide with it. Where hidden goals stood, one line says how many: "+3 done hidden", under the
boxes in the diagram and after the goals that stay in each group of the outline; a click on it turns the switch off.
The switch counts what it hides, on or off: "Hide done (7)". The counters on boxes and rows, the "+n" badge and the
crumb's count stay as they are: they count everything. Pictures, the top of the map with one goal unfolded in the
outline: `art-inbox/worker-board/b316/hide-off.png` and `hide-on.png`.

**Asks from the goal map (B258).** The person, 2026-10-15, chose that the Advisor writes the map "through a
brainstorm or an ask" (spec 2026-10-15, section 4): an ask is a question to the Advisor tied to a goal, which runs
while the person does other things. "Ask the Advisor…" in the frame of the goal zoomed into (second, after
"+ Sub-goal") and in a row's "…" menu opens a box under the frame: the question (2000 characters), pictures pasted
with Ctrl+V or picked (at most four, kept as Talk to Main's are, `keepTalkFile`), Send. The words and pictures stay
while the map is drawn anew; Esc or Cancel closes the box. Send writes `Ask (A<n>, <date time>): <question>` under
the goal (`POST /api/goals` `ask`; the next ask id, kept from coming back by the head line "Last ask: A<n>"), then
types `ask from the goal map`, `Goal: G<id> <title>`, `Ask (A<n>): <question>` and `Pictures: <paths>` into the
Advisor's chat (`goal-ask`, `src/say.mjs`, to the Advisor only; a chat that is not running is started through the
main chat, as any word to it). Only an ask that stands under that goal, not answered yet, is typed, in the map's own
words; when the words do not reach the Advisor, the box keeps the ask with its words fixed and "Send again" types it
again, never a second ask (the review of B258). The Advisor writes `Answer (<date time>, <title>): …` and `More: <page>` under the ask
(roles/partner.md, "Asks from the goal map"; the page in `goalAsks`, `.claude/goal-asks`, beside the threads, not in
the game). The frame shows each ask as a violet block: the question with its id, time and "waiting for the Advisor",
or the answer with the pictures it names and "More ↗" (the page in the board's file window, from the project's
folder or the asks' folder), and the buttons "Make a step from this" (Talk to Main, prefilled with the goal, the ask
and the answer; B259 gives the main chat words of its own), "Ask again" and "Done", which writes `Read: <date time>`
under the answer (`read`). A read ask folds away with the frame's lines ("1 ask read"). An ask not answered or not
read stands in the tree as a violet dashed box after the goals inside (a click lights its block; nothing drops on
it), in the outline as a tag ("1 ask pending", "answer to read") and in the frame's line. An answer not read is a
line under Needs your attention, "Answers to your asks", with "Read it →" (the answer under its goal) and "Done",
and counts in its number. An ask and its read mark are messages, not edits: the page's undo leaves them alone. The
picture: `art-inbox/board-goals/b258-ask.png`.

**The brainstorm on the board (B259).** The person, 2026-10-15: "I dont like the brainstorming part of the worker
board. i still rely on explicity the brainstorm skill to help me think, ask questions with prompts that i can not do
in the UI", and of where it lives "B" (its own part, `where-brainstorm.png`); what it produces "C" (goals for the map,
steps for the backlog the person ticks, and a note under the goal); where the questions come from: one thread file per
brainstorm, written by the Advisor, shown and answered by the board, never an AI call of the board's (spec 2026-10-15,
section 5). The **thread** is `<brainstorms>/<yyyy-mm-dd>-<title's words>.md` (setting `brainstorms`,
`.claude/brainstorms`): the head the board writes (`# Brainstorm:`, `Goal: G<id> <title>` or `Goal: new`,
`Started: <date time> · State: running`, `Opening:`), the Advisor's context head under it, its questions
(`## Q<n> (HH:MM)`, the question, `Why:`, `- A: … (advised)`, `Picture:`), the board's `Answer (HH:MM): A — <words>`
(or `Other — <words>`, `skipped`, `back to Q<m>`) under each, and at the end the Advisor's `## Proposal (HH:MM)`
(`Decided:`, `Goals:` "- [ ] <title> — under G<id> or top — Done when: …", `Steps:` "- [ ] <title> — <worker> —
about <time>", `Note:`; a changed one under a new heading, the last counts) and the board's
`Created (HH:MM): <goals>; <n> steps asked of the main chat; left out: <titles>` (`src/brainstorm.mjs`, read and
written line by line, as the map is). The **Brainstorm part** is the Advisor tab's third: at the left
"+ New brainstorm… (about a goal, or free)" and the brainstorms, running ("question 3 waits for you", "with the
Advisor", "proposal to tick") and done ("→ G10, 2 steps", "discarded"); at the right the chosen one's card: what it
is about (a link into the map), the open question with its why, its options as buttons with the advised one marked,
"Other" for the person's own words (also as words with a chosen option), the picture of every option, Answer, Skip,
Back (asks the question before again) and "Enough, wrap up", the earlier questions and answers folded, and the
thread file in the board's file window. While the Advisor has the turn the card says what it does: "The Advisor is
thinking…", "The Advisor is on: <its card's line>" when it works on something else, or that its chat is not running
and the main chat starts it (Review Focus 4); no fixed time limit. The proposal shows what was decided, the goals
and the steps with a tick each (all ticked at first), the note, and "Create what's ticked", "Change…" (the person's
words to the Advisor) and, under the card, "Discard" (a second click). **Create** (`POST /api/brainstorm` `create`,
the thread's length as read: a thread that changed since is refused; a second Create, also at the same moment, is
refused, Review Focus 5) writes the ticked goals into the map (under the goal the Advisor named, else the thread's
goal, or at the top), each with its Done when, the note under the thread's goal (or the first goal made) as
`Note (brainstorm <date>): …`, and `Brainstorm: <path> (done)`, then the thread's Created line and state done; the
page then types one `backlog step from the goal map` per ticked step into the main chat (Title, Goal: the first goal
made or the thread's, Description: the brainstorm and its note, Time, Worker; `goal-step`, built from the thread as
the board read it), which writes the step and adds its id to the goal's `Steps:` line (roles/main.md, "A step from
the goal map"). A start writes `Brainstorm: <path> (running)` under its goal, so the outline tags it; one brainstorm
runs on a goal at a time ("Brainstorm this" on a goal with one running opens it). The words to the Advisor
(`brainstorm`, `brainstorm answer`, `brainstorm wrap up`, `brainstorm change`) are each made from the thread after the
board's own write, so one is typed only when the thread is where it says (no second `brainstorm` for a thread the
Advisor has; an answer only once written); a chat that is not running is started through the main chat. When
nothing comes back, "Type it to the Advisor again" beside the waiting line types the word the brainstorm waits on once
more; a step the main chat could not be asked for after Create is asked again with "Ask the main chat again for N
steps". The review of B259 also made the head's lines count once (a "Goal:" in the Advisor's context is context), a
question asked again under its number take its answer, a question like "Lanterns: where?" stay a question, a Done when
with " — " in it and "under G6 (words)" read, a left-out title compared as the Created line keeps it (its own " · " as
" - "), two starts on one goal at once make one thread, a question left open while it wraps up wait for nobody, and
lines the board cannot read show on the card.
"Brainstorm this" stands in a goal's frame, its "…" menu and under an ask's answer (the answer becomes the opening).
Needs your attention lists a question waiting and a proposal to tick under "Brainstorms", with the way to it, and
counts them; so does the part's button. The Advisor's job: roles/partner.md, "A brainstorm". On a phone the list
stands above the card, and the Advisor tab's buttons wrap. Pictures: `art-inbox/board-goals/b259-card.png` and
`b259-proposal.png`.

**The game plan, readable (B218).** The person, 2026-10-14: "advisor game plan has links that dont work i want to be
able to click them in the UI", and "too much text ... adding collapsing headers so this page feel more manageable".
In the Advisor tab's Game plan part every heading folds what stands under it, folded at first with its first line
beside it, so the plan fits on a screen; a part the person opened stays open while the page runs. Its links work: a
web page opens in a new tab; a file opens read-only in a window of the board (`/api/game-file`, `src/gameFile.mjs`),
read from the plan's own folder in the game, else from the project's folder (a plan may write its links that way),
never from outside them, only text files and pictures of at most 1 MB; a picture opens in the picture popup. Links in
a chat's words stay words. The Advisor keeps no open questions in the plan (`roles/partner.md`). Pictures:
`art-inbox/worker-board/b218/`.

**Whether a worker was compacted (B235).** The Workers mod 0.9.0 compacts a large worker after its report and writes `compacted: { at, before, after }` on its card, or writes `compactNote: { at, why }` when it does not. The board reads the newer of the two and shows one small line under the worker's name: "compacted at 16:40, from 820k to 95k tokens" in grey, or "not compacted at 16:40: <why>" in yellow; the whole line as its tooltip. Without the mod there is no such line. The picture: `art-inbox/worker-board/b235/`. Since clear after each step (2026-10-23, below) the same place says "cleared after B482 · log" when the mod cleared the worker (`cleared` newer than both), and a compaction's tooltip says why it was not cleared (`clearNote`).

**A picture in Talk to Main (B167).** The person, 2026-10-14: "i need a change so that i can post pictures in the 'talk
to main' chat in the worker board, from my clipboard". Ctrl+V in the talk takes the picture on the clipboard (PNG,
JPEG or WebP, 8 MB at most) and shows it small above the box, with a × to take it away; words on the clipboard are
pasted as words, and anything else gets a short line ("The clipboard holds no picture."). Send takes words and
picture as one message, also a picture alone. Only then does the board keep it: `POST /api/talk/picture`, checked as
the Design tab's reference pictures are (the board's own page, the bytes of a picture), into the project's
`art-inbox/talk/` under a plain name of the minute (`2026-10-14-1144.png`, "-2" for a second one that minute, never
written over). The message names it, and only a name the board gives in that folder goes to the main chat, never to
another chat. Typed into the main chat's chat it reads "words / Picture: <full path> / (typed on the worker board,
HH:MM)", so the main chat can open it; the talk reads the picture back from that line and shows it in the person's
message, and a click opens it large. The pictures: `art-inbox/worker-board/b167/`.

**A picture in the Advisor's chat (B282).** The person, 2026-10-17: "I want to be able to post picturures in this chat.
when talking via the board to you. from the clip board." The Advisor tab's chat box takes Ctrl+V of a picture as Talk to
Main does: the same types and size, shown small above the words with a ×, the same lines when nothing is taken, kept by
the board only on Send, and typed into the Advisor's chat with its "Picture:" line; its chat shows it in the person's
message, small. The board takes a kept picture to the main chat or the Advisor, never to a worker. Both boxes run the
same code (`pictureSlots` in `public/board.js`: one slot per box, with `setSlotPicture`, `keepSlotPicture`, `pasteInto`
and `wirePictureSlot`), not a copy.

**The Design tab's page (B99).** A fourth tab, after the person's layout A
(`art-inbox/worker-board/design-tab/2026-10-12-design-tab-a-side-by-side.png`): three parts side by side and "Ideas
so far" along the bottom. 1 New idea: the idea, what it is about (the kinds the board names), reference pictures of
the person's own (picked from disk, or pasted with Ctrl+V anywhere on the tab, B156), "Make a picture". 2 The picture: the version looked at, large; every version to choose from; "What
should change?" with "Make it again"; "I agree", which can be taken back. 3 Add what you want, open for "New idea" at
once, without a picture (B368), and for an idea once its picture is agreed (B379): title, description, requirements, the worker or the main chat's choice, an optional time; "Put on the
backlog" or "Put in a queue". The page reads `state.design` and writes only through `POST /api/design` and
`/api/design/reference` (the board's side, B101); it writes nothing into the backlog, the main chat does (the one
thing the board itself writes there is the tick of an approved step, B110, below). What is
typed stays in the page while it is open and is never drawn over by a new reading of the state. A board whose
server has no `design` says so on the tab.

**Your approval ticks a step (B110).** The one thing the board writes outside its own data folder. When you
approve a Verify step of the backlog whose work is merged, the board ticks the step itself ("- [ ]" becomes
"- [x]") and writes one line under it: "Approved by you on the worker board on 2026-10-12 at 22:40", with your
note when you gave one. No chat is woken, and the note is sent to nobody. Merged means: the step names no branch,
or one that is in neither the game's repository nor the board's any more; the board asks git anew at the click.
A step whose branch is still there goes to its worker, who merges; so does every approval when git does not
answer or the file cannot be written, so none is lost. A rejection, with your words, always goes back to the
worker, and an answer to a Decide or Provide step goes where it went before. "Done" on a Do step, what only
you could do, is settled the same way: ticked by the board with "Done by you on the worker board on ..." under
it, unless the step names a branch that is still there. When open steps waited for the
approved one ("after B55"), the main chat gets one line of the board's own that names them. Only the board that
delivers writes (the one in the repository's main folder); a copy and the demo never do. The file is read anew
right before, only the step's line and the new line change and every other byte stays, the new text is written
beside the file and put in its place in one move, and when somebody else wrote the backlog in between, theirs
stands and the board starts again from it. A step that is ticked already, gone, or there twice is left alone.

**The plan's limits (B113).** The person, 2026-10-12: "put a visual indictator of the sessions limits on the
overview page so i understand how much work we can still do and way maybe items are stuck in the queue instead of
in the worker", and "add the status for worker that they are suspended, instead of free or working. due to the
session limit." Of the mock-up, 2026-10-13: "pick only 1 location. preferable at the top on the same vertical axis
as the title". The picture is `art-inbox/worker-board/2026-10-13-b113-limits-result-demo.png`.

- *Where the figures come from* (`src/limits.mjs`). The board asks no chat and no service: reading the limits
  wakes nothing and costs nothing. The percentages are in a file the app keeps for its own usage card
  (`usageHistory` in `config.json`, by default `%APPDATA%\Claude\plan-usage-history.json`), renewed about every 15
  minutes while the app is open. The time a limit resets is not in that file. It is in a transcript: where a chat
  looked its limits up (once per 5-hour window is enough, the time does not move), and where the app stopped a
  chat at the limit. The person chose that Game - Main looks the limits up once after each reset, so the time is
  known. Without it the bar says "reset time not known yet".
- *The bar.* In the head, in the title's row, once: the 5-hour limit with its figure, its reset and how long that
  is; the week smaller beside it; and how old the figure is (marked when older than 20 minutes). Calm below 80%
  (`limitWarnPercent`), a warning colour from there, and at 100%, or while a stop's reset is ahead, "Limit reached"
  with when work goes on. After a known reset with no figure since, the bar is empty and says since when.
- *Suspended.* A state of its own, in place of working or free, in two cases. The app stopped the chat at the
  limit: its line is the last thing in the transcript, and names the time. Or a worker paused by itself: its last
  word to the main chat says in its first line "paused for the limit", with "until HH:MM" when it knows, and its
  turn has ended (the person's choice of 2026-10-13; a pause on the worker's card through the Workers mod would be
  the exact way, later). Only that phrase is looked for. B310: that word may be a message or a work note to the main
  chat (`work note --to main`; seen live 2026-10-18, Units' lane said it worked on); the newer of its last message and
  its last note to the main chat decides, a note's time read from its Since (to the minute; "until" is the next such
  clock time after it). A note's pause stands until, after the note's minute, the chat uses a tool of its own work or
  sends the main chat a message: its card, the work tool, the app's recap and a look at the limits are no work.
  B312: a worker's own pause also ends early once a reading of the limits taken after it (the board's own: the app's
  usage file, a chat's look at its limits; `src/limits.mjs`, `pauseLifted`) shows the window it paused for back: that
  window began after the pause (its reset time minus its length lies past the pause's start), or its use is below the
  percent the note names for it (the figure after "5-hour" or "week", else the only one; below 50% when it names
  none). Then the chat counts as not paused at all: free, or between two turns, with the hand-out and the "may wait
  for you" hint as for any chat. Seen live 2026-10-18: Units paused at 11:39 "until 14:40" at 92%, the limit reset at
  13:00, and its lane said Suspended until 14:40. Without a reading after the pause (also when the board only works
  out that a reset it knew of has passed), the pause stands. "paused for the weekly limit" pauses for the week. A
  suspended chat gets no step delivered and is no "may wait for you" hint. The lane says who held it and when it goes on; the time
  column shows that time. Nothing starts a chat by itself: once the time has passed the lane says the limit is
  back and the chat has not gone on, in the warning colour. A suspended chat asks the person nothing.
- *Why a queued step is not started.* One line on the step, the first of these that holds: a limit is reached; its
  worker is suspended; its condition is not met (the open steps it names by id, else the condition's own words,
  which the board cannot judge); its worker is busy, waits for the person or was cut off; or nobody handed it out.

**The board asks for workers (B124).** The person, 2026-10-14: "i want the capability that the main chat or the
worker board will will spawn the needed workers. if non exist scale up to three workers", to make the board simple
to start in a new environment. Of the mock-up: "1 yes. but if workers and main exists i want to show them both,
just like now". The picture is `art-inbox/worker-board/b124/2026-10-14-b124-result.png`.

- *The board only asks; the main chat starts the chats*, names them and gives them the shared briefing. The word
  it types into the main chat, as its other words: `spawn workers`, then `Count: N` (1 to 3), then `Why: no worker
  is in the list` or `Why: asked with the button` (`spawnWords` in `src/say.mjs`).
- *By itself, once.* When the list holds the main chat and no worker (the advisor is no worker), the board asks
  for three (`spawnWhenAlone`), at its minute's look, and only while the main chat's chat is open, so the word is
  taken and not lost. It asks once per empty list: again only after a worker was there since that ask (the
  history holds it) and all went. An ask that did not arrive is asked again with the button, not by the board.
- *The button.* Under the last lane, where a new worker shows: "+ One more worker" (one), or "Ask for three
  workers" while there is none. One ask at a time: an ask is open while it is on its way, and after it arrived
  until the workers came, for 15 minutes at most; meanwhile the button waits and the row says when it asked.
- *What the page says* under the lanes. The main chat and workers: every lane as before, and the button. The main
  chat alone: that the board asked, when, and what happens next, in words that stay true whether the main chat
  starts a worker itself or puts up a chip for the person to click. No main chat: how to make one, with this
  project's folder and the name the list of chats gives the main chat. No word names a project.

**Removing a worker (B143).** The person, 2026-10-14: "I need an option to remove a worker as well. I need a warning
if that worker is not free." Of the mock-up: "1. yes. 2. yes" (the look, and one click for a free worker with
nothing queued). The pictures are in `art-inbox/worker-board/b143`.

- *The board only asks; the main chat removes.* The word it types into the main chat: `remove worker`, then
  `Name: <the name in the list of chats>`, `State: <what the lane says it does>` and `Why: removed with the button`
  (`removeWords` and `workerState` in `src/say.mjs`). The main chat stops the worker at a safe point if it works,
  takes it out of the list, closes its chat and hands its queued steps on.
- *The control.* "✕ Remove" under the state of every worker's lane; the main chat's lane has none, nor a leftover.
  A worker that is free and has nothing queued is asked for on the one click.
- *The warning.* Any other worker (working, waiting for the person, suspended, cut off, unknown, or with steps
  queued) gets a warning under its lane first, which says what it is doing and what would stop, and names up to
  three queued steps. "Remove anyway" asks, "Keep it" closes the warning. The server reads the worker's state itself
  and refuses a worker that is not free unless the page says the warning was confirmed (`sure`).
- *One ask at a time per worker.* An ask is open while it is on its way, and after it arrived for 15 minutes while
  the worker is still in the list (`removalAsk` in `src/state.mjs`); meanwhile the control waits and the lane says
  when it asked. An ask that did not arrive, or a worker still there after that time, says so for an hour and can be
  asked again.
- *Gone when it left the list (B152).* The person, 2026-10-14: "the removing of a worker doesnt work". The main
  chat had taken the worker out of the list of chats, but could not close its chat (Remote Control was on for it),
  and the board takes its lanes from the app's open chats. Now a chat whose card says `{"left": true}` has no lane
  and is no worker for "No workers yet"; the rest of the list is made without it, so a new chat of its name is no
  leftover. For two minutes after the card was written its lane stays and says "Removed at HH:MM", then it goes; a
  card the board cannot date goes at once. A chat that joins again writes a new card and shows again.

**The timeline looks ahead.** It runs from two hours before now to at least six hours after it, and further when
more is planned (`hoursBack` and `hoursAhead` in `config.json`). What was is of little use to the person; what is
expected and queued is what they plan with.

**The right side is as wide as it is dragged**, on both tabs, and the lanes follow the room that is left.

**Where an answer goes.** The person talks with the advisor on the second tab, and the board answers the workers:
an answer is addressed to the chat that asked and to no other. The server checks each answer against the request
it is for (`src/say.mjs`) and keeps it in `data/outbox.jsonl`. Delivery is the bridge in the mod, as described
below, with one change the person confirmed on 2026-10-12 ("yes i want this to be picked up and queue if needed
or just removed from the backlog if accepted"): every chat of the project picks up what is addressed to it, where
the first design let only the main chat receive.

**The bridge as built** (`src/bridge.mjs`, and `hooks/board.ts` in the Workers mod, version 0.4.0). While it runs,
the board keeps `<project>\.claude\board.json` with its address and a key. Every chat in the Workers list asks
`POST /api/bridge/take` with that key, its own name and its session's id every few seconds. The board serves only
the session it shows under that name (B463: refusing another name, it says the name it shows that session under, so
a chat renamed in the app joins under it at its next take, or at a refused work call, which it then asks once more),
marks what waits for that chat taken, writes that down, then hands it out;
the mod types it into its chat as the person's own words and tells the board what was typed and what was not
(`POST /api/bridge/typed`), so the card says "handed to its chat", then "typed into its chat", or that it did not
arrive. The engine runs it once the chat is idle, so a busy chat gets it after what it is doing. The key only
takes: sending still needs the board's own page. A second board that starts while another one's file is there
and that board answers leaves the file alone. What remains, as with sending: a chat that wrote a `board.json` of
its own could have its own text typed into the other chats; that takes a deliberate act, and the mod's note
forbids touching the file. What is typed:

| The person | Typed into the chat |
|---|---|
| approves | `(answered on the worker board, 16:02) B14 "<title>": approved. Tick this step in the backlog.` |
| rejects | `... rejected. Reason: <their words>` and `Pick this up: now if it belongs to what you are doing, else as a step in the queue.` |
| marks done | `... done. Tick this step in the backlog.` |
| decides or provides | `... B67 "<title>": <their words>` |
| answers a chat that waits | `(answered on the worker board, 16:02) <their words>` |
| types to the advisor | `<their words>` and `(typed on the worker board, 16:02)` |

An answered card leaves Needs your attention at once and is no longer counted as waiting for the person (B307; the
person, 2026-10-18: "if I answer a question it shouldnt show up anymore"). With "Show closed" ticked it stands among
the closed ones in its answered look, dashed, and says where its answer is; an answer that did not arrive brings it
back open. What is sent to a chat that is not running makes
the board ask the main chat to start it, or another chat that runs when the main chat is off (`start <name>`, with the id the app
knows the chat by, at most every two minutes per chat; `wakeFor` and `wakerFor` in `src/say.mjs`, T9.4); the card and the advisor's tab say that it was asked, or offer the
button when it was not.

A request a chat filed itself says "Close this request." where a step says "Tick this step in the backlog.". An
answer waits for its chat however old (B548): the chat may be busy or not open. A line typed to a chat waits
`answerKeepHours` (48) and goes with its age once it is older than `messageKeepMinutes` (10). A delivered
answer keeps its request closed. A step that changed since it was answered (its words, or the lines under it)
asks again and shows the earlier answer: that is how a rejected step comes back after the rework.

**From advice to work** (the person, 2026-10-12): what the person agrees with the advisor, the advisor passes on
to the main chat, which hands out as before. The advisor still hands out nothing itself.

**A restart of the app** (the person, 2026-10-12: "I want to be able to restart claude, the worker board to
restart and reload. and then let the workers continue with what they were doing before the restart"; their
choices: the mod starts the board, the workers carry on on their click, no compaction on the way).

- *The board comes back by itself.* The boards run as children of the app and end with it. The project's list
  of chats names the launch entries to keep running (`.claude\chats\list.json`, "boards"); every chat in the list
  looks every 15 seconds whether each answers and starts the one that does not, as a child of its own process
  (the Workers mod, `keepBoards`). So the first game chat that opens after a restart brings the boards back, and
  a chat that closes hands its board on to the next one within seconds. Nothing is set up in Windows.
- *A new version, on the person's click (B142).* The person, 2026-10-14: "i want the board to show a little
  notification on top that a new version is available and I click it to start it. dont auto refresh. i want this
  notification visiually distinct, like the yellow we use somethwere." Whatever starts `node server.mjs` (the Run
  pane, a chat's Workers mod, a command) starts a keeper (`src/keeper.mjs`) that runs the board as its child with a
  channel; that process stays the one that was started, so stopping it, or the end of the app, ends the board as
  before, and a board whose keeper is gone ends too. The board knows the commit its folder was on when it started,
  and every 30 seconds whether the folder holds a newer one (`src/version.mjs`): a changed file of the server, or
  only of the page. Then a note in the yellow of "waiting for you" sits on top of the page: "A new version of the
  board is available. Click to start it." A click (`POST /api/restart`, from the board's own page only) first loads
  the new version once in a process of its own, and refuses with the reason when it does not load; else the board
  answers, ends with code 75, and its keeper starts it again, with the key the chats' mod knows, so nothing waits
  for a chat in vain. The page then loads itself anew. A newer page alone needs no new start: its note loads the
  page. (Nothing started anew by itself until B454, below.) The top bar says which version runs: "Board 9beb081 · since 09:48". A board
  started without the keeper (one from before B142) says so and has to be started anew by hand once. The picture:
  `art-inbox/worker-board/b142/2026-10-14-b142-new-version-note.png`.
- *A new version, by itself (B454).* The person, 2026-10-20 (Q259 A, G11's re-check): nine of 65 questions in two days
  only asked to click that note or to start the board anew, and the goal map puts the noise among the questions in G15.
  Their earlier "dont auto refresh" (above) gave way to it. A newer *page* loads itself the next time the page is idle
  (`isPageIdle` in `public/board.js`: no dialog open, no field with focus or with words in it, nothing on its way), at
  most once a minute (`sessionStorage` `page-updated-at`), and a quiet note says so for 8 seconds. A newer *server*
  starts itself anew at a safe moment (`src/selfUpdate.mjs`, `lookAtUpdate` in `server.mjs`, every 3 seconds): no line
  taken by a chat and not yet typed (an outbox line in `taken`, under 2 minutes old), no result check and no reconcile
  pass running, no chat log being written (`chatLogs.pending`), no call of a chat (`take`, `typed`, `work`) being
  answered, not within 30 seconds of the last `save-log` (a chat being cleared after its step, and its fresh
  conversation's first calls), and no Pause all standing. The start is the one the click makes (`restartNow`: the
  settings file and the new version are checked first, B404's 10-second settle follows), so a start the board refuses
  is not tried again for 10 minutes. The note on top says what the board waits for in a quiet cool tone
  (`version.selfUpdate`); after 10 minutes without a safe moment it turns into the yellow "Click to start it" of
  before, the fallback, and a safe moment after that still starts the new version. Not in it: the chats (the Workers
  mod reaches a chat only when its process starts anew).
- *The page keeps asking.* While the board is away the page asks every 5 seconds and says since when; a board
  that is back has a new token, and the page loads itself anew. The board says for an hour that it was off, and
  from when to when.
- *Interrupted.* A chat whose transcript shows an open turn while its own file says otherwise was cut off
  (`isCutOff` in `src/state.mjs`): the file says waiting since after the turn began and the transcript has not
  moved on, or it says working and is no longer renewed. A chat whose process keeps no such file is never called
  interrupted. It is a state of its own, with the task the chat was on.
- *Off for one evening, on again.* On 2026-10-12 at 19:42 the person had every board stopped ("stop all worker boards. i
  will start 1 manually from main myself"), and the list under "boards" was empty while they checked the new board.
  Since 2026-10-13 it names "worker-board" again, on their yes of 2026-10-12: the board on 4310 comes back by itself
  after a restart of the app. An empty list switches the automatic start off; that is theirs to say.
- *Not running.* The two restarts of 2026-10-12 showed that after a restart no worker's chat runs until something
  starts it, and that a message addressed by a chat's name does not reach a chat that is not running. A running
  chat's mod asks the board every few seconds what waits for it, so the board knows who runs: a chat it has not
  heard from for half a minute is "not running" (`runningOf` in `src/state.mjs`). The lane says so, the advisor's
  tab says so, and `resume` names these chats for the main chat, which starts them through the app by their
  session's id. Nothing is said in the board's first half minute, or about a chat that asks from another session
  than the one the board shows.
- *Not running, not Working (B315).* Seen live 2026-10-18 at 16:32: after the app was quit and opened again, the
  Overview showed all four workers "Working" (their cards still said so from before the quit, and "resume" had ended
  their stop for the restart), while Needs your attention said three of them held a step but were not working. A
  lane that counts as working only by what is left of it (its card, its step, or a turn its transcript shows open)
  is stale (`isStaleWork` in `src/state.mjs`) when its process has not asked the board (`runningOf` not true) and its
  transcript has been quiet since before the app's last start, or when its process is known not to run and its
  transcript has been quiet longer than the grace time (`GRACE_MS`, 10 min). The app's last start is when it wrote
  the lock it holds in its own folder, above its chat list (`lockfile` on Windows, `SingletonLock` elsewhere;
  `appStartedAt` in `src/sources.mjs`); without it only the second rule holds. Such a lane is in the state `off`:
  its pill and its time column say "Not running", its task and step stay, it has no time, no "Now:", no "no sign of
  life", and a line under it says it does nothing until its chat is opened or the main chat starts it. It counts as
  not running for the restart banner and for `resume`, and after the grace time its step gets the `stuck` flag with
  **Start <chat>**. A chat whose process is known not to run gets no "may wait for you" hint (`idle hold`): its lane
  says it, and the two never disagree. Once its transcript moves after the app's start, or its process asks the
  board, it is read as before. B566 (X22: three working chats shown "its chat does not run" while they ran, as their
  takes came more than 30 s apart): a chat runs (`runningOf`) when its mod made any accepted call of the bridge in the
  last 30 s (a take, a work call, a typed report: `noteCall` in `src/bridge.mjs`), or its conversation was written in
  the last minute after the app's start; the takes alone no longer decide. The watch rule `working-not-running` names a
  worker whose card says it works while its chat made no call, took nothing and wrote nothing for over 5 minutes.
- *One board delivers.* Of two boards on one project the one that records is the one that delivers; a board
  started with `--history-from` only shows, refuses an answer and says where to give it. A board that starts
  takes the delivery over when the file names a board that no longer takes its key.
- *Two words, and the main chat does the work* (until 2026-10-18; replaced by *Pause and resume from the store*
  below; Pause 2 removed the word "prepare restart", restart.md and their reading). "Prepare restart" and "Resume all" type `prepare restart` and
  `resume` into the main chat, in the board's own wording; `resume` names the chats the board read as cut off.
  The main chat asks every working chat to stop at a safe point and writes who was on what into
  `<project>\.claude\restart.md`, and after the restart it brings them back from that file, then removes it. The
  board says how the preparing stands: who still works, and "Ready" when every chat is at rest and the file is
  written. A message from the main chat reaches a chat in the middle of its turn; what the board types waits
  until a chat is idle, which is why the main chat does the messaging.
- *Stopped once its safe-point line is in (B291; gone with Pause 2, 2026-10-18: no "Safe point:" line is read, and
  no lane is "Stopped for the restart"; a stop for a restart is the store's pause and the checkpoints).* The person, 2026-10-17, with a banner that still said "Still
  working: Support, Features" after all five chats had sent their "Safe point:" line: "board says we are still
  waiting put on backlog to fix/investigate this issue", and "part of B291 is that i want the workers to show status
  suspended." Why: "Still working" was read only from each chat's transcript, and a turn cut off by the main chat,
  then the stop word answered, looks as if it runs; the lines themselves were never read (and a word to the main chat
  by the app's id for it, not its title, was not known as one, nor for a pause). Now a worker whose word to the main
  chat, by its title or its id, starts with `Note from <name>: Safe point:` after the person's `prepare restart` (no
  `resume` after it) has stopped (`safePointNote`): its lane says "Suspended" ("Stopped for the restart at HH:MM ·
  waits for Resume"; its time column "Stopped for · Restart"), until it works again: a tool of its work after the line
  (a reply to the main chat's thanks, or its card, is not work), or until "resume". The newest restart word stays
  known for a day, so a restart prepared at night still stands in the morning; B314 (seen live 2026-10-18 at 16:19:
  two workers filed their line as a work note to the main chat, as the job texts allow, and the banner still named
  them as working): a note to the main chat whose first line is the safe-point line, filed in the minute of the
  prepare word or later, counts as the message does (`storeSafePoint`). The newer of note and message decides (one
  that says something else ends the stop); the note's time is when the transcript shows the work tool filing it, else
  its minute, so work after it in that same minute ends it too; "safe to restart" needs restart.md
  written after the last worker's line; a step waiting on a stopped worker says "<worker> stopped for the restart". The banner names
  only the workers with no line yet ("Still working (no safe point yet): ..."; the main chat, which does the
  preparing, is never waited for), then "Everyone stopped: safe to restart" once the main chat wrote restart.md,
  and says when it last wrote that file.
- *A word that was only copied (B315).* Seen live 2026-10-18 at 16:32: right after the app was opened again no chat
  ran, so no Workers mod had asked the board, and "Resume all" was kept as `copied` (B212's way for a board without a
  mod: the page puts the words on the clipboard). The banner then said nothing plain, and nobody resumed for ten
  minutes. Now the server keeps the words as they were copied with the message (`pasteText`), and the banner, for the
  newest word to the main chat that was only copied (`restart.copied`: "Resume all", "Prepare restart", a "Start",
  or any line to it), says "<Main>'s chat is not running yet: open <its title> in the app (or click it in the
  sidebar) and paste with Ctrl+V; the word is on your clipboard", with the app's id for the chat when the board
  knows it and a button **Copy again**. It stays until the main chat has taken it: the person's words in its
  transcript, since the word was copied, begin with the word's first line (then "Resume" shows as handed for a
  quarter of an hour), or a newer word of its kind went another way. The main chat's name and title come from the
  list of chats. Once its chat runs and the word is still not pasted, the line says that; on a PC without the
  Workers mod it says that no mod types it in. The bar on top that says words were copied names the same reason.
  Seen live again that day: the copied "resume" of 16:32 reached the main chat another way (another chat sent it by
  its session id), the main chat resumed every worker and deleted restart.md, and the banner still said to paste it
  long after. So a copied word also clears once it no longer matters (`stillMatters` in state.mjs): for "resume",
  once a turn of the main chat since the copy has the word "resume", whoever brought it (pasted, a message from
  another chat, the board); for any other line, once a turn of the main chat since the copy contains its first line;
  and in every case after two hours. (Pause 2: the restart file's part of this, `restartAt`, and the "prepare
  restart" word are gone.) A button **Dismiss** beside
  **Copy again** keeps the word dismissed (`dismissedAt` on it in the outbox, `dismissCopied` in store.mjs, through
  /api/say with `command: 'dismiss copied'`), so the banner leaves that word alone.
- *Pause and resume from the store, not from messages* (the person, 2026-10-18 20:25: "I feel like there should be a
  better way to do the restart and resume all workers? it doesnt feel reliable at all ... find a fundamental better
  way"; spec `.claude/specs/2026-10-18-pause-resume-design.md`). The old way was a relay of chat words (the board's
  outbox, Main's restart.md, the workers' "Safe point:" lines, the transcripts, the cards), and the banner guessed from
  all five. Now the state is in the store. *Checkpoints:* a chat writes its step's checkpoint with `work step`
  (`commit`, a hash or none, and `next`, the next action in one line), at least at every commit: the step's head holds
  `Checkpoint: <commit> · <next> · <date time to the second>` and History one line per checkpoint (`work/api.mjs`
  `step`; a taken step takes one too). *Pause is a flag:* **Pause all** (in place of Prepare restart, after a Yes)
  writes `<work>/pause.json` `{ "state": "pausing", "since": <ms>, "by": "person" }` through the page's work API
  (`pause-all`, the person's only); no word is typed to Main. *Safe from facts* (`work/pause.mjs` `pauseFacts`):
  "Pausing since HH:MM: still working: <chats running a turn now>; holding a step with no checkpoint since the pause:
  <chat (B<id>)>", then "Safe to restart" once no chat runs a turn (a lane working, not only between two turns) and
  every step held (taken, in progress, waiting on you or in review, as the work API holds it) has a checkpoint at or
  after the pause, to the millisecond. Working also counts background work a chat started, a lane the board cannot
  read, and a turn open behind a "suspended" that may be stale; a step held with no checkpoint by a chat the board
  does not show is named apart ("held by a chat not on the board: B<id> (<title>)") and blocks Safe too (the review of
  part 1). *Resume:* **Resume all** writes `resuming` (`resume-all`; also with no pause.json, for a
  chat that was cut off); when the main chat runs the board types `resume` into it, as before; when it does not, the
  banner says so with a link **Open <its title>**, `claude://claude.ai/epitaxy/<the app's id for it>` (title from the
  list of chats, the id from its app card), and its Workers mod reads the resume from the flag. The banner names each
  chat holding a step that has not started a turn since the resume (its last turn began after it, or it runs one now),
  once, with the steps it holds; once none is left, or 20 minutes after Resume all (*Resuming holds nothing*, below),
  the board sets `running` (`resumed`, the server's only) and the banner goes; **End resume** (the person's
  `end-resume`) does the same for a chat that will never start. `running` counts as no pause: the old "Resume all (N cut
  off)" shows again. The link is built only for an app id (`local_` and a uuid); while no mod has asked the board, the
  banner says whether the main chat runs is not known yet. *The mod reads it* through
  the bridge: `pause-state` on `/api/bridge/work`, and the same answer in `turn-ended`'s `pause`.
- *Pause 2: each chat stops and goes on by itself* (the Workers mod 0.13.9, `mods/folder-branches/hooks/board.ts`
  `pauseContexts`). The work tool's `step` takes `commit` and `next`, and its description says to write a checkpoint
  with every commit and when the person pauses. The mod reads the pause only in calls it makes anyway: `turn-ended`'s
  answer (kept as the last reading), and on a batch of tool calls `pause-state` at most once per 20 s, inside the 1.5 s
  the mod may hold anything; at a prompt only at the first one of its process, while the last reading was a pause or a
  resume, or when the words speak of a resume (then anew); at a session start (the classic SessionStart hook) once.
  Each line is given once, as context for the model, never typed: *while pausing*, at the chat's next tool batch, "The
  person pauses all chats: commit your work, write your checkpoint (work step B<id> --commit <hash> --next "<next
  action>"), then end your turn and start nothing new." (holding nothing: "end your turn and start nothing new");
  *while resuming*, to the main chat at its session start or the board's `resume`, "Resume: wake each chat below that
  has not started, by its session id with SendMessage, one line each: 'resume your step B<id> from your checkpoint'"
  with one line per holder that has not started (its app session id, else its CLI one, its step and checkpoint); to a
  chat holding a step, at its first turn after the resume, "You hold B<id>: checkpoint <commit> · <next>; go on from
  there." The same line goes in at a session start (or the first prompt of its process) while it holds a step and the
  person does not pause. A board without `pause-state` changes nothing. *Gone* (spec point 7): the word "prepare
  restart" (the board refuses it), `.claude/restart.md` (not read, `restartNote`, `restartAt`), the "Safe point:"
  lines and their reading (B291 `safePointNote`, B314 `storeSafePoint`, the lane "Stopped for the restart", the
  banner's preparing and resume lines, the restart word kept a day); the copied-word banner (B315) stays for the
  other words, and **Resume all (N cut off)** without a pause for chats that were cut off. The job texts: a worker and
  the partner write a checkpoint with every commit and stop as the mod's line says; the main chat wakes the holders
  from the mod's list and keeps no restart file (`roles/worker.md` "A pause of all chats", `roles/main.md`,
  `roles/partner.md`, `roles/protocol.md` "What the Workers mod puts beside a chat's turn").
- *The review of Pause 2 (fix first, 2026-10-18).* A rule changed with it (the coordinator's, from the design's intent):
  an app restart loses only a turn in flight; files on disk survive. So **Safe to restart** is no chat running a turn
  (working, background work, a lane the board cannot read, as part 1 built), none in the app's question form ("waiting
  for you (question form): <chat>", no longer "still working") and no line handed to a chat and not typed yet ("a line
  is being typed into: <chat>", `pending` from the outbox's taken lines). A step held with no checkpoint since the pause
  blocks nothing: the banner says it beside ("B313 (Board) has no checkpoint; it resumes from its branch and
  History."), and `pause-state` gives each hold its `branch` and last three History lines (`history`; the resume list
  its `branch`), which the mod's resume line uses instead: "You hold B313: no checkpoint since the pause; go on from its
  branch <branch> and its History: <lines>." A checkpoint from before the pause counts as none while resuming. *While
  pausing* (then until running; since 2026-10-19 until Resume all, *Resuming holds nothing* below), the board hands
  out nothing that starts a turn: no delivery and no check's word or note-wake
  (`deliverWork`), no pull (`pull`, also turn-ended's), no chat may be woken (`mayWake`), and a take hands out only the
  board's own `resume` to the main chat (`store.take`'s `only`); the person's own lines and answers wait in the outbox,
  shown "held until resume" (`isHeld` in the state), and do not grow late for the time the pause held them
  (`heldMs`, `isLate` with `keep.pause`; running keeps `pausedSince`). After **Open <main>**: once the main chat's
  process runs while resuming, it has had no turn since Resume all and the board typed no `resume` since, the board
  types `resume` into it, once (`resumeRetypeTo`, `pause.main.hasActed`). The mod: the stop line goes in at the first
  tool batch of every turn while pausing (once per turn), says "stop or wait for your background agents", and the
  cached reading is dropped at each turn's start, unless that turn's prompt just read it (one reading per turn's
  start); a free worker sends no pull while paused; the main chat's resume list goes in once per resume (keyed by
  pause.json's since, kept in the mod's own store, `pause-resume-given:<session>`, so a new process of the main chat
  does not say it again) and names only app session ids (`local_...`): a chat without one says "session not known
  (start it from the board)".
- *Resuming holds nothing (2026-10-19).* Seen live: after Resume all at 12:24 pause.json stayed `resuming` for two
  hours. The board held every line while resuming too, and set running only once every chat holding a step had started
  a turn: the person answered Worker 1's blocking ask Q188 at 12:41, the answer waited "held until resume", Worker 1
  never started a turn, so the resume never ended (a deadlock, until the person's End resume at 14:37). The banner also
  named a chat holding two steps twice, a stale hold (a step a chat holds but is not on) as one more. Now: *only pausing
  holds* (`HOLDS` in `work/pause.mjs`): while resuming every line is handed out as when running (answers, the board's
  wakes, deliveries, pulls, note-wakes, the resume words), since resuming is there to get chats started. *Running comes
  by itself* once every chat holding a step has started a turn since Resume all, or 20 minutes after it, whichever is
  first (`resumeEnds`, `RESUME_WAIT_MS`); the banner says when ("The board goes on without waiting at 12:44"). A chat
  counts once, whatever steps it holds (`waiting: [{ chat, ids }]`), so any turn of it counts for all of them. The
  board's `running` keeps in pause.json who had not started (`notStarted`), and for an hour (`NOT_STARTED_SHOWN_MS`)
  the banner says it as information, one muted line per chat: "Worker 6 did not start after the resume: B364."; a chat
  that starts a turn later is no longer named. Running also keeps when the resume began (`resumedSince`, also after
  End resume): *lines held while pausing* go out at Resume all and are not late for the time they were held, which now
  ends at the resume (`heldMs`: pausing until now, resuming until its since, running until `resumedSince`; a record
  from before it until its since). The Workers mod still sends no pull of its own while resuming (`isPaused`); the
  board's own delivery hands a free chat its queued step all the same.

**The Design tab** (the person, 2026-10-12: "i want to be able to prompt an initial idea. let it build a visual in
codex about what i want, present it to me, if i agree can add information to it what i want and put it either on
the backlog or in the queue"). The page is `public/`; this is the board's side (`src/design.mjs`, `src/ideas.mjs`,
`src/codex.mjs`).

- *An idea becomes a picture.* The person types an idea and says what it is about. The kind decides how the words
  for Codex open and which reference pictures go with them, so the picture matches the game's or the board's look;
  both are in `design.json` next to the server, which the person can change. Codex makes the picture in about a
  minute. To change it the person says what should change: the last picture is attached first, with the words to
  keep everything that is not named. Every version is kept.
- *Where things are kept.* The ideas, their versions and what was asked to change: `data/ideas.json`, there again
  after a new start (a picture that was being made then counts as failed). The pictures, each with the words it was
  made with: `<project>art-inboxideas<short name>1.png`, so a step can name the folder and the board shows
  them. A reference picture the person adds, picked or pasted: first `art-inbox/ideas/_references/`,
  under a name of the board's choosing; when the idea is made it moves into the idea's folder as `reference-1.png` and
  so on (B156).
- *The step is asked of the main chat.* "Put on the backlog" and "Put in a queue" type a word into the main chat,
  with the board's mark: the first line `backlog step from the Design tab` or `queue step from the Design tab`,
  then `Title:`, `About:` (the kind), `Description:`, `Requirements:` with its points, `Pictures:` (the folder and
  the agreed picture), `Worker:` (a worker, or "Game - Main decides") and `Time:` when given. A step asked from "New
  idea" has no picture: no `About:` and no `Pictures:` line, and no idea to show its id on (B368). The first line and
  the labels are the board's; every field is the person's own words, kept to one line. The main chat writes the
  step with its id and keeps the folder in its words, by which the board finds the step and shows its id on the
  idea. The board writes no step into the backlog; the one thing it writes there is the tick of a step the person
  approved (B110, "Your approval ticks a step").
- *Safety, because here the board starts a program that makes something.* Codex runs only on a call from the
  board's own page (the token, the page's origin, JSON), one picture at a time, with a time limit (`seconds` in
  `design.json`, 240), in a folder of its own under the system's temporary folder, which is removed afterwards. It
  is started without a shell, told to write in that folder only, and given the idea's own words and the reference
  pictures: nothing from a chat or a transcript. A reference picture is accepted only as PNG, JPEG or WebP by how
  its bytes begin, 8 MB at most. Codex is the command line the person is signed in to; the board holds no key.

**Pictures.** Pictures come only from the folders named in `config.json` (`pictureRoots`, the project's
`art-inbox`), and the path is checked on the real file.

**The game of a branch** (the person, 2026-10-12: "i want the link to open a game with the branch that contains
the code ... spin up a new game with new port ... find a way so it doesnt run indefinately if i close the tab").
Work to verify has one button, "Open the game on <branch>": the branch an ask names in `run.branch` or a step
names in its words, else `main`. The board starts the game from the working folder that holds that branch
(`run-game.mjs`, one process per folder, the folder's own vite and configuration) on a port of its own, from
`gamePort` (5300) plus the folder's place in git's list, and opens it in a new tab. The game ends by itself
`gameIdleSeconds` (30) after its last tab was closed, or when nobody opened it within `gameOpenSeconds` (120); the
board also ends its games when it is closed, and the card has a Stop button. The page names the request only: the
branch and the folder come from the board's own state, and starting needs what sending needs (the token, the
board's own origin, JSON). The board switches no folder to another branch: a branch that is in no working folder
cannot be started, and the card says so. Vite's cache for these games is kept in the board's `data/game-cache`,
so nothing is written into a folder's `node_modules` while a worker runs the game from it too. The Overview has
a "Run game" button that is always there (the person, 2026-10-12: "lets add the run game button in the worker
board"): it opens the game as it is on main the same way, and says which commit main is on and since when.

**Still to build in the branch:** a tool in the mod for a chat to file and close an ask; the plan line names the
chat's branch and when its task was named; and the line in the working agreement that tells every chat to file an
ask where it would write an `@you` step. Delivery is built and tested in parts, and not yet tried with a real chat:
that needs `/reload-plugins` in the chat that is to receive.

**On a phone, piece 1: the width (B206).** The person chose pieces 1 to 3 of `PHONE-PLAN.md` (B199: "1. yes"). Up to
760 px the top bar wraps: the tabs, in a box of their own (`.tab-list`, which counts for nothing on a wide screen),
scroll sideways on the first line, "Prepare restart", the version and "Last updated" go on the next; the limits box
stacks its windows. In a narrow Workers panel a worker's time takes the two columns beside its task (it sat in the
menu's narrow column and was cut). Up to 600 px a window fills the screen, its Send row at the bottom. The page is
then as wide as the phone in every tab; the Design tab's strip of pictures scrolls inside itself. The wide view is
as before. The pictures: `art-inbox/worker-board/b206/`.

**On a phone, piece 2: the order (B207).** Up to 600 px the Overview shows Needs your attention (with Talk to Main
beside it) first, then the head and the workers; the timeline and the folders are folded away under a button "Show
the timeline and folders". The tabs are a bar along the bottom with their short names, "Today", "Advisor" and
"Backlog" (each tab holds both names, `.tab-long` and `.tab-short`); the Design tab is left out. A backlog step's
state goes under its title, so the title keeps the width. The wide view is as before. The pictures:
`art-inbox/worker-board/b207/`.

**On a phone, piece 3: thumbs (B208).** Up to 600 px every button and field is at least 44 px high, an answer box
grows as one types up to 40% of the screen (`field-sizing: content`, and the page's own code where a browser lacks
it), and a picture opens the full width of the screen to pinch and move; a tap on the picture keeps it open, a tap
beside it closes it. With this the three pieces the person chose (B199) are built; the way in from the phone (piece
4) waits, until then Remote Control. The pictures: `art-inbox/worker-board/b208/`.

## What it is for

The person runs one main chat and four worker chats on Lava Tactics and loses track of who does what. Their words:
"improve managing the workers. by improving the visualization to show which workers we have, which tasks they pick
up, how longs tasks are taking, expectedly ... which tasks are queued", and "i can type to it which is the same as
this chat".

Decided on 2026-10-12:

- What is typed on the board goes into the existing "Game - Main" chat (the bridge below). The tool runs no Claude
  of its own.
- The advisor is a chat of its own, "Game - Advisor". It wrote `.claude/advice.md` until B173; since then it keeps the
  game plan in the game's repository, which the board only shows. The old file was removed (B176).
- The look follows the newest picture in `design/`. The first one is `design/2026-10-12-codex-design-1.webp`.

## The parts

| Part | What it does | Depends on |
|---|---|---|
| Readers | Turn each source into plain data: the app's chats, the workers' plan lines, the transcripts' tails, the backlog, the working folders. The formats are in `BRIEF.md` under "Sources" | the files only |
| State | Decides per chat: working, waiting for you, free, unknown (the table in `BRIEF.md`). The transcript decides whether a chat is busy; a worker's own line never does | readers |
| History | Once a minute, records what changed per chat in `data/history.jsonl`. Gives the start of a task, its first estimate, time worked against time waiting, and the timeline | state |
| Server | `127.0.0.1:4310`, serves the page, `GET /api/state`, and the chat box's endpoints. Node, no dependencies | all above |
| Page | Workers, For you, Queue, Working folders, Today, Advice, and the chat dock. Asks for the state every 30 seconds | server |
| Bridge | Delivers what is typed on the board into the main chat. Lives in the existing `folder-branches` mod | server, the mod |

The board works without the workers' help. A worker's plan line adds the step and the estimate when it is there.

## Done is free (B148)

The person, 2026-10-14: "worker 1 should be finished but it doesnt say so on the board, why is this?" A chat whose
turn has ended counts as working between two turns while something of its work is open: its card, background work
it started, a task handed to it, its step's branch. Its card can be left behind, and a command it started can run
on (a board it started for the person). Every chat ends its answer to the person with the closing block of the
project's CLAUDE.md, so the board reads that: when the answer that ended the last turn ends with "+ Done:   yes"
(`saysDone` in `src/transcript.mjs`), the chat has finished, and neither its card nor what it left running in the
background holds it. B310: background work has ended when the app's report of it (a task notification) names its
call, also a report that arrived in the middle of a turn, which the app keeps as a queued command (Units, 2026-10-18:
its review helper had reported at 11:34, and its lane still said background work ran). What others hold for it still does: a task the main chat handed over that is not reported, or
its step's branch. "- Done:   no" and "- Done:   partly" keep the reading as it was, and a turn that runs is never
read as finished. The demo's Cleanup is this case; the picture is
`art-inbox/worker-board/b148/2026-10-14-b148-before-after.png`.

A lane read as free, by "Done: yes" or by the app's own summary, shows no task, step or time from a card left
behind: only one dim line, "Last task: <text>, finished" (the person, 10:14: "units worker is in an incorrect
state", of Units shown free beside its old card's task and "22 min over its first estimate"). A chat that waits
for the person keeps its card's task: that is the work it waits on. The picture is
`art-inbox/worker-board/b148/2026-10-14-b148-free-lane.png`.

## A turn that ended without a closing message (B262)

The person, 2026-10-15: "this is out of sync. what is the root of this problem and how do we prevent this. it seems
to happen often that the worker board has old status." A worker had ended its turn and been compacted by the
Workers mod, and the board still showed it working, "no sign of life for 47 min". The root: after a /compact the
app writes an older stretch of the chat again at the end of its transcript, just before its compaction mark (in that
case 4 MB of it, more than the board reads), and that stretch ended in a tool's answer, which the board read as a
turn that runs. How the board reads a turn's end since then (`settleTurn` in `src/state.mjs`, `turnEnded` in
`src/transcript.mjs`):

- A compaction ends the turn before it: the app's mark (`system` `compact_boundary`) or its summary. A /compact runs
  only between two turns; the app's own compaction in the middle of a turn (`trigger: auto`) is followed at once by
  the turn's next entries, so it ends nothing for the readers of a task.
- The app's own state decides where the board has it: the app writes its summary of a turn (`postTurnSummary`) when
  the turn ends, and clears it, saving the file at once, when the next turn starts (its code, 2026-10-15). A current
  summary therefore says the turn has ended, whatever the transcript's last entry is. Its absence says nothing: the
  summary comes a moment after a turn, and some chats get none.
- Without the app's word, a turn whose last entry is a tool's answer, with every call answered, ended without a
  closing message once nothing was written for longer than `quietMinutes`. Before that it may still be thinking. A
  chat its card shows as cut off (see `isCutOff`) stays cut off.
- A task reported in a turn that ended this way is finished, as after a closing answer.
- "No sign of life" is left for a turn that truly runs: a step without an answer (B247) or a prompt without one.

A free lane says what the board knows and from where: "Ready for a new task · idle since 20:53, from the app", or
"turn ended without a closing message at 20:26, from the transcript". The demo's Audio is this case; the picture is
in `art-inbox/worker-board/b262/`.

## Time and estimates

- A task starts when it is handed over (the message from the main chat in the worker's transcript), or when its
  plan line first names it.
- The first estimate a worker gives is kept. The card shows time so far, the first estimate, and what the worker
  says now. Past the first estimate, the overrun shows in a warning colour.
- Since B185 that warning (Overdue) comes only when a worker is over twice its estimate and by at least 10 minutes,
  the person's yes against false alarms; a little over shows "12 min over" in the usual colour.
- **How long tasks really take (B185).** The person, 2026-10-14, after a simple task showed 60 minutes: "i only want
  structural improvements to improve the accuracy". `src/taskTimes.mjs` reads each worker's transcript, the past once
  and then only what it gained (an offset per transcript, kept in `data/task-times.json`; the tools' answers are
  skipped unread, so a 200 MB transcript takes under a second). B301: a task runs from the worker's own `work take
  B<id>` to its `work report B<id>` (the work tool's calls, never a message's words); a second take of the same step
  goes on with it. Only the time its turns run
  counts: waiting for the person, in a queue or with the board off does not; work sent to the background counts until
  the app starts the chat again (up to an hour); half an hour without a line in a turn does not. A task paused for the
  limit, or never reported, is left out. The area is `board`, `art` or `game`, from the step's "Touches:" line in the
  store, else its words; its estimate is the step's. The board writes `data/task-times.md`, the list the main chat and the workers read before they give
  a time (per area: how many tasks, the typical working time, how far estimates were off; an area under 5 tasks is
  still a guess), and shows "Estimates lately: 7x too high" on the Overview (its tooltip per area) and "estimate 1 h,
  took 6 min" in the Backlog tab's "Recently finished". The tasks of one step are one there. Nothing is kept by hand.
  The picture: `art-inbox/worker-board/2026-10-14-b185-task-times.png`.
- An estimate older than 15 minutes of work is marked as old. In step 4 the mod reminds a working chat to renew it.
- A lane's main figure is the time left ("24 min left"); the clock time it ends at is the small one (B95). A time
  that has run out says by how much ("12 min over").
- A working worker always has a time: its own, else the estimate of its step in the store, counted from the task's
  start and saying where it is from (B301: a hand-over's time is no longer read). A worker that works with neither is
  a fault, shown in the warning colour ("No time"). The main chat has no task to time.
- One turn can hold several tasks. When the board still showed another task the chat had named, a task starts when it
  was named (B94).
- A message that arrives while a chat works is not a user entry in the transcript: the app keeps it with the turn as
  a queued command; it opens and ends no turn.
- The steps of a task are one line in the lane (B108): which step of how many, the step's name and the time left for
  that step ("2/5 · Sheet and two views · 12 min left"), from `task.stepLeft` in the chat's card (B107). It counts
  down while the chat works; a step without a time says so. The names of all steps, the current one marked, open
  under the line on hover and when the keyboard is on it. The task's own time stays in the lane's time column.

## The queue

A step a worker is on is in progress, not queued, also when the step names no branch (a check, a comparison, a
merge): the step the work store holds taken, in progress or waiting on the person for it, else the open step of its
own that its task record names by id (B94; B301: a hand-over names none).


The queue stays in the backlog, so there is one list. The main chat writes each queued step so the board can read
it: `- [ ] <task> (for Units; after <condition>; about 40 min)`. The board picks out the worker and the time.

**Only what waits for a worker (B172).** The person, 2026-10-14: "i believe the queue is out of sync ... investigate
what caused this and try to prevent it". The board had counted every open step under "Next to hand out" as queued,
for the first chat its words named: Main's queue held B126 "(later; not handed out)", Board's held the person's
Verify steps. Now a step is queued only when its note names a worker ("(for Units; ...)"), wherever it stands; never
a step for the person (@you), and never one marked "later", "not handed out" or "not queued" in brackets. A step
under "Next to hand out" without a worker waits for the main chat; one for a worker the board does not know is
"Queued for nobody". (B301: a worker's message no longer ends its task: a step ends with `work report`.)

## The work store (B296, increment 1: the store, the migration, the flow)

The design: `.claude/specs/2026-10-17-work-store-design.md` in the project; the plan beside it in `.claude/plans`.
The work moves from prose (the backlog's lines) into records: one file per item in the folder of the setting `work`
(`.claude/work` unless set), a state per item, and the flow of states as data. Increment 1 built the store and ran it
as a shadow of the backlog; B301 removed the shadow (below): the store is the one source of the work.

- **An item** (`src/work/item.mjs`): `<id>.md`, a head of `Key: value` lines up to the first blank line (keys fixed
  per kind: step, ask, instruction, note; `Id`, `Kind`, `State`, `Since` always; `-` is none), then `## ` sections
  kept verbatim. A broken head is named by file and line; the item is still read as it is.
- **The flow** (`src/work/flow.mjs`, `guards.mjs`, `examples/work/flow.json`): per kind its states and its moves,
  who makes each (`by`: a role, `person` or `server`) and what must hold first (`when`, a guard by name). `mayMove`
  answers yes or one line ("B285: only main queues a step (flow.json)"); `nextMoves` lists the moves out of a state.
  A `flow.json` in the store folder replaces the default; one that names an unknown guard or state is refused with
  its name and the default stands.
  Focus 3: the partner (role advisor) and the main chat take, work and report a step queued for them as a worker
  does: queued → taken ("Blocked by all done"), taken → in progress, in progress → waiting on you and → review, and
  review → review are by worker, advisor and main, as the live project's flow.json has them.
- **The migration** (`src/work/migrate.mjs`, `line.mjs`): every step line becomes an item. Its line is kept as
  fields: `Title`; `Owner`, `Blocked by` (a condition of only ids, "B12 and B13") or `Waits for` (any other condition,
  "after today's board work", verbatim), `Estimate` from "(for ...)"; `Branch` from "(branch x)"; `State` (done,
  in progress with a branch, new when held back or not queued, queued with a worker, refined with a ready block);
  an `@you` step is an ask (`Asks: look | decide | provide | do` from Verify/Decide/Provide/Do, `open` or
  `answered`) that keeps its `B` id. When the fields alone would not give the line back as written, the head keeps
  the backlog's words: `Queue note` (a "(for ...)" with more in it, such as "now" or "with B280"), or `Line` (the
  whole line); the adapter uses them only while they still say what the fields say, so a changed field wins. The
  indented lines go verbatim under `## Context`; a refine block goes whole under `## Refined` (a mark in Context
  says where it stood), and its Summary, Picture and What we build lines are also copied into sections of those
  names; "Done on ... by ..." lines also become `## History` lines. A step without an id gets `L-<8 hex>`, a hash of
  its activity and its line's words, so it keeps its id when steps come or go around it (a second step with the
  same words gets the next of a row); an id twice keeps its first item, and the second gets such an id with its
  line, named as a problem. `activities.json` keeps the
  activities in order with their steps, their notes (the lines under a heading before its first step), the loose
  lines between steps and the head of the file. Nothing is dropped: the store written back as text equals the
  backlog line for line, blank lines aside.
- **The adapter** (`src/work/adapter.mjs`): the store as the backlog's text in today's form, read by the same
  `parseBacklog`, so `state.mjs` and the page need no change. Parity is a test: on a made-up backlog with every form
  of line, and on the real one when `BOARD_PARITY_BACKLOG` names it (skipped otherwise; no chat's words come into
  the repository).
- **The store on disk** (`src/work/store.mjs`): `readStore`, `writeItem` (read anew, written beside, put in place;
  refused when the file changed since it was read), `nextId` (above `last-ids.json`, read value by value so a broken
  file still counts, every file and every id being given: one at a time per folder in the process, and claimed with an
  `<id>.claim` file that only one process can create; an id never comes back), `appendHistory`, `writeStore` (only
  the files whose text changed; Since and History carried only within one step; a step with an id that left the
  backlog keeps its file and is named as a problem, never deleted; an id-less step's file, only ever a copy of its
  line, goes with it; `last-ids.json` never lowered).
- **What you see**: under the Backlog tab's head one line, "Store · 370 items · backlog.md is its view" (the problems
  on hover); in a step's window a part "Flow": the strip of states with the step's own marked, and the moves out of it
  with who makes each.
- **The command**: `node tools/migrate-backlog.mjs --backlog <file> --work <folder>` prints the counts, the problems,
  the parity, the steps in flight and the goal map's step ids the store lacks, and writes nothing (B301: see there for
  `--make-store` and `--init`).

## The work store, increment 2 (B297): the API, the view

- **The API** (`src/work/api.mjs`, `workApi(body, ctx)`): every action of the `work` tool and the page, one request at
  a time per store folder (two takes of one step never interleave). The chats: `next` (my open instructions, then my
  steps by state in one line each, the first in full), `take` (a step queued for this chat: the board moves it to
  taken, the chat to in progress, with its branch; a step another holds is refused naming the holder), `step` (one
  History line; the mod writes the card), `ask` (a `Q<n>` under a step, answered with the "For you" block; a blocking
  one moves the step to waiting on you), `note` (an `N<n>` to the person or Main), `report` (in progress → review,
  "check pending", a note to Main; B304: from review, by the flow's move review → review, the check runs again),
  `block`/`unblock`, `new`, `queue`, `close` (an instruction), `drop`, `refine` and
  `refined` (the Advisor's block in today's form). The person, on the page: `answer`, `tick` (close, approve, done: a
  step in review is done, any other dropped; an ask answered), `delete`, `refine-answer`, `refine-accept`, `recheck`
  (B304: "Check again" on a step in review whose check failed). The board:
  `check`. Every move asks the flow (`mayMove`) and writes `<from> → <to>` in History; a file whose head is broken is
  refused with its line, never moved. B301: a store folder that is not there or cannot be read is refused with 503
  and the board's line for it (`work/read.mjs`, `storeFault`); a file that changed meanwhile is 409, one that cannot be
  written 500.
- **The view** (`src/work/view.mjs`): backlog.md is written from the store after every change,
  in today's form, its first line `<!-- generated by the worker board from <work folder>; edit nothing here -->`.
  What a step's line cannot say (taken, review, a goal, Blocked by beside Waits for) stands in one line under it,
  `[store] State: taken · Goal: G17` (`adapter.mjs`, `storeLine`), and the migration reads it back: the view
  migrates to the same items (heads without Since, sections without History). A dropped step stands ticked. Free text
  the API adds to a step (a report, a drop, an ask under it, an answer) goes in as lines under it, so the view shows it.
- **The routes**: `POST /api/work` for the page (the token, the origin, JSON, as `/api/backlog`) and `POST
  /api/bridge/work` for the Workers mod (the key, and only the chat and session the board shows, as `/api/bridge/take`).
  Roles come from the list of chats (the main chat, the Advisor, the workers); free chats from the lanes; `overlaps`
  from the steps' "Touches:" lines. After a report the board runs its own check (`src/work/check.mjs`) and writes it
  to History; a passed check closes the step by the default flow. B304: it checks the one repository the step's work
  is in, among those the board knows (the game's, `gameRepo`, and the board's own folder): the one that holds the
  reported merged commit, else the one that has, or had by its reflog or its remote, the step's branch. There its
  base equals its remote, the branch is gone (also from the remote), and a result is named; the lines name the
  repository by its folder's last part. When no repository can be told, the check fails with "could not tell which
  repository B<id>'s work is in", never a silent pass. B363: a step whose work is outside git (pictures or pages
  in the project's folder: taken with branch `none`, or on no branch of its own, a repository's base or none, and no
  merged commit a repository holds) is checked by its files: those its Touches name (2026-10-25: no longer those its
  result's prose names, which only warn), in the project's folder outside every repository: a word with a "/" and a
  file's ending or a "/" at its end must be there;
  another ("and/or", "B1/B2/B3", a date) counts only when it is; one inside a repository is work in git, to be reported
  with its merged commit: "work outside git", "there: ...", "not there: ...", "in a repository: ..." (B353, B347).
  B580: a branch named at the take that no repository has or ever had (every repository answered, none has a trace)
  counts as no branch of its own, so such a step is checked by its files too; a git that does not answer never does. The
  review of B363: work merged on a repository's base branch itself passes without "branch gone" ("worked on main
  itself"). Worktree clean-up (2026-10-24): the check also confirms that no worktree of the step is left: none of
  that repository on the step's branch, none of a repository the board knows named for the step (its id as a whole in
  the folder's name, `game-b12`), and no folder of one in the project folder (empty, or holding a `.git` file, or named
  `<repository's folder>-...`); a result check's own `check-b<id>` folders are left to `checked`. Each leftover is one
  line with its path and how to remove it ("git worktree remove <path>, then delete the empty folder Windows may
  leave", its link alone first when it holds one), and the pass says "worktree gone". A failed check runs again on the person's "Check again" (the
  lane's flag, `recheck`) or the owner's report from review. The board that delivers writes backlog.md; a copy with a store of its own
  writes the view into that folder; a copy without one only reads. The Backlog tab's line says "backlog.md is its
  view".
- **The board's own writers** (`src/tick.mjs`): closing, deleting, the person's refine answers and the board's tick of
  merged work go through the API as the person (B301: only so; the writers of backlog.md's lines are gone, and the
  refine-text helpers live in `src/work/refineText.mjs`).
- **The work tool** (the Workers mod, `hooks/register.tsx`): `work` beside `chat`, registered in every chat of the list;
  each call goes to `/api/bridge/work` as this chat (its name and session are the mod's to give, never the call's) and
  answers the board's text, or one line when the board is down or refuses. `take` names the card after the step and
  `step` moves the card as the chat tool's `plan` and `step` do; a subagent may only read (`next`, `list`). The note
  every chat gets names the tool in one line.
- **Making the store** (B301's `--make-store`, the cutover of 2026-10-17 by another name: `node tools/migrate-backlog.mjs
  --backlog <file> --work <folder> --make-store [--dry-run] [--chats <folder>]`): the migration into an empty folder,
  the old file kept as `backlog.before-store.md`, the view written. It first proves parity and the view's round trip
  and refuses otherwise, and refuses a backlog that changed while it ran. It prints the steps in flight (id, state,
  owner, branch) and each chat card with a task beside the store's state of the step it names, "<- check" where they
  disagree. The dry run prints the same and writes nothing.
- **The review's findings**: the chat that asked may `withdraw` its ask (the step goes on; a
  report from waiting on you is refused until then); `take` claims a step in progress that names nobody ("claimed"),
  and the table of `--make-store` marks such steps; the person's close is `done` from any state (flow.json: `* → done` by the
  person), dropped only through `drop`; `answer` and `withdraw` write the step first and put it back when the ask
  cannot be written (500, nothing changed); a chat asks only under its own step or one nobody holds (Main and the
  person under any). `--make-store` reads the store back after writing it and leaves backlog.md as it is on any
  difference, and writes the view from the store it checked.
  The view keeps the hash of what it wrote (`<work>/view.json`): a backlog.md edited by hand since is kept beside it
  as `backlog.edited-<date>-<time>.md` before the view is written, and the board's top line names it while it is there.

## The work store, increment 3 (B298): every word of the person's is filed

- **Instructions** (`api.mjs`): `instruction` files the person's words to a chat as `I<n>` (`Chat`, `State: open`,
  `Since` to the second, `Via: chat | board`, `Text` in one line, the words in full under `## Text`) and answers
  "Recorded as I17; close it with work close I17 --as ...", with the chat's open ones (`open: [{ id, turns }]`).
  `turn-ended` (with `since`, when the turn started) marks every instruction of that chat filed before then and still
  open as missed once more: `Missed: n` and a History line "server: missed: a turn of Main ended without closing it".
  The instruction that opened the turn was filed before it started, so a turn that answers without closing it marks
  it; a line that came in while the turn ran waits for the next one. Nothing is closed for the chat: `close` does
  that, and answers which stay open. `next` names a missed one with its turns.
- **The Workers mod** (`hooks/register.tsx`): on `prompt.submit` with an origin of the person's own typing
  (`composer`, Remote Control's `bridge`, the desktop app's `sdk`; never a line the board typed, which comes as
  `plugin`, nor one pasted by hand with `[I<n>]` at its end or the board's mark, never a slash command) it files the
  words before `next(e)`, also while a turn runs, so a prompt the app holds is filed when submitted. Beside the prompt,
  as its context for the model, go "Recorded as I17; close it with ..." and "Open instructions: I17 (new), I15 (2
  turns)"; the composed system prompt never changes with them, so it stays cached (review). On `turn.complete`
  (reason answer, the chat's own turn, once) it sends `turn-ended` with the turn's start; `Filed` keeps the
  millisecond an instruction was filed, so a line typed a moment after the turn began is not counted for it. Every call
  of the mod's own to the board waits 1.5 s at most and goes on without it; a refusal (B301: a board without a work
  store answers 503) changes nothing for the chat, and the next call asks again. A chat started anew asks once
  (`next`) for its open ones.
- **A line typed on the board** (`say.mjs`, `withInstruction`): Talk to Main or a line to any chat is filed as the
  person's instruction first and goes with its id at its end ("Queue the menu [I17]"); an answer to a request and the
  board's own words are not filed.
- **What you see** (`work/lists.mjs`, `instructionsOf`; the page's `instructionGroups`): under Needs your attention a
  part "Open instructions", per chat: the missed ones first, in red with their turns, then the open ones, then the
  ones closed within a day, grey, with "→ <Closed as>". The main chat's name opens the talk with it. Since the calm
  panel (2026-10-19) the part stands in the log, folded at the bottom of Needs your attention; a missed one also stands
  among the asks as one red line (see "A calm Needs your attention: the log").

## The work store, increment 4 (B299): asks by kind, the three lists

- **Asks** (`api.mjs`): `ask` answers the "For you" block in the project's form: one numbered item, "**Answer:**"
  (decide, look) or "**Do:**" (provide, do), the options with the advice (`advice`: "A thin or B thick; I advise B"),
  the id, kind and step ("Q4, look, blocks B1"), and a link per picture and play that opens the board
  (`http://127.0.0.1:<port>/#picture=<path>`, `#play=<branch>&<settings>`). An ask may stand alone (no `of`): the
  Workers mod files each question of the app's question form (AskUserQuestion) as a decide ask, `Via: form`, under the
  card's step when the board takes it there; the person answers those in the chat, and the mod then sends
  `answered-in-chat` with their choice or their own words (or `withdraw` when the form was closed unanswered). Any ask
  of its own a chat closes the same way when the person answered it in the chat. B305: an ask with no asking chat (no
  Owner, or "-": one carried over from the old backlog, which kept its B id) is closed with `answered-in-chat` by the
  main chat or the Advisor, in whose chat the person answered it; the person's words are required, and History says
  "<chat>: answered in its chat by the person: <words>"; a step that waited on it goes on as with the board's answer.
  Only the main chat withdraws such an ask, with a why. A worker closes only its own asks; an ask with an asking chat
  stays that chat's.
  B305: what a step's `Blocked by` names no longer holds it once it is done or dropped (a step) or answered or withdrawn
  (an ask), for the board's delivery and for `next`. The guard is split: the board's move queued → taken (its wake of
  the Owner) keeps "Blocked by all done and Owner free"; the worker's own `take` is the flow's move by the worker,
  "Blocked by all done", so a chat still holding a step takes its next one. A flow.json without that move (made
  before B305) keeps the board's move for `take`, the taking chat counted free; a refused take names what is open.
  B306: a step's `Waits for` holds it as `Blocked by` does, under the same guard names (no flow.json changes): the
  ids it names (`B<n>`, `Q<n>`) until each is resolved as above; words with no id ("today's board work", kept from
  the old backlog's queue notes) until the main chat or the person clears them with `unblock B<id>` without `on`
  (History "no longer waits for: <words>"; a worker may not). The board does not deliver it; `take` refuses it naming
  the words ("B243 waits for: today's board work; the main chat clears it with work unblock B243") or the open ids;
  `next` shows it "waiting: ...". The reconciler flags (`waits`, on the Owner's lane) a queued step whose only wait is
  words once its Owner has been free, holding and given nothing, past the grace time: "B243 waits for 'today's board
  work': clear it or keep it". On the board, a form's question
  whose chat does not run has a **Withdraw** button. `answer` (the person) names the ask's own
  id, so an answer given after the chat moved on answers that ask and no later one; a look takes approve or reject
  (with words), a do takes done; the answer says whom to wake (`wake`). `read` puts a note away.
- **Refine questions are asks**: `refine` makes one decide ask per question under the step (`Via: refine`, Owner the
  Advisor), and withdraws the open ones of an earlier round; `refined` is refused while one is open, naming it; the
  answers given in the step's window (`refine-answer`) answer the matching asks, `refine-accept` answers the rest.
  Focus 3: an ask and its question are matched by the ask's whole words (its Text), else by its title (`questionIndex`):
  a title cut at 200 characters on a space once matched no question, so the asks stayed open and the fold was refused.
  Both ways hold: a window answer answers the ask (a History line on it), an ask answered alone writes into the block.
  The review of Focus 3: a question is read off the start of its line, so one holding " Answer: " still matches; equal
  questions match by their place (the step's newest refine asks with those words, in id order).
- **The lists** (`work/lists.mjs`, `state.mjs`): Needs your attention takes the store's open asks (and the ones
  answered within ten minutes, until their answer has arrived) as cards: the ask's kind, what it blocks and who waits
  ("blocks B1 · Board waits"), the options with the advised one marked, pictures, a Play link; answered through
  `POST /api/work` `answer` (the page's `sendWork`), after which the board types into the chat that asked
  `(answered on the worker board, HH:MM) Q12 "<title>": <answer>` (`say.mjs`, `answerWords`). **Information** lists the
  notes and reports, unread first, each with **Read**. A chat waits for the person only when it asked with the app's
  question form or holds an open blocking ask: its answers are not read for "For you" blocks (the main chat's and the
  Advisor's neither), and a chat's own card stands only for an app form the mod could not file.
- **The step window** (`itemOfStep`, the page's `itemPartsOf`): a step of the store shows its item: Summary on top, the
  picture, the goal chip, the flow strip, What we build, then Requirements and Touches folded, History last. A lane
  names its step by the store's title, not the card's short topic.

## The work store, increment 5 (B300): pull delivery and the reconciler

- **The reconciler** (`work/reconcile.mjs`, pure): `reconcile({ store, flow, lanes, now, times, prefix })` →
  `{ moves, deliveries, flags }`, one rule per row of the spec's section 7. Since a chat's `take` moves queued → taken
  itself, the first row is a wake, not a move: a queued step whose guards hold (`mayMove` to taken for the server,
  the Owner counted free) and whose Owner's lane is free and holds no other step is a delivery ("deliver B286 to
  Units"), one per chat. A step taken or in progress whose Owner does not run (and is not held by the limit) is
  flagged after `GRACE_MS` (10 min, from the later of its Since and the chat's last activity) with the button
  "Start <chat>". An open blocking ask older than `ASK_MS` (60 min) is marked old and stands first under Needs your
  attention; nothing is sent again. Open instructions are B298's list (no flag). A step in review whose last check
  failed is flagged on its Owner's lane with the button "Check again" (B304), and the Owner is told once. A broken file, an id twice or a state the flow
  does not know make one line on top (`workFlags`, in the store note) and are not moved or delivered. A card that names
  a step the store does not hold taken, in progress or waiting for that chat is flagged ("Units' card says B281 but
  B281 is queued"). The flow's other moves by the server whose guard holds are made (a review closed once its check
  passed and its look is answered); the reconciler never names a move the flow does not allow.
- **The state** (`state.mjs`) runs it at every build: the lanes carry `flags`, the state `workFlags` and `reconciled`
  (moves, deliveries, and the lines the flags say to their chats). A lane's task is the step the store holds for its
  chat (with or without a branch; a step in progress holds an ended turn as "between two turns"); the main chat's
  "Task from" lines are not read (B301 removed their reading, `HANDS_OVER`, altogether).
- **Delivery** (`work/deliver.mjs`, `server.mjs`): every refresh (`refreshSeconds`) the board that writes the store
  carries `reconciled` out: the moves through the API as the server (action `advance`), and each line into the outbox
  once per key ("B286 Units"), written down in the store's `delivered.json` before it is sent, so never twice, also
  not after a restart. The line is `say.mjs` `workWords`: command `work`, typed without the board's mark (the board's
  word, not the person's), kept as long as an answer, and a chat that does not run makes the board ask the main chat to
  start it (`wakeFor`).
- **Pull** (`api.mjs` `pull`, the mod's `turn.complete`): a worker whose card holds no task asks once per turn that
  answered; the API answers the line when a step queued for it may be taken now (the chat counted free), else nothing;
  the server sends it under the same key (nothing when sent before) and the mod takes it at once. The call goes through
  the mod's 1.5 s race.
- **The page**: a lane's flag is a line, with the button "Start <chat>" (`data-start`: the board's start words to the
  main chat); the lines on top stand in the store note; an old ask first, whatever the order.
- **The review's findings**: a line's key is the step, its owner and when it was queued for that owner (`Since`), so a
  step queued anew goes anew. `sendOnce` checks and records under one lock per store (the pull and the refresh never
  send twice), puts the line into the outbox first and spends the key only then; a line that expired or failed untaken
  goes once more (`delivered.json` keeps per key the message, its start word and how often it went again). No line,
  pull answer or check line goes to a chat that is not on the board, busy or held by the limit (`mayWake`: its lane
  free, read anew for a pull). A waiting line whose step is no longer that chat's (another owner, done, dropped; a
  check's line once the step left review) is withdrawn (`dropped`), with the start it asked of the main chat when
  nothing else waits for that chat. A step queued for a chat that has been free longer than the grace time and not
  taken is flagged ("B286 queued for Units, Units free, not taken"). The mod's turn end is one call (`turn-ended` with
  `pull: true`, the pull's answer in `pull`), held 1.5 s at most in all. The button "Start <chat>" does not open the
  lane's window.

## The work store is required (B301)

The person, 2026-10-17: "I want to prevent confusing behavior. I rather have it fail." Until B301 every path of the
store was gated on `truth.json` saying "store", with the old reading kept for a shadow. The live project runs on the
store, so the old paths are gone; where the board fell back silently, it now says on top of the page what is wrong
and does not pretend.

- **Gone**: the shadow (`src/work/shadow.mjs`, its per-refresh migration of backlog.md, `truth.json`, the API's 409
  "not the truth yet" and the mod's five-minute memory of it); building anything from `parseBacklog(backlog.md)` (the
  backlog file is not read by the board at all: the queue, in progress, the steps for the person and the Backlog tab
  come from the store, through the adapter); the main chat's "Task from" hand-over (`HANDS_OVER`, `taskStart`,
  `handOvers` in `transcript.mjs`, the mod's `handOver()` and "(more follows)"); "Report from" ending a task (in the
  board, `lastReport`, `lastFinish`, `reportsOf`; in the mod, a message to the main chat no longer marks the card
  reported); the "For you" block as what waits for the person (`advisorWaiting`, B290's reading, the window's items
  with Yes/No/Done and A/B/C answers); the writers of backlog.md's lines in `tick.mjs` (tick, delete, the refine
  block); the cutover's checks for a running board and `BOARD_ANSWERS_ASKS`.
- **Where it was**: a step ends with `work report`: the mod marks the card reported on the board's yes, clears it when
  the turn ends, and compacts a large worker then, unless the board's answer names its next step (`more`: another step
  queued or taken for it). A lane's task, its time and its window come from the store's step; the window's task as
  it was given is the person's words only. The finished list dates a step from its History line "→ done"; task times
  run from the worker's own `work take` to its `work report` (the work tool's calls in its transcript). The board's
  writers go through the work API only (`src/work/refineText.mjs` holds the refine-text helpers).
- **What fails, and how it shows** (`src/work/read.mjs`, `storeKeeper`, `storeFault`, `storeBacklog`): no store folder
  ("No work store in <folder>: the board shows no work. In the board's folder, make it from the backlog with ...
  --make-store, or make an empty one with ... --init."), or one that cannot be read ("The work store <folder> cannot be
  read (<code>) ..."): that line stands on top of the board, the backlog, queues and asks are empty (nothing is drawn
  from backlog.md), the reconciler does nothing, and the work API answers 503 with the same line. A broken item file,
  an id twice or a state the flow does not know: one line on top names the folder and the file; the item is shown as
  it is and not moved. A store folder without `activities.json` is named the same way. A write that fails is 500, one
  that met a change made meanwhile 409.
- **A chat that wrote questions in its chat but filed no ask** (`unfiledAsk` in `state.mjs`): its turn has ended, its
  last answer ends with a "For you" block (`asksAtEnd`), it holds no open ask, and no ask of its own was filed or
  answered since that turn began. Needs your attention shows the warning "<chat> wrote questions in its chat but filed
  no ask" (kind `unfiled`), with a button to its chat: Talk to Main, the Advisor's chat on its tab, or, for a worker,
  the card's window with its answer. The app's question form is filed by the mod as before, so it counts. (B308: a
  worker that holds a step, is not working and asked nothing at all is a hint of its own; see below. Warnings,
  2026-10-19: "that turn" is the one that wrote the answer, and an open ask an item of the block asks keeps it away;
  see "The warnings see the chat's asks".)
- **Kept, and why**: "Note from <name>: paused for the limit until HH:MM" (the store holds no pause; the lane shows
  "Suspended"; B310: as a message or as the first line of a work note to the main chat); the closing block's "+ Done:   yes" (a card is the chat's own, not the store's: a chat that is done is
  free whatever its card says); "Note from"/"Question from" messages (the mod only notes that the worker waits for
  the main chat); the "Task"/"What I did" lines and the closing block, shown in a chat's answer window as its words.
- **Making a store**: `tools/migrate-backlog.mjs --make-store` (the cutover's checks, into an empty folder) or
  `--init` (an empty store: one activity, the default flow). Without a mode the command only reports.
- **The review's findings**: the warning counts only asks filed since the turn began (an ask's first History line),
  looks for the turn's start in the tail and the longer look back, and warns all the same, saying so, when it cannot
  tell; an open ask of an earlier turn keeps it quiet no more. The board notes what it sees ticked (`data/finished.json`)
  only from a store it can read, with each step's own time of its move to done (`seenFromState`), so a store read again
  is no burst. (A flag for a chat whose last answer closed with "Done: yes" while the store still held its step, "...
  run work report", was here until B308: it misread "Done: yes".) Moving a queued step and taking it out of its queue are the API's
  `requeue` (`for`) and `unqueue` (Main and the person; flow.json: queued → refined or new), called by the page's
  buttons; the words `move step` and `unqueue step` go. The Workers mod 0.13.1: the work tool knows them; no message
  is a report (`sentKind` goes); the compaction keeps the store's steps.
- **The demo and the tests** make their stores in memory from their backlog texts (`storeFromText`;
  `test/withStore.mjs`), as `--make-store` would.

## A queue asked before the refine (B303)

Seen live on 2026-10-17: the main chat made a step with `work new`, queued it at once and got "no move from new to
queued"; the refine gate sent the step to the Advisor, but the queue was lost, and once refined nobody queued it.

- **The wish is kept** (`src/work/api.mjs`, `queue`): a `queue` the flow refuses only because the step is not refined
  yet (it is new; the one who asks could queue it once it is refined, and the flow lets the board queue it then) is
  not refused: the step gets the head line `Queue when refined: for <chat>; after <...>; about <...>` and the History
  line "queue asked before its refine: ...", and the answer says "B302 is not refined yet: the Advisor refines it
  first, then the board queues it for Board by itself." Every other refusal stays one: a worker, a step done or
  queued, a bad `about`, a flow without the board's move below.
- **The refine gate** (`src/refineGate.mjs`) counts such a step as one the main chat queued: it sends it to the
  Advisor in that turn (a new step and an old one alike); the step's window item carries `queueWhenRefined`.
- **Once refined** (the Advisor's `refined`, or a refine the person's answers or accept leave ready) the board queues
  it by itself, as the server, with what was asked: Owner, Blocked by or Waits for, Estimate; the wish goes; History
  "server: refined → queued" and "server: queued for Board; ... (asked by Main before its refine)". The flow's move
  for it: `{ "from": "refined", "to": "queued", "by": "server", "when": "a queue was asked before its refine" }`
  (the guard in `guards.mjs`), in the default flow and `examples/work/flow.json`. When the flow did not let it at
  the refine, the reconciler names the move later and `advance` carries the wish out the same way.
- **A refusal's "only ... may"** names the server only when nobody else makes that move ("only main queues a step").

## A worker that holds a step and asked nothing (B308)

Seen live on 2026-10-18: lanes showed "Board ended its turn with Done: yes but B269 is still in progress: run work
report" (and for B280, and Support for B31). The steps really were open: a chat's closing "+ Done:   yes" says it did
what that turn asked, not that its step is finished. Meanwhile Board waited for the person's look on B269 and B280,
said so only in prose in its chat, filed no ask and wrote no "For you" block, so Needs your attention showed nothing.

- **The "Done: yes" flag is gone** (kind `unreported` in `src/work/reconcile.mjs`, the lane field `saidDone`). Kept:
  "Done: yes" still makes a chat free whatever its own card says (B148), and a step the store holds for it still holds
  it; the `stuck` flag ("B<id>: <chat> holds it but is not running", with **Start <chat>**) stays, as it reads the
  chat's process, not its words.
- **The hint** (`idle hold` in `reconcile.mjs`, from the lane's `resting` in `state.mjs`): a worker (not the main chat;
  the Advisor has no lane) that holds steps taken or in progress, whose turn has ended with nothing running (no
  command or subagent it left in the background, read as `heldBy` reads it, so "Done: yes" overrules one), that is
  not cut off or suspended, and that holds no open ask of its own (Warnings, 2026-10-19: nor stands another chat's
  open ask under a step it holds), for longer than `IDLE_HOLD_MS` (5 min, in `src/config.mjs`, from the later of its
  turn's end, its steps' Since and the person's last answer to an ask of its own): Needs your attention shows one line per
  chat, "<chat> holds B269 and B280 but is not working and asked you nothing: it may wait for you" (kind `idle`), with
  the button to its answer in the card's window, as the warning that a chat filed no ask has. It counts in the number
  of Needs your attention as that warning does. It has no answered state: it goes when the chat runs again, files an
  ask, or reports. A chat whose answer ends with a "For you" block and filed no ask has that warning instead, not both.
  Nothing of the chat's words is read for it.

## The warnings see the chat's asks (Warnings, 2026-10-19)

Seen live at 08:24 on 2026-10-19: the person answered Q153 (Worker 2's decide on B356, not blocking, filed 00:02) and
Q154 (Worker 4's look on B333, not blocking, filed 00:28) on the board, and Needs your attention showed at once
"Worker 2 holds B356 but is not working and asked you nothing: it may wait for you" and "Worker 4 wrote questions in
its chat but filed no ask", dated 00:30 and 00:28. Checked on copies of the night's store and transcripts: neither
showed while the two asks were open; both came with the answers.

- **Why "filed no ask"**: the board typed the answer to Q154 into Worker 4 (08:24:33), which opened a new turn. Until
  the chat answers in it, the app's summary of its answer before stays current, so the board counts that turn as
  ended, and it read the last answer (00:28, the block that asked Q154) against the start of the new turn: Q154,
  filed in the turn that wrote the block, counted as filed before it.
- **Why "asked you nothing"**: the answer closed Worker 2's only open ask before it had reached the chat, and the hint
  read "no open ask" as "asked nothing".
- **The turn that wrote the answer** (`unfiledAsk` in `state.mjs`): its start is the last opening at or before that
  answer; one opened since has not answered yet. The warning stays away when an ask of the chat was filed at or after
  that start, or when an open ask of its own is one an item of the block asks: the item names its id as a word of its
  own (the work tool's "(Q154, look on B333)"), or asks the same words (`sameAsk`, as B317 files the block). The words
  are compared in `src/work/askWords.mjs`, shared with `askForYou`.
- **An ask's time** (`askFiledMs` in `src/work/item.mjs`): an ask gets `Filed`, the millisecond it was filed (the head
  key after Since, as an instruction's), and every "since this turn began" reads it: the warning's `filed`
  (`storeWaits`) and the asks B317 does not file again (`askForYou`). An older ask without it counts at the end of the
  minute its first History line (else its Since) names, so one filed in the minute a turn began counts as filed in it.
- **The idle hint** (`idle hold` in `reconcile.mjs`): any open ask keeps it away, blocking or not: the chat's own,
  under its step or alone, or another chat's under a step it holds. The person's answer to an ask of the chat's own
  starts the idle time anew (its Since, at the end of that minute): the answer is on its way, and the hint comes back
  only when the chat has not gone on 5 minutes after it.
- **Not changed**: a turn whose prompt has no answer yet still counts as ended while the app's summary of the answer
  before is current (its lane says free for those seconds; seen at 08:24:38 for Worker 4).
- Tests: `test/warningsSeeAsks.test.mjs` (the two cases with their own times).

## A chat renamed keeps its work (B313)

Seen live on 2026-10-18: the person renamed the worker chats (Support to Worker 1, Board to Worker 2, Features to
Worker 3, Units to Worker 4). The store names chats by their short name, so the steps in progress under the old names
were stranded: the store refuses a take or a report from a chat under another name, and one step was moved by hand.

- **The board follows a rename by itself** (`src/work/rename.mjs`, `followRenames`, at every refresh of the board that
  writes the store, before the delivery). It knows each chat by its session id (the key of its card,
  `.claude/chats/<session>.json`) and the name the list gives it (the lanes, leftovers and the Advisor too), and keeps
  the last name it saw per session in `<work>/names.json` (`sessions`), so a rename while the board was off is seen at
  its start. A session under another name than before is the same chat renamed: the work API's `rename` as the board
  moves every open item naming the old name, one History line each, "<old> renamed to <new> (same chat)". A session
  seen for the first time only records its name; a rename that could not be written is tried again at the next refresh.
- **What moves** (`src/work/names.mjs`): the Owner of a step not done or dropped and of an open ask, the Chat of an open
  instruction, the From and To of an unread note (a To of `you` or `main` is a word, never moved), and the "for" of a
  step's `Queue when refined`. Done, dropped, answered, withdrawn, closed and read items keep the name they were done
  under; History lines stay as written. Names compare as the API compares them: without the title's prefix, any case.
- **A name two chats had is not moved**: the old name is still another listed chat's, two sessions left the same name
  in one refresh, or the new name is another chat's too. The rename stands under `held` in names.json (once), and the
  board says on top, while open items still name the old name: "names.json: the board did not move the open items of
  <old> (<ids>) to <new>, as two chats had the name <old>: the main chat moves them with work rename ...".
- **`work rename` (`from`, `to`)**, the main chat and the person (the mod 0.13.5 knows it): the same move for a rename
  the board could not see, such as a chat replaced by a new one. It clears the held line of that old name.
- **delivered.json stays**: its keys name the chat a line went to. A queued step whose Owner moved is delivered once
  more under the new name, and the waiting line under the old name is withdrawn as for any step no longer that chat's;
  copying the keys would leave the renamed chat without its line.

## Fix first: a board fix goes first

The person, 2026-10-18: "also when something is classified as a fix for the worker board, it should take priority
over the current goal/focus of the advisor".

- **The mark**: a step's head may hold `Priority: fix` (the only value; `src/work/item.mjs`, `isFix`, `fixFirst`). The
  work API sets it with `priority: 'fix'` on `new` and on `queue` (also for a queue asked before the refine), with the
  History line "marked a board fix"; for a step queued already for that chat, `queue` with `priority` only marks it.
  The main chat, the partner (role advisor) and the person mark a step; a worker is refused. The Workers mod's work
  tool carries the field (0.13.8). The main chat marks every step it makes from a bug the person reports in the board
  or in a chat's tools for the board (roles/main.md).
- **It stays with its owner and jumps that owner's queue**; it is never given to another free chat. Wherever the board
  picks the next step, a fix comes first: the reconciler's delivery (`reconcile.mjs`: the queued steps sorted fix first,
  so a free owner is woken for its fix; a fix that may not be taken yet, blocked or waiting, holds nothing back), the
  chat's pull at its turn's end (`pull`), and `work next` (within a state, so a step in progress is not set aside;
  its line reads "B<id> queued, board fix: ...").
- **On the page**: the lanes' queues (`backlog.mjs`, `queue`: fix first; each step `isFix`) and the column "Next in
  queue" show a small "fix" chip; the Backlog tab shows the chip and puts an open fix first in its group, also in "One
  list".
- **The Focus page**: a part not under way whose queued step (not itself a fix) has an owner that works on a fix, or has
  one queued, says "A board fix goes first: B<id>" (`state.mjs`, `fixAhead`: the fix under way first, else the lowest
  id). The partner's job text: a board fix is never held back for the focus, nor argued in the daily note.

## The background loops and the check after a report (B404)

Place 1 of `docs/robustness-2026-10.md` (the person's Q207 B). The board's loops used to swallow their errors, so a
loop that kept failing stopped delivery while the page looked healthy, and a restart seconds after a report left the
step on "check pending" for good.

- **The record** (`src/loops.mjs`): the look, the reconciler, approve-recaps, the stuck-check pass, measuring, CPU for
  the chats, answering the page and each step's check after a report (`check:<id>`) run through `loops.run(name, fn)`:
  last success, last error, failures in a row, since when. It never throws; the next run goes on. approve-recaps runs
  on its own, so an odd recap stops no delivery.
- **The log**: each new error (another message than the loop's last; B446: its random part aside) is one line in
  `<project>/.claude/board-errors.log` (UTC time, the loop, the error's first line); at 1 MB the file moves to
  `board-errors.log.1`. Not for the demo.
- **The page**: one note on top while a loop fails ("Delivery failing since 23:10 (EBUSY …); also …"); nothing else
  changes. The state carries `loops: { failing, line }`.
- **A stuck check**: the reconciler asks the server-only action `recheck-stuck` (skipping the checks that run now):
  a step in review whose last check line is "check pending" from more than 2 minutes ago is checked again, with the
  History line "check run again: it stood on check pending for more than 2 minutes"; at most 3 times per report, then
  it waits for the person's Check again.
- **A base branch off its remote** (B598, the fix of X45): the check's line "main of <repo> is not the same as
  origin/main" goes on with which case it is (`check.mjs` `baseFault`): behind (fast-forward it), holding commits the
  remote lacks (push them), both, or behind with uncommitted edits in files the fast-forward would change (named, as
  another chat's work); each says the board checks again by itself. The supervisor's repair rule `base-equal` does
  that: a step in review whose last check failed only on such lines is checked again once each base equals its remote's
  (the view's `bases`, `basesNow`; the server-only action `recheck-base`, History "check run again: main of <repo>
  equals origin/main now"), once per failed check, without a new report. Tests: `test/supervisor/baseEqual.test.mjs`.
- **A restart** stops taking work (the Workers mod gets 503 "The board restarts: try again in a moment."), starts no
  new look, pass or check, and waits up to 10 s for the reconciler's pass and the running checks before it ends; it
  also ends when the page's connection drops before the answer is out.
- **No remote** (`src/work/check.mjs`): origin/<base> unread passes as "has no remote" only when `git remote` names no
  origin; git not answering, or an origin whose base cannot be read, is a fault. A repository with an origin whose base
  was never pushed now fails the check, as it should.
- Tests: `test/loops.test.mjs` (fake clock: a loop that throws once and goes on, one failing every refresh logged once,
  the page line, the log file and its rotation, stuck checks and their cap, the restart's wait), `test/work/recheck.test.mjs`
  (the action on a store), `test/work/check.test.mjs` (no remote against a failed call).
- Not in it: taking `main()` apart into modules (12 to 16 h, a later step).

## CPU for the chats (B311)

The person, 2026-10-18, while playing the game: the workers made the PC lag; "i want the board to not completely stop
but [not] prevent my ability to play the game". A setting in the board's head, beside Prepare restart.

- **Three levels**, one click each: **Off** (Normal priority, all cores), **Gentle** (BelowNormal priority, all cores),
  **Strong** (Idle priority, on at most half of the logical cores: the higher half of the affinity mask, so the lower
  cores, where Windows starts most work, stay free for the game). Kept in `data/cpu.json`, so it survives a restart;
  `cpuLimit` in config.json gives the level until one is clicked ("off" unless set). A copy of the board beside the
  person's starts at Off whatever config.json says, and applies only what was clicked on it.
- **Which processes** (`src/cpu.mjs`, `chosenProcesses`): every `claude.exe` whose command line names a session of
  the project's list of chats (`--resume=<id>`; the sessions are the card files `.claude/chats/<session>.json` and the
  chats the board lists), and its whole tree below (node, vite, a browser with a temporary profile, python, git, ...).
  A child counts only when it started after its parent, so a reused process number leads nowhere. Never the desktop
  app (its command line names no session, and it is no child of a chat), never anything else; the board's own server
  only when a chat started it.
- **How** (`cpuLimiter`): at start and every refresh one PowerShell listing (`Get-CimInstance Win32_Process`, the
  command line only of `claude.exe`). A process is set (`PriorityClass`, `ProcessorAffinity`, a second PowerShell call
  with the changes on its standard input) only when it is not at the level: Windows reports another base priority, or
  the board has not set it and its parent is not done (a child of a BelowNormal or Idle process inherits the priority
  and the cores). Both calls lower their own priority first. Off lists nothing at all, apart from one pass right after
  a limit was switched off, which gives every chosen process Normal and all cores back. A process that cannot be set
  (gone, access denied) is passed over quietly and not tried again at that level; a listing that fails is one red line
  on top, gone at the next listing that works.
- **Windows only.** Elsewhere the control says "not available here" and nothing runs; `POST /api/cpu` answers 409.
- **The head** shows the level lit and, when not Off, how many processes it applies to ("15 processes, below normal",
  "15 processes, idle, 12 of 24 cores"). `POST /api/cpu {level}` takes the click, from the board's own page only (token,
  origin, JSON, as every action).
- Tests (`test/cpu.test.mjs`): the level's parsing and storage, the setting, which processes are chosen from a made-up
  list, the affinity mask for N cores, what is set and what is passed over, the Off pass, a failed listing, another
  platform, the endpoint and the head's text; the PowerShell calls are the one object `windowsProcesses` that tests
  replace.
- **B440** (2026-10-19): a board that a chat started was itself a process below a chat. Strong put it at Idle on one core,
  and while the PC was busy every request took 1.5 to 5 s, so the chats' work tool gave up. The board and its keeper
  are spared (`spare`, which also leaves out what they start; the parent only when it is the keeper), and both get
  Normal and all cores back, tried again each pass until Windows took both, and again whenever a listing finds one of
  them lowered (another board's limiter, say), with a line in the board's log. The Workers mod 0.13.14 names the reason when the board does not answer ("did not answer (<reason>): nothing
  was recorded"). B445 (the Workers mod 0.13.15): a call the board holds for 10 s counts as timed out, said with its
  seconds ("timed out after 10 s"; asked again as a cut answer, B412), and a refusal shows the board's words with the
  HTTP status beside them ("… (HTTP 409)", or "The worker board refused it (HTTP 500)." without words). The mod's own
  late calls (a form's ask) keep waiting as long as the board takes, so their answer still closes the ask.

## The Focus tab, increment 4 (Focus 4): the main chat delegates, the partner's questions first, the talk bar

Spec 2026-10-18, sections 2 and 4; plan Task 7; picture `art-inbox/focus-mockups/inc4-needs.png`.

- **From your partner** (`state.mjs` `markPartner`, `board.js` `partner-needs:start` `partnerFirst`): every card of
  Needs your attention says whether the partner asked it (`isPartner`: from the chat the setting `advisor` names, with
  or without the prefix). The page draws those first, in their own group: the asks the focus shows (`state.focus.needs`,
  its daily note's order) first, then the partner's others; the rest as before.
- **The talk bar** (`src/focus.mjs` `talkBar`, the move `talk` on `/api/goals`): the person's words go into the focus
  goal's talk (`talkFor`, shared with the pick: the thread that runs, else one wrapped up reopened, else a new one, linked
  under the goal): with the partner's question open they are its answer (`brainstorm answer`), in a new thread its
  opening (`brainstorm`), else `talk: <words>` / `Goal:` / `Thread:` (`focusWords('talk')`). Each typed as the
  person's word; a partner not running is woken through the main chat.
- **A note to the main chat wakes it** (`reconcile.mjs` `notes`, `deliver.mjs` `noteLine`): the notes `To: main` it has
  not read (`Main read`), from another chat and not the board's note of a report (`Via: report`), wake it with one line
  per refresh, "work: notes N62, N65 for you; run work next" (key per set of notes in `delivered.json`); none while such
  a line waits or was taken in the last 10 minutes (B564, X20: a line the Workers mod took on 2026-10-19 and never said
  it typed held every notes line for five days, so the notes reached the main chat only when it ran `work next` for
  something else), none while it is suspended, none for notes filed before the board's first refresh with
  this (`notesFrom`). The same notes still unread 30 minutes after their line arrived (`NOTE_AGAIN_MS`) go once more,
  "work: notes N62, N65 for you, unread 41 min; run work next" (key `... again`). Its `work next` shows them first and writes `Main read`, which withdraws a line still waiting; the
  person's Read under Information is the State, apart. A board that only shows marks nothing.
- **Waiting for the main chat** (`focusState`): a part whose steps are made but none is queued or under way (new or
  refined) is `handout` with `waitsSince`; the page says "Waiting for the main chat to hand it out", and after the grace
  time `handoutNeeds` puts a hint under Needs your attention with the way to Talk to Main. The review: a step queued before its
  refine (`Queue when refined`) is the board's to queue: its part is `refining`, "Waiting for its refine, then the board
  queues it", and no hint.
- **Chat names** (`work/api.mjs` `chatName`): queue and requeue `for`, rename `from` and `to`, a note's `to` and the
  asking chat lose the list's prefix and match a chat of the list (`chats`, from the board) in any case; an unknown one
  is taken with a warning line naming the known ones (the review: a worker about to be started is not on the list yet).
  An Owner written as prefix + name counts as that name, and is repaired when its chat
  takes the step.
- **The main chat delegates only** (`roles/main.md`): it asks the user nothing about planning (what to build, in which
  order, how big, which goal); those questions go to the partner. Its own asks are about delegation (a worker to start
  or stop, a restart). The check before work: the partner settles "first do X" or asks the user itself.
- Tests: `test/needsPartner.test.mjs`, `test/focusTalkBar.test.mjs`, `test/work/noteWake.test.mjs`,
  `test/focusHandout.test.mjs`, `test/work/chatNames.test.mjs`, `test/partnerJob.test.mjs`.

## The Focus tab, increment 3 (Focus 3): the run, the daily note, "Is the vibe there?"

Spec 2026-10-18, sections 3 to 6; plan Tasks 5 and 6; mockup `art-inbox/focus-mockups/focus-run.png`, pictures
`inc3-run.png` and `inc3-vibe-there.png` beside it.

- **Parts follow their steps** (`state.mjs` `focusState`, since Focus 1, pinned by `test/focusRun.test.mjs`): all
  finished (done, closed, dropped) → done; one taken, in progress, waiting on you or in review → in progress with that
  step's owner; else next. The progress counts parts done, and the minutes the sizes of the others name.
- **The daily note** (`src/work/dailyNote.mjs`, `api.mjs` `note`): the partner's `work note` with `of` G<n> (role
  advisor only, to you) writes `N<n>` with `Of: G<n>` (a new note key) and the sections `## Decided for you` (one line
  each) and `## Needs you` (the ids of asks in the store). `work ask` with `of` G<n> makes an ask of the goal itself
  (no step to follow when it is answered or withdrawn). The state's `focus` carries `note` (the partner's newest daily
  note of the goal: `{ id, since, decided: [{ text, undoAsked }], needs }`) and `needs` (the partner's open asks of the
  goal or its steps, the note's first, with options and pictures); `focusState` takes the partner's name (the setting
  `advisor`); since the review, by the name of the chat the board shows for it, as the work API gives it the role advisor.
- **Undo** (Review Focus 4): the page's `note-undo` on `/api/goals`, and an `undo` on `/api/work`, go through
  `server.mjs` `undoNow` and `src/focus.mjs` `undoLine`, one at a time: the store's person-only `undo` with `check`
  says whether the line may be undone, the board types `undo: <line>` / `Goal:` / `Note:` to the partner
  (`focusWords('undo')`), and only then the store adds the line under `## Undo asked` with its time. A second Undo,
  also from another tab, types nothing; a word that could not be kept leaves the line unmarked (the review). The page
  shows "undo asked" from the note's section.
- **Is the vibe there?** (`src/focus.mjs` `vibe-there-yes`, `vibe-there-no`): asked when every part is done; the server
  passes `allDone` from the store. Yes ticks the goal and clears `Focus:` in one change of the map, once (a second Yes
  finds the goal done: no word); No (with words) takes `How agreed` away (`goalsWrite.mjs` `reopenHow`). Each types its
  words, as the person's: `vibe there: yes`, `vibe there: no` with `Words:`.
- **The morning round** (`rounds.mjs` `roundText` with the state's `focus`): "Your focus: G<n> <title> (<stage>). Write
  today's note on it: ..." or "No focus: have the user pick one ...". The partner's job: `roles/partner.md`, "The daily
  note" (what it may decide without the person: small visual details, numbers, wording, the order of the parts; never a
  rule of the game, a new screen or more than about an hour's extra work).
- The Workers mod's work tool 0.13.6: the fields `decided` and `needs` (beside B313's `rename` and `from` of 0.13.5).
- The review's findings: a blocking ask holds a step only when the chat that holds the step asks it (the partner's
  or the main chat's ask under a worker's step is written `Blocking: no` and leaves the step as it is), and an answer
  that frees a step waiting on you also wakes the step's owner when another chat asked (`answer`'s `wakeOwner`, sent by
  the server as the asker's `wake`).
- Tests: `test/focusRun.test.mjs`, `test/focusNote.test.mjs`.

## The Focus tab, increment 2 (Focus 2): the vibe and how moves, and the partner

The plan's Tasks 3 and 4 (spec `.claude/specs/2026-10-18-focus-partner-design.md`, sections 2, 3, 5 and 6). Pictures
beside the mockup `focus-vibe.png`: `art-inbox/focus-mockups/inc2-vibe.png`, `inc2-how.png`.

- **The moves** (`src/focus.mjs`, `focusMove`, through `POST /api/goals`; one at a time): `focus` (`id`, or `text`
  for something new: a goal at the top, `Last id` raised) writes `Focus:` and starts the goal's brainstorm thread, or
  goes on with the one that runs about it (`editThread` start, linked under the goal); `vibe-agree` (the focus in the
  vibe stage, with a draft) and `how-go` (the how stage, with parts) write `Vibe agreed` / `How agreed` once;
  `vibe-not-yet` and `how-not-yet` carry the person's words and write nothing. A refusal names why (no partner, a
  board that only shows, not the focus, the wrong stage, no draft yet, no words).
- **The words** (`src/say.mjs`, `focusWords`): `focus: G<n> <title>` / `Thread:` / `Stage:` / `Your job: <board>/roles/partner.md,
  "The focus"`; `vibe: agreed`, `vibe: not yet`, `how: go`, `how: not yet` with `Goal:` and `Thread:` (the not-yets
  with `Words:`). The move answers them, or null when it changed nothing: the server puts them into the outbox as the
  person's word (no Workers mod: copied, the page pastes), and `wakeFor` asks the main chat to start a partner that is
  not running (Review Focus 5). Two clicks on "This is the vibe", also at once: one line, one word (Review Focus 3).
- **The drafts**: `vibe-draft` (`lines`, `picture`; refused once the vibe is agreed) and `how-draft` (`parts`,
  `partnerDecides`, `youDecide`; once the how is agreed only the parts' steps may change). The partner sends them with
  the Workers mod's work tool (version 0.13.4: the actions `vibe-draft` and `how-draft`, the fields `goal`, `lines`,
  `picture`, `parts`, `partnerDecides`, `youDecide`): the work API (`/api/bridge/work`) takes them from the chat
  the list names the partner only (role advisor) and hands them to the board's `goalDraft`, which writes the map, not
  the store; a part may be the tool's line "<title> · <size> · steps B<n>". No chat reads the board's own file. The
  page's route (`/api/goals`) takes them too.
- **A copy** (the review of Focus 1): a copy whose `goals`, `brainstorms` and `goalsHistory` are whole paths outside
  the project (`isOwnMap`) writes that map, its threads and the focus, and keeps the words in its own outbox, which no
  chat takes; the project's map stays the delivering board's.
- **The page** (`focus:start`): `focusCan` (a partner and a board that writes, else why), `focusView` with working
  buttons (`act`, `isEnabled`, `title`), `focusAsk` (the open question, its options, why and picture, or who has the
  turn). Drawn by `drawFocus` with `focusUi` (a move on its way, its line, the Not yet box, the words of each box and
  the option picked, kept while the page redraws); `focusAct` sends the moves, `focusAnswer` writes the answer into
  the thread (`/api/brainstorm`) and types `brainstorm answer` (`/api/say`), as the Brainstorm part does.
- **The partner** (`roles/partner.md`, from the Advisor's job, which keeps refining, goal linking and rounds): "The
  focus" in three moves (talk until the vibe is clear and keep the draft, never build; on `vibe: agreed` propose the
  how; on `how: go` make the steps with `work new` and the goal, refine them itself, write their ids into the parts,
  and `work note --to main` "Queue for G<n> ..."), and "Planning questions from the main chat". `roles/partner.md`
  only points there; the rounds and every place the board names the job say `partner.md`. `roles/main.md`: planning
  questions go to the partner; its queue notes are queued as any task. `roles/protocol.md`: the map's focus lines and
  the new words. The project's `.claude/main-briefing.md` needs one line of its own (the main chat's).
- The review of Focus 1, fixed here: a part whose step is in review is in progress; an unknown part, and the way back
  to the tab, open the first part `advisorParts` shows; an empty `advisorParts` is named as broken.
- Tests: `test/focusFlow.test.mjs` (each move, the words, Review Focus 3 and 5, the drafts, the work API's drafts by role),
  `test/focusPage.test.mjs` (the buttons, the talk's open question),
  `test/partnerJob.test.mjs` (the job texts and where the board names them).

## The Focus tab, increment 1 (Focus 1): read-only from goals.md

The spec `.claude/specs/2026-10-18-focus-partner-design.md` and its plan (increment 1, Tasks 1 and 2); the person,
2026-10-18: "i do like it, but keep the goal tab and brainstorm as well". Mockups and pictures beside each other in
`art-inbox/focus-mockups`: `focus-vibe.png`, `focus-run.png`; `inc1-pick.png`, `inc1-vibe.png`, `inc1-how.png`,
`inc1-run.png`.

- **The lines** (`src/goals.mjs`): a head line `Focus: G<n>` before the first goal (`Focus:` alone is none; a Focus
  line under a goal is a note); under a goal `Vibe:` (one per point), `Vibe picture:`, `Vibe agreed: <date time>`,
  `Part: <title> · <size> · steps B<n>, B<n>` (size and steps optional), `Partner decides:`, `You decide:`,
  `How agreed: <date time>`. `focusStage(node)`: none or gone → pick; ticked → done; no Vibe agreed → vibe (an agreed
  vibe without words is the how, its line "(no words kept)"); no How agreed → how; else run.
- **The writers** (`src/goalsWrite.mjs`, by id, every other line kept): `setFocus` (in place, else after the head's
  Last lines, else under the heading; null removes it; a goal that is gone is refused), `setVibe` and `setHow`
  (their lines replaced where the first stood, else after the goal's own top lines), `agreeVibe` and `agreeHow`
  (once: a second agree keeps the first). Nothing calls them from the page yet: increment 2 does.
- **The state** (`focusState` in `src/state.mjs`): `focus` is null without a map, a focus or a goal of that id;
  else the goal, its stage, its lines, its brainstorm thread (a running one about it, else its Brainstorm line's) and
  each part's progress from the work store: all its steps done, closed or dropped → done; one taken, in progress or
  waiting on you → now, with that step's owner; else next; `progress` is the parts done of all and the minutes the
  sizes of the parts not done name. `advisorParts` from the setting.
- **The page** (`public/board.js`, the section `focus:start`): `focusView` (head, strip, the right card per stage,
  the run's parts without step ids, the pick list), `focusTalk` (the thread as bubbles), `goalStepIds` (the goal's
  Steps and Part steps and those of its goals inside) and `advisorPartsShown`. The part kept from last time that the
  bar no longer shows gives way to Focus; the chat opened from the Advisor's card still opens. The Backlog's
  `coordinateList` takes `goal`: only those steps; their finished ones only with "Show finished", as without a goal
  (B325).
- **Drawn, off until increment 2**: "This is the vibe", "Not yet", "Go", the Pick buttons, the talk boxes and Send;
  the daily note is a line that says it comes next.
- **A copy tries it apart**: `goals`, `brainstorms`, `goalAsks` and `goalsHistory` may be a whole path of their own,
  as `work` (`projectFile` in `src/config.mjs`).
- Tests: `test/focus.test.mjs` (the lines, the stage, Review Focus 1 and 2, the writers), `test/focusPage.test.mjs`
  (the state, each stage's view, no step ids on the run, the talk, the steps behind a goal),
  `test/advisorTab.test.mjs` (the bar and the setting).

## The calm answer window (B269)

The person, 2026-10-15: the window where a chat needs their answer was too cluttered; they chose a calmer picture
and wanted it "even more spacious". Since B299 what waits for the person is an ask of the work store, so the window
of an ask the board can answer (not answered yet, not a refine question, not one of the app's question form) is
drawn calm (`isCalm`, `drawCalm` in `public/board.js`): a narrower window with room around everything; the head
says who needs the answer, the ask's kind and when; one line names the step it is about and whether the chat waits
for it; the question is the title (`splitAsk`: up to its first "?", the why and the advice under it), with links to
its pictures and its play link; the answers are large cards (`cardsOf`): the ask's options, each with its letter
and its words, the advised one marked "Recommended"; without options Yes and No for a look (approve, reject) or a
decide, Done for a do, none for a provide, whose note is the answer. The step as the store holds it, who asked and
what waits on it, and the pictures large are folded behind "View context". A note is optional, needed for a No.
The open asks of the same chat on the same step go one at a time, oldest first (`calmGroup`, "Question 2 of 3",
Back and Next), with one Send at the end (`sendCalm`): each answer given goes to the store (`calmAnswer`: a look's
approve or reject, a do's done, else the pick and the note as words); a No without words, or words on a look
without a pick, is not sent and the window shows that question and says why; questions left without an answer stay
open on the board. Sent, the window closes and the cards on the right say where the answers are. On a phone the
window fills the screen. The roles ask a choice with its options apart (`options`, letter first) and the advised one
in `advice`, so the cards can be drawn; the ask's whole first line comes as `question`, since its Title may be cut.

## The bridge

1. The person types on the board. The page sends it to the server, which keeps it as "waiting".
2. The mod, running in the main chat, asks for waiting messages every few seconds and marks each one delivered
   before it does anything else, so a message is never typed twice.
3. The mod submits the text to its own chat as the person's own words (`$.prompt.submit` with `asUser`). The engine
   runs it as a turn once the chat is idle.
4. The dock shows the chat's transcript, so the answer appears there like any other.

Step 1 of the build tested both on 2026-10-12: the mod can submit a line as the person's own words (the chat's
record marks it as coming from the mod), and it can reach the board's server on `127.0.0.1` over HTTP. So the mod
asks the server for waiting messages; no shared file is needed.

Safety, because what arrives is typed into a chat that can change files:

- The server listens on this machine only. Sending needs a token the server puts into its own page, the page's own
  origin, and a JSON body. Other websites in a browser cannot send.
- Every delivered message is visible in the dock and in the chat itself, with the time it was typed.
- The mod's note tells every chat never to send through the board. A worker's message to the main chat stays a
  teammate's report and never counts as the person's word.
- What remains: any program running as the person on this PC could type through it. Such a program can already
  change the files the chats read.

### A word that waits (B532)

The supervisor's first run (2026-10-24) found 33 words "waiting" in the outbox, the oldest of nine days: `take` handed
out only words under `messageKeepMinutes` (10) old, so a word to a chat that was busy or closed longer stayed waiting
in the file for ever and showed as expired on the page only (the partner's S20 confirmation, the weekly round, B403's
check request); and the goal guard's evaluate word of 9459 characters was refused by the mod (its limit is 3000) and
never sent again, with nobody told why. Now:

1. A word the chat's work stands on waits as long as an answer does (`answerKeepHours`, store.mjs `keepMs`): a partner
   word (`say.mjs` `isPartnerWord`: refine, result check, evaluate, the plan's words, the Focus page's), a round of the
   board's clock and the main chat's `start` of a closed chat. B548 (the result check of B532): so do a line the person
   typed to a chat and a resume; a person's answer waits however old. A word that steers a chat now (stop, clear, a
   model or effort, a sweep) keeps its minutes: no old order turns up in a chat. A word over 10 minutes old goes with
   its age under its words ("this word waited for you: sent 3 hours ago, at 15:00"); its first line stays the board's
   own, which the chat reads.
2. The sweep (`src/work/outboxSweep.mjs`), at every refresh (deliver.mjs) and before a chat's take (for that chat's
   words), closes a waiting word that no longer matters and writes its state and `why` with `closedAt` into the
   outbox: `dropped` when a newer word of the same kind to the same chat about the same step, round or plan item
   stands (waiting, taken or delivered), a refine for a step no longer new (a later round also while it is refined), a
   check for a step out of review or gone, an evaluate once its goal is done or was evaluated after it, a start once
   that chat runs or nothing waits for it; `expired` once it waited longer than it is kept. Never: a person's answer
   (it waits for its chat, also one off on purpose) and a work line (`withdrawStale` judges it by its step; B589). The page
   lists the closed words with their why for 12 hours after they were closed (`outboxNow`). B548: the take goes through
   `takeFor` (the sweep of that chat's words, then the take), and `test/work/outboxReplay.test.mjs` replays the outbox
   as it stood before the first sweep (`fixtures/outbox-replay.json`, the words' shapes only): 31 of its 33 waiting
   words close, the person's answer of three days and the weekly round stay, and the answer reaches its chat.
3. A word the mod took and could not type (`$.prompt.submit` threw, or a hook dropped it) is reported with its why
   (the Workers mod 0.15.1, `reportTyped`), and goes again after a minute as a new word (`retryOf`; the mod types an id
   once per process), three tries in all, while it is not late. A word the mod refused for good (too long, no text:
   `refused`, `final`) is not tried again, and the board hands no word over the mod's 3000 characters at all
   (`fitsMod`, bridge.mjs): it fails at once with "too long: N > 3000 characters". A work line is not retried: the
   work store sends its own.
4. The supervisor's rule 8 (`undelivered`) judges a waiting word as the sweep does and names only what still waits
   after it: not a word the sweep drops, nor a person's answer past its keep.

### A chat that was stopped, or replaced (B577)

X3 came back at 21:47 on 2026-10-24: four words to Worker 5 (work B522 twice, work B567 twice, 21:41-21:42) failed with
"a hook dropped it: the session was stopped and nobody has sent input since". The main chat had stopped that worker's
turn at about 21:40, deleted the chat at 21:46 and made a new Worker 5; the board spent its tries within minutes on a
chat being replaced and never handed the words to the new one. Now (`src/stopped.mjs`):

1. A word the app drops because its chat's session was stopped (`isStoppedWhy`) spends no try: `settle` marks it
   `stopped` (not failed) and puts it back as a new word (`retryOf`; the mod types an id once per process) with
   `stoppedAt` and the session that took it (`stoppedSession`, from the mod's typed report). The work store's `sendOnce`
   follows `retriedAs` to the word that stands for a line, so a work line is not sent twice.
2. While that very session has begun no turn since (`isStillStopped`: the lane's `turnAt`), the chat takes nothing
   (`takeFor`): every word would be dropped again. Its lane says "stopped since HH:MM" (state.mjs `stopped`, board.js
   `stoppedLine`), and the main chat is asked once per stop (say.mjs `wakesStopped`, the `wake "<chat>"` word with its
   session id; it waits as long as a start does, and the sweep drops it once the chat is no longer stopped) to send it
   one line by its session id: that is input. A turn begun after the stop, or another session under the name, lets
   the words go, each with its age.
3. A chat replaced under the same name (a new session on the board under that name; a cleared chat is one too): at a
   refresh the words that failed for its old session in the last day (`failedSession`; not final, not tried again)
   go to the new one as new words (`revive`, `revivedFor`), each with its age at the take; the sweep and
   `withdrawStale` close those whose purpose is gone, as any waiting word.
4. Rule 8 names a stopped chat once per stop ("Worker 5 was stopped at 21:42: 2 words wait for it"), with whether the
   main chat was asked to wake it, not word by word; a word that went again is named by the word that stands for it.
5. roles/main.md: a worker the main chat stops or replaces is named to the board in the same move (a work note, "Stopped
   <name> at HH:MM: <why>"), and a stopped worker it keeps is woken at once.

### A failed work line is judged too (B589)

X3 came back a fourth time (after B532, B577, B571): its four words of 21:41-21:42 had failed before B577 kept a
failure's session (`failedSession`), so `revive` passed them by, and a work line is never retried; `withdrawStale`
judged only waiting work lines, and the sweep's `whyClosed` none at all. So they stayed failed after B522 and B567 were
done, and rule 8 named them at every sweep. Now one judge, `workLineWhy` (`src/work/workLines.mjs`), says why a work
line no longer matters ("B567 is done", "B522 left review", "B30 is Builder's now", "its notes were read"), for every
kind: a step's line, a check's word, notes, the sync check's, board-queued, fix-held, partner-ask. `withdrawStale`
closes a waiting line and one failed for good (`isFailedForGood`) by it, `dropped` with its why and `closedAt`; one
whose step is still that chat's and open stays failed, for the person to see. `whyClosed` gives the same answer for a
work line (the sweep itself leaves work lines to `withdrawStale`, which drops the start they asked too), so the health
summary and rule 8 no longer name a line whose step moved on, even before the refresh closes it.
`test/work/failedWorkLine.test.mjs` holds a guard: every kind of work line (scanned beside `workWords` in src), waiting
or failed, whose purpose is gone closes at a refresh; every other command (scanned as `command: '<x>'` in src) waiting
past its keep is closed by the sweep, and failed is judged. A failed word of minutes (not `waitsLong`) is judged by
its time: rule 8 names it for its two hours, the summary for a day.

## A step's title without its note (B292)

The person, 2026-10-17, of Support's lane showing B29's whole line: "tasks still dont have a compact name. i dont
understand why this is happening." Every note in brackets at the end of a step's line is no part of its title on the
board, whatever it starts with: the main chat's "(for Units; after B12; about 1 h)", "(later; not handed out)",
"(not handed out; after today; ...)", a chat's name, where its pictures are; two in a row too (`closingNotes` in
`src/backlog.mjs`). Their parts are still read from every note: who it is for, after what, how long; the step's
words keep the notes, so what reads them (a step held back, the pictures it points to) finds them. The work store
keeps the titles it migrated with their notes (`lineFields` in `src/work/line.mjs` reads only "(for ...)" as
fields), so the line it writes back still says the same step; a lane named after such a title, or after a card
named so, drops the note (`withoutNote` in board.js). Of two steps the store holds in progress for one worker, its
lane shows the one its card names, else the one it took last, never one it was taken off. And a worker whose last
answer closed "- Done:   partly" or "no" is between two turns, not free, whatever the app calls its turn.

## A calmer Overview (B307)

The person, 2026-10-18 on the Advisor tab: "I want to see if i can make this overview slightly easier and have less
text/details. what would you recommend to cut?" Of the six cuts the Advisor drew they kept the refresh icon by the
project's name, the limits' reset times, "Estimates lately" and the next step in each queue, and asked for a handle to
make Information smaller or bigger. Nothing is gone: what leaves a row is in its tooltip or in the details "⋯" opens.
1. Information has a box of its own under the asks (`#information`), as high as the handle above it is dragged (the
   arrow keys too; a double-click gives the usual 260 pixels; kept in this browser, `infoHeightFit`). Each note is one
   line: the step it is about, who sent it, its words without "Report from ...:" (`infoLine`); a click opens the whole
   note with its Read button; "Mark all read" reads each new one in turn. All read and hidden, the box is one line.
   Since the calm panel (2026-10-19) this box is the log, folded by default behind one quiet line.
2. One line per worker: its task, or "free since 13:01" (`freeShort`). "Now:" and "Between turns" are in the task's
   tooltip and its details; the compaction note shows only when it warns, else on hovering the name; "No active task"
   and "Ready for a new task" go, and so does the empty bar of a worker without a task. Alerts, flags, a held or cut-off
   worker and "Needs your decision" stay on the row: they say something is wrong. The Advisor's card follows: its task,
   else what it refines, else how it stands.
3. The time left once, in the column Left ("1 h 34"; over its time "12 min over"), its end time and where the time is
   from in the tooltip (`leftView`); the step line keeps its own time for the list that opens on hover.
4. "Next in queue": the next step's id and title and why it waits ("waits for B277"), "+2" for the rest, nothing when
   the queue is empty (`nextInQueue`); its tooltip has the length of the queue and its time.
5. The head: which commit main is on, on hovering Run game (a running game keeps its link); "0 waiting for you" goes
   (`shownCounts`); how old the limits' figure is shows only when it is old.
6. The top bar: CPU for the chats, its processes and the board's version sit behind ⚙ (`#settings`), whose tooltip says
   the level and the version; a click elsewhere or Escape folds it; on a phone it opens across the screen.

## The simple Overview (B327, B343)

The Overview opens on Simple; Details, beside the title, is the Overview as it was, and the browser keeps the choice.
B327 made Simple one narrow column; the person rejected it (Q70, 2026-10-18: "i expected it to be wider ... I want the
workers and maybe what the current focus is with the tasks"). Since B343, after the agreed drawing
(art-inbox/board-highover/simple-wide.png):
1. The page's full width: the title and the bar on top (the focus goal by its id and title, its steps done and the
   time left; the workers busy; the 5-hour limit and its reset), then three columns. Below 1100 px they stack.
2. Your focus: its steps. The state's `focus.steps` (state.mjs focusState): the goal's steps one by one, its parts' in
   order and then its own, each Done, Working or Next with its worker; the one at work also with its worker's time
   left, read from that worker's lane while it works on that step. A step the store does not hold, or one dropped,
   is not listed. The bar counts these steps (done of all) when the board lists them, else the parts.
   B328: with no focus goal, or the last one done, the bar counts the next milestone instead, the one the Advisor tab's
   Next milestone row shows: "M1 · The loop is fun · 9 of 23 steps done · about 30 h left", every backlog step under
   it and its sub-goals (done of done and open), the parts its Missing lines name ("2 not made yet"), and the time
   the open ones name (`totals.minutesLeft` in src/milestone.mjs; left out when none names one). A milestone not mapped
   yet says so, without a count, as the Next milestone row does.
3. Workers: every chat of the list but leftovers, with its step, a bar of its steps and its time left; one without work
   says in a few words why (free, waits for you, paused until 19:23, not running, cut off).
4. Needs your attention as in Details, without the log's line (and so without "Open instructions" and Information),
   the closed and answered cards and the order and closed switches: those stay under Details. ("From the backlog" is
   gone everywhere since the calm panel; a missed instruction's red line shows here too, and opens the log in Details.) On a phone the inbox stays the third column,
   under the workers (Details puts it first). The restart box shows across the page under the bar, as "Prepare restart"
   needs it.

## Two projects side by side (B319)

Two projects, each with its own copy of the board, run at once on one PC and never meet. The person, 2026-10-18 15:23:
"i can run 2 projects using the same worker board code without it interfering with eachother ... i can runt he worker
board twice perhaps each using their own workers." Part 1 of G12's how; one board that shows several projects is not
in it.

1. The PC's list of boards, `boards.json` in `~/.worker-board` (`WORKER_BOARD_HOME` moves it), holds each project's
   board: its port, the first port of its games, and what its config.json asked for (`src/ports.mjs`, the `boards`
   region). A board writes itself into it once it listens, and `--launch-entry` does when it writes the entry; a
   project folder that is gone leaves the list. A lock file keeps two boards that start at once from losing each other.
2. The port (`chooseHome`): the one the project had, while config.json asks for the same and no other project holds
   it; else the one asked for; else, when another project's board holds it, the next free port from there, passing over
   ports something else listens on, the ports given by hand (4311, 4312: `HAND_PORTS`) and the copies' (4320 to 4419).
   The board says on its second line whose port it gave way to. The first project keeps its port whoever comes later,
   so the first project's board keeps 4310. A new wish in config.json is chosen anew. A port the list does not give the
   project yet is looked at first (review): when something listens there, it is taken only when that is the project's
   own board, as its `/api/board` says (`boardProject`), or, for a board of before it, as the project's own
   `.claude/board.json` says (`whoseBoard`); another project's board, or another program, keeps it.
3. Games: each project has a range of `GAME_SPAN` (100) ports from its first one, never meeting another project's; a
   folder's game takes its place in it. A copy in another working folder of the same repository takes its project's
   range, and its own port (from 4320, `data/port.json`) is never one another project's board holds.
4. The chats: the Workers mod finds the board in the `.claude/board.json` of the project folder its chat was opened in,
   and asks it with that board's own key, so a chat's card, answers and work reach its own project's board; the other
   board refuses the key (proved with two project folders in the mod's tests and with two real boards).
5. The Workers mod is one per PC. `npm run setup` never installs over a newer copy, and leaves a copy that came from
   another board's folder to that folder. A board whose folder carries another version than the PC runs says so on top
   of its page (`modNote`): not installed or older, run setup, there where the PC's copy came from (the app's
   `known_marketplaces.json`); newer, bring the board's folder up to date. Only the board that delivers says it: a copy
   or a board that shows another's history is no install of the mod.
   A second project's board is a clone or a plain copy of the folder, never a `git worktree` of the first: that is a
   copy beside it, which only shows (README, "Two projects on one PC").
6. The proof: `test/twoBoards.test.mjs` copies the board into two folders for two made-up projects, both configured on
   the same port, runs them at once, and checks their ports, their notes and keys, the list, the second's launch entry,
   and that the first takes its own port again after a restart.

## A new project in one click (B320)

The person, 2026-10-18 15:23: "also starting a new project feels like 1 click, the board setsup the folder and chat and
the work stores itself as well." 15:26: "windows only and claude only ... with an icon to run it." Part 3 of G12's how.

1. One flow, `src/newProject.mjs` (`makeProject`), from two doors: `npm run new` (`tools/new-project.mjs`, which asks in
   the terminal or takes `--name`, `--folder`, `--prefix`) and **New project…** under ⚙ on the board that delivers
   (a form: the name, the folder, which follows the name beside this project until typed, and the chats' prefix,
   "<name> - " unless given; `POST /api/new-project`, the page's token, one at a time; the demo and a board that only
   shows refuse). Windows only.
2. A folder that is there and not empty is refused (`folderIsFree`): nothing is ever overwritten. A run that fails half
   way takes away what it made (the folder too when it made it) and its place in the PC's list, so it can be tried
   again (review).
3. What it makes (`projectFiles`): the folder with `git init`; `.gitignore` keeping the board's copy and `.claude/` out
   of the project's repository; a README; the board's own copy in `worker-board`, a clone of the board that makes it at
   its commit, with that board's origin (a plain copy of its files when it is no repository); its `config.json` from
   `examples/config.json` (name, project, no game; the ports from the board's defaults); `.claude/chats/list.json`
   (prefix, main chat; no `boards`: the icon starts the board); `.claude/work` with the default flow, `last-ids.json`
   and one activity named after the project; `CLAUDE.md` from `examples/CLAUDE.md` (the answer rules: compact, the
   For you block, Task and What I did, the closing block, the limit pause); the briefings from `examples/`, filled in.
4. Its port (B319): chosen with the PC's list and written into it at once, so a second new project takes another; the
   launch entry `worker-board` names it.
5. The icon "<name> board" (`shortcutScript`, PowerShell's WScript.Shell): on the desktop and in the Start menu's
   programs, running `node start-board.mjs --open` in the copy, minimised, with `public/board.ico` (drawn by
   `tools/make-icon.mjs`: three lanes in the page's colours). `start-board.mjs --open` opens the page once the board
   runs (`openCommand`). An icon that cannot be made is said, with the command that starts the board instead. Review:
   the script holds no word of the person's: the name and paths reach PowerShell as its environment (`shortcutEnv`),
   so no quote (also ’), `$` or backtick is read as PowerShell; an icon of that name that is there already is kept and
   said. What went wrong on the way (`warnings`) stands under the form's link.
   A board that is no repository of its own (a download, or a folder in a larger repository) is copied as files and
   the copy made a repository of its own, so it delivers rather than only shows.
6. The board is started at once (`startBoard`), and the form shows the link to it.
7. Not in it: a game (added later in `config.json`), the first chats (B322), Mac.

## A chat's "For you" block is filed by itself (B317)

The person, 2026-10-18, yes to: "Should the Workers mod file them by itself from a chat's 'For you' block, so the
board always shows them with an answer box?" Chats sometimes ended an answer with a "For you" block without `work
ask`; the board then showed only the warning "<chat> wrote questions in its chat but filed no ask" (B301).

- **The mod reads the block** (`hooks/foryou.ts`, `forYouItems`): at `turn.complete` of the chat's own turn (reason
  answer, never a subagent's), from the turn's final answer (`e.answer`), when its last part is a "For you" block (the
  board's rule, `handover.mjs` `asksAtEnd`: followed by nothing but a rule and the closing block; a title or an item
  written a little off still counts). Each numbered item is an ask: **Answer:** a decide, or a look when it has a
  picture or play link and no options; **Do:** a do; a numbered item with neither word a decide. Options from lines
  under it (`- **A:** red`) or from its words when clear ("A thin, B thick or C none", "A ... or B ...; ...", the
  letters alone "A, B or C"), else none; the advice from "I advise ..." (to the first comma or full stop); pictures
  from `#picture=` paths, play from `#play=` (`<branch>&<settings>`), each checked as `handover.mjs` checks them; the
  ask's id when the item is one the work tool wrote ("(Q4, decide, blocks B1)"). Nine items at most, and no more than
  fit 12,000 characters of the board's call (it takes 16 KB).
- **One call at the turn's end**: the items go with `turn-ended` as `forYou`, so the turn's end stays one call held
  1.5 s at most, the free worker's pull included.
- **The board files the missing ones** (`api.mjs`, `askForYou`): an item is left out when it names an ask of the
  store, or asks what an ask of the chat filed since the turn began, or one still open, asks already (the words
  compared without markdown, links or the id note; equal, or one the start of the other). B362: also when its words
  name an open ask of the chat's own by its id anywhere, as a word of its own ("(Q128, under B356)", "Q128: ...", "see
  Q128"), as a chat that filed its ask with `work ask` and then wrote its own block in its own words does (Q112, Q131
  to Q133 were filed twice so). Another chat's ask named for context holds nothing back (the review); a new question
  that names one of its own open asks is not filed, and the warning "filed no ask" says so when the chat filed none
  that turn. The others are asks of that
  chat, `Via: chat`, `Blocking: no`, History "asked (decide, from its "For you" block)", under the one step it holds
  in progress, else alone (none, or more than one), as the app form's asks are. The answer names them (`asked`), and
  the view is written when there are some.
- **On the board** they are asks like any other: a card with an answer box under Needs your attention, and an answer
  there wakes the chat. The warning "filed no ask" goes by its own rule, as an ask of the chat now stands since that
  turn began. It stays for a chat without the mod 0.13.7, or when the board did not answer in time.
- **Answered in the chat instead**: beside the chat's next prompt, once, the mod names what was filed ("Filed on the
  worker board from your last "For you" block: Q20. ... close it with work answered-in-chat <id> and their words"); the
  job texts say so too (`roles/worker.md`, `main.md`, `partner.md`).
- **Asked twice in other words** (B474, B480; `src/work/askRepeat.mjs`): an item is also left out when it shares six
  in ten of its first meaningful words (`overlapOf`, three at least) with an ask the chat filed this turn, holds open,
  or another chat holds open; when it leads with an open ask's id; or when it is a do that sends the person to answer
  or open another chat's open questions under a step it names. An ask withdrawn unanswered, or routed to the partner,
  counts for nothing. `work ask` refuses a question of the chat that stands open under the same step or goal, or that
  the person answered within 2 minutes, at seven in ten alike, naming it. What was left out goes back in the answer
  (`left`), and the mod 0.13.18 names it beside the chat's next prompt, once, so a new question that only looked alike
  is filed with `work ask`. `tools/replay-asks.mjs` replays a period of the store through these checks.
- Tests: `test/work/forYouAsks.test.mjs`, `test/work/askedTwice.test.mjs`; in the mod, `hooks/foryou.test.ts` and
  `hooks/chatlist.test.ts` (B317, B480).

## Install with one command (B321)

The person, 2026-10-18 15:26: "windows only and claude only. Preferably its own installer who checks if you have
claude, windows, node installed in order to run the worker board. with an icon to run it." Q4 (15:28): one command with
the checks and an icon now, a real installer (.exe, signed) later. Part 2 of G12's how.

1. `tools/install.ps1`, run as the README says: `irm <its raw address on GitHub> | iex` in PowerShell. It runs in a
   script block of its own (nothing it sets stays in the person's PowerShell) and never `exit`s (that would close the
   window it was pasted into). Plain ASCII, so Windows PowerShell 5.1 reads it alike from GitHub and from a file.
2. The checks, one line each (`[ok]`, `[--]`, `[!!]`): Windows; the Claude desktop app (`Find-ClaudeApp`: the Store's
   package, `Packages\Claude_*`, `AnthropicClaude`, `%APPDATA%\Claude`; missing: where to get it, and it stops); Node 24
   or newer and git (missing or old: offered with winget, `OpenJS.NodeJS.LTS` and `Git.Git`, the PATH read again
   after; without winget, where to get them). `WORKER_BOARD_CHECK=1` only checks.
3. The board: into the folder the person names (`worker-board` in the home folder unless said, `WORKER_BOARD_FOLDER`),
   cloned from the board's repository (`WORKER_BOARD_REPO` to use another); a folder that holds the board already is
   kept as it is (with the command that brings it up to date), one that holds anything else is refused.
4. The Workers mod: `node setup.mjs` in it (B251, B319: one per PC, never over a newer copy); when it cannot, the board
   works without it and the line says so.
5. The project: the new-project flow (B320, `tools/new-project.mjs`). Run again with a project on the PC (the PC's list
   of boards, B319), it names them and only offers another.
6. The tests (`test/install.test.mjs`) run the script's parts through Windows PowerShell as `iex` does, by
   `WORKER_BOARD_TEST`, which calls one part inside the script's scope; nothing is installed.
7. Review: winget's own words and questions show (`| Out-Host`), with `--source winget` and the terms accepted, which
   the question says; a winget that fails is said with where to get the program. An older Node found first after an
   upgrade points to nodejs.org rather than to running again. A typed folder loses its quotes, takes `~` and the folder
   PowerShell is in, and no last `\` (`Resolve-TypedFolder`). The board's folder is remembered
   (`installed.json` beside the PC's list), so a second run offers that one rather than cloning a second. An empty
   `%APPDATA%\Claude` is no sign of the app (an uninstall leaves it). The PATH gets winget's new entries added, never
   replaced. The check-only test takes this PC as it is.

## A new project's first chats (B322)

Replaced on the page by B335 (one Initialise button, below); what the app allows stands as found here.

Right after a new project is made, its main chat and its Advisor are opened in its folder with their names. Part 4 of
G12's how. What the Claude desktop app allows from outside (read in the app's own code, 2026-10-18): its link
`claude://code/new?q=<first words>&folder=<folder>` opens a new chat of the Code tab in that folder with its first
words ready (up to 14,336 characters); nothing from outside sends them or names a chat (the app's session tools rename
and message chats but start none, and a chip or a routine needs a click of its own). So it is the middle way: one
click, then Enter.

1. `chatsToOpen` (public/board.js, region `openchats`): the chats the project lacks, its main chat while the list has
   none and its Advisor while the settings name one and none is open, each with `openChatLink` and `firstWords`. None on
   the demo or a board that only shows (`openChats` in the state is null there: the board's folder, the project's
   name, the Advisor's name).
2. The first words: the chat names itself with its exact title (the app's `set_session_title`, session "self"), joins
   the list (the Workers mod's `chat join`, when it is there), reads its job (`roles/main.md` or `roles/partner.md`),
   `roles/protocol.md`, the main chat also `.claude/main-briefing.md`, and the project's `CLAUDE.md`, and says it is
   ready. The board knows the chat by its title, so it shows within a minute; the main chat is then asked for workers
   as before.
3. Where they are: without a main chat, the box "No main chat yet" holds the buttons in place of the steps by hand;
   with one and no Advisor, a box of its own above the workers; on the simple view (B327), whose workers column
   (B343) has no buttons, under its bar. Each button has "Copy its first words" beside it, for when the app does not open from the link, and
   says for five minutes after its click that the chat was opened (review: no second chat unknowingly). The Advisor is
   offered only while the project is new (no worker yet) and never under the main chat's name; nothing without a
   prefix. Paths in the first words are written as the board's folder writes them.
4. Not in it: the workers' chats (the main chat starts those, as before).

## Ready for strangers on GitHub (B323)

Someone who finds the board on GitHub reads one page and knows what it is, what they need and the command to run.
Part 5 of G12's how. The person's Q53 (15:33): the repository stays private, they invite whom they want, no license
file. It was public on GitHub when this was built; Q72 (17:46): "A Make it private: invitees install with a git clone
line" (the person makes it private on GitHub).

1. The README opens with what the board is (three lines), Install (what you need: Windows, the Claude app and an
   invitation; the two lines an invited person pastes, a git clone and the install script; the one line for when the
   repository is ever public) and what the board is in more words; the steps by hand stand below under "By hand".
2. The words the board reads travel with it: `examples/CLAUDE.md` (a new project's own, B320) is brought up to date
   with the first project's rules in general words (a picture for every option, the play links, the plain first two
   lines, the forms of a report and a note to the main chat); `roles/main.md`, `roles/worker.md` and the briefings
   point to it when a project has none of its own.
3. The README's "Not yet portable" list and `ANY-PROJECT-PLAN.md` say where it stands (B130 and B134 were done).
4. No path of this PC in any file: the made-up paths of the tests are `D:\Work\...`, the history documents name the
   first project's folders in words; `test/anyProject.test.mjs` checks every file of the repository (its own
   patterns and pictures aside).

## A new project's chats with one button (B335)

The person on B322's box of two buttons with copy buttons, Q71 (2026-10-18 17:44): "Rejected. its not clear what im
looking at. if i need to create chats for a new project then just 1 button saying initialise or something is
sufficient". The Advisor's picture: `art-inbox/board-init/initialise.png`.

1. While a new project has no main chat, its board shows one box: "This project has no chats yet" ("No main chat yet"
   when it has other chats, its main chat archived for example), one line, and one button, Initialise (`setupBox`),
   in the workers part and under the simple view's bar alike; nothing else of the workers part shows then. Once the
   main chat has its name, the box is gone. A project with a main chat and no Advisor is offered nothing here: its
   main chat starts one.
2. The button opens the main chat in the Claude app (B322's link, `setupChat`); its first words have it name itself,
   join the list, read its job and the project's facts, and start the Advisor by a chip (when the settings name one
   apart from the main chat and none is open), telling the person to click it. Five minutes after a click the button
   says when the chat was opened.
3. Gone: the Advisor's own box, the second button, the copy buttons and the instructions (B322's parts 1 and 3).

## The proof: a stranger installs it and runs two projects (B324)

Part 6 of G12's how, the last. On 2026-10-18 a helper chat that had only the README (read from GitHub) installed the
board on this PC into a folder of its own, beside the first project's running board, and made a project "Trial".

1. What held: the install's checks; the board kept as it was on a run again; setup left the PC's Workers mod as it was
   ("Nothing to do"); the new project's board ran at once on a port of its own (two trial projects, 4313 and 4314,
   beside 4310), each answering `/api/board` with its own project, the first board untouched; the Trial board offered
   Initialise, and the person's click and Enter gave a main chat that named itself, joined, read its job and, asked
   by the board, put up cards for three workers.
2. What it stumbled on, now fixed: the install's project questions cannot be answered in a window where nobody types
   (the settings `WORKER_BOARD_PROJECT`, `WORKER_BOARD_PROJECT_FOLDER`, `WORKER_BOARD_PREFIX`, passed on to
   `new-project.mjs`, `Get-NewProjectArgs`); `npm run new`'s options and where a project goes without `--folder`
   were not in the README (one went into `Projects` in the home folder); the main chat's first words named
   `spawn_task`, which that chat did not have: they now name the start card (`start_session`) and the chip and take
   whichever the app gives.
3. Cleaned up after: the trial boards stopped, their icons, the project in the home folder and their places in the
   PC's list removed. Recorded in the README ("Not yet portable", 19) and ANY-PROJECT-PLAN.md.

## The help tour's pictures (B347)

G26, the person's brainstorm of 2026-10-18: a help tour of six cards, one painting each, warm and showing the idea
rather than the screen, so the pictures stay true while the board changes. The person picked the style (card 4, the
work divides itself) and, on 2026-10-18, kept all six (Q109).

1. `public/help/`, 1280 by 720 WebP, about 40 KB each: `1-set-up` (one command, then Initialise), `2-pick-focus`,
   `3-vibe-and-how` (with the partner), `4-work-divides`, `5-answer` (what needs you), `6-check-result`.
2. Painted by Codex, with card 4 as the style for the others: the board's navy with blue, green and amber, rounded soft
   3D, the person in an amber sweater and the white robot workers; no words, letters or numbers, so the card's own
   lines carry the words.
3. The person's test: a card whose idea cannot be painted simply points at a part of the board to simplify. All six
   were painted simply at the first try.
4. Not served yet: the tour (B348) adds them to the page.

## Public for anyone (B349)

The person, 2026-10-18 20:35 (Q107): "its ok to keep it public", which takes back B323's private repository (Q53,
Q72). The README's Install speaks to anyone: what you need (Windows and the Claude app), the one line that fetches the
install script from GitHub and gets the board, git included, and the git clone for whoever wants to read the script
first. Nothing in it says private or invited; the Git part reminds that anyone reads what is pushed. Not in it: a
license file (Q53 left it out).

## The help tour (B348)

G26, the person's brainstorm of 2026-10-18 ("i want a help me button in top right of screen and when you first open
the worker board"): help you can follow in a minute, its pictures the paintings of B347.

1. A round **?** at the far right of the bar of tabs, so it is there on every tab, opens the tour at its first card.
2. Six cards in a dialog over the page: the painting (16:9), "number · title", one or two plain lines naming the
   board's own parts (Initialise, the Focus tab, Go, Needs your attention), a dot per card, Back and Next; the last
   card's button says Done. The arrow keys move; × and Escape close at any time. The painting's alt text says what it
   shows, since the painting has no words.
3. It opens by itself at the first read of a browser that has not seen it, on a plain address only: a link from a chat
   (a picture, a game, a step, a tab) shows what it links to, and the demo, whose pictures the chats take, never opens
   it. Closing it keeps `help-seen` in the browser (one board per port, so each project's board shows it once); a
   browser that keeps nothing is not shown it every time.
4. On a phone (600 px or narrower) the card fills the screen, its buttons at the bottom.
5. The server serves the six paintings by name (`/help/<name>.webp`), nothing else from their folder.
6. Not in it: help texts inside the board's own parts.

## The help tour drawn as the board (B375)

The person, 2026-10-19 (I23): "I want new pictures for the introduction of the board that are more drawn like the
actual board. simplified, but like it's clear roughly how to board looks like and what steps it needs to do". They
picked the drawings over the paintings of B347 (Q173, A, with the new titles and lines).

1. Six SVG pictures in `public/help/`, made by `node tools/help-pictures.mjs`: the board in its own colours and shapes
   (the tabs, the Overview's columns, the Focus page with its stages and the talk, the how with Go, Needs your
   attention), the part each card is about ringed in amber with its number and a few words.
2. The cards follow the person's steps: 1 install, 2 Initialise, 3 talk it through with your partner (the Focus tab),
   4 Go, 5 the workers build, 6 you check (Needs your attention). Picking the focus is part of 3, answering part of 6.
3. A change of the board is a redraw: change the drawing in the tool and run it again. The paintings are gone; the
   server serves `/help/<name>.svg` by name, nothing else from the folder.

## High effort mode for the partner (B352)

The person, 2026-10-18 (I16): "while refining a goal, i want a button to change the claude chat working on it, to
other model/effort, lets call it high effort mode. so like fable 5.1 max effort. otherwise it will use opus extra".

1. A switch under the talk with the partner on the Focus page (the vibe and the how): "High effort mode · off: Opus
   5.5, extra high" or "· on: Opus 5.5, max", amber when on (`src/partnerEffort.mjs`, `PARTNER_MODES`). Since 2026-10-24 high effort is Opus at
   max effort, not Fable (the person: "maximum run opus ... you cant run fable without my permission"); the switch only
   ever sends `usual` or `high` (`SWITCH_MODES`). A third mode, `fable` (Fable 5.1 at max), comes only from the goal
   guard after the person's yes (the next part); while it is on the switch reads "· on: Fable 5.1, max", and flipping it
   goes back to the usual partner.
2. The board cannot change a chat itself: the switch types `partner effort` (Chat, Mode, Model, Effort, Session when
   known, Why) into the main chat, which sets the partner's chat with the app's `set_session_model` and
   `set_session_effort` (roles/main.md, roles/protocol.md). It is one of the board's words, never the person's.
3. The mode shown is the last such word in the outbox that arrived, which the outbox keeps however long the partner is
   idle (`outboxNow`, review); without one (none asked) what the partner's last answer ran on says it, so high effort
   is still known and switched back on Go. It is set once the partner's next answer runs on that model and effort: the app writes both on every
   answer in the transcript (`parseTail` keeps `model` and `effort`; a helper's lines do not count); until then the
   line is dashed and says "Switching…". A word that did not arrive (expired, or the Workers mod could not type it)
   changed nothing and says so.
4. Go on the how and another goal as the focus switch it back to the usual partner (the person's yes, 2026-10-18), so
   the run's refining and rounds use the usual partner; the talk about the same goal started again keeps it.
5. Not in it: a switch for the workers' chats or the main chat.

## The goal guard asks before Fable (2026-10-24)

The person, 2026-10-24: "i want to prevent any chat running fable. i run out of tokens too quickly. maximum run opus.
if you really require fable somereason exclicitly ask, you cant run fable without my permission"; and "on 3 failed
attempts is important context. i want to be asked. hey this task failed 3 times, we would like to evaluate strategy
using fable. yes, or no use opus."

1. The goal guard (B359, `src/goalGuard.mjs`, `src/focus.mjs` `guardGoal`) no longer starts the fundamental evaluation
   at a goal's third failed attempt. It files one ask to the person through the work API as the board (`as: 'server'`,
   `fableAskOf`): kind decide, blocking, of the goal, its title "G<n> failed 3 times: evaluate the strategy with Fable?"
   (the real count), two plain lines (what failed and the latest failure; that Fable 5.1 is the strongest model but uses
   far more tokens than Opus 5.5), the options "A Yes: Fable 5.1 (max), only for this evaluation" and "B No: Opus 5.5
   (max)" (the person's framing: "yes, or no use opus"), no advice. It is the person's: never routed to the partner (the board is no worker or main chat), and only the person
   answers it on the board (its Owner is the board, so no chat can close it in its chat). The work API lets the board
   ask of a goal as it lets the partner.
2. The board writes `Fable asked: Q<n>` under the goal. While the ask stands open the guard does nothing more: no
   second ask, no evaluation, no mode word (`guardStep` says `wait`). An open ask of the board's for the goal whose line
   was lost is used again (`openFableAsk`), never filed twice.
3. The answer starts it (the person's answer runs the guard, as every answer of the goal's asks does, and the board's
   tick runs it for every goal with a `Fable asked` line, `guardsAsking`, so a missed one starts too): `Evaluation asked:
   <date time>` under the goal, the partner set by the `partner effort` word, then `evaluate G<n>` as before. Fable only
   for the person's yes (`modeOfAnswer`): an answer that is A alone (any case, its punctuation), A followed by its
   option's words ("A Yes: Fable 5.1 (max), ...", "A: yes"), or whose first word is yes. B, "a bit pricey, use opus", any
   other words, a withdrawn ask or an answer by the partner give `high`, Opus 5.5 at max. An ask the store no longer
   holds (deleted) starts it on Opus too, and its line goes, so the goal is never "asking" for ever.
4. The `partner effort` word for `fable` names the ask: `Yes: Q<n>, the person's yes: Fable for this evaluation only`.
   `partnerEffortWords` throws for mode `fable` without a `Q<n>`, so no code path sends it without the answered yes; the
   page's switch is refused it (`checkSay`, `SWITCH_MODES`); the server never sends `fable` itself, only the mode the
   answered asks give, and its why names the mode used.
5. While evaluations run, the partner's mode is `evaluationsMode` (`partnerModeFor`): Fable only when every evaluation
   that runs had the person's yes, else Opus at max; one asked again (B528) keeps its mode the same way. The trip ends
   (`endTrip`: `Evaluation asked` and `Fable asked` taken away) with the evaluation's marked how-draft, with Go on a
   reopened how, and with the goal's tick (a passed re-check, or the person's overturn), so a reopened goal never brings
   Fable back on an old yes. Go or a tick while the board still asks withdraws its ask (the board owns it). The
   evaluation's end switches the partner back to usual, as before; another that still runs keeps its own mode. Go and a
   new focus switch Fable back as they switch high (`effortBack`). And on every tick, a partner the board set on Fable
   (its own word) goes back to usual, or to Opus at max, once no evaluation with the person's yes runs (`fableBack`):
   Fable never stays on. Fable the person set by hand is theirs. The next trip asks anew: an old yes is no yes for it.
6. The review of 2026-10-24, a deadlock: the work API's turn waits on the goal map's for a draft or a goal's re-check,
   so the guard never files its ask while it holds the map's turn. The guard runs one at a time in a turn of its own
   (`guardGoal`): its step under the map's turn (it reads the store fresh), the ask through the work API outside it, then
   `Fable asked` under the map's turn again (read anew: an ask for a goal ticked or changed meanwhile is withdrawn). The
   withdrawals the map's moves ask for run after the work API's turn, never awaited inside it.
7. The Focus page's run shows "Fable or Opus? The board asks you" with the ask while it stands (`guardOf` state
   `asking`).
8. Nothing else picks Fable: roles/main.md (sets Fable only on a `partner effort` word with `Mode: fable` and its `Yes:`
   line, never a subagent with model "fable"), roles/partner.md, roles/worker.md and roles/supervisor.md (never), and the
   settings' `models` refuse a Fable id (`modelIds`). The model chip still shows Fable when the person sets a chat to it
   by hand.
9. Tests: `test/fableAsk.test.mjs` (the deadlock as a test that times out without the fix); `test/goalGuard.test.mjs`
   fires the guard through the answered ask.
10. The person, 2026-10-25: the steps of a goal in its fundamental evaluation no longer run on Opus by force (B518, B525
    lifted their model to opus, about $4.60 a step against $1.81 on Sonnet, 14% of all spend): the work API
    (`guardedDefaults`, `liftModel`) lifts only the effort, to high, and the model stays as given (the Advisor's `model` at
    refine: sonnet unless the step is hard); the evaluate word says so (`Next steps:`).

## Done when and the standard per kind of work (B354)

Part 2 of G11's how (agreed 2026-10-18 21:21). The vibe: nothing is done unchecked; every kind of work has its standard
and reference written before it is built. The person, 21:18: "i want to ensure the way the new board works is work
agnostic. it just needs to have clear ways on defining the goal, but also verifying its actually reached".

1. A goal is picked as the focus and ticked only with a `Done when:` line with words in it (`hasDoneWhen`,
   src/goals.mjs). The focus pick, "Is the vibe there?" Yes (src/focus.mjs) and the Goals part's tick (src/goalsWrite.mjs,
   `doneWhen`) refuse it with why. The person's button asks the partner (`done-when`, a Focus move: the word
   `done when: G<n> <title>` with the partner's job, roles/partner.md "Done when"); it changes nothing in the map.
2. Something new goes into the map without a focus, and the partner is asked for its Done when with the person's words;
   the person picks it once the line stands. The board cannot know when the partner wrote it, so it picks nothing by itself.
3. The settings' `kinds` (src/config.mjs): `{ kind, done, reference }`, the name, the definition of done and the
   reference folder, paths inside the project; each kind once. The board names no kind itself; the partner's rounds list
   them ("Kinds of work").
4. A step's `Standard:` line (src/work/standard.mjs): `<kind> · <reference picture> · target <score>`, or `none (<why>)`.
   The work tool's `refine`, `refined` and `new` take `standard`; the block keeps it after Size (and the step its
   `## Standard` section), so a next round and the person's answers keep it. `refined`, and `new` from an agreed how,
   are refused for a step whose title or text names a kind (its name or plural, whole words, any case) without one; the
   refusal names the kind's reference folder and definition of done. A chat whose work tool has no `standard` yet
   (its process started before the mod had it) gives it as a line of `what` starting "Standard:" (`withStandard`).
   The Workers mod sends `standard` since 0.13.10 (the person's yes, Q142, 2026-10-18 22:33).
5. The Focus page's run shows each part's standards (its steps', each once, none left out).
6. Not in it: the checks themselves (the next parts of G11), the project's own definitions of done (B355).
7. The review's findings: the focus picked again ("Start the talk") is never refused, also one picked before the rule
   without a Done when; the person's words longer than a new goal's title stay under it (`Note: In your words: ...`);
   the board shows the pictures of each kind's reference folder too (`shownRoots`, src/pictures.mjs), inside the
   deepest shown folder; a kind's name inside a compound, a path or a file name does not count, and a y after a
   consonant takes ies; a goal asked for can be asked again ("Ask again"), and the Goals part puts the word on the
   clipboard without the Workers mod; a goal of the game plan has the ask too (the partner takes its line from the plan).

## Done only after a check by a helper (B356)

Part 3 of G11's how (agreed 2026-10-18 21:21). The vibe: a step is done only when a helper that did not build it
ticked every agreed point against the standard and the reference. The person, 21:18: "verifying its actually reached
and otherwise automatically create follow up steps to fix them"; Q128 (21:27): art below its target goes back to the
worker for another try, until the attempts stall; only then the person's call, with the gap named.

1. A step needs the result check when it has agreed points ("What we build") or a Standard line
   (`needsResultCheck`, src/work/resultCheck.mjs); one without keeps the board's own check alone.
2. The flow's guard "the check passed and no ask of kind look is open" means both checks for such a step: the board's
   own (its last "check passed", not pending) and the result check (its last "result check passed"). The flow file
   names the same guard, so the project's own flow.json needs no change. A board that names no partner chat makes no
   result check (`hasPartner`): its own check closes a step, as before.
3. Once the board's own check passed and no result check stands yet, the server types `check step` (Step, Built by,
   the job) to the partner (`checkStepWords`), and wakes it through the main chat when its chat does not run. A
   "Check again" that passes asks again while none stands.
4. The partner has a fresh helper check it and files `work checked` (the partner only): `evidence` (a path, or
   "none (why)"), `points` ("pass: ...", "fail: ...", "ask: ..."), `score`. Kept under `## Checked`, a History line
   "result check passed|failed|waits for you: <n> of <m> points pass, score ...".
5. A failed point makes a fix step (`fixStep`): "Fix: <the failed points>" (no brackets at its end, about 100
   characters), state queued for the same worker, its activity, goal and standard, refined ready "from the result check
   of B<id>", `Fix of: B<id>`; the step counts `Attempts` and waits in review. A fix that is done closes the step it
   fixes once no other fix of it is open ("result check passed: its fix B<n> is done"), up a chain of fixes too.
6. An ask point makes no fix step: the partner asks the person under the step and files `checked` again after.
7. The step's window shows "Checked by a helper" (the ticks green, red or amber, the score, the evidence picture) and
   "A fix of B<id>"; the Focus page shows under each part "Checked by a helper: n of m points pass (B<id>)" with the
   evidence to open.
8. The Workers mod's work tool takes `checked` and its fields `evidence`, `points` and `score` (0.13.11). B381: a
   point is kept whole (up to 4000 characters, within the board's 16 KB per call; it was cut at 300), and the fix step carries its failed points whole in
   its What we build, its Context and its refine block; only its title is short.
9. Not in it: the picture tool (B357), the goal re-check (B358), the stall rule's own setting (B361).
10. The review's findings: the result check counts from the step's last report (a report anew asks anew); a History
    line is read by its words, whoever wrote it; "Not in it" lines and a Standard of none ask for no check. A failed
    step is through once every fix of it is done or dropped and one at least done, with no point waiting for the
    person (`fixesThrough`; the second review: only the fix that check made, named in its line): the guard reads it,
    so a fix closed by the person's tick or the board's own move lets the
    reconciler close the step too; only dropped fixes do not, and the partner checks it anew. One fix at a time: a
    `checked` while a fix is open is refused; a fix made for a step that could not be written is taken back.
    The second review: a History line counts by the words right after who wrote it, so free words cannot fake a check;
    a fix that is done while its step is not through (a point for the person, or reported since) has the partner
    asked for that step again (`closeFixed` answers it, the server's `askResultCheck` types it).

## The goal re-check before its tick (B358)

Part 4 of G11's how (agreed 2026-10-18 21:21). The person, 20:56: "before we can mark a goal as done a reevaluate of
the goal needs to be done if its actually complete"; 21:18: "verifying its actually reached and otherwise
automatically create follow up steps".

1. A tick on the Goals part (the server routes `state` done there while a partner is on the board) and Yes to "Is the
   vibe there?" ask the partner for the goal's re-check (src/focus.mjs `goalDone`, `askRecheck`): `Recheck asked:
   <date time>` under the goal, once, and the word `goal re-check:` (the goal, its Done when and vibe, the job). A goal
   without a Done when is refused (B354). Without a partner on the board the Goals part ticks as before.
2. The partner's helper re-checks it and the partner files `work checked G<n>` (src/work/api.mjs `goalCheck`): every
   Done when point and vibe line pass, fail or ask, the evidence picture, the score. The board writes `Rechecked
   (<date time>, <who>): <passed|failed|waits for you> · <n> of <m> points pass · gap: ... · evidence <path>` under the
   goal (`goalChecked`) and takes `Recheck asked` away. Passed: ticked, the focus cleared, a recap note to the person in
   the partner's name. Failed: open, an attempt (its failed re-checks counted); the partner makes the follow-up steps
   into the goal's how. Ask: the person judges, and the partner files again.
3. After a failed re-check the person's tick stands: ticked, with `Overturned (<date time>): ticked by you after the
   re-check failed` under it.
4. The Goals part's folded line says where the re-check stands, and its lines show every re-check and overturn; the
   Focus run shows "Your partner re-checks it" in place of "Is the vibe there?", or the gap it found with the attempt.
5. Not in it: the two guards (the next step), the recap's own look; no change to the Workers mod (`checked` takes a
   goal's id).
6. The review's findings: a tick after a failed re-check asks a new one; the person's tick without a passed re-check
   is their second click while one is open (`overturn`), written "before its re-check came" or "after the re-check
   failed"; a tick while it is open types the word again, once a minute at most, so a re-check never stays stuck; the
   Goals part can take a re-check back (its line removed), and `goalChecked` then refuses a late outcome; one that waits
   for the person stays asked; without the Workers mod the word is put on the clipboard; Undo does not count a re-check
   asked or an overturn; a point's " · " and a long gap no longer break the line.
7. The second review: the page keeps the overturn's confirm for its second click (the dot and the menu); No to the
   vibe takes an open re-check back too, so a later pass cannot tick it; a take-back is no change Undo takes back.

## The goal's steps beside the map (B383)

The person, 2026-10-19, from the Design tab (their agreed picture of the Goals page): "I want to use the right side of
the screen to show the steps associated to the selected goal and to show the 'missing steps'."

1. A right panel "Steps for this goal" (public/index.html `aside#goals-steps`, public/board.js region `goalsteps`) for
   the goal zoomed into: on a screen of 1180 px and more beside the map (a grid on `#view-advice[data-pane="goals"] >
   .advisor-goals`), narrower under it.
2. Associated steps (`goalStepsView`): those its Steps and Part lines name, then the store's steps with its Goal, a
   dropped one left out; each numbered by its place (the number stays whatever the filter shows), its title, one line
   (its summary, else its first point), its badge from where it stands in the flow (Done, Working, In review, Needs you,
   Queued, Ready, New) and its chat, and a menu (open the step, open its chat's window). All, Open or Done; done steps
   fold under "Show N completed steps" and fold again.
3. Missing steps: the goal's Missing lines, each split at a dash into words and a line under them, with Add step and
   Dismiss, and "Add all N to this goal". Add step (`missing-add`, src/goalSteps.mjs `missingToSteps`, one at a time)
   makes a step under the goal through the work store's `new` as the person (its title `stepTitleOf`: the words before
   the dash, nothing the backlog's line reads as more; its activity the one most of the goal's steps are in), links it
   into the goal's Steps line and takes the line out, found by its words; a line the store refuses is named and Add all
   goes on. Dismiss (`missing-dismiss`, `removeGoalMissing`) takes the line out, undoable as any change of the map.
4. Not in it: the left and middle of the page (a step of its own afterwards, as the person said).

## Partner answers: detail questions go to the partner first (2026-10-19)

The person, 2026-10-19, chose this over a blanket auto-approve (which this project will not build): "detail questions
go to your partner first; the partner answers them, taking the worker's advice, and lists each answer in its daily
note with an Undo; questions only you can answer still come to you; work keeps moving and you keep the last word".
Picture: `art-inbox/worker-board/partner-answers/note.png`.

1. **The setting** (`src/work/partnerAnswers.mjs`, `store.mjs` `readPartnerAnswersFile`, `writePartnerAnswers`):
   `<work>/partner-answers.json`, `{ "on": true|false, "since": <ms> }`; missing or unreadable is on (the person gave it
   priority). `readStore` gives it as `partnerAnswers`, the state as `partnerAnswers` (null without a store). The
   person switches it on the Focus page (`partnerSwitchView`, `partnerSwitch`: under today's note in the run, else under everything else): `POST /api/work`
   `partner-answers` with `on`, person only. Off: everything as before.
2. **Routing** (`api.mjs` `ask`, `routesToPartner`): while on, an ask filed with the work tool by a worker or the main
   chat (not the partner, not the person; not `Via` form or chat: the app's question form and a "For you" block the
   person already sees) of kind decide or look with options or advice gets `Route: partner` (History "asked (...): to
   the partner first"). The tool answers "Q<n> goes to your partner first ..." instead of the "For you" block. A
   blocking ask of the holder still moves its step to waiting on you. `storeNeeds` leaves it out of Needs your
   attention, and the reconciler's "old ask" too.
3. **The wake** (`reconcile.mjs` `partnerAsks`, `deliver.mjs` `partnerAskKey`): `reconcile` takes the partner's card
   (`partner`: name, state, isRunning, idle; from `state.mjs`) and names each routed ask while the partner is free (its
   card free or off, or its chat not running: `wakeFor` asks the main chat to start it), never while the person pauses;
   the delivery sends `work: Q<n> is yours to answer for the person; run work next` once per ask (`kind:
   'partner-ask'`), withdrawn while waiting once the ask is no longer routed and open. The partner's `work next` lists
   the routed asks first ("Asks you answer for the person ...", their options and advice) and how to answer them.
4. **The answer** (`api.mjs` `partnerAnswer`, the partner only): `partner-answer` with `id`, `text` (by default the
   advice) and `why` (required): the ask is answered (`Answered by: partner`, `## Answer`, `## Why`, `Daily note`),
   History "answered by the partner: ... (why: ...)"; its step goes on as with the person's answer, and the asking chat
   (and the owner of a step it frees) is woken as by the person's answer, through `server.mjs` `sendWakes`, now also
   from the work tool: `(answered on the worker board, HH:MM) Q<n> "<title>": Your partner answered this for the
   person: <answer> (why: <why>). The person may still take it back.` The line `Q<n> (<asker>, B<n>): <title> →
   <answer> (<why>)` is added under "Decided for you" of the partner's newest note of the focus made today (its first
   History line's date; a note that only counted its lines counts them anew), else a new note of the day (`Today's
   note on G<n>: ...`); without a focus, a note to the person of no goal ("Your partner's answers of <date>"). The
   ask keeps the line it stands under (`## Note line`) beside `Daily note`: the board finds an answer's ask by these
   fields, never by the line's words.
5. **Handed on** (`escalate`, the partner with a why, or the board): `Route: person`, Since now, the card's line under
   `## Route` ("Your partner hands this to you: <why>"; the board's: "Your partner did not answer in 30 min: it is
   yours", "No partner chat is on the board: it is yours", "Your partner's answers are switched off: it is yours"),
   History "to the person: <why>". The reconciler names (`escalations`) a routed ask still open `PARTNER_ANSWER_MS`
   (30 min) after its filing, whatever the partner does (busy, cut off, paused); every routed ask at once when no
   partner chat is on the board or the setting is off; the delivery carries them out as the server, also while paused.
6. **Undo** (`api.mjs` `undo`, `takeBack`; `focus.mjs` `undoLine` with a `tell` port; `server.mjs` `undoNow`): the
   note's Undo on a line that lists a partner's answer (the ask whose `Daily note` is that note and whose `Note line`
   is that line), and the Undo on the answered ask's card ("Show closed": a partner's answer stays among the closed cards for 7 days,
   `canTakeBack`; `partnerAnswerView`, `partnerAnswerParts`, the click table's `take-back`, B408), take it back: the ask is open again with
   `Route: person` and "Your partner had answered: <answer>; you took it back" under `## Route`, a step its holder blocked
   on it waits on the person again (the flow's move as its holder's role), the note's line is marked under "Undo
   asked" (the page says "taken back"), and the asking chat gets one line, "The person took back the partner's answer
   on Q<n>; wait for their answer." (`takenBackWords`, `kind: 'taken-back'`). Nothing is typed to the partner. Once only:
   a second Undo changes nothing; an ask the person answered after is no partner's answer any more (409).
7. **The jobs**: `roles/partner.md` "Detail questions" (take the worker's advice unless it goes against the agreed
   vibe, a standard or something the person decided; escalate money, deleting, publishing, a new screen, a rule of the
   game, anything that adds more than about an hour of work, approving finished art or a new look (sprites, maps,
   effects); one line why), one line each in `roles/worker.md` and `roles/main.md`,
   `roles/protocol.md`. The Workers mod 0.13.12: the work tool's actions `partner-answer` and `escalate` (`id`, `text`,
   `why`).
8. Tests: `test/work/partnerAnswers.test.mjs`, `test/partnerAnswersPage.test.mjs`; four older ask tests switch it off
   (the person answers there, as before).
9. **The review's findings** (the independent review of 2026-10-19):
   - One note per goal per day (`noteOfToday`, `dailyNoteMerged`): the partner's own `work note` with `of` G<n> made
     later the same day merges into today's note of the goal (its decided lines added, none twice; its needs first, the
     note's others after; its words in place of the note's), so no later note hides the answers. The Focus page shows
     that note, every decided line with its Undo; the state names a line's ask by the ask's fields (`focusRun`: `ask`,
     `takenBack`), and the page's "taken back" goes by `takenBack`, the line after a take-back by the line's `ask`
     ("Taken back: the question comes to you ..."). Answers the Focus page does not show (no focus, or an earlier
     day's) stand under Needs your attention in **Decided for you by your partner** (`partnerDecidedOf`,
     `drawDecidedForYou`), each with its Undo, for 7 days (`TAKE_BACK_MS`); the answered card keeps its Undo as long.
   - No routed ask waits without end: 30 minutes from its filing, whatever the partner does. While routed, a chat whose
     blocking ask waits on the partner is held between two turns, not waiting for the person: its lane says "Waiting for
     your partner (Q<n>)" (`storeWaits.partner`, the lane's `waitsForPartner`, `laneStateText`), and Needs your attention
     shows **With your partner: <n> questions** (`withPartnerOf`, `drawWithPartner`), a click lists them.
   - A take-back marks the note first; a note that cannot be marked fails it (500, "nothing changed; try Undo again"),
     so the Undo stays; when the ask cannot be written after, the note's mark is put back.
   - `roles/partner.md`: the hand-on list names work of more than about an hour and approving finished art or a new look
     (sprites, maps, effects).

## When you are bothered, and rebuilds by themselves (B361)

Part 6 of G11's how (agreed 2026-10-18 21:21). The person, 20:56: "I want a setting where I can tweak if i get bothered
right away or when i need to be notified, in the boards settings"; 21:18 on rebuilds: "this will normally require an
approval from the user, but can be automatically approved."

1. The ⚙ panel holds two switches beside CPU for the chats: **Bother me** (At once, Once a day; it says that a question
   that holds up a chat always comes at once) and **Approve rebuilds by itself** (Off, On). They are the settings
   `botherMe` (B360) and `approveRebuilds` (B359): a click sends `POST /api/settings` with one key and value
   (src/boardSettings.mjs `checkSetting`), the board writes it into its config.json (`settingChanged`: every other
   setting, the indent and the line ends kept; a broken file is left alone) and runs on it at once. The demo changes
   them in memory only; a board that shows another board's history does not change them.
2. Once a day: Needs your attention leaves out the store's asks that hold up no chat (not blocking, not a refine
   question, not of the app's form; `gatheredAsks`), and the Focus page shows them under the partner's daily note,
   beside the recaps of B360, as their own cards: their pictures, options and answer, answered there.
3. Not in it: new kinds of notification.

## A calm Needs your attention: the log (2026-10-19)

The person, 2026-10-19, about the "Open instructions" part and the Information list on the right side: "can we hide
these two away somewhere? i rather not see this information by default. Also the 'from the backlog' can be removed."
Pictures: `art-inbox/worker-board/calm-panel/before.png` and `after.png`.

1. **The log.** Open instructions and Information leave the list. At the very bottom of the panel one quiet line
   (`#log-line`, a button): "Log: 44 reports · 3 instructions", the notes not read yet and the instructions not closed
   (`logCounts`, `logLineText`: one in the singular, a part with none left out, "Log: nothing new" for none). A click
   unfolds the log under it (`#information`, the box of B307 with its handle): Open instructions as B298 drew them,
   then Information as B299 and B307 drew it, "Mark all read" and all; "Nothing in the log yet." when both are empty.
   Folded or open is kept in this browser (`log-open`, in try/catch: without storage it is folded after a reload).
   Simple leaves the line and the log out. On a phone (up to 1250 px) the log flows under the asks, without a handle.
2. **A missed instruction is the person's.** An instruction a chat missed (red in the log) also stands among the asks,
   after the partner's group, as one red line each (`missedLines`, `drawMissed`): "Main missed your words of 14:02:
   open the log". A click opens the log and brings that instruction into sight (`openLog`); in Simple it goes to
   Details first, as the person's click on Details would.
3. **"From the backlog" goes.** The asks the backlog held (migrated with their B ids, kind ask) are cards like every
   other (`panelNeeds`): an open one among the asks, counted; a ticked one closed, shown only with "Show closed". The
   server still sends them as `backlogForYou` and `backlogClosed`, which their answers go by (say.mjs, tick.mjs,
   games.mjs). "1 answered, hidden" still counts only what was answered on the board lately. The Backlog tab's own
   filter for the person's steps stays as it was.
4. **The count** on the tab counts what waits for the person: the open cards, the refine lines, the answers to read on
   the goal map, the brainstorms waiting, and the missed lines; never the log's notes or open instructions.

## A recap's two buttons (B390)

The person, 2026-10-19 (I28): "i get 2 buttons, overturn and feedback but dont they mean the same thing. i also want a
button approve/mark as seen. so red is overturn with text feedback, blue is ok, mark as seen no text needed."

1. A recap card at rest shows two buttons and no box: **Overturn** (red) and **OK, seen** (blue). The Feedback button
   is gone, on Needs your attention and under the daily note alike.
2. Overturn opens a box for the person's words (the answer forms' `openForms`), sent with "Overturn with these words"
   as before: a fix step from them, or the goal opened again; Cancel closes the box and drops the words.
3. OK, seen sends the store's `seen` (the person only): the recap is approved at once, `Recap: seen`, read, its
   History "seen by you: approved at once"; no words, so no partner chat is needed and nobody is woken. The store's
   `feedback` action is gone; a recap answered with it before still says so.

## Short recap cards: Context, Change, Before | After, one Checked line (B569)

The person, 2026-10-24 (I92): the information cards are not readable: too much text, written as if they know what went
on, and the picture always shows "3 points pass". Their example card (B568) was answered "Yes, build all cards like
this" (Q352).

1. A report's result opens with `Context: <what was wrong or missing> Change: <what the person gets now>`, then
   `Details:` (or a `Tests bite:` line) and the rest for the check (src/work/recapWords.mjs `reportParts`). The
   board's check of a report (check.mjs, in git and outside it) used to fail without both, with a Context over 300 or a
   Change over 500 characters, or with file names (or paths), code words or commit hashes in them; since 2026-10-25 it
   passes with a warning (`partsWarnings`) and the board builds the card's words itself (below, "The report check
   judges the work, not the wording"). A report takes up to 2000 characters; the board warns when it cut one.
2. The recap note keeps them as sections `Context` and `Change`, and `Points pass` ("5 of 5": the check that closed
   the step; a step closed through its fix has every point pass); sections, not head keys, so a board not yet updated
   still reads the note. A goal's recap: its why as the Context, its Done when as the Change.
3. The card: the step's title (an incident fix's "Fix of X<n>:" left off), bold Context and Change, the picture,
   then one quiet line "Checked: 5 of 5 points pass" that opens the step's points (`#details=B<n>`; a goal's on
   Goals). Nothing on screen: no picture.
4. The picture of a visible change is Before | After: the worker shoots `<picture folder>/B<n>/before.png` and
   `after.png`, the check's helper sets them side by side with `tools/evidence.mjs --before --after`
   (`before-after.png`, labelled, no points). The ticked list alone is no picture any more: such evidence is
   `none (nothing on screen)`.
5. A recap made before B569 (no `Points pass`) is read in the same form from its step's record at read time: the
   Context from the step's summary, the Change from its report, each in plain sentences (asides, files, code words,
   hashes and check words left out); its points picture dropped, a Before | After kept.
6. B591 (the result check of B569): a card is read by someone who forgot, as the agreed one. The report check also
   warns of item ids (B12, Q3, G15, ...) and placeholders (`<n>`) in the Context and Change (`plainFaults`); an old
   record's sentence with one, a time or a measured wait, or half a quote is dropped. Every card shows only a
   Before | After picture, also a recap made since B569 from a check with a points picture. Cards whose words were cut
   from an old report get theirs written anew by `tools/recap-words.mjs <work folder> <words.json>` (the words from a
   file outside the repository, checked as a report's are; `Points pass` kept or taken from the step; a History line).
   An open card's status says only "Approves itself in 22 h.": its two buttons say the rest.

## A step waits for the partner, not for you (B392)

The person, 2026-10-19 14:46: "it says worker 6 is waiting for me but i dont see it. fix it and prevent this future
problem". A worker's blocking ask went to the partner first (Route: partner) and was not shown to the person, while its
step moved to "waiting on you" as the flow says (the project's flow.json is the person's and stays as it is).

1. `partnerWaitOf(stepId, items)` (src/work/partnerAnswers.mjs) is the one test: the ids of the step's open blocking
   asks when every one of them is routed to the partner, else null. It is derived from the asks each time, never kept as
   a second state: the moment the partner hands an ask on (Route: person) the step is the person's.
2. `flowOfStep` and the focus goal's steps (`focusState`) carry it as `waitsForPartner`. The page shows "waits for your
   partner (Q<n>)" in pink (`--partner`, apart from the violet of Suspended) in the step window's flow strip, the Goals page's steps panel, the Overview's
   focus steps and workers (no time left in its place), and the worker card's pill. The chat's lane already said so
   (`waitsForPartner` of the lanes, Partner answers); Needs your attention never listed such an ask.
3. A routed ask open ten minutes (`PARTNER_AGAIN_MS`) wakes the partner once more while it is free (the reconciler's
   `again`, its own delivery key), never beside a line about it that still waits to be taken nor within ten minutes of
   the last; at 30 minutes it goes to the person as before. Only a step still at work (taken, in progress, waiting on
   you) waits for anybody (`stepWaitsForPartner`).

## An ask's links (B397)

The person, 2026-10-19, on an ask that only named another: "i dont have enough information to make a decision. where
can i find Q202, i need a link in the future".

1. In an ask's card (Needs your attention, the daily note), its calm window and its details, a Q id of an open ask
   or a B id of a step of the backlog is a link that opens that ask's or step's window; an id the board does not
   know stays words (`askLinkPieces`, between the marks `asklinks`).
2. A page of the project the words name (a path with `/` and a text or picture ending, standing on its own) is a
   link: a picture opens in the picture popup, a text page read-only in the file window (`/api/game-file`, the game's
   folder first, then the project's, as the game plan's links). A path inside a web address stays words.
3. An ask that names one other open ask shows that ask inline under its words: its question, words and options, so
   one window holds what is needed (`pointedAsk`).
4. The partner's role says: an ask handed on with escalate stands under Needs your attention itself; the partner
   files no second ask that points to it.

## The partner's helper (B424)

The person, 2026-10-19 (I38, I39): "make advisor 2 visible on the board, and is advisor given instructions to utilise
advisor 2 when it's not working, if advisor 2 is busy it can pick up stuff itself", and "make advisor show under the
advisor tab and not an worker".

1. The list of chats names one helper of the partner, `"helper": "<name>"` in `list.json` (`parseList`). A chat of
   that name (not the main chat, not the partner) is no lane: it is not counted as a worker, gets no queue and stands
   in no worker list. The board's state carries it as `advisorHelper` (its card's state, task, time, step, idle).
2. The Overview draws it on its own card right under the Advisor's, in the Advisor's part (`drawHelperCard`): its
   standing as the Advisor's (`advisorStanding`), its task, step and time while it works, else "helps <partner>:
   refines and result checks". Nothing to open and no worker buttons.
3. The work tool gives it the role `helper`: its `refine`, `refined`, `checked` and `ask` count as the partner's
   (`HELPS`), its own name on the History lines, but never of a goal (its re-check, its asks and its daily note stay
   the partner's); in all else it is a worker. `queue` and `requeue` for it are refused.
4. The board's words reach it as the partner's do: the bridge serves it, an answer on the page may go to it, a rename
   follows it, and the pause counts it. Its app question form, a "For you" block without an ask and a long silence get
   their cards under Needs your attention, among the partner's; a card left "working" by a quit app is "Not running".
5. `roles/partner.md` ("Your helper"): hand it the next refine or check whenever it is free, take the next one while
   it is busy, never let one wait while either is free. `roles/main.md`: never queue for it.
6. Not in it: more than one helper, a helper for the main chat, and the Workers mod's own role for it (the mod's chat
   tool still lists it as a worker; its change needs the person's word).

## Redraw keys from what is drawn, and one click table (B408)

The person, 2026-10-19 (Q207 B): place 3 of `docs/robustness-2026-10.md`, its first slice. A part redrew only when its
hand-listed key changed, and a click worked only in the box it was bound to: the "With your partner" line opened up to
a minute late, a refused change of the Partner answers switch never showed, and Undo under the daily note did nothing.

1. Needs your attention and the Focus page each have a view (`needsView`, `focusPageView`, between `// redraw:start`
   and `// redraw:end`): plain data in the state's own shape, holding only what the part draws (a chat as its name and
   whether it runs, the backlog as its steps' ids, the time as its minute), and `ui`, what the person does there
   (`needsUi`, `focusPageUi`). `once` is keyed on the view's JSON and the part is drawn from the view, not from the
   whole state, so a field it reads and its view leaves out is missing at once instead of drawn late.
2. One click handler on the document (`CLICK_ACTS`, `clickAct`, between `// clicks:start` and `// clicks:end`): a
   button names its act by a data attribute, and the act runs wherever the button is drawn. It holds `take-back` (the
   Undo of a partner's answer) and `with-partner` (the line's list) for now; the boxes' own handlers keep the rest.
3. The tests (`test/redrawKeys.test.mjs`) check the views and the click table by what they do, and that every field
   the two parts read is in their views.
4. Not in it: the rest of the page, part by part (about 30 h), and `public/pages/*.js` modules.

## Torn files and whole writes (B406)

The person, 2026-10-19 (Q207 B): place 2 of docs/robustness-2026-10.md. A file the board kept was written over in
place: a restart or a power cut in the middle left half of it, and a torn data file kept the board from starting until
someone deleted it.

1. `src/write.mjs` holds the board's writes. `writeAtomic(file, data)` writes beside (`<file>.<pid>.<random>.tmp`),
   flushes to disk and puts the new file in place with a rename: the file is whole, the old one or the new one.
   `again` tries a rename, a delete or an append again on EPERM, EBUSY and EACCES (five tries; Windows holds a file for
   a moment while a virus scanner or the indexer reads it). Every write of the board goes through it: the data files,
   the settings, the launch entry, the list of boards, the work store (`putInPlace`, `removeItem`), the goal map and
   its daily copy, the ideas, the backlog view, the CPU level, the port file, a new project's files and Codex's
   pictures. A module that takes its file functions as `fs` (the tests' files in memory) keeps them; without `open` a
   file is written plainly.
2. `appendLines` ends a line torn by a power cut before it appends, so the next record of the outbox or the history
   never runs into it.
3. At the start (`readKept`), finished.json, rounds.json, refine-gate.json, task-times.json and ideas.json that do
   not parse are kept aside as `<name>.broken-<yyyymmdd-hhmmss>` and the board starts without them; one that is there
   but cannot be read, or not kept aside, is started without too and written anew. The state's `setAside` names them
   and the page says so on top (`setAsideNote`), a kept copy for as long as it is there. A board showing another's
   history never moves that board's files. A `launch.json` that cannot be read or does not parse is never written
   over (a byte-order mark first is read as it is).
4. Writes whose result was dropped are checked: delivered.json's record of a line sent is read anew and written again
   (three tries), and a key that still could not be written is held in memory, so the line is not sent twice, and
   written with the next record; a fix step that could not be taken back is said in the answer; a
   recap that could not be written is said in the goal's re-check; the chats' names record holds a held rename once.
5. The tests take their folders away with retries (`test/tempDir.mjs`, `maxRetries` on every clean-up); the two-board
   test runs on fixed ports below the system's own range and waits for a stopped board's port.
6. Not in it: the data layout of any file; files made new under a name of their own (a pasted picture, a brainstorm
   thread's first file, the store's id claims), which are never written over.

## An ask's title and its context (B452)

The person, 2026-10-20 (I47): a partner's ask of a hundred words stood whole as the window's bold header; they want a
short title and the rest as plain words under it. An ask had one free text, and the board showed its first line (here
the whole text) as the title.

1. The work tool's ask takes `title`, the question itself in at most 12 words (`TITLE_WORDS`, and 120 characters),
   and `text` (or `context`), its brief context: two to four plain sentences on why, what was found and what each
   choice means. Without `title` the first line of `text` is the title. A longer title is refused (400) with its word
   count and where the rest goes (`titleProblem`, `src/work/askWords.mjs`). The store keeps the title as the Title
   field and as the first line of Text, the context after it, so every older reader of an ask's Text still reads the
   question first.
2. The mod's own asks (`via` form or chat: the app's question form, a "For you" block) keep their words as they came:
   their title is their question (`askTitleOf`).
   B462: a refine question is one line of the refine block and an ask. Seen live: refine questions of 24 to 32 words
   stood as bold headers. Its title is its question, found in its words before " Advised:" (`refineTitleOf`), and it
   must start the line: a refine whose question gives a title over 12 words (or 120 characters), or has words before
   it, is refused before anything is written (400, "Question <n> leads with a question of <n> words" or "starts with
   words before its question", `refineQuestionProblem`). So a question comes first, with its numbers, why and advice
   after it in the same line ("Should the hedge be yew? 40 plants in two rows. Advised: yes, ..."). The ask keeps the
   line whole as its Text, so the block's question and its ask still match, and gets the title given; `askPartsOf`
   reads the rest of the line after a Title it starts with as the context. The step's window shows the question and
   the rest muted after it (`refineQuestions`, `splitAsk`).
3. `askTitleOf` gives every ask its title and context: a first line within a title's size is the title; a longer one
   (an ask from before) is split, its first question that ends within 280 characters (else its first sentence) the
   title, the rest of its words the context in their order (`askPartsOf`; a short Title its Text does not hold stands
   apart, the Text all context). Needs your attention's card, the calm window and the Focus page's Needs you lead with
   the title and show the context as plain words (`storeNeeds`: `title`, `question`, `text`); the "For you" block the
   tool answers carries the title and the links, never the context.
4. The window's own split (`splitAsk`) takes the first sentence when the question mark stands past 280 characters.
5. The roles (worker, main, partner) say how to write an ask: the title is the question, the context carries the
   numbers. The Workers mod's description of the tool does not name the title for an ask yet: a chat learns it from
   its role and from the refusal.
6. Not in it: the options' own length, and the answers.

## A step's effort level (B468)

The person, 2026-10-21 (I52): "in order to save tokens, i need a task, before it's picked up to evaluate what effort
level it needs. the worker will adjust to this new effort level". Every chat ran at the effort it was started with.

1. The partner gives every step an effort at its refine: `effort` on `work refine`, `work refined` and `work new` from
   an agreed how, a level of the app's (low, medium, high, xhigh, max) and a reason of one line ("medium: a board fix
   in one hook, with tests"; `parseEffort`, `src/work/effort.mjs`). The store keeps it as the step's Effort section
   ("medium · ...") and the refine block's `Effort:` line, after Standard; a later round without one keeps it, a
   `refined` with one replaces it. The Workers mod sends only the fields it lists (`WORK_FIELDS`); it lists `effort`
   since its version 0.13.17 (the person's yes on Q279), and a chat started before that gives it as a line of
   `questions` or `what` that starts with "Effort:" (`withEffort`), as the standard did. A level the board cannot
   read, or one without a reason, is refused before anything is written. A step without one counts as medium
   (`effortOf`). A fix step a
   failed result check makes runs at the effort of the step it fixes. How the partner chooses stands in
   roles/partner.md; max only with the person's word.
2. A chat cannot set its own effort (the app refuses that for a chat itself), so the board asks the main chat:
   `set effort`, "Chat:", "Effort:", "Session:", "Step:" (none when back to the usual level), "Why:" (command
   `worker-effort`), and the main chat sets the worker's chat with the app's `set_session_effort` (roles/main.md), as
   for the partner's high effort mode (B352). The app keeps each chat's effort in its own file of the chat
   (`effort`), so the board reads what a worker runs at (the lane's `effort`) and never guesses.
3. What a worker should run at (`effortPlan`): the effort of the step it holds (taken, in progress, waiting on you),
   else of the step it gets next (the reconciler's line to it, or its first queued step whose blockers are done, fix
   first and then by id, as its own pull takes them), else, only after a word of the board changed it, its usual level:
   the one it ran at before the board's first word, kept on every word as `usual` and kept while the chat does not run
   at it (a word back to it not applied yet changes nothing; the outbox keeps the newest word per worker however old,
   `outboxNow`). So a report followed by the next step asks once. A word goes when the worker does not run at that
   level and the newest word for it is not one for that level of the last half hour (`AGAIN_MS`, `lastWord`; also
   checked against the outbox itself when the delivery sends it); a word back that was lost goes again after that, a
   level the person set by hand after a word back arrived is left alone. None for a chat whose effort the app's file
   does not say, none without a main chat or the Workers mod, none while the person pauses.
4. The app applies a new effort from the chat's next turn on, so the line of a worker's next step ("work: B<id> is
   yours") waits while that step's effort is not set, at most three minutes after the word (`HOLD_MS`); then it goes
   anyway. The reconciler's line and the worker's own pull at its turn's end both wait (`state.reconciled.held`,
   `pullFor`).
5. The step's window shows its effort after the goal: the five levels with its own lit, its reason (or "counts as
   medium"), who runs at it until the step ends or that the main chat was asked and it is not set yet, and what was
   kept for that level (`itemPartsOf`, `effortRunLine`, `effortKeptLine`). The worker's window has "Effort: <level>"
   among its chips, ", not set yet" while asked. A refine block shows its Effort line (`refinedParts`).
6. The time and tokens per level: each task the board measures (B185) keeps its step's effort at the take, the effort
   most of its answers ran at (`ranOn`; the app writes it on every answer) and the tokens of its answers from the take
   to the report, each message once (`usage`, `messageId` in `src/transcript.mjs`). `taskTimesOf` gives per level the
   tasks, their typical time, typical tokens and output tokens, and how many ran at another level; the list in the
   board's data folder (`task-times.md`) has the table "Per effort level". The answers of helpers (their own
   transcripts) are not counted.
7. Not in it: the partner's own effort (B352) and the result checks' helpers.

## A step's model (model per step, the token-saving plan's step 2)

Measured on 2026-10-23: 96% of the project chats' usage ran on Opus. The person approved the same day: "workers Sonnet
by default, Opus only for steps the Advisor marks hard (architecture, the board's core, unclear bugs)", plus "the
Advisor's check helpers on Sonnet". It builds on B468: the same word to the main chat, the same hold.

1. The partner names every step's model at its refine, with its effort: `model` on `work refine`, `work refined` and
   `work new`, a family (sonnet or opus) and a reason of one line ("opus: a guard of the work store"; `parseModel`,
   `src/work/effort.mjs`). The store keeps it as the step's Model section ("opus · ...") and the refine block's
   `Model:` line, right before `Effort:`; a later round without one keeps it, a `refined` with one replaces it, a fix
   step runs on the model of the step it fixes. The Workers mod lists `model` in `WORK_FIELDS` since its version
   0.15.0; a chat started before gives it as a line of `questions` or `what` that starts with "Model:" and a family
   (`withModel`). A step without one counts as sonnet (`modelOf`). When the partner marks opus stands in
   roles/partner.md: architecture or design decisions, the board's core, unclear or repeated bugs, art direction or
   judging; everything else sonnet, and medium the usual effort (effort barely changes the cost: output is about 5%
   of the usage).
2. The app's model ids come from the settings, never from the code: `models` (`{ "sonnet": "claude-...", "opus":
   "claude-..." }`, as the app's model picker lists them; none unless set). They count only as both, each starting
   with `claude-` (`modelIds`); given otherwise the board says so on top ("Settings: ...", `modelsProblem`) and sets
   the effort alone, B468's word, as without them. The page then shows no model either: a model the board did not set
   is not shown (the state's `model` of a step is null).
3. One word to the main chat sets both (`effortWords`, command `worker-effort` as before): `set model and effort`,
   "Chat:", "Session:", "Step:" (none when back to the usual setting), "Model:" (the id), "Effort:", "Why:". The main
   chat runs `set_session_model` and `set_session_effort` (roles/main.md); its own model stays. A word counts as asked
   for a setting when both its effort and its model are that setting's (`sameTarget`), also in the delivery's check.
4. The step's line to its worker waits until both are read back (`isSet`), from the app's file of the chat: the app
   writes the session's record there on every change of the model (Claude 3.1623: `setModel` → `commitSessionModel`,
   which sets the record's `model` and saves the session; for an idle chat once its process took the model), so an
   idle worker is confirmed from the file. Only a file that names no model lets the chat's last answer count (its
   transcript names its model, as B352 reads the partner's; the lane's `lastAnswer`), and only an answer after the
   newest word (not lost) that set another model. A word for another setting still on its way (the newest word, not
   lost, of the last half hour, whose setting the file does not show yet: a word back to Sonnet still in the main
   chat's queue) changes the chat after any reading now, so while it is, the step is not set.
   The review (2026-10-24): **an opus step waits until its worker runs on Opus**, however long: no release after three
   minutes, for a lost word, without a main chat or with a file that names no effort. Its word goes only once a word
   for another model on its way was applied (the main chat sets them in their order, so the reading that frees it
   comes after both), and again each half hour (`AGAIN_MS`). The lane says so, "B<id> waits for Opus since HH:MM: <why>"
   (a flag of kind `model`, amber), and `work take` refuses the step while it waits, with that line (`stepHold`, the
   state's `reconciled.holds`). Any other step keeps B468's hold: three minutes at most after its word (`HOLD_MS`), a
   lost word frees the line; running a sonnet step on Opus costs tokens at worst.
5. Between steps a worker runs at its usual setting from the settings, `usualModel` and `usualEffort` (sonnet and
   medium unless set; `runSettings`), never at what it ran at before the board's first word (B468 kept that one, extra
   high on Opus for every worker). The board moves a worker back only after one of its words changed it, as in B468; a
   word of before (another level, or no model) is no word back to the usual setting, so such a worker is moved to it,
   and a setting the person chose by hand after a word back arrived is left alone.
6. The page says the model beside the effort: the step's window has **Model and effort** (the two families and the
   five levels, each with the step's lit and its reason), who runs at "Sonnet · low" until the step ends and then at
   its usual setting; the worker's window has "Sonnet · low" among its chips (", not set yet" while asked); a refine
   block shows its Model line. No new page.
7. The partner's helpers: every helper the partner starts for a check, a re-check, a review or facts runs on Sonnet
   (`model: "sonnet"`), and its helper chat (Advisor 2) runs on Sonnet at medium as its own setting, which the main
   chat sets once (roles/partner.md, roles/main.md). The board does not set the helper chat itself.
8. The partner and its helper are never set by this plan (`skip`): their own setting (B352, and the helper's once)
   stays.
9. Not in it: the main chat's model, and the partner's (B352).
10. **The chip on every row (2026-10-24).** The person: "Can we make it visual on the board which model/effort level its
    running?" Beside the state of every chat of the Overview's worker list (Main, workers, the Advisor and Advisor 2), in
    Simple and Details: "Opus · extra high", "Sonnet · medium", "Fable · max", from the app's own file of the chat
    (`model`, `effort`; the Advisor's `effort` is B352's mode, so the state gives it `appEffort`). The chip is information, so all chips are the same quiet grey outline in one weight; only a small dot names the model
    (Opus soft blue, Sonnet grey, Fable soft violet; the person picked this from three options). No amber, gold, orange,
    red or yellow: those mean "needs you" or a fault. While the lane's `effortRun` is not set yet and asks another setting,
    it shows the change with a dashed edge, "Sonnet · medium → Opus · high", and its tooltip says when the main chat was
    asked; no model and no effort is no chip (`runChipOf`, between `// runchip:start` and `// runchip:end`).

## The last silent catches (B446)

The result check of B404 found four catches left in `server.mjs` that dropped their errors: nothing on the page,
nothing in the log. They now run through the loops' record (`src/loops.mjs`) as the other loops do:

1. After a chat's call on the store, asking the partner for a result check (`result-check`, "asking for a result
   check"; the error names the step not asked for, `aboutError`) and the goal guard after a failed check (`guard`,
   "the goal guard"; a store it cannot read now fails it, where it counted no attempt before). A failure never fails
   the chat's call. Neither is asked again by itself: the page's note and the log say what was lost.
2. Making a picture of an idea (`picture`, "making a picture"): a making that throws still ends the idea's version
   ("The picture could not be made."); when that end cannot be written either, the one error names both (`afterError`).
3. Measuring the tasks inside the look (`measure`, as on a board that shows another's history): its failure no longer
   hides inside the look's success, and the look goes on.
4. The log tells a new error from the same one again by its words without their random part (`errorKey`): a file
   written beside its place (`<file>.<pid>.<random>.tmp`) has another name on every run, so a loop failing on it each
   refresh wrote a line every few seconds; it writes one now. The page still shows the error as it last was. After a
   success the same error is a new failure and is logged again (one that fails now and then, as a picture, is seen).
5. Tests: `test/loops.test.mjs` (the random part, a repeat after a success, the joined and named errors, the page's
   words) and `test/silentCatches.test.mjs` (the four places as loops, the guard's store read; server.mjs keeps no
   `.catch(() => {})` apart from the settings queue, whose caller gets the error; the catches that give a value are
   the fallbacks of a read).

## A file it cannot read is not an empty one (B467)

The result check of B446 found two catches in `server.mjs` that gave a value instead of dropping nothing: a work store
it could not read was taken for an empty one while measuring the tasks (they lost their area and estimate), and a goal
map it could not read for "no evaluation runs" (the partner's effort could be switched back). The same held for more
reads, so all of them were looked at:

1. **`absentAs(value)`** (`src/write.mjs`), for a read's catch: a file or folder that is not there gives `value`; any
   other error (held by Windows, not readable, not JSON) goes on. Used for config.json in the settings panel, the
   folder of the chats' cards, the idea folders, the goal map for a Missing line, and the Focus moves' goal map and
   talks (`src/focus.mjs`: every error was "There is no goal map to write into.", or a talk taken for none, so a second
   one was started). Those reads, and the work store's own (`readOr`, `src/work/store.mjs`), first try a file Windows
   holds again (`again`).
2. **The work store is never read as empty**: an item file it cannot read fails the read instead of dropping that step,
   and a held delivered.json is no empty record (which would send every line again). Measuring the tasks (the `measure`
   loop fails and reads the transcripts on next time), the goal guard (B446), an Overturn of a recap and a Missing line
   made into a step fail the same way (a call fails: the page gets an error, the log a line).
3. **The evaluations that run** (`evaluations`, "reading the evaluations that run"): unknown keeps the partner's effort
   as it is, where an unreadable map counted as none running. It is read on a move on the Focus page, so a failure
   shows until the next move.
4. **The focus word goes out** when the map, written a moment before, cannot be read again for its stage: the stage as
   read before, and a line on the console; a click again would find nothing changed and send none.
5. **Loops of their own**: following the app's folder (`app-folder`); the list of chats for the CPU (`chat-list`: the
   chats of the cards are still limited, and a click on a level still works); and, read once at the start so they show
   until the board starts again: the kinds of idea (`design-kinds`, the usual kinds meanwhile), another board's task
   times on a board that shows its history (`history`), and `.claude/board.json`, where the chats find the board
   (`bridge-note`, also on the console as before). Restart says "config.json cannot be read" for a held file, no
   longer "it is not there".
6. Two handlers in `server.mjs` still drop their error, each with its reason: the settings queue (its caller gets the
   turn and its error) and an Overturn whose goal could not be opened again (the page is told).
   `test/silentCatches.test.mjs` holds server.mjs to that: no other `.catch(...)`, and no second handler of a
   `.then(..., ...)` on one line but a look whether a file is there (`stat`), may leave its error unused. `try`/`catch`
   blocks are not checked: in server.mjs they answer the page or say why.
7. Tests: `test/write.test.mjs` (`absentAs`), `test/goalGuard.test.mjs` (an unreadable map is no "none running" and no
   "no goal map"), `test/focusFlow.test.mjs` (the focus word with a held map), `test/work/store.test.mjs` (a held step
   and a held delivered.json), `test/silentCatches.test.mjs` (the rule, and the rule on samples of every form).

## The board finds and fixes stuck states itself (B465)

The person, 2026-10-21 (I50): "i want a structural fix for preventing this it gets stuck, of the out of sync button
verifies this as well. including that it seems advisor 2 chat is not running. also gets solved." Each way work got
stuck that day was found by the person. They are now one list in the board, each with its fix (since the supervisor,
2026-10-24, its repair rules in `src/supervisor/rules/repair.mjs`, run by `src/supervisor/loop.mjs`):

| Check | Found when | Fix (status) |
| --- | --- | --- |
| `blocked` | a step's `Blocked by` names one in review whose board check passed (merged, its result check open), or (B542) one done or dropped, queued or in progress; or its `Waits for` names only steps done or dropped | unblocked by the board, the `Waits for` cleared, a History line naming the blocker (Fixed) |
| | ... names one the store lacks, or its `Waits for` names one in review | the main chat (For Main) |
| `not-taken` | a queued step whose free owner, holding nothing, got its line 10 min ago and did not take it | the line again (Woke); still queued 10 min on: For Main |
| `queued-behind` | a step queued over 20 min (`QUEUED_BEHIND_MS`) for a busy worker, nothing holding it (Blocked by, Waits for), while another worker is free: holds nothing, has nothing queued, not suspended (B550, X15, X16) | a note to the main chat, "Requeue B<n> to <free worker>: queued <age> behind <busy worker>" (Sent): the oldest step to the first free worker (running first, then free longest), the next to the next; a result check's fix (`Fix of`) is named as staying with the worker that built it, not moved; once an hour per step, by the runner's watch while the step stays queued for the same worker. The board never requeues it itself: queueing is the main chat's; but an incident fix the board queued itself it moves to that free worker itself (Fixed; "Incident fixes the board queues itself") |
| `focus-ready` | a worker free over 20 min (`FOCUS_IDLE_MS`, by its lane's idle time) holding nothing, nothing queued, not named by queued-behind, while steps are refined ready and not queued; no pause, no limit full (B564, X20) | a note to the main chat, "Queue B<n> (<focus>) for <free worker>: free <age> with nothing queued" (Sent): board fixes (Priority fix, "board fix") first, then the focus goal's steps (the view's `focus`, state.mjs `focus.id`), each in id order, a step with Blocked by or Waits for open skipped; one step per free worker, free longest first; steps of other goals never; once an hour per step, by the runner's watch while it stays refined ready. The board never queues it itself |
| `review-wait` | (B542, X7) a step queued an hour, its owner free that long, behind one in review whose check has not passed | a note to the main chat naming both, once per pair (Sent); the step's line says "waits for the check of B<n>" |
| `owner-gone` | a step queued for a chat the list has not shown for 30 min by the runner's own watch (not the partner, its helper or a leftover) | requeued to a free worker, a running one with the fewest queued first (Fixed); none free: For Main |
| | ... taken or in progress for such a chat | For Main: its work may stand on a branch |
| `refine-drop` | a yes to a refine question that drops the step (`Drop B<n> ...`), which the partner cannot do | a note to the main chat (Sent) |
| `limit-back` | a worker suspended for the limit whose time has passed (`isBack`), holding a step, no limit full | "the limit is back: go on with B<n> from its checkpoint" (Woke); still suspended 10 min on: For Main |
| `old-name` | a chat's mod refused under a name for over 2 min (one that follows the shown name, B463, joins at once), its session shown under another | a note to the main chat to have it join under the shown name (Sent) |
| `helper` | the partner's helper not running while refines (not yet refined, not waiting for the person) or result checks the board sent the partner wait | the helper woken, which asks the main chat to start it (Woke); still not running 10 min on: the partner told to do them itself, and the main chat to start it (For Main) |
| `partner-ask` | an ask routed to the partner open 10 min with no line about it in that time (the partner was busy) | the partner woken, busy or not (Woke) |
| `worktrees` | a worktree of a repository the board knows, or an empty folder one left in the project folder (2026-10-24) | removed by the board when safe (Cleaned); else listed with why (Left), no chat told: "Worktree clean-up" below |

- **At its take** (B542, X10): a step's `Blocked by` loses the steps done, dropped or in review, and a `Waits for` whose
  every step is goes, each with a History line naming the blocker, so no step in progress still shows a wait. The
  health summary names only what still holds a step, and dates a word of another day ("2026-10-15 18:13 round ...").
- **When**: every 3 minutes (`SYNC_EVERY_MS`, loop `sync`), on a board that writes the store and is no copy beside the
  person's; and at once on **Out of sync?** (**Check now** since the supervisor, below; a worker's menu or the panel's
  head), before the board types `check sync`
  into the main chat, which gets the list's answer as `Board's own check (HH:MM): ...` and checks what the list does not
  know (roles/main.md, "Check sync"). One run at a time (`syncRunner`). Nothing that wakes a chat while the person
  pauses.
- **How it fixes**: unblock and requeue through the work API as the board (`server` may now do both; the History line
  ends "(the board's sync check: <why>)"); a wake is a `work` line of kind `sync` sent once per finding
  (`sendOnce`, key `sync <finding>`), which the board does not withdraw as stale and which carries `syncKey`, so the
  next run knows it was woken; a chat not running makes the board ask the main chat to start it, as for any line.
- **The main chat is told once**: what the list cannot fix (For Main) and what it sends (Sent) go in one note per run,
  `The board's sync check at HH:MM: what it could not fix itself`, a line each, only for findings it was not told
  before; the keys stand in `<project>/.claude/sync.json` (`noted`, the newest 500; B482). A note that could not be filed is tried at the
  next run.
- **The page**: the newest run that was asked or found something stands under the Workers panel's head for an hour
  (state `syncList`, `syncListOf`, the agreed picture `art-inbox/worker-board/b465/out-of-sync-answer.png`): a row per
  finding with its status, and "N other checks: nothing stuck".
- **Old names**: the board keeps the names a chat's mod was refused under (409) with its session, for 10 minutes
  (`noteRefused`), from takes and work calls.
- **The review** made it wait where a moment's view misleads: an owner counts as gone only after the runner has missed
  it for 30 minutes (`seen`, `observed`: a chat file the app rewrites is skipped for one read, an account switch drops
  chats for a while), and a blocker in review only once its board check passed. The helper has one key per time it
  stops running, so the main chat is told once. A sync line is withdrawn once what it is about closed, once the step is
  another chat's, or after 30 minutes (`SYNC_LINE_MS`). A fix whose file changed meanwhile is tried at the next run, not
  told; a wake that throws is one row. A later run that finds nothing clears what the board found by itself.
- Not in it: the limits beyond "full". A worker woken at a stop point of its own (a weekly share it keeps) pauses again.
- **B482** (the result check of B465): a blocker in review holds its step until its result check passed too, when it
  needs one (a pending, missing or failed one may still bring a fix); what the main chat was told and since when a
  wait was seen (`seen`) stand in the project's `.claude/sync.json`, read at every run, so a restart or a board that
  takes the loop over neither tells Main again nor wakes or hands on anew (a lock whose process is gone, or cut off, is
  taken over at once);
  one loop per project: `<project>/.claude/sync-loop.json` names the board process that runs the list (`mayRunLoop`),
  a second one on the project (another `--port`) leaves it, and its "Out of sync?" asks the main chat only; a lock
  whose owner has not run for two rounds is taken over.
- **One board process runs all the loops (B488).** The lock is for every loop that writes or sends, not the list alone:
  the look (task times, the clock's rounds, the refine lines, the wakes, the board's asks), the reconciler (the work
  store's moves, each chat's line, the recaps, the stuck checks) and the list. `loopGate` (`src/supervisor/loop.mjs` since
  the supervisor; server.mjs takes it from `src/supervisor/index.mjs` and gives the gate to the supervisor as `owns`) asks `loopOwner`
  before each run and keeps the answer for a second; a process without the lock serves the page and reads (its look
  reads the outbox and history files again, `reload` in store.mjs). A new claim is written and read back after 80 ms,
  so of two processes starting at once the write that stands wins. The process that gains the lock after being refused
  it (the holder ended; a dead process's lock is taken at once) reads again the files the holder wrote (the outbox, the
  finished, rounds and refine records, the task times, the spending), so it sends nothing twice, and writes
  `.claude/board.json`, so the mod finds it. At its start a process that does not get the lock writes no `board.json`.
  B529: the page of the process without the lock takes no write (a word, a work action, the backlog, goals,
  brainstorm, design, settings, a picture: `mayWrite` in `createBoard`, 409 naming the holder's page from the lock's
  port), since its words would wait in an outbox no chat takes from; a game, a restart, the CPU level and a new project
  stay its own. B539: every POST route states this in one table, `POST_ROUTES` in server.mjs (its kind, and its guard:
  `lock`, or `free` with its reason); the handler serves only the routes in it and guards by it. The Workers mod's
  work tool, take and typed are `lock` too (a mod that reaches a process without the lock, by a stale `board.json`,
  writes nothing there: 409 naming the holder's page); its report is `free` (in memory only). Test:
  `test/routeGuards.test.mjs` asks every `/api/...` route server.mjs names with a POST and fails on one that takes it
  without a guard in the table. The chat logs are the holder's too: only it finishes the open logs of the journal (at its start, or when
  it gains the loops, after reading the journal again, `reload` in chatLogs.mjs) and takes a `save-log`; and the gain
  reads `alive.json` again, so its first look sees no gap the holder did not have. Test:
  `test/oneLoopProcess.test.mjs` (two real processes: the round, a step's line, a refine line and the open chat log go
  out once, only the holder finishes the log, and the other's page refuses a word naming the holder's port; the holder
  is killed, the other takes the lock, writes `board.json`, finishes the log the holder left, and at its own first look
  sends the next step's line, its refine line and the notice of a step refined meanwhile once, and nothing the holder
  sent), the gate in `test/supervisor/selfCheck.test.mjs`, `reload` in `test/chatLogs.test.mjs` and `test/store.test.mjs`.
- A new way of getting stuck is added to the list with its check, fix and test, not only fixed by hand (roles/main.md).
- Tests: `test/supervisor/selfCheck.test.mjs` (each check, each fix, the one note, the runner, the board's own unblock and requeue),
  `test/outOfSync.test.mjs` (the words to the main chat, the page's answer).

## Worktree clean-up (2026-10-24)

The person, 2026-10-24: "cleanup leftover working tree's please. ensure this is part of the cleanup step." Git had
removed the worktrees of finished steps, but on Windows their empty folders stayed in the project folder (17 of them
that day), and the result checks' worktrees (`check-b<id>`, `check-b<id>-before`) stayed whole. The report check
confirmed that a step's branch was gone, never its worktree or its folder. Three places see to it now, all in
`src/work/worktrees.mjs`:

- **The report check** (`stepLeftovers`, from `reportCheck`): no worktree of the step's repository on its branch, no
  worktree of a repository the board knows named for the step, and no folder of one in the project folder, empty or
  not. Each leftover fails the check with one line: its path and "git worktree remove <path>, then delete the empty
  folder Windows may leave" (a link in it named first, to be taken away alone: `cmd /c rmdir "<link>"` on Windows).
  The worker removes it and reports again, as after a failed branch check. Work outside git gets the same lines.
- **The result check** (`checked`, the work API's `checkWorktrees`): the board refuses `work checked B<id>` while the
  check's own worktrees are left (folders named `check-b<id>...`, wherever git lists them, or in the project folder),
  each named with how to remove it; the helper removes them and files it again. Chosen over the board removing them:
  they hold a junction to the game's packages (`node_modules`), which the board never removes (below), so only the
  helper that made them can, and nothing is filed before they are gone.
- **The sync list** (check `worktrees`, `findLeftovers` through the runner's port `leftovers`, `cleanLeftover` through
  `clean`): every few minutes, across the game's repository and the board's own (`knownRepos` in server.mjs), every
  worktree but the main checkouts and the board's own folder, and every folder right in the project folder that looks
  like a worktree's (`<repository's folder>-...`, `check-...`, or holding a `.git` file) that git does not list. The
  board removes by itself (Cleaned): an empty folder that is no link, not made in the last 20 minutes and named for no
  open step; and a worktree with no changes and no untracked files, whose HEAD is in `origin/<base>` or `<base>`, that
  no open step holds (queued, taken, in progress, review or waiting on you; by its branch, or its id in the folder's
  name), named as the steps and checks name theirs, not made or used in the last 20 minutes (its folder, and git's
  HEAD, index and log for it) and with no link anywhere in it. Anything else it lists with why (Left): held by B<id>,
  has changes, not merged into <base>, holds a link, made or used lately, locked, not named as a step's. Left rows go
  to no chat, and a run that only lists shows nothing by itself (held worktrees are the usual); an asked run shows
  them. The same list without removing anything: `node tools/leftover-worktrees.mjs [--config <file>] [--board
  <folder>]`.
- **Windows safety**: `git worktree remove --force` follows junctions and deletes what they point to. Nothing here uses
  `--force` or removes a folder recursively: a worktree is removed by `git worktree remove` alone, only after a walk
  through it found no link (a junction, a symlink, or an entry of no known kind; a folder too large to walk is left),
  and looked at again right before; a folder only by `rmdir`, which fails when it is not empty.
- The job texts: `roles/worker.md` (the step's end: the worktree removed before `work report`), `roles/partner.md`
  ("The check", step 4: the helper removes its check worktrees before `work checked`), `roles/protocol.md`.
- Tests: `test/work/worktrees.test.mjs` (temporary git repositories: merged and unmerged worktrees, changes, held
  ones, an empty leftover folder, a junction made with `mklink /J`, skipped with its reason where none can be made),
  `test/work/check.test.mjs`, `test/work/resultCheck.test.mjs`, `test/supervisor/selfCheck.test.mjs`, `test/outOfSync.test.mjs`.

## The supervisor, part 1 (2026-10-24): the board checks itself

The person, 2026-10-24 (the chat "Worker board task reliability", goal map T7): "a supervisor chat/worker. its goal is
to periodically check if, e.g. the board is out of sync, if workers are correctly suspended or not, if the system is
working like intended. It just needs to observe, periodically, not consume a lot of tokens." And: "the more we can build
as code solutions compared to AI the better, since it's cheaper." That morning the workers stood still for hours (a
cleared worker counted as "unknown" and got no next step; three workers stayed "suspended" on a limit stop of days
before), and the self-check of B465 did not see it: it only knows its own patterns. Spec
`.claude/specs/2026-10-24-supervisor-design.md`, plan `.claude/plans/2026-10-24-supervisor-plan.md` (the project's).
Part 1 (T7.2) is the code: the component, the watch rules, the incidents, the section and "Check now". Part 2 (T7.3),
the AI sweep by a cheap supervisor chat and the hand-over to the Advisor, comes after it.

- **One component**, `src/supervisor/`: `index.mjs` (the one door: `createSupervisor(ports)` with `start()`, `run({
  asked, subject })`, `view(now)`, `stop()`), `loop.mjs` (B465's runner, its one loop per project and its fixes, moved
  from `src/work/sync.mjs`), `rules/repair.mjs` (B465's checks, each a repair rule), `rules/watch.mjs` (the watch
  rules), `view.mjs` (the one read-only view every rule reads), `incidents.mjs` (findings filed as incidents). Only
  `server.mjs` imports it, and only `index.mjs` (`test/supervisor/boundary.test.mjs`). `src/work/worktrees.mjs` stays in
  `src/work`: the report check, the result check and `tools/leftover-worktrees.mjs` use it too; the rule `worktrees`
  reaches it through the loop's ports `leftovers` and `clean`, as before.
- **A rule** is `{ id, kind: 'repair' | 'watch', says, check(view, ctx) }`; a finding `{ rule, key, subject, text,
  evidence }`, and a repair rule's finding also B465's `check` and `fix` (its repair). The rules run one by one: a rule
  that throws is one finding "rule <id> failed: <why>" and the others go on (`runRules`).
- **The move changed nothing**: the B465 tests pass with only their imports changed
  (`test/supervisor/selfCheck.test.mjs`), and the old and the new self-check, run over a snapshot of the live state and
  over a planted board that trips every check, gave the same rows, note, fixes, wakes, clean-ups and `sync.json`.
- **The watch rules** report only (their thresholds are the setting `supervisor`, README): `unknown-lane` (a worker
  unknown or off over 10 min that holds a step, taken or in progress, and that the board could not wake: `state.wakeFailed`
  names it, or `state.nobodyRuns` says no chat runs to carry the start word; its text names the step and the failed wake-up.
  X46 and X65 were false alarms: a chat that is off with no step is closed, which is normal, and the board wakes a chat that
  words wait for by itself, at most three tries, T9.4), `stale-suspended` (suspended for over 10 min after its reset passed, after the app's stop
  while a reading since shows room, or longer than its limit's window), `idle-while-waiting` (all workers free, unknown
  or off for over 10 min while a step that may be taken waits; not while the person pauses or a limit is full),
  `holder-not-running` (a step taken or in progress whose worker has not run for over 30 min), `opus-wait` (an opus
  step's line held for Opus over 15 min), `skip-repeats` (a clear, or a compaction not skipped by design as for a small
  chat, skipped for the same reason twice in a row), `repair-repeats` (the same repair rule on the same chat or
  step 3 times in a day; B574: an unblock counts by its step and blocker, so a step freed once per finished blocker is
  no repeat; B590: every rule whose table entry says `countsBy: 'key'` counts so, a gone rule's (review-wait) too, so
  a step waiting behind several checks in turn is no repeat; and a step that goes done leaves its dependants' Blocked by in the same move, "no longer blocked by B<n>:
  done", so the sync check's unblock is left for misses), `undelivered` (a word to a chat waiting over 10 min, or expired or failed in the last two
  hours), `report-check-twice` (a step's board check failed twice in a row since its last pass), `old-mod` (a chat on an
  older Workers mod than the one installed: dormant until the mod reports its version, Part 2's mod), `odd-effort`
  (B544, the fix of X9: a chat whose card says an effort that is not a level; the partner's card holds the app's level in
  `appEffort` beside its high effort mode in `effort`, and `effort.mjs chatEffort` reads the level, so the health
  summary never says "[object Object]"), `review-stuck` (B543, the fix of X8: a step in review with no result check
  filed for over 60 min, its first or again after its fix was done or its ask point answered; one that waits for an open fix,
  down a chain of fixes too, or for the person's answer is no case), `dropped-fix` (B630, the fix of X54: a step in
  review whose fix was dropped, with no new fix, no new check and no open step blocking it, for over 30 min; with a
  block, `reviewWaitOf` says kind 'blocked' and the step waits as planned, odd in the health summary only when a
  blocker is stalled itself), `review-held` (B656, X8 again: a step in review whose chain of open fixes ends in a refined
  fix the ready list holds, for over 60 min from when the board first saw that hold (B660, X59: not from the fix's Since; a changed why
  starts again; a hold that is the person's open ask, "waits for the answer to Q<n>", is no case and not odd); one case per chain, named by its first step, with the
  held why; a chain whose last fix is at work is no case, however deep; its line reads "waits for its fix B<n>, held:
  <why>" on the Backlog tab, in work next and list, and in the health summary, which counts review chains, not steps),
  `chain-long` (B664, X8 a third time: a chain of fixes with three tries or more, its first step and every fix under it
  not dropped, whose newest fix is at work with no "Tried before:" line in its what: a third patch of the same way; one
  case per chain and newest fix; a fix the board made open for the partner's other way is no case yet), `open-fix` (B667,
  B664's check, principle 2: an open fix the partner never refines had no follow-up: a step in review whose last fix is
  new with no refine round written since it was made, over 60 min from then (`openFixMinutes`) and its newest refine word
  unanswered for 30 (`checkWordMinutes`); one case per fix, naming the words typed and "the board stopped asking" after
  BOARD_TRIES; its line reads "waits for its fix B<n>, not refined yet"; the refine gate types such a fix's word again
  after an hour, `FIX_RETRY_MS`, up to BOARD_TRIES; a round with questions waits for the person and is no case). B664: the health
  summary judges a step in review as review-stuck, dropped-fix and review-held do, through one helper (`reviewLateOf`,
  with the supervisor's memory of when it first saw each key): a fresh check word, the person's open ask and a hold the
  watch only just saw are not odd there either,
  `stale-checkpoint` (B572, the fix of X24: a step in progress over 120 min with no checkpoint within them, or whose
  last checkpoint's next action is to report, written over 30 min ago; one finding per step and checkpoint; not while
  the person pauses, a limit is full or its worker is suspended for the limit, and its suspended time does not count; the health summary shows each step in progress with its
  last checkpoint's age, commit and next action, "!" when stale), `effort-mismatch` (B576, the fix of X26: a worker
  whose effort, or model where the settings name model ids, differs from its step's over 10 min after the take, with no
  switch read back; one finding per chat and step; not while the person pauses or a limit is full, and the pause's time
  does not count; the health summary says beside "wants" "switch asked HH:MM" or "switched", and marks the mismatch
  "!" only once it lasts).
  What a step in review waits for (`resultCheck.mjs reviewWaitOf`: its first check, its check again, the person's
  answer, its fix B<n>, or its fix dropped) stands beside its title on the Backlog tab and in the work tool's `next`
  and `list`; the repair rule `fix-dropped` gives the main chat one word for a dropped fix, 30 min after the drop:
  close it or have it checked again. `not-cleared` (B547, the fix of X13 and X14: a worker whose last report is newer than its last clear and that took a new
  step since, at once, or that stays so for over 10 min, `notClearedMinutes`; one finding per worker per report, with
  the mod's why and the repair). `queued-not-running` (B587, the fix of X36: a free worker whose chat does not run while
  its next queued step waits over 15 min with no `start` of it on its way to the main chat; one finding per step).
  `old-limit-reading` (B601, the fix of X47: a limit whose newest figure is older than `oldReadingIncidentMinutes`, 60 (B632, the fix of X55
  and X56: past `oldReadingMinutes`, 30, the supervisor chat first looks the limits up once with `get_usage`, which counts as a chat
  reading), while a worker works (B645: not while the person pauses) and only when that last reading is near a stop (X47, X55, X56
  were false alarms with readings of 2% and 64%: an old low reading changes no decision; the 5-hour limit at `oldReadingFiveHourPercent`,
  80, or more, the weekly at `oldReadingWeekPercent`, 90, or more); one finding per limit, gone with a newer reading; the health summary's limits
  line adds "(old: N min)"; the app writes its usage file only while it is in use, so a quiet hour leaves it old). B640 (the fix of
  B632's check): the supervisor chat is cleared after every turn and the board reads only a chat's new transcript, so the board keeps
  the newest chat reading of each window itself (`state.limitReadings`, `limits.mjs newestPerWindow`; the server writes it to the
  project's `.claude/limit-readings.json` and passes it back to `buildState` as `keptReadings`); and a sweep is not skipped as
  "nothing changed" when a limit's reading is past `oldReadingMinutes` and near a stop (the same levels as the rule, X47/X55/X56: an old low
  reading wakes the supervisor chat for nothing; the sweep runner's `limitsOld`, read from
  `settings.supervisor`). B645 (the fix of B640's check): nothing is looked up while the person pauses (the bridge holds the sweep word until
  the resume, nothing spends in a pause and a reset is known by its time), so the sweep does not start for an old reading then and
  `old-limit-reading` is quiet; the sweep word's job (`roles/supervisor.md`) names the deferred tool `mcp__ccd_session_mgmt__get_usage`,
  loaded with ToolSearch. B649 (the fix of B645's check): the rule counts the figure's age from the end of the last pause at the earliest
  (`afterPause`, as the rules about chats do), so a long pause does not file an incident before the lookup after the resume lands; the finding's text
  still names the figure's real age. How long a thing
  lasted comes from the timeline (`state.today`), else from the supervisor's own watch.
- **The supervisor's memory**, `<project>/.claude/supervisor.json`, beside `sync.json` and apart from it: its watch
  (`seen`), the repairs of the last day (`repairs`, for `repair-repeats`) and when each rule tripped (`trips`). Read at
  every run, as `sync.json` is, so a restart or another board taking the loop over goes on from it. `sync.json` and
  `sync-loop.json` keep their form.
- **Incidents** are items of the work store, `X<n>` (`src/work/item.mjs`): Title, State (open, with the advisor, fix,
  fixed, came back; "fix" is shown "fix B<n>"), Source (the rule's id, or "sweep"), Subject, Key, Since, First seen,
  Last seen, Count, Fix, Rule wanted, Evidence. The work API: `incident` (the board, or a chat of role supervisor: Source
  "sweep" and the rule that could catch it), `incident-fix` (the partner: the step that fixes it), `incidents-fixed`
  (the board's reconcile: fixed once that step is done, open again when it was dropped). A chat of role supervisor
  only reads and files incidents. After each run the loop files its findings (`recordFindings`): a new key opens one,
  the same key only counts it (Count and Last seen, no History line: an hour of a lasting problem is one record with
  count 20), a fixed one's key makes it "came back". B584: unless the finding names when its case began (`since`:
  not-cleared its take or report, undelivered its oldest word, report-check-twice its second failure) before its fix
  step was done: that old case still standing only counts and says so once in History, for up to 2 h after the fix
  ("old case outlived its fix" then). Incidents are never on the backlog view.
- **To the person**: each incident that opened or came back gives one note of the board's (`Via: supervisor`, About
  X<n>). B573: the unread ones are drawn as one quiet line under Needs your attention, "Supervisor: 3 new findings"
  with a wrench, never counted; a click opens the section (Details first, from Simple), and opening the section any
  way reads them all. A count that grows gives nothing. B581 (the person, 2026-10-24): a small quiet x at the line's
  right reads only its notes (the line leaves at once, also after a reload); the section stays folded with its New
  tags, and the incidents stay open and keep counting. A new or returning incident is a new note: a line again.
- **The section** (state `supervisor`, the view, in place of `syncList`), under the Workers panel's head where the
  "Out of sync?" list stood. B573 (the person, 2026-10-24: "the supervisor notes take up too much space. i want it
  collapisble and understand how many things it found and is working on"): it stands on every board with a supervisor,
  folded by default to one head line, "Supervisor · 10 found in the last 24 h (4 the 24 h before) · 3 in work · 2 new",
  with **Check now** beside it;
  a click on the line opens it, and the fold is kept across reloads (localStorage `supervisor-open`). Found: opened or
  came back (an incident's `foundAt`, from its History) in the last 24 hours, `[now - 24 h, now)`; in brackets beside it
  the same over the 24 hours before, `[now - 48 h, now - 24 h)` (the lower edge is in, the upper out; the view holds a
  fixed incident for two days, `incidentsOf`, so the earlier window counts the fixed ones too). **A rolling day**
  (the person, 2026-10-26, "apply A"): nothing is set by hand. It replaced Gap 4's setting `supervisorCountFrom` in
  config.json, a start time that never reset by itself; the setting is gone from the board, and an old config.json
  that still has it starts as before, the setting ignored. In work: its fix step queued, taken, in
  progress, waiting on the person or in review (the card's `phase`). In work and (open) with the Advisor count
  every open incident whatever its age, and the cards list them: an open incident never drops out of sight because it
  is old. Only fixed counts the last 24 hours ("12 fixed in the last 24 h"): a fixed incident (its state, or its fix
  step done) found or seen again (`lastSeen`) in that time, listed the same, a card with none left out; one with no
  time known is counted, never hidden. Open, the head adds "· 2 with the Advisor · 0
  fixed in the last 24 h" (no fix under way yet; fixed), then when it checked itself, its incidents (one card per fix step, see "The
  supervisor's incident cards"), the last check (B465's rows, as before, for an hour), the rules (those that tripped
  now or today, how often, a failed one with why; the others on a click) and the last sweep. **New**: an incident found
  since the person last opened the section (`supervisor-seen-at`) and not fixed; its card carries a quiet New tag and
  comes first. Opening marks them seen; the open section's tags stand against the opening before
  (`supervisor-shown-since`), so they do not vanish at the click. Pictures: `art-inbox/B573/`. Cool colours only: nothing in it is the person's to act on (`test/supervisor/page.test.mjs` checks every colour
  of its styles). Pictures: `art-inbox/worker-board/supervisor/` (the project's picture folder).
- **Check now** (was "Out of sync?"; a worker's menu, the section's head, and the panel's head on a board without a supervisor) with
  a wrench in the button's own colour: the server runs the supervisor at once (`run({ asked: true, subject })`, the
  subject the worker of the menu) and, until Part 2's sweep replaces it, still types `check sync` into the main chat.
- **The review of part 1** (2026-10-24): merged with main, B449's check `unchecked` is a repair rule, and B488's one
  gate of the board's loops (`loopOwner`, `loopGate`, in `loop.mjs`, re-exported by `index.mjs`) is built by the server
  and given to the supervisor as its port `owns`, so the list runs only in the process that runs every loop. The watch
  rules say nothing of chats that stand still or words held while the person pauses all or resumes (rules 2, 4, 5, 8),
  and never count the pause's time; rules 4 and 5 say nothing at a full limit, and rule 4 nothing of a worker suspended
  for the limit. `idle-while-waiting` counts only steps queued for a worker of the list whose line is not held for its
  model or effort. A compaction skipped because more of the same work follows is by design. A note to the main chat
  counts as a repair of the day only in the run it went. The section opens for a new incident or a new repair finding
  (the check's `newAt`), not for a check that finds the same again. A line to the person that could not be filed goes
  at the next run (`linesOwed`: open or came back, and no line about it since). A chat of role supervisor may also end
  its turns (`turn-ended`) and `pull`, as every chat's Workers mod does.
- Tests: `test/supervisor/` (boundary, component, selfCheck, watch, incidents, page), `test/outOfSync.test.mjs`.

## The supervisor, part 2 (2026-10-24): the sweep and the hand-over

Part 2 (T7.3) of the supervisor (spec and plan as part 1's): the AI for the gaps the code rules leave, at as few tokens as
it can. The person: "It just needs to observe, periodically, not consume a lot of tokens."

- **The supervisor's chat** is the list of chats' `"supervisor"` (`list.json`, like `"helper"`; `appChats.mjs
  parseList`): state `supervisorChat` (its card: name, sessions, model, effort, state, last clear, whether it runs) and
  `supervisorName` (the list's word, also while no such chat is open). No lane, no queue, never counted as a worker; the
  bridge shows it (`bridge.mjs shownChats`, one list of the chats the board shows by name), so it takes its words and
  works with the work tool in the role `supervisor` (server.mjs `workCtx`, `laneRole`). The main chat may be asked to
  start it (`say.mjs checkSay` start). Its job: `roles/supervisor.md`, which also holds the short list of how the
  board should behave, so a sweep reads that file and the summary, nothing else.
- **`work health`** (Task 5; a read, the role supervisor only, `api.mjs healthOf` through the server's port `health`):
  `src/supervisor/health.mjs healthSummary(view, now)`, from the supervisor's one view, at most 8000 characters: the
  chats (state and since by the timeline, model and effort beside the step's, its step, last report from the store's
  History, last clear and why from the card), the steps under way (state, age, owner; new and refined only counted), the
  queues, the incidents (with their keys, so a sweep files the same thing under the same key) and repairs of the last
  day, the words not delivered, the limits and the pause. Odd lines carry `!`; a step is odd past its state's limit,
  except (B561, the fix of X15) a queued step that waits for open steps it names in Blocked by or Waits for ("waits as
  planned for B<n> (<state> <age>)", unless a blocker is stalled itself, down a chain of planned waits; a loop counts as
  stalled) and a result check's fix that stays with its builder while that builder holds a step; a queued step whose
  every blocker ended reads "still blocked by B<n>, done" and keeps its age's `!`. A chat line is no odd one (themes 3 and 4, the
  false alarms X46, X51 to X53) when the chat is off or unknown, does not run and holds no step (closed is normal), or when a
  worker is stopped on purpose: its lane says it is parked (`suspended.by` 'parked', "(on purpose: waits for B<n>)", never
  "for a limit"), or it is interrupted and the step it holds waits for another open step (`waitsOf`) or for the person's
  answer (waiting on you, an open ask); a stop for a limit stays odd, and so does a closed chat that holds a step. The
  role text (`roles/supervisor.md`, "What is no incident") tells the sweep the rest: what a code rule covers (unknown lanes,
  limit readings, clears, checks) it files no second time, and a worker the person parked (its last checkpoint says so). When it must cut, the lines of every
  chat, the steps the chats hold and the limits stay, then the oddest and newest of the rest; a section says how many
  it left out (`test/supervisor/health.test.mjs`: 900 items, under 8000, every held step kept).
- **The sweep** (Task 6, `src/supervisor/sweep.mjs sweepRunner`, wired in `index.mjs sweepOver`): every
  `supervisorSweepMinutes` (config.json, 10 unless set, 0 for none) the board, where its loops run (`owns`), wakes the
  chat with one board word through the outbox (`say.mjs sweepWords`, command `sweep`, typed as it is like `work`; a
  chat that does not run is started by the main chat as for any board word, `wakeFor`): "sweep: run work health, file
  each oddity with work incident (evidence and the rule that could catch it), then end your turn" (with "(about
  <worker>)" from a worker's menu) and the job file. It looks every minute (`SWEEP_TICK_MS`, loop `sweep`).
- **Quiet nights** (Review Focus 3): a sweep only while work runs (a chat of the board works, or a step is taken or in
  progress), never while the person pauses or resumes, at a full limit, while the last sweep runs (its word on its way
  or its chat working; one with neither for 2 minutes has ended, `SWEEP_SETTLE_MS`), or while its chat runs a turn
  that another board process asked.
- **Check now** (Task 6, server.mjs `sync`): `supervisor.checkNow({ subject })` runs the rules (asked) and a sweep at
  once; the main chat is no longer asked (`roles/main.md`, "Check sync"). Review Focus 4: when no sweep can run the page
  says plainly why (`whyNoSweep`): no `"supervisor"` in the list, no chat of that name open, no Workers mod at all, its
  mod older than 0.16.0, the person pauses, a full limit, the last sweep still runs; the rules ran all the same. The
  schedule notes the same reason once, not every minute.
- **Cleared after every turn** (the Workers mod 0.16.0, `register.tsx clearSupervisor`): a chat the board's answer to
  its turn's end names `supervisor` (or the list names so, when the board did not answer) is cleared with /clear after
  every turn of its own, through the clear-after-step path (`queueClear`, the card's mark, the /clear's ticket) without
  `save-log` and without a worker's guards: only a turn or a subagent still running, or a prompt that came in before the
  /clear ran, holds it (the card says why). Its turn's end reaches the board before (the clear comes after `turn-ended`).
  The conversation after the clear is told nothing: the next sweep word says what to do. The board refuses `save-log`
  for it as for every chat but a worker.
- **What a sweep did and cost**: the server tells the supervisor its chat's `health`, `incident` and `turn-ended` calls
  (`heard`): a health read, each incident filed (`found`), and the turn's end with its session and start. 20 seconds
  after it ended the tokens of that turn are read from the chat's transcript (`tokensOfTurn`: every answer from the
  turn's start on, each message once; the old transcript stays after the clear): input, cache writes, cache reads and
  output, and their sum. A sweep that ended without reading health says so ("its Workers mod may be older than
  0.16.0"); one whose chat went quiet without a turn's end says that. The last sweep, the reason none ran and the last 50
  sweeps stand in `<project>/.claude/supervisor-sweep.json`, so a restart neither sweeps at once nor forgets one that
  runs. The view: `lastSweep`, `sweepNote`, `sweepEvery`, `sweepsToday` (count and tokens); the section's line "Last
  sweep at 10:30 (by the clock): 2 findings, 31,200 tokens. Today 7 sweeps, 201,300 tokens." (spec, "Cost": measured,
  not guessed).
- **The Workers mod's version** (0.16.0): every call to the board carries `X-Workers-Mod` (`board.ts MOD_VERSION`, the
  same as plugin.json, a test checks it); the server keeps it per chat (`noteMod`), which makes the watch rule `old-mod`
  live and lets Check now say that the supervisor's chat runs a mod too old to sweep. A mod older than 0.16.0 sends none.
- **The hand-over to the Advisor** (Task 7, `index.mjs tellOwed`, after every run of the rules and at the end of each
  sweep's turn): each incident that opened or came back gets, from the store (so also one the sweep filed, and after a
  restart), first the person's line (part 1), then, once that line is filed, one board word to the partner through
  the outbox (`tell`, as every board word: one to a partner that does not run waits there and the main chat is asked to
  start it): `incident: X<n> <title>`, `State:` (new, or came back after its fix), `Count:`, `Source:`, `Subject:`,
  `Evidence:`, `Rule wanted:` (a sweep's) and `Your job: <board>/roles/partner.md, "Incidents"` (`say.mjs
  incidentWords`, typed with the board's mark, as `check step`). The incident is then "with the advisor" (`work
  incident-told`, the board's alone). Review Focus 2: once per new or returning incident; a count that grows gives
  nothing; a word in the outbox about it since it got its state counts as sent, so a failed state change is only tried
  again; a word that could not go is tried at the next run (the loop "incidents" says so). Without a partner on the
  board the incident stays open, the person told.
- **The partner** (`roles/partner.md`, "Incidents"): a small tweak (new, one place, a clear cause) or a structural fix
  (came back, Count 2 or more after a fix, or several parts: it starts with a deeper look); the fix step refined with
  `work new` ("Fix of X<n>: ...", `priority` fix, so it goes first to its worker; opus · high for a structural fix),
  a part that adds a supervisor rule where it can, then `work incident-fix X<n>` (the Workers mod 0.16.0 forwards it,
  with `fix`). The main chat queues it as any board fix (`roles/main.md`). When the Refiner exists (T6.4) this moves
  there.
- Tests: `test/supervisor/health.test.mjs`, `test/supervisor/sweep.test.mjs`, `test/supervisor/handover.test.mjs`; the
  mod's `chatlist.test.ts` (health, incident and incident-fix forwarded, the supervisor cleared without a log, the
  version header), `chats.test.ts`, `board.test.ts`.
- **The review of part 2** (2026-10-24): a sweep word counts as on its way only while it waits within its time or was
  taken in the last 10 minutes (the raw outbox keeps an expired word "waiting" and one whose typing was never reported
  "taken": one such word had held every later sweep and Check now for good), and a sweep open 30 minutes has ended
  (`SWEEP_LONGEST_MS`). A sweep by the clock is skipped while the board looks as at the last sweep (`facts`: the health
  summary's sha1 with its times and counts masked, its "!" marks kept, kept on the sweep across restarts; the section
  says "nothing changed since the last sweep"); Check now always sweeps; the summary leaves out the sweep words. The
  supervisor's chat files no ask through a "For you" block (the board ignores its block, its mod sends none). An
  incident's word to the partner waits as long as a step's (`isLate`), the incident is "with the advisor" only once the
  word arrived (typed, copied, or taken over 10 minutes ago, `wordState`), and a lost one is sent again. One person line
  and one word per incident also when a run of the rules and a sweep's end come together (`tellOwedNow`, one at a time).
  old-mod and the sweep read only what a chat's mod said in the last 2 minutes; a mod that asks without the header runs
  one older than 0.16.0 (a case once 0.16.0 is installed). A Check now right after a sweep ended keeps that sweep with
  its tokens; a turn's end told while the board asks whether the sweep still runs stays told. The mod never takes the
  main chat for the supervisor, whatever the list says.
- **Set up after the merge** (not in the code): the Workers mod 0.16.0 installed, a chat started by the main chat and
  titled with the list's prefix and the name the list gives it (`"supervisor": "Supervisor"` in
  `.claude/chats/list.json`), on Sonnet · low; it joins the list by its title. Until then the rules run as before and
  Check now says why no sweep ran.
- **Chats on an older mod, one way out** (B541, the fix of X4-X6, 2026-10-24): the rule `old-mod` filed one incident per
  chat and gave the person no way to act. Now `src/oldMods.mjs` (pure) finds the chats on an older Workers mod among the
  main chat, the workers, the partner, its helper and the supervisor's chat, each with what it misses (the partner: it
  cannot name an incident's fix; the supervisor: it cannot sweep). The rule files one finding for all of them, keyed
  `old-mod <installed>`, so one install is one incident that counts up. The server puts one card first under Needs your
  attention (kind `old-mod`, id `old-mod:<installed>`): the chats, the one way (Pause all, restart the Claude app,
  Resume all) and a Pause all button that asks as the one above the workers does; while a pause stands it names the next
  step. Built from what the chats' mods said in the last 2 minutes, it clears by itself once all run the installed mod.
  The board restarts nothing. Tests: `test/oldMods.test.mjs`, `test/supervisor/watch.test.mjs`.
- **Every card that waits carries its way** (B533, the person, 2026-10-24: "I want a button to approve/disapprove or a
  link to where I need to do something. This has neither."): `cardWays` (board.js, between `cardways` marks) gives each
  card under Needs your attention what the person can do: an ask the board can answer has its form; the hints (B301
  "No ask filed", B308 "May wait for you") have the way to the chat's answer (Talk to Main, the Advisor's chat, a
  worker's answer) and a button that types one line into that chat as the person's own words (`nudgeWords`: file the
  questions with work ask; go on, ask or report, naming the steps it holds), filed as an instruction like every line the
  person types, so the chat closes it; once it went the button says "Asked at HH:MM" (page memory: a reload shows it
  again). A worker with no sign of life gets Check now (B438); a quiet main chat and a question of the app's own form
  say "in its chat in the Claude app", the one place the board cannot link. The unfiled card names its chat's step (a
  link). A hint's window opens with "What the board found": the card's words, links and buttons, then the chat's
  answer; the main chat's "It waits for you, and said no more" stays only where the chat itself asks. The Focus run's
  guard cards (rebuild, Fable or Opus) and the re-check that waits for the person link their ask ids and carry a button
  to the ask's window (else Needs your attention). The handout card the step was asked for went with redesign Part 2
  (the board hands out every task). Tests: `test/cardWays.test.mjs`.
- **A new mod between steps** (B570, the person's I95, 2026-10-24: "i dont want to restart all the chats manually"): an
  idle chat is restarted alone by archiving and unarchiving it in the app (its process ends; its next word starts it on
  the installed mod; nothing is spent until then). `src/work/modRollout.mjs` (pure, `rolloutPlan`) reads the version
  each chat's mod said lately (`modsNow`, now also `buildState`'s `modsLately`) against the installed one: a chat on an
  older mod that is free, whose process runs (`isRunning` true, never on a guess) and that holds no step taken, in
  progress or waiting on you gets the word `restart for mod` (Chat, Session, From, To, Why; command `mod-restart`, a
  partner word so a partner that does not run is started) to its restarter: the main chat, or the partner for the main
  chat (roles/main.md, roles/partner.md: archive, unarchive the list's chats archived with it, unarchive it, no message).
  Again each half hour while it still runs the older mod, three times at most per installed version; `deliver.mjs`
  skips a twin of the last half hour. A free worker's next step line waits for it (`reconciled.held`, the hold's
  words in `holds`), ten minutes at most after the word, so the step starts on the new mod; a chat with a step in
  progress "restarts after B<id>" (each lane's `modRun`, every chat's in `modRuns`). Once its process ended its mod no
  longer asks, so it no longer counts as old and the line goes (the board's `start` word to the main chat wakes it).
  B541's card and the rule `old-mod` now name only a chat still idle on the older mod 30 minutes after the board's
  first word for it (`overdueChats`, from the outbox): the restart did not reach it. A restart word stays known in the
  outbox a day (`store.mjs`), so its three tries are counted. The partner sends the restarted main chat one line, as no
  board word starts the main chat (the review). The merging worker of a mod change runs the CLI's marketplace update and
  plugin update once (roles/worker.md); the person restarts nothing. B587: the hold never outlasts the restart: a chat
  whose process ended is not held, and a word typed over two minutes ago whose restarter's turn has ended with the chat
  still running (refused, or the archive was) holds nothing either (`REFUSED_AFTER_MS`). Tests: `test/modRollout.test.mjs`,
  `test/work/modRolloutDeliver.test.mjs`, `test/oldMods.test.mjs`, `test/supervisor/watch.test.mjs`.

## The supervisor's incident cards (2026-10-24)

The person, 2026-10-24, on the section's rows: "too much text. is it busy trying to send this to the advisor or not? what
backlogitem is there. its not clear what the follow up is." They chose layout B of
`art-inbox/worker-board/supervisor/incidents-layout-ab.png`: **one card per fix step**, newest activity first.

- **A card** is the step's id (a link, `#details=B541`) and short title, its live state in a chip ("refined · waits for
  Main", "queued for Worker 2", "Worker 5 · building", "in review", "done · fixed"; from the step's record and its worker's
  lane, `src/supervisor/cards.mjs stepState`), and one quiet line: the incident ids and a few words, "(seen N×)" only above
  once. A click opens each incident's evidence, times and count. The rules are one folded line ("20 rules · 2 tripped").
- **Grouping** is by the incident's `Fix` while it is being fixed or fixed; a step titled "Fix of X<n>" counts only as a
  fallback when no Fix does; an incident that came back, or is open again, does not keep its old Fix. Those with no fix
  step stand on the last card, "No fix step yet": "sending to the Advisor…" while its word waits or was just taken, "with
  the Advisor" once it arrived, "came back".
- **Live**: `supervisor.view(now, live)` makes the cards at every refresh from the store, the chats and the Advisor's name
  the server passes, so a step the partner just linked shows at once. Quiet blues and greys, nothing warm.
  Tests: `test/supervisor/cards.test.mjs`, `handover.test.mjs`, `page.test.mjs`; pictures `incident-cards.png`, `-400.png`.

## Incident fixes the board queues itself (2026-10-24)

On the night of 2026-10-24 the supervisor's loop (an incident, the Advisor's refined fix step marked priority fix, a
worker builds it, the incident closes) stalled 9 times at one link: only the main chat queued, the Advisor's "yours to
queue" note did not make it act, and every fix sat refined until someone messaged it; twice it put a fix behind a busy
worker while another was free. The person chose B: "the board queues it, but ensure that the main knows the board can
do this so it doesnt try to double assign work to a singler worker if it expect it could be free".

- **What** (`src/work/incidentFix.mjs`, the flow's server move `{ "from": "refined", "to": "queued", "by": "server",
  "when": "an incident fix is ready" }`, in the default flow and `examples/work/flow.json`: a project without its own
  flow.json gets it by default; one with its own flow.json needs that line, and a board built before this rejects a
  flow.json that has it, "no guard is called ..."): a step refined (ready), `Priority: fix`, that an incident not fixed
  names as its `Fix` (or titled "Fix of X<n>" while that incident has no Fix, or this step as its Fix), with nothing
  holding it (Blocked by, Waits for, an ask under it, Touches that overlap a taken step's, as for the main chat's queue),
  no `Queue when refined` (B303 carries that out) and no History line of a move to queued: once only, so a step the
  main chat queued or took out stays as it is.
- **For whom** (`placeFixes`, by the reconciler at every refresh, so within a minute; not while the person pauses or
  resumes): only a chat that runs (not `off`, not `unknown`, `isRunning` not false: a fix queued for one stalled for
  good, as nothing delivers to it or moves it); a worker free with nothing queued, free longest first; none: the worker
  with the shortest queue that waits for nobody (its lane not waiting, no step waiting on you, not paused for the
  limit). Several fixes at once each count in the queue for the next. The reconciler's `autoQueues`; `deliverWork`
  carries each out through the API's `advance` with `for` and `tier`, which checks it anew (`queueIncidentFix`; a
  free-worker placement whose worker got a queued or held step meanwhile is refused, and the next refresh places
  anew): History "server: refined → queued" and "server: queued by the board for Worker 2 (incident fix of X4)". As a
  board fix it goes first in that queue.
- **Held by its standard**: a fix the product plan's standards hold (`standardHold`, the API's own guard, passed to the
  reconciler by state.mjs) is not placed, so it takes no worker's place and is not refused at every refresh; the main
  chat and the partner get "B<n> is held by its standard: <why>" once each (`heldFixes`, kind `fix-held`, held while
  the step stays refined).
- **The main chat knows**: one information line per placement into the outbox, "The board queued B541 (incident fix of
  X4) for Worker 2, first in its queue. Information only: nothing to do." (kind `board-queued`; at once, and named again
  from the History by the reconciler's `boardLines` for 30 minutes under the same key, so it goes once, also after a
  restart). Its `work queue` or `requeue` for a worker the board gave a fix in the last 10 minutes says so on top
  ("Worker 2 got B541, a board fix, at 21:40; your step goes after it"), not refused. `roles/main.md`: it never queues
  or requeues an incident fix, and reads a worker's queue before handing it work; `roles/partner.md`: the partner names
  the fix and asks the main chat nothing.
- **Around it**: the rule `queued-behind` moves a fix the board queued behind a busy worker to a worker that came free
  itself (Fixed, a server requeue), where it names other steps to the main chat, but never while a work line about it
  went to its owner in the last 10 minutes (`NOT_TAKEN_MS`: it may be taking it); `focus-ready` leaves the fixes the
  board queues now, or that their standard holds, to it (the view's `autoQueued`). The Supervisor section's card says "refined · the board queues it"
  and "queued by the board for Worker 2". The review: the reconciler names a server move only when that move's own
  guard holds (`mayMove` holds when any server move to that state does, which named a fix under B303's move, without a
  worker), and `advance` never queues a step without a chat.
- Tests: `test/work/autoQueueFixes.test.mjs`.

## Clear after each step (2026-10-23)

Measured on 2026-10-23: 73% of all the project chats' usage was the model reading long histories again (300k to 700k
tokens of history sent on every call; the answers were 5%). The mod compacted a worker only after a reported step,
above 250k, and never when the next step was queued already, so a busy worker was never reset, and the main chat and
the partner's helper never at all. The person chose (2026-10-23, "Worker board task reliability"): workers are cleared
with the Workers mod running /clear itself, as it runs /compact ("1 C. i like the clear, its cheaper"), and every
conversation is kept as a text file without the worker spending tokens on it ("disk space is not a concern. token
usage is"). A chat calling the app's clear_session tool on itself was refused by auto mode's safety check, so the mod
runs /clear (`$.command.run({ command: 'clear' })`, queued for when the chat is idle, the way /compact runs).

- **The setting.** `list.json` `"afterStep"`: `"clear"`, `"compact"` (the default, so every other project stays as it
  was) or `"off"`. The main chat and the partners are never cleared: they are compacted while they rest (a turn of
  theirs ended, nothing of theirs runs on) above `compactAbove`, once per turn and one /compact on its way at a time
  (`"compactAtRest": false` stops this alone), told to keep what their role needs
  (`compactKeep`: the main chat its workers, queues and the person's open words; the partner its focus goal, refines,
  checks and routed asks; the helper its task from the Advisor).
- **When a worker is cleared** (`clearAfter` in `register.tsx`, `clearWhy` in `chats.ts`): when the turn in which it
  reported its step has ended (where the compaction ran), also when more work follows. Not, and compacted instead with
  the reason on its card (`clearNote`), when the board's answer to the turn's end does not name it a worker (`role`), the
  person pauses, its answer asks the person something the board did not file (`unfiled`, a question outside the
  block the mod reads, or more items than the board is handed), it sent another chat a message in that turn (the
  answer would come into a cleared conversation), a subagent of it still runs, a prompt came in, or the log could not
  be saved. A board slow to answer the report's turn's end (it checks the report then; 3.8 s seen live on 2026-10-23)
  does not hold the turn's end past its moment and a half: the decision waits for the answer apart, up to 15 s (the
  first call's, else a repeat with the same request id, B412), nothing typed in meanwhile, and decides then with every
  guard of that moment; a prompt that came in meanwhile means no clear (and no compaction); no answer at all falls
  back as before.
- **The log, at no token cost** (`src/chatLogs.mjs`). The mod asks the board through the bridge (`/api/bridge/work`,
  `save-log` with `stepId`, the mod's own call: the work tool refuses it from the model, the board refuses it for any
  chat but a worker, and for one whose transcript shows background work running). The board puts the log in its
  journal (`data/chat-logs.json`) and answers at once; then the system copies the transcript beside the log as
  `.jsonl` (never read whole), and the text is written from that copy line by line: each message with its time and
  speaker (the person, the person on the worker board, the worker board, a message from another chat, a background
  notice, the chat, its thinking, each tool call with its full input, each tool result in full, a compaction, a slash
  command), the app's own bookkeeping left out, a line that is no JSON (the last one cut off while it was written)
  named as such. The old transcript stays on disk after a /clear, so the copy may finish after the clear; a log not
  finished when the board stops is finished at its next start, and once copied nothing needs the app to keep the old
  transcript. Logs go to `<project>/.claude/chat-logs/<chat>/<YYYY-MM-DD HHmm> <step>.txt`.
- **The clear.** The mod marks the card (`clearing: { at, step, log }`), then queues /clear with a ticket; its own
  `command.run` hook runs a /clear of the mod only as the one of the clear still on its way (its ticket), while no
  prompt or turn came in since it was decided; any other is refused (a stale one after the clear was dropped, also
  much later). A real turn on the same session drops the clear at its start, and its end is told to the board as any
  turn's; a clear that has not run within two minutes is let go. A /clear queued before the mod was loaded anew runs
  only on the card's fresh mark, with nothing come in since. Should the engine run the /clear or /compact as a turn,
  that turn is none of the chat's (no turn's end told, nothing decided). Nothing is typed into the chat while the clear
  is on its way (a line the board put out waits for the conversation after it). /clear ends the conversation
  (`session.end`, reason `clear`) and the process goes on under a new session id.
- **The same chat after it.** At the new conversation's start (`classic.SessionStart`, source `clear`; else the first
  prompt or turn) the mod moves the card to the new session id, the old file holding only `{ "movedTo": "<new id>" }`
  (a mod that lost its word of the clear in a reload finds the card by its mark). The board follows `movedTo` (in
  `sources.mjs` and the state), so the lane, its card, its transcript, its steps, asks and open instructions (kept under
  the chat's name) stay the one chat's, whether or not the app's file names the new session yet; a session the board
  shows under no name is read anew once (at most every 30 s) before the bridge refuses it, so the first work call of
  the new conversation is not "not the chat the board shows". The fresh conversation is told as its start's context
  who it is, that its rules are in `CLAUDE.md` and `.claude/worker-briefing.md`, that its earlier conversation was
  cleared and where the log is, the person's instructions still open (as `work next` lists them; the mod asks `next`
  as a chat started anew does, B298), and to run `work next`; after the mod's own clear, or a /clear the person ran of
  a chat the board last named a worker; the move happens once, also when the tick and a prompt meet. A new process of
  the mod finds what the clear was by the card's mark.
- **The old session's end.** The task times and the spending read a lane's session; the session a cleared chat left
  is read on to its end (the report's line, the last minutes), named in the journal's `left` by each save-log and in
  the state's `movedFrom` while the app still names it, until both readers reached its end or it is gone.
- **No false signals.** Neither the /clear nor the start after it is a turn: no `turn-ended` goes to the board for
  them, so no instruction is marked missed for them; the fresh conversation's first turn that ends without closing
  one counts as any turn does.
- **The board shows it**: "cleared after B482 · log" where B235's line stands; "log" opens the text in the board's file
  viewer, which shows a log larger than 1 MB by its last 2 MB under a line naming the whole file.
- **Rollout** (the person's, once the mod is installed and the app started anew): `"afterStep": "clear"` and
  `"compactAbove": 150000` in the project's `list.json`.

### The board keeps the account of clears (B547, 2026-10-24)

On 2026-10-24 three reported steps ended in no clear: Workers 4 and 1 (an older mod, 18:22 and 18:23) left no
turn-ended, no log and no reason on the board, and Worker 2 (19:10) was refused its log while its background work ran
(HTTP 409); each took its next step on the old conversation. The mod decides the clear once, at the end of the
reporting turn, and when that moment fails nothing tries again. So the board, which sees both ends, keeps the account
(`src/clearOwed.mjs`): a worker whose last report (its own History line to review, or reported again) is newer than its
last clear (its card's `cleared`, now kept as `lastCleared` whatever came after) owes a clear (`clearOwed` on its lane).
While it does, for a Workers mod of 0.17.0 or newer (the version its last call said): the reconciler's and the pull's
line of its next step waits (`reconciled.held`), its mod's take hands out no step line, its work tool's take is refused
("Not yet: this chat is cleared after B12 first ..."), and once the chat is free, nothing it started runs in the
background, the person does not pause and two minutes have passed since the report (the mod's own clear goes first),
the take's answer names the clear (`clear: { step, reportedAt }`). The mod (0.17.0) runs it as the clear after a report,
with all its guards, at most once a minute, and refused it only writes why on the card (no compaction). An older mod is
held to nothing; the row says "not cleared after B12" with what happens next, and the watch rule `not-cleared` names it.
The mod's newest word why it did not clear now shows as its own kind (`not-cleared`), no longer hidden behind an older
clear.
B587 (X36: a worker restarted for a new mod at 22:45 owed the clear of the step it had just reported; its process
ended with the archive, so it could not clear, and its next step's line waited until the board itself started anew
8 minutes on): the clear holds the line only while the chat's process runs (`clearHolds`). A worker whose process ended
gets its line at once, with the board's `start` to the main chat beside it in the same refresh; once started, its take
is refused and its mod clears it first, then the fresh conversation takes the step. Tests: `test/restartStart.test.mjs`.

## A step its worker holds while on another (B567, 2026-10-24)

X21: Worker 3 filed Q338 as not blocking and rested on it from 19:55; B547 stayed in progress with an idle chat, and
three focus steps queued behind it. X23: Q338 was answered at 21:09 while Worker 3 was on B534, and B547 still showed
in progress; B522 sat in progress 2 h with its checkpoint "report B522" while its chat was replaced and Worker 5 did
other steps. The causes: a not-blocking ask never moves a step, so a resting worker kept counting busy; an answer
moved its step back to in progress whatever its worker was on; and nothing named a step left in progress behind another.

- **Rests** (`src/work/parked.mjs`, the reconciler): a step in progress whose worker has rested REST_MS (15 min; its
  turn ended with nothing running, its chat runs, not suspended, not while the person pauses; counted from the step's
  own Since at the earliest) while an ask under it is open, blocking or not, moves to waiting on you, History
  "(rests for Q<n>)": the flow's server move `{ "from": "in progress", "to": "waiting on you", "by": "server", "when":
  "its worker rests on an open ask" }`, in the default flow and `examples/work/flow.json`; a project with its own
  flow.json needs that line (a board built before this rejects it). The guard checks the open ask; the rest is the
  reconciler's, from the lanes.
- **Free for its queue** (`restsFree`): a resting worker whose every held step waits on the person (or is parked) gets
  its next queued step as a free one does: the reconciler's deliveries and `restFree`, `mayWake`, the work API's `pull`
  (a step waiting on you holds no chat), the effort word (for the step it gets), and the repair rules not-taken and
  queued-behind.
- **Parked**: an answer (or a withdrawal) while its worker holds another step taken or in progress leaves the step
  waiting on you, History "server: parked (resumes after B<n>)": the guard "its asks are answered" holds only while its
  worker is on no other step, for the API and the reconciler alike. The asking chat's word says so. Once B<n> is
  reported, the first parked step of that chat moves to in progress, "(resumes after B<n>)" (the report's `resumed`),
  the next one after it in turn. `work next` lists a parked step right after those in progress, a step waiting on an
  open ask after the queued ones, each with its words ("waits for Q<n>; take your next queued step meanwhile").
- **Anything else**: the health summary names every step a worker holds while on another (its card's step, else the
  newest it holds taken or in progress): "(parked: Worker 5 is on B568; rests for Q1 | resumes after B2 | blocked by
  B9 | nothing names why it waits)", the last one odd. The repair rule held-elsewhere names a step in progress over an
  hour whose owner's card names another step, with nothing naming why, to the main chat once an hour (`do: send`,
  key per hour since first seen). The supervisor's step cards say "parked until B<n> is reported".
- **The worker's rule** (`roles/worker.md`): an ask you stop for is blocking; while a step waits on you or is parked,
  take your next queued step; never leave a step in progress unnamed while on another.

## Chats report their own state (2026-10-24, redesign Part 1)

The supervisor's first day found a group of incidents from the board guessing a chat's state: "working" while its chat
did not run, work for a chat that did not run. It read that state in nine steps of inference from side signals and
timers. Now each chat says it (principle 3, know don't guess).

- **What is reported** (the Workers mod 0.19.0): `busy` from a turn's start, `idle` at its end, `asking` while a
  question to the person (the app's form, AskUserQuestion) is open, each with since when. Idle carries `background:
  true` while the turn's Stop hook lists background work still running (a shell, a subagent, a monitor, a workflow);
  its end wakes the chat with a turn of its own, whose end says it again. A turn that ends while the form is open stays
  asking until the answer: then busy, or idle when no turn runs. Only a Stop hook sets `background`: a turn cut short
  (Esc, an API error) runs none, and what the last one listed stands. When its session ends (not a /clear) it reports
  `ended` once. Model and effort are not reported: the app's record of the chat stays the one place for them.
- **When:** at once on every change (`POST /api/bridge/report`, not awaited: no turn waits on the board), and with
  every take, the mod's 5-second ping (`report` in its body). While a clear is on its way the take is skipped and the
  report alone goes at every ping, so a clear that takes long does not turn the chat unknown; the idle of the turn's
  end goes before the clear starts.
- **The board keeps** each chat's last report in memory (`server.mjs`, `src/bridge.mjs` `noteReport`): by the name it
  shows, and only from the session it shows under that name (another session, a renamed or replaced chat, is refused
  as a take is, 409, and writes nothing); a state other than the four is refused, 400. Each report carries `run` (its
  process: when its session started there) and `seq` (rising by one with every report and take of that process): one
  of a lower `seq` than the kept one of the same session and run changes nothing but when the chat was last heard
  (principle 5; no clock is compared, a new session or process starts fresh). The board also keeps when it heard the
  chat's last turn start (`busyAt`: busy after idle, ended or nothing).
- **What it shows** (`src/chatReport.mjs` `laneFromReport`, `src/state.mjs`): busy is Working, asking Waiting for
  you, idle Free. Idle while the store holds a step taken, in progress or waiting on the person for the chat is
  Interrupted, never Free, so it is handed no new work ("idle with its task open" in the main chat's words); with a
  blocking ask on the person open (or the step waiting on the person) it waits. A blocking ask routed to the partner
  keeps it Working between two turns, waiting for the partner (B392: `waitsForPartner`; health counts that as no odd
  state). Idle with background work is Working, "background work it started is still running", unless it moved a step to
  review or done during its last turn (the step's Since at or after `busyAt`) and holds no other (B148). A chat that reports runs. The report takes the place of the reading of its transcript, card and timers (the turn, cut off,
  quiet, held by its card or branch). Suspended (the plan's limit) stays the board's own fact, whatever it reports.
- **Unknown and off:** no report for `unknownAfterSeconds` (30 unless set, at least 5: the mod pings every 5 s) is
  Unknown: no task goes to it, and the pause does not count it as running a turn. It is Not running (`isRunning`
  false, its lane's `offWhy` says why) once its session ended, once the app started after its last report (B315's
  fact: its process ended with the app), or once its reports stay silent past `offAfterMinutes` (5 unless set, at
  least 1; principle 2: never wait for ever), "silent since HH:MM". Its `offSince` (which the rule working-not-running
  reads as a card left working) is set only when its last report said it worked: busy, asking, or idle with background
  work. An archived chat has no lane, as before.
- **Older mods and a restart:** a chat on a Workers mod older than 0.19.0 sends no report and keeps the board's
  reading, until the restart between steps (B570) brings it onto the new mod; the reading is removed in a later
  clean-up once no chat needs it. After the board restarts its reports are empty: each chat shows the board's reading
  until its next ping, never Unknown or Not running.
- **Done when** (principle 6): for 4 hours after it is live none of these opens or comes back: a chat shown working
  whose chat does not run, a chat working with no task, a chat shown free while its turn runs.
- Tests: `test/chatReport.test.mjs`, `test/chatReport.state.test.mjs`, `test/chatReport.review.test.mjs` (the review of
  2026-10-25: a busy chat with no transcript to read, the partner's wait, ended and silent, the pause, offSince,
  background after a report, the words), `test/bridge.test.mjs`, `test/server.test.mjs`, `test/config.test.mjs`; in
  the mod, `hooks/chatlist.test.ts` ("Redesign Part 1").

## The board hands out all work (2026-10-25, redesign Part 2)

The supervisor's first day found its biggest group of incidents (12 of 36) in the main chat handing out work by
judgment into per-worker queues: tasks waited behind a busy worker while another was free (root cause 1, "AI chats do
what code should do"). Now the board hands out every task itself (principle 1), from facts the chats told it (principle
3: Part 1's reports). The spec: `.claude/specs/2026-10-24-board-redesign-design.md`, Part 2; the plan:
`.claude/plans/2026-10-25-board-hands-out-work-plan.md`.

- **One ready list** (`src/work/handOut.mjs` `readyList`, `src/work/guards.mjs` `readyHold`): every step in state
  refined whose refine is ready (`Refined: ready`), with nothing it is blocked by or waits for open (a blocker in review
  still holds: the worker's own take needs it done), no words to clear, no blocking ask open and no answer the partner
  has not folded in (B309), not held by its kind's standard (the guard of 2026-10-21) or its routing record. In one
  order: `Priority: fix` first, then the goal map's focus goal's, then the rest, each by id. The rest is held, each
  with one line why. The page shows it under the Workers ("Ready for a worker", "Refined, but held"), the main chat's
  sync words name it ("Ready for a worker: ..."), the supervisor reads it.
- **Added by the person** (the Backlog tab's blocks, 2026-10-25): a refined task outside the focus goal waits for the
  person's "Add to queue" (`Queued by: person, <stamp>`, the work API's `add-to-queue`; "Remove", `remove-from-queue`,
  takes it off): the list then holds it after the focus goal's tasks, in the order added, for the first free worker.
- **Kept for a worker:** a task the person pinned (`Pinned: <worker>`, the work API's `pin`; "Pin to", "Move to",
  "Unpin" in a task's window) waits for that worker only, never starts a new one, and goes to it
  before the list's order. A follow-up (a task whose `Blocked by` or `Waits for` named a step that worker moved to
  review or done, or a result check's fix of a step it built, its `Fix of`) is a preference only (the review of
  2026-10-25: by the time the blocker is done its builder is mostly busy again, so a keep only delayed the work): in the
  list's order it goes to that worker when it is idle at the give, else to anyone (`prefers`). `followUpMinutes` above 0
  keeps it for that worker that long instead (`keptFor`, `keptUntil`); its default is 0.
- **The give** (`match`, `idleWorkers`): only a worker whose own report says idle and free (or, B567, it rests while its
  task waits on the person), running, holding no step given or under way, not stuck, gets a task; the one idle longest
  first. Unknown, off, suspended, busy, and a chat the board still reads by its older inference (no report: an older
  mod, or the board just restarted) get none (Review Focus 2). Among the rest a worker already on the task's model
  family is preferred; a task whose Touches overlap a step given or under way, or one given in the same pass, waits.
  The reconciler names the gives (`gives`); the server makes each through the work API as the server: the flow's move
  refined → queued by server when "the board hands it out" (`advance` with `for`). The API checks it anew and refuses a
  second give of a task, or a give to a worker that holds a step queued, taken or in progress (Review Focus 4: two idle
  reports at once, two refreshes). History "refined → queued (given by the board to <worker>)". The next pass sends the
  worker its line (the existing delivery, with its holds: the model switch, the clear, the mod restart). The server
  runs the reconciler the moment a chat's report turns idle (`src/work/again.mjs` `coalesce`: one pass at a time, a call
  meanwhile makes exactly one more), and once more after a pass that gave a task.
- **The take-back** (`takeBacks`, principle 2): a given task whose newest work line to its worker is `takeWithinMinutes`
  (2) old and still not taken goes back (queued → refined, Owner cleared; History "queued → refined (taken back from
  <worker>: not taken within 2 min)"). With "; stuck" when the worker's fresh report has said idle since before that
  line: it never reacted. A worker that reacted (its report went busy after the line: the person typed to it, or it
  thinks long before `work take`) is waited for (Review Focus 3); once it reports idle again without having taken the
  task, the task goes back, not stuck ("not taken in the turn after its line"). A task whose line has not gone (held for
  its model, a clear, a restart, or its chat went off or unknown first) is not on that clock (Review Focus 1), but on a
  second, longer one (the review of 2026-10-25: an Opus task given to a worker whose model was never switched locked both
  for ever): `heldGiveMinutes` (20) after the give it goes back, not stuck ("its line was held"), and `skipPairs` keeps
  that task from that worker for as long. A task given to a chat missing from the list (an account switch drops chats
  for a while) is on the same clock as any, from its line, else from the give: never at once. A stuck worker's lane has
  the flag `not taking`, "Stuck: did not take B<n> within 2 min; it went back on the list", and gets no task, until its
  report's since is newer than the take-back (`stuckWorkers`). None while the person pauses or resumes, or a limit is
  full; after either the clock starts anew (a pause's resume, from pause.json; a full limit's end, from the server's
  memory of when it last held the hand-out, `handOutHeldAt`). A give the work API refuses (managed routing, a race) is
  kept by the server 15 minutes (`deliver.mjs` `givesRefused`): not tried again for that worker, and the ready list says
  "not given to <worker>: <why>".
- **One more worker** (`workerStart`): when ready tasks that a new worker could take wait (kept for nobody, their
  Touches overlapping nothing given or under way, as `match` checks), more of them than the workers asked for in the
  last 10 minutes that have not reported yet (a start word whose worker has not reported since; a spawn word, which
  carries how many workers had reported then), no idle worker is left after the gives, and fewer workers than
  `maxWorkers` are not off, the main chat is asked once per need (`board-start <who> <how
  many ran>`): `start "<worker>"` for a worker of the list whose chat is off (the one off longest first), else `spawn
  workers` with `Count: 1`, `Why: ready tasks wait and no worker is free`. Without `maxWorkers` the board asks for none.
  Main does this without judgment: it is the board's hands (roles/main.md, "Main is the board's hands").
- **The flow** (`src/work/flow.mjs`, `examples/work/flow.json`): `{ "from": "refined", "to": "queued", "by": "server",
  "sets": ["Owner"], "when": "the board hands it out" }`, `{ "from": "queued", "to": "refined", "by": "server" }` and
  `{ "from": "queued", "to": "new", "by": "server" }` take the place of Main's queue moves and the board's queue of
  incident fixes. A project's older `flow.json` still reads (the retired guards never hold), but the board then gives
  nothing and says on top "flow.json lets the board hand out no task: add the move ...". `flowHandsOut`.
- **Gone:** Main's `work queue`, `requeue` and `unqueue` (the API answers 410 with why), `Queue when refined` (B303),
  the page's "Add to queue" for a worker's queue (since the blocks it adds to the one shared queue) and "Take out of
  the queue", the words `queue step from the backlog` and `step refined`,
  the Design tab's worker picker ("Put in a queue" is "Put on the list", `list step from the Design tab`), the board's
  queue of incident fixes and its lines to the main chat (a fix simply stands first), the focus hint "waits for the main
  chat to hand them out", the flag "not taken", and the supervisor's rules `not-taken`, `queued-behind`, `focus-ready`,
  `review-wait`, `idle-while-waiting` and `queued-not-running`. `owner-gone` keeps the steps held by a chat that left,
  and takes a pin to a chat gone 30 min off (`unpin`).
- **At rollout** (`oldQueued`, the API's `retire-queue`): every step queued by a placement of before (Main's or the
  person's queue or requeue, the board's incident queue, a result check's fix) goes back on the list once: refined, or
  new when its refine is not ready; a placement the person made last becomes its pin; a kept `Queue when refined` goes.
  History "back on the ready list: the board hands out all tasks now".
- **Settings** (`config.json`, top level): `maxWorkers` (a whole number ≥ 1; none: no worker is asked for),
  `takeWithinMinutes` (2, at least 1), `followUpMinutes` (0: a preference only; above 0 a keep that long),
  `heldGiveMinutes` (20, at least 1 and never under `takeWithinMinutes`), beside Part 1's `unknownAfterSeconds`.
- **Done when** (principle 6): for 4 hours after it is live none of these opens or comes back: `ready-while-free` (a
  ready task kept for nobody waits over `idleMinutes` while a worker whose report says free, and that holds no given
  task, stands idle), `not-taking`
  (a worker the board took a task back from, flagged), `holder-not-running` (a chat that does not run has work).
- Tests: `test/work/handOutList.test.mjs`, `test/work/handOutMatch.test.mjs`, `test/work/handOutApi.test.mjs`,
  `test/work/handOutSim.test.mjs` (simulated chats through `buildState` and `deliverWork`), `test/work/again.test.mjs`,
  `test/work/retireQueue.test.mjs`, `test/pinTask.test.mjs`, `test/focusHandout.test.mjs`, `test/config.test.mjs`,
  `test/supervisor/watch.test.mjs`, `test/supervisor/selfCheck.test.mjs`.

## Any running chat wakes a chat words wait for (T9.4, 2026-10-25)

The person: "once it's in the queue the worker can stay silent/off. the code aspect needs to wake the chat if it has
replies in its message queue". On 2026-10-25 at 16:37, after a board restart, the main chat was off and its words (a start
of Worker 3, two effort words, note N807) waited 15+ minutes: `wakeFor` asked only the main chat to start a chat and gave
nothing when the main chat itself did not run. Only a running chat can start another (the app's session tools); the board
cannot.

- `wakerFor(state, target, outbox, now)` (`src/say.mjs`) names the chat that carries the `start "<target>"` word: the main
  chat when it runs, else the partner, else another chat that runs (the workers, free ones first, then busy ones; the
  supervisor's chat last). Never the target, never a leftover, never the partner's helper (it does only what the partner
  hands it; `checkSay` refuses it as a holder too). A chat asked to start that target in the last half hour (its word waits,
  or it took it and the target did not start; not one closed because the target runs) is passed over; when every running
  chat was asked, the first again. Null when none can carry it.
- Who cannot carry a word now (`wakerOrder`, review of 2026-10-25): a chat whose turn was stopped (`stoppedOf` on the
  outbox, so for every chat), a chat whose card says Suspended (paused for the limit), and a chat removed in the last
  minutes (`removedAt`). The state exposes `removedAt` on the lanes only, not on the partner, its helper or the
  supervisor's chat, and does not add it there: a removed one of those is passed over only by its stop or its Suspended card.
- `wakeFor` keeps its guards (not again within two minutes; not while an earlier start waits, for ten) and its filter for
  words to other chats (a line typed on the board, a partner word, a sweep). New: every word to the main chat that waits
  while the main chat is known not to run wakes it the same way, whatever its command, and the main chat being off no
  longer means nothing.
- The `start` word (`checkSay`) goes to the main chat, running or not (it waits there), or to any chat that runs. Its first
  line stays `start "<chat>"`; the rest is the same for any chat: one line with SendMessage to the chat's session id (as
  main.md, partner.md and the mod's resume text say), "The worker board holds something for you.", no reply, then go on. The
  roles of the worker, the partner and the supervisor say so; the supervisor's never-list names this word as its one
  exception (the one message it sends).
- `state.nobodyRuns` (`{ since, chats }`, `nobodyRunsOf`): words the board wakes a chat for wait for chats that are off and
  no chat that could carry the word may run (an unknown one says nothing: the board does not guess). The exception is a
  board no mod has called since it started (`bridge.isMissing`, after a board restart): every chat's `isRunning` is null
  then, and an unknown one counts as not running, or the line would never show. The page shows one line under Needs your
  attention, in the attention colour, and it goes as soon as a chat runs.
- Retries stop (review of 2026-10-25). A start that did not wake its chat in ten minutes (the guard on `about`) is asked
  again by `wakesDue`, of a running chat that was not asked since the oldest word that waits for the chat (`wakerFor` with
  `since`), and at most `MAX_WAKE_TRIES` (3) start words for one wait, then nothing more: a chat that cannot be started (a
  stale session id, archived on purpose, wrongly read as off) was asked every ten minutes for days. The same cap holds
  when a word is sent (`wakeFor` without `since`: a pinned start sent anew each start window asked Main 37 times in 6 h).
  A start word closed by the sweep, or one waiting for a chat known not to run, is no try. A wait that ends (the
  words are taken) starts a new count. `state.wakeFailed` (`[{ chat, tries, since }]`, `wakeFailedOf`) carries the chats
  the board asked in vain (the last ask is no longer on its way and nobody is left to ask); the page shows one line each
  under Needs your attention, in the style of the "No chat is running" line ("Nobody could wake <chat> after <n> tries
  since HH:MM: open it yourself."), and the lane's Start button stays. A chat that line names is not named by both lines.
  It goes once the chat runs, its words no longer wait, or another chat that runs can still be asked.
- The pause holds the clock. While the person pauses (`isHolding(state.pause)`) `wakesDue` asks nothing (it wrote a held
  start per running chat, round and round, and every chat started the same target at Resume all), and `wakeFailedOf`
  says nothing. A start the pause holds counts as on its way, however old, and at the resume it counts from there.
- A word that wakes nobody hides no later one (`wakesDue` records a chat only for a word the board wakes it for): an off
  worker whose oldest waiting word is an untaken `start "Worker 4"` is still woken for its later `work` line. The outbox
  sweep closes a waiting `start` word whose holder is not the main chat and is known not to run (`ctx.off`; it can never
  carry it, another chat is asked) with "<holder> does not run, so it cannot carry the start of <chat>"; the main chat's own
  start words wait for it as before.

### The resume after a crash (T9.4, 2026-10-26)

The PC crashed at 09:16 and was off until 12:18; after it every chat was closed. All focus work was one chain, B670 to B674,
and its head, B670, stood in progress for Worker 3, which the crash cut off. Nothing woke it: the wake-up above wakes only a chat
that board words wait for, nothing waited for it, and the restart flow ("Resume all") types into the main chat, which was closed
too. Everything stood still until the person looked. The person: "lets build the automatic resume and see that it works".

- *The word.* `resumesDue(state, outbox)` (`src/say.mjs`, pure) adds one word to each worker that holds a step taken or in
  progress in the store (`storeSteps`: its Owner) and is known not to run (`isRunning` false, or its lane off): command
  `resume-step`, about the step id, text `resume your step B<id> from your checkpoint` (the words the main chat sends at
  Resume all, roles/main.md). It names the step the lane's task names, else the oldest it holds. It is the board's word
  (`bridge.mjs` types it without the person's mark) and no word of the page (`checkSay` refuses the command).
- *The server.* At every look of the board's clock that delivers (`server.mjs`, before `wakesDue`, so the start word follows in the
  same look), also while no chat has called the board yet: after a reboot the word then waits, the page's "No chat is running"
  line names the chat, and the first chat the person opens carries the start word for the others.
- *The wake-up.* `resume-step` is a wake word (`isWakeWord`) that waits as long as its purpose stands (`waitsLong`): `wakesDue`
  has a chat that runs start the closed one (`wakerFor`, three tries at most, then the page says nobody could), and
  `nobodyRunsOf` names it while no chat runs.
- *Never for* the main chat, a leftover, a chat stopped on purpose (`stoppedOf`), parked or paused for the limit (its lane says
  suspended), a chat being removed (`removedAt`, an open removal), or while the person pauses all chats (`isHolding`); nor for
  a step in review, done or waiting on the person. *Once for each off spell:* not again while an earlier word for the same
  chat and step waits, or was sent since the chat last ran (its last write or turn), so a chat that cannot be started is
  not asked again and again, and one that ran and quit again is resumed anew.
- *The sweep* (`outboxSweep.mjs`) closes a waiting word when its chat runs again ("<chat> runs again": it has been started; its
  mod then hands the chat its checkpoint, "You hold B<id> ...") or when the chat no longer holds the step in the store (in
  review, done, dropped, gone, or another chat's). The chat's `take` sweeps first, so a chat that is already up when it
  takes is not handed a word whose purpose is done.
- *Why Worker 5 read free (point 2 of the brief).* It has no card in `.claude/chats`: it never joined the list ("chat not on
  board list; needs which board name to join as", its own last turn), so the board has no Workers mod for it. The rule of Gap 1
  (`laneWithoutReport`: a chat whose card names a mod that reports, with no report since the board started, is unknown and
  then off) needs that mod; without it the lane is read from the conversation as for an older mod (turn ended: free) and
  `isRunning` is null while no mod has called the board (B213). That is pinned (`chatReport.state.test.mjs`: a chat without a
  card keeps today's reading) and was left as it is: calling it off would be a guess (principle 3). Nothing depends on it:
  `nobodyRunsOf` counts an unknown chat as not running while `bridge.isMissing`, and a chat that holds a step and has no card is
  read off by B315 once the app started after its last write. The torn card was the real hole: Worker 3's card (627 bytes for
  466 of JSON, its end NUL bytes, written when the PC crashed) did not parse, so its mod, its task and its off state were lost
  and its lane read "unknown" for ever. `sources.mjs` (`readCard`) now reads a card without the NUL bytes a crash leaves at its end.
- Tests: `test/resumeAfterCrash.test.mjs` (made-up chats through `buildState`: the 2026-10-26 case, a board no chat has called, the
  pause, the chats and steps that get nothing, once for each off spell, the sweep, the torn card).

## Asset providers, part 1: the provider setting (T9.3, 2026-10-25)

The person's yes to build part 1 of `.claude/specs/2026-10-25-asset-providers-design.md`: the setting and the provider
modules that part 2 (asset requests, the queue, the `asset` work action) will call. Nothing here changes what the chats
do: no work action, no mod change, no Codex run of its own.

- *The setting.* `config.json` may hold `providers`, an object from asset kind to provider: `visual` is `codex`
  (the board runs it, `mode: auto`), `music` is `person-suno` (the person makes it in Suno, `person`), `sound effect`
  is `sound-library` (a folder of sounds in the project from which a chat picks a file, `pick`). A kind left out keeps
  that default (`DEFAULT_PROVIDERS`, src/providers/index.mjs). An entry is the provider's name, or `{ "provider", "folder"? }`:
  `sound-library` takes a `folder` (inside the project, written with `/`, `sound-library` unless given). A wrong
  setting is refused at the start, as the others are (src/config.mjs `readProviders`, said by `configProblem`): an
  unknown kind, an unknown provider name, a provider set for a kind it does not serve (`codex` for music), a folder on a
  provider that has none, a folder that leads out of the project. `parseConfig` keeps such a kind at its default.
- *The modules.* `src/providers/`: one file per provider and `index.mjs`. Each exports `{ name, mode, kinds, check }`
  (the sound library also its default `folder`). `check(tools)` answers `{ ok, why }`, never throws and makes nothing:
  `codex` is ok when `findCodex` (src/codex.mjs) finds Codex, with the same `given` path the Design tab uses
  (`tools.codexPath`, the `codex` of the design settings); `person-suno` is always ok; `sound-library` is ok when its
  folder is there and holds a sound file (`.wav`, `.mp3`, `.ogg`, `.flac`, in the folder or up to four folders deep).
  `index.mjs` holds the known providers by name, `providerFor(settings, kind)` and `checkProviders(settings, tools)`,
  which answers `[{ kind, provider, mode, ok, why }]` in the order visual, music, sound effect. Part 2's
  `provide(request, tools)` has its place in the same face; it is not built.
- *On the board.* The server runs `checkProviders` at its start and every 10 minutes (not at every refresh; the loop
  `providers`, so a failing check shows in the head like the other loops) and the state carries the last answer as
  `providers`. The Design tab shows it under "Ideas so far", in a part "Asset providers": a line per kind with the kind,
  the provider and "works" or why not. The part is quiet; only a provider that does not work is in the attention colour.
  The demo and a board whose server sends none show no part.

## The report check judges the work, not the wording (2026-10-25)

The person, 2026-10-25 ("2 yes"), after the supervisor's incidents X45, X50, X57 and X67 (workers looped on refused
reports): in two days 37 of about 178 reported steps were refused at least once, 28 of them for wording only and 5 for
facts only. "Check the work, not the wording." The report check (src/work/check.mjs) now refuses only for facts about the
work, and passes wording with a warning (principles 1 and 8: the board tidies, the worker is not sent back).

- *Refuses (facts).* The base branch differs from its remote (with the way out, `baseFault`); the step's branch is still
  there, locally or on the remote; a worktree or a worktree folder of the step is left; no repository can be told from
  the merged commit or the branch; no result is named (the work API already refuses an empty one); for work outside git,
  work that sits in a repository (the result names a file in one: "report that work with its merged commit", so the
  base against its remote is still checked), and a report whose Touches and result together name no file that is there
  ("not there: ..." or "no file named"). The independent review of the same day kept these two as refusals.
- *Warns for outside git.* Touches is a plan written before the work, often relative to a repository, and the worker
  cannot edit it: a Touches path that is not there warns ("Touches names files not there: ...") once the result names
  a file that is; so does a path in the result's prose that is not there (it misread words such as "done/level.md",
  X57), and a Touches path in a repository when a file outside git is there. A step with no Touches file and a result
  that names an existing file passes: that file is what is checked ("there: ...").
- *Warns (the step passes).* No `Tests bite:` mutant for a change that touches a test file; a Context or Change that is
  missing, over 300 or 500 characters, or holds file names, code words, hashes, ids or placeholders
  (`partsWarnings`); a path in the result's prose that is not there; a result the board cut at its 2000 characters
  (`report` keeps the limit and writes "result cut: N characters" in History; the check reads it, also on a check run
  again).
- *Where a warning goes.* The check's outcome carries `warnings`; the History line keeps the usual pass lines and
  says the warnings after them (`check passed with warnings: <lines> | warnings: <warnings>`), and the step closes (or
  waits for its result check) as after a pass. `work next` shows "Your last report (B<n>) passed the board's check with
  warnings: ... - nothing to redo; do not report again" in every call for as long as that is the chat's newest report
  (the latest report minute among its steps, in any state); a newer report replaces it, whatever its check says (`boardWarningsOf`, resultCheck.mjs).
  Nothing is marked or written: the Workers mod makes silent `work next` calls and throws their text away (register.tsx,
  after a clear, at session start, at a prompt), so a warning told once was lost (the review).
- *The mutant.* The partner's result check asks for it: the board's word to the partner carries `Board warnings:` and,
  for a report that names no mutant for a change touching tests, a `Demand:` line (`checkStepWords`, say.mjs; the
  repair `unchecked` carries the same lines when it asks again, `warningLines`, resultCheck.mjs); the
  helper makes the mutant in a scratch copy and a test that still passes is a fail point (roles/partner.md, "The
  check").
- *The card.* The recap's Context and Change are the board's own words (`recapParts`): as the worker wrote them when
  they read plain (cut at a word to 300 and 500 characters), else tidied by dropping each sentence that holds a
  file name, code word, hash, id or placeholder (an id turned into the step's title when the store is at hand and the
  title reads plain keeps its sentence whole). Taking the words out of a sentence left broken ones ("Lamps stay off set
  to true.", the re-check), so a sentence is never mended. Where a part is missing or nothing plain is left, the Context comes from the step's summary and
  the Change from the report's own prose (a report with no Context or Change at all), else the summary, else the step's
  title; never the Details.
- *The supervisor.* The rule `report-check-twice` counts only failed checks that refused for a fact: the refusals for
  wording that older History lines hold are known (`isWordingOnly`, recapWords.mjs) and left out; a pass with warnings
  is a pass, and the repair `base-equal` reads it as one.

## What it does not do

- It does not start, stop or restart chats itself: it asks the main chat (a worker to start, a restart for a new mod,
  a model and effort to set). Since redesign Part 2 it does hand out the tasks.
- It does not call an AI service, with one exception since 2026-10-12: on the Design tab, on the person's click, it
  starts Codex to make a picture of an idea (see "The Design tab" above). Apart from that, only typing through the
  bridge and the advisor use the plan's usage.
- It does not change the game's folders or git. (B301: it writes the work store, and backlog.md only as its view.)

## Build order

Each step ends with something the person can look at.

1. **Bridge test** (throwaway, about half an hour): a line placed in a file is typed into the main chat by the
   mod. Answers whether the bridge is possible at all, before anything is built around it.
2. **The board with real data**: readers, state, history, server, page after the newest design, without sending.
   A launch entry "worker-board" so the Run pane starts it.
3. **The bridge for real**: typing on the board reaches the main chat; delivered and waiting are shown.
4. **Later, after use**: answering a worker from the board (the buttons in the first design; the same bridge,
   picked up in that worker's chat), the reminder to renew an estimate, and what the person misses by then.

If step 1 fails, the board is still built; its chat dock then only shows the main chat, with a button that copies
what was typed so it can be pasted into the app.

## Tests

- Every reader is a pure function over text and is tested with made-up samples: the backlog, the transcript's
  tail, the plan line, the worktree list, the state table one test per row.
- The sending endpoint: refused without the token, refused from another origin, accepted with both.
- The mod's part with `claude plugin test`: a waiting message is submitted once; a delivered one never again.

## The person's feedback on the first board (2026-10-12, during step 2)

Their words, kept as given. Not built yet: they asked to first work out what they are trying to accomplish and how
to structure it, "instead of taking my feedback literally".

> I want clearer: 'for you'.
>
> I want to clearly have visual what each items wants from me. If they want input/design of verifying.
>
> For verifying i need either clear pictures or a link to the branch to start it. with enough details. I also need
> a button yes or no with input why. Input questions always require text input.
>
> I still feel there is too much information on the board. I want 1 tab to just get an overview of what is
> currently happening for the works, in the queue. how many for you items. the today planning timeline. The
> working folders maybe too much details?
>
> But i need a 2nd tab for the advice. i need to be able to chat with it.

## Settled with the person on 2026-10-12

1. Answering a worker from the board stays in step 4.
2. "Game - Support" (was "Game - Cleanup") builds it, because it built the Workers list in the same mod.
3. The folder `worker-board` becomes a small git repository of its own. It was kept on this PC only until 2026-10-12;
   since then it has a remote the person made, and everything is pushed to it (see "Git" in `README.md`).

B491: a brainstorm question's title is refused as an ask's is (B452): the open question of a running talk whose title is over 12
words or missing (also one from before the form, by the title its first question gives) is typed to the Advisor at once as
`brainstorm fix` (src/brainstorm.mjs `titleFixes`, src/say.mjs `brainstormFixWords`, the look in server.mjs), once for each
wording; the Advisor rewrites it in the thread. An earlier or answered question only shows under the card as a problem.
