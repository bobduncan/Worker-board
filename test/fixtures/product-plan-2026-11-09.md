# Lava Tactics: the product plan

Pitch: Push enemies into lava. Win a fight, grow stronger, until your party falls.

The answers every goal and step falls back to, shown on the worker board's Vision tab (the partner's job, "The plan
interview"). Each answer is **decided** (your word, or a document you approved), **assumed** (the partner's default,
with when to ask you again) or **open**. A goal names the answers it serves (`Serves: P2, P3` in the goal map); a chat
that is unsure walks up from its step to its goal, to the answer here, to [the vision](game-vision.md), and logs where
it found the answer. There is no P4 (dropped on 2026-10-19: the game is built to last either way).

## P1 · What it is

- State: decided (you, 2026-10-19; confirmed on the board 23:53) · the player: assumed, revisit after M1 is played
- Picture: art-inbox/vision/vision-what-it-is.png · a tactics roguelite: a small map, a short fight, upgrades waiting
- Answer: a turn-based tactics roguelite on lava, for the desktop browser; a hobby game.
- Point: **Tactics roguelite:** short, puzzle-like fights on small maps
- Point: **Like Into the Breach,** but a run of fights with random upgrades instead of a campaign
- Point: **For:** you first; at version 1, someone else who plays it without help
- Advice: solid; nothing left to ask. Ask again after M1 is played, about the player.
- Settled: (you, 2026-10-21)

## P2 · Why it is good

- State: decided (you, 2026-10-19; as bullets 23:52)
- Picture: art-inbox/vision/vision-why-it-is-good.png · thinking pays: a push, a combination, a tile that matters
- Point: **Thinking is rewarded,** and so are strategy and combining upgrades
- Point: **A challenge can be beaten without a plan for it, but with difficulty;** fun interactions, combinations and a good strategy make it significantly easier
- Point: **Knockback is one tool among the abilities, upgrades and hazards,** no longer the main one (your words of 16:41)
- Point: **Good visuals and special effects are part of why it is good:** every hit, push, death and ability shows and sounds like it matters (your words of 22:28)
- Point: **Small maps where every tile matters,** with hazards that change the fight
- Point: **A run of battles with random upgrades instead of a campaign:** the difference from Into the Breach
- Advice: solid since your rewrite; the first four points carry it, the rest is detail.
- Settled: (you, 2026-10-21)

## P3 · Look and sound

- State: decided (you, 2026-10-19: the look's four questions P3.1 to P3.4 answered on the board; the sound from the definitions of done, 2026-10-11 to 2026-10-18)
- Picture: art-inbox/vision/look-target.png · the look we aim for
- Picture: art-inbox/vision/look-today.png · a fight today
- Picture: art-inbox/vision/units-lineup.png · the units
- Point: **The camera stays straight on:** a three-quarter tilt from above, the grid upright; every sprite and map is drawn for it (P3.1 A, 2026-10-19)
- Point: **One palette per world:** World 1 warm lava and dark stone as today, World 2 ash and embers, a later world obsidian; the ground and the lava redrawn per world (P3.2 B)
- Point: **Menus and panels in stone and gold,** as today: dark stone panels with carved edges and thin gold trim, polished but not restyled (P3.3 A)
- Point: **Effects subtle:** a thin bolt, a small burst of sparks, a short flash; nothing ever covers the units or the ground; good visuals within that (P3.4 A, against the partner's advice of bold stylised effects)
- Point: **4x pixel art:** warm lava and glowing cracks against dark stone
- Point: **Every unit at the same size and style** as the line-up, art scored against its reference
- Point: **Short, punchy, stylised sounds;** no voices, no long cinematic booms
- Point: **Music from Suno,** named by its style
- Advice: settled: your four deeper answers decided the look. Ask again when World 2's palette is drawn.
- Settled: (you, 2026-10-19)

## P5 · How people get it

- State: decided (you, 2026-10-19; Q228; as bullets 23:53) · revisit after someone else has played version 1
- Picture: art-inbox/vision/vision-how-people-get-it.png · a link for friends in a desktop browser now, a shop page later
- Point: **Until version 1 has been played by others, a link for friends:** the built game on a free static host (GitHub Pages or itch.io's browser player), free, sent by you
- Point: **It plays in a desktop browser**
- Point: **Then a Steam page:** paid, a one-time fee of about 100 dollars, a store page and a demo
- Point: **How people hear of it beyond friends** is decided with the Steam page
- Advice: solid; ask again after someone else has played version 1.
- Settled: (you, 2026-10-21)

## P6 · Built on

- State: decided (you, 2026-10-21; confirmed on the board 00:34; from architecture.md, 2026-10-11)
- Picture: art-inbox/vision/vision-built-on.png · everything is data, set onto the grid
- Point: **TypeScript, PixiJS and Vite,** in the browser
- Point: **Everything is data:** units, abilities, maps, upgrades, worlds
- Point: **Hard to change later:** cliffs reached only by stairs; enemies' behaviour as data; a hero as data
- Advice: solid; the three hard-to-change rules stand. Ask again before M3, when more heroes come.
- Settled: (you, 2026-10-21)

## P7 · The road

- State: decided (you, 2026-10-25, your words on the board)
- Picture: art-inbox/vision/vision-the-road.png · the foundation, every kind at its bar, everything there and fun, then the whole game and more
- Point: **M1 the technical foundation, ready to scale:** what is hard to change later comes first: the structure checked, maps from their paintings, one input layer, light as data, one screen frame
- Point: **M2 every aspect of World 1 at its bar:** one goal per standard (maps, feel, units and their animation, effects, light and atmosphere, screens, sound), each judged on its own
- Point: **M3 everything there, and it is fun:** no feature, setting or gameplay part missing; the difficulty is one small part of it
- Point: **M4 the game complete, more heroes and worlds:** more characters, World 2 and on, version 1 on GitHub and itch.io
- Advice: solid; your road of 2026-10-25. Ask again after M2, when every kind is at its bar.
- Overturned (2026-10-25): the game plan's three stages (the loop is fun; version 1, polished; growth)

## P8 · Good enough means

- State: decided (from game-plan.md, part 4, 2026-10-18)
- Picture: art-inbox/vision/vision-good-enough.png · a reference for every kind, scored and checked by someone else
- Point: **A definition of done and a reference** for every kind of thing, before it is built
- Point: **Art scores 75 or more** against its reference
- Point: **Checked by someone else** than who built it; a failed point makes its fix by itself
- Advice: thin: it says what is checked, not how well. The Standards step (4) fills it in, kind by kind.

## Features

Every feature the partner sees, from the vision, the game as it is and the game plan's milestones (2026-10-19). Must
is in the game by M3 and complete in M4; later is M4's content and on. Complex: it changes how the game is built underneath.

### F1 · Battles with knockback

- Mark: must (from game-vision.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/knockback.png · Shield Bash aimed: pushed into the lava
- Point: **Push** into lava, hazards, walls and each other

### F2 · A run map of nodes

- Mark: must (from game-vision.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/run-map.png · World 1's map, a fork ahead
- Point: **Branching paths:** fights, a shop, a rest, the boss

### F3 · Pick 1 of 3 upgrades

- Mark: must (from game-vision.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/upgrades.png · the pick after a fight
- Point: **After every won fight,** two after a fight with elites

### F4 · Heroes grow through a run

- Mark: must (from game-plan.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/abilities-grow.png · the Knight's bar: 2 abilities, then 4
- Point: **Two abilities at the start,** the rest unlocked or learned

### F5 · New enemies, one trouble each

- Mark: must (from game-plan.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/new-enemies.png · the Bats, the Ballista and the Brute
- Point: **Bats, the Ballista and the Brute** beside the first four

### F6 · Elites and a boss

- Mark: must (from game-plan.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/boss.png · the Lava Golem and crowned elites
- Point: **The Lava Golem** on 2x2 tiles; elites hit harder

### F7 · Ground that changes in a fight

- Mark: must (from game-plan.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/rock-slow-ground.png · Stone Wall's rock, Slow Ground's tiles
- Point: **Rocks and slow ground** for some turns

### F8 · A shop that sells

- Mark: must (from game-plan.md)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/shop.png · the shop
- Point: **Gold buys** potions, armour and charms

### F9 · A tutorial run

- Mark: must (from goals.md: G27 under M2)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/tutorial-fight.png · the tutorial's first fight, a tip showing
- Point: **One new thing at each stop,** ending with a small boss

### F10 · Undo within your turn

- Mark: must (you, 2026-10-19)
- Milestone: M3 (partner, 2026-10-25)
- Complex: no
- Built: yes
- Picture: art-inbox/vision/features/undo.png · Undo and Undo turn after a step
- Point: **Undo and Undo turn** until the enemies move

### F11 · Enemies show their next move

- Mark: unsure (from game-plan.md, an experiment, 2026-10-17)
- Complex: yes · enemies must decide before your turn, so their behaviour becomes data the turn can show
- Prepare: now · enemies plan at the end of their turn and act from that plan next turn (a planned tile, not a unit followed), shown nowhere yet; part of the refactor G33, beside behaviour as data (B366) · now: about a day, in the enemy AI and the turn (ai.ts, turn.ts) and their five test files; the showing behind a setting, on or off, adds about 1 h once the showing is built, since the enemies plan and act the same either way (a setting that switched them back to deciding on their own turn would be two games to test and balance, about a day more) · later: every enemy, the boss and the elites built by then, the bot's runs and the balance, all again
- Tradeoff: prepare (you, 2026-10-21)
- Built: partly · reshaped 2026-10-24 (I85): an enemy's skill waits a turn and lands on the tiles it marked (B502), on in the game since B510 (`?delayed=off` lands it at once); those marked tiles are what an enemy shows of its next move, so the enemy-intent step (B07) is dropped; the plan per enemy above (B477) was replaced by it
- Picture: art-inbox/vision/features/enemy-card.png · not built: the Ballista's card says when it shoots
- Point: **Into the Breach's core:** every enemy shows what it will do before your turn
- Point: **Behind a setting, on or off** (your words, 2026-10-21: "it will be great if its a setting you can turn on/off ... it will give me great flexibility"), as S5 plans for your experiments

### F12 · The reference look on every map

- Mark: must (from game-plan.md)
- Milestone: M2 (partner, 2026-10-25)
- Complex: no
- Built: partly
- Picture: art-inbox/vision/features/look-vs-target.png · today beside the look we aim for
- Point: **Every map** scores 75 or more against it

### F13 · Menus and a run summary, finished

- Mark: must (from game-plan.md)
- Milestone: M2 (partner, 2026-10-25)
- Complex: no
- Built: partly
- Picture: art-inbox/vision/features/menus.png · start screen, settings, run summaries
- Point: **Start screen, run summary, settings** polished

### F14 · Gems and chests to spend

- Mark: later (from game-plan.md)
- Milestone: M4 (partner, 2026-10-25)
- Complex: no
- Built: partly
- Picture: art-inbox/vision/features/gems-chests.png · gems and chests counted on the map
- Point: **Counted today,** they buy nothing yet

### F15 · World 2 and on

- Mark: later (from game-plan.md)
- Milestone: M4 (partner, 2026-10-25)
- Complex: no
- Built: partly
- Picture: art-inbox/vision/features/world-2-map.png · World 2's map, in World 1's art for now
- Point: **A world is one data entry;** World 2 has a name already

### F16 · More heroes to pick

- Mark: must (partner, 2026-10-21; from your characters brainstorm of 2026-10-20: the Wizard in M1 as G39; the four new heroes after the architecture check as G40)
- Milestone: M3 (you, 2026-10-25)
- Complex: yes · a party of any heroes changes every map's start tiles, the bot and the upgrade offers (B457)
- Built: partly · since B455 a run starts with the Knight alone and the Wizard joins on a hero card
- Picture: art-inbox/vision/features/hero-card.png · the Wizard's hero card today
- Point: **Beyond the Knight and the Wizard:** the Ranger, the Rogue, the Priest and the Necromancer come as hero cards, a party of up to three

### F17 · Unlocks between runs

- Mark: unsure (from game-vision.md: "unlocks later, if the loop is fun", 2026-10-10)
- Complex: yes · what a run starts with is read from a save kept across runs
- Prepare: wait · the run save already has versions with one migration each (B403), so a save of unlocks beside it is one more file and one migration, about the same work later as now
- Tradeoff: wait (you, 2026-10-21)
- Built: no
- Picture: art-inbox/vision/features/run-over.png · not built: a lost run keeps nothing
- Point: **Something kept** after the party falls

### F18 · Generated maps

- Mark: no (from game-vision.md: "generated maps later, if ever", 2026-10-10)
- Complex: yes · every map's rules, the bot and the art would have to work on maps nobody drew
- Built: no
- Picture: art-inbox/vision/features/hand-made-maps.png · not built: World 1's six hand-made maps
- Point: **Hand-made maps** in a pool instead

## Goals preset

The partner's proposal: your road of 2026-10-25 in four stages, each goal mapped to the goal of your goal map it already
is. M1 builds what is hard to change later; M2 brings every kind of thing in World 1 to its bar, one goal per standard,
each judged on its own; M3 has every feature and setting in and the run fun; M4 completes the game and adds heroes and
worlds. Before many things of one kind are built, a goal How we build good <kind> proves the kind's aspects one by one,
then one thing of the kind is put together from them (your rule of 2026-10-25). A goal merged into another, or moved
under it, stands inside it below.

Strategy: Foundation first, then Quality first (you, 2026-10-25) · your words: foundation first, and polish/standards first: what is hard to change later is built first, then every kind of thing is brought to its bar, and only then comes more content

Checked: (2026-10-25) How we build a good one first, for every kind: S33 How we build good maps in M1 before S24, G59 and its steps inside it, B607 the combination last; S34 units and S36 effects ahead of their bars in M2, S35 skills ahead of the heroes' abilities in M3 (your yes); S37 light, S38 screens and S39 sound ahead of S26, S27 and S22 (your yes, 17:20); S24, S29 and S16 pick no way or bar before the aspects are proven; M1 eight confirmed goals, M2 ten, M3 eight: the rule's one goal per kind over the usual six, as M2's seven by your word, the fix for six being each How-we-build goal as its bar goal's first sub-goal, not the rule's form; every other goal and every step kept

### M1 · The technical foundation, ready to scale

- Change: new
- Cause: your road of 2026-10-25: the technical foundation and scalability is a stage of its own, before quality and content (your strategy: foundation first)
- Steps: B494 and B495 (two safety-net follow-ups of the architecture check) move here from Version 1, polished (G9)
- Done when: the structure is checked (G33) and the four foundations stand, so K1, K2, K5 and K6 say "Foundation built: yes": a map is built from its painting, every screen reads its keys, hover and camera from one layer, a world's light is data, every painted screen stands on one frame; by the standards' per-item times a new map then costs about 2 h, a new screen about 3 h and a world's light about 1 h
- Goal: G94

#### S7 · Architecture check before the polish

- State: agreed (you, 2026-10-19; in the goal map); done (ticked by you, 2026-10-25 12:48)
- Change: move G33 from Version 1, polished (G9) to M1
- Cause: your road: the structure is checked in the foundation stage; done today, it stays here by its goal state; the preparation you chose for the enemies' next move (F11: the waiting skills, B502, B510) was built inside it
- Steps: all stay with it (every one done)
- Done when: the tech lead checked the structure against the later features (more heroes, unlocks) and named what to prepare now
- Serves: P6
- Picture: art-inbox/vision/vision-built-on.png · everything is data, set onto the grid
- Goal: G33

#### S33 · How we build good maps

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your words (2026-10-25): "we have 1 goal first, to evaluate how can we build good maps", the Terraces "just an example of this", the map's aspects split up (lava, height levels, stairs or bridges, props, cliffs, a circle made of cells, what makes a good level design) and "each of these little aspects can be proven individually before trying to combine them as 1 task"; S32 was too specific as a goal of its own; your two making guidelines: a cell is all stone or all lava, never half; three floors at most to start, the code without a limit, able to scale to ten and more
- Why: no goal proved how a map is made before S24 built every map one way; your rule How we build a good one, first
- Steps: its how agreed (2026-10-25 16:40): B615 lets each test map stand alone, then one step per aspect, each proven alone beside its target: B616 lava, B617 cliffs and edges, B618 round shapes, B619 three floors, B620 stairs and bridges, B621 props, B622 ground that changes, B623 what makes a good fight map; G59's steps go on inside it as the way to build one (B602, B603, B605, B609, B610 and their fixes); B607 (the Terraces put together) is the last step, after the aspects
- Done when: every map aspect (lava; floors; stairs and bridges; cliffs and edges; round shapes on square cells; props: fixed, tall ones in front of units, breakable ones; ground that changes in a fight; level design; the way to build one) is proven on its own, in the game or its tool chain, beside its target picture, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in the level definition of done (docs/process/done/level.md; among them: a cell all stone or all lava, never half; at most three floors in a map while the code has no maximum) and its bar line in K1; then the Terraces, put together from the proven aspects (B607), stand beside their painting at play size and meet K1, scored 75+ by three judges, checked by someone who built none of it; S24 builds every map the way this goal proved
- Serves: P2, P3, P6
- Picture: art-inbox/vision/standards/maps-painting-b-terraces.png · the Terraces' painting: the target the aspects are proven beside and put together into
- Sub: Lava, cliffs and round shapes on square cells
- Sub: Floors, stairs and bridges up to three heights
- Sub: Props and ground that changes in a fight
- Sub: The Terraces as a painted map, a proof (G59)
- Goal: G60

#### S32 · The Terraces as a painted map, a proof

- State: agreed (you, 2026-10-25; in the goal map)
- Change: move G59 under S33
- Cause: your word (2026-10-25): too specific as a goal of its own; the Terraces are one example of how we build good maps: the way to build one, proven on them, its running steps going on; why a painting is tried first stands in the goal map's Why (maps turned into tiles never look like their paintings)
- Steps: B602, B603, B605, B608, B609, B610 and B611 stay with it and go on; B607 stays its last step, the Terraces put together from the proven aspects, after S33's other aspects are proven
- Done when: the Terraces play in the game on their own arena link, nothing in World 1 changed, as one Codex painting repainted to the game's grid and view; the painting lies under the units with the game's moving lava around it; walkable tiles and stairs are traced from the painting, tall props cut out so units stand behind them; a screenshot beside the concept painting and a play link are shown to you; you say whether painted maps are the way for S24, and if not, what failed
- Serves: P3, P6
- Picture: art-inbox/vision/standards/maps-painting-b-terraces.png · the Terraces' painting, the concept the proof is painted from
- Goal: G59

#### S24 · Maps built from their reference painting

- State: agreed (you, 2026-11-09; in the goal map 2026-11-09)
- Change: move G42 from under G41 to M1, a goal of its own; rename The foundation: from a reference picture to the game's tiles; its Done when and first sub-goal rewritten: no way of building named
- Cause: your road: the map foundation is M1's, not a sub-goal of the map bar; a title that names what exists when it is done; your map round (2026-10-25): today's maps miss the painting's rocks, crates and torches, and their edges and cliffs are not right; the other World 1 maps look far worse (your word, 2026-10-25): blocky, bare, smeared cliffs, stairs pasted on; your rule How we build a good one, first (2026-10-25): no way of building is chosen before S33's aspects are proven, so it waits for S33 and builds by the way S33 proves
- Steps: none yet; it waits for How we build good maps (S33): its how (pieces cut from the reference, 6 parts, about 13.5 h) is laid anew from S33's verdicts and the way it proved; its vibe is agreed
- Done when: a map is built from its painting by the way S33 proved, and the same way builds every World 1 map; it keeps the painting's shape and size, its outline from the painting, never blocky rectangles or square-cut holes; the painting's rocks, crates and torches stand where the painting has them; edges and cliffs are drawn as a natural ledge (your pick, Q373): a smooth, slightly worn outline, a lip of lighter worn stone on top, tall cliffs of dark layered rock below, never smeared, and stairs and bridges drawn into the ground, not pasted on; the zoom and the ground's detail stay as today; the Terraces, rebuilt through it, stand beside their painting at play size and you say it looks like it; K1 says "Foundation built: yes"
- Serves: P3, P6
- Picture: art-inbox/vision/standards/maps-painting-b-terraces.png · the Terraces' painting, the first map built from one
- Sub: The way S33 proved, built as the foundation
- Sub: The Terraces rebuilt through it, beside their painting, at play size
- Goal: G42

#### S25 · One input and camera layer for every screen

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G45 from under G43 to M1, a goal of its own; move G44 under G45; rename The foundation: one input and camera layer every screen shares
- Cause: your road: the input foundation is M1's; the playthrough against the feel bar (G44) comes first and says what the layer must fix
- Steps: none yet
- Done when: a tester who built none of it scored today's game against every point of the feel bar (K2); then every screen reads its keys, hover and camera from one layer, and K2 says "Foundation built: yes"
- Serves: P3, P6
- Picture: art-inbox/vision/standards/feel-keys.png · a key for every action, shown on hover
- Sub: A playthrough against the feel bar, the gaps named (G44)
- Sub: Keys, hover and camera read from one layer on every screen
- Goal: G45

#### S37 · How we build good light

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your rule How we build a good one, first (2026-10-25), and your yes to its goal (17:20): light is built per world (World 1's set, World 2's, a later world's) and shows on every map, so its aspects are proven once, ahead of S26, which then uses what it found
- Why: K5's foundation (S26) would make a world's light data before anyone proved what the lava's glow, the braziers, the shadow, the embers and the bloom can be in the engine at 60 frames per second
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every light aspect (the lava's glow on what stands near it; braziers and torches with their flicker; shadow and dark drops; embers, smoke and pulsing cracks; bloom and the vignette; a world's palette; light over a painted map) is proven on its own, in the game, beside its target picture, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in the light definition of done (docs/process/done/light.md) and its bar line in K5; then one World 1 map, lit from the proven aspects, stands beside the look we aim for at play size and meets K5, scored 75+ by three judges, checked by someone who built none of it; S26 makes the data from what it found
- Serves: P3, P6
- Picture: art-inbox/vision/look-target.png · warm lava light, deep shadow, glow: the target the aspects are proven beside
- Sub: Lava glow, braziers and shadow, each proven alone
- Sub: Embers, smoke and flicker at 60 fps
- Sub: Bloom, the world's palette, light over a painting
- Sub: One map lit the proven way
- Goal: G79

#### S26 · A world's light as data

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G51 from under G49 to M1, a goal of its own; rename The foundation: a world's light as data
- Cause: your road: the light foundation is M1's, so every map of a world is lit the same way before any map's light is judged
- Steps: none yet
- Done when: a world's palette, light sources, embers and smoke are data, World 1's set among them, and every map of a world is lit from its set; K5 says "Foundation built: yes"
- Serves: P3, P6
- Picture: art-inbox/vision/look-target.png · warm lava light, deep shadow, glow
- Sub: World 1's palette, light sources, embers and smoke as one data set
- Sub: Every World 1 map lit from that set, nothing lit by hand
- Goal: G51

#### S38 · How we build good screens

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your rule How we build a good one, first (2026-10-25), and your yes to its goal (17:20): eight screens today and more to come (the tutorial's, where gems and chests are spent, World 2's map), so a screen's aspects are proven ahead of S27, which then uses what it found; S25 shares its focus-and-keys aspect
- Why: K6's foundation (S27) would fix the frame before anyone proved a painted scene at both sizes, words laid by shares, the tablet button, focus and keys, each on its own
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every screen aspect (one painted scene from a Codex mock-up at 1280x720 and 1920x1080, letterboxed in any window; words laid over it by shares and scaled with it; the stone tablet button, pressable or greyed with its reason; focus and keys: Enter, Escape, a way back, every choice by mouse and by key; every changed number shown before the click; one family: the lava cavern, dark stone tablets, gold lettering) is proven on its own, in the game, beside its target picture, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in the screen definition of done (docs/process/done/screen.md) and its bar line in K6; then one plain screen (the rest, or settings), put together from the proven aspects, meets K6 beside the mock-up you picked, scored 75+ by three judges, checked by someone who built none of it; S27 builds the frame from what it found
- Serves: P1, P3
- Picture: art-inbox/shop-b305/mockup-b/mockup.png · the shop as you picked it: one painted scene, the words laid over it; the target the aspects are proven beside
- Sub: A painted scene at 1280x720 and 1920x1080, letterboxed
- Sub: Words, buttons, focus and keys on the scene
- Sub: One family of screens; numbers before the click
- Sub: One plain screen built the proven way
- Goal: G84

#### S27 · One frame every painted screen shares

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G56 from under G55 to M1, a goal of its own; rename The foundation: one frame every painted screen shares
- Cause: your road: the screen foundation is M1's, before any screen is brought to its bar
- Steps: none yet
- Done when: the main menu, the shop and the run's end stand on one frame (the 16:9 stage, the words laid on it by shares, the stone tablet button, focus and keys), so a new screen is its painting plus its words; K6 says "Foundation built: yes"
- Serves: P3, P6
- Picture: art-inbox/screens-b374/start-mockup-vs-game.png · the main menu: your picked mock-up beside the game
- Sub: The frame: a 16:9 stage, words laid by shares, the stone tablet button, focus and keys
- Sub: The main menu, the shop and the run's end moved onto it, looking as today
- Goal: G56

### M2 · Every aspect of World 1 at its bar

- Change: rename Version 1, polished (G9); its Done when anew
- Cause: your road: the quality level per aspect is one stage, one goal per standard, each judged on its own; G9 was the polish stage and is this one
- Steps: G9's done steps stay; B473 moves to G55 (S21); B494 and B495 move to M1; B28 and B33 (two look try-outs of 2026-10-14) stay on it until you keep or drop them
- Done when: every standard K1 to K7 is measured and met: every World 1 map, the feel, every unit and its animations, every effect, every map's light, every screen and every sound at its bar, each checked by someone who built none of it
- Goal: G9

#### S14 · Maps meet their bar

- State: agreed (you, 2026-11-09; in the goal map 2026-11-09)
- Change: move G41 from The loop is fun (G2) to M2; merge G23, G24, G25 and G34 into G41; move G29 under G41 from G28; G42 moves out to M1 (S24)
- Cause: your road: one goal for the maps standard, judged on its own; Better maps' Done when is a point of the map bar (walkable and dangers at a glance), the later look pass (G34) is the bar's 75+, and the three set-piece maps are brought to their paintings here; your word (2026-10-25): the other World 1 maps look far worse than the Causeway
- Steps: B400 (from G23) and G24's five done steps (B329 to B333) move to G41; G29's steps stay with G29; B497 (the crumbling tiles' look to 75) moves here from G30
- Done when: every World 1 map meets the Maps standard's bar (K1), the five plain ones too (the Watchtower, Twin Isles, the Long Ledge, Crossroads, Lava Tongue): each gets a painting of its own in the look we aim for and is built from it through M1's map foundation, its shape, edges, cliffs, stairs, rocks, crates and torches as that painting has them, no two alike; its look scored 75+ by three judges, walkable ground and where a push kills read at a glance, each checked by someone who built none of it; a map added later is built at that bar
- Serves: P2, P3
- Picture: art-inbox/vision/standards/maps-example-bridge.png · an example map in the look we aim for
- Picture: art-inbox/vision/s24/s24-today-world1.png · World 1's maps today at play size: the Causeway and the five plain ones (2026-10-25)
- Sub: The Causeway, the Terraces and the Ring as their paintings (G29)
- Sub: The five plain maps rebuilt from new paintings
- Sub: Walkable ground, drops and where a push kills read at a glance on every map
- Goal: G41

#### S3 · Better maps

- State: agreed (you, 2026-11-09; in the goal map 2026-11-09)
- Change: merge G23 into G41 (S14), with its sub-goals G24 and G25; G28 moves out to M3 (S28)
- Cause: its Done when is a point of the map bar (K1: walkable and dangers at a glance); the cliffs and stairs (G24) are built; G25's five new maps are the bar's count, 5 per world
- Steps: B400 and G24's five done steps move to G41
- Goal: G23

#### S8 · The reference look on every map

- State: agreed (you, 2026-11-09; in the goal map 2026-11-09)
- Change: merge G34 into G41 (S14)
- Cause: every map is brought to the map bar's 75+ in M2 and a new map is built at it, so a later look pass is not needed
- Steps: none
- Goal: G34

#### S15 · The feel meets its bar

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G43 from The loop is fun (G2) to M2; merge G6 into G43; G44 and G45 move out to M1 (S25)
- Cause: your road: one goal for the feel standard, judged on its own; G6's polish list (the preview before a click, a readable offer and run map, the draw order) is the feel bar's, and its open step is a camera point of that bar
- Steps: B396 moves here from G6, with G6's other 15 steps (done, or asks answered)
- Done when: a tester who built none of it walks the feel bar (K2) through a whole fight and the screens around it, on M1's input layer, and every point passes
- Serves: P3, P8
- Picture: art-inbox/vision/standards/feel-preview.png · hovering shows what a click will do
- Sub: Hover shows the move, the push and the damage before every click
- Sub: A whole fight with the keyboard alone, and one with the mouse alone
- Sub: Every hit, push and death answers within 100 ms; the camera keeps every unit in view
- Goal: G43

#### S4 · The polish you need to judge fun

- State: agreed (your confirm of S15, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G6 into G43 (S15)
- Cause: your road: each aspect judged on its own; G6's polish list is spread over the feel, effects and sound bars, and the feel bar holds most of it
- Steps: B396 and G6's other 15 steps (done, or asks answered) move to G43
- Goal: G6

#### S34 · How we build good units

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your word (2026-10-25): the generic approach "should also be applicable for building units, or skills, special effects"; your yes to its goal; ahead of S29, which redraws every unit of World 1, and of the four heroes (S19) and World 2's units; K3's pipeline is built, so what it proves goes into the pipeline and the Units standard
- Why: S29 held your pick of resolution and the model sheet as its first two sub-goals, the way chosen inside the goal that redraws every unit; the rule proves them first, one by one
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every unit aspect (the pixel size and resolution at play size; one model sheet: detail, outline, shading, proportions; the eight animation sheets: idle, attack, hit, death and the four walks; an ability's cast animation and its projectile's cast point; hero, enemy, role and elite read at play size; a boss on 2x2 tiles; the world's palette on a unit; the pipeline from the prompt kit to the game) is proven on its own, in the game or its tool chain, beside the line-up, with a verdict (can we, how, at what cost, which limit the engine sets: the tile, the zoom, the 4x pixels, 60 frames per second), a making guideline in the unit definition of done (docs/visual/unit-definition-of-done.md) and its bar line in K3; then the Knight, redrawn through the proven pipeline to the sheet with every animation playing, stands in the line-up at play size and meets K3, scored 75+ by three judges, checked by someone who built none of it; S29 redraws every other unit the same way
- Serves: P3, P8
- Picture: art-inbox/vision/units-lineup.png · the line-up: the target every aspect is proven beside
- Sub: One model sheet: size, resolution, outline, shading
- Sub: The eight animation sheets and every ability's cast
- Sub: Role, side and world read at play size
- Sub: One unit, the Knight, through the proven pipeline
- Goal: G64

#### S29 · Every unit one detailed, consistent model

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: rewritten from your words (2026-10-25): higher resolution, better animations, one consistent model for every unit; its pick of resolution and its model sheet move to S34 as aspects
- Cause: your word (2026-10-25): the Skeleton Archer and Warrior look far more detailed than the Knight; find a way for the unit models to be consistent; your rule How we build a good one, first: the pick, the sheet and the Knight as the first unit through the pipeline are proven in S34 before every unit is redrawn
- Why: K3 has no goal of its own, and the units were drawn in separate passes, so their detail differs; the way to consistency is one model sheet every unit is drawn to and judged beside all the others
- Steps: B423 (the Slime's full art) moves here from G10
- Done when: every unit of World 1 (2 heroes, 8 enemies and 2 bosses) is drawn to the model sheet S34 proved, at the resolution you picked there: the same detail, outline, shading and proportions, so in one line-up none looks simpler; every animation smoother than today and playing in the game; scored 75+ by three judges against the new line-up, checked by someone who built none of it
- Serves: P3, P8
- Picture: art-inbox/vision/units-lineup.png · the line-up every unit is scored against
- Sub: Every unit after the Knight redrawn to the sheet; the Slime and the Small Slime at full art (B423)
- Sub: Smoother animations: idle, attack, hit, death and the four walks, every ability animating
- Goal: G95

#### S36 · How we build good effects

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your word (2026-10-25): the generic approach applies to "special effects" too; your yes to its goal; ahead of S16, which redraws every skill's effect; how bold they are is your pick first, since P3.4 says subtle and your word of 2026-10-25 says striking like the mockups
- Why: S16 held your pick of boldness and the bar's raise as its first two sub-goals, the way chosen inside the goal that redraws every effect; the rule proves the aspects first, one by one
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every effect aspect (how bold: subtle, big, dramatic or bold and stylised, your pick; how an effect is made: drawn frames, particles, a flash or a shake, and what each costs at 60 frames per second in PixiJS; the cast, the caster facing, the projectile from its cast point; the impact: a hit, a push, a death, a heal; the outcomes: a kill, a push into the lava, a blocked push; readable at play size over rock and over lava; within 100 ms with its sound; colours from the world's palette and the caster; nothing left behind) is proven on its own, in the game, beside its target picture, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in the skill effect definition of done (docs/process/done/skill-effect.md) and its bar line in K4; then one skill's effect, put together from the proven aspects, meets K4 beside its mockup, scored 75+ by three judges, checked by someone who built none of it; S16 redraws every other effect the same way
- Serves: P2, P3, P8
- Picture: art-inbox/vision/p3/fx.png · how big a hit looks: subtle, big and dramatic, bold and stylised; your pick comes first
- Sub: How bold the effects are, your pick
- Sub: Frames, particles, flashes and shakes: the engine's limits
- Sub: Cast, flight, impact and outcome at play size
- Sub: One skill's effect built the proven way
- Goal: G74

#### S16 · Every skill's effect as striking as the mockups

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G46 from The loop is fun (G2) to M2; merge G48 into G46; rewritten from your words (2026-10-25): better special effects, towards the mockups; its pick of boldness and the bar's raise move to S36 as aspects
- Cause: your road: one goal for the effects standard; your word (2026-10-25): getting hit is okay, but most skills in the game look terrible, while the mockups' effects (the purple explosion screen) look amazing; your rule How we build a good one, first: how bold and how an effect is made are proven in S36 before every effect is redrawn
- Steps: B365 (done) moves from G48 to G46
- Done when: every ability's effect redrawn to the look you picked in S36, each 75+ by three judges against its mockup, still readable over rock and lava; hits, pushes and deaths kept unless below the new bar; checked by someone who built none of it
- Serves: P3, P8
- Picture: art-inbox/vision/p3/fx.png · how big a hit looks: subtle, big and dramatic, bold and stylised
- Sub: One mockup per ability as its reference
- Sub: Today's skills measured against the new bar, the worst named first (G47)
- Sub: Every skill's effect below the bar redrawn to its mockup, the worst first
- Goal: G46

#### S17 · Light and atmosphere meet their bar

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G49 from The loop is fun (G2) to M2; G51 moves out to M1 (S26); rename Light meets its bar
- Cause: your road: one goal for the light standard, judged on its own; the light as data is a foundation and comes first; the standard's name
- Steps: none yet
- Done when: every World 1 map's light meets the Light and atmosphere standard's bar (K5), lit from M1's light data, scored 75+ against the look we aim for, embers and flicker small and slow at 60 frames per second, checked by someone who built none of it
- Serves: P3, P8
- Picture: art-inbox/vision/standards/light-lit-units.png · the lava lights what stands near it
- Sub: Measure today's light against the bar (G50)
- Sub: The lava lights what stands near it on every map; a drop stays dark, nothing walkable looks like lava
- Sub: Embers, pulsing cracks and flickering braziers, small and slow, at 60 frames per second
- Goal: G49

#### S21 · Screens meet their bar

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G35 into G55, its sound half into G57 (S22); G56 moves out to M1 (S27)
- Cause: your road: one goal for the screens standard, judged on its own; the menus' and the run summary's polish (G35, F13) is the screen bar; the frame is a foundation and comes first
- Steps: B473 (the rest as one scene) moves here from G9's own list
- Done when: every screen of a run (the main menu, settings, the run map, the upgrade pick, the shop, the rest, a fight's end and the run's end) meets the Screens standard's bar (K6) on M1's frame, each painting scored 75+ by three judges against the mock-up you picked, checked by someone who built none of it
- Serves: P1, P3
- Picture: art-inbox/vision/standards/screens-today.png · every screen today: four painted, four plain
- Sub: The rest, the upgrade pick, settings and a fight's end painted from a mock-up you pick
- Sub: Every choice by mouse and by key, a way back from every screen, every changed number shown before the click
- Goal: G55

#### S9 · Menus, a run summary and sound, finished

- State: agreed (your confirm of S21, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G35 into G55 (S21); its sound half into G57 (S22)
- Cause: the screen and sound bars hold its polish, each judged on its own
- Steps: none
- Goal: G35

#### S39 · How we build good sound

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your rule How we build a good one, first (2026-10-25), and your yes to its goal (17:20): 43 moments and 7 tracks today, and every new ability, enemy and screen brings its moments, so a sound's aspects are proven once, ahead of S22, which then uses what it found; K7's foundation is built (the sound board, B373)
- Why: every moment has your pick, but where a one-shot comes from, its takes, its levels, ten at once and the music per place were never proven on their own
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every sound aspect (where a one-shot comes from: a library or a tool, with its source and licence on record; two or three takes for a frequent sound; one loudness for every one-shot; one family: rock, fire, iron and the lava's bed; a music track per place from Suno, loops of at most 30 s at -20 LUFS under the effects; ten at once without noise; in time with the animation within 100 ms) is proven on its own, in the game or its tool chain, by your ear on the sound board, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in the sound definition of done (docs/process/done/sound.md) and its bar line in K7; then one moment, made from the proven aspects, meets K7 as your pick from three candidates, checked by a helper who built none of it
- Serves: P3, P8
- Picture: art-inbox/vision/standards/sound-board.png · the bar is your ear: three candidates per moment, and your pick
- Sub: Where a one-shot comes from: takes, levels, family
- Sub: Music per place: tracks, loops and levels
- Sub: Ten at once, in time with the animation
- Sub: One moment made the proven way
- Goal: G89

#### S22 · Sound meets its bar

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G35's sound half into G57
- Cause: your road: one goal for the sound standard, judged on its own; its foundation is built (B373)
- Steps: none yet
- Done when: every moment and music track meets the Sound standard's bar (K7): each moment your pick, two or three takes for a frequent sound, the music fitting its place and levelled, checked by a helper who built none of it
- Serves: P3, P8
- Picture: art-inbox/vision/standards/sound-map.png · the moments, each with its cue and your pick
- Sub: Measure today's sound against the bar (G58)
- Sub: Every moment below the bar fixed: takes, levels, the music per place
- Goal: G57

### M3 · Everything there, and it is fun

- Change: rename The loop is fun (G2), M1 to M3; its Done when anew
- Cause: your road: the stage where no feature, setting or gameplay part is missing and the run is fun; the fun was G2's purpose, and the quality it waited for is M2's now
- Steps: B429 stays with it (B318 done)
- Done when: every must feature (F1 to F10, and F16's four heroes) and every setting is in the game and plays to the end; you say it is fun from your own runs, and no bug breaks a run; the difficulty is one of the things you judge, not the stage
- Goal: G2

#### S1 · Five harder fights, and a real boss

- State: agreed (you, 2026-10-18; in the goal map)
- Done when: a World 1 run has five fights that get harder, each bringing a new trouble, and a boss fight on its own ground that a careful player can lose a hero to
- Serves: P2
- Picture: art-inbox/vision/features/boss.png · the boss and crowned elites
- Sub: Three new enemy types, one new trouble per fight (G20)
- Goal: G3

#### S35 · How we build good skills

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: new
- Cause: your word (2026-10-25): the generic approach "should also be applicable for building units, or skills, special effects"; your yes to its goal; a skill is an ability as a game piece (what it does, how it reads, animates and grows), its look is S36's kind; ahead of S2 and S19, whose next skills are the four heroes' eight, and of World 2's; its data foundation is built (an ability's effect, visuals and sound as data, B365)
- Why: no standard and no goal said what makes a good skill before eight more are built; the rule proves the aspects first, one by one; its bar lines go to K3's ability lines, or to a Skills standard if you want one (asked in its focus talk)
- Steps: none yet; each aspect becomes a step of its own when a sub-goal is refined, the engine's limits first
- Done when: every skill aspect (its one clear job and the enemy or situation it answers; its shape in the rules as data: target, range, area, push, a wait, charges, and the limit of what the rules can say today; its preview of what a click will do; its icon and its text made from the rules; its cast animation and projectile; its sound; how it grows by upgrades and combines with others; its balance by the bot's whole runs) is proven on its own, in the game, beside its target picture, with a verdict (can we, how, at what cost, which limit the engine sets), a making guideline in a skill definition of done (docs/process/done/skill.md, new beside upgrade.md) and its bar line in K3 (or a Skills standard); then one new skill, one of the four heroes', built from the proven aspects, plays in a fight and meets its bar, checked by someone who built none of it; S19 builds the other seven the same way
- Serves: P2, P6
- Picture: art-inbox/vision/features/abilities-grow.png · the Knight's bar: 2 abilities, then 4
- Sub: A skill's one job and its rule shape
- Sub: A skill's preview, icon, cast animation and sound
- Sub: Upgrades, combinations and balance by the bot
- Sub: One new skill built the proven way, played
- Goal: G69

#### S2 · Twelve upgrades, growing heroes and the Wizard

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G39 into G5; rename About twelve upgrades to pick from
- Cause: your road: the run's content, each feature in and fun; the Wizard's card (built) is how a hero joins the party, one part of heroes growing through a run; fewer goals
- Steps: B455 and B456 (done) move from G39 to G5; G18's and G19's stay with them
- Done when: a run offers at least twelve different upgrade cards across the heroes, one picked after every won fight; each hero starts with two abilities and ends with about four; the run starts with the Knight alone, the Wizard comes as a card and a fallen hero is back at the next rest
- Serves: P2
- Picture: art-inbox/vision/features/abilities-grow.png · the Knight's bar: 2 abilities, then 4
- Sub: Heroes grow through a run: two abilities at the start, the rest by upgrades (G18)
- Sub: Six new abilities that answer the enemies (G19)
- Goal: G5

#### S18 · The Wizard as a pick

- State: agreed (your confirm of S2, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G39 into G5 (S2)
- Cause: built (B455, B456); a hero joining by a card is one part of heroes growing through a run
- Steps: B455 and B456 (done) move to G5
- Goal: G39

#### S19 · Four more characters to pick

- State: agreed (you, 2026-10-20; your characters brainstorm, in the goal map)
- Change: move G40 from Version 1, polished (G9) to M3 (G2)
- Cause: your word (2026-10-25): the four heroes are part of everything being there, before you judge it fun
- Steps: all stay with it (B457 to B461)
- Done when: the Ranger, the Rogue, the Priest and the Necromancer are in the pool, each with its role, two abilities, quick art and every animation, and a party of three fights on every map
- Serves: P2
- Picture: art-inbox/vision/features/hero-card.png · a hero's card, as the Wizard's today
- Goal: G40

#### S5 · Undo and the enemies' next move as settings

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G4 into G7; rename Your experiments, each behind a setting
- Cause: your road: no setting missing; undo is built (B372) and the enemies' waiting skills are the next move they show (B502, B510), so G4 is one setting of this goal, not a goal; a direct title
- Steps: B372 stays; G4's B366 (done) moves to G7; B07 and B08 are dropped
- Done when: undo and the enemies' next move each switch on in the settings, each plays a whole run on and off, and a variant that loses is removed
- Serves: P2
- Picture: art-inbox/vision/features/undo.png · Undo and Undo turn after a step
- Sub: The enemies' next move as a setting (the settings screen's Delayed attacks row, B704), on or off, a whole run each way
- Sub: A whole run with undo on and one with it off, the loser removed
- Goal: G7

#### S28 · Map dangers: crumbling floor, vents and an ambush

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G28 from under G23 to M3 (G2), a goal of its own; rename Map dangers: crumbling floor, vents and an ambush; G29 moves out to G41 (S14); G31 moves out to a goal of its own (S31)
- Cause: your road: level ideas are gameplay parts, judged in M3; your word (2026-10-25): a map's dangers, like crumbling floor and vents, differ from objectives like surviving or keeping an area free: two goals
- Steps: G28's own stay; G30's B441 (done) stays with G30 and its B497 (a look gap to 75) moves to G41; G32 has none yet
- Done when: one World 1 fight has tiles that crumble and vents that erupt on a schedule shown a turn ahead, and one has enemies climbing out of spots marked a turn ahead, each won by the test players and seen by you
- Serves: P2
- Picture: art-inbox/vision/features/changing-ground.png · ground that changes during a fight
- Sub: Ground that changes during a fight: the Crumbling Floor and the Vents (G30)
- Sub: Reinforcements that arrive where they were shown: the Ambush (G32)
- Goal: G28

#### S31 · Objectives: survive, kill all, hold an area

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: move G31 from under G28 to M3 (G2), a goal of its own; rename Objectives: survive, kill all, hold an area
- Cause: your word (2026-10-25): objectives like winning by surviving, killing all enemies or keeping an area free differ from a map's dangers: two goals
- Steps: none yet
- Done when: every World 1 fight shows its objective at the start and each turn: kill all enemies, survive a number of turns, keep an area free (Hold the Shrine) or reach a spot (Reach the Gate); a failed objective costs the reward; each kind won by the test players and seen by you
- Serves: P2
- Picture: art-inbox/levels-g28/codex/d-shrine/out.png · Hold the Shrine, the level idea you picked
- Sub: Survive a number of turns
- Sub: Keep an area free of enemies: Hold the Shrine
- Sub: Reach a spot: Reach the Gate
- Goal: G31

#### S10 · A tutorial that teaches in small steps

- State: agreed (you, 2026-10-19; in the goal map)
- Change: move G27 from Version 1, polished (G9) to M3 (G2)
- Cause: your road: the tutorial is a feature of the whole game (F9), in before you judge it fun; the polish stage is the quality per aspect now
- Steps: all stay with it (six, each done; its re-check closes it)
- Done when: Tutorial in the main menu plays a five-node run that teaches moving, attacking and the lava push, picking an upgrade, both heroes, the shop and a small boss, then returns to the menu; a new player learns the game from it alone
- Serves: P1
- Picture: art-inbox/vision/features/tutorial-fight.png · the tutorial's first fight, a tip showing
- Goal: G27

#### S6 · Two whole runs played, one by someone else

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: drop G8
- Cause: your word (2026-10-25): strip this goal, you play the runs yourself, outside the plan
- Steps: none open (B303 done, B35 dropped)
- Goal: G8

#### S11 · Someone else plays it start to end

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: drop G36
- Cause: your word (2026-10-25): the runs are yours, outside the plan (S6)
- Steps: none
- Goal: G36

### M4 · The game complete, more heroes and worlds

- Change: rename Growth (G10), M3+ to M4; its Done when anew
- Cause: your road: the fourth stage completes the game and adds content, more characters and worlds; a new character is content, not difficulty
- Steps: B41 stays with it (B45 done, B42 dropped); B423 moves to S29 (M2)
- Done when: a run goes on into World 2; gems and chests buy something; version 1 on GitHub and itch.io (Steam eventually, low priority)
- Goal: G10

#### S12 · Architecture check before growth

- State: agreed (you, 2026-10-19; in the goal map)
- Done when: the structure is ready for more heroes and for unlocks, or a rebuild is planned with its cost
- Serves: P6
- Picture: art-inbox/vision/vision-built-on.png · everything is data, set onto the grid
- Goal: G37

#### S13 · A run goes on into World 2

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: rename World 2; its Done when grows to World 2's own look and maps
- Cause: a direct title: what you can do when it is done; P3 gives each world its palette, and the map bar asks 5 maps per world
- Steps: B448 stays
- Done when: a run goes on into World 2 after World 1's boss, with World 2's own palette and light, five maps at the map bar, and every fork of its run map a real choice
- Serves: P2, P3, P7
- Picture: art-inbox/vision/features/world-2-map.png · World 2's map, in World 1's art for now
- Sub: World 2's palette and light set, ash and embers, as data
- Sub: Five World 2 maps from their paintings, each at the map bar, no two alike
- Sub: Each fork of World 2's run map a real choice: two different fights
- Goal: G38

#### S20 · Gems and chests buy something

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: merge G53 and G54 into G52
- Cause: fewer sub-goals (your word); your choice of what they buy stays on the goal as a note, asked first in its focus talk with pictures
- Steps: none yet
- Done when: the gems and chests a run finds buy something you see, in that run or the next, and the screen that spends them says what they bought
- Serves: P2
- Picture: art-inbox/vision/features/gems-chests.png · gems and chests counted on the map today
- Goal: G52

#### S30 · The game on GitHub, itch.io, then Steam

- State: agreed (you, 2026-10-25; in the goal map 2026-10-26)
- Change: rewritten from your words (2026-10-25): distribution, low priority; GitHub for now, itch.io and Steam eventually
- Cause: your word (2026-10-25): for now GitHub is fine, like running the game locally; itch.io and Steam seem good, eventually; a low-priority goal
- Why: P5 has no goal of its own; low priority by your word, so it comes last in M4
- Steps: none yet
- Done when: a friend runs the game from GitHub with a short how-to; it plays on itch.io in a desktop browser; a Steam page with a demo stands once the game is complete
- Serves: P5, P1
- Picture: art-inbox/vision/vision-how-people-get-it.png · a link for friends in a desktop browser now, a shop page later
- Sub: For now: the game on GitHub, run locally from a short how-to
- Sub: On itch.io, playable in a desktop browser
- Sub: Eventually on Steam: a store page and a demo
- Goal: G98

## Standards

Per kind of thing the goals need: how many, the bar it must meet, what to build first so each next one is cheap, and
how today's game scores against it (the partner's proposal of 2026-10-20, from your words: the levels are clunky and
not like the Codex pictures, and the feel has had no focus yet). Gaps become goals. The guard: no second thing of a
kind is built before its standard is confirmed and its foundation exists.

### K1 · Maps

- State: confirmed (you, 2026-10-21)
- Count: 5 per world, 7 built today · from S14, S13
- Kind: map
- Done: docs/process/done/level.md
- Reference: art-inbox/vision/look-target.png · the look we aim for (Codex)
- Today: art-inbox/vision/look-today.png · Ember Hollow as built
- Picture: art-inbox/vision/standards/maps-painting-a-causeway.png · A · The Causeway, the painting (Codex, G28)
- Picture: art-inbox/vision/standards/maps-built-a-causeway.png · A · The Causeway, as built (B394)
- Picture: art-inbox/vision/standards/maps-painting-b-terraces.png · B · The Terraces, the painting
- Picture: art-inbox/vision/standards/maps-built-b-terraces.png · B · The Terraces, as built
- Picture: art-inbox/vision/standards/maps-painting-f-ring.png · F · The Ring, the painting
- Picture: art-inbox/vision/standards/maps-built-f-ring.png · F · The Ring, as built
- Picture: art-inbox/vision/standards/maps-example-bridge.png · example 1, a bridge: two plateaus over a lava river, a bridge two tiles wide and a crumbling path, stairs down to a ledge on each side (Codex, in the look we aim for)
- Picture: art-inbox/vision/standards/maps-example-hollow.png · example 2, a hollow: a basin ringed by cliffs, two stairways down, two lava pools and a vent (Codex)
- Picture: art-inbox/vision/standards/maps-example-isle.png · example 3, an isle: one island in a lava sea, a raised centre with stairs on two sides (Codex)
- Picture: art-inbox/vision/s24/s24-today-beside-painting.png · the Causeway today at play size, beside its painting (your map round, 2026-10-25)
- Picture: art-inbox/vision/s24/s24-today-world1.png · World 1's maps today at play size: the five plain ones far worse than the Causeway (your word, 2026-10-25)
- Bar: visible at a glance
  - the types of ground and terrain tell apart at play size: ground, lava, cliff, stairs · art-inbox/vision/standards/maps-walkable.png
  - dangers read before a click: lava, drops, vents, the map's edge, and where a push kills · art-inbox/vision/standards/maps-dangers.png
  - heights read: cliffs and walls you cannot climb look like it, stairs like the way up · art-inbox/vision/standards/maps-height.png
  - walkable ground tells from the lava a little more clearly than today: a soft edge, no bright rim and no grid (your word, 2026-10-25)
- Bar: the start reads
  - at the first look you see where the enemy comes from, where you would stand, and the one idea of the fight (a
    bridge to hold, a hollow to climb out of)
- Bar: routes
  - two ways to every place that matters
  - a chokepoint and a high tile on each map
  - no dead end that traps you
- Bar: the size of a level
  - fits one screen: every tile in view above the unit panel at 1280x720 · art-inbox/vision/standards/maps-view.png
  - the zoom as today: the map fills the screen, the units big (your word, 2026-10-25)
  - 10x8 to 14x10 tiles; a fight of 3 to 6 turns; two heroes against four to seven enemies
- Bar: not too simple, not too complex
  - too simple: one obvious path, or won by standing still
  - too complex: more than two things to think about at once, or a first turn that needs a plan of three moves
  - no two maps of a world share a shape or look alike
- Bar: drawn as the reference
  - lava with its glow, cracks and shore: a hazard, not a decoration · art-inbox/vision/standards/maps-lava.png
  - every map from a painting of its own: its shape and size, never blocky rectangles or square-cut holes, and its rocks, crates and torches where the painting puts them, never hiding a unit or a tile · art-inbox/vision/standards/maps-props.png
  - edges and cliffs as a natural ledge (your pick, 2026-10-25): a smooth, slightly worn outline, a lip of lighter worn stone on top, tall cliffs of dark layered rock below, never smeared or streaky; stairs and bridges drawn into the ground and the cliff, not pasted on · art-inbox/vision/s24/s24-edges-d.png
  - a bridge over lava is a stone walkway two cells wide, part of the painted floor, lava on both long sides, a cliff below its foot, crossed by units from end to end; plain ground in the rules, never planks on a painted map (B679, the Shrine's four walkways proven; its walkways scored 72 of 75 against Codex's painting, the game's moving lava against the painted cliff-foot glow being what costs the points) � art-inbox/B679/walkways-panel.png
  - the ground's detail as today: big cracks in the ground, many dark rocks in the lava (your word, 2026-10-25)
  - the whole scored 75+ by three judges against the reference
- Bar: a vibe and a colour palette per world: a map tells its world without its name (the Causeway's embers, the
  Terraces' ash)
- Bar: fair and by the rules
  - nothing hidden decides a fight: every danger that hits you was on screen
  - ground that changes is told before and shown after: the cell that will fall is marked a turn ahead; when it falls the map shows a lava hole with a broken stone rim where the rules changed it, in the map's own look, the stone around it unchanged (your pick, 2026-10-27)
  - the fight follows the level playbook's rules, checked by the bot's whole runs
  - winnable by a careful player, losable by a careless one
- Foundation: a way from a reference picture to the game's tiles (the map's rows in the game's geometry, a guide drawn from
  them, Codex painting the terrain only in the reference's look, the lava keyed out, the game's own props in cells), so a built
  map looks like its reference instead of hand-pixelled tiles · about 8 h
- Foundation built: yes (B672, 2026-10-26): the way is rows, `tools/paintedmap/guide.py`, Codex paints terrain only, `key.py`, the game's own props in cells (playbook rule 43)
- Per item: one map from its painting, with the pieces · about 2 h
- Score: 0 of 7 meet the bar · your word of 2026-10-20: clunky, not like the Codex pictures; of 2026-10-25, per map: the Causeway: its rocks, crates and torches missing, its edges and cliffs not right, walkable ground a little unclear; the five plain maps far worse and alike, each blocky and flat with smeared cliffs and no props at all: the Watchtower: the tower a flat square, stairs pasted on its sides, a square-cut pool; Twin Isles: two blocky islands with square-cut pools, the plank bridges pasted on; the Long Ledge: the ledge a straight band, a stair pasted on its end; Crossroads: a rectangle with slot-cut pools, nothing on its ground; Lava Tongue: a rectangle split by a straight lava slot, the raised rock's stair pasted on
- Gap: every map → G41 Maps meet their bar (S14, under M2), its foundation first: G42 Maps built from their reference painting (S24, M1)

### K2 · Feel

- State: confirmed (you, 2026-10-21)
- Count: every fight and screen · from S15
- Kind: feel
- Done: docs/process/done/feel.md
- Today: art-inbox/vision/look-today.png · a turn today
- Bar: at a glance
  - hovering a tile or a unit shows what a click would do: the move, the push, the damage, before the click · art-inbox/vision/standards/feel-preview.png
  - nothing waits on you without saying so: a turn that ends, an enemy that moves, a pick that is due
- Bar: the start reads
  - at the first look of a fight: whose turn it is, which hero acts, and what it can do · art-inbox/vision/standards/feel-start.png
- Bar: ways through
  - a keyboard shortcut for every action, shown on hover · art-inbox/vision/standards/feel-keys.png
  - a whole fight plays with the keyboard alone, and one with the mouse alone, both to the end
- Bar: answers at once
  - every hit, push and death answers within 100 ms, with a flash, a sound and a number · art-inbox/vision/standards/feel-answers.png
  - the camera follows the action and never leaves a unit half off screen
  - a fight shows within about a second of the click, a card and never black · art-inbox/checks-b443/loading-card.png
- Bar: neither too simple nor too complex
  - a turn takes no more clicks than its moves: pick, aim, confirm; one key undoes or cancels
  - the same key and the same gesture do the same thing on every screen
- Bar: as the reference
  - as clear as the Into the Breach reference what every click will do
  - effects subtle, never covering the units or the ground (P3.4)
- Bar: fair and by the rules
  - what the preview shows is what happens: the click preview and the rules agree, pinned by a test · art-inbox/vision/standards/feel-intent.png
  - the feel checklist walked by a tester who did not build it
- Foundation: one input and camera layer every screen shares, and a feel checklist a tester walks through · about 5 h
- Per item: about 1 h per screen
- Score: not measured · your word of 2026-10-20: no focus on it yet
- Gap: unknown → G43 The feel meets its bar (S15, under M2); first the playthrough against the bar (G44) and the input layer (G45), together S25 in M1

### K3 · Units

- State: confirmed (you, 2026-10-21)
- Count: 2 heroes, 8 enemies and 2 bosses today; more heroes later (F16) · from S29, S1, S2, S19, S13
- Kind: unit
- Done: docs/visual/unit-definition-of-done.md
- Reference: art-inbox/vision/units-lineup.png · the line-up
- Today: art-inbox/vision/features/enemies.webp · the enemies today
- Bar: at a glance
  - hero or enemy, and which kind, tell apart at play size against the lava; an elite by its crown · art-inbox/vision/standards/units-glance.png
  - its role reads from its look: a caster's staff, a shooter's bow, a brute's bulk · art-inbox/vision/standards/units-role.png
- Bar: its size
  - at the line-up's size beside the other units and the tiles, its feet on the tile's foot line; a boss on 2x2 tiles · art-inbox/vision/standards/units-size.png
- Bar: neither too simple nor too complex
  - each enemy asks its own answer of you; no two units play alike
  - a hero starts with two abilities and holds at most seven, each with one clear job
- Bar: alive
  - idle, attack, hit, death and the four walks, each a sheet, each playing in the game · art-inbox/vision/standards/units-alive.png
  - every ability animates, its projectile leaving the right point; every skill has its icon
- Bar: as the reference
  - 4x pixel art in the line-up's style · art-inbox/vision/units-lineup.png
  - scored 75+ by three judges against the line-up at play size
- Bar: its world
  - in the world's palette: you tell its world without its name · art-inbox/vision/standards/units-world.png
- Bar: fair and by the rules
  - its stats, abilities, art and sounds in one data entry
  - its attack reaches no further than its rule; a click selects it by its drawn pixels
- Foundation: a unit as one data entry and the sprite pipeline (built: the prompt kit, B309); before more heroes, a
  party of any heroes (F16) · about 6 h
- Foundation built: yes (the sprite pipeline and its prompt kit, B309; you, 2026-10-21)
- Per item: about 3 h
- Score: not measured · the new units were checked at 75+ in their steps; the boss has quick art (B231), its full art
  waits (B276)
- Gap: the Slime's full art (B423) and what the measure names → S29 Every unit one detailed, consistent model (under M2, a new goal; its G id on your Yes); the four new heroes at the unit standard → G40 Four more characters to pick (S19, under M3, B458 to B461); the boss's full art is done (the Skeleton Overlord, B469)

### K4 · Effects

- State: confirmed (you, 2026-10-21)
- Count: about 12 abilities, each with its effect; hits, pushes and deaths · from S16, S2
- Kind: skill effect
- Done: docs/process/done/skill-effect.md
- Today: art-inbox/vision/standards/effects-today.png · hits, pushes and deaths after B234
- Bar: at a glance
  - it reads what happened: a hit, a push, a death, a heal · art-inbox/vision/standards/effects-glance.png
  - readable at play size over the rock and over the lava
- Bar: its size
  - subtle: a thin bolt, a small burst, a short flash; never covering the units or the ground (P3.4) · art-inbox/vision/standards/effects-subtle.png
  - within 100 ms of the action, with its sound; the battle waits only its own short time
- Bar: every outcome
  - the caster faces the target, west mirrored; the projectile leaves the cast point · art-inbox/vision/standards/effects-cast.png
  - a kill, a push into the lava and a blocked push each play their own way · art-inbox/vision/standards/effects-outcomes.png
  - nothing left behind: rings, sparks and dust gone when it ends
- Bar: as the reference
  - scored 75+ by three judges against the effect's reference picture
- Bar: its world
  - its colours from the world's palette and its caster: fire red, void purple · art-inbox/vision/standards/effects-world.png
- Bar: fair and by the rules
  - it shows the rule's outcome and never more: a blocked push looks blocked
  - the click preview still shows the right ghost before the cast
- Foundation: an ability's effect, visuals and sound as data (the game plan: before M3, B365) · about 4 h
- Foundation built: yes (an ability's effect, visuals and sound as data, B365; 2026-10-24)
- Per item: about 1.5 h
- Score: not measured · hits, pushes and deaths were redone in B234; the abilities' own effects are uneven
- Gap: unknown → G46 Every skill's effect as striking as the mockups (S16, under M2): Measure today first (G47); its foundation is built (B365, inside G33)

### K5 · Light and atmosphere

- State: confirmed (you, 2026-10-21)
- Count: every map and fight, per world · from S17, S13
- Kind: light
- Done: docs/process/done/light.md
- Reference: art-inbox/vision/look-target.png · the look we aim for (Codex): warm lava light, deep shadow, glow
- Today: art-inbox/vision/look-today.png · a fight today, lit by the game's light layer
- Bar: at a glance
  - the lava lights what stands near it: units, props and cliff faces lit warm on the lava side, with a thin rim of lava light · art-inbox/vision/standards/light-lit-units.png
  - the lava is the brightest thing on screen; a drop stays dark; light never makes a walkable tile look like lava · art-inbox/vision/standards/light-readable.png
- Bar: alive
  - embers drift up, the lava's cracks pulse, braziers flicker, a vent smokes · art-inbox/vision/standards/light-alive.png
  - every motion small and slow: nothing pulls the eye from the fight, nothing covers a unit or a tile
- Bar: neither too simple nor too complex
  - too flat: evenly lit, no glow, no shadow; too much: bloom that blurs the pixels or a haze that greys the screen · art-inbox/vision/standards/light-balance.png
- Bar: as the reference
  - glow, warm light and deep shadow as the look we aim for, scored 75+ by three judges at play size
- Bar: its world
  - each world tells itself by its light: World 1 warm orange, World 2 ash grey with embers, a later world cold violet obsidian · art-inbox/vision/standards/light-worlds.png
- Bar: its size
  - the whole map lit and moving at 60 frames per second in a desktop browser; a setting turns the motion down on a slow machine
- Bar: fair and by the rules
  - a glow marks only what is there: a glowing tile is lava or a vent, a dark one a drop
- Foundation: the game's light layer (built: light sources, a flicker, bloom and a vignette) plus a world's light as
  data (its palette, its sources, its embers and smoke), so every map of a world is lit the same way · about 5 h
- Per item: a world's light set, from its palette · about 1 h
- Score: not measured · today the light layer lights the ground from the lava and the braziers, with a flicker and bloom
- Gap: unknown → G49 Light and atmosphere meet their bar (S17, under M2): Measure today first (G50); its foundation first: G51 A world's light as data (S26, M1)

### K6 · Screens

- State: confirmed (you, 2026-10-24)
- Count: 8 screens today (the main menu, settings, the run map, the upgrade pick, the shop, the rest, a fight's end and the run's end) and the fight's panels; more to come: the tutorial's (S10), where gems and chests are spent (S20), World 2's map (S13) · from S21, S10, S13, S20
- Kind: screen
- Done: docs/process/done/screen.md
- Reference: art-inbox/shop-b305/mockup-b/mockup.png · the shop as you picked it (Codex): one painted scene, the words laid over it
- Today: art-inbox/vision/standards/screens-today.png · every screen today at 1280x720: four painted, four plain
- Picture: art-inbox/shop-b305/mockup-vs-game.png · the shop: your picked mock-up beside the game (B326)
- Picture: art-inbox/screens-b374/start-mockup-vs-game.png · the main menu: your picked mock-up beside the game (B374)
- Picture: art-inbox/screens-b374/summary-mockup-vs-game.png · the run's end: your picked mock-up beside the game (B374)
- Picture: art-inbox/b473/rest-today.png · the rest today: a plain panel (its painting waits, B473)
- Bar: at a glance
  - what the screen is for at the first look: its title and the one choice it asks · art-inbox/vision/standards/screens-glance.png
  - what can be pressed looks pressable; what cannot is greyed and says why ("Not enough gold.")
- Bar: the start reads
  - the likely next action has the focus, and one line says what to do next ("Choose a good.")
- Bar: ways through
  - every choice by mouse and by key: Enter does the obvious thing, Escape goes back
  - a way back from every screen and no dead end; a double-click or a held key from the screen before chooses nothing
- Bar: its size
  - one screen at 1280x720 and 1920x1080, nothing scrolls; a painted screen letterboxed in any window, 2752x990 too
  - a choice takes at most two clicks or keys
- Bar: neither too simple nor too complex
  - one decision per screen; at most eight goods or three cards at once
  - every number a choice changes is shown before the click ("HP 5/8 to 7/10") · art-inbox/vision/standards/screens-numbers.png
- Bar: as the reference
  - one painted scene from the mock-up you picked, the words laid over it and scaled with it
  - the painting scored 75+ by three judges against its mock-up
- Bar: its world
  - every screen of a run one family: the lava cavern, dark stone tablets in iron frames, the logo's gold lettering · art-inbox/vision/standards/screens-world.png
- Bar: fair and by the rules
  - every text made from the rules (B413); a button does what it says
  - its picture pinned in the screen checks; what it remembers survives a reload
- Foundation: one frame every painted screen shares (the 16:9 stage, the words laid on it by shares, the stone tablet button, focus and keys; today the main menu, the shop and the run's end each keep their own copy), so a new screen is its painting plus its words · about 4 h
- Per item: one screen from its picked mock-up, on the frame · about 3 h
- Score: about 4 of 8 meet the bar · the main menu, the run map, the shop and the run's end are painted from a picture you gave or picked; the upgrade pick, the rest, settings and a fight's end are plain panels; not measured
- Gap: the plain screens → G55 Screens meet their bar (S21, under M2), its foundation first: G56 One frame every painted screen shares (S27, M1)

### K7 · Sound

- State: confirmed (you, 2026-10-24)
- Count: 43 moments and 7 music tracks today; each new ability, enemy and screen brings its moments · from S22
- Kind: sound
- Done: docs/process/done/sound.md
- Reference: art-inbox/vision/standards/sound-board.png · the bar is your ear: three candidates per moment on the sound board, and your pick
- Today: art-inbox/vision/standards/sound-map.png · the 16 moments B373 added, each with its cue and your pick; all 43 moments have one
- Bar: at a glance, by ear
  - each moment tells apart without looking: a hit from a block, your hero hurt from an enemy hurt, your turn from theirs
  - a danger sounds unlike the rest: a death in the lava, the boss's entrance, a hero falling
- Bar: the start reads
  - a fight's start, each change of turn and each run screen has its cue (a path chosen, bought, too dear)
- Bar: every moment covered
  - every game moment has your pick; a test fails when one has none · art-inbox/vision/standards/sound-map.png
  - a new ability, enemy or screen brings its moments in its own step
  - the music fits the place: the menu and the run's screens their own track, a fight the battle track, the boss its own
- Bar: answers at once
  - within 100 ms of its action, in time with the animation, pinned by a test
  - once per event; ten at once never become noise
- Bar: neither too simple nor too complex
  - a sound heard often (a step, a hit) has two or three takes, so it never tires
  - short: one-shots at most 3 s, loops at most 30 s
- Bar: as you picked by ear
  - each moment picked by you from three candidates, or D for three new ones · art-inbox/vision/standards/sound-board.png
  - levelled: every one-shot the same loudness, the music at -20 LUFS under the effects; music and effects each their own volume
- Bar: its world
  - one family of sounds: rock, fire, iron and the lava's bed; a later world gets its own bed
- Bar: fair and by the rules
  - a sound says only what happened: a blocked push sounds blocked, a miss never like a hit
  - its source and licence on record; Sound on or off is remembered
- Foundation: every moment as data, the sound board, and the tools that cut, level and export the picks · about 3.5 h
- Foundation built: yes (every moment its sound and the sound board, B373; 2026-10-19)
- Per item: one moment from three candidates to your pick · about 0.5 h
- Score: 43 of 43 moments have your pick · not measured against the rest of the bar: takes per sound, ten at once, music per place, volumes apart
- Gap: unknown → G57 Sound meets its bar (S22, under M2): Measure today first (G58); its foundation is built (B373)

## The log

What the chats found when they walked up, one line each (the partner gathers them at a milestone's end): `hit P<n>` the
answer served, `gap` the plan was silent, `overturned P<n>` (or `F<n>`, a feature card) a prototype or a check showed an assumed answer wrong.

- overturned F11 (2026-10-21, B471): the card said partly built behind a setting; no such setting exists, it is not built
- overturned F16 (2026-10-21, B471): marked later; your characters brainstorm made it a must after the architecture check, the Wizard already a card

## Next focus

- Proposed (partner, 2026-10-25): G60 · How we build good maps
- Why: your rule How we build a good one, first, and your yes (2026-10-25): every map aspect proven alone before G42 builds the foundation; G59, the painted Terraces, runs inside it
- When: now (the focus since 2026-10-25 16:39)
- Or: G42 · The foundation: from a reference picture to the game's tiles, after G60, by the way it proved
