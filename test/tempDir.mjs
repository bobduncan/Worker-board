// B406: a temporary folder for one test, taken away after it with retries: on Windows a virus scanner or the
// search indexer may hold a file for a moment, and a clean-up without retries then fails a test that passed.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The clean-up of a test's folder: tries again while Windows holds a file in it. */
export const removeDir = dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** A new folder under the system's temporary folder, removed (with retries) when the test `t` ends. */
export async function tempDir(t, prefix = 'board-test-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => removeDir(dir))
  return dir
}
