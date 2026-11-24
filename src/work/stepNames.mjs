// B1302: the board's one rule for whether a folder's name names a step, in a module of its own (pure, no imports), so the worktree
// clean-up (worktrees.mjs) and the test-queue reader (testQueue.mjs) share it without one pulling in the other's modules.

/** Whether a folder's name names step `id` as a whole: B410 in "game-b410", "check-b410-before" and "wt-b410b", not in "game-b4100". */
export function namesStep(name, id) {
  const plain = String(id ?? '').trim().toLowerCase()
  if (!/^[a-z]\d+$/.test(plain)) return false
  return new RegExp(`(?:^|[^a-z0-9])${plain}(?![0-9])`).test(String(name).toLowerCase())
}
