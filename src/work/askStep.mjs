// Start-up check, MUST 2 (2026-11-05, the person's screenshot): the step an ask is about, so the board can withdraw an ask whose step is
// over. The ask's own `Of` when it names a step (B<n>); an ask with no `Of` (Q666: "If B1051 should leave Worker 3 now ...") is about the first
// B<n> in its title. An `Of` that names something else (a goal) has no step here.

/** The step id an ask is about, or null: its `Of` when that is a step, else (no `Of`) the first B<n> in its title. */
export function askStepOf(of, title) {
  if (typeof of === 'string' && of.trim() !== '') return /^B\d+$/.test(of.trim()) ? of.trim() : null
  const found = /\bB\d+\b/.exec(typeof title === 'string' ? title : '')
  return found === null ? null : found[0]
}
