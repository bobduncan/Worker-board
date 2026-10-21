# Quality, model routing and Spending

## Available now

Spending collects reported usage from local project transcripts, including Main and both Advisors. It makes no model calls. The ledger stores message identifiers, counts and attribution, not private chat text. Choose 24 hours, 7 days, 30 days or all retained history; inspect models, effort, chats, task costs and planning/review/repair overhead. Export aggregate CSV for comparisons. Failed and unfinished work remains in the totals.

API-equivalent cost ranges are not the subscription bill or a conversion to weekly quota. Cached reads and writes have separate prices; unknown write duration produces a range. Unpriced models and incomplete token data remain unknown. Account-wide allowance figures have their own timestamps and include other projects.

The ledger retains the latest 50,000 messages and discloses limited coverage. Initial history is scanned in bounded chunks over multiple refreshes. Oversized lines and unavailable transcripts are gaps. Copied fork history and streamed duplicates count once. First-pass quality and savings remain unmeasured without actual attempt histories and a comparable baseline.

## Initial release is observe-only

The installed bridge has not demonstrated complete execution-tool coverage, child controls and native model-setting confirmation. Automatic cheaper-model execution is therefore held. Spending permits Off or Observe only; neither changes native chat models or interrupts legacy tasks.

Implemented managed-path foundations include conservative route calculations, versioned contract/record handling, independent exact-revision review checks, bounded repair decisions, guarded API checks, validation primitives and a fast-forward integration helper. Activation still requires verified bridge/controller coverage and end-to-end runner wiring. These foundations do not imply that existing legacy shell merges are guarded. Do not enable `enforce` merely to remove the hold message.

## Proposed routing policy

| Work | Author minimum | Independent reviewer |
|---|---|---|
| Exact mechanical text/data | Haiku low after R0 trial | Sonnet medium |
| Narrow code following a specified pattern | Sonnet medium; Haiku medium after R1 trial | Sonnet medium |
| Normal feature | Sonnet medium | Sonnet medium |
| State, concurrency, persistence or art | Sonnet high | Sonnet high |
| Architecture, core guards, routing/permissions/check machinery | Opus high decisions; Sonnet high only for a verified fixed plan | Opus high |

Main's proposed baseline is Sonnet low; the Advisor's is Sonnet medium. Haiku Main is a separate later experiment. These are recommendations, not settings already applied to current chats.

A one-line change can be critical. Protected paths force stronger review; unexplained risk never selects Haiku. R1 cheap eligibility requires a specified existing pattern, at most three implementation files and exact implementation scope. Broad implementation globs do not qualify. Haiku max cannot satisfy a Sonnet requirement. An existing escalation cannot be lowered during an attempt.

## Managed-path contract and checks

The approved contract binds stable acceptance IDs, observable results/checks, non-goals, interfaces, repository keys, allowed paths, risk, validation profile, evidence and review floor with SHA-256. Scope changes invalidate previous approval. The R3 Sonnet exception requires an independently verified saved Opus-approved implementation plan.

The board API exposes `contract`, `route-state`, `route-raise`, `submit`, `candidate-review` and `integrate`; `route-confirm` and `quality-job-result` are server-only. Missing capabilities hold these execution paths. Older installed mods do not expose new commands; use their existing workflow until an updated verified bridge is installed.

Review must differ from all implementing sessions and children, meet the model floor and pass every AC exactly once. Unknown or duplicate points, unresolved serious findings and changed revisions cannot approve. Required tests and review precede a guarded merge; backup/result/art/playtest checks remain afterwards. Read, checkpoint and pause remain available while held.

## Repair and tuning

Compare the complete cost of accepted results: specification, coordination, implementation, reviews, repairs and failed/abandoned work. Unknown attribution is not zero. Compare similar task classes and sizes.

One targeted repair is allowed at the current tier. Repeated acceptance failure promotes the setting; three implementation attempts require an Opus/high strategy evaluation. Amendments and fix IDs cannot erase the root work's history. Lifetime/project and included-usage limits remain; max, rescue and extra credits require separate permission.

R0 starts with ten eligible tasks. R1 needs the routing replay and twenty eligible tasks. Require comparable all-in savings, no serious escaped regression and seven-day follow-up. Disable a cheaper class after a serious escaped regression or below-floor execution. Spending suggestions never downgrade settings themselves.

## Reproduce and recover

`fixtures/routing/replay-cases.json` contains twenty independently specified shapes. Run `node tools/test.mjs test/work/routingReplay.test.mjs`, or `node tools/routing-replay.mjs --cases fixtures/routing/replay-cases.json --policy <scratch-policy.json>`. The replay calls no models and checks routing, not generated-code quality. Use exact configured model IDs and verified account availability.

`data/spending.json` stays local and ignored by Git. Managed records use the existing work store and expected-content writes. Missing/corrupt managed records are held, not silently converted to legacy work. Global Off/Observe cannot waive a task's latched managed guards.

Rollback stops new cheap assignments, checkpoints active work, confirms a stronger route and keeps evidence/history. No force reset, deletion of unmerged work or paid fallback is included.

Price basis: [official pricing](https://platform.claude.com/docs/en/about-claude/pricing), checked 2026-10-21. Runtime limitations: `quality-routing-capabilities.md`. Pilot status: `model-routing-pilot.md`.
