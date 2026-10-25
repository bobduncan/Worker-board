// The asset provider for pictures: Codex, which the board runs by itself (mode "auto"). Part 1 only knows whether it
// can work now; part 2 adds `provide`, which wraps `makePicture` of src/codex.mjs.

import { findCodex } from '../codex.mjs'

export const codex = {
  name: 'codex',
  mode: 'auto',
  kinds: ['visual'],
  /**
   * Whether Codex is found: where `tools.codexPath` says (the `codex` of the Design tab's settings, '' for none), else
   * where the board looks for it. `tools.findCodex` stands in for src/codex.mjs `findCodex` (the tests'). It makes
   * nothing and never throws.
   */
  async check({ findCodex: find = findCodex, codexPath = '' } = {}) {
    try {
      return (await find({ given: codexPath })) === null ? { ok: false, why: 'Codex not found' } : { ok: true, why: 'Codex found' }
    } catch {
      return { ok: false, why: 'Codex could not be looked for' }
    }
  },
}
