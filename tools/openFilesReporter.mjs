// F39 (2026-11-21): a second reporter of node --test (tools/test.mjs gives it a file of its own): one JSON line per test file and per
// test as it is taken up (`dequeue`) and as it ends (`complete`), so the stall watchdog can name the files still open when a run
// hangs (on 2026-11-21 taskWindowPage.test.mjs hung inside a test for an hour and nothing said which file it was).
import { basename } from 'node:path'

export default async function * openFilesReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:dequeue' && event.type !== 'test:complete') continue
    const file = typeof event.data?.file === 'string' ? event.data.file : null
    if (file === null) continue
    // The file itself is the item at nesting 0 that carries the file's own name (the bare name, or the whole path it was given by).
    const isFile = event.data.nesting === 0 && basename(String(event.data.name)) === basename(file)
    yield `${JSON.stringify({ at: event.type === 'test:dequeue' ? 'start' : 'end', file, test: isFile ? null : String(event.data.name).slice(0, 120) })}\n`
  }
}
