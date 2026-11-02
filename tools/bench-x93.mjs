// B917 (X93): the costs the live profile named, timed on the real store and spending ledger, for a before and after on
// the same data: the backlog view (the asks of every step), every step's window (the fixes of every step, through its
// tries) and the five spending summaries of one rebuild. Read only.
// Usage: node tools/bench-x93.mjs <board folder> <work folder> <spending.json> [rounds]
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const [board, workDir, ledgerFile, roundsArg] = process.argv.slice(2)
const rounds = Number(roundsArg ?? 5)
const load = path => import(pathToFileURL(join(board, path)).href)
const { readStore } = await load('src/work/store.mjs')
const { storeBacklog, itemOfStep } = await load('src/work/read.mjs')
const { createSpendingCollector } = await load('src/work/routing/collector.mjs')
const links = existsSync(join(board, 'src/work/links.mjs')) ? await load('src/work/links.mjs') : null
const inRebuild = (items, work) => (links === null ? work() : links.withLinks(items, work))

const store = await readStore(workDir)
const work = { ...store, ok: true, dir: workDir }
const steps = [...work.items.values()].filter(one => one.head.get('Kind') === 'step').map(one => one.head.get('Id'))
const dir = await mkdtemp(join(tmpdir(), 'bench-x93-'))
await copyFile(ledgerFile, join(dir, 'spending.json'))
const spending = createSpendingCollector({ dir, transcripts: null })
await spending.load()

const time = work => {
  const at = performance.now()
  work()
  return performance.now() - at
}
const out = { backlog: [], windows: [], summaries: [] }
for (let round = 0; round < rounds; round++) {
  out.backlog.push(time(() => storeBacklog(work)))
  out.windows.push(time(() => inRebuild(work.items, () => steps.forEach(id => itemOfStep(work, id)))))
  out.summaries.push(time(() => [1, 7, 30, null, 0.6].forEach(days => spending.summary(days))))
}
await rm(dir, { recursive: true, force: true })
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)].toFixed(0)
console.log(`${board}: ${work.items.size} items, ${steps.length} steps; median of ${rounds} (ms): backlog view ${median(out.backlog)}, every step's window ${median(out.windows)}, five spending summaries ${median(out.summaries)}`)
