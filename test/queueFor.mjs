// Redesign Part 2: Main's queue is gone; the board gives a task to an idle worker (work/handOut.mjs, the API's give).
// Tests whose subject is something after the hand-out (a take, a report, a result check) set their step given to its
// worker with this, as the board's give writes it: queued, Owner, Since now and the give's History line.

import { stamp } from '../src/work/migrate.mjs'
import { appendHistory, readItemFile, writeItem } from '../src/work/store.mjs'

export async function queueFor(dir, id, owner, { now = Date.now() } = {}) {
  const file = await readItemFile(dir, id)
  if (file === null) throw new Error(`queueFor: no ${id} in the store`)
  const head = new Map(file.item.head)
  const from = head.get('State')
  head.set('State', 'queued')
  head.set('Owner', owner)
  head.set('Since', stamp(now))
  const item = appendHistory({ ...file.item, head }, 'server', `${from} → queued (given by the board to ${owner})`, now)
  const done = await writeItem(dir, item, undefined, { expected: file.text })
  if (!done.ok) throw new Error(`queueFor: ${done.why}`)
  return { ok: true, result: { id, changed: true } }
}
