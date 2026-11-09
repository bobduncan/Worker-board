# A reactive board: one wait system, queue not call (goalmap T23)

## Why (the person, 2026-11-09)
"see if we have principles e.g. always reactive, not too much text, visually distinctive for importants, use code more than
chats ... i have this feeling for the T2, we make errors in this, i submit things but i see not enough loaders. or it tries to
react directly to the CHAT instead of code just submitting an item in a queue and then waiting for the chat to pick it up".
They said yes to this plan's four parts ("1. yes").

**The audit:** a read-only audit of the Plan tab (Focus, Goals, Brainstorm, Vision) checked about 40 buttons. It is kept as
`docs/reactive-board-audit-2026-11-09.md` next to this file. It found five patterns:
1. **Chats write what code could.** The partner writes even a Confirm or a mark on the Vision tab.
2. **Three wait systems, two of which guess:** the wait line, the Vision "preparing" lines, and the "thinking" cards.
   They can disagree on one card.
3. **The wait line covers only a fixed list of words.** Every other click gets an 8-second message or page memory.
4. **Time limits stop at delivery.** After that there is no Late and no Send again.
5. **The page runs two steps itself** (write, then send), and a failure in between leaves half an action. Old texts
   name the main chat for work the code now does.

## Part 1: the principles (written)
PRINCIPLES.md gains 10 to 14: always reactive; queue, don't call; one status per thing; little text and honest words;
colour only for what needs the person. Every build, review and result check of a board step checks them as well.

## Part 2: one wait system (chat 1 leads or sets the conditions: it is status code)
Every click is a tracked item:
- **One server action per click.** It stores the person's input (a line, an item) and queues the word to the chat
  together. The page never makes a second call to type the word.
- **Every word gets the wait line,** not only a fixed list. It reads Sent, then Picked up by <chat> at <time>, then Done,
  or Late.
- **Two limits:** not picked up (as today), and picked up but no result within its limit (new). Both turn Late, with
  Send again, also for a chat that is running.
- **The line is the one status** of the card it stands on. Every guessed "thinking…" or "preparing…" text goes.

Done when: every click on the Plan tab shows its line where the button was. A test lists the page's word commands and
fails on any without one. The incidents that would show it failing: a line that stays on Picked up past its limit, and
two statuses on one card.

## Part 3: move the Plan tab onto it (most used first, each its own step)
1. **The Focus talk card and the Brainstorm card** show the line, not "thinking…". The answer and its word become one
   server action. (Audit 1, 2, 8.)
2. **The Focus and Goals words without a line get one:** Pick, Start, This is the goal definition, Did we reach the goal,
   Ask for a Done when, Ask again for the demo, Undo, Mark done. "Asked" never lives in page memory. (Audit 6, 7.)
3. **The Vision tab's decisions** (Yes mine, Confirm, the feature marks, Prepare now or Wait, Not now, Good enough) are
   written into the plan by code at once. The partner is told afterwards, and the slide leaves because the file says
   so. (Audit 3.)
4. **The Vision tab's judgment words** (Go deeper, Get options, Propose standards, Check the plan, ...) use the line, and
   the person's words are kept for Send again. (Audit 9.)
5. **The effort switch and "Make a step from this"** are done by code, not by the main chat. (Pattern 1.)

## Part 4: quick fixes
- **"Make it my focus" on Vision step 5** went the plan's way and was always refused. It now goes the Focus way. Built on
  branch `vision-focus-button`.
- **Words and colour:**
  - "The main chat is asked for N steps", "the main chat hands them out" and "the main chat is asked to start it" say
    what the board did instead;
  - plain information is muted, not orange;
  - "Your partner writes its Done when" is muted and read from the store.

  (Audit 7, 10.)

## Order and landing
- Part 1 and the focus button land first: they are small.
- Then Part 2, on chat 1's design or conditions.
- Then Part 3, one step at a time, most used first.
- Part 4's word and colour fixes may go with Part 3.1.
- Each lands on chat 1's go after the person's yes.
