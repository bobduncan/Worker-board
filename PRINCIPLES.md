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
