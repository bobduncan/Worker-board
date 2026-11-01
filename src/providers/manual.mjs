// The asset provider for anything: the person makes the file with any tool and drops it (mode "person"). It serves every
// kind, is free and always works; the board asks the person each time (part C).

import { ASSET_KINDS } from './kinds.mjs'

export const manual = {
  name: 'manual',
  mode: 'person',
  kinds: ASSET_KINDS,
  card: { title: 'Manual', line: 'You drop your own file, any tool', facts: ['Free', 'The board asks you each time'], icon: 'manual' },
  /** Always works: the person is the provider. */
  check() {
    return { ok: true, state: 'works', why: 'nothing to check', detail: 'Always works' }
  },
}
