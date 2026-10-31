# Goals
Last id: G7

Rules: a goal is one line "- [ ] G<n> <title>" ([ ] open, [~] in progress, [x] done); its id never changes and is
never reused (a new goal takes the number after "Last id:" and raises it); two spaces of indentation per level is "part of"; the lines under a goal, one level deeper, are
"Done when:", "Why:", "Enables: G<n>", "Also part of: G<n>", "Steps: B<n>, B<n>" (the backlog's steps that serve it),
"Missing: <one line>", "Note:" and "From the game plan: <part>". The board's Goals part draws this file.
A goal changed with "Change this goal" also has "Objective: <one line>", "Done when <n>: <a bullet one can check> · steps B<n>, B<n>" (one per bullet; its old "Done when:" stays), "Not in it: <one line>", and "Your words: <date time> · <the person's words>" for each thing the person said about it.

- [~] G1 The product
  Done when: a stranger uses it without help
  - [~] G2 The first version works
    Done when: the main path works from start to end
    - [x] G3 The main path
      Steps: B1, B2
    - [ ] G4 The rough edges
      Steps: B3
      Missing: a check by someone who has not seen it
  - [ ] G5 The first version is polished
- [ ] G6 The tools around it
  Enables: G1
  - [ ] G7 A quick way to try a change
    Also part of: G2
