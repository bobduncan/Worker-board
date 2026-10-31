# The board's job texts

Each file here is the job of one kind of chat the board works with (`partner.md`: the partner, the chat the setting
`advisor` names; `advisor.md` only points there). The board names the
file to the chat; what one project sets comes with it from the settings. `protocol.md` lists the words the board
and the chats share: what a chat writes for the board to read, and what the board types into a chat (B200).
`worker.md` is the job of a worker, for any project (B201); a project's own facts stand in its
`.claude/worker-briefing.md`, made after `examples/worker-briefing.md`. `main.md` is the job of the main chat (B202),
with the project's own facts in its `.claude/main-briefing.md`, made after `examples/main-briefing.md`.
`supervisor.md` is the job of the supervisor's chat (the list of chats' `"supervisor"`, spec 2026-10-24): a sweep reads
the board's health summary and files incidents, nothing else; the board names the file in its sweep word.

`product-owner.md` is the charter of the product owner's chat (the list of chats' `"owner"`, T9, 2026-10-31): every talk
with the person about goals and focus (brainstorms, goal changes), always first, nothing else; until the list names an
owner, the partner keeps those talks.

> **For any project (B191).** Every change to the worker board, these job texts included, works for any project. No game, chat, folder
> or PC names in the code, the page, the job texts (`roles/`) or the examples: names, paths and words come from the
> settings (`config.json`) or the project's own files. `test/anyProject.test.mjs` fails on a new tie; the ties known
> today are listed there, each with the part of `ANY-PROJECT-PLAN.md` that removes it, and that list only shrinks.
> The user, 2026-10-14: "first ensure that its clear to all future work that this is the constraint if i develop
> something the worker board."

A job text says what to do in general words. A project's own examples (a feature, a folder, a chat's title) belong
in that project's files, such as its game plan, and never here.
