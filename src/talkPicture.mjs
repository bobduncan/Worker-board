// B167: a picture pasted into "Talk to Main" on the board. The board keeps it in the project's picture folder (B193:
// the first of the settings' pictureRoots), in a folder for the talk, under a plain name of the day and the minute.
// The line typed into the main chat's chat names its full path, so the main chat can open it; the talk on the board
// shows the picture again from that line.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The talk's folder in the project's picture folder `pictures` ("pictures/talk"). */
export const talkFolder = pictures => `${pictures}/talk`

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a path is one the page may send with a message: a picture the board kept in the talk's folder. */
export function isTalkPicture(path, pictures) {
  const name = new RegExp(`^${escaped(talkFolder(pictures))}/\\d{4}-\\d{2}-\\d{2}-\\d{4}(?:-\\d{1,2})?\\.(?:png|jpg|webp)$`)
  return typeof path === 'string' && name.test(path)
}

/** "2026-10-14-1144.png" for a picture kept at 11:44 on 14 October; "-2" and on for more in the same minute. */
export function talkPictureName(at, kind, count = 1) {
  const day = new Date(at)
  const two = number => String(number).padStart(2, '0')
  const minute = `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}-${two(day.getHours())}${two(day.getMinutes())}`
  return `${minute}${count > 1 ? `-${count}` : ''}.${kind}`
}

/**
 * Keeps `bytes`, a picture of `kind` ("png"), in the talk's folder of the `project`'s picture folder `pictures`
 * under the first free name of the minute `at`: a second picture in that minute gets the next number, and nothing is
 * ever written over. Answers its path ("pictures/talk/2026-10-14-1144.png"), or null when the minute is full.
 */
export async function keepTalkPicture(project, bytes, kind, at, pictures) {
  const folder = join(project, ...talkFolder(pictures).split('/'))
  await mkdir(folder, { recursive: true })
  for (let count = 1; count <= 99; count += 1) {
    const name = talkPictureName(at, kind, count)
    try {
      await writeFile(join(folder, name), bytes, { flag: 'wx' })
      return `${talkFolder(pictures)}/${name}`
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  return null
}

/** The line under the words that tells the main chat where the picture is. */
export const pictureLine = file => `Picture: ${file}`

/** A line typed on the board in its parts again: its words, and the picture its "Picture:" line names, or null. */
export function splitPicture(text, pictures) {
  const words = String(text ?? '')
  const line = new RegExp(`^Picture: .*?[\\\\/](${escaped(pictures)}[\\\\/]talk[\\\\/][\\w.-]+)[ \\t]*$`, 'm')
  const found = words.match(line)
  const picture = found === null ? null : found[1].replace(/\\/g, '/')
  if (picture === null || !isTalkPicture(picture, pictures)) return { text: words, picture: null }
  return { text: words.replace(found[0], '').replace(/\n{3,}/g, '\n\n').trim(), picture }
}
