// F55 (2026-11-23, chat 1's review): the claim file beside the loop lock, as the file system gives it to `loopOwner`'s `claim`
// ports. The claim is made with a hard link: the whole text goes to a file beside the claim first, and `link` gives it the claim's
// name in one step (EEXIST when a claim stands). A `writeFile` with `wx` would open the claim empty and fill it a step later: the
// other process read '' then, called the claim torn and took it away, and two processes owned the loops (11 double owners in
// 1500 rounds at 20 ms bursts, chat 1's probe; 0 with the link). The removal is the project's retrying one (Windows holds a file
// for a moment now and then); the file beside goes whatever happened.

import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { BUSY, besideOf, removeFile } from '../write.mjs'

/** The claim file of a loop lock: beside it, `<lock>.claim`. */
export const claimFileOf = lock => `${lock}.claim`

/**
 * The `claim` ports of `loopOwner` on `claimFile`: `create(text)` (exclusive: EEXIST when a claim stands; never seen empty),
 * `read()` (its text; ENOENT when none), `remove()` (nothing there is fine; tried again while Windows holds it). `fs` for tests.
 * Review a: a folder without hard links (exFAT, FAT32, some network or synced folders) refuses `link` with something other than
 * EEXIST or a held file: the claim is then written under its own name with `wx` (exclusive still, only no longer never-empty), so
 * the board on such a folder runs its loops at all.
 */
export function claimPorts(claimFile, fs = { link, mkdir, readFile, rm, writeFile }) {
  return {
    create: async text => {
      await fs.mkdir(dirname(claimFile), { recursive: true })
      const beside = besideOf(claimFile)
      try {
        await fs.writeFile(beside, text, { flag: 'wx' })
        try {
          await fs.link(beside, claimFile)
        } catch (error) {
          if (error?.code === 'EEXIST' || BUSY.includes(error?.code)) throw error
          await fs.writeFile(claimFile, text, { flag: 'wx' })
        }
      } finally {
        await fs.rm(beside, { force: true }).catch(() => {})
      }
    },
    read: () => fs.readFile(claimFile, 'utf8'),
    remove: () => removeFile(claimFile, fs, { force: true }),
  }
}
