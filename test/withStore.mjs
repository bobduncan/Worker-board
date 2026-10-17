// B301: the board reads the work only from the work store. The tests write their made-up backlogs as text, so a test's
// `backlogText` becomes a store in memory first (work/read.mjs, `storeFromText`), as `--make-store` makes one from a
// backlog file. A raw that has `work` already, or no backlog, goes as it is.

import { buildState as build } from '../src/state.mjs'
import { storeFromText } from '../src/work/read.mjs'

export function buildState(raw, options) {
  if (raw === null || typeof raw !== 'object' || typeof raw.backlogText !== 'string' || raw.work !== undefined) return build(raw, options)
  const { backlogText, ...rest } = raw
  return build({ ...rest, work: storeFromText(backlogText, { now: options?.now ?? Date.now() }) }, options)
}
