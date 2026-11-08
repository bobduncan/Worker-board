# Stop and rethink a topic (goalmap T13.2.1, "This isn't working")

## What the person gets (plain words)

- **Say it:** on the Focus page's talk bar, switch on "Stop and rethink" and pick the topic from a list of the goal's
  parts (each part names its open tasks and their workers). Then write your words and paste a picture if you like.
  Example: "all wrong, look at this, stop it and rethink".
- **At once:** the board stops the topic. The Product owner confirms in the talk what was stopped, for example "G60,
  side stairs: B1068 (Worker 5) stopped, rethink started".
- **Later, from 11-10 at the earliest:** the Product owner may also start a rethink from your words alone (option B).
  That needs a chat restart, so it waits for the end of chat 1's stability measure.
- **Work stops:**
  - every waiting task on that topic is held;
  - a worker in the middle of one stops at a safe point and hands it back;
  - nothing on that topic is handed out again until you have picked a new way.
- **The rethink:** the Advisor rethinks that topic with everything: your words now, your picture, every word you gave
  on it before, and every earlier try with its picture.
- **Your pick:** one question comes back, "Rebuild G60: side stairs", with two or three different ways, a picture each,
  and what each costs. New work starts only after your pick, and it carries all your words.
- **Not in it:**
  - a button on the topic (later, if you want one);
  - the Product owner doing the rethink itself;
  - a stronger model instead of another way.

## The person's words

- 2026-11-07, chat 2: "ill need a way to do what i just used you for. somehow im not able to tell the productowner,
  idk what you are building right now(via the workers) but its all work try refining the approach some more look at
  this, stop the current work regarding this topic". Before that, for the G60 side stairs, through chat 2: a lessons
  list of every earlier "no", the current question answered, and a reference picture handed to the worker.
- Where to say it: "1. A", the Product owner, in words with a picture. The design above: "1 yes".

## Decision 2026-11-07: A, a page action (this overrides sections 2 and 5 below where they differ)

The person: "1. A". Chat 1 asked for no mod change during its stability measure.
- **The page starts the rethink** as the person, from the Focus talk bar: the "Stop and rethink" switch, the topic
  picked from a list, words and pictures. There is no `work rethink` for chats yet, and no mod change.
- **Where it runs:** the server, as a goals command, `POST /api/goals {command: 'rethink', id: G<n>, part | of, text,
  pictures}`. It calls:
  1. a work action as the person, `rethink-hold`, which finds the topic and writes the holds and the words, and
     answers with the held steps and the workers to stop;
  2. for each worker to stop, the SAME function the Stop button goes through (`sayNow` with `command: 'stop'`,
     `sure: true`, to the main chat, B83/B769);
  3. the evaluation start, `startEvaluation`, with the person's words, pictures and the topic's earlier words;
  4. a talk word to the talk partner (the Product owner, else the partner): "rethink started by you: <topic>; held
     ...; stopped ...; your words ...". The talk partner confirms it in the talk in one line.
- **State:** `focus.rethinkTopics` lists the focus goal's parts with their open steps (id, title, state, owner), and
  each open fix chain of the goal under no part, named by its newest step.

## How it works (for the builders)

What it reuses:
- the fundamental evaluation and its "Rebuild G<n>" ask (roles/partner.md);
- the earlier words of a topic (`src/work/rowWords.mjs`, live since ba79811);
- the "next try of" link (`work new` with `of`);
- the board's stop-a-task word (B83, `src/say.mjs` `stopWords`);
- the Goals ask box's picture paste.

### 1. Pictures in the talk bar (`public/board.js`, `server.mjs`)
- The Focus page's talk bar takes pasted and picked pictures, as the Goals ask box does (`pastedTalk`, `addAskPicture`,
  the same upload route and picture folder).
- The `talk` command carries `pictures` (paths in the project). The talk word typed to the Product owner names them,
  one per line.

### 2. A new work action: `rethink` (`src/work/api.mjs`)
**Who may call it:** the Product owner (`owner`), and the partner (`advisor`) while no Product owner is listed.

**Fields** (all already in the mod's WORK_FIELDS):
- `goal` (G<n>);
- `of`: a step of the topic;
- `title`: the topic in a few words;
- `text`: the person's words, verbatim;
- `pictures`.

**What the board does:**
1. **Finds the topic.**
   - The topic is the how's part (`Part:` line) that holds `of`, or a step of `of`'s fix chain (`fixRootsOf` up,
     `fixesOf` down).
   - If no part holds them, the topic is that chain, named "the tries of B<root>".
   - The topic's steps are every step of that part or chain, plus the steps of a recap row that names one of them.
2. **Holds the topic's open steps:**
   - A step that is new, refined or queued gets `Waits for: the rethink of <goal> "<title>" (<minute>)`.
   - A step that is taken, in progress or waiting on you gets the same line, and the board sends the existing
     stop-a-task word for its worker, so the worker stops at a safe point and the step goes back. The line keeps the
     step from being handed out again.
   - Steps that are done or dropped stay as they are.
3. **Keeps the words** on every held step: the person's words become a point of its `## Your words`, with `where:
   "rethink, <minute>"` and the pictures. Use the same code as the `words` action.
4. **Starts the evaluation for that topic now:**
   - It writes `Evaluation asked: <minute>` and `Evaluation part: <title>` under the goal. This takes a new entry next to
     `focus.mjs` `fireGuard`, `startEvaluation(id, part, asked)`, which skips the guard's trip test but writes the
     same lines.
   - It sends the `evaluate G<n>` word to the partner as today (`evaluateWords`), with one more block on top:
     `Asked by the person (<minute>): "<words>"`, then `Pictures:`, then the topic's earlier words
     (`rowWordsText(rowWordsOf(...), { budget: 6000, chars: 400 })`).
5. **Answers the caller in one line,** naming the topic, the steps held, and the workers told to stop. The Product owner
   says that line in the talk.

**When it refuses (one plain line each):**
- no goal, or `of` is not a step: "Name the goal and a step of the topic";
- the topic has no open step: there is nothing to stop. The board still starts the evaluation and says so;
- an evaluation of that goal is already running: there is no second one. The person's words go to the partner as a
  note on the running evaluation ("More from the person: ..."), and the holds are still written.

### 3. The end (`src/focus.mjs` `endTrip`, roles/partner.md)
- The evaluation ends as today: the partner's marked how-draft, after the person's pick on the `Rebuild G<n>: <title>`
  ask (2 or 3 ways, a picture each).
- At that end, the board clears every `Waits for: the rethink of ...` line it wrote, and types the partner one line:
  "held for the rethink, now free: B..., drop or keep each". So nothing stays stuck.
- The partner drops the steps the new way replaces ("replaced by the rethink of ..."). It makes the new steps with `of`
  (the newest try of the topic), so they carry every earlier word.

### 4. Roles
- `roles/product-owner.md`, a new section "## Stop and rethink":
  - When the person says a topic is wrong, asks to stop it, or asks for a rethink, call `work rethink` at once, with
    their words verbatim and their pictures.
  - Ask which topic only when unsure: one question, the candidates named.
  - Say in the talk what the board answered.
  - Never argue the topic and never defend the work.
- `roles/partner.md`, "The fundamental evaluation":
  - An evaluation the person asked for (`Asked by the person`) runs the same way.
  - Their words and pictures are the first input. Every way you bring them is compared with their picture, and says
    which of their earlier words it meets.

### 5. The mod (`mods/workers`)
- Add `rethink` to the work tool's action list and its description. No new fields are needed. Bump the version. The
  person's word is needed (it is asked in chat 2). Then `npm run setup`.
- Chats get the mod at their next start. The board asks the Product owner's chat to restart, as for any mod change.

### 6. Stability area (chat 1's conditions, 2026-11-07)
1. **One stop path.** Stopping a worker goes through the SAME server function the person's Stop button uses (B83).
   There is no second copy of the stop logic.
   - A live hand-over test: a rethink on a topic with a step in progress → the worker stops at a safe point → the
     step is given back.
   - It is NOT handed out again while `Waits for: the rethink of ...` stands.
   - After `endTrip` it is handed out normally.
2. **A person hold.** `Waits for: the rethink of` counts as a hold the person asked for in every Supervisor rule that
   reads holds: review-held, open-fix, stale-checkpoint and ready-while-free. A held step is not ready. Pin this in a
   test.
3. **The mod.** No mod change during the 3-day stability measure (from 11-07; 11-10 at the earliest). Chat 1 prefers a
   page action, where the talk bar posts the rethink as the person; the person's choice is open, see section 2.

## Tests
- **`rethink` finds the topic** by a part, by a fix chain, and through a recap row.
- **The holds:** new, refined and queued steps get the Waits for line; a step in progress gets the line and a
  stop-task word to its worker; done and dropped steps are untouched.
- **Words and evaluation:** the person's words land on every held step; the evaluation lines are written under the
  goal; the evaluate word holds the words, the pictures and the earlier words.
- **Refusals:** a missing goal or step; an evaluation already running (the words go as a note, the holds are still
  written).
- **The end:** when the evaluation ends, the board clears the rethink holds and types the partner the line.
- **The talk bar:** a pasted picture reaches the talk command and the word to the Product owner (a page test).
- **A dry run on the live store:** `rethink` for G60 with `of: B1068` names the side-stairs topic, would hold B1068
  (a stop word to Worker 5) and nothing else, and builds the evaluate word with the person's 10:55 and 11:18 words
  and the reference picture. Read-only.

## Size
About 6 hours, in two steps:
1. The `rethink` action, the holds, the evaluation start and end, the roles, and tests.
2. The talk bar pictures and the mod's action.

It lands one step at a time, each on chat 1's go.
