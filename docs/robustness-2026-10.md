# Robustness of the worker board: the ten weakest places (October 2026)

Step B389, 2026-10-19. The person asked for an "analysis for code refactor to make it more robust". This page reads
the board's code and tests and names the ten places most likely to break something, ranked by risk (how likely in
daily use × how much harm), each with its files, why it breaks, a proposed refactor and its size. Nothing in the code
was changed: a proposal becomes a step only after the person's look.

Line numbers refer to commit bb18837. Three readers worked in parallel (free text read as data; silent failures and
file safety; file size and tests), and a fourth checked every claim against the code; several scenarios were
reproduced with small in-memory probes.

## What today's fixes have in common

The four fixes of 2026-10-19 each patched one place where **free text was read as if it were data**:

- B362: an ask's id named inside a For you sentence filed the same ask again.
- B363: the report check read file paths out of a result sentence.
- B378: a step's Touches were compared as words, not as paths.
- B381: a check's points were cut at a fixed length, and the fix step lost them.

Places 6, 8 and 10 below are the same pattern, still open. The general cure: **a fact that drives behaviour is
written as a field by one module and never read back from a sentence.**

## The size of it

| Part | Lines | Note |
| --- | --- | --- |
| public/board.js | 11,892 | one script for every page; ~510 functions, 176 listeners (139 of them click, input, change, submit or keydown), 56 regions a test can cut out |
| src/work/api.mjs | 2,184 | a table of actions, well covered (~6,300 lines of tests in test/work) |
| src/state.mjs | 1,602 | `buildState` alone is 583 lines, exercised by most state tests |
| server.mjs | 1,503 | `main()` is 1,123 lines (354–1477) of wiring, loops and wakes |
| Workers mod, register.tsx | 1,426 | tested through the plugin test kit (chatlist.test.ts, 83 tests), not in `npm test` |
| test/ | 191 files, ~27,400 lines | ~574 assertions match source text instead of behaviour |

## The ten, ranked by risk

### 1. The background loops and the check after a report fail without a trace

- **Where:** server.mjs:1417 (the look loop ends in `.catch(() => {})`), 1466-1470 (the reconciler in `catch {}`),
  1459 (the result of `approve-recaps` is not checked, and it runs before delivery), 671-682 (the check after a report
  is fired off and its errors swallowed), 344 (a request error answers 500 and logs nothing), 1196-1199 (a restart
  exits as soon as its answer is sent). src/work/check.mjs:68-69: any failure of `rev-parse origin/<base>`, a timeout
  too, counts as "no remote", so the check passes. In all, server.mjs has 15 such silent catches. A test starts the
  board as a process (twoBoards.test.mjs), so its start and its ports are exercised, but nothing tests the loops or
  the check after a report; ~28 regexes over the source stand in for them.
- **Why it breaks:** the person restarts the board seconds after a worker's report, while git still runs: the step
  stays in review on "check pending" for ever, because nothing reads "check pending" again. One odd item that makes
  `approve-recaps` throw stops every delivery and every hand-over on every tick, while the page looks healthy.
- **Refactor:** each loop records its last success, its last error and a count; the page shows "delivery failing
  since HH:MM" and the errors go to a log file. A restart stops taking work and waits up to 10 s for the queue and the
  checks. The reconciler runs the check again for a step on "check pending" for more than 2 minutes. "No remote" is
  told apart with `git remote`. Then the wiring moves out of `main()` into small modules (one `sayAndWake` instead of
  six copies of say + wake + reset) with behaviour tests on a memory store and a fake clock.
- **Size:** **4 h** for the loops and the check; **12–16 h** to take `main()` apart.

### 2. A torn data file stops the board from starting; writes are not atomic

- **Where:** server.mjs:720-723 reads finished.json, rounds.json, refine-gate.json and task-times.json with
  `.then(text => JSON.parse(text), () => null)`: the `() => null` catches a missing file but not a parse error, so a
  torn file makes `main()` fail, and the keeper ends with it (keeper.mjs:26). These files are written directly, without
  a temp file: task-times.json every minute (server.mjs:903-904), and 1342, 1364, 1385, 1397, cpu.mjs:42, alive.json
  (src/store.mjs:181-183). The outbox and history files are appended without first ending the last line.
  server.mjs:392: when launch.json cannot be read it counts as empty and its other entries are overwritten.
  goalsWrite.mjs:489-496: the daily copy of goals.md is written directly and its errors swallowed; a cut copy is never
  made again. `putInPlace` (src/work/store.mjs:32-49) renames without trying again on EPERM/EBUSY, and `removeItem`
  (302-311) deletes without trying again; src/ports.mjs `again()` already solves this but is not shared. Writes whose
  result is ignored: deliver.mjs:68, 147, api.mjs:1248, 1253, rename.mjs:48.
- **Why it breaks:** the minute write of task-times.json cut by a restart's `process.exit` or by a power cut leaves a
  file that does not parse: **the board does not start** until someone deletes it. A torn last line of the outbox
  swallows the next record, and a "taken" mark lost that way types a message twice. Now and then a Delete or an answer
  is refused with "could not be written: EPERM". The two tests known to fail now and then come from the same causes:
  "delete through the board" (stepEdit.test.mjs:63: the rename and the clean-up `rm` without retries; 233 of 235
  clean-ups lack them) and "two projects' boards" (twoBoards.test.mjs:255: a port from the range other sockets also
  use, and a restart on a port not yet released).
- **Refactor:** the start-up reads catch a parse error too, keep the bad file as `.broken-<time>` and say so on the
  page; one `writeAtomic(file, text)` (a temp file, fsync, rename, five tries on EPERM, EBUSY and EACCES) used by every
  write, `putInPlace` included; one `appendLine` that ends the last line first; every write's `ok` checked; tests get a
  `tempDir(t)` helper with retries, and the two-board test fixed ports and waits for their release.
- **Size:** **1 h** for the start-up reads, **3 h** for the writes, **1.5 h** for the ignored results, **2–3 h** for
  the two flaky tests.

### 3. The page redraws only when a hand-written key changes, and clicks work only where they were bound

- **Where:** public/board.js:72 (`once(key, data, draw)`): each part redraws only when its hand-listed data changes
  (`needsData` 3313, `focusData` 8270). Click handlers are bound to one box each (`takeBackClick` on #needs and #details
  only, 3204-3205).
- **Why it breaks (three live bugs today):** (a) the "With your partner" toggle flips `withPartnerOpen` (3198), which
  `needsData` does not list, so nothing changes until the minute in the key does (up to 60 s). (b) `focusData` leaves
  out `state.partnerAnswers` and its sending and problem, which the Partner answers switch reads (8744): a refused
  change never shows, and the box shows the click instead of what the store holds. (c) With "Bother me: once a day",
  an answered question gathered under the daily note (drawn at 8617) shows its Undo, but no handler for
  `data-take-back` is bound on the Focus page: the button does nothing. The tests pass because they only check that
  the code text exists.
- **Refactor:** per page a pure `view(state, ui)` that returns plain data, and `once` keyed on that view's JSON, so the
  key is always what is drawn; one click handler on the document with a `data-act` → handler table, so markup works
  wherever it is drawn. Later, `public/pages/*.js` modules (the page's rules already allow scripts from the board; the
  board's list of files it serves must grow).
- **Size:** first slice **3 h** (fix a–c, key Needs and Focus on their views); the whole page about **30 h**, done page
  by page.

### 4. A slow or cut answer reads as "not recorded", and the call is recorded twice

- **Where:** the Workers mod, register.tsx:375-424 (`withinTime`, 1.5 s), 497 (the `fileForm` fall-back), 1098. On the
  board every work call reads the whole store 3–4 times (server.mjs:584, api.mjs:162, 183; ~150 ms each with over 900
  items) and waits behind the reconciler's moves.
- **Why it breaks:** a question asked with the app's form gets no answer within 1.5 s, but the board files it under the
  step; the mod files it again without the step, and the first ask stays open for ever (the mod only closes ids it got
  back). A board restart that cuts a `work report` or `work new` after it was written: the tool says nothing was
  recorded, the chat tries again, and a second report or a duplicate step follows.
- **Refactor:** the mod sends a request id; the board keeps each answer by id (in memory and a small file) and gives
  the same answer to a repeat. On a time-out the mod asks again with the same id and says "not known whether
  recorded" instead of falling back. The store is read once per call.
- **Size:** **5 h**. **Tests:** chatlist.test.ts:1358 covers a board that hangs completely, not "slow, then done".
- **Done (B412, 2026-10-19):** the mod sends `X-Work-Request` with every work call; the board keeps the answer of a
  change by session and id (src/work/requests.mjs, data/work-requests.json, a day, 300 at most) and answers a repeat
  with it before anything else; the work tool asks a cut answer again with the same id and else says "not known whether
  it was recorded"; a form's ask is never filed a second time after a late answer, and is closed when that answer comes;
  workCtx no longer reads the store (the overlaps come from the call's own reading). Tests: test/workRequests.test.mjs,
  the B412 tests in chatlist.test.ts. Still open: the store is read once more after a change, for the view.

### 5. About 574 tests check the source text, not what it does

- **Where:** the test files that read the page or the server: ~355 assertions over board.js, ~107 over board.css, ~76
  over index.html, ~28 over server.mjs. Examples: `assert.match(script, /off: 'Not running'/)`; a regex that
  `drawDesign()` is the last line of `draw`; a 300-character regex of the `fill()` call in `drawNeeds`. Tests also copy
  the page's constants (`MIN` 89 times, `STATES`) instead of using them.
- **Why it breaks:** a reworded line fails ten tests while the behaviour is right, and a wrong behaviour passes while
  the words are there: place 3's three bugs passed this way. Of the 268 one-line checks over board.js, 121 claim a
  behaviour directly (42 request bodies, 31 handlers and data attributes, 8 redraw keys, 40 how parts are put together).
- **Refactor:** a small DOM test harness: index.html and board.js loaded in linkedom or happy-dom (the project's first
  dependency; the working agreement allows popular npm packages) with a fake `fetch`; a test clicks and checks the
  request body and the page. Most of the rest become pure view tests after place 3. Rewritten file by file when a file
  is touched anyway.
- **Size:** the harness **4–6 h**, then about 1 h per test file. First slice: the harness, and the Partner answers
  page's 15 regexes as DOM tests (they would fail today on place 3's bugs).

### 6. Three different readers of the For you block

- **Where:** the mod's mods/folder-branches/hooks/foryou.ts:30-31 (lenient title and item); src/handover.mjs:91, 98
  (`asksAtEnd`, lenient) and 19, 140 (`parseHandover`, strict `**Answer:**` only); state.mjs:556-566 (`blockAsksOpen`
  on the strict reader); src/work/askWords.mjs:12 (`sameAsk` matches on a shared start; no test imports this module).
- **Why it breaks (reproduced):** an item written `**Answer**:` (colon outside the bold) is a question to
  `asksAtEnd` but no item to `parseHandover`: the board warns "wrote questions but filed no ask" although the ask is
  open. An open ask "Look at the menu" makes a new item "Look at the menu on a phone and check its spacing?" count as
  the same ask: it is neither filed nor warned about.
- **Refactor:** one pure grammar module for the block; the mod sends the block's raw text with the turn's end and the
  board parses it once; `sameAsk` compares equal keys, or a prefix only when the lengths are close (about 20%).
- **Size:** **3 h**. **Tests:** warningsSeeAsks.test.mjs:40-47 uses only the strict form.

### 7. The work store reads every read error as "not there"

- **Where:** src/work/store.mjs:25 (`readOr` falls back on any error); 66-68 (an item file that cannot be read is
  left out); 95-96 (an unreadable flow.json falls back to the default flow); 106 (an unreadable pause.json reads as
  "not paused"); 259-261, 277-279 (an unreadable delivered.json reads as empty, and deliver.mjs:55-58 sends the lines
  again). server.mjs:514, 585, 632, 641, 886, 1153 read an unreadable store as an empty one
  (`.catch(() => ({ items: new Map() }))`); at 585 that empty store feeds the check of overlapping Touches. It breaks
  the store's own rule (B301) that there is no fall-back.
- **Why it breaks:** a virus scanner holds pause.json for a moment during Pause all: the reconciler sends "work: B286
  is yours" to a chat the person paused. With flow.json held instead, the board makes moves the person's flow forbids.
- **Refactor:** `readOr` falls back only when the file is not there (ENOENT); other errors are tried again three
  times 50 ms apart, then become a problem, and the reconciler skips its moves and deliveries that tick; the server's
  reads of the store say "the store cannot be read" instead of an empty store.
- **Size:** **2 h**. **Tests:** only an unreadable folder is tested (test/work/store.test.mjs:41).

### 8. A line starting `## ` splits an ask, a note or an instruction, and History prose is read as state

- **Where:** src/work/item.mjs:84-93 (`serializeItem` writes lines as they are; a line starting `## ` opens a section,
  item.mjs:34); src/work/api.mjs:76-81 (`lines()` escapes nothing). Free text enters raw at notes (api.mjs:641,
  920-924), instructions (1633-1640), ask texts (552, 585) and answers (617, 770, 994, 1949). A step's own file is
  safe today only because every writer indents its lines or starts them with `- ` (`underStep` 341-349, `make` 1400,
  `refine` 1792-1800, `howBlock` 1759, `refined` 1891). Meanwhile History lines decide what happens:
  resultCheck.mjs:45-73 (the done gate, through guards.mjs:48-49), goalGuard.mjs:18, 33, recap.mjs:52, 59,
  reconcile.mjs:170-171, state.mjs:830, api.mjs:1552.
- **Why it breaks:** a worker's note with a `## What changed` part shows Main only the part above it (`readNotes`,
  api.mjs:273); an answer with a `## History` line merges into that ask's History (reproduced; the only trace is the
  problem "History stands twice"). The next writer that forgets to indent lets free text rewrite a step's History,
  which the done gate reads. The readers also disagree: reconcile.mjs:170 matches anywhere in the line, `gitCheckPassed` only
  the first words.
- **Refactor:** quick: `serializeItem` escapes a line matching `## ` inside a section and `parseItem` unescapes it
  (**1 h**). Real: the facts that drive the flow become head fields written by one module (`Check: failed · <time> ·
  <why>`, `Result check: failed · fix B412`, `Reported: <time>`, `Queue asked by: Main`); History becomes display only
  (**6 h**).
- **Tests:** test/work/item.test.mjs has no case of `## ` inside text.

### 9. The board and the Workers mod agree only by hand

- **Where:** mods/folder-branches/hooks/board.ts:68-85 (`WORK_ACTIONS`, `WORK_FIELDS`) and the tool's description and
  schema (register.tsx:895-962) copy src/work/api.mjs:35-46; register.tsx:1311 drops a field it does not know without
  a word. The mod's tests (chatlist.test.ts drives register.tsx) run only in the plugin test kit, never in `npm test`,
  and no test compares the two sides.
- **Why it breaks:** every new field touches three places (Focus, B354, B356, fix-first and Pause 2 each did); the mod
  already forwards `stepMinutes`, which the board never reads. A chat that runs an older mod strips a new field without
  error (for example `priority`, so a fix is not queued first), and a new mod reaches a chat only when its process
  starts anew.
- **Refactor:** one table of actions (fields, roles, wording) in `src/work/actions.mjs`; api.mjs derives its sets from
  it, and a test in test/ makes the mod's lists equal to it. The mod forwards every field but a short deny list, and
  the board refuses an unknown field with "your Workers mod is older than the board; restart this chat". The take and
  pause decisions move into pure, tested functions in board.ts.
- **Size:** **4 h**; first slice the contract test, **1 h**.

### 10. Goal-map verdicts and the rebuild ask are found by their words

- **Where:** src/goals.mjs:41-48 (`recheckOf`: a verdict that is not exactly `passed`, `failed` or `waits for you`
  counts as `failed`); goalGuard.mjs:40-41, 64-65 (the rebuild ask is the open ask whose title begins `Rebuild G<n>`);
  api.mjs:1213-1228 (` · ` replaced, the gap cut at 400 characters).
- **Why it breaks:** a hand-edited "Rechecked (…): Passed · 3 of 3 …" reads as failed (the board itself writes a fixed
  lower-case verdict, api.mjs:1227, focus.mjs:464); each failed check counts as an attempt for the goal guard, and the
  third switches the partner to high effort and asks for an evaluation. More likely: a rebuild ask titled "Approve a
  rebuild of G12?" leaves the Focus page on "evaluating" while the ask waits.
- **Refactor:** the verdict as its own token (`Rechecked (<at>, <by>, failed): …`), and an unknown verdict read as
  `unknown`, never `failed`; the rebuild ask gets a `Rebuild: G12` head field the API sets, not a title to match.
- **Size:** **2.5 h**. **Tests:** goalGuard.test.mjs:72-74 covers the title regex only.

## The three to do first

1. **Place 1, the silent loops and the stuck check (about 1.5 h for the first part):** log and show the loops'
   errors, and run a "check pending" again after 2 minutes. Today a stopped delivery or a stuck check is invisible,
   and everything else on this page is easier to find once failures show.
2. **Place 2's start-up reads and minute writes (about 2 h):** a file torn by a restart or a power cut keeps the board
   from starting; reading a parse error as a kept `.broken` file and writing the minute files atomically closes it.
3. **Place 3's first slice (3 h):** three bugs the person can meet today, and the pattern (a redraw key that is the
   view itself, one click table) that stops the next ones. With place 5's harness after it, such bugs fail a test.

Together about 6.5 hours. Places 4, 7 and 8 come next: each is a few hours and protects against lost, doubled or
split work.

## Also seen, not ranked

- The Backlog tab is built by printing the store's items as backlog lines and parsing them back
  (src/work/adapter.mjs:71-72, line.mjs:57-80): a title "Fix the hover (for the phone)" reads back as "Fix the hover",
  with "the phone" as its owner when none is set. api.mjs:1389-1392, `fixTitle` and `stepTitleOf` guard against it;
  building the tab from the items' head fields would let the guards go (6 h).
- A pasted prompt has no length limit in the mod (register.tsx:1098), while the board refuses a request over 16 KB
  (server.mjs:79, counted in bytes): a long prompt is dropped without a word. The turn's end items are limited to
  12,000 characters (foryou.ts:43).
- The page decides by matching sentences in two places: the server's (public/board.js:3746) and the Workers mod's
  compaction text (3988).
- The page's `fetch` calls have no time-out: a request that never answers keeps its button "sending".
- Three modules have no test that imports them: src/work/askWords.mjs (place 6's `sameAsk`), src/work/names.mjs and
  src/work/partnerAnswers.mjs.
- README.md does not name `advisorReadFirst`, `advisorSuggestions`, `morningRound` or `weeklyRound`.
- Sound as it is: work calls are serialized per store folder (api.mjs:119-124); each item write is a compare-and-swap
  through a temp file (src/work/store.mjs:31-50); new ids are claimed with `.claim` files; goals.md writes compare
  before writing and try three times.
