# The worker board, described

B184, 2026-10-14. Everything the board does and how it looks, in general words, good enough to build it again
roughly the same from this page alone. `DESIGN.md` keeps the history of why; this page says what. The words the board
shares with the chats are in `roles/protocol.md` and are not repeated here. The screenshots are from the demo
(`npm run demo`), in the project's picture folder under `worker-board/b184/`.

## What it is

One page on the person's own PC for a project in which several Claude chats work together: one main chat hands out
the tasks, worker chats do them, an Advisor chat advises. The page shows who works on what, what waits for the
person, and lets the person answer, talk to the main chat, and plan. Every answer is typed into the chat it is for
(by the Workers mod) or copied for the person to paste (without it).

## How it is built

- **The server** (`server.mjs`, Node 24, no dependencies) reads files on this PC and serves one page on
  `127.0.0.1` only. It reads: the project's list of chats, each chat's card, the app's list of chats and their
  transcripts, the backlog, the asks, the game's working folders through git, the app's usage file, the game plan
  (see the README, "What it reads"). It writes only its own `data/` and, on the person's click, a tick in the backlog.
- **Its routes:** `GET /` (the page), `GET /api/state` (everything the page shows, read anew every `refreshSeconds`),
  `GET /api/picture` (a picture of the project's picture folders), `POST /api/say` (an answer or a line for a chat),
  `POST /api/game` (start or stop a game), `POST /api/design` and `/api/design/reference` (the Design tab),
  `POST /api/talk/picture` (a pasted picture), `POST /api/restart` (a new version), `POST /api/work` (the store;
  also `pause-all` and `resume-all`, which write `pause.json`), and for the Workers mod `POST /api/bridge/take`,
  `/api/bridge/typed` and `/api/bridge/work` (the work tool; `pause-state` reads the pause). Every POST of the page
  needs its token and its own origin; the mod's need the bridge's key.
- **The page** is `public/index.html`, `public/board.css` and `public/board.js` (no framework). It draws the state
  it is given and redraws only what changed, so typing is never lost.
- **A keeper** starts the server and starts it anew when the person clicks the yellow "new version" note.

## The look

A dark dashboard: dark blue panels with thin borders on an almost black page, white text, colour only for state.

| Token | Colour | Used for |
|---|---|---|
| `--bg` | `#0a0f18` | the page |
| `--panel` | `#101826` | panels, windows, the side |
| `--inset` | `#152032` | fields, bars, sunken boxes |
| `--line` | `#202d40` | every border and rule |
| `--text` / `--muted` | `#e8eef7` / `#8d9aae` | text / quieter text |
| `--working` | `#3fd27f` green | working, good, done |
| `--waiting` | `#f6b93b` yellow | waiting for the person, warnings, the new-version note |
| `--free` | `#3b82f6` blue | free, the main buttons, the chosen tab |
| `--suspended` | `#a78bfa` purple | paused for the limit |
| `--unknown` | `#5b6779` grey | not seen, cannot tell |
| `--warn` | `#ff7a59` red-orange | problems, cut off, over the estimate |

- **Type:** 15 px "Segoe UI", system-ui, sans-serif, line height 1.4; headings 17 to 30 px bold; small notes 12.5 to
  13.5 px muted; code and branches in a monospace font.
- **Shapes:** panels with a 1 px `--line` border and 10 px corners; pills (a state word on its colour, 999 px
  round); count pills (a coloured dot and a number in an outlined box); buttons 7 px round, the main one filled
  `--free`, the others outlined; windows as centred dialogs over a dimmed page, with a × at the top right.
- **Spacing:** 14 to 18 px inside panels, 8 to 12 px between items; lanes as table rows with a 1 px rule.
- **Layouts:** two columns on a wide screen (the work on the left, a resizable side on the right). Below about
  1250, 1100, 900 and 820 px the columns stack and less important columns of a table drop out; at phone width
  (about 375 to 400 px) the tabs shorten ("Today" for Overview), lanes become cards, and the side comes under the
  work (`08-phone.png`). Motion is switched off for people who ask their system for less.

## The top bar

The tabs **Overview**, **Advisor**, **Backlog**, **Design**; on the right **Pause all** (2026-10-18, in place of
Prepare restart, which is gone with restart.md and the "Safe point:" lines: after a Yes it writes the work store's
`pause.json`, and each chat's Workers mod (0.13.9) tells its chat at the first tool batch of each turn to write its
checkpoint, stop or wait for its background agents and end its turn; until Resume all (2026-10-19: no longer until
running) the board hands out nothing that starts a turn, and what the person sends waits, "held until resume", and goes
out at Resume all, not late for the time it waited; the restart banner says "Pausing since HH:MM: still
working: ...; waiting for you (question form): ...; a line is being typed into: ...", then "Safe to restart", with a
muted line for each step held with no checkpoint ("B313 (Board) has no checkpoint; it resumes from its branch and
History."), and **Resume all**; after Resume all it names who has not started a
turn yet, each chat once with the steps it holds ("not started yet: Worker 1 (B188, B190)"), and when the board goes
on without waiting ("at 12:44", 20 minutes after Resume all), and when the main chat does not run a link **Open <its
title>** that opens it in the app (its mod then gives it the list of whom to wake by session id, and each holder's mod
its checkpoint; once its process runs and it
has done nothing, the board types `resume` into it, once); while resuming everything goes out as when running (the
person's answers too); it goes once every chat holding a step has started a turn, or 20 minutes after Resume all, and
then says for an hour, in grey, who did not start ("Worker 6 did not start after the resume: B364."); see DESIGN.md,
"Pause and resume from the store" and "Resuming holds nothing"; B315: a word to
the main chat that was only copied, because its chat did not run yet, stays on the restart banner, "Main's chat is not
running yet: open Game - Main in the app (or click it in the sidebar) and paste with Ctrl+V", with **Copy again**
and **Dismiss**, until the main chat has it or it no longer matters: "resume" once the main chat got "resume" another
way, and any word after two hours), **CPU for the
chats** (B311: Off, Gentle, Strong, one click each; when not Off, how many processes it applies to, "15 processes,
below normal"; "not available here" off Windows; a listing that failed is one red line on top), **Bother me** (B361: At once, or Once a day: the recaps
and the questions that hold up no chat then gather under your partner's daily note on the Focus page; a question that
holds up a chat always comes at once) and **Approve rebuilds by itself** (B361: Off, On; saved in the board's settings
file), the board's
version and since when, "Last updated", and a refresh button. When the board's folder holds a newer version, a
yellow note on top says so; a click starts the new version. When a data file of the board was torn (by a restart or a
power cut) and could not be read at its start, a red note on top names it and the copy it was kept aside as
(`<name>.broken-<time>`, B406): the board started without it. Without the Workers mod a bar on top says that what the
person sent was copied, and into which chat to paste it. At the far right a round **?** opens the help tour (below).

## The help tour (B348)

Six cards over the page, one painting each (`public/help/`, B347) with its number, title and one or two lines: 1 set
up a project, 2 pick a goal as your focus, 3 agree its vibe and how with your partner, 4 the work divides itself, 5
answer what needs you, 6 check the result. **Back** (not on the first card), **Next** (**Done** on the last), a dot per
card to jump to it, the arrow keys, and **×** or Escape to close at any time. It opens by itself the first time a
browser opens the board, on a plain address only: never over a link from a chat (`#picture=`, `#play=`, a step, a
tab) and never on the demo; once closed, the browser keeps that it was seen (`help-seen`), and it opens only from the
**?**. On a phone the card fills the screen, its buttons at the bottom.

## Overview (`01-overview.png`)

- **The head:** the project's name (the setting `name`) with a refresh button; **Run game** (only for a project
  with a game: starts the base branch's game and opens it, with its commit and last change under it); the plan's
  limits (the 5-hour and the weekly bar, green, yellow from the warning percentage, red when full, with when they
  reset and how old the reading is).
- **Count pills:** how many workers are working, waiting for the person, free, suspended, cut off, not running or
  unknown.
- **The Workers panel:** one row per chat of the list, the main chat first. Columns: **Worker** (its icon, name and
  state pill: Working, Waiting for you, Free, Suspended, Interrupted, Unknown, and "not running" when the mod says
  so; B315: "Not running" in place of Working for a chat whose card was left working by a quit app, its process not
  running, with its step kept and no "may wait for you" hint), **Current task** (its topic, "Now:" what it does, or "Last task: ..., finished", a red line when it is over
  its first estimate), **Progress** (a bar with "step n of m" and the time left of the step), **Est. time** (ETA and
  the clock time, "Goes on at ..." when suspended, "Blocked" when it waits), **Queue** (the next step for it, how
  many more, and why it has not started). Under a worker's name, when the Workers mod cleared it after its reported
  step (clear after each step): "cleared after B482 · log", "log" opening the kept conversation in a window of the
  board (a log larger than 1 MB shows its last 2 MB, under the line that names the whole file); a compaction's line
  says in its tooltip why the worker was not cleared. A ⋯ menu per row holds **Remove**, which asks the main chat to close that
  worker (with a warning when it is not free). Under the rows: what is missing (no list of chats, no chat, no
  backlog), "No main chat yet" with the steps to make one, "No workers yet" with **Ask for three workers**, the line
  about the missing mod, and **+ Add worker**. B465: under the panel's head, after **Out of sync?** (or when the
  board's own check found something), "Out of sync? · the board checked itself at HH:MM": a row per stuck state it
  found, each with **Fixed**, **Woke**, **Sent** or **For Main**, and a **Fine** row for the checks that found nothing
  (`art-inbox/worker-board/b465/out-of-sync-answer.png`); it stands for an hour.
- **The timeline:** from a few hours back to some hours ahead, one row per chat: what it did (green working,
  yellow waiting, blue free, purple suspended, grey not seen), what it expects (hatched) and its queue (striped),
  task changes as marks, and "Now" as a line.
- **The side, "Needs your attention":** every request of a chat and every step of the backlog that is the person's,
  newest first (or by kind), each a card with who asks, the kind (Input needed, Verification needed, Do, Decide),
  the words, pictures to look at, choices with the recommended one marked, how to play the change, and the answer:
  a text field and **Send**, or **Approve** / **Reject** with a reason, or **Done**. An answered card leaves the list at once
  (B307); **Show closed** shows it again, dashed, with where its answer is (waiting for its chat, handed over, typed
  in, copied to paste), beside the closed ones; an ask the backlog held (migrated with its B id) is a card like every
  other, and a ticked one shows only with **Show closed**. Focus 4: your partner's questions (its asks of the focus goal and its
  steps first, then its others) stand first, under **From your partner**. The work store's asks are the cards (B298, B299: Decide, Look,
  Provide or Do, "blocks B1 · Board waits", a **Play it** link), answered into the store. At the very bottom one quiet
  line, **Log: 44 reports · 3 instructions** (the unread notes and the open instructions; "nothing new" for none; never
  in the count on the tab): a click unfolds the log, **Open instructions** (the person's words per chat: missed ones
  red, closed ones grey with what came of them) and **Information** (notes and reports, each with **Read**, and **Mark
  all read**); folded or open is kept in the browser. An instruction a chat missed also stands among the asks as one
  red line, "Main missed your words of 14:02: open the log", which opens the log at it (and counts). B360: after the questions, a **recap** of every step that passed its
  result check and every goal that passed its re-check: a card marked Information (a green edge; it asks nothing and
  blocks nothing) with the step or goal, what the person gets, its evidence picture and when it approves itself, and
  two buttons (B390): **Overturn** in red opens a box for the person's words (the partner makes a fix step from them; a
  goal opens again; Cancel closes the box) and **OK, seen** in blue approves it at once, with no words ("Seen by you");
  left alone it approves itself 24 hours after it came and moves to the closed items (setting
  `botherMe` "daily": gathered under the daily note on the Focus page instead, as the questions that hold up no chat
  are, B361). B301: no card comes from a chat's words; a chat that wrote questions in
  its chat without filing an ask is a warning card, "<chat> wrote questions in its chat but filed no ask", with a
  button to its chat (Talk to Main, the Advisor's chat, or a worker's answer in the card's window). B308: a worker
  that holds a step, has ended its turn with nothing running and filed no ask, for more than 5 minutes, is a hint
  card of the same kind, "<chat> holds B269 but is not working and asked you nothing: it may wait for you", one per
  chat, with the button to its answer; it goes when the chat works again, files an ask or reports.
- **On top:** a line when the work store is not there or cannot be read (B301: naming its folder and the command that
  makes it; the board then shows no work), or a file in it is broken (naming the file).
- **The side, "Talk to Main"** (`02-talk-to-main.png`): the person's talk with the main chat: what they typed (also
  in the chat itself) and its answers with times, the main chat's "For you" block and closing block drawn as such;
  lines on their way marked so. A box with **Send to Main**; Ctrl+V adds a picture, shown small until it is sent.

## The windows

- **A worker's task** (`03-task-window.png`, a click on a lane or `#task=<name>`): the step the work store holds for
  it (else what the person typed), the person's feedback it is on, its plan with the steps done and to come, and the
  details.
- **A worker's answer:** its "Task" and "What I did" lines and the rest of its answer, as its words; its "For you"
  items are no questions to answer here (B301).
- **A step of the backlog:** its words, its notes in sections, its branch, its pictures, and **Add to queue**. Its
  **Model and effort** (B468, model per step): Sonnet or Opus and the five effort levels, the step's lit, each with its
  reason, and who runs at it ("Units runs at Sonnet · low until the step ends, then at its usual setting (Sonnet ·
  medium)", or that the main chat was asked and it is not set yet). A worker's task window shows the same as a chip,
  "Sonnet · low".
- **A picture** (`04-picture-popup.png`, a click on any picture or `#picture=<path>`): the picture large with its
  path; a click closes it.
- **A game** (`#play=<branch>&<settings>`): the branch's game started and this tab turned into it.

## Focus (`05-advisor.png`; Focus 1: `art-inbox/focus-mockups/inc1-*.png`; Focus 2: `inc2-vibe.png`, `inc2-how.png`; Focus 3: `inc3-run.png`, `inc3-vibe-there.png`)

The tab was named Advisor until Focus 1 (spec 2026-10-18). Its bar shows three parts: **Focus**, **Goals** and
**Brainstorm**; the others (Next milestone, Game plan, Suggestions, Refine, Chat) are hidden, not deleted, and the
setting `advisorParts` brings any back. The Advisor's chat still opens from its card and its links.

**Focus** shows one goal of the map, the focus (`Focus: G<n>` in goals.md's head), read from the file: "Your focus",
the goal's id and title, its vibe in one line once agreed, and the strip 1 The vibe → 2 The how → 3 The run (a step
done is green with ✓, the one now blue). The vibe: the talk with your partner on the left (the goal's brainstorm
thread as bubbles: your words, its questions) and "The vibe so far" on the right (its lines ticked, its picture),
with "This is the vibe" and "Not yet". The how: the talk on the left, "The how so far" on the right (the parts with
their sizes, "Decided by your partner", "Brought to you"), with "Go" and "Not yet". The run: "The how" on the left,
each part with Done, In progress (and who is on it) or Next and a bar, no step ids, and "See the steps behind this →",
which opens the Backlog on the goal's steps ("Steps behind G6 ✕" clears it); "Today's note from your partner" on the
right; a slim talk bar under it. No focus (or one that is gone): "What do you want to work on?" with the open goals of
the map and a free line; a focus that is done asks for the next one.

Since Focus 2 the moves work, on the board that delivers (and on a copy with a goal map of its own), with a partner on
it (the chat the setting `advisor` names; without one, or on a board that only shows, the buttons are off and say
why). **Pick** makes a goal your focus; the free line ("Start") makes something new a goal at the top and your focus.
The board writes `Focus:`, starts the goal's talk (or goes on with the one that runs) and types `focus: G<n>` to your
partner. **The talk** answers your partner's open question as the Brainstorm part does: its options as chips (the
advised one marked), your words in the box, Send (Enter; Shift+Enter a new line); while your partner has the turn the
box is off and a line says it thinks, or that its chat is not running. **This is the vibe** (once your partner wrote
one) and **Go** (once it proposed parts) write their line once and tell your partner; **Not yet** opens a box for what
is missing and sends your words. A line under the head says what each move did, or why not.

B352: under the talk, **High effort mode** with a switch: off is the usual partner (Opus 5.5, extra high effort), on
is Fable 5.1 at max effort, for the vibe and the how of a hard goal. Flipping it types `partner effort` into the main
chat, which sets your partner's chat; until your partner's next answer runs on that model and effort (its transcript
names both) the line is dashed and says "Switching…", then solid. Go on the how and another goal as your focus switch
it back to off by themselves; a word the main chat never took says so and changes nothing. The switch stands as the
last word asked (kept however long your partner is idle), else as what your partner runs on, so it
survives a reload.

Since Focus 4 the run's **talk bar** sends your words to your partner, in the talk about the goal (Enter sends): with
its question open they are your answer; while it has the turn they are typed to it as your word; with no talk running
a new one starts with them. A part whose steps are made but not handed out yet says **Waiting for the main chat to
hand it out** instead of Next; when they wait longer than the grace time, a hint under Needs your attention opens the
talk with the main chat.

Since Focus 3 the run follows the work: each part is Done when all its steps are, In progress (with who is on it) while
one is taken, in progress, waiting on you or in review, else Next; the head counts the parts done and the time the
others still name. **Today's note from your partner** (its daily note, written in its morning round) lists what it
**decided for you**, each line with **Undo**: a click asks your partner to undo it (it is typed into its chat as your
word, once) and the line then says "undo asked". **Needs you** shows your partner's open questions on the goal or its
steps, three at most ("and n more"), each with its options as buttons (the advised one marked; a click answers it)
and its pictures. Once every part is done, **Is the vibe there?** stands above the note with the vibe: **Yes** ticks
the goal and clears the focus (the page then asks for the next one); **No** opens a box for what is missing, and the
goal goes back to the how.

Partner answers (2026-10-19; picture `art-inbox/worker-board/partner-answers/note.png`): under today's note (else at the foot of the page) a switch
**Your partner answers detail questions** (on unless you switch it off; "on: detail questions go to your partner
first", "off: every question comes to you"). While it is on, a worker's or the main chat's question with its options
or advice goes to your partner first and does not stand under Needs your attention; your partner answers it (normally
with the worker's advice) and the answer stands in today's note under "Decided for you" as `Q<n> (<worker>, B<n>):
<question> → <answer> (<why>)`, with **Undo**. Undo takes the answer back: the question comes to you under Needs your
attention, with "Your partner had answered: ...; you took it back", its chat waits for your answer, and the line says
"taken back". With **Show closed**, the answered question's card says "Your partner answered: ..." with its why and the
same **Undo**, for 7 days; an answer the Focus page's note does not show (no focus, or an earlier day's) stands under
Needs your attention in **Decided for you by your partner**, with its Undo, for 7 days. Your partner's own note of the
day and its answers share one note. While a question is with your partner, Needs your attention shows **With your
partner: <n> questions** (a click lists them) and the asking worker's lane says "Waiting for your partner (Q<n>)". A
question your partner hands on, or has not answered 30 minutes after it was asked, comes to you with a line on its card
that says why ("Your partner hands this to you: ...", "Your partner did not answer in 30 min: it is yours"). Questions only you can answer (provide, do, without options or advice) come to you as before.
B392: a step whose open blocking questions are all with your partner says **Waits for your partner** in pink, never
"Needs you": in its window's flow strip ("waits for your partner (Q<n>)"), in the goal's steps on the Goals page, in your
focus's steps and the workers on the Overview, and on the worker's card. It is yours only once your partner hands the
question on. A question still with your partner ten minutes after it was asked wakes your partner once more.

B354: a goal becomes your focus, and gets its tick, only with a **Done when** that says how you check it. In the pick
list a goal without one says "No Done when yet" with **Ask your partner to write it** in place of Pick (then "Your
partner writes its Done when", with **Ask again**); something new is put into the map at once and your partner is asked for its Done
when: you pick it once the line stands. On the Goals part such a goal has **Ask your partner for a Done when** beside
"Done when…", and its tick is refused with why. "Is the vibe there?" shows the Done when under the vibe; without one
Yes is off and the button asks your partner for it. In the run each part shows what its results are checked against,
"Checked against: <kind> · <reference picture> · target <score>", the picture opened with a click: the Standard line
of its steps (below, "Kinds of work").

B356: a step with agreed points is done only after a helper that did not build it checked it. Under each part of the
run, "Checked by a helper: n of m points pass (B<id>)" in green or red, with **the evidence** to open (the result
beside its reference, the points ticked). A step's window shows **Checked by a helper**: the score, every point ticked
✓ (green), ✗ (red) or ? (amber, for you to judge), and the evidence picture; a fix step the board made from a failed
point says which step it fixes.

B358: a goal is ticked only after your partner re-checked it against its Done when and its vibe. Ticking it on the
Goals part, or Yes to "Is the vibe there?", asks for that re-check ("Your partner re-checks it…"); a passed one ticks
it and leaves you a recap, a failed one names the gap and the attempt under the goal while your partner adds the steps
that close it. While the re-check runs, a click on the dot asks your partner again, and a second click ticks it
without the re-check: that overturn is written under the goal. **Take the re-check back** leaves the goal open.

B383: beside the map (under it on a narrower screen), **Steps for this goal** shows the goal you zoomed into: its
**Associated steps** (All, Open or Done; each numbered with its title, one line, its state and its chat, a menu to open
it or its chat; done ones folded under "Show N completed steps") and its **Missing steps**, each with **+ Add step** (a
new step under the goal, which your partner refines) and **Dismiss**, and **Add all**.

The other parts: **Next milestone** (the way to the next milestone, drawn from the goal map: the first
milestone of the game plan in it that is not done, its sub-goals as the row, the milestone's own Done when as the
last box; "No milestone to go to yet" until there is one, "not mapped yet" while it has no sub-goals), **Goals** (the project's goal map, `goals.md`, one level at
a time: the goals with their counters of goals inside, steps done and missing lines; a click zooms into a goal, ‹, Esc
or the crumb zooms out, ▸ folds one more level open; the focus is in the address, `#advice/goals/G2`; every change
is written to the file at once: the frame's buttons add, rename, set Done when, Why, notes and links, dissolve or
delete; a row's dot changes its state; drag a row, or Alt+↑/↓, Tab and Shift+Tab, to move it; Ctrl-click several and
group them under a new goal; Ctrl+Z undoes; the tree beside the outline shows the same level as boxes under the goal
zoomed into, "Diagram" and "Outline" hide either side, "Hide done" leaves out the goals done with all inside them done (kept in the browser; "+n done hidden" where they stood shows them again; on a phone behind the bar's "…"), a click on a box zooms in, dragging a box moves it; on a phone
the outline alone and a "…" menu on every row; "Ask the Advisor…" in the frame or a row's menu asks the Advisor a
question about that goal, with pictures pasted or picked: the ask stands under the goal, violet, until the Advisor's
answer comes there, with its pictures and "More ↗" for its whole page; "Make a step from this", "Ask again" and
"Done" (read) under it; an answer not read is also a line under Needs your attention), **Brainstorm** (think something
through with the Advisor, one question at a time: "+ New brainstorm…" or "Brainstorm this" on a goal starts one with
your opening words; the Advisor's question comes as a card with its options, the advised one marked, your own words
under "Other" and a picture when it is visual; Answer, Skip, Back, "Enough, wrap up"; while the Advisor thinks the
card says so, or what keeps it; at the end a proposal: what was decided, new goals for the map and steps for the
backlog, each with a tick, and a note; "Create what's ticked" puts the goals into the map and asks the main chat for
each step; "Change…" asks the Advisor for another proposal; the list at the left holds every brainstorm, running and
done, with what became of it; a question or a proposal waiting is also a line under Needs your attention),
**Game plan** (the game plan from the game's repository, with when it was written; being reworked in B218 at the time
of this page), **Suggestions** (the Advisor's open suggestions with their Why, Cost and Unblocks, and when its rounds
come), **Refine** (the steps by where their refine stands) and **Chat** (a chat with the Advisor, as "Talk to Main").

## Vision (2026-10-19)

The product plan (`productPlan`, the game's `docs/product-plan.md`, written by the partner): the answers every goal and
step falls back to. Five steps, broad to narrow, **1 · Vision → 2 · Features → 3 · Standards → 4 · Plan → 5 · Focus**
(the new order of 2026-10-21; a ✓ on a step that is settled), and an **Interview**, the guided path: the partner's
questions and every decision that waits on the person across the five steps, one per slide, each decision with the
buttons of its step (Yes, mine; Prepare now or Wait; Confirm; Change; Make it my focus) and a box for the person's
own words about that one (Send my words: a change of it, or a new focus proposal), sent at once and marked sent;
while decisions wait, every step shows a bar "n decisions wait for you" with **Start**, and once none waits the
Interview says **All decided**. The vision: the page's pitch in large type, then a
card per answer: its title, its state (decided green, assumed blue, open amber; **settled ✓** in teal once a deeper
round is answered or the person pressed **Good enough**), its first four points with bold lead words and the rest
under **Details · n more**, up to three pictures with captions (Look and sound always; every other card gets one
scene made in its look, 2026-10-21; a card still without pictures shows two or three line icons with captions
instead, or lettered badges for tools), the partner's one line of
advice, where it came from, **Go deeper** (or "2 deeper questions →", or **Deepen again** once settled), **Good
enough**, **Yes, mine** / **Confirm** and **Change**; an open card has **Answer it →**. Standards (2026-10-20): the
guard on top (since 2026-10-21 the board holds it: a step whose Standard line names a kind with a standard goes into a
queue only once that standard is confirmed and its `Foundation built: yes`; a step that builds the foundation ends
its Standard line in " · foundation" and goes first; each card says what it holds back), then a row per
kind of thing the goals need: its pictures as a gallery (one big: the bar, today, or any other; the rest as thumbnails
under it, a click showing one big; a vision card with two or more pictures has the same), what the goals need as a muted line, then two parts set apart: **the bar** (three to eight points, each with sub-points where the page indents them under it, and a "see" where a point has a picture) and **today** (the score and a gap chip); how the things get built (the foundation, the hours) stays on the page for the gap goal, since a standard says what each thing must meet, not how it gets built; **Confirm** (waits in the bar),
**Change**, **Measure today**; a box for words on all of them (the gaps become goals at the plan's check). Empty, the step has
**Propose standards**. Features: the architecture check on top
(a complex feature later or not sure: the structure is checked at every milestone), then a card per feature: its
picture, name, complex and built tags (the why of a complex one in plain grey under them), points, the four marks
**Must · Later · No · ?** and the milestone the plan check placed it in ("The plan puts it in M1 · The loop is fun");
above the cards, a bar names the features still not sure, with Show them, since the step's ✓ waits for them; a
pressed **?** is dashed (not sure is an answer); above the overview, **Tradeoffs to decide before the plan**: each
complex feature later or not sure with its picture, the partner's advice (prepare now: what, the cost now, what a
late add touches; or wait: why) and **Prepare now** · **Wait**, sent at once; the step's ✓ and the plan's **Check
the plan** wait for every choice, and the Interview asks them first among the features' decisions; the person's marks wait in a
blue bar ("2 marks not sent yet") until **Send to your partner**; a box for a feature they miss. Plan: **Check the
plan** on top (the partner lays every goal per milestone and proposes each missing one with its why: a feature
without a goal, a standard's gap with its foundation first, an architecture check, a milestone's done when; its last
check's line), then the preset per milestone, a row per goal with its picture, Done when, sub-goals, what it serves and whether it is a goal
of the map, **Confirm** (waits in the bar) and **Change**; a box for words on the whole preset, and **Put the goals in
my goal map**. Focus: your focus now with its done when (its steps are made on the Focus tab: vibe, how, Go), and the
next focus the partner proposes on **Propose the next focus** (its why, when and up to two others), with **Make it
my focus**: only the person's click sets it. The interview: one slide per question, in the page's order (deeper ones under their card, then the
features', then the goals'), as the help tour's cards: the options as picture cards (the advised one marked), the
person's own words as the last card, the question, why it is asked, a dot per slide, **Back**, **Don't know**,
**Answer: A**, **Next**; Change adds a slide with the part as it is and a box for the person's words. Nothing is
written by the board: the moves go to the partner (`roles/protocol.md`).

## Backlog (`06-backlog.png`)

The whole backlog: filters **All**, **In progress**, **Queued**, **Needs your attention**, **Without a worker**, with
counts; a search; **Show finished**; **One list, newest first** (or by activity, the focus first). "Recently
finished" folds open to the last 20 finished steps with when and how the board knows. Each step is a row with its
id, title, worker and state; a click opens its window; a step nobody has gets **Add to queue**, which asks the main
chat to queue it.

## Design (`07-design.png`)

An idea becomes a picture that Codex makes. **New idea:** the words, what it is about (the project's kinds of
idea), reference pictures (picked or pasted), **Make a picture**. **The picture:** the version looked at, every
version to choose from, "What should change?" with **Make it again**, **I agree**. Then the step: title,
requirements, worker and time, **Put on the backlog** or **Put in a queue**, which the main chat writes. "Ideas so
far" along the bottom.

## States without data

A project without a list of chats, without chats or without a backlog says under the lanes what the board looks
for and where (`09-empty-project.png`); without a game there is no Run game; without the Workers mod the board says
what it cannot tell; the demo has made-up data of every state.
