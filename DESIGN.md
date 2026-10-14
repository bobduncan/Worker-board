# Worker board: design

> **For any project (B191).** Every change to the worker board works for any project. No game, chat, folder
> or PC names in the code, the page, the job texts (`roles/`) or the examples: names, paths and words come from the
> settings (`config.json`) or the project's own files. `test/anyProject.test.mjs` fails on any tie; its list of
> known ties has been empty since B202 and stays empty.
> The user, 2026-10-14: "first ensure that its clear to all future work that this is the constraint if i develop
> something the worker board."

**How to read this file (B138).** It is the history of the board's decisions, made while it was built for its
first project, a game: the chat titles ("Game - Main", "Game - Board", ...), the folders (`C:\Web\...`,
`art-inbox`) and the game's words in it are that project's. In another project read them as its main chat, its
workers and its own folders. The board as it is now, in general words:

- How to set the board up and its settings: `README.md`.
- The jobs of the chats the board works with, and the words they share with it: `roles/` (`main.md`,
  `worker.md`, `advisor.md`, `protocol.md`).
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
backlog, are closed and not shown, unless they tick "Show closed" above the inbox. An answer that did not arrive in
time opens its request again.

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
the task as it was given, the main chat's hand-over as it arrived in that chat ("Task from ...", also one that came
in the middle of a turn) or what the person typed there, with when (`taskOrigin` in `src/transcript.mjs`: the
newest such message at or before the task's start, kept to 6000 characters); the backlog step it is on, or the
first open one that message names; and where it stands now, its step line, its time and what it does. This is the
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
- *The window* is B100's window of a worker that waits, when its answer has the form: its title says it finished;
  "Its task" (its own Task line, and the main chat's hand-over folded under it; what the person typed to it is
  never shown, as B100 has it); "What it did"; "For you", one card per item with its links and its own answer (Yes
  or No, or Done, and words), which the window gathers in the answer box as "1. yes" / "2. no: ..." / "3. done",
  where the person can still change them before one Send; "Its whole answer", folded; and on the right its closing
  block as three rows, Done in green or red. An answer without the form keeps B100's window, its closing block
  also shown apart.
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

- *The task*, at most two lines: the line "In short: ..." of the hand-over when it has one, else its first line
  without its frame ("Task from Game - Main: B12, ..." and "About 1 h" fall away), else the step's title, else the
  card's topic (`shortTask`).
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

- *The head* says "Main needs your answer" (also its card), not "Finished: its task".
- *On top*, set apart: "You asked", its closing block's Prompt line, and "Where it stands", its Done line in green or
  red.
- *What you decide on*: its answer itself, open, drawn as in Talk to Main, without its "For you" block and its closing
  block (`material` in `parseHandover`); it scrolls on its own when long.
- *Needs your attention*: its questions. A question that lists its choices ("- **A:** ...") shows them under it, with
  its advice, and gets A/B/C buttons; one whose words name them ("A, B or C?") gets the buttons alone; the window types
  "1. A" in the answer box as it types "1. yes".
- *Details*, folded: its closing block, and for a question it first asked in an earlier answer a button to Talk to
  Main, which holds all its answers. The board does not guess which earlier answer that was, as the main chat words
  a question anew each time; the main chat puts the material of each question in the answer that asks it.

"For you" is "Needs your attention" everywhere on the board: the right side's tab and its panel, the Backlog tab's
filter, a step's state and the windows. The chats keep writing their block as "> **For you**"; the board reads it
under both names. The tab stays on one line also when the right side is at its narrowest. The picture:
`art-inbox/worker-board/2026-10-14-b169-main-window.png`.

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

**Stop, move or take out of the queue (B83).** The person, 2026-10-14, of the two choices: "1. A" (stop lets the worker
reach a safe point: work committed and pushed, nothing new started) and "2. A" (the main chat makes the change). A
worker's "⋯" menu has "■ Stop its task" for a worker on a task; it asks once ("Stop its task? It finishes what runs,
saves and shares its work, and starts nothing new." with "Stop it" and "Keep going"), then types `stop task` (Name,
Task, Why) into the main chat. The window of a step in a queue (the main chat's queue too) has "Move to" with a list
of the other workers and "Take out of the queue"; they type `move step` (Step, From, To) and `unqueue step` (Step,
From). The board writes nothing into the backlog: the main chat changes the step's note and tells the workers
(`roles/main.md`, `roles/protocol.md`). Each ask is shown as asked while it is on its way and for a while after
(`changeAsks` in the state); the server reads the worker and the step from its own state and refuses a stop that was
not confirmed, a step no queue holds, or a move to the same worker or to the main chat. A click on "⋯" no longer
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
repo itself." So the job description, in general words, is the board's `roles/advisor.md`. What one project sets is
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
map in the game's repository (`milestoneMap`, JSON, its form in `roles/advisor.md`): the milestone, three to six
steps with the backlog steps that serve each and what is missing from the backlog, and one recommendation.
`src/milestone.mjs` counts each step against the backlog as it stands (done, open; an id not on the backlog counts
as missing), so the numbers stay current between rounds. The page draws the steps as a row of boxes (done, part done,
not started, and the milestone's own check last) with a bar of done, open and missing; a click on a box lists its
items under the row. "Yes, queue it" types "advisor recommendation: yes" with the step into the main chat, which
puts it on the backlog when it is not there and hands it out; "No…" asks why and types "advisor recommendation: no"
with the reason into the Advisor's chat. One answer per recommendation (its id); the box then says what was answered.
The mock-up the person agreed to ("1. yes. 2. yes."): `art-inbox/worker-board/b195/2026-10-14-b195-mockup.png`.

**The game plan, readable (B218).** The person, 2026-10-14: "advisor game plan has links that dont work i want to be
able to click them in the UI", and "too much text ... adding collapsing headers so this page feel more manageable".
In the Advisor tab's Game plan part every heading folds what stands under it, folded at first with its first line
beside it, so the plan fits on a screen; a part the person opened stays open while the page runs. Its links work: a
web page opens in a new tab; a file opens read-only in a window of the board (`/api/game-file`, `src/gameFile.mjs`),
read from the plan's own folder in the game, else from the project's folder (a plan may write its links that way),
never from outside them, only text files and pictures of at most 1 MB; a picture opens in the picture popup. Links in
a chat's words stay words. The Advisor keeps no open questions in the plan (`roles/advisor.md`). Pictures:
`art-inbox/worker-board/b218/`.

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
  the exact way, later). Only that phrase is looked for. The lane says who held it and when it goes on; the time
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

An answered card stays in sight until its answer was typed into its chat and two minutes more, and says where the
answer is; it is no longer counted as waiting for the person. What is sent to a chat that is not running makes
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
- *One board delivers.* Of two boards on one project the one that records is the one that delivers; a board
  started with `--history-from` only shows, refuses an answer and says where to give it. A board that starts
  takes the delivery over when the file names a board that no longer takes its key.
- *Two words, and the main chat does the work.* "Prepare restart" and "Resume all" type `prepare restart` and
  `resume` into the main chat, in the board's own wording; `resume` names the chats the board read as cut off.
  The main chat asks every working chat to stop at a safe point and writes who was on what into
  `<project>\.claude\restart.md`, and after the restart it brings them back from that file, then removes it. The
  board says how the preparing stands: who still works, and "Ready" when every chat is at rest and the file is
  written. A message from the main chat reaches a chat in the middle of its turn; what the board types waits
  until a chat is idle, which is why the main chat does the messaging.

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
background holds it. What others hold for it still does: a task the main chat handed over that is not reported, or
its step's branch. "- Done:   no" and "- Done:   partly" keep the reading as it was, and a turn that runs is never
read as finished. The demo's Cleanup is this case; the picture is
`art-inbox/worker-board/b148/2026-10-14-b148-before-after.png`.

A lane read as free, by "Done: yes" or by the app's own summary, shows no task, step or time from a card left
behind: only one dim line, "Last task: <text>, finished" (the person, 10:14: "units worker is in an incorrect
state", of Units shown free beside its old card's task and "22 min over its first estimate"). A chat that waits
for the person keeps its card's task: that is the work it waits on. The picture is
`art-inbox/worker-board/b148/2026-10-14-b148-free-lane.png`.

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
  skipped unread, so a 200 MB transcript takes under a second). A task runs from the main chat's hand-over to the
  worker's "Report from" message; a further message about the same step goes on with it. Only the time its turns run
  counts: waiting for the person, in a queue or with the board off does not; work sent to the background counts until
  the app starts the chat again (up to an hour); half an hour without a line in a turn does not. A task paused for the
  limit, or never reported, is left out. The area is `board`, `art` or `game`, from the hand-over's "Touches:" line,
  else its words. The board writes `data/task-times.md`, the list the main chat and the workers read before they give
  a time (per area: how many tasks, the typical working time, how far estimates were off; an area under 5 tasks is
  still a guess), and shows "Estimates lately: 7x too high" on the Overview (its tooltip per area) and "estimate 1 h,
  took 6 min" in the Backlog tab's "Recently finished". The tasks of one step are one there. Nothing is kept by hand.
  The picture: `art-inbox/worker-board/2026-10-14-b185-task-times.png`.
- An estimate older than 15 minutes of work is marked as old. In step 4 the mod reminds a working chat to renew it.
- A lane's main figure is the time left ("24 min left"); the clock time it ends at is the small one (B95). A time
  that has run out says by how much ("12 min over").
- A working worker always has a time: its own, else the "about <time>" of its backlog step, else the one in its
  hand-over; the last two count from the task's start and say where they are from. A worker that works with none
  of the three is a fault, shown in the warning colour ("No time"). The main chat has no task to time.
- One turn can hold several tasks. A task a chat names starts no earlier than its last message to the main chat,
  and when the board still showed another task the chat had named, it starts when it was named (B94).
- A hand-over that arrives while a chat works is not a user entry in the transcript: the app keeps it with the
  turn as a queued command. The board reads it as a hand-over just the same.
- The steps of a task are one line in the lane (B108): which step of how many, the step's name and the time left for
  that step ("2/5 · Sheet and two views · 12 min left"), from `task.stepLeft` in the chat's card (B107). It counts
  down while the chat works; a step without a time says so. The names of all steps, the current one marked, open
  under the line on hover and when the keyboard is on it. The task's own time stays in the lane's time column.

## The queue

A step a worker is on is in progress, not queued, also when the step names no branch (a check, a comparison, a
merge): the step that names its branch, else the open step of its own that its task record names by id, else the
one its hand-over names (B94).


The queue stays in the backlog, so there is one list. The main chat writes each queued step so the board can read
it: `- [ ] <task> (for Units; after <condition>; about 40 min)`. The board picks out the worker and the time.

**Only what waits for a worker (B172).** The person, 2026-10-14: "i believe the queue is out of sync ... investigate
what caused this and try to prevent it". The board had counted every open step under "Next to hand out" as queued,
for the first chat its words named: Main's queue held B126 "(later; not handed out)", Board's held the person's
Verify steps. Now a step is queued only when its note names a worker ("(for Units; ...)"), wherever it stands; never
a step for the person (@you), and never one marked "later", "not handed out" or "not queued" in brackets. A step
under "Next to hand out" without a worker waits for the main chat; one for a worker the board does not know is
"Queued for nobody". And a worker's message whose first line starts "Report from" ends its task, whatever address or
tool sent it (the main chat's name, its local id or pipe address, the app's send_message): Game - Support's report of
B168 went to the main chat's local id, and the board kept its hand-over open, so Support showed as working.

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

## What it does not do

- It does not start, stop or restart chats, and it does not hand out tasks by itself.
- It does not call an AI service, with one exception since 2026-10-12: on the Design tab, on the person's click, it
  starts Codex to make a picture of an idea (see "The Design tab" above). Apart from that, only typing through the
  bridge and the advisor use the plan's usage.
- It does not change the backlog, the game's folders or git.

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
