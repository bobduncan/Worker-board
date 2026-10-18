# Worker board: design

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
  started, and the start goes through the board's own page with its token, like every other.

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
A checkbox "One list, newest first" beside "Show finished" (B164; the person: "show it 1 long list desc. so last
item on the backlog first") lists every step without the activities, the highest id on top and the steps from
before the ids at the end; the filters, the search and "Show finished" work as in the list by activity, and each
row opens its window as there. The choice is kept in this browser. The picture:
`art-inbox/worker-board/2026-10-14-b164-one-list.png`.
Since B179 the tab opens as one list unless this browser turned the checkbox off, and "Recently finished" folds
away and back with a click on its head (a button that says whether the list is open), also kept in this browser.
The person, 2026-10-14: "Make the backlog 'recently finished' collapsible. Also one list checkbox turned on by
default." The picture: `art-inbox/worker-board/b179/2026-10-14-b179-backlog-folded.jpg`.
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

**Whether a worker was compacted (B235).** The Workers mod 0.9.0 compacts a large worker after its report and writes `compacted: { at, before, after }` on its card, or writes `compactNote: { at, why }` when it does not. The board reads the newer of the two and shows one small line under the worker's name: "compacted at 16:40, from 820k to 95k tokens" in grey, or "not compacted at 16:40: <why>" in yellow; the whole line as its tooltip. Without the mod there is no such line. The picture: `art-inbox/worker-board/b235/`.

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
should change?" with "Make it again"; "I agree", which can be taken back. 3 Add what you want, open once a picture
is agreed: title, description, requirements, the worker or the main chat's choice, an optional time; "Put on the
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
the session it shows under that name, marks what waits for that chat taken, writes that down, then hands it out;
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
the board ask the main chat to start it (`start <name>`, with the id the app knows the chat by, at most every two
minutes per chat; `wakeFor` in `src/say.mjs`); the card and the advisor's tab say that it was asked, or offer the
button when it was not.

A request a chat filed itself says "Close this request." where a step says "Tick this step in the backlog.". An
answer waits for its chat for `answerKeepHours` (48): the chat may be busy or not open. A line typed to the
advisor is dropped after `messageKeepMinutes` (10), so nothing typed long ago turns up in a chat. A delivered
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
  page. Nothing starts anew by itself. The top bar says which version runs: "Board 9beb081 · since 09:48". A board
  started without the keeper (one from before B142) says so and has to be started anew by hand once. The picture:
  `art-inbox/worker-board/b142/2026-10-14-b142-new-version-note.png`.
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
  board, it is read as before.
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
  every step held taken or in progress has a checkpoint at or after the pause; a step of a chat the board does not
  show counts for nothing. *Resume:* **Resume all** writes `resuming` (`resume-all`; also with no pause.json, for a
  chat that was cut off); when the main chat runs the board types `resume` into it, as before; when it does not, the
  banner says so with a link **Open <its title>**, `claude://claude.ai/epitaxy/<the app's id for it>` (title from the
  list of chats, the id from its app card), and its Workers mod reads the resume from the flag. The banner names each
  holder that has not started a turn since the resume (its last turn began after it, or it runs one now); once none
  is left the board sets `running` (`resumed`, the server's only) and the banner goes. *The mod reads it* through
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
  the agreed picture), `Worker:` (a worker, or "Game - Main decides") and `Time:` when given. The first line and
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
  repository B<id>'s work is in", never a silent pass. A failed check runs again on the person's "Check again" (the
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
  ones closed within a day, grey, with "→ <Closed as>". The main chat's name opens the talk with it.

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
  worker that holds a step, is not working and asked nothing at all is a hint of its own; see below.)
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
  not cut off or suspended, and that holds no open ask of its own, for longer than `IDLE_HOLD_MS` (5 min, in
  `src/config.mjs`, from the later of its turn's end and its steps' Since): Needs your attention shows one line per
  chat, "<chat> holds B269 and B280 but is not working and asked you nothing: it may wait for you" (kind `idle`), with
  the button to its answer in the card's window, as the warning that a chat filed no ask has. It counts in the number
  of Needs your attention as that warning does. It has no answered state: it goes when the chat runs again, files an
  ask, or reports. A chat whose answer ends with a "For you" block and filed no ask has that warning instead, not both.
  Nothing of the chat's words is read for it.

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
  a line waits or was taken, none while it is suspended, none for notes filed before the board's first refresh with
  this (`notesFrom`). Its `work next` shows them first and writes `Main read`, which withdraws a line still waiting; the
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
4. Needs your attention as in Details, without "From the backlog", "Open instructions", the closed and answered
   cards and the order and closed switches: those stay under Details. On a phone the inbox stays the third column,
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
  compared without markdown, links or the id note; equal, or one the start of the other). The others are asks of that
  chat, `Via: chat`, `Blocking: no`, History "asked (decide, from its "For you" block)", under the one step it holds
  in progress, else alone (none, or more than one), as the app form's asks are. The answer names them (`asked`), and
  the view is written when there are some.
- **On the board** they are asks like any other: a card with an answer box under Needs your attention, and an answer
  there wakes the chat. The warning "filed no ask" goes by its own rule, as an ask of the chat now stands since that
  turn began. It stays for a chat without the mod 0.13.7, or when the board did not answer in time.
- **Answered in the chat instead**: beside the chat's next prompt, once, the mod names what was filed ("Filed on the
  worker board from your last "For you" block: Q20. ... close it with work answered-in-chat <id> and their words"); the
  job texts say so too (`roles/worker.md`, `main.md`, `partner.md`).
- Tests: `test/work/forYouAsks.test.mjs`; in the mod, `hooks/foryou.test.ts` and `hooks/chatlist.test.ts` (B317).

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

## What it does not do

- It does not start, stop or restart chats, and it does not hand out tasks by itself.
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
