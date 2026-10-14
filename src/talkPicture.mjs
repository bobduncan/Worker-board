// B167: a picture pasted into "Talk to Main" on the board. The board keeps it in the project's art-inbox, in a folder
// for the talk, under a plain name of the day and the minute. The line typed into the main chat's chat names its
// full path, so the main chat can open it; the talk on the board shows the picture again from that line.

export const TALK_FOLDER = 'art-inbox/talk'

/** The one kind of path the page may send with a message: a picture the board kept in the talk's folder. */
export const TALK_PICTURE = /^art-inbox\/talk\/\d{4}-\d{2}-\d{2}-\d{4}(?:-\d{1,2})?\.(?:png|jpg|webp)$/

/** "2026-10-14-1144.png" for a picture kept at 11:44 on 14 October; "-2" and on for more in the same minute. */
export function talkPictureName(at, kind, count = 1) {
  const day = new Date(at)
  const two = number => String(number).padStart(2, '0')
  const minute = `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}-${two(day.getHours())}${two(day.getMinutes())}`
  return `${minute}${count > 1 ? `-${count}` : ''}.${kind}`
}

/** The line under the words that tells the main chat where the picture is. */
export const pictureLine = file => `Picture: ${file}`

const LINE = /^Picture: .*?[\\/](art-inbox[\\/]talk[\\/][\w.-]+)[ \t]*$/m

/** A line typed on the board in its parts again: its words, and the picture its "Picture:" line names, or null. */
export function splitPicture(text) {
  const words = String(text ?? '')
  const found = words.match(LINE)
  const picture = found === null ? null : found[1].replace(/\\/g, '/')
  if (picture === null || !TALK_PICTURE.test(picture)) return { text: words, picture: null }
  return { text: words.replace(found[0], '').replace(/\n{3,}/g, '\n\n').trim(), picture }
}
