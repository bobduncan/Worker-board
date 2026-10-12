// Reading files that belong to other programs: never more of one than the board can use.

import { open } from 'node:fs/promises'

/**
 * The first `maxBytes` of a file as text, and whether that is the whole file. Null when it cannot be read. A
 * larger file is never loaded whole, so a file that grew out of hand cannot take the board down.
 */
export async function readHead(path, maxBytes) {
  let file
  try {
    file = await open(path, 'r')
    const { size } = await file.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, 0)
    return { text: buffer.toString('utf8'), isWhole: size <= maxBytes }
  } catch {
    return null
  } finally {
    await file?.close().catch(() => {})
  }
}
