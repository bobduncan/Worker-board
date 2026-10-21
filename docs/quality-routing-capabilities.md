# Routing capability check (2026-10-21)

Board tests: `node tools/test.mjs`. On the restricted Windows executor, use a writable project-local TEMP; HTTP tests require local loopback permission.

Installed mod runtime: Claude Code 2.1.299, mod 0.13.18. Exact test command on this PC:

```powershell
& '<installed Claude runtime>\claude.exe' plugin test '<board-worktree>\mods\folder-branches'
```

The SDK tests use `claude-code/testing`; they are separate from Node tests. Baseline: 158 tests pass. Existing hooks intercept selected `tool.call` events and inject post-batch context. This does **not** establish that every execution tool, arbitrary shell wrapper, external writer and child is covered, or that native setting changes and actual-route attribution can be confirmed before every mutation. No all-tools enforcement capability is advertised without that proof.

The board now exposes exact app model metadata alongside effort and evaluates a versioned capability handshake. Missing capabilities hold enforcement. Observe mode and spending insights do not require a model call. The current installed bridge has no verified routing handshake, so the initial rollout remains observe-only; changing a config flag cannot manufacture capabilities. Existing manual settings and legacy tasks retain their existing behaviour.

To activate managed cheaper execution, a bridge must supply protocol v1 with proved execution coverage, observed model/effort, a different-session controller and either attributed or disabled children. Test refusal at the real tool middleware boundary and every assignment path. A regex denying `git merge` inside arbitrary shell text is insufficient.
