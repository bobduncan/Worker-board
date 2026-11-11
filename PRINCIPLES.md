# Worker board: design principles

The person's rules for every feature and fix of the worker board (2026-10-24, after the supervisor's first day found
36 incidents with three root causes: chats doing what code should do, the board guessing the chats' state, too many
features at once). Every builder follows them, every review and result check of a board step checks against them, and
a design that breaks one says which and why.

1. **Code before chat.** Anything mechanical (who gets what, when, moves, counts, timers, retries) is the board's code.
   A chat only does what needs judgment: refining, building, judging quality. Code is cheaper and does not drift.
2. **Assume every chat can fail.** A chat can stop, forget, misread, run an old mod or answer late. Every hand-off to a
   chat has a time limit, a retry and a visible "stuck" state; the board never waits for ever.
3. **Know, don't guess.** The board acts only on facts it is told directly. When it does not know, it shows "unknown"
   and does not act as if it knew.
4. **One place per fact.** Each fact (a step's state, a chat's state, who owns what, a rule) lives in one place;
   everything else reads it there.
5. **Same situation, same outcome.** A decision never depends on lucky timing; two things at once cannot trip over each
   other (one at a time, or safe to repeat).
6. **Done means it works live.** Passing tests is not enough. A board step names the incidents that would show it
   failing (the supervisor's rules or sweep); it is done when none of them opens or comes back for 4 hours after the
   change is live, and a fix when its incident stays fixed for 4 hours. Until the board checks this by itself, the
   result check looks at the incidents of its kind 4 hours after the merge.
7. **Cost by design.** A feature uses no chat where code can do it, and wakes a chat only when there is work for it.
   Which model a chat runs on is not each feature's choice: the model rules (the work tool's `model` field, the
   settings' `models`, and never Fable without the person's yes) hold for all.
8. **When in doubt, hold and say so once.** Never act silently, never loop.
9. **Simple over clever.** Fewer moving parts; remove before adding.

## The person's side (2026-11-09)

The person: "see if we have principles e.g. always reactive, not too much text, visually distinctive for importants, use
code more than chats ... i submit things but i see not enough loaders. or it tries to react directly to the CHAT instead of
code just submitting an item in a queue and then waiting for the chat to pick it up".

10. **Always reactive.** Every click answers at once. If a chat must act, a loader shows on the spot that names who has it
    and since when, and turns Done, Late or Stopped by itself. It never says "on it" or "thinking" when nobody is.
11. **Queue, don't call.** A click is stored by code at once, as an item or a line. A chat picks it up when its turn
    comes, and the page shows the stored state. A decision the person makes is written by code, never by a chat that
    "records" it.
12. **One status per thing.** One wait system for every click, with no second guess beside it that can disagree.
13. **Little text, honest words.** Short and plain: context, problem, what each button does. Say what the board did,
    never a chat that no longer does it. Pictures and links show exactly what is asked about.
14. **Colour only for what needs the person.** Amber, orange or red mark what waits for them; plain information stays
    calm.
15. **A decision anywhere updates the board at once.** What the person decides in any chat, the board's own or a side
    chat, is written on the board as their words. Every older open question and unstarted step on that goal is then
    held from them and goes back to its chat to re-ask, withdraw or say it still stands. The person never meets a
    question that their own later words have already answered. (The person, 2026-11-09: "when we redesign/discuss
    things, the signals ont he board aint updated with the new information and thats confusing"; built as part P6 of
    the wait-system plan.)

## A clean page (2026-11-11)

The person, on the Stability row: "this UI sucks. i didnt specifically ask for this weird line ... Lets make a new
principle rule for future changes that UI changes still need to provide a clean UI"; then "3. yes" to this text.

16. **A clean page.**
    (1) A change adds only what was asked for: no extra lines, charts or marks.
    (2) Everything on the page says what it is: no unlabelled lines, dots or mini-charts.
    (3) Short words, one line where possible; details go behind a "details" link.
    (4) Before a UI change goes live, its builder shows a picture of the result beside the page as it was, and the
    review checks that picture against this rule.
